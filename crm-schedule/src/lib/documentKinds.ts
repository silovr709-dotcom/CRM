// Виды документов заказа: подписи, префиксы номеров и порядок в списке.
import type { IssuedDocument } from '../types';

export type DocKind = IssuedDocument['kind'];

export interface DocKindMeta {
  id: DocKind;
  title: string;
  /** Короткое название для кнопки: «КП», «Смета». */
  short: string;
  prefix: string;
  /** Зачем документ — подсказка в карточке. */
  hint: string;
  /** Когда его обычно делают: для подсказки «следующий шаг». */
  when: string;
}

export const DOC_KINDS: DocKindMeta[] = [
  {
    id: 'offer',
    title: 'Коммерческое предложение',
    short: 'КП',
    prefix: 'КП',
    hint: 'Сумма, состав, срок и условия — для решения клиента',
    when: 'перед согласованием',
  },
  {
    id: 'estimate',
    title: 'Смета',
    short: 'Смета',
    prefix: 'СМ',
    hint: 'Позиции с количеством и ценой: из чего складывается сумма',
    when: 'после замера',
  },
  {
    id: 'contract',
    title: 'Договор',
    short: 'Договор',
    prefix: 'ДГ',
    hint: 'Предмет, цена, предоплата, сроки, гарантия',
    when: 'после согласования',
  },
  {
    id: 'work',
    title: 'Наряд на монтаж',
    short: 'Наряд',
    prefix: 'НР',
    hint: 'Что везти и делать бригаде, адрес и телефон',
    when: 'перед монтажом',
  },
  {
    id: 'act',
    title: 'Акт выполненных работ',
    short: 'Акт',
    prefix: 'АК',
    hint: 'Работы сданы, оплата и остаток — для подписи клиента',
    when: 'после монтажа',
  },
];

export function docKindMeta(kind: DocKind): DocKindMeta {
  return DOC_KINDS.find((item) => item.id === kind) ?? DOC_KINDS[0];
}
