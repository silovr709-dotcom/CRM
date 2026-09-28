// AI-диалог: отвечает на вопросы ТОЛЬКО на основании реальных данных,
// распознаёт команды и фразы-планы. Ничего не меняет без подтверждения.

import { db } from '../../db.js';
import { listTasks } from '../tasks.js';
import { getTodayView, whatDidIForget } from '../today.js';
import { planDay, unloadDay, freeSlots } from '../planner.js';
import { parsePhrase } from './parser.js';
import { parseCommand } from './commands.js';
import { todayStr, addDays, humanDate, humanDuration, minToTime, weekdayName } from '../../util/dates.js';

const norm = (s) => s.toLowerCase().replace(/ё/g, 'е').trim();
const ACTIVE = 'inbox,planned,in_progress,paused';

function fmtTask(t) {
  const time = t.time ? `${t.time} — ` : '';
  return `• ${time}${t.title}${t.project ? ` (${t.project.name})` : ''}`;
}

function answerToday(date) {
  const v = getTodayView(date);
  const label = humanDate(date);
  if (!v.timed.length && !v.untimed.length) {
    return { kind: 'answer', text: `На ${label} ничего не запланировано. Свободно: ${humanDuration(v.free_min)}.` };
  }
  const lines = [];
  lines.push(`${label.charAt(0).toUpperCase() + label.slice(1)}: ${v.briefing.tasks_count} задач(и), ${v.briefing.events_count} событ., ${v.briefing.trips_count} поездк.`);
  if (v.timed.length) {
    lines.push('\nПо времени:');
    v.timed.forEach(t => lines.push(fmtTask(t)));
  }
  if (v.untimed.length) {
    lines.push('\nБез времени:');
    v.untimed.forEach(t => lines.push(fmtTask(t)));
  }
  if (v.attention.length) lines.push(`\n⚠ Требует внимания: ${v.attention.length}`);
  lines.push(`\nСвободно: ${humanDuration(v.free_min)}.`);
  return { kind: 'answer', text: lines.join('\n'), tasks: [...v.timed, ...v.untimed] };
}

function answerMorning(date) {
  const tasks = listTasks({ date, status: ACTIVE }).filter(t => !t.time || t.time < '12:00');
  if (!tasks.length) return { kind: 'answer', text: `Утро ${humanDate(date)} свободно.` };
  return {
    kind: 'answer',
    text: `Утром ${humanDate(date)}:\n` + tasks.map(fmtTask).join('\n'),
    tasks,
  };
}

function answerOverdue() {
  const tasks = listTasks({ overdue: 1, status: ACTIVE, limit: 20 });
  if (!tasks.length) return { kind: 'answer', text: 'Просроченных задач нет. 👌' };
  return {
    kind: 'answer',
    text: `Просрочено ${tasks.length}:\n` + tasks.map(t => `• ${t.title} (${t.deadline && t.deadline < todayStr() ? 'дедлайн ' + humanDate(t.deadline) : humanDate(t.date)})`).join('\n'),
    tasks,
  };
}

function answerForgotten() {
  const items = whatDidIForget();
  if (!items.length) return { kind: 'answer', text: 'Ничего критичного не вижу. Всё под контролем.' };
  const lines = ['Возможно, требует внимания:'];
  for (const it of items.slice(0, 10)) {
    if (it.task) lines.push(`• ${it.task.title} — ${it.reason}`);
    else if (it.project) lines.push(`• Проект «${it.project.name}» — ${it.reason}`);
    else if (it.note) lines.push(`• Заметка «${(it.note.title || it.note.content).slice(0, 40)}» — ${it.reason}`);
  }
  return { kind: 'answer', text: lines.join('\n'), forgotten: items };
}

function answerPurchases() {
  const tasks = db.prepare(`
    SELECT * FROM tasks WHERE type = 'purchase' AND status NOT IN ('done','cancelled') ORDER BY date IS NULL, date`).all();
  if (!tasks.length) return { kind: 'answer', text: 'Список покупок пуст.' };
  return {
    kind: 'answer',
    text: 'Нужно купить:\n' + tasks.map(t => `• ${t.title}${t.date ? ` (${humanDate(t.date)})` : ''}`).join('\n'),
    tasks,
  };
}

function answerChronic() {
  const tasks = db.prepare(`
    SELECT * FROM tasks WHERE postponed_count >= 2 AND status NOT IN ('done','cancelled')
    ORDER BY postponed_count DESC LIMIT 10`).all();
  if (!tasks.length) return { kind: 'answer', text: 'Хронически переносимых задач нет.' };
  return {
    kind: 'answer',
    text: 'Чаще всего переносятся:\n' + tasks.map(t => `• ${t.title} — ${t.postponed_count} раз`).join('\n'),
    tasks,
  };
}

