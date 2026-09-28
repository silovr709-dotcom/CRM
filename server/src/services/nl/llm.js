// Адаптер внешнего LLM (OpenAI-совместимый API: OpenAI / OpenRouter / Ollama / vLLM…).
// Ключ берётся из настроек (локальная БД, в git не попадает) либо из переменных
// окружения LLM_API_KEY / LLM_API_URL / LLM_MODEL (env имеет приоритет).
//
// LLM используется для РАЗБОРА ФРАЗ (лучше понимает сложные формулировки).
// Ответы на вопросы («что у меня сегодня?») намеренно остаются на данных БД.
// При любой ошибке/таймауте — тихий фолбэк на встроенный парсер.

import { getSetting, db } from '../../db.js';
import { todayStr, nowTimeStr, addDays, humanDate, humanDuration } from '../../util/dates.js';

function cfg() {
  const key = process.env.LLM_API_KEY || getSetting('llm_api_key', '');
  const url = process.env.LLM_API_URL || getSetting('llm_api_url', '') || 'https://api.openai.com/v1/chat/completions';
  const model = process.env.LLM_MODEL || getSetting('llm_model', '') || 'gpt-4o-mini';
  return { key, url, model, source: process.env.LLM_API_KEY ? 'env' : (key ? 'settings' : null) };
}

export function llmAvailable() {
  return Boolean(cfg().key);
}

export function llmStatus() {
  const c = cfg();
  return {
    available: Boolean(c.key),
    model: c.key ? c.model : null,
    url: c.key ? c.url : null,
    source: c.source,
  };
}

// Проверка ключа реальным мини-запросом
export async function llmTest() {
  const c = cfg();
  if (!c.key) return { ok: false, error: 'Ключ не задан' };
  try {
    const res = await fetch(c.url, {
      method: 'POST',
      signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.key}` },
      body: JSON.stringify({
        model: c.model,
        max_tokens: 5,
        messages: [{ role: 'user', content: 'Ответь одним словом: ок' }],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, error: `HTTP ${res.status}${res.status === 401 ? ' — ключ не принят' : ''}${res.status === 404 ? ' — проверьте URL/модель' : ''}`, detail: body.slice(0, 200) };
    }
    return { ok: true, model: c.model };
  } catch (e) {
    if (e.name === 'TimeoutError') return { ok: false, error: 'Таймаут — API недоступен' };
    if (String(e.message).includes('fetch failed')) return { ok: false, error: 'Нет соединения с API — проверьте интернет/URL' };
    return { ok: false, error: e.message };
  }
}

const TYPES = ['task', 'event', 'trip', 'purchase', 'delivery', 'work', 'personal', 'call', 'meeting'];

function buildSystemPrompt() {
  return `Ты — парсер задач персонального органайзера. Разбери фразу пользователя (русский язык) на отдельные действия.
Сегодня: ${todayStr()}.
Верни СТРОГО JSON без пояснений: {"items":[{"title":string,"type":string,"date":"YYYY-MM-DD","time":"HH:MM"|null,"duration_min":number,"depends_on_prev":boolean,"is_reminder":boolean}]}
Правила:
- type из списка: ${TYPES.join(', ')};
- title — короткий глагольный заголовок с большой буквы, без дат и времени;
- если время не указано, но действия идут цепочкой — расставь разумные времена (утро 09:00, вечер 18:00, поездка ~40 мин, доставка ~60, звонок ~15, работа ~120);
- depends_on_prev=true, если действие логически после предыдущего;
- is_reminder=true для «не забыть…» / «напомни…»;
- если дата не указана — сегодня.`;
}

export async function llmParsePhrase(text) {
  const c = cfg();
  if (!c.key) return null;
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 12000);
    const res = await fetch(c.url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${c.key}`,
      },
      body: JSON.stringify({
        model: c.model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: buildSystemPrompt() },
          { role: 'user', content: text },
        ],
      }),
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;
    const parsed = JSON.parse(content);
    const items = (parsed.items || [])
      .filter(it => it && it.title && it.date)
      .map(it => ({
        title: String(it.title).slice(0, 200),
        type: TYPES.includes(it.type) ? it.type : 'task',
        date: it.date,
        time: it.time || null,
        duration_min: Number(it.duration_min) || 30,
        depends_on_prev: Boolean(it.depends_on_prev),
        is_reminder: Boolean(it.is_reminder),
        recurrence: null,
        schedule_mode: it.time ? 'fixed' : 'flexible',
      }));
    if (!items.length) return null;
    const total = items.reduce((a, i) => a + i.duration_min, 0);
    return {
      kind: 'plan',
      source: 'llm',
      date: items[0].date,
      items,
      assumptions: [],
      questions: [],
      summary: `Вижу ${items.length} действ${items.length === 1 ? 'ие' : items.length < 5 ? 'ия' : 'ий'} на ${humanDate(items[0].date)}. Суммарно примерно ${humanDuration(total)}. Создать план?`,
    };
  } catch {
    return null; // фолбэк на встроенный парсер
  }
}

