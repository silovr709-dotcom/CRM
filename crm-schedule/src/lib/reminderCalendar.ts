// Напоминания → календарь телефона (.ics с будильниками VALARM).
// Это самый надёжный офлайн-канал: файл один раз импортируется в календарь
// телефона, и дальше телефон напоминает сам — без интернета, без открытого
// приложения и без нашего сервера. Обратная сторона: после импорта правки
// в CRM в календарь не подтянутся, файл нужно скачивать заново.
import type { PlannedReminder } from './reminders';
import { downloadFile } from './storage';

function icsEscape(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** ISO → базовый UTC-формат ICS: 20261030T070000Z. */
function icsUtc(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

/**
 * Собирает календарь из планов напоминаний. У каждого события будильник
 * стоит абсолютным временем (notifyAt), а не «за N минут»: время показа
 * уже посчитано движком с тихими часами и откладываниями.
 */
export function buildRemindersIcs(planned: PlannedReminder[], company = ''): string {
  const stamp = icsUtc(new Date().toISOString());
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CRM + График монтажей//Напоминания//RU',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${icsEscape(company ? `Напоминания — ${company}` : 'Напоминания CRM')}`,
  ];

  const sorted = [...planned].sort(
    (left, right) => new Date(left.notifyAt).getTime() - new Date(right.notifyAt).getTime(),
  );
  for (const reminder of sorted) {
    const start = icsUtc(reminder.momentAt);
    const alarm = icsUtc(reminder.notifyAt);
    if (!start || !alarm) continue;
    const end = icsUtc(new Date(new Date(reminder.momentAt).getTime() + 30 * 60000).toISOString());
    const description = [reminder.detail, reminder.ruleLabel].filter(Boolean).join('\n');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${reminder.id}@crm-schedule`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${start}`,
      `DTEND:${end}`,
      `SUMMARY:${icsEscape(reminder.title)}`,
      description ? `DESCRIPTION:${icsEscape(description)}` : '',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `TRIGGER;VALUE=DATE-TIME:${alarm}`,
      `DESCRIPTION:${icsEscape(reminder.title)}`,
      'END:VALARM',
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');
  return lines.filter(Boolean).join('\r\n');
}

/** Скачивает файл календаря с напоминаниями на 90 дней вперёд. */
export function downloadRemindersIcs(planned: PlannedReminder[], company = ''): number {
  const content = buildRemindersIcs(planned, company);
  const count = (content.match(/BEGIN:VEVENT/g) ?? []).length;
  downloadFile('напоминания-crm.ics', content, 'text/calendar;charset=utf-8');
  return count;
}
