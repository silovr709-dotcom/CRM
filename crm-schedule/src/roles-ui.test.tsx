// @vitest-environment jsdom
// Роли на устройстве: что видно менеджеру и монтажнику, и подписи автора.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from './App';
import { AppProvider } from './store';
import { emptyData, STORAGE_KEY } from './lib/storage';
import { addDays } from './lib/dates';
import { todayISO } from './lib/dates';
import type { AppData, Deal, RoleId } from './types';

function makeData(role: RoleId = 'owner', deal: Partial<Deal> = {}): AppData {
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
      items: [],
      documents: [],
      tasks: [],
      payments: [],
      expenses: [],
      plan: [],
      history: [],
      schedule: {
        status: 'planned',
        installAt: addDays(today, 1),
        timeStart: '10:00',
        address: 'Ленина, 42',
      },
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

beforeEach(() => {
  localStorage.clear();
  window.scrollTo = () => {};
  window.location.hash = '';
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('роль определяет, что видно', () => {
  it('руководитель видит отчёты и себестоимость', () => {
    seed(makeData('owner'));
    renderApp('#/deal/deal-1?tab=money');

    expect(within(nav()).getByRole('button', { name: /Отчёты/ })).toBeTruthy();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Затраты и маржа')).toBeTruthy();
  });

  it('менеджер не видит затраты и маржу, но видит оплаты', () => {
    seed(makeData('manager'));
    renderApp('#/deal/deal-1?tab=money');

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByText('Затраты и маржа')).toBeNull();
    expect(within(dialog).getByText('План оплат')).toBeTruthy();
  });

  it('монтажник не видит денег, отчётов и документов', async () => {
    seed(makeData('installer'));
    renderApp('#/deal/deal-1?tab=money');

    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    const dialog = screen.getByRole('dialog');
    // Вкладки «Оплата» и «Документы» скрыты, остался обзор.
    expect(within(dialog).queryByRole('button', { name: /^Оплата/ })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: /^Документы/ })).toBeNull();
    expect((within(dialog).getByLabelText('Сумма заказа скрыта') as HTMLInputElement).value)
      .toBe('скрыто ролью «Монтажник»');
    expect(within(dialog).queryByRole('button', { name: /Удалить/ })).toBeNull();
    expect(within(nav()).queryByRole('button', { name: /Отчёты/ })).toBeNull();
  });

  it('в «Данных» роль переключается и сразу меняет экран', async () => {
    seed(makeData('owner'));
    renderApp();

    fireEvent.click(within(nav()).getByRole('button', { name: /Данные/ }));
    const group = screen.getByRole('radiogroup', { name: 'Роль на этом устройстве' });
    fireEvent.click(within(group).getByRole('radio', { name: /Монтажник/ }));

    await waitFor(() => expect(within(nav()).queryByRole('button', { name: /Отчёты/ })).toBeNull());
    expect(within(group).getByRole('radio', { name: /Монтажник/ }).getAttribute('aria-checked')).toBe('true');
    // Пока учётных записей нет, роль — просто режим экрана, и об этом сказано.
    expect(screen.getByText(/Роль пока переключается свободно/)).toBeTruthy();
  });
});

describe('авторство', () => {
  it('заметка в истории подписана именем из настроек', async () => {
    seed(makeData('manager'));
    renderApp('#/deal/deal-1?tab=history');

    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Новая заметка'), { target: { value: 'Позвонить в пятницу' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Заметка/ }));

    await waitFor(() => expect(within(dialog).getAllByText('Ирина').length).toBeGreaterThan(0));
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) as string) as AppData;
      expect(stored.deals[0].history[0].author).toBe('Ирина');
    });
  });
});

describe('напоминания клиенту', () => {
  it('показывает готовое сообщение и отмечает отправку', async () => {
    seed(makeData('owner'));
    renderApp('#/deal/deal-1?tab=schedule');

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Клиенту')).toBeTruthy();
    const block = within(dialog).getByText('Клиенту').closest('.client-reminders') as HTMLElement;

    // Монтаж завтра — есть напоминание с адресом и WhatsApp.
    expect(within(block).getByText('Монтаж завтра')).toBeTruthy();
    const text = within(block).getAllByText(/Ленина, 42/)[0];
    expect(text.textContent).toContain('10:00');

    const wa = within(block).getAllByRole('link', { name: /WhatsApp/ })[0] as HTMLAnchorElement;
    expect(wa.getAttribute('href')).toContain('https://wa.me/79001112233');
    expect(decodeURIComponent(wa.getAttribute('href') ?? '')).toContain('Анна, добрый день!');

    fireEvent.click(wa);

    await waitFor(() => expect(within(block).getAllByText(/отправлено/i).length).toBeGreaterThan(0));
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) as string) as AppData;
      expect(stored.deals[0].history[0].title).toContain('Клиенту: deal-1:install');
    });
  });
});

describe('обзор подсказывает, кому написать', () => {
  it('показывает ближайшее напоминание клиенту с WhatsApp', () => {
    seed(makeData('manager'));
    renderApp('#/overview');

    const block = screen.getByText('Написать клиентам').closest('section') as HTMLElement;
    expect(within(block).getAllByText('Анна Смирнова').length).toBeGreaterThan(0);
    expect(within(block).getByText(/Монтаж завтра/)).toBeTruthy();
    const link = within(block).getAllByRole('link', { name: /WhatsApp/ })[0] as HTMLAnchorElement;
    expect(link.getAttribute('href')).toContain('https://wa.me/79001112233');
  });

  it('монтажнику не показывает деньги в отчётах', () => {
    seed(makeData('installer'));
    renderApp('#/reports');
    expect(screen.getByText('Отчёты скрыты ролью')).toBeTruthy();
  });
});
