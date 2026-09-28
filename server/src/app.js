import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

import tasksRouter from './routes/tasks.js';
import projectsRouter from './routes/projects.js';
import miscRouter from './routes/misc.js';
import assistantRouter from './routes/assistant.js';
import plannerRouter from './routes/planner.js';
import telegramRouter from './routes/telegram.js';
import stockRouter from './routes/stock.js';
import authRouter from './routes/auth.js';
import adminRouter from './routes/admin.js';
import exportRouter from './routes/export.js';
import { startTelegramLoop, startTelegramScheduler } from './services/telegram.js';
import { sessionUser, cleanupSessions, COOKIE_NAME } from './services/users.js';
import { als } from './ctx.js';
import { db } from './db.js';
import { securityHeaders } from './util/security.js';
import { startBackupSchedule, checkpointAndClose } from './services/backup.js';
import { startSnapshotSchedule, snapshotOnShutdown } from './services/persist.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(securityHeaders);

// CORS нужен только в разработке (Vite на другом порту) или если фронтенд
// вынесен на отдельный домен — тогда перечислите его в CORS_ORIGINS.
// В продакшене фронтенд и API на одном домене, кросс-доменные запросы с
// куками запрещены: так чужой сайт не сможет действовать от вашего имени.
const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);
if (process.env.NODE_ENV !== 'production') {
  app.use(cors({ origin: true, credentials: true }));
} else if (allowedOrigins.length) {
  app.use(cors({ origin: allowedOrigins, credentials: true }));
}

app.use(express.json({ limit: '20mb' }));

// Разбор cookie (без внешних зависимостей)
app.use((req, res, next) => {
  const header = req.headers.cookie || '';
  req.cookies = Object.fromEntries(
    header.split(';').map(p => p.trim()).filter(Boolean).map(p => {
      const i = p.indexOf('=');
      return i < 0 ? [p, ''] : [p.slice(0, i), decodeURIComponent(p.slice(i + 1))];
    }));
  next();
});

// Проверка состояния для хостинга (Timeweb: «Путь проверки состояния» = /api/health)
app.get('/api/health', (req, res) => {
  try {
    db.prepare('SELECT 1').get();
    res.json({ ok: true, uptime_sec: Math.round(process.uptime()) });
  } catch (e) {
    res.status(503).json({ ok: false, error: e.message });
  }
});

// Кто вошёл: сессия из cookie → контекст пользователя на весь запрос
const OPEN_PATHS = new Set(['/api/auth/login', '/api/health']);
app.use((req, res, next) => {
  const user = sessionUser(req.cookies?.[COOKIE_NAME]);
  if (!user) {
    if (OPEN_PATHS.has(req.path) || !req.path.startsWith('/api')) return next();
    return res.status(401).json({ error: 'Нужно войти' });
  }
  als.run({ userId: user.id, user }, next);
});

app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/export', exportRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/assistant', assistantRouter);
app.use('/api/planner', plannerRouter);
app.use('/api/telegram', telegramRouter);
app.use('/api/stock', stockRouter);
app.use('/api', miscRouter);

// Telegram-бот: long polling + планировщик напоминаний/брифингов (у каждого пользователя свой бот)
startTelegramLoop();
startTelegramScheduler();
startBackupSchedule();
startSnapshotSchedule();
cleanupSessions();
setInterval(cleanupSessions, 12 * 60 * 60 * 1000);

// Продакшен: раздача собранного фронтенда
const __dirname = dirname(fileURLToPath(import.meta.url));
const webDist = join(__dirname, '..', '..', 'web', 'dist');
if (existsSync(webDist)) {
  app.use(express.static(webDist, {
    setHeaders(res, path) {
      // Файлы сборки с хэшем в имени можно кэшировать надолго,
      // а оболочку и service worker — нет, иначе пользователи застрянут на старой версии.
      if (path.includes(`${'/'}assets${'/'}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      else res.setHeader('Cache-Control', 'no-cache');
    },
  }));
  app.get(/^(?!\/api).*/, (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(join(webDist, 'index.html'));
  });
}

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'internal error' });
});

const PORT = process.env.PORT || 3001;
const server = app.listen(PORT, '0.0.0.0', () => console.log(`Organizer API on :${PORT}`));

// Аккуратная остановка: при обновлении версии хостинг присылает SIGTERM.
// Успеваем закрыть соединения и свести базу в один файл, чтобы ничего не потерять.
let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    console.log(`Получен ${signal} — завершаюсь аккуратно…`);
    const finish = async () => {
      // Сначала выгружаем финальный снимок в S3 (если настроен), потом закрываем базу
      await snapshotOnShutdown();
      checkpointAndClose();
      process.exit(0);
    };
    server.close(() => { finish(); });
    setTimeout(finish, 20000).unref();
  });
}

process.on('unhandledRejection', (e) => console.error('unhandledRejection:', e));
process.on('uncaughtException', (e) => console.error('uncaughtException:', e));
