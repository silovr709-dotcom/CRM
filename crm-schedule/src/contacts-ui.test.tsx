// @vitest-environment jsdom
// Быстрые касания: кнопки в списке, журнал в карточке, сроки и права ролей.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from './App';
import { AppProvider } from './store';
import { emptyData, STORAGE_KEY } from './lib/storage';
import { addDays, todayISO } from './lib/dates';
import type { AppData, ContactEntry, Deal, RoleId } from './types';

function makeData(role: RoleId = 'owner', deal: Partial<Deal> = {}, contacts: ContactEntry[] = []): AppData {
  const base = emptyData();
  const today = todayISO();
  return {
    ...base,
    settings: { ...base.settings, demo: false, companyName: 'Кухни Лада', myName: 'Ирина', role },
    clients: [{
      id: 'client-1',
      name: 'Анна Смирнова',
      phones: ['+7 900 111-22-33'],
      emails: [],
      tags: [],
      createdAt: '2026-05-01T09:00:00.000Z',
      updatedAt: '2026-05-01T09:00:00.000Z',
    }],
    deals: [{
      id: 'deal-1',
      title: 'Кухня на Ленина',
      clientId: 'client-1',
      amount: 285000,
      manager: 'Ирина',
      status: 'approved',
      nextContactAt: today,
      tasks: [],
      payments: [],
      expenses: [],
      plan: [],
      contacts,
      history: [],
      schedule: { status: 'planned', installAt: addDays(today, 3), timeStart: '10:00', address: 'Ленина, 42' },
      createdAt: '2026-05-01T09:00:00.000Z',
      updatedAt: '2026-05-02T09:00:00.000Z',
      ...deal,
    }],
    updatedAt: '2026-05-02T09:00:00.000Z',
  };
}

function seed(data: AppData) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function renderApp(hash = '') {
  window.location.hash = hash;
  render(<AppProvider><App /></AppProvider>);
}

const nav = () => screen.getByRole('navigation', { name: 'Разделы' });

/** Ждём, пока изменение доедет до localStorage (сохранение с задержкой). */
async function storedDeal(check?: (deal: Deal) => void): Promise<Deal> {
  let found: Deal | undefined;
  await waitFor(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    const data = raw ? JSON.parse(raw) as AppData : undefined;
    found = data?.deals.find((item) => item.id === 'deal-1');
    expect(found).toBeTruthy();
    if (found && check) check(found);
  });
  return found as Deal;
}

beforeEach(() => {
  localStorage.clear();
  window.scrollTo = () => {};
  window.location.hash = '';
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('касание клиента одним нажатием', () => {
  it('«Позвонил» пишет журнал, автора и следующий контакт через 2 дня', async () => {
    seed(makeData());
    renderApp();

    fireEvent.click(within(nav()).getByRole('button', { name: /CRM/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Позвонил: Кухня на Ленина' }));

    const deal = await storedDeal((item) => expect(item.contacts).toHaveLength(1));
    expect(deal.contacts?.[0]).toMatchObject({ channel: 'call', outcome: 'reached', author: 'Ирина' });
    expect(deal.nextContactAt).toBe(addDays(todayISO(), 2));
    expect(deal.history.at(-1)).toMatchObject({ kind: 'contact', title: 'Связь: поговорили', author: 'Ирина' });
  });

  it('«Не взял» возвращает на завтра и не выдаёт это за разговор', async () => {
    seed(makeData());
    renderApp();

    fireEvent.click(within(nav()).getByRole('button', { name: /CRM/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Не взял: Кухня на Ленина' }));

    const deal = await storedDeal((item) => expect(item.contacts).toHaveLength(1));
    expect(deal.contacts?.[0].outcome).toBe('noAnswer');
    expect(deal.nextContactAt).toBe(addDays(todayISO(), 1));
  });

  it('«Написал» ставит контакт через 3 дня в WhatsApp', async () => {
    seed(makeData());
    renderApp();

    fireEvent.click(within(nav()).getByRole('button', { name: /CRM/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Написал: Кухня на Ленина' }));

    const deal = await storedDeal((item) => expect(item.contacts).toHaveLength(1));
    expect(deal.contacts?.[0]).toMatchObject({ channel: 'whatsapp', outcome: 'messaged' });
    expect(deal.nextContactAt).toBe(addDays(todayISO(), 3));
  });

  it('журнал не мешает открыть сделку кликом по строке', async () => {
    seed(makeData());
    renderApp();

    fireEvent.click(within(nav()).getByRole('button', { name: /CRM/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Анна Смирнова/ }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
  });
});

describe('журнал в карточке сделки', () => {
  const history: ContactEntry[] = [
    { id: 'c-1', at: '2026-10-20T10:00:00.000Z', channel: 'call', outcome: 'noAnswer', author: 'Ирина' },
    { id: 'c-2', at: '2026-10-22T15:30:00.000Z', channel: 'whatsapp', outcome: 'reached', author: 'Ирина', note: 'Ждёт замер в субботу' },
  ];

  it('показывает последние касания с заметкой и автором', async () => {
    seed(makeData('owner', {}, history));
    renderApp('#/deal/deal-1');

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Связь с клиентом')).toBeTruthy();
    expect(within(dialog).getAllByText('Поговорили').length).toBeGreaterThan(0);
    expect(within(dialog).getByText('Ждёт замер в субботу')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Позвонил: Кухня на Ленина' })).toBeTruthy();
  });

  it('«Отложить на неделю» сдвигает срок, не выдумывая звонок', async () => {
    seed(makeData('owner', {}, history));
    renderApp('#/deal/deal-1');

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '+1 неделя' }));

    const deal = await storedDeal((item) => expect(item.nextContactAt).toBe(addDays(todayISO(), 7)));
    expect(deal.contacts).toHaveLength(2);
  });

  it('«Другое» записывает отказ с причиной и снимает срок', async () => {
    seed(makeData());
    renderApp('#/deal/deal-1');

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Другое касание: Кухня на Ленина' }));

    const form = await screen.findByRole('dialog', { name: 'Касание клиента' });
    fireEvent.change(within(form).getByLabelText(/Что вышло/), { target: { value: 'declined' } });
    fireEvent.change(within(form).getByLabelText(/Заметка/), { target: { value: 'Выбрали другую мастерскую' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Записать' }));

    const deal = await storedDeal((item) => expect(item.contacts).toHaveLength(1));
    expect(deal.contacts?.[0]).toMatchObject({ outcome: 'declined', note: 'Выбрали другую мастерскую' });
    expect(deal.nextContactAt).toBeUndefined();
  });
});

describe('касания и роли', () => {
  it('монтажник тоже отмечает звонок — это не про деньги', async () => {
    seed(makeData('installer'));
    renderApp();

    fireEvent.click(within(nav()).getByRole('button', { name: /CRM/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Позвонил: Кухня на Ленина' }));

    const deal = await storedDeal((item) => expect(item.contacts).toHaveLength(1));
    // Автор — вошедший сотрудник (в тестовой базе это имя из настроек).
    expect(deal.contacts?.[0].author).toBe('Ирина');
  });
});

describe('карточка клиента', () => {
  it('показывает, когда последний раз общались, и даёт отметить касание', async () => {
    seed(makeData('owner', {}, [
      { id: 'c-1', at: '2026-10-20T10:00:00.000Z', channel: 'call', outcome: 'reached', author: 'Ирина' },
    ]));
    renderApp('#/client/client-1');

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/связь .*назад|связь вчера|связь сегодня/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Написал: Кухня на Ленина' }));

    await storedDeal((item) => expect(item.contacts).toHaveLength(2));
  });
});
