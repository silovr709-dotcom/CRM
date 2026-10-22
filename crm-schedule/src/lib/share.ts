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
