import { db } from '../db.js';
import { log } from './activity.js';
import { addDays, addWorkdays, todayStr, humanDate } from '../util/dates.js';

// Движок автоматизаций: КОГДА (триггер + условия) → ТОГДА (действие).
// Работает на уровне сервисов — не зависит от того, с какого экрана изменена задача.

function matches(conditions, task) {
  if (!conditions) return true;
  if (conditions.task_type && task.type !== conditions.task_type) return false;
  if (conditions.category_id && Number(task.category_id) !== Number(conditions.category_id)) return false;
  if (conditions.project_id && Number(task.project_id) !== Number(conditions.project_id)) return false;
  if (conditions.title_contains &&
      !String(task.title).toLowerCase().includes(String(conditions.title_contains).toLowerCase())) return false;
  return true;
}

export function runAutomations(triggerType, task) {
  const rules = db.prepare('SELECT * FROM automations WHERE enabled = 1 AND trigger_type = ?').all(triggerType);
  const created = [];
  for (const rule of rules) {
    let conditions = {};
    let params = {};
    try { conditions = JSON.parse(rule.conditions || '{}'); } catch { /* noop */ }
    try { params = JSON.parse(rule.action_params || '{}'); } catch { /* noop */ }
    if (!matches(conditions, task)) continue;

    const base = task.date || todayStr();
    const offset = Number(params.offset_days || 0);
    const date = params.workdays ? addWorkdays(base, offset) : addDays(base, offset);

    if (rule.action_type === 'create_task') {
      const res = db.prepare(`
        INSERT INTO tasks (title, type, status, date, time, duration_min, project_id, category_id, contact_id, description)
        VALUES (?, ?, 'planned', ?, ?, ?, ?, ?, ?, ?)`).run(
        params.title || `Следующий шаг: ${task.title}`,
        params.type || 'task',
        date,
        params.time || null,
        params.duration_min || null,
        task.project_id || null,
        task.category_id || null,
        task.contact_id || null,
        `Создано автоматизацией «${rule.name}» после «${task.title}»`
      );
      const id = Number(res.lastInsertRowid);
      log('task', id, 'created', `автоматизация «${rule.name}» → ${humanDate(date)}`);
      log('automation', rule.id, 'fired', `«${task.title}» → «${params.title}» (${humanDate(date)})`);
      created.push({ kind: 'automation', rule: rule.name, task: db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) });
    } else if (rule.action_type === 'create_reminder') {
      const res = db.prepare(
        'INSERT INTO reminders (title, remind_date, remind_time, project_id) VALUES (?, ?, ?, ?)').run(
        params.title || `Напоминание: ${task.title}`,
        date,
        params.time || null,
        task.project_id || null
      );
      log('automation', rule.id, 'fired', `напоминание «${params.title}» (${humanDate(date)})`);
      created.push({ kind: 'automation_reminder', rule: rule.name, reminder: db.prepare('SELECT * FROM reminders WHERE id = ?').get(Number(res.lastInsertRowid)) });
    }
  }
  return created;
}
