// Документы заказа: КП, смета, договор, наряд на монтаж и акт.
//
// Модель отдельная от React: по ней строится и экран, и печатная форма, и
// ссылка для клиента. Ничего не считаем «на глаз»: суммы, сроки и оплаты
// берутся из сделки, а не вводятся заново.

import type { Client, Deal, DealItem, DealStatus, IssuedDocument, Settings } from '../types';
import { fmtMoney, todayISO } from './dates';
import { paidAmount } from './crmTasks';
import { docKindMeta } from './documentKinds';

export type DocumentRow = { title: string; qty: number; unit: string; price: number; amount: number };

export interface DocumentModel {
  kind: IssuedDocument['kind'];
  /** Название документа: «Коммерческое предложение». */
  title: string;
  /** Номер вида КП-2026-001. */
  number: string;
  /** Дата документа YYYY-MM-DD. */
  issuedAt: string;
  /** Кому: заказчик. */
  client: string;
  /** Название заказа — предмет. */
  subject: string;
  /** Вводные абзацы документа. */
  intro: string[];
  rows: DocumentRow[];
  /** Итог по смете (сумма позиций). */
  itemsTotal: number;
  /** Сумма заказа из карточки — единственная цифра для договора. */
  total: number;
  paid: number;
  remainder: number;
  /** Блоки «поле — значение»: адрес, дата монтажа, бригада и т. п. */
  details: { label: string; value: string }[];
  /** Условия и примечания. */
  notes: string[];
  /** Подписи: слева исполнитель, справа заказчик. */
  signatures: [string, string];
  company: string;
}

/** Дата в документах: 05.11.2026 — так её читают в договорах. */
export function docDate(day?: string): string {
  if (!day) return '—';
  const [year, month, date] = day.slice(0, 10).split('-');
  if (!year || !month || !date) return day;
  return `${date}.${month}.${year}`;
}

/** Сумма одной позиции сметы. */
export function itemAmount(item: Pick<DealItem, 'qty' | 'price'>): number {
  const qty = Number.isFinite(item.qty) ? item.qty : 0;
  const price = Number.isFinite(item.price) ? item.price : 0;
  return Math.round(qty * price * 100) / 100;
}

/** Сумма всех позиций сметы. */
export function itemsTotal(items: DealItem[] | undefined): number {
  return (items ?? []).reduce((sum, item) => sum + itemAmount(item), 0);
}

/** Позиции для печати: если смету не заполняли — одна строка «по договору». */
export function documentRows(deal: Deal): DocumentRow[] {
  const items = deal.items ?? [];
  if (!items.length) {
    return [{
      title: deal.title || 'Кухня по договору',
      qty: 1,
      unit: 'компл.',
      price: deal.amount,
      amount: deal.amount,
    }];
  }
  return items.map((item) => ({
    title: item.title,
    qty: item.qty,
    unit: item.unit || 'шт.',
    price: item.price,
    amount: itemAmount(item),
  }));
}

/** Номер документа: КП-2026-001. Нумерация своя у каждого вида. */
export function documentNumber(kind: IssuedDocument['kind'], year: number, sequence: number): string {
  const meta = docKindMeta(kind);
  const safe = Math.max(1, Math.floor(sequence));
  return `${meta.prefix}-${year}-${String(safe).padStart(3, '0')}`;
}

/**
 * Следующий номер среди уже выданных. Считаем по всем документам базы,
 * чтобы номера не повторялись даже после удаления заказа.
 */
export function nextSequence(
  kind: IssuedDocument['kind'],
  year: number,
  issued: { kind: string; number: string }[],
): number {
  const prefix = `${docKindMeta(kind).prefix}-${year}-`;
  const used = issued
    .filter((doc) => doc.kind === kind && doc.number.startsWith(prefix))
    .map((doc) => Number(doc.number.slice(prefix.length)))
    .filter((value) => Number.isFinite(value) && value > 0);
  return used.length ? Math.max(...used) + 1 : 1;
}

