// Доставка напоминаний: уведомление системы, звук, заголовок вкладки, вибрация.
// Логика «когда напоминать» живёт в reminders.ts — здесь только каналы.
import type { ReminderChannel, ReminderPriority } from '../types';
import type { PlannedReminder } from './reminders';

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

/* ------------------------------ уведомления ------------------------------ */

export interface BrowserPayload {
  title: string;
  body: string;
  tag?: string;
  /** Не будить звуком системы, если свой сигнал. */
  silent?: boolean;
  high?: boolean;
  onClick?: () => void;
}

/** Показывает системное уведомление. Через service worker — работает и на телефоне. */
export async function showBrowserNotification(payload: BrowserPayload): Promise<boolean> {
  if (notifyPermission() !== 'granted') return false;

  try {
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration?.showNotification) {
        await registration.showNotification(payload.title, {
          body: payload.body,
          tag: payload.tag,
          silent: payload.silent,
          icon: `${import.meta.env.BASE_URL}icons/icon-192.png`,
          badge: `${import.meta.env.BASE_URL}icons/favicon-32.png`,
          requireInteraction: payload.high,
          data: { tag: payload.tag },
        });
        return true;
      }
    }
    const notification = new Notification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      silent: payload.silent,
      icon: `${import.meta.env.BASE_URL}icons/icon-192.png`,
      requireInteraction: payload.high,
    });
    notification.onclick = () => {
      window.focus();
      payload.onClick?.();
      notification.close();
    };
    return true;
  } catch {
    return false;
  }
}

/* --------------------------------- звук ---------------------------------- */

let audioContext: AudioContext | null = null;

function context(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!audioContext) audioContext = new Ctor();
  if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
  return audioContext;
}

/** Короткий сигнал: высокий и двойной для важных, один тон для обычных. */
export function playChime(priority: ReminderPriority = 'normal'): void {
  const ctx = context();
  if (!ctx) return;
  const now = ctx.currentTime;
  const tones: Array<{ at: number; frequency: number; duration: number }> = priority === 'high'
    ? [{ at: 0, frequency: 880, duration: 0.16 }, { at: 0.22, frequency: 1180, duration: 0.2 }]
    : priority === 'low'
      ? [{ at: 0, frequency: 620, duration: 0.14 }]
      : [{ at: 0, frequency: 760, duration: 0.16 }];

  for (const tone of tones) {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = tone.frequency;
    gain.gain.setValueAtTime(0.0001, now + tone.at);
    gain.gain.exponentialRampToValueAtTime(0.16, now + tone.at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + tone.at + tone.duration);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(now + tone.at);
    oscillator.stop(now + tone.at + tone.duration + 0.02);
  }
}

export function vibrate(priority: ReminderPriority = 'normal'): void {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  try {
    navigator.vibrate(priority === 'high' ? [120, 60, 120] : 80);
  } catch {
    /* вибрация не критична */
  }
}

/* ------------------------------- заголовок ------------------------------- */

let baseTitle = '';

export function setTitleBadge(count: number, base?: string): void {
  if (typeof document === 'undefined') return;
  if (base) baseTitle = base;
  const clean = (baseTitle || document.title).replace(/^\(\d+\)\s*/, '').replace(/^🔔\s*/, '');
  baseTitle = clean;
  document.title = count > 0 ? `(${count}) ${clean}` : clean;
}

export function resetTitle(): void {
  if (typeof document === 'undefined') return;
  document.title = (baseTitle || document.title).replace(/^\(\d+\)\s*/, '');
}

/* ------------------------------- отправка -------------------------------- */

export interface DeliveryResult {
  delivered: number;
  browserShown: number;
  sounded: boolean;
  titleUpdated: boolean;
}

export interface DeliveryOptions {
  channels?: ReminderChannel[];
  /** Текст для приложения. */
  onInApp?: (reminder: PlannedReminder) => void;
  onOpen?: (reminder: PlannedReminder) => void;
  /** Сколько всего необработанных — для заголовка. */
  pendingCount?: number;
  /** Тихие часы: не звучим и не показываем системные окна. */
  silent?: boolean;
}

/**
 * Разносит напоминания по каналам. Каждый канал включается в правиле,
 * поэтому «в приложении, но без звука» — это просто набор каналов.
 */
export async function deliverReminders(
  reminders: PlannedReminder[],
  options: DeliveryOptions = {},
): Promise<DeliveryResult> {
  const result: DeliveryResult = { delivered: 0, browserShown: 0, sounded: false, titleUpdated: false };
  if (reminders.length === 0) return result;

  for (const reminder of reminders) {
    const channels = options.channels ?? reminder.channels;
    const silent = options.silent === true;

    if (channels.includes('inapp') && !silent) {
      options.onInApp?.(reminder);
    }

    if (channels.includes('browser') && !silent) {
      const shown = await showBrowserNotification({
        title: reminder.title,
        body: reminder.detail || reminder.ruleLabel,
        tag: reminder.id,
        silent: channels.includes('sound'),
        high: reminder.priority === 'high',
        onClick: () => options.onOpen?.(reminder),
      });
      if (shown) result.browserShown += 1;
    }

    if (channels.includes('sound') && !silent) {
      playChime(reminder.priority);
      result.sounded = true;
    }

    if (channels.includes('title')) {
      vibrate(reminder.priority);
    }

    result.delivered += 1;
  }

  if (reminders.some((reminder) => reminder.channels.includes('title'))) {
    setTitleBadge(options.pendingCount ?? reminders.length);
    result.titleUpdated = true;
  }

  return result;
}

/** Кнопка «Проверить уведомление» в настройках. */
export async function testNotification(channels: ReminderChannel[]): Promise<{ browser: boolean; sound: boolean }> {
  const result = { browser: false, sound: false };
  if (channels.includes('browser')) {
    result.browser = await showBrowserNotification({
      title: 'Проверка уведомлений',
      body: 'Всё работает — напоминания будут приходить так же.',
      tag: 'crm-test',
    });
  }
  if (channels.includes('sound')) {
    playChime('high');
    result.sound = true;
  }
  return result;
}

/* --------------------------- совместимость ------------------------------- */

/** Ближайший монтаж на сегодня для плашки в шапке. */
export function clearNotificationHistory(): void {
  try {
    localStorage.removeItem('crm-schedule.notified.v1');
  } catch {
    /* нечего чистить */
  }
}
