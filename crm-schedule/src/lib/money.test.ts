import { describe, expect, it } from 'vitest';
import type { Deal } from '../types';
import { makeDeal } from './testUtils';
import {
  addExpense, addPlannedPayment, dealMoney, expensesByKind, expensesTotal, receivables,
  patchExpense, patchPlannedPayment, removeExpense, settlePlanByPayments, settlePlannedPayment,
  unsettlePlannedPayment, EXPENSE_KINDS, expenseKindMeta, THIN_MARGIN_PERCENT,
} from './money';

const today = '2026-10-24';

function dealWith(patch: Partial<Deal> = {}): Deal {
  return makeDeal(patch);
}

describe('деньги по сделке', () => {
  it('считает маржу и процент', () => {
    const deal = dealWith({
      amount: 300000,
      expenses: [
        { id: 'e1', kind: 'materials', amount: 120000, at: '2026-10-01' },
        { id: 'e2', kind: 'install', amount: 30000, at: '2026-10-02' },
      ],
    });
    const money = dealMoney(deal);
    expect(money.expenses).toBe(150000);
    expect(money.margin).toBe(150000);
    expect(money.marginPercent).toBe(50);
    expect(money.loss).toBe(false);
    expect(money.thin).toBe(false);
  });

  it('видит убыток и тонкую маржу', () => {
    const loss = dealMoney(dealWith({
      amount: 100000,
      expenses: [{ id: 'e1', kind: 'factory', amount: 120000, at: '2026-10-01' }],
    }));
    expect(loss.loss).toBe(true);
    expect(loss.margin).toBe(-20000);

    const thin = dealMoney(dealWith({
      amount: 100000,
      expenses: [{ id: 'e1', kind: 'factory', amount: 95000, at: '2026-10-01' }],
    }));
    expect(thin.thin).toBe(true);
    expect(thin.marginPercent).toBe(5);
    expect(thin.marginPercent).toBeLessThan(THIN_MARGIN_PERCENT);
  });

  it('не выдумывает маржу, когда затраты не заполнены', () => {
    const money = dealMoney(dealWith({ amount: 100000 }));
    expect(money.expenses).toBe(0);
    expect(money.incomplete).toBe(true);
    // Без затрат «маржа 100%» была бы враньём, поэтому процент не считаем.
    expect(money.marginPercent).toBe(0);
    expect(money.thin).toBe(false);
    expect(money.loss).toBe(false);
  });

  it('учитывает возвраты клиенту и деньги на руках', () => {
    const money = dealMoney(dealWith({
      amount: 100000,
      payments: [
        { id: 'p1', amount: 50000, at: '2026-10-01', kind: 'prepay' },
        { id: 'p2', amount: -10000, at: '2026-10-05', kind: 'refund' },
      ],
      expenses: [{ id: 'e1', kind: 'materials', amount: 20000, at: '2026-10-02' }],
    }));
    expect(money.paid).toBe(40000);
    expect(money.remainder).toBe(60000);
    expect(money.cashNow).toBe(20000);
  });

  it('раскладывает затраты по статьям с долями', () => {
    const deal = dealWith({
      expenses: [
        { id: 'e1', kind: 'materials', amount: 60000, at: '2026-10-01' },
        { id: 'e2', kind: 'factory', amount: 20000, at: '2026-10-01' },
        { id: 'e3', kind: 'install', amount: 20000, at: '2026-10-01' },
      ],
    });
    expect(expensesTotal(deal)).toBe(100000);
    const slices = expensesByKind(deal);
    expect(slices).toHaveLength(3);
    expect(slices[0].label).toBe('Материалы');
    expect(Math.round(slices[0].share * 100)).toBe(60);
  });

  it('добавляет, правит и удаляет затрату', () => {
    const base = dealWith();
    const added = addExpense(base, { kind: 'delivery', amount: 4500, at: '2026-10-10', comment: 'подъём' });
    expect(added.expenses).toHaveLength(1);
    expect(added.expenses).not.toBe(base.expenses);

    const id = added.expenses![0].id;
    const patched = patchExpense(added, id, { amount: 5000, kind: 'materials' });
    expect(patched.expenses![0].amount).toBe(5000);
    expect(patched.expenses![0].kind).toBe('materials');

    expect(removeExpense(patched, id).expenses).toHaveLength(0);
  });

  it('округлое число из поля ввода не даёт дробей в копейках', () => {
    const added = addExpense(dealWith(), { kind: 'other', amount: 1999.6, at: '2026-10-10' });
    expect(added.expenses![0].amount).toBe(2000);
  });

  it('знает все статьи затрат', () => {
    expect(EXPENSE_KINDS.map((item) => item.id)).toEqual(['materials', 'factory', 'install', 'delivery', 'other']);
    expect(expenseKindMeta('install').short).toBe('Монтаж');
  });
});

