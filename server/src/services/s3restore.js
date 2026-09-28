// Восстановление базы из S3 при старте контейнера.
//
// Зачем: в App Platform каждый деплой поднимает НОВЫЙ пустой контейнер.
// Поэтому при запуске, если локальной базы нет, мы скачиваем последний снимок
// из S3. Модуль вызывается до открытия SQLite и ничего про неё не знает.

import { existsSync, writeFileSync, statSync } from 'node:fs';
import { dbFile } from '../paths.js';
import { s3Enabled, getObject, s3Info } from './s3.js';

export const SNAPSHOT_KEY = process.env.S3_SNAPSHOT_KEY || 'snapshots/organizer.db';

export async function restoreIfNeeded() {
  if (!s3Enabled) {
    console.log('[s3] хранилище не настроено — работаем на локальном диске');
    return { restored: false, reason: 's3-disabled' };
  }
  if (existsSync(dbFile) && statSync(dbFile).size > 0) {
    console.log('[s3] локальная база на месте — восстановление не требуется');
    return { restored: false, reason: 'local-db-exists' };
  }
  const { bucket, endpoint } = s3Info();
  try {
    console.log(`[s3] ищу снимок ${SNAPSHOT_KEY} в ${bucket} (${endpoint})…`);
    const buf = await getObject(SNAPSHOT_KEY);
    if (!buf) {
      console.log('[s3] снимка ещё нет — начинаем с пустой базы');
      return { restored: false, reason: 'no-snapshot' };
    }
    writeFileSync(dbFile, buf);
    console.log(`[s3] база восстановлена из снимка, ${buf.length} байт`);
    return { restored: true, size: buf.length };
  } catch (e) {
    // Важно: не падаем. Лучше подняться с пустой базой и написать об этом
    // в лог, чем не запуститься вовсе.
    console.error('[s3] не удалось восстановить базу:', e.message);
    return { restored: false, reason: 'error', error: e.message };
  }
}
