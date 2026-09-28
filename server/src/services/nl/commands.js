// Команды: «перенеси на пятницу», «напомни через неделю», «удали», «поставь в приоритет»…
// Возвращают ПРЕДЛОЖЕНИЕ команды; выполнение — после подтверждения (/api/assistant/confirm).

import { db } from '../../db.js';
import { extractDate, R } from './parser.js';
import { findTaskByTitle, updateTask, deleteTask, setStatus } from '../tasks.js';
import { todayStr, addDays, humanDate } from '../../util/dates.js';

const norm = (s) => s.toLowerCase().replace(/ё/g, 'е').trim();

function resolveTask(fragment) {
  const frag = fragment
    .replace(R(/\b(задачу|задача|дело|это|эту)\b/g), ' ')
    .replace(/\s+/g, ' ').trim();
  if (!frag) return { candidates: [] };
  const candidates = findTaskByTitle(frag);
  return { candidates, fragment: frag };
}

export function parseCommand(text) {
  const s = norm(text);

  // распланируй
  if (/^(распланируй|спланируй|распланировать)( мой)?( день| завтра)?\b/.test(s)) {
    const d = /завтра/.test(s) ? addDays(todayStr(), 1) : todayStr();
    return { kind: 'command', command: 'plan_day', date: d };
  }
  if (/^разгрузи(ть)?( мой)?( день)?\b/.test(s)) {
    return { kind: 'command', command: 'unload_day', date: todayStr() };
  }

  // перенеси/отложи/поставь X на КОГДА
  let m = s.match(/^(перенеси(?:те)?|отложи(?:те)?|поставь(?:те)?|передвинь)\s+(.+?)\s+на\s+(.+)$/);
  if (m) {
    const when = extractDate(m[3], todayStr()) || extractDate('в ' + m[3], todayStr());
    const target = when ? when.date
      : /завтра/.test(m[3]) ? addDays(todayStr(), 1)
      : /месяц/.test(m[3]) ? addDays(todayStr(), 30)
      : /недел/.test(m[3]) ? addDays(todayStr(), 7)
      : null;
    if (target) {
      const { candidates } = resolveTask(m[2]);
      return {
        kind: 'command', command: 'move', date: target, candidates,
        text: `Перенести «${m[2].trim()}» на ${humanDate(target)}?`,
      };
    }
  }

  // отложи X на месяц/неделю (без явной даты) — обработано выше; «отложи на месяц» без задачи:
  m = s.match(/^(отложи(?:те)?)\s+на\s+(месяц|неделю|(\d+)\s*дн[а-яе]*)$/);
  if (m) {
    const target = m[2] === 'месяц' ? addDays(todayStr(), 30) : m[2] === 'неделю' ? addDays(todayStr(), 7) : addDays(todayStr(), Number(m[3]));
    return { kind: 'command', command: 'move', date: target, candidates: [], need_task: true, text: `Что перенести на ${humanDate(target)}?` };
  }

  // напомни (о X) через N дней/недель | завтра | в пятницу
  m = s.match(/^напомни(?:ть)?(?:\s+мне)?\s*(?:о|об|про)?\s*(.*?)\s*(через\s+.+|завтра|послезавтра|в\s+\S+день[а-яе]*|в\s+пятницу|в\s+субботу|в\s+воскресенье|во\s+вторник|в\s+среду|в\s+четверг|в\s+понедельник)$/);
  if (m) {
    const when = extractDate(m[2], todayStr());
    const date = when ? when.date : addDays(todayStr(), 1);
    const title = m[1].trim() || 'Напоминание';
    return {
      kind: 'command', command: 'remind', date, title,
      text: `Создать напоминание «${title}» на ${humanDate(date)}?`,
    };
  }

  // удали X / отмени X
  m = s.match(/^(удали(?:ть)?|отмени(?:ть)?)\s+(.+)$/);
  if (m) {
    const { candidates } = resolveTask(m[2]);
    return {
      kind: 'command',
      command: m[1].startsWith('удали') ? 'delete' : 'cancel',
      candidates,
      text: `${m[1].startsWith('удали') ? 'Удалить' : 'Отменить'} «${m[2].trim()}»?`,
    };
  }

  // поставь X в приоритет
  m = s.match(/^(поставь|сделай)\s+(.+?)\s+(в\s+приоритет|приоритетн[а-яе]+|важн[а-яе]+)$/);
  if (m) {
    const { candidates } = resolveTask(m[2]);
    return { kind: 'command', command: 'prioritize', candidates, text: `Поставить «${m[2].trim()}» в приоритет?` };
  }

  // сделай X повторяющейся / каждый четверг
  m = s.match(/^сделай\s+(.+?)\s+повторяющ[а-яе]+$/);
  if (m) {
    const { candidates } = resolveTask(m[1]);
    return { kind: 'command', command: 'make_recurring', candidates, rule: { freq: 'weekly' }, text: `Сделать «${m[1].trim()}» еженедельной?` };
  }

  // добавь X в проект Y
  m = s.match(/^(добавь|свяжи)\s+(.+?)\s+(?:в\s+проект|с\s+проектом|с)\s+(.+)$/);
  if (m) {
    const { candidates } = resolveTask(m[2]);
    const project = db.prepare(`SELECT * FROM projects WHERE nlower(name) LIKE nlower(?) LIMIT 1`).get(`%${m[3].trim()}%`);
    if (project) {
      return { kind: 'command', command: 'link_project', candidates, project_id: project.id, project_name: project.name, text: `Добавить «${m[2].trim()}» в проект «${project.name}»?` };
    }
    return { kind: 'answer', text: `Не нашёл проект «${m[3].trim()}».` };
  }

  // разбей X на N задач
  m = s.match(/^разбей\s+(.+?)\s+на\s+(\d+|две|три|четыре)\s*(задач[а-яе]*|част[а-яе]*)?$/);
  if (m) {
    const nums = { две: 2, три: 3, четыре: 4 };
    const n = nums[m[2]] || Number(m[2]) || 2;
    const { candidates } = resolveTask(m[1]);
    return { kind: 'command', command: 'split', candidates, parts: n, text: `Разбить «${m[1].trim()}» на ${n} части?` };
  }

  return null;
}

