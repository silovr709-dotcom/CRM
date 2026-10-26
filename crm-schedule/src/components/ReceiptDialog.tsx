/* Карточка поступления: одна ведомость — один заказ.
 * Слева — файл ведомости (PDF или фото), справа — что и сколько привезли. */

import { useMemo, useRef, useState } from 'react';
import { FileText, Paperclip, Plus, Trash2, Upload } from 'lucide-react';
import type { WarehouseItem, WarehouseReceipt } from '../types';
import { useApp } from '../store';
import { fmtDate, fmtDateTime, todayISO } from '../lib/dates';
import { fmtBytes, getFile } from '../lib/attachments';
import { downloadFile } from '../lib/storage';
import { canExtractPdfText, extractPdfText } from '../lib/pdfText';
import {
  cleanOrderNo, dealOptions, findDealByOrderNo, itemsMismatch, looksLikeOrderNo,
  packagesFromItems, parseManifestText, receiptProblem, receivedLabel, SHIPMENT_ROWS,
} from '../lib/warehouse';
import Modal from './Modal';

interface Draft {
  orderNo: string;
  receivedAt: string;
  shippedAt: string;
  packages: string;
  items: WarehouseItem[];
  driver: string;
  shippedBy: string;
  note: string;
  dealId: string;
}

function draftFrom(receipt?: WarehouseReceipt): Draft {
  return {
    orderNo: receipt?.orderNo ?? '',
    receivedAt: receipt?.receivedAt ?? todayISO(),
    shippedAt: receipt?.shippedAt ?? '',
    packages: receipt ? String(receipt.packages) : '',
    items: receipt?.items?.length ? receipt.items.map((item) => ({ ...item })) : [],
    driver: receipt?.driver ?? '',
    shippedBy: receipt?.shippedBy ?? '',
    note: receipt?.note ?? '',
    dealId: receipt?.dealId ?? '',
  };
}

