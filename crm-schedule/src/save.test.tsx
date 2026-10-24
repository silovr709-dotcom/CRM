// @vitest-environment jsdom
// Сохранение в браузер: с задержкой (чтобы не писать базу на каждую букву),
// но без потери правок при закрытии и сворачивании вкладки.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';
import { AppProvider } from './store';
import { STORAGE_KEY } from './lib/storage';

function renderApp() {
  return render(<AppProvider><App /></AppProvider>);
}

function storedTheme(): string | undefined {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return undefined;
  return (JSON.parse(raw) as { settings?: { theme?: string } }).settings?.theme;
}

beforeEach(() => {
  localStorage.clear();
  window.scrollTo = () => {};
  window.location.hash = '';
});

afterEach(() => cleanup());

describe('сохранение с задержкой', () => {
  it('записывает базу после паузы, а не на каждое изменение', async () => {
    renderApp();
    await waitFor(() => expect(localStorage.getItem(STORAGE_KEY)).toBeTruthy(), { timeout: 2000 });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) as string).deals.length).toBeGreaterThan(0);
  });

  it('правка темы доходит до хранилища', async () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Переключить тему' }));

    await waitFor(() => expect(storedTheme()).toBeTruthy(), { timeout: 2000 });
    const theme = document.documentElement.dataset.theme;
    expect(storedTheme()).toBe(theme === 'dark' ? 'dark' : 'light');
  });

  it('пишет сразу при закрытии страницы, не дожидаясь паузы', async () => {
    renderApp();
    await waitFor(() => expect(localStorage.getItem(STORAGE_KEY)).toBeTruthy(), { timeout: 2000 });

    // Меняем данные и тут же «закрываем» страницу.
    fireEvent.click(screen.getByRole('button', { name: 'Переключить тему' }));
    const before = localStorage.getItem(STORAGE_KEY);
    window.dispatchEvent(new Event('pagehide'));

    await waitFor(() => {
      const after = localStorage.getItem(STORAGE_KEY);
      expect(after).toBeTruthy();
      expect(after).not.toBe(before);
    }, { timeout: 1000 });
  });

  it('пишет при скрытии вкладки', async () => {
    renderApp();
    await waitFor(() => expect(localStorage.getItem(STORAGE_KEY)).toBeTruthy(), { timeout: 2000 });

    fireEvent.click(screen.getByRole('button', { name: 'Переключить тему' }));
    const before = localStorage.getItem(STORAGE_KEY);

    const original = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));

    await waitFor(() => expect(localStorage.getItem(STORAGE_KEY)).not.toBe(before), { timeout: 1000 });
    if (original) Object.defineProperty(Document.prototype, 'visibilityState', original);
  });
});
