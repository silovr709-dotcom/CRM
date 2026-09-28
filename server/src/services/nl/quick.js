// «Умная строка»: одна фраза → готовая задача с датой, временем и типом.
// Работает на встроенном парсере (без нейросетей).

import { db } from '../../db.js';
import { uid } from '../../ctx.js';
import { parsePhrase } from './parser.js';
import { createTask } from '../tasks.js';
import { todayStr } from '../../util/dates.js';

// Пытаемся понять, о ком/о каком проекте речь: «замер у Петровых» → контакт «Петровы»
function guessLinks(title) {
  const links = { contact_id: null, project_id: null };
  const words = String(title).split(/[\s,.;:()«»"]+/).filter(w => w.length >= 4);
  for (const w of words) {
    const stem = w.slice(0, Math.max(4, w.length - 2));
    if (!links.contact_id) {
      const c = db.prepare('SELECT id FROM contacts WHERE user_id = ? AND nlower(name) LIKE nlower(?) LIMIT 1')
        .get(uid(), `%${stem}%`);
      if (c) links.contact_id = c.id;
    }
    if (!links.project_id) {
      const p = db.prepare(`SELECT id FROM projects WHERE user_id = ? AND status != 'archived' AND nlower(name) LIKE nlower(?) LIMIT 1`)
        .get(uid(), `%${stem}%`);
      if (p) links.project_id = p.id;
    }
  }
  return links;
}

// Парсер работает с текстом в нижнем регистре — возвращаем исходное написание
// («замер у петровых» → «Замер у Петровых»).
function restoreCase(title, original) {
  const originalWords = String(original).split(/(\s+)/);
  const out = String(title).split(/(\s+)/).map(w => {
    if (!w.trim()) return w;
    const found = originalWords.find(ow => ow.toLowerCase().replace(/ё/g, 'е') === w.toLowerCase().replace(/ё/g, 'е'));
    return found || w;
  }).join('');
  return out.charAt(0).toUpperCase() + out.slice(1);
}

export function smartCreate(text, { project_id = null } = {}) {
  const plan = parsePhrase(String(text || ''), todayStr());
  if (!plan.items.length) {
    // Ничего не распознали — создаём обычную задачу во «Входящие»
    const task = createTask({ title: String(text || '').trim().slice(0, 200), status: 'inbox', project_id });
    return { created: [task], recognized: false, summary: 'Добавил во «Входящие» — даты в тексте не нашёл.' };
  }

  const created = [];
  let prevId = null;
  for (const it of plan.items) {
    const title = restoreCase(it.title, text);
    const links = guessLinks(title);
    const task = createTask({
      title,
      type: it.type === 'reminder' ? 'task' : it.type,
      date: it.date,
      time: it.time || null,
      duration_min: it.duration_min || null,
      schedule_mode: it.schedule_mode || 'flexible',
      recurrence: it.recurrence || null,
      status: 'planned',
      project_id: project_id ?? links.project_id,
      contact_id: links.contact_id,
      depends_on: it.depends_on_prev && prevId ? [prevId] : [],
    });
    if (it.is_reminder) {
      db.prepare('INSERT INTO reminders (title, remind_date, remind_time, task_id, user_id) VALUES (?, ?, ?, ?, ?)')
        .run(task.title, it.date, it.time || null, task.id, uid());
    }
    created.push(task);
    prevId = task.id;
  }

  const first = created[0];
  return {
    created,
    recognized: true,
    summary: created.length === 1
      ? `Добавил: «${first.title}»${first.date ? ` на ${first.date}` : ''}${first.time ? ` в ${first.time}` : ''}`
      : `Добавил задач: ${created.length}`,
  };
}
