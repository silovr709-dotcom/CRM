import { describe, expect, it } from 'vitest';
import {
  buildDealRows, compareCrmRows, CRM_STAGES, focusCounts, matchesFocus, matchesQuery,
  summarizeStages, type CrmRowLike,
} from './crmBoard';
import { makeDeal } from './testUtils';

function row(patch: Partial<CrmRowLike> = {}): CrmRowLike {
  return {
    status: 'draft',
    tone: 'none',
    hasNextAction: false,
    closed: false,
    total: 100000,
    updatedAt: '2026-10-01T00:00:00Z',
    search: 'анна кухня',
    ...patch,
  };
}

describe('фокусы CRM', () => {
  it('сегодня — только активные с сегодняшним или просроченным контактом', () => {
    expect(matchesFocus(row({ tone: 'today' }), 'today')).toBe(true);
    expect(matchesFocus(row({ tone: 'overdue' }), 'today')).toBe(true);
    expect(matchesFocus(row({ tone: 'soon' }), 'today')).toBe(false);
    expect(matchesFocus(row({ tone: 'today', closed: true }), 'today')).toBe(false);
  });

  it('без следующего шага — активные без действия или срока', () => {
    expect(matchesFocus(row({ hasNextAction: false }), 'no-next')).toBe(true);
    expect(matchesFocus(row({ hasNextAction: true, tone: 'none' }), 'no-next')).toBe(true);
    expect(matchesFocus(row({ hasNextAction: true, tone: 'planned' }), 'no-next')).toBe(false);
  });

  it('поиск не зависит от регистра', () => {
    expect(matchesQuery(row(), 'КУХНЯ')).toBe(true);
    expect(matchesQuery(row(), 'шкаф')).toBe(false);
    expect(matchesQuery(row(), '   ')).toBe(true);
  });
});

describe('сортировка и сводка', () => {
  it('срочные выше, затем свежие изменения', () => {
    const rows = [
      row({ tone: 'planned', updatedAt: '2026-10-01T00:00:00Z' }),
      row({ tone: 'overdue', updatedAt: '2026-09-01T00:00:00Z' }),
      row({ tone: 'today', updatedAt: '2026-10-05T00:00:00Z' }),
    ];
    expect([...rows].sort(compareCrmRows).map((item) => item.tone)).toEqual(['overdue', 'today', 'planned']);
  });

  it('считает активные, сегодняшние и портфель', () => {
    const counts = focusCounts([
      row({ tone: 'overdue', total: 100 }),
      row({ tone: 'today', total: 200 }),
      row({ tone: 'planned', total: 300 }),
      row({ closed: true, status: 'delivered', total: 400 }),
    ]);
    expect(counts.active).toBe(3);
    expect(counts.closed).toBe(1);
    expect(counts.today).toBe(2);
    expect(counts.pipeline).toBe(600);
  });

  it('воронка содержит пять этапов и суммы', () => {
    expect(CRM_STAGES).toHaveLength(5);
    const stages = summarizeStages([
      row({ status: 'draft', total: 100 }),
      row({ status: 'offerSent', total: 200 }),
      row({ status: 'production', total: 300 }),
    ]);
    expect(stages[0]).toMatchObject({ id: 'lead', count: 1, total: 100 });
    expect(stages[1]).toMatchObject({ id: 'offer', count: 1, total: 200 });
    expect(stages[3]).toMatchObject({ id: 'production', count: 1, total: 300 });
  });
});

describe('строки сделок', () => {
  it('учитывают задачу и поиск по клиенту', () => {
    const rows = buildDealRows(
      [makeDeal({ tasks: [{ id: 't1', title: 'Позвонить', kind: 'call', createdAt: '2026-10-01T00:00:00Z' }] })],
      () => 'Анна Смирнова',
      '2026-10-22',
    );
    expect(rows[0].hasNextAction).toBe(true);
    expect(rows[0].search).toContain('Анна Смирнова');
    expect(rows[0].search).toContain('Позвонить');
  });
});
