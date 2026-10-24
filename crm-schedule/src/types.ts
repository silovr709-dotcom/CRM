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
  /** Личные напоминания: важнее общих правил «Задачи» из настроек. */
  reminder?: TaskReminder;
  createdAt: string;
}

/** Статья затрат по заказу — из чего складывается себестоимость. */
export type ExpenseKind = 'materials' | 'factory' | 'install' | 'delivery' | 'other';

/**
 * Затрата по сделке. Сумма в рублях; отдельно от оплат клиента:
 * оплаты — это деньги «в», затраты — деньги «из». Маржа = оплаты − затраты.
 */
export interface Expense {
  id: string;
  kind: ExpenseKind;
  amount: number;
  /** Дата YYYY-MM-DD. */
  at: string;
  comment?: string;
  /** Кто внёс — для истории. */
  addedBy?: string;
}

/** Платёж, который ещё не получен, но обещан: план оплат и дебиторка. */
export interface PlannedPayment {
  id: string;
  /** Сколько должны получить; для возврата — отрицательная. */
  amount: number;
  /** Дата ожидания YYYY-MM-DD. */
  at: string;
  kind: PaymentKind;
  comment?: string;
  /** Отметка «получено»: id фактического платежа, если уже пришёл. */
  paidId?: string;
}

export interface Payment {
  id: string;
  /** Сумма в рублях; возврат — отрицательный. */
  amount: number;
  /** Дата YYYY-MM-DD. */
  at: string;
  kind: PaymentKind;
  comment?: string;
  /** Кто внёс платёж. */
  author?: string;
}