/** Предоплата по договору: половина суммы, округлённая до сотни. */
export function prepayment(total: number): number {
  if (!(total > 0)) return 0;
  return Math.round(total / 2 / 100) * 100;
}

/** Что клиент должен знать о сроках: ближайшая понятная дата. */
export function promisedDate(deal: Deal): string {
  const schedule = deal.schedule ?? { status: 'planned' as const };
  return schedule.installAt || schedule.deliveryAt || schedule.readyAt || '';
}

function scheduleLine(deal: Deal): { label: string; value: string }[] {
  const schedule = deal.schedule ?? { status: 'planned' as const };
  const out: { label: string; value: string }[] = [];
  if (schedule.measureAt) out.push({ label: 'Замер', value: docDate(schedule.measureAt) });
  if (schedule.readyAt) out.push({ label: 'Готовность на фабрике', value: docDate(schedule.readyAt) });
  if (schedule.deliveryAt) out.push({ label: 'Доставка', value: docDate(schedule.deliveryAt) });
  if (schedule.installAt) {
    const time = schedule.timeStart ? `, ${schedule.timeStart}${schedule.timeEnd ? `–${schedule.timeEnd}` : ''}` : '';
    out.push({ label: 'Монтаж', value: `${docDate(schedule.installAt)}${time}` });
  }
  if (schedule.team) out.push({ label: 'Бригада', value: schedule.team });
  if (schedule.address) out.push({ label: 'Адрес', value: schedule.address });
  return out;
}

export interface BuildDocumentInput {
  kind: IssuedDocument['kind'];
  number: string;
  issuedAt?: string;
  deal: Deal;
  client?: Client;
  settings: Settings;
}

