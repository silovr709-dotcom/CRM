// @vitest-environment jsdom
// Склад в интерфейсе: поиск по номеру заказа, приход, выдача, связь со сделкой.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from './App';
import { AppProvider } from './store';
import { emptyData, STORAGE_KEY } from './lib/storage';
import { todayISO } from './lib/dates';
import type { AppData, Deal, WarehouseReceipt } from './types';

function makeData(receipts: WarehouseReceipt[] = [], dealPatch: Partial<Deal> = {}): AppData {
  const base = emptyData();
  return {
    ...base,
    settings: { ...base.settings, demo: false, companyName: 'Кухни Лада', myName: 'Ирина', role: 'owner' },
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
      orderNo: '91_53d4',
      clientId: 'client-1',
      amount: 285000,
      status: 'approved',
      tasks: [],
      payments: [],
      history: [],
      schedule: { status: 'planned' },
      createdAt: '2026-05-01T09:00:00.000Z',
      updatedAt: '2026-05-02T09:00:00.000Z',
      ...dealPatch,
    }],
    receipts,
    updatedAt: '2026-05-02T09:00:00.000Z',
  };
}

function receipt(patch: Partial<WarehouseReceipt> = {}): WarehouseReceipt {
  return {
    id: 'rcpt-1',
    orderNo: '91_53d4',
    receivedAt: todayISO(),
    packages: 3,
    items: [{ name: 'Каркас', qty: 2 }, { name: 'Фурнитура', qty: 1 }],
    driver: 'Сергей Кузьмин',
    dealId: 'deal-1',
    createdAt: '2026-05-02T09:00:00.000Z',
    updatedAt: '2026-05-02T09:00:00.000Z',
    ...patch,
  };
}

function seed(data: AppData) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function renderApp(hash = '#/warehouse') {
  window.location.hash = hash;
  render(<AppProvider><App /></AppProvider>);
}

const nav = () => screen.getByRole('navigation', { name: 'Разделы' });
const search = () => screen.getByLabelText('Поиск по складу') as HTMLInputElement;
const addButton = () => screen.getAllByRole('button', { name: 'Приход' })[0];

async function stored(check: (data: AppData) => void): Promise<AppData> {
  let found: AppData | undefined;
  await waitFor(() => {
    window.dispatchEvent(new Event('beforeunload'));
    const raw = localStorage.getItem(STORAGE_KEY);
    found = raw ? JSON.parse(raw) as AppData : undefined;
    expect(found).toBeTruthy();
    if (found) check(found);
  }, { timeout: 12_000 });
  return found as AppData;
}

