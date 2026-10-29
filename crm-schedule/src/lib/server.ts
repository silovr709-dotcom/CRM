/* Свой сервер приложения (PHP на своём хостинге, папка server/ в репозитории).
 *
 * Одна фирма: сотрудники входят по логину/паролю, роль проверяет сервер,
 * общая база лежит на своём домене. Если API рядом нет (github.io, dev) —
 * серверный режим просто выключен и приложение работает как раньше. */

import type { RoleId } from '../types';
import type { Removed, SyncEnvelope } from './sync';
import { emptyRemoved } from './sync';

export interface ServerUser {
  id: string;
  name: string;
  login: string;
  role: RoleId;
  active: boolean;
  createdAt: string;
}

export interface ServerHealth {
  ok: boolean;
  version: number;
  needsSetup: boolean;
  users: number;
  revision: number;
}

export interface ServerUiState {
  /** Проверяли ли, есть ли рядом свой сервер. */
  checked: boolean;
  /** API своего домена отвечает. */
  available: boolean;
  /** Сервер пуст: ещё не создан руководитель. */
  needsSetup: boolean;
  user: ServerUser | null;
  status: 'off' | 'syncing' | 'ok' | 'error';
  error: string;
  lastSyncAt: string;
  revision: number;
}

export interface ServerSession {
  token: string;
  user: ServerUser;
  revision: number;
}

const SESSION_KEY = 'crm-schedule.server.v1';
const REMOVED_KEY = 'crm-schedule.server.removed.v1';

/** Адрес API рядом с приложением: на своём домене это ./api/index.php. */
export function serverApiUrl(action: string, extraQuery = ''): string {
  const base = import.meta.env.BASE_URL || './';
  return `${base}api/index.php?action=${encodeURIComponent(action)}${extraQuery}`;
}

async function call<T>(
  action: string,
  options: { method?: string; body?: unknown; token?: string; timeoutMs?: number; query?: string } = {},
): Promise<T> {
  if (typeof fetch !== 'function') throw new Error('Браузер не умеет сетевые запросы');
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? window.setTimeout(() => controller.abort(), options.timeoutMs ?? 12_000) : 0;
  let response: Response;
  try {
    response = await fetch(serverApiUrl(action, options.query), {
      method: options.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        // Токен — двумя заголовками: на части PHP-хостингов (Apache + PHP-FPM)
        // Authorization до PHP не доходит, а X-Auth-Token проходит.
        ...(options.token ? { Authorization: `Bearer ${options.token}`, 'X-Auth-Token': options.token } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller?.signal,
    });
  } catch {
    throw new Error('Нет связи с сервером');
  } finally {
    if (timer) window.clearTimeout(timer);
  }
  let payload: Record<string, unknown> = {};
  try {
    payload = (await response.json()) as Record<string, unknown>;
  } catch {
    throw new Error(`Сервер ответил ${response.status} и это не похоже на API приложения`);
  }
  if (!response.ok || payload.ok === false) {
    const message = typeof payload.message === 'string' ? payload.message : `Сервер ответил ${response.status}`;
    const error = new Error(message) as Error & { status?: number; code?: string };
    error.status = response.status;
    error.code = typeof payload.error === 'string' ? payload.error : '';
    throw error;
  }
  return payload as T;
}

/** Жив ли рядом свой сервер. null — API рядом нет (github.io, dev, чужая папка). */
export async function serverHealth(): Promise<ServerHealth | null> {
  try {
    const raw = await call<Record<string, unknown>>('health', { timeoutMs: 4_000 });
    // Чужие ответы с ok:true (например, перехватчики тестов или другой API)
    // своим сервером не считаем: нужна именно подпись нашего API.
    if (raw.ok !== true || raw.version !== 1 || typeof raw.needsSetup !== 'boolean') return null;
    return {
      ok: true,
      version: Number(raw.version) || 0,
      needsSetup: raw.needsSetup === true,
      users: Number(raw.users) || 0,
      revision: Number(raw.revision) || 0,
    };
  } catch {
    return null;
  }
}

/* ------------------------------- сессия ------------------------------- */

export function loadServerSession(): ServerSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ServerSession>;
    if (!parsed.token || !parsed.user?.id || !parsed.user.login) return null;
    return {
      token: parsed.token,
      user: parsed.user as ServerUser,
      revision: Number(parsed.revision) || 0,
    };
  } catch {
    return null;
  }
}

