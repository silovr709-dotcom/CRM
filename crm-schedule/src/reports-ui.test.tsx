// @vitest-environment jsdom
// Отчёты и деньги в интерфейсе: раздел «Отчёты», маржа в карточке сделки,
// затраты и план оплат.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import App from './App';
import { AppProvider } from './store';
import { demoData } from './lib/demoData';
import { emptyData, saveData } from './lib/storage';
import type { Deal } from './types';

function renderApp() {
  return render(<AppProvider><App /></AppProvider>);
}

function nav() {
  return screen.getByRole('navigation', { name: 'Разделы' });
}

function openDeal(title: string) {
  fireEvent.click(within(nav()).getByRole('button', { name: /CRM/ }));
  fireEvent.click(screen.getAllByText(title)[0]);
  return screen.getByRole('dialog');
}

beforeEach(() => {
  localStorage.clear();
  window.scrollTo = () => {};
  window.location.hash = '';
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('раздел «Отчёты»', () => {
  it('открывается из меню и показывает цифры периода', () => {
    renderApp();
    fireEvent.click(within(nav()).getByRole('button', { name: /Отчёты/ }));

    expect(screen.getByRole('heading', { name: 'Отчёты' })).toBeTruthy();
    expect(screen.getByText('Новых сделок')).toBeTruthy();
    expect(screen.getByText('Получено денег')).toBeTruthy();
    expect(screen.getByText('На руках')).toBeTruthy();
    expect(screen.getByText('Ждём оплату')).toBeTruthy();
    // Демо-данные: получено 100 000 + 90 000 + 20 000 (октябрьские платежи)
    expect(screen.getAllByText(/₽/).length).toBeGreaterThan(5);
  });

  it('переключает период и листает его стрелками', () => {
    renderApp();
    fireEvent.click(within(nav()).getByRole('button', { name: /Отчёты/ }));

    const group = screen.getByRole('group', { name: 'Период отчёта' });
    fireEvent.click(within(group).getByRole('button', { name: 'Год' }));
    expect(within(group).getByText(/^Год \d{4}$/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Предыдущий период' }));
    const label = within(screen.getByRole('group', { name: 'Период отчёта' })).getByText(/^Год \d{4}$/).textContent ?? '';
    expect(Number(label.slice(4))).toBe(new Date().getFullYear() - 1);
  });

  it('показывает ошибку, если своя дата «с» позже «по»', () => {
    renderApp();
    fireEvent.click(within(nav()).getByRole('button', { name: /Отчёты/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Свой' }));

    fireEvent.change(screen.getByLabelText('С'), { target: { value: '2026-10-20' } });
    fireEvent.change(screen.getByLabelText('По'), { target: { value: '2026-10-01' } });
    expect(screen.getByText('Дата «с» позже даты «по»')).toBeTruthy();
  });

  it('выгружает сделки и отчёт в CSV', () => {
    const created: string[] = [];
    const original = URL.createObjectURL;
    URL.createObjectURL = ((blob: Blob) => {
      created.push(blob.type);
      return 'blob:mock';
    }) as typeof URL.createObjectURL;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    renderApp();
    fireEvent.click(within(nav()).getByRole('button', { name: /Отчёты/ }));
    const csvButtons = screen.getAllByRole('button', { name: /\.csv/ });
    expect(csvButtons).toHaveLength(2);
    csvButtons.forEach((button) => fireEvent.click(button));

    expect(created.filter((type) => type.includes('text/csv'))).toHaveLength(2);
    expect(screen.getByText('Отчёт выгружен в CSV')).toBeTruthy();
    URL.createObjectURL = original;
  });

  it('показывает долги по демо-данным и ведёт в сделку', () => {
    renderApp();
    fireEvent.click(within(nav()).getByRole('button', { name: /Отчёты/ }));
    const debtCard = screen.getByText('Кто должен').closest('section');
    expect(debtCard).toBeTruthy();
    // «Кухня в новостройке» согласована, предоплаты нет — значит должна быть в списке.
    const link = within(debtCard as HTMLElement).getByRole('button', { name: 'Кухня в новостройке' });
    fireEvent.click(link);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('с обзора по «Ждём оплату» открывается отчёт', () => {
    renderApp();
    const strip = screen.getByLabelText('Показатели');
    fireEvent.click(within(strip).getByRole('button', { name: /Ждём оплату/ }));
    expect(screen.getByRole('heading', { name: 'Отчёты' })).toBeTruthy();
    expect(screen.getByText('Кто должен')).toBeTruthy();
  });

  it('на пустой базе объясняет, что считать нечего', () => {
    saveData(emptyData());
    renderApp();
    fireEvent.click(within(nav()).getByRole('button', { name: /Отчёты/ }));
    expect(screen.getByText('Пока нечего считать')).toBeTruthy();
  });
});

describe('деньги в карточке сделки', () => {
  it('показывает маржу, добавляет затрату и пересчитывает', () => {
    const data = demoData();
    const deal = data.deals.find((item) => item.id === 'deal_lenina') as Deal;
    saveData(data);

    renderApp();
    const dialog = openDeal(deal.title);
    fireEvent.click(within(dialog).getByRole('button', { name: /Оплата/ }));

    expect(within(dialog).getByText('Затраты и маржа')).toBeTruthy();
    // 285 000 − 156 500 = 128 500 (демо-затраты Кухни на Ленина)
    expect(within(dialog).getAllByText(/128\s*500 ₽/).length).toBeGreaterThan(0);

    const expenses = dialog.querySelector('.deal-expenses') as HTMLElement;
    fireEvent.change(within(expenses).getByLabelText('Сумма, ₽'), { target: { value: '10000' } });
    fireEvent.click(within(expenses).getByRole('button', { name: /Добавить затрату/ }));

    expect(within(dialog).getAllByText(/118\s*500 ₽/).length).toBeGreaterThan(0);
  });

  it('не даёт добавить затрату без суммы', () => {
    renderApp();
    const dialog = openDeal('Кухня на Ленина, 42');
    fireEvent.click(within(dialog).getByRole('button', { name: /Оплата/ }));
    const expenses = dialog.querySelector('.deal-expenses') as HTMLElement;
    fireEvent.click(within(expenses).getByRole('button', { name: /Добавить затрату/ }));
    expect(screen.getByText('Укажите сумму затраты')).toBeTruthy();
  });

  it('ведёт план оплат: отметка «получено» создаёт платёж', () => {
    renderApp();
    const dialog = openDeal('Кухня в новостройке');
    fireEvent.click(within(dialog).getByRole('button', { name: /Оплата/ }));

    expect(within(dialog).getByText('План оплат')).toBeTruthy();
    const money = () => within(dialog).getByText('Сумма заказа').parentElement?.textContent ?? '';
    expect(money()).toMatch(/530\s*000/);

    fireEvent.click(within(dialog).getAllByRole('button', { name: /Отметить полученным: 265\s*000/ })[0]);

    // Отметка сработала: кнопка стала «снять отметку», платёж появился в списке.
    expect(within(dialog).getAllByRole('button', { name: 'Снять отметку «получено»' }).length).toBe(1);
    expect(within(dialog).getAllByText(/265\s*000 ₽/).length).toBeGreaterThan(1);
  });

  it('добавляет платёж в план', () => {
    renderApp();
    const dialog = openDeal('Кухня «Скандинавия»');
    fireEvent.click(within(dialog).getByRole('button', { name: /Оплата/ }));

    const plan = dialog.querySelector('.deal-plan') as HTMLElement;
    fireEvent.change(within(plan).getByLabelText('Сумма, ₽'), { target: { value: '200000' } });
    fireEvent.click(within(plan).getByRole('button', { name: /В план/ }));

    expect(within(dialog).getAllByText(/200\s*000 ₽/).length).toBeGreaterThan(0);
  });

  it('прячет маржу, пока затраты не заполнены', () => {
    const data = emptyData();
    data.deals = [{
      id: 'deal-x', title: 'Новый заказ', clientId: '', amount: 100000, status: 'draft',
      tasks: [], payments: [], history: [], schedule: { status: 'planned' },
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }];
    saveData(data);

    renderApp();
    const dialog = openDeal('Новый заказ');
    fireEvent.click(within(dialog).getByRole('button', { name: /Оплата/ }));
    expect(within(dialog).getByText('маржа не посчитана')).toBeTruthy();
    expect(within(dialog).getByText(/без них процент не считается/)).toBeTruthy();
  });
});
