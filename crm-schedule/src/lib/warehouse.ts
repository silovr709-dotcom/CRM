/* Склад: поступления с фабрики по отгрузочным ведомостям.
 *
 * Главный вопрос, на который отвечает модуль: «пришёл ли заказ, когда, сколько
 * упаковок и что именно внутри». Поэтому всё крутится вокруг номера заказа,
 * а ведомость (PDF или фото) — приложение к записи.
 */

import type { Deal, WarehouseItem, WarehouseReceipt } from '../types';
import { daysBetween, fmtDate, todayISO } from './dates';

/** Строки типографской ведомости Visma Mebel — подсказки при вводе. */
export const SHIPMENT_ROWS = [
  'Каркас',
  'Каркас пенала',
  'Фасады',
  'Двери купе',
  'ХДФ (задняя стенка)',
  'ХДФ пеналов (задняя стенка)',
  'Цоколь ЛДСП/МДФ',
  'Цоколь ПВХ',
  'Силиконовый уплотнитель',
  'Столешница',
  'Стеновая панель',
  'Стекло',
  'Стеклянные полки',
  'Алюминиевая рамка',
  'Фурнитура',
  'Передняя планка т/б',
  'Посудосушитель',
  'Бутылочница/Корзина',
  'Плинтус',
  'Шина (профиль навески)',
  'Труба хром',
  'Мойка',
  'Лоток',
  'Трек',
  'Голайн/Шуко',
  'Короб/рассеиватель',
  'Доп. ЛДСП',
];

/**
 * Ключ для сравнения номеров заказов: «91_53d4», «91-53D4» и «9153d4»
 * должны находиться одинаково. Пробелы и разделители не важны.
 */
export function orderKey(value: string | undefined): string {
  return (value ?? '').toLowerCase().replace(/[^0-9a-zа-яё]/g, '');
}

/** Номер заказа как его удобно показывать: обрезаем пробелы и лишние разделители. */
export function cleanOrderNo(value: string | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, '').slice(0, 40);
}

/** Похоже ли на номер заказа фабрики: 91_53d4, 91-15dr, 9153d4. */
export function looksLikeOrderNo(value: string): boolean {
  const clean = value.trim();
  if (!/^[0-9]{2,4}[_-]?[0-9a-zа-я]{2,8}$/i.test(clean)) return false;
  return /\d/.test(clean) && /[a-zа-я]/i.test(clean);
}

/* --------------------------- распознавание ведомости --------------------------- */

export interface ParsedManifest {
  /** Номера заказов, найденные в тексте: обычно один-три на лист. */
  orderNos: string[];
  /** Дата отгрузки из ведомости, YYYY-MM-DD. */
  shippedAt?: string;
  /** «Итого (кол-во упаковок)». */
  packages?: number;
  /** Позиции, которые удалось узнать по названиям строк. */
  items: WarehouseItem[];
  driver?: string;
  shippedBy?: string;
}

const ORDER_NO_RE = /\b(\d{2,4})[_\-\s]?([0-9a-zа-я]{2,8})\b/gi;
const DATE_RE = /\b(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})\b/;

