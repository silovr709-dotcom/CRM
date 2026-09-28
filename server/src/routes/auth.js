// Вход, выход, смена пароля и управление пользователями (только администратор).

import { Router } from 'express';
import {
  authenticate, createSession, dropSession, changeOwnPassword,
  listUsers, createUser, updateUser, deleteUser, COOKIE_NAME, SESSION_DAYS,
} from '../services/users.js';
import { currentUser, isAdmin } from '../ctx.js';
import { loginRateLimit } from '../util/security.js';

const r = Router();

export function setSessionCookie(req, res, token) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

r.post('/login', loginRateLimit, (req, res) => {
  const { login, password } = req.body || {};
  const user = authenticate(login, password);
  if (!user) {
    req.onLoginFailed?.();
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }
  req.onLoginOk?.();
  setSessionCookie(req, res, createSession(user.id));
  res.json({ user });
});

r.post('/logout', (req, res) => {
  dropSession(req.cookies?.[COOKIE_NAME]);
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
});

r.get('/me', (req, res) => {
  const user = currentUser();
  if (!user) return res.status(401).json({ error: 'Нужно войти' });
  res.json({ user });
});

r.post('/password', (req, res) => {
  const user = currentUser();
  if (!user) return res.status(401).json({ error: 'Нужно войти' });
  try {
    res.json({ user: changeOwnPassword(user.id, req.body.old_password, req.body.new_password) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---------- управление пользователями ----------
function adminOnly(req, res, next) {
  if (!isAdmin()) return res.status(403).json({ error: 'Доступно только администратору' });
  next();
}

r.get('/users', adminOnly, (req, res) => res.json(listUsers()));

r.post('/users', adminOnly, (req, res) => {
  try {
    res.status(201).json(createUser(req.body || {}));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

r.patch('/users/:id', adminOnly, (req, res) => {
  try {
    const u = updateUser(req.params.id, req.body || {});
    if (!u) return res.status(404).json({ error: 'Не найден' });
    res.json(u);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

r.delete('/users/:id', adminOnly, (req, res) => {
  try {
    if (Number(req.params.id) === currentUser()?.id) {
      return res.status(400).json({ error: 'Нельзя удалить самого себя' });
    }
    deleteUser(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

export default r;
