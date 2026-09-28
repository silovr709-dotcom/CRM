import { Router } from 'express';
import { db } from '../db.js';
import { log } from '../services/activity.js';
import { listTasks } from '../services/tasks.js';

const r = Router();

function projectStats(p) {
  const stats = db.prepare(`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done
    FROM tasks WHERE project_id = ?`).get(p.id);
  // Следующее действие: ближайшая незаблокированная незавершённая задача
  const open = listTasks({ project_id: p.id, status: 'inbox,planned,in_progress', include_subtasks: 1 });
  const next = open.find(t => !t.blocked) || null;
  return {
    ...p,
    tasks_total: stats.total || 0,
    tasks_done: stats.done || 0,
    progress: stats.total ? Math.round((stats.done / stats.total) * 100) : 0,
    next_action: next ? { id: next.id, title: next.title, date: next.date, time: next.time, type: next.type } : null,
  };
}

r.get('/', (req, res) => {
  const where = req.query.status ? `WHERE status IN (${req.query.status.split(',').map(() => '?').join(',')})` : `WHERE status != 'archived'`;
  const params = req.query.status ? req.query.status.split(',') : [];
  const rows = db.prepare(`SELECT * FROM projects ${where} ORDER BY status = 'active' DESC, updated_at DESC`).all(...params);
  res.json(rows.map(projectStats));
});

r.get('/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(Number(req.params.id));
  if (!p) return res.status(404).json({ error: 'not found' });
  const full = projectStats(p);
  full.tasks = listTasks({ project_id: p.id, include_subtasks: 1 });
  full.notes = db.prepare('SELECT * FROM notes WHERE project_id = ? ORDER BY pinned DESC, id DESC').all(p.id);
  full.reminders = db.prepare("SELECT * FROM reminders WHERE project_id = ? AND status = 'pending'").all(p.id);
  full.history = db.prepare(`
    SELECT a.* FROM activity_log a WHERE (a.entity_type = 'project' AND a.entity_id = ?)
      OR (a.entity_type = 'task' AND a.entity_id IN (SELECT id FROM tasks WHERE project_id = ?))
    ORDER BY a.id DESC LIMIT 50`).all(p.id, p.id);
  res.json(full);
});

r.post('/', (req, res) => {
  const { name, description = '', deadline = null, color = '#4f46e5', icon = '' } = req.body;
  const result = db.prepare('INSERT INTO projects (name, description, deadline, color, icon) VALUES (?, ?, ?, ?, ?)')
    .run(name, description, deadline, color, icon);
  const id = Number(result.lastInsertRowid);
  log('project', id, 'created', name);
  res.status(201).json(projectStats(db.prepare('SELECT * FROM projects WHERE id = ?').get(id)));
});

r.patch('/:id', (req, res) => {
  const id = Number(req.params.id);
  const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  if (!p) return res.status(404).json({ error: 'not found' });
  const fields = ['name', 'description', 'status', 'deadline', 'color', 'icon', 'pause_until'];
  const sets = [], vals = [];
  for (const f of fields) if (req.body[f] !== undefined) { sets.push(`${f} = ?`); vals.push(req.body[f] === '' ? null : req.body[f]); }
  if (sets.length) {
    sets.push(`updated_at = datetime('now')`);
    db.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
  }
  if (req.body.status && req.body.status !== p.status) {
    const map = { paused: 'paused', active: 'resumed', done: 'completed', archived: 'updated' };
    log('project', id, map[req.body.status] || 'updated',
      req.body.status === 'paused' && req.body.pause_until ? `до ${req.body.pause_until}` : p.name);
  } else if (sets.length) log('project', id, 'updated', p.name);
  res.json(projectStats(db.prepare('SELECT * FROM projects WHERE id = ?').get(id)));
});

r.delete('/:id', (req, res) => {
  const p = db.prepare('SELECT name FROM projects WHERE id = ?').get(Number(req.params.id));
  db.prepare('DELETE FROM projects WHERE id = ?').run(Number(req.params.id));
  if (p) log('project', Number(req.params.id), 'deleted', p.name);
  res.json({ ok: true });
});

export default r;
