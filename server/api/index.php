<?php
/* Сервер приложения «CRM + График» на обычном PHP-хостинге (reg.ru).
 *
 * Одна фирма: сотрудники с ролями (owner/manager/installer), вход по
 * логину/паролю (password_hash), токены сессий, общая база одним документом.
 * Хранилище — JSON-файл в data/ (директория закрыта от прямого доступа).
 * Роль enforced на сервере: монтажник не получает деньги даже напрямую
 * из API, а его запись не может стереть суммы, которых он не видел.
 */

declare(strict_types=1);

const API_VERSION = 1;
const TOKEN_TTL = 2592000; // 30 дней
const MAX_BODY = 8388608; // 8 МБ на документ базы
const MAX_FILE = 10485760; // 10 МБ на один файл вложения
const LOGIN_FAIL_LIMIT = 5; // после стольких неудач — пауза во входе
const LOGIN_FAIL_PAUSE = 900; // 15 минут
const ROLES = ['owner', 'manager', 'installer'];
const SESSION_COOKIE = 'crm_session';

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Auth-Token, X-File-Id, X-File-Name, X-File-Mime, X-File-Owner, X-File-Owner-Type');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

function out(array $payload, int $status = 200): void
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function body(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') return [];
    if (strlen($raw) > MAX_BODY) out(['ok' => false, 'error' => 'too_large', 'message' => 'Слишком большой запрос'], 413);
    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : [];
}

function dataDir(): string
{
    $dir = __DIR__ . '/data';
    if (!is_dir($dir)) @mkdir($dir, 0775, true);
    return $dir;
}

function statePath(): string
{
    return dataDir() . '/state.json';
}

function emptyState(): array
{
    return [
        'users' => [],
        'sessions' => [],
        'files' => [],
        'loginFails' => [],
        'workspace' => ['revision' => 0, 'envelope' => null, 'updatedAt' => '', 'device' => '', 'versions' => []],
    ];
}

