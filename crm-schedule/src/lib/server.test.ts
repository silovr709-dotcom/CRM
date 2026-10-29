// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  loadServerRemoved, loadServerSession, saveServerRemoved, saveServerSession,
  serverHealth, serverLogin, serverPull, serverPush,
} from './server';
import { emptyRemoved, type SyncEnvelope } from './sync';
import { emptyData } from './storage';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const user = {
  id: 'usr-1', name: 'Ирина', login: 'irina', role: 'owner' as const, active: true,
  createdAt: '2026-10-26T00:00:00.000Z',
};

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('свой сервер: адрес и здоровье', () => {
  it('здоровье читает из соседнего api/index.php', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true, version: 1, needsSetup: true, users: 0, revision: 0 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(serverHealth()).resolves.toEqual({
      ok: true, version: 1, needsSetup: true, users: 0, revision: 0,
    });
    expect(String((fetchMock.mock.calls as unknown as Array<[string]>)[0][0])).toContain('api/index.php?action=health');
  });

  it('нет API рядом (github.io) — серверный режим выключен, а не ошибка', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>404</html>', { status: 404 })));
    await expect(serverHealth()).resolves.toBeNull();
  });
});

describe('свой сервер: сессия', () => {
  it('вход возвращает токен и пользователя, сессия сохраняется', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: true, token: 'tok-123', user })));

    const session = await serverLogin({ login: 'irina', password: 'secret1' });
    expect(session.token).toBe('tok-123');
    expect(session.user.role).toBe('owner');

    saveServerSession(session);
    expect(loadServerSession()?.user.login).toBe('irina');
    saveServerSession(null);
    expect(loadServerSession()).toBeNull();
  });

  it('битая сохранённая сессия не ломает приложение', () => {
    localStorage.setItem('crm-schedule.server.v1', '{мусор');
    expect(loadServerSession()).toBeNull();
  });

  it('ошибка входа приходит текстом для человека', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(
      { ok: false, error: 'credentials', message: 'Логин или пароль не подошли' },
      401,
    )));
    await expect(serverLogin({ login: 'irina', password: 'bad' })).rejects.toThrow('не подошли');
  });
});

describe('свой сервер: данные', () => {
  const envelope = (): SyncEnvelope => ({
    kind: 'crm-schedule/sync',
    schema: 1,
    device: 'Тестовое устройство',
    savedAt: '2026-10-26T00:00:00.000Z',
    data: emptyData(),
    removed: emptyRemoved(),
  });

  it('чтение с известной версией не тянет документ', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      ok: true, found: true, unchanged: true, revision: 5, updatedAt: '', device: 'ПК',
    }));
    vi.stubGlobal('fetch', fetchMock);

    const pull = await serverPull('tok', 5);
    expect(pull).toMatchObject({ found: true, unchanged: true, revision: 5, envelope: null });
    expect(String((fetchMock.mock.calls as unknown as Array<[string]>)[0][0])).toContain('known_revision=5');
  });

  it('токен уходит и стандартным, и запасным заголовком', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      ok: true, found: true, unchanged: true, revision: 5, updatedAt: '', device: 'ПК',
    }));
    vi.stubGlobal('fetch', fetchMock);

    await serverPull('tok-abc', 5);
    const init = (fetchMock.mock.calls as unknown as Array<[string, RequestInit]>)[0][1];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok-abc');
    expect(headers['X-Auth-Token']).toBe('tok-abc');
  });

  it('конфликт записи — не ошибка, а сигнал перечитать базу', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(
      { ok: false, conflict: true, revision: 7, message: 'На сервере уже есть более новая версия' },
      409,
    )));
    await expect(serverPush('tok', envelope(), 5)).resolves.toEqual({
      ok: false, conflict: true, revision: 5,
    });
  });

  it('удаления для серверной базы переживают перезапуск', () => {
    const removed = emptyRemoved();
    removed.deals['deal-1'] = '2026-10-26T00:00:00.000Z';
    removed.receipts['rcpt-1'] = '2026-10-26T00:00:00.000Z';
    saveServerRemoved(removed);
    expect(loadServerRemoved().deals['deal-1']).toBeTruthy();
    expect(loadServerRemoved().receipts['rcpt-1']).toBeTruthy();
  });
});
