// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Client, DealItem, Settings } from '../types';
import { fmtMoney } from './dates';
import { makeDeal } from './testUtils';
import { emptyData } from './storage';
import {
  buildDocument, docDate, documentNumber, documentRows, documentSubtitle, itemAmount, itemsTotal,
  nextSequence, prepayment, promisedDate, STATUS_TEXT,
} from './documents';
import { DOC_KINDS, docKindMeta } from './documentKinds';

const settings: Settings = { ...emptyData().settings, companyName: 'Кухни Лада', myName: 'Ирина' };

const client: Client = {
  id: 'client-1',
  name: 'Анна Смирнова',
  phones: ['+7 900 000-00-00'],
  emails: [],
  address: 'Ленина, 42',
  tags: [],
  createdAt: '2026-01-01T09:00:00.000Z',
  updatedAt: '2026-01-01T09:00:00.000Z',
};

function items(): DealItem[] {
  return [
    { id: 'i1', title: 'Шкафы верхние', qty: 4, unit: 'шт.', price: 12000 },
    { id: 'i2', title: 'Столешница', qty: 2.5, unit: 'м. п.', price: 8000 },
  ];
}

describe('смета заказа', () => {
  it('считает сумму позиции и всего', () => {
    expect(itemAmount({ qty: 4, price: 12000 })).toBe(48000);
    expect(itemAmount({ qty: 2.5, price: 8000 })).toBe(20000);
    expect(itemsTotal(items())).toBe(68000);
    expect(itemsTotal([])).toBe(0);
    expect(itemsTotal(undefined)).toBe(0);
  });

  it('без позиций печатает одну строку «по договору»', () => {
    const deal = makeDeal({ amount: 285000, items: [] });
    const rows = documentRows(deal);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ qty: 1, unit: 'компл.', price: 285000, amount: 285000 });
  });

  it('с позициями переводит смету в строки документа', () => {
    const rows = documentRows(makeDeal({ items: items() }));
    expect(rows.map((row) => row.amount)).toEqual([48000, 20000]);
    expect(rows[1].unit).toBe('м. п.');
  });
});

describe('номера документов', () => {
  it('делает номер с префиксом вида и годом', () => {
    expect(documentNumber('offer', 2026, 1)).toBe('КП-2026-001');
    expect(documentNumber('contract', 2026, 42)).toBe('ДГ-2026-042');
    expect(docKindMeta('act').prefix).toBe('АК');
  });

  it('продолжает нумерацию своего вида и своего года', () => {
    const issued = [
      { kind: 'offer', number: 'КП-2026-001' },
      { kind: 'offer', number: 'КП-2026-007' },
      { kind: 'contract', number: 'ДГ-2026-009' },
      { kind: 'offer', number: 'КП-2025-099' },
    ];
    expect(nextSequence('offer', 2026, issued)).toBe(8);
    expect(nextSequence('contract', 2026, issued)).toBe(10);
    expect(nextSequence('estimate', 2026, issued)).toBe(1);
    expect(nextSequence('offer', 2025, issued)).toBe(100);
  });

  it('все виды документов описаны по-русски', () => {
    expect(DOC_KINDS).toHaveLength(5);
    for (const kind of DOC_KINDS) {
      expect(kind.title.length).toBeGreaterThan(3);
      expect(kind.hint.length).toBeGreaterThan(10);
      expect(kind.prefix).toMatch(/^[А-Я]+$/);
    }
  });
});

