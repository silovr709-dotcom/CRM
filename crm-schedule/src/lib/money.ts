// Деньги по заказу: затраты, маржа, план оплат и дебиторка.
// Только чистые функции — поэтому всё считается и проверяется без браузера.
//
// Термины:
//   сумма      — сколько клиент платит по договору (deal.amount);
//   получено   — фактические платежи, возвраты вычитаются (deal.payments);
//   затраты    — материалы, фабрика, монтаж, доставка (deal.expenses);
//   маржа      — сумма − затраты (сколько остаётся до налогов);
//   остаток    — сколько клиент ещё должен по договору.
//
// Важно: доход считаем по дате платежа (деньги пришли), а не по дате сделки.
// Иначе «выручка за месяц» врёт при предоплате в одном месяце и доплате в другом.

import type { Deal, Expense, ExpenseKind, PlannedPayment, PaymentKind } from '../types';
import { daysBetween, parseDay, todayISO } from './dates';
import { nowIso, uid } from './utils';

export const EXPENSE_KINDS: Array<{ id: ExpenseKind; label: string; short: string }> = [
  { id: 'materials', label: 'Материалы и фурнитура', short: 'Материалы' },
  { id: 'factory', label: 'Фабрика, производство', short: 'Фабрика' },
  { id: 'install', label: 'Монтаж, работа бригады', short: 'Монтаж' },
  { id: 'delivery', label: 'Доставка и подъём', short: 'Доставка' },
  { id: 'other', label: 'Прочее', short: 'Прочее' },
];

export function expenseKindMeta(kind: ExpenseKind): { id: ExpenseKind; label: string; short: string } {
  return EXPENSE_KINDS.find((item) => item.id === kind) ?? EXPENSE_KINDS[EXPENSE_KINDS.length - 1];
}

export const PLAN_KINDS: Array<{ id: PaymentKind; label: string }> = [
  { id: 'prepay', label: 'Предоплата' },
  { id: 'final', label: 'Доплата' },
  { id: 'extra', label: 'Доп. работы' },
  { id: 'refund', label: 'Возврат' },
];

/* ------------------------------- затраты ------------------------------- */

export function expensesTotal(deal: Pick<Deal, 'expenses'>): number {
  return (deal.expenses ?? []).reduce((sum, expense) => sum + (Number(expense.amount) || 0), 0);
}

/** Затраты по статьям: сумма и доля от всех затрат. */
export interface ExpenseSlice {
  kind: ExpenseKind;
  label: string;
  amount: number;
  share: number;
}

export function expensesByKind(deal: Pick<Deal, 'expenses'>): ExpenseSlice[] {
  const total = expensesTotal(deal);
  return EXPENSE_KINDS
    .map((meta) => {
      const amount = (deal.expenses ?? [])
        .filter((expense) => expense.kind === meta.id)
        .reduce((sum, expense) => sum + (Number(expense.amount) || 0), 0);
      return { kind: meta.id, label: meta.short, amount, share: total > 0 ? amount / total : 0 };
    })
    .filter((slice) => slice.amount !== 0);
}

export function addExpense(deal: Deal, input: { kind: ExpenseKind; amount: number; at?: string; comment?: string; addedBy?: string }): Deal {
  const expense: Expense = {
    id: uid('exp'),
    kind: input.kind,
    amount: Math.round(Number(input.amount) || 0),
    at: (input.at || todayISO()).slice(0, 10),
    comment: input.comment?.trim() || undefined,
    addedBy: input.addedBy?.trim() || undefined,
  };
  return touch(deal, { expenses: [...(deal.expenses ?? []), expense] });
}

export function patchExpense(deal: Deal, id: string, patch: Partial<Omit<Expense, 'id'>>): Deal {
  return touch(deal, {
    expenses: (deal.expenses ?? []).map((expense) => (expense.id === id
      ? {
        ...expense,
        ...patch,
        amount: patch.amount === undefined ? expense.amount : Math.round(Number(patch.amount) || 0),
        at: patch.at ? patch.at.slice(0, 10) : expense.at,
      }
      : expense)),
  });
}

export function removeExpense(deal: Deal, id: string): Deal {
  return touch(deal, { expenses: (deal.expenses ?? []).filter((expense) => expense.id !== id) });
}

/* -------------------------------- маржа -------------------------------- */

