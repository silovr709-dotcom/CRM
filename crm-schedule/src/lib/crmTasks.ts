// Задачи и оплаты сделки. Чистые функции: получают сделку — возвращают новую.
// Именно поэтому всё можно проверить тестами без браузера.

import type { Deal, DealTask, Payment, PaymentKind, TaskKind, TaskRepeat } from '../types';
import { addDays, daysBetween, fmtMoney, parseDay, todayISO } from './dates';
import { nowIso, uid } from './utils';

export const TASK_KINDS: Array<{ id: TaskKind; label: string; icon: string }> = [
  { id: 'call', label: 'Позвонить', icon: '☎' },
  { id: 'meet', label: 'Встреча', icon: '👥' },
  { id: 'measure', label: 'Замер', icon: '📐' },
  { id: 'docs', label: 'Документы', icon: '📄' },
  { id: 'payment', label: 'Оплата', icon: '₽' },
  { id: 'delivery', label: 'Доставка и монтаж', icon: '🚚' },
  { id: 'other', label: 'Другое', icon: '•' },
];

export const PAYMENT_KINDS: Array<{ id: PaymentKind; label: string }> = [
  { id: 'prepay', label: 'Предоплата' },
  { id: 'final', label: 'Доплата' },
  { id: 'extra', label: 'Доп. работы' },
  { id: 'refund', label: 'Возврат' },
];

export function taskKindMeta(kind: TaskKind) {
  return TASK_KINDS.find((item) => item.id === kind) ?? TASK_KINDS[TASK_KINDS.length - 1];
}

export function paymentKindLabel(kind: PaymentKind): string {
  return PAYMENT_KINDS.find((item) => item.id === kind)?.label ?? 'Платёж';
}

export type TaskTone = 'overdue' | 'today' | 'soon' | 'later' | 'none' | 'done';

/** Срочность задачи относительно сегодняшнего дня. */
export function taskTone(task: DealTask, today = todayISO()): TaskTone {
  if (task.done) return 'done';
  if (!task.dueAt) return 'none';
  const due = parseDay(task.dueAt);
  if (Number.isNaN(due.getTime())) return 'none';
  const diff = daysBetween(today, task.dueAt);
  if (diff < 0) return 'overdue';
  if (diff === 0) return 'today';
  if (diff <= 3) return 'soon';
  return 'later';
}

const TONE_ORDER: Record<TaskTone, number> = { overdue: 0, today: 1, soon: 2, later: 3, none: 4, done: 5 };

export function sortTasks(tasks: DealTask[], today = todayISO()): DealTask[] {
  return [...tasks].sort((left, right) => {
    const byTone = TONE_ORDER[taskTone(left, today)] - TONE_ORDER[taskTone(right, today)];
    if (byTone !== 0) return byTone;
    const leftDue = left.dueAt ?? '9999-12-31';
    const rightDue = right.dueAt ?? '9999-12-31';
    if (leftDue !== rightDue) return leftDue.localeCompare(rightDue);
    return left.createdAt.localeCompare(right.createdAt);
  });
}

export function openTasks(deal: Deal): DealTask[] {
  return (deal.tasks ?? []).filter((task) => !task.done);
}

/** Ближайшая незавершённая задача — её показываем строкой в списке. */
export function nextTask(deal: Deal, today = todayISO()): DealTask | null {
  return sortTasks(openTasks(deal), today)[0] ?? null;
}

export interface TaskStats {
  open: number;
  overdue: number;
  today: number;
}

export function taskStats(deals: Deal[], today = todayISO()): TaskStats {
  let open = 0;
  let overdue = 0;
  let todayCount = 0;
  for (const deal of deals) {
    for (const task of openTasks(deal)) {
      open += 1;
      const tone = taskTone(task, today);
      if (tone === 'overdue') overdue += 1;
      if (tone === 'today') todayCount += 1;
    }
  }
  return { open, overdue, today: todayCount };
}

/** Все открытые задачи со ссылкой на сделку — для экрана «Задачи». */
export interface TaskWithDeal {
  deal: Deal;
  task: DealTask;
  tone: TaskTone;
}

export function allTasks(deals: Deal[], today = todayISO()): TaskWithDeal[] {
  return deals
    .flatMap((deal) => (deal.tasks ?? []).map((task) => ({ deal, task, tone: taskTone(task, today) })))
    .sort((left, right) => TONE_ORDER[left.tone] - TONE_ORDER[right.tone]
      || (left.task.dueAt ?? '9999-12-31').localeCompare(right.task.dueAt ?? '9999-12-31'));
}

function touch(deal: Deal, patch: Partial<Deal>): Deal {
  return { ...deal, ...patch, updatedAt: nowIso() };
}

export function addTask(deal: Deal, task: Omit<DealTask, 'id' | 'createdAt'>): Deal {
  const entry: DealTask = { ...task, id: uid('task'), createdAt: nowIso() };
  return touch(deal, { tasks: [...(deal.tasks ?? []), entry] });
}

