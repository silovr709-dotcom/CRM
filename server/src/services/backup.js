// Резервные копии базы. SQLite умеет делать целостный снимок командой
// VACUUM INTO — база при этом не блокируется надолго и копия не бьётся.
//
// Копии лежат рядом с базой: ${DATA_DIR}/backups/organizer-YYYY-MM-DD-HHmm.db
// Хранится последние BACKUP_KEEP штук (по умолчанию 7).

import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { db, dataDir } from '../db.js';

export const backupsDir = join(dataDir, 'backups');
mkdirSync(backupsDir, { recursive: true });

const KEEP = Number(process.env.BACKUP_KEEP || 7);
const EVERY_HOURS = Number(process.env.BACKUP_EVERY_HOURS || 24);

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

export function makeBackup() {
  const file = join(backupsDir, `organizer-${stamp()}.db`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  prune();
  return file;
}

export function listBackups() {
  return readdirSync(backupsDir)
    .filter(f => f.endsWith('.db'))
    .map(f => {
      const full = join(backupsDir, f);
      const st = statSync(full);
      return { name: f, path: full, size: st.size, created_at: st.mtime.toISOString() };
    })
    .sort((a, b) => (a.name < b.name ? 1 : -1));
}

function prune() {
  const extra = listBackups().slice(KEEP);
  for (const b of extra) { try { unlinkSync(b.path); } catch { /* уже удалён */ } }
}

let timer = null;

export function startBackupSchedule() {
  if (EVERY_HOURS <= 0 || timer) return;
  const run = () => {
    try {
      const file = makeBackup();
      console.log('[backup] создана копия', file);
    } catch (e) {
      console.error('[backup] не удалось создать копию:', e.message);
    }
  };
  // первая копия через минуту после старта, затем по расписанию
  setTimeout(run, 60 * 1000).unref?.();
  timer = setInterval(run, EVERY_HOURS * 60 * 60 * 1000);
  timer.unref?.();
}

// Аккуратное завершение: дожать WAL в основной файл, чтобы после остановки
// контейнера база оставалась целой одним файлом.
export function checkpointAndClose() {
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch { /* ok */ }
  try { db.close(); } catch { /* ok */ }
}
