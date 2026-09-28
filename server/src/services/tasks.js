import { db } from '../db.js';
import { uid } from '../ctx.js';
import { log } from './activity.js';
import { nextOccurrence } from './recurrence.js';
import { runAutomations } from './automations.js';
import { todayStr, nowTimeStr, humanDate } from '../util/dates.js';

const TASK_FIELDS = [
  'title', 'description', 'type', 'status', 'priority', 'schedule_mode',
  'date', 'time', 'duration_min', 'deadline', 'project_id', 'category_id',
  'contact_id', 'parent_id', 'location', 'location_from', 'location_to',
  'recurrence', 'extra'
];

function rowToTask(row) {
  if (!row) return null;
  return {
    ...row,
    recurrence: row.recurrence ? JSON.parse(row.recurrence) : null,
    extra: row.extra ? JSON.parse(row.extra) : null,
  };
}

export function attachMeta(tasks) {
  if (!tasks.length) return tasks;
  const ids = tasks.map(t => t.id);
  const ph = ids.map(() => '?').join(',');
  const deps = db.prepare(`
    SELECT d.task_id, d.depends_on_id, d.kind, t.title AS dep_title, t.status AS dep_status
    FROM task_dependencies d JOIN tasks t ON t.id = d.depends_on_id
    WHERE d.task_id IN (${ph})`).all(...ids);
  const subs = db.prepare(`
    SELECT parent_id, COUNT(*) AS total, SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) AS done
    FROM tasks WHERE parent_id IN (${ph}) GROUP BY parent_id`).all(...ids);
  const projIds = [...new Set(tasks.map(t => t.project_id).filter(Boolean))];
  const projects = projIds.length
    ? db.prepare(`SELECT id, name, color FROM projects WHERE user_id = ? AND id IN (${projIds.map(() => '?').join(',')})`).all(uid(), ...projIds)
    : [];
  const catIds = [...new Set(tasks.map(t => t.category_id).filter(Boolean))];
  const cats = catIds.length
    ? db.prepare(`SELECT id, name, color, icon FROM categories WHERE user_id = ? AND id IN (${catIds.map(() => '?').join(',')})`).all(uid(), ...catIds)
    : [];
  const pMap = Object.fromEntries(projects.map(p => [p.id, p]));
  const cMap = Object.fromEntries(cats.map(c => [c.id, c]));
  for (const t of tasks) {
    t.dependencies = deps.filter(d => d.task_id === t.id);
    t.blocked = t.dependencies.some(d => d.kind !== 'with' && d.dep_status !== 'done' && d.dep_status !== 'cancelled');
    const s = subs.find(x => x.parent_id === t.id);
    t.subtasks_total = s ? s.total : 0;
    t.subtasks_done = s ? s.done : 0;
    t.project = t.project_id ? pMap[t.project_id] || null : null;
    t.category = t.category_id ? cMap[t.category_id] || null : null;
  }
  return tasks;
}

export function listTasks(filters = {}) {
  const where = ['user_id = ?'];
  const params = [uid()];
  if (filters.date) { where.push('date = ?'); params.push(filters.date); }
  if (filters.from) { where.push('date >= ?'); params.push(filters.from); }
  if (filters.to) { where.push('date <= ?'); params.push(filters.to); }
  if (filters.status) {
    const st = String(filters.status).split(',');
    where.push(`status IN (${st.map(() => '?').join(',')})`);
    params.push(...st);
  }
  if (filters.type) { where.push('type = ?'); params.push(filters.type); }
  if (filters.project_id) { where.push('project_id = ?'); params.push(Number(filters.project_id)); }
  if (filters.category_id) { where.push('category_id = ?'); params.push(Number(filters.category_id)); }
  if (filters.contact_id || (filters.project_ids && filters.project_ids.length)) {
    const parts = [];
    if (filters.contact_id) { parts.push('contact_id = ?'); params.push(Number(filters.contact_id)); }
    if (filters.project_ids?.length) {
      parts.push(`project_id IN (${filters.project_ids.map(() => '?').join(',')})`);
      params.push(...filters.project_ids.map(Number));
    }
    where.push(parts.join(' OR '));
  }
  if (filters.search) {
    where.push('(nlower(title) LIKE nlower(?) OR nlower(description) LIKE nlower(?))');
    params.push(`%${filters.search}%`, `%${filters.search}%`);
  }
  if (filters.tag) {
    // теги вида #замер — ищем как подстроку (кириллица корректно через nlower)
    where.push('nlower(title) LIKE nlower(?)');
    params.push(`%#${String(filters.tag).replace(/^#/, '')}%`);
  }
  if (filters.overdue) {
    where.push(`status NOT IN ('done','cancelled') AND (
      (date IS NOT NULL AND date < ?) OR (deadline IS NOT NULL AND deadline < ?)
    )`);
    params.push(todayStr(), todayStr());
  }
  if (filters.inbox) {
    where.push(`status = 'inbox' OR (date IS NULL AND deadline IS NULL AND status NOT IN ('done','cancelled'))`);
  }
  if (!filters.include_subtasks) where.push('parent_id IS NULL');

  let sql = 'SELECT * FROM tasks';
  if (where.length) sql += ' WHERE ' + where.map(w => `(${w})`).join(' AND ');
  sql += ` ORDER BY
    CASE WHEN date IS NULL THEN 1 ELSE 0 END, date,
    CASE WHEN time IS NULL THEN 1 ELSE 0 END, time,
    priority DESC, id`;
  if (filters.limit) sql += ` LIMIT ${Number(filters.limit)}`;
  const rows = db.prepare(sql).all(...params).map(rowToTask);
  return attachMeta(rows);
}

