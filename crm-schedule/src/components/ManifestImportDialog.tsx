/* Загрузка ведомости целиком: один PDF — все заказы с листа.
 * Приложение читает таблицу (колонки — заказы, строки — позиции), показывает
 * найденное карточками, и только после проверки записывает приходы. */

import { useMemo, useRef, useState } from 'react';
import { FileText, Paperclip, Plus, ScanSearch, Trash2, Upload } from 'lucide-react';
import type { WarehouseItem } from '../types';
import { useApp } from '../store';
import { fmtBytes } from '../lib/attachments';
import { fmtDate, todayISO } from '../lib/dates';
import { isPdfFile, readPdf } from '../lib/pdfText';
import {
  cleanOrderNo, findDealByOrderNo, itemsMismatch, orderKey, packagesFromItems,
  parseManifestItems, SHIPMENT_ROWS, shipmentRowItems, type ParsedManifest, type ParsedManifestOrder,
} from '../lib/warehouse';
import { recognizeManifest } from '../lib/ocr';
import Modal from './Modal';

interface DraftOrder {
  key: number;
  selected: boolean;
  orderNo: string;
  packages: string;
  items: WarehouseItem[];
}

let nextKey = 1;

function draftFromParsed(order: ParsedManifestOrder): DraftOrder {
  nextKey += 1;
  return {
    key: nextKey,
    selected: true,
    orderNo: order.orderNo,
    packages: order.packages ? String(order.packages) : '',
    items: order.items.map((item) => ({ ...item })),
  };
}

function blankOrder(): DraftOrder {
  nextKey += 1;
  // Позиции бланка уже подставлены — человеку остаётся вписать количество.
  return { key: nextKey, selected: true, orderNo: '', packages: '', items: shipmentRowItems() };
}

