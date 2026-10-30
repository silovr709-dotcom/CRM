// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppData, Client } from '../types';
import { emptyData } from './storage';
import { daysAgoIso, makeDeal } from './testUtils';
import {
  buildEnvelope, emptyRemoved, envelopeSignature, formatSyncCode, hashEnvelope, makeSyncCode,
  fetchVersion, listVersions, mergeRemoved, mergeSyncData, normalizeSyncCode, parseEnvelope,
  pullSpace, pushSpace, SYNC_ENDPOINT,
} from './sync';

function makeClient(patch: Partial<Client> = {}): Client {
  return {
    id: 'client-1',
    name: 'Анна Смирнова',
    phones: [],
    emails: [],
    tags: [],
    createdAt: '2026-01-01T09:00:00.000Z',
    updatedAt: '2026-01-01T09:00:00.000Z',
    ...patch,
  };
}

function makeData(patch: Partial<AppData> = {}): AppData {
  return { ...emptyData(), createdAt: '2026-01-01T09:00:00.000Z', updatedAt: '2026-01-01T09:00:00.000Z', ...patch };
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('свободные события при слиянии', () => {
  it('объединяет события и не воскрешает удалённые', () => {
    const stamp = (daysAgo: number) => new Date(Date.now() - daysAgo * 86400000).toISOString();
    const event = {
      id: 'evt-1',
      title: 'Обучение',
      date: '2026-10-11',
      createdAt: stamp(5),
      updatedAt: stamp(5),
    };
    const local = makeData({ events: [] });
    const remote = makeData({ events: [event] });
    const merged = mergeSyncData(local, remote, emptyRemoved());
    expect(merged.data.events.map((item) => item.id)).toEqual(['evt-1']);

    const deleted = mergeSyncData(
      local,
      remote,
      { ...emptyRemoved(), events: { 'evt-1': stamp(2) } },
    );
    expect(deleted.data.events).toHaveLength(0);
    expect(deleted.removed.events['evt-1']).toBeTruthy();
  });
});

describe('код общей базы', () => {
  it('создаёт 24 символа без похожих друг на друга знаков', () => {
    const code = makeSyncCode();
    expect(code).toHaveLength(24);
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{24}$/);
    expect(makeSyncCode()).not.toBe(code);
  });

  it('понимает код с дефисами, пробелами и в нижнем регистре', () => {
    expect(normalizeSyncCode('abcd-efgh 2345 jklm')).toBe('ABCDEFGH2345JKLM');
    expect(formatSyncCode('ABCDEFGH2345JKLMN')).toBe('ABCD-EFGH-2345-JKLM-N');
    expect(formatSyncCode('')).toBe('');
  });
});

