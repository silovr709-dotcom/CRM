import { describe, expect, it } from 'vitest';
import {
  buildReceipt, cleanOrderNo, dealOptions, dealReceiptsLine, findDealByOrderNo, isOnStock,
  itemsLine, itemsMismatch, looksLikeOrderNo, orderKey, packagesFromItems, parseManifestText,
  receiptMatches, receiptProblem, receivedLabel, summarizeWarehouse, SHIPMENT_ROWS,
} from './warehouse';
import { makeDeal } from './testUtils';
import type { WarehouseReceipt } from '../types';

function receipt(patch: Partial<WarehouseReceipt> = {}): WarehouseReceipt {
  return {
    id: 'rcpt-1',
    orderNo: '91_53d4',
    receivedAt: '2026-06-11',
    packages: 3,
    items: [{ name: 'Каркас', qty: 2 }, { name: 'Фурнитура', qty: 1 }],
    createdAt: '2026-06-11T10:00:00.000Z',
    updatedAt: '2026-06-11T10:00:00.000Z',
    ...patch,
  };
}

describe('номер заказа', () => {
  it('сравнивается без разделителей и регистра', () => {
    expect(orderKey('91_53d4')).toBe('9153d4');
    expect(orderKey('91-53D4')).toBe(orderKey('91_53d4'));
    expect(orderKey(' 91 53d4 ')).toBe('9153d4');
    expect(orderKey(undefined)).toBe('');
  });

  it('чистится от пробелов', () => {
    expect(cleanOrderNo(' 91 _ 53d4 ')).toBe('91_53d4');
    expect(cleanOrderNo(undefined)).toBe('');
  });

  it('узнаёт формат фабрики', () => {
    expect(looksLikeOrderNo('91_53d4')).toBe(true);
    expect(looksLikeOrderNo('91-15dr')).toBe(true);
    expect(looksLikeOrderNo('9153d4')).toBe(true);
    expect(looksLikeOrderNo('12345')).toBe(false);
    expect(looksLikeOrderNo('кухня')).toBe(false);
  });
});

describe('разбор ведомости', () => {
  const text = [
    '№ заказа 91_53d4 91_61d2 91_15dr',
    'Каркас 2 1 2',
    'Фасады 1 5',
    'Цоколь ПВХ 1',
    'Фурнитура 1 1',
    'Итого (кол-во упаковок) 3 4 8',
    'Дата отгрузки: 11.06.2026',
    'ФИО водителя: Сергей Кузьмин',
    'Отгрузил(а): Ольга',
  ].join('\n');

  it('находит все номера заказов на листе', () => {
    const parsed = parseManifestText(text);
    expect(parsed.orderNos).toEqual(['91_53d4', '91_61d2', '91_15dr']);
  });

  it('достаёт дату отгрузки в формате базы', () => {
    expect(parseManifestText(text).shippedAt).toBe('2026-06-11');
  });

  it('достаёт количество упаковок из строки «Итого»', () => {
    expect(parseManifestText(text).packages).toBe(3);
  });

  it('узнаёт позиции по названиям строк', () => {
    const names = parseManifestText(text).items.map((item) => item.name);
    expect(names).toContain('Каркас');
    expect(names).toContain('Фасады');
    expect(names).toContain('Цоколь ПВХ');
    expect(names).toContain('Фурнитура');
    // Количества из колонок не выдумываем — их проверяет человек.
    expect(parseManifestText(text).items.every((item) => item.qty === 0)).toBe(true);
  });

  it('достаёт водителя и отгрузившего', () => {
    const parsed = parseManifestText(text);
    expect(parsed.driver).toContain('Сергей');
    expect(parsed.shippedBy).toContain('Ольга');
  });

  it('на пустом тексте ничего не выдумывает', () => {
    const parsed = parseManifestText('');
    expect(parsed.orderNos).toEqual([]);
    expect(parsed.packages).toBeUndefined();
    expect(parsed.shippedAt).toBeUndefined();
    expect(parsed.items).toEqual([]);
  });

  it('не принимает за номер заказа дату и сумму', () => {
    expect(parseManifestText('11.06.2026 285000').orderNos).toEqual([]);
  });

  it('знает стандартные строки ведомости', () => {
    expect(SHIPMENT_ROWS.length).toBeGreaterThan(20);
    expect(SHIPMENT_ROWS).toContain('Каркас');
    expect(SHIPMENT_ROWS).toContain('Фурнитура');
  });
});

describe('содержимое прихода', () => {
  it('считает упаковки по позициям', () => {
    expect(packagesFromItems([{ name: 'Каркас', qty: 2 }, { name: 'Фасады', qty: 5 }])).toBe(7);
    expect(packagesFromItems([])).toBe(0);
  });

  it('замечает, что позиции не сходятся с «Итого»', () => {
    expect(itemsMismatch({ items: [{ name: 'Каркас', qty: 2 }], packages: 3 })).toBe(true);
    expect(itemsMismatch({ items: [{ name: 'Каркас', qty: 2 }], packages: 2 })).toBe(false);
    expect(itemsMismatch({ items: [], packages: 3 })).toBe(false);
  });

  it('описывает содержимое строкой', () => {
    expect(itemsLine([])).toBe('состав не заполнен');
    expect(itemsLine([{ name: 'Каркас', qty: 2 }, { name: 'Фасады', qty: 5 }])).toBe('Каркас ×2, Фасады ×5');
    const many = Array.from({ length: 6 }, (_, index) => ({ name: `Позиция ${index + 1}`, qty: 1 }));
    expect(itemsLine(many, 3)).toContain('и ещё 3');
  });

  it('понимает, что заказ ещё на складе', () => {
    expect(isOnStock(receipt())).toBe(true);
    expect(isOnStock(receipt({ issuedAt: '2026-06-12' }))).toBe(false);
  });

  it('пишет, когда привезли', () => {
    expect(receivedLabel(receipt({ receivedAt: '2026-06-11' }), '2026-06-11')).toBe('принято сегодня');
    expect(receivedLabel(receipt({ receivedAt: '2026-06-10' }), '2026-06-11')).toBe('принято вчера');
    expect(receivedLabel(receipt({ receivedAt: '2026-06-08' }), '2026-06-11')).toBe('принято 3 дня назад');
    expect(receivedLabel(receipt({ receivedAt: '2026-05-01' }), '2026-06-11')).toContain('принято 1');
  });
});

