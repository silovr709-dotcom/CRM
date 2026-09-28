// Контекст текущего пользователя.
// Вместо того чтобы протаскивать user_id через все функции, держим его
// в AsyncLocalStorage: HTTP-запрос и Telegram-цикл оборачиваются в runAs(),
// а любой код внутри получает id через uid().

import { AsyncLocalStorage } from 'node:async_hooks';

export const als = new AsyncLocalStorage();

// id текущего пользователя; 0 — «никто» (такой записи нет, значит данные не найдутся)
export function uid() {
  const store = als.getStore();
  return store?.userId ?? 0;
}

export function currentUser() {
  return als.getStore()?.user ?? null;
}

export function isAdmin() {
  return als.getStore()?.user?.role === 'admin';
}

export function runAs(user, fn) {
  const u = typeof user === 'number' ? { id: user, role: 'user' } : user;
  return als.run({ userId: u.id, user: u }, fn);
}
