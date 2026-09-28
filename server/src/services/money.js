// Деньги по заказам: платежи, долги, отчёт по месяцам.
//
// Правило простое: сумма заказа — в проекте (price), а всё полученное —
// строки в таблице payments. Остаток = price − сумма платежей.

import { db } from '../db.js';
import { uid } from '../ctx.js';
import { todayStr, addDays } from '../util/dates.js';

export const PAYMENT_METHODS = ['наличные', 'карта', 'перевод', 'другое'];

export function listPayments(projectId) {
  return db.prepare(`SELECT * FROM payments WHERE project_id = ? AND user_id = ?
                     ORDER BY date DESC, id DESC`).all(Number(projectId), uid());
}

export function paidSum(projectId) {
  return db.prepare('SELECT COALESCE(SUM(amount), 0) AS s FROM payments WHERE project_id = ? AND user_id = ?')
    .get(Number(projectId), uid()).s;
}

export function addPayment(projectId, { amount, date = todayStr(), method = 'наличные', note = '' }) {
  const sum = Number(amount);
  if (!Number.isFinite(sum) || sum === 0) throw new Error('Укажите сумму платежа');
  const res = db.prepare(`INSERT INTO payments (project_id, amount, date, method, note, user_id)
                          VALUES (?, ?, ?, ?, ?, ?)`)
    .run(Number(projectId), sum, date || todayStr(), method || 'наличные', String(note || ''), uid());
  syncPrepaid(projectId);
  return db.prepare('SELECT * FROM payments WHERE id = ?').get(Number(res.lastInsertRowid));
}

export function deletePayment(projectId, paymentId) {
  db.prepare('DELETE FROM payments WHERE id = ? AND project_id = ? AND user_id = ?')
    .run(Number(paymentId), Number(projectId), uid());
  syncPrepaid(projectId);
}

// Поле projects.prepaid держим в актуальном состоянии: на него опираются
// старые запросы (списки, сводки, ассистент, Telegram).
export function syncPrepaid(projectId) {
  db.prepare('UPDATE projects SET prepaid = ? WHERE id = ? AND user_id = ?')
    .run(paidSum(projectId), Number(projectId), uid());
}

const monthStart = (d) => `${d.slice(0, 7)}-01`;
const shiftMonth = (ym, delta) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

// Отчёт для страницы «Деньги»
export function moneyReport() {
  const today = todayStr();
  const thisMonth = today.slice(0, 7);

  const received = (from, to) => db.prepare(
    `SELECT COALESCE(SUM(amount), 0) AS s FROM payments WHERE user_id = ? AND date >= ? AND date <= ?`)
    .get(uid(), from, to).s;

  // Поступления по месяцам за последние 6 месяцев
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const ym = shiftMonth(thisMonth, -i);
    const last = shiftMonth(ym, 1);
    months.push({
      month: ym,
      received: db.prepare(`SELECT COALESCE(SUM(amount),0) AS s FROM payments
                            WHERE user_id = ? AND date >= ? AND date < ?`)
        .get(uid(), `${ym}-01`, `${last}-01`).s,
    });
  }

  // Заказы в работе: сколько всего, сколько получено, сколько ждём
  const active = db.prepare(`
    SELECT COALESCE(SUM(COALESCE(price,0)), 0) AS price,
           COALESCE(SUM(COALESCE(prepaid,0)), 0) AS paid
    FROM projects WHERE user_id = ? AND status IN ('active','paused')`).get(uid());

  // Должники: заказы с остатком, самые «горячие» — те, что уже сданы
  const debtors = db.prepare(`
    SELECT p.id, p.name, p.stage, p.status, p.deadline,
           COALESCE(p.price,0) AS price, COALESCE(p.prepaid,0) AS paid,
           COALESCE(p.price,0) - COALESCE(p.prepaid,0) AS debt,
           c.id AS contact_id, c.name AS contact_name, c.phone AS contact_phone,
           (SELECT MAX(date) FROM payments WHERE project_id = p.id) AS last_payment
    FROM projects p LEFT JOIN contacts c ON c.id = p.contact_id
    WHERE p.user_id = ? AND p.status IN ('active','paused','done')
      AND COALESCE(p.price,0) - COALESCE(p.prepaid,0) > 0
    ORDER BY (p.stage = 'Сдано') DESC, debt DESC`).all(uid());

  const recent = db.prepare(`
    SELECT pay.*, p.name AS project_name, c.name AS contact_name
    FROM payments pay
    JOIN projects p ON p.id = pay.project_id
    LEFT JOIN contacts c ON c.id = p.contact_id
    WHERE pay.user_id = ? ORDER BY pay.date DESC, pay.id DESC LIMIT 15`).all(uid());

  return {
    today,
    received_this_month: received(`${thisMonth}-01`, `${thisMonth}-31`),
    received_last_30: received(addDays(today, -29), today),
    active_price: active.price,
    active_paid: active.paid,
    expected: Math.max(0, active.price - active.paid),
    total_debt: debtors.reduce((s, d) => s + d.debt, 0),
    months,
    debtors,
    recent,
  };
}

// Блок «пора забрать деньги» для экрана «Сегодня»:
// заказ сдан или на монтаже, а остаток не закрыт.
export function moneyAlerts(limit = 5) {
  return db.prepare(`
    SELECT p.id, p.name, p.stage,
           COALESCE(p.price,0) - COALESCE(p.prepaid,0) AS debt,
           c.name AS contact_name, c.phone AS contact_phone
    FROM projects p LEFT JOIN contacts c ON c.id = p.contact_id
    WHERE p.user_id = ? AND p.status IN ('active','done')
      AND p.stage IN ('Монтаж', 'Сдано')
      AND COALESCE(p.price,0) - COALESCE(p.prepaid,0) > 0
    ORDER BY (p.stage = 'Сдано') DESC, debt DESC LIMIT ?`).all(uid(), limit);
}

export { monthStart };
