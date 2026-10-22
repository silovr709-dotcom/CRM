// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import type { ReminderRule, Settings } from '../types';
import {
  CHANNEL_META, clearSent, clearSnoozes, collectMoments, defaultDigest, defaultQuietHours,
  defaultReminderRules, describeRule, digestText, evaluateReminders, fmtOffset, inQuietHours,
  markSentMap, momentAt, quietWindow, readSent, readSnoozes, reminderId, snoozePresets,
  snoozeReminder, SOURCE_META, OFFSET_PRESETS,
} from './reminders';
import { makeDeal } from './testUtils';

const clientName = () => 'Иванов';
const quietOff = { enabled: false, from: '21:00', to: '08:00', skipWeekends: false, mode: 'wait' as const };
const waitQuiet = { enabled: true, from: '21:00', to: '08:00', skipWeekends: false, mode: 'wait' as const };
const skipQuiet = { ...waitQuiet, mode: 'skip' as const };

function settings(patch: Partial<Settings> = {}): Pick<Settings, 'quietHours' | 'myName'> {
  return { quietHours: quietOff, myName: '', ...patch };
}

function rule(patch: Partial<ReminderRule> = {}): ReminderRule {
  return {
    id: 'r1',
    label: 'Тест',
    enabled: true,
    source: 'install',
    offsets: [0],
    channels: ['inapp'],
    priority: 'normal',
    respectQuietHours: false,
    ...patch,
  };
}

function installDeal(patch: Parameters<typeof makeDeal>[0] = {}) {
  return makeDeal({
    schedule: { status: 'planned', installAt: '2026-10-25', timeStart: '14:00', team: 'Бригада 1' },
    ...patch,
  });
}

const at = (iso: string) => new Date(iso);

beforeEach(() => {
  localStorage.clear();
});

describe('смещения', () => {
  it('склоняет и подписывает смещения по-русски', () => {
    expect(fmtOffset(0)).toBe('в момент срока');
    expect(fmtOffset(60)).toBe('1 час до');
    expect(fmtOffset(90)).toBe('1 час 30 минут до');
    expect(fmtOffset(1440)).toBe('1 день до');
    expect(fmtOffset(2 * 1440)).toBe('2 дня до');
    expect(fmtOffset(5 * 1440)).toBe('5 дней до');
    expect(fmtOffset(-60)).toBe('1 час после');
  });

  it('описывает правило для списка настроек', () => {
    const text = describeRule(rule({ offsets: [1440, 60], channels: ['inapp', 'browser'] }));
    expect(text).toContain('Монтаж');
    expect(text).toContain('1 день до');
    expect(text).toContain('1 час до');
    expect(text).toContain(CHANNEL_META.browser.label.toLowerCase());
    expect(describeRule(rule({ offsets: [] }))).toContain('без смещений');
  });

  it('набор смещений покрывает и «до», и «после» срока', () => {
    expect(OFFSET_PRESETS.some((preset) => preset.minutes > 0)).toBe(true);
    expect(OFFSET_PRESETS.some((preset) => preset.minutes < 0)).toBe(true);
    expect(OFFSET_PRESETS.some((preset) => preset.minutes === 0)).toBe(true);
  });

  it('момент собирается из даты и времени', () => {
    const moment = momentAt('2026-10-25', '14:30');
    expect(moment.getHours()).toBe(14);
    expect(moment.getMinutes()).toBe(30);
    expect(momentAt('2026-10-25').getHours()).toBe(9);
    expect(Number.isNaN(momentAt('кривая дата').getTime())).toBe(true);
  });
});

describe('тихие часы', () => {
  it('понимает окно через полночь', () => {
    expect(inQuietHours(waitQuiet, at('2026-10-23T23:30:00'))).toBe(true);
    expect(inQuietHours(waitQuiet, at('2026-10-24T03:00:00'))).toBe(true);
    expect(inQuietHours(waitQuiet, at('2026-10-24T12:00:00'))).toBe(false);
    expect(inQuietHours(quietOff, at('2026-10-24T03:00:00'))).toBe(false);
  });

  it('не действует в выходные, если так настроено', () => {
    const weekendQuiet = { ...waitQuiet, skipWeekends: true };
    // 2026-10-24 — суббота
    expect(inQuietHours(weekendQuiet, at('2026-10-24T23:30:00'))).toBe(false);
    expect(inQuietHours(weekendQuiet, at('2026-10-23T23:30:00'))).toBe(true);
  });

  it('находит конец окна: вечером — завтрашнее утро', () => {
    const window = quietWindow(waitQuiet, at('2026-10-23T22:00:00'));
    expect(window).not.toBeNull();
    expect(window?.end.getDate()).toBe(24);
    expect(window?.end.getHours()).toBe(8);
  });

  it('находит конец окна: ночью — сегодняшнее утро', () => {
    const window = quietWindow(waitQuiet, at('2026-10-24T03:00:00'));
    expect(window?.end.getDate()).toBe(24);
    expect(window?.start.getDate()).toBe(23);
  });

  it('вне окна возвращает null', () => {
    expect(quietWindow(waitQuiet, at('2026-10-24T12:00:00'))).toBeNull();
    expect(quietWindow({ ...waitQuiet, from: '09:00', to: '09:00' }, at('2026-10-24T12:00:00'))).toBeNull();
  });
});

