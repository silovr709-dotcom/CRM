// Точка входа.
//
// Порядок важен: если приложение живёт в контейнере без постоянного диска
// (Timeweb App Platform), сначала скачиваем последний снимок базы из S3
// и только потом открываем SQLite и поднимаем сервер.

import { restoreIfNeeded } from './services/s3restore.js';

await restoreIfNeeded();
await import('./app.js');