describe('план оплат и дебиторка', () => {
  it('создаёт платёж по плану и снимает отметку', () => {
    const base = addPlannedPayment(dealWith({ amount: 200000 }), { amount: 100000, at: '2026-10-20', kind: 'prepay' });
    const planId = base.plan![0].id;

    const settled = settlePlannedPayment(base, planId, '2026-10-21');
    expect(settled.payments).toHaveLength(1);
    expect(settled.payments[0].amount).toBe(100000);
    expect(settled.payments[0].at).toBe('2026-10-21');
    expect(settled.plan![0].paidId).toBeTruthy();

    const back = unsettlePlannedPayment(settled, planId);
    expect(back.payments).toHaveLength(0);
    expect(back.plan![0].paidId).toBeUndefined();
  });

  it('повторно не создаёт платёж по уже оплаченной позиции', () => {
    const deal = settlePlannedPayment(
      addPlannedPayment(dealWith({ amount: 100000 }), { amount: 100000, at: '2026-10-20', kind: 'prepay' }),
      'plan-nothing',
    );
    expect(deal.payments).toHaveLength(0);
  });

  it('правит и удаляет позицию плана', () => {
    const deal = addPlannedPayment(dealWith(), { amount: 50000, at: '2026-11-01', kind: 'final' });
    const id = deal.plan![0].id;
    const patched = patchPlannedPayment(deal, id, { amount: 70000, at: '2026-11-05' });
    expect(patched.plan![0].amount).toBe(70000);
    expect(patched.plan![0].at).toBe('2026-11-05');
  });

  it('собирает дебиторку: сначала самые просроченные', () => {
    const deals: Deal[] = [
      dealWith({ id: 'd1', title: 'Кухня', amount: 200000, payments: [{ id: 'p', amount: 50000, at: '2026-09-01', kind: 'prepay' }],
        plan: [{ id: 'pl1', amount: 150000, at: '2026-10-20', kind: 'final' }] }),
      dealWith({ id: 'd2', title: 'Шкаф', amount: 100000, payments: [{ id: 'p2', amount: 0, at: '2026-09-01', kind: 'prepay' }],
        plan: [{ id: 'pl2', amount: 100000, at: '2026-10-10', kind: 'final' }] }),
      dealWith({ id: 'd3', title: 'Закрытая', amount: 100000, payments: [{ id: 'p3', amount: 100000, at: '2026-09-01', kind: 'final' }] }),
      dealWith({ id: 'd4', title: 'Отказ', status: 'rejected', amount: 100000 }),
    ];
    const items = receivables(deals, today, (deal) => `клиент ${deal.id}`);
    expect(items.map((item) => item.deal.id)).toEqual(['d2', 'd1']);
    expect(items[0].overdue).toBe(14);
    expect(items[1].overdue).toBe(4);
    expect(items[0].client).toBe('клиент d2');
  });

  it('без плана ставит в конец и берёт остаток по договору', () => {
    const deals = [
      dealWith({ id: 'a', amount: 100000 }),
      dealWith({ id: 'b', amount: 50000, plan: [{ id: 'x', amount: 50000, at: '2026-10-01', kind: 'final' }] }),
    ];
    const items = receivables(deals, today);
    expect(items[0].deal.id).toBe('b');
    expect(items[1].deal.id).toBe('a');
    expect(items[1].planned).toBe(100000);
    expect(items[1].dueAt).toBe('');
  });

  it('не показывает в плане больше, чем осталось по договору', () => {
    const deal = dealWith({
      amount: 100000,
      payments: [{ id: 'p', amount: 80000, at: '2026-10-01', kind: 'prepay' }],
      plan: [
        { id: 'x', amount: 60000, at: '2026-10-01', kind: 'prepay' },
        { id: 'y', amount: 60000, at: '2026-11-01', kind: 'final' },
      ],
    });
    const items = receivables([deal], today);
    expect(items[0].remainder).toBe(20000);
    expect(items[0].planned).toBe(20000);
  });

  it('закрывает план, когда долг закрыт деньгами', () => {
    const deal = dealWith({
      amount: 100000,
      payments: [{ id: 'p', amount: 100000, at: '2026-10-01', kind: 'final' }],
      plan: [{ id: 'x', amount: 100000, at: '2026-11-01', kind: 'final' }],
    });
    const settled = settlePlanByPayments(deal);
    expect(settled.plan![0].paidId).toBe('paid');
  });
});
