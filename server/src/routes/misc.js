import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { join, extname } from 'node:path';
import { db, dataDir, getSetting, setSetting, allSettings } from '../db.js';
import { uid } from '../ctx.js';
import { log, getActivity } from '../services/activity.js';
import { instantiateTemplate } from '../services/templates.js';
import { listTasks } from '../services/tasks.js';
import { extractTags } from '../util/tags.js';

const filesDir = join(dataDir, 'files');
mkdirSync(filesDir, { recursive: true });

const r = Router();

// ---------- Вложения (файлы) ----------
r.get('/attachments', (req, res) => {
  const where = ['user_id = ?'], params = [uid()];
  if (req.query.task_id) { where.push('task_id = ?'); params.push(Number(req.query.task_id)); }
  if (req.query.project_id) { where.push('project_id = ?'); params.push(Number(req.query.project_id)); }
  if (req.query.note_id) { where.push('note_id = ?'); params.push(Number(req.query.note_id)); }
  res.json(db.prepare(`SELECT id, filename, mime, size, task_id, project_id, note_id, created_at FROM attachments
    WHERE ${where.join(' AND ')} ORDER BY id DESC`).all(...params));
});

r.post('/attachments', (req, res) => {
  const { filename, data, mime = 'application/octet-stream', task_id = null, project_id = null, note_id = null } = req.body;
  if (!filename || !data) return res.status(400).json({ error: 'filename and data (base64) required' });
  const buf = Buffer.from(data, 'base64');
  if (buf.length > 15 * 1024 * 1024) return res.status(413).json({ error: 'файл больше 15 МБ' });
  const stored = randomBytes(10).toString('hex') + extname(filename).slice(0, 10);
  writeFileSync(join(filesDir, stored), buf);
  const result = db.prepare(
    'INSERT INTO attachments (filename, mime, size, stored_name, task_id, project_id, note_id, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(filename, mime, buf.length, stored, task_id, project_id, note_id, uid());
  const id = Number(result.lastInsertRowid);
  log('attachment', id, 'created', filename);
  res.status(201).json(db.prepare('SELECT id, filename, mime, size, created_at FROM attachments WHERE id = ?').get(id));
});

r.get('/attachments/:id/download', (req, res) => {
  const a = db.prepare('SELECT * FROM attachments WHERE id = ? AND user_id = ?').get(Number(req.params.id), uid());
  if (!a) return res.status(404).json({ error: 'not found' });
  res.setHeader('Content-Type', a.mime);
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(a.filename)}`);
  res.sendFile(join(filesDir, a.stored_name));
});

r.delete('/attachments/:id', (req, res) => {
  const a = db.prepare('SELECT * FROM attachments WHERE id = ? AND user_id = ?').get(Number(req.params.id), uid());
  if (a) {
    try { unlinkSync(join(filesDir, a.stored_name)); } catch { /* уже нет */ }
    db.prepare('DELETE FROM attachments WHERE id = ?').run(a.id);
  }
  res.json({ ok: true });
});

// ---------- Заметки ----------
r.get('/notes', (req, res) => {
  const where = ['n.user_id = ?'], params = [uid()];
  if (req.query.project_id) { where.push('n.project_id = ?'); params.push(Number(req.query.project_id)); }
  if (req.query.task_id) { where.push('n.task_id = ?'); params.push(Number(req.query.task_id)); }
  if (req.query.contact_id) { where.push('n.contact_id = ?'); params.push(Number(req.query.contact_id)); }
  if (req.query.search) {
    where.push('(nlower(n.title) LIKE nlower(?) OR nlower(n.content) LIKE nlower(?))');
    params.push(`%${req.query.search}%`, `%${req.query.search}%`);
  }
  const sql = `SELECT n.*, p.name AS project_name, t.title AS task_title
    FROM notes n LEFT JOIN projects p ON p.id = n.project_id LEFT JOIN tasks t ON t.id = n.task_id
    WHERE ${where.join(' AND ')} ORDER BY n.pinned DESC, n.id DESC`;
  res.json(db.prepare(sql).all(...params));
});
r.post('/notes', (req, res) => {
  const { title = '', content = '', project_id = null, task_id = null, contact_id = null, category_id = null, pinned = 0 } = req.body;
  const result = db.prepare(
    'INSERT INTO notes (title, content, project_id, task_id, contact_id, category_id, pinned, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(title, content, project_id, task_id, contact_id, category_id, pinned ? 1 : 0, uid());
  const id = Number(result.lastInsertRowid);
  log('note', id, 'created', title || content.slice(0, 60));
  res.status(201).json(db.prepare('SELECT * FROM notes WHERE id = ?').get(id));
});
r.patch('/notes/:id', (req, res) => {
  const id = Number(req.params.id);
  const fields = ['title', 'content', 'project_id', 'task_id', 'contact_id', 'category_id', 'pinned'];
  const sets = [], vals = [];
  for (const f of fields) if (req.body[f] !== undefined) { sets.push(`${f} = ?`); vals.push(req.body[f] === '' ? null : req.body[f]); }
  if (sets.length) {
    sets.push(`updated_at = datetime('now')`);
    db.prepare(`UPDATE notes SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).run(...vals, id, uid());
    log('note', id, 'updated');
  }
  res.json(db.prepare('SELECT * FROM notes WHERE id = ? AND user_id = ?').get(id, uid()));
});
r.delete('/notes/:id', (req, res) => {
  db.prepare('DELETE FROM notes WHERE id = ? AND user_id = ?').run(Number(req.params.id), uid());
  res.json({ ok: true });
});

