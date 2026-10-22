// Модель единого приложения: клиенты, сделки, задачи, оплаты и график монтажей.
// Одна сделка = один заказ: в ней же живут задачи, платежи и даты монтажа.

/** Этапы сделки — те же, что были в CRM калькулятора. */
export type DealStatus =
  | 'draft'
  | 'calculating'
  | 'offerSent'
  | 'clientThinking'
  | 'approved'
  | 'techCheck'
  | 'factorySent'
  | 'production'
  | 'ready'
  | 'delivered'
  | 'rejected';

export type TaskKind = 'call' | 'meet' | 'measure' | 'docs' | 'payment' | 'delivery' | 'other';

export type PaymentKind = 'prepay' | 'final' | 'extra' | 'refund';

export type ScheduleStatus = 'planned' | 'confirmed' | 'done' | 'problem';

export type HistoryKind = 'note' | 'status' | 'contact' | 'document' | 'payment' | 'project';

export interface Client {
  id: string;
  name: string;
  phones: string[];
  emails: string[];
  /** Адрес объекта — подставляется в монтаж. */
  address?: string;
  source?: string;
  managerComment?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface DealTask {
  id: string;
  title: string;
  kind: TaskKind;
  /** Срок YYYY-MM-DD. Пусто — «когда-нибудь». */
  dueAt?: string;
  done?: boolean;
  doneAt?: string;
  assignee?: string;
  comment?: string;
  /** `auto:<правило>` — задачу поставила автоматика. */
  origin?: string;
  createdAt: string;
}

export interface Payment {
  id: string;
  /** Сумма в рублях; возврат — отрицательный. */
  amount: number;
  /** Дата YYYY-MM-DD. */
  at: string;
  kind: PaymentKind;
  comment?: string;
}

export interface HistoryEntry {
  id: string;
  createdAt: string;
  kind: HistoryKind;
  title: string;
  text?: string;
}

/** Плановые даты заказа: замер, готовность на фабрике, доставка и монтаж. */
export interface DealSchedule {
  measureAt?: string;
  readyAt?: string;
  deliveryAt?: string;
  installAt?: string;
  /** Сколько дней занимает монтаж, по умолчанию 1. */
  installDays?: number;
  team?: string;
  address?: string;
  phone?: string;
  note?: string;
  status: ScheduleStatus;
}

export interface Deal {
  id: string;
  /** Название заказа, например «Кухня на Ленина». */
  title: string;
  clientId: string;
  /** Сумма заказа для клиента. */
  amount: number;
  /** Ответственный менеджер. */
  manager?: string;
  status: DealStatus;
  /** Следующий шаг по сделке словами. */
  nextAction?: string;
  /** Когда связаться с клиентом, YYYY-MM-DD. */
  nextContactAt?: string;
  /** Причина отказа. */
  lostReason?: string;
  comment?: string;
  tasks: DealTask[];
  payments: Payment[];
  history: HistoryEntry[];
  schedule: DealSchedule;
  createdAt: string;
  updatedAt: string;
}

export interface Settings {
  companyName: string;
  managers: string[];
  teams: string[];
  /** Показывать подсказки-подсказки на экранах. */
  hints: boolean;
}

export interface AppData {
  version: 1;
  clients: Client[];
  deals: Deal[];
  settings: Settings;
  createdAt: string;
  updatedAt: string;
}