describe('сбор моментов', () => {
  it('берёт монтаж, замер, доставку и готовность из графика', () => {
    const deal = makeDeal({
      schedule: {
        status: 'planned',
        installAt: '2026-10-25',
        measureAt: '2026-10-20',
        readyAt: '2026-10-23',
        deliveryAt: '2026-10-24',
      },
    });
    const moments = collectMoments([deal], { clientName });
    const sources = moments.map((moment) => moment.source);
    expect(sources).toContain('install');
    expect(sources).toContain('measure');
    expect(sources).toContain('delivery');
    expect(sources).toContain('ready');
  });

  it('пропускает выполненные события и закрытые сделки', () => {
    const done = makeDeal({ id: 'done', amount: 0, schedule: { status: 'done', installAt: '2026-10-25' } });
    expect(collectMoments([done], { clientName })).toHaveLength(0);
    const closed = makeDeal({
      id: 'closed',
      status: 'delivered',
      nextContactAt: '2026-10-30',
      tasks: [{ id: 't1', title: 'Позвонить', kind: 'call', dueAt: '2026-10-30', createdAt: '' }],
    });
    expect(collectMoments([closed], { clientName })).toHaveLength(0);
  });

  it('задачи и следующий контакт тоже дают моменты', () => {
    const deal = makeDeal({
      tasks: [{ id: 't1', title: 'Замерить', kind: 'measure', dueAt: '2026-10-28', createdAt: '' }],
      nextContactAt: '2026-10-29',
    });
    const moments = collectMoments([deal], { clientName });
    expect(moments.map((moment) => moment.source).sort()).toEqual(['contact', 'task']);
  });

  it('остаток к оплате появляется только если есть долг и монтаж', () => {
    const unpaid = makeDeal({
      amount: 100000,
      schedule: { status: 'planned', installAt: '2026-10-30' },
      payments: [{ id: 'p1', amount: 30000, at: '2026-10-01', kind: 'prepay' }],
    });
    const moments = collectMoments([unpaid], { clientName });
    expect(moments.some((moment) => moment.source === 'payment')).toBe(true);

    const paid = makeDeal({
      amount: 100000,
      schedule: { status: 'planned', installAt: '2026-10-30' },
      payments: [{ id: 'p1', amount: 100000, at: '2026-10-01', kind: 'prepay' }],
    });
    expect(collectMoments([paid], { clientName }).some((moment) => moment.source === 'payment')).toBe(false);
  });

  it('зависшая сделка считается от последнего изменения', () => {
    const stale = makeDeal({ id: 's1', updatedAt: '2026-10-15T10:00:00.000Z', status: 'draft' });
    const moments = collectMoments([stale], { clientName, today: '2026-10-20' }, [
      rule({ source: 'stale', staleDays: 10, offsets: [0], atTime: '10:00' }),
    ]);
    expect(moments.filter((moment) => moment.source === 'stale')).toHaveLength(1);
  });
});

