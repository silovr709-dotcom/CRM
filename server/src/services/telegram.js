// Telegram-бот: полноценный канал органайзера.
//  - любой текст → тот же AI-слой (разбор фраз, команды, вопросы);
//  - планы и команды подтверждаются инлайн-кнопками (ничего не меняется без подтверждения);
//  - напоминания приходят в чат, задачи с временем — за N минут до начала;
//  - утренний брифинг и вечерний разбор по расписанию.
// Работает через long polling — не нужен внешний URL. Токен хранится в настройках (БД),
// НЕ в коде и не в репозитории.

import { db, getSetting, setSetting } from '../db.js';
import { smartMessage } from './nl/smart.js';
import { executeCommand } from './nl/commands.js';
import { applyPlanItems } from './nl/apply.js';
import { applyPlan } from './planner.js';
import { getTodayView } from './today.js';
import { todayStr, nowTimeStr, humanDate, humanDuration, timeToMin, addDays } from '../util/dates.js';
import { typeEmoji } from '../util/emoji.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const pending = new Map(); // key → {type, payload}; подтверждения кнопок
let pendingSeq = 1;
const notifiedTasks = new Set(); // 'date:id' — чтобы не дублировать пуши о задачах

function api(method) {
  const token = getSetting('telegram_token', '');
  return `https://api.telegram.org/bot${token}/${method}`;
}

