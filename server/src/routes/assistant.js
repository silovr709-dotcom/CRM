import { Router } from 'express';
import { handleMessage } from '../services/nl/assistant.js';
import { executeCommand } from '../services/nl/commands.js';
import { createTask } from '../services/tasks.js';
import { db } from '../db.js';
import { planDay, applyPlan, unloadDay } from '../services/planner.js';
import { getTodayView, whatDidIForget } from '../services/today.js';
import { todayStr, addDays } from '../util/dates.js';
import { log } from '../services/activity.js';

const r = Router();

r.post('/', (req, res) => {
  try {
    res.json(handleMessage(String(req.body.message || '')));
  } catch (e) {
    console.error(e);
    res.json({ kind: 'answer', text: 'Не смог разобрать запрос. Попробуйте иначе.' });
  }
});

// Подтверждение плана из AI-ввода → реальное создание задач
r.post('/confirm', (req, res) => {
  const { items = [], project_id = null } = req.body;
  const created = [];
  let prevId = null;
  for (const it of items) {
    if (it.skip) { prevId = null; continue; }
    const task = createTask({
      title: it.title,
      type: it.type === 'reminder' ? 'task' : it.type,
      date: it.date,
      time: it.time || null,
      duration_min: it.duration_min || null,
      schedule_mode: it.schedule_mode || 'flexible',
      recurrence: it.recurrence || null,
      project_id: it.project_id ?? project_id,
      category_id: it.category_id || null,
      depends_on: it.depends_on_prev && prevId ? [prevId] : [],
      description: 'Создано через AI-ввод',
    });
    if (it.is_reminder) {
      db.prepare('INSERT INTO reminders (title, remind_date, remind_time, task_id) VALUES (?, ?, ?, ?)')
        .run(task.title, it.date, it.time || null, task.id);
    }
    created.push(task);
    prevId = task.id;
  }
  log('assistant', 0, 'plan_applied', `${created.length} задач`);
  res.status(201).json({ created });
});

// Подтверждение команды
r.post('/execute', (req, res) => {
  res.json(executeCommand(req.body));
});

export default r;
