// Сводные цифры для обзорного экрана.

import type { Deal } from '../types';
import { addDays, isoDay, todayISO } from './dates';
import { contactTone, isClosedStatus } from './crm';
import { paidAmount, taskStats } from './crmTasks';
import { collectEvents, upcomingEvents, type ScheduleEvent } from './schedule';

export interface Overview {
  activeDeals: number;
  pipeline: number;
  contactsToday: number;
  contactsOverdue: number;
  installsWeek: number;
  installsToday: number;
  paidThisMonth: number;
  openTasks: number;
  overdueTasks: number;
  warnings: number;
}

function monthPrefix(today = todayISO()): string {
  return today.slice(0, 7);
}

/** Оплаты, поступившие в текущем месяце (по датам платежей). */
export function paidThisMonth(deals: Deal[], today = todayISO()): number {
  const prefix = monthPrefix(today);
  return deals.reduce((sum, deal) => sum + (deal.payments ?? [])
    .filter((payment) => payment.at?.slice(0, 7) === prefix)
    .reduce((inner, payment) => inner + (Number(payment.amount) || 0), 0), 0);
}

export function installsThisWeek(events: ScheduleEvent[], today = todayISO()): ScheduleEvent[] {
  const weekday = (new Date(`${today}T12:00:00`).getDay() + 6) % 7;
  const monday = addDays(today, -weekday);
  const sunday = addDays(monday, 6);
  return events.filter((event) => event.kind === 'install' && event.date >= monday && event.date <= sunday);
}

export function overview(deals: Deal[], warnings: number, today = todayISO()): Overview {
  const events = collectEvents(deals);
  const active = deals.filter((deal) => !isClosedStatus(deal.status));
  const tasks = taskStats(deals, today);
  const contacts = active.map((deal) => contactTone(deal.nextContactAt, today));
  return {
    activeDeals: active.length,
    pipeline: active.reduce((sum, deal) => sum + deal.amount, 0),
    contactsToday: contacts.filter((tone) => tone === 'today').length,
    contactsOverdue: contacts.filter((tone) => tone === 'overdue').length,
    installsWeek: installsThisWeek(events, today).length,
    installsToday: events.filter((event) => event.kind === 'install' && event.date === today).length,
    paidThisMonth: paidThisMonth(deals, today),
    openTasks: tasks.open,
    overdueTasks: tasks.overdue,
    warnings,
  };
}

/** Сделки, с которыми нужно работать сегодня: просроченный или сегодняшний контакт. */
export function dealsForToday(deals: Deal[], today = todayISO()): Deal[] {
  return deals
    .filter((deal) => !isClosedStatus(deal.status))
    .filter((deal) => {
      const tone = contactTone(deal.nextContactAt, today);
      return tone === 'overdue' || tone === 'today';
    })
    .sort((left, right) => (left.nextContactAt ?? '').localeCompare(right.nextContactAt ?? ''));
}

/** Монтажи и доставки на ближайшие дни, включая сегодня. */
export function scheduleAhead(deals: Deal[], days = 7, today = todayISO()): ScheduleEvent[] {
  return upcomingEvents(collectEvents(deals), today, days)
    .filter((event) => event.kind === 'install' || event.kind === 'delivery' || event.kind === 'measure');
}

/** Сумма полученных денег по сделке для подписи в списке. */
export function dealPaid(deal: Deal): number {
  return paidAmount(deal.payments);
}

/** «Понедельник, 22 октября» — заголовок обзора. */
export function longToday(today = todayISO()): string {
  const date = new Date(`${today}T12:00:00`);
  const weekdays = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
  const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  return `${weekdays[date.getDay()]}, ${date.getDate()} ${months[date.getMonth()]}`;
}

export function monthKey(day: string): string {
  return day.slice(0, 7);
}

export function isoToday(): string {
  return isoDay(new Date());
}
