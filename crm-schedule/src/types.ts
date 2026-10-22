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

/** Тип вложения: по нему выбираются иконка и способ превью. */
export type AttachmentKind = 'photo' | 'document' | 'drawing' | 'contract' | 'other';

/**
 * Вложение сделки или клиента. Сам файл лежит в IndexedDB, здесь — только
 * описание: имя, тип, размер и дата. Благодаря этому копия JSON остаётся лёгкой.
 */
export interface Attachment {
  id: string;
  name: string;
  mime: string;
  /** Размер в байтах. */
  size: number;
  kind: AttachmentKind;
  createdAt: string;
  note?: string;
  width?: number;
  height?: number;
  /** Добавил: имя менеджера на момент загрузки. */
  addedBy?: string;
}

/** Как часто повторять задачу после выполнения. */
export type TaskRepeat = 'daily' | 'weekdays' | 'weekly' | 'monthly';

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
  /** Договоры, фото объекта и прочие файлы клиента. */
  attachments?: Attachment[];
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
  /** `auto:<правило>` — задачу поставила автоматика, `repeat:<id>` — повтор. */
  origin?: string;
  repeat?: TaskRepeat;
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
  /** Время начала и окончания для дня монтажа, HH:MM. */
  timeStart?: string;
  timeEnd?: string;
  /** Сколько дней занимает монтаж, по умолчанию 1. */
  installDays?: number;
  team?: string;
  address?: string;
  phone?: string;
  note?: string;
  status: ScheduleStatus;
  /** За сколько минут напомнить. Пусто — общие настройки. */
  reminders?: number[];
}

export interface Deal {
  id: string;
  /** Название заказа, например «Кухня на Ленина». */
  title: string;
  clientId: string;
  /** Сумма заказа для клиента. 0 — сумма ещё не заполнена. */
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
  /** Документы заказа: договор, эскизы, чеки, фото с монтажа. */
  attachments?: Attachment[];
  history: HistoryEntry[];
  schedule: DealSchedule;
  createdAt: string;
  updatedAt: string;
}

/* ----------------------------- настройки ------------------------------ */

export type ThemeMode = 'light' | 'dark' | 'system';

export interface MessageTemplate {
  id: string;
  title: string;
  /** Текст с подстановками: {client} {deal} {total} {paid} {remainder} {date} {team}. */
  text: string;
  /** Показывать в карточке сделки. */
  enabled: boolean;
}

export type RuleId = 'callAfterOffer' | 'contractAfterApproval' | 'askPrepayment' | 'afterInstall' | 'stuckDeal';

export interface AutomationRule {
  id: RuleId;
  label: string;
  hint: string;
  /** Через сколько дней срабатывает. */
  days: number;
  enabled: boolean;
}

export interface Settings {
  companyName: string;
  /** Имя текущего пользователя: «мои сделки» и подписи. */
  myName: string;
  managers: string[];
  teams: string[];
  hints: boolean;
  theme: ThemeMode;
  /** Браузерные напоминания о монтажах. */
  notifications: boolean;
  /** За сколько минут напоминать по умолчанию. */
  reminderMinutes: number;
  messageTemplates: MessageTemplate[];
  rules: AutomationRule[];
  /** Показывать баннер «это демо-данные». */
  demo: boolean;
}

export interface AppData {
  version: 2;
  clients: Client[];
  deals: Deal[];
  settings: Settings;
  createdAt: string;
  updatedAt: string;
}
