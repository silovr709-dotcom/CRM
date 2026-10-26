import { describe, expect, it } from 'vitest';
import { spansFromTsv } from './ocr';
import { parseManifestItems, shipmentRowItems, SHIPMENT_ROWS } from './warehouse';

const TSV = [
  'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext',
  '5\t1\t1\t1\t1\t1\t20\t50\t60\t14\t95\tКаркас',
  '5\t1\t1\t1\t1\t2\t220\t50\t10\t14\t96\t2',
  '1\t1\t1\t0\t0\t0\t0\t0\t500\t800\t-1\t',
].join('\n');

describe('распознавание скана (OCR)', () => {
  it('превращает слова OCR в координаты: y переворачивается сверху вниз', () => {
    const spans = spansFromTsv(TSV, 800);
    expect(spans).toEqual([
      { str: 'Каркас', x: 20, y: 736, width: 60, page: 1 },
      { str: '2', x: 220, y: 736, width: 10, page: 1 },
    ]);
  });

  it('слова OCR раскладываются по заказам, как текст настоящего PDF', () => {
    const word = (text: string, left: number, top: number, width = 20) =>
      ['5', '1', '1', '1', '1', '1', String(left), String(top), String(width), '12', '90', text].join('\t');
    const header = 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext';
    const tsv = [header,
      word('91_53d4', 200, 40, 50), word('91_61d2', 300, 40, 50),
      word('Каркас', 20, 80, 50), word('2', 220, 80, 10), word('1', 320, 80, 10),
      word('Итого', 20, 120, 40), word('3', 220, 120, 10), word('4', 320, 120, 10),
    ].join('\n');
    const parsed = parseManifestItems([spansFromTsv(tsv, 800)]);
    expect(parsed.orders.map((order) => [order.orderNo, order.packages])).toEqual([
      ['91_53d4', 3],
      ['91_61d2', 4],
    ]);
    expect(parsed.orders[0].items).toEqual([{ name: 'Каркас', qty: 2 }]);
  });

  it('битый TSV даёт пустой список, а не исключение', () => {
    expect(spansFromTsv('мусор', 800)).toEqual([]);
    expect(spansFromTsv('', 800)).toEqual([]);
  });
});

describe('позиции ведомости списком', () => {
  it('подставляет все строки бланка — названия вбивать не нужно', () => {
    const items = shipmentRowItems();
    expect(items.map((item) => item.name)).toEqual(SHIPMENT_ROWS);
    expect(items.every((item) => item.qty === 0)).toBe(true);
  });

  it('не дублирует уже распознанные и сохраняет их количество', () => {
    const items = shipmentRowItems([{ name: 'Каркас', qty: 2 }, { name: 'Своя позиция', qty: 1 }]);
    expect(items.filter((item) => item.name === 'Каркас')).toEqual([{ name: 'Каркас', qty: 2 }]);
    expect(items[1]).toEqual({ name: 'Своя позиция', qty: 1 });
    expect(items).toHaveLength(SHIPMENT_ROWS.length + 1);
  });
});
