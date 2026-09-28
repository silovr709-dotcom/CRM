// AI-диалог: отвечает на вопросы ТОЛЬКО на основании реальных данных,
// распознаёт команды и фразы-планы. Ничего не меняет без подтверждения.

import { db } from '../../db.js';
import { listTasks, findTaskByTitle } from '../tasks.js';
import { getTodayView, whatDidIForget } from '../today.js';
import { planDay, unloadDay, freeSlots } from '../planner.js';
import { parsePhrase } from './parser.js';
import { parseCommand } from './commands.js';
import { uid } from '../../ctx.js';
import { getStats } from '../stats.js';
import { silentProjects } from '../today.js';
import { todayStr, addDays, humanDate, humanDuration, minToTime, weekdayName, diffDays } from '../../util/dates.js';

// Разные формулировки, чтобы ассистент не выглядел роботом
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export const SUGGESTIONS = [
  'Что у меня сегодня?',
  'Что на неделе?',
  'Что просрочено?',
  'Статистика недели',
  'Итоги месяца',
  'Сколько задач?',
  'Что я забыл?',
  'Распланируй мой день',
  'Перенеси всё на завтра',
];

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
  const frag = m[1].replace(/(монтажом|монтажа)/g, 'монтаж').trim();
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


// ---------- Новые сценарии (на правилах, без нейросетей) ----------

function answerGreeting() {
  const h = new Date().getHours();
  const part = h < 5 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер';
  const v = getTodayView();
  const n = v.timed.length + v.untimed.length;
  const tail = n
    ? pick([
      `На сегодня ${n} дел(а). Показать?`,
      `Сегодня в плане ${n} дел(а) — спросите «что сегодня», разложу по времени.`,
      `Дел на сегодня: ${n}. Готов помочь.`,
    ])
    : pick(['На сегодня ничего не запланировано — свободный день.',
      'Сегодня план пуст. Добавим что-нибудь?',
      'Задач на сегодня нет. Отдыхаем или планируем?']);
  return { kind: 'answer', text: `${part}! ${tail}` };
}

function answerHelp() {
  return {
    kind: 'answer',
    text: [
      'Вот что я умею 👇',
      '',
      '📋 Рассказать о делах:',
      '• «что у меня сегодня / завтра»',
      '• «что на неделе»',
      '• «что просрочено», «что я забыл»',
      '• «когда монтаж у Ивановых»',
      '• «что по проекту Кухня Ивановых»',
      '• «сколько задач»',
      '',
      '📊 Итоги:',
      '• «статистика недели»',
      '• «итоги месяца» (1-го числа сам пришлю в Telegram)',
      '',
      '✅ Выполнять команды:',
      '• «выполнил замер», «начни монтаж», «пауза Кухня Ивановых»',
      '• «перенеси замер на пятницу», «перенеси всё на завтра»',
      '• «напомни о договоре через 3 дня»',
      '• «распланируй день», «разгрузи день»',
      '',
      '✍️ Разобрать фразу в задачи:',
      '• «завтра в 10:00 замер у Петровых, потом отвезти фасады на объект»',
      '',
      'Любое изменение я сначала предлагаю — без вашего «Да» ничего не меняю.',
    ].join('\n'),
  };
}

function answerWeek() {
  const from = todayStr(), to = addDays(from, 6);
  const tasks = listTasks({ from, to, status: ACTIVE });
  if (!tasks.length) {
    return { kind: 'answer', text: pick(['На ближайшую неделю пусто — свободно.', 'В ближайшие 7 дней задач нет.']) };
  }
  const byDate = new Map();
  for (const t of tasks) {
    if (!t.date) continue;
    if (!byDate.has(t.date)) byDate.set(t.date, []);
    byDate.get(t.date).push(t);
  }
  const lines = [`На неделе ${tasks.length} дел(а):`];
  for (const [date, list] of [...byDate.entries()].sort()) {
    lines.push(`\n${humanDate(date)} (${weekdayName(date)}) — ${list.length}:`);
    for (const t of list.slice(0, 6)) lines.push(fmtTask(t));
    if (list.length > 6) lines.push(`  …и ещё ${list.length - 6}`);
  }
  return { kind: 'answer', text: lines.join('\n'), tasks };
}

