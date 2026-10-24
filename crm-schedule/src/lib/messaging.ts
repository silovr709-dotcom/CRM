// Ссылки на мессенджеры: WhatsApp, Telegram, SMS.
// Всё через обычные ссылки — без серверов, токенов и API.

export function digitsOnly(value?: string): string {
  return (value ?? '').replace(/[^\d]/g, '');
}

/** WhatsApp: телефон в международном формате, текст уже подставлен. */
export function whatsappLink(phone: string | undefined, text: string): string {
  const digits = digitsOnly(phone);
  const base = digits ? `https://wa.me/${digits}` : 'https://wa.me/';
  return `${base}?text=${encodeURIComponent(text)}`;
}

/** Telegram: выбираем получателя в приложении, текст уже готов. */
export function telegramLink(text: string, url?: string): string {
  const params = new URLSearchParams();
  if (url) params.set('url', url);
  params.set('text', text);
  return `https://t.me/share/url?${params.toString()}`;
}

/** SMS: открывает приложение сообщений с текстом. */
export function smsLink(phone: string | undefined, text: string): string {
  const digits = (phone ?? '').replace(/[^\d+]/g, '');
  return `sms:${digits}?body=${encodeURIComponent(text)}`;
}

/** Ссылка для звонка. */
export function telLink(phone: string | undefined): string {
  return `tel:${(phone ?? '').replace(/[^\d+]/g, '')}`;
}
