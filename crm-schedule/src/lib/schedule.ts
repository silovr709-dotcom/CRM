// График монтажей: замеры, готовность на фабрике, доставки и монтажи по всем
// заказам в одном календаре. Чистые функции — без React и хранилища.

import type { Deal, DealSchedule, ScheduleStatus } from '../types';
import { addDays, isoDay, parseDay, todayISO } from './dates';

export type ScheduleKind = 'measure' | 'ready' | 'delivery' | 'install';

export const SCHEDULE_KINDS: Array<{ id: ScheduleKind; label: string; short: string; color: string }> = [
  { id: 'measure', label: 'Замер', short: 'З', color: 'blue' },
  { id: 'ready', label: 'Готовность на фабрике', short: 'Ф', color: 'violet' },
  { id: 'delivery', label: 'Доставка', short: 'Д', color: 'teal' },
  { id: 'install', label: 'Монтаж', short: 'М', color: 'orange' },
];

export const SCHEDULE_STATUSES: Array<{ id: ScheduleStatus; label: string; tone: string }> = [
  { id: 'planned', label: 'Запланировано', tone: 'muted' },
  { id: 'confirmed', label: 'Подтверждено клиентом', tone: 'blue' },
  { id: 'done', label: 'Выполнено', tone: 'green' },
  { id: 'problem', label: 'Проблема', tone: 'red' },
];

export function scheduleKindMeta(kind: ScheduleKind) {
  return SCHEDULE_KINDS.find((item) => item.id === kind) ?? SCHEDULE_KINDS[0];
}

export function scheduleStatusMeta(status: ScheduleStatus) {
  return SCHEDULE_STATUSES.find((item) => item.id === status) ?? SCHEDULE_STATUSES[0];
}

export interface ScheduleEvent {
  id: string;
  dealId: string;
  dealTitle: string;
  client: string;
  kind: ScheduleKind;
  /** Дата YYYY-MM-DD. */
  date: string;
  /** Для монтажа длиной в несколько дней — порядковый день и всего дней. */
  dayIndex?: number;
  dayCount?: number;
  team?: string;
  address?: string;
  phone?: string;
  note?: string;
  status: ScheduleStatus;
  amount: number;
}

/** Все события графика по одной сделке. */
export function dealEvents(deal: Deal, clientName = 'Без клиента'): ScheduleEvent[] {
  const schedule: DealSchedule = deal.schedule ?? { status: 'planned' };
  const base = {
    dealId: deal.id,
    dealTitle: deal.title,
    client: clientName,
    team: schedule.team,
    address: schedule.address,
    phone: schedule.phone,
    note: schedule.note,
    status: schedule.status ?? 'planned',
    amount: deal.amount,
  };
  const events: ScheduleEvent[] = [];
  if (schedule.measureAt) events.push({ ...base, id: `${deal.id}-measure`, kind: 'measure', date: schedule.measureAt });
  if (schedule.readyAt) events.push({ ...base, id: `${deal.id}-ready`, kind: 'ready', date: schedule.readyAt });
  if (schedule.deliveryAt) events.push({ ...base, id: `${deal.id}-delivery`, kind: 'delivery', date: schedule.deliveryAt });
  if (schedule.installAt) {
    const days = Math.max(1, Math.min(14, Math.round(schedule.installDays ?? 1)));
    for (let index = 0; index < days; index += 1) {
      events.push({
        ...base,
        id: `${deal.id}-install-${index}`,
        kind: 'install',
        date: addDays(schedule.installAt, index),
        dayIndex: index + 1,
        dayCount: days,
      });
    }
  }
  return events;
}

export function collectEvents(deals: Deal[], clientName: (deal: Deal) => string = () => 'Без клиента'): ScheduleEvent[] {
  return deals
    .flatMap((deal) => dealEvents(deal, clientName(deal)))
    .sort((left, right) => left.date.localeCompare(right.date) || left.dealTitle.localeCompare(right.dealTitle));
}

export function eventsByDay(events: ScheduleEvent[]): Map<string, ScheduleEvent[]> {
  const map = new Map<string, ScheduleEvent[]>();
  for (const event of events) {
    const list = map.get(event.date) ?? [];
    list.push(event);
    map.set(event.date, list);
  }
  return map;
}

/** Сетка месяца: всегда с понедельника, ровно 6 недель. */
export function monthGrid(anchor: Date): string[] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const shift = (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(first.getDate() - shift);
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return isoDay(day);
  });
}