describe('слияние двух устройств', () => {
  it('оставляет более свежую версию каждой записи', () => {
    const local = makeData({
      updatedAt: '2026-03-01T10:00:00.000Z',
      deals: [makeDeal({ id: 'deal-1', title: 'Кухня на Ленина', updatedAt: '2026-03-02T10:00:00.000Z' })],
      clients: [makeClient({ name: 'Анна (компьютер)' })],
    });
    const remote = makeData({
      updatedAt: '2026-03-03T10:00:00.000Z',
      deals: [makeDeal({ id: 'deal-1', title: 'Кухня на Ленина', updatedAt: '2026-03-03T10:00:00.000Z' })],
      clients: [makeClient({ name: 'Анна (телефон)', updatedAt: '2026-03-03T10:00:00.000Z' })],
    });

    const merged = mergeSyncData(local, remote, emptyRemoved());

    expect(merged.data.deals).toHaveLength(1);
    expect(merged.data.deals[0].updatedAt).toBe('2026-03-03T10:00:00.000Z');
    expect(merged.data.clients[0].name).toBe('Анна (телефон)');
    expect(merged.data.updatedAt).toBe('2026-03-03T10:00:00.000Z');
  });

  it('добавляет записи с другого устройства и не теряет свои', () => {
    const local = makeData({
      clients: [makeClient({ id: 'c-local', name: 'С компьютера' })],
      deals: [makeDeal({ id: 'd-local', clientId: 'c-local' })],
    });
    const remote = makeData({
      clients: [makeClient({ id: 'c-phone', name: 'С телефона' })],
      deals: [makeDeal({ id: 'd-phone', clientId: 'c-phone', createdAt: '2026-02-01T09:00:00.000Z' })],
    });

    const merged = mergeSyncData(local, remote, emptyRemoved());
    expect(merged.data.clients.map((client) => client.id).sort()).toEqual(['c-local', 'c-phone']);
    expect(merged.data.deals.map((deal) => deal.id).sort()).toEqual(['d-local', 'd-phone']);
  });

  it('не возвращает запись, удалённую позже последней правки', () => {
    const edited = daysAgoIso(10);
    const removedAt = daysAgoIso(2);
    const local = makeData({ deals: [] });
    const remote = makeData({ deals: [makeDeal({ id: 'deal-1', updatedAt: edited })] });

    const merged = mergeSyncData(local, remote, { clients: {}, deals: { 'deal-1': removedAt }, receipts: {}, events: {} });
    expect(merged.data.deals).toHaveLength(0);
    expect(merged.removed.deals['deal-1']).toBe(removedAt);
  });

  it('возвращает запись, если её изменили после удаления', () => {
    const local = makeData({ clients: [makeClient({ id: 'c1', updatedAt: '2026-03-01T09:00:00.000Z' })] });
    const remote = makeData({ clients: [] });

    const merged = mergeSyncData(local, remote, { clients: { c1: '2026-02-01T09:00:00.000Z' }, deals: {}, receipts: {}, events: {} });
    expect(merged.data.clients).toHaveLength(1);
    expect(merged.removed.clients.c1).toBeUndefined();
  });

  it('забывает старые удаления и хранит свежие', () => {
    const old = new Date(Date.now() - 400 * 86400000).toISOString();
    const fresh = new Date(Date.now() - 3 * 86400000).toISOString();
    const merged = mergeSyncData(makeData(), makeData(), { clients: { old: old, fresh: fresh }, deals: {}, receipts: {}, events: {} });
    expect(merged.removed.clients.old).toBeUndefined();
    expect(merged.removed.clients.fresh).toBe(fresh);
  });

  it('берёт свежие настройки, но тема и разрешение уведомлений — свои', () => {
    const local = makeData({
      updatedAt: '2026-02-01T09:00:00.000Z',
      settings: { ...makeData().settings, theme: 'dark', notifications: true, companyName: 'Старое имя' },
    });
    const remote = makeData({
      updatedAt: '2026-03-01T09:00:00.000Z',
      settings: { ...makeData().settings, theme: 'light', notifications: false, companyName: 'Новое имя' },
    });

    const merged = mergeSyncData(local, remote, emptyRemoved());
    expect(merged.data.settings.companyName).toBe('Новое имя');
    expect(merged.data.settings.theme).toBe('dark');
    expect(merged.data.settings.notifications).toBe(true);
  });

  it('не теряет учётные записи при слиянии', () => {
    const account = (id: string, name: string) => ({
      id, name, role: 'manager' as const, hash: 'pbkdf2:abc', salt: 's', createdAt: '2026-01-01T09:00:00.000Z',
    });
    const local = makeData({
      updatedAt: '2026-02-01T10:00:00.000Z',
      settings: { ...makeData().settings, accounts: [account('acc-1', 'Ирина')] },
    });
    const remote = makeData({
      updatedAt: '2026-03-01T10:00:00.000Z',
      settings: { ...makeData().settings, accounts: [account('acc-2', 'Сергей')] },
    });

    const merged = mergeSyncData(local, remote, emptyRemoved());
    expect(merged.data.settings.accounts?.map((item) => item.name).sort()).toEqual(['Ирина', 'Сергей']);
    expect(merged.data.settings.accounts).toHaveLength(2);
  });

  it('объединяет «надгробия» по самому свежему времени', () => {
    const merged = mergeRemoved(
      { clients: { a: '2026-01-01T00:00:00.000Z' }, deals: { x: '2026-01-05T00:00:00.000Z' }, receipts: {}, events: {} },
      { clients: { a: '2026-02-01T00:00:00.000Z', b: '2026-01-02T00:00:00.000Z' }, deals: {}, receipts: {}, events: {} },
    );
    expect(merged.clients.a).toBe('2026-02-01T00:00:00.000Z');
    expect(merged.clients.b).toBe('2026-01-02T00:00:00.000Z');
    expect(merged.deals.x).toBe('2026-01-05T00:00:00.000Z');
  });
});

