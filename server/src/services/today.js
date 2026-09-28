import { uid } from '../ctx.js';
import { db, getSetting } from '../db.js';
import { listTasks } from './tasks.js';
import { freeSlots, freeMinutes, defaultDuration, eveningReview } from './planner.js';
import { todayStr, nowTimeStr, timeToMin, minToTime, humanDuration, addDays, diffDays } from '../util/dates.js';

const ACTIVE = 'inbox,planned,in_progress,paused';

// Сборка экрана «Сегодня»: сейчас / далее / таймлайн / требует внимания / свободное время.
export function getTodayView(date = todayStr()) {
  const isToday = date === todayStr();
  const nowMin = timeToMin(nowTimeStr());

  const withDone = listTasks({ date, status: ACTIVE + ',done' });
  const tasks = withDone.filter(t => t.status !== 'done');

  // Учёт дороги: если у задачи есть место — подсказываем время выезда.
  // Время берётся из справочника мест (locations.travel_min) или из настроек.
  const defaultTravel = Number(getSetting('default_travel_min', '30'));
  const locations = db.prepare('SELECT * FROM locations WHERE user_id = ?').all(uid());
  const travelFor = (t) => {
    const place = t.location_to || t.location || t.location_from;
    if (!place || !t.time) return null;
    if (!['trip', 'delivery', 'meeting', 'event'].includes(t.type)) return null;
    const known = locations.find(l => place.toLowerCase().includes(l.name.toLowerCase()));
    return known?.travel_min ?? defaultTravel;
  };

  const timed = withDone.filter(t => t.time)
    .map(t => {
      const travel = travelFor(t);
      return {
        ...t,
        start_min: timeToMin(t.time),
        end_min: timeToMin(t.time) + defaultDuration(t),
        travel_min: travel,
        departure_time: travel ? minToTime(timeToMin(t.time) - travel) : null,
      };
    })
    .sort((a, b) => a.start_min - b.start_min);
  const untimed = tasks.filter(t => !t.time);

  const activeTimed = timed.filter(t => t.status !== 'done');
  const current = isToday ? activeTimed.find(t => t.start_min <= nowMin && t.end_min > nowMin) || null : null;
  const next = isToday ? activeTimed.find(t => t.start_min > nowMin) || null : activeTimed[0] || null;

  // Таймлайн: блоки + свободные окна
  const workStart = timeToMin(getSetting('work_start', '09:00'));
  const workEnd = timeToMin(getSetting('work_end', '19:00'));
  const timeline = [];
  let cursor = workStart;
  for (const t of timed) {
    if (t.start_min > cursor + 5) {
      timeline.push({ kind: 'free', start: minToTime(cursor), end: minToTime(t.start_min), minutes: t.start_min - cursor });
    }
    timeline.push({ kind: 'task', start: minToTime(t.start_min), end: minToTime(t.end_min), task: t });
    cursor = Math.max(cursor, t.end_min);
  }
  if (cursor < workEnd) {
    timeline.push({ kind: 'free', start: minToTime(cursor), end: minToTime(workEnd), minutes: workEnd - cursor });
  }

  // Требует внимания: просроченные + заблокированные с датой сегодня + давно переносимые
  const overdue = listTasks({ overdue: 1, status: ACTIVE, limit: 20 });
  const attention = [
    ...overdue.map(t => ({ ...t, attention_reason: t.deadline && t.deadline < todayStr() ? 'просрочен дедлайн' : 'просрочена' })),
    ...tasks.filter(t => t.blocked).map(t => ({ ...t, attention_reason: 'зависит от незавершённой задачи' })),
    ...tasks.filter(t => t.postponed_count >= 3 && !t.blocked).map(t => ({ ...t, attention_reason: `переносилась ${t.postponed_count} раз` })),
  ];
  const seen = new Set();
  const attentionUniq = attention.filter(t => !seen.has(t.id) && seen.add(t.id));

  const reminders = db.prepare(
    `SELECT * FROM reminders WHERE user_id = ? AND status = 'pending' AND remind_date <= ? ORDER BY remind_date, remind_time`).all(uid(), date);

  const trips = tasks.filter(t => t.type === 'trip' || t.type === 'delivery');
  const events = tasks.filter(t => ['event', 'meeting'].includes(t.type));
  const route = buildRoute(timed.filter(t => t.status !== 'done'), defaultTravel);

  return {
    date,
    is_today: isToday,
    now_time: nowTimeStr(),
    current, next,
    timed, untimed,
    timeline,
    attention: attentionUniq,
    reminders,
    route,
    silent_projects: silentProjects(),
    free_min: freeMinutes(date, { fromNow: isToday }),
    free_slots: freeSlots(date, { fromNow: isToday }).map(s => ({ start: minToTime(s.start), end: minToTime(s.end), minutes: s.end - s.start })),
    briefing: {
      events_count: events.length,
      tasks_count: tasks.length,
      trips_count: trips.length,
      overdue_count: overdue.length,
      free_human: humanDuration(freeMinutes(date, { fromNow: isToday })),
      top: [...tasks].sort((a, b) => (b.priority - a.priority) || String(a.time || '99').localeCompare(String(b.time || '99')))
        .slice(0, 3).map(t => t.title),
      first: activeTimed[0] ? { time: activeTimed[0].time, title: activeTimed[0].title } : null,
    },
    evening: eveningReview(date),
  };
}

