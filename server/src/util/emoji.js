const MAP = {
  task: '☑️', event: '📅', trip: '🚗', purchase: '🛒', delivery: '🚚',
  work: '💻', personal: '🏠', call: '📞', meeting: '🤝', reminder: '⏰',
};

export function typeEmoji(type) {
  return MAP[type] || '📌';
}