describe('движок напоминаний', () => {
  it('показывает напоминание в момент срока', () => {
    const result = evaluateReminders({
      deals: [installDeal()],
      rules: [rule({ offsets: [0] })],
      settings: settings(),
      now: at('2026-10-25T14:00:00'),
      clientName,
    });
    expect(result.fire).toHaveLength(1);
    expect(result.fire[0].title).toContain('Кухня на Ленина');
    expect(new Date(result.fire[0].notifyAt).getHours()).toBe(14);
  });

  it('показывает несколько смещений независимо', () => {
    const result = evaluateReminders({
      deals: [installDeal()],
      rules: [rule({ offsets: [1440, 120] })],
      settings: settings(),
      now: at('2026-10-24T12:00:00'),
      clientName,
    });
    expect(result.fire).toHaveLength(0);
    expect(result.upcoming.map((item) => item.offsetMinutes).sort((a, b) => b - a)).toEqual([1440, 120]);

    const later = evaluateReminders({
      deals: [installDeal()],
      rules: [rule({ offsets: [1440, 120] })],
      settings: settings(),
      now: at('2026-10-25T12:00:00'),
      clientName,
    });
    expect(later.fire).toHaveLength(1);
    expect(later.fire[0].offsetMinutes).toBe(120);
  });

  it('догоняет пропущенное в пределах окна и не всплывает слишком старым', () => {
    const soon = evaluateReminders({
      deals: [installDeal()],
      rules: [rule({ offsets: [1440] })],
      settings: settings(),
      now: at('2026-10-24T15:00:00'),
      clientName,
    });
    expect(soon.fire).toHaveLength(1);

    const late = evaluateReminders({
      deals: [installDeal()],
      rules: [rule({ offsets: [1440] })],
      settings: settings(),
      now: at('2026-10-24T21:00:00'),
      clientName,
    });
    expect(late.fire).toHaveLength(0);
    expect(late.skipped.length).toBeGreaterThan(0);
  });

  it('откладывает показ до конца тихих часов', () => {
    // срок 25-го в 10:00, напоминание за 12 часов → 24-го в 22:00 (тишина)
    const deal = installDeal({ schedule: { status: 'planned', installAt: '2026-10-25', timeStart: '10:00' } });
    const result = evaluateReminders({
      deals: [deal],
      rules: [rule({ offsets: [720], respectQuietHours: true })],
      settings: settings({ quietHours: waitQuiet }),
      now: at('2026-10-24T22:30:00'),
      clientName,
    });
    expect(result.fire).toHaveLength(0);
    expect(result.waiting).toHaveLength(1);
    expect(result.waiting[0].waitingForQuiet).toBe(true);
    expect(new Date(result.waiting[0].notifyAt).getDate()).toBe(25);
    expect(new Date(result.waiting[0].notifyAt).getHours()).toBe(8);
  });

  it('отдаёт отложенное утром, даже если вкладку открыли позже', () => {
    const deal = installDeal({ schedule: { status: 'planned', installAt: '2026-10-25', timeStart: '10:00' } });
    const result = evaluateReminders({
      deals: [deal],
      rules: [rule({ offsets: [720], respectQuietHours: true })],
      settings: settings({ quietHours: waitQuiet }),
      now: at('2026-10-25T10:30:00'),
      clientName,
    });
    expect(result.fire).toHaveLength(1);
    expect(new Date(result.fire[0].notifyAt).getHours()).toBe(8);
  });

  it('в режиме «пропустить» тихие часы не показывают ничего', () => {
    const deal = installDeal({ schedule: { status: 'planned', installAt: '2026-10-25', timeStart: '10:00' } });
    const result = evaluateReminders({
      deals: [deal],
      rules: [rule({ offsets: [720], respectQuietHours: true })],
      settings: settings({ quietHours: skipQuiet }),
      now: at('2026-10-24T22:30:00'),
      clientName,
    });
    expect(result.fire).toHaveLength(0);
    expect(result.waiting).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
  });

  it('правило, которое не уважает тихие часы, срабатывает ночью', () => {
    const result = evaluateReminders({
      deals: [installDeal({ schedule: { status: 'planned', installAt: '2026-10-25', timeStart: '02:00' } })],
      rules: [rule({ offsets: [0], respectQuietHours: false })],
      settings: settings({ quietHours: waitQuiet }),
      now: at('2026-10-25T02:00:00'),
      clientName,
    });
    expect(result.fire).toHaveLength(1);
  });

  it('учитывает только мои сделки', () => {
    const mine = installDeal({ id: 'a', manager: 'Ирина' });
    const other = installDeal({ id: 'b', manager: 'Пётр' });
    const result = evaluateReminders({
      deals: [mine, other],
      rules: [rule({ offsets: [0], onlyMine: true })],
      settings: settings({ myName: 'Ирина' }),
      now: at('2026-10-25T14:00:00'),
      clientName,
    });
    expect(result.fire).toHaveLength(1);
    expect(result.fire[0].dealId).toBe('a');
  });

  it('свои смещения из карточки заменяют настройки правила', () => {
    const deal = installDeal({ schedule: { status: 'planned', installAt: '2026-10-25', timeStart: '14:00', reminders: [60] } });
    const result = evaluateReminders({
      deals: [deal],
      rules: [rule({ offsets: [1440] })],
      settings: settings(),
      now: at('2026-10-25T13:00:00'),
      clientName,
    });
    expect(result.fire).toHaveLength(1);
    expect(result.fire[0].offsetMinutes).toBe(60);
  });

  it('не повторяет уже отправленное', () => {
    const input = {
      deals: [installDeal()],
      rules: [rule({ offsets: [0] })],
      settings: settings(),
      now: at('2026-10-25T14:00:00'),
      clientName,
    };
    const first = evaluateReminders(input);
    const sent = { [first.fire[0].id]: new Date().toISOString() };
    const second = evaluateReminders({ ...input, sent });
    expect(second.fire).toHaveLength(0);
  });

  it('отложенное напоминание возвращается позже', () => {
    const base = {
      deals: [installDeal()],
      rules: [rule({ offsets: [0] })],
      settings: settings(),
      clientName,
    };
    const first = evaluateReminders({ ...base, now: at('2026-10-25T14:00:00') });
    const id = first.fire[0].id;
    const snoozes = { [id]: '2026-10-25T16:00:00' };
    const before = evaluateReminders({ ...base, now: at('2026-10-25T15:00:00'), snoozes });
    expect(before.fire).toHaveLength(0);
    const after = evaluateReminders({ ...base, now: at('2026-10-25T16:00:00'), snoozes });
    expect(after.fire).toHaveLength(1);
  });

  it('повторяет просроченное каждый день, пока не закрыто', () => {
    const deal = makeDeal({
      tasks: [{ id: 't1', title: 'Позвонить', kind: 'call', dueAt: '2026-10-20', createdAt: '' }],
    });
    const daily = rule({ source: 'task', offsets: [0], atTime: '09:00', repeatDaily: true, respectQuietHours: false });
    const morning = evaluateReminders({
      deals: [deal],
      rules: [daily],
      settings: settings(),
      now: at('2026-10-23T09:10:00'),
      clientName,
    });
    expect(morning.fire).toHaveLength(1);
    expect(new Date(morning.fire[0].notifyAt).getHours()).toBe(9);

    const afternoon = evaluateReminders({
      deals: [deal],
      rules: [daily],
      settings: settings(),
      now: at('2026-10-23T16:00:00'),
      clientName,
    });
    expect(afternoon.fire).toHaveLength(1);

    // та же задача, закрытая — тишина
    const done = makeDeal({
      tasks: [{ id: 't1', title: 'Позвонить', kind: 'call', dueAt: '2026-10-20', done: true, createdAt: '' }],
    });
    const silence = evaluateReminders({
      deals: [done],
      rules: [daily],
      settings: settings(),
      now: at('2026-10-23T09:10:00'),
      clientName,
    });
    expect(silence.fire).toHaveLength(0);
  });

  it('одна и та же задача повторяется на следующий день новым ключом', () => {
    const deal = makeDeal({
      tasks: [{ id: 't1', title: 'Позвонить', kind: 'call', dueAt: '2026-10-20', createdAt: '' }],
    });
    const daily = rule({ source: 'task', offsets: [0], atTime: '09:00', repeatDaily: true, respectQuietHours: false });
    const day1 = evaluateReminders({ deals: [deal], rules: [daily], settings: settings(), now: at('2026-10-23T09:10:00'), clientName });
    const sent = { [day1.fire[0].id]: new Date().toISOString() };
    const day2 = evaluateReminders({ deals: [deal], rules: [daily], settings: settings(), now: at('2026-10-24T09:10:00'), clientName, sent });
    expect(day2.fire).toHaveLength(1);
    expect(day2.fire[0].id).not.toBe(day1.fire[0].id);
  });

  it('собирает утреннюю сводку один раз в день', () => {
    const digest = rule({ id: 'digest', source: 'digest', offsets: [], atTime: '08:30', channels: ['inapp'] });
    const run = (now: Date) => evaluateReminders({
      deals: [],
      rules: [digest],
      settings: settings({ quietHours: waitQuiet }),
      now,
      clientName,
      digestSummary: () => 'монтажей 2 · задач 3',
    });
    const fired = run(at('2026-10-24T08:35:00'));
    expect(fired.fire).toHaveLength(1);
    expect(fired.fire[0].detail).toContain('монтажей 2');

    const sent = { [fired.fire[0].id]: new Date().toISOString() };
    const again = evaluateReminders({
      deals: [],
      rules: [digest],
      settings: settings({ quietHours: waitQuiet }),
      now: at('2026-10-24T09:30:00'),
      clientName,
      sent,
    });
    expect(again.fire).toHaveLength(0);

    const nextDay = run(at('2026-10-25T08:30:00'));
    expect(nextDay.fire).toHaveLength(1);
    expect(nextDay.fire[0].id).not.toBe(fired.fire[0].id);
  });

  it('выключенные правила молчат', () => {
    const result = evaluateReminders({
      deals: [installDeal()],
      rules: [rule({ offsets: [0], enabled: false })],
      settings: settings(),
      now: at('2026-10-25T14:00:00'),
      clientName,
    });
    expect(result.fire).toHaveLength(0);
    expect(result.upcoming).toHaveLength(0);
  });

  it('в ближайшие попадает не больше недели вперёд', () => {
    const far = installDeal({ schedule: { status: 'planned', installAt: '2027-01-10' } });
    const result = evaluateReminders({
      deals: [far],
      rules: [rule({ offsets: [0] })],
      settings: settings(),
      now: at('2026-10-24T12:00:00'),
      clientName,
    });
    expect(result.upcoming).toHaveLength(0);
  });

  it('у каждого напоминания устойчивый ключ', () => {
    const now = at('2026-10-25T14:00:00');
    const first = evaluateReminders({ deals: [installDeal()], rules: [rule()], settings: settings(), now, clientName });
    const second = evaluateReminders({ deals: [installDeal()], rules: [rule()], settings: settings(), now, clientName });
    expect(first.fire[0].id).toBe(second.fire[0].id);
    const moment = collectMoments([installDeal()], { clientName })[0];
    expect(first.fire[0].id).toBe(reminderId('r1', moment.key, 0, now));
  });
});

