import { describe, expect, it } from 'vitest';
import { dealsForToday, installsThisWeek, overview, paidThisMonth } from './metrics';
import { makeDeal } from './testUtils';

const today = '2026-10-22';

describe('сводка обзора', () => {
  it('считает оплаты текущего месяца', () => {
    const deals = [
      makeDeal({ payments: [{ id: 'p1', amount: 50000, at: '2026-10-01', kind: 'prepay' }, { id: 'p2', amount: 20000, at: '2026-09-30', kind: 'prepay' }] }),
      makeDeal({ id: 'd2', payments: [{ id: 'p3', amount: 15000, at: '2026-10-15', kind: 'final' }] }),
    ];
    expect(paidThisMonth(deals, today)).toBe(65000);
  });

  it('монтажи недели — с понедельника по воскресенье', () => {
    const events = [
      { id: '1', kind: 'install' as const, date: '2026-10-19', dealId: 'd', dealTitle: 'a', client: '', status: 'planned' as const, amount: 0 },
      { id: '2', kind: 'install' as const, date: '2026-10-25', dealId: 'd', dealTitle: 'a', client: '', status: 'planned' as const, amount: 0 },
      { id: '3', kind: 'install' as const, date: '2026-10-26', dealId: 'd', dealTitle: 'a', client: '', status: 'planned' as const, amount: 0 },
    ];
    expect(installsThisWeek(events, today).map((event) => event.id)).toEqual(['1', '2']);
  });

  it('собирает срочные сделки и показатели', () => {
    const deals = [
      makeDeal({ id: 'a', nextContactAt: '2026-10-20', amount: 100000 }),
      makeDeal({ id: 'b', nextContactAt: today, amount: 200000 }),
      makeDeal({ id: 'c', nextContactAt: '2026-11-20', amount: 300000 }),
      makeDeal({ id: 'd', status: 'delivered', nextContactAt: today, amount: 400000 }),
    ];
    expect(dealsForToday(deals, today).map((deal) => deal.id)).toEqual(['a', 'b']);
    const stats = overview(deals, 2, today);
    expect(stats.activeDeals).toBe(3);
    expect(stats.pipeline).toBe(600000);
    expect(stats.contactsToday).toBe(1);
    expect(stats.contactsOverdue).toBe(1);
    expect(stats.warnings).toBe(2);
  });
});