export default function ManifestImportDialog({ onClose }: { onClose: () => void }) {
  const { deals, receipts, addReceipts, notify } = useApp();
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [needOcr, setNeedOcr] = useState(false);
  const [parseNote, setParseNote] = useState('');
  const [parsedText, setParsedText] = useState('');
  const [byColumns, setByColumns] = useState(false);
  const [receivedAt, setReceivedAt] = useState(todayISO());
  const [shippedAt, setShippedAt] = useState('');
  const [driver, setDriver] = useState('');
  const [shippedBy, setShippedBy] = useState('');
  const [orders, setOrders] = useState<DraftOrder[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const existingKeys = useMemo(
    () => new Set(receipts.map((receipt) => orderKey(receipt.orderNo)).filter(Boolean)),
    [receipts],
  );
  const selected = orders.filter((order) => order.selected);
  const selectedPackages = selected.reduce(
    (sum, order) => sum + (Number(order.packages) || packagesFromItems(order.items)),
    0,
  );

  const readFile = async (picked: File) => {
    setFile(picked);
    setError('');
    setByColumns(false);
    setNeedOcr(false);
    if (!(await isPdfFile(picked))) {
      setParseNote('Это фото ведомости: текста в файле нет. Нажмите «Распознать скан» — приложение прочитает лист как картинку. Или добавьте заказы вручную — файл приложится к каждому приходу.');
      setNeedOcr(true);
      return;
    }
    setParsing(true);
    setParseNote('Читаю ведомость…');
    const read = await readPdf(picked);
    const layout = read.pages;
    const text = read.text;
    setParsing(false);
    if (read.error) {
      setParseNote(`Файл — настоящий PDF, но прочитать его как текст не получилось: ${read.error}. Можно распознать его как картинку кнопкой «Распознать скан» — или добавить заказы вручную.`);
      setNeedOcr(true);
      return;
    }
    if (!text) {
      setParseNote('PDF открылся, но текста в нём нет: это скан — картинка внутри PDF (на телефоне текст выделяет сам телефон, в файле его нет). Нажмите «Распознать скан», приложение прочитает страницы как фото.');
      setNeedOcr(true);
      return;
    }
    setParsedText(text.slice(0, 12_000));
    applyParsed(parseManifestItems(layout));
  };

  /** Показывает найденные заказы карточками — общий путь для PDF и OCR. */
  const applyParsed = (parsed: ParsedManifest) => {
    setShippedAt((current) => current || parsed.shippedAt || '');
    setDriver((current) => current || parsed.driver || '');
    setShippedBy((current) => current || parsed.shippedBy || '');
    setByColumns(parsed.tableByColumns);
    if (parsed.orders.length === 0) {
      setParseNote('Текст прочитался, но номеров заказов в нём не нашлось. Добавьте заказы вручную ниже — файл приложится к каждому приходу.');
      return;
    }
    setOrders(parsed.orders.map(draftFromParsed));
    const foundPackages = parsed.orders.reduce((sum, order) => sum + (order.packages ?? 0), 0);
    setParseNote(
      `Нашёл заказов: ${parsed.orders.length}${foundPackages ? `, упаковок по «Итого»: ${foundPackages}` : ''}`
      + `${parsed.shippedAt ? `, дата отгрузки: ${fmtDate(parsed.shippedAt)}` : ''}. `
      + (parsed.tableByColumns
        ? 'Количество разнёс по колонкам заказов — проверьте цифры перед записью.'
        : 'Часть количеств по колонкам разнести не удалось — проверьте и допишите пустые строки.'),
    );
  };

  /** Сканированная ведомость: читаем страницы как картинки (OCR). */
  const runOcr = async () => {
    if (!file) return;
    setOcrBusy(true);
    setParseNote('Распознаю скан…');
    try {
      const result = await recognizeManifest(file, setParseNote);
      if (result.text) setParsedText(result.text.slice(0, 12_000));
      if (result.parsed.orders.length > 0) {
        applyParsed(result.parsed);
      } else {
        setParseNote(result.text
          ? 'Распознавание прочитало текст, но номеров заказов не нашло. Добавьте заказы вручную ниже — позиции уже подставлены, останется вписать количество.'
          : 'Распознавание ничего не прочитало: лист бледный или фото размыто. Добавьте заказы вручную ниже — позиции уже подставлены.');
      }
    } catch (error) {
      setParseNote(`Распознать не получилось: ${error instanceof Error ? error.message : 'ошибка распознавания'}. В первый раз нужен интернет — модель распознавания загружается один раз и дальше лежит в кэше. Заказы можно добавить вручную.`);
    }
    setOcrBusy(false);
  };

  const patchOrder = (key: number, patch: Partial<DraftOrder>) => {
    setOrders((current) => current.map((order) => (order.key === key ? { ...order, ...patch } : order)));
  };

  const patchItem = (key: number, index: number, patch: Partial<WarehouseItem>) => {
    setOrders((current) => current.map((order) => (order.key === key
      ? { ...order, items: order.items.map((item, position) => (position === index ? { ...item, ...patch } : item)) }
      : order)));
  };

  const save = async () => {
    const chosen = orders.filter((order) => order.selected);
    if (chosen.length === 0) {
      setError('Отметьте хотя бы один заказ из ведомости');
      return;
    }
    const missing = chosen.find((order) => !cleanOrderNo(order.orderNo));
    if (missing) {
      setError('У отмеченного заказа не указан номер — по нему потом ищут на складе');
      return;
    }
    if (!receivedAt) {
      setError('Укажите дату приёмки');
      return;
    }
    setSaving(true);
    setError('');
    const failed = await addReceipts(chosen.map((order) => ({
      orderNo: order.orderNo,
      receivedAt,
      shippedAt: shippedAt || undefined,
      packages: Number(order.packages) || packagesFromItems(order.items),
      items: order.items.filter((item) => item.name.trim() && Number(item.qty) > 0),
      driver,
      shippedBy,
      dealId: findDealByOrderNo(deals, order.orderNo)?.id,
      text: parsedText || undefined,
    })), file);
    setSaving(false);
    if (failed) {
      setError(failed);
      return;
    }
    notify(`Записано приходов: ${chosen.length} — из одной ведомости`, 'ok');
    onClose();
  };

  return (
    <Modal
      title="Ведомость с фабрики"
      subtitle="Один PDF — все заказы с листа: номер, упаковки и что внутри"
      onClose={onClose}
      size="lg"
      footer={(
        <>
          <button type="button" className="btn ghost" onClick={onClose}>Отмена</button>
          <button type="button" className="btn primary" onClick={() => void save()} disabled={saving || parsing}>
            {saving ? 'Записываю…' : `Записать приходы${selected.length ? `: ${selected.length}` : ''}`}
          </button>
        </>
      )}
    >
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
        <b>{file ? file.name : 'Перетащите PDF ведомости сюда'}</b>
        <small>{file ? fmtBytes(file.size) : 'Или нажмите, чтобы выбрать файл. Фото тоже можно — заказы добавите вручную.'}</small>
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
      {parsing && <p className="inline-note"><ScanSearch size={13} /> Читаю текст и таблицу ведомости…</p>}
      {parseNote && !parsing && <p className="inline-note">{parseNote}</p>}
      {file && needOcr && !parsing && (
        <button type="button" className="btn" onClick={() => void runOcr()} disabled={ocrBusy}>
          {ocrBusy ? 'Распознаю…' : 'Распознать скан (OCR)'}
        </button>
      )}
      {file && byColumns && <p className="inline-note">Файл приложится к каждому записанному приходу — открывать его можно из любой записи заказа.</p>}

      <div className="receipt-row manifest-shared">
        <label className="field">
          <span>Принято на склад</span>
          <input type="date" value={receivedAt} onChange={(event) => setReceivedAt(event.target.value)} aria-label="Принято на склад" />
        </label>
        <label className="field">
          <span>Дата отгрузки</span>
          <input type="date" value={shippedAt} onChange={(event) => setShippedAt(event.target.value)} aria-label="Дата отгрузки" />
        </label>
        <label className="field">
          <span>Водитель</span>
          <input value={driver} placeholder="кто привёз" onChange={(event) => setDriver(event.target.value)} aria-label="Водитель" />
        </label>
        <label className="field">
          <span>Отгрузил на фабрике</span>
          <input value={shippedBy} onChange={(event) => setShippedBy(event.target.value)} aria-label="Отгрузил на фабрике" />
        </label>
      </div>

      <div className="section-head manifest-head">
        <div>
          <h3>Заказы из ведомости</h3>
          <span className="muted small">
            {orders.length === 0
              ? 'пока пусто — загрузите PDF или добавьте заказ вручную'
              : `выбрано ${selected.length} из ${orders.length} · упаковок: ${selectedPackages}`}
          </span>
        </div>
        <button type="button" className="btn small ghost" onClick={() => setOrders((current) => [...current, blankOrder()])}>
          <Plus size={13} /> Заказ вручную
        </button>
      </div>

      {orders.length === 0 ? (
        <p className="inline-note">
          Когда PDF прочитается, здесь появятся карточки заказов: номер, сколько упаковок
          и что именно за упаковки — по каждой колонке ведомости отдельно.
        </p>
      ) : (
        <div className="manifest-orders">
          {orders.map((order, orderIndex) => {
            const deal = findDealByOrderNo(deals, order.orderNo);
            const mismatch = itemsMismatch({
              items: order.items,
              packages: Number(order.packages) || packagesFromItems(order.items),
            });
            const duplicate = Boolean(order.orderNo && existingKeys.has(orderKey(order.orderNo)));
            return (
              <section key={order.key} className={`manifest-order${order.selected ? '' : ' off'}`} aria-label={`Заказ ${order.orderNo || orderIndex + 1}`}>
                <div className="manifest-order-head">
                  <label className="manifest-check">
                    <input
                      type="checkbox"
                      checked={order.selected}
                      onChange={(event) => patchOrder(order.key, { selected: event.target.checked })}
                      aria-label={`Записать заказ ${order.orderNo || orderIndex + 1}`}
                    />
                    <span>Записать</span>
                  </label>
                  <input
                    className="manifest-order-no"
                    value={order.orderNo}
                    placeholder="91_53d4"
                    aria-label={`Номер заказа ${orderIndex + 1}`}
                    onChange={(event) => patchOrder(order.key, { orderNo: cleanOrderNo(event.target.value) })}
                  />
                  <label className="manifest-packages">
                    <span>Упаковок</span>
                    <input
                      type="number"
                      min={0}
                      value={order.packages}
                      placeholder={String(packagesFromItems(order.items) || 0)}
                      aria-label={`Упаковок у заказа ${order.orderNo || orderIndex + 1}`}
                      onChange={(event) => patchOrder(order.key, { packages: event.target.value })}
                    />
                  </label>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Убрать заказ ${order.orderNo || orderIndex + 1} из списка`}
                    onClick={() => setOrders((current) => current.filter((item) => item.key !== order.key))}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>

                <div className="manifest-order-meta">
                  {deal
                    ? <span className="badge badge-green">сделка: {deal.title}</span>
                    : <span className="badge badge-ghost">без сделки</span>}
                  {duplicate && <span className="badge badge-amber">такой заказ уже есть на складе</span>}
                </div>

                {order.items.length > 0 ? (
                  <ul className="receipt-item-list">
                    {order.items.map((item, index) => (
                      <li key={`${order.key}-${index}`}>
                        <input
                          value={item.name}
                          placeholder="наименование"
                          aria-label={`Наименование ${index + 1} заказа ${order.orderNo || orderIndex + 1}`}
                          onChange={(event) => patchItem(order.key, index, { name: event.target.value })}
                        />
                        <input
                          type="number"
                          min={0}
                          value={item.qty === 0 ? '' : item.qty}
                          placeholder="0"
                          aria-label={`Количество ${index + 1} заказа ${order.orderNo || orderIndex + 1}`}
                          onChange={(event) => patchItem(order.key, index, { qty: Number(event.target.value) || 0 })}
                        />
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label={`Убрать позицию ${item.name || index + 1} заказа ${order.orderNo || orderIndex + 1}`}
                          onClick={() => patchOrder(order.key, { items: order.items.filter((_, position) => position !== index) })}
                        >
                          <Trash2 size={14} />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="inline-note">Состав не распознан — добавьте позиции или оставьте пустым и допишите позже.</p>
                )}

                <div className="manifest-order-foot">
                  <button
                    type="button"
                    className="btn small ghost"
                    onClick={() => patchOrder(order.key, { items: [...order.items, { name: '', qty: 1 }] })}
                  >
                    <Plus size={13} /> Позиция
                  </button>
                  {order.items.length < SHIPMENT_ROWS.length && (
                    <button
                      type="button"
                      className="btn small ghost"
                      onClick={() => patchOrder(order.key, { items: shipmentRowItems(order.items) })}
                    >
                      Все позиции ведомости
                    </button>
                  )}
                  <span className={`small ${mismatch ? 'danger' : 'muted'}`}>
                    Сумма позиций: {packagesFromItems(order.items)}
                    {mismatch ? ' — не сходится с «Итого», проверьте' : ''}
                  </span>
                </div>
              </section>
            );
          })}
        </div>
      )}

      {error && <p className="field-error" role="alert">{error}</p>}
      {!file && orders.length > 0 && (
        <p className="inline-note"><FileText size={13} /> Файл не выбран: приходы запишутся без ведомости. Её можно приложить позже из карточки прихода.</p>
      )}
    </Modal>
  );
}
