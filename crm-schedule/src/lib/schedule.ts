// График монтажей: замеры, готовность на фабрике, доставки и монтажи по всем
// заказам в одном календаре. Чистые функции — без React и хранилища.

import type { CalendarEvent, Deal, DealSchedule, ScheduleStatus } from '../types';
import { addDays, isoDay, minutesOf, parseDay, timeRangesOverlap, todayISO } from './dates';

export type ScheduleKind = 'measure' | 'ready' | 'delivery' | 'install' | 'custom';

export const SCHEDULE_KINDS: Array<{ id: ScheduleKind; label: string; short: string; color: string }> = [
  { id: 'measure', label: 'Замер', short: 'З', color: 'blue' },
  { id: 'ready', label: 'Готовность на фабрике', short: 'Ф', color: 'violet' },
  { id: 'delivery', label: 'Доставка', short: 'Д', color: 'teal' },
  { id: 'install', label: 'Монтаж', short: 'М', color: 'orange' },
  { id: 'custom', label: 'Событие', short: 'С', color: 'green' },
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
  /** Время начала и окончания (HH:MM), если задано в сделке. */
  timeStart?: string;
  timeEnd?: string;
  status: ScheduleStatus;
  amount: number;
  /** Свободное событие графика (kind === 'custom'): id записи CalendarEvent. */
  customId?: string;
  /** Вид свободного события свободным текстом: «встреча», «выходной». */
  category?: string;
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
    timeStart: schedule.timeStart,
    timeEnd: schedule.timeEnd,
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

/**
 * Даты повторений свободного события. Серия не бесконечна: показываем год
 * назад и два года вперёд от сегодня — дальше календарем не листают.
 */
export function occurrenceDates(item: CalendarEvent, today = todayISO()): string[] {
  if (!item.repeat) return [item.date];
  const windowStart = addDays(today, -370);
  const windowEnd = addDays(today, 730);
  const dates: string[] = [];
  if (item.repeat === 'weekly') {
    let cursor = item.date;
    while (cursor < windowStart) cursor = addDays(cursor, 7);
    while (cursor <= windowEnd) {
      dates.push(cursor);
      cursor = addDays(cursor, 7);
    }
    return dates;
  }
  // monthly: тот же день месяца, в коротких месяцах — последний день.
  const start = parseDay(item.date);
  const dayOfMonth = start.getDate();
  let year = start.getFullYear();
  let month = start.getMonth();
  for (let step = 0; step < 120; step += 1) {
    const lastDay = new Date(year, month + 1, 0).getDate();
    const day = Math.min(dayOfMonth, lastDay);
    const candidate = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (candidate > windowEnd) break;
    if (candidate >= windowStart && candidate >= item.date) dates.push(candidate);
    month += 1;
    if (month > 11) { month = 0; year += 1; }
  }
  return dates;
}

/** Свободные события графика: встречи, отгрузки, выходные — без сделок. */
export function calendarEvents(items: CalendarEvent[]): ScheduleEvent[] {
  const events: ScheduleEvent[] = [];
  for (const item of items) {
    if (!item?.date || !item.title) continue;
    const days = Math.max(1, Math.min(14, Math.round(item.days ?? 1)));
    for (const occurrence of occurrenceDates(item)) {
      for (let index = 0; index < days; index += 1) {
        events.push({
          id: item.repeat ? `${item.id}-${occurrence}-${index}` : `${item.id}-day-${index}`,
          dealId: '',
          dealTitle: item.title,
          client: item.category || 'Событие',
          kind: 'custom',
          date: addDays(occurrence, index),
          dayIndex: days > 1 ? index + 1 : undefined,
          dayCount: days > 1 ? days : undefined,
          team: item.team,
          address: item.place,
          note: item.note,
          timeStart: item.timeStart,
          timeEnd: item.timeEnd,
          status: 'planned',
          amount: 0,
          customId: item.id,
          category: item.category,
        });
      }
    }
  }
  return events;
}

export function collectEvents(
  deals: Deal[],
  clientName: (deal: Deal) => string = () => 'Без клиента',
  custom: CalendarEvent[] = [],
): ScheduleEvent[] {
  return [
    ...deals.flatMap((deal) => dealEvents(deal, clientName(deal))),
    ...calendarEvents(custom),
  ]
    .sort((left, right) => left.date.localeCompare(right.date)
      || (minutesOf(left.timeStart) ?? 24 * 60) - (minutesOf(right.timeStart) ?? 24 * 60)
      || left.dealTitle.localeCompare(right.dealTitle));
}

/** События одного дня по времени — для листа дня и маршрута. */
export function eventsOfDay(events: ScheduleEvent[], day: string): ScheduleEvent[] {
  return events
    .filter((event) => event.date === day)
    .sort((left, right) => (minutesOf(left.timeStart) ?? 24 * 60) - (minutesOf(right.timeStart) ?? 24 * 60));
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
export function scheduleWarnings(deals: Deal[], custom: CalendarEvent[] = []): ScheduleWarning[] {
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

  // Пересечение по времени важнее пересечения по дню: два монтажа в 9:00 и в 15:00 — это нормально.
  const installs = deals.filter((deal) => deal.schedule?.installAt && deal.schedule.team?.trim());
  for (let first = 0; first < installs.length; first += 1) {
    for (let second = first + 1; second < installs.length; second += 1) {
      const left = installs[first];
      const right = installs[second];
      if (left.schedule.team?.trim() !== right.schedule.team?.trim()) continue;
      if (!left.schedule.timeStart || !right.schedule.timeStart) continue;
      const leftDays = Math.max(1, left.schedule.installDays ?? 1);
      const rightDays = Math.max(1, right.schedule.installDays ?? 1);
      const sameDay = Array.from({ length: leftDays }, (_, index) => addDays(left.schedule.installAt as string, index))
        .find((day) => Array.from({ length: rightDays }, (_, index) => addDays(right.schedule.installAt as string, index)).includes(day));
      if (!sameDay) continue;
      if (!timeRangesOverlap(
        { start: left.schedule.timeStart, end: left.schedule.timeEnd },
        { start: right.schedule.timeStart, end: right.schedule.timeEnd },
      )) continue;
      warnings.push({
        dealId: left.id,
        kind: 'error',
        text: `Бригада «${left.schedule.team}» ${sameDay.split('-').reverse().join('.')}: «${left.title}» и «${right.title}» пересекаются по времени`,
      });
    }
  }

  // Свободные события тех же людей в день монтажа — не ошибка, но проверить стоит:
  // выходной или обучение легко поставить поверх выезда по недосмотру.
  const seenCustom = new Set<string>();
  for (const event of calendarEvents(custom)) {
    const team = event.team?.trim();
    if (!team || !event.customId) continue;
    const installs = busy.get(team)?.get(event.date);
    if (!installs || installs.length === 0) continue;
    const key = `${event.customId}:${event.date}`;
    if (seenCustom.has(key)) continue;
    seenCustom.add(key);
    warnings.push({
      dealId: '',
      kind: 'warn',
      text: `«${team}» ${event.date.split('-').reverse().join('.')}: событие «${event.dealTitle}» в день монтажа — ${installs.join(', ')}`,
    });
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

/** Текст времени монтажа для подписи. */
export function eventTimeLabel(event: ScheduleEvent): string {
  if (!event.timeStart && !event.timeEnd) return '';
  if (event.timeStart && event.timeEnd) return `${event.timeStart}–${event.timeEnd}`;
  return event.timeStart ? `с ${event.timeStart}` : `до ${event.timeEnd}`;
}

/** Сколько дней до монтажа: отрицательное — уже прошёл. */
export function daysToInstall(deal: Deal, today = todayISO()): number | null {
  if (!deal.schedule?.installAt) return null;
  const diff = Math.round((parseDay(deal.schedule.installAt).getTime() - parseDay(today).getTime()) / 86400000);
  return Number.isNaN(diff) ? null : diff;
}