describe('поиск по складу', () => {
  it('находит по номеру заказа в любом написании', () => {
    expect(receiptMatches(receipt(), '91_53d4')).toBe(true);
    expect(receiptMatches(receipt(), '9153d4')).toBe(true);
    expect(receiptMatches(receipt(), '53d4')).toBe(true);
    expect(receiptMatches(receipt(), '77_77zz')).toBe(false);
  });

  it('находит по позиции, водителю и заметке', () => {
    const item = receipt({ driver: 'Сергей Кузьмин', note: 'царапина на цоколе' });
    expect(receiptMatches(item, 'каркас')).toBe(true);
    expect(receiptMatches(item, 'сергей')).toBe(true);
    expect(receiptMatches(item, 'царапина')).toBe(true);
  });

  it('находит по номеру заказа сделки, даже если в приходе он записан иначе', () => {
    const deal = makeDeal({ orderNo: '91-53d4' });
    expect(receiptMatches(receipt({ orderNo: '9153D4' }), '91_53d4', deal)).toBe(true);
  });

  it('пустой запрос показывает всё', () => {
    expect(receiptMatches(receipt(), '   ')).toBe(true);
  });
});

describe('сводка склада', () => {
  it('считает упаковки на складе, выдачу и приходы за месяц', () => {
    const summary = summarizeWarehouse([
      receipt({ id: 'a', packages: 3 }),
      receipt({ id: 'b', packages: 4, receivedAt: '2026-06-01' }),
      receipt({ id: 'c', packages: 7, receivedAt: '2026-01-10', issuedAt: '2026-01-12', dealId: 'deal-1' }),
    ], '2026-06-11');

    expect(summary.receipts).toBe(3);
    expect(summary.onStock).toBe(2);
    expect(summary.packagesOnStock).toBe(7);
    expect(summary.issued).toBe(1);
    expect(summary.lastMonth).toBe(2);
    expect(summary.withoutDeal).toBe(2);
    expect(summary.lastReceivedAt).toBe('2026-06-11');
  });

  it('на пустом складе даёт нули, а не ошибки', () => {
    const summary = summarizeWarehouse([], '2026-06-11');
    expect(summary.receipts).toBe(0);
    expect(summary.packagesOnStock).toBe(0);
    expect(summary.lastReceivedAt).toBeUndefined();
  });
});

describe('связь со сделками', () => {
  const deals = [
    makeDeal({ id: 'deal-1', orderNo: '91_53d4', title: 'Кухня Скандинавия' }),
    makeDeal({ id: 'deal-2', orderNo: '91_61d2', title: 'Шкаф-купе' }),
    makeDeal({ id: 'deal-3', title: 'Без номера' }),
  ];

  it('находит сделку по номеру без разделителей', () => {
    expect(findDealByOrderNo(deals, '9153D4')?.id).toBe('deal-1');
    expect(findDealByOrderNo(deals, '')).toBeUndefined();
    expect(findDealByOrderNo(deals, '00_00xx')).toBeUndefined();
  });

  it('предлагает подходящие сделки для привязки', () => {
    expect(dealOptions(deals, '91_53d4')[0].id).toBe('deal-1');
    expect(dealOptions(deals, '').length).toBe(3);
  });

  it('описывает приходы по сделке одной строкой', () => {
    expect(dealReceiptsLine([])).toBe('на склад не приходило');
    expect(dealReceiptsLine([
      receipt({ receivedAt: '2026-06-01', packages: 3 }),
      receipt({ id: 'b', receivedAt: '2026-06-10', packages: 4 }),
    ])).toContain('7 уп.');
  });
});

describe('запись прихода', () => {
  it('не сохраняет без номера заказа и даты', () => {
    expect(receiptProblem({ orderNo: '' })).toContain('номер заказа');
    expect(receiptProblem({ orderNo: '91_53d4' })).toContain('дату приёмки');
    expect(receiptProblem({ orderNo: '91_53d4', receivedAt: '2026-06-11' })).toBe('');
  });

  it('собирает запись с чистыми полями', () => {
    const created = buildReceipt({
      orderNo: ' 91 _ 53d4 ',
      items: [{ name: ' Каркас ', qty: 2 }, { name: '  ', qty: 5 }, { name: 'Фасады', qty: -3 }],
      packages: 3,
      driver: ' Сергей ',
      receivedAt: '2026-06-11',
      author: 'Ирина',
    }, 'rcpt-9', '2026-06-11T12:00:00.000Z');

    expect(created.orderNo).toBe('91_53d4');
    expect(created.items).toEqual([{ name: 'Каркас', qty: 2 }, { name: 'Фасады', qty: 0 }]);
    expect(created.driver).toBe('Сергей');
    expect(created.author).toBe('Ирина');
    expect(created.createdAt).toBe('2026-06-11T12:00:00.000Z');
  });

  it('без даты приёмки ставит сегодня', () => {
    expect(buildReceipt({ orderNo: '91_53d4' }, 'rcpt-1').receivedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