export interface DealMoney {
  /** Сумма по договору. */
  total: number;
  /** Получено по факту (возвраты вычитаны). */
  paid: number;
  /** Остаток к получению по договору. */
  remainder: number;
  /** Все затраты по заказу. */
  expenses: number;
  /** Прибыль по договору: сумма − затраты. */
  margin: number;
  /** Маржа в процентах от суммы; 0, если сумма не заполнена. */
  marginPercent: number;
  /** Сколько денег уже вернулось: получено − затраты. Может быть минусом. */
  cashNow: number;
  /** Затраты больше суммы — сделка в убыток. */
  loss: boolean;
  /** Маржа ниже порога (10%) — повод проверить смету. */
  thin: boolean;
  /** Не хватает данных: нет суммы или нет затрат. */
  incomplete: boolean;
}

/** Порог «тонкой» маржи в процентах. */
export const THIN_MARGIN_PERCENT = 10;

export function dealMoney(deal: Deal): DealMoney {
  const total = Math.max(0, Number(deal.amount) || 0);
  const paid = (deal.payments ?? []).reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);
  const expenses = expensesTotal(deal);
  const margin = total - expenses;
  const hasExpenses = (deal.expenses ?? []).length > 0;
  const marginPercent = total > 0 && hasExpenses ? Math.round((margin / total) * 1000) / 10 : 0;
  return {
    total,
    paid,
    remainder: Math.max(0, total - paid),
    expenses,
    margin,
    marginPercent,
    cashNow: paid - expenses,
    loss: total > 0 && expenses > total,
    thin: total > 0 && hasExpenses && expenses <= total && marginPercent < THIN_MARGIN_PERCENT,
    incomplete: total <= 0 || !hasExpenses,
  };
}

/* ----------------------------- план оплат ----------------------------- */

export function addPlannedPayment(deal: Deal, input: { amount: number; at: string; kind: PaymentKind; comment?: string }): Deal {
  const entry: PlannedPayment = {
    id: uid('plan'),
    amount: Math.round(Number(input.amount) || 0),
    at: (input.at || todayISO()).slice(0, 10),
    kind: input.kind,
    comment: input.comment?.trim() || undefined,
  };
  return touch(deal, { plan: [...(deal.plan ?? []), entry] });
}

export function patchPlannedPayment(deal: Deal, id: string, patch: Partial<Omit<PlannedPayment, 'id'>>): Deal {
  return touch(deal, {
    plan: (deal.plan ?? []).map((entry) => (entry.id === id
      ? {
        ...entry,
        ...patch,
        amount: patch.amount === undefined ? entry.amount : Math.round(Number(patch.amount) || 0),
        at: patch.at ? patch.at.slice(0, 10) : entry.at,
      }
      : entry)),
  });
}

export function removePlannedPayment(deal: Deal, id: string): Deal {
  return touch(deal, { plan: (deal.plan ?? []).filter((entry) => entry.id !== id) });
}

/** Отметить плановый платёж полученным — создаёт фактический платёж. */
export function settlePlannedPayment(deal: Deal, id: string, paidAt?: string): Deal {
  const entry = (deal.plan ?? []).find((item) => item.id === id);
  if (!entry || entry.paidId) return deal;
  const paymentId = uid('pay');
  const payment = {
    id: paymentId,
    amount: entry.amount,
    at: (paidAt || todayISO()).slice(0, 10),
    kind: entry.kind,
    comment: entry.comment ?? 'по плану оплат',
  };
  return touch(deal, {
    payments: [...(deal.payments ?? []), payment],
    plan: (deal.plan ?? []).map((item) => (item.id === id ? { ...item, paidId: paymentId } : item)),
  });
}

/** Снять отметку «получено»: платёж удаляется, план снова ждёт. */
export function unsettlePlannedPayment(deal: Deal, id: string): Deal {
  const entry = (deal.plan ?? []).find((item) => item.id === id);
  if (!entry?.paidId) return deal;
  return touch(deal, {
    payments: (deal.payments ?? []).filter((payment) => payment.id !== entry.paidId),
    plan: (deal.plan ?? []).map((item) => (item.id === id ? { ...item, paidId: undefined } : item)),
  });
}

