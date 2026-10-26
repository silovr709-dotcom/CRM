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

/** Один заказ, найденный в ведомости: номер, упаковки и что именно внутри. */
export interface ParsedManifestOrder {
  orderNo: string;
  /** «Итого (кол-во упаковок)» именно по этому заказу. */
  packages?: number;
  /** Позиции с количествами именно по этому заказу. */
  items: WarehouseItem[];
}

export interface ParsedManifest {
  /** Номера заказов, найденные в тексте: обычно один-три на лист. */
  orderNos: string[];
  /** Заказы по отдельности — когда ведомость удалось разложить по колонкам. */
  orders: ParsedManifestOrder[];
  /** True, если количества разнесены по координатам колонок PDF (надёжно). */
  tableByColumns: boolean;
  /** Дата отгрузки из ведомости, YYYY-MM-DD. */
  shippedAt?: string;
  /** «Итого (кол-во упаковок)» первого заказа — для одиночного прихода. */
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

/** Строка для сравнения названий позиций: без регистра, знаков и лишних пробелов. */
function normLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^0-9a-zа-я]+/gi, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

const NORMALIZED_ROWS = SHIPMENT_ROWS.map((row) => ({ row, norm: normLabel(row) }));

/** Какая стандартная позиция ведомости начинается в этой строке, если есть. */
function rowAtLine(line: string): string | undefined {
  const norm = normLabel(line);
  let best: { row: string; norm: string } | undefined;
  for (const candidate of NORMALIZED_ROWS) {
    if (norm === candidate.norm || norm.startsWith(`${candidate.norm} `)) {
      if (!best || candidate.norm.length > best.norm.length) best = candidate;
    }
  }
  return best?.row;
}

/** Целые числа после названия позиции в строке. */
function numbersAfterRow(line: string, row: string): number[] {
  const norm = normLabel(line);
  const rowNorm = normLabel(row);
  const rest = norm.startsWith(rowNorm) ? norm.slice(rowNorm.length) : norm;
  return (rest.match(/\d{1,4}/g) ?? []).map(Number);
}

/** Числа из строки «Итого (кол-во упаковок) 3 4 7». */
function totalNumbers(line: string): number[] {
  const norm = normLabel(line);
  if (!norm.includes('итого')) return [];
  const after = norm.includes('упаковок') ? norm.slice(norm.indexOf('упаковок') + 'упаковок'.length) : norm.replace('итого', '');
  return (after.match(/\d{1,4}/g) ?? []).map(Number);
}

/**
 * Раскладывает заказы по строкам текста. В обычном тексте пустые ячейки таблицы
 * пропадают, поэтому количества разносим только когда чисел в строке ровно
 * столько, сколько заказов: иначе это была бы выдумка, а не распознавание.
 */
function ordersFromLines(lines: string[], orderNos: string[]): ParsedManifestOrder[] {
  const orders: ParsedManifestOrder[] = orderNos.map((orderNo) => ({ orderNo, items: [] }));
  if (orders.length === 0) return orders;
  for (const line of lines) {
    const totals = totalNumbers(line);
    if (totals.length === orderNos.length && totals.length > 0) {
      totals.forEach((value, index) => { if (value > 0) orders[index].packages = value; });
      continue;
    }
    const row = rowAtLine(line);
    if (!row) continue;
    const numbers = numbersAfterRow(line, row);
    if (numbers.length !== orderNos.length) continue;
    numbers.forEach((value, index) => {
      if (value > 0) orders[index].items.push({ name: row, qty: value });
    });
  }
  return orders;
}

/**
 * Разбор текста ведомости. Работает, если у PDF есть текстовый слой
 * (скан или фото текста не дают — тогда поля заполняются руками).
 * Заказы по отдельности возвращает `orders`: для одиночного прихода поля
 * `packages`/`items` ниже оставлены как раньше — подсказка без выдуманных чисел.
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

  const limited = orderNos.slice(0, 12);
  return {
    orderNos: limited,
    orders: ordersFromLines(flat.split(/\r?\n/), limited),
    tableByColumns: false,
    shippedAt,
    packages,
    items,
    driver: valueAfter(flat, /ФИО\s+водителя/i),
    shippedBy: valueAfter(flat, /Отгрузил\(?а?\)?/i),
  };
}

/* --------------------- разбор таблицы по координатам PDF --------------------- */

/** Кусок текста PDF со своим местом на странице: x/y — левый нижний угол, в пунктах. */
export interface ManifestTextItem {
  str: string;
  x: number;
  y: number;
  width?: number;
  page?: number;
}

interface ManifestToken extends ManifestTextItem {
  center: number;
}

interface ManifestLine {
  y: number;
  tokens: ManifestToken[];
  text: string;
}

/** Разбивает кусок текста на слова, сохраняя примерную координату каждого. */
function tokensOf(item: ManifestTextItem): ManifestToken[] {
  const width = item.width ?? 0;
  const parts = item.str.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) {
    return [{ ...item, str: item.str.trim(), center: item.x + width / 2 }].filter((token) => token.str);
  }
  const tokens: ManifestToken[] = [];
  let offset = 0;
  for (const part of parts) {
    const index = item.str.indexOf(part, offset);
    const at = index >= 0 ? index : offset;
    const share = item.str.length ? at / item.str.length : 0;
    tokens.push({
      ...item,
      str: part,
      x: item.x + width * share,
      center: item.x + width * share + (width * part.length) / Math.max(1, item.str.length) / 2,
    });
    offset = at + part.length;
  }
  return tokens;
}