// ---------- Напоминания ----------
r.get('/reminders', (req, res) => {
  const extra = req.query.all ? '' : ` AND status = 'pending'`;
  res.json(db.prepare(`SELECT * FROM reminders WHERE user_id = ?${extra} ORDER BY remind_date, remind_time`).all(uid()));
});
r.post('/reminders', (req, res) => {
  const { title, remind_date, remind_time = null, task_id = null, note_id = null, project_id = null } = req.body;
  const result = db.prepare(
    'INSERT INTO reminders (title, remind_date, remind_time, task_id, note_id, project_id, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(title, remind_date, remind_time, task_id, note_id, project_id, uid());
  const id = Number(result.lastInsertRowid);
  log('reminder', id, 'created', `${title} — ${remind_date}`);
  res.status(201).json(db.prepare('SELECT * FROM reminders WHERE id = ?').get(id));
});
r.patch('/reminders/:id', (req, res) => {
  const id = Number(req.params.id);
  const fields = ['title', 'remind_date', 'remind_time', 'status'];
  const sets = [], vals = [];
  for (const f of fields) if (req.body[f] !== undefined) { sets.push(`${f} = ?`); vals.push(req.body[f]); }
  if (sets.length) db.prepare(`UPDATE reminders SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).run(...vals, id, uid());
  res.json(db.prepare('SELECT * FROM reminders WHERE id = ? AND user_id = ?').get(id, uid()));
});

// «💤 Через час» — отложить напоминание
r.post('/reminders/:id/snooze', (req, res) => {
  const id = Number(req.params.id);
  const minutes = Number(req.body.minutes || 60);
  const rem = db.prepare('SELECT * FROM reminders WHERE id = ? AND user_id = ?').get(id, uid());
  if (!rem) return res.status(404).json({ error: 'not found' });
  const base = new Date();
  base.setMinutes(base.getMinutes() + minutes);
  const date = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(base.getDate()).padStart(2, '0')}`;
  const time = `${String(base.getHours()).padStart(2, '0')}:${String(base.getMinutes()).padStart(2, '0')}`;
  db.prepare(`UPDATE reminders SET remind_date = ?, remind_time = ?, status = 'pending', notified_at = NULL WHERE id = ?`)
    .run(date, time, id);
  log('reminder', id, 'updated', `отложено на ${minutes} мин → ${date} ${time}`);
  res.json(db.prepare('SELECT * FROM reminders WHERE id = ?').get(id));
});

r.delete('/reminders/:id', (req, res) => {
  db.prepare('DELETE FROM reminders WHERE id = ? AND user_id = ?').run(Number(req.params.id), uid());
  res.json({ ok: true });
});

// ---------- Категории ----------
r.get('/categories', (req, res) =>
  res.json(db.prepare('SELECT * FROM categories WHERE user_id = ? ORDER BY builtin DESC, name').all(uid())));
r.post('/categories', (req, res) => {
  const { name, color = '#6b7280', icon = '' } = req.body;
  const result = db.prepare('INSERT INTO categories (name, color, icon, user_id) VALUES (?, ?, ?, ?)').run(name, color, icon, uid());
  res.status(201).json(db.prepare('SELECT * FROM categories WHERE id = ?').get(Number(result.lastInsertRowid)));
});
r.patch('/categories/:id', (req, res) => {
  const { name, color, icon } = req.body;
  const id = Number(req.params.id);
  const own = db.prepare('SELECT id FROM categories WHERE id = ? AND user_id = ?').get(id, uid());
  if (!own) return res.status(404).json({ error: 'not found' });
  if (name !== undefined) db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(name, id);
  if (color !== undefined) db.prepare('UPDATE categories SET color = ? WHERE id = ?').run(color, id);
  if (icon !== undefined) db.prepare('UPDATE categories SET icon = ? WHERE id = ?').run(icon, id);
  res.json(db.prepare('SELECT * FROM categories WHERE id = ?').get(id));
});
r.delete('/categories/:id', (req, res) => {
  db.prepare('DELETE FROM categories WHERE id = ? AND user_id = ? AND builtin = 0').run(Number(req.params.id), uid());
  res.json({ ok: true });
});

// ---------- Контакты и клиенты ----------
r.get('/contacts', (req, res) => {
  const rows = db.prepare('SELECT * FROM contacts WHERE user_id = ? ORDER BY name').all(uid());
  // краткая статистика для списка клиентов
  const stats = db.prepare(`
    SELECT contact_id,
           COUNT(*) AS projects_count,
           COALESCE(SUM(MAX(0, COALESCE(price,0) - COALESCE(prepaid,0))), 0) AS debt
    FROM projects WHERE user_id = ? AND contact_id IS NOT NULL AND status != 'archived'
    GROUP BY contact_id`).all(uid());
  const open = db.prepare(`
    SELECT contact_id, COUNT(*) AS c FROM tasks
    WHERE user_id = ? AND contact_id IS NOT NULL AND status NOT IN ('done','cancelled')
    GROUP BY contact_id`).all(uid());
  res.json(rows.map(c => ({
    ...c,
    projects_count: stats.find(s => s.contact_id === c.id)?.projects_count ?? 0,
    debt: stats.find(s => s.contact_id === c.id)?.debt ?? 0,
    open_tasks: open.find(o => o.contact_id === c.id)?.c ?? 0,
  })));
});

// Карточка клиента целиком: задачи, проекты, заметки, файлы, долг
r.get('/contacts/:id/full', (req, res) => {
  const id = Number(req.params.id);
  const c = db.prepare('SELECT * FROM contacts WHERE id = ? AND user_id = ?').get(id, uid());
  if (!c) return res.status(404).json({ error: 'not found' });

  const projects = db.prepare(`
    SELECT * FROM projects WHERE user_id = ? AND contact_id = ? ORDER BY status = 'active' DESC, updated_at DESC`)
    .all(uid(), id).map(p => {
      const st = db.prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) AS done
                             FROM tasks WHERE project_id = ?`).get(p.id);
      return {
        ...p,
        tasks_total: st.total || 0,
        tasks_done: st.done || 0,
        progress: st.total ? Math.round((st.done / st.total) * 100) : 0,
        debt: Math.max(0, Number(p.price || 0) - Number(p.prepaid || 0)),
      };
    });

  const projectIds = projects.map(p => p.id);
  const ph = projectIds.map(() => '?').join(',');
  const tasks = listTasks({ contact_id: id, project_ids: projectIds, status: 'inbox,planned,in_progress,paused,done', limit: 200 });

  const notes = db.prepare(`SELECT * FROM notes WHERE user_id = ? AND (contact_id = ?${ph ? ` OR project_id IN (${ph})` : ''})
                            ORDER BY pinned DESC, id DESC`).all(uid(), id, ...projectIds);
  const files = ph
    ? db.prepare(`SELECT id, filename, mime, size, created_at FROM attachments
                  WHERE user_id = ? AND project_id IN (${ph}) ORDER BY id DESC`).all(uid(), ...projectIds)
    : [];

  const debt = projects
    .filter(p => p.status !== 'archived')
    .reduce((sum, p) => sum + p.debt, 0);

  res.json({
    ...c,
    projects,
    tasks,
    notes,
    files,
    debt,
    total_price: projects.reduce((s, p) => s + Number(p.price || 0), 0),
    total_paid: projects.reduce((s, p) => s + Number(p.prepaid || 0), 0),
  });
});

r.post('/contacts', (req, res) => {
  const { name, phone = '', email = '', address = '', notes = '' } = req.body;
  const result = db.prepare('INSERT INTO contacts (name, phone, email, address, notes, user_id) VALUES (?, ?, ?, ?, ?, ?)')
    .run(name, phone, email, address, notes, uid());
  const id = Number(result.lastInsertRowid);
  log('contact', id, 'created', name);
  res.status(201).json(db.prepare('SELECT * FROM contacts WHERE id = ?').get(id));
});
r.patch('/contacts/:id', (req, res) => {
  const id = Number(req.params.id);
  const fields = ['name', 'phone', 'email', 'address', 'notes'];
  const sets = [], vals = [];
  for (const f of fields) if (req.body[f] !== undefined) { sets.push(`${f} = ?`); vals.push(req.body[f]); }
  if (sets.length) db.prepare(`UPDATE contacts SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).run(...vals, id, uid());
  res.json(db.prepare('SELECT * FROM contacts WHERE id = ? AND user_id = ?').get(id, uid()));
});
r.delete('/contacts/:id', (req, res) => {
  db.prepare('DELETE FROM contacts WHERE id = ? AND user_id = ?').run(Number(req.params.id), uid());
  res.json({ ok: true });
});

// ---------- Глобальный поиск ----------
// Русский регистр: SQLite lower() кириллицу не знает, поэтому nlower() из db.js.
r.get('/search', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ tasks: [], projects: [], notes: [], query: q });
  const like = `%${q}%`;
  const tasks = db.prepare(`
    SELECT id, title, type, status, date, time, project_id FROM tasks
    WHERE user_id = ? AND (nlower(title) LIKE nlower(?) OR nlower(description) LIKE nlower(?))
    ORDER BY status IN ('done','cancelled'), date IS NULL, date DESC LIMIT 12`).all(uid(), like, like);
  const projects = db.prepare(`
    SELECT id, name, status, color, icon, price, prepaid, stage FROM projects
    WHERE user_id = ? AND (nlower(name) LIKE nlower(?) OR nlower(description) LIKE nlower(?))
    ORDER BY status = 'active' DESC, updated_at DESC LIMIT 8`).all(uid(), like, like);
  const notes = db.prepare(`
    SELECT id, title, content, project_id FROM notes
    WHERE user_id = ? AND (nlower(title) LIKE nlower(?) OR nlower(content) LIKE nlower(?))
    ORDER BY pinned DESC, id DESC LIMIT 8`).all(uid(), like, like);
  const contacts = db.prepare(`
    SELECT id, name, phone FROM contacts
    WHERE user_id = ? AND (nlower(name) LIKE nlower(?) OR phone LIKE ?)
    ORDER BY name LIMIT 6`).all(uid(), like, like);
  res.json({ query: q, tasks, projects, notes, contacts });
});

