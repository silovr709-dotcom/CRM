// Напоминания о монтажах, пока приложение открыто.
// Браузерные уведомления + встроенная плашка «скоро выезд».
import type { Deal } from '../types';
import { collectEvents, type ScheduleEvent } from './schedule';
import { daysBetween, minutesOf, todayISO } from './dates';

const SENT_KEY = 'crm-schedule.notified.v1';

export type NotifyPermission = 'unsupported' | 'default' | 'granted' | 'denied';

export function notifyPermission(): NotifyPermission {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission as NotifyPermission;
}

export async function askNotifyPermission(): Promise<NotifyPermission> {
  if (notifyPermission() === 'unsupported') return 'unsupported';
  try {
    return (await Notification.requestPermission()) as NotifyPermission;
  } catch {
    return notifyPermission();
  }
}

function sentKeys(): Record<string, true> {
  try {
    return JSON.parse(localStorage.getItem(SENT_KEY) ?? '{}') as Record<string, true>;
  } catch {
    return {};
  }
}

function markSent(key: string) {
  try {
    const keys = sentKeys();
    keys[key] = true;
    localStorage.setItem(SENT_KEY, JSON.stringify(keys));
  } catch {
    /* нечего сохранять */
  }
}

export interface DueReminder {
  event: ScheduleEvent;
  minutesLeft: number;
}

/** Что требует напоминания прямо сейчас: монтажи/замеры сегодня и скоро. */
export function dueReminders(
  deals: Deal[],
  now = new Date(),
  defaultMinutes = 60,
  clientName: (deal: Deal) => string = () => '',
): DueReminder[] {
  const today = todayISO();
  const current = now.getHours() * 60 + now.getMinutes();
  const result: DueReminder[] = [];

  for (const deal of deals) {
    const reminders = deal.schedule?.reminders?.length ? deal.schedule.reminders : [defaultMinutes];
    const before = Math.max(...reminders);
    for (const event of collectEvents([deal], clientName)) {
      if (event.date !== today) continue;
      if (event.kind !== 'install' && event.kind !== 'measure' && event.kind !== 'delivery') continue;
      if (event.status === 'done') continue;
      const start = minutesOf(deal.schedule?.timeStart);
      if (start === null) continue;
      const left = start - current;
      if (left < 0 || left > before) continue;
      result.push({ event, minutesLeft: left });
    }
  }
  return result.sort((left, right) => left.minutesLeft - right.minutesLeft);
}

/** Показывает браузерные уведомления один раз на событие. */
export function pushNotifications(reminders: DueReminder[]): number {
  if (notifyPermission() !== 'granted') return 0;
  const keys = sentKeys();
  let shown = 0;
  for (const reminder of reminders) {
    const key = `${reminder.event.id}:${todayISO()}`;
    if (keys[key]) continue;
    try {
      const title = reminder.minutesLeft <= 0
        ? `Сейчас: ${labelOf(reminder.event)}`
        : `Через ${reminder.minutesLeft} мин: ${labelOf(reminder.event)}`;
      new Notification(title, {
        body: [reminder.event.dealTitle, reminder.event.client, reminder.event.team, reminder.event.address]
          .filter(Boolean).join(' · '),
        tag: key,
      });
      markSent(key);
      shown += 1;
    } catch {
      break;
    }
  }
  return shown;
}

export function labelOf(event: ScheduleEvent): string {
  if (event.kind === 'install') return 'монтаж';
  if (event.kind === 'measure') return 'замер';
  if (event.kind === 'delivery') return 'доставка';
  return 'событие';
}

/** Ближайший монтаж на сегодня для плашки в шапке. */
export function todayInstallHint(deals: Deal[], now = new Date()): string {
  const today = todayISO();
  const events = collectEvents(deals).filter((event) => event.date === today && event.kind === 'install');
  if (events.length === 0) return '';
  const withTime = events
    .map((event) => ({ event, start: minutesOf(deals.find((deal) => deal.id === event.dealId)?.schedule.timeStart) }))
    .sort((left, right) => (left.start ?? 24 * 60) - (right.start ?? 24 * 60))[0];
  const current = now.getHours() * 60 + now.getMinutes();
  const left = withTime.start === null ? null : withTime.start - current;
  const when = left === null ? 'сегодня' : left > 0 ? `через ${Math.round(left / 60 * 10) / 10} ч` : 'сейчас';
  return `${events.length} монтаж${events.length === 1 ? '' : 'а'} сегодня · ${when}: ${withTime.event.dealTitle}`;
}

export function clearNotificationHistory(): void {
  try {
    localStorage.removeItem(SENT_KEY);
  } catch {
    /* нечего чистить */
  }
}

export { daysBetween };
