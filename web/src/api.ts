const BASE = '/api';

// 401 → показываем экран входа (ловится в store)
export const AUTH_EVENT = 'myday-unauthorized';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (res.status === 401) {
    window.dispatchEvent(new Event(AUTH_EVENT));
    throw new Error('Нужно войти');
  }
  if (!res.ok) {
    let message = `Ошибка ${res.status}`;
    const body = await res.text();
    try { message = JSON.parse(body).error || message; } catch { /* текст как есть */ }
    throw new Error(message);
  }
  return res.json();
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

// --- Даты (клиент) ---
export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WD_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
export const WD_FULL = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];

export function humanDate(dateStr: string | null, withWd = true): string {
  if (!dateStr) return '';
  const t = todayStr();
  if (dateStr === t) return 'сегодня';
  if (dateStr === addDays(t, 1)) return 'завтра';
  if (dateStr === addDays(t, -1)) return 'вчера';
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const base = `${d} ${MONTHS[m - 1]}${y !== new Date().getFullYear() ? ' ' + y : ''}`;
  return withWd ? `${base}, ${WD_SHORT[dt.getDay()]}` : base;
}

export function money(v: number | null | undefined): string {
  if (v == null) return '';
  return `${Math.round(v).toLocaleString('ru-RU')} ₽`;
}

export function humanDuration(min: number | null | undefined): string {
  if (min == null) return '';
  const h = Math.floor(min / 60), m = min % 60;
  if (h && m) return `${h} ч ${m} мин`;
  if (h) return `${h} ч`;
  return `${m} мин`;
}

export function weekdayOf(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}
