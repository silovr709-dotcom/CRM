// @vitest-environment jsdom
// Учётные записи и пароли: вход, разделение ролей и запрет на управление доступом.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from './App';
import { AppProvider } from './store';
import { emptyData, STORAGE_KEY } from './lib/storage';
import { createAccount } from './lib/accounts';
import type { Account, AppData, RoleId } from './types';

const SESSION_KEY = 'crm-schedule.session.v1';

function baseData(accounts: Account[], role: RoleId = 'owner'): AppData {
  const base = emptyData();
  return {
    ...base,
    settings: {
      ...base.settings,
      demo: false,
      companyName: 'Кухни Лада',
      myName: 'Ирина',
      role,
      accounts,
    },
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
      expenses: [{ id: 'e1', kind: 'materials', amount: 120000, at: '2026-05-02' }],
      plan: [],
      history: [],
      schedule: { status: 'planned' },
      createdAt: '2026-05-01T09:00:00.000Z',
      updatedAt: '2026-05-02T09:00:00.000Z',
    }],
    updatedAt: '2026-05-02T09:00:00.000Z',
  };
}

function seed(data: AppData) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function renderApp(hash = '') {
  window.location.hash = hash;
  return render(<AppProvider><App /></AppProvider>);
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

describe('вход по паролю', () => {
  it('без учётных записей приложение открывается сразу и предлагает их завести', async () => {
    seed(baseData([]));
    renderApp();

    expect(screen.getByRole('navigation', { name: 'Разделы' })).toBeTruthy();
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Разделы' })).getByRole('button', { name: /Данные/ }));

    const card = screen.getByText('Доступ и учётные записи').closest('section') as HTMLElement;
    expect(within(card).getByRole('radiogroup', { name: 'Роль на этом устройстве' })).toBeTruthy();
    expect(within(card).getByRole('button', { name: /Добавить/ })).toBeTruthy();
  });

  it('с учётными записями сначала просит пароль', async () => {
    const owner = await createAccount({ name: 'Ирина', role: 'owner', password: '1111' });
    seed(baseData([owner]));
    renderApp();

    expect(screen.getByText('Здравствуйте, Ирина')).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Разделы' })).toBeNull();

    const input = screen.getByLabelText('Пароль');
    fireEvent.change(input, { target: { value: 'неверный' } });
    fireEvent.click(screen.getByRole('button', { name: /Войти/ }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Неверный пароль'));
    // Внутрь не пустили.
    expect(screen.queryByRole('navigation', { name: 'Разделы' })).toBeNull();

    fireEvent.change(input, { target: { value: '1111' } });
    fireEvent.click(screen.getByRole('button', { name: /Войти/ }));

    await waitFor(() => expect(screen.getByRole('navigation', { name: 'Разделы' })).toBeTruthy());
    expect(localStorage.getItem(SESSION_KEY)).toBe(owner.id);
    // Внизу панели видно, кто вошёл.
    expect(screen.getAllByText('Ирина').length).toBeGreaterThan(0);
  });

  it('запоминает вход после перезагрузки', async () => {
    const owner = await createAccount({ name: 'Ирина', role: 'owner', password: '1111', id: 'acc-owner' });
    seed(baseData([owner]));
    localStorage.setItem(SESSION_KEY, owner.id);
    renderApp();

    expect(screen.getByRole('navigation', { name: 'Разделы' })).toBeTruthy();
    expect(screen.queryByText(/вход по паролю/)).toBeNull();
  });

  it('монтажник после входа не видит денег и управления доступом', async () => {
    const worker = await createAccount({ name: 'Олег', role: 'installer', password: '2222', id: 'acc-worker' });
    seed(baseData([worker]));
    localStorage.setItem(SESSION_KEY, worker.id);
    renderApp('#/data');

    const nav = screen.getByRole('navigation', { name: 'Разделы' });
    expect(within(nav).queryByRole('button', { name: /Отчёты/ })).toBeNull();

    const card = screen.getByText('Доступ и учётные записи').closest('section') as HTMLElement;
    expect(within(card).queryByRole('button', { name: /Добавить/ })).toBeNull();
    expect(within(card).getByText(/ваша учётная запись/)).toBeTruthy();
  });
});

describe('управление сотрудниками', () => {
  it('руководитель добавляет сотрудника, и тот появляется в списке', async () => {
    const owner = await createAccount({ name: 'Ирина', role: 'owner', password: '1111', id: 'acc-owner' });
    seed(baseData([owner]));
    localStorage.setItem(SESSION_KEY, owner.id);
    renderApp('#/data');

    const card = screen.getByText('Доступ и учётные записи').closest('section') as HTMLElement;
    fireEvent.change(within(card).getByPlaceholderText('например, Сергей'), { target: { value: 'Сергей' } });
    fireEvent.change(within(card).getByLabelText('Пароль нового сотрудника'), { target: { value: '3333' } });
    fireEvent.click(within(card).getByRole('button', { name: /Добавить/ }));

    await waitFor(() => expect(within(card).getByText('Сергей')).toBeTruthy());
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) as string) as AppData;
      expect(stored.settings.accounts?.map((item) => item.name)).toEqual(['Ирина', 'Сергей']);
      // Пароль в базе не лежит открытым текстом.
      expect(JSON.stringify(stored)).not.toContain('3333');
    });
  });

  it('пароль короче четырёх символов не принимается', async () => {
    const owner = await createAccount({ name: 'Ирина', role: 'owner', password: '1111', id: 'acc-owner' });
    seed(baseData([owner]));
    localStorage.setItem(SESSION_KEY, owner.id);
    renderApp('#/data');

    const card = screen.getByText('Доступ и учётные записи').closest('section') as HTMLElement;
    fireEvent.change(within(card).getByPlaceholderText('например, Сергей'), { target: { value: 'Сергей' } });
    fireEvent.change(within(card).getByLabelText('Пароль нового сотрудника'), { target: { value: '12' } });
    fireEvent.click(within(card).getByRole('button', { name: /Добавить/ }));

    await waitFor(() => expect(within(card).getByRole('alert').textContent).toBe('Пароль короче 4 символов'));
  });

  it('руководитель меняет роль сотрудника, и она применяется при входе', async () => {
    const owner = await createAccount({ name: 'Ирина', role: 'owner', password: '1111', id: 'acc-owner' });
    const manager = await createAccount({ name: 'Сергей', role: 'manager', password: '3333', id: 'acc-manager' });
    seed(baseData([owner, manager]));
    localStorage.setItem(SESSION_KEY, owner.id);
    renderApp('#/data');

    const select = screen.getByLabelText('Роль: Сергей');
    fireEvent.change(select, { target: { value: 'installer' } });

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) as string) as AppData;
      expect(stored.settings.accounts?.find((item) => item.id === 'acc-manager')?.role).toBe('installer');
    });
  });

  it('«Выйти» возвращает на экран входа', async () => {
    const owner = await createAccount({ name: 'Ирина', role: 'owner', password: '1111', id: 'acc-owner' });
    seed(baseData([owner]));
    localStorage.setItem(SESSION_KEY, owner.id);
    renderApp();

    fireEvent.click(screen.getByRole('button', { name: 'Выйти' }));

    await waitFor(() => expect(screen.getByText('Здравствуйте, Ирина')).toBeTruthy());
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it('первая учётная запись не выкидывает на вход', async () => {
    seed(baseData([]));
    renderApp('#/data');

    const card = screen.getByText('Доступ и учётные записи').closest('section') as HTMLElement;
    fireEvent.change(within(card).getByPlaceholderText('например, Сергей'), { target: { value: 'Ирина' } });
    fireEvent.change(within(card).getByLabelText('Пароль нового сотрудника'), { target: { value: '1111' } });
    fireEvent.click(within(card).getByRole('button', { name: /Добавить/ }));

    // Первый сотрудник остаётся внутри приложения, а не на экране входа.
    await waitFor(() => expect(localStorage.getItem(SESSION_KEY)).toBeTruthy());
    expect(screen.getByRole('navigation', { name: 'Разделы' })).toBeTruthy();
    expect(screen.queryByText(/Здравствуйте, Ирина/)).toBeNull();
  });
});
