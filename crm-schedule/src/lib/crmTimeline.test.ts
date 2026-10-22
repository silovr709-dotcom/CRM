import { describe, expect, it } from 'vitest';
import { buildDealTimeline } from './crmTimeline';
import { fmtMoney } from './dates';
import { makeDeal } from './testUtils';

describe('лента сделки', () => {
  it('собирает задачи, оплаты и историю в обратном порядке', () => {
    const deal = makeDeal({
      tasks: [{ id: 't1', title: 'Позвонить', kind: 'call', createdAt: '2026-10-01T10:00:00.000Z' }],
      payments: [{ id: 'p1', amount: 50000, at: '2026-10-05', kind: 'prepay', comment: 'наличные' }],
      history: [{ id: 'h1', createdAt: '2026-10-06T10:00:00.000Z', kind: 'status', title: 'Смена этапа' }],
      createdAt: '2026-09-01T10:00:00.000Z',
    });
    const events = buildDealTimeline(deal);
    expect(events.map((event) => event.kind)).toEqual(['status', 'payment', 'task', 'project']);
    expect(events.find((event) => event.kind === 'payment')?.title).toContain(fmtMoney(50000));
  });
});
