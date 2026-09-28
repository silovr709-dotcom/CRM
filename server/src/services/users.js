// Пользователи и сессии входа.
// Публичной регистрации нет: аккаунты заводит администратор.
// Сессия живёт долго (180 дней) и хранится в базе — переживает перезапуск сервера.

import { randomBytes } from 'node:crypto';
import { db, seedUserData } from '../db.js';
import { hashPassword, verifyPassword } from '../util/password.js';

export const SESSION_DAYS = 180;
export const COOKIE_NAME = 'myday_sid';

const publicFields = 'id, login, name, role, must_change_password, active, created_at';

export function listUsers() {
  return db.prepare(`SELECT ${publicFields} FROM users ORDER BY role = 'admin' DESC, id`).all();
}

export function getUser(id) {
  return db.prepare(`SELECT ${publicFields} FROM users WHERE id = ?`).get(Number(id)) || null;
}

export function getUserByLogin(login) {
  return db.prepare('SELECT * FROM users WHERE nlower(login) = nlower(?)').get(String(login).trim()) || null;
}

export function createUser({ login, password, name = '', role = 'user' }) {
  const clean = String(login || '').trim().toLowerCase();
  if (!/^[a-z0-9_.-]{3,32}$/.test(clean)) {
    throw new Error('Логин: 3–32 символа, латинские буквы, цифры, «_», «-», «.»');
  }
  if (String(password || '').length < 4) throw new Error('Пароль — минимум 4 символа');
  if (getUserByLogin(clean)) throw new Error('Такой логин уже занят');
  const { salt, hash } = hashPassword(password);
  const res = db.prepare(
    `INSERT INTO users (login, name, role, pass_salt, pass_hash) VALUES (?, ?, ?, ?, ?)`)
    .run(clean, String(name || '').trim(), role === 'admin' ? 'admin' : 'user', salt, hash);
  const id = Number(res.lastInsertRowid);
  seedUserData(id);
  return getUser(id);
}

export function updateUser(id, { name, role, active, password }) {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(id));
  if (!u) return null;
  if (name !== undefined) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(String(name), u.id);
  if (role !== undefined && u.role !== role) {
    const admins = db.prepare(`SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND active = 1`).get().c;
    if (u.role === 'admin' && admins <= 1) throw new Error('Нельзя убрать права у единственного администратора');
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role === 'admin' ? 'admin' : 'user', u.id);
  }
  if (active !== undefined) {
    db.prepare('UPDATE users SET active = ? WHERE id = ?').run(active ? 1 : 0, u.id);
    if (!active) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
  }
  if (password) {
    if (String(password).length < 4) throw new Error('Пароль — минимум 4 символа');
    const { salt, hash } = hashPassword(password);
    db.prepare('UPDATE users SET pass_salt = ?, pass_hash = ?, must_change_password = 0 WHERE id = ?')
      .run(salt, hash, u.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
  }
  return getUser(u.id);
}

export function deleteUser(id) {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(id));
  if (!u) return false;
  if (u.role === 'admin') {
    const admins = db.prepare(`SELECT COUNT(*) AS c FROM users WHERE role = 'admin'`).get().c;
    if (admins <= 1) throw new Error('Нельзя удалить единственного администратора');
  }
  // Удаляем вместе со всеми его данными
  const tables = ['tasks', 'projects', 'notes', 'reminders', 'contacts', 'categories',
    'attachments', 'stock_items', 'stock_moves', 'templates', 'automations', 'activity_log', 'locations'];
  for (const t of tables) {
    try { db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(u.id); } catch { /* ignore */ }
  }
  db.prepare('DELETE FROM user_settings WHERE user_id = ?').run(u.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
  db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
  return true;
}

export function authenticate(login, password) {
  const u = getUserByLogin(login);
  if (!u || !u.active) return null;
  if (!verifyPassword(password, u.pass_salt, u.pass_hash)) return null;
  return getUser(u.id);
}

export function changeOwnPassword(userId, oldPassword, newPassword) {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(userId));
  if (!u) throw new Error('Пользователь не найден');
  if (!verifyPassword(oldPassword, u.pass_salt, u.pass_hash)) throw new Error('Текущий пароль неверный');
  if (String(newPassword || '').length < 4) throw new Error('Новый пароль — минимум 4 символа');
  const { salt, hash } = hashPassword(newPassword);
  db.prepare('UPDATE users SET pass_salt = ?, pass_hash = ?, must_change_password = 0 WHERE id = ?')
    .run(salt, hash, u.id);
  return getUser(u.id);
}

// ---------- сессии ----------
export function createSession(userId) {
  const token = randomBytes(32).toString('hex');
  db.prepare(`INSERT INTO sessions (token, user_id, expires_at)
              VALUES (?, ?, datetime('now', '+${SESSION_DAYS} days'))`).run(token, Number(userId));
  return token;
}

export function sessionUser(token) {
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.id, u.login, u.name, u.role, u.must_change_password, u.active
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires_at > datetime('now')`).get(String(token));
  if (!row || !row.active) return null;
  // продлеваем «скользящую» сессию, чтобы вход не слетал у активных пользователей
  db.prepare(`UPDATE sessions SET last_seen = datetime('now'),
              expires_at = datetime('now', '+${SESSION_DAYS} days') WHERE token = ?`).run(String(token));
  return row;
}

export function dropSession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(String(token));
}

export function cleanupSessions() {
  db.prepare(`DELETE FROM sessions WHERE expires_at <= datetime('now')`).run();
}

export function activeUsers() {
  return db.prepare(`SELECT ${publicFields} FROM users WHERE active = 1`).all();
}
