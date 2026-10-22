import { describe, expect, it } from 'vitest';
import { contactTone, defaultNextAction, isClosedStatus, statusMeta, dealMessage } from './crm';
import { fmtMoney } from './dates';
import { makeDeal } from './testUtils';

describe('статусы сделки', () => {
  it('знает подписи и этапы', () => {
    expect(statusMeta('offerSent').label).toBe('КП отправлено');
    expect(statusMeta('production').stage).toBe('production');
    expect(statusMeta('unknown' as never).value).toBe('draft');
  });

  it('закрытыми считаются выданные и отказы', () => {
    expect(isClosedStatus('delivered')).toBe(true);
    expect(isClosedStatus('rejected')).toBe(true);
    expect(isClosedStatus('ready')).toBe(false);
  });

  it('подсказывает следующий шаг', () => {
    expect(defaultNextAction('approved')).toMatch(/договор/i);
    expect(defaultNextAction('production')).toMatch(/срок/i);
  });
});

describe('срочность контакта', () => {
  const today = '2026-10-22';
  it('различает просрочку, сегодня и скоро', () => {
    expect(contactTone('2026-10-20', today)).toBe('overdue');
    expect(contactTone('2026-10-22', today)).toBe('today');
    expect(contactTone('2026-10-24', today)).toBe('soon');
    expect(contactTone('2026-11-20', today)).toBe('planned');
    expect(contactTone(undefined, today)).toBe('none');
  });
});

describe('сообщение клиенту', () => {
  it('зависит от этапа', () => {
    const deal = makeDeal({ status: 'ready', amount: 100000 });
    const text = dealMessage(deal, 'Анна', 40000, fmtMoney);
    expect(text).toContain('Анна');
    expect(text).toContain('готов');
    expect(text).toContain(fmtMoney(60000));
  });
});