// ---------- Полноценный чат-режим ----------
// LLM получает СНИМОК реальных данных (сегодня, просрочка, неделя, проекты)
// и сам решает: это новый план (→ подтверждение) или вопрос (→ живой ответ).

function normalizeItems(raw) {
  return (raw || [])
    .filter(it => it && it.title)
    .map(it => ({
      title: String(it.title).slice(0, 200),
      type: TYPES.includes(it.type) ? it.type : 'task',
      date: /^\d{4}-\d{2}-\d{2}$/.test(String(it.date || '')) ? it.date : todayStr(),
      time: /^\d{2}:\d{2}$/.test(String(it.time || '')) ? it.time : null,
      duration_min: Number(it.duration_min) || 30,
      depends_on_prev: Boolean(it.depends_on_prev),
      is_reminder: Boolean(it.is_reminder),
      recurrence: null,
      schedule_mode: it.time ? 'fixed' : 'flexible',
    }));
}

async function buildContext() {
  const { getTodayView } = await import('../today.js');
  const v = getTodayView();
  const c = (t) => ({ title: t.title, type: t.type, date: t.date, time: t.time || null, status: t.status });
  const upcoming = db.prepare(`
    SELECT title, type, date, time, status FROM tasks
    WHERE date > ? AND date <= ? AND status IN ('inbox','planned','in_progress')
    ORDER BY date, time LIMIT 30`).all(todayStr(), addDays(todayStr(), 7));
  const projects = db.prepare(`SELECT name, status FROM projects WHERE status IN ('active','paused') LIMIT 15`).all();
  return {
    now: `${todayStr()} ${nowTimeStr()}`,
    today_timed: v.timed.map(c),
    today_untimed: v.untimed.map(c),
    overdue: (v.attention || []).slice(0, 15).map(c),
    free_slots_today: v.free_slots,
    next_7_days: upcoming,
    projects,
    reminders: (v.reminders || []).slice(0, 10).map(r => ({ title: r.title, date: r.remind_date, time: r.remind_time })),
  };
}

export async function llmAssist(text) {
  const conf = cfg();
  if (!conf.key) return null;
  try {
    const ctx = await buildContext();
    const sys = `Ты — личный ассистент-органайзер. Общайся живо и по-русски. Сегодня ${todayStr()}, сейчас ${nowTimeStr()}.
Ниже КОНТЕКСТ — реальные задачи/проекты/напоминания пользователя. Отвечай ТОЛЬКО на основе этих данных, ничего не выдумывай.
Верни СТРОГО JSON одного из двух видов:
1) Пользователь описывает НОВЫЕ дела, которые надо запланировать →
   {"mode":"plan","items":[{"title":string,"type":string,"date":"YYYY-MM-DD","time":"HH:MM"|null,"duration_min":number,"depends_on_prev":boolean,"is_reminder":boolean}],"comment":string}
   type из: ${TYPES.join(', ')}; title — короткий глагольный заголовок без дат; depends_on_prev=true если действие по смыслу после предыдущего; дата не названа → сегодня; comment — одна фраза о твоих допущениях.
2) Всё остальное (вопрос, совет, разговор, анализ дня) →
   {"mode":"answer","answer":string}
   Отвечай кратко, конкретно, дружелюбно; можно эмодзи и переносы строк; ссылайся на реальные задачи из контекста. Если данных нет — честно скажи. НИКОГДА не утверждай, что уже создал/изменил/удалил что-то: изменения делаются только через план с подтверждением.
КОНТЕКСТ: ${JSON.stringify(ctx)}`;
    const res = await fetch(conf.url, {
      method: 'POST',
      signal: AbortSignal.timeout(20000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${conf.key}` },
      body: JSON.stringify({
        model: conf.model,
        temperature: 0.4,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: text },
        ],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;
    const parsed = JSON.parse(content);

    if (parsed.mode === 'plan') {
      const items = normalizeItems(parsed.items);
      if (!items.length) return null;
      const total = items.reduce((a, i) => a + i.duration_min, 0);
      return {
        kind: 'plan',
        source: 'llm',
        date: items[0].date,
        items,
        assumptions: parsed.comment ? [String(parsed.comment)] : [],
        questions: [],
        summary: `🧠 Понял так — ${items.length} шаг${items.length === 1 ? '' : items.length < 5 ? 'а' : 'ов'} на ${humanDate(items[0].date)}, примерно ${humanDuration(total)}. Создать план?`,
      };
    }
    if (parsed.mode === 'answer' && parsed.answer) {
      return { kind: 'answer', source: 'llm', text: String(parsed.answer).slice(0, 3500) };
    }
    return null;
  } catch {
    return null; // фолбэк на встроенный слой
  }
}