export function weekStatsText() {
  const s = getStats();
  const lines = ['📊 Неделя в цифрах:'];
  lines.push(`• Выполнено: ${s.week_done}`);
  lines.push(`• Создано: ${s.week_created}`);
  lines.push(`• Открытых задач: ${s.open_total}`);
  lines.push(`• Просрочено: ${s.overdue}`);
  const best = [...s.days].sort((a, b) => b.done - a.done)[0];
  if (best && best.done) lines.push(`• Самый продуктивный день: ${humanDate(best.date)} — ${best.done} задач(и)`);
  if (s.chronic.length) {
    lines.push('\nЧасто переносится:');
    for (const c of s.chronic.slice(0, 3)) lines.push(`• ${c.title} — ${c.postponed_count} раз`);
  }
  const verdict = s.week_done > s.week_created ? 'Разгребаете быстрее, чем набирается — отлично! 👍'
    : s.week_done === 0 ? 'На этой неделе закрытых задач нет — с чего начнём?'
    : 'Держите темп.';
  lines.push('\n' + verdict);
  return lines.join('\n');
}

// Итоги месяца (по умолчанию — прошедший месяц, если сегодня 1–5 число)
export function monthSummaryText(monthOffset = null) {
  const now = new Date();
  const useePrev = monthOffset === null ? now.getDate() <= 5 : monthOffset < 0;
  const d = new Date(now.getFullYear(), now.getMonth() + (useePrev ? -1 : 0), 1);
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0');
  const from = `${y}-${m}-01`;
  const to = `${y}-${m}-${String(new Date(y, d.getMonth() + 1, 0).getDate()).padStart(2, '0')}`;
  const monthName = d.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });

  const done = db.prepare(`
    SELECT COUNT(*) AS c FROM tasks WHERE user_id = ? AND completed_at IS NOT NULL
      AND substr(completed_at,1,10) BETWEEN ? AND ?`).get(uid(), from, to).c;
  const created = db.prepare(`
    SELECT COUNT(*) AS c FROM tasks WHERE user_id = ? AND substr(created_at,1,10) BETWEEN ? AND ?`)
    .get(uid(), from, to).c;
  const projectsDone = db.prepare(`
    SELECT name FROM projects WHERE user_id = ? AND status = 'done'
      AND substr(updated_at,1,10) BETWEEN ? AND ?`).all(uid(), from, to);
  const money = db.prepare(`
    SELECT COALESCE(SUM(prepaid), 0) AS paid, COALESCE(SUM(price), 0) AS price,
           COALESCE(SUM(MAX(0, COALESCE(price,0) - COALESCE(prepaid,0))), 0) AS debt
    FROM projects WHERE user_id = ? AND status != 'archived'`).get(uid());
  const byType = db.prepare(`
    SELECT type, COUNT(*) AS c FROM tasks WHERE user_id = ? AND completed_at IS NOT NULL
      AND substr(completed_at,1,10) BETWEEN ? AND ? GROUP BY type ORDER BY c DESC LIMIT 3`).all(uid(), from, to);

  const lines = [`🗓 Итоги: ${monthName}`, ''];
  lines.push(`✅ Выполнено задач: ${done}`);
  lines.push(`➕ Создано задач: ${created}`);
  if (byType.length) lines.push(`🔝 Чаще всего: ${byType.map(t => `${t.type} (${t.c})`).join(', ')}`);
  if (projectsDone.length) lines.push(`🏁 Завершены проекты: ${projectsDone.map(p => p.name).join(', ')}`);
  lines.push(`💰 По деньгам: заказов на ${fmtMoney(money.price)}, получено ${fmtMoney(money.paid)}, должны ${fmtMoney(money.debt)}`);
  const silent = silentProjects();
  if (silent.length) lines.push(`😴 Молчат проекты: ${silent.map(p => `${p.name} (${p.days} дн.)`).join(', ')}`);
  lines.push('');
  lines.push(done > 0 ? pick(['Хороший месяц! 💪', 'Так держать!', 'Есть результат — двигаемся дальше.'])
    : 'В этом месяце закрытых задач не было.');
  return lines.join('\n');
}

