// Лента событий по сделке: задачи, оплаты, смены этапов, заметки — одним потоком.

import type { Deal, HistoryKind } from '../types';
import { paymentKindLabel, taskKindMeta } from './crmTasks';
import { fmtDate, fmtMoney } from './dates';

export type TimelineKind = HistoryKind | 'task' | 'offer';

export interface TimelineEvent {
  id: string;
  at: string;
  kind: TimelineKind;
  title: string;
  detail?: string;
  author?: string;
}

export const TIMELINE_META: Record<TimelineKind, { label: string; icon: string }> = {
  task: { label: 'Задача', icon: '☑' },
  payment: { label: 'Оплата', icon: '₽' },
  document: { label: 'Документ', icon: '📄' },
  status: { label: 'Этап', icon: '↗' },
  note: { label: 'Заметка', icon: '✎' },
  contact: { label: 'Контакт', icon: '☎' },
  offer: { label: 'КП', icon: '✉' },
  project: { label: 'Сделка', icon: '◆' },
};

/** Собирает всю историю сделки: новые события сверху. */
export function buildDealTimeline(deal: Deal): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  for (const task of deal.tasks ?? []) {
    const meta = taskKindMeta(task.kind);
    events.push({
      id: `task-add-${task.id}`,
      at: task.createdAt,
      kind: 'task',
      title: `Задача: ${task.title}`,
      detail: [meta.label, task.dueAt ? `срок ${fmtDate(task.dueAt)}` : 'без срока', task.assignee].filter(Boolean).join(' · '),
    });
    if (task.done && task.doneAt) {
      events.push({
        id: `task-done-${task.id}`,
        at: task.doneAt,
        kind: 'task',
        title: `Выполнено: ${task.title}`,
        detail: `${meta.label}${task.assignee ? ` · ${task.assignee}` : ''}`,
      });
    }
  }

  for (const payment of deal.payments ?? []) {
    events.push({
      id: `pay-${payment.id}`,
      at: `${payment.at}T12:00:00`,
      kind: 'payment',
      title: `${paymentKindLabel(payment.kind)}: ${fmtMoney(payment.amount)}`,
      detail: payment.comment,
      author: payment.author,
    });
  }

  for (const entry of deal.history ?? []) {
    events.push({
      id: `hist-${entry.id}`,
      at: entry.createdAt,
      kind: entry.kind,
      title: entry.title,
      detail: entry.text,
      author: entry.author,
    });
  }

  events.push({
    id: 'deal-created',
    at: deal.createdAt,
    kind: 'project',
    title: 'Сделка создана',
    detail: fmtMoney(deal.amount),
  });

  return events
    .filter((event) => Boolean(event.at))
    .sort((left, right) => right.at.localeCompare(left.at));
}

/** Компактная лента для карточки клиента: последние N событий по всем сделкам. */
export function buildClientTimeline(deals: Deal[], limit = 12): TimelineEvent[] {
  return deals
    .flatMap((deal) => buildDealTimeline(deal).map((event) => ({ ...event, title: `${deal.title}: ${event.title}` })))
    .sort((left, right) => right.at.localeCompare(left.at))
    .slice(0, limit);
}
