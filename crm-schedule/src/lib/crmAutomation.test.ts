import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, normalizeRules, planAutomation, runAutomations } from './crmAutomation';
import { makeDeal } from './testUtils';

// Даты считаем от того же «сейчас», с которым сравнивает правила, иначе тест
// начинает зависеть от календаря: 3 дня назад от сегодня — ещё не 3 дня назад от 22 октября.
const now = new Date('2026-10-22T12:00:00.000Z');
const daysAgoIso = (days: number) => new Date(now.getTime() - days * 86400000).toISOString();

describe('автоматические правила', () => {
  it('ставит звонок после отправки КП, когда прошло 2 дня', () => {
    const deal = makeDeal({ status: 'offerSent', updatedAt: daysAgoIso(3) });
    const actions = planAutomation({ deal }, DEFAULT_RULES, now);
    expect(actions.map((action) => action.ruleId)).toContain('callAfterOffer');
  });

  it('не ставит задачу повторно', () => {
    const deal = makeDeal({
      status: 'offerSent',
      updatedAt: daysAgoIso(5),
      tasks: [{ id: 't1', title: 'Позвонить', kind: 'call', origin: 'auto:callAfterOffer', createdAt: '' }],
    });
    const actions = planAutomation({ deal }, DEFAULT_RULES, now);
    expect(actions.map((action) => action.ruleId)).not.toContain('callAfterOffer');
  });

  it('поднимает зависшую сделку', () => {
    const deal = makeDeal({ status: 'approved', updatedAt: daysAgoIso(20) });
    const actions = planAutomation({ deal }, DEFAULT_RULES, now);
    expect(actions.map((action) => action.ruleId)).toContain('stuckDeal');
  });

  it('просит предоплату по согласованной сделке без денег', () => {
    const deal = makeDeal({ status: 'approved', updatedAt: daysAgoIso(4), amount: 200000 });
    const actions = planAutomation({ deal }, DEFAULT_RULES, now);
    expect(actions.map((action) => action.ruleId)).toContain('askPrepayment');
  });

  it('ставит договор после согласования КП и меняет этап', () => {
    const deal = makeDeal({ status: 'offerSent', updatedAt: daysAgoIso(1) });
    const actions = planAutomation({ deal, offerApprovedAt: daysAgoIso(0) }, DEFAULT_RULES, now);
    const contract = actions.find((action) => action.ruleId === 'contractAfterApproval');
    expect(contract?.nextStatus).toBe('approved');
  });

  it('пропускает отключённые правила', () => {
    const deal = makeDeal({ status: 'offerSent', updatedAt: daysAgoIso(5) });
    const rules = DEFAULT_RULES.map((rule) => (rule.id === 'callAfterOffer' ? { ...rule, enabled: false } : rule));
    const actions = planAutomation({ deal }, rules, now);
    expect(actions.map((action) => action.ruleId)).not.toContain('callAfterOffer');
  });

  it('применяет задачи ко всем сделкам и возвращает отчёт', () => {
    const deals = [
      makeDeal({ id: 'a', status: 'offerSent', updatedAt: daysAgoIso(5) }),
      makeDeal({ id: 'b', status: 'production', updatedAt: daysAgoIso(1) }),
    ];
    const result = runAutomations(deals, DEFAULT_RULES, now);
    expect(result.applied.length).toBeGreaterThan(0);
    expect(result.deals[0].tasks.length).toBeGreaterThan(0);
    expect(result.deals[1].tasks.length).toBe(0);
  });

  it('нормализует сохранённые правила', () => {
    const rules = normalizeRules([{ id: 'callAfterOffer', enabled: false, days: 7 }]);
    expect(rules.find((rule) => rule.id === 'callAfterOffer')).toMatchObject({ enabled: false, days: 7 });
    expect(rules.find((rule) => rule.id === 'stuckDeal')?.days).toBe(10);
  });
});