function fmtMoney(v) {
  return `${Math.round(Number(v || 0)).toLocaleString('ru-RU')} ₽`;
}

function answerProject(text) {
  const m = text.match(/(?:по проекту|проект|проекте)\s+(.+?)\??$/);
  if (!m) return null;
  const frag = m[1].trim().replace(/^«|»$/g, '');
  const p = db.prepare(`SELECT * FROM projects WHERE user_id = ? AND nlower(name) LIKE nlower(?)
                        ORDER BY status = 'active' DESC LIMIT 1`).get(uid(), `%${frag}%`);
  if (!p) return { kind: 'answer', text: `Проект «${frag}» не нашёл. Проверьте название.` };

  const st = db.prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) AS done
                         FROM tasks WHERE project_id = ?`).get(p.id);
  const progress = st.total ? Math.round((st.done / st.total) * 100) : 0;
  const open = listTasks({ project_id: p.id, status: ACTIVE, limit: 5 });
  const debt = Math.max(0, Number(p.price || 0) - Number(p.prepaid || 0));

  const lines = [`📁 ${p.name}`];
  lines.push(`Статус: ${{ active: 'в работе', paused: 'на паузе', done: 'завершён', archived: 'в архиве' }[p.status] || p.status}` +
    (p.stage ? ` · этап: ${p.stage}` : ''));
  lines.push(`Прогресс: ${st.done || 0} из ${st.total || 0} задач (${progress}%)`);
  if (p.deadline) lines.push(`Дедлайн: ${humanDate(p.deadline)}`);
  if (p.price) lines.push(`Деньги: заказ ${fmtMoney(p.price)}, получено ${fmtMoney(p.prepaid || 0)}` +
    (debt > 0 ? `, остаток ${fmtMoney(debt)}` : ', закрыт полностью ✅'));
  if (open.length) {
    lines.push('\nБлижайшие задачи:');
    open.forEach(t => lines.push(fmtTask(t)));
  } else {
    lines.push('\n⚠ Открытых задач нет — добавьте следующее действие, иначе проект встанет.');
  }
  return { kind: 'answer', text: lines.join('\n'), tasks: open };
}

function answerWhen(text) {
  const m = text.match(/^когда\s+(?:будет\s+|у нас\s+|мне\s+)?(.+?)\??$/);
  if (!m) return null;
  const frag = m[1].trim();
  const tasks = findTaskByTitle(frag);
  if (!tasks.length) {
    const p = db.prepare(`SELECT * FROM projects WHERE user_id = ? AND nlower(name) LIKE nlower(?) LIMIT 1`)
      .get(uid(), `%${frag}%`);
    if (p?.deadline) return { kind: 'answer', text: `Проект «${p.name}» — дедлайн ${humanDate(p.deadline)}.` };
    return { kind: 'answer', text: `Не нашёл «${frag}» среди активных задач.` };
  }
  const t = tasks[0];
  if (!t.date) {
    return { kind: 'answer', text: `«${t.title}» пока без даты${t.deadline ? `, но дедлайн ${humanDate(t.deadline)}` : ''}.`, tasks };
  }
  const days = diffDays(todayStr(), t.date);
  const when = days === 0 ? 'сегодня' : days === 1 ? 'завтра' : days > 0 ? `через ${days} дн. — ${humanDate(t.date)}` : `${humanDate(t.date)} (уже прошло)`;
  return {
    kind: 'answer',
    text: `«${t.title}» — ${when}${t.time ? `, в ${t.time}` : ''}${t.project ? ` (проект «${t.project.name}»)` : ''}.`,
    tasks,
  };
}

function answerCount() {
  const open = db.prepare(`SELECT COUNT(*) AS c FROM tasks WHERE user_id = ? AND status NOT IN ('done','cancelled') AND parent_id IS NULL`).get(uid()).c;
  const today = db.prepare(`SELECT COUNT(*) AS c FROM tasks WHERE user_id = ? AND date = ? AND status NOT IN ('done','cancelled')`).get(uid(), todayStr()).c;
  const overdue = listTasks({ overdue: 1, status: ACTIVE, limit: 200 }).length;
  const done7 = db.prepare(`SELECT COUNT(*) AS c FROM tasks WHERE user_id = ? AND completed_at >= datetime('now','-7 days')`).get(uid()).c;
  return {
    kind: 'answer',
    text: [
      `Открытых задач: ${open}`,
      `Сегодня: ${today}`,
      `Просрочено: ${overdue}`,
      `Закрыто за 7 дней: ${done7}`,
    ].join('\n'),
  };
}

function answerSilent() {
  const list = silentProjects();
  if (!list.length) return { kind: 'answer', text: 'Все активные проекты в движении — молчунов нет. 👌' };
  return {
    kind: 'answer',
    text: 'Давно нет движения:\n' + list.map(p => `• ${p.name} — ${p.days} дн. (последнее ${humanDate(p.last_activity)})`).join('\n'),
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

  // 2) Приветствия и «что умеешь» — до всего остального
  if (/^(привет\S*|здравствуй\S*|добрый день|доброе утро|добрый вечер|доброй ночи|хай|салют|ку|йоу|здорово|доброго дня)(\s|[!,.?]|$)/.test(s)) {
    return answerGreeting();
  }
  if (/(что ты умеешь|что умеешь|твои возможности|help|помощь|подскажи что|чем поможешь|команды)/.test(s)) {
    return answerHelp();
  }
  if (/(спасибо|благодарю)/.test(s) && s.length < 25) {
    return { kind: 'answer', text: pick(['Пожалуйста! 🙂', 'Обращайтесь.', 'Всегда рад помочь.']) };
  }

  // 3) Итоги и статистика
  if (/(статистик|как прошла недел|итоги недел|неделя в цифрах)/.test(s)) {
    return { kind: 'answer', text: weekStatsText() };
  }
  if (/(итоги месяца|за месяц|месяц в цифрах|отчет за месяц|результаты месяца)/.test(s)) {
    return { kind: 'answer', text: monthSummaryText() };
  }
  if (/(что на недел|план на недел|на этой недел|ближайш[а-я]+ недел)/.test(s)) return answerWeek();
  if (/(молч|без движен|застоял|завис[а-я]* проект)/.test(s)) return answerSilent();
  if (/^сколько\s+(задач|дел|работы)/.test(s) || /сколько у меня задач/.test(s)) return answerCount();
  if (/(по проекту|^проект\s|о проекте)/.test(s)) { const r = answerProject(s); if (r) return r; }
  if (/^когда\s+/.test(s)) { const r = answerWhen(s); if (r) return r; }

  // 4) Вопросы
  // ВНИМАНИЕ: \b в JS не работает с кириллицей — границу слова задаём явно
  const isQuestion = /\?$/.test(s) || /^(что|какие|когда|сколько|где|кому|есть ли)(\s|$)/.test(s);
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

  // 5) Фраза-план
  const plan = parsePhrase(text);
  if (plan.items.length) return plan;

  return {
    kind: 'answer',
    text: pick([
      'Не совсем понял. Спросите «что у меня сегодня», «что на неделе», «итоги месяца» — или напишите «что ты умеешь».',
      'Хм, такую фразу не разобрал. Попробуйте иначе или напишите «что ты умеешь» — покажу список.',
      'Пока не понял задачу. Можно так: «завтра в 10:00 замер у Петровых» или «что просрочено?».',
    ]),
    suggestions: SUGGESTIONS,
  };
}
