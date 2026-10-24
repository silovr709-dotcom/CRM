// @vitest-environment jsdom
// Прошлые версии общей базы: показать список и вернуть «как было».
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from './App';
import { AppProvider } from './store';
import { emptyData } from './lib/storage';
import { buildEnvelope, emptyRemoved, makeSyncCode, type SyncEnvelope } from './lib/sync';
import { STORAGE_KEY } from './lib/storage';
import type { AppData } from './types';

function dataWith(deals: { id: string; title: string }[]): AppData {
  const base = emptyData();
  return {
    ...base,
    clients: deals.map((deal) => ({
      id: `${deal.id}-client`,
      name: `Клиент ${deal.title}`,
      phones: [],
      emails: [],
      tags: [],
      createdAt: '2026-05-01T09:00:00.000Z',
      updatedAt: '2026-05-01T09:00:00.000Z',
    })),
    deals: deals.map((deal) => ({
      id: deal.id,
      title: deal.title,
      clientId: `${deal.id}-client`,
      amount: 100000,
      status: 'draft' as const,
      tasks: [],
      payments: [],
      history: [],
      schedule: { status: 'planned' as const },
      createdAt: '2026-05-01T09:00:00.000Z',
      updatedAt: '2026-05-01T09:00:00.000Z',
    })),
    updatedAt: '2026-05-02T09:00:00.000Z',
  };
}

/** Сервер в памяти: текущая база плюс история версий. */
function fakeServer() {
  const old = buildEnvelope(dataWith([{ id: 'deal-old', title: 'Старая кухня' }]), emptyRemoved(), 'компьютера');
  const fresh = buildEnvelope(
    dataWith([{ id: 'deal-old', title: 'Старая кухня' }, { id: 'deal-new', title: 'Новая кухня' }]),
    emptyRemoved(),
    'телефона',
  );
  const state: { envelope: SyncEnvelope; revision: number; versions: { revision: number; envelope: SyncEnvelope; savedAt: string }[] } = {
    envelope: fresh,
    revision: 4,
    versions: [
      { revision: 4, envelope: fresh, savedAt: '2026-05-02T10:00:00.000Z' },
      { revision: 2, envelope: old, savedAt: '2026-05-01T10:00:00.000Z' },
    ],
  };

  const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const name = String(url).split('/rpc/')[1] ?? '';
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    const json = (value: unknown) => ({ ok: true, status: 200, json: async () => value });

    if (name === 'crm_sync_pull') {
      return json({
        found: true,
        payload: state.envelope,
        revision: state.revision,
        updated_at: '2026-05-02T10:00:00.000Z',
        device: 'телефона',
      });
    }
    if (name === 'crm_sync_versions') {
      return json({
        ok: true,
        versions: state.versions.map((version) => ({
          revision: version.revision,
          device: version.envelope.device,
          saved_at: version.savedAt,
          deals: version.envelope.data.deals.length,
          clients: version.envelope.data.clients.length,
          bytes: 1500,
        })),
      });
    }
    if (name === 'crm_sync_version') {
      const found = state.versions.find((version) => version.revision === Number(body.p_revision));
      return json(found ? { ok: true, payload: found.envelope, revision: found.revision } : { ok: false, error: 'not_found' });
    }
    if (name === 'crm_sync_push') {
      if (Number(body.p_revision) !== state.revision) {
        return json({ ok: false, conflict: true, revision: state.revision });
      }
      state.envelope = body.p_payload as SyncEnvelope;
      state.revision += 1;
      state.versions.unshift({ revision: state.revision, envelope: state.envelope, savedAt: new Date().toISOString() });
      return json({ ok: true, revision: state.revision });
    }
    return json({});
  });

  return { fetchMock, state };
}

/** Кладём в браузер «свою» базу: без демо-примеров, чтобы слияние было честным. */
function seedStorage() {
  const data = dataWith([{ id: 'deal-old', title: 'Старая кухня' }]);
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...data, settings: { ...data.settings, demo: false } }));
}

function openData() {
  fireEvent.click(within(screen.getByRole('navigation', { name: 'Разделы' })).getByRole('button', { name: /Данные/ }));
}

describe('прошлые версии общей базы', () => {
  beforeEach(() => {
    localStorage.clear();
    window.scrollTo = () => {};
    window.location.hash = '';
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('показывает сохранённые версии и возвращает старую', async () => {
    const code = makeSyncCode();
    const { fetchMock, state } = fakeServer();
    vi.stubGlobal('fetch', fetchMock);
    localStorage.setItem('crm-schedule.sync.v1', JSON.stringify({
      code,
      revision: 4,
      deviceId: 'dev-test',
      deviceName: 'компьютера',
      lastSyncAt: '2026-05-02T10:00:00.000Z',
      serverAt: '2026-05-02T10:00:00.000Z',
      serverDevice: 'телефона',
      known: true,
      removed: emptyRemoved(),
    }));

    seedStorage();
    render(<AppProvider><App /></AppProvider>);
    openData();

    fireEvent.click(screen.getByRole('button', { name: /Показать/ }));
    const block = await screen.findByText('Прошлые версии').then((node) => node.closest('.version-block') as HTMLElement);
    const rows = within(block).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    // В свежей версии две сделки, в старой — одна.
    expect(rows[0].textContent).toMatch(/2 сделки/);
    expect(rows[1].textContent).toMatch(/1 сделка/);

    fireEvent.click(within(rows[1]).getByRole('button', { name: /Вернуть/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Вернуть базу на/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Вернуть эту версию' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // На сервер ушла новая ревизия со старым составом сделок.
    await waitFor(() => expect(state.revision).toBeGreaterThan(4));
    expect(state.envelope.data.deals.map((deal) => deal.id)).toEqual(['deal-old']);

    // И на этом устройстве не осталось «новой» сделки.
    await waitFor(() => {
      const raw = localStorage.getItem(STORAGE_KEY);
      expect(raw).toBeTruthy();
      const stored = JSON.parse(raw as string) as { deals: { id: string }[]; settings: { demo: boolean } };
      expect(stored.deals.map((deal) => deal.id)).toEqual(['deal-old']);
      expect(stored.settings.demo).toBe(false);
    }, { timeout: 3000 });
  });

  it('честно говорит, если версий ещё нет', async () => {
    const code = makeSyncCode();
    const { fetchMock, state } = fakeServer();
    state.versions = [];
    vi.stubGlobal('fetch', fetchMock);
    localStorage.setItem('crm-schedule.sync.v1', JSON.stringify({
      code,
      revision: 4,
      deviceId: 'dev-test',
      deviceName: 'компьютера',
      lastSyncAt: '2026-05-02T10:00:00.000Z',
      serverAt: '2026-05-02T10:00:00.000Z',
      serverDevice: 'телефона',
      known: true,
      removed: emptyRemoved(),
    }));

    seedStorage();
    render(<AppProvider><App /></AppProvider>);
    openData();
    fireEvent.click(screen.getByRole('button', { name: /Показать/ }));

    expect(await screen.findByText(/пока не помнит прошлых версий/)).toBeTruthy();
  });
});