/** Собрать документ: единственное место, где решается его содержание. */
export function buildDocument({ kind, number, issuedAt, deal, client, settings }: BuildDocumentInput): DocumentModel {
  const meta = docKindMeta(kind);
  const rows = documentRows(deal);
  const itemsSum = itemsTotal(deal.items);
  const total = deal.items?.length ? Math.round(itemsSum) : deal.amount;
  const paid = paidAmount(deal.payments);
  const remainder = Math.max(0, total - paid);
  const day = issuedAt || todayISO();
  const clientName = client?.name || 'Заказчик';
  const company = settings.companyName || 'Мастерская';

  const base = {
    kind,
    title: meta.title,
    number,
    issuedAt: day,
    client: clientName,
    subject: deal.title || 'Кухня по индивидуальному заказу',
    itemsTotal: Math.round(itemsSum || deal.amount),
    total,
    paid,
    remainder,
    signatures: [`${company}`, clientName] as [string, string],
    company,
  };

  switch (kind) {
    case 'offer':
      return {
        ...base,
        intro: [
          `${company} предлагает вам изготовление и монтаж: ${deal.title || 'кухня по индивидуальному заказу'}.`,
          `Предложение составлено ${docDate(day)} и действует 14 дней.`,
        ],
        rows,
        details: [
          ...(client?.phones[0] ? [{ label: 'Телефон', value: client.phones[0] }] : []),
          ...(deal.schedule?.address ? [{ label: 'Адрес объекта', value: deal.schedule.address }] : []),
          { label: 'Срок изготовления', value: promisedDate(deal) ? docDate(promisedDate(deal)) : 'уточняется после замера' },
        ],
        notes: [
          'Стоимость указана с материалами и монтажом.',
          'Итоговая стоимость фиксируется в договоре после замера.',
          'Оплата: предоплата 50%, остаток — после монтажа.',
        ],
        signatures: [`Менеджер: ${deal.manager || settings.myName || company}`, 'Заказчик'],
      };

    case 'estimate':
      return {
        ...base,
        intro: [
          `Смета к заказу «${deal.title}» от ${docDate(day)}.`,
        ],
        rows,
        details: scheduleLine(deal),
        notes: [
          'Смета не является публичной офертой.',
          'Цены на материалы уточняются при заказе; замена согласуется с заказчиком.',
          ...(deal.items?.length && Math.round(itemsSum) !== deal.amount
            ? [`Сумма по позициям — ${fmtMoney(itemsSum)}, в карточке заказа указано ${fmtMoney(deal.amount)}.`]
            : []),
        ],
        signatures: [`${company}`, clientName],
      };

    case 'contract':
      return {
        ...base,
        rows,
        intro: [
          `${company}, в лице ${deal.manager || settings.myName || 'менеджера'}, именуемое в дальнейшем «Исполнитель», и ${clientName}, именуемый в дальнейшем «Заказчик», заключили договор о нижеследующем.`,
          `1. Предмет: изготовление и монтаж изделия «${deal.title || 'кухня'}» по адресу ${client?.address || deal.schedule?.address || '________'}.`,
          `2. Цена: ${fmtMoney(total)}. Предоплата ${fmtMoney(prepayment(total))}, остаток ${fmtMoney(Math.max(0, total - prepayment(total)))} — после монтажа.`,
          deal.schedule?.installAt
            ? `3. Срок монтажа: ${docDate(deal.schedule.installAt)}${deal.schedule.timeStart ? `, ${deal.schedule.timeStart}` : ''}. Срок может сдвигаться по согласованию сторон.`
            : '3. Срок монтажа согласуется после замера и фиксируется в наряде.',
          '4. Гарантия на изделие и монтаж — 24 месяца с даты подписания акта.',
        ],
        details: [
          ...scheduleLine(deal),
          { label: 'Сумма договора', value: fmtMoney(total) },
          { label: 'Предоплата', value: fmtMoney(prepayment(total)) },
        ],
        notes: [
          'Заказчик обязуется обеспечить доступ в помещение и электропитание на время монтажа.',
          'Изменения состава работ оформляются дополнительным соглашением.',
        ],
        signatures: [`Исполнитель: ${company}`, `Заказчик: ${clientName}`],
      };

    case 'work':
      return {
        ...base,
        rows,
        intro: [
          `Наряд на монтаж по заказу «${deal.title}».`,
          'Состав работ — по позициям ниже; материалы привозит бригада.',
        ],
        details: [
          ...scheduleLine(deal),
          { label: 'Телефон клиента', value: client?.phones[0] || deal.schedule?.phone || '—' },
          { label: 'Ответственный', value: deal.manager || settings.myName || '—' },
          ...(deal.schedule?.note ? [{ label: 'Как пройти / что знать', value: deal.schedule.note }] : []),
        ],
        notes: [
          'Бригада фотографирует «до» и «после» и отмечает монтаж в приложении.',
          'Замечания клиента фиксируются в акте.',
        ],
        signatures: ['Сдал: мастер', 'Принял: клиент'],
      };

    case 'act':
    default:
      return {
        ...base,
        rows,
        intro: [
          `Акт выполненных работ по заказу «${deal.title}» от ${docDate(day)}.`,
          `Работы выполнены в полном объёме. Стоимость работ — ${fmtMoney(total)}.`,
        ],
        details: [
          ...(deal.schedule?.installAt ? [{ label: 'Дата монтажа', value: docDate(deal.schedule.installAt) }] : []),
          { label: 'Оплачено', value: fmtMoney(paid) },
          { label: 'Остаток к оплате', value: fmtMoney(remainder) },
        ],
        notes: [
          'Заказчик претензий по объёму, качеству и срокам не имеет.',
          remainder > 0
            ? `К оплате остаётся ${fmtMoney(remainder)}.`
            : 'Заказ оплачен полностью.',
        ],
        signatures: ['Сдал: мастер', 'Принял: заказчик'],
      };
  }
}

