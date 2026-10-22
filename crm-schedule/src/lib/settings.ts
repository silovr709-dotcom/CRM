// Значения настроек по умолчанию — отдельный модуль, чтобы не было циклов импорта.
import type { Settings } from '../types';
import { DEFAULT_RULES } from './crmAutomation';
import { DEFAULT_TEMPLATES } from './templates';

export function defaultSettings(): Settings {
  return {
    companyName: 'Моя студия',
    myName: '',
    managers: [],
    teams: [],
    hints: true,
    theme: 'light',
    notifications: false,
    reminderMinutes: 60,
    messageTemplates: DEFAULT_TEMPLATES,
    rules: DEFAULT_RULES,
    demo: false,
  };
}
