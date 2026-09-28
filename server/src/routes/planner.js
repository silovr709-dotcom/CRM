import { Router } from 'express';
import { planDay, applyPlan, unloadDay, eveningReview } from '../services/planner.js';
import { getTodayView, whatDidIForget } from '../services/today.js';
import { getStats } from '../services/stats.js';
import { updateTask } from '../services/tasks.js';
import { todayStr, addDays } from '../util/dates.js';

const r = Router();

r.get('/today', (req, res) => res.json(getTodayView(req.query.date || todayStr())));
r.get('/forgotten', (req, res) => res.json(whatDidIForget()));
r.get('/stats', (req, res) => res.json(getStats()));

r.post('/plan-day', (req, res) => res.json(planDay(req.body.date || todayStr())));
r.post('/apply-plan', (req, res) => res.json({ applied: applyPlan(req.body.placed || []) }));
r.post('/unload-day', (req, res) => res.json(unloadDay(req.body.date || todayStr())));

r.get('/evening', (req, res) => res.json(eveningReview(req.query.date || todayStr())));
// Перенести невыполненные на завтра (после подтверждения на клиенте)
r.post('/carry-over', (req, res) => {
  const ids = req.body.task_ids || [];
  const to = req.body.to_date || addDays(todayStr(), 1);
  const moved = [];
  for (const id of ids) {
    const t = updateTask(id, { date: to, time: null });
    if (t) moved.push(t);
  }
  res.json({ moved });
});

export default r;
