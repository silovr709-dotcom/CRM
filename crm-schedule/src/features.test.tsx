// @vitest-environment jsdom
// Сквозные проверки новых возможностей: ⌘K, отмена действий, импорт с
// предпросмотром, повторы задач и экран настроек.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import App from './App';
import { AppProvider } from './store';
import { demoData } from './lib/demoData';
import {
  autoBackupInfo, emptyData, mergeImport, previewImport, readAutoBackup, saveData, writeAutoBackup,
} from './lib/storage';
import { makeDeal } from './lib/testUtils';
import { installAvailable, isStandalone, promptInstall } from './lib/pwa';

function renderApp() {
  return render(<AppProvider><App /></AppProvider>);
}

function nav() {
  return screen.getByRole('navigation', { name: 'Разделы' });
}

describe('новые возможности интерфейса', () => {
  beforeEach(() => {
    localStorage.clear();
    window.scrollTo = () => {};
    window.location.hash = '';
  });

  afterEach(() => cleanup());

  it('открывает поиск по ⌘K и показывает разделы', () => {
    renderApp();
    fireEvent.keyDown(document, { key: 'k', metaKey: true });
    const palette = screen.getByRole('dialog', { name: 'Поиск и команды' });
    expect(within(palette).getByLabelText('Поиск')).toBeTruthy();
    expect(within(palette).getByText('Новая сделка')).toBeTruthy();
    fireEvent.change(within(palette).getByLabelText('Поиск'), { target: { value: 'Анна' } });
    expect(within(palette).getAllByText(/Анна/u).length).toBeGreaterThan(0);
    fireEvent.keyDown(within(palette).getByLabelText('Поиск'), { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Поиск и команды' })).toBeNull();
  });

  it('создаёт сделку и открывает её карточку', () => {
    renderApp();
    fireEvent.click(within(nav()).getByRole('button', { name: /CRM/ }));
    fireEvent.click(screen.getAllByRole('button', { name: '+ Сделка' })[0]);
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByPlaceholderText(/Кухня на Ленина/u), { target: { value: 'Шкаф в прихожую' } });
    const select = within(dialog).getAllByRole('combobox')[0];
    fireEvent.change(select, { target: { value: select.querySelectorAll('option')[1].value as string } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Создать сделку' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getAllByText('Шкаф в прихожую').length).toBeGreaterThan(0);
  });

  it('открывает экран данных и меняет тему', () => {
    renderApp();
    fireEvent.click(within(nav()).getByRole('button', { name: /Данные/ }));
    expect(screen.getByRole('heading', { name: 'Данные' })).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: /Тёмная/ }));
    fireEvent.click(screen.getByRole('button', { name: /Сохранить настройки/ }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('переключает режимы графика без ошибок', () => {
    renderApp();
    fireEvent.click(within(nav()).getByRole('button', { name: /График монтажей/ }));
    for (const mode of ['Неделя', 'Бригады', 'Список', 'Месяц']) {
      fireEvent.click(screen.getByRole('button', { name: mode }));
    }
    expect(screen.getByRole('heading', { name: 'График монтажей' })).toBeTruthy();
  });

  it('открывает список клиентов и карточку клиента', () => {
    renderApp();
    fireEvent.click(within(nav()).getByRole('button', { name: /CRM/ }));
    fireEvent.click(screen.getByRole('tab', { name: 'Клиенты' }));
    const rows = screen.getAllByRole('button', { name: /Анна Смирнова/ });
    fireEvent.click(rows[0]);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Сделки')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Сохранить' })).toBeTruthy();
  });

  it('показывает вкладку графика в карточке сделки', () => {
    renderApp();
    fireEvent.click(within(nav()).getByRole('button', { name: /CRM/ }));
    fireEvent.click(screen.getAllByText('Кухня на Ленина, 42')[0]);
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(within(dialog).getByRole('navigation', { name: 'Разделы карточки' })).getByRole('button', { name: /График/ }));
    expect(within(dialog).getByText('Дней на монтаж')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: /История/ }));
    expect(within(dialog).getByText(/Всего событий/)).toBeTruthy();
  });

  it('переключает CRM на доску и обратно', () => {
    renderApp();
    fireEvent.click(within(nav()).getByRole('button', { name: /CRM/ }));
    fireEvent.click(screen.getByRole('tab', { name: 'Доска' }));
    expect(screen.getAllByText('Согласовано').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('tab', { name: 'Список' }));
    expect(screen.getAllByText('Кухня на Ленина, 42').length).toBeGreaterThan(0);
  });
});

