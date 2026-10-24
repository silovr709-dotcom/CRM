// Демо-база для первого запуска: показывает, как выглядит рабочий день.
// Все даты считаются от сегодняшнего дня, чтобы календарь сразу был живым.

import type {
  AppData, Client, Deal, DealSchedule, DealTask, Expense, Payment, PlannedPayment,
} from '../types';
import { addDays, todayISO } from './dates';
import { nowIso } from './utils';
import { defaultSettings } from './settings';

function iso(daysFromToday: number, hour = 12): string {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
}

function day(daysFromToday: number): string {
  return addDays(todayISO(), daysFromToday);
}

function client(
  id: string,
  name: string,
  phones: string[],
  emails: string[],
  extra: Partial<Client> = {},
): Client {
  return {
    id,
    name,
    phones,
    emails,
    tags: [],
    createdAt: iso(-60),
    updatedAt: iso(-2),
    ...extra,
  };
}

function task(id: string, title: string, kind: DealTask['kind'], dueIn: number | null, done = false, assignee?: string): DealTask {
  return {
    id,
    title,
    kind,
    dueAt: dueIn === null ? undefined : day(dueIn),
    done,
    doneAt: done ? iso(-1) : undefined,
    assignee,
    createdAt: iso(-6),
  };
}

function payment(id: string, amount: number, daysAgo: number, kind: Payment['kind'], comment?: string): Payment {
  return { id, amount, at: day(-daysAgo), kind, comment };
}

function expense(id: string, kind: Expense['kind'], amount: number, daysAgo: number, comment?: string): Expense {
  return { id, kind, amount, at: day(-daysAgo), comment };
}

/** План оплат: `paidDaysAgo` — уже получено, иначе ждём к дате. */
function plan(id: string, amount: number, inDays: number, kind: PlannedPayment['kind'], paidDaysAgo?: number): PlannedPayment {
  return {
    id,
    amount,
    at: day(inDays),
    kind,
    paidId: paidDaysAgo === undefined ? undefined : `p_${id}`,
  };
}

function schedule(patch: Partial<DealSchedule>): DealSchedule {
  return { status: 'planned', ...patch };
}

