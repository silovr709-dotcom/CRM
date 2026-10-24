// @vitest-environment jsdom
// Документы заказа: смета из позиций, выдача КП/договора, страница статуса с QR.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from './App';
import { AppProvider } from './store';
import { emptyData, STORAGE_KEY } from './lib/storage';
import { encodeStatus } from './lib/share';
import { fmtMoney } from './lib/dates';
import type { AppData, Deal, DealItem } from './types';

function makeItems(): DealItem[] {
  return [
    { id: 'item-1', title: 'Шкафы верхние', qty: 4, unit: 'шт.', price: 12000 },
    { id: 'item-2', title: 'Столешница', qty: 2.5, unit: 'м. п.', price: 8000 },
  ];
}

function makeData(deal: Partial<Deal> = {}): AppData {
  const base = emptyData();
  return {
    ...base,
    settings: { ...base.settings, demo: false, companyName: 'Кухни Лада', myName: 'Ирина' },
    clients: [{
      id: 'client-1',
      name: 'Анна Смирнова',
      phones: ['+7 900 111-22-33'],
      emails: [],
      address: 'Ленина, 42',
      tags: [],
      createdAt: '2026-05-01T09:00:00.000Z',
      updatedAt: '2026-05-01T09:00:00.000Z',
    }],
    deals: [{
      id: 'deal-1',
      title: 'Кухня на Ленина',
      clientId: 'client-1',
      amount: 100000,
      manager: 'Ирина',
      status: 'approved',
      items: makeItems(),
      tasks: [],
      payments: [{ id: 'pay-1', amount: 30000, at: '2026-05-02', kind: 'prepay' }],
      history: [],
      schedule: { status: 'planned', installAt: '2026-06-10', timeStart: '10:00', address: 'Ленина, 42' },
      createdAt: '2026-05-01T09:00:00.000Z',
      updatedAt: '2026-05-02T09:00:00.000Z',
      ...deal,
    }],
    updatedAt: '2026-05-02T09:00:00.000Z',
  };
}

/** Сумма в тексте: пробелы между разрядами бывают обычные и неразрывные. */
function money(value: number): RegExp {
  return new RegExp(`^${fmtMoney(value).replace(/\u00a0/g, '\\s')}$`);
}

function seed(data: AppData = makeData()) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function renderDocs() {
  window.location.hash = '#/deal/deal-1?tab=docs';
  render(<AppProvider><App /></AppProvider>);
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

describe('смета заказа', () => {
  it('показывает позиции, их суммы и итог', () => {
    seed();
    renderDocs();

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Смета заказа')).toBeTruthy();
    const titles = within(dialog).getAllByLabelText('Название позиции') as HTMLInputElement[];
    expect(titles.map((input) => input.value)).toEqual(['Шкафы верхние', 'Столешница']);
    expect(within(dialog).getByText('Итого по смете')).toBeTruthy();
    // 4 × 12 000 + 2,5 × 8 000 = 68 000.
    expect(within(dialog).getAllByText(money(68000)).length).toBeGreaterThan(0);
  });

  it('предлагает привести сумму заказа к смете', async () => {
    seed();
    renderDocs();

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/В карточке заказа указано/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Поставить сумму по смете' }));

    await waitFor(() => expect(within(dialog).queryByText(/В карточке заказа указано/)).toBeNull());
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) as string) as AppData;
      expect(stored.deals[0].amount).toBe(68000);
    });
  });

  it('добавляет и удаляет позицию', async () => {
    seed();
    renderDocs();

    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /Позиция$/ }));
    expect((within(dialog).getAllByLabelText('Название позиции') as HTMLInputElement[]).length).toBe(3);
    expect(within(dialog).getAllByRole('button', { name: 'Удалить позицию' }).length).toBe(3);

    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Удалить позицию' })[2]);
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) as string) as AppData;
      expect(stored.deals[0].items).toHaveLength(2);
    });
  });

  it('без позиций честно объясняет, что будет в документах', () => {
    seed(makeData({ items: [] }));
    renderDocs();

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/Позиций пока нет/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: /Заполнить из суммы заказа/ }));
    const titles = within(dialog).getAllByLabelText('Название позиции') as HTMLInputElement[];
    expect(titles[0].value).toBe('Кухня на Ленина');
  });
});

