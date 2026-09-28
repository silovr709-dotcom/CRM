import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, '..', 'data');
mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(join(dataDir, 'organizer.db'));

// SQLite lower()/LIKE не понимают кириллицу — регистронезависимый поиск через JS
db.function('nlower', { deterministic: true }, (s) => (s == null ? null : String(s).toLowerCase()));

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#6b7280',
  icon TEXT DEFAULT '',
  builtin INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  address TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  address TEXT DEFAULT '',
  travel_min INTEGER
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT DEFAULT 'active', -- active | paused | done | archived
  deadline TEXT,
  color TEXT DEFAULT '#4f46e5',
  icon TEXT DEFAULT '',
  pause_until TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  type TEXT DEFAULT 'task',           -- task|event|trip|purchase|delivery|work|personal|call|meeting|reminder|custom…
  status TEXT DEFAULT 'planned',      -- inbox|planned|in_progress|done|cancelled|paused
  priority INTEGER DEFAULT 0,         -- 0 обычный | 1 важный | 2 критичный
  schedule_mode TEXT DEFAULT 'flexible', -- fixed | flexible | deadline
  date TEXT,
  time TEXT,
  duration_min INTEGER,
  deadline TEXT,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  parent_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  location TEXT DEFAULT '',
  location_from TEXT DEFAULT '',
  location_to TEXT DEFAULT '',
  recurrence TEXT,                    -- JSON: {freq, interval, days, until}
  extra TEXT,                         -- JSON: произвольные поля (груз, водитель, машина…)
  postponed_count INTEGER DEFAULT 0,
  completed_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tasks_date ON tasks(date);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);

CREATE TABLE IF NOT EXISTS task_dependencies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  kind TEXT DEFAULT 'after',          -- after | with | requires
  UNIQUE(task_id, depends_on_id)
);

CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT DEFAULT '',
  content TEXT DEFAULT '',
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  pinned INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  remind_date TEXT NOT NULL,
  remind_time TEXT,
  task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  note_id INTEGER REFERENCES notes(id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'pending',      -- pending | done | dismissed
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  builtin INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS template_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  ord INTEGER DEFAULT 0,
  title TEXT NOT NULL,
  type TEXT DEFAULT 'task',
  offset_days INTEGER DEFAULT 0,      -- смещение от даты старта
  workdays INTEGER DEFAULT 0,         -- 1 = рабочие дни
  duration_min INTEGER,
  depends_prev INTEGER DEFAULT 1      -- зависит от предыдущего шага
);