export function patchTask(deal: Deal, taskId: string, patch: Partial<DealTask>): Deal {
  return touch(deal, { tasks: (deal.tasks ?? []).map((task) => (task.id === taskId ? { ...task, ...patch } : task)) });
}

/**
 * Отметка выполнения. Если у задачи есть повторение — сразу создаётся
 * следующая с тем же сроком через нужный интервал.
 */
export function toggleTask(deal: Deal, taskId: string): Deal {
  const source = (deal.tasks ?? []).find((task) => task.id === taskId);
  if (!source) return deal;
  const completing = !source.done;

  const tasks = (deal.tasks ?? []).map((task) => (task.id === taskId
    ? { ...task, done: !task.done, doneAt: task.done ? undefined : nowIso() }
    : task));

  if (completing && source.repeat) {
    const nextDue = nextRepeatDate(source.dueAt ?? todayISO(), source.repeat);
    const already = tasks.some((task) => task.origin === `repeat:${source.id}` && !task.done);
    if (!already) {
      tasks.push({
        ...source,
        id: uid('task'),
        done: false,
        doneAt: undefined,
        dueAt: nextDue,
        origin: `repeat:${source.id}`,
        createdAt: nowIso(),
      });
    }
  }

  return touch(deal, { tasks });
}

/** Следующий срок для повторяющейся задачи. */
export function nextRepeatDate(from: string, repeat: TaskRepeat): string {
  if (repeat === 'daily') return addDays(from, 1);
  if (repeat === 'weekly') return addDays(from, 7);
  if (repeat === 'monthly') {
    const date = parseDay(from);
    const day = date.getDate();
    date.setMonth(date.getMonth() + 1);
    // 31-е число в коротком месяце переносим на последний день.
    if (date.getDate() < day) date.setDate(0);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  // Будни: пропускаем выходные.
  let next = addDays(from, 1);
  while ([0, 6].includes(parseDay(next).getDay())) next = addDays(next, 1);
  return next;
}

export const REPEAT_LABELS: Array<{ id: TaskRepeat; label: string }> = [
  { id: 'daily', label: 'каждый день' },
  { id: 'weekdays', label: 'по будням' },
  { id: 'weekly', label: 'каждую неделю' },
  { id: 'monthly', label: 'каждый месяц' },
];

/** Отложить задачу на N дней (0 — на сегодня). */
export function postponeTask(deal: Deal, taskId: string, days: number, today = todayISO()): Deal {
  const task = (deal.tasks ?? []).find((item) => item.id === taskId);
  if (!task) return deal;
  const base = task.dueAt && task.dueAt > today ? task.dueAt : today;
  return patchTask(deal, taskId, { dueAt: addDays(base, days) });
}

export function removeTask(deal: Deal, taskId: string): Deal {
  return touch(deal, { tasks: (deal.tasks ?? []).filter((task) => task.id !== taskId) });
}

/* ------------------------------- оплаты ------------------------------- */

export function sortedPayments(deal: Deal): Payment[] {
  return [...(deal.payments ?? [])].sort((left, right) => right.at.localeCompare(left.at));
}

export function paidAmount(payments?: Payment[]): number {
  return (payments ?? []).reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0);
}

export function addPayment(deal: Deal, entry: Omit<Payment, 'id'>): Deal {
  const payment: Payment = { ...entry, id: uid('pay') };
  return touch(deal, { payments: [...(deal.payments ?? []), payment] });
}

/** Правка уже внесённого платежа: сумма, дата, тип или комментарий. */
export function patchPayment(deal: Deal, id: string, patch: Partial<Payment>): Deal {
  return touch(deal, { payments: (deal.payments ?? []).map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)) });
}

export function removePayment(deal: Deal, id: string): Deal {
  return touch(deal, { payments: (deal.payments ?? []).filter((entry) => entry.id !== id) });
}

export interface PaymentState {
  paid: number;
  remainder: number;
  label: string;
  tone: 'muted' | 'warn' | 'ok' | 'bad';
  percent: number;
}

/** Статус оплаты: сумма платежей главнее любого ручного поля. */
export function paymentState(deal: Deal): PaymentState {
  const paid = paidAmount(deal.payments);
  const total = Math.max(0, deal.amount || 0);
  const remainder = Math.max(0, total - paid);
  const percent = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0;
  if (total > 0 && paid >= total) return { paid, remainder: 0, label: 'оплачено полностью', tone: 'ok', percent: 100 };
  if (paid > 0) return { paid, remainder, label: `внесено ${fmtMoney(paid)}`, tone: 'warn', percent };
  return { paid, remainder: total, label: 'оплаты нет', tone: 'muted', percent: 0 };
}

/** Дополнительная задача «Позвонить» на завтра — частая рутина в один клик. */
export function quickFollowUp(deal: Deal, days = 1): Deal {
  return addTask(deal, {
    title: `Связаться с клиентом по заказу «${deal.title}»`,
    kind: 'call',
    dueAt: addDays(todayISO(), days),
    done: false,
    assignee: deal.manager,
  });
}
