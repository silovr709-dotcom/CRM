// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from './App';
import { AppProvider } from './store';
import { emptyData } from './lib/storage';
import { buildEnvelope, emptyRemoved, formatSyncCode, type SyncEnvelope } from './lib/sync';
import type { AppData } from './types';

/** Сервер синхронизации в памяти: тех же правил, что и настоящий. */
function fakeServer(initial: SyncEnvelope | null) {
  const state: { envelope: SyncEnvelope | null; revision: number } = {
    envelope: initial,
    revision: initial ? 1 : 0,
  };
  const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    const json = (value: unknown) => ({ ok: true, status: 200, json: async () => value });
    if (String(url).endsWith('/rpc/crm_sync_pull')) {
      return json(state.envelope
        ? { found: true, payload: state.envelope, revision: state.revision, updated_at: new Date().toISOString(), device: 'компьютера' }
        : { found: false });
    }
    if (!state.envelope) {
      state.envelope = body.p_payload as SyncEnvelope;
      state.revision = 1;
      return json({ ok: true, revision: 1 });
    }
    if (Number(body.p_revision) !== state.revision) {
      return json({ ok: false, conflict: true, revision: state.revision });
    }
    state.envelope = body.p_payload as SyncEnvelope;
    state.revision += 1;
    return json({ ok: true, revision: state.revision });
  });
  return { fetchMock, state };
}

function remoteData(): AppData {
  const base = emptyData();
  return {
    ...base,
    clients: [{
      id: 'client-pc',
      name: 'Пётр Иванов',
      phones: ['+7 900 111-22-33'],
      emails: [],
      tags: [],
      createdAt: '2026-03-01T09:00:00.000Z',
      updatedAt: '2026-03-01T09:00:00.000Z',
    }],
    deals: [{
      id: 'deal-pc',
      title: 'Кухня с компьютера',
      clientId: 'client-pc',
      amount: 300000,
      status: 'draft',
      tasks: [],
      payments: [],
      history: [],
      schedule: { status: 'planned' },
      createdAt: '2026-03-01T09:00:00.000Z',
      updatedAt: '2026-03-01T09:00:00.000Z',
    }],
    updatedAt: '2026-03-01T09:00:00.000Z',
  };
}

function renderApp() {
  return render(<AppProvider><App /></AppProvider>);
}

describe('общая база в интерфейсе', () => {
  beforeEach(() => {
    localStorage.clear();
    window.scrollTo = () => {};
    window.location.hash = '';
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('подключается по ссылке с другого устройства и забирает его базу', async () => {
    const code = 'ABCDEFGH2345JKLMNPQR';
    const { fetchMock } = fakeServer(buildEnvelope(remoteData(), emptyRemoved(), 'компьютера'));
    vi.stubGlobal('fetch', fetchMock);
    window.location.hash = `#/sync/${code}`;

    renderApp();

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(new RegExp(formatSyncCode(code).slice(0, 9)))).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Подключиться' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Код общей базы').textContent).toBe(formatSyncCode(code));
    });

    // Данные компьютера оказались на этом устройстве.
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Разделы' })).getByRole('button', { name: /CRM/ }));
    expect(screen.getByText('Кухня с компьютера')).toBeTruthy();
    expect(screen.getByText('Пётр Иванов')).toBeTruthy();
  });

  it('создаёт общую базу из «Данных» и отправляет туда свои записи', async () => {
    const { fetchMock, state } = fakeServer(null);
    vi.stubGlobal('fetch', fetchMock);

    renderApp();
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Разделы' })).getByRole('button', { name: /Данные/ }));
    fireEvent.click(screen.getByRole('button', { name: /Создать общую базу/ }));

    await waitFor(() => {
      expect(screen.getByLabelText('Код общей базы').textContent).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){5}$/);
    });
    await waitFor(() => expect(state.envelope?.data.deals.length).toBeGreaterThan(0));
    // Значок общей базы появился рядом с «сохранено».
    expect(screen.getAllByText(/общая база/i).length).toBeGreaterThan(0);
  });

  it('не подключается по несуществующему коду и не теряет данные', async () => {
    const { fetchMock } = fakeServer(null);
    vi.stubGlobal('fetch', fetchMock);

    renderApp();
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Разделы' })).getByRole('button', { name: /Данные/ }));
    fireEvent.change(screen.getByLabelText(/Код с другого устройства/), {
      target: { value: 'ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Подключиться/ }));

    await waitFor(() => {
      expect(screen.getByText(/База с таким кодом не найдена/)).toBeTruthy();
    });
    // Карточка осталась в режиме «синхронизация выключена».
    expect(screen.getByRole('button', { name: /Создать общую базу/ })).toBeTruthy();
  });
});
