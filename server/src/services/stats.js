import { db } from '../db.js';
import { uid } from '../ctx.js';
import { todayStr, addDays } from '../util/dates.js';

// Аналитика: продуктивность, распределение, «хронические» задачи.
export function getStats() {
  const t = todayStr();
  const from14 = addDays(t, -13);
  const from7 = addDays(t, -6);

  // Выполнено по дням (последние 14 дней)
  const doneRows = db.prepare(`
    SELECT substr(completed_at, 1, 10) AS d, COUNT(*) AS c
    FROM tasks WHERE user_id = ? AND completed_at IS NOT NULL AND substr(completed_at, 1, 10) >= ?
    GROUP BY d`).all(uid(), from14);
  const days = [];
  for (let d = from14; d <= t; d = addDays(d, 1)) {
    days.push({ date: d, done: doneRows.find(r => r.d === d)?.c ?? 0 });
  }

  const week_done = db.prepare(`
    SELECT COUNT(*) AS c FROM tasks WHERE user_id = ? AND completed_at IS NOT NULL AND substr(completed_at,1,10) >= ?`).get(uid(), from7).c;
  const week_created = db.prepare(`
    SELECT COUNT(*) AS c FROM tasks WHERE user_id = ? AND substr(created_at,1,10) >= ?`).get(uid(), from7).c;
  const open_total = db.prepare(`
    SELECT COUNT(*) AS c FROM tasks WHERE user_id = ? AND status NOT IN ('done','cancelled') AND parent_id IS NULL`).get(uid()).c;
  const overdue = db.prepare(`
    SELECT COUNT(*) AS c FROM tasks WHERE user_id = ? AND status NOT IN ('done','cancelled')
      AND ((date IS NOT NULL AND date < ?) OR (deadline IS NOT NULL AND deadline < ?))`).get(uid(), t, t).c;
  const total_postpones = db.prepare(`SELECT COALESCE(SUM(postponed_count),0) AS c FROM tasks WHERE user_id = ?`).get(uid()).c;

  // По типам (открытые)
  const by_type = db.prepare(`
    SELECT type, COUNT(*) AS c FROM tasks
    WHERE user_id = ? AND status NOT IN ('done','cancelled') AND parent_id IS NULL
    GROUP BY type ORDER BY c DESC`).all(uid());

  // По категориям (открытые)
  const by_category = db.prepare(`
    SELECT COALESCE(c.name, 'Без категории') AS name, COALESCE(c.icon, '·') AS icon, COUNT(*) AS c
    FROM tasks tk LEFT JOIN categories c ON c.id = tk.category_id
    WHERE tk.user_id = ? AND tk.status NOT IN ('done','cancelled') AND tk.parent_id IS NULL
    GROUP BY tk.category_id ORDER BY c DESC`).all(uid());

  // Хронически переносимые
  const chronic = db.prepare(`
    SELECT id, title, postponed_count FROM tasks
    WHERE user_id = ? AND postponed_count >= 2 AND status NOT IN ('done','cancelled')
    ORDER BY postponed_count DESC LIMIT 5`).all(uid());

  // Проекты: прогресс
  const projects = db.prepare(`
    SELECT p.id, p.name,
      (SELECT COUNT(*) FROM tasks WHERE project_id = p.id) AS total,
      (SELECT COUNT(*) FROM tasks WHERE project_id = p.id AND status = 'done') AS done
    FROM projects p WHERE p.user_id = ? AND p.status = 'active' ORDER BY p.updated_at DESC LIMIT 8`).all(uid())
    .map(p => ({ ...p, progress: p.total ? Math.round((p.done / p.total) * 100) : 0 }));

  return { days, week_done, week_created, open_total, overdue, total_postpones, by_type, by_category, chronic, projects };
}
