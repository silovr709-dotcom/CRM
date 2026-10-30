// Локальное расписание уведомлений: напоминания ставятся в системное
// расписание устройства заранее (Notification Triggers, где браузер умеет).
// Тогда уведомление приходит в срок и без интернета, и при закрытом
// приложении — его показывает сама система, а не наша вкладка.
// Где браузер так не умеет (например, iPhone), остаётся обычный показ при
// открытом приложении и календарь телефона (reminderCalendar.ts).
import type { PlannedReminder } from './reminders';

const STORAGE_KEY = 'crm-schedule.local-notifications.v1';
/** Сколько уведомлений держим в расписании устройства одновременно. */
export const LOCAL_SCHEDULE_LIMIT = 50;

/** Запись реестра: id напоминания → время показа (мс). */
export type LocalScheduleRegistry = Record<string, number>;

interface TimestampTriggerCtor {
  new (timestamp: number): unknown;
}

function triggerCtor(): TimestampTriggerCtor | null {
  if (typeof window === 'undefined') return null;
  const ctor = (window as unknown as { TimestampTrigger?: TimestampTriggerCtor }).TimestampTrigger;
  return typeof ctor === 'function' ? ctor : null;
}

/** Умеет ли это устройство показывать уведомления по расписанию само. */
export function supportsLocalScheduling(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  if (!('serviceWorker' in navigator) || !('Notification' in window)) return false;
  return triggerCtor() !== null;
}

export function readLocalSchedule(): LocalScheduleRegistry {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const registry: LocalScheduleRegistry = {};
    for (const [id, at] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof at === 'number' && Number.isFinite(at)) registry[id] = at;
    }
    return registry;
  } catch {
    return {};
  }
}

export function writeLocalSchedule(registry: LocalScheduleRegistry): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(registry));
  } catch {
    /* приватный режим — расписание просто не переживёт перезапуск */
  }
}

export interface SchedulableReminder {
  id: string;
  title: string;
  body: string;
  notifyAt: number;
  high: boolean;
}

/** Из планов движка выбираем то, что можно поставить в расписание устройства:
    канал «браузер», время в будущем, без дублей, ближайшие первыми. */
export function collectSchedulable(planned: PlannedReminder[], nowMs: number): SchedulableReminder[] {
  const byId = new Map<string, SchedulableReminder>();
  for (const reminder of planned) {
    if (!reminder.channels.includes('browser')) continue;
    const notifyAt = new Date(reminder.notifyAt).getTime();
    if (!Number.isFinite(notifyAt) || notifyAt <= nowMs + 1000) continue;
    if (byId.has(reminder.id)) continue;
    byId.set(reminder.id, {
      id: reminder.id,
      title: reminder.title,
      body: reminder.detail || reminder.ruleLabel,
      notifyAt,
      high: reminder.priority === 'high',
    });
  }
  return [...byId.values()]
    .sort((left, right) => left.notifyAt - right.notifyAt)
    .slice(0, LOCAL_SCHEDULE_LIMIT);
}

export interface LocalSyncPlan {
  toSchedule: SchedulableReminder[];
  toCancel: string[];
  nextRegistry: LocalScheduleRegistry;
}

/** Чистый расчёт синхронизации: что поставить, что снять, что останется.
    Уже стоящее с тем же временем не трогаем — система не любит лишних замен. */
export function planLocalSync(
  desired: SchedulableReminder[],
  registry: LocalScheduleRegistry,
  nowMs: number,
): LocalSyncPlan {
  const desiredById = new Map(desired.map((item) => [item.id, item]));
  const toSchedule: SchedulableReminder[] = [];
  const toCancel: string[] = [];
  const nextRegistry: LocalScheduleRegistry = {};

  for (const item of desired) {
    if (registry[item.id] === item.notifyAt) {
      nextRegistry[item.id] = item.notifyAt;
    } else {
      toSchedule.push(item);
      nextRegistry[item.id] = item.notifyAt;
    }
  }
  for (const [id, at] of Object.entries(registry)) {
    if (at <= nowMs) continue; // уже сработало или просрочено — само уйдёт из реестра
    if (!desiredById.has(id)) toCancel.push(id);
  }
  return { toSchedule, toCancel, nextRegistry };
}

/** Напоминание уже показано системой по расписанию? Тогда вкладка не должна
    показывать второе такое же окно, когда её откроют. */
export function wasShownLocally(id: string, registry: LocalScheduleRegistry, nowMs: number): boolean {
  const at = registry[id];
  return typeof at === 'number' && at <= nowMs + 5000;
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    return (await navigator.serviceWorker.getRegistration()) ?? null;
  } catch {
    return null;
  }
}

async function closeByTag(reg: ServiceWorkerRegistration, tag: string): Promise<void> {
  try {
    const shown = await reg.getNotifications({ tag });
    for (const notification of shown) notification.close();
  } catch {
    /* снятие — не критично */
  }
}

export interface LocalSyncResult {
  supported: boolean;
  scheduled: number;
}

/**
 * Приводит системное расписание устройства к планам движка.
 * Сеть не нужна: showNotification с триггером хранится в самом устройстве.
 */
export async function syncLocalReminderSchedule(planned: PlannedReminder[]): Promise<LocalSyncResult> {
  if (!supportsLocalScheduling()) return { supported: false, scheduled: 0 };
  if (Notification.permission !== 'granted') return { supported: true, scheduled: 0 };
  const reg = await registration();
  if (!reg?.showNotification) return { supported: true, scheduled: 0 };
  const Trigger = triggerCtor();
  if (!Trigger) return { supported: false, scheduled: 0 };

  const nowMs = Date.now();
  const desired = collectSchedulable(planned, nowMs);
  const plan = planLocalSync(desired, readLocalSchedule(), nowMs);

  for (const id of plan.toCancel) await closeByTag(reg, id);
  let scheduled = 0;
  for (const item of plan.toSchedule) {
    try {
      await reg.showNotification(item.title, {
        body: item.body,
        tag: item.id,
        requireInteraction: item.high,
        icon: `${import.meta.env.BASE_URL}icons/icon-192.png`,
        badge: `${import.meta.env.BASE_URL}icons/favicon-32.png`,
        data: { tag: item.id, local: true },
        // Экспериментальное поле расписания: TS его не знает, браузер — да.
        showTrigger: new Trigger(item.notifyAt),
      } as NotificationOptions);
      scheduled += 1;
    } catch {
      // Конкретное уведомление поставить не вышло — не падаем из-за него.
      delete plan.nextRegistry[item.id];
    }
  }
  writeLocalSchedule(plan.nextRegistry);
  return { supported: true, scheduled };
}

/** Снять одно уведомление из расписания (отложили или убрали напоминание). */
export async function cancelLocalReminder(id: string): Promise<void> {
  const registry = readLocalSchedule();
  if (id in registry) {
    delete registry[id];
    writeLocalSchedule(registry);
  }
  const reg = await registration();
  if (reg) await closeByTag(reg, id);
}

/** Сколько уведомлений сейчас стоит в расписании устройства. */
export function localScheduledCount(nowMs = Date.now()): number {
  return Object.values(readLocalSchedule()).filter((at) => at > nowMs).length;
}
