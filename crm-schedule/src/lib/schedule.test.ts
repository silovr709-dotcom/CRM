import { describe, expect, it } from 'vitest';
import {
  calendarEvents, collectEvents, dealEvents, monthGrid, moveEvent, occurrenceDates, scheduleWarnings, teamLoad, weekGrid,
} from './schedule';
import type { CalendarEvent } from '../types';
import { makeDeal } from './testUtils';

describe('события графика', () => {
  it('разворачивает многодневный монтаж в отдельные дни', () => {
    const deal = makeDeal({
      schedule: {
        status: 'planned',
        installAt: '2026-10-10',
        installDays: 3,
        team: 'Бригада 1',
        address: 'Ленина, 1',
      },
    });
    const events = dealEvents(deal, 'Анна');
    const installs = events.filter((event) => event.kind === 'install');
    expect(installs).toHaveLength(3);
    expect(installs.map((event) => event.date)).toEqual(['2026-10-10', '2026-10-11', '2026-10-12']);
    expect(installs[1]).toMatchObject({ dayIndex: 2, dayCount: 3, client: 'Анна' });
  });

  it('собирает события по всем датам заказа', () => {
    const deal = makeDeal({
      schedule: { status: 'planned', measureAt: '2026-10-01', readyAt: '2026-10-08', deliveryAt: '2026-10-09', installAt: '2026-10-10' },
    });
    expect(dealEvents(deal).map((event) => event.kind)).toEqual(['measure', 'ready', 'delivery', 'install']);
    expect(collectEvents([deal])).toHaveLength(4);
  });

  it('сетка месяца начинается с понедельника и содержит 42 дня', () => {
    const grid = monthGrid(new Date('2026-10-15T12:00:00'));
    expect(grid).toHaveLength(42);
    expect(new Date(`${grid[0]}T12:00:00`).getDay()).toBe(1);
    expect(grid[0]).toBe('2026-09-28');
    expect(weekGrid(new Date('2026-10-15T12:00:00'))).toHaveLength(7);
  });
});

describe('проверки графика', () => {
  it('ловит монтаж раньше готовности, без адреса и бригады', () => {
    const deal = makeDeal({
      schedule: { status: 'planned', readyAt: '2026-10-12', installAt: '2026-10-10' },
    });
    const warnings = scheduleWarnings([deal]).map((warning) => warning.text).join(' ');
    expect(warnings).toMatch(/раньше готовности/);
    expect(warnings).toMatch(/адрес/);
    expect(warnings).toMatch(/бригад/);
  });

  it('ловит доставку позже монтажа', () => {
    const deal = makeDeal({
      schedule: { status: 'planned', installAt: '2026-10-10', deliveryAt: '2026-10-12', team: 'Бригада 1', address: 'Ленина, 1' },
    });
    expect(scheduleWarnings([deal])[0].text).toMatch(/доставка позже монтажа/i);
  });

  it('предупреждает, если бригада занята в двух местах', () => {
    const first = makeDeal({
      id: 'a',
      title: 'Кухня А',
      schedule: { status: 'planned', installAt: '2026-10-10', team: 'Бригада 1', address: 'Ленина, 1' },
    });
    const second = makeDeal({
      id: 'b',
      title: 'Кухня Б',
      schedule: { status: 'planned', installAt: '2026-10-10', team: 'Бригада 1', address: 'Мира, 2' },
    });
    const warnings = scheduleWarnings([first, second]);
    expect(warnings.some((warning) => /одновременно 2 монтажа/.test(warning.text))).toBe(true);
  });

  it('считает загрузку бригад', () => {
    const deal = makeDeal({
      schedule: { status: 'planned', installAt: '2026-10-10', installDays: 2, team: 'Бригада 1' },
    });
    expect(teamLoad(dealEvents(deal))).toEqual([{ team: 'Бригада 1', days: 2, deals: 1 }]);
  });
});

describe('перенос событий', () => {
  it('меняет нужную дату в сделке', () => {
    const deal = makeDeal({ schedule: { status: 'planned', measureAt: '2026-10-01', installAt: '2026-10-10' } });
    const moved = moveEvent(deal, 'install', '2026-10-15');
    expect(moved.schedule.installAt).toBe('2026-10-15');
    expect(moved.schedule.measureAt).toBe('2026-10-01');
  });
});

