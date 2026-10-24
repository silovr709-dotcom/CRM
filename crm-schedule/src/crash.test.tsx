// @vitest-environment jsdom
// Аварийный экран: ошибка рендера не должна оставлять белый экран.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import AppErrorBoundary from './components/AppErrorBoundary';
import { demoData } from './lib/demoData';
import { saveData } from './lib/storage';

function Boom(): JSX.Element {
  throw new Error('Поле «сумма» получило объект');
}

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('аварийный экран', () => {
  it('показывает объяснение вместо белого экрана', () => {
    render(<AppErrorBoundary><Boom /></AppErrorBoundary>);

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Что-то сломалось на экране');
    expect(alert.textContent).toContain('Данные не потеряны');
    expect(alert.textContent).toContain('Поле «сумма» получило объект');
    expect(screen.getByRole('button', { name: 'Перезагрузить' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Открыть демо' })).toBeTruthy();
  });

  it('предлагает скачать копию, только если данные есть', () => {
    render(<AppErrorBoundary><Boom /></AppErrorBoundary>);
    expect(screen.queryByRole('button', { name: 'Скачать копию данных' })).toBeNull();
    cleanup();

    saveData(demoData());
    render(<AppErrorBoundary><Boom /></AppErrorBoundary>);
    expect(screen.getByRole('button', { name: 'Скачать копию данных' })).toBeTruthy();
  });

  it('скачивает JSON с текущими данными', () => {
    saveData(demoData());
    const created: string[] = [];
    const original = URL.createObjectURL;
    URL.createObjectURL = ((blob: Blob) => { created.push(blob.type); return 'blob:mock'; }) as typeof URL.createObjectURL;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    render(<AppErrorBoundary><Boom /></AppErrorBoundary>);
    fireEvent.click(screen.getByRole('button', { name: 'Скачать копию данных' }));

    expect(created).toContain('application/json');
    URL.createObjectURL = original;
  });
});
