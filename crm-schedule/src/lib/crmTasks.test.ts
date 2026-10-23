import { describe, expect, it } from 'vitest';
import {
  addPayment, addTask, nextTask, openTasks, paidAmount, patchPayment, patchTask,
  paymentState, postponeTasks, removeTask, sortTasks, taskStats, taskTone, toggleTask, toggleTasks,
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

describe('массовые действия с задачами', () => {
  const withThree = () => {
    let deal = makeDeal();
    deal = addTask(deal, { title: 'A', kind: 'call', dueAt: '2026-10-01', done: false });
    deal = addTask(deal, { title: 'B', kind: 'call', dueAt: '2026-10-01', done: false });
    deal = addTask(deal, { title: 'C', kind: 'call', dueAt: '2026-10-01', done: false });
    return deal;
  };

  it('выполняет все задачи одной операцией, а не только последнюю', () => {
    const deal = withThree();
    const done = toggleTasks(deal, deal.tasks.map((task) => task.id));
    expect(done.tasks.every((task) => task.done)).toBe(true);
  });

  it('откладывает все просроченные задачи', () => {
    const deal = withThree();
    const moved = postponeTasks(deal, deal.tasks.map((task) => task.id), 1, '2026-10-01');
    expect(moved.tasks.map((task) => task.dueAt)).toEqual(['2026-10-02', '2026-10-02', '2026-10-02']);
  });

  it('повторяющаяся задача при массовом выполнении создаёт следующую', () => {
    let deal = makeDeal();
    deal = addTask(deal, { title: 'Планёрка', kind: 'meet', dueAt: '2026-10-01', done: false, repeat: 'daily' });
    const done = toggleTasks(deal, deal.tasks.map((task) => task.id));
    expect(done.tasks).toHaveLength(2);
    expect(done.tasks[1].dueAt).toBe('2026-10-02');
    expect(done.tasks[1].done).toBe(false);
  });
});

describe('правка задач', () => {
  it('меняет текст, срок, тип и исполнителя', () => {
    let deal = addTask(makeDeal(), { title: 'Позвонить', kind: 'call', dueAt: '2026-10-25', done: false });
    const id = deal.tasks[0].id;
    deal = patchTask(deal, id, { title: 'Позвонить и уточнить размеры', kind: 'measure', dueAt: '2026-10-27', assignee: 'Сергей' });
    expect(deal.tasks[0]).toMatchObject({
      title: 'Позвонить и уточнить размеры', kind: 'measure', dueAt: '2026-10-27', assignee: 'Сергей',
    });
    expect(deal.updatedAt >= deal.tasks[0].createdAt).toBe(true);
  });

  it('не трогает остальные задачи', () => {
    let deal = addTask(makeDeal(), { title: 'Первая', kind: 'call', done: false });
    deal = addTask(deal, { title: 'Вторая', kind: 'docs', done: false });
    deal = patchTask(deal, deal.tasks[1].id, { title: 'Вторая, исправленная' });
    expect(deal.tasks[0].title).toBe('Первая');
    expect(deal.tasks[1].title).toBe('Вторая, исправленная');
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

  it('правит существующий платёж', () => {
    let deal = addPayment(makeDeal({ amount: 100000 }), { amount: 40000, at: '2026-10-01', kind: 'prepay' });
    const id = deal.payments[0].id;
    deal = patchPayment(deal, id, { amount: 50000, comment: 'наличными' });
    expect(paidAmount(deal.payments)).toBe(50000);
    expect(deal.payments[0].comment).toBe('наличными');
    expect(paymentState(deal).remainder).toBe(50000);
  });

  it('без платежей — остаток равен сумме', () => {
    expect(paymentState(makeDeal({ amount: 70000 }))).toMatchObject({ paid: 0, remainder: 70000, tone: 'muted' });
  });
});

describe('сумма из поля ввода', () => {
  it('не сбрасывает поле из-за случайной буквы', async () => {
    const { amountFromInput } = await import('./utils');
    expect(amountFromInput('150000')).toBe(150000);
    expect(amountFromInput('150 000')).toBe(150000);
    expect(amountFromInput('12a')).toBe(12);
    expect(amountFromInput('1,5')).toBe(1.5);
    expect(amountFromInput('')).toBe(0);
    expect(amountFromInput('abc')).toBe(0);
    expect(amountFromInput('-5')).toBe(5);
  });
});
