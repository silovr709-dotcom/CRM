import { describe, expect, it } from 'vitest';
import {
  addPayment, addTask, nextTask, openTasks, paidAmount, paymentState, removeTask,
  sortTasks, taskStats, taskTone, toggleTask,
} from './crmTasks';
import { makeDeal } from './testUtils';

const today = '2026-10-22';

describe('задачи сделки', () => {
  it('срочность задачи', () => {
    expect(taskTone({ id: '1', title: 'a', kind: 'call', dueAt: '2026-10-20', createdAt: '' }, today)).toBe('overdue');
    expect(taskTone({ id: '1', title: 'a', kind: 'call', dueAt: '2026-10-22', createdAt: '' }, today)).toBe('today');
    expect(taskTone({ id: '1', title: 'a', kind: 'call', dueAt: '', createdAt: '' }, today)).toBe('none');
    expect(taskTone({ id: '1', title: 'a', kind: 'call', done: true, createdAt: '' }, today)).toBe('done');
  });

  it('сортирует просроченные первыми, выполненные в конце', () => {
    const tasks = [
      { id: 'done', title: 'done', kind: 'call' as const, done: true, createdAt: '' },
      { id: 'later', title: 'later', kind: 'call' as const, dueAt: '2026-11-01', createdAt: '' },
      { id: 'overdue', title: 'overdue', kind: 'call' as const, dueAt: '2026-10-01', createdAt: '' },
    ];
    expect(sortTasks(tasks, today).map((task) => task.id)).toEqual(['overdue', 'later', 'done']);
  });

  it('добавляет, выполняет и удаляет задачу', () => {
    const base = makeDeal();
    const added = addTask(base, { title: 'Позвонить', kind: 'call', dueAt: today, done: false });
    expect(added.tasks).toHaveLength(1);
    expect(openTasks(added)).toHaveLength(1);
    expect(nextTask(added, today)?.title).toBe('Позвонить');

    const done = toggleTask(added, added.tasks[0].id);
    expect(done.tasks[0].done).toBe(true);
    expect(done.tasks[0].doneAt).toBeTruthy();
    expect(openTasks(done)).toHaveLength(0);

    const removed = removeTask(done, done.tasks[0].id);
    expect(removed.tasks).toHaveLength(0);
  });

  it('считает статистику по всем сделкам', () => {
    const deals = [
      makeDeal({ tasks: [{ id: 'a', title: 'a', kind: 'call', dueAt: '2026-10-20', createdAt: '' }, { id: 'b', title: 'b', kind: 'call', dueAt: today, createdAt: '' }] }),
      makeDeal({ id: 'deal-2', tasks: [{ id: 'c', title: 'c', kind: 'call', done: true, createdAt: '' }] }),
    ];
    expect(taskStats(deals, today)).toEqual({ open: 2, overdue: 1, today: 1 });
  });
});

describe('оплаты', () => {
  it('сумма и остаток считаются по платежам', () => {
    let deal = makeDeal({ amount: 100000 });
    deal = addPayment(deal, { amount: 40000, at: '2026-10-01', kind: 'prepay' });
    deal = addPayment(deal, { amount: 10000, at: '2026-10-10', kind: 'final' });
    expect(paidAmount(deal.payments)).toBe(50000);
    const state = paymentState(deal);
    expect(state.remainder).toBe(50000);
    expect(state.percent).toBe(50);
    expect(state.tone).toBe('warn');
  });

  it('полная оплата даёт зелёный статус', () => {
    const deal = addPayment(makeDeal({ amount: 50000 }), { amount: 50000, at: '2026-10-01', kind: 'final' });
    expect(paymentState(deal)).toMatchObject({ paid: 50000, remainder: 0, tone: 'ok', percent: 100 });
  });

  it('без платежей — остаток равен сумме', () => {
    expect(paymentState(makeDeal({ amount: 70000 }))).toMatchObject({ paid: 0, remainder: 70000, tone: 'muted' });
  });
});