export function demoData(): AppData {
  const clients: Client[] = [
    client('cli_anna', 'Анна Смирнова', ['+7 (912) 345-67-89'], ['anna.smirnova@mail.ru'], {
      address: 'ул. Ленина, 42, кв. 15',
      source: 'Рекомендация',
      managerComment: 'Постоянная клиентка, вторая кухня. Любит спокойный стиль.',
      tags: ['Постоянный', 'Рекомендация'],
    }),
    client('cli_dmitry', 'Дмитрий Орлов', ['+7 (903) 118-22-40'], ['d.orlov@yandex.ru'], {
      address: 'ЖК «Северный», корп. 3, кв. 108',
      source: 'Instagram',
      tags: ['Горячий'],
    }),
    client('cli_maria', 'Мария Ковалёва', ['+7 (921) 774-10-33'], ['m.kovaleva@gmail.com'], {
      address: 'ул. Мира, 8, кв. 4',
      source: 'Сайт',
      tags: ['Дизайнер'],
    }),
    client('cli_sergey', 'Сергей Тимофеев', ['+7 (916) 520-77-12'], [], {
      address: 'Коттеджный посёлок «Озёрный», участок 12',
      source: 'Авито',
      managerComment: 'Нужен монтаж до конца месяца — уезжает.',
      tags: ['Срочно'],
    }),
    client('cli_ekaterina', 'Екатерина Назарова', ['+7 (985) 640-19-08'], ['e.nazarova@bk.ru'], {
      address: 'ул. Свободы, 17, кв. 62',
      source: 'Рекомендация',
      tags: ['Плёнка'],
    }),
    client('cli_olga', 'Ольга Кузнецова', ['+7 (926) 301-44-56'], [], {
      address: '',
      source: 'WhatsApp',
      managerComment: 'Адрес объекта уточнить у дизайнера.',
      tags: ['Проблема'],
    }),
    client('cli_artem', 'Артём Волков', ['+7 (909) 882-15-70'], ['a.volkov@mail.ru'], {
      address: 'ул. Гагарина, 3, кв. 21',
      source: 'Повторный',
      tags: ['Постоянный'],
    }),
    client('cli_igor', 'Игорь Лебедев', ['+7 (967) 410-02-18'], [], {
      address: 'д. Малиновка, ул. Дачная, 6',
      source: 'Звонок',
      tags: [],
    }),
  ];

  const deals: Deal[] = [
    {
      id: 'deal_lenina',
      title: 'Кухня на Ленина, 42',
      clientId: 'cli_anna',
      amount: 285000,
      manager: 'Ирина',
      status: 'production',
      nextAction: 'Подтвердить готовность и время доставки',
      nextContactAt: day(1),
      comment: 'Фасады — эмаль, столешница из кварцевого агломерата. Ключи у консьержа.',
      tasks: [
        { ...task('t_len_1', 'Позвонить на фабрику: срок готовности', 'call', 0, false, 'Ирина'), repeat: 'weekdays' },
        task('t_len_2', 'Согласовать доставку с клиентом', 'delivery', 2, false, 'Ирина'),
        task('t_len_3', 'Отправить договор', 'docs', -6, true, 'Ирина'),
      ],
      payments: [
        payment('p_len_1', 100000, 24, 'prepay', 'Предоплата 35%'),
        payment('p_len_2', 90000, 9, 'final', 'Платёж после согласования'),
      ],
      expenses: [
        expense('e_len_1', 'materials', 86000, 22, 'Фасады, столешница, фурнитура'),
        expense('e_len_2', 'factory', 64000, 18, 'Производство корпусов'),
        expense('e_len_3', 'delivery', 6500, 8, 'Доставка и подъём'),
      ],
      plan: [
        plan('pl_len_1', 100000, -24, 'prepay', 24),
        plan('pl_len_2', 90000, 9, 'final', 9),
        plan('pl_len_3', 95000, 16, 'final'),
      ],
      history: [
        { id: 'h_len_1', createdAt: iso(-3), kind: 'status', title: 'Этап: В производстве', text: 'Пакет отправлен на фабрику' },
        { id: 'h_len_2', createdAt: iso(-24), kind: 'payment', title: 'Получена предоплата', text: '100 000 ₽' },
      ],
      schedule: schedule({
        measureAt: day(-26),
        readyAt: day(5),
        deliveryAt: day(9),
        installAt: day(10),
        installDays: 2,
        timeStart: '09:00',
        timeEnd: '14:00',
        team: 'Бригада 1 — Сергей',
        address: 'ул. Ленина, 42, кв. 15',
        phone: '+7 (912) 345-67-89',
        note: 'Заезд с 9:00, лифт грузовой. Парковка у второго подъезда.',
        status: 'confirmed',
      }),
      createdAt: iso(-40),
      updatedAt: iso(-1),
    },
    {
      id: 'deal_scandi',
      title: 'Кухня «Скандинавия»',
      clientId: 'cli_dmitry',
      amount: 412000,
      manager: 'Ирина',
      status: 'offerSent',
      nextAction: 'Уточнить решение по КП и срокам',
      nextContactAt: day(-1),
      comment: 'Отправляли КП 12 дней назад, клиент просил паузу до зарплаты.',
      contacts: [
        { id: 'ct_sc_1', at: iso(-12), channel: 'whatsapp', outcome: 'messaged', author: 'Ирина', note: 'Отправила КП и смету', nextAt: day(-4) },
        { id: 'ct_sc_2', at: iso(-4), channel: 'call', outcome: 'reached', author: 'Ирина', note: 'Просил перезвонить после зарплаты', nextAt: day(-1) },
        { id: 'ct_sc_3', at: iso(-1), channel: 'call', outcome: 'noAnswer', author: 'Ирина', nextAt: day(0) },
      ],
      tasks: [
        task('t_sc_1', 'Позвонить: узнать решение по КП', 'call', -1, false, 'Ирина'),
        task('t_sc_2', 'Проверить комплектацию с дизайнером', 'meet', 3, false, 'Ирина'),
      ],
      payments: [],
      history: [
        { id: 'h_sc_1', createdAt: iso(-12), kind: 'document', title: 'КП отправлено', text: 'Ссылка отправлена в WhatsApp' },
        { id: 'h_sc_2', createdAt: iso(-4), kind: 'contact', title: 'Клиент просил перезвонить позже' },
      ],
      schedule: schedule({
        measureAt: day(-14),
        installAt: day(21),
        installDays: 3,
        timeStart: '10:00',
        timeEnd: '18:00',
        team: 'Бригада 2 — Андрей',
        address: 'ЖК «Северный», корп. 3, кв. 108',
        phone: '+7 (903) 118-22-40',
        status: 'planned',
      }),
      createdAt: iso(-30),
      updatedAt: iso(-4),
    },
    {
      id: 'deal_wardrobe',
      title: 'Шкаф-купе в прихожую',
      clientId: 'cli_maria',
      amount: 96000,
      manager: 'Олег',
      status: 'clientThinking',
      nextAction: 'Согласовать цвет профиля и заполнение',
      nextContactAt: day(0),
      contacts: [
        { id: 'ct_ward_1', at: iso(-6), channel: 'call', outcome: 'reached', author: 'Олег', note: 'Договорились о замере', nextAt: day(-2) },
        { id: 'ct_ward_2', at: iso(-2), channel: 'whatsapp', outcome: 'messaged', author: 'Олег', note: 'Отправил варианты профиля', nextAt: day(0) },
      ],
      tasks: [task('t_ward_1', 'Отправить варианты цвета профиля', 'docs', 0, false, 'Олег')],
      payments: [payment('p_ward_1', 20000, 6, 'prepay', 'Задаток за замер')],
      expenses: [expense('e_ward_1', 'materials', 38000, 5, 'ЛДСП, профиль, доводчики')],
      plan: [
        plan('pl_ward_1', 20000, -6, 'prepay', 6),
        plan('pl_ward_2', 76000, 18, 'final'),
      ],
      history: [{ id: 'h_ward_1', createdAt: iso(-6), kind: 'payment', title: 'Получен задаток', text: '20 000 ₽' }],
      schedule: schedule({
        measureAt: day(-7),
        readyAt: day(16),
        deliveryAt: day(19),
        installAt: day(20),
        installDays: 1,
        timeStart: '18:00',
        timeEnd: '21:00',
        team: 'Бригада 3 — Илья',
        address: 'ул. Мира, 8, кв. 4',
        phone: '+7 (921) 774-10-33',
        note: 'Клиентка просила после 18:00.',
        status: 'planned',
      }),
      createdAt: iso(-11),
      updatedAt: iso(-2),
    },
    {
      id: 'deal_ozero',
      title: 'Кухня в новостройке',
      clientId: 'cli_sergey',
      amount: 530000,
      manager: 'Ирина',
      status: 'approved',
      nextAction: 'Выставить счёт на предоплату',
      nextContactAt: day(2),
      comment: 'Согласовал КП, ждёт счёт. Монтаж строго до конца месяца.',
      tasks: [
        task('t_oz_1', 'Выставить счёт на предоплату', 'payment', 2, false, 'Ирина'),
        task('t_oz_2', 'Передать проект технологу', 'docs', 1, false, 'Олег'),
      ],
      payments: [],
      expenses: [expense('e_oz_1', 'materials', 210000, 1, 'Закупка под проект')],
      plan: [
        plan('pl_oz_1', 265000, 2, 'prepay'),
        plan('pl_oz_2', 265000, 14, 'final'),
      ],
      history: [{ id: 'h_oz_1', createdAt: iso(-2), kind: 'status', title: 'Этап: Согласовано', text: 'Клиент согласовал КП' }],
      schedule: schedule({
        measureAt: day(-18),
        readyAt: day(14),
        deliveryAt: day(15),
        installAt: day(16),
        installDays: 2,
        timeStart: '09:00',
        timeEnd: '13:00',
        team: 'Бригада 2 — Андрей',
        address: 'Коттеджный посёлок «Озёрный», участок 12',
        phone: '+7 (916) 520-77-12',
        note: 'Дом за забором, нужен пропуск на въезд.',
        status: 'planned',
      }),
      createdAt: iso(-32),
      updatedAt: iso(-2),
    },
    {
      id: 'deal_provence',
      title: 'Кухня «Прованс»',
      clientId: 'cli_ekaterina',
      amount: 318000,
      manager: 'Олег',
      status: 'factorySent',
      nextAction: 'Получить подтверждение фабрики',
      nextContactAt: day(3),
      tasks: [task('t_pr_1', 'Получить подтверждение фабрики', 'call', 3, false, 'Олег')],
      payments: [payment('p_pr_1', 150000, 15, 'prepay', 'Предоплата 47%')],
      expenses: [
        expense('e_pr_1', 'materials', 98000, 12, 'Плёнка, фрезеровка'),
        expense('e_pr_2', 'factory', 72000, 10, 'Производство'),
      ],
      plan: [
        plan('pl_pr_1', 150000, -15, 'prepay', 15),
        plan('pl_pr_2', 168000, 12, 'final'),
      ],
      history: [{ id: 'h_pr_1', createdAt: iso(-5), kind: 'status', title: 'Этап: Передано на фабрику' }],
      schedule: schedule({
        measureAt: day(-20),
        readyAt: day(4),
        deliveryAt: day(6),
        installAt: day(7),
        installDays: 1,
        timeStart: '14:00',
        timeEnd: '18:00',
        team: 'Бригада 2 — Андрей',
        address: 'ул. Свободы, 17, кв. 62',
        phone: '+7 (985) 640-19-08',
        note: 'Плёнка «Мыло», фасады с фрезеровкой 2 категории.',
        status: 'confirmed',
      }),
      createdAt: iso(-28),
      updatedAt: iso(-5),
    },
    {
      id: 'deal_facades',
      title: 'Монтаж фасадов, Свободы 17',
      clientId: 'cli_olga',
      amount: 148000,
      manager: 'Олег',
      status: 'ready',
      nextAction: 'Уточнить адрес и согласовать бригаду',
      nextContactAt: day(0),
      comment: 'Адрес объекта не внесён — уточнить у дизайнера.',
      tasks: [task('t_fa_1', 'Уточнить адрес монтажа', 'call', 0, false, 'Олег')],
      payments: [payment('p_fa_1', 74000, 10, 'prepay', '50% предоплата')],
      expenses: [expense('e_fa_1', 'install', 42000, 8, 'Работа бригады')],
      plan: [plan('pl_fa_1', 74000, 2, 'final')],
      history: [{ id: 'h_fa_1', createdAt: iso(-3), kind: 'status', title: 'Этап: Готово' }],
      schedule: schedule({
        readyAt: day(3),
        deliveryAt: day(9),
        installAt: day(10),
        installDays: 1,
        timeStart: '09:00',
        timeEnd: '13:00',
        team: 'Бригада 1 — Сергей',
        address: '',
        phone: '+7 (926) 301-44-56',
        note: 'Адрес уточняется.',
        status: 'problem',
      }),
      createdAt: iso(-22),
      updatedAt: iso(-3),
    },
    {
      id: 'deal_gagarina',
      title: 'Кухня под сдачу, Гагарина',
      clientId: 'cli_artem',
      amount: 205000,
      manager: 'Ирина',
      status: 'delivered',
      nextAction: 'Запросить отзыв',
      nextContactAt: day(4),
      tasks: [task('t_ga_1', 'Запросить отзыв и фото', 'call', 4, false, 'Ирина')],
      payments: [
        payment('p_ga_1', 100000, 48, 'prepay', 'Предоплата'),
        payment('p_ga_2', 105000, 16, 'final', 'Оплата при выдаче'),
      ],
      expenses: [
        expense('e_ga_1', 'materials', 64000, 40, 'Материалы'),
        expense('e_ga_2', 'install', 28000, 16, 'Монтаж'),
        expense('e_ga_3', 'delivery', 4000, 17, 'Доставка'),
      ],
      history: [{ id: 'h_ga_1', createdAt: iso(-15), kind: 'status', title: 'Этап: Выдано' }],
      schedule: schedule({
        measureAt: day(-45),
        readyAt: day(-20),
        deliveryAt: day(-16),
        installAt: day(-15),
        installDays: 1,
        timeStart: '10:00',
        timeEnd: '16:00',
        team: 'Бригада 1 — Сергей',
        address: 'ул. Гагарина, 3, кв. 21',
        phone: '+7 (909) 882-15-70',
        status: 'done',
      }),
      createdAt: iso(-50),
      updatedAt: iso(-15),
    },
    {
      id: 'deal_dacha',
      title: 'Комплект на дачу',
      clientId: 'cli_igor',
      amount: 87000,
      manager: 'Олег',
      status: 'rejected',
      nextAction: 'Вернуться к клиенту весной',
      lostReason: 'Дорого, выбрал готовый комплект',
      nextContactAt: day(45),
      tasks: [],
      payments: [],
      history: [{ id: 'h_da_1', createdAt: iso(-9), kind: 'status', title: 'Этап: Отказ', text: 'Дорого, выбрал готовый комплект' }],
      schedule: schedule({ measureAt: day(-24) }),
      createdAt: iso(-27),
      updatedAt: iso(-9),
    },
    {
      id: 'deal_modern',
      title: 'Кухня «Модерн» для Анны',
      clientId: 'cli_anna',
      amount: 356000,
      manager: 'Ирина',
      status: 'calculating',
      nextAction: 'Досчитать комплект и подготовить КП',
      nextContactAt: day(3),
      comment: 'Вторая кухня для новой квартиры. Ждёт КП к пятнице.',
      tasks: [task('t_mo_1', 'Подготовить КП к пятнице', 'docs', 3, false, 'Ирина')],
      payments: [],
      history: [{ id: 'h_mo_1', createdAt: iso(-1), kind: 'project', title: 'Сделка создана' }],
      schedule: schedule({ measureAt: day(2), team: 'Бригада 1 — Сергей' }),
      createdAt: iso(-3),
      updatedAt: iso(-1),
    },
    {
      id: 'deal_countertop',
      title: 'Столешница из кварца',
      clientId: 'cli_dmitry',
      amount: 64000,
      manager: 'Олег',
      status: 'draft',
      nextAction: 'Собрать размеры и вызвать замерщика',
      nextContactAt: day(1),
      tasks: [task('t_co_1', 'Согласовать дату замера', 'measure', 1, false, 'Олег')],
      payments: [],
      history: [],
      schedule: schedule({ team: 'Бригада 3 — Илья', address: 'ЖК «Северный», корп. 3, кв. 108' }),
      createdAt: iso(-2),
      updatedAt: iso(-2),
    },
  ];

  return {
    version: 2,
    clients,
    deals,
    settings: {
      ...defaultSettings(),
      companyName: 'Студия кухни',
      myName: 'Ирина',
      managers: ['Ирина', 'Олег'],
      teams: ['Бригада 1 — Сергей', 'Бригада 2 — Андрей', 'Бригада 3 — Илья'],
      demo: true,
    },
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}
