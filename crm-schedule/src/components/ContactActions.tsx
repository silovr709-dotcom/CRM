/* Быстрые касания клиента: «Позвонил», «Не взял», «Написал» — одним кликом,
 * с журналом и автором. Плюс форма «другое касание» для заметок и встреч. */

import { useState } from 'react';
import { Check, MessageSquare, Phone, PhoneMissed } from 'lucide-react';
import { useApp } from '../store';
import type { ContactChannel, ContactOutcome, Deal } from '../types';
import {
  CHANNEL_META, CONTACT_CHANNELS, OUTCOME_META, contactLine, contactSummary, nextContactAfter,
  sinceLabel,
} from '../lib/contacts';
import { fmtDate, todayISO } from '../lib/dates';
import Modal from './Modal';

type QuickOutcome = 'reached' | 'noAnswer' | 'messaged';

const QUICK: { outcome: QuickOutcome; channel: ContactChannel; label: string; icon: typeof Phone; title: string }[] = [
  { outcome: 'reached', channel: 'call', label: 'Позвонил', icon: Check, title: 'Клиент ответил — следующий контакт через 2 дня' },
  { outcome: 'noAnswer', channel: 'call', label: 'Не взял', icon: PhoneMissed, title: 'Не ответил — вернуться завтра' },
  { outcome: 'messaged', channel: 'whatsapp', label: 'Написал', icon: MessageSquare, title: 'Сообщение отправлено — вернуться через 3 дня' },
];

export function ContactActions({ deal, compact = false }: { deal: Deal; compact?: boolean }) {
  const { logContact, notify } = useApp();
  const [open, setOpen] = useState(false);

  const runQuick = (item: typeof QUICK[number]) => {
    logContact(deal.id, { channel: item.channel, outcome: item.outcome });
    const next = nextContactAfter(item.outcome, todayISO());
    notify(
      next ? `Записано: ${item.label.toLowerCase()} · следующий контакт ${fmtDate(next)}` : `Записано: ${item.label.toLowerCase()}`,
      'ok',
    );
  };

  return (
    <div className={`touch-actions${compact ? ' compact' : ''}`}>
      {QUICK.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.outcome}
            type="button"
            className={`touch-btn${item.outcome === 'reached' ? ' primary' : ''}`}
            title={item.title}
            aria-label={`${item.label}: ${deal.title}`}
            onClick={() => runQuick(item)}
          >
            <Icon size={14} /> {item.label}
          </button>
        );
      })}
      <button
        type="button"
        className="touch-btn ghost"
        aria-label={`Другое касание: ${deal.title}`}
        onClick={() => setOpen(true)}
      >
        <Phone size={14} /> Другое
      </button>
      {open && <ContactDialog deal={deal} onClose={() => setOpen(false)} />}
    </div>
  );
}

/** Строка «связь была вчера · звонок · поговорили» под именем клиента. */
export function ContactLine({ deal }: { deal: Deal }) {
  const summary = contactSummary(deal.contacts, todayISO());
  return (
    <span className={`touch-line${summary.daysSince !== undefined && summary.daysSince >= 10 ? ' quiet' : ''}`}>
      {summary.last ? `${sinceLabel(summary.daysSince)} · ${contactLine(summary.last)}` : 'Связи ещё не было'}
    </span>
  );
}

/** Полный журнал касаний: последние сверху, с автором и заметкой. */
export function ContactLog({ deal, limit = 8 }: { deal: Deal; limit?: number }) {
  const list = [...(deal.contacts ?? [])].sort((left, right) => right.at.localeCompare(left.at)).slice(0, limit);
  if (list.length === 0) {
    return (
      <p className="inline-note">
        Журнал пуст. Нажмите «Позвонил» или «Написал» — запись появится здесь и в истории сделки,
        а следующий контакт назначится сам.
      </p>
    );
  }
  return (
    <ul className="touch-log">
      {list.map((entry) => (
        <li key={entry.id}>
          <span className={`touch-dot outcome-${entry.outcome}`} aria-hidden>{OUTCOME_META[entry.outcome].icon}</span>
          <div className="touch-log-main">
            <b>{OUTCOME_META[entry.outcome].label}</b>
            <span className="muted small">
              {CHANNEL_META[entry.channel].label} · {fmtDateTimeShort(entry.at)}
              {entry.author ? ` · ${entry.author}` : ''}
            </span>
            {entry.note && <span className="touch-note">{entry.note}</span>}
            {entry.nextAt && <span className="muted small">следующий контакт {fmtDate(entry.nextAt)}</span>}
          </div>
        </li>
      ))}
    </ul>
  );
}

function fmtDateTimeShort(iso: string): string {
  const [day, time] = iso.split('T');
  return `${fmtDate(day)}${time ? `, ${time.slice(0, 5)}` : ''}`;
}

function ContactDialog({ deal, onClose }: { deal: Deal; onClose: () => void }) {
  const { logContact, notify } = useApp();
  const [channel, setChannel] = useState<ContactChannel>('call');
  const [outcome, setOutcome] = useState<ContactOutcome>('reached');
  const [note, setNote] = useState('');
  const [nextAt, setNextAt] = useState(nextContactAfter('reached', todayISO()) ?? '');

  const save = () => {
    logContact(deal.id, { channel, outcome, note, nextAt });
    notify(nextAt ? `Записано · следующий контакт ${fmtDate(nextAt)}` : 'Касание записано', 'ok');
    onClose();
  };

  return (
    <Modal
      title="Касание клиента"
      subtitle={deal.title}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn ghost" onClick={onClose}>Отмена</button>
          <button type="button" className="btn primary" onClick={save}>Записать</button>
        </>
      )}
    >
      <div className="form-grid">
          <label>
            <span>Как связались</span>
            <select value={channel} onChange={(event) => setChannel(event.target.value as ContactChannel)}>
              {CONTACT_CHANNELS.map((item) => (
                <option key={item} value={item}>{CHANNEL_META[item].label}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Что вышло</span>
            <select
              value={outcome}
              onChange={(event) => {
                const next = event.target.value as ContactOutcome;
                setOutcome(next);
                setNextAt(nextContactAfter(next, todayISO()) ?? '');
              }}
            >
              {Object.values(OUTCOME_META).map((item) => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
            </select>
            <small className="field-hint">{OUTCOME_META[outcome].hint}</small>
          </label>
          <label className="wide">
            <span>Заметка</span>
            <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="О чём договорились" />
          </label>
          <label>
            <span>Следующий контакт</span>
            <input type="date" value={nextAt} onChange={(event) => setNextAt(event.target.value)} />
            <small className="field-hint">Пусто — срок не ставить.</small>
          </label>
        </div>
    </Modal>
  );
}
