// Разбор естественного языка (RU): фраза → план из отдельных действий
// с типами, датами, временем, длительностью и зависимостями.
// Всегда возвращает ПРЕДЛОЖЕНИЕ — создание задач происходит только после подтверждения.

import { todayStr, addDays, nextWeekday, minToTime, timeToMin, humanDate, humanDuration } from '../../util/dates.js';
import { getSetting } from '../../db.js';

const norm = (s) => s.toLowerCase().replace(/ё/g, 'е');

// В JS `\b` и `\w` не понимают кириллицу — используем собственные аналоги.
const W = '[0-9a-zа-яё_]';
const B = `(?:(?<!${W})(?=${W})|(?<=${W})(?!${W}))`;
const fix = (src) => src.replace(/\\b/g, B).replace(/\\w/g, W);
export const R = (re) => new RegExp(fix(re.source), re.flags);
const RS = (src, flags = '') => new RegExp(fix(src), flags);

// --- Типы по глаголам (порядок = приоритет при равной позиции) ---
const TYPE_PATTERNS = [
  { re: R(/\b(отвез|отвес[тз]|привез|достав|завез)\w*/), type: 'delivery' },
  { re: R(/\b(съезд|заех|заед|поех|поед|доех|доед|сгоня|заскоч|выехать|съезж)\w*/), type: 'trip' },
  { re: R(/\b(куп|закуп|докуп)\w*/), type: 'purchase' },
  { re: R(/\b(позвон|набрать|набер|созвон|обзвон|звонок)\w*/), type: 'call' },
  { re: R(/\b(встреч|встрет|замер|прием|презентац|показать)\w*/), type: 'meeting' },
  { re: R(/\b(додел|доработ|поработ|подготов|написа|сверста|законч|сда(ть|ча))\w*/), type: 'work' },
  { re: R(/\b(забра|забер)\w*/), type: 'task' },
  { re: R(/\b(оплат|заплат)\w*/), type: 'task' },
];

const DEFAULT_DURATION = { trip: 40, delivery: 60, purchase: 30, call: 15, meeting: 60, work: 120, task: 30, event: 60, personal: 30, reminder: 5 };

const PERSONAL_HINTS = R(/\b(посылк|продукт|собак|кошк|корм|мам|пап|аптек|врач|парикмахер|спортзал|домой|интернет)\w*/);

const WEEKDAYS = [
  [R(/\bв\s+воскресень\w+/), 0], [R(/\bв\s+понедельник\w*/), 1], [R(/\bво?\s+вторник\w*/), 2],
  [R(/\bв\s+сред[уе]\w*/), 3], [R(/\bв\s+четверг\w*/), 4], [R(/\bв\s+пятниц\w+/), 5], [R(/\bв\s+суббот\w+/), 6],
];

const DOW_WORDS = ['воскресень', 'понедельник', 'вторник', 'сред', 'четверг', 'пятниц', 'суббот'];

const RECUR_PATTERNS = [
  { re: R(/\bежедневн\w+|\bкаждый день\b/), rule: { freq: 'daily' } },
  { re: R(/\bпо будням\b/), rule: { freq: 'weekdays' } },
  { re: R(/\bеженедельн\w+|\bкаждую неделю\b/), rule: { freq: 'weekly' } },
  { re: R(/\bежемесячн\w+|\bкаждый месяц\b/), rule: { freq: 'monthly' } },
  { re: R(/\bежегодн\w+|\bкаждый год\b/), rule: { freq: 'yearly' } },
  { re: R(/\bкаждые\s+(\d+)\s+дн\w+/), rule: (m) => ({ freq: 'every_n_days', interval: Number(m[1]) }) },
  {
    re: R(/\bкажд(?:ый|ую|ое)\s+(воскресень|понедельник|вторник|сред|четверг|пятниц|суббот)\w*/),
    rule: (m) => ({ freq: 'days_of_week', days: [DOW_WORDS.indexOf(m[1])] }),
  },
];

