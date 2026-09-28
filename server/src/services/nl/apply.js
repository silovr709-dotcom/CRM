// Применение подтверждённого AI-плана: создание задач с зависимостями и напоминаниями.
// Используется и HTTP-маршрутом, и Telegram-ботом — единая бизнес-логика.

import { uid } from '../../ctx.js';
import { db } from '../../db.js';
import { createTask } from '../tasks.js';
import { log } from '../activity.js';

export function applyPlanItems(items = [], projectId = null) {
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
      project_id: it.project_id ?? projectId,
      category_id: it.category_id || null,
      depends_on: it.depends_on_prev && prevId ? [prevId] : [],
      description: 'Создано через AI-ввод',
    });
    if (it.is_reminder) {
      db.prepare('INSERT INTO reminders (title, remind_date, remind_time, task_id, user_id) VALUES (?, ?, ?, ?, ?)')
        .run(task.title, it.date, it.time || null, task.id, uid());
    }
    created.push(task);
    prevId = task.id;
  }
  log('assistant', 0, 'plan_applied', `${created.length} задач`);
  return created;
}