/** Собирает строки страницы из кусочков текста: сверху вниз, внутри — слева направо. */
function linesOf(items: ManifestTextItem[]): ManifestLine[] {
  const tokens = items.flatMap(tokensOf).sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: ManifestLine[] = [];
  for (const token of tokens) {
    const line = lines.find((candidate) => Math.abs(candidate.y - token.y) <= 3);
    if (line) line.tokens.push(token);
    else lines.push({ y: token.y, tokens: [token], text: token.str });
  }
  return lines
    .map((line) => {
      const sorted = [...line.tokens].sort((a, b) => a.x - b.x);
      return { ...line, tokens: sorted, text: sorted.map((token) => token.str).join(' ') };
    })
    .sort((a, b) => b.y - a.y);
}

/** Колонки заказов на странице: номера из шапки таблицы и их центры по x. */
function columnsOf(lines: ManifestLine[]): Array<{ orderNo: string; key: string; center: number }> {
  const columns: Array<{ orderNo: string; key: string; center: number }> = [];
  for (const line of lines) {
    for (const token of line.tokens) {
      const text = token.str.trim();
      if (!looksLikeOrderNo(text)) continue;
      const key = orderKey(text);
      if (columns.some((column) => column.key === key)) continue;
      columns.push({ orderNo: cleanOrderNo(text), key, center: token.center });
    }
  }
  return columns.sort((a, b) => a.center - b.center);
}

/**
 * Разбор ведомости по геометрии PDF — главный путь для настоящего бланка.
 * Колонки таблицы — заказы, строки — позиции; число относится к той колонке,
 * под которой стоит на странице. Так количество попадает именно в свой заказ,
 * даже если у соседних заказов эта позиция пустая.
 */
export function parseManifestItems(pages: ManifestTextItem[][]): ParsedManifest {
  const pageLines = pages.map(linesOf);
  const text = pageLines.flat().map((line) => line.text).join('\n');
  const base = parseManifestText(text);

  const merged = new Map<string, ParsedManifestOrder & { key: string }>();
  const columnOrder: string[] = [];
  let byColumns = false;

  pages.forEach((_items, pageIndex) => {
    const lines = pageLines[pageIndex];
    const columns = columnsOf(lines);
    if (columns.length === 0) return;
    byColumns = true;

    for (const column of columns) {
      if (!merged.has(column.key)) {
        merged.set(column.key, { key: column.key, orderNo: column.orderNo, items: [] });
        columnOrder.push(column.key);
      }
    }

    const gaps = columns.slice(1).map((column, index) => column.center - columns[index].center).filter((gap) => gap > 0);
    const maxDistance = gaps.length ? Math.max(36, Math.min(...gaps) * 0.62) : Number.POSITIVE_INFINITY;
    const nearest = (center: number) => {
      let best: (typeof columns)[number] | undefined;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const column of columns) {
        const distance = Math.abs(column.center - center);
        if (distance < bestDistance) { best = column; bestDistance = distance; }
      }
      return best && bestDistance <= maxDistance ? best : undefined;
    };

    for (const line of lines) {
      const isTotal = normLabel(line.text).includes('итого');
      const row = isTotal ? undefined : rowAtLine(line.text);
      if (!isTotal && !row) continue;
      for (const token of line.tokens) {
        if (!/^\d{1,4}$/.test(token.str.trim())) continue;
        const column = nearest(token.center);
        if (!column) continue;
        const order = merged.get(column.key);
        if (!order) continue;
        const qty = Number(token.str);
        if (qty <= 0) continue;
        if (isTotal) {
          order.packages = qty;
        } else if (row) {
          const existing = order.items.find((item) => item.name === row);
          if (existing) existing.qty += qty;
          else order.items.push({ name: row, qty });
        }
      }
    }
  });

  if (!byColumns) return base;
  const orders = columnOrder
    .map((key) => merged.get(key))
    .filter((order): order is ParsedManifestOrder & { key: string } => Boolean(order))
    .map(({ key: _key, ...order }) => order);
  return {
    ...base,
    orderNos: orders.map((order) => order.orderNo),
    orders,
    tableByColumns: orders.some((order) => order.items.length > 0 || order.packages),
    packages: orders[0]?.packages ?? base.packages,
    items: orders[0]?.items.length ? orders[0].items : base.items,
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

/**
 * Позиции ведомости списком: распознанные/введённые плюс все остальные строки
 * бланка Visma с пустым количеством. Человеку остаётся только проставить
 * цифры — названия придумывать и вбивать не нужно. Своя позиция добавляется
 * отдельной строкой, как раньше.
 */
export function shipmentRowItems(existing: WarehouseItem[] = []): WarehouseItem[] {
  const result = existing.map((item) => ({ ...item }));
  const known = new Set(result.map((item) => item.name.trim().toLowerCase()));
  for (const row of SHIPMENT_ROWS) {
    if (!known.has(row.toLowerCase())) result.push({ name: row, qty: 0 });
  }
  return result;
}

/** Короткая сводка для карточки сделки: «пришло 4 уп. 11 июня». */
export function dealReceiptsLine(receipts: WarehouseReceipt[]): string {
  if (receipts.length === 0) return 'на склад не приходило';
  const packages = receipts.reduce((sum, receipt) => sum + (Number(receipt.packages) || 0), 0);
  const last = [...receipts].sort((left, right) => left.receivedAt.localeCompare(right.receivedAt)).at(-1);
  return `${packages} уп. · ${last ? fmtDate(last.receivedAt) : ''}`.trim();
}
