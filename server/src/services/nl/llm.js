// Адаптер внешнего LLM. Контракт для будущего подключения (OpenAI / Anthropic / локальная модель).
// Ключи НЕ хранятся в репозитории — только переменные окружения.
//
// Если LLM_API_URL и LLM_API_KEY заданы, parsePhrase может делегировать разбор внешней модели
// (та должна вернуть JSON того же формата: { items: [{title,type,date,time,duration_min,depends_on_prev}] }).
// Иначе работает встроенный разбор (services/nl/parser.js).

export function llmAvailable() {
  return Boolean(process.env.LLM_API_URL && process.env.LLM_API_KEY);
}

export async function llmParse(text, context = {}) {
  if (!llmAvailable()) return null;
  const res = await fetch(process.env.LLM_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.LLM_API_KEY}`,
    },
    body: JSON.stringify({
      task: 'parse_actions',
      text,
      context,
      schema: {
        items: [{ title: 'string', type: 'task|event|trip|purchase|delivery|work|call|meeting|reminder', date: 'YYYY-MM-DD', time: 'HH:MM|null', duration_min: 'number', depends_on_prev: 'boolean' }],
      },
    }),
  });
  if (!res.ok) return null;
  return res.json();
}