async function call(method, body) {
  try {
    const res = await fetch(api(method), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return await res.json();
  } catch {
    return { ok: false };
  }
}

export async function sendMessage(chatId, text, keyboard = null) {
  return call('sendMessage', {
    chat_id: chatId,
    text: text.slice(0, 4000),
    ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
  });
}

export async function tgStatus() {
  const token = getSetting('telegram_token', '');
  if (!token) return { configured: false, linked: false };
  const me = await call('getMe', {});
  return {
    configured: true,
    valid: Boolean(me.ok),
    bot_username: me.ok ? me.result.username : null,
    linked: Boolean(getSetting('telegram_chat_id', '')),
  };
}

// ---------- форматирование ----------
function fmtItems(items) {
  return items.map(it =>
    `${it.time ? it.time + ' ' : ''}${typeEmoji(it.type)} ${it.title}${it.depends_on_prev ? ' ⤷' : ''}`
  ).join('\n');
}

function briefingText(v) {
  const b = v.briefing;
  const lines = [`☀️ Доброе утро! ${humanDate(v.date)}`];
  lines.push(`📅 ${b.events_count} событий · ☑️ ${b.tasks_count} задач · 🚗 ${b.trips_count} поездок` +
    (b.overdue_count ? ` · 🔴 ${b.overdue_count} просрочено` : ''));
  lines.push(`⏱ Свободно: ${b.free_human || '0 мин'}`);
  if (v.timed.length) {
    lines.push('\nПо времени:');
    for (const t of v.timed) lines.push(`${t.time} ${typeEmoji(t.type)} ${t.title}`);
  }
  if (v.untimed.length) {
    lines.push('\nПросто сделать:');
    for (const t of v.untimed) lines.push(`• ${t.title}`);
  }
  if (b.first) lines.push(`\nПервая задача: ${b.first.time} — ${b.first.title}`);
  return lines.join('\n');
}

function eveningText(v) {
  const e = v.evening;
  const lines = [`🌙 Вечерний разбор · ${humanDate(v.date)}`];
  lines.push(`Выполнено: ${e.done_count} · Перенесено: ${e.moved_count} · Не выполнено: ${e.undone.length}`);
  if (e.undone.length) {
    lines.push('\nОсталось:');
    for (const u of e.undone) lines.push(`• ${u.title}`);
  }
  return lines.join('\n');
}

// ---------- обработка сообщений ----------
async function handleText(chatId, text) {
  const t = text.trim();

  if (t === '/start') {
    setSetting('telegram_chat_id', String(chatId));
    await sendMessage(chatId,
      '👋 Привет! Я — ваш органайзер.\n\n' +
      'Пишите обычным языком:\n«Завтра утром съездить на склад, забрать фасады, потом отвезти на объект»\n\n' +
      'Или спрашивайте:\n«Что у меня сегодня?» · «Что просрочено?» · «Что я забыл?»\n\n' +
      'Команды:\n/today — план на сегодня\n/tomorrow — что завтра\n/brief — утренний брифинг\n/evening — вечерний разбор\n\n' +
      '✅ Сюда будут приходить напоминания и брифинги.');
    return;
  }
  if (t === '/today') return answerAndSend(chatId, 'Что у меня сегодня?');
  if (t === '/tomorrow') return answerAndSend(chatId, 'Что у меня завтра?');
  if (t === '/brief') return sendMessage(chatId, briefingText(getTodayView()));
  if (t === '/evening') return sendMessage(chatId, eveningText(getTodayView()));
  if (t === '/help') return handleText(chatId, '/start');

  return answerAndSend(chatId, t);
}

async function answerAndSend(chatId, text) {
  let res;
  try {
    res = await smartMessage(text);
  } catch {
    return sendMessage(chatId, 'Не смог разобрать. Попробуйте иначе.');
  }

  if (res.kind === 'plan' && res.items?.length) {
    const key = String(pendingSeq++);
    pending.set(key, { type: 'plan', items: res.items });
    const extra = [...(res.assumptions || []), ...(res.questions || [])].map(x => '💡 ' + x).join('\n');
    await sendMessage(chatId,
      `${res.summary}\n\n${fmtItems(res.items)}${extra ? '\n\n' + extra : ''}`,
      [[{ text: '✅ Создать план', callback_data: `ok:${key}` }, { text: '❌ Отмена', callback_data: `no:${key}` }]]);
    return;
  }

  if (res.kind === 'command') {
    const key = String(pendingSeq++);
    pending.set(key, { type: 'command', cmd: res });
    const cand = res.candidates?.length
      ? '\n→ ' + res.candidates[0].title + (res.candidates.length > 1 ? ` (и ещё ${res.candidates.length - 1} похожих)` : '')
      : '';
    await sendMessage(chatId, `${res.text || 'Выполнить команду?'}${cand}`,
      [[{ text: '✅ Да', callback_data: `ok:${key}` }, { text: '❌ Нет', callback_data: `no:${key}` }]]);
    return;
  }

  if (res.kind === 'plan_day') {
    if (!res.placed?.length) return sendMessage(chatId, res.summary || 'Планировать нечего.');
    const key = String(pendingSeq++);
    pending.set(key, { type: 'plan_day', placed: res.placed });
    await sendMessage(chatId,
      `${res.summary}\n\n${res.placed.map(p => `${p.time} ${typeEmoji(p.type)} ${p.title}`).join('\n')}`,
      [[{ text: '✅ Применить', callback_data: `ok:${key}` }, { text: '❌ Отмена', callback_data: `no:${key}` }]]);
    return;
  }

  if (res.kind === 'unload') {
    const lines = (res.suggestions || []).map(s => `• ${s.title} — ${s.reason}`);
    return sendMessage(chatId, `${res.summary}${lines.length ? '\n\n' + lines.join('\n') : ''}`);
  }

  return sendMessage(chatId, res.text || res.summary || 'Готово.');
}

async function handleCallback(cb) {
  const [action, key] = String(cb.data || '').split(':');
  const item = pending.get(key);
  await call('answerCallbackQuery', { callback_query_id: cb.id });
  const chatId = cb.message.chat.id;

  if (!item) return sendMessage(chatId, 'Это предложение уже неактуально.');
  pending.delete(key);

  if (action === 'no') return sendMessage(chatId, 'Отменено — ничего не меняю.');

  try {
    if (item.type === 'plan') {
      const created = applyPlanItems(item.items);
      return sendMessage(chatId, `✅ Создано задач: ${created.length}`);
    }
    if (item.type === 'command') {
      const r = executeCommand(item.cmd);
      return sendMessage(chatId, (r.ok ? '✅ ' : '⚠️ ') + r.text);
    }
    if (item.type === 'plan_day') {
      const applied = applyPlan(item.placed);
      return sendMessage(chatId, `✅ План применён: ${applied.length} задач расставлены по времени`);
    }
  } catch (e) {
    return sendMessage(chatId, '⚠️ Не получилось: ' + e.message);
  }
}

// ---------- long polling ----------
let offset = 0;

export function startTelegramLoop() {
  (async () => {
    // сброс накопившихся апдейтов при старте
    while (true) {
      const token = getSetting('telegram_token', '');
      if (!token) { await sleep(5000); continue; }
      try {
        const res = await fetch(api('getUpdates') + `?timeout=25&offset=${offset}`, {
          signal: AbortSignal.timeout(35000),
        });
        const data = await res.json();
        if (!data.ok) { await sleep(5000); continue; }
        for (const u of data.result) {
          offset = u.update_id + 1;
          try {
            if (u.message?.text) await handleText(u.message.chat.id, u.message.text);
            else if (u.callback_query) await handleCallback(u.callback_query);
          } catch (e) {
            console.error('tg update error:', e.message);
          }
        }
      } catch {
        await sleep(5000);
      }
    }
  })();
}

// ---------- планировщик уведомлений ----------
export function startTelegramScheduler() {
  setInterval(async () => {
    const chatId = getSetting('telegram_chat_id', '');
    const token = getSetting('telegram_token', '');
    if (!chatId || !token) return;

    const today = todayStr();
    const now = nowTimeStr();

    // 1. Напоминания, чьё время пришло
    const due = db.prepare(`
      SELECT * FROM reminders WHERE status = 'pending' AND notified_at IS NULL
        AND (remind_date < ? OR (remind_date = ? AND (remind_time IS NULL OR remind_time <= ?)))`)
      .all(today, today, now);
    for (const r of due) {
      await sendMessage(chatId, `⏰ Напоминание: ${r.title}`);
      db.prepare(`UPDATE reminders SET notified_at = datetime('now') WHERE id = ?`).run(r.id);
    }

    // 2. Задачи с временем — за N минут до начала
    const before = Number(getSetting('notify_before_min', '15'));
    const nowMin = timeToMin(now);
    const upcoming = db.prepare(`
      SELECT * FROM tasks WHERE date = ? AND time IS NOT NULL AND status IN ('planned','in_progress')`)
      .all(today);
    for (const t of upcoming) {
      const key = `${today}:${t.id}`;
      const startMin = timeToMin(t.time);
      if (!notifiedTasks.has(key) && startMin - nowMin <= before && startMin - nowMin > 0) {
        notifiedTasks.add(key);
        await sendMessage(chatId,
          `🔔 Через ${startMin - nowMin} мин: ${t.time} — ${t.title}` +
          (t.location || t.location_to ? `\n📍 ${t.location || t.location_to}` : ''));
      }
    }

    // 3. Утренний брифинг
    const morning = getSetting('brief_morning', '08:00');
    if (now >= morning && getSetting('last_brief_date', '') !== today) {
      setSetting('last_brief_date', today);
      await sendMessage(chatId, briefingText(getTodayView()));
    }

    // 4. Вечерний разбор (+ кнопка переноса)
    const evening = getSetting('brief_evening', '20:30');
    if (now >= evening && getSetting('last_evening_date', '') !== today) {
      setSetting('last_evening_date', today);
      const v = getTodayView();
      if (v.evening.undone.length) {
        const key = String(pendingSeq++);
        pending.set(key, {
          type: 'command',
          cmd: { command: 'carry_over_ids', ids: v.evening.undone.map(u => u.id) },
        });
        await sendMessage(chatId, eveningText(v) + '\n\nПеренести невыполненные на завтра?',
          [[{ text: '✅ Перенести', callback_data: `ok:${key}` }, { text: '❌ Оставить', callback_data: `no:${key}` }]]);
      } else {
        await sendMessage(chatId, eveningText(v));
      }
    }
  }, 60000);
}