describe('свободные события графика', () => {
  const custom: CalendarEvent = {
    id: 'evt-1',
    title: 'Обучение по фурнитуре',
    date: '2026-10-11',
    days: 2,
    category: 'Обучение',
    team: 'Бригада 1',
    timeStart: '10:00',
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
  };

  it('разворачивает многодневное событие и помечает его как свободное', () => {
    const events = calendarEvents([custom]);
    expect(events.map((event) => event.date)).toEqual(['2026-10-11', '2026-10-12']);
    expect(events[0]).toMatchObject({
      kind: 'custom',
      customId: 'evt-1',
      dealTitle: 'Обучение по фурнитуре',
      client: 'Обучение',
      dayCount: 2,
    });
    expect(events[0].dealId).toBe('');
  });

  it('пропускает записи без даты и названия', () => {
    expect(calendarEvents([{ ...custom, title: '' }])).toHaveLength(0);
    expect(calendarEvents([{ ...custom, date: '' }])).toHaveLength(0);
  });

  it('смешивает свободные события со сделками и сортирует по дате и времени', () => {
    const deal = makeDeal({
      schedule: { status: 'planned', installAt: '2026-10-11', timeStart: '09:00' },
    });
    const merged = collectEvents([deal], () => 'Анна', [custom]);
    const onDay = merged.filter((event) => event.date === '2026-10-11');
    expect(onDay.map((event) => event.kind)).toEqual(['install', 'custom']);
    expect(merged.filter((event) => event.kind === 'custom')).toHaveLength(2);
  });
});

describe('повторы свободных событий', () => {
  const base: CalendarEvent = {
    id: 'rep-1',
    title: 'Планёрка',
    date: '2026-10-05',
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
  };

  it('без повтора — только исходная дата', () => {
    expect(occurrenceDates(base, '2026-10-30')).toEqual(['2026-10-05']);
  });

  it('каждую неделю — шаг ровно 7 дней', () => {
    const dates = occurrenceDates({ ...base, repeat: 'weekly' }, '2026-10-30');
    expect(dates.slice(0, 4)).toEqual(['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26']);
    expect(dates).toContain('2026-11-02');
  });

  it('каждый месяц — тот же день, в коротком месяце последний', () => {
    const dates = occurrenceDates({ ...base, date: '2026-01-31', repeat: 'monthly' }, '2026-10-30');
    expect(dates[0]).toBe('2026-01-31');
    expect(dates).toContain('2026-02-28');
    expect(dates).toContain('2026-03-31');
    expect(dates).toContain('2026-04-30');
  });

  it('calendarEvents разворачивает повторы с отдельными id', () => {
    const events = calendarEvents([{ ...base, date: '2026-10-26', repeat: 'weekly' }]);
    expect(events.some((event) => event.date === '2026-10-26')).toBe(true);
    expect(events.some((event) => event.date === '2026-11-02')).toBe(true);
    expect(events.find((event) => event.date === '2026-11-02')?.id).toBe('rep-1-2026-11-02-0');
  });
});

describe('свободные события в проверках графика', () => {
  const deal = () => makeDeal({
    schedule: { status: 'planned', installAt: '2026-10-10', team: 'Бригада 1', address: 'Ленина, 1' },
  });
  const custom: CalendarEvent = {
    id: 'evt-9',
    title: 'Выходной',
    date: '2026-10-10',
    team: 'Бригада 1',
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
  };

  it('предупреждает о событии бригады в день её монтажа', () => {
    const warnings = scheduleWarnings([deal()], [custom]);
    expect(warnings.some((warning) => warning.kind === 'warn' && /событие/i.test(warning.text))).toBe(true);
  });

  it('молчит, если событие без бригады или в другой день', () => {
    expect(scheduleWarnings([deal()], [{ ...custom, team: undefined }])).toHaveLength(0);
    expect(scheduleWarnings([deal()], [{ ...custom, date: '2026-10-15' }])).toHaveLength(0);
  });
});
