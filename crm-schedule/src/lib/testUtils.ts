// Общий конструктор сделки для тестов.
import type { Deal } from '../types';

export function makeDeal(patch: Partial<Deal> = {}): Deal {
  return {
    id: 'deal-1',
    title: 'Кухня на Ленина',
    clientId: 'client-1',
    amount: 100000,
    manager: 'Ирина',
    status: 'draft',
    tasks: [],
    payments: [],
    history: [],
    schedule: { status: 'planned' },
    createdAt: '2026-01-05T10:00:00.000Z',
    updatedAt: '2026-01-05T10:00:00.000Z',
    ...patch,
  };
}

export function daysAgoIso(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}