describe('содержание документов', () => {
  it('КП объясняет состав, срок и условия оплаты', () => {
    const deal = makeDeal({
      items: items(),
      amount: 68000,
      status: 'offerSent',
      schedule: { status: 'planned', address: 'Ленина, 42', installAt: '2026-12-01' },
    });
    const doc = buildDocument({ kind: 'offer', number: 'КП-2026-001', issuedAt: '2026-11-01', deal, client, settings });

    expect(doc.title).toBe('Коммерческое предложение');
    expect(doc.client).toBe('Анна Смирнова');
    expect(doc.total).toBe(68000);
    expect(doc.rows).toHaveLength(2);
    expect(doc.intro.join(' ')).toContain('Кухни Лада');
    expect(doc.details.some((row) => row.label === 'Адрес объекта' && row.value === 'Ленина, 42')).toBe(true);
    expect(doc.details.some((row) => row.value.includes('01.12.2026'))).toBe(true);
    expect(doc.notes.join(' ')).toContain('предоплата 50%');
  });

  it('смета показывает расхождение с суммой заказа, но не переписывает её', () => {
    const deal = makeDeal({ items: items(), amount: 70000 });
    const doc = buildDocument({ kind: 'estimate', number: 'СМ-2026-001', issuedAt: '2026-11-01', deal, client, settings });

    expect(doc.itemsTotal).toBe(68000);
    expect(doc.total).toBe(68000);
    expect(doc.notes.join(' ')).toContain(`в карточке заказа указано ${fmtMoney(70000)}`);
  });

  it('смета без позиций берёт сумму заказа', () => {
    const doc = buildDocument({
      kind: 'estimate', number: 'СМ-2026-002', issuedAt: '2026-11-01',
      deal: makeDeal({ amount: 285000 }), client, settings,
    });
    expect(doc.total).toBe(285000);
    expect(doc.itemsTotal).toBe(285000);
    expect(doc.notes.join(' ')).not.toContain('в карточке заказа указано');
  });

  it('договор считает предоплату и остаток', () => {
    const deal = makeDeal({
      amount: 285000,
      payments: [{ id: 'p1', amount: 100000, at: '2026-11-02', kind: 'prepay' }],
      schedule: { status: 'planned', installAt: '2026-12-10', timeStart: '10:00' },
    });
    const doc = buildDocument({ kind: 'contract', number: 'ДГ-2026-001', issuedAt: '2026-11-01', deal, client, settings });

    expect(prepayment(285000)).toBe(142500);
    expect(prepayment(0)).toBe(0);
    expect(doc.intro.join(' ')).toContain(fmtMoney(142500));
    expect(doc.details).toContainEqual({ label: 'Предоплата', value: fmtMoney(142500) });
    expect(doc.intro.join(' ')).toContain('10.12.2026');
    expect(doc.signatures[1]).toContain('Анна Смирнова');
  });

  it('наряд на монтаж — это задание бригаде с адресом и телефоном', () => {
    const deal = makeDeal({
      items: items(),
      schedule: {
        status: 'confirmed', installAt: '2026-12-10', timeStart: '09:00', timeEnd: '14:00',
        team: 'Бригада №2', address: 'Ленина, 42', phone: '+7 900 111-22-33', note: 'Код домофона 42',
      },
    });
    const doc = buildDocument({ kind: 'work', number: 'НР-2026-001', issuedAt: '2026-12-05', deal, client, settings });
    const values = doc.details.map((row) => row.value).join(' | ');

    expect(values).toContain('Бригада №2');
    expect(values).toContain('09:00–14:00');
    expect(values).toContain('+7 900 000-00-00');
    expect(values).toContain('Код домофона 42');
    expect(doc.rows).toHaveLength(2);
  });

  it('акт считает остаток и пишет про претензии', () => {
    const deal = makeDeal({
      amount: 285000,
      items: items(),
      payments: [{ id: 'p1', amount: 200000, at: '2026-12-10', kind: 'final' }],
    });
    const doc = buildDocument({ kind: 'act', number: 'АК-2026-001', issuedAt: '2026-12-10', deal, client, settings });

    expect(doc.total).toBe(68000);
    expect(doc.paid).toBe(200000);
    // Оплатили больше суммы позиций — остатка нет, отрицательных чисел не показываем.
    expect(doc.remainder).toBe(0);
    expect(doc.notes.join(' ')).toContain('Заказ оплачен полностью');
    expect(doc.notes.join(' ')).toContain('претензий');
  });

  it('подпись документа короткая: дата и сумма', () => {
    const doc = buildDocument({
      kind: 'offer', number: 'КП-2026-003', issuedAt: '2026-11-05',
      deal: makeDeal({ amount: 285000 }), client, settings,
    });
    expect(docDate('2026-11-05')).toBe('05.11.2026');
    expect(docDate('')).toBe('—');
    expect(documentSubtitle(doc)).toBe(`05.11.2026 · ${fmtMoney(285000)}`);
  });
});

describe('даты и статусы для клиента', () => {
  it('обещанная дата — самая понятная клиенту', () => {
    expect(promisedDate(makeDeal({ schedule: { status: 'planned', readyAt: '2026-12-01', installAt: '2026-12-10' } })))
      .toBe('2026-12-10');
    expect(promisedDate(makeDeal({ schedule: { status: 'planned', deliveryAt: '2026-12-05' } }))).toBe('2026-12-05');
    expect(promisedDate(makeDeal())).toBe('');
  });

  it('у каждого этапа есть понятный клиенту текст', () => {
    expect(STATUS_TEXT.production).toBe('Изготовление');
    expect(Object.values(STATUS_TEXT).every((text) => text.length > 5)).toBe(true);
    expect(Object.keys(STATUS_TEXT)).toHaveLength(11);
  });
});
