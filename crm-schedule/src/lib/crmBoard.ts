// Воронка CRM: этапы, фильтры «с кем работать сейчас», сортировка и сводка.
// Логика вынесена из компонентов, чтобы её можно было проверить тестами.

import type { ContactTone } from './crm';
import { isClosedStatus } from './crm';
import type { Deal, DealStatus } from '../types';
import { contactTone } from './crm';
import { paidAmount } from './crmTasks';
import { fmtMoney } from './dates';

export type CrmFocus = 'today' | 'week' | 'no-next' | 'active' | 'closed' | 'all';

export interface StageDef {
  id: string;
  title: string;
  hint: string;
  statuses: DealStatus[];
}

/** Пять этапов воронки — по ним же работает доска. */
export const CRM_STAGES: StageDef[] = [
  { id: 'lead', title: 'Лид и расчёт', hint: 'замер, данные, просчёт', statuses: ['draft', 'calculating'] },
  { id: 'offer', title: 'КП у клиента', hint: 'отправлено, клиент думает', statuses: ['offerSent', 'clientThinking'] },
  { id: 'approved', title: 'Согласовано', hint: 'договор и проверка', statuses: ['approved', 'techCheck'] },
  { id: 'production', title: 'Производство', hint: 'фабрика и готовность', statuses: ['factorySent', 'production', 'ready'] },
  { id: 'closed', title: 'Закрыто', hint: 'выдано или отказ', statuses: ['delivered', 'rejected'] },
];

export const CRM_FOCUS_LABELS: Record<CrmFocus, string> = {
  today: 'Сегодня и просрочено',
  week: 'На неделе',
  'no-next': 'Без следующего шага',
  active: 'Все активные',
  closed: 'Закрытые',
  all: 'Вообще все',
};

/** Минимум данных строки, нужный для фильтрации и сортировки. */
export interface CrmRowLike {
  status: DealStatus;
  tone: ContactTone;
  hasNextAction: boolean;
  closed: boolean;
  total: number;
  updatedAt: string;
  search: string;
}

export function matchesFocus(row: CrmRowLike, focus: CrmFocus): boolean {
  switch (focus) {
    case 'today': return !row.closed && (row.tone === 'overdue' || row.tone === 'today');
    case 'week': return !row.closed && (row.tone === 'overdue' || row.tone === 'today' || row.tone === 'soon');
    case 'no-next': return !row.closed && (!row.hasNextAction || row.tone === 'none');
    case 'active': return !row.closed;
    case 'closed': return row.closed;
    case 'all': return true;
    default: return true;
  }
}

export function matchesQuery(row: CrmRowLike, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase('ru-RU');
  if (!needle) return true;
  return row.search.toLocaleLowerCase('ru-RU').includes(needle);
}

const TONE_RANK: Record<ContactTone, number> = { overdue: 0, today: 1, none: 2, soon: 3, planned: 4 };

export function compareCrmRows(left: CrmRowLike, right: CrmRowLike): number {
  const byTone = TONE_RANK[left.tone] - TONE_RANK[right.tone];
  if (byTone !== 0) return byTone;
  return right.updatedAt.localeCompare(left.updatedAt);
}

export interface StageSummary extends StageDef {
  count: number;
  total: number;
}

export function summarizeStages(rows: CrmRowLike[]): StageSummary[] {
  return CRM_STAGES.map((stage) => {
    const stageRows = rows.filter((row) => stage.statuses.includes(row.status));
    return { ...stage, count: stageRows.length, total: stageRows.reduce((sum, row) => sum + row.total, 0) };
  });
}

export interface FocusCounts {
  today: number;
  week: number;
  noNext: number;
  active: number;
  closed: number;
  pipeline: number;
}

export function focusCounts(rows: CrmRowLike[]): FocusCounts {
  const active = rows.filter((row) => !row.closed);
  return {
    today: active.filter((row) => row.tone === 'overdue' || row.tone === 'today').length,
    week: active.filter((row) => row.tone === 'overdue' || row.tone === 'today' || row.tone === 'soon').length,
    noNext: active.filter((row) => !row.hasNextAction || row.tone === 'none').length,
    active: active.length,
    closed: rows.length - active.length,
    pipeline: active.reduce((sum, row) => sum + row.total, 0),
  };
}

export interface DealRow extends CrmRowLike {
  deal: Deal;
  toneLabel: string;
}

/** Строка списка сделок — всё, что нужно фильтрам и карточке. */
export function buildDealRows(
  deals: Deal[],
  clientName: (deal: Deal) => string,
  today = new Date().toISOString().slice(0, 10),
  extraSearch: (deal: Deal) => string = () => '',
): DealRow[] {
  return deals.map((deal) => {
    const closed = isClosedStatus(deal.status);
    const tone = contactTone(deal.nextContactAt, today);
    const openTask = (deal.tasks ?? []).some((task) => !task.done);
    const search = [
      deal.title,
      clientName(deal),
      deal.nextAction,
      deal.comment,
      deal.manager,
      deal.schedule.team,
      deal.schedule.address,
      ...(deal.tasks ?? []).map((task) => task.title),
      ...(deal.payments ?? []).map((payment) => payment.comment ?? ''),
      extraSearch(deal),
    ].filter(Boolean).join(' ');
    return {
      deal,
      status: deal.status,
      tone,
      toneLabel: tone === 'overdue' ? 'просрочено' : tone === 'today' ? 'сегодня' : tone === 'soon' ? 'скоро' : '',
      hasNextAction: Boolean(deal.nextAction?.trim()) || openTask,
      closed,
      total: deal.amount,
      updatedAt: deal.updatedAt,
      search,
    };
  });
}

/** Деньги: сколько уже получено по всем сделкам. */
export function totalPaid(deals: Deal[]): number {
  return deals.reduce((sum, deal) => sum + paidAmount(deal.payments), 0);
}

export function pipelineLabel(deals: Deal[]): string {
  return fmtMoney(deals.filter((deal) => !isClosedStatus(deal.status)).reduce((sum, deal) => sum + deal.amount, 0));
}
