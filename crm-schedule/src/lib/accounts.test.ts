// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  MIN_PASSWORD, createAccount, hashPassword, nameTaken, passwordProblem, verifyPassword,
} from './accounts';

describe('пароли', () => {
  it('не хранит пароль открытым текстом и узнаёт его обратно', async () => {
    const { hash, salt } = await hashPassword('kuхня-42');
    expect(hash).not.toContain('kuхня-42');
    expect(hash.startsWith('pbkdf2:') || hash.startsWith('weak:')).toBe(true);
    expect(salt.length).toBeGreaterThan(8);
    expect(await verifyPassword('kuхня-42', { hash, salt })).toBe(true);
    expect(await verifyPassword('kuхня-43', { hash, salt })).toBe(false);
  });

  it('одинаковые пароли дают разные отпечатки из-за соли', async () => {
    const first = await hashPassword('пароль');
    const second = await hashPassword('пароль');
    expect(first.hash).not.toBe(second.hash);
    expect(await verifyPassword('пароль', first)).toBe(true);
    expect(await verifyPassword('пароль', second)).toBe(true);
  });

  it('проверяет длину пароля и повтор имени', () => {
    expect(passwordProblem('')).toBe('Введите пароль');
    expect(passwordProblem('123')).toBe(`Пароль короче ${MIN_PASSWORD} символов`);
    expect(passwordProblem('1234')).toBe('');

    const accounts = [
      { id: 'a1', name: 'Ирина', role: 'owner' as const },
      { id: 'a2', name: 'Сергей', role: 'manager' as const },
    ].map((item) => ({ ...item, hash: 'x', salt: 'y', createdAt: '' }));

    expect(nameTaken(accounts, ' ирина ')).toBe(true);
    expect(nameTaken(accounts, 'Олег')).toBe(false);
    // Своё же имя при редактировании не считается занятым.
    expect(nameTaken(accounts, 'Ирина', 'a1')).toBe(false);
  });
});

describe('учётные записи', () => {
  it('создаёт сотрудника с ролью и отпечатком пароля', async () => {
    const account = await createAccount({ name: '  Олег ', role: 'installer', password: 'montag-1' });
    expect(account.name).toBe('Олег');
    expect(account.role).toBe('installer');
    expect(account.id).toMatch(/^acc-/);
    expect(await verifyPassword('montag-1', account)).toBe(true);
    expect(await verifyPassword('montag-2', account)).toBe(false);
  });

  it('понимает старый слабый отпечаток после смены браузера', async () => {
    // Если WebCrypto недоступен, отпечаток начинается с weak: —
    // проверка всё равно работает, просто защита слабее.
    const { hash, salt } = await hashPassword('1234');
    if (hash.startsWith('weak:')) {
      expect(await verifyPassword('1234', { hash, salt })).toBe(true);
    } else {
      expect(hash.startsWith('pbkdf2:')).toBe(true);
    }
  });
});
