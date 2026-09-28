// Утилиты дат. Даты храним строками 'YYYY-MM-DD', время — 'HH:MM'.

export function pad(n) { return String(n).padStart(2, '0'); }

export function toDateStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayStr() { return toDateStr(new Date()); }

export function nowTimeStr() {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(dateStr, n) {
  const d = parseDate(dateStr);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

export function isWeekend(dateStr) {
  const wd = parseDate(dateStr).getDay();
  return wd === 0 || wd === 6;
}

// Добавить n рабочих дней (пн–пт)
export function addWorkdays(dateStr, n) {
  let cur = dateStr;
  let left = Math.abs(n);
  const step = n >= 0 ? 1 : -1;
  while (left > 0) {
    cur = addDays(cur, step);
    if (!isWeekend(cur)) left--;
  }
  return cur;
}

export function timeToMin(t) {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}

export function minToTime(min) {
  min = Math.max(0, Math.min(24 * 60 - 1, Math.round(min)));
  return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
}

export function diffDays(a, b) {
  return Math.round((parseDate(b) - parseDate(a)) / 86400000);
}

const WEEKDAYS_RU = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const WEEKDAYS_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const MONTHS_RU = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

export function humanDate(dateStr, { withWeekday = true } = {}) {
  const t = todayStr();
  if (dateStr === t) return 'сегодня';
  if (dateStr === addDays(t, 1)) return 'завтра';
  if (dateStr === addDays(t, -1)) return 'вчера';
  const d = parseDate(dateStr);
  const base = `${d.getDate()} ${MONTHS_RU[d.getMonth()]}`;
  return withWeekday ? `${base} (${WEEKDAYS_SHORT[d.getDay()]})` : base;
}

export function weekdayName(dateStr) {
  return WEEKDAYS_RU[parseDate(dateStr).getDay()];
}

export function humanDuration(min) {
  if (min == null) return '';
  const h = Math.floor(min / 60), m = min % 60;
  if (h && m) return `${h} ч ${m} мин`;
  if (h) return `${h} ч`;
  return `${m} мин`;
}

// nextWeekday: ближайшая дата с данным днём недели (0=вс..6=сб), не сегодня
export function nextWeekday(fromStr, weekday, includeToday = false) {
  let cur = includeToday ? fromStr : addDays(fromStr, 1);
  for (let i = 0; i < 8; i++) {
    if (parseDate(cur).getDay() === weekday) return cur;
    cur = addDays(cur, 1);
  }
  return cur;
}
