// Пути к данным. Отдельный модуль, чтобы их можно было узнать
// до открытия базы (например, чтобы скачать снимок из S3 перед стартом).
//
// DATA_DIR — постоянное хранилище (в облаке /data). Локально — server/data.

import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, isAbsolute } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envDir = process.env.DATA_DIR;

export const dataDir = envDir
  ? (isAbsolute(envDir) ? envDir : join(process.cwd(), envDir))
  : join(__dirname, '..', 'data');

export const dbFile = join(dataDir, 'organizer.db');
export const filesDir = join(dataDir, 'files');
export const backupsDir = join(dataDir, 'backups');

mkdirSync(dataDir, { recursive: true });
mkdirSync(filesDir, { recursive: true });
mkdirSync(backupsDir, { recursive: true });
