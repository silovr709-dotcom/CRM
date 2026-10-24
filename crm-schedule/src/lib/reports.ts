// Отчёты: выручка, деньги, маржа, конверсия, источники и причины отказа.
// Всё считается из сделок и их платежей/затрат — отдельных таблиц нет.

import type { Client, Deal, DealStatus } from '../types';
import { addDays, daysBetween, todayISO } from './dates';
import { DEAL_STATUSES, isClosedStatus } from './crm';
import { expensesTotal } from './money';

export type PeriodId = 'month' | 'quarter' | 'year' | 'custom';

export interface Period {
  from: string;
  to: string;
  label: string;
}

export function periodRange(period: PeriodId, today = todayISO(), custom?: { from: string; to: string }): Period {
  const date = new Date(`${today}T12:00:00`);
  const year = date.getFullYear();
  const month = date.getMonth();
  if (period === 'custom' && custom?.from && custom?.to) {
    return { from: custom.from, to: custom.to, label: `${custom.from} — ${custom.to}` };
  }
  if (period === 'year') {
    return { from: `${year}-01-01`, to: `${year}-12-31`, label: `Год ${year}` };
  }
  if (period === 'quarter') {
    const startMonth = Math.floor(month / 3) * 3;
    const from = `${year}-${String(startMonth + 1).padStart(2, '0')}-01`;
    const lastDay = new Date(year, startMonth + 3, 0).getDate();
    const to = `${year}-${String(startMonth + 3).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    const names = ['I', 'II', 'III', 'IV'];
    return { from, to, label: `${names[Math.floor(month / 3)]} квартал ${year}` };
  }
  const lastDay = new Date(year, month + 1, 0).getDate();
  const from = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const to = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  const months = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
  return { from, to, label: `${months[month]} ${year}`.replace(/^./, (char) => char.toUpperCase()) };
}

/** Соседний период: стрелки «назад / вперёд» в отчёте. */
export function shiftPeriod(period: PeriodId, range: Period, direction: -1 | 1): { from: string; to: string } {
  if (period === 'year') {
    const year = Number(range.from.slice(0, 4)) + direction;
    return { from: `${year}-01-01`, to: `${year}-12-31` };
  }
  if (period === 'quarter') {
    const year = Number(range.from.slice(0, 4));
    const quarter = Math.floor((Number(range.from.slice(5, 7)) - 1) / 3) + direction;
    const nextYear = year + Math.floor(quarter / 4);
    const index = ((quarter % 4) + 4) % 4;
    const startMonth = index * 3;
    const lastDay = new Date(nextYear, startMonth + 3, 0).getDate();
    return {
      from: `${nextYear}-${String(startMonth + 1).padStart(2, '0')}-01`,
      to: `${nextYear}-${String(startMonth + 3).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
    };
  }
  // Месяц: сдвигаем по 1-му числу, чтобы не ловить 31-е в коротком месяце.
  const date = new Date(`${range.from.slice(0, 7)}-01T12:00:00`);
  date.setMonth(date.getMonth() + direction);
  const year = date.getFullYear();
  const month = date.getMonth();
  const lastDay = new Date(year, month + 1, 0).getDate();
  return {
    from: `${year}-${String(month + 1).padStart(2, '0')}-01`,
    to: `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
  };
}

/* ------------------------------ показатели ------------------------------ */

export interface Totals {
  /** Сумма новых сделок за период (по дате создания). */
  booked: number;
  /** Новых сделок штук. */
  bookedCount: number;
  /** Получено денег за период (по дате платежа). */
  received: number;
  /** Затраты за период (по дате затраты). */
  spent: number;
  /** Получено − затраты. Это «живые» деньги периода, а не бухгалтерская маржа. */
  cash: number;
  /** Средний чек новых сделок. */
  averageDeal: number;
  /** Маржа по сделкам, созданным в период (сумма − затраты всех этих сделок). */
  margin: number;
  /** Маржа в процентах. */
  marginPercent: number;
  /** Сделок в работе и их портфель на конец периода. */
  activeDeals: number;
  pipeline: number;
  /** Осталось получить по всем незакрытым сделкам. */
  receivable: number;
  closedWon: number;
  closedLost: number;
}

export function totals(deals: Deal[], range: { from: string; to: string }): Totals {
  let booked = 0;
  let bookedCount = 0;
  let received = 0;
  let spent = 0;
  let margin = 0;
  let closedWon = 0;
  let closedLost = 0;

  for (const deal of deals) {
    const created = (deal.createdAt ?? '').slice(0, 10);
    const isNew = created >= range.from && created <= range.to;
    if (isNew) {
      booked += deal.amount || 0;
      bookedCount += 1;
      margin += (deal.amount || 0) - expensesTotal(deal);
    }
    for (const payment of deal.payments ?? []) {
      if (payment.at >= range.from && payment.at <= range.to) received += Number(payment.amount) || 0;
    }
    for (const expense of deal.expenses ?? []) {
      if (expense.at >= range.from && expense.at <= range.to) spent += Number(expense.amount) || 0;
    }
    if (isNew && deal.status === 'delivered') closedWon += 1;
    if (isNew && deal.status === 'rejected') closedLost += 1;
  }

  const active = deals.filter((deal) => !isClosedStatus(deal.status));
  const pipeline = active.reduce((sum, deal) => sum + (deal.amount || 0), 0);
  const receivable = active.reduce((sum, deal) => {
    const paid = (deal.payments ?? []).reduce((inner, payment) => inner + (Number(payment.amount) || 0), 0);
    return sum + Math.max(0, (deal.amount || 0) - paid);
  }, 0);

  return {
    booked,
    bookedCount,
    received,
    spent,
    cash: received - spent,
    averageDeal: bookedCount > 0 ? Math.round(booked / bookedCount) : 0,
    margin,
    marginPercent: booked > 0 ? Math.round((margin / booked) * 1000) / 10 : 0,
    activeDeals: active.length,
    pipeline,
    receivable,
    closedWon,
    closedLost,
  };
}

/* ------------------------------- разбивки ------------------------------- */

export interface Slice {
  key: string;
  label: string;
  deals: number;
  amount: number;
  paid: number;
  share: number;
}

/** Разбивка новых сделок периода по произвольному признаку. */
export function breakdown(
  deals: Deal[],
  range: { from: string; to: string },
  pick: (deal: Deal) => string[],
  emptyLabel = 'не указано',
): Slice[] {
  const map = new Map<string, Slice>();
  let total = 0;
  for (const deal of deals) {
    const created = (deal.createdAt ?? '').slice(0, 10);
    if (created < range.from || created > range.to) continue;
    const keys = pick(deal).map((value) => value.trim()).filter(Boolean);
    const labels = keys.length > 0 ? keys : [emptyLabel];
    const amount = deal.amount || 0;
    total += amount;
    for (const label of labels) {
      const slice = map.get(label) ?? { key: label, label, deals: 0, amount: 0, paid: 0, share: 0 };
      slice.deals += 1;
      slice.amount += amount;
      slice.paid += (deal.payments ?? []).reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);
      map.set(label, slice);
    }
  }
  return [...map.values()]
    .map((slice) => ({ ...slice, share: total > 0 ? slice.amount / total : 0 }))
    .sort((left, right) => right.amount - left.amount);
}

export function byManager(deals: Deal[], range: { from: string; to: string }): Slice[] {
  return breakdown(deals, range, (deal) => [deal.manager ?? '']);
}

export function bySource(deals: Deal[], clients: Client[], range: { from: string; to: string }): Slice[] {
  const sourceById = new Map(clients.map((client) => [client.id, client.source ?? '']));
  return breakdown(deals, range, (deal) => [sourceById.get(deal.clientId) ?? '']);
}

export function byTag(deals: Deal[], clients: Client[], range: { from: string; to: string }): Slice[] {
  const tagsById = new Map(clients.map((client) => [client.id, client.tags ?? []]));
  return breakdown(deals, range, (deal) => tagsById.get(deal.clientId) ?? []);
}

/** Причины отказа за период — сразу видно, что теряем и почему. */
export function lostReasons(deals: Deal[], range: { from: string; to: string }): Slice[] {
  const rejected = deals.filter((deal) => {
    const created = (deal.createdAt ?? '').slice(0, 10);
    return deal.status === 'rejected' && created >= range.from && created <= range.to;
  });
  return breakdown(rejected, range, (deal) => [deal.lostReason ?? '']);
}

/* ------------------------------- воронка ------------------------------- */

export interface FunnelStage {
  status: DealStatus;
  label: string;
  count: number;
  amount: number;
  /** Доля от всех новых сделок периода. */
  share: number;
}

/** Воронка за период: новые сделки периода по текущим этапам. */
export function funnel(deals: Deal[], range: { from: string; to: string }): FunnelStage[] {
  const fresh = deals.filter((deal) => {
    const created = (deal.createdAt ?? '').slice(0, 10);
    return created >= range.from && created <= range.to;
  });
  const total = fresh.length;
  return DEAL_STATUSES
    .map((meta) => {
      const list = fresh.filter((deal) => deal.status === meta.value);
      return {
        status: meta.value,
        label: meta.label,
        count: list.length,
        amount: list.reduce((sum, deal) => sum + (deal.amount || 0), 0),
        share: total > 0 ? list.length / total : 0,
      };
    })
    .filter((stage) => stage.count > 0);
}

/**
 * Конверсия «дошло до этапа N»: сделки, созданные в периоде, которые в итоге
 * оказались на этом этапе или дальше по воронке.
 */
export function conversion(deals: Deal[], range: { from: string; to: string }): {
  leads: number;
  measured: number;
  approved: number;
  installed: number;
  lost: number;
  /** Сколько дошедших до монтажа из всех, в %. */
  winRate: number;
} {
  const fresh = deals.filter((deal) => {
    const created = (deal.createdAt ?? '').slice(0, 10);
    return created >= range.from && created <= range.to;
  });
  // Отказ стоит в конце списка этапов, поэтому «дошёл до этапа» считаем по
  // позиции, но отказы из дошедших исключаем: они ушли из воронки.
  const order = DEAL_STATUSES.map((meta) => meta.value);
  const index = (status: DealStatus) => order.indexOf(status);
  const reached = (stage: DealStatus) => fresh
    .filter((deal) => deal.status !== 'rejected' && index(deal.status) >= index(stage))
    .length;
  const leads = fresh.length;
  const installed = fresh.filter((deal) => deal.status === 'delivered' || deal.status === 'ready').length;
  return {
    leads,
    measured: reached('calculating'),
    approved: reached('approved'),
    installed,
    lost: fresh.filter((deal) => deal.status === 'rejected').length,
    winRate: leads > 0 ? Math.round((installed / leads) * 1000) / 10 : 0,
  };
}

/* ------------------------------- по дням ------------------------------- */

export interface DayPoint {
  day: string;
  received: number;
  spent: number;
}

/** Деньги по дням: для мини-графика и проверки «когда пришли деньги». */
export function dailyMoney(deals: Deal[], range: { from: string; to: string }): DayPoint[] {
  const map = new Map<string, DayPoint>();
  const days = Math.max(0, daysBetween(range.from, range.to));
  for (let index = 0; index <= days; index += 1) {
    const day = addDays(range.from, index);
    map.set(day, { day, received: 0, spent: 0 });
  }
  for (const deal of deals) {
    for (const payment of deal.payments ?? []) {
      const point = map.get(payment.at?.slice(0, 10) ?? '');
      if (point) point.received += Number(payment.amount) || 0;
    }
    for (const expense of deal.expenses ?? []) {
      const point = map.get(expense.at?.slice(0, 10) ?? '');
      if (point) point.spent += Number(expense.amount) || 0;
    }
  }
  return [...map.values()];
}

/** Деньги по месяцам — для годового отчёта. */
export function monthlyMoney(deals: Deal[], year: number): Array<{ month: string; received: number; spent: number }> {
  const rows = Array.from({ length: 12 }, (_, index) => ({
    month: `${year}-${String(index + 1).padStart(2, '0')}`,
    received: 0,
    spent: 0,
  }));
  const indexOf = (day?: string) => {
    if (!day || day.slice(0, 4) !== String(year)) return -1;
    return Number(day.slice(5, 7)) - 1;
  };
  for (const deal of deals) {
    for (const payment of deal.payments ?? []) {
      const index = indexOf(payment.at);
      if (index >= 0) rows[index].received += Number(payment.amount) || 0;
    }
    for (const expense of deal.expenses ?? []) {
      const index = indexOf(expense.at);
      if (index >= 0) rows[index].spent += Number(expense.amount) || 0;
    }
  }
  return rows;
}

/* -------------------------------- выгрузка -------------------------------- */

/** CSV с разделителем «;» и BOM — открывается в Excel и Google Таблицах. */
export function toCsv(rows: Array<Array<string | number>>): string {
  const body = rows
    .map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(';'))
    .join('\n');
  return `\uFEFF${body}`;
}

/** Сделки периода — плоская таблица для Excel. */
export function dealsCsv(deals: Deal[], range: { from: string; to: string }, clientName: (deal: Deal) => string): string {
  const rows: Array<Array<string | number>> = [[
    'Сделка', 'Клиент', 'Этап', 'Менеджер', 'Сумма', 'Получено', 'Остаток',
    'Затраты', 'Маржа', 'Маржа %', 'Создана', 'Изменена',
  ]];
  const list = deals
    .filter((deal) => {
      const created = (deal.createdAt ?? '').slice(0, 10);
      return created >= range.from && created <= range.to;
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  for (const deal of list) {
    const paid = (deal.payments ?? []).reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);
    const expenses = expensesTotal(deal);
    const margin = (deal.amount || 0) - expenses;
    rows.push([
      deal.title,
      clientName(deal),
      DEAL_STATUSES.find((meta) => meta.value === deal.status)?.label ?? deal.status,
      deal.manager ?? '',
      deal.amount || 0,
      paid,
      Math.max(0, (deal.amount || 0) - paid),
      expenses,
      margin,
      deal.amount ? Math.round((margin / deal.amount) * 1000) / 10 : '',
      (deal.createdAt ?? '').slice(0, 10),
      (deal.updatedAt ?? '').slice(0, 10),
    ]);
  }
  return toCsv(rows);
}

/** Итоговая таблица отчёта — для печати и CSV. */
export function reportCsv(
  totalsValue: Totals,
  managers: Slice[],
  sources: Slice[],
  losses: Slice[],
  range: Period,
): string {
  const rows: Array<Array<string | number>> = [
    ['Отчёт', range.label],
    ['Период', `${range.from} — ${range.to}`],
    [],
    ['Показатель', 'Значение'],
    ['Новых сделок', totalsValue.bookedCount],
    ['Сумма новых сделок', totalsValue.booked],
    ['Получено денег', totalsValue.received],
    ['Затраты', totalsValue.spent],
    ['Деньги на руках', totalsValue.cash],
    ['Маржа по новым сделкам', totalsValue.margin],
    ['Маржа, %', totalsValue.marginPercent],
    ['Средний чек', totalsValue.averageDeal],
    ['Сделок в работе', totalsValue.activeDeals],
    ['Портфель', totalsValue.pipeline],
    ['Ждём оплату', totalsValue.receivable],
    [],
    ['Менеджер', 'Сделок', 'Сумма', 'Оплачено'],
    ...managers.map((slice) => [slice.label, slice.deals, slice.amount, slice.paid]),
    [],
    ['Источник', 'Сделок', 'Сумма', 'Оплачено'],
    ...sources.map((slice) => [slice.label, slice.deals, slice.amount, slice.paid]),
    [],
    ['Причина отказа', 'Сделок', 'Сумма потерянных'],
    ...losses.map((slice) => [slice.label, slice.deals, slice.amount]),
  ];
  return toCsv(rows);
}
