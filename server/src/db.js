import { DatabaseSync } from 'node:sqlite';
import { dataDir, dbFile } from './paths.js';
import { uid } from './ctx.js';
import { hashPassword } from './util/password.js';

export { dataDir };

export const db = new DatabaseSync(dbFile);

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

CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  mime TEXT DEFAULT 'application/octet-stream',
  size INTEGER DEFAULT 0,
  stored_name TEXT NOT NULL,
  task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  note_id INTEGER REFERENCES notes(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stock_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  qty REAL DEFAULT 0,
  unit TEXT DEFAULT 'шт',
  min_qty REAL DEFAULT 0,
  location TEXT DEFAULT '',
  note TEXT DEFAULT '',
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stock_moves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES stock_items(id) ON DELETE CASCADE,
  delta REAL NOT NULL,
  reason TEXT DEFAULT '',
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
`);

// ---------- Аккаунты ----------
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  login TEXT NOT NULL UNIQUE,
  name TEXT DEFAULT '',
  role TEXT DEFAULT 'user',            -- admin | user
  pass_salt TEXT NOT NULL,
  pass_hash TEXT NOT NULL,
  must_change_password INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT (datetime('now')),
  last_seen TEXT DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

-- Настройки у каждого пользователя свои (в т.ч. свой Telegram-бот)
CREATE TABLE IF NOT EXISTS user_settings (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT,
  PRIMARY KEY (user_id, key)
);
`);

// Миграции для существующих баз
try { db.exec(`ALTER TABLE reminders ADD COLUMN notified_at TEXT`); } catch { /* уже есть */ }

// Деньги и этапы заказа в проектах + привязка проекта к клиенту
const PROJECT_COLUMNS = [
  ['price', 'REAL'],            // сумма заказа, ₽
  ['prepaid', 'REAL'],          // получено (аванс и доплаты), ₽
  ['stage', 'TEXT'],            // этап конвейера заказа
  ['contact_id', 'INTEGER'],    // клиент
];
for (const [col, type] of PROJECT_COLUMNS) {
  try { db.exec(`ALTER TABLE projects ADD COLUMN ${col} ${type}`); } catch { /* уже есть */ }
}

// Разделение данных по пользователям
const OWNED_TABLES = [
  'tasks', 'projects', 'notes', 'reminders', 'contacts', 'categories',
  'attachments', 'stock_items', 'stock_moves', 'templates', 'automations',
  'activity_log', 'locations',
];
for (const t of OWNED_TABLES) {
  try { db.exec(`ALTER TABLE ${t} ADD COLUMN user_id INTEGER`); } catch { /* уже есть */ }
}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id)`); } catch { /* ignore */ }
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id)`); } catch { /* ignore */ }

// ---------- Первый запуск: администратор ----------
// Пароль берётся из переменной окружения ADMIN_PASSWORD (в облаке задаётся
// в панели управления и в репозиторий НЕ попадает). Если её нет — временный
// пароль «admin», который приложение попросит сменить при первом входе.
function bootstrapAdmin() {
  const existing = db.prepare('SELECT COUNT(*) AS c FROM users').get();
  if (existing.c > 0) return;
  const envPass = (process.env.ADMIN_PASSWORD || '').trim();
  const login = (process.env.ADMIN_LOGIN || 'admin').trim() || 'admin';
  const { salt, hash } = hashPassword(envPass || 'admin');
  db.prepare(`INSERT INTO users (login, name, role, pass_salt, pass_hash, must_change_password)
              VALUES (?, ?, 'admin', ?, ?, ?)`)
    .run(login, 'Администратор', salt, hash, envPass ? 0 : 1);
  console.log(envPass
    ? `Создан администратор «${login}» с паролем из ADMIN_PASSWORD.`
    : `Создан администратор «${login}» с временным паролем «admin» — смените его после входа.`);
}
bootstrapAdmin();

// Данные, созданные до появления аккаунтов, отдаём администратору
function assignLegacyData() {
  const admin = db.prepare(`SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1`).get();
  if (!admin) return;
  for (const t of OWNED_TABLES) {
    try { db.prepare(`UPDATE ${t} SET user_id = ? WHERE user_id IS NULL`).run(admin.id); } catch { /* ignore */ }
  }
  // Старые общие настройки → в личные настройки администратора
  const legacy = db.prepare('SELECT key, value FROM settings').all();
  const ins = db.prepare('INSERT OR IGNORE INTO user_settings (user_id, key, value) VALUES (?, ?, ?)');
  for (const s of legacy) ins.run(admin.id, s.key, s.value);
}

// ---------- сид данных ----------
// Стартовый набор для КАЖДОГО нового пользователя: категории, шаблоны, автоматизации.
export function seedUserData(userId) {
  const has = db.prepare('SELECT COUNT(*) AS c FROM categories WHERE user_id = ?').get(userId);
  if (has.c > 0) return;

  const cat0 = db.prepare('INSERT INTO categories (name, color, icon, builtin, user_id) VALUES (?, ?, ?, 1, ?)');
  const cat = { run: (...a) => cat0.run(...a, userId) };
  cat.run('Работа', '#4f46e5', '💼');
  cat.run('Клиенты', '#0891b2', '🤝');
  cat.run('Личное', '#16a34a', '🏠');
  cat.run('Покупки', '#d97706', '🛒');
  cat.run('Авто', '#525252', '🚗');
  cat.run('Здоровье', '#dc2626', '❤️');

  // Встроенные шаблоны
  const tpl0 = db.prepare('INSERT INTO templates (name, description, builtin, user_id) VALUES (?, ?, 1, ?)');
  const tpl = { run: (...a) => tpl0.run(...a, userId) };
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
  const auto0 = db.prepare(
    'INSERT INTO automations (name, enabled, trigger_type, conditions, action_type, action_params, user_id) VALUES (?, 1, ?, ?, ?, ?, ?)');
  const auto = { run: (...a) => auto0.run(...a, userId) };
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

// Значения настроек по умолчанию (общие, дальше каждый пользователь меняет своё)
const DEFAULT_SETTINGS = {
  work_start: '09:00',
  work_end: '19:00',
  plan_buffer_min: '15',      // буфер между задачами при планировании
  plan_fill_ratio: '0.8',     // не забивать день больше чем на 80%
  default_travel_min: '30',   // время на дорогу по умолчанию
  user_name: '',
  telegram_token: '',
  telegram_chat_id: '',
  brief_morning: '08:00',
  brief_evening: '20:30',
  notify_before_min: '15',
  monthly_report: '1',        // присылать итоги месяца 1-го числа
};
{
  const ins = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) ins.run(k, v);
}

// Перенос данных «до аккаунтов» администратору + его стартовый набор
assignLegacyData();
{
  const admin = db.prepare(`SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1`).get();
  if (admin) seedUserData(admin.id);
}

// Настройка текущего пользователя: личное значение → общее значение по умолчанию → fallback
export function getSetting(key, fallback = null, userId = uid()) {
  const own = db.prepare('SELECT value FROM user_settings WHERE user_id = ? AND key = ?').get(userId, key);
  if (own && own.value !== null) return own.value;
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setSetting(key, value, userId = uid()) {
  db.prepare(`INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?)
              ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`)
    .run(userId, key, String(value));
}

export function allSettings(userId = uid()) {
  const out = {};
  for (const row of db.prepare('SELECT key, value FROM settings').all()) out[row.key] = row.value;
  for (const row of db.prepare('SELECT key, value FROM user_settings WHERE user_id = ?').all(userId)) out[row.key] = row.value;
  return out;
}