describe('документ общей базы', () => {
  it('собирает и разбирает конверт, отбрасывая мусор', () => {
    const data = makeData({ deals: [makeDeal()] });
    const envelope = buildEnvelope(data, { clients: {}, deals: { 'deal-1': '2026-02-01T00:00:00.000Z' }, receipts: {}, events: {} }, 'телефон');
    const parsed = parseEnvelope(JSON.parse(JSON.stringify(envelope)));
    expect(parsed?.data.deals).toHaveLength(1);
    expect(parsed?.removed.deals['deal-1']).toBe('2026-02-01T00:00:00.000Z');
    expect(parseEnvelope({ hello: 'world' })).toBeNull();
    expect(parseEnvelope(null)).toBeNull();
  });

  it('понимает старый формат без конверта и не зависит от порядка ключей', () => {
    const data = makeData({ clients: [makeClient()] });
    expect(parseEnvelope(data)?.data.clients).toHaveLength(1);

    const left = envelopeSignature({ data, removed: { clients: { a: '1', b: '2' }, deals: {}, receipts: {}, events: {} } });
    const right = envelopeSignature({ data, removed: { clients: { b: '2', a: '1' }, deals: {}, receipts: {}, events: {} } });
    expect(left).toBe(right);
  });
});

describe('отпечаток документа', () => {
  it('одинаков для одинаковых данных и разный для разных', () => {
    const base = { data: makeData({ clients: [makeClient()] }), removed: emptyRemoved() };
    expect(hashEnvelope(base)).toBe(hashEnvelope({ data: makeData({ clients: [makeClient()] }), removed: emptyRemoved() }));
    expect(hashEnvelope(base)).not.toBe(hashEnvelope({ data: makeData({ clients: [] }), removed: emptyRemoved() }));
  });

  it('короткий — его можно хранить в настройках устройства', () => {
    const hash = hashEnvelope({ data: makeData(), removed: emptyRemoved() });
    expect(hash.length).toBeLessThan(40);
    expect(hash).toMatch(/^[a-z0-9]+:[a-z0-9]+$/);
  });
});

