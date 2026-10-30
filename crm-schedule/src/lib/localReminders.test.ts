import { describe, expect, it } from 'vitest';
import type { PlannedReminder } from './reminders';
import { collectSchedulable, planLocalSync, wasShownLocally } from './localReminders';

function planned(patch: Partial<PlannedReminder> = {}): PlannedReminder {
  return {
    id: 'r1',
    ruleId: 'rule-install',
    ruleLabel: 'Монтаж',
    source: 'install',
    title: 'Монтаж: Кухня',
    detail: 'Иванов · Ленина, 1',
    momentAt: '2026-10-30T07:00:00.000Z',
    notifyAt: '2026-10-30T06:00:00.000Z',
    offsetMinutes: 60,
    priority: 'normal',
    channels: ['inapp', 'browser'],
    waitingForQuiet: false,
    ...patch,
  };
}

const NOW = new Date('2026-10-30T05:00:00.000Z').getTime();

describe('локальное расписание уведомлений', () => {
  it('берёт только браузерный канал и только будущее', () => {
    const items = collectSchedulable([
      planned(),
      planned({ id: 'r2', channels: ['inapp'] }),
      planned({ id: 'r3', notifyAt: '2026-10-30T04:00:00.000Z' }),
    ], NOW);
    expect(items.map((item) => item.id)).toEqual(['r1']);
    expect(items[0].notifyAt).toBe(new Date('2026-10-30T06:00:00.000Z').getTime());
  });

  it('сортирую по времени и убираю дубли', () => {
    const items = collectSchedulable([
      planned({ id: 'late', notifyAt: '2026-10-30T09:00:00.000Z' }),
      planned({ id: 'early', notifyAt: '2026-10-30T06:30:00.000Z' }),
      planned({ id: 'early', notifyAt: '2026-10-30T06:30:00.000Z' }),
    ], NOW);
    expect(items.map((item) => item.id)).toEqual(['early', 'late']);
  });

  it('не переставляет уже стоящее с тем же временем', () => {
    const desired = collectSchedulable([planned()], NOW);
    const plan = planLocalSync(desired, { r1: desired[0].notifyAt }, NOW);
    expect(plan.toSchedule).toHaveLength(0);
    expect(plan.toCancel).toHaveLength(0);
    expect(plan.nextRegistry).toEqual({ r1: desired[0].notifyAt });
  });

  it('снимает лишнее и переставляет изменившееся', () => {
    const desired = collectSchedulable([planned()], NOW);
    const plan = planLocalSync(desired, {
      r1: desired[0].notifyAt - 60000,
      gone: NOW + 3600000,
      past: NOW - 60000,
    }, NOW);
    expect(plan.toSchedule.map((item) => item.id)).toEqual(['r1']);
    expect(plan.toCancel).toEqual(['gone']);
    expect(plan.nextRegistry).toEqual({ r1: desired[0].notifyAt });
  });

  it('понимает, что система уже показала уведомление', () => {
    const registry = { r1: NOW - 1000, r2: NOW + 60000 };
    expect(wasShownLocally('r1', registry, NOW)).toBe(true);
    expect(wasShownLocally('r2', registry, NOW)).toBe(false);
    expect(wasShownLocally('unknown', registry, NOW)).toBe(false);
  });
});