export function getTask(id) {
  const row = rowToTask(db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').get(Number(id), uid()));
  if (!row) return null;
  attachMeta([row]);
  row.subtasks = attachMeta(
    db.prepare('SELECT * FROM tasks WHERE parent_id = ? ORDER BY id').all(row.id).map(rowToTask));
  row.dependents = db.prepare(`
    SELECT d.task_id AS id, t.title, t.status FROM task_dependencies d
    JOIN tasks t ON t.id = d.task_id WHERE d.depends_on_id = ?`).all(row.id);
  row.notes = db.prepare('SELECT * FROM notes WHERE task_id = ? ORDER BY id DESC').all(row.id);
  row.reminders = db.prepare('SELECT * FROM reminders WHERE task_id = ? ORDER BY remind_date, remind_time').all(row.id);
  row.contact = row.contact_id
    ? db.prepare('SELECT * FROM contacts WHERE id = ? AND user_id = ?').get(row.contact_id, uid()) : null;
  return row;
}

function serializeValue(field, value) {
  if (value === undefined) return undefined;
  if (value === '') value = null;
  if ((field === 'recurrence' || field === 'extra') && value != null && typeof value === 'object') {
    return JSON.stringify(value);
  }
  return value;
}

export function createTask(data, { silent = false } = {}) {
  const cols = [];
  const vals = [];
  for (const f of TASK_FIELDS) {
    const v = serializeValue(f, data[f]);
    if (v !== undefined) { cols.push(f); vals.push(v); }
  }
  if (!cols.includes('title')) throw new Error('title is required');
  cols.push('user_id'); vals.push(uid());
  const res = db.prepare(
    `INSERT INTO tasks (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...vals);
  const id = Number(res.lastInsertRowid);

  if (Array.isArray(data.depends_on)) {
    for (const depId of data.depends_on) addDependency(id, depId, 'after');
  }
  if (Array.isArray(data.reminders)) {
    for (const r of data.reminders) {
      db.prepare('INSERT INTO reminders (title, remind_date, remind_time, task_id, user_id) VALUES (?, ?, ?, ?, ?)')
        .run(r.title || data.title, r.remind_date, r.remind_time || null, id, uid());
    }
  }
  if (!silent) log('task', id, 'created', data.title);
  const task = getTask(id);
  runAutomations('task_created', task);
  return task;
}

export function updateTask(id, patch) {
  const existing = db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').get(Number(id), uid());
  if (!existing) return null;

  const sets = [];
  const vals = [];
  for (const f of TASK_FIELDS) {
    if (patch[f] !== undefined) {
      sets.push(`${f} = ?`);
      vals.push(serializeValue(f, patch[f]));
    }
  }
  const rescheduled =
    (patch.date !== undefined && patch.date !== existing.date) ||
    (patch.time !== undefined && patch.time !== existing.time);
  if (rescheduled && existing.date && patch.date && patch.date !== existing.date) {
    sets.push('postponed_count = postponed_count + 1');
  }
  if (sets.length) {
    sets.push(`updated_at = datetime('now')`);
    db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...vals, Number(id));
  }

  if (Array.isArray(patch.depends_on)) {
    db.prepare('DELETE FROM task_dependencies WHERE task_id = ?').run(Number(id));
    for (const depId of patch.depends_on) addDependency(Number(id), depId, 'after');
  }

  if (rescheduled) {
    log('task', id, 'rescheduled',
      `${existing.date || '—'} ${existing.time || ''} → ${patch.date ?? existing.date ?? '—'} ${patch.time ?? existing.time ?? ''}`.trim());
  } else if (sets.length) {
    log('task', id, 'updated', patch.title && patch.title !== existing.title ? `«${patch.title}»` : '');
  }
  return getTask(id);
}

export function setStatus(id, status) {
  const t = db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').get(Number(id), uid());
  if (!t) return null;
  if (status === 'done') return completeTask(id);
  db.prepare(`UPDATE tasks SET status = ?, completed_at = NULL, updated_at = datetime('now') WHERE id = ?`)
    .run(status, Number(id));
  const actions = { cancelled: 'cancelled', paused: 'paused', in_progress: 'started', planned: t.status === 'done' ? 'reopened' : 'resumed', inbox: 'updated' };
  log('task', id, actions[status] || 'updated', t.title);
  return getTask(id);
}

export function completeTask(id) {
  const t = rowToTask(db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').get(Number(id), uid()));
  if (!t) return null;
  db.prepare(`UPDATE tasks SET status = 'done', completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
    .run(Number(id));
  log('task', id, 'completed', t.title);

  const followups = [];

  // 1. Повторение → следующее вхождение
  if (t.recurrence) {
    const nd = nextOccurrence(t.recurrence, t.date || todayStr());
    if (nd) {
      const clone = { ...t };
      delete clone.id;
      const next = createTask({
        ...clone, date: nd, status: 'planned', completed_at: null,
        recurrence: t.recurrence,
      }, { silent: true });
      log('task', next.id, 'created', `повторение «${t.title}» → ${humanDate(nd)}`);
      followups.push({ kind: 'recurrence', task: next });
    }
  }

  // 2. Автоматизации
  const created = runAutomations('task_completed', t);
  followups.push(...created);

  // 3. Разблокированные задачи (для интерфейса)
  const unblocked = db.prepare(`
    SELECT t2.id, t2.title FROM task_dependencies d
    JOIN tasks t2 ON t2.id = d.task_id
    WHERE d.depends_on_id = ? AND t2.status NOT IN ('done','cancelled')`).all(Number(id))
    .filter(u => {
      const others = db.prepare(`
        SELECT COUNT(*) AS c FROM task_dependencies d
        JOIN tasks dt ON dt.id = d.depends_on_id
        WHERE d.task_id = ? AND d.depends_on_id != ? AND dt.status NOT IN ('done','cancelled')`)
        .get(u.id, Number(id));
      return others.c === 0;
    });

  return { task: getTask(id), followups, unblocked };
}

export function deleteTask(id) {
  const t = db.prepare('SELECT title FROM tasks WHERE id = ? AND user_id = ?').get(Number(id), uid());
  if (!t) return false;
  db.prepare('DELETE FROM tasks WHERE id = ?').run(Number(id));
  log('task', id, 'deleted', t.title);
  return true;
}

export function addDependency(taskId, dependsOnId, kind = 'after') {
  if (Number(taskId) === Number(dependsOnId)) return;
  db.prepare('INSERT OR IGNORE INTO task_dependencies (task_id, depends_on_id, kind) VALUES (?, ?, ?)')
    .run(Number(taskId), Number(dependsOnId), kind);
}

export function removeDependency(taskId, dependsOnId) {
  db.prepare('DELETE FROM task_dependencies WHERE task_id = ? AND depends_on_id = ?')
    .run(Number(taskId), Number(dependsOnId));
}

export function findTaskByTitle(fragment) {
  const rows = db.prepare(`
    SELECT * FROM tasks WHERE user_id = ? AND status NOT IN ('done','cancelled') AND nlower(title) LIKE nlower(?)
    ORDER BY CASE WHEN date IS NULL THEN 1 ELSE 0 END, date LIMIT 5`)
    .all(uid(), `%${fragment}%`).map(rowToTask);
  return attachMeta(rows);
}