// ---------- Маршрут дня ----------
// Если за день 2+ выезда с адресами — показываем точки по порядку,
// время выезда и ссылку «Открыть в Яндекс.Картах» (параметр rtext).
export function buildRoute(timedTasks, defaultTravel = 30) {
  const TRIP_TYPES = ['trip', 'delivery', 'meeting', 'event', 'work'];
  const points = timedTasks
    .filter(t => TRIP_TYPES.includes(t.type))
    .map(t => ({ task: t, address: (t.location_to || t.location || '').trim() }))
    .filter(p => p.address.length > 2)
    .sort((a, b) => String(a.task.time).localeCompare(String(b.task.time)));

  if (points.length < 2) return null;

  const first = points[0].task;
  const travel = first.travel_min ?? defaultTravel;
  const departure = first.time ? minToTime(Math.max(0, timeToMin(first.time) - travel)) : null;

  return {
    departure_time: departure,
    travel_min: travel,
    points: points.map((p, i) => ({
      order: i + 1,
      task_id: p.task.id,
      title: p.task.title,
      time: p.task.time,
      address: p.address,
      type: p.task.type,
    })),
    // Яндекс.Карты строят маршрут по списку точек через «~»
    yandex_url: 'https://yandex.ru/maps/?rtext=' +
      encodeURIComponent(points.map(p => p.address).join('~')) + '&rtt=auto',
  };
}

// ---------- «Проект молчит» ----------
// Активный проект, по которому 7+ дней нет никакого движения.
export function silentProjects(days = 7) {
  const rows = db.prepare(`
    SELECT p.id, p.name, p.color, p.icon, p.stage, p.updated_at,
      (SELECT MAX(COALESCE(t.completed_at, t.updated_at)) FROM tasks t WHERE t.project_id = p.id) AS last_task_at
    FROM projects p
    WHERE p.user_id = ? AND p.status = 'active'`).all(uid());

  const out = [];
  for (const p of rows) {
    const last = [p.updated_at, p.last_task_at].filter(Boolean).sort().pop();
    if (!last) continue;
    const lastDate = String(last).slice(0, 10);
    const silentDays = diffDays(lastDate, todayStr());
    if (silentDays >= days) {
      out.push({ id: p.id, name: p.name, color: p.color, icon: p.icon, stage: p.stage, days: silentDays, last_activity: lastDate });
    }
  }
  return out.sort((a, b) => b.days - a.days).slice(0, 5);
}

// «Что я забыл?» — эвристический анализ без бессмысленных списков.
export function whatDidIForget() {
  const t = todayStr();
  const items = [];

  const overdue = listTasks({ overdue: 1, status: ACTIVE, limit: 10 });
  for (const task of overdue) {
    items.push({ kind: 'overdue', task, reason: task.deadline && task.deadline < t ? `дедлайн ${task.deadline} прошёл` : `запланирована на ${task.date}, не выполнена` });
  }

  // Задачи, которые постоянно переносятся
  const chronic = db.prepare(`
    SELECT * FROM tasks WHERE user_id = ? AND postponed_count >= 3 AND status NOT IN ('done','cancelled') AND parent_id IS NULL
    ORDER BY postponed_count DESC LIMIT 5`).all(uid());
  for (const task of chronic) {
    items.push({ kind: 'chronic', task, reason: `переносилась уже ${task.postponed_count} раз — возможно, стоит разбить или отменить` });
  }

  // Активные проекты без следующего действия
  const projects = db.prepare(`SELECT * FROM projects WHERE user_id = ? AND status = 'active'`).all(uid());
  for (const p of projects) {
    const open = db.prepare(`
      SELECT COUNT(*) AS c FROM tasks WHERE project_id = ? AND status NOT IN ('done','cancelled')`).get(p.id);
    if (open.c === 0) {
      items.push({ kind: 'project_stalled', project: p, reason: 'нет ни одного следующего действия' });
    }
  }

  // Задачи без движения > 14 дней
  const stale = db.prepare(`
    SELECT * FROM tasks WHERE user_id = ? AND status IN ('inbox','planned') AND parent_id IS NULL
      AND date IS NULL AND deadline IS NULL
      AND updated_at < datetime('now', '-14 days') LIMIT 5`).all(uid());
  for (const task of stale) {
    items.push({ kind: 'stale', task, reason: 'без даты и без движения больше 14 дней' });
  }

  // Старые непривязанные заметки
  const oldNotes = db.prepare(`
    SELECT * FROM notes WHERE user_id = ? AND project_id IS NULL AND task_id IS NULL AND pinned = 0
      AND created_at < datetime('now', '-14 days') ORDER BY id DESC LIMIT 3`).all(uid());
  for (const note of oldNotes) {
    items.push({ kind: 'old_note', note, reason: 'быстрая заметка лежит без дела — превратить в задачу?' });
  }

  // Проекты без движения неделю и больше
  for (const p of silentProjects()) {
    items.push({ kind: 'project_silent', project: p, reason: `по проекту нет движения ${p.days} дн.` });
  }

  // Просроченные паузы проектов
  const pausedDue = db.prepare(`SELECT * FROM projects WHERE user_id = ? AND status = 'paused' AND pause_until IS NOT NULL AND pause_until <= ?`).all(uid(), t);
  for (const p of pausedDue) {
    items.push({ kind: 'pause_over', project: p, reason: `пауза до ${p.pause_until} закончилась — возобновить?` });
  }

  return items;
}
