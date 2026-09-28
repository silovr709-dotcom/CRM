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

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.use('/api/tasks', tasksRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/assistant', assistantRouter);
app.use('/api/planner', plannerRouter);
app.use('/api', miscRouter);

app.get('/api/health', (req, res) => res.json({ ok: true }));

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
