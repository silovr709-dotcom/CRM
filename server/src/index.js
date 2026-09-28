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
import { startTelegramLoop, startTelegramScheduler } from './services/telegram.js';
import { sessionUser, cleanupSessions, COOKIE_NAME } from './services/users.js';
import { als } from './ctx.js';

const app = express();
app.set('trust proxy', 1);
app.use(cors({ origin: true, credentials: true }));
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

app.get('/api/health', (req, res) => res.json({ ok: true }));

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
cleanupSessions();
setInterval(cleanupSessions, 12 * 60 * 60 * 1000);

// Продакшен: раздача собранного фронтенда
const __dirname = dirname(fileURLToPath(import.meta.url));
const webDist = join(__dirname, '..', '..', 'web', 'dist');
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(join(webDist, 'index.html')));
}

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'internal error' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => console.log(`Organizer API on :${PORT}`));
