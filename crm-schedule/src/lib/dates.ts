// Даты и деньги: одни и те же правила для всех экранов.

export const MONTHS = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
];

export const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

export const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

/** Дата в формате YYYY-MM-DD по локальному времени. */
export function isoDay(value: Date = new Date()): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function todayISO(): string {
  return isoDay(new Date());
}

/** Разбор YYYY-MM-DD в локальную дату без сдвигов часового пояса. */
export function parseDay(day: string): Date {
  return new Date(`${day}T12:00:00`);
}

export function addDays(day: string, count: number): string {
  const date = parseDay(day);
  if (Number.isNaN(date.getTime())) return day;
  date.setDate(date.getDate() + count);
  return isoDay(date);
}

export function daysBetween(fromDay: string, toDay: string): number {
  const from = parseDay(fromDay);
  const to = parseDay(toDay);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0;
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}

/** «22 октября» — без года, если год текущий. */
export function fmtDate(day?: string, opts: { withYear?: boolean } = {}): string {
  if (!day) return '—';
  const date = parseDay(day.slice(0, 10));
  if (Number.isNaN(date.getTime())) return day;
  const base = `${date.getDate()} ${MONTHS[date.getMonth()]}`;
  const showYear = opts.withYear ?? date.getFullYear() !== new Date().getFullYear();
  return showYear ? `${base} ${date.getFullYear()}` : base;
}

/** «22.10» — компактно для календаря. */
export function fmtDayShort(day: string): string {
  const date = parseDay(day);
  return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function fmtWeekday(day: string): string {
  const date = parseDay(day);
  return WEEKDAYS[(date.getDay() + 6) % 7];
}

export function fmtDateTime(iso?: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  return `${fmtDate(iso.slice(0, 10))} · ${time}`;
}

export function relativeDay(day?: string, today = todayISO()): string {
  if (!day) return 'без срока';
  const diff = daysBetween(today, day);
  if (diff === 0) return 'сегодня';
  if (diff === 1) return 'завтра';
  if (diff === -1) return 'вчера';
  if (diff < 0) return `просрочено на ${Math.abs(diff)} дн.`;
  if (diff <= 7) return `через ${diff} дн.`;
  return fmtDate(day);
}

/** Полная сумма: 285 000 ₽. Основной формат для строк, карточек и документов. */
export function fmtMoney(value?: number): string {
  const amount = Math.round(Number(value) || 0);
  return `${amount.toLocaleString('ru-RU')} ₽`;
}

/** Компактная сумма для воронки, KPI и доски: 285 тыс ₽, 1,2 млн ₽. */
export function fmtMoneyCompact(value?: number): string {
  const amount = Math.round(Number(value) || 0);
  const sign = amount < 0 ? '−' : '';
  const abs = Math.abs(amount);
  if (abs >= 1_000_000) {
    const millions = abs / 1_000_000;
    return `${sign}${millions.toFixed(millions >= 10 ? 0 : 1).replace('.0', '').replace('.', ',')} млн ₽`;
  }
  if (abs >= 1000) return `${sign}${Math.round(abs / 1000)} тыс ₽`;
  return `${sign}${abs.toLocaleString('ru-RU')} ₽`;
}

/** Сумма сделки: пока не заполнена — честно об этом пишем. */
export function fmtMoneyOrEmpty(value?: number): string {
  const amount = Number(value) || 0;
  return amount > 0 ? fmtMoney(amount) : 'сумма не заполнена';
}

/** «9:00–14:00» или пустая строка. */
export function fmtTimeRange(start?: string, end?: string): string {
  if (!start && !end) return '';
  if (start && end) return `${start}–${end}`;
  return start ? `с ${start}` : `до ${end}`;
}

/** Минуты с полуночи из «HH:MM». */
export function minutesOf(time?: string): number | null {
  if (!time) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** Пересекаются ли два интервала времени в один день. */
export function timeRangesOverlap(
  first: { start?: string; end?: string },
  second: { start?: string; end?: string },
): boolean {
  const firstStart = minutesOf(first.start);
  const secondStart = minutesOf(second.start);
  if (firstStart === null || secondStart === null) return true;   // время не задано — считаем, что может пересечься
  const firstEnd = minutesOf(first.end) ?? firstStart + 120;
  const secondEnd = minutesOf(second.end) ?? secondStart + 120;
  return firstStart < secondEnd && secondStart < firstEnd;
}

export function fmtNum(value?: number): string {
  return (Number(value) || 0).toLocaleString('ru-RU');
}

/** Значение для <input type="date">. */
export function dateInput(value?: string): string {
  return value ? value.slice(0, 10) : '';
}

/** «+7 (999) 123-45-67» из любых цифр — для tel: и WhatsApp. */
export function normalizePhone(value?: string): string {
  const digits = (value ?? '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 11 && (digits.startsWith('7') || digits.startsWith('8'))) {
    return `+7 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9, 11)}`;
  }
  if (digits.length === 10) {
    return `+7 (${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 8)}-${digits.slice(8, 10)}`;
  }
  return `+${digits}`;
}

export function telHref(value?: string): string {
  const digits = (value ?? '').replace(/\D/g, '');
  return digits ? `tel:+${digits}` : '';
}

export function digitsOnly(value?: string): string {
  return (value ?? '').replace(/\D/g, '');
}
