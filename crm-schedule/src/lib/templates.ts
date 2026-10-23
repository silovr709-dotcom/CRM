// Шаблоны сообщений клиенту с подстановками. Свои шаблоны редактируются
// в «Данных», а в карточке сделки текст можно поправить перед отправкой.
import type { Deal, MessageTemplate } from '../types';
import { fmtDate, fmtMoney } from './dates';
import { paidAmount } from './crmTasks';

export const DEFAULT_TEMPLATES: MessageTemplate[] = [
  {
    id: 'tpl_offer',
    title: 'КП отправлено',
    enabled: true,
    text: '{client}, добрый день! Отправили коммерческое предложение по проекту «{deal}» на сумму {total}. Посмотрите, пожалуйста, и напишите, что скорректировать.',
  },
  {
    id: 'tpl_reminder',
    title: 'Напоминание о решении',
    enabled: true,
    text: '{client}, добрый день! Напоминаю про проект «{deal}» на {total}. Подскажите, двигаемся дальше или нужны правки?',
  },
  {
    id: 'tpl_payment',
    title: 'Остаток к оплате',
    enabled: true,
    text: '{client}, по заказу «{deal}» остаток к оплате — {remainder} из {total}. Как удобнее внести?',
  },
  {
    id: 'tpl_install',
    title: 'Подтверждение монтажа',
    enabled: true,
    text: '{client}, подтверждаем монтаж {date}{team}. Адрес: {address}. Если время неудобно — напишите, перенесём.',
  },
  {
    id: 'tpl_after',
    title: 'После монтажа',
    enabled: true,
    text: '{client}, спасибо за заказ «{deal}»! Если всё устраивает, будем благодарны за отзыв. По гарантии всегда на связи.',
  },
];

export interface TemplateContext {
  client: string;
  deal: string;
  total: string;
  paid: string;
  remainder: string;
  date: string;
  team: string;
  address: string;
  manager: string;
  company: string;
}

export function templateContext(deal: Deal, clientName: string, company: string): TemplateContext {
  const paid = paidAmount(deal.payments);
  return {
    client: clientName || 'Добрый день',
    deal: deal.title,
    total: fmtMoney(deal.amount),
    paid: fmtMoney(paid),
    remainder: fmtMoney(Math.max(0, deal.amount - paid)),
    date: deal.schedule?.installAt ? fmtDate(deal.schedule.installAt) : 'дата уточняется',
    team: deal.schedule?.team ? `, бригада: ${deal.schedule.team}` : '',
    address: deal.schedule?.address || 'уточним перед выездом',
    manager: deal.manager || '',
    company: company || '',
  };
}

/** Подставляет {переменные} и убирает лишние пробелы. */
export function renderTemplate(text: string, context: TemplateContext): string {
  const rendered = text.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const value = (context as unknown as Record<string, string>)[key];
    return value ?? '';
  });
  return rendered.replace(/\s+([,.;:!?])/g, '$1').replace(/[ \t]{2,}/g, ' ').trim();
}

export function enabledTemplates(templates?: MessageTemplate[]): MessageTemplate[] {
  return (templates ?? DEFAULT_TEMPLATES).filter((template) => template.enabled !== false);
}

/** Нормализация шаблонов из настроек/резервной копии. */
export function normalizeTemplates(raw: unknown): MessageTemplate[] {
  if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_TEMPLATES;
  return raw
    .filter((item): item is Partial<MessageTemplate> => Boolean(item) && typeof item === 'object')
    .map((item, index) => ({
      id: typeof item.id === 'string' && item.id ? item.id : `tpl_${index + 1}`,
      title: typeof item.title === 'string' && item.title ? item.title : `Шаблон ${index + 1}`,
      text: typeof item.text === 'string' ? item.text : '',
      enabled: item.enabled !== false,
    }));
}