// Выполнение подтверждённой команды
export function executeCommand(cmd) {
  const taskId = cmd.task_id || (cmd.candidates && cmd.candidates[0] && cmd.candidates[0].id);
  switch (cmd.command) {
    case 'move': {
      if (!taskId) return { ok: false, text: 'Не выбрана задача.' };
      const t = updateTask(taskId, { date: cmd.date });
      return { ok: true, text: `Перенёс «${t.title}» на ${humanDate(cmd.date)}.`, task: t };
    }
    case 'remind': {
      const res = db.prepare('INSERT INTO reminders (title, remind_date) VALUES (?, ?)').run(cmd.title, cmd.date);
      return { ok: true, text: `Напоминание «${cmd.title}» — ${humanDate(cmd.date)}.`, reminder_id: Number(res.lastInsertRowid) };
    }
    case 'delete': {
      if (!taskId) return { ok: false, text: 'Не выбрана задача.' };
      const t = db.prepare('SELECT title FROM tasks WHERE id = ?').get(taskId);
      deleteTask(taskId);
      return { ok: true, text: `Удалил «${t?.title}».` };
    }
    case 'cancel': {
      if (!taskId) return { ok: false, text: 'Не выбрана задача.' };
      const t = setStatus(taskId, 'cancelled');
      return { ok: true, text: `Отменил «${t.title}».` };
    }
    case 'prioritize': {
      if (!taskId) return { ok: false, text: 'Не выбрана задача.' };
      const t = updateTask(taskId, { priority: 2 });
      return { ok: true, text: `«${t.title}» — теперь высокий приоритет.`, task: t };
    }
    case 'make_recurring': {
      if (!taskId) return { ok: false, text: 'Не выбрана задача.' };
      const t = updateTask(taskId, { recurrence: cmd.rule || { freq: 'weekly' } });
      return { ok: true, text: `«${t.title}» теперь повторяется.`, task: t };
    }
    case 'link_project': {
      if (!taskId) return { ok: false, text: 'Не выбрана задача.' };
      const t = updateTask(taskId, { project_id: cmd.project_id });
      return { ok: true, text: `«${t.title}» добавлена в проект «${cmd.project_name}».`, task: t };
    }
    case 'split': {
      if (!taskId) return { ok: false, text: 'Не выбрана задача.' };
      const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
      const n = cmd.parts || 2;
      const per = t.duration_min ? Math.ceil(t.duration_min / n) : null;
      for (let i = 1; i <= n; i++) {
        db.prepare(`INSERT INTO tasks (title, type, parent_id, duration_min, project_id, category_id)
                    VALUES (?, ?, ?, ?, ?, ?)`)
          .run(`${t.title} — часть ${i}/${n}`, t.type, t.id, per, t.project_id, t.category_id);
      }
      return { ok: true, text: `Разбил «${t.title}» на ${n} подзадачи.` };
    }
    default:
      return { ok: false, text: 'Неизвестная команда.' };
  }
}
