// Напоминания клиенту: что и когда ему написать.
//
// Не «ещё один список задач», а готовые сообщения к событиям заказа: за день
// до замера, перед доставкой и монтажом, после монтажа, при остатке к оплате.
// Текст уже собран из данных сделки — остаётся открыть WhatsApp или Telegram.

import type { Client, Deal } from '../types';
import { addDays, fmtDate, fmtMoney, todayISO } from './dates';
import { paidAmount } from './crmTasks';
import { promisedDate } from './documents';

export type ClientReminderKind = 'measure' | 'delivery' | 'install' | 'review' | 'payment';

export interface ClientReminder {
  /** Стабильный ключ: сделка + вид + дата. */
  id: string;
  dealId: string;
  dealTitle: string;
  clientId: string;
  clientName: string;
  clientPhone?: string;
  kind: ClientReminderKind;
  /** Когда стоит написать, YYYY-MM-DD. */
  dueAt: string;
  /** Заголовок: «Монтаж завтра». */
  title: string;
  /** Готовый текст сообщения клиенту. */
  text: string;
  /** Просрочено, сегодня, скоро (в пределах 3 дней) или позже. */
  urgency: 'overdue' | 'today' | 'soon' | 'later';
  /** Уже отправляли — дата из истории сделки. */
  sentAt?: string;
}

export const CLIENT_REMINDER_META: Record<ClientReminderKind, { label: string; icon: string }> = {
  measure: { label: 'Замер', icon: '📐' },
  delivery: { label: 'Доставка', icon: '🚚' },
  install: { label: 'Монтаж', icon: '🔧' },
  review: { label: 'После монтажа', icon: '⭐' },
  payment: { label: 'Оплата', icon: '₽' },
};

/** Метка в истории сделки: по ней понимаем, что клиенту уже написали. */
export function reminderHistoryTitle(id: string): string {
  return `Клиенту: ${id}`;
}

/** Из истории сделки: какие напоминания уже отправлены. */
export function sentReminders(deal: Deal): Record<string, string> {
  const sent: Record<string, string> = {};
  for (const entry of deal.history ?? []) {
    if (entry.kind !== 'contact') continue;
    const prefix = reminderHistoryTitle('');
    if (!entry.title.startsWith(prefix)) continue;
    const id = entry.title.slice(prefix.length);
    if (id) sent[id] = entry.createdAt;
  }
  return sent;
}

function greeting(client: Client | undefined): string {
  const name = client?.name?.split(' ')[0];
  return name ? `${name}, добрый день!` : 'Добрый день!';
}

function signature(deal: Deal, settings: { companyName: string; myName: string }): string {
  return [deal.manager || settings.myName, settings.companyName].filter(Boolean).join(', ');
}

function urgencyOf(dueAt: string, today: string): ClientReminder['urgency'] {
  if (dueAt < today) return 'overdue';
  if (dueAt === today) return 'today';
  if (dueAt <= addDays(today, 3)) return 'soon';
  return 'later';
}

export interface ClientRemindersOptions {
  today?: string;
  /** Насколько вперёд смотреть по датам, дней. По умолчанию 30. */
  horizonDays?: number;
  /** Показывать уже отправленные (по умолчанию нет). */
  includeSent?: boolean;
}

/**
 * Список напоминаний по всем сделкам. Считаем только то, что ещё впереди
 * (или просрочено), и не трогаем отказанные заказы.
 */
