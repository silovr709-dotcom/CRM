// Роли: кто что видит и может менять на этом устройстве.
//
// Роль — не «настоящая» защита (база лежит в браузере), а защита от случайного
// взгляда и случайной правки: менеджеру не нужна себестоимость, монтажнику —
// деньги, а руководителю нужен весь отчёт. Данные не шифруются, поэтому роль
// честно описана как «режим экрана», а не как пароль.

import type { RoleId, Settings } from '../types';

export interface RoleMeta {
  id: RoleId;
  label: string;
  /** Кому подходит — одной строкой. */
  hint: string;
  /** Что видит и может: для карточки выбора. */
  sees: string[];
  /** Себестоимость, маржа и отчёты по деньгам. */
  canSeeMoney: boolean;
  /** Затраты и себестоимость конкретного заказа. */
  canSeeExpenses: boolean;
  /** Настройки компании, импорт, очистка базы, общая база. */
  canEditSettings: boolean;
  /** Удаление сделок и клиентов. */
  canDelete: boolean;
  /** График монтажей и отметки о выполнении. */
  canEditSchedule: boolean;
}

export const ROLES: RoleMeta[] = [
  {
    id: 'owner',
    label: 'Руководитель',
    hint: 'всё: деньги, себестоимость, отчёты, настройки',
    sees: ['Все заказы и клиенты', 'Себестоимость и маржа', 'Отчёты и выгрузки', 'Настройки и общая база'],
    canSeeMoney: true,
    canSeeExpenses: true,
    canEditSettings: true,
    canDelete: true,
    canEditSchedule: true,
  },
  {
    id: 'manager',
    label: 'Менеджер',
    hint: 'клиенты, сделки, документы; без себестоимости',
    sees: ['Свои и чужие заказы', 'Суммы и оплаты клиента', 'Документы и статус', 'Без затрат и маржи'],
    canSeeMoney: true,
    canSeeExpenses: false,
    canEditSettings: false,
    canDelete: false,
    canEditSchedule: true,
  },
  {
    id: 'installer',
    label: 'Монтажник',
    hint: 'график, адреса, телефоны; без денег и настроек',
    sees: ['График и адреса', 'Телефоны и задачи', 'Отметки о монтаже', 'Без сумм, затрат и отчётов'],
    canSeeMoney: false,
    canSeeExpenses: false,
    canEditSettings: false,
    canDelete: false,
    canEditSchedule: true,
  },
];

export function roleMeta(role: RoleId | undefined): RoleMeta {
  return ROLES.find((item) => item.id === role) ?? ROLES[0];
}

export function isRole(value: unknown): value is RoleId {
  return value === 'owner' || value === 'manager' || value === 'installer';
}

/** Кто поставил отметку: имя из настроек, иначе нейтральное «сотрудник». */
export function authorName(settings: Pick<Settings, 'myName'>): string {
  return settings.myName.trim() || 'сотрудник';
}

/** Подпись автора для истории: «Ирина · 12.11.2026, 14:05». */
export function authorLine(author: string | undefined, when: string): string {
  return author ? `${author} · ${when}` : when;
}
