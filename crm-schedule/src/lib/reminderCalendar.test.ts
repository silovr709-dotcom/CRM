import { describe, expect, it } from 'vitest';
import type { PlannedReminder } from './reminders';
import { buildRemindersIcs } from './reminderCalendar';

function planned(patch: Partial<PlannedReminder> = {}): PlannedReminder {
  return {
    id: 'rule-install|install:d1|60|2026-10-30',
    ruleId: 'rule-install',
    ruleLabel: 'Монтаж',
    source: 'install',
    dealId: 'd1',
    title: 'Монтаж: Кухня, Ленина',
    detail: 'Иванов · остаток 10 000 ₽',
    momentAt: '2026-10-30T07:00:00.000Z',
    notifyAt: '2026-10-30T06:00:00.000Z',
    offsetMinutes: 60,
    priority: 'normal',
    channels: ['inapp', 'browser'],
    waitingForQuiet: false,
    ...patch,
  };
}

describe('календарь напоминаний для телефона', () => {
  it('ставит будильник абсолютным временем показа', () => {
    const ics = buildRemindersIcs([planned()], 'Visma Mebel');
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('DTSTART:20261030T070000Z');
    expect(ics).toContain('BEGIN:VALARM');
    expect(ics).toContain('TRIGGER;VALUE=DATE-TIME:20261030T060000Z');
    expect(ics).toContain('SUMMARY:Монтаж: Кухня\\, Ленина');
    expect(ics).toContain('END:VCALENDAR');
  });

  it('сортирует события по времени показа и пропускает битые даты', () => {
    const ics = buildRemindersIcs([
      planned({ id: 'b', notifyAt: '2026-10-30T09:00:00.000Z', momentAt: '2026-10-30T10:00:00.000Z' }),
      planned({ id: 'a', notifyAt: '2026-10-30T06:00:00.000Z' }),
      planned({ id: 'bad', notifyAt: 'не дата', momentAt: 'не дата' }),
    ]);
    const events = ics.split('BEGIN:VEVENT').slice(1);
    expect(events).toHaveLength(2);
    expect(events[0]).toContain('UID:a@crm-schedule');
    expect(events[1]).toContain('UID:b@crm-schedule');
  });

  it('пустой список — валидный пустой календарь', () => {
    const ics = buildRemindersIcs([]);
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).not.toContain('BEGIN:VEVENT');
  });
});
