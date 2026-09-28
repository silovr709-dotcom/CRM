export const TYPE_META: Record<string, { icon: string; label: string }> = {
  task: { icon: '☑️', label: 'Задача' },
  event: { icon: '📅', label: 'Событие' },
  trip: { icon: '🚗', label: 'Поездка' },
  purchase: { icon: '🛒', label: 'Покупка' },
  delivery: { icon: '🚚', label: 'Доставка' },
  work: { icon: '💻', label: 'Работа' },
  personal: { icon: '🏠', label: 'Личное' },
  call: { icon: '📞', label: 'Звонок' },
  meeting: { icon: '🤝', label: 'Встреча' },
  reminder: { icon: '⏰', label: 'Напоминание' },
};

export function typeIcon(t: string) { return TYPE_META[t]?.icon ?? '📌'; }
export function typeLabel(t: string) { return TYPE_META[t]?.label ?? t; }

export const STATUS_META: Record<string, { label: string; color: string }> = {
  inbox: { label: 'Входящие', color: '#8b8b94' },
  planned: { label: 'Запланирована', color: '#4f6ef7' },
  in_progress: { label: 'В работе', color: '#d97706' },
  done: { label: 'Выполнена', color: '#16a34a' },
  cancelled: { label: 'Отменена', color: '#9ca3af' },
  paused: { label: 'На паузе', color: '#8b5cf6' },
};

export const PRIORITY_META = [
  { value: 0, label: 'Обычный', color: '#9ca3af' },
  { value: 1, label: 'Важный', color: '#d97706' },
  { value: 2, label: 'Критичный', color: '#dc2626' },
];

export const RECUR_OPTIONS = [
  { value: '', label: 'Не повторяется' },
  { value: 'daily', label: 'Ежедневно' },
  { value: 'weekdays', label: 'По будням' },
  { value: 'weekly', label: 'Еженедельно' },
  { value: 'monthly', label: 'Ежемесячно' },
  { value: 'yearly', label: 'Ежегодно' },
];

export const MODE_META: Record<string, { label: string; hint: string }> = {
  fixed: { label: 'Жёсткая', hint: 'нельзя двигать' },
  flexible: { label: 'Гибкая', hint: 'можно двигать' },
  deadline: { label: 'К сроку', hint: 'важен только дедлайн' },
};
