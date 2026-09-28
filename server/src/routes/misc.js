import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { db, getSetting, setSetting } from '../db.js';
import { log, getActivity } from '../services/activity.js';
import { instantiateTemplate } from '../services/templates.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const filesDir = join(__dirname, '..', '..', 'data', 'files');
mkdirSync(filesDir, { recursive: true });

const r = Router();

// ---------- Вложения (файлы) ----------
r.get('/attachments', (req, res) => {
  const where = [], params = [];
  if (req.query.task_id) { where.push('task_id = ?'); params.push(Number(req.query.task_id)); }
  if (req.query.project_id) { where.push('project_id = ?'); params.push(Number(req.query.project_id)); }
  if (req.query.note_id) { where.push('note_id = ?'); params.push(Number(req.query.note_id)); }
  res.json(db.prepare(`SELECT id, filename, mime, size, task_id, project_id, note_id, created_at FROM attachments
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC`).all(...params));
});

r.post('/attachments', (req, res) => {
  const { filename, data, mime = 'application/octet-stream', task_id = null, project_id = null, note_id = null } = req.body;
  if (!filename || !data) return res.status(400).json({ error: 'filename and data (base64) required' });
  const buf = Buffer.from(data, 'base64');
  if (buf.length > 15 * 1024 * 1024) return res.status(413).json({ error: 'файл больше 15 МБ' });
  const stored = randomBytes(10).toString('hex') + extname(filename).slice(0, 10);
  writeFileSync(join(filesDir, stored), buf);
  const result = db.prepare(
    'INSERT INTO attachments (filename, mime, size, stored_name, task_id, project_id, note_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(filename, mime, buf.length, stored, task_id, project_id, note_id);
  const id = Number(result.lastInsertRowid);
  log('attachment', id, 'created', filename);
  res.status(201).json(db.prepare('SELECT id, filename, mime, size, created_at FROM attachments WHERE id = ?').get(id));
});

r.get('/attachments/:id/download', (req, res) => {
  const a = db.prepare('SELECT * FROM attachments WHERE id = ?').get(Number(req.params.id));
  if (!a) return res.status(404).json({ error: 'not found' });
  res.setHeader('Content-Type', a.mime);
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(a.filename)}`);
  res.sendFile(join(filesDir, a.stored_name));
});

r.delete('/attachments/:id', (req, res) => {
  const a = db.prepare('SELECT * FROM attachments WHERE id = ?').get(Number(req.params.id));
  if (a) {
    try { unlinkSync(join(filesDir, a.stored_name)); } catch { /* уже нет */ }
    db.prepare('DELETE FROM attachments WHERE id = ?').run(a.id);
  }
  res.json({ ok: true });
});

// ---------- Заметки ----------
r.get('/notes', (req, res) => {
  const where = [], params = [];
  if (req.query.project_id) { where.push('project_id = ?'); params.push(Number(req.query.project_id)); }
  if (req.query.task_id) { where.push('task_id = ?'); params.push(Number(req.query.task_id)); }
  if (req.query.search) { where.push('(nlower(title) LIKE nlower(?) OR nlower(content) LIKE nlower(?))'); params.push(`%${req.query.search}%`, `%${req.query.search}%`); }
  const sql = `SELECT n.*, p.name AS project_name, t.title AS task_title
    FROM notes n LEFT JOIN projects p ON p.id = n.project_id LEFT JOIN tasks t ON t.id = n.task_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY n.pinned DESC, n.id DESC`;
  res.json(db.prepare(sql).all(...params));
});
r.post('/notes', (req, res) => {
  const { title = '', content = '', project_id = null, task_id = null, contact_id = null, category_id = null, pinned = 0 } = req.body;
  const result = db.prepare(
    'INSERT INTO notes (title, content, project_id, task_id, contact_id, category_id, pinned) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(title, content, project_id, task_id, contact_id, category_id, pinned ? 1 : 0);
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
    db.prepare(`UPDATE notes SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
    log('note', id, 'updated');
  }
  res.json(db.prepare('SELECT * FROM notes WHERE id = ?').get(id));
});
r.delete('/notes/:id', (req, res) => {
  db.prepare('DELETE FROM notes WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// ---------- Напоминания ----------
r.get('/reminders', (req, res) => {
  const pending = req.query.all ? '' : `WHERE status = 'pending'`;
  res.json(db.prepare(`SELECT * FROM reminders ${pending} ORDER BY remind_date, remind_time`).all());
});
r.post('/reminders', (req, res) => {
  const { title, remind_date, remind_time = null, task_id = null, note_id = null, project_id = null } = req.body;
  const result = db.prepare(
    'INSERT INTO reminders (title, remind_date, remind_time, task_id, note_id, project_id) VALUES (?, ?, ?, ?, ?, ?)')
    .run(title, remind_date, remind_time, task_id, note_id, project_id);
  const id = Number(result.lastInsertRowid);
  log('reminder', id, 'created', `${title} — ${remind_date}`);
  res.status(201).json(db.prepare('SELECT * FROM reminders WHERE id = ?').get(id));
});
r.patch('/reminders/:id', (req, res) => {
  const id = Number(req.params.id);
  const fields = ['title', 'remind_date', 'remind_time', 'status'];
  const sets = [], vals = [];
  for (const f of fields) if (req.body[f] !== undefined) { sets.push(`${f} = ?`); vals.push(req.body[f]); }
  if (sets.length) db.prepare(`UPDATE reminders SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
  res.json(db.prepare('SELECT * FROM reminders WHERE id = ?').get(id));
});
r.delete('/reminders/:id', (req, res) => {
  db.prepare('DELETE FROM reminders WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// ---------- Категории ----------
r.get('/categories', (req, res) => res.json(db.prepare('SELECT * FROM categories ORDER BY builtin DESC, name').all()));
r.post('/categories', (req, res) => {
  const { name, color = '#6b7280', icon = '' } = req.body;
  const result = db.prepare('INSERT INTO categories (name, color, icon) VALUES (?, ?, ?)').run(name, color, icon);
  res.status(201).json(db.prepare('SELECT * FROM categories WHERE id = ?').get(Number(result.lastInsertRowid)));
});
r.patch('/categories/:id', (req, res) => {
  const { name, color, icon } = req.body;
  const id = Number(req.params.id);
  if (name !== undefined) db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(name, id);
  if (color !== undefined) db.prepare('UPDATE categories SET color = ? WHERE id = ?').run(color, id);
  if (icon !== undefined) db.prepare('UPDATE categories SET icon = ? WHERE id = ?').run(icon, id);
  res.json(db.prepare('SELECT * FROM categories WHERE id = ?').get(id));
});
r.delete('/categories/:id', (req, res) => {
  db.prepare('DELETE FROM categories WHERE id = ? AND builtin = 0').run(Number(req.params.id));
  res.json({ ok: true });
});

// ---------- Контакты ----------
r.get('/contacts', (req, res) => res.json(db.prepare('SELECT * FROM contacts ORDER BY name').all()));
r.post('/contacts', (req, res) => {
  const { name, phone = '', email = '', address = '', notes = '' } = req.body;
  const result = db.prepare('INSERT INTO contacts (name, phone, email, address, notes) VALUES (?, ?, ?, ?, ?)')
    .run(name, phone, email, address, notes);
  const id = Number(result.lastInsertRowid);
  log('contact', id, 'created', name);
  res.status(201).json(db.prepare('SELECT * FROM contacts WHERE id = ?').get(id));
});
r.patch('/contacts/:id', (req, res) => {
  const id = Number(req.params.id);
  const fields = ['name', 'phone', 'email', 'address', 'notes'];
  const sets = [], vals = [];
  for (const f of fields) if (req.body[f] !== undefined) { sets.push(`${f} = ?`); vals.push(req.body[f]); }
  if (sets.length) db.prepare(`UPDATE contacts SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
  res.json(db.prepare('SELECT * FROM contacts WHERE id = ?').get(id));
});
r.delete('/contacts/:id', (req, res) => {
  db.prepare('DELETE FROM contacts WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// ---------- Шаблоны ----------
r.get('/templates', (req, res) => {
  const templates = db.prepare('SELECT * FROM templates ORDER BY builtin DESC, name').all();
  const steps = db.prepare('SELECT * FROM template_steps ORDER BY template_id, ord').all();
  res.json(templates.map(t => ({ ...t, steps: steps.filter(s => s.template_id === t.id) })));
});
r.post('/templates', (req, res) => {
  const { name, description = '', steps = [] } = req.body;
  const result = db.prepare('INSERT INTO templates (name, description) VALUES (?, ?)').run(name, description);
  const id = Number(result.lastInsertRowid);
  const ins = db.prepare('INSERT INTO template_steps (template_id, ord, title, type, offset_days, workdays, duration_min, depends_prev) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  steps.forEach((s, i) => ins.run(id, i, s.title, s.type || 'task', s.offset_days || 0, s.workdays ? 1 : 0, s.duration_min || null, s.depends_prev === false ? 0 : 1));
  log('template', id, 'created', name);
  res.status(201).json({ id, name, description });
});
r.delete('/templates/:id', (req, res) => {
  db.prepare('DELETE FROM templates WHERE id = ?').run(Number(req.params.id));
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
  res.json(db.prepare('SELECT * FROM automations ORDER BY id DESC').all().map(a => ({
    ...a,
    conditions: JSON.parse(a.conditions || '{}'),
    action_params: JSON.parse(a.action_params || '{}'),
  })));
});
r.post('/automations', (req, res) => {
  const { name, trigger_type = 'task_completed', conditions = {}, action_type = 'create_task', action_params = {}, enabled = 1 } = req.body;
  const result = db.prepare(
    'INSERT INTO automations (name, enabled, trigger_type, conditions, action_type, action_params) VALUES (?, ?, ?, ?, ?, ?)')
    .run(name, enabled ? 1 : 0, trigger_type, JSON.stringify(conditions), action_type, JSON.stringify(action_params));
  const id = Number(result.lastInsertRowid);
  log('automation', id, 'created', name);
  res.status(201).json({ id });
});
r.patch('/automations/:id', (req, res) => {
  const id = Number(req.params.id);
  if (req.body.enabled !== undefined) db.prepare('UPDATE automations SET enabled = ? WHERE id = ?').run(req.body.enabled ? 1 : 0, id);
  if (req.body.name !== undefined) db.prepare('UPDATE automations SET name = ? WHERE id = ?').run(req.body.name, id);
  if (req.body.conditions !== undefined) db.prepare('UPDATE automations SET conditions = ? WHERE id = ?').run(JSON.stringify(req.body.conditions), id);
  if (req.body.action_params !== undefined) db.prepare('UPDATE automations SET action_params = ? WHERE id = ?').run(JSON.stringify(req.body.action_params), id);
  res.json({ ok: true });
});
r.delete('/automations/:id', (req, res) => {
  db.prepare('DELETE FROM automations WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// ---------- История ----------
r.get('/activity', (req, res) => res.json(getActivity(req.query)));

// ---------- Настройки ----------
r.get('/settings', (req, res) => {
  const rows = db.prepare('SELECT * FROM settings').all();
  res.json(Object.fromEntries(rows.map(x => [x.key, x.value])));
});
r.put('/settings', (req, res) => {
  for (const [k, v] of Object.entries(req.body)) setSetting(k, v);
  res.json({ ok: true });
});

export default r;