/**
 * Привести план в порядок: если платежей внесли больше, чем было в плане,
 * отметить последние ожидаемые как полученные. Нужно, чтобы дебиторка не
 * показывала «долг», который уже закрыт деньгами.
 */
export function settlePlanByPayments(deal: Deal): Deal {
  const pending = (deal.plan ?? []).filter((entry) => !entry.paidId);
  if (pending.length === 0) return deal;
  const unpaid = dealMoney(deal).remainder;
  if (unpaid > 0) return deal;
  return touch(deal, {
    plan: (deal.plan ?? []).map((entry) => (entry.paidId ? entry : { ...entry, paidId: 'paid' })),
  });
}

/* ------------------------------- дебиторка ------------------------------- */

export interface DebtItem {
  deal: Deal;
  /** Плановая сумма (просроченная или ближайшая), если план заполнен. */
  planned: number;
  /** Сколько обещано к этой дате. */
  dueAt: string;
  /** Просрочено дней: 0 — сегодня и позже, >0 — сколько дней ждём. */
  overdue: number;
  /** По договору осталось получить. */
  remainder: number;
  client: string;
}

/**
 * Кто сколько должен. Основа — остаток по договору; дата берётся из плана:
 * самая ранняя неоплаченная позиция. Если плана нет, ставим «без даты» и
 * сортируем такие в конец.
 */
export function receivables(
  deals: Deal[],
  today = todayISO(),
  clientName: (deal: Deal) => string = () => '',
): DebtItem[] {
  const items: DebtItem[] = [];
  for (const deal of deals) {
    const money = dealMoney(deal);
    if (money.remainder <= 0) continue;
    if (deal.status === 'rejected') continue;
    const pending = (deal.plan ?? [])
      .filter((entry) => !entry.paidId && entry.amount > 0)
      .sort((left, right) => left.at.localeCompare(right.at));
    const first = pending[0];
    const planned = pending.length > 0
      ? pending.reduce((sum, entry) => sum + entry.amount, 0)
      : money.remainder;
    items.push({
      deal,
      planned: Math.min(planned, money.remainder),
      dueAt: first?.at ?? '',
      overdue: first ? Math.max(0, daysBetween(first.at, today)) : 0,
      remainder: money.remainder,
      client: clientName(deal),
    });
  }
  return items.sort((left, right) => {
    if (left.overdue !== right.overdue) return right.overdue - left.overdue;
    if (left.dueAt !== right.dueAt) return left.dueAt.localeCompare(right.dueAt);
    return right.remainder - left.remainder;
  });
}

export function overdueDebt(items: DebtItem[]): DebtItem[] {
  return items.filter((item) => item.overdue > 0);
}

export function nextPlanned(deal: Deal): PlannedPayment | null {
  const pending = (deal.plan ?? [])
    .filter((entry) => !entry.paidId)
    .sort((left, right) => left.at.localeCompare(right.at));
  return pending[0] ?? null;
}

/* ------------------------------- расходы ------------------------------- */

export interface ExpenseRow {
  dealId: string;
  dealTitle: string;
  expense: Expense;
}

/** Все затраты за период — для отчёта и выгрузки в бухгалтерию. */
export function expensesInRange(deals: Deal[], from: string, to: string): ExpenseRow[] {
  const rows: ExpenseRow[] = [];
  for (const deal of deals) {
    for (const expense of deal.expenses ?? []) {
      if (expense.at >= from && expense.at <= to) {
        rows.push({ dealId: deal.id, dealTitle: deal.title, expense });
      }
    }
  }
  return rows.sort((left, right) => left.expense.at.localeCompare(right.expense.at));
}

/* ------------------------------- движение ------------------------------- */

/** Обновить сделку с отметкой времени — как в остальном приложении. */
function touch(deal: Deal, patch: Partial<Deal>): Deal {
  return { ...deal, ...patch, updatedAt: nowIso() };
}

/** Подходит ли дата в период (включительно). */
export function inRange(day: string | undefined, from: string, to: string): boolean {
  if (!day) return false;
  const value = day.slice(0, 10);
  return value >= from && value <= to;
}

/** Проверка даты из поля ввода: пустое и мусор → сегодня. */
export function dayOrToday(value?: string, today = todayISO()): string {
  if (!value) return today;
  const date = parseDay(value.slice(0, 10));
  return Number.isNaN(date.getTime()) ? today : date.toISOString().slice(0, 10);
}