describe('обмен с сервером', () => {
  it('читает базу по коду и убирает дефисы из кода', async () => {
    const payload = buildEnvelope(makeData({ clients: [makeClient()] }), emptyRemoved(), 'компьютер');
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ found: true, payload, revision: 4, updated_at: '2026-03-01T10:00:00.000Z', device: 'телефон' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await pullSpace('ABCD-EFGH-2345-JKLM-NPQR');
    expect(result.found).toBe(true);
    expect(result.revision).toBe(4);
    expect(result.device).toBe('телефон');
    expect(result.envelope?.data.clients).toHaveLength(1);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${SYNC_ENDPOINT}/rest/v1/rpc/crm_sync_pull`);
    expect(JSON.parse(String(init.body))).toEqual({ p_token: 'ABCDEFGH2345JKLMNPQR' });
  });

  it('не скачивает документ, если версия та же', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ found: true, unchanged: true, revision: 7, updated_at: '2026-03-01T10:00:00.000Z', device: 'телефон' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await pullSpace('ABCDEFGH2345JKLMNPQR', 7);
    expect(result.unchanged).toBe(true);
    expect(result.envelope).toBeNull();
    expect(result.revision).toBe(7);

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ p_token: 'ABCDEFGH2345JKLMNPQR', p_known_revision: 7 });
  });

  it('первый запрос версии не присылает — сервер отдаст документ целиком', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true, status: 200, json: async () => ({ found: true, unchanged: false, payload: buildEnvelope(makeData(), emptyRemoved(), 'пк'), revision: 1 }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await pullSpace('ABCDEFGH2345JKLMNPQR');
    expect(result.unchanged).toBe(false);
    expect(result.envelope).not.toBeNull();

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ p_token: 'ABCDEFGH2345JKLMNPQR' });
  });

  it('сообщает, что базы ещё нет', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ found: false }) })));
    const result = await pullSpace('ABCDEFGH2345JKLMNPQR');
    expect(result.found).toBe(false);
    expect(result.envelope).toBeNull();
  });

  it('отправляет документ и разбирает конфликт версий', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: false, conflict: true, revision: 9 }) })));
    const envelope = buildEnvelope(makeData(), emptyRemoved(), 'телефон');
    const result = await pushSpace('ABCDEFGH2345JKLMNPQR', envelope, 3);
    expect(result).toMatchObject({ ok: false, conflict: true, revision: 9 });
  });

  it('превращает сетевую ошибку в понятный текст', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fail'); }));
    await expect(pullSpace('ABCDEFGH2345JKLMNPQR')).rejects.toThrow('Нет связи с сервером синхронизации');
  });
});

describe('прошлые версии базы', () => {
  function stubRpc(answers: Record<string, unknown>) {
    return vi.fn(async (url: string | URL) => {
      const name = String(url).split('/rpc/')[1] ?? '';
      return { ok: true, status: 200, json: async () => answers[name] };
    });
  }

  it('читает список версий и отбрасывает пустые строки', async () => {
    vi.stubGlobal('fetch', stubRpc({
      crm_sync_versions: {
        ok: true,
        versions: [
          { revision: 7, device: 'телефона', saved_at: '2026-05-02T10:00:00.000Z', deals: 4, clients: 3, bytes: 2048 },
          { revision: 0, deals: 1 },
          { revision: 6, device: 'компьютера', saved_at: '2026-05-01T10:00:00.000Z', deals: 3, clients: 2, bytes: 1900 },
        ],
      },
    }));

    const list = await listVersions('ABCD-EFGH-2345-JKLM-NPQR');
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ revision: 7, deals: 4, clients: 3, bytes: 2048, device: 'телефона' });
    expect(list[1].revision).toBe(6);
  });

  it('возвращает пустой список, если сервер не ответил', async () => {
    vi.stubGlobal('fetch', stubRpc({ crm_sync_versions: null }));
    expect(await listVersions('ABCD-EFGH-2345-JKLM-NPQR')).toEqual([]);
  });

  it('достаёт нужную версию и разбирает её как документ', async () => {
    const data = makeData({ clients: [makeClient()], deals: [makeDeal({ id: 'deal-1' })] });
    const envelope = buildEnvelope(data, emptyRemoved(), 'компьютера');
    vi.stubGlobal('fetch', stubRpc({ crm_sync_version: { ok: true, payload: envelope, revision: 5 } }));

    const version = await fetchVersion('ABCD-EFGH-2345-JKLM-NPQR', 5);
    expect(version?.data.deals[0].id).toBe('deal-1');
    expect(version?.data.clients[0].name).toBe('Анна Смирнова');
    expect(version?.removed).toEqual(emptyRemoved());
  });

  it('понимает «такой версии нет»', async () => {
    vi.stubGlobal('fetch', stubRpc({ crm_sync_version: { ok: false, error: 'not_found' } }));
    expect(await fetchVersion('ABCD-EFGH-2345-JKLM-NPQR', 99)).toBeNull();
  });
});
