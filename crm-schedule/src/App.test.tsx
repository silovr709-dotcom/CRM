// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import App from './App';
import { AppProvider } from './store';

function renderApp() {
  return render(<AppProvider><App /></AppProvider>);
}

function nav() {
  return screen.getByRole('navigation', { name: 'Разделы' });
}

describe('приложение целиком', () => {
  beforeEach(() => {
    localStorage.clear();
    window.scrollTo = () => {};
  });

  afterEach(() => cleanup());

  it('открывается на обзоре с демо-данными', () => {
    renderApp();
    expect(screen.getByRole('heading', { name: 'Обзор' })).toBeTruthy();
    expect(screen.getByText(/Сделок в работе/)).toBeTruthy();
  });

  it('переключается на CRM и показывает сделки', () => {
    renderApp();
    fireEvent.click(within(nav()).getByRole('button', { name: /CRM/ }));
    expect(screen.getByRole('heading', { name: 'CRM' })).toBeTruthy();
    expect(screen.getByText('Кухня на Ленина, 42')).toBeTruthy();
  });

  it('открывает карточку сделки и её вкладки', () => {
    renderApp();
    fireEvent.click(within(nav()).getByRole('button', { name: /CRM/ }));
    fireEvent.click(screen.getByText('Кухня на Ленина, 42'));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getAllByText('Анна Смирнова').length).toBeGreaterThan(0);
    expect(within(dialog).getByRole('button', { name: /Задачи/ })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: /Оплата/ })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: /Оплата/ }));
    expect(within(dialog).getByText('Сумма заказа')).toBeTruthy();
  });

  it('открывает график монтажей и находит событие', () => {
    renderApp();
    fireEvent.click(within(nav()).getByRole('button', { name: /График монтажей/ }));
    expect(screen.getByRole('heading', { name: 'График монтажей' })).toBeTruthy();
    expect(screen.getAllByText(/Монтаж|Замер|Доставка/).length).toBeGreaterThan(0);
  });

  it('открывает экран задач', () => {
    renderApp();
    fireEvent.click(within(nav()).getByRole('button', { name: /Задачи/ }));
    expect(screen.getByRole('heading', { name: 'Задачи' })).toBeTruthy();
  });

  it('показывает доску по этапам', () => {
    renderApp();
    fireEvent.click(within(nav()).getByRole('button', { name: /CRM/ }));
    fireEvent.click(screen.getByRole('tab', { name: 'Доска' }));
    expect(screen.getAllByText('Лид и расчёт').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Производство').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Закрыто').length).toBeGreaterThan(0);
  });

  it('добавляет задачу в карточке сделки', () => {
    renderApp();
    fireEvent.click(within(nav()).getByRole('button', { name: /CRM/ }));
    fireEvent.click(screen.getByText('Кухня на Ленина, 42'));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /Задачи/ }));
    const input = within(dialog).getByPlaceholderText(/Что сделать/);
    fireEvent.change(input, { target: { value: 'Позвонить по доставке' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Добавить' }));
    expect(within(dialog).getByText('Позвонить по доставке')).toBeTruthy();
  });

  it('открывает быструю правку события из графика', () => {
    renderApp();
    fireEvent.click(within(nav()).getByRole('button', { name: /График монтажей/ }));
    const pills = screen.getAllByTitle(/Монтаж:|Замер:|Доставка:/);
    fireEvent.click(pills[0]);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Дней на монтаж')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Клиент' })).toBeTruthy();
  });
});
