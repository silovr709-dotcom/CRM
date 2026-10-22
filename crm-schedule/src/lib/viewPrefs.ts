// Память экранов: фильтры, режимы и выбранные дни возвращаются такими же,
// какими их оставили. Один ключ на экран, значения проверяются при чтении.
import { useCallback, useEffect, useRef, useState } from 'react';

const PREFIX = 'crm-schedule.prefs.';

export function loadPrefs<T extends Record<string, unknown>>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<T>;
    if (!parsed || typeof parsed !== 'object') return fallback;
    return { ...fallback, ...parsed };
  } catch {
    return fallback;
  }
}

export function savePrefs(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* переполнение памяти не должно ломать экран */
  }
}

/** Состояние, которое само сохраняется в браузере. */
export function usePrefs<T extends Record<string, unknown>>(key: string, initial: T) {
  const initialRef = useRef(initial);
  const [state, setState] = useState<T>(() => loadPrefs(key, initialRef.current));

  useEffect(() => {
    savePrefs(key, state);
  }, [key, state]);

  const patch = useCallback((next: Partial<T>) => {
    setState((current) => ({ ...current, ...next }));
  }, []);

  return [state, patch, setState] as const;
}

/** Один флаг (например «показывать подсказку») — без объекта. */
export function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(PREFIX + key) === '1';
  } catch {
    return false;
  }
}

export function writeFlag(key: string, value: boolean): void {
  try {
    localStorage.setItem(PREFIX + key, value ? '1' : '0');
  } catch {
    /* не критично */
  }
}

/** Мобильный экран: узкая ширина и тач. */
export function isNarrow(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(max-width: 720px)').matches;
}
