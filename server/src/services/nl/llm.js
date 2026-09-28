// Адаптер внешнего LLM (OpenAI-совместимый API: OpenAI / OpenRouter / Ollama / vLLM…).
// Ключи ТОЛЬКО из переменных окружения — в репозитории не хранятся.
//
//   LLM_API_KEY  — ключ (обязателен для включения)
//   LLM_API_URL  — endpoint (по умолчанию https://api.openai.com/v1/chat/completions)
//   LLM_MODEL    — модель (по умолчанию gpt-4o-mini)
//
// LLM используется для РАЗБОРА ФРАЗ (лучше понимает сложные формулировки).
// Ответы на вопросы («что у меня сегодня?») намеренно остаются на данных БД.
// При любой ошибке/таймауте — тихий фолбэк на встроенный парсер.

import { todayStr, humanDate, humanDuration } from '../../util/dates.js';

const API_URL = process.env.LLM_API_URL || 'https://api.openai.com/v1/chat/completions';
const MODEL = process.env.LLM_MODEL || 'gpt-4o-mini';

export function llmAvailable() {
  return Boolean(process.env.LLM_API_KEY);
}

export function llmStatus() {
  return { available: llmAvailable(), model: llmAvailable() ? MODEL : null, url: llmAvailable() ? API_URL : null };
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
  if (!llmAvailable()) return null;
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 12000);
    const res = await fetch(API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
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