function answerFreeWindow(text) {
  const m = text.match(/(\d+|один|два|три|четыре|пять)\s*(свободн[а-яе]+\s*)?час/);
  const nums = { один: 1, два: 2, три: 3, четыре: 4, пять: 5 };
  const hours = m ? (nums[m[1]] || Number(m[1]) || 2) : 2;
  const need = hours * 60;
  for (let i = 0; i < 14; i++) {
    const d = addDays(todayStr(), i);
    const slot = freeSlots(d, { fromNow: i === 0 }).find(s => s.end - s.start >= need);
    if (slot) {
      return {
        kind: 'answer',
        text: `Ближайшее окно на ${hours} ч: ${humanDate(d)} (${weekdayName(d)}) с ${minToTime(slot.start)} до ${minToTime(slot.end)}.`,
      };
    }
  }
  return { kind: 'answer', text: `В ближайшие 2 недели окна на ${hours} ч не нашёл.` };
}

function answerProduction() {
  const tasks = db.prepare(`
    SELECT * FROM tasks WHERE status NOT IN ('done','cancelled')
      AND (title LIKE '%производств%' OR description LIKE '%производств%') ORDER BY date IS NULL, date`).all();
  if (!tasks.length) return { kind: 'answer', text: 'Активных задач по производству нет.' };
  return {
    kind: 'answer',
    text: 'Производство:\n' + tasks.map(t => `• ${t.title}${t.date ? ` (${humanDate(t.date)})` : ''}`).join('\n'),
    tasks,
  };
}

function answerBefore(text) {
  // «что мне нужно сделать перед монтажом Ивановых»
  const m = text.match(/перед\s+(.+?)\??$/);
  if (!m) return null;
  const frag = m[1].replace(/\b(монтажом|монтажа)\b/g, 'монтаж').trim();
  const words = frag.split(/\s+/).filter(w => w.length > 3);
  let target = null;
  for (const w of words) {
    target = db.prepare(`
      SELECT * FROM tasks WHERE status NOT IN ('done','cancelled') AND nlower(title) LIKE nlower(?) ORDER BY date IS NULL, date LIMIT 1`)
      .get(`%${w.slice(0, w.length - 1)}%`);
    if (target) break;
  }
  if (!target) return { kind: 'answer', text: `Не нашёл задачу, похожую на «${m[1]}».` };
  const deps = db.prepare(`
    SELECT t.* FROM task_dependencies d JOIN tasks t ON t.id = d.depends_on_id
    WHERE d.task_id = ? AND t.status NOT IN ('done','cancelled')`).all(target.id);
  const sameProject = target.project_id ? db.prepare(`
    SELECT * FROM tasks WHERE project_id = ? AND status NOT IN ('done','cancelled') AND id != ?
      AND (date IS NULL OR date <= ?) LIMIT 10`).all(target.project_id, target.id, target.date || '9999') : [];
  const list = [...deps, ...sameProject.filter(t => !deps.some(d => d.id === t.id))];
  if (!list.length) return { kind: 'answer', text: `Перед «${target.title}» открытых задач не вижу — всё готово.` };
  return {
    kind: 'answer',
    text: `Перед «${target.title}»${target.date ? ` (${humanDate(target.date)})` : ''} нужно:\n` + list.map(t => `• ${t.title}${t.date ? ` — ${humanDate(t.date)}` : ''}`).join('\n'),
    tasks: list,
  };
}

export function handleMessage(text) {
  const s = norm(text);
  if (!s) return { kind: 'answer', text: 'Напишите, что нужно сделать или что вы хотите узнать.' };

  // 1) Команды
  const cmd = parseCommand(s);
  if (cmd) {
    if (cmd.command === 'plan_day') return { kind: 'plan_day', ...planDay(cmd.date) };
    if (cmd.command === 'unload_day') return { kind: 'unload', ...unloadDay(cmd.date) };
    return cmd;
  }

  // 2) Вопросы
  const isQuestion = /\?$/.test(s) || /^(что|какие|когда|сколько|где|кому|есть ли)\b/.test(s);
  if (isQuestion) {
    if (/забыл/.test(s)) return answerForgotten();
    if (/просрочен/.test(s)) return answerOverdue();
    if (/(купить|покупк)/.test(s)) return answerPurchases();
    if (/переношу|перенос/.test(s)) return answerChronic();
    if (/свободн[а-яе]+\s+час|свободн[а-яе]+\s+врем|окно/.test(s)) return answerFreeWindow(s);
    if (/производств/.test(s)) return answerProduction();
    if (/перед\s+/.test(s)) { const r = answerBefore(s); if (r) return r; }
    if (/завтра/.test(s)) {
      return /утр/.test(s) ? answerMorning(addDays(todayStr(), 1)) : answerToday(addDays(todayStr(), 1));
    }
    if (/сегодня|у меня/.test(s)) {
      return /утр/.test(s) ? answerMorning(todayStr()) : answerToday(todayStr());
    }
    return answerToday(todayStr());
  }

  // 3) Фраза-план
  const plan = parsePhrase(text);
  if (plan.items.length) return plan;

  return {
    kind: 'answer',
    text: 'Я могу: разобрать фразу на задачи («завтра съездить на склад, забрать фасады…»), ' +
      'ответить на вопросы («что у меня сегодня?», «что просрочено?», «что я забыл?») ' +
      'и выполнять команды («перенеси … на пятницу», «напомни через 3 дня», «распланируй день»).',
  };
}