describe('вложения в карточках', () => {
  beforeEach(() => {
    localStorage.clear();
    window.scrollTo = () => {};
    window.location.hash = '';
    const data = demoData();
    data.deals[0] = {
      ...data.deals[0],
      attachments: [{
        id: 'file-demo',
        name: 'договор-Ленина.pdf',
        mime: 'application/pdf',
        size: 2048,
        kind: 'document',
        createdAt: new Date().toISOString(),
      }],
    };
    data.clients[0] = {
      ...data.clients[0],
      attachments: [{
        id: 'file-client-demo',
        name: 'фото-замера.jpg',
        mime: 'image/jpeg',
        size: 4096,
        kind: 'photo',
        createdAt: new Date().toISOString(),
      }],
    };
    saveData(data);
  });

  afterEach(() => cleanup());

  it('показывает вкладку «Файлы» со списком вложений', () => {
    renderApp();
    fireEvent.click(within(nav()).getByRole('button', { name: /CRM/ }));
    fireEvent.click(screen.getAllByText('Кухня на Ленина, 42')[0]);
    const dialog = screen.getByRole('dialog');
    const tabs = within(dialog).getByRole('navigation', { name: 'Разделы карточки' });
    fireEvent.click(within(tabs).getByRole('button', { name: /Файлы/ }));
    expect(within(dialog).getByText('договор-Ленина.pdf')).toBeTruthy();
    expect(within(dialog).getByText(/Перетащите файлы сюда/)).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: /Скачать всё/ })).toBeTruthy();
  });

  it('показывает документы в карточке клиента', () => {
    renderApp();
    fireEvent.click(within(nav()).getByRole('button', { name: /CRM/ }));
    fireEvent.click(screen.getByRole('tab', { name: 'Клиенты' }));
    fireEvent.click(screen.getAllByRole('button', { name: /Анна Смирнова/ })[0]);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Документы и фото')).toBeTruthy();
    expect(within(dialog).getByText('фото-замера.jpg')).toBeTruthy();
  });
});

describe('офлайн и установка', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    fireEvent(window, new Event('online'));
  });

  it('показывает плашку, когда пропала сеть', () => {
    renderApp();
    expect(screen.queryByText(/Нет сети/u)).toBeNull();
    fireEvent(window, new Event('offline'));
    expect(screen.getByText(/Нет сети/u)).toBeTruthy();
    fireEvent(window, new Event('online'));
    expect(screen.queryByText(/Нет сети/u)).toBeNull();
  });

  it('не предлагает установку, пока браузер её не разрешил', async () => {
    expect(installAvailable()).toBe(false);
    expect(isStandalone()).toBe(false);
    await expect(promptInstall()).resolves.toBe(false);
  });
});

describe('данные и импорт', () => {
  beforeEach(() => localStorage.clear());

  it('различает свою копию и считает содержимое', () => {
    const data = demoData();
    const raw = JSON.stringify({
      kind: 'crm-schedule-backup',
      version: 2,
      clients: data.clients,
      deals: data.deals,
      settings: data.settings,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    });
    const preview = previewImport(raw, emptyData());
    expect(preview.kind).toBe('crm-schedule');
    expect(preview.deals).toBe(data.deals.length);
    expect(preview.clients).toBe(data.clients.length);
    expect(preview.error).toBeUndefined();
  });

  it('сливает импорт без потери текущих клиентов', () => {
    const current = emptyData();
    const incoming = demoData();
    const merged = mergeImport(current, incoming);
    expect(merged.clients.length).toBe(incoming.clients.length);
    expect(merged.deals.length).toBe(incoming.deals.length);
  });

  it('сохраняет авто-копию перед опасным действием', () => {
    const data = emptyData();
    data.deals = [makeDeal()];
    expect(writeAutoBackup(data, 'тест')).toBe(true);
    const info = autoBackupInfo();
    expect(info?.reason).toBe('тест');
    expect(readAutoBackup()?.deals).toHaveLength(1);
  });

  it('отдаёт понятную ошибку на битый файл', () => {
    const preview = previewImport('{ это не json', emptyData());
    expect(preview.error).toMatch(/JSON/u);
  });
});