describe('история и откладывание', () => {
  it('запоминает отправленные и чистит их', () => {
    markSentMap(['a|b|0|2026-10-24'], at('2026-10-24T12:00:00'));
    expect(Object.keys(readSent())).toEqual(['a|b|0|2026-10-24']);
    clearSent();
    expect(readSent()).toEqual({});
  });

  it('забывает старые отметки', () => {
    markSentMap(['old'], new Date(Date.now() - 40 * 86400000));
    markSentMap(['fresh'], new Date());
    expect(readSent().old).toBeUndefined();
    expect(readSent().fresh).toBeDefined();
  });

  it('хранит отложенные и убирает просроченные', () => {
    const id = 'rule|moment|0|2026-10-24';
    snoozeReminder(id, new Date(Date.now() + 3600000));
    expect(readSnoozes()[id]).toBeDefined();
    snoozeReminder('old', new Date(Date.now() - 3 * 86400000));
    expect(readSnoozes().old).toBeUndefined();
    clearSnoozes();
    expect(readSnoozes()).toEqual({});
  });

  it('даёт понятные варианты отложить', () => {
    const presets = snoozePresets(at('2026-10-24T12:00:00'));
    expect(presets).toHaveLength(4);
    expect(presets[0].label).toBe('10 минут');
    expect(presets[0].until.getTime()).toBe(at('2026-10-24T12:10:00').getTime());
    expect(presets[3].until.getDate()).toBe(25);
    expect(presets[3].until.getHours()).toBe(9);
  });
});

