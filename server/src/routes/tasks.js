import { Router } from 'express';
import * as tasks from '../services/tasks.js';
import { smartCreate } from '../services/nl/quick.js';

const r = Router();

r.get('/', (req, res) => res.json(tasks.listTasks(req.query)));

// Умная строка: «завтра в 10:00 замер у Петровых» → готовая задача
r.post('/smart', (req, res) => {
  const text = String(req.body.text || req.body.title || '').trim();
  if (!text) return res.status(400).json({ error: 'text required' });
  res.status(201).json(smartCreate(text, { project_id: req.body.project_id ?? null }));
});
r.get('/:id', (req, res) => {
  const t = tasks.getTask(req.params.id);
  if (!t) return res.status(404).json({ error: 'not found' });
  res.json(t);
});
r.post('/', (req, res) => res.status(201).json(tasks.createTask(req.body)));
r.patch('/:id', (req, res) => {
  const t = tasks.updateTask(req.params.id, req.body);
  if (!t) return res.status(404).json({ error: 'not found' });
  res.json(t);
});
r.delete('/:id', (req, res) => {
  tasks.deleteTask(req.params.id);
  res.json({ ok: true });
});
r.post('/:id/complete', (req, res) => {
  const result = tasks.completeTask(req.params.id);
  if (!result) return res.status(404).json({ error: 'not found' });
  res.json(result);
});
r.post('/:id/status', (req, res) => {
  const t = tasks.setStatus(req.params.id, req.body.status);
  if (!t) return res.status(404).json({ error: 'not found' });
  res.json(t);
});
r.post('/:id/dependencies', (req, res) => {
  tasks.addDependency(req.params.id, req.body.depends_on_id, req.body.kind || 'after');
  res.json(tasks.getTask(req.params.id));
});
r.delete('/:id/dependencies/:depId', (req, res) => {
  tasks.removeDependency(req.params.id, req.params.depId);
  res.json(tasks.getTask(req.params.id));
});

export default r;