export function saveServerSession(session: ServerSession | null): void {
  try {
    if (!session) localStorage.removeItem(SESSION_KEY);
    else localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    /* приватный режим: сессия проживёт до закрытия вкладки в памяти вызывающего */
  }
}

/** Удаления для серверной базы: чтобы удалённое не воскресало при слиянии. */
export function loadServerRemoved(): Removed {
  try {
    const raw = localStorage.getItem(REMOVED_KEY);
    if (!raw) return emptyRemoved();
    const parsed = JSON.parse(raw) as Partial<Removed>;
    return {
      clients: parsed.clients ?? {},
      deals: parsed.deals ?? {},
      receipts: parsed.receipts ?? {},
    };
  } catch {
    return emptyRemoved();
  }
}

export function saveServerRemoved(removed: Removed): void {
  try {
    localStorage.setItem(REMOVED_KEY, JSON.stringify(removed));
  } catch {
    /* не критично */
  }
}

/* -------------------------------- вход -------------------------------- */

export async function serverSetup(input: { name: string; login: string; password: string }): Promise<ServerSession> {
  const raw = await call<{ token: string; user: ServerUser }>('setup', { method: 'POST', body: input });
  return { token: raw.token, user: raw.user, revision: 0 };
}

export async function serverLogin(input: { login: string; password: string }): Promise<ServerSession> {
  const raw = await call<{ token: string; user: ServerUser }>('login', { method: 'POST', body: input });
  return { token: raw.token, user: raw.user, revision: 0 };
}

export async function serverLogout(token: string): Promise<void> {
  try {
    await call('logout', { method: 'POST', token, timeoutMs: 4_000 });
  } catch {
    /* выход локально важнее ответа сервера */
  }
}

export async function serverMe(token: string): Promise<ServerUser> {
  const raw = await call<{ user: ServerUser }>('me', { token });
  return raw.user;
}

/* ----------------------------- пользователи ----------------------------- */

export async function serverListUsers(token: string): Promise<ServerUser[]> {
  const raw = await call<{ users: ServerUser[] }>('users', { token });
  return raw.users;
}

export async function serverCreateUser(
  token: string,
  input: { name: string; login: string; password: string; role: RoleId },
): Promise<ServerUser> {
  const raw = await call<{ user: ServerUser }>('user_create', { method: 'POST', token, body: input });
  return raw.user;
}

export async function serverUpdateUser(
  token: string,
  input: { id: string; name?: string; role?: RoleId; active?: boolean; password?: string },
): Promise<ServerUser> {
  const raw = await call<{ user: ServerUser }>('user_update', { method: 'POST', token, body: input });
  return raw.user;
}

export async function serverDeleteUser(token: string, id: string): Promise<void> {
  await call('user_delete', { method: 'POST', token, body: { id } });
}

/* -------------------------------- данные -------------------------------- */

export interface ServerPull {
  found: boolean;
  unchanged: boolean;
  revision: number;
  envelope: SyncEnvelope | null;
  updatedAt: string;
  device: string;
}

/** Прочитать общую базу. knownRevision — не тянуть документ, если версия та же. */
export async function serverPull(token: string, knownRevision = 0): Promise<ServerPull> {
  const raw = await call<Record<string, unknown>>('data', {
    token,
    query: knownRevision > 0 ? `&known_revision=${knownRevision}` : '',
  });
  const envelope = (raw.envelope ?? null) as SyncEnvelope | null;
  return {
    found: raw.found === true,
    unchanged: raw.unchanged === true,
    revision: Number(raw.revision) || 0,
    envelope: envelope && typeof envelope === 'object' ? envelope : null,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
    device: typeof raw.device === 'string' ? raw.device : '',
  };
}

export type ServerPush =
  | { ok: true; revision: number }
  | { ok: false; conflict: true; revision: number }
  | { ok: false; conflict: false; error: string };

/** Записать общую базу поверх известной версии. Чужая новая версия — конфликт, не затирание. */
export async function serverPush(token: string, envelope: SyncEnvelope, revision: number): Promise<ServerPush> {
  try {
    const raw = await call<{ revision: number }>('data', {
      method: 'POST',
      token,
      body: { envelope, revision, device: envelope.device },
    });
    return { ok: true, revision: Number(raw.revision) || revision + 1 };
  } catch (error) {
    const shaped = error as Error & { status?: number; code?: string };
    if (shaped.status === 409 || shaped.code === 'conflict') {
      return { ok: false, conflict: true, revision };
    }
    return { ok: false, conflict: false, error: shaped.message || 'Сервер не принял данные' };
  }
}
