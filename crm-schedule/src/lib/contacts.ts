/* Журнал общения с клиентом: один клик «позвонил / не взял / написал» —
 * запись в историю, следующий контакт и честный «дней без связи». */

import type { ContactChannel, ContactEntry, ContactOutcome } from '../types';
import { addDays, daysBetween, fmtDateTime } from './dates';

export const CONTACT_CHANNELS: ContactChannel[] = ['call', 'whatsapp', 'telegram', 'sms', 'email', 'meeting'];
export const CONTACT_OUTCOMES: ContactOutcome[] = ['reached', 'noAnswer', 'messaged', 'scheduled', 'declined'];

interface Meta<T extends string> {
  id: T;
  label: string;
  icon: string;
  /** Что сделать дальше — подсказка в интерфейсе. */
  hint: string;
}

export const CHANNEL_META: Record<ContactChannel, Meta<ContactChannel>> = {
  call: { id: 'call', label: 'Звонок', icon: '☎', hint: 'Позвонили' },
  whatsapp: { id: 'whatsapp', label: 'WhatsApp', icon: '✆', hint: 'Написали в WhatsApp' },
  telegram: { id: 'telegram', label: 'Telegram', icon: '✈', hint: 'Написали в Telegram' },
  sms: { id: 'sms', label: 'СМС', icon: '✉', hint: 'Отправили СМС' },
  email: { id: 'email', label: 'Почта', icon: '@', hint: 'Написали на почту' },
  meeting: { id: 'meeting', label: 'Встреча', icon: '◆', hint: 'Встретились' },
};

export const OUTCOME_META: Record<ContactOutcome, Meta<ContactOutcome>> = {
  reached: { id: 'reached', label: 'Поговорили', icon: '✓', hint: 'Клиент ответил, договорились о следующем шаге' },
  noAnswer: { id: 'noAnswer', label: 'Не взял', icon: '✕', hint: 'Не ответил — попробуем ещё раз' },
  messaged: { id: 'messaged', label: 'Написал', icon: '✉', hint: 'Отправили сообщение, ждём ответа' },
  scheduled: { id: 'scheduled', label: 'Договорились', icon: '⚑', hint: 'Назначили замер, встречу или монтаж' },
  declined: { id: 'declined', label: 'Отказ', icon: '⊘', hint: 'Клиент отказался' },
};

/**
 * Через сколько дней вернуться к клиенту после такого результата.
 * `undefined` — срок ставится вручную (договорились о дате) или не нужен (отказ).
 */
export const CONTACT_RULE_DAYS: Record<ContactOutcome, number | undefined> = {
  reached: 2,
  noAnswer: 1,
  messaged: 3,
  scheduled: undefined,
  declined: undefined,
};

export function channelMeta(channel: ContactChannel | undefined): Meta<ContactChannel> | undefined {
  return channel ? CHANNEL_META[channel] : undefined;
}

export function outcomeMeta(outcome: ContactOutcome | undefined): Meta<ContactOutcome> | undefined {
  return outcome ? OUTCOME_META[outcome] : undefined;
}

/** Следующий контакт по правилу; `days` — если хотим свой срок. */
export function nextContactAfter(outcome: ContactOutcome, today: string, days?: number): string | undefined {
  const rule = days ?? CONTACT_RULE_DAYS[outcome];
  return rule === undefined ? undefined : addDays(today, rule);
}

export interface ContactInput {
  channel: ContactChannel;
  outcome: ContactOutcome;
  /** Дата и время касания, ISO. По умолчанию — сейчас. */
  at?: string;
  author?: string;
  note?: string;
  /** Свой срок следующего контакта, YYYY-MM-DD. */
  nextAt?: string;
  today?: string;
}

export interface ContactResult {
  entry: ContactEntry;
  /** Готовая запись в историю сделки. */
  history: { kind: 'contact'; title: string; text?: string };
  /** Чему стал равен `nextContactAt` (undefined — снять срок). */
  nextContactAt: string | undefined;
}

/** Чистая логика одного касания: её же вызывает store. */
export function buildContact(input: ContactInput): ContactResult {
  const at = input.at ?? new Date().toISOString();
  const today = input.today ?? at.slice(0, 10);
  const nextAt = input.nextAt !== undefined
    ? (input.nextAt || undefined)
    : nextContactAfter(input.outcome, today);
  const channel = CHANNEL_META[input.channel];
  const outcome = OUTCOME_META[input.outcome];
  const note = input.note?.trim() || '';

  const entry: ContactEntry = {
    id: `contact-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    at,
    channel: input.channel,
    outcome: input.outcome,
    author: input.author || undefined,
    note: note || undefined,
    nextAt,
  };

  const detail = [
    `${channel.label} · ${outcome.label}`,
    note || undefined,
    nextAt ? `следующий контакт ${nextAt}` : undefined,
  ].filter(Boolean).join(' · ');

  return {
    entry,
    history: {
      kind: 'contact',
      title: `Связь: ${outcome.label.toLowerCase()}`,
      text: detail,
    },
    nextContactAt: nextAt,
  };
}

/** Ставит/сдвигает срок контакта, ничего не записывая в журнал (отложить). */
export function snoozeContact(today: string, days: number): string {
  return addDays(today, days);
}

export interface ContactSummary {
  total: number;
  last?: ContactEntry;
  /** Сколько дней прошло с последнего касания; undefined — касаний не было. */
  daysSince?: number;
  /** Сколько раз подряд не отвечали в конце журнала. */
  noAnswerStreak: number;
  /** Говорили ли с клиентом хоть раз. */
  reached: boolean;
}

export function contactSummary(contacts: ContactEntry[] | undefined, today: string): ContactSummary {
  const list = [...(contacts ?? [])].sort((left, right) => right.at.localeCompare(left.at));
  const last = list[0];
  let noAnswerStreak = 0;
  for (const item of list) {
    if (item.outcome !== 'noAnswer') break;
    noAnswerStreak += 1;
  }
  return {
    total: list.length,
    last,
    daysSince: last ? Math.max(0, daysBetween(last.at.slice(0, 10), today)) : undefined,
    noAnswerStreak,
    reached: list.some((item) => item.outcome === 'reached' || item.outcome === 'scheduled'),
  };
}

/** «Сегодня», «вчера», «5 дней назад», «нет связи». */
export function sinceLabel(days?: number): string {
  if (days === undefined) return 'связи не было';
  if (days === 0) return 'связь сегодня';
  if (days === 1) return 'связь вчера';
  if (days < 5) return `связь ${days} дня назад`;
  return `связь ${days} дней назад`;
}

/** Подпись последнего касания для карточки: «Звонок · поговорили · 12 окт, 14:03». */
export function contactLine(entry?: ContactEntry): string {
  if (!entry) return 'Связи ещё не было';
  const channel = CHANNEL_META[entry.channel]?.label ?? 'Контакт';
  const outcome = OUTCOME_META[entry.outcome]?.label.toLowerCase() ?? '';
  return [channel, outcome, fmtDateTime(entry.at)].filter(Boolean).join(' · ');
}

/** Дней без связи — для подсветки «пора звонить», даже если срок не задан. */
export const QUIET_DAYS = 10;

export function quietTooLong(summary: ContactSummary): boolean {
  return summary.daysSince !== undefined && summary.daysSince >= QUIET_DAYS;
}
