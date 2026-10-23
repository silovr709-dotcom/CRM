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
function openClients() {
  fireEvent.click(within(nav()).getByRole('button', { name: /CRM/ }));
  fireEvent.click(screen.getByRole('tab', { name: 'Клиенты' }));
  fireEvent.click(screen.getAllByRole('button', { name: /Анна Смирнова/ })[0]);
}

describe('фокус при вводе', () => {
  beforeEach(() => {
    localStorage.clear();
    window.scrollTo = () => {};
    window.location.hash = '';
  });
  afterEach(() => cleanup());

  it('карточка клиента: все поля держат фокус', () => {
    renderApp();
    openClients();
    const dialog = screen.getByRole('dialog');
    const fields: Array<[string, string]> = [
      ['+7 900 000-00-00', '8'],
      ['anna@example.ru', 'a'],
      ['город, улица, дом', 'М'],
      ['сайт, знакомые, Авито', 'с'],
      ['VIP, повторный', 'V'],
      ['о клиенте, о квартире, о договорённостях', 'т'],
    ];
    for (const [placeholder, char] of fields) {
      const input = within(dialog).getByPlaceholderText(placeholder) as HTMLInputElement | HTMLTextAreaElement;
      input.focus();
      fireEvent.change(input, { target: { value: input.value + char } });
      expect(document.activeElement, `поле «${placeholder}»`).toBe(input);
    }
  });

  it('карточка сделки: название и сумма держат фокус', () => {
    renderApp();
    fireEvent.click(within(nav()).getByRole('button', { name: /CRM/ }));
    fireEvent.click(screen.getAllByText('Кухня на Ленина, 42')[0]);
    const dialog = screen.getByRole('dialog');
    const title = within(dialog).getByDisplayValue('Кухня на Ленина, 42') as HTMLInputElement;
    title.focus();
    fireEvent.change(title, { target: { value: 'Кухня на Ленина, 42!' } });
    expect(document.activeElement).toBe(title);
    const manager = within(dialog).getByPlaceholderText('менеджер') as HTMLInputElement;
    manager.focus();
    fireEvent.change(manager, { target: { value: 'Сергей' } });
    expect(document.activeElement).toBe(manager);
  });

  it('новый клиент открывается с фокусом в «Имя»', async () => {
    renderApp();
    fireEvent.click(within(nav()).getByRole('button', { name: /CRM/ }));
    fireEvent.click(screen.getByRole('tab', { name: 'Клиенты' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Клиент' }));
    const dialog = screen.getByRole('dialog');
    const name = within(dialog).getByPlaceholderText('Анна Смирнова');
    // автофокус ставится через короткий таймер, чтобы не мешать быстрому клику
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(document.activeElement).toBe(name);
    // и после ввода остаётся там же
    fireEvent.change(name, { target: { value: 'Пётр' } });
    expect(document.activeElement).toBe(name);
  });

  it('быстрый клик по второму полю не перебивается автофокусом', () => {
    renderApp();
    fireEvent.click(within(nav()).getByRole('button', { name: /CRM/ }));
    fireEvent.click(screen.getByRole('tab', { name: 'Клиенты' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Клиент' }));
    const dialog = screen.getByRole('dialog');
    const phones = within(dialog).getByPlaceholderText('+7 900 000-00-00');
    phones.focus();
    expect(document.activeElement).toBe(phones);
  });
});

describe('фокус в поиске', () => {
  beforeEach(() => {
    localStorage.clear();
    window.scrollTo = () => {};
    window.location.hash = '';
  });
  afterEach(() => cleanup());

  it('поиск по CRM не теряет фокус при фильтрации', () => {
    renderApp();
    fireEvent.click(within(nav()).getByRole('button', { name: /CRM/ }));
    const search = screen.getByLabelText('Поиск по CRM') as HTMLInputElement;
    search.focus();
    fireEvent.change(search, { target: { value: 'Кухня' } });
    expect(document.activeElement).toBe(search);
    fireEvent.change(search, { target: { value: 'Кухня на' } });
    expect(document.activeElement).toBe(search);
  });

  it('поиск по задачам не теряет фокус', () => {
    renderApp();
    fireEvent.click(within(nav()).getByRole('button', { name: /Задачи/ }));
    const search = screen.getByLabelText('Поиск по задачам') as HTMLInputElement;
    search.focus();
    fireEvent.change(search, { target: { value: 'Позвонить' } });
    expect(document.activeElement).toBe(search);
  });

  it('ввод в поиске ⌘K проходит по буквам', () => {
    renderApp();
    fireEvent.keyDown(document, { key: 'k', metaKey: true });
    const palette = screen.getByRole('dialog', { name: 'Поиск и команды' });
    const input = within(palette).getByLabelText('Поиск') as HTMLInputElement;
    input.focus();
    fireEvent.change(input, { target: { value: 'А' } });
    fireEvent.change(input, { target: { value: 'Ан' } });
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('Ан');
  });
});
