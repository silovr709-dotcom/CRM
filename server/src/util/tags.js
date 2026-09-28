// Теги вида #замер, #срочно — прямо в названии задачи.
// ВАЖНО: \w и \b в JS не работают с кириллицей, поэтому класс символов задаём явно.
const TAG_RE = /#([0-9A-Za-zА-Яа-яЁё_-]{2,30})/g;

export function extractTags(text) {
  if (!text) return [];
  const out = new Set();
  for (const m of String(text).matchAll(TAG_RE)) out.add(m[1]);
  return [...out];
}

// Название без тегов — для аккуратного отображения
export function stripTags(text) {
  return String(text || '').replace(TAG_RE, '').replace(/\s{2,}/g, ' ').trim();
}
