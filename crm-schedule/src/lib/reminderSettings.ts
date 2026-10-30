// Проверка и «починка» настроек напоминаний из копии или старой версии.
// Отдельный модуль: storage.ts и так большой, а правил здесь много.
import type {
  DigestSettings, QuietHours, ReminderChannel, ReminderPriority, ReminderRule, ReminderSource,
  TaskReminder,
} from '../types';
import {
  defaultDigest, defaultQuietHours, defaultReminderRules, defaultTaskReminder,
} from './reminders';

const SOURCES: ReminderSource[] = [
  'install', 'measure', 'delivery', 'ready', 'task', 'contact', 'payment', 'stale', 'digest', 'custom',
];
const CHANNELS: ReminderChannel[] = ['inapp', 'browser', 'sound', 'title'];
const PRIORITIES: ReminderPriority[] = ['low', 'normal', 'high'];

function time(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return fallback;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return fallback;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function offsets(value: unknown, fallback: number[]): number[] {
  if (!Array.isArray(value)) return fallback;
  const clean = value
    .map((item) => Math.round(Number(item)))
    .filter((item) => Number.isFinite(item) && Math.abs(item) <= 60 * 24 * 30);
  const unique = Array.from(new Set(clean)).sort((left, right) => right - left);
  return unique.length > 0 ? unique.slice(0, 8) : fallback;
}

export function normalizeReminderRule(raw: Partial<ReminderRule>, fallback?: ReminderRule): ReminderRule | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = SOURCES.includes(raw.source as ReminderSource) ? raw.source as ReminderSource : fallback?.source;
  if (!source) return null;
  const channels = Array.isArray(raw.channels)
    ? raw.channels.filter((item): item is ReminderChannel => CHANNELS.includes(item as ReminderChannel))
    : fallback?.channels ?? ['inapp'];
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 60) : `rule-${Math.random().toString(36).slice(2, 8)}`,
    label: typeof raw.label === 'string' && raw.label.trim()
      ? raw.label.trim().slice(0, 80)
      : fallback?.label ?? 'Напоминание',
    enabled: raw.enabled !== false,
    source,
    offsets: offsets(raw.offsets, fallback?.offsets ?? [0]),
    atTime: time(raw.atTime, fallback?.atTime ?? '09:00'),
    channels: channels.length > 0 ? channels : ['inapp'],
    priority: PRIORITIES.includes(raw.priority as ReminderPriority) ? raw.priority as ReminderPriority : fallback?.priority ?? 'normal',
    onlyMine: Boolean(raw.onlyMine),
    respectQuietHours: raw.respectQuietHours !== false,
    repeatDaily: Boolean(raw.repeatDaily),
    staleDays: Number.isFinite(Number(raw.staleDays)) ? Math.max(1, Math.min(90, Math.round(Number(raw.staleDays)))) : fallback?.staleDays,
  };
}

export function normalizeReminderRules(raw: unknown): ReminderRule[] {
  if (!Array.isArray(raw)) return defaultReminderRules();
  const rules = raw
    .map((item) => normalizeReminderRule(item as Partial<ReminderRule>))
    .filter((item): item is ReminderRule => item !== null);
  return rules.length > 0 ? rules.slice(0, 40) : defaultReminderRules();
}

/** Личное напоминание задачи из копии или старой версии. */
export function normalizeTaskReminder(raw: unknown): TaskReminder | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const value = raw as Partial<TaskReminder>;
  const base = defaultTaskReminder();
  const channels = Array.isArray(value.channels)
    ? value.channels.filter((item): item is ReminderChannel => CHANNELS.includes(item as ReminderChannel))
    : base.channels ?? ['inapp'];
  return {
    enabled: value.enabled !== false,
    offsets: offsets(value.offsets, base.offsets),
    atTime: time(value.atTime, base.atTime ?? '09:00'),
    channels: channels.length > 0 ? channels : ['inapp'],
    priority: PRIORITIES.includes(value.priority as ReminderPriority)
      ? value.priority as ReminderPriority
      : base.priority ?? 'normal',
    repeatDaily: Boolean(value.repeatDaily),
    respectQuietHours: value.respectQuietHours !== false,
  };
}

export function normalizeQuietHours(raw: unknown): QuietHours {
  const base = defaultQuietHours();
  if (!raw || typeof raw !== 'object') return base;
  const value = raw as Partial<QuietHours>;
  return {
    enabled: value.enabled !== false,
    from: time(value.from, base.from),
    to: time(value.to, base.to),
    skipWeekends: value.skipWeekends !== false,
    mode: value.mode === 'skip' ? 'skip' : 'wait',
  };
}

export function normalizeDigest(raw: unknown): DigestSettings {
  const base = defaultDigest();
  if (!raw || typeof raw !== 'object') return base;
  const value = raw as Partial<DigestSettings>;
  const channels = Array.isArray(value.channels)
    ? value.channels.filter((item): item is ReminderChannel => CHANNELS.includes(item as ReminderChannel))
    : base.channels;
  return {
    enabled: value.enabled !== false,
    at: time(value.at, base.at),
    weekdaysOnly: value.weekdaysOnly !== false,
    channels: channels.length > 0 ? channels : base.channels,
  };
}
