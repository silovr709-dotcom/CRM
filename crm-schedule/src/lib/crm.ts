// Статусы сделки, подписи этапов и правила «когда следующий контакт».
// Чистые функции — без React и без хранилища.

import type { Deal, DealStatus } from '../types';
import { daysBetween, todayISO } from './dates';

export interface DealStatusMeta {
  value: DealStatus;
  label: string;
  hint: string;
  stage: 'lead' | 'offer' | 'approved' | 'production' | 'closed';
  /** Цвет для бейджа. */
  tone: string;
}

export const DEAL_STATUSES: DealStatusMeta[] = [
  { value: 'draft', label: 'Черновик', hint: 'собираем исходные данные', stage: 'lead', tone: 'slate' },
  { value: 'calculating', label: 'На просчёте', hint: 'комплектуем и считаем', stage: 'lead', tone: 'blue' },
  { value: 'offerSent', label: 'КП отправлено', hint: 'ждём реакцию клиента', stage: 'offer', tone: 'violet' },
  { value: 'clientThinking', label: 'Клиент думает', hint: 'следующий контакт обязателен', stage: 'offer', tone: 'violet' },
  { value: 'approved', label: 'Согласовано', hint: 'можно готовить документы', stage: 'approved', tone: 'green' },
  { value: 'techCheck', label: 'На проверке технолога', hint: 'проверка перед фабрикой', stage: 'approved', tone: 'green' },
  { value: 'factorySent', label: 'Передано на фабрику', hint: 'пакет отправлен', stage: 'production', tone: 'amber' },
  { value: 'production', label: 'В производстве', hint: 'контроль сроков', stage: 'production', tone: 'amber' },
  { value: 'ready', label: 'Готово', hint: 'готово к выдаче', stage: 'production', tone: 'amber' },
  { value: 'delivered', label: 'Выдано', hint: 'заказ закрыт', stage: 'closed', tone: 'slate' },
  { value: 'rejected', label: 'Отказ', hint: 'зафиксировать причину', stage: 'closed', tone: 'red' },
];

export function statusMeta(status: DealStatus): DealStatusMeta {
  return DEAL_STATUSES.find((item) => item.value === status) ?? DEAL_STATUSES[0];
}

export function isClosedStatus(status: DealStatus): boolean {
  return status === 'delivered' || status === 'rejected';
}

/** Показывать ли сделку как активную. */
export function isActiveDeal(deal: Deal): boolean {
  return !isClosedStatus(deal.status);
}

export type ContactTone = 'none' | 'overdue' | 'today' | 'soon' | 'planned';

/** Срочность следующего контакта. */
export function contactTone(day?: string, today = todayISO()): ContactTone {
  if (!day) return 'none';
  const diff = daysBetween(today, day);
  if (diff < 0) return 'overdue';
  if (diff === 0) return 'today';
  if (diff <= 3) return 'soon';
  return 'planned';
}

export function contactToneLabel(tone: ContactTone, day?: string): string {
  switch (tone) {
    case 'none': return 'срок не назначен';
    case 'overdue': return `просрочено${day ? ` с ${day.split('-').reverse().join('.')}` : ''}`;
    case 'today': return 'сегодня';
    case 'soon': return 'скоро';
    default: return 'запланировано';
  }
}

/** Что делать дальше на этом этапе, если менеджер не написал своё. */
export function defaultNextAction(status: DealStatus): string {
  switch (status) {
    case 'draft': return 'Собрать исходные данные и замер';
    case 'calculating': return 'Досчитать комплект и подготовить КП';
    case 'offerSent': return 'Связаться с клиентом после отправки КП';
    case 'clientThinking': return 'Уточнить решение клиента и возражения';
    case 'approved': return 'Подготовить договор, чек и пакет на проверку';
    case 'techCheck': return 'Проверить замечания технолога';
    case 'factorySent': return 'Получить подтверждение фабрики';
    case 'production': return 'Проверить срок производства и готовность';
    case 'ready': return 'Согласовать выдачу, доставку или монтаж';
    case 'delivered': return 'Закрыть заказ и запросить отзыв';
    case 'rejected': return 'Зафиксировать причину отказа';
    default: return 'Следующий контакт с клиентом';
  }
}

/** Готовый текст сообщения клиенту под текущий этап сделки. */
export function dealMessage(deal: Deal, clientName: string, paid: number, fmt: (value: number) => string): string {
  const name = clientName || 'Добрый день';
  const total = fmt(deal.amount);
  const remainder = fmt(Math.max(0, deal.amount - paid));
  switch (deal.status) {
    case 'draft':
    case 'calculating':
      return `${name}, добрый день! Готовим расчёт по проекту «${deal.title}». Уточню пару деталей и пришлю коммерческое предложение.`;
    case 'offerSent':
      return `${name}, отправили КП по проекту «${deal.title}» на сумму ${total}. Посмотрите, пожалуйста, и напишите, что скорректировать.`;
    case 'clientThinking':
      return `${name}, добрый день! Напоминаю про проект «${deal.title}» на ${total}. Подскажите, двигаемся дальше или нужны правки?`;
    case 'approved':
    case 'techCheck':
      return `${name}, проект «${deal.title}» согласован. Готовим договор и товарный чек.`;
    case 'factorySent':
    case 'production':
      return `${name}, ваш заказ «${deal.title}» в производстве. Остаток к оплате: ${remainder}.`;
    case 'ready':
      return `${name}, заказ «${deal.title}» готов. Остаток к оплате ${remainder} — давайте согласуем доставку и монтаж.`;
    case 'delivered':
      return `${name}, спасибо за заказ «${deal.title}»! Будем рады рекомендациям и всегда поможем с сервисом.`;
    default:
      return `${name}, добрый день! По проекту «${deal.title}»: ${deal.nextAction || defaultNextAction(deal.status)}.`;
  }
}
