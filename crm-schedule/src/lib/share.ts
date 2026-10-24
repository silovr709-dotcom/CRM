// Ссылка на сделку: данные кодируются прямо в адрес, поэтому её можно
// отправить коллеге в мессенджере — сервер не нужен.
import type { Client, Deal } from '../types';

interface SharedPayload {
  kind: 'crm-schedule-deal';
  v: 1;
  deal: Deal;
  client?: Client;
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): string {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeShare(deal: Deal, client?: Client): string {
  // Историю не отправляем: она длинная, а коллеге нужны даты, задачи и деньги.
  const payload: SharedPayload = {
    kind: 'crm-schedule-deal',
    v: 1,
    deal: { ...deal, history: [] },
    client,
  };
  return toBase64Url(JSON.stringify(payload));
}

export function decodeShare(value: string): SharedPayload | null {
  try {
    const parsed = JSON.parse(fromBase64Url(value)) as SharedPayload;
    if (parsed?.kind !== 'crm-schedule-deal' || !parsed.deal) return null;
    return parsed;
  } catch {
    return null;
  }
}

/* --------------------------- страница для клиента --------------------------- */

/**
 * Короткая страница статуса для клиента. Отдаём только то, что ему полезно:
 * этап, даты, деньги и телефон менеджера. Ни задач, ни затрат, ни заметок.
 */
export interface SharedStatus {
  kind: 'crm-schedule-status';
  v: 1;
  order: {
    title: string;
    company: string;
    client: string;
    stage: string;
    manager: string;
    /** Телефон менеджера или клиента — чтобы клиент мог позвонить. */
    phone: string;
    address: string;
    measureAt: string;
    readyAt: string;
    deliveryAt: string;
    installAt: string;
    timeStart: string;
    total: number;
    paid: number;
    remainder: number;
    updatedAt: string;
  };
}

export function encodeStatus(
  deal: Deal,
  client: Client | undefined,
  settings: { companyName: string; myName: string },
  totals: { total: number; paid: number; remainder: number },
): string {
  const schedule = deal.schedule ?? { status: 'planned' as const };
  const payload: SharedStatus = {
    kind: 'crm-schedule-status',
    v: 1,
    order: {
      title: deal.title || 'Заказ',
      company: settings.companyName || 'Мастерская',
      client: client?.name ?? '',
      stage: deal.status,
      manager: deal.manager || settings.myName || '',
      phone: client?.phones[0] || schedule.phone || '',
      address: schedule.address || client?.address || '',
      measureAt: schedule.measureAt ?? '',
      readyAt: schedule.readyAt ?? '',
      deliveryAt: schedule.deliveryAt ?? '',
      installAt: schedule.installAt ?? '',
      timeStart: schedule.timeStart ?? '',
      total: totals.total,
      paid: totals.paid,
      remainder: totals.remainder,
      updatedAt: deal.updatedAt,
    },
  };
  return toBase64Url(JSON.stringify(payload));
}

export function decodeStatus(value: string): SharedStatus | null {
  try {
    const parsed = JSON.parse(fromBase64Url(value)) as SharedStatus;
    if (parsed?.kind !== 'crm-schedule-status' || !parsed.order) return null;
    return parsed;
  } catch {
    return null;
  }
}