// ---------- Теги #из_названий ----------
r.get('/tags', (req, res) => {
  const rows = db.prepare(`SELECT title FROM tasks WHERE user_id = ? AND status NOT IN ('done','cancelled')`).all(uid());
  const counts = new Map();
  for (const row of rows) {
    for (const tag of extractTags(row.title)) counts.set(tag, (counts.get(tag) || 0) + 1);
  }
  res.json([...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count));
});

// ---------- Шаблоны ----------
r.get('/templates', (req, res) => {
  const templates = db.prepare('SELECT * FROM templates WHERE user_id = ? ORDER BY builtin DESC, name').all(uid());
  const ids = templates.map(t => t.id);
  const steps = ids.length
    ? db.prepare(`SELECT * FROM template_steps WHERE template_id IN (${ids.map(() => '?').join(',')}) ORDER BY template_id, ord`).all(...ids)
    : [];
  res.json(templates.map(t => ({ ...t, steps: steps.filter(s => s.template_id === t.id) })));
});
r.post('/templates', (req, res) => {
  const { name, description = '', steps = [] } = req.body;
  const result = db.prepare('INSERT INTO templates (name, description, user_id) VALUES (?, ?, ?)').run(name, description, uid());
  const id = Number(result.lastInsertRowid);
  const ins = db.prepare('INSERT INTO template_steps (template_id, ord, title, type, offset_days, workdays, duration_min, depends_prev) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  steps.forEach((s, i) => ins.run(id, i, s.title, s.type || 'task', s.offset_days || 0, s.workdays ? 1 : 0, s.duration_min || null, s.depends_prev === false ? 0 : 1));
  log('template', id, 'created', name);
  res.status(201).json({ id, name, description });
});
r.delete('/templates/:id', (req, res) => {
  db.prepare('DELETE FROM templates WHERE id = ? AND user_id = ?').run(Number(req.params.id), uid());
  res.json({ ok: true });
});
r.post('/templates/:id/instantiate', (req, res) => {
  const created = instantiateTemplate(req.params.id, {
    startDate: req.body.start_date,
    projectId: req.body.project_id,
    contextTitle: req.body.context_title,
    contactId: req.body.contact_id,
    categoryId: req.body.category_id,
  });
  res.status(201).json({ created });
});

// ---------- Автоматизации ----------
r.get('/automations', (req, res) => {
  res.json(db.prepare('SELECT * FROM automations WHERE user_id = ? ORDER BY id DESC').all(uid()).map(a => ({
    ...a,
    conditions: JSON.parse(a.conditions || '{}'),
    action_params: JSON.parse(a.action_params || '{}'),
  })));
});
r.post('/automations', (req, res) => {
  const { name, trigger_type = 'task_completed', conditions = {}, action_type = 'create_task', action_params = {}, enabled = 1 } = req.body;
  const result = db.prepare(
    'INSERT INTO automations (name, enabled, trigger_type, conditions, action_type, action_params, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(name, enabled ? 1 : 0, trigger_type, JSON.stringify(conditions), action_type, JSON.stringify(action_params), uid());
  const id = Number(result.lastInsertRowid);
  log('automation', id, 'created', name);
  res.status(201).json({ id });
});
r.patch('/automations/:id', (req, res) => {
  const id = Number(req.params.id);
  const own = db.prepare('SELECT id FROM automations WHERE id = ? AND user_id = ?').get(id, uid());
  if (!own) return res.status(404).json({ error: 'not found' });
  if (req.body.enabled !== undefined) db.prepare('UPDATE automations SET enabled = ? WHERE id = ?').run(req.body.enabled ? 1 : 0, id);
  if (req.body.name !== undefined) db.prepare('UPDATE automations SET name = ? WHERE id = ?').run(req.body.name, id);
  if (req.body.conditions !== undefined) db.prepare('UPDATE automations SET conditions = ? WHERE id = ?').run(JSON.stringify(req.body.conditions), id);
  if (req.body.action_params !== undefined) db.prepare('UPDATE automations SET action_params = ? WHERE id = ?').run(JSON.stringify(req.body.action_params), id);
  res.json({ ok: true });
});
r.delete('/automations/:id', (req, res) => {
  db.prepare('DELETE FROM automations WHERE id = ? AND user_id = ?').run(Number(req.params.id), uid());
  res.json({ ok: true });
});

// ---------- История ----------
r.get('/activity', (req, res) => res.json(getActivity(req.query)));

// ---------- Настройки ----------
const SECRET_KEYS = new Set(['telegram_token']);
r.get('/settings', (req, res) => {
  const all = allSettings();
  for (const k of SECRET_KEYS) delete all[k]; // секреты наружу не отдаём
  res.json(all);
});
r.put('/settings', (req, res) => {
  for (const [k, v] of Object.entries(req.body)) setSetting(k, v);
  res.json({ ok: true });
});

export default r;