// --- Дата из текста ---
export function extractDate(text, base = todayStr()) {
  const s = norm(text);
  let m;
  if ((m = s.match(R(/\bпослезавтра\b/)))) return { date: addDays(base, 2), matched: m[0] };
  if ((m = s.match(R(/\bзавтра\b/)))) return { date: addDays(base, 1), matched: m[0] };
  if ((m = s.match(R(/\bсегодня\b/)))) return { date: base, matched: m[0] };
  for (const [re, wd] of WEEKDAYS) {
    m = s.match(re);
    if (m) return { date: nextWeekday(base, wd), matched: m[0] };
  }
  m = s.match(R(/\bчерез\s+(\d+)\s*(день|дня|дней)\b/));
  if (m) return { date: addDays(base, Number(m[1])), matched: m[0] };
  m = s.match(R(/\bчерез\s+(\d+)\s*недел\w+/));
  if (m) return { date: addDays(base, 7 * Number(m[1])), matched: m[0] };
  m = s.match(R(/\bчерез\s+недел\w+/));
  if (m) return { date: addDays(base, 7), matched: m[0] };
  m = s.match(R(/\bчерез\s+месяц\b/));
  if (m) return { date: addDays(base, 30), matched: m[0] };
  m = s.match(R(/\b(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?\b/));
  if (m) {
    const y = m[3] ? (m[3].length === 2 ? '20' + m[3] : m[3]) : base.slice(0, 4);
    const mk = (yy) => `${yy}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
    const date = mk(y);
    return { date: date >= base ? date : mk(Number(y) + 1), matched: m[0] };
  }
  const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  m = s.match(RS(`\\b(\\d{1,2})\\s+(${months.join('|')})`));
  if (m) {
    const mm = String(months.indexOf(m[2]) + 1).padStart(2, '0');
    let date = `${base.slice(0, 4)}-${mm}-${String(m[1]).padStart(2, '0')}`;
    if (date < base) date = `${Number(base.slice(0, 4)) + 1}-${mm}-${String(m[1]).padStart(2, '0')}`;
    return { date, matched: m[0] };
  }
  return null;
}

// --- Время из текста ---
function extractTime(s) {
  let m = s.match(R(/\b(?:в|к)\s+(\d{1,2})[:.](\d{2})\b/));
  if (m) return { time: `${String(m[1]).padStart(2, '0')}:${m[2]}`, matched: m[0] };
  m = s.match(R(/\b(?:в|к)\s+(\d{1,2})(?:\s*час(?:а|ов)?)?(?:\s+(утра|вечера|дня|ночи))?\b/));
  if (m) {
    let h = Number(m[1]);
    if (h > 23) return null;
    const suffix = m[2];
    if (suffix === 'вечера' && h < 12) h += 12;
    if (suffix === 'дня' && h < 11) h += 12;
    if (!suffix && !/час/.test(m[0]) && h >= 1 && h <= 7) h += 12; // «в 5» → 17:00 (рабочая эвристика)
    return { time: `${String(h).padStart(2, '0')}:00`, matched: m[0] };
  }
  return null;
}

function extractDuration(s) {
  if (R(/\bполчаса\b/).test(s)) return { min: 30, matched: s.match(R(/\bполчаса\b/))[0] };
  let m = s.match(R(/\b(?:на|около|примерно)\s+(\d+(?:[.,]5)?)\s*час(?:а|ов)?\b/));
  if (m) return { min: Math.round(parseFloat(m[1].replace(',', '.')) * 60), matched: m[0] };
  m = s.match(R(/\b(\d+(?:[.,]5)?)\s*час(?:а|ов)?\b/));
  if (m && !R(/\b(?:в|к)\s+\d{1,2}\s*час/).test(s)) return { min: Math.round(parseFloat(m[1].replace(',', '.')) * 60), matched: m[0] };
  m = s.match(R(/\b(?:на\s+)?(\d+)\s*мин(?:ут)?\w*\b/));
  if (m) return { min: Number(m[1]), matched: m[0] };
  return null;
}

const DAYPART = [
  { re: R(/\bс\s+утра\b|\bутром\b|\bутра\b/), start: '09:00', name: 'утром' },
  { re: R(/\bдо обеда\b/), start: '10:00', name: 'до обеда' },
  { re: R(/\bв обед\b|\bднем\b/), start: '13:00', name: 'днём' },
  { re: R(/\bпосле обеда\b/), start: '14:00', name: 'после обеда' },
  { re: R(/\bвечером\b|\bпод вечер\b|\bк вечеру\b/), start: '18:00', name: 'вечером' },
  { re: R(/\bночью\b/), start: '22:00', name: 'ночью' },
];

// --- Разбиение на действия ---
const SEQ_SEPARATORS = RS(
  '(?:,\\s*(?:а\\s+)?потом\\s+|,\\s*затем\\s+|\\bпосле\\s+этого\\s+|\\bпосле\\s+чего\\s+|,\\s*а\\s+|,\\s*и\\s+|,\\s*|\\s+потом\\s+|\\s+затем\\s+)'
);

const ACTION_EXTRA = R(/\b(не забыть|не забудь|напомни|запиш|отправ|провер|уточн|узна|отда(ть|л)|сходить|сходи|записаться|оплатить|разгруз|погруз|собрать|смонтир|установ|съезд|забрать|забер|сделать)\w*/);

function hasActionVerb(s) {
  return TYPE_PATTERNS.some(p => p.re.test(s)) || ACTION_EXTRA.test(s);
}

function detectType(s) {
  let best = null;
  for (const p of TYPE_PATTERNS) {
    const m = s.match(p.re);
    if (m && (best === null || m.index < best.index)) best = { index: m.index, type: p.type };
  }
  let type = best ? best.type : 'task';
  if (type === 'task' && PERSONAL_HINTS.test(s)) type = 'personal';
  return type;
}

const STRIP_WORDS = R(/\b(завтра|сегодня|послезавтра|с утра|утром|днем|вечером|в обед|после обеда|до обеда|ночью|надо|нужно|необходимо|обязательно|еще)\b/g);
const LEAD_JUNK = R(/^\s*(и|а|но|еще|также)\s+/);

function cleanTitle(original, removed = []) {
  let t = ' ' + original + ' ';
  for (const r of removed) {
    if (r) t = t.replace(new RegExp(r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), ' ');
  }
  t = t
    .replace(STRIP_WORDS, ' ')
    .replace(LEAD_JUNK, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[,.\s-]+|[,.\s]+$/g, '');
  if (!t) t = original.trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

const REMINDER_RE = R(/\b(не забыть бы|не забыть|не забудь|напомни(?:ть)?(?:\s+мне)?)\s*(?:о том,? чтобы|про|о|об)?\s*/);

// Главная функция: текст → план
export function parsePhrase(text, base = todayStr()) {
  const s = norm(text);
  const assumptions = [];
  const questions = [];

  const globalDate = extractDate(s, base);
  const defaultDate = globalDate ? globalDate.date : base;
  if (!globalDate) assumptions.push('Дата не указана — беру сегодня.');

  let recurrence = null;
  let recurMatched = null;
  let recurStart = null;
  for (const rp of RECUR_PATTERNS) {
    const m = s.match(rp.re);
    if (m) {
      recurrence = typeof rp.rule === 'function' ? rp.rule(m) : rp.rule;
      recurMatched = m[0];
      if (recurrence.freq === 'days_of_week' && recurrence.days?.length) {
        recurStart = nextWeekday(base, recurrence.days[0], true);
      } else if (recurrence.freq === 'weekdays') {
        let d = base;
        while ([0, 6].includes(new Date(d).getDay())) d = addDays(d, 1);
        recurStart = d;
      } else recurStart = base;
      break;
    }
  }

  const rawParts = s.split(SEQ_SEPARATORS)
    .flatMap(p => p.split(R(/\s+и\s+/))) // «… и не забыть купить корм»
    .map(p => p.trim()).filter(Boolean);
  const parts = [];
  for (const p of rawParts) {
    if (!parts.length) { parts.push(p); continue; }
    if (hasActionVerb(p)) parts.push(p);
    else parts[parts.length - 1] += ', ' + p; // «фасады, стекла и ручки» — дополнение, не действие
  }

  let cursor = null; // конец предыдущего действия, минуты
  let currentDate = recurStart || base; // дата «переносится» по цепочке сегментов
  const items = [];

  for (const partRaw of parts) {
    let part = partRaw;
    const removed = [];

    // Напоминание?
    const remM = part.match(REMINDER_RE);
    const isReminder = Boolean(remM);
    if (remM) part = part.replace(REMINDER_RE, ' ');

    // Повторение: убрать из заголовка, дата = первое вхождение
    if (recurMatched && part.includes(recurMatched)) removed.push(recurMatched);

    // Дата сегмента: применяется к нему и последующим («завтра …, потом …»)
    const localDate = extractDate(part, base);
    if (localDate) { currentDate = localDate.date; removed.push(localDate.matched); cursor = null; }
    const date = currentDate;

    // Часть дня
    let daypart = null;
    for (const dp of DAYPART) {
      const m = part.match(dp.re);
      if (m) { daypart = dp; removed.push(m[0]); break; }
    }

    // Точное время
    const timeM = extractTime(part);
    if (timeM) removed.push(timeM.matched);

    // Длительность
    const dur = extractDuration(part);
    if (dur) removed.push(dur.matched);

    const type = isReminder && !hasActionVerb(part) ? 'reminder' : detectType(part);
    const duration = (dur && dur.min) || DEFAULT_DURATION[type] || 30;

    // Время: явное > часть дня > продолжение цепочки
    let time = null;
    let depends = false;
    const prev = items[items.length - 1];
    const sameDay = !prev || prev.date === date;

    if (timeM) {
      time = timeM.time;
      cursor = timeToMin(time) + duration;
      if (prev && sameDay) depends = true;
    } else if (daypart) {
      const start = timeToMin(daypart.start);
      const from = cursor !== null && sameDay && cursor > start ? cursor + 10 : start;
      time = minToTime(from);
      cursor = timeToMin(time) + duration;
      if (prev && sameDay) depends = true;
    } else if (cursor !== null && sameDay && prev) {
      time = minToTime(cursor + 10);
      cursor = timeToMin(time) + duration;
      depends = true;
    } else if (prev && sameDay && ['trip', 'delivery'].includes(type)) {
      depends = true; // «забрать … → отвезти …» — цепочка и без времени
    }

    const title = cleanTitle(part, removed);
    if (!title || title.length < 2) continue;

    items.push({
      title,
      type,
      date,
      time,
      duration_min: duration,
      depends_on_prev: depends && items.length > 0,
      is_reminder: isReminder,
      recurrence: recurrence || null,
      schedule_mode: timeM ? 'fixed' : 'flexible',
    });
  }

  // Уточнения — только необходимые
  for (const it of items) {
    if ((it.type === 'trip' || it.type === 'delivery') && !R(/\b(на|в|до|к)\s+\S+/).test(norm(it.title))) {
      questions.push(`Куда ехать: «${it.title}»?`);
    }
  }

  const planDate = items[0]?.date || defaultDate;
  const totalMin = items.reduce((a, it) => a + it.duration_min, 0);
  const summary = items.length
    ? `Вижу ${items.length} действ${items.length === 1 ? 'ие' : items.length < 5 ? 'ия' : 'ий'} на ${humanDate(planDate)}. ` +
      `Суммарно примерно ${humanDuration(totalMin)}.` +
      (items.some(x => x.depends_on_prev) ? ' Действия связаны в цепочку.' : '') +
      ' Создать план?'
    : 'Не смог выделить действия из фразы. Попробуйте переформулировать.';

  return { kind: 'plan', date: planDate, items, assumptions, questions, summary };
}