describe('документы заказа', () => {
  it('выдаёт КП с номером и показывает его содержимое', async () => {
    seed();
    renderDocs();

    const dialog = screen.getByRole('dialog');
    const cards = within(dialog).getAllByText('Коммерческое предложение');
    expect(cards.length).toBeGreaterThan(0);
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Создать' })[0]);

    const preview = await waitFor(() => {
      const dialogs = screen.getAllByRole('dialog');
      expect(dialogs.length).toBeGreaterThan(1);
      return dialogs[dialogs.length - 1];
    });
    // eslint-disable-next-line no-console

    await waitFor(() => expect(within(preview).getAllByText(/КП-[0-9]{4}-001/).length).toBeGreaterThan(0));
    expect(within(preview).getByText('Шкафы верхние')).toBeTruthy();
    expect(within(preview).getAllByText(money(68000)).length).toBeGreaterThan(0);
    // Условия КП: срок монтажа и предоплата.
    expect(within(preview).getAllByText('10.06.2026').length).toBeGreaterThan(0);
    expect(within(preview).getByText(/предоплата 50%/)).toBeTruthy();

    // Номер запомнился в сделке — второй раз он не изменится.
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) as string) as AppData;
      expect(stored.deals[0].documents?.[0]).toMatchObject({ kind: 'offer' });
      expect(stored.deals[0].documents?.[0].number).toBe(stored.deals[0].documents?.[0].number.toUpperCase());
    });
  });

  it('нумерует документы по порядку и по видам', async () => {
    const data = makeData();
    data.deals[0].documents = [
      { id: 'd1', kind: 'offer', number: `КП-${new Date().getFullYear()}-007`, issuedAt: '2026-05-01' },
    ];
    seed(data);
    renderDocs();

    const dialog = screen.getByRole('dialog');
    // КП уже выдан — у карточки кнопка «Открыть».
    const offerCard = within(dialog).getByText('Коммерческое предложение').closest('.doc-card') as HTMLElement;
    expect(within(offerCard).getByText(`КП-${new Date().getFullYear()}-007`)).toBeTruthy();

    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Создать' })[0]);
    const preview = await waitFor(() => {
      const dialogs = screen.getAllByRole('dialog');
      expect(dialogs.length).toBeGreaterThan(1);
      return dialogs[dialogs.length - 1];
    });
    await waitFor(() => expect(within(preview).getAllByText(new RegExp(`СМ-${new Date().getFullYear()}-001`)).length).toBeGreaterThan(0));
  });
});

describe('страница статуса для клиента', () => {
  it('открывается по ссылке и показывает этап, сроки и деньги', () => {
    const data = makeData();
    const deal = data.deals[0];
    const payload = encodeStatus(
      deal,
      data.clients[0],
      data.settings,
      { total: 68000, paid: 30000, remainder: 38000 },
    );
    window.location.hash = `#/status/${encodeURIComponent(payload)}`;

    render(<AppProvider><App /></AppProvider>);

    expect(screen.getByText('Кухня на Ленина')).toBeTruthy();
    expect(screen.getByText('Заказ подтверждён')).toBeTruthy();
    expect(screen.getByText('Кухни Лада')).toBeTruthy();
    expect(screen.getByText('10.06.2026, 10:00')).toBeTruthy();
    expect(screen.getAllByText(money(38000)).length).toBeGreaterThan(0);
    // Ничего лишнего: ни затрат, ни задач, ни меню CRM.
    expect(screen.queryByRole('navigation', { name: 'Разделы' })).toBeNull();
    expect(screen.queryByText(/маржа/i)).toBeNull();
  });

  it('честно говорит, если ссылка испорчена', () => {
    window.location.hash = '#/status/не-ссылка';
    render(<AppProvider><App /></AppProvider>);
    expect(screen.getByText('Ссылка не открылась')).toBeTruthy();
  });
});
