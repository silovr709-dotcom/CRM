/* Склад: что пришло с фабрики, когда и в каком количестве.
 * Главный сценарий — «пришёл ли заказ 91_53d4»: поиск по номеру в одну строку. */

import { useMemo, useState } from 'react';
import {
  ArrowRight, Boxes, CalendarDays, FileText, PackageCheck, Plus, Search, Trash2, Truck, Upload, X,
} from 'lucide-react';
import type { WarehouseReceipt } from '../types';
import { useApp } from '../store';
import { fmtDate, todayISO } from '../lib/dates';
import {
  isOnStock, itemsLine, receiptMatches, receivedLabel, summarizeWarehouse,
} from '../lib/warehouse';
import { downloadFile } from '../lib/storage';
import { getFile } from '../lib/attachments';
import EmptyState from './EmptyState';
import ReceiptDialog from './ReceiptDialog';
import ManifestImportDialog from './ManifestImportDialog';

type Filter = 'all' | 'stock' | 'issued' | 'unlinked';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'stock', label: 'На складе' },
  { id: 'issued', label: 'Выдано' },
  { id: 'unlinked', label: 'Без сделки' },
];

export default function WarehouseView({ onOpenDeal }: { onOpenDeal: (id: string) => void }) {
  const { receipts, deals, removeReceipt, notify } = useApp();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [editing, setEditing] = useState<WarehouseReceipt | null>(null);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const today = todayISO();

  const summary = useMemo(() => summarizeWarehouse(receipts, today), [receipts, today]);
  const dealById = useMemo(() => new Map(deals.map((deal) => [deal.id, deal])), [deals]);

  const visible = useMemo(() => {
    const list = receipts
      .filter((receipt) => {
        if (filter === 'stock') return isOnStock(receipt);
        if (filter === 'issued') return !isOnStock(receipt);
        if (filter === 'unlinked') return !receipt.dealId;
        return true;
      })
      .filter((receipt) => receiptMatches(receipt, query, dealById.get(receipt.dealId ?? '')))
      .sort((left, right) => right.receivedAt.localeCompare(left.receivedAt)
        || right.createdAt.localeCompare(left.createdAt));
    return list;
  }, [receipts, filter, query, dealById]);

  const openFile = async (receipt: WarehouseReceipt) => {
    if (!receipt.file) return;
    const blob = await getFile(receipt.file.id);
    if (!blob) {
      notify('Ведомость добавлена на другом устройстве — откройте её там', 'info');
      return;
    }
    downloadFile(receipt.file.name, blob, receipt.file.mime);
  };

  return (
    <div className="page warehouse">
      <header className="page-head">
        <div>
          <div className="eyebrow">Склад</div>
          <h1>Поступления с фабрики</h1>
          <p className="muted">
            Введите номер заказа из ведомости — увидите, когда привезли, сколько упаковок и что внутри.
          </p>
        </div>
        <div className="actions wrap">
          <button type="button" className="btn primary" onClick={() => setImporting(true)}>
            <Upload size={16} /> Ведомость PDF
          </button>
          <button type="button" className="btn ghost" onClick={() => setCreating(true)}>
            <Plus size={16} /> Приход
          </button>
        </div>
      </header>

      <section className="warehouse-search">
        <Search size={18} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Номер заказа, водитель, позиция: 91_53d4, фурнитура…"
          aria-label="Поиск по складу"
          autoFocus
        />
        {query && (
          <button type="button" className="icon-btn" aria-label="Очистить поиск" onClick={() => setQuery('')}>
            <X size={15} />
          </button>
        )}
      </section>

      <section className="warehouse-stats">
        <div className="stat">
          <span className="stat-icon"><Boxes size={16} /></span>
          <b>{summary.packagesOnStock}</b>
          <small>упаковок на складе</small>
        </div>
        <div className="stat">
          <span className="stat-icon"><PackageCheck size={16} /></span>
          <b>{summary.onStock}</b>
          <small>заказов ждут выдачи</small>
        </div>
        <div className="stat">
          <span className="stat-icon"><Truck size={16} /></span>
          <b>{summary.lastMonth}</b>
          <small>приходов за 30 дней</small>
        </div>
        <div className="stat">
          <span className="stat-icon"><CalendarDays size={16} /></span>
          <b>{summary.lastReceivedAt ? fmtDate(summary.lastReceivedAt) : '—'}</b>
          <small>последний приход</small>
        </div>
      </section>

      <div className="warehouse-controls">
        <div className="segmented" role="tablist" aria-label="Что показывать на складе">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={filter === item.id}
              className={filter === item.id ? 'active' : ''}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
              {item.id === 'unlinked' && summary.withoutDeal > 0 ? ` · ${summary.withoutDeal}` : ''}
            </button>
          ))}
        </div>
        <span className="muted small">
          {query ? `Найдено: ${visible.length}` : `Всего поступлений: ${receipts.length}`}
        </span>
      </div>

      {visible.length === 0 ? (
        <section className="card">
          <EmptyState
            icon={<Boxes size={22} />}
            title={query ? 'Ничего не нашлось' : receipts.length === 0 ? 'Склад пока пуст' : 'Под фильтр ничего не попал'}
            hint={query
              ? 'Проверьте номер заказа — он есть в ведомости, например 91_53d4.'
              : 'Когда водитель привезёт мебель, нажмите «Приход»: номер заказа, количество упаковок и файл ведомости.'}
            action={<button type="button" className="btn small primary" onClick={() => setImporting(true)}>Загрузить ведомость</button>}
          />
        </section>
      ) : (
        <ul className="receipt-list">
          {visible.map((receipt) => {
            const deal = dealById.get(receipt.dealId ?? '');
            const stock = isOnStock(receipt);
            return (
              <li key={receipt.id} className={`receipt-card${stock ? '' : ' issued'}`}>
                <button type="button" className="receipt-main" onClick={() => setEditing(receipt)}>
                  <span className="receipt-top">
                    <b className="receipt-order">{receipt.orderNo || 'без номера'}</b>
                    <span className={`badge ${stock ? 'badge-green' : 'badge-ghost'}`}>
                      {stock ? 'на складе' : 'выдано'}
                    </span>
                    {!receipt.dealId && <span className="badge badge-amber">без сделки</span>}
                    {receipt.file && <span className="receipt-file-chip"><FileText size={12} /> ведомость</span>}
                  </span>
                  <span className="receipt-deal">{deal ? deal.title : 'сделка не привязана'}</span>
                  <span className="receipt-meta">
                    <span>{receivedLabel(receipt, today)}</span>
                    <span><b>{receipt.packages}</b> уп.</span>
                    {receipt.shippedAt && <span>отгружено {fmtDate(receipt.shippedAt)}</span>}
                    {receipt.driver && <span>{receipt.driver}</span>}
                  </span>
                  <span className="receipt-items">{itemsLine(receipt.items)}</span>
                  {receipt.note && <span className="receipt-note">{receipt.note}</span>}
                </button>
                <span className="receipt-actions">
                  {receipt.file && (
                    <button
                      type="button"
                      className="icon-btn"
                      title="Скачать ведомость"
                      aria-label={`Скачать ведомость ${receipt.orderNo}`}
                      onClick={() => void openFile(receipt)}
                    >
                      <FileText size={15} />
                    </button>
                  )}
                  {deal && (
                    <button
                      type="button"
                      className="icon-btn"
                      title="Открыть сделку"
                      aria-label={`Открыть сделку ${deal.title}`}
                      onClick={() => onOpenDeal(deal.id)}
                    >
                      <ArrowRight size={15} />
                    </button>
                  )}
                  <button
                    type="button"
                    className="icon-btn"
                    title="Удалить поступление"
                    aria-label={`Удалить поступление ${receipt.orderNo}`}
                    onClick={() => {
                      if (confirm(`Удалить приход ${receipt.orderNo || 'без номера'}?`)) removeReceipt(receipt.id);
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {importing && <ManifestImportDialog onClose={() => setImporting(false)} />}
      {creating && <ReceiptDialog onClose={() => setCreating(false)} />}
      {editing && <ReceiptDialog receipt={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
