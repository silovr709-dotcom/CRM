import { describe, expect, it } from 'vitest';
import { buildIcs, importCalculatorBackup, validateData } from './storage';
import { makeDeal } from './testUtils';

const baseData = {
  version: 1 as const,
  clients: [],
  deals: [makeDeal({ amount: 100000 })],
  settings: { companyName: 'Студия', managers: [], teams: [], hints: true },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('проверка и восстановление базы', () => {
  it('принимает свою структуру', () => {
    const data = validateData(baseData);
    expect(data?.deals).toHaveLength(1);
    expect(data?.settings.companyName).toBe('Студия');
  });

  it('отбрасывает мусор и чинит старые записи', () => {
    expect(validateData({ hello: 'world' })).toBeNull();
    const data = validateData({ clients: [], deals: [{ title: 'Без id', schedule: {} }] });
    expect(data?.deals[0].id).toBeTruthy();
    expect(data?.deals[0].schedule.status).toBe('planned');
    expect(data?.deals[0].amount).toBe(0);
  });
});

describe('календарь ICS', () => {
  it('содержит события заказа и экранирует текст', () => {
    const ics = buildIcs(
      {
        ...baseData,
        deals: [makeDeal({
          title: 'Кухня, Ленина 1; кв. 5',
          schedule: { status: 'confirmed', installAt: '2026-10-10', installDays: 2, team: 'Бригада 1', address: 'Ленина, 1' },
        })],
      },
      () => 'Анна',
    );
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('DTSTART;VALUE=DATE:20261010');
    expect(ics).toContain('DTEND;VALUE=DATE:20261012');
    expect(ics).toContain('LOCATION:Ленина\\, 1');
    expect(ics).toContain('Клиент: Анна');
    expect(ics.trim().endsWith('END:VCALENDAR')).toBe(true);
  });
});

describe('импорт резервной копии калькулятора', () => {
  const backup = JSON.stringify({
    kind: 'recept-backup',
    projects: [
      {
        id: 'p1',
        name: 'Кухня на Ленина',
        client: 'Анна Смирнова',
        status: 'approved',
        orderWorkflow: { status: 'production', nextAction: 'Проверить срок', assignee: 'Ирина' },
        schedule: { installAt: '2026-11-10T12:00:00.000Z', installDays: 2, team: 'Бригада 1', address: 'Ленина, 42' },
        tasks: [{ id: 't1', title: 'Позвонить', kind: 'call', dueAt: '2026-11-01', done: false }],
        clientOfferSnapshots: [
          { createdAt: '2026-09-02T00:00:00.000Z', clientTotal: 180000 },
          { createdAt: '2026-09-20T00:00:00.000Z', clientTotal: 285000 },
        ],
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-10T00:00:00.000Z',
      },
    ],
    clients: [{ id: 'c1', name: 'Анна Смирнова', phones: ['+7 912 345-67-89'], emails: [], tags: [] }],
  });

  it('переносит заказы, клиентов, задачи и даты монтажа', () => {
    const result = importCalculatorBackup(backup);
    expect(result.deals).toBe(1);
    expect(result.clients).toBe(1);
    expect(result.data.deals[0]).toMatchObject({
      title: 'Кухня на Ленина',
      clientId: 'c1',
      status: 'production',
      manager: 'Ирина',
      nextAction: 'Проверить срок',
    });
    expect(result.data.deals[0].schedule).toMatchObject({
      installAt: '2026-11-10',
      installDays: 2,
      team: 'Бригада 1',
    });
    expect(result.data.deals[0].tasks[0]).toMatchObject({ title: 'Позвонить', dueAt: '2026-11-01' });
    expect(result.data.deals[0].amount).toBe(285000);
    expect(result.warning).toMatch(/сумм/i);
  });

  it('создаёт клиента, если его нет в списке', () => {
    const result = importCalculatorBackup(JSON.stringify({
      kind: 'recept-backup',
      projects: [{ id: 'p2', name: 'Шкаф', client: 'Новый Клиент' }],
      clients: [],
    }));
    expect(result.clients).toBe(1);
    expect(result.data.clients[0].name).toBe('Новый Клиент');
    expect(result.data.deals[0].clientId).toBe(result.data.clients[0].id);
  });

  it('отказывает чужим файлам', () => {
    expect(() => importCalculatorBackup('{}')).toThrow(/резервная копия калькулятора/i);
  });
});
