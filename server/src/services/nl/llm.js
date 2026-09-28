// Адаптер внешнего LLM (OpenAI-совместимый API: OpenAI / OpenRouter / Ollama / vLLM…).
// Ключ берётся из настроек (локальная БД, в git не попадает) либо из переменных
// окружения LLM_API_KEY / LLM_API_URL / LLM_MODEL (env имеет приоритет).
//
// LLM используется для РАЗБОРА ФРАЗ (лучше понимает сложные формулировки).
// Ответы на вопросы («что у меня сегодня?») намеренно остаются на данных БД.
// При любой ошибке/таймауте — тихий фолбэк на встроенный парсер.

import { getSetting } from '../../db.js';
import { todayStr, humanDate, humanDuration } from '../../util/dates.js';

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
