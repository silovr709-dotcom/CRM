import { Router } from 'express';
import { db } from '../db.js';
import { uid } from '../ctx.js';
import { log } from '../services/activity.js';
import { listTasks } from '../services/tasks.js';

const r = Router();

// Конвейер заказа
export const STAGES = ['Замер', 'Проект', 'Договор', 'Производство', 'Доставка', 'Монтаж', 'Сдано'];

function projectStats(p) {
  const stats = db.prepare(`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done
    FROM tasks WHERE project_id = ?`).get(p.id);
  // Следующее действие: ближайшая незаблокированная незавершённая задача
  const open = listTasks({ project_id: p.id, status: 'inbox,planned,in_progress', include_subtasks: 1 });
  const next = open.find(t => !t.blocked) || null;
  const price = Number(p.price || 0);
  const prepaid = Number(p.prepaid || 0);
  return {
    ...p,
    price: p.price == null ? null : price,
    prepaid: p.prepaid == null ? null : prepaid,
    debt: Math.max(0, price - prepaid),
    contact: p.contact_id
      ? db.prepare('SELECT id, name, phone FROM contacts WHERE id = ? AND user_id = ?').get(p.contact_id, uid()) || null
      : null,
    tasks_total: stats.total || 0,
    tasks_done: stats.done || 0,
    progress: stats.total ? Math.round((stats.done / stats.total) * 100) : 0,
    next_action: next ? { id: next.id, title: next.title, date: next.date, time: next.time, type: next.type } : null,
  };
}

export function loadProject(id) {
  return db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(Number(id), uid());
}

r.get('/', (req, res) => {
  const params = [uid()];
  let where = `WHERE user_id = ? AND status != 'archived'`;
  if (req.query.status) {
    const st = String(req.query.status).split(',');
    where = `WHERE user_id = ? AND status IN (${st.map(() => '?').join(',')})`;
    params.push(...st);
  }
  const rows = db.prepare(`SELECT * FROM projects ${where} ORDER BY status = 'active' DESC, updated_at DESC`).all(...params);
  res.json(rows.map(projectStats));
});

// Сводка по деньгам: сколько клиенты должны всего
r.get('/money/summary', (req, res) => {
  const rows = db.prepare(`
    SELECT COALESCE(SUM(price), 0) AS total_price,
           COALESCE(SUM(prepaid), 0) AS total_prepaid,
           COALESCE(SUM(MAX(0, COALESCE(price,0) - COALESCE(prepaid,0))), 0) AS total_debt
    FROM projects WHERE user_id = ? AND status IN ('active','paused')`).get(uid());
  res.json(rows);
});

r.get('/:id', (req, res) => {
  const p = loadProject(req.params.id);
  if (!p) return res.status(404).json({ error: 'not found' });
  const full = projectStats(p);
  full.tasks = listTasks({ project_id: p.id, include_subtasks: 1 });
  full.notes = db.prepare('SELECT * FROM notes WHERE project_id = ? ORDER BY pinned DESC, id DESC').all(p.id);
  full.reminders = db.prepare("SELECT * FROM reminders WHERE project_id = ? AND status = 'pending'").all(p.id);
  full.history = db.prepare(`
    SELECT a.* FROM activity_log a WHERE a.user_id = ? AND ((a.entity_type = 'project' AND a.entity_id = ?)
      OR (a.entity_type = 'task' AND a.entity_id IN (SELECT id FROM tasks WHERE project_id = ?)))
    ORDER BY a.id DESC LIMIT 50`).all(uid(), p.id, p.id);
  full.stages = STAGES;
  res.json(full);
});

r.post('/', (req, res) => {
  const {
    name, description = '', deadline = null, color = '#4f46e5', icon = '',
    price = null, prepaid = null, stage = null, contact_id = null,
  } = req.body;
  const result = db.prepare(`INSERT INTO projects (name, description, deadline, color, icon, price, prepaid, stage, contact_id, user_id)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(name, description, deadline, color, icon,
      price === '' || price === null ? null : Number(price),
      prepaid === '' || prepaid === null ? null : Number(prepaid),
      stage, contact_id || null, uid());
  const id = Number(result.lastInsertRowid);
  log('project', id, 'created', name);
  res.status(201).json(projectStats(loadProject(id)));
});

r.patch('/:id', (req, res) => {
  const id = Number(req.params.id);
  const p = loadProject(id);
  if (!p) return res.status(404).json({ error: 'not found' });
  const fields = ['name', 'description', 'status', 'deadline', 'color', 'icon', 'pause_until',
    'price', 'prepaid', 'stage', 'contact_id'];
  const sets = [], vals = [];
  for (const f of fields) {
    if (req.body[f] === undefined) continue;
    let v = req.body[f] === '' ? null : req.body[f];
    if ((f === 'price' || f === 'prepaid') && v !== null) v = Number(v);
    sets.push(`${f} = ?`); vals.push(v);
  }
  if (sets.length) {
    sets.push(`updated_at = datetime('now')`);
    db.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).run(...vals, id, uid());
  }
  if (req.body.stage !== undefined && req.body.stage !== p.stage) {
    log('project', id, 'stage', `этап: ${req.body.stage || '—'}`);
  } else if (req.body.status && req.body.status !== p.status) {
    const map = { paused: 'paused', active: 'resumed', done: 'completed', archived: 'updated' };
    log('project', id, map[req.body.status] || 'updated',
      req.body.status === 'paused' && req.body.pause_until ? `до ${req.body.pause_until}` : p.name);
  } else if (sets.length) log('project', id, 'updated', p.name);
  res.json(projectStats(loadProject(id)));
});

r.delete('/:id', (req, res) => {
  const p = loadProject(req.params.id);
  if (p) {
    db.prepare('DELETE FROM projects WHERE id = ? AND user_id = ?').run(p.id, uid());
    log('project', p.id, 'deleted', p.name);
  }
  res.json({ ok: true });
});

export default r;