function toIsoDate(day: string, month: string, year: string): string | undefined {
  const dd = Number(day);
  const mm = Number(month);
  let yyyy = Number(year);
  if (!dd || !mm || !yyyy) return undefined;
  if (yyyy < 100) yyyy += 2000;
  if (dd < 1 || dd > 31 || mm < 1 || mm > 12) return undefined;
  return `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

/** После подписи в ведомости обычно идёт значение — берём остаток строки. */
function valueAfter(text: string, label: RegExp): string | undefined {
  const match = label.exec(text);
  if (!match) return undefined;
  const rest = text.slice(match.index + match[0].length);
  const line = rest.split(/\r?\n/)[0] ?? '';
  const value = line.replace(/^[\s:|]+/, '').trim();
  return value ? value.slice(0, 80) : undefined;
}

/**
 * Разбор текста ведомости. Работает, если у PDF есть текстовый слой
 * (скан или фото текста не дают — тогда поля заполняются руками).
 * Количества по строкам в таблице с колонками надёжно не разделить, поэтому
 * позиции возвращаем как подсказку, а числа человек проверяет сам.
 */
export function parseManifestText(text: string): ParsedManifest {
  const flat = text.replace(/\u00a0/g, ' ');
  const orderNos: string[] = [];
  const seen = new Set<string>();
  for (const match of flat.matchAll(ORDER_NO_RE)) {
    const candidate = `${match[1]}_${match[2]}`;
    if (!looksLikeOrderNo(candidate)) continue;
    const key = orderKey(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    orderNos.push(candidate);
  }

  const dateMatch = DATE_RE.exec(flat);
  const shippedAt = dateMatch ? toIsoDate(dateMatch[1], dateMatch[2], dateMatch[3]) : undefined;

  const totalMatch = /Итого[^\n]*?(\d{1,4})/i.exec(flat);
  const packages = totalMatch ? Number(totalMatch[1]) || undefined : undefined;

  const lower = flat.toLowerCase();
  const items: WarehouseItem[] = SHIPMENT_ROWS
    .filter((row) => lower.includes(row.toLowerCase().replace(/\.$/, '')))
    .map((row) => ({ name: row, qty: 0 }));

  return {
    orderNos: orderNos.slice(0, 12),
    shippedAt,
    packages,
    items,
    driver: valueAfter(flat, /ФИО\s+водителя/i),
    shippedBy: valueAfter(flat, /Отгрузил\(?а?\)?/i),
  };
}

/* ------------------------------ записи склада ------------------------------ */

export function packagesFromItems(items: WarehouseItem[]): number {
  return items.reduce((sum, item) => sum + (Number(item.qty) || 0), 0);
}

/** Сумма позиций не сходится с «Итого» — человек должен это увидеть. */
export function itemsMismatch(receipt: Pick<WarehouseReceipt, 'items' | 'packages'>): boolean {
  const sum = packagesFromItems(receipt.items);
  return sum > 0 && receipt.packages > 0 && sum !== receipt.packages;
}

/** Заказ ещё на складе (не выдан и не увезён на монтаж). */
export function isOnStock(receipt: WarehouseReceipt): boolean {
  return !receipt.issuedAt;
}

export function receiptTitle(receipt: WarehouseReceipt): string {
  return receipt.orderNo ? `Заказ ${receipt.orderNo}` : 'Без номера заказа';
}

/** Человеческая строка «когда пришло»: 3 дня назад. */
export function receivedLabel(receipt: WarehouseReceipt, today = todayISO()): string {
  const days = daysBetween(receipt.receivedAt, today);
  if (!Number.isFinite(days)) return fmtDate(receipt.receivedAt);
  if (days <= 0) return 'принято сегодня';
  if (days === 1) return 'принято вчера';
  if (days < 5) return `принято ${days} дня назад`;
  if (days < 30) return `принято ${days} дней назад`;
  return `принято ${fmtDate(receipt.receivedAt)}`;
}

/** Что именно: «Каркас ×2, Фасады ×5». */
export function itemsLine(items: WarehouseItem[], limit = 4): string {
  const filled = items.filter((item) => Number(item.qty) > 0);
  if (filled.length === 0) return 'состав не заполнен';
  const shown = filled.slice(0, limit).map((item) => `${item.name} ×${item.qty}`);
  const rest = filled.length - shown.length;
  return `${shown.join(', ')}${rest > 0 ? ` и ещё ${rest}` : ''}`;
}

/** Поиск по номеру заказа, водителю, позициям и заметке. */
export function receiptMatches(receipt: WarehouseReceipt, query: string, deal?: Deal): boolean {
  const value = query.trim().toLowerCase();
  if (!value) return true;
  const key = orderKey(value);
  if (key && orderKey(receipt.orderNo).includes(key)) return true;
  if (key && orderKey(deal?.orderNo).includes(key)) return true;
  const haystack = [
    receipt.orderNo,
    receipt.driver,
    receipt.shippedBy,
    receipt.note,
    receipt.issuedTo,
    receipt.text?.slice(0, 4000),
    ...receipt.items.map((item) => item.name),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return value.split(/\s+/).every((word) => haystack.includes(word));
}

export interface WarehouseSummary {
  receipts: number;
  onStock: number;
  packagesOnStock: number;
  issued: number;
  /** Поступления за последние 30 дней. */
  lastMonth: number;
  withoutOrderNo: number;
  withoutDeal: number;
  lastReceivedAt?: string;
}

export function summarizeWarehouse(receipts: WarehouseReceipt[], today = todayISO()): WarehouseSummary {
  const onStock = receipts.filter(isOnStock);
  const lastMonth = receipts.filter((receipt) => {
    const days = daysBetween(receipt.receivedAt, today);
    return Number.isFinite(days) && days <= 30 && days >= -1;
  }).length;
  const lastReceivedAt = receipts
    .map((receipt) => receipt.receivedAt)
    .filter(Boolean)
    .sort()
    .at(-1);
  return {
    receipts: receipts.length,
    onStock: onStock.length,
    packagesOnStock: onStock.reduce((sum, receipt) => sum + (Number(receipt.packages) || 0), 0),
    issued: receipts.length - onStock.length,
    lastMonth,
    withoutOrderNo: receipts.filter((receipt) => !receipt.orderNo.trim()).length,
    withoutDeal: receipts.filter((receipt) => !receipt.dealId).length,
    lastReceivedAt,
  };
}

/** Сделка, к которой относится номер заказа (сравнение без разделителей). */
export function findDealByOrderNo(deals: Deal[], orderNo: string): Deal | undefined {
  const key = orderKey(orderNo);
  if (!key) return undefined;
  return deals.find((deal) => orderKey(deal.orderNo) === key);
}

/** Сделки, к которым можно привязать поступление: сначала совпадение по номеру. */
export function dealOptions(deals: Deal[], orderNo: string): Deal[] {
  const key = orderKey(orderNo);
  const scored = deals.map((deal) => ({
    deal,
    score: key && orderKey(deal.orderNo) === key ? 2 : orderKey(deal.orderNo).startsWith(key) && key ? 1 : 0,
  }));
  return scored
    .filter((item) => item.score > 0 || !key)
    .sort((left, right) => right.score - left.score || right.deal.updatedAt.localeCompare(left.deal.updatedAt))
    .slice(0, 20)
    .map((item) => item.deal);
}

export interface ReceiptInput {
  orderNo?: string;
  receivedAt?: string;
  shippedAt?: string;
  packages?: number;
  items?: WarehouseItem[];
  driver?: string;
  shippedBy?: string;
  note?: string;
  dealId?: string;
  file?: WarehouseReceipt['file'];
  text?: string;
  author?: string;
}

/** Проверка перед сохранением: пустой номер заказа — главная ошибка. */
export function receiptProblem(input: ReceiptInput): string {
  if (!cleanOrderNo(input.orderNo)) return 'Укажите номер заказа — по нему ищут на складе';
  if (!input.receivedAt) return 'Укажите дату приёмки';
  if (Number(input.packages) < 0) return 'Количество упаковок не может быть отрицательным';
  return '';
}

/** Новая запись склада: с датами, пустыми полями по умолчанию. */
export function buildReceipt(input: ReceiptInput, id: string, now = new Date().toISOString()): WarehouseReceipt {
  const receivedAt = input.receivedAt || todayISO();
  return {
    id,
    orderNo: cleanOrderNo(input.orderNo),
    shippedAt: input.shippedAt || undefined,
    receivedAt,
    packages: Math.max(0, Math.round(Number(input.packages) || 0)),
    items: (input.items ?? [])
      .map((item) => ({ name: item.name.trim(), qty: Math.max(0, Math.round(Number(item.qty) || 0)) }))
      .filter((item) => item.name),
    driver: input.driver?.trim() || undefined,
    shippedBy: input.shippedBy?.trim() || undefined,
    note: input.note?.trim() || undefined,
    dealId: input.dealId || undefined,
    file: input.file,
    text: input.text,
    author: input.author || undefined,
    createdAt: now,
    updatedAt: now,
  };
}

/** Новая пустая позиция для формы. */
export function emptyItem(name = ''): WarehouseItem {
  return { name, qty: 1 };
}

/** Короткая сводка для карточки сделки: «пришло 4 уп. 11 июня». */
export function dealReceiptsLine(receipts: WarehouseReceipt[]): string {
  if (receipts.length === 0) return 'на склад не приходило';
  const packages = receipts.reduce((sum, receipt) => sum + (Number(receipt.packages) || 0), 0);
  const last = [...receipts].sort((left, right) => left.receivedAt.localeCompare(right.receivedAt)).at(-1);
  return `${packages} уп. · ${last ? fmtDate(last.receivedAt) : ''}`.trim();
}
