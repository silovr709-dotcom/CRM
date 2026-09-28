// Выгрузка данных в CSV — открывается в Excel и Google-Таблицах.
// Разделитель «;» и BOM в начале: так Excel на русской Windows не ломает кириллицу.

import { Router } from 'express';
import { db } from '../db.js';
import { uid } from '../ctx.js';

const r = Router();

function csv(rows, columns) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = columns.map(c => esc(c.title)).join(';');
  const body = rows.map(row => columns.map(c => esc(c.get(row))).join(';')).join('\n');
  return `\uFEFF${head}\n${body}\n`;
}

function send(res, filename, text) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.send(text);
}

const stamp = () => new Date().toISOString().slice(0, 10);

// Заказы: сумма, оплачено, остаток, этап, клиент
r.get('/projects.csv', (req, res) => {
  const rows = db.prepare(`
    SELECT p.*, c.name AS contact_name, c.phone AS contact_phone,
           (SELECT COUNT(*) FROM tasks WHERE project_id = p.id) AS tasks_total,
           (SELECT COUNT(*) FROM tasks WHERE project_id = p.id AND status = 'done') AS tasks_done
    FROM projects p LEFT JOIN contacts c ON c.id = p.contact_id
    WHERE p.user_id = ? ORDER BY p.created_at DESC`).all(uid());
  const text = csv(rows, [
    { title: 'Заказ', get: r => r.name },
    { title: 'Клиент', get: r => r.contact_name || '' },
    { title: 'Телефон', get: r => r.contact_phone || '' },
    { title: 'Этап', get: r => r.stage || '' },
    { title: 'Статус', get: r => ({ active: 'в работе', paused: 'пауза', done: 'завершён', archived: 'архив' }[r.status] || r.status) },
    { title: 'Сумма', get: r => r.price ?? '' },
    { title: 'Оплачено', get: r => r.prepaid ?? '' },
    { title: 'Остаток', get: r => Math.max(0, (r.price || 0) - (r.prepaid || 0)) },
    { title: 'Дедлайн', get: r => r.deadline || '' },
    { title: 'Задач всего', get: r => r.tasks_total },
    { title: 'Задач сделано', get: r => r.tasks_done },
    { title: 'Создан', get: r => String(r.created_at || '').slice(0, 10) },
  ]);
  send(res, `Заказы-${stamp()}.csv`, text);
});

// Клиенты: контакты, число заказов и долг
r.get('/clients.csv', (req, res) => {
  const rows = db.prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM projects p WHERE p.contact_id = c.id) AS projects_count,
      (SELECT COALESCE(SUM(MAX(0, COALESCE(p.price,0) - COALESCE(p.prepaid,0))), 0)
         FROM projects p WHERE p.contact_id = c.id AND p.status IN ('active','paused','done')) AS debt
    FROM contacts c WHERE c.user_id = ? ORDER BY c.name`).all(uid());
  const text = csv(rows, [
    { title: 'Клиент', get: r => r.name },
    { title: 'Телефон', get: r => r.phone || '' },
    { title: 'Email', get: r => r.email || '' },
    { title: 'Адрес', get: r => r.address || '' },
    { title: 'Заказов', get: r => r.projects_count },
    { title: 'Должен', get: r => r.debt },
    { title: 'Заметка', get: r => r.notes || '' },
  ]);
  send(res, `Клиенты-${stamp()}.csv`, text);
});

// Платежи: когда, сколько, по какому заказу
r.get('/payments.csv', (req, res) => {
  const rows = db.prepare(`
    SELECT pay.*, p.name AS project_name, c.name AS contact_name
    FROM payments pay
    JOIN projects p ON p.id = pay.project_id
    LEFT JOIN contacts c ON c.id = p.contact_id
    WHERE pay.user_id = ? ORDER BY pay.date DESC, pay.id DESC`).all(uid());
  const text = csv(rows, [
    { title: 'Дата', get: r => r.date },
    { title: 'Сумма', get: r => r.amount },
    { title: 'Способ', get: r => r.method },
    { title: 'Заказ', get: r => r.project_name },
    { title: 'Клиент', get: r => r.contact_name || '' },
    { title: 'Комментарий', get: r => r.note || '' },
  ]);
  send(res, `Платежи-${stamp()}.csv`, text);
});

export default r;
