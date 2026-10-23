// Идентификаторы и общие утилиты.

export function uid(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Сумма из поля ввода: буквы и лишние знаки просто игнорируются.
 * Раньше `Number('12a')` давало NaN → 0, и поле очищалось на середине ввода.
 */
export function amountFromInput(text: string): number {
  const clean = text.replace(/[^\d.,]/g, '').replace(',', '.');
  if (!clean) return 0;
  const value = Number(clean);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function splitList(value: string): string[] {
  return value
    .split(/[,;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function joinList(values?: string[]): string {
  return (values ?? []).join(', ');
}

/** Простое «похоже на того же клиента»: одинаковое имя (без регистра) или общий телефон. */
export function normalizeName(value?: string): string {
  return (value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU');
}

export function phoneKey(value?: string): string {
  const digits = (value ?? '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
}