beforeEach(() => {
  vi.setConfig({ testTimeout: 20_000 });
  localStorage.clear();
  window.scrollTo = () => {};
  window.location.hash = '';
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('раздел «Склад»', () => {
  it('есть в навигации и показывает приходы', () => {
    seed(makeData([receipt()]));
    renderApp();

    expect(within(nav()).getByRole('button', { name: /Склад/ })).toBeTruthy();
    expect(screen.getByText('91_53d4')).toBeTruthy();
    expect(screen.getByText('на складе')).toBeTruthy();
    expect(screen.getByText(/Каркас ×2/)).toBeTruthy();
  });

  it('находит заказ по номеру, даже если его ввели без разделителя', () => {
    seed(makeData([
      receipt(),
      receipt({ id: 'rcpt-2', orderNo: '91_61d2', dealId: undefined, packages: 4 }),
    ]));
    renderApp();

    fireEvent.change(search(), { target: { value: '9153d4' } });
    expect(screen.getByText('91_53d4')).toBeTruthy();
    expect(screen.queryByText('91_61d2')).toBeNull();
    expect(screen.getByText(/Найдено: 1/)).toBeTruthy();
  });

  it('ищет по тому, что внутри: «фурнитура»', () => {
    seed(makeData([
      receipt(),
      receipt({ id: 'rcpt-2', orderNo: '91_61d2', items: [{ name: 'Фасады', qty: 5 }] }),
    ]));
    renderApp();

    fireEvent.change(search(), { target: { value: 'фурнитура' } });
    expect(screen.getByText('91_53d4')).toBeTruthy();
    expect(screen.queryByText('91_61d2')).toBeNull();
  });

  it('фильтр «Без сделки» показывает то, что ещё не привязали', () => {
    seed(makeData([
      receipt(),
      receipt({ id: 'rcpt-2', orderNo: '91_61d2', dealId: undefined }),
    ]));
    renderApp();

    fireEvent.click(screen.getByRole('tab', { name: /Без сделки/ }));
    expect(screen.getByText('91_61d2')).toBeTruthy();
    expect(screen.queryByText('91_53d4')).toBeNull();
  });

  it('считает упаковки на складе в сводке', () => {
    seed(makeData([
      receipt({ packages: 3 }),
      receipt({ id: 'rcpt-2', orderNo: '91_61d2', packages: 4, issuedAt: todayISO() }),
    ]));
    renderApp();

    expect(screen.getByText('упаковок на складе').previousElementSibling?.textContent).toBe('3');
    expect(screen.getByText('заказов ждут выдачи').previousElementSibling?.textContent).toBe('1');
  });
});

describe('новый приход', () => {
  it('записывает номер, количество и позиции', async () => {
    seed(makeData());
    renderApp();

    fireEvent.click(addButton());
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Номер заказа'), { target: { value: '91_77aa' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Позиция$/ }));
    fireEvent.change(within(dialog).getByLabelText('Наименование 1'), { target: { value: 'Каркас' } });
    fireEvent.change(within(dialog).getByLabelText('Количество 1'), { target: { value: '2' } });
    fireEvent.change(within(dialog).getByLabelText('Упаковок'), { target: { value: '2' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Записать приход' }));

    const data = await stored((current) => expect(current.receipts).toHaveLength(1));
    expect(data.receipts[0]).toMatchObject({
      orderNo: '91_77aa',
      packages: 2,
      items: [{ name: 'Каркас', qty: 2 }],
      author: 'Ирина',
    });
  });

  it('не пускает без номера заказа и объясняет почему', async () => {
    seed(makeData());
    renderApp();

    fireEvent.click(addButton());
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Записать приход' }));

    expect(await within(dialog).findByRole('alert')).toBeTruthy();
    expect(within(dialog).getByRole('alert').textContent).toContain('номер заказа');
    expect(localStorage.getItem(STORAGE_KEY)).toBeTruthy();
  });

  it('сам привязывает приход к сделке с тем же номером', async () => {
    seed(makeData());
    renderApp();

    fireEvent.click(addButton());
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Номер заказа'), { target: { value: '91 53d4' } });
    fireEvent.change(within(dialog).getByLabelText('Упаковок'), { target: { value: '3' } });
    expect(within(dialog).getByText(/Привяжется к «Кухня на Ленина»/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Записать приход' }));

    const data = await stored((current) => expect(current.receipts).toHaveLength(1));
    expect(data.receipts[0].dealId).toBe('deal-1');
  });
});

describe('карточка прихода', () => {
  it('выдаёт со склада и возвращает обратно', async () => {
    seed(makeData([receipt()]));
    renderApp();
    vi.stubGlobal('prompt', () => 'Бригада 1');

    fireEvent.click(screen.getByText('91_53d4'));
    let dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Выдать со склада' }));

    await stored((current) => expect(current.receipts[0].issuedAt).toBe(todayISO()));
    fireEvent.click(screen.getByRole('tab', { name: 'Выдано' }));
    fireEvent.click(await screen.findByText('91_53d4'));
    dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Вернуть на склад' }));

    await stored((current) => expect(current.receipts[0].issuedAt).toBeUndefined());
  });

  it('удаляет приход с возможностью вернуть', async () => {
    seed(makeData([receipt()]));
    renderApp();
    vi.stubGlobal('confirm', () => true);

    fireEvent.click(screen.getByRole('button', { name: 'Удалить поступление 91_53d4' }));
    await stored((current) => expect(current.receipts).toHaveLength(0));
  });

  it('показывает приходы в карточке сделки', async () => {
    seed(makeData([receipt()]));
    renderApp('#/deal/deal-1');

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Склад')).toBeTruthy();
    expect(within(dialog).getAllByText(/91_53d4/).length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText(/3 уп\./).length).toBeGreaterThan(0);
  });

  it('сообщает, что по заказу ничего не приходило', async () => {
    seed(makeData([], { orderNo: '91_15dr' }));
    renderApp('#/deal/deal-1');

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/По заказу 91_15dr ничего не приходило/)).toBeTruthy();
  });
});