export function clientReminders(
  deals: Deal[],
  clients: Client[],
  settings: { companyName: string; myName: string },
  options: ClientRemindersOptions = {},
): ClientReminder[] {
  const today = options.today ?? todayISO();
  const horizon = addDays(today, options.horizonDays ?? 30);
  const out: ClientReminder[] = [];

  for (const deal of deals) {
    if (deal.status === 'rejected') continue;
    const client = clients.find((item) => item.id === deal.clientId);
    const sent = sentReminders(deal);
    const device = signature(deal, settings);
    const hello = greeting(client);
    const schedule = deal.schedule ?? { status: 'planned' as const };
    const paid = paidAmount(deal.payments);

    const push = (kind: ClientReminderKind, dueAt: string, title: string, text: string) => {
      const id = `${deal.id}:${kind}:${dueAt}`;
      if (!dueAt) return;
      const sentAt = sent[id];
      if (sentAt && !options.includeSent) return;
      out.push({
        id,
        dealId: deal.id,
        dealTitle: deal.title,
        clientId: client?.id ?? '',
        clientName: client?.name ?? 'Без клиента',
        clientPhone: client?.phones?.[0] || schedule.phone,
        kind,
        dueAt,
        title,
        text,
        urgency: urgencyOf(dueAt, today),
        sentAt,
      });
    };

    // Замер: напоминаем за день.
    if (schedule.measureAt) {
      const due = addDays(schedule.measureAt, -1);
      if (due <= horizon) {
        push('measure', due, 'Замер завтра',
          `${hello} напоминаем: завтра, ${fmtDate(schedule.measureAt)}, у вас запланирован замер`
          + `${schedule.timeStart ? ` на ${schedule.timeStart}` : ''}. Адрес: ${schedule.address || 'уточним в сообщении'}.`
          + `\n${device}`);
      }
    }

    // Доставка: за день, с адресом и временем.
    if (schedule.deliveryAt) {
      const due = addDays(schedule.deliveryAt, -1);
      if (due <= horizon) {
        push('delivery', due, 'Доставка завтра',
          `${hello} завтра, ${fmtDate(schedule.deliveryAt)}, привезём заказ «${deal.title}»`
          + `${schedule.timeStart ? ` к ${schedule.timeStart}` : ''}. Адрес: ${schedule.address || 'уточним в сообщении'}.`
          + ` Нужно освободить проход и место для сборки.\n${device}`);
      }
    }

    // Монтаж: за день, с бригадой и временем.
    if (schedule.installAt) {
      const due = addDays(schedule.installAt, -1);
      if (due <= horizon) {
        const hours = schedule.timeStart
          ? `${schedule.timeStart}${schedule.timeEnd ? `–${schedule.timeEnd}` : ''}`
          : 'по согласованию';
        push('install', due, 'Монтаж завтра',
          `${hello} подтверждаем монтаж ${fmtDate(schedule.installAt)}, ${hours}.`
          + ` Адрес: ${schedule.address || 'уточним в сообщении'}.`
          + `${schedule.team ? ` Бригада: ${schedule.team}.` : ''}`
          + ` Если время неудобно — напишите, перенесём.\n${device}`);

        // Через день после монтажа — просьба о отзыве.
        const after = addDays(schedule.installAt, 1);
        if (after <= horizon) {
          push('review', after, 'Спросить про результат',
            `${hello} вчера закончили монтаж по заказу «${deal.title}». Всё устраивает?`
            + ` Если что-то нужно поправить — напишите, приедем. Будем благодарны за отзыв.\n${device}`);
        }
      }
    }

    // Остаток к оплате: за 3 дня до плановой даты и после просрочки.
    const total = deal.items?.length
      ? deal.items.reduce((sum, item) => sum + item.qty * item.price, 0)
      : deal.amount;
    const remainder = Math.max(0, Math.round(total) - paid);
    if (remainder > 0) {
      const planned = (deal.plan ?? [])
        .filter((entry) => !entry.paidId && entry.amount > 0)
        .sort((left, right) => left.at.localeCompare(right.at))[0];
      const dueAt = planned ? addDays(planned.at, -3) : '';
      if (dueAt && dueAt <= horizon) {
        push('payment', dueAt, 'Остаток к оплате',
          `${hello} по заказу «${deal.title}» остаток к оплате — ${fmtMoney(remainder)}`
          + `${planned ? ` (план: ${fmtDate(planned.at)})` : ''}.`
          + ` Как удобнее внести?\n${device}`);
      }
    }
  }

  return out.sort((left, right) => left.dueAt.localeCompare(right.dueAt));
}

/** Ближайшая обещанная дата для подписи «когда клиенту писать». */
export function nextPromised(deal: Deal): string {
  return promisedDate(deal);
}
