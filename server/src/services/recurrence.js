import { addDays, parseDate, todayStr } from '../util/dates.js';

// rule: { freq: 'daily'|'weekdays'|'weekly'|'monthly'|'yearly'|'every_n_days'|'days_of_week',
//         interval?: number, days?: number[] (0=вс..6=сб), until?: 'YYYY-MM-DD' }
export function nextOccurrence(rule, fromDateStr) {
  if (!rule || !rule.freq) return null;
  const from = fromDateStr || todayStr();
  let next = null;
  switch (rule.freq) {
    case 'daily':
      next = addDays(from, 1); break;
    case 'every_n_days':
      next = addDays(from, Math.max(1, rule.interval || 1)); break;
    case 'weekdays': {
      let cur = addDays(from, 1);
      while ([0, 6].includes(parseDate(cur).getDay())) cur = addDays(cur, 1);
      next = cur; break;
    }
    case 'weekly':
      next = addDays(from, 7 * Math.max(1, rule.interval || 1)); break;
    case 'days_of_week': {
      const days = (rule.days || []).slice().sort();
      if (!days.length) return null;
      let cur = addDays(from, 1);
      for (let i = 0; i < 8; i++) {
        if (days.includes(parseDate(cur).getDay())) { next = cur; break; }
        cur = addDays(cur, 1);
      }
      break;
    }
    case 'monthly': {
      const d = parseDate(from);
      d.setMonth(d.getMonth() + Math.max(1, rule.interval || 1));
      next = d.toISOString().slice(0, 10); break;
    }
    case 'yearly': {
      const d = parseDate(from);
      d.setFullYear(d.getFullYear() + 1);
      next = d.toISOString().slice(0, 10); break;
    }
    default: return null;
  }
  if (next && rule.until && next > rule.until) return null;
  return next;
}

export function describeRecurrence(rule) {
  if (!rule || !rule.freq) return '';
  const names = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  switch (rule.freq) {
    case 'daily': return 'ежедневно';
    case 'weekdays': return 'по будням';
    case 'weekly': return 'еженедельно';
    case 'monthly': return 'ежемесячно';
    case 'yearly': return 'ежегодно';
    case 'every_n_days': return `каждые ${rule.interval || 1} дн.`;
    case 'days_of_week': return 'по: ' + (rule.days || []).map(d => names[d]).join(', ');
    default: return '';
  }
}