export interface HistoryEntry {
  id: string;
  createdAt: string;
  kind: HistoryKind;
  title: string;
  text?: string;
  /** Кто сделал: имя из настроек на момент действия. */
  author?: string;
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

/**
 * Позиция сметы заказа. Сумма заказа (`amount`) остаётся главной цифрой для
 * клиента; позиции объясняют, из чего она складывается.
 */
export interface DealItem {
  id: string;
  title: string;
  qty: number;
  /** шт., компл., м. п. — как в смете. */
  unit: string;
  /** Цена за единицу, ₽. */
  price: number;
  note?: string;
}

/** Выданный документ заказа: номер запоминаем, чтобы он не менялся. */
export interface IssuedDocument {
  id: string;
  kind: 'offer' | 'estimate' | 'contract' | 'work' | 'act';
  /** КП-2026-001. */
  number: string;
  /** Дата выдачи YYYY-MM-DD. */
  issuedAt: string;
  /** Кто выдал — для истории синхронизации между менеджерами. */
  issuedBy?: string;
}

/** Как связались с клиентом: звонок, мессенджер, почта, встреча. */
export type ContactChannel = 'call' | 'whatsapp' | 'telegram' | 'sms' | 'email' | 'meeting';

/** Чем закончилось касание. */
export type ContactOutcome = 'reached' | 'noAnswer' | 'messaged' | 'scheduled' | 'declined';

/**
 * Одно касание клиента. Журнал нужен, чтобы отвечать на вопросы «кто звонил»,
 * «сколько дней тишина» и «почему просрочен контакт» — по факту, а не по дате.
 */
export interface ContactEntry {
  id: string;
  /** Когда связались, ISO. */
  at: string;
  channel: ContactChannel;
  outcome: ContactOutcome;
  /** Кто из сотрудников — имя на момент действия. */
  author?: string;
  note?: string;
  /** О чём договорились: срок следующего контакта YYYY-MM-DD. */
  nextAt?: string;
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
  /** Журнал общения: звонки, сообщения, встречи. Новые — в конце. */
  contacts?: ContactEntry[];
  /** Причина отказа. */
  lostReason?: string;
  comment?: string;
  /** Позиции сметы: КП и смета печатаются из них. */
  items?: DealItem[];
  /** Выданные документы: номера не переиспользуются. */
  documents?: IssuedDocument[];
  tasks: DealTask[];
  payments: Payment[];
  /** Затраты по заказу: материалы, фабрика, монтаж, доставка. */
  expenses?: Expense[];
  /** План оплат: что и когда клиент должен заплатить. */
  plan?: PlannedPayment[];
  /** Документы заказа: договор, эскизы, чеки, фото с монтажа. */
  attachments?: Attachment[];
  history: HistoryEntry[];
  schedule: DealSchedule;
  createdAt: string;
  updatedAt: string;
}

/* ----------------------------- настройки ------------------------------ */

export type ThemeMode = 'light' | 'dark' | 'system';

/** Роль на устройстве: руководитель, менеджер или монтажник. */
export type RoleId = 'owner' | 'manager' | 'installer';

/**
 * Учётная запись сотрудника. Пароль хранится только отпечатком (PBKDF2),
 * сама учётная запись синхронизируется вместе с базой.
 */
export interface Account {
  id: string;
  name: string;
  role: RoleId;
  /** pbkdf2:<base64> — или weak:<хэш> на устройстве без WebCrypto. */
  hash: string;
  salt: string;
  createdAt: string;
  /** Когда последний раз входил — для списка в «Данных». */
  lastLoginAt?: string;
}

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

/* ----------------------------- напоминания ------------------------------ */

/** Куда доставлять напоминание. */
export type ReminderChannel = 'inapp' | 'browser' | 'sound' | 'title';

export type ReminderPriority = 'low' | 'normal' | 'high';

/** За чем следит правило. */
export type ReminderSource =
  | 'install' | 'measure' | 'delivery' | 'ready'
  | 'task' | 'contact' | 'payment' | 'stale' | 'digest';

/**
 * Правило напоминания: «когда» × «о чём» × «куда».
 * Один и тот же источник можно настроить несколько раз — например,
 * за сутки на почту-в-браузер и за 15 минут со звуком.
 */
export interface ReminderRule {
  id: string;
  label: string;
  enabled: boolean;
  source: ReminderSource;
  /** Минуты до срока: 1440 — за сутки, 0 — в момент, −60 — через час после. */
  offsets: number[];
  /** Время для дат без часов (задачи, контакты, оплата). */
  atTime?: string;
  channels: ReminderChannel[];
  priority: ReminderPriority;
  /** Только сделки, где ответственный — вы. */
  onlyMine?: boolean;
  /** Не будить в тихие часы. */
  respectQuietHours: boolean;
  /** Каждый день заново, пока срок не закрыт (задачи, контакты, зависшие сделки). */
  repeatDaily?: boolean;
  /** Для «зависших» сделок: сколько дней без движения. */
  staleDays?: number;
}

/**
 * Личное напоминание задачи. Если задано — общие правила «Задачи» для неё
 * не работают: либо своё расписание, либо (enabled: false) полная тишина.
 */
export interface TaskReminder {
  enabled: boolean;
  /** Минуты до срока: 1440 — за сутки, 120 — за два часа, −60 — через час после. */
  offsets: number[];
  /** Время дня, если у задачи только дата (по умолчанию 09:00). */
  atTime?: string;
  channels?: ReminderChannel[];
  priority?: ReminderPriority;
  /** Напоминать каждый день, пока задача не выполнена. */
  repeatDaily?: boolean;
  /** Не будить в тихие часы. */
  respectQuietHours?: boolean;
}

export interface QuietHours {
  enabled: boolean;
  from: string;
  to: string;
  /** В субботу и воскресенье тихие часы не действуют. */
  skipWeekends: boolean;
  /** Что делать с попавшим в тихие часы: дождаться или пропустить. */
  mode: 'wait' | 'skip';
}

export interface DigestSettings {
  enabled: boolean;
  /** «08:30». */
  at: string;
  weekdaysOnly: boolean;
  channels: ReminderChannel[];
}

export interface Settings {
  companyName: string;
  /** Имя текущего пользователя: «мои сделки» и подписи. */
  myName: string;
  /** Роль на этом устройстве: что показывать и что разрешено менять.
   *  Действует, пока не заведены учётные записи с паролями. */
  role?: RoleId;
  /** Сотрудники с паролями. Пусто — доступ без входа, как раньше. */
  accounts?: Account[];
  managers: string[];
  teams: string[];
  hints: boolean;
  theme: ThemeMode;
  /** Браузерные напоминания о монтажах. */
  notifications: boolean;
  /** За сколько минут напоминать по умолчанию. */
  reminderMinutes: number;
  messageTemplates: MessageTemplate[];
  /** Правила напоминаний — порядок задаёт вид списка. */
  reminderRules: ReminderRule[];
  quietHours: QuietHours;
  digest: DigestSettings;
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
