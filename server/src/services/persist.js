// Сохранение состояния в S3: снимки базы и вложения.
//
// Как это работает в App Platform (контейнер без постоянного диска):
//   старт      → s3restore.js скачал последний снимок базы;
//   работа     → раз в SNAPSHOT_EVERY_MIN минут, если база менялась, кладём новый снимок;
//   остановка  → перед выходом обязательно кладём финальный снимок (деплой ничего не теряет);
//   вложения   → загружаются в S3 сразу при добавлении, при скачивании
//                недостающий файл подтягивается из S3 обратно на диск.

import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { db } from '../db.js';
import { dataDir, filesDir } from '../paths.js';
import { s3Enabled, putObject, getObject, deleteObject, s3SelfTest, s3Info } from './s3.js';
import { SNAPSHOT_KEY } from './s3restore.js';

const EVERY_MIN = Number(process.env.SNAPSHOT_EVERY_MIN || 5);

let lastDataVersion = -1;
let busy = false;
let timer = null;
export const state = { lastSnapshotAt: null, lastError: null, snapshots: 0 };

// PRAGMA data_version меняется при любой записи в базу — дешёвый способ
// понять, есть ли что сохранять, и не гонять снимки вхолостую.
function dataVersion() {
  try { return db.prepare('PRAGMA data_version').get().data_version; } catch { return Date.now(); }
}

export async function snapshotNow({ force = false } = {}) {
  if (!s3Enabled) return { ok: false, reason: 's3-disabled' };
  if (busy) return { ok: false, reason: 'busy' };
  const version = dataVersion();
  if (!force && version === lastDataVersion) return { ok: true, skipped: true };

  busy = true;
  const tmp = join(dataDir, `.snapshot-${process.pid}.db`);
  try {
    try { unlinkSync(tmp); } catch { /* его и не было */ }
    // VACUUM INTO даёт согласованную копию даже во время работы
    db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
    const buf = readFileSync(tmp);
    await putObject(SNAPSHOT_KEY, buf, 'application/x-sqlite3');
    lastDataVersion = version;
    state.lastSnapshotAt = new Date().toISOString();
    state.lastError = null;
    state.snapshots += 1;
    return { ok: true, size: buf.length, at: state.lastSnapshotAt };
  } catch (e) {
    state.lastError = e.message;
    console.error('[s3] снимок не сохранён:', e.message);
    return { ok: false, error: e.message };
  } finally {
    try { unlinkSync(tmp); } catch { /* уже нет */ }
    busy = false;
  }
}

export function startSnapshotSchedule() {
  if (!s3Enabled || EVERY_MIN <= 0 || timer) return;
  console.log(`[s3] снимки базы в ${s3Info().bucket} каждые ${EVERY_MIN} мин`);
  timer = setInterval(() => { snapshotNow().catch(() => {}); }, EVERY_MIN * 60 * 1000);
  timer.unref?.();
  // первый снимок вскоре после старта — чтобы сразу проверить доступ к хранилищу
  setTimeout(() => { snapshotNow({ force: true }).catch(() => {}); }, 30_000).unref?.();
}

// Финальный снимок при остановке контейнера (SIGTERM во время деплоя)
export async function snapshotOnShutdown() {
  if (!s3Enabled) return;
  try {
    const res = await snapshotNow({ force: true });
    console.log(res.ok ? '[s3] финальный снимок сохранён' : `[s3] финальный снимок не удался: ${res.error}`);
  } catch (e) {
    console.error('[s3] финальный снимок не удался:', e.message);
  }
}

// ---------- Вложения ----------
const fileKey = (stored) => `files/${stored}`;

export async function uploadAttachment(stored, buf, mime) {
  if (!s3Enabled) return;
  try { await putObject(fileKey(stored), buf, mime || 'application/octet-stream'); }
  catch (e) { console.error('[s3] файл не выгружен:', e.message); }
}

// Вернуть путь к файлу на диске, при необходимости скачав его из S3
export async function ensureAttachmentLocal(stored) {
  const local = join(filesDir, stored);
  if (existsSync(local)) return local;
  if (!s3Enabled) return null;
  try {
    const buf = await getObject(fileKey(stored));
    if (!buf) return null;
    writeFileSync(local, buf);
    return local;
  } catch (e) {
    console.error('[s3] файл не скачан:', e.message);
    return null;
  }
}

export async function removeAttachment(stored) {
  try { unlinkSync(join(filesDir, stored)); } catch { /* уже нет */ }
  if (!s3Enabled) return;
  try { await deleteObject(fileKey(stored)); } catch (e) { console.error('[s3] файл не удалён:', e.message); }
}

// ---------- Диагностика для админа ----------
export async function storageStatus() {
  const info = s3Info();
  if (!info.enabled) {
    return { ...info, ok: false, message: 'S3 не настроен: данные хранятся только на диске сервера' };
  }
  try {
    await s3SelfTest();
    return {
      ...info, ok: true, message: 'Хранилище доступно: запись и чтение работают',
      last_snapshot_at: state.lastSnapshotAt, snapshots: state.snapshots, last_error: state.lastError,
    };
  } catch (e) {
    return { ...info, ok: false, message: `Нет доступа к хранилищу: ${e.message}` };
  }
}
