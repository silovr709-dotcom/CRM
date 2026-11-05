// Быстрый договор: создание сделки с датами и суммой прямо из карточки клиента.
// Для архивных данных: не нужно проходить весь мастер сделки.
import { useState } from 'react';
import type { DealStatus } from '../types';
import { useApp } from '../store';
import { statusMeta } from '../lib/crm';
import Modal from './Modal';

export default function QuickContractModal({ clientId, onClose, onCreated }: {
  clientId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { addDeal, patchDeal, issueDocument, notify } = useApp();
  const [draft, setDraft] = useState({
    title: '',
    amount: '',
    status: 'delivered' as DealStatus,
    contractDate: '',
    measureAt: '',
    readyAt: '',
    deliveryAt: '',
    installAt: '',
    issueContract: true,
  });

  const create = () => {
    const title = draft.title.trim() || 'Договор';
    const id = addDeal({
      title,
      clientId,
      amount: Number(draft.amount.replace(/\s/g, '').replace(',', '.')) || 0,
      status: draft.status,
    });
    // Даты в расписание сделки.
    patchDeal(id, {
      schedule: {
        status: 'done',
        measureAt: draft.measureAt || undefined,
        readyAt: draft.readyAt || undefined,
        deliveryAt: draft.deliveryAt || undefined,
        installAt: draft.installAt || undefined,
      },
    });
    // Договор с указанной датой.
    if (draft.issueContract) {
      issueDocument(id, 'contract', draft.contractDate || undefined);
    }
    notify('Договор добавлен');
    onCreated();
  };

  return (
    <Modal title="Быстрый договор" subtitle="Сумма, даты и договор — в одной форме. Сделка создастся автоматически." onClose={onClose} size="md">
      <div className="form-grid">
        <label className="field span-2">Название
          <input data-autofocus value={draft.title} placeholder="Кухня на Ленина, 42" onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
        </label>
        <label className="field">Сумма, ₽
          <input inputMode="numeric" value={draft.amount} placeholder="0" onChange={(e) => setDraft({ ...draft, amount: e.target.value })} />
        </label>
        <label className="field">Этап
          <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as DealStatus })}>
            {(['draft', 'approved', 'inProduction', 'ready', 'delivered'] as DealStatus[]).map((st) => (
              <option key={st} value={st}>{statusMeta(st).label}</option>
            ))}
          </select>
        </label>
        <label className="field">Дата договора
          <input type="date" value={draft.contractDate} onChange={(e) => setDraft({ ...draft, contractDate: e.target.value })} />
        </label>
        <label className="field">Замер
          <input type="date" value={draft.measureAt} onChange={(e) => setDraft({ ...draft, measureAt: e.target.value })} />
        </label>
        <label className="field">Готовность
          <input type="date" value={draft.readyAt} onChange={(e) => setDraft({ ...draft, readyAt: e.target.value })} />
        </label>
        <label className="field">Доставка
          <input type="date" value={draft.deliveryAt} onChange={(e) => setDraft({ ...draft, deliveryAt: e.target.value })} />
        </label>
        <label className="field">Монтаж
          <input type="date" value={draft.installAt} onChange={(e) => setDraft({ ...draft, installAt: e.target.value })} />
        </label>
        <label className="field span-2 chip-toggle">
          <input type="checkbox" checked={draft.issueContract} onChange={(e) => setDraft({ ...draft, issueContract: e.target.checked })} />
          выдать договор с номером
        </label>
      </div>
      <div className="modal-footer" style={{ marginTop: 12 }}>
        <button type="button" className="btn ghost" onClick={onClose}>Отмена</button>
        <span className="foot-spacer" />
        <button type="button" className="btn primary" onClick={create}>Добавить</button>
      </div>
    </Modal>
  );
}
