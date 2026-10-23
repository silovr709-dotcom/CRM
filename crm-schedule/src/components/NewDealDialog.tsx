// Новая сделка: клиент, название, сумма, этап и ответственный.
import { useState } from 'react';
import type { DealStatus } from '../types';
import { useApp } from '../store';
import { statusMeta } from '../lib/crm';
import Modal from './Modal';

export default function NewDealDialog({ onClose, onCreated, onNewClient }: {
  onClose: () => void;
  onCreated: (id: string) => void;
  onNewClient: () => void;
}) {
  const { clients, addDeal, patchDeal, settings, notify } = useApp();
  const [draft, setDraft] = useState({
    title: '',
    clientId: '',
    amount: '',
    status: 'draft' as DealStatus,
    manager: settings.myName || '',
    nextContactAt: '',
  });

  const managers = settings.managers.length > 0
    ? settings.managers
    : Array.from(new Set([settings.myName, ...clients.map(() => '')].filter(Boolean) as string[]));

  const create = () => {
    const title = draft.title.trim();
    if (!title) { notify('Укажите название заказа', 'error'); return; }
    if (!draft.clientId) { notify('Выберите клиента — без него сделка потеряется', 'error'); return; }
    const id = addDeal({
      title,
      clientId: draft.clientId,
      amount: Number(draft.amount.replace(/\s/g, '').replace(',', '.')) || 0,
      status: draft.status,
      manager: draft.manager || undefined,
    });
    // Следующий контакт задаём сразу: сделка не должна «повиснуть».
    if (draft.nextContactAt) patchDeal(id, { nextContactAt: draft.nextContactAt });
    notify('Сделка создана');
    onCreated(id);
  };

  return (
    <Modal
      title="Новая сделка"
      subtitle="Заказ привязывается к клиенту. Даты монтажа заполним в карточке."
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn ghost" onClick={onClose}>Отмена</button>
          <span className="foot-spacer" />
          <button type="button" className="btn primary" onClick={create}>Создать сделку</button>
        </>
      )}
    >
      <div className="form-grid">
        <label className="field span-2">Название заказа
          <input
            data-autofocus
            value={draft.title}
            placeholder="Кухня на Ленина, 42"
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            onKeyDown={(event) => { if (event.key === 'Enter') create(); }}
          />
        </label>
        <label className="field span-2">Клиент
          <select value={draft.clientId} onChange={(event) => setDraft({ ...draft, clientId: event.target.value })}>
            <option value="">— выберите клиента —</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}{client.phones[0] ? ` · ${client.phones[0]}` : ''}
              </option>
            ))}
          </select>
        </label>
        {clients.length === 0 && (
          <p className="form-note span-2">
            Клиентов пока нет.{' '}
            <button type="button" className="link-btn" onClick={onNewClient}>Добавить первого клиента →</button>
          </p>
        )}
        <label className="field">Сумма, ₽
          <input
            inputMode="numeric"
            value={draft.amount}
            placeholder="0"
            onChange={(event) => setDraft({ ...draft, amount: event.target.value })}
          />
          <small className="field-hint">можно оставить пустым и заполнить позже</small>
        </label>
        <label className="field">Этап
          <select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as DealStatus })}>
            {(['draft', 'calculating', 'offerSent', 'clientThinking', 'approved'] as DealStatus[]).map((status) => (
              <option key={status} value={status}>{statusMeta(status).label}</option>
            ))}
          </select>
        </label>
        <label className="field">Ответственный
          <input
            list="deal-managers"
            value={draft.manager}
            placeholder="кто ведёт сделку"
            onChange={(event) => setDraft({ ...draft, manager: event.target.value })}
          />
          <datalist id="deal-managers">
            {managers.map((name) => <option key={name} value={name} />)}
          </datalist>
        </label>
        <label className="field">Когда связаться
          <input type="date" value={draft.nextContactAt} onChange={(event) => setDraft({ ...draft, nextContactAt: event.target.value })} />
        </label>
      </div>
    </Modal>
  );
}