/* Чтение-изменение-запись состояния одним захватом файла: без гонок. */
function withState(callable $fn)
{
    $path = statePath();
    $handle = fopen($path, 'c+');
    if ($handle === false) out(['ok' => false, 'error' => 'storage', 'message' => 'Сервер не может хранить данные'], 500);
    flock($handle, LOCK_EX);
    $raw = stream_get_contents($handle);
    $state = $raw ? json_decode($raw, true) : null;
    if (!is_array($state)) $state = emptyState();
    $state += emptyState();
    $state['users'] = is_array($state['users'] ?? null) ? $state['users'] : [];
    $state['sessions'] = is_array($state['sessions'] ?? null) ? $state['sessions'] : [];
    $state['files'] = is_array($state['files'] ?? null) ? $state['files'] : [];
    $state['loginFails'] = is_array($state['loginFails'] ?? null) ? $state['loginFails'] : [];
    $state['workspace'] = is_array($state['workspace'] ?? null) ? $state['workspace'] : emptyState()['workspace'];

    [$result, $dirty] = $fn($state);
    if ($dirty) {
        rewind($handle);
        ftruncate($handle, 0);
        fwrite($handle, json_encode($state, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
        fflush($handle);
    }
    flock($handle, LOCK_UN);
    fclose($handle);
    return $result;
}

function publicUser(array $user): array
{
    return [
        'id' => $user['id'],
        'name' => $user['name'],
        'login' => $user['login'],
        'role' => $user['role'],
        'active' => $user['active'] ?? true,
        'createdAt' => $user['createdAt'] ?? '',
    ];
}

function findUser(array $state, string $id): ?array
{
    foreach ($state['users'] as $user) if (($user['id'] ?? '') === $id) return $user;
    return null;
}

function makeToken(array &$state, string $userId): string
{
    $token = bin2hex(random_bytes(32));
    // Старые сессии этого пользователя не копим бесконечно.
    foreach ($state['sessions'] as $hash => $session) {
        if (($session['expires'] ?? 0) < time()) unset($state['sessions'][$hash]);
    }
    $state['sessions'][hash('sha256', $token)] = ['userId' => $userId, 'expires' => time() + TOKEN_TTL];
    return $token;
}

/* Токен из заголовков: Authorization на виртуальных хостингах Apache часто
 * не доходит до PHP, поэтому смотрим все места, где он может оказаться,
 * включая запасной X-Auth-Token (его клиент присылает всегда вместе). */
function bearerToken(): string
{
    $candidates = [
        (string)($_SERVER['HTTP_AUTHORIZATION'] ?? ''),
        (string)($_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? ''),
        (string)($_SERVER['HTTP_X_AUTH_TOKEN'] ?? ''),
    ];
    if (function_exists('getallheaders')) {
        $headers = getallheaders();
        if (is_array($headers)) {
            foreach ($headers as $name => $value) {
                $lower = strtolower((string)$name);
                if ($lower === 'authorization' || $lower === 'x-auth-token') $candidates[] = (string)$value;
            }
        }
    }
    foreach ($candidates as $candidate) {
        $candidate = trim($candidate);
        if ($candidate === '') continue;
        if (preg_match('/Bearer\s+(.+)/i', $candidate, $m)) return trim($m[1]);
        if (strpos($candidate, ' ') === false) return $candidate; // X-Auth-Token приходит без префикса
    }
    // Последний запасной канал — cookie сессии. Она не зависит от того,
    // пропустил ли Apache заголовки до PHP.
    return trim((string)($_COOKIE[SESSION_COOKIE] ?? ''));
}

function setSessionCookie(string $token, bool $clear = false): void
{
    if (headers_sent()) return;
    $expires = $clear ? time() - 3600 : time() + TOKEN_TTL;
    $secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
    $parts = [
        SESSION_COOKIE . '=' . rawurlencode($clear ? '' : $token),
        'Expires=' . gmdate('D, d M Y H:i:s', $expires) . ' GMT',
        'Max-Age=' . ($clear ? 0 : TOKEN_TTL),
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
    ];
    if ($secure) $parts[] = 'Secure';
    header('Set-Cookie: ' . implode('; ', $parts), false);
}

function authUser(array $state): ?array
{
    $token = bearerToken();
    if ($token === '') return null;
    $hash = hash('sha256', $token);
    $session = $state['sessions'][$hash] ?? null;
    if (!$session || ($session['expires'] ?? 0) < time()) return null;
    $user = findUser($state, (string)($session['userId'] ?? ''));
    if (!$user || !($user['active'] ?? true)) return null;
    return $user;
}

function requireUser(array $state): array
{
    $user = authUser($state);
    if (!$user) out(['ok' => false, 'error' => 'unauthorized', 'message' => 'Войдите, пожалуйста'], 401);
    return $user;
}

function requireOwner(array $state): array
{
    $user = requireUser($state);
    if (($user['role'] ?? '') !== 'owner') out(['ok' => false, 'error' => 'forbidden', 'message' => 'Это может только руководитель'], 403);
    return $user;
}

function cleanLogin(string $login): string
{
    return mb_strtolower(trim($login));
}

function validRole($role): bool
{
    return in_array($role, ROLES, true);
}

/* ------------------------- роли и денежные поля ------------------------- */

/* Убирает из сделки то, что роли видеть нельзя. */
function hideMoneyFromDeal(array $deal, string $role): array
{
    if ($role === 'installer') {
        $deal['amount'] = 0;
        $deal['payments'] = [];
        $deal['plan'] = [];
        $deal['expenses'] = [];
        if (isset($deal['items']) && is_array($deal['items'])) {
            foreach ($deal['items'] as &$item) if (is_array($item)) $item['price'] = 0;
            unset($item);
        }
    } elseif ($role === 'manager') {
        $deal['expenses'] = [];
    }
    return $deal;
}

/* Что отдаём пользователю: деньги фильтруются по роли прямо на сервере. */
function envelopeForRole($envelope, string $role)
{
    if (!is_array($envelope) || !isset($envelope['data']) || !is_array($envelope['data'])) return $envelope;
    if (isset($envelope['data']['settings']) && is_array($envelope['data']['settings'])) {
        // Учётки живут на сервере, в документе базы их отпечатков быть не должно.
        $envelope['data']['settings']['accounts'] = [];
    }
    if ($role !== 'owner' && isset($envelope['data']['deals']) && is_array($envelope['data']['deals'])) {
        foreach ($envelope['data']['deals'] as &$deal) {
            if (is_array($deal)) $deal = hideMoneyFromDeal($deal, $role);
        }
        unset($deal);
    }
    return $envelope;
}

/**
 * Что принимаем на хранение: чужие деньги записью не затираем.
 * Не-руководитель не меняет настройки фирмы; монтажник не трогает суммы,
 * оплаты, план и затраты; менеджер не трогает затраты.
 */
function envelopeForStorage(array $incoming, string $role, $stored): array
{
    if (isset($incoming['data']['settings']) && is_array($incoming['data']['settings'])) {
        $incoming['data']['settings']['accounts'] = [];
    }
    if (!is_array($stored) || !isset($stored['data']) || !is_array($stored['data'])) {
        // Первую запись делает тот, кто вошёл первым (руководитель после настройки).
        return envelopeForRole($incoming, 'owner');
    }
    if ($role !== 'owner' && isset($stored['data']['settings'])) {
        $incoming['data']['settings'] = $stored['data']['settings'];
    }
    if ($role === 'owner') return $incoming;
    if (!isset($incoming['data']['deals']) || !is_array($incoming['data']['deals'])) return $incoming;

    $storedDeals = [];
    foreach (($stored['data']['deals'] ?? []) as $deal) {
        if (is_array($deal) && isset($deal['id'])) $storedDeals[(string)$deal['id']] = $deal;
    }
    foreach ($incoming['data']['deals'] as &$deal) {
        if (!is_array($deal) || !isset($deal['id'])) continue;
        $old = $storedDeals[(string)$deal['id']] ?? null;
        if ($role === 'manager') {
            if ($old !== null && isset($old['expenses'])) $deal['expenses'] = $old['expenses'];
            else $deal['expenses'] = [];
        } elseif ($role === 'installer') {
            if ($old !== null) {
                foreach (['amount', 'payments', 'plan', 'expenses', 'items'] as $field) {
                    if (array_key_exists($field, $old)) $deal[$field] = $old[$field];
                }
            } else {
                $deal = hideMoneyFromDeal($deal, 'installer');
            }
        }
    }
    unset($deal);
    return $incoming;
}

/* -------------------------------- маршруты -------------------------------- */

$action = (string)($_GET['action'] ?? 'health');
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($action === 'health') {
    $info = withState(function (array $state) {
        return [[
            'ok' => true,
            'version' => API_VERSION,
            'needsSetup' => count($state['users']) === 0,
            'users' => count($state['users']),
            'revision' => (int)($state['workspace']['revision'] ?? 0),
        ], false];
    });
    out($info);
}

if ($action === 'setup' && $method === 'POST') {
    $input = body();
    $name = trim((string)($input['name'] ?? ''));
    $login = cleanLogin((string)($input['login'] ?? ''));
    $password = (string)($input['password'] ?? '');
    if ($name === '' || $login === '' || mb_strlen($password) < 6) {
        out(['ok' => false, 'error' => 'invalid', 'message' => 'Имя, логин и пароль не короче 6 символов'], 422);
    }
    $result = withState(function (array &$state) use ($name, $login, $password) {
        if (count($state['users']) > 0) return [['error' => 'done'], false];
        $user = [
            'id' => 'usr-' . bin2hex(random_bytes(6)),
            'name' => $name,
            'login' => $login,
            'passHash' => password_hash($password, PASSWORD_DEFAULT),
            'role' => 'owner',
            'active' => true,
            'createdAt' => gmdate('c'),
        ];
        $state['users'][] = $user;
        $token = makeToken($state, $user['id']);
        return [['user' => $user, 'token' => $token], true];
    });
    if (isset($result['error'])) out(['ok' => false, 'error' => 'setup_done', 'message' => 'Руководитель уже создан — войдите'], 409);
    setSessionCookie((string)$result['token']);
    out(['ok' => true, 'token' => $result['token'], 'user' => publicUser($result['user'])]);
}

if ($action === 'login' && $method === 'POST') {
    $input = body();
    $login = cleanLogin((string)($input['login'] ?? ''));
    $password = (string)($input['password'] ?? '');
    // Защита от подбора пароля: после нескольких неудач с одного адреса
    // вход по этому логину закрывается на паузу.
    $failKey = $login . '|' . (string)($_SERVER['REMOTE_ADDR'] ?? '');
    $result = withState(function (array &$state) use ($login, $password, $failKey) {
        $now = time();
        // Старые записи о неудачах не копим.
        foreach ($state['loginFails'] as $key => $fail) {
            if (!is_array($fail) || $now - (int)($fail['last'] ?? 0) > 86400) unset($state['loginFails'][$key]);
        }
        $fail = $state['loginFails'][$failKey] ?? null;
        if (is_array($fail)
            && (int)($fail['count'] ?? 0) >= LOGIN_FAIL_LIMIT
            && $now - (int)($fail['last'] ?? 0) < LOGIN_FAIL_PAUSE) {
            return [['locked' => (int)($fail['last'] ?? $now) + LOGIN_FAIL_PAUSE - $now], false];
        }
        foreach ($state['users'] as $user) {
            if (($user['login'] ?? '') === $login && ($user['active'] ?? true)) {
                if (password_verify($password, (string)($user['passHash'] ?? ''))) {
                    unset($state['loginFails'][$failKey]);
                    $token = makeToken($state, $user['id']);
                    return [['user' => $user, 'token' => $token], true];
                }
                break;
            }
        }
        $count = is_array($fail) ? (int)($fail['count'] ?? 0) : 0;
        if (is_array($fail) && $now - (int)($fail['last'] ?? 0) >= LOGIN_FAIL_PAUSE) $count = 0;
        $state['loginFails'][$failKey] = ['count' => $count + 1, 'last' => $now];
        return [null, true];
    });
    if (is_array($result) && isset($result['locked'])) {
        $minutes = max(1, (int)ceil(((int)$result['locked']) / 60));
        out(['ok' => false, 'error' => 'locked', 'message' => "Слишком много попыток входа. Подождите {$minutes} мин. и попробуйте ещё раз"], 429);
    }
    if ($result === null) out(['ok' => false, 'error' => 'credentials', 'message' => 'Логин или пароль не подошли'], 401);
    setSessionCookie((string)$result['token']);
    out(['ok' => true, 'token' => $result['token'], 'user' => publicUser($result['user'])]);
}

if ($action === 'logout' && $method === 'POST') {
    $token = bearerToken();
    if ($token !== '') {
        $hash = hash('sha256', $token);
        withState(function (array &$state) use ($hash) {
            unset($state['sessions'][$hash]);
            return [true, true];
        });
    }
    setSessionCookie('', true);
    out(['ok' => true]);
}

if ($action === 'me') {
    $user = withState(function (array $state) {
        $me = authUser($state);
        return [$me ? publicUser($me) : null, false];
    });
    if ($user === null) out(['ok' => false, 'error' => 'unauthorized', 'message' => 'Войдите, пожалуйста'], 401);
    out(['ok' => true, 'user' => $user]);
}

/* ------------------------------ пользователи ------------------------------ */

if ($action === 'users' && $method === 'GET') {
    $users = withState(function (array $state) {
        requireOwner($state);
        return [array_map('publicUser', $state['users']), false];
    });
    out(['ok' => true, 'users' => $users]);
}

if ($action === 'user_create' && $method === 'POST') {
    $input = body();
    $name = trim((string)($input['name'] ?? ''));
    $login = cleanLogin((string)($input['login'] ?? ''));
    $password = (string)($input['password'] ?? '');
    $role = (string)($input['role'] ?? 'manager');
    if ($name === '' || $login === '' || mb_strlen($password) < 6 || !validRole($role)) {
        out(['ok' => false, 'error' => 'invalid', 'message' => 'Имя, логин, пароль от 6 символов и роль обязательны'], 422);
    }
    $result = withState(function (array &$state) use ($name, $login, $password, $role) {
        requireOwner($state);
        foreach ($state['users'] as $user) {
            if (($user['login'] ?? '') === $login) return ['taken', false];
        }
        $user = [
            'id' => 'usr-' . bin2hex(random_bytes(6)),
            'name' => $name,
            'login' => $login,
            'passHash' => password_hash($password, PASSWORD_DEFAULT),
            'role' => $role,
            'active' => true,
            'createdAt' => gmdate('c'),
        ];
        $state['users'][] = $user;
        return [$user, true];
    });
    if ($result === 'taken') out(['ok' => false, 'error' => 'login_taken', 'message' => 'Такой логин уже занят'], 409);
    out(['ok' => true, 'user' => publicUser($result)]);
}

if ($action === 'user_update' && $method === 'POST') {
    $input = body();
    $id = (string)($input['id'] ?? '');
    $result = withState(function (array &$state) use ($input, $id) {
        $actor = requireOwner($state);
        foreach ($state['users'] as &$user) {
            if (($user['id'] ?? '') !== $id) continue;
            if (isset($input['name']) && trim((string)$input['name']) !== '') $user['name'] = trim((string)$input['name']);
            if (isset($input['role']) && validRole($input['role'])) {
                if (($user['role'] ?? '') === 'owner' && $input['role'] !== 'owner') {
                    $owners = count(array_filter($state['users'], fn($u) => ($u['role'] ?? '') === 'owner' && ($u['active'] ?? true)));
                    if ($owners <= 1) return ['last_owner', false];
                }
                $user['role'] = (string)$input['role'];
            }
            if (isset($input['active'])) {
                if (($actor['id'] ?? '') === $id && !$input['active']) return ['self', false];
                $user['active'] = (bool)$input['active'];
                if (!$user['active']) {
                    foreach ($state['sessions'] as $hash => $session) {
                        if (($session['userId'] ?? '') === $id) unset($state['sessions'][$hash]);
                    }
                }
            }
            if (isset($input['password']) && (string)$input['password'] !== '') {
                if (mb_strlen((string)$input['password']) < 6) return ['short', false];
                $user['passHash'] = password_hash((string)$input['password'], PASSWORD_DEFAULT);
            }
            return [$user, true];
        }
        unset($user);
        return [null, false];
    });
    if ($result === 'last_owner') out(['ok' => false, 'error' => 'last_owner', 'message' => 'Нельзя убрать последнего руководителя'], 422);
    if ($result === 'self') out(['ok' => false, 'error' => 'self', 'message' => 'Себя отключить нельзя'], 422);
    if ($result === 'short') out(['ok' => false, 'error' => 'invalid', 'message' => 'Пароль короче 6 символов'], 422);
    if ($result === null) out(['ok' => false, 'error' => 'not_found', 'message' => 'Пользователь не найден'], 404);
    out(['ok' => true, 'user' => publicUser($result)]);
}

if ($action === 'user_delete' && $method === 'POST') {
    $input = body();
    $id = (string)($input['id'] ?? '');
    $result = withState(function (array &$state) use ($id) {
        $actor = requireOwner($state);
        if (($actor['id'] ?? '') === $id) return ['self', false];
        $before = count($state['users']);
        $state['users'] = array_values(array_filter($state['users'], fn($u) => ($u['id'] ?? '') !== $id));
        if (count($state['users']) === $before) return [null, false];
        foreach ($state['sessions'] as $hash => $session) {
            if (($session['userId'] ?? '') === $id) unset($state['sessions'][$hash]);
        }
        return [true, true];
    });
    if ($result === 'self') out(['ok' => false, 'error' => 'self', 'message' => 'Себя удалить нельзя'], 422);
    if ($result === null) out(['ok' => false, 'error' => 'not_found', 'message' => 'Пользователь не найден'], 404);
    out(['ok' => true]);
}

/* --------------------------------- данные --------------------------------- */

if ($action === 'data' && $method === 'GET') {
    $known = isset($_GET['known_revision']) ? (int)$_GET['known_revision'] : 0;
    $result = withState(function (array $state) use ($known) {
        $user = requireUser($state);
        $workspace = $state['workspace'];
        $revision = (int)($workspace['revision'] ?? 0);
        if (empty($workspace['envelope'])) {
            return [['found' => false, 'revision' => 0, 'user' => publicUser($user)], false];
        }
        if ($known > 0 && $known === $revision) {
            return [[
                'found' => true, 'unchanged' => true, 'revision' => $revision,
                'updatedAt' => $workspace['updatedAt'] ?? '', 'device' => $workspace['device'] ?? '',
                'user' => publicUser($user),
            ], false];
        }
        return [[
            'found' => true, 'revision' => $revision,
            'envelope' => envelopeForRole($workspace['envelope'], (string)$user['role']),
            'updatedAt' => $workspace['updatedAt'] ?? '', 'device' => $workspace['device'] ?? '',
            'user' => publicUser($user),
        ], false];
    });
    out(array_merge(['ok' => true], $result));
}

if ($action === 'data' && $method === 'POST') {
    $input = body();
    $envelope = $input['envelope'] ?? null;
    $baseRevision = (int)($input['revision'] ?? 0);
    $device = mb_substr((string)($input['device'] ?? ''), 0, 80);
    if (!is_array($envelope) || !isset($envelope['data']) || !is_array($envelope['data'])) {
        out(['ok' => false, 'error' => 'invalid', 'message' => 'Нет данных для записи'], 422);
    }
    $result = withState(function (array &$state) use ($envelope, $baseRevision, $device) {
        $user = requireUser($state);
        $workspace = &$state['workspace'];
        $revision = (int)($workspace['revision'] ?? 0);
        if ($baseRevision !== $revision) {
            return [['conflict' => true, 'revision' => $revision], false];
        }
        $workspace['envelope'] = envelopeForStorage($envelope, (string)$user['role'], $workspace['envelope'] ?? null);
        $workspace['revision'] = $revision + 1;
        $workspace['updatedAt'] = gmdate('c');
        $workspace['device'] = $device;
        $versions = $workspace['versions'] ?? [];
        $versions[] = [
            'revision' => $workspace['revision'],
            'device' => $device,
            'savedAt' => $workspace['updatedAt'],
            'user' => $user['name'] ?? '',
            'envelope' => $workspace['envelope'],
        ];
        $workspace['versions'] = array_slice($versions, -12);
        return [['revision' => $workspace['revision']], true];
    });
    if (!empty($result['conflict'])) {
        out(['ok' => false, 'conflict' => true, 'revision' => $result['revision'], 'message' => 'На сервере уже есть более новая версия'], 409);
    }
    out(['ok' => true, 'revision' => $result['revision']]);
}

if ($action === 'versions' && $method === 'GET') {
    $versions = withState(function (array $state) {
        requireOwner($state);
        $list = [];
        foreach (($state['workspace']['versions'] ?? []) as $version) {
            $envelope = $version['envelope'] ?? null;
            $list[] = [
                'revision' => (int)($version['revision'] ?? 0),
                'device' => (string)($version['device'] ?? ''),
                'savedAt' => (string)($version['savedAt'] ?? ''),
                'user' => (string)($version['user'] ?? ''),
                'deals' => is_array($envelope) ? count($envelope['data']['deals'] ?? []) : 0,
                'clients' => is_array($envelope) ? count($envelope['data']['clients'] ?? []) : 0,
            ];
        }
        return [array_reverse($list), false];
    });
    out(['ok' => true, 'versions' => $versions]);
}

if ($action === 'version_restore' && $method === 'POST') {
    $input = body();
    $wanted = (int)($input['revision'] ?? 0);
    $result = withState(function (array &$state) use ($wanted) {
        requireOwner($state);
        foreach (($state['workspace']['versions'] ?? []) as $version) {
            if ((int)($version['revision'] ?? 0) === $wanted && isset($version['envelope'])) {
                $state['workspace']['envelope'] = $version['envelope'];
                $state['workspace']['revision'] = ((int)($state['workspace']['revision'] ?? 0)) + 1;
                $state['workspace']['updatedAt'] = gmdate('c');
                $state['workspace']['device'] = 'восстановлено';
                return [$state['workspace']['revision'], true];
            }
        }
        return [null, false];
    });
    if ($result === null) out(['ok' => false, 'error' => 'not_found', 'message' => 'Версия не найдена'], 404);
    out(['ok' => true, 'revision' => $result]);
}

/* -------------------------------- файлы -------------------------------- */

/* Сами файлы лежат на диске рядом с состоянием, в документ базы попадают
 * только описания: база не раздуется из-за фотографий монтажей. */
function filesDir(): string
{
    $dir = dataDir() . '/files';
    if (!is_dir($dir)) @mkdir($dir, 0775, true);
    return $dir;
}

function validFileId(string $id): bool
{
    return (bool)preg_match('/^[A-Za-z0-9_-]{1,80}$/', $id);
}

if ($action === 'files' && $method === 'GET') {
    $files = withState(function (array $state) {
        requireUser($state);
        return [$state['files'] ?? [], false];
    });
    out(['ok' => true, 'files' => $files]);
}

if ($action === 'file' && $method === 'GET') {
    $id = (string)($_GET['id'] ?? '');
    if (!validFileId($id)) out(['ok' => false, 'error' => 'invalid', 'message' => 'Неверный файл'], 422);
    $meta = withState(function (array $state) use ($id) {
        requireUser($state);
        return [$state['files'][$id] ?? null, false];
    });
    $path = filesDir() . '/' . $id . '.bin';
    if (!is_array($meta) || !is_file($path)) {
        out(['ok' => false, 'error' => 'not_found', 'message' => 'Файл не найден на сервере'], 404);
    }
    header('Content-Type: ' . ((string)($meta['mime'] ?? '') !== '' ? (string)$meta['mime'] : 'application/octet-stream'));
    header('Content-Length: ' . (string)filesize($path));
    header("Content-Disposition: inline; filename*=UTF-8''" . rawurlencode((string)($meta['name'] ?? $id)));
    readfile($path);
    exit;
}

if ($action === 'file_upload' && $method === 'POST') {
    $id = (string)($_SERVER['HTTP_X_FILE_ID'] ?? '');
    if (!validFileId($id)) out(['ok' => false, 'error' => 'invalid', 'message' => 'Неверный файл'], 422);
    $raw = file_get_contents('php://input');
    if ($raw === false) out(['ok' => false, 'error' => 'storage', 'message' => 'Не удалось прочитать файл'], 500);
    if (strlen($raw) > MAX_FILE) out(['ok' => false, 'error' => 'too_large', 'message' => 'Файл больше 10 МБ'], 413);
    $name = mb_substr(urldecode((string)($_SERVER['HTTP_X_FILE_NAME'] ?? $id)), 0, 200);
    $mime = mb_substr((string)($_SERVER['HTTP_X_FILE_MIME'] ?? 'application/octet-stream'), 0, 120);
    $ownerType = mb_substr((string)($_SERVER['HTTP_X_FILE_OWNER_TYPE'] ?? ''), 0, 20);
    $ownerId = mb_substr((string)($_SERVER['HTTP_X_FILE_OWNER'] ?? ''), 0, 80);
    // Сначала проверяем вход и кладём файл на диск, описание — в состояние.
    withState(function (array $state) {
        requireUser($state);
        return [true, false];
    });
    $path = filesDir() . '/' . $id . '.bin';
    $tmp = $path . '.tmp' . bin2hex(random_bytes(4));
    if (file_put_contents($tmp, $raw) === false || !rename($tmp, $path)) {
        @unlink($tmp);
        out(['ok' => false, 'error' => 'storage', 'message' => 'Сервер не может сохранить файл'], 500);
    }
    $meta = withState(function (array &$state) use ($id, $name, $mime, $ownerType, $ownerId, $raw) {
        $user = requireUser($state);
        $meta = [
            'name' => $name,
            'mime' => $mime,
            'size' => strlen($raw),
            'ownerType' => $ownerType,
            'ownerId' => $ownerId,
            'by' => (string)($user['name'] ?? ''),
            'at' => gmdate('c'),
        ];
        $state['files'][$id] = $meta;
        return [$meta, true];
    });
    out(['ok' => true, 'file' => $meta]);
}

if ($action === 'file_delete' && $method === 'POST') {
    $input = body();
    $id = (string)($input['id'] ?? '');
    if (!validFileId($id)) out(['ok' => false, 'error' => 'invalid', 'message' => 'Неверный файл'], 422);
    withState(function (array &$state) use ($id) {
        requireUser($state);
        unset($state['files'][$id]);
        return [true, true];
    });
    @unlink(filesDir() . '/' . $id . '.bin');
    out(['ok' => true]);
}

out(['ok' => false, 'error' => 'unknown_action', 'message' => 'Неизвестный запрос'], 404);