export default function ReceiptDialog({ receipt, onClose, onSaved }: {
  receipt?: WarehouseReceipt;
  onClose: () => void;
  onSaved?: (id: string) => void;
}) {
  const { deals, addReceipt, updateReceipt, attachReceiptFile, notify, receipts } = useApp();
  const openFile = async (id: string) => {
    const blob = await getFile(id);
    if (!blob) {
      notify('Этот файл добавлен на другом устройстве — откройте запись там или перенесите архивом', 'info');
      return;
    }
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener');
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
  const [draft, setDraft] = useState<Draft>(() => draftFrom(receipt));
  const [file, setFile] = useState<File | null>(null);
  const [parsedText, setParsedText] = useState(receipt?.text ?? '');
  const [parsing, setParsing] = useState(false);
  const [parseNote, setParseNote] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const patch = (value: Partial<Draft>) => setDraft((current) => ({ ...current, ...value }));
  const isNew = !receipt;
  const matchedDeal = useMemo(
    () => deals.find((deal) => deal.id === draft.dealId) ?? findDealByOrderNo(deals, draft.orderNo),
    [deals, draft.dealId, draft.orderNo],
  );
  const knownOrderNos = useMemo(() => {
    const values = new Set<string>();
    deals.forEach((deal) => { if (deal.orderNo) values.add(deal.orderNo); });
    receipts.forEach((item) => { if (item.orderNo) values.add(item.orderNo); });
    return [...values];
  }, [deals, receipts]);

  /** Разбор файла: текст из PDF заполняет номер, дату и позиции. */
  const readFile = async (picked: File) => {
    setFile(picked);
    setParseNote('');
    if (!canExtractPdfText(picked)) return;
    setParsing(true);
    const text = await extractPdfText(picked);
    setParsing(false);
    if (!text) {
      setParseNote('В этом PDF нет текстового слоя (скан или фото) — заполните номер и количество руками.');
      return;
    }
    setParsedText(text);
    const parsed = parseManifestText(text);
    setDraft((current) => ({
      ...current,
      orderNo: current.orderNo || parsed.orderNos[0] || '',
      shippedAt: current.shippedAt || parsed.shippedAt || '',
      packages: current.packages || (parsed.packages ? String(parsed.packages) : ''),
      items: current.items.length > 0 ? current.items : parsed.items,
      driver: current.driver || parsed.driver || '',
      shippedBy: current.shippedBy || parsed.shippedBy || '',
    }));
    const found = [
      parsed.orderNos.length ? `номер заказа: ${parsed.orderNos.slice(0, 3).join(', ')}` : 'номер заказа не нашёл',
      parsed.shippedAt ? `дата отгрузки: ${fmtDate(parsed.shippedAt)}` : '',
      parsed.packages ? `упаковок: ${parsed.packages}` : '',
    ].filter(Boolean).join(' · ');
    setParseNote(`${found}. Проверьте цифры перед сохранением.`);
  };

  const setItem = (index: number, patchItem: Partial<WarehouseItem>) => {
    patch({ items: draft.items.map((item, position) => (position === index ? { ...item, ...patchItem } : item)) });
  };

  const addRow = (name = '') => patch({ items: [...draft.items, { name, qty: 1 }] });

  const save = async () => {
    const input = {
      orderNo: draft.orderNo,
      receivedAt: draft.receivedAt,
      shippedAt: draft.shippedAt || undefined,
      packages: Number(draft.packages) || packagesFromItems(draft.items),
      items: draft.items.filter((item) => item.name.trim()),
      driver: draft.driver,
      shippedBy: draft.shippedBy,
      note: draft.note,
      dealId: draft.dealId || matchedDeal?.id,
      text: parsedText || undefined,
    };
    const problem = receiptProblem(input);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError('');
    if (isNew) {
      const failed = await addReceipt(input, file);
      setSaving(false);
      if (failed) {
        setError(failed);
        return;
      }
      notify(`Приход ${cleanOrderNo(draft.orderNo)} записан${file ? ' с ведомостью' : ''}`, 'ok');
      onClose();
      return;
    }
    updateReceipt(receipt.id, {
      ...input,
      items: input.items,
      file: receipt.file,
      updatedAt: new Date().toISOString(),
    });
    if (file) {
      const failed = await attachReceiptFile(receipt.id, file);
      if (failed) {
        setSaving(false);
        setError(failed);
        return;
      }
    }
    setSaving(false);
    notify('Поступление обновлено', 'ok');
    onSaved?.(receipt.id);
    onClose();
  };

  const issue = () => {
    if (!receipt) return;
    const to = window.prompt('Кому выдали со склада? (бригада или клиент)', receipt.issuedTo ?? '');
    if (to === null) return;
    updateReceipt(receipt.id, { issuedAt: todayISO(), issuedTo: to.trim() || undefined });
    notify('Отмечено: выдано со склада', 'ok');
    onClose();
  };

  const returnToStock = () => {
    if (!receipt) return;
    updateReceipt(receipt.id, { issuedAt: undefined, issuedTo: undefined });
    notify('Снова на складе', 'ok');
    onClose();
  };

  const mismatch = itemsMismatch({
    items: draft.items,
    packages: Number(draft.packages) || packagesFromItems(draft.items),
  });

  return (
    <Modal
      title={isNew ? 'Приход на склад' : `Заказ ${receipt.orderNo || 'без номера'}`}
      subtitle={isNew
        ? 'Введите номер заказа из ведомости — по нему потом ищут'
        : `${receivedLabel(receipt)} · ${receipt.packages} уп.`}
      onClose={onClose}
      size="lg"
      footer={(
        <>
          {!isNew && (receipt.issuedAt
            ? <button type="button" className="btn ghost" onClick={returnToStock}>Вернуть на склад</button>
            : <button type="button" className="btn ghost" onClick={issue}>Выдать со склада</button>)}
          <button type="button" className="btn ghost" onClick={onClose}>Отмена</button>
          <button type="button" className="btn primary" onClick={() => void save()} disabled={saving}>
            {saving ? 'Сохраняю…' : isNew ? 'Записать приход' : 'Сохранить'}
          </button>
        </>
      )}
    >
      <div className="receipt-grid">
        <div className="receipt-file">
          <span className="field-label">Ведомость</span>
          <div
            className={`dropzone receipt-drop${file ? ' has-file' : ''}`}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const dropped = event.dataTransfer.files?.[0];
              if (dropped) void readFile(dropped);
            }}
            onClick={() => inputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => { if (event.key === 'Enter') inputRef.current?.click(); }}
          >
            {file ? <Paperclip size={18} /> : <Upload size={18} />}
            <b>{file ? file.name : 'Перетащите PDF или фото'}</b>
            <small>{file ? fmtBytes(file.size) : 'Скан, PDF или снимок ведомости'}</small>
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,image/*"
              hidden
              aria-label="Файл ведомости"
              onChange={(event) => {
                const picked = event.target.files?.[0];
                if (picked) void readFile(picked);
              }}
            />
          </div>
          {parsing && <p className="inline-note">Читаю текст из PDF…</p>}
          {parseNote && <p className="inline-note">{parseNote}</p>}
          {!isNew && receipt.file && !file && (
            <div className="receipt-existing-file">
              <FileText size={14} />
              <button type="button" className="link-btn" onClick={() => void openFile(receipt.file!.id)}>
                {receipt.file.name}
              </button>
              <small className="muted">{fmtBytes(receipt.file.size)}</small>
              <button
                type="button"
                className="link-btn"
                onClick={async () => {
                  const blob = await getFile(receipt.file!.id);
                  if (blob) downloadFile(receipt.file!.name, blob, receipt.file!.mime);
                }}
              >
                скачать
              </button>
            </div>
          )}
          <p className="inline-note">
            Файл хранится в этом браузере (как и остальные вложения). Номер, дата и количество
            синхронизируются между устройствами — на телефоне видно, что пришло, даже без файла.
          </p>
        </div>

        <div className="receipt-fields">
          <label className="field">
            <span>Номер заказа</span>
            <input
              list="order-nos"
              value={draft.orderNo}
              data-autofocus
              placeholder="91_53d4"
              onChange={(event) => patch({ orderNo: cleanOrderNo(event.target.value) })}
              aria-label="Номер заказа"
            />
            <datalist id="order-nos">
              {knownOrderNos.map((value) => <option key={value} value={value} />)}
            </datalist>
            {draft.orderNo && !looksLikeOrderNo(draft.orderNo) && (
              <small className="field-hint danger">Похоже, номер введён с ошибкой</small>
            )}
          </label>

          <div className="receipt-row">
            <label className="field">
              <span>Дата отгрузки</span>
              <input type="date" value={draft.shippedAt} onChange={(event) => patch({ shippedAt: event.target.value })} />
            </label>
            <label className="field">
              <span>Принято на склад</span>
              <input type="date" value={draft.receivedAt} onChange={(event) => patch({ receivedAt: event.target.value })} />
            </label>
          </div>

          <div className="receipt-row">
            <label className="field">
              <span>Упаковок</span>
              <input
                type="number"
                min={0}
                value={draft.packages}
                placeholder={String(packagesFromItems(draft.items) || 0)}
                onChange={(event) => patch({ packages: event.target.value })}
              />
            </label>
            <label className="field">
              <span>Водитель</span>
              <input value={draft.driver} placeholder="кто привёз" onChange={(event) => patch({ driver: event.target.value })} />
            </label>
          </div>

          <label className="field">
            <span>Сделка</span>
            <select value={draft.dealId || matchedDeal?.id || ''} onChange={(event) => patch({ dealId: event.target.value })}>
              <option value="">— не привязывать —</option>
              {dealOptions(deals, draft.orderNo).map((deal) => (
                <option key={deal.id} value={deal.id}>{deal.title}{deal.orderNo ? ` · ${deal.orderNo}` : ''}</option>
              ))}
            </select>
            {!draft.dealId && matchedDeal && (
              <small className="field-hint">Привяжется к «{matchedDeal.title}» — номер совпал</small>
            )}
          </label>

          <label className="field">
            <span>Отгрузил на фабрике</span>
            <input value={draft.shippedBy} onChange={(event) => patch({ shippedBy: event.target.value })} />
          </label>

          <label className="field">
            <span>Примечание</span>
            <textarea rows={2} value={draft.note} placeholder="царапина, недостача, что проверить" onChange={(event) => patch({ note: event.target.value })} />
          </label>
        </div>
      </div>

      <section className="receipt-items">
        <div className="section-head">
          <div>
            <h3>Что именно привезли</h3>
            <span className="muted small">позиции из ведомости: наименование и количество упаковок</span>
          </div>
          <button type="button" className="btn small ghost" onClick={() => addRow()}>
            <Plus size={13} /> Позиция
          </button>
        </div>

        {draft.items.length === 0 && (
          <p className="inline-note">Позиции не заполнены. Нажмите «Позиция» или выберите из списка ниже.</p>
        )}

        {draft.items.length > 0 && (
          <ul className="receipt-item-list">
            {draft.items.map((item, index) => (
              <li key={`${index}-${item.name}`}>
                <input
                  value={item.name}
                  list="shipment-rows"
                  placeholder="наименование"
                  aria-label={`Наименование ${index + 1}`}
                  onChange={(event) => setItem(index, { name: event.target.value })}
                />
                <input
                  type="number"
                  min={0}
                  value={item.qty}
                  aria-label={`Количество ${index + 1}`}
                  onChange={(event) => setItem(index, { qty: Number(event.target.value) || 0 })}
                />
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Убрать позицию ${item.name || index + 1}`}
                  onClick={() => patch({ items: draft.items.filter((_, position) => position !== index) })}
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}

        <datalist id="shipment-rows">
          {SHIPMENT_ROWS.map((row) => <option key={row} value={row} />)}
        </datalist>

        <div className="quick-row">
          {SHIPMENT_ROWS.slice(0, 8).map((row) => (
            <button key={row} type="button" className="quick" onClick={() => addRow(row)}>{row}</button>
          ))}
        </div>

        <p className={`inline-note${mismatch ? ' danger' : ''}`}>
          Сумма позиций: {packagesFromItems(draft.items)} · упаковок в ведомости: {draft.packages || '—'}
          {mismatch ? ' — цифры не сходятся, проверьте' : ''}
        </p>
      </section>

      {!isNew && (
        <p className="inline-note">
          Записано {fmtDateTime(receipt.createdAt)}
          {receipt.author ? ` · ${receipt.author}` : ''}
          {receipt.issuedAt ? ` · выдано ${fmtDate(receipt.issuedAt)}${receipt.issuedTo ? ` (${receipt.issuedTo})` : ''}` : ''}
        </p>
      )}

      {error && <p className="field-error" role="alert">{error}</p>}
    </Modal>
  );
}