CREATE TABLE IF NOT EXISTS automations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  trigger_type TEXT DEFAULT 'task_completed', -- task_completed | task_created
  conditions TEXT DEFAULT '{}',       -- JSON: {task_type, category_id, project_id, title_contains}
  action_type TEXT DEFAULT 'create_task',     -- create_task | create_reminder
  action_params TEXT DEFAULT '{}',    -- JSON: {title, offset_days, workdays, type, duration_min, time}
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  action TEXT NOT NULL,               -- created|updated|rescheduled|completed|cancelled|paused|resumed|deleted|reopened
  details TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS integrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,             -- push|apple_calendar|apple_reminders|email|telegram
  enabled INTEGER DEFAULT 0,
  config TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now'))
);
`);

// ---------- сид данных ----------
function seed() {
  const has = db.prepare('SELECT COUNT(*) AS c FROM settings').get();
  if (has.c > 0) return;

  const setSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
  setSetting.run('work_start', '09:00');
  setSetting.run('work_end', '19:00');
  setSetting.run('plan_buffer_min', '15');     // буфер между задачами при планировании
  setSetting.run('plan_fill_ratio', '0.8');    // не забивать день больше чем на 80%
  setSetting.run('default_travel_min', '30');  // время на дорогу по умолчанию
  setSetting.run('user_name', '');

  const cat = db.prepare('INSERT INTO categories (name, color, icon, builtin) VALUES (?, ?, ?, 1)');
  cat.run('Работа', '#4f46e5', '💼');
  cat.run('Клиенты', '#0891b2', '🤝');
  cat.run('Личное', '#16a34a', '🏠');
  cat.run('Покупки', '#d97706', '🛒');
  cat.run('Авто', '#525252', '🚗');
  cat.run('Здоровье', '#dc2626', '❤️');

  // Встроенные шаблоны
  const tpl = db.prepare('INSERT INTO templates (name, description, builtin) VALUES (?, ?, 1)');
  const step = db.prepare(
    'INSERT INTO template_steps (template_id, ord, title, type, offset_days, workdays, duration_min, depends_prev) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');

  let id = tpl.run('Доставка', 'Стандартная цепочка доставки').lastInsertRowid;
  [['Забрать товар', 'trip', 0, 0, 30, 0],
   ['Проверить комплектность', 'task', 0, 0, 15, 1],
   ['Погрузить', 'task', 0, 0, 20, 1],
   ['Доехать до места', 'trip', 0, 0, 40, 1],
   ['Разгрузить', 'task', 0, 0, 20, 1],
   ['Получить подтверждение', 'task', 0, 0, 10, 1]]
    .forEach((s, i) => step.run(id, i, s[0], s[1], s[2], s[3], s[4], s[5]));

  id = tpl.run('Монтаж', 'Стандартная цепочка монтажа').lastInsertRowid;
  [['Проверить комплектность', 'task', 0, 0, 20, 0],
   ['Загрузить инструмент', 'task', 0, 0, 20, 1],
   ['Доехать до объекта', 'trip', 0, 0, 40, 1],
   ['Разгрузить', 'task', 0, 0, 20, 1],
   ['Выполнить монтаж', 'work', 0, 0, 240, 1],
   ['Проверить результат', 'task', 0, 0, 20, 1],
   ['Сделать фото', 'task', 0, 0, 10, 1],
   ['Получить подтверждение клиента', 'task', 0, 0, 10, 1]]
    .forEach((s, i) => step.run(id, i, s[0], s[1], s[2], s[3], s[4], s[5]));

  id = tpl.run('Новый клиент', 'Лид → обработка → замер → проект → договор → производство → доставка → монтаж').lastInsertRowid;
  [['Обработать обращение', 'call', 0, 1, 20, 0],
   ['Договориться о замере', 'call', 1, 1, 15, 1],
   ['Выполнить замер', 'meeting', 3, 1, 90, 1],
   ['Подготовить проект', 'work', 5, 1, 180, 1],
   ['Показать проект клиенту', 'meeting', 7, 1, 60, 1],
   ['Получить обратную связь', 'call', 9, 1, 15, 1],
   ['Подписать договор', 'meeting', 11, 1, 60, 1],
   ['Отправить заказ на производство', 'task', 12, 1, 30, 1],
   ['Проверить статус производства', 'call', 17, 1, 10, 1],
   ['Согласовать доставку', 'call', 40, 1, 15, 1],
   ['Доставка', 'delivery', 43, 1, 120, 1],
   ['Монтаж', 'work', 45, 1, 300, 1]]
    .forEach((s, i) => step.run(id, i, s[0], s[1], s[2], s[3], s[4], s[5]));

  id = tpl.run('Поездка', 'Подготовка и поездка').lastInsertRowid;
  [['Спланировать маршрут', 'task', -1, 0, 15, 0],
   ['Собрать необходимое', 'task', -1, 0, 30, 1],
   ['Поездка', 'trip', 0, 0, 120, 1],
   ['Разобрать итоги поездки', 'task', 1, 0, 15, 1]]
    .forEach((s, i) => step.run(id, i, s[0], s[1], s[2], s[3], s[4], s[5]));

  id = tpl.run('ТО автомобиля', 'Техническое обслуживание').lastInsertRowid;
  [['Записаться в сервис', 'call', 0, 0, 10, 0],
   ['Отвезти машину в сервис', 'trip', 2, 0, 60, 1],
   ['Уточнить статус ремонта', 'call', 3, 0, 10, 1],
   ['Забрать машину', 'trip', 4, 0, 60, 1]]
    .forEach((s, i) => step.run(id, i, s[0], s[1], s[2], s[3], s[4], s[5]));

  // Пример автоматизации: производство → контроль статуса
  const auto = db.prepare(
    'INSERT INTO automations (name, enabled, trigger_type, conditions, action_type, action_params) VALUES (?, 1, ?, ?, ?, ?)');
  auto.run(
    'Контроль производства',
    'task_completed',
    JSON.stringify({ title_contains: 'на производство' }),
    'create_task',
    JSON.stringify({ title: 'Проверить статус производства', offset_days: 5, workdays: 1, type: 'call', duration_min: 10 })
  );
  auto.run(
    'Напоминание после замера',
    'task_completed',
    JSON.stringify({ title_contains: 'замер' }),
    'create_task',
    JSON.stringify({ title: 'Подготовить проект по замеру', offset_days: 1, workdays: 1, type: 'work', duration_min: 120 })
  );
}

seed();

export function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value));
}
