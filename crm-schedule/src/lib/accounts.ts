// Учётные записи сотрудников: имя, роль и пароль.
//
// Пароль не хранится: только PBKDF2-SHA256 с солью (120 000 итераций).
// Это защищает от «подсмотреть в настройках» и от случайного входа не тем
// человеком, но не шифрует саму базу: данные по-прежнему лежат в браузере
// и в общей базе. Это честно написано в интерфейсе.

import type { Account, RoleId } from '../types';

const ITERATIONS = 120_000;
const KEY_BITS = 256;
export const MIN_PASSWORD = 4;

/** Соль и пароль → необратимый отпечаток. */
export async function hashPassword(
  password: string,
  salt?: string,
): Promise<{ hash: string; salt: string; iterations: number }> {
  const useSalt = salt || randomSalt();
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    // Крайне редкий случай (старый браузер без WebCrypto): слабый, но
    // детерминированный отпечаток. Интерфейс предупреждает об этом.
    return { hash: `weak:${weakHash(`${useSalt}:${password}`)}`, salt: useSalt, iterations: 0 };
  }
  const encoder = new TextEncoder();
  const key = await subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle.deriveBits(
    { name: 'PBKDF2', salt: encoder.encode(useSalt), iterations: ITERATIONS, hash: 'SHA-256' },
    key,
    KEY_BITS,
  );
  return { hash: `pbkdf2:${toBase64(new Uint8Array(bits))}`, salt: useSalt, iterations: ITERATIONS };
}

/** Проверка пароля: сравниваем отпечатки, время не зависит от совпадения. */
export async function verifyPassword(password: string, account: Pick<Account, 'hash' | 'salt'>): Promise<boolean> {
  const result = await hashPassword(password, account.salt);
  return safeEqual(result.hash, account.hash);
}

export async function createAccount(input: {
  name: string;
  role: RoleId;
  password: string;
  id?: string;
}): Promise<Account> {
  const { hash, salt } = await hashPassword(input.password);
  return {
    id: input.id ?? `acc-${Math.random().toString(36).slice(2, 10)}`,
    name: input.name.trim(),
    role: input.role,
    hash,
    salt,
    createdAt: new Date().toISOString(),
  };
}

/** Пароль подходит? Возвращает причину, чтобы показать её в форме. */
export function passwordProblem(password: string): string {
  if (!password) return 'Введите пароль';
  if (password.trim().length < MIN_PASSWORD) return `Пароль короче ${MIN_PASSWORD} символов`;
  return '';
}

/** Похоже ли имя на уже существующее (без учёта регистра и пробелов). */
export function nameTaken(accounts: Account[], name: string, exceptId?: string): boolean {
  const clean = name.trim().toLowerCase();
  return accounts.some((account) => account.id !== exceptId && account.name.trim().toLowerCase() === clean);
}

/** Устройство без WebCrypto: предупреждение для интерфейса. */
export function isWeakCrypto(): boolean {
  return !globalThis.crypto?.subtle;
}

function randomSalt(): string {
  const bytes = new Uint8Array(16);
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.getRandomValues) cryptoApi.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  return toBase64(bytes);
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return diff === 0;
}

function weakHash(text: string): string {
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0;
  return (hash >>> 0).toString(36);
}
