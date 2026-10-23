// Настройки автоматических правил CRM хранятся отдельно от базы.
import { DEFAULT_RULES, normalizeRules, type AutomationRule } from './crmAutomation';

const KEY = 'crm-schedule.rules.v1';

export function loadRules(): AutomationRule[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_RULES;
    return normalizeRules(JSON.parse(raw));
  } catch {
    return DEFAULT_RULES;
  }
}

export function saveRules(rules: AutomationRule[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(rules));
  } catch {
    /* переполнение хранилища не критично — правила останутся по умолчанию */
  }
}