/** Что клиенту показывать на странице статуса. */
export const STATUS_TEXT: Record<DealStatus, string> = {
  draft: 'Заявка принята, готовим расчёт',
  calculating: 'Считаем стоимость',
  offerSent: 'Отправили предложение',
  clientThinking: 'Ждём вашего решения',
  approved: 'Заказ подтверждён',
  techCheck: 'Идёт техническая проверка',
  factorySent: 'Заказ передан на фабрику',
  production: 'Изготовление',
  ready: 'Готово, ждём доставку',
  delivered: 'Доставлено',
  rejected: 'Заказ закрыт',
};

/** Подпись под названием документа — в списке в карточке заказа. */
export function documentSubtitle(model: Pick<DocumentModel, 'kind' | 'issuedAt' | 'total'>): string {
  return `${docDate(model.issuedAt)} · ${fmtMoney(model.total)}`;
}

/* ------------------------------ печатная форма ------------------------------ */

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function num(value: number): string {
  return value.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

/** Тело документа для печати и «Сохранить как PDF». Только строка — без DOM. */
export function documentHtml(model: DocumentModel): string {
  const rows = model.rows.map((row, index) => `
    <tr>
      <td class="num">${index + 1}</td>
      <td>${esc(row.title)}</td>
      <td class="num">${num(row.qty)}</td>
      <td>${esc(row.unit)}</td>
      <td class="num">${esc(fmtMoney(row.price))}</td>
      <td class="num">${esc(fmtMoney(row.amount))}</td>
    </tr>`).join('');

  const details = model.details
    .filter((row) => row.value)
    .map((row) => `<tr><td>${esc(row.label)}</td><td>${esc(row.value)}</td></tr>`)
    .join('');

  const showMoney = model.kind !== 'work';
  const money = showMoney
    ? `<table class="docs-money">
        <tr><td>Итого</td><td>${esc(fmtMoney(model.total))}</td></tr>
        ${model.paid > 0 ? `<tr><td>Оплачено</td><td>${esc(fmtMoney(model.paid))}</td></tr>` : ''}
        ${model.kind === 'act' ? `<tr class="strong"><td>Остаток</td><td>${esc(fmtMoney(model.remainder))}</td></tr>` : ''}
        ${model.kind === 'contract' ? `<tr><td>Предоплата</td><td>${esc(fmtMoney(prepayment(model.total)))}</td></tr>` : ''}
      </table>`
    : '';

  return `
    <div class="docs-head">
      <div>
        <div class="docs-company">${esc(model.company)}</div>
        <h1>${esc(model.title)}</h1>
        <div class="muted">№ ${esc(model.number)} от ${esc(docDate(model.issuedAt))}</div>
      </div>
      <div class="docs-subject">
        <div class="muted">Заказчик</div>
        <b>${esc(model.client)}</b>
        <div class="muted">${esc(model.subject)}</div>
      </div>
    </div>

    ${model.intro.map((text) => `<p>${esc(text)}</p>`).join('')}

    ${details ? `<h2>Условия</h2><table class="docs-details">${details}</table>` : ''}

    <h2>${model.kind === 'act' ? 'Выполненные работы' : model.kind === 'work' ? 'Что делать' : 'Состав заказа'}</h2>
    <table class="docs-grid">
      <thead>
        <tr><th>№</th><th>Наименование</th><th>Кол-во</th><th>Ед.</th><th>Цена</th><th>Сумма</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    ${money}

    ${model.notes.length ? `<h2>Примечания</h2><ul class="docs-notes">${model.notes.map((note) => `<li>${esc(note)}</li>`).join('')}</ul>` : ''}

    <div class="docs-sign">
      <div><span>${esc(model.signatures[0])}</span><i></i></div>
      <div><span>${esc(model.signatures[1])}</span><i></i></div>
    </div>
  `;
}

/** Имя файла: КП-2026-001-Кухня-на-Ленина.html */
export function documentFileName(model: Pick<DocumentModel, 'number' | 'subject'>): string {
  const safe = model.subject.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, '-').slice(0, 40).replace(/-+$/, '');
  return `${model.number}${safe ? `-${safe}` : ''}.html`;
}
