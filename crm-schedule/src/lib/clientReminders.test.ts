// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Client, Deal } from '../types';
import { makeDeal } from './testUtils';
import {
  CLIENT_REMINDER_META, clientReminders, reminderHistoryTitle, sentReminders,
} from './clientReminders';
import { fmtMoney } from './dates';

const today = '2026-11-10';
const settings = { companyName: 'Кухни Лада', myName: 'Ирина' };

const client: Client = {
  id: 'client-1',
  name: 'Анна Смирнова',
  phones: ['+7 900 111-22-33'],
  emails: [],
  tags: [],
  createdAt: '2026-01-01T09:00:00.000Z',
  updatedAt: '2026-01-01T09:00:00.000Z',
};

function deal(patch: Partial<Deal> = {}): Deal {
  return makeDeal({
    amount: 100000,
    manager: 'Ирина',
    schedule: { status: 'planned' },
    ...patch,
  });
}

function kinds(list: ReturnType<typeof clientReminders>): string[] {
  return list.map((item) => item.kind);
}

describe('напоминания клиенту', () => {
  it('напоминает о замере и монтаже за день', () => {
    const list = clientReminders([deal({
      schedule: {
        status: 'planned',
        measureAt: '2026-11-12',
        installAt: '2026-11-20',
        timeStart: '10:00',
        timeEnd: '14:00',
        address: 'Ленина, 42',
        team: 'Бригада №2',
      },
    })], [client], settings, { today, horizonDays: 60 });

    const measure = list.find((item) => item.kind === 'measure');
    expect(measure?.dueAt).toBe('2026-11-11');
    expect(measure?.text).toContain('Анна, добрый день!');
    expect(measure?.text).toContain('Ленина, 42');

    const install = list.find((item) => item.kind === 'install');
    expect(install?.dueAt).toBe('2026-11-19');
    expect(install?.text).toContain('10:00–14:00');
    expect(install?.text).toContain('Бригада №2');
    expect(install?.text).toContain('Кухни Лада');

    // Через день после монтажа — просьба про отзыв.
    const review = list.find((item) => item.kind === 'review');
    expect(review?.dueAt).toBe('2026-11-21');
    expect(review?.text).toContain('Всё устраивает');
  });

  it('сортирует по дате и помечает срочность', () => {
    const list = clientReminders([deal({
      schedule: { status: 'planned', measureAt: '2026-11-10', installAt: '2026-12-01' },
    })], [client], settings, { today, horizonDays: 60 });

    expect(list.map((item) => item.dueAt)).toEqual([...list.map((item) => item.dueAt)].sort());
    expect(list[0].urgency).toBe('overdue');
    expect(clientReminders([deal({ schedule: { status: 'planned', measureAt: '2026-11-11' } })], [client], settings, { today })[0].urgency)
      .toBe('today');
    expect(clientReminders([deal({ schedule: { status: 'planned', measureAt: '2026-11-13' } })], [client], settings, { today })[0].urgency)
      .toBe('soon');
    expect(clientReminders([deal({ schedule: { status: 'planned', measureAt: '2026-11-25' } })], [client], settings, { today })[0].urgency)
      .toBe('later');
  });

  it('не берёт отказанные заказы и далёкие события', () => {
    const rejected = deal({ status: 'rejected', schedule: { status: 'planned', installAt: '2026-11-15' } });
    expect(clientReminders([rejected], [client], settings, { today })).toEqual([]);

    const far = deal({ schedule: { status: 'planned', installAt: '2027-03-01' } });
    expect(clientReminders([far], [client], settings, { today, horizonDays: 30 })).toEqual([]);
  });

  it('просит остаток к оплате за три дня до плановой даты', () => {
    const list = clientReminders([deal({
      plan: [{ id: 'p1', amount: 40000, at: '2026-11-20', kind: 'final' }],
      payments: [{ id: 'pay1', amount: 60000, at: '2026-11-01', kind: 'prepay' }],
    })], [client], settings, { today });

    const payment = list.find((item) => item.kind === 'payment');
    expect(payment?.dueAt).toBe('2026-11-17');
    expect(payment?.text).toContain(fmtMoney(40000));
    expect(payment?.text).toContain('Как удобнее внести');
  });

  it('не просит денег, если всё оплачено', () => {
    const list = clientReminders([deal({
      amount: 50000,
      plan: [{ id: 'p1', amount: 50000, at: '2026-11-20', kind: 'final' }],
      payments: [{ id: 'pay1', amount: 50000, at: '2026-11-01', kind: 'prepay' }],
    })], [client], settings, { today });
    expect(kinds(list)).not.toContain('payment');
  });

  it('помнит, что клиенту уже написали', () => {
    const reminderId = 'deal-1:install:2026-11-19';
    const withHistory = deal({
      schedule: { status: 'planned', installAt: '2026-11-20' },
      history: [{
        id: 'h1',
        createdAt: '2026-11-18T09:00:00.000Z',
        kind: 'contact',
        title: reminderHistoryTitle(reminderId),
        text: 'Напоминание отправлено: WhatsApp',
      }],
    });

    expect(sentReminders(withHistory)[reminderId]).toBe('2026-11-18T09:00:00.000Z');
    // По умолчанию отправленные не показываем (но просьба про отзыв остаётся).
    const visible = clientReminders([withHistory], [client], settings, { today, horizonDays: 60 });
    expect(visible.map((item) => item.kind)).not.toContain('install');
    expect(visible.map((item) => item.kind)).toContain('review');
    const all = clientReminders([withHistory], [client], settings, { today, horizonDays: 60, includeSent: true });
    expect(all.find((item) => item.kind === 'install')?.sentAt).toBe('2026-11-18T09:00:00.000Z');
  });

  it('у каждого вида есть подпись и иконка', () => {
    expect(Object.keys(CLIENT_REMINDER_META).sort()).toEqual(['delivery', 'install', 'measure', 'payment', 'review']);
    for (const meta of Object.values(CLIENT_REMINDER_META)) {
      expect(meta.label.length).toBeGreaterThan(2);
      expect(meta.icon.length).toBeGreaterThan(0);
    }
  });
});
