// Напоминания клиенту в карточке заказа: готовый текст и кнопки мессенджеров.
import { useMemo } from 'react';
import { Check, Copy, MessageCircle, Send } from 'lucide-react';
import { useApp } from '../store';
import type { Deal } from '../types';
import { CLIENT_REMINDER_META, clientReminders } from '../lib/clientReminders';
import { smsLink, telegramLink, whatsappLink } from '../lib/messaging';
import { fmtDate, fmtDateTime } from '../lib/dates';
import { absoluteLink } from '../lib/router';

const URGENCY_LABEL: Record<string, string> = {
  overdue: 'просрочено',
  today: 'сегодня',
  soon: 'скоро',
  later: 'позже',
};

export default function ClientReminders({ deal }: { deal: Deal }) {
  const { clients, settings, notify, markClientReminder } = useApp();
  const client = clients.find((item) => item.id === deal.clientId);

  const reminders = useMemo(
    () => clientReminders([deal], clients, settings, { includeSent: true, horizonDays: 60 }),
    [deal, clients, settings],
  );

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notify('Текст сообщения скопирован');
    } catch {
      notify('Не удалось скопировать — выделите текст вручную', 'error');
    }
  };

  const sent = (id: string, channel: string) => {
    markClientReminder(deal.id, id, channel);
    notify('Отмечено: клиенту написали');
  };

  return (
    <section className="client-reminders">
      <div className="section-head tight">
        <div>
          <h3><MessageCircle size={15} /> Клиенту</h3>
          <span className="muted small">
            готовые сообщения к датам заказа — остаётся отправить
          </span>
        </div>
      </div>

      {reminders.length === 0 ? (
        <p className="inline-note">
          Пока напоминать не о чем: заполните даты замера, доставки или монтажа — сообщения
          появятся здесь сами.
        </p>
      ) : (
        <ul className="reminder-list">
          {reminders.map((reminder) => (
            <li key={reminder.id} className={`reminder-row${reminder.sentAt ? ' sent' : ''}`}>
              <div className="reminder-top">
                <span className="reminder-icon" aria-hidden="true">
                  {CLIENT_REMINDER_META[reminder.kind].icon}
                </span>
                <b>{reminder.title}</b>
                <span className={`reminder-when ${reminder.urgency}`}>
                  {fmtDate(reminder.dueAt)}
                  {reminder.sentAt ? ` · отправлено ${fmtDate(reminder.sentAt.slice(0, 10))}` : ''}
                </span>
              </div>
              <p className="reminder-text">{reminder.text}</p>
              <div className="reminder-actions">
                <a
                  className="btn small primary"
                  href={whatsappLink(reminder.clientPhone, reminder.text)}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => sent(reminder.id, 'WhatsApp')}
                >
                  <MessageCircle size={14} /> WhatsApp
                </a>
                <a
                  className="btn small ghost"
                  href={telegramLink(reminder.text, absoluteLink({ view: 'crm', dealId: deal.id }))}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => sent(reminder.id, 'Telegram')}
                >
                  <Send size={14} /> Telegram
                </a>
                <a
                  className="btn small ghost"
                  href={smsLink(reminder.clientPhone, reminder.text)}
                  onClick={() => sent(reminder.id, 'SMS')}
                >
                  SMS
                </a>
                <button type="button" className="icon-btn small" title="Скопировать текст" onClick={() => void copy(reminder.text)}>
                  <Copy size={13} />
                </button>
                {reminder.sentAt ? (
                  <span className="reminder-sent"><Check size={13} /> отправлено</span>
                ) : (
                  <span className="reminder-urgency muted small">{URGENCY_LABEL[reminder.urgency]}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {client && (
        <p className="inline-note">
          Телефон в сообщениях — из карточки клиента. Последнее напоминание клиенту:{' '}
          {reminders.filter((item) => item.sentAt).length
            ? fmtDateTime(
              reminders
                .map((item) => item.sentAt)
                .filter(Boolean)
                .sort()
                .at(-1) as string,
            )
            : 'ещё не отправляли'}
          .
        </p>
      )}
    </section>
  );
}
