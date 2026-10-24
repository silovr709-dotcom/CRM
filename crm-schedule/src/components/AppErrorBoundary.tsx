// Страховка от белого экрана: любая ошибка рендера показывает объяснение
// и три выхода — перезагрузить, скачать копию данных, открыть демо.
import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import type { AppData } from '../types';
import { loadData } from '../lib/storage';

interface State {
  error: Error | null;
}

function downloadSnapshot(): void {
  const data = loadData();
  if (!data) return;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `crm-копия-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Демо-режим сбрасывает только отображение, данные остаются в браузере. */
function openDemo(): void {
  try {
    localStorage.removeItem('crm-schedule.v1');
  } catch {
    /* приватный режим: просто перезагрузимся */
  }
  window.location.hash = '#/overview';
  window.location.reload();
}

export default class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Консоль — единственное место, где это увидит разработчик.
    console.error('Ошибка интерфейса:', error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    const hasData = Boolean(loadData() as AppData | null);

    return (
      <div className="crash-screen" role="alert">
        <div className="crash-card">
          <span className="crash-mark">!</span>
          <h1>Что-то сломалось на экране</h1>
          <p>
            Данные не потеряны: они сохранены в этом браузере. Сначала попробуйте перезагрузить —
            обычно этого достаточно.
          </p>
          <pre>{error.message}</pre>
          <div className="crash-actions">
            <button type="button" className="btn primary" onClick={() => window.location.reload()}>
              Перезагрузить
            </button>
            {hasData && (
              <button type="button" className="btn ghost" onClick={downloadSnapshot}>
                Скачать копию данных
              </button>
            )}
            <button type="button" className="btn ghost" onClick={openDemo}>
              Открыть демо
            </button>
          </div>
          <p className="muted small">
            Если ошибка повторяется — пришлите текст выше. Копию JSON можно загрузить обратно в «Данных».
          </p>
        </div>
      </div>
    );
  }
}
