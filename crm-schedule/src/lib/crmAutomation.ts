// Автоматические правила CRM: система сама ставит задачи, чтобы сделки не повисали.
// Логика чистая — поэтому её легко проверить тестами.

import type { Deal, DealStatus, TaskKind } from '../types';
import { addDays, todayISO } from './dates';
import { addTask, paymentState } from './crmTasks';

export type RuleId = 'callAfterOffer' | 'contractAfterApproval' | 'askPrepayment' | 'afterInstall' | 'stuckDeal';

export interface AutomationRule {
  id: RuleId;
  label: string;
  hint: string;
  /** Через сколько дней срабатывает. */
  days: number;
  enabled: boolean;
}

export const DEFAULT_RULES: AutomationRule[] = [
  { id: 'callAfterOffer', label: 'Позвонить после КП', hint: 'если клиент не ответил на отправленное предложение', days: 2, enabled: true },
  { id: 'contractAfterApproval', label: 'Договор после согласования', hint: 'клиент согласовал — готовим документы', days: 0, enabled: true },
  { id: 'askPrepayment', label: 'Запросить предоплату', hint: 'сделка согласована, но денег нет', days: 3, enabled: true },
  { id: 'afterInstall', label: 'Позвонить после монтажа', hint: 'узнать впечатления и попросить рекомендацию', days: 3, enabled: true },
  { id: 'stuckDeal', label: 'Сделка зависла', hint: 'по активной сделке давно нет движения', days: 10, enabled: true },
];

export interface AutomationAction {
  ruleId: RuleId;
  dealId: string;
  task: { title: string; kind: TaskKind; dueAt: string; origin: string };
  nextStatus?: DealStatus;
}

function day(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function daysBetween(fromIso: string, now: Date): number {
  const from = new Date(fromIso);
  if (Number.isNaN(from.getTime())) return 0;
  return Math.floor((now.getTime() - from.getTime()) / 86400000);
}

function hasAutoTask(deal: Deal, ruleId: RuleId): boolean {
  return (deal.tasks ?? []).some((task) => task.origin === `auto:${ruleId}` && !task.done);
}

export interface AutomationInput {
  deal: Deal;
  now?: Date;
  /** Клиент согласовал КП (внешняя отметка). */
  offerApprovedAt?: string | null;
  /** Монтаж выполнен. */
  installDoneAt?: string | null;
}

/** Какие задачи нужно создать прямо сейчас. Повторы исключены по метке origin. */
export function planAutomation(input: AutomationInput, rules: AutomationRule[], now = new Date()): AutomationAction[] {
  const actions: AutomationAction[] = [];
  const { deal } = input;
  const status = deal.status;
  const paid = paymentState(deal).paid;
  const client = deal.title || 'клиент';
  const enabled = (id: RuleId) => rules.find((rule) => rule.id === id && rule.enabled);

  const callRule = enabled('callAfterOffer');
  if (callRule && (status === 'offerSent' || status === 'clientThinking')
    && daysBetween(deal.updatedAt, now) >= callRule.days && !hasAutoTask(deal, 'callAfterOffer')) {
    actions.push({
      ruleId: 'callAfterOffer',
      dealId: deal.id,
      task: { title: `Позвонить по заказу «${client}»: узнать решение по КП`, kind: 'call', dueAt: day(now), origin: 'auto:callAfterOffer' },
    });
  }

  const contractRule = enabled('contractAfterApproval');
  if (contractRule && input.offerApprovedAt && !hasAutoTask(deal, 'contractAfterApproval')) {
    actions.push({
      ruleId: 'contractAfterApproval',
      dealId: deal.id,
      task: { title: `Подготовить договор: «${client}» согласовал КП`, kind: 'docs', dueAt: day(now), origin: 'auto:contractAfterApproval' },
      nextStatus: status === 'offerSent' || status === 'clientThinking' ? 'approved' : undefined,
    });
  }

  const prepayRule = enabled('askPrepayment');
  if (prepayRule && (status === 'approved' || status === 'techCheck') && paid <= 0
    && daysBetween(deal.updatedAt, now) >= prepayRule.days && !hasAutoTask(deal, 'askPrepayment')) {
    actions.push({
      ruleId: 'askPrepayment',
      dealId: deal.id,
      task: { title: `Запросить предоплату по заказу «${client}»`, kind: 'payment', dueAt: day(now), origin: 'auto:askPrepayment' },
    });
  }

  const afterInstallRule = enabled('afterInstall');
  if (afterInstallRule && input.installDoneAt && !hasAutoTask(deal, 'afterInstall')) {
    actions.push({
      ruleId: 'afterInstall',
      dealId: deal.id,
      task: {
        title: `Позвонить по заказу «${client}» после монтажа: впечатления и отзыв`,
        kind: 'call',
        dueAt: addDays(input.installDoneAt.slice(0, 10), afterInstallRule.days),
        origin: 'auto:afterInstall',
      },
    });
  }

  const stuckRule = enabled('stuckDeal');
  const closed = status === 'delivered' || status === 'rejected';
  if (stuckRule && !closed && daysBetween(deal.updatedAt, now) >= stuckRule.days && !hasAutoTask(deal, 'stuckDeal')) {
    actions.push({
      ruleId: 'stuckDeal',
      dealId: deal.id,
      task: {
        title: `Сделка без движения ${daysBetween(deal.updatedAt, now)} дн. — связаться по заказу «${client}»`,
        kind: 'call',
        dueAt: day(now),
        origin: 'auto:stuckDeal',
      },
    });
  }

  return actions;
}

export interface AutomationResult {
  deals: Deal[];
  applied: Array<{ dealId: string; ruleId: RuleId; title: string }>;
}

/** Прогоняет все правила по всем сделкам и возвращает обновлённый список. */
export function runAutomations(deals: Deal[], rules: AutomationRule[], now = new Date()): AutomationResult {
  const applied: AutomationResult['applied'] = [];
  const today = todayISO();
  const next = deals.map((deal) => {
    const installDoneAt = deal.schedule.status === 'done' && deal.schedule.installAt && deal.schedule.installAt <= today
      ? deal.schedule.installAt
      : null;
    const actions = planAutomation({ deal, now, installDoneAt }, rules, now);
    if (actions.length === 0) return deal;

    let updated = deal;
    for (const action of actions) {
      updated = addTask(updated, { ...action.task, done: false });
      if (action.nextStatus && updated.status !== action.nextStatus) {
        updated = {
          ...updated,
          status: action.nextStatus,
          history: [...(updated.history ?? []), {
            id: `h_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
            createdAt: new Date().toISOString(),
            kind: 'status',
            title: 'Автоматика сменила этап',
            text: action.task.title,
          }],
        };
      }
      applied.push({ dealId: deal.id, ruleId: action.ruleId, title: action.task.title });
    }
    return updated;
  });
  return { deals: next, applied };
}

/** Сохранённые настройки правил приводятся к актуальному списку. */
export function normalizeRules(raw: unknown): AutomationRule[] {
  const saved = Array.isArray(raw) ? (raw as Array<Partial<AutomationRule>>) : [];
  return DEFAULT_RULES.map((rule) => {
    const found = saved.find((item) => item?.id === rule.id);
    if (!found) return rule;
    const days = Number(found.days);
    return {
      ...rule,
      enabled: found.enabled !== false,
      days: Number.isFinite(days) && days >= 0 && days <= 90 ? Math.round(days) : rule.days,
    };
  });
}
