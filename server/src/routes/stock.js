import { Router } from 'express';
import { db } from '../db.js';
import { uid } from '../ctx.js';
import { log } from '../services/activity.js';

const r = Router();

r.get('/', (req, res) => {
  const items = db.prepare(`
    SELECT s.*, p.name AS project_name FROM stock_items s
    LEFT JOIN projects p ON p.id = s.project_id
    WHERE s.user_id = ?
    ORDER BY (s.qty <= s.min_qty AND s.min_qty > 0) DESC, s.name`).all(uid());
  res.json(items);
});

r.post('/', (req, res) => {
  const { name, qty = 0, unit = 'шт', min_qty = 0, location = '', note = '', project_id = null } = req.body;
  const result = db.prepare(
    'INSERT INTO stock_items (name, qty, unit, min_qty, location, note, project_id, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(name, Number(qty), unit, Number(min_qty), location, note, project_id, uid());
  const id = Number(result.lastInsertRowid);
  if (Number(qty) !== 0) {
    db.prepare('INSERT INTO stock_moves (item_id, delta, reason, user_id) VALUES (?, ?, ?, ?)').run(id, Number(qty), 'Начальный остаток', uid());
  }
  log('stock', id, 'created', `${name}: ${qty} ${unit}`);
  res.status(201).json(db.prepare('SELECT * FROM stock_items WHERE id = ? AND user_id = ?').get(id, uid()));
});

r.patch('/:id', (req, res) => {
  const id = Number(req.params.id);
  const fields = ['name', 'unit', 'min_qty', 'location', 'note', 'project_id'];
  const sets = [], vals = [];
  for (const f of fields) if (req.body[f] !== undefined) { sets.push(`${f} = ?`); vals.push(req.body[f] === '' ? null : req.body[f]); }
  if (sets.length) {
    sets.push(`updated_at = datetime('now')`);
    db.prepare(`UPDATE stock_items SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).run(...vals, id, uid());
  }
  res.json(db.prepare('SELECT * FROM stock_items WHERE id = ? AND user_id = ?').get(id, uid()));
});

// движение: приход (+) / расход (−) / резерв
r.post('/:id/move', (req, res) => {
  const id = Number(req.params.id);
  const delta = Number(req.body.delta || 0);
  if (!delta) return res.status(400).json({ error: 'delta required' });
  const item = db.prepare('SELECT * FROM stock_items WHERE id = ? AND user_id = ?').get(id, uid());
  if (!item) return res.status(404).json({ error: 'not found' });
  db.prepare(`UPDATE stock_items SET qty = qty + ?, updated_at = datetime('now') WHERE id = ?`).run(delta, id);
  db.prepare('INSERT INTO stock_moves (item_id, delta, reason, project_id, user_id) VALUES (?, ?, ?, ?, ?)')
    .run(id, delta, req.body.reason || '', req.body.project_id || null, uid());
  log('stock', id, delta > 0 ? 'stock_in' : 'stock_out', `${item.name}: ${delta > 0 ? '+' : ''}${delta} ${item.unit}${req.body.reason ? ` (${req.body.reason})` : ''}`);
  res.json(db.prepare('SELECT * FROM stock_items WHERE id = ? AND user_id = ?').get(id, uid()));
});

r.get('/:id/moves', (req, res) => {
  res.json(db.prepare(`
    SELECT m.*, p.name AS project_name FROM stock_moves m
    LEFT JOIN projects p ON p.id = m.project_id
    WHERE m.item_id = ? AND m.user_id = ? ORDER BY m.id DESC LIMIT 50`).all(Number(req.params.id), uid()));
});

r.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM stock_items WHERE id = ? AND user_id = ?').run(Number(req.params.id), uid());
  res.json({ ok: true });
});

export default r;
