import { describe, expect, it } from 'vitest';
import {
  collectEvents, dealEvents, monthGrid, moveEvent, scheduleWarnings, teamLoad, weekGrid,
} from './schedule';
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
