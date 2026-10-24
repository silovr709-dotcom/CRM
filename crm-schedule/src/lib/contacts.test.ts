import { describe, expect, it } from 'vitest';
import {
  buildContact, contactLine, contactSummary, CONTACT_RULE_DAYS, nextContactAfter, quietTooLong,
  QUIET_DAYS, sinceLabel, CHANNEL_META, OUTCOME_META,
} from './contacts';
import type { ContactEntry } from '../types';

function entry(patch: Partial<ContactEntry> = {}): ContactEntry {
  return {
    id: 'c-1',
    at: '2026-10-20T10:00:00.000Z',
    channel: 'call',
    outcome: 'reached',
    ...patch,
  };
}

describe('следующий контакт по результату', () => {
  it('поговорили — через 2 дня, не взял — завтра, написал — через 3', () => {
    expect(nextContactAfter('reached', '2026-10-24')).toBe('2026-10-26');
    expect(nextContactAfter('noAnswer', '2026-10-24')).toBe('2026-10-25');
    expect(nextContactAfter('messaged', '2026-10-24')).toBe('2026-10-27');
  });

  it('договорились и отказ срок сами не ставят', () => {
    expect(nextContactAfter('scheduled', '2026-10-24')).toBeUndefined();
    expect(nextContactAfter('declined', '2026-10-24')).toBeUndefined();
    expect(CONTACT_RULE_DAYS.scheduled).toBeUndefined();
  });

  it('свой срок важнее правила', () => {
    expect(nextContactAfter('reached', '2026-10-24', 10)).toBe('2026-11-03');
    expect(nextContactAfter('reached', '2026-10-24', 0)).toBe('2026-10-24');
  });
});

describe('запись касания', () => {
  it('пишет журнал, историю и новый срок одним действием', () => {
    const result = buildContact({
      channel: 'call', outcome: 'reached', author: 'Ирина', note: 'Ждёт замер',
      at: '2026-10-24T14:03:00.000Z', today: '2026-10-24',
    });

    expect(result.entry).toMatchObject({
      channel: 'call', outcome: 'reached', author: 'Ирина', note: 'Ждёт замер', nextAt: '2026-10-26',
    });
    expect(result.history.kind).toBe('contact');
    expect(result.history.title).toBe('Связь: поговорили');
    expect(result.history.text).toContain('Ждёт замер');
    expect(result.history.text).toContain('2026-10-26');
    expect(result.nextContactAt).toBe('2026-10-26');
  });

  it('пустая заметка не попадает в запись', () => {
    const result = buildContact({ channel: 'whatsapp', outcome: 'messaged', note: '   ', today: '2026-10-24' });
    expect(result.entry.note).toBeUndefined();
    expect(result.history.text).not.toContain('undefined');
  });

  it('свой срок можно снять пустой строкой', () => {
    const result = buildContact({ channel: 'call', outcome: 'reached', nextAt: '', today: '2026-10-24' });
    expect(result.nextContactAt).toBeUndefined();
    expect(result.entry.nextAt).toBeUndefined();
  });

  it('отказ снимает срок контакта, а не ставит новый', () => {
    const result = buildContact({ channel: 'call', outcome: 'declined', today: '2026-10-24' });
    expect(result.nextContactAt).toBeUndefined();
  });
});

describe('сводка журнала', () => {
  it('считает последнее касание, дни тишины и серию недозвонов', () => {
    const summary = contactSummary([
      entry({ id: 'a', at: '2026-10-10T10:00:00.000Z', outcome: 'reached' }),
      entry({ id: 'b', at: '2026-10-20T10:00:00.000Z', outcome: 'noAnswer' }),
      entry({ id: 'c', at: '2026-10-23T10:00:00.000Z', outcome: 'noAnswer' }),
    ], '2026-10-24');

    expect(summary.total).toBe(3);
    expect(summary.last?.id).toBe('c');
    expect(summary.daysSince).toBe(1);
    expect(summary.noAnswerStreak).toBe(2);
    expect(summary.reached).toBe(true);
  });

  it('пустой журнал не врёт про сроки', () => {
    const summary = contactSummary(undefined, '2026-10-24');
    expect(summary.total).toBe(0);
    expect(summary.daysSince).toBeUndefined();
    expect(summary.reached).toBe(false);
    expect(quietTooLong(summary)).toBe(false);
  });

  it('долгая тишина подсвечивается', () => {
    const summary = contactSummary([entry({ at: '2026-10-01T10:00:00.000Z' })], '2026-10-24');
    expect(summary.daysSince).toBe(23);
    expect(quietTooLong(summary)).toBe(true);
    expect(QUIET_DAYS).toBe(10);
  });
});

describe('человеческие подписи', () => {
  it('дни без связи читаются по-русски', () => {
    expect(sinceLabel(0)).toBe('связь сегодня');
    expect(sinceLabel(1)).toBe('связь вчера');
    expect(sinceLabel(3)).toBe('связь 3 дня назад');
    expect(sinceLabel(12)).toBe('связь 12 дней назад');
    expect(sinceLabel(undefined)).toBe('связи не было');
  });

  it('у каждого канала и результата есть подпись и подсказка', () => {
    Object.values(CHANNEL_META).forEach((meta) => {
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.hint.length).toBeGreaterThan(0);
    });
    Object.values(OUTCOME_META).forEach((meta) => {
      expect(meta.label.length).toBeGreaterThan(0);
    });
    expect(CHANNEL_META.whatsapp.label).toBe('WhatsApp');
    expect(OUTCOME_META.noAnswer.label).toBe('Не взял');
  });

  it('последнее касание описывается одной строкой', () => {
    expect(contactLine(undefined)).toBe('Связи ещё не было');
    expect(contactLine(entry({ at: '2026-10-20T14:03:00.000Z' }))).toContain('Звонок');
    expect(contactLine(entry({ at: '2026-10-20T14:03:00.000Z' }))).toContain('поговорили');
  });
});
