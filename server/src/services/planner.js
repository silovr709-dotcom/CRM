import { getSetting } from '../db.js';
import { listTasks, updateTask } from './tasks.js';
import { timeToMin, minToTime, todayStr, nowTimeStr, humanDuration, addDays, humanDate } from '../util/dates.js';

const ACTIVE = 'inbox,planned,in_progress,paused';

function defaultDuration(t) {
  if (t.duration_min) return t.duration_min;
  const map = { trip: 40, purchase: 30, call: 15, meeting: 60, event: 60, work: 120, delivery: 60 };
  return map[t.type] || 30;
}

// Занятые интервалы дня (задачи с временем)
export function busyIntervals(date) {
  const tasks = listTasks({ date, status: ACTIVE }).filter(t => t.time);
  return tasks
    .map(t => ({ start: timeToMin(t.time), end: timeToMin(t.time) + defaultDuration(t), task: t }))
    .sort((a, b) => a.start - b.start);
}

// Свободные окна между work_start и work_end
export function freeSlots(date, { fromNow = false } = {}) {
  const workStart = timeToMin(getSetting('work_start', '09:00'));
  const workEnd = timeToMin(getSetting('work_end', '19:00'));
  let cursor = workStart;
  if (fromNow && date === todayStr()) cursor = Math.max(cursor, timeToMin(nowTimeStr()));
  const slots = [];
  for (const b of busyIntervals(date)) {
    if (b.start > cursor) slots.push({ start: cursor, end: Math.min(b.start, workEnd) });
    cursor = Math.max(cursor, b.end);
  }
  if (cursor < workEnd) slots.push({ start: cursor, end: workEnd });
  return slots.filter(s => s.end - s.start >= 10);
}

export function freeMinutes(date, opts) {
  return freeSlots(date, opts).reduce((acc, s) => acc + (s.end - s.start), 0);
}

// «Распланировать мой день»: гибкие задачи раскладываются по свободным окнам.
// Не заполняем больше plan_fill_ratio свободного времени, оставляем буферы.
export function planDay(date = todayStr()) {
  const buffer = Number(getSetting('plan_buffer_min', '15'));
  const fillRatio = Number(getSetting('plan_fill_ratio', '0.8'));

  const all = listTasks({ status: ACTIVE });
  const fixed = all.filter(t => t.date === date && t.time);
  // Кандидаты: гибкие задачи на эту дату без времени + задачи с дедлайном <= date + просроченные
  const candidates = all.filter(t =>
    !t.time && t.status !== 'paused' && !t.blocked &&
    ((t.date === date) ||
     (!t.date && t.deadline && t.deadline <= addDays(date, 2)) ||
     (t.date && t.date < date)) // просроченные
  ).sort((a, b) => {
    const pa = (b.priority - a.priority);
    if (pa) return pa;
    const da = a.deadline || '9999', dbb = b.deadline || '9999';
    if (da !== dbb) return da < dbb ? -1 : 1;
    return (a.date || '9999') < (b.date || '9999') ? -1 : 1;
  });

  const slots = freeSlots(date, { fromNow: true }).map(s => ({ ...s }));
  const totalFree = slots.reduce((a, s) => a + (s.end - s.start), 0);
  const budget = Math.floor(totalFree * fillRatio);

  const placed = [];
  const unplaced = [];
  let used = 0;
  for (const t of candidates) {
    const dur = defaultDuration(t);
    if (used + dur > budget) { unplaced.push(t); continue; }
    const slot = slots.find(s => s.end - s.start >= dur);
    if (!slot) { unplaced.push(t); continue; }
    const start = slot.start;
    placed.push({
      task_id: t.id, title: t.title, type: t.type,
      date, time: minToTime(start), duration_min: dur,
      was: { date: t.date, time: t.time },
      overdue: !!(t.date && t.date < date),
    });
    slot.start = start + dur + buffer;
    used += dur;
    if (slot.end - slot.start < 10) slots.splice(slots.indexOf(slot), 1);
  }

  const reserve = totalFree - used;
  return {
    date,
    fixed: fixed.map(t => ({ id: t.id, title: t.title, time: t.time, duration_min: defaultDuration(t), type: t.type })),
    placed,
    unplaced: unplaced.map(t => ({ id: t.id, title: t.title, type: t.type, duration_min: defaultDuration(t) })),
    total_free_min: totalFree,
    reserve_min: reserve,
    summary: placed.length
      ? `Предлагаю распределить ${placed.length} задач(и). Останется резерв ${humanDuration(reserve)}.` +
        (unplaced.length ? ` Не поместилось: ${unplaced.length} — можно перенести на другой день.` : '')
      : totalFree < 30
        ? 'Свободного времени почти не осталось — планировать нечего.'
        : 'Нет гибких задач для планирования на этот день.',
  };
}

export function applyPlan(placed) {
  const applied = [];
  for (const p of placed) {
    const t = updateTask(p.task_id, { date: p.date, time: p.time, duration_min: p.duration_min });
    if (t) applied.push(t);
  }
  return applied;
}

// «Разгрузить мой день»: находим, что можно перенести/сократить. Только предложения.
export function unloadDay(date = todayStr()) {
  const tasks = listTasks({ date, status: ACTIVE });
  const suggestions = [];
  for (const t of tasks) {
    const dur = defaultDuration(t);
    if (t.schedule_mode === 'fixed') continue;
    if (t.priority === 0 && (!t.deadline || t.deadline > addDays(date, 3))) {
      suggestions.push({
        task_id: t.id, title: t.title,
        action: 'move', to_date: addDays(date, 1),
        reason: 'необязательная задача без близкого дедлайна',
      });
    } else if (dur >= 180) {
      suggestions.push({
        task_id: t.id, title: t.title,
        action: 'split',
        reason: `длинный блок (${humanDuration(dur)}) — можно разбить на части`,
      });
    }
  }
  // Похожие задачи (покупки) — объединить
  const purchases = tasks.filter(t => t.type === 'purchase');
  if (purchases.length > 1) {
    suggestions.push({
      action: 'merge',
      task_ids: purchases.map(t => t.id),
      title: purchases.map(t => t.title).join(' + '),
      reason: 'несколько покупок можно объединить в одну поездку',
    });
  }
  const free = freeMinutes(date, { fromNow: true });
  return {
    date,
    suggestions,
    summary: suggestions.length
      ? `Нашёл ${suggestions.length} предложений. Свободно сейчас: ${humanDuration(free)}. Ничего не меняю без подтверждения.`
      : 'День выглядит сбалансированно — разгружать нечего.',
  };
}

// Вечерний разбор: что переносим на завтра
export function eveningReview(date = todayStr()) {
  const tasks = listTasks({ date, include_subtasks: 1 });
  const done = tasks.filter(t => t.status === 'done');
  const moved = tasks.filter(t => t.postponed_count > 0 && t.status !== 'done');
  const undone = tasks.filter(t => !['done', 'cancelled'].includes(t.status));
  return {
    date,
    done_count: done.length,
    moved_count: moved.length,
    undone: undone.map(t => ({ id: t.id, title: t.title, type: t.type, time: t.time })),
    suggestion: undone.length ? `Перенести ${undone.length} невыполненных задач(и) на завтра?` : 'Все задачи закрыты. Отличный день!',
  };
}

export { defaultDuration };