describe('настройки по умолчанию', () => {
  it('правила покрывают ключевые события и часть выключена', () => {
    const rules = defaultReminderRules();
    expect(rules.length).toBeGreaterThanOrEqual(8);
    expect(rules.some((item) => item.source === 'install' && item.offsets.includes(120))).toBe(true);
    expect(rules.filter((item) => item.enabled).length).toBeGreaterThan(3);
    expect(rules.every((item) => item.offsets.length > 0 || item.source === 'digest')).toBe(true);
    const ids = rules.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('тихие часы и сводка заданы разумно', () => {
    expect(defaultQuietHours()).toMatchObject({ enabled: true, from: '21:00', to: '08:00', mode: 'wait' });
    expect(defaultDigest()).toMatchObject({ enabled: true, at: '08:30', weekdaysOnly: true });
  });

  it('каждый источник описан для интерфейса', () => {
    for (const source of Object.keys(SOURCE_META) as Array<keyof typeof SOURCE_META>) {
      expect(SOURCE_META[source].label.length).toBeGreaterThan(0);
      expect(SOURCE_META[source].hint.length).toBeGreaterThan(0);
    }
  });

  it('сводка коротко перечисляет дела', () => {
    expect(digestText({ installs: 2, measures: 1, tasks: 3, overdue: 1, contacts: 0 }))
      .toBe('монтажей 2 · замеров 1 · задач 3 · просрочено 1');
    expect(digestText({ installs: 0, measures: 0, tasks: 0, overdue: 0, contacts: 0 }))
      .toContain('дел нет');
  });
});
