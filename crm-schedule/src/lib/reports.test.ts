import { describe, expect, it } from 'vitest';
import type { Client, Deal } from '../types';
import { makeDeal } from './testUtils';
import {
  breakdown, byManager, bySource, conversion, dailyMoney, dealsCsv, funnel, lostReasons,
  monthlyMoney, periodRange, reportCsv, shiftPeriod, totals,
} from './reports';

const today = '2026-10-24';
const month = periodRange('month', today);
const range = { from: month.from, to: month.to };

function deal(patch: Partial<Deal> = {}): Deal {
  return makeDeal(patch);
}

function client(patch: Partial<Client> = {}): Client {
  return {
    id: 'client-1', name: 'Анна', phones: [], emails: [], tags: [],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    ...patch,
  };
}

describe('периоды', () => {
  it('месяц, квартал и год от сегодняшней даты', () => {
    expect(periodRange('month', today)).toMatchObject({ from: '2026-10-01', to: '2026-10-31', label: 'Октябрь 2026' });
    expect(periodRange('quarter', today)).toMatchObject({ from: '2026-10-01', to: '2026-12-31', label: 'IV квартал 2026' });
    expect(periodRange('year', today)).toMatchObject({ from: '2026-01-01', to: '2026-12-31', label: 'Год 2026' });
  });

  it('учитывает короткие месяцы и февраль', () => {
    expect(periodRange('month', '2026-02-15').to).toBe('2026-02-28');
    expect(periodRange('month', '2028-02-15').to).toBe('2028-02-29');
  });

  it('листает периоды назад и вперёд', () => {
    expect(shiftPeriod('month', month, -1)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(shiftPeriod('month', { from: '2026-01-01', to: '2026-01-31', label: '' }, -1))
      .toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(shiftPeriod('quarter', periodRange('quarter', today), 1))
      .toEqual({ from: '2027-01-01', to: '2027-03-31' });
    expect(shiftPeriod('quarter', periodRange('quarter', '2026-02-10'), -1))
      .toEqual({ from: '2025-10-01', to: '2025-12-31' });
    expect(shiftPeriod('year', periodRange('year', today), -1))
      .toEqual({ from: '2025-01-01', to: '2025-12-31' });
  });

  it('берёт свой период как есть', () => {
    expect(periodRange('custom', today, { from: '2026-03-01', to: '2026-04-15' }).from).toBe('2026-03-01');
  });
});

describe('итоги периода', () => {
  const deals: Deal[] = [
    deal({ id: 'd1', amount: 200000, createdAt: '2026-10-02T09:00:00.000Z', status: 'delivered',
      payments: [{ id: 'p1', amount: 100000, at: '2026-10-05', kind: 'prepay' }, { id: 'p2', amount: 100000, at: '2026-10-20', kind: 'final' }],
      expenses: [{ id: 'e1', kind: 'materials', amount: 80000, at: '2026-10-03' }] }),
    deal({ id: 'd2', amount: 100000, createdAt: '2026-09-15T09:00:00.000Z', status: 'production',
      payments: [{ id: 'p3', amount: 50000, at: '2026-10-10', kind: 'prepay' }],
      expenses: [{ id: 'e2', kind: 'factory', amount: 20000, at: '2026-10-11' }] }),
    deal({ id: 'd3', amount: 50000, createdAt: '2026-10-08T09:00:00.000Z', status: 'rejected', lostReason: 'дорого' }),
  ];

  it('считает новые сделки, деньги и затраты за период', () => {
    const result = totals(deals, range);
    expect(result.bookedCount).toBe(2);
    expect(result.booked).toBe(250000);
    expect(result.received).toBe(250000);
    expect(result.spent).toBe(100000);
    expect(result.cash).toBe(150000);
    expect(result.averageDeal).toBe(125000);
  });

  it('маржа считается по сделкам периода, а не по всем', () => {
    const result = totals(deals, range);
    // 200 000 − 80 000 (у d1) + 50 000 − 0 (у d3 без затрат)
    expect(result.margin).toBe(170000);
    expect(result.marginPercent).toBe(68);
  });

  it('считает портфель и что ждём оплатить', () => {
    const result = totals(deals, range);
    expect(result.activeDeals).toBe(1);
    expect(result.pipeline).toBe(100000);
    expect(result.receivable).toBe(50000);
    expect(result.closedWon).toBe(1);
    expect(result.closedLost).toBe(1);
  });

  it('пустой период не делит на ноль', () => {
    const empty = totals([], { from: '2020-01-01', to: '2020-01-31' });
    expect(empty.booked).toBe(0);
    expect(empty.averageDeal).toBe(0);
    expect(empty.marginPercent).toBe(0);
    expect(empty.cash).toBe(0);
  });
});

describe('разбивки', () => {
  const deals: Deal[] = [
    deal({ id: 'a', amount: 100000, manager: 'Ирина', clientId: 'c1', createdAt: '2026-10-01T00:00:00.000Z' }),
    deal({ id: 'b', amount: 300000, manager: 'Сергей', clientId: 'c2', createdAt: '2026-10-05T00:00:00.000Z' }),
    deal({ id: 'c', amount: 100000, manager: 'Ирина', clientId: 'c1', createdAt: '2026-10-09T00:00:00.000Z' }),
    deal({ id: 'd', amount: 900000, manager: 'Ирина', clientId: 'c1', createdAt: '2026-08-09T00:00:00.000Z' }),
  ];
  const clients: Client[] = [client({ id: 'c1', source: 'Авито', tags: ['кухня'] }), client({ id: 'c2', source: 'Сарафан' })];

  it('по менеджерам — только сделки периода, крупные сверху', () => {
    const slices = byManager(deals, range);
    expect(slices[0]).toMatchObject({ label: 'Сергей', deals: 1, amount: 300000 });
    expect(slices[1]).toMatchObject({ label: 'Ирина', deals: 2, amount: 200000 });
    expect(slices.reduce((sum, slice) => sum + slice.share, 0)).toBeCloseTo(1, 5);
  });

  it('по источникам — из карточки клиента', () => {
    const slices = bySource(deals, clients, range);
    expect(slices.map((slice) => slice.label).sort()).toEqual(['Авито', 'Сарафан']);
    expect(slices.find((slice) => slice.label === 'Авито')?.amount).toBe(200000);
  });

  it('пустое значение подписано, а не теряется', () => {
    const slices = breakdown(deals, range, (item) => [item.manager ?? '']);
    const withoutManager = breakdown(
      [deal({ id: 'x', amount: 1000, manager: undefined, createdAt: '2026-10-02T00:00:00.000Z' })],
      range,
      (item) => [item.manager ?? ''],
    );
    expect(slices.length).toBe(2);
    expect(withoutManager[0].label).toBe('не указано');
  });

  it('причины отказа — за период, с суммами', () => {
    const lost = [
      deal({ id: 'l1', amount: 100000, status: 'rejected', lostReason: 'дорого', createdAt: '2026-10-02T00:00:00.000Z' }),
      deal({ id: 'l2', amount: 50000, status: 'rejected', lostReason: 'дорого', createdAt: '2026-10-03T00:00:00.000Z' }),
      deal({ id: 'l3', amount: 70000, status: 'rejected', createdAt: '2026-10-04T00:00:00.000Z' }),
      deal({ id: 'l4', amount: 900000, status: 'rejected', lostReason: 'дорого', createdAt: '2025-10-04T00:00:00.000Z' }),
    ];
    const slices = lostReasons(lost, range);
    expect(slices[0]).toMatchObject({ label: 'дорого', deals: 2, amount: 150000 });
    expect(slices.find((slice) => slice.label === 'не указано')?.deals).toBe(1);
  });
});

describe('воронка и конверсия', () => {
  const deals: Deal[] = [
    deal({ id: '1', status: 'draft', amount: 100000, createdAt: '2026-10-01T00:00:00.000Z' }),
    deal({ id: '2', status: 'offerSent', amount: 200000, createdAt: '2026-10-02T00:00:00.000Z' }),
    deal({ id: '3', status: 'approved', amount: 300000, createdAt: '2026-10-03T00:00:00.000Z' }),
    deal({ id: '4', status: 'delivered', amount: 400000, createdAt: '2026-10-04T00:00:00.000Z' }),
    deal({ id: '5', status: 'rejected', amount: 500000, lostReason: 'сроки', createdAt: '2026-10-05T00:00:00.000Z' }),
    deal({ id: '6', status: 'production', amount: 600000, createdAt: '2026-09-05T00:00:00.000Z' }),
  ];

  it('воронка считает только новые сделки периода', () => {
    const stages = funnel(deals, range);
    expect(stages.reduce((sum, stage) => sum + stage.count, 0)).toBe(5);
    expect(stages.find((stage) => stage.status === 'approved')).toMatchObject({ count: 1, amount: 300000 });
  });

  it('конверсия: отказы не считаются дошедшими до этапа', () => {
    const stats = conversion(deals, range);
    expect(stats.leads).toBe(5);
    expect(stats.approved).toBe(2);
    expect(stats.installed).toBe(1);
    expect(stats.lost).toBe(1);
    expect(stats.winRate).toBe(20);
  });
});

describe('деньги по дням и месяцам', () => {
  it('раскладывает поступления и затраты по дням периода', () => {
    const points = dailyMoney([
      deal({ payments: [{ id: 'p', amount: 10000, at: '2026-10-03', kind: 'prepay' }], expenses: [{ id: 'e', kind: 'other', amount: 4000, at: '2026-10-03' }] }),
    ], { from: '2026-10-01', to: '2026-10-05' });
    expect(points).toHaveLength(5);
    expect(points[2]).toEqual({ day: '2026-10-03', received: 10000, spent: 4000 });
    expect(points[0].received).toBe(0);
  });

  it('годовой отчёт по месяцам', () => {
    const rows = monthlyMoney([
      deal({ payments: [{ id: 'p', amount: 70000, at: '2026-03-10', kind: 'prepay' }] }),
      deal({ payments: [{ id: 'p2', amount: 70000, at: '2025-03-10', kind: 'prepay' }] }),
    ], 2026);
    expect(rows).toHaveLength(12);
    expect(rows[2].received).toBe(70000);
  });
});

describe('выгрузка в CSV', () => {
  const deals = [deal({
    id: 'd1', title: 'Кухня; на Ленина', amount: 200000, createdAt: '2026-10-02T00:00:00.000Z',
    payments: [{ id: 'p', amount: 50000, at: '2026-10-03', kind: 'prepay' }],
    expenses: [{ id: 'e', kind: 'materials', amount: 120000, at: '2026-10-03' }],
  })];

  it('экранирует кавычки и разделитель, ставит BOM', () => {
    const csv = dealsCsv(deals, range, () => 'Анна "Аня"');
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('"Кухня; на Ленина"');
    expect(csv).toContain('"Анна ""Аня"""');
    expect(csv.split('\n')[0]).toContain('Маржа %');
  });

  it('считает маржу в строке сделки', () => {
    const csv = dealsCsv(deals, range, () => 'Анна');
    const line = csv.split('\n')[1];
    expect(line).toContain('"80000"');
    expect(line).toContain('"40"');
  });

  it('отчёт целиком содержит показатели и разбивки', () => {
    const csv = reportCsv(
      totals(deals, range),
      byManager(deals, range),
      bySource(deals, [], range),
      lostReasons(deals, range),
      month,
    );
    expect(csv).toContain('"Отчёт";"Октябрь 2026"');
    expect(csv).toContain('"Получено денег"');
    expect(csv).toContain('"не указано"');
  });
});
