// Значения настроек по умолчанию — отдельный модуль, чтобы не было циклов импорта.
import type { Settings } from '../types';
import { DEFAULT_RULES } from './crmAutomation';
import { DEFAULT_TEMPLATES } from './templates';
import { defaultDigest, defaultQuietHours, defaultReminderRules } from './reminders';

export function defaultSettings(): Settings {
  return {
    companyName: 'Моя студия',
    myName: '',
    role: 'owner',
    accounts: [],
    managers: [],
    teams: [],
    hints: true,
    theme: 'light',
    notifications: true,
    reminderMinutes: 60,
    messageTemplates: DEFAULT_TEMPLATES,
    reminderRules: defaultReminderRules(),
    quietHours: defaultQuietHours(),
    digest: defaultDigest(),
    rules: DEFAULT_RULES,
    demo: false,
  };
}