export function weekGrid(anchor: Date): string[] {
  const shift = (anchor.getDay() + 6) % 7;
  const start = new Date(anchor);
  start.setDate(anchor.getDate() - shift);
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return isoDay(day);
  });
}

export function isWeekend(day: string): boolean {
  const date = parseDay(day);
  return date.getDay() === 0 || date.getDay() === 6;
}

/** Какое поле дат отвечает за событие — нужно для переноса мышью и правки. */
export function scheduleFieldForKind(kind: ScheduleKind): keyof DealSchedule {
  if (kind === 'measure') return 'measureAt';
  if (kind === 'ready') return 'readyAt';
  if (kind === 'delivery') return 'deliveryAt';
  return 'installAt';
}

export interface ScheduleWarning {
  dealId: string;
  kind: 'error' | 'warn' | 'info';
  text: string;
}

/**
 * Проверки графика: монтаж раньше готовности, доставка после монтажа,
 * монтаж без адреса или бригады и двойная занятость бригады.
 */
export function scheduleWarnings(deals: Deal[]): ScheduleWarning[] {
  const warnings: ScheduleWarning[] = [];
  const busy = new Map<string, Map<string, string[]>>();

  for (const deal of deals) {
    const schedule = deal.schedule;
    if (!schedule?.installAt) continue;

    if (schedule.readyAt && schedule.readyAt > schedule.installAt) {
      warnings.push({ dealId: deal.id, kind: 'error', text: `«${deal.title}»: монтаж раньше готовности на фабрике` });
    }
    if (schedule.deliveryAt && schedule.deliveryAt > schedule.installAt) {
      warnings.push({ dealId: deal.id, kind: 'warn', text: `«${deal.title}»: доставка позже монтажа` });
    }
    if (!schedule.address?.trim()) {
      warnings.push({ dealId: deal.id, kind: 'warn', text: `«${deal.title}»: у монтажа не указан адрес` });
    }
    if (!schedule.team?.trim()) {
      warnings.push({ dealId: deal.id, kind: 'warn', text: `«${deal.title}»: не назначена бригада` });
    }

    const team = schedule.team?.trim();
    if (!team) continue;
    const days = Math.max(1, Math.round(schedule.installDays ?? 1));
    for (let index = 0; index < days; index += 1) {
      const date = addDays(schedule.installAt, index);
      const byDay = busy.get(team) ?? new Map<string, string[]>();
      const list = byDay.get(date) ?? [];
      list.push(deal.title);
      byDay.set(date, list);
      busy.set(team, byDay);
    }
  }

  for (const [team, byDay] of busy) {
    for (const [date, names] of byDay) {
      if (names.length > 1) {
        warnings.push({
          dealId: '',
          kind: 'error',
          text: `Бригада «${team}», ${date.split('-').reverse().join('.')}: одновременно ${names.length} монтажа — ${names.join(', ')}`,
        });
      }
    }
  }
  return warnings;
}

/** Ближайшие события начиная с сегодняшнего дня. */
export function upcomingEvents(events: ScheduleEvent[], from = todayISO(), days = 14): ScheduleEvent[] {
  const until = addDays(from, days);
  return events.filter((event) => event.date >= from && event.date <= until);
}

export interface TeamLoad {
  team: string;
  days: number;
  deals: number;
}

/** Загрузка бригад по монтажам. */
export function teamLoad(events: ScheduleEvent[]): TeamLoad[] {
  const map = new Map<string, { days: Set<string>; deals: Set<string> }>();
  for (const event of events) {
    if (event.kind !== 'install') continue;
    const team = event.team?.trim() || 'Без бригады';
    const current = map.get(team) ?? { days: new Set<string>(), deals: new Set<string>() };
    current.days.add(event.date);
    current.deals.add(event.dealId);
    map.set(team, current);
  }
  return Array.from(map.entries())
    .map(([team, value]) => ({ team, days: value.days.size, deals: value.deals.size }))
    .sort((left, right) => right.days - left.days);
}

/** Перенос события на другой день: меняет нужную дату в сделке. */
export function moveEvent(deal: Deal, kind: ScheduleKind, date: string): Deal {
  const field = scheduleFieldForKind(kind);
  return { ...deal, schedule: { ...deal.schedule, [field]: date }, updatedAt: new Date().toISOString() };
}

/** Сколько дней до монтажа: отрицательное — уже прошёл. */
export function daysToInstall(deal: Deal, today = todayISO()): number | null {
  if (!deal.schedule?.installAt) return null;
  const diff = Math.round((parseDay(deal.schedule.installAt).getTime() - parseDay(today).getTime()) / 86400000);
  return Number.isNaN(diff) ? null : diff;
}
