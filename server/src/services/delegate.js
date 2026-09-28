// Поручения: передать задачу другому пользователю (жене, мастеру) и видеть,
// что с ней стало. Данные у всех раздельные, поэтому «поручить» = передать
// задачу в список исполнителя, сохранив автора в created_by.

import { db } from '../db.js';
import { uid, currentUser } from '../ctx.js';
import { log } from './activity.js';
import { attachMeta } from './tasks.js';
import { activeUsers } from './users.js';

// Кому можно поручать: все активные пользователи, кроме себя
export function assignableUsers() {
  return activeUsers()
    .filter(u => u.id !== uid())
    .map(u => ({ id: u.id, login: u.login, name: u.name || u.login }));
}

export function assignTask(taskId, targetUserId) {
  const id = Number(taskId);
  const target = Number(targetUserId);
  const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').get(id, uid());
  if (!task) return null;

  const user = db.prepare(`SELECT id, login, name FROM users WHERE id = ? AND active = 1`).get(target);
  if (!user) throw new Error('Такого пользователя нет');
  if (target === uid()) throw new Error('Задача и так ваша');

  const author = task.created_by || uid();
  db.prepare(`UPDATE tasks SET user_id = ?, created_by = ?, assigned_at = datetime('now'),
              updated_at = datetime('now') WHERE id = ?`).run(target, author, id);
  // Подзадачи уезжают вместе с родителем
  db.prepare(`UPDATE tasks SET user_id = ?, created_by = ? WHERE parent_id = ?`).run(target, author, id);

  log('task', id, 'assigned', `поручено: ${user.name || user.login}`);
  return { ...task, user_id: target, assignee: user.name || user.login };
}

// Забрать задачу обратно себе
export function recallTask(taskId) {
  const id = Number(taskId);
  const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND created_by = ?').get(id, uid());
  if (!task) return null;
  db.prepare(`UPDATE tasks SET user_id = ?, assigned_at = NULL, updated_at = datetime('now')
              WHERE id = ?`).run(uid(), id);
  db.prepare(`UPDATE tasks SET user_id = ? WHERE parent_id = ?`).run(uid(), id);
  log('task', id, 'updated', 'возвращено себе');
  return task;
}

// Что я поручил другим (специально идём мимо обычного фильтра по user_id)
export function delegatedByMe({ includeDone = false } = {}) {
  const rows = db.prepare(`
    SELECT t.*, u.name AS assignee_name, u.login AS assignee_login
    FROM tasks t JOIN users u ON u.id = t.user_id
    WHERE t.created_by = ? AND t.user_id != ?
      ${includeDone ? '' : "AND t.status NOT IN ('done','cancelled')"}
    ORDER BY (t.date IS NULL), t.date, t.time, t.id DESC LIMIT 100`).all(uid(), uid());
  return rows.map(r => ({
    ...r,
    recurrence: r.recurrence ? JSON.parse(r.recurrence) : null,
    extra: r.extra ? JSON.parse(r.extra) : null,
    assignee: r.assignee_name || r.assignee_login,
  }));
}

// Что мне поручили другие
export function assignedToMe() {
  const rows = db.prepare(`
    SELECT t.*, u.name AS author_name, u.login AS author_login
    FROM tasks t JOIN users u ON u.id = t.created_by
    WHERE t.user_id = ? AND t.created_by IS NOT NULL AND t.created_by != ?
      AND t.status NOT IN ('done','cancelled')
    ORDER BY (t.date IS NULL), t.date, t.time LIMIT 100`).all(uid(), uid());
  return attachMeta(rows.map(r => ({
    ...r,
    recurrence: r.recurrence ? JSON.parse(r.recurrence) : null,
    extra: r.extra ? JSON.parse(r.extra) : null,
    author: r.author_name || r.author_login,
  })));
}

// Короткая сводка для экрана «Сегодня»
export function delegationSummary() {
  const me = currentUser();
  if (!me) return { delegated: [], assigned: [] };
  return {
    delegated: delegatedByMe().slice(0, 5),
    assigned: assignedToMe().slice(0, 5),
  };
}
