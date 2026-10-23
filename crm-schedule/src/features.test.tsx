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

  it('не теряет правки клиента при закрытии карточки', () => {
    renderApp();
    fireEvent.click(within(nav()).getByRole('button', { name: /CRM/ }));
    fireEvent.click(screen.getByRole('tab', { name: 'Клиенты' }));
    fireEvent.click(screen.getAllByRole('button', { name: /Анна Смирнова/ })[0]);
    let dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByPlaceholderText('+7 900 000-00-00'), { target: { value: '+7 999 111-22-33' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Закрыть' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getAllByRole('button', { name: /Анна Смирнова/ })[0]);
    dialog = screen.getByRole('dialog');
    expect((within(dialog).getByPlaceholderText('+7 900 000-00-00') as HTMLTextAreaElement).value)
      .toBe('+7 999 111-22-33');
  });

  it('закрывает по Esc только верхнее окно', () => {
    renderApp();
    fireEvent.click(within(nav()).getByRole('button', { name: /CRM/ }));
    fireEvent.click(screen.getByRole('tab', { name: 'Клиенты' }));
    fireEvent.click(screen.getAllByRole('button', { name: /Анна Смирнова/ })[0]);
    const card = screen.getByRole('dialog');
    fireEvent.click(within(within(card).getByRole('navigation', { name: 'Разделы карточки' })).getByRole('button', { name: /Задачи/ }));
    fireEvent.click(within(card).getByRole('button', { name: /^Задача$/ }));
    expect(screen.getAllByRole('dialog')).toHaveLength(2);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(within(screen.getByRole('dialog')).getByText('Анна Смирнова')).toBeTruthy();
  });

  it('настраивает личное напоминание задачи', () => {
    renderApp();
    fireEvent.click(within(nav()).getByRole('button', { name: /Задачи/ }));
    fireEvent.click(screen.getAllByRole('button', { name: /Изменить задачу:/ })[0]);
    const editor = screen.getAllByRole('dialog').at(-1) as HTMLElement;

    expect(within(editor).getByRole('button', { name: 'Как у всех' })).toBeTruthy();
    fireEvent.click(within(editor).getByRole('button', { name: 'Своё' }));
    fireEvent.click(within(editor).getByRole('button', { name: 'за 30 минут' }));
    fireEvent.click(within(editor).getByRole('button', { name: 'за 3 часа' }));
    expect(within(editor).getByText(/Будет:/u).textContent).toContain('30 минут');

    fireEvent.click(within(editor).getByRole('button', { name: 'Сохранить' }));
    expect(screen.getAllByRole('img', { name: /Напоминание:/ }).length).toBeGreaterThan(0);

    // настройки сохранились: у задачи снова открывается режим «Своё»
    fireEvent.click(screen.getAllByRole('button', { name: /Изменить задачу:/ })[0]);
    const again = screen.getAllByRole('dialog').at(-1) as HTMLElement;
    expect(within(again).getByRole('button', { name: 'Своё' }).className).toContain('active');
    expect(within(again).getByText(/Будет:/u).textContent).toContain('3 часа');
  });

  it('«Выполнить все» закрывает все задачи сделки, а не одну', () => {
    renderApp();
    fireEvent.click(within(nav()).getByRole('button', { name: /CRM/ }));
    fireEvent.click(screen.getAllByText('Кухня на Ленина, 42')[0]);
    const dialog = screen.getByRole('dialog');
    const tabs = within(dialog).getByRole('navigation', { name: 'Разделы карточки' });
    fireEvent.click(within(tabs).getByRole('button', { name: /Задачи/ }));

    // добавляем две свои задачи (в демо уже есть похожие названия)
    const mine = ['Проверить фурнитуру', 'Уточнить цвет фасадов'];
    for (const title of mine) {
      fireEvent.change(within(dialog).getByPlaceholderText(/Что сделать/u), { target: { value: title } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Добавить' }));
    }
    const boxes = within(dialog).getAllByRole('checkbox', { name: /Выполнить:/u }) as HTMLInputElement[];
    expect(boxes.length).toBeGreaterThan(1);
    fireEvent.click(within(dialog).getByRole('button', { name: /Выполнить все/ }));
    // Повторяющиеся задачи создают следующую копию, поэтому проверяем именно наши две.
    for (const title of mine) {
      const box = within(dialog).getByRole('checkbox', { name: `Выполнить: ${title}` }) as HTMLInputElement;
      expect(box.checked, `задача «${title}»`).toBe(true);
    }
  });

  it('правит задачу из общего списка', () => {
    renderApp();
    fireEvent.click(within(nav()).getByRole('button', { name: /Задачи/ }));
    const title = screen.getAllByRole('button', { name: /Изменить задачу:/ })[0];
    fireEvent.click(title);
    const editor = screen.getAllByRole('dialog').at(-1) as HTMLElement;
    const input = within(editor).getByPlaceholderText(/позвонить/u) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Позвонить и уточнить адрес' } });
    fireEvent.click(within(editor).getByRole('button', { name: 'Сохранить' }));
    expect(screen.getAllByText('Позвонить и уточнить адрес').length).toBeGreaterThan(0);
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
    const tabs = within(dialog).getByRole('navigation', { name: 'Разделы карточки' });
    fireEvent.click(within(tabs).getByRole('button', { name: /Файлы/ }));
    expect(within(dialog).getByText('Документы и фото')).toBeTruthy();
    expect(within(dialog).getByText('фото-замера.jpg')).toBeTruthy();
  });

  it('правит задачу прямо в карточке клиента', () => {
    renderApp();
    fireEvent.click(within(nav()).getByRole('button', { name: /CRM/ }));
    fireEvent.click(screen.getByRole('tab', { name: 'Клиенты' }));
    fireEvent.click(screen.getAllByRole('button', { name: /Анна Смирнова/ })[0]);
    const dialog = screen.getByRole('dialog');
    const tabs = within(dialog).getByRole('navigation', { name: 'Разделы карточки' });
    fireEvent.click(within(tabs).getByRole('button', { name: /Задачи/ }));

    // добавляем задачу клиенту
    fireEvent.click(within(dialog).getByRole('button', { name: /^Задача$/ }));
    const editor = screen.getAllByRole('dialog').at(-1) as HTMLElement;
    fireEvent.change(within(editor).getByPlaceholderText(/позвонить/u), { target: { value: 'Уточнить размеры' } });
    fireEvent.click(within(editor).getByRole('button', { name: 'Добавить задачу' }));
    expect(within(dialog).getByRole('button', { name: 'Уточнить размеры' })).toBeTruthy();

    // открываем её на редактирование и меняем текст
    fireEvent.click(within(dialog).getByRole('button', { name: 'Уточнить размеры' }));
    const edit = screen.getAllByRole('dialog').at(-1) as HTMLElement;
    expect(within(edit).getByRole('button', { name: 'Сохранить' })).toBeTruthy();
    fireEvent.change(within(edit).getByPlaceholderText(/позвонить/u), { target: { value: 'Уточнить размеры и цвет' } });
    fireEvent.click(within(edit).getByRole('button', { name: 'Сохранить' }));
    expect(within(dialog).getByRole('button', { name: 'Уточнить размеры и цвет' })).toBeTruthy();
  });
});

describe('офлайн и установка', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    fireEvent(window, new Event('online'));
    cleanup();
  });

  it('открывает центр напоминаний', () => {
    renderApp();
    const button = screen.getAllByRole('button', { name: /Напоминания/ })[0];
    fireEvent.click(button);
    const panel = screen.getByRole('dialog', { name: 'Центр напоминаний' });
    expect(within(panel).getByText('Ближайшие')).toBeTruthy();
    expect(within(panel).getByText(/включено правил/u)).toBeTruthy();
    fireEvent.click(within(panel).getByRole('button', { name: 'Закрыть' }));
    expect(screen.queryByRole('dialog', { name: 'Центр напоминаний' })).toBeNull();
  });

  it('добавляет правило напоминания в настройках', () => {
    renderApp();
    fireEvent.click(within(nav()).getByRole('button', { name: /Данные/ }));
    const heading = screen.getByRole('heading', { name: /Напоминания/ });
    expect(heading).toBeTruthy();
    const before = screen.getAllByRole('checkbox', { name: /Включить правило/u }).length;
    fireEvent.click(screen.getByRole('button', { name: /Правило$/ }));
    const after = screen.getAllByRole('checkbox', { name: /Включить правило/u }).length;
    expect(after).toBe(before + 1);
    // новое правило сразу раскрыто — есть выбор «О чём напоминать»
    expect(screen.getAllByLabelText(/О чём напоминать/u).length).toBeGreaterThan(0);
    expect(screen.getByText('Когда напоминать')).toBeTruthy();
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
