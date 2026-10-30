// Движок напоминаний: правила «когда × о чём × куда».
//
// Момент — событие со сроком (монтаж, задача, следующий контакт…).
// Правило задаёт смещения в минутах до срока. Пересечение даёт напоминания,
// которые движок отдаёт на доставку. Всё чистыми функциями: без таймеров,
// без DOM — поэтому проверяется тестами и не зависит от браузера.
import type {
  CalendarEvent, Deal, DigestSettings, QuietHours, ReminderChannel, ReminderPriority, ReminderRule,
  ReminderSource, Settings, TaskReminder,
} from '../types';
import { addDays, isoDay, parseDay, todayISO } from './dates';
import { isClosedStatus } from './crm';
import { paymentState } from './crmTasks';
import { calendarEvents, collectEvents } from './schedule';

/* ------------------------------- время --------------------------------- */

/** Минуты с полуночи из «HH:MM». */
function minutesOfTime(time?: string, fallback = 9 * 60): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec((time ?? '').trim());
  if (!match) return fallback;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return fallback;
  return hours * 60 + minutes;
}

/** Дата (YYYY-MM-DD) + время (HH:MM) → локальный момент. */
export function momentAt(day: string, time?: string, fallback = '09:00'): Date {
  const base = parseDay(day);
  if (Number.isNaN(base.getTime())) return new Date(Number.NaN);
  const minutes = minutesOfTime(time, minutesOfTime(fallback));
  base.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return base;
}

export function dayKey(date: Date): string {
  return isoDay(date);
}

/* ------------------------------- правила -------------------------------- */

export const SOURCE_META: Record<ReminderSource, { label: string; hint: string; what: string }> = {
  install: { label: 'Монтаж', hint: 'по дате монтажа в графике', what: 'монтаж' },
  measure: { label: 'Замер', hint: 'по дате замера', what: 'замер' },
  delivery: { label: 'Доставка', hint: 'по дате доставки', what: 'доставка' },
  ready: { label: 'Готовность на фабрике', hint: 'когда заказ готов к отгрузке', what: 'готовность' },
  task: { label: 'Задачи', hint: 'по сроку задачи; у отдельной задачи можно задать своё', what: 'задача' },
  contact: { label: 'Связаться с клиентом', hint: 'по дате следующего контакта', what: 'контакт' },
  payment: { label: 'Остаток к оплате', hint: 'если к монтажу не всё оплачено', what: 'оплата' },
  stale: { label: 'Сделка без движения', hint: 'нет изменений столько дней', what: 'сделка' },
  digest: { label: 'Сводка на день', hint: 'одно сообщение со всеми делами', what: 'сводка' },
  custom: { label: 'Событие графика', hint: 'свободное событие без сделки: встреча, выходной, отгрузка', what: 'событие' },
};

export const OFFSET_PRESETS: Array<{ minutes: number; label: string; short: string }> = [
  { minutes: 7 * 24 * 60, label: 'за неделю', short: '7 дн' },
  { minutes: 3 * 24 * 60, label: 'за 3 дня', short: '3 дн' },
  { minutes: 24 * 60, label: 'за сутки', short: '1 дн' },
  { minutes: 3 * 60, label: 'за 3 часа', short: '3 ч' },
  { minutes: 60, label: 'за час', short: '1 ч' },
  { minutes: 30, label: 'за 30 минут', short: '30 м' },
  { minutes: 15, label: 'за 15 минут', short: '15 м' },
  { minutes: 0, label: 'в момент срока', short: '0' },
  { minutes: -60, label: 'через час после', short: '−1 ч' },
  { minutes: -24 * 60, label: 'на следующий день', short: '−1 дн' },
];

export const CHANNEL_META: Record<ReminderChannel, { label: string; hint: string }> = {
  inapp: { label: 'В приложении', hint: 'тост и колокольчик' },
  browser: { label: 'Уведомление системы', hint: 'всплывает, даже если вкладка свёрнута' },
  sound: { label: 'Звук', hint: 'короткий сигнал' },
  title: { label: 'В заголовке вкладки', hint: 'счётчик и значок, пока не откроете' },
};

export const PRIORITY_META: Record<ReminderPriority, { label: string }> = {
  low: { label: 'Тихо' },
  normal: { label: 'Обычно' },
  high: { label: 'Важно' },
};

/** Настройки по умолчанию: разумный набор, который не будит по ночам. */
export function defaultReminderRules(): ReminderRule[] {
  return [
    {
      id: 'rule-install-day',
      label: 'Монтаж накануне вечером',
      enabled: true,
      source: 'install',
      offsets: [24 * 60],
      channels: ['inapp', 'browser'],
      priority: 'normal',
      respectQuietHours: true,
    },
    {
      id: 'rule-install-soon',
      label: 'Монтаж через 2 часа',
      enabled: true,
      source: 'install',
      offsets: [120, 30],
      channels: ['inapp', 'browser', 'sound'],
      priority: 'high',
      respectQuietHours: true,
    },
    {
      id: 'rule-install-now',
      label: 'Пора выезжать',
      enabled: true,
      source: 'install',
      offsets: [0],
      channels: ['browser', 'sound', 'title'],
      priority: 'high',
      respectQuietHours: true,
    },
    {
      id: 'rule-measure',
      label: 'Замер за день и за час',
      enabled: true,
      source: 'measure',
      offsets: [24 * 60, 60],
      channels: ['inapp', 'browser'],
      priority: 'normal',
      respectQuietHours: true,
    },
    {
      id: 'rule-delivery',
      label: 'Доставка накануне',
      enabled: true,
      source: 'delivery',
      offsets: [24 * 60, 60],
      channels: ['inapp', 'browser'],
      priority: 'normal',
      respectQuietHours: true,
    },
    {
      id: 'rule-ready',
      label: 'Заказ готов на фабрике',
      enabled: false,
      source: 'ready',
      offsets: [0],
      channels: ['inapp'],
      priority: 'low',
      respectQuietHours: true,
    },
    {
      id: 'rule-tasks',
      label: 'Задачи на сегодня',
      enabled: true,
      source: 'task',
      offsets: [0],
      atTime: '09:00',
      channels: ['inapp', 'browser'],
      priority: 'normal',
      respectQuietHours: true,
      repeatDaily: true,
    },
    {
      id: 'rule-contact',
      label: 'Связаться с клиентом',
      enabled: true,
      source: 'contact',
      offsets: [0],
      atTime: '10:00',
      channels: ['inapp'],
      priority: 'normal',
      respectQuietHours: true,
      repeatDaily: true,
    },
    {
      id: 'rule-payment',
      label: 'Остаток к оплате перед монтажом',
      enabled: true,
      source: 'payment',
      offsets: [24 * 60],
      atTime: '11:00',
      channels: ['inapp', 'browser'],
      priority: 'normal',
      respectQuietHours: true,
    },
    {
      id: 'rule-custom',
      label: 'Событие графика накануне',
      enabled: true,
      source: 'custom',
      offsets: [24 * 60],
      channels: ['inapp', 'browser'],
      priority: 'normal',
      respectQuietHours: true,
    },
    {
      id: 'rule-stale',
      label: 'Сделка зависла',
      enabled: false,
      source: 'stale',
      offsets: [0],
      staleDays: 10,
      atTime: '10:00',
      channels: ['inapp'],
      priority: 'low',
      respectQuietHours: true,
      repeatDaily: true,
    },
  ];
}

/** Личное напоминание задачи по умолчанию: за час, в приложении и системным окном. */
export function defaultTaskReminder(): TaskReminder {
  return {
    enabled: true,
    offsets: [60],
    atTime: '09:00',
    channels: ['inapp', 'browser'],
    priority: 'normal',
    repeatDaily: false,
    respectQuietHours: true,
  };
}

/** Смещения, которые чаще всего нужны задаче. */
export const TASK_OFFSET_PRESETS: Array<{ minutes: number; label: string; short: string }> =
  OFFSET_PRESETS.filter((preset) => preset.minutes >= 0);

/** Подпись личного напоминания задачи для списков и подсказок. */
export function describeTaskReminder(reminder: TaskReminder): string {
  if (!reminder.enabled) return 'напоминаний нет';
  const offsets = (reminder.offsets.length > 0 ? reminder.offsets : [0])
    .slice().sort((left, right) => right - left).map(fmtOffset).join(', ');
  const channels = (reminder.channels ?? ['inapp'])
    .map((channel) => CHANNEL_META[channel].label.toLowerCase()).join(', ');
  return `${offsets}${channels ? ` · ${channels}` : ''}${reminder.repeatDaily ? ' · каждый день' : ''}`;
}

export function defaultQuietHours(): QuietHours {
  return { enabled: true, from: '21:00', to: '08:00', skipWeekends: true, mode: 'wait' };
}

export function defaultDigest(): DigestSettings {
  return { enabled: true, at: '08:30', weekdaysOnly: true, channels: ['inapp', 'browser'] };
}

/** Правила из настроек + сводка на день отдельным правилом. Один состав
    нужен и живому движку, и расписанию на устройстве, и экспорту в календарь. */
export function reminderRulesWithDigest(settings: Pick<Settings, 'reminderRules' | 'digest'>): ReminderRule[] {
  const base = settings.reminderRules ?? [];
  const digestRule: ReminderRule = {
    id: 'rule-digest',
    label: 'Сводка на день',
    enabled: Boolean(settings.digest?.enabled),
    source: 'digest',
    offsets: [0],
    atTime: settings.digest?.at ?? '08:30',
    channels: settings.digest?.channels ?? ['inapp', 'browser'],
    priority: 'low',
    respectQuietHours: true,
  };
  return [...base.filter((rule) => rule.source !== 'digest'), digestRule];
}

/* -------------------------------- моменты ------------------------------- */

export interface ReminderMoment {
  /** Устойчивый ключ момента — по нему же считается дубль. */
  key: string;
  source: ReminderSource;
  dealId?: string;
  /** Заголовок в уведомлении. */
  title: string;
  /** Подпись: клиент, бригада, адрес. */
  detail: string;
  /** Срок. */
  at: Date;
  client?: string;
  team?: string;
  address?: string;
  /** Свои смещения из карточки (только для монтажа). */
  customOffsets?: number[];
  /** Личные настройки напоминания (только у задач). */
  taskReminder?: TaskReminder;
  taskId?: string;
}

interface MomentContext {
  clientName: (deal: Deal) => string;
  today?: string;
  /** Свободные события графика — напоминаем и о них. */
  events?: CalendarEvent[];
}

/** Все события со сроком: график, задачи, контакты, оплаты, зависшие сделки. */
export function collectMoments(
  deals: Deal[],
  context: MomentContext,
  rules: ReminderRule[] = defaultReminderRules(),
): ReminderMoment[] {
  const moments: ReminderMoment[] = [];
  const today = context.today ?? todayISO();
  const staleRule = rules.find((rule) => rule.source === 'stale' && rule.enabled);
  /** Время дня из правила — для дат без часов (задачи, контакты, оплата). */
  const ruleTime = (source: ReminderSource, fallback: string) =>
    rules.find((rule) => rule.source === source && rule.enabled)?.atTime ?? fallback;

  for (const deal of deals) {
    const client = context.clientName(deal);
    const closed = isClosedStatus(deal.status);

    for (const event of collectEvents([deal], context.clientName)) {
      if (event.status === 'done') continue;
      const source = event.kind as ReminderSource;
      const time = event.kind === 'ready' ? undefined : event.timeStart;
      moments.push({
        key: `${event.kind}:${deal.id}:${event.date}`,
        source,
        dealId: deal.id,
        title: `${SOURCE_META[source]?.label ?? 'Событие'}: ${deal.title}`,
        detail: [client, event.team, event.address, event.timeStart]
          .filter(Boolean).join(' · '),
        at: momentAt(event.date, time, '09:00'),
        client,
        team: event.team,
        address: event.address,
        customOffsets: event.kind === 'install' ? deal.schedule?.reminders : undefined,
      });
    }

    if (!closed) {
      for (const task of deal.tasks ?? []) {
        if (task.done || !task.dueAt) continue;
        moments.push({
          key: `task:${deal.id}:${task.id}:${task.dueAt}`,
          source: 'task',
          dealId: deal.id,
          title: task.title,
          detail: [client, deal.title, task.assignee].filter(Boolean).join(' · '),
          // Своё время дня задачи важнее правила, правило — важнее значения по умолчанию.
          at: momentAt(task.dueAt, undefined, task.reminder?.atTime ?? ruleTime('task', '09:00')),
          client,
          address: deal.schedule?.address,
          taskId: task.id,
          taskReminder: task.reminder,
        });
      }

      if (deal.nextContactAt) {
        moments.push({
          key: `contact:${deal.id}:${deal.nextContactAt}`,
          source: 'contact',
          dealId: deal.id,
          title: `Связаться: ${client}`,
          detail: [deal.title, deal.nextAction].filter(Boolean).join(' · '),
          at: momentAt(deal.nextContactAt, undefined, ruleTime('contact', '10:00')),
          client,
          address: deal.schedule?.address,
        });
      }

      const pay = paymentState(deal);
      if (pay.remainder > 0 && deal.amount > 0 && deal.schedule?.installAt) {
        moments.push({
          key: `payment:${deal.id}:${deal.schedule.installAt}`,
          source: 'payment',
          dealId: deal.id,
          title: `Остаток к оплате: ${deal.title}`,
          detail: [client, `осталось ${Math.round(pay.remainder).toLocaleString('ru-RU')} ₽`].filter(Boolean).join(' · '),
          at: momentAt(deal.schedule.installAt, undefined, ruleTime('payment', '11:00')),
          client,
          address: deal.schedule?.address,
        });
      }

      if (staleRule) {
        const days = Math.max(1, staleRule.staleDays ?? 10);
        const last = new Date(deal.updatedAt);
        if (!Number.isNaN(last.getTime())) {
          const at = new Date(last.getTime());
          at.setDate(at.getDate() + days);
          const minutes = minutesOfTime(staleRule.atTime, 10 * 60);
          at.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
          if (at.getTime() >= parseDay(today).getTime()) {
            moments.push({
              key: `stale:${deal.id}:${dayKey(at)}`,
              source: 'stale',
              dealId: deal.id,
              title: `Без движения ${days} дн.: ${deal.title}`,
              detail: [client, deal.status].filter(Boolean).join(' · '),
              at,
              client,
            });
          }
        }
      }
    }
  }

  // Свободные события графика: напоминаем один раз, в первый день.
  for (const event of calendarEvents(context.events ?? [])) {
    if (event.dayIndex && event.dayIndex > 1) continue;
    moments.push({
      key: `custom:${event.customId}:${event.date}`,
      source: 'custom',
      title: `${event.category || 'Событие'}: ${event.dealTitle}`,
      detail: [event.team, event.address, event.timeStart].filter(Boolean).join(' · '),
      at: momentAt(event.date, event.timeStart, '09:00'),
      team: event.team,
      address: event.address,
    });
  }

  return moments;
}

/* ------------------------------- расчёты -------------------------------- */

export interface PlannedReminder {
  /** Устойчивый ключ для дублей и откладывания. */
  id: string;
  ruleId: string;
  ruleLabel: string;
  source: ReminderSource;
  dealId?: string;
  title: string;
  detail: string;
  /** Срок события. */
  momentAt: string;
  /** Когда показать. */
  notifyAt: string;
  offsetMinutes: number;
  priority: ReminderPriority;
  channels: ReminderChannel[];
  /** Попало в тихие часы и ждёт своего времени. */
  waitingForQuiet: boolean;
}

export interface EvaluateInput {
  deals: Deal[];
  /** Свободные события графика — о них тоже напоминаем. */
  events?: CalendarEvent[];
  rules: ReminderRule[];
  settings: Pick<Settings, 'quietHours' | 'myName'>;
  now?: Date;
  clientName: (deal: Deal) => string;
  /** Уже отправленные: id → ISO. */
  sent?: Record<string, string>;
  /** Отложенные: id → ISO «показать после». */
  snoozes?: Record<string, string>;
  /** Текст сводки — собирается вызывающей стороной из данных. */
  digestSummary?: (now: Date) => string;
  /** На сколько дней вперёд собирать планы (по умолчанию 7). Для экспорта
      в календарь телефона нужно дальше: календарь напоминает сам. */
  horizonDays?: number;
}

export interface EvaluateResult {
  /** Пора показывать прямо сейчас. */
  fire: PlannedReminder[];
  /** Ближайшие 7 дней — для центра напоминаний. */
  upcoming: PlannedReminder[];
  /** Сработали, но ждут окончания тихих часов. */
  waiting: PlannedReminder[];
  /** Пропущены из-за тихих часов (режим «пропустить»). */
  skipped: string[];
}

/** Окно «догона»: если приложение было закрыто, не теряем напоминание. */
const CATCH_UP_MINUTES = 4 * 60;
/** После тихих часов напоминание ждёт дольше: человек увидит его утром. */
const QUIET_CATCH_UP_MINUTES = 12 * 60;
const UPCOMING_DAYS = 7;

export interface QuietWindow {
  /** Начало тишины. */
  start: Date;
  /** Конец тишины — когда напоминание можно показать. */
  end: Date;
}

/**
 * Окно тихих часов, в которое попадает момент `at` (или null, если не попадает).
 * Нужно, чтобы «дождаться утра» работало даже после перезапуска приложения:
 * время показа считается от конца окна, а не от текущего часа.
 */
export function quietWindow(quiet: QuietHours, at: Date): QuietWindow | null {
  if (!quiet.enabled || !quiet.from || !quiet.to) return null;
  const weekend = at.getDay() === 0 || at.getDay() === 6;
  if (quiet.skipWeekends && weekend) return null;
  const from = minutesOfTime(quiet.from, 21 * 60);
  const to = minutesOfTime(quiet.to, 8 * 60);
  if (from === to) return null;
  const current = at.getHours() * 60 + at.getMinutes();
  const start = new Date(at);
  const end = new Date(at);
  start.setHours(Math.floor(from / 60), from % 60, 0, 0);
  end.setHours(Math.floor(to / 60), to % 60, 0, 0);
  if (from < to) {
    if (current < from || current >= to) return null;
    return { start, end };
  }
  // окно через полночь: 21:00 → 08:00
  if (current >= from) {
    end.setDate(end.getDate() + 1);
    return { start, end };
  }
  if (current < to) {
    start.setDate(start.getDate() - 1);
    return { start, end };
  }
  return null;
}

export function inQuietHours(quiet: QuietHours, now: Date): boolean {
  if (!quiet.enabled) return false;
  const from = minutesOfTime(quiet.from, 21 * 60);
  const to = minutesOfTime(quiet.to, 8 * 60);
  const current = now.getHours() * 60 + now.getMinutes();
  const weekend = now.getDay() === 0 || now.getDay() === 6;
  if (quiet.skipWeekends && weekend) return false;
  return from <= to ? current >= from && current < to : current >= from || current < to;
}

export function fmtOffset(minutes: number): string {
  const abs = Math.abs(minutes);
  const suffix = minutes < 0 ? ' после' : ' до';
  if (abs === 0) return 'в момент срока';
  const days = Math.floor(abs / 1440);
  const hours = Math.floor((abs % 1440) / 60);
  const mins = abs % 60;
  let text = '';
  if (days > 0) text += `${days} ${plural(days, 'день', 'дня', 'дней')}`;
  if (hours > 0) text += `${text ? ' ' : ''}${hours} ${plural(hours, 'час', 'часа', 'часов')}`;
  if (mins > 0) text += `${text ? ' ' : ''}${mins} ${plural(mins, 'минуту', 'минуты', 'минут')}`;
  return `${text}${suffix}`;
}

function plural(value: number, one: string, few: string, many: string): string {
  const mod100 = value % 100;
  const mod10 = value % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

export function describeRule(rule: ReminderRule): string {
  const source = SOURCE_META[rule.source];
  if (rule.source === 'digest') return `${rule.label} · сводка на день`;
  const offsets = rule.offsets.length > 0
    ? rule.offsets.slice().sort((left, right) => right - left).map(fmtOffset).join(', ')
    : 'без смещений';
  const channels = rule.channels.map((channel) => CHANNEL_META[channel].label.toLowerCase()).join(', ');
  return `${source.label}: ${offsets}${channels ? ` · ${channels}` : ''}`;
}

/** Ключ дубля: правило + момент + смещение + день показа. */
export function reminderId(ruleId: string, momentKey: string, offset: number, notifyAt: Date): string {
  return `${ruleId}|${momentKey}|${offset}|${dayKey(notifyAt)}`;
}

interface PlanConfig {
  ruleId: string;
  ruleLabel: string;
  offsets: number[];
  atTime?: string;
  channels: ReminderChannel[];
  priority: ReminderPriority;
  repeatDaily?: boolean;
  respectQuietHours?: boolean;
}

export function evaluateReminders(input: EvaluateInput): EvaluateResult {
  const now = input.now ?? new Date();
  const sent = input.sent ?? {};
  const snoozes = input.snoozes ?? {};
  const quiet = input.settings.quietHours ?? defaultQuietHours();
  const moments = collectMoments(input.deals, {
    clientName: input.clientName,
    today: isoDay(now),
    events: input.events,
  }, input.rules);

  const fire: PlannedReminder[] = [];
  const upcoming: PlannedReminder[] = [];
  const waiting: PlannedReminder[] = [];
  const skipped: string[] = [];
  const horizon = new Date(now.getTime() + (input.horizonDays ?? UPCOMING_DAYS) * 86400000);

  /** Один момент в одном наборе настроек: правило или личное напоминание задачи. */
  const planMoment = (config: PlanConfig, moment: ReminderMoment) => {
    const offsets = config.offsets.length > 0 ? config.offsets : [0];
    for (const offset of offsets) {
      let notifyAt = new Date(moment.at.getTime() - offset * 60000);

      // Повторяющиеся напоминания: пока дело не закрыто, показываем раз в день.
      if (config.repeatDaily && notifyAt.getTime() < now.getTime()) {
        const minutes = minutesOfTime(config.atTime, 9 * 60);
        const today = new Date(now);
        today.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
        // Сегодняшнее время ещё впереди — покажем по расписанию, иначе сразу.
        notifyAt = today.getTime() > now.getTime()
          ? today
          : new Date(Math.floor(now.getTime() / 60000) * 60000);
      }

      // Отложенное напоминание показываем по времени «после», а не по сроку.
      // Пока время не пришло, держим его в планах: так его можно заранее
      // поставить в расписание устройства и выгрузить в календарь телефона.
      const snoozeId = reminderId(config.ruleId, moment.key, offset, notifyAt);
      const snoozeUntil = snoozes[snoozeId];
      if (snoozeUntil) {
        const at = new Date(snoozeUntil);
        if (at.getTime() > now.getTime()) {
          if (at <= horizon && !sent[snoozeId]) {
            upcoming.push({
              id: snoozeId,
              ruleId: config.ruleId,
              ruleLabel: config.ruleLabel,
              source: moment.source,
              dealId: moment.dealId,
              title: moment.title,
              detail: moment.detail,
              momentAt: moment.at.toISOString(),
              notifyAt: at.toISOString(),
              offsetMinutes: offset,
              priority: config.priority,
              channels: config.channels,
              waitingForQuiet: false,
            });
          }
          continue;
        }
        notifyAt = at;
      }

      const id = reminderId(config.ruleId, moment.key, offset, notifyAt);
      if (sent[id]) continue;

      const planned: PlannedReminder = {
        id,
        ruleId: config.ruleId,
        ruleLabel: config.ruleLabel,
        source: moment.source,
        dealId: moment.dealId,
        title: moment.title,
        detail: moment.detail,
        momentAt: moment.at.toISOString(),
        notifyAt: notifyAt.toISOString(),
        offsetMinutes: offset,
        priority: config.priority,
        channels: config.channels,
        waitingForQuiet: false,
      };

      // Тихие часы: «дождаться утра» переносит показ на конец окна тишины.
      const window = config.respectQuietHours ? quietWindow(quiet, notifyAt) : null;
      if (window) {
        if (quiet.mode === 'skip') {
          skipped.push(id);
          continue;
        }
        if (window.end.getTime() > now.getTime()) {
          planned.notifyAt = window.end.toISOString();
          planned.waitingForQuiet = true;
          waiting.push(planned);
          continue;
        }
        notifyAt = window.end;
        planned.notifyAt = notifyAt.toISOString();
      }

      const delta = now.getTime() - notifyAt.getTime();
      const catchUp = window ? QUIET_CATCH_UP_MINUTES : CATCH_UP_MINUTES;

      if (delta >= 0) {
        if (delta <= catchUp * 60000) {
          fire.push(planned);
        } else if (!snoozeUntil) {
          // Слишком старое — считаем пропущенным, чтобы не всплывало через неделю.
          skipped.push(id);
        }
      } else if (notifyAt <= horizon) {
        upcoming.push(planned);
      }
    }
  };

  for (const rule of input.rules) {
    if (!rule.enabled) continue;

    if (rule.source === 'digest') {
      const notifyAt = momentAt(isoDay(now), rule.atTime ?? '08:30');
      const id = reminderId(rule.id, `digest:${dayKey(notifyAt)}`, 0, notifyAt);
      if (sent[id]) continue;
      const planned: PlannedReminder = {
        id,
        ruleId: rule.id,
        ruleLabel: rule.label,
        source: 'digest',
        title: 'Сводка на день',
        detail: input.digestSummary?.(now) ?? 'Дела на сегодня',
        momentAt: notifyAt.toISOString(),
        notifyAt: notifyAt.toISOString(),
        offsetMinutes: 0,
        priority: rule.priority,
        channels: rule.channels,
        waitingForQuiet: false,
      };
      if (notifyAt.getTime() > now.getTime() && notifyAt <= horizon) {
        upcoming.push(planned);
        continue;
      }
      const delta = now.getTime() - notifyAt.getTime();
      if (delta >= 0 && delta <= CATCH_UP_MINUTES * 60000) fire.push(planned);
      continue;
    }

    for (const moment of moments) {
      if (moment.source !== rule.source) continue;
      if (Number.isNaN(moment.at.getTime())) continue;
      // У задачи свои настройки — она не подчиняется общему правилу.
      if (moment.source === 'task' && moment.taskReminder) continue;
      if (rule.onlyMine && input.settings.myName) {
        const deal = input.deals.find((item) => item.id === moment.dealId);
        if (!deal || (deal.manager ?? '') !== input.settings.myName) continue;
      }

      planMoment({
        ruleId: rule.id,
        ruleLabel: rule.label,
        // Свои смещения из карточки монтажа важнее правила.
        offsets: moment.customOffsets?.length ? moment.customOffsets : rule.offsets,
        atTime: rule.atTime,
        channels: rule.channels,
        priority: rule.priority,
        repeatDaily: rule.repeatDaily,
        respectQuietHours: rule.respectQuietHours,
      }, moment);
    }
  }

  // Личные напоминания задач: у каждой задачи своё расписание и каналы.
  for (const moment of moments) {
    const personal = moment.taskReminder;
    if (moment.source !== 'task' || !personal?.enabled) continue;
    planMoment({
      ruleId: `task:${moment.taskId ?? moment.key}`,
      ruleLabel: 'Своё напоминание',
      offsets: personal.offsets,
      atTime: personal.atTime,
      channels: personal.channels?.length ? personal.channels : ['inapp'],
      priority: personal.priority ?? 'normal',
      repeatDaily: personal.repeatDaily,
      respectQuietHours: personal.respectQuietHours !== false,
    }, moment);
  }

  const byNotify = (left: PlannedReminder, right: PlannedReminder) =>
    new Date(left.notifyAt).getTime() - new Date(right.notifyAt).getTime();

  return {
    fire: fire.sort(byNotify),
    upcoming: upcoming.sort(byNotify).slice(0, 100),
    waiting: waiting.sort(byNotify),
    skipped,
  };
}

/* ------------------------------- история -------------------------------- */

const SENT_KEY = 'crm-schedule.sent.v2';
const SNOOZE_KEY = 'crm-schedule.snooze.v1';
const SENT_TTL_DAYS = 30;

function readMap(key: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as Record<string, string>;
  } catch {
    return {};
  }
}

function writeMap(key: string, value: Record<string, string>): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* переполнение памяти не должно ломать напоминания */
  }
}

export function readSent(): Record<string, string> {
  const map = readMap(SENT_KEY);
  const limit = Date.now() - SENT_TTL_DAYS * 86400000;
  const fresh: Record<string, string> = {};
  for (const [key, iso] of Object.entries(map)) {
    const time = new Date(iso).getTime();
    if (Number.isFinite(time) && time >= limit) fresh[key] = iso;
  }
  return fresh;
}

export function markSentMap(ids: string[], now = new Date()): void {
  if (ids.length === 0) return;
  const map = readSent();
  for (const id of ids) map[id] = now.toISOString();
  writeMap(SENT_KEY, map);
}

export function clearSent(): void {
  try {
    localStorage.removeItem(SENT_KEY);
  } catch {
    /* нечего чистить */
  }
}

export function readSnoozes(): Record<string, string> {
  const map = readMap(SNOOZE_KEY);
  const now = Date.now();
  const fresh: Record<string, string> = {};
  for (const [key, iso] of Object.entries(map)) {
    const time = new Date(iso).getTime();
    // Держим отложенные ещё сутки после срока — на случай, если вкладка была закрыта.
    if (Number.isFinite(time) && time >= now - 86400000) fresh[key] = iso;
  }
  return fresh;
}

export function snoozeReminder(id: string, until: Date): void {
  const map = readSnoozes();
  map[id] = until.toISOString();
  writeMap(SNOOZE_KEY, map);
}

export function clearSnoozes(): void {
  try {
    localStorage.removeItem(SNOOZE_KEY);
  } catch {
    /* нечего чистить */
  }
}

/** Быстрые варианты отложить. */
export function snoozePresets(now = new Date()): Array<{ label: string; until: Date }> {
  const at = (minutes: number) => new Date(now.getTime() + minutes * 60000);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  const evening = new Date(now);
  evening.setHours(18, 0, 0, 0);
  if (evening.getTime() <= now.getTime()) evening.setDate(evening.getDate() + 1);
  return [
    { label: '10 минут', until: at(10) },
    { label: '1 час', until: at(60) },
    { label: 'До вечера', until: evening },
    { label: 'До завтра', until: tomorrow },
  ];
}

/** Сводка для утреннего дайджеста: коротко, но по делу. */
export function digestText(parts: {
  installs: number;
  measures: number;
  tasks: number;
  overdue: number;
  contacts: number;
}): string {
  const items: string[] = [];
  if (parts.installs > 0) items.push(`монтажей ${parts.installs}`);
  if (parts.measures > 0) items.push(`замеров ${parts.measures}`);
  if (parts.contacts > 0) items.push(`связаться с ${parts.contacts}`);
  if (parts.tasks > 0) items.push(`задач ${parts.tasks}`);
  if (parts.overdue > 0) items.push(`просрочено ${parts.overdue}`);
  return items.length > 0 ? items.join(' · ') : 'На сегодня дел нет — можно планировать';
}

/** Ближайшая дата (YYYY-MM-DD) для подписи. */
export function nextDays(now = new Date()): string[] {
  const start = isoDay(now);
  return Array.from({ length: UPCOMING_DAYS }, (_, index) => addDays(start, index));
}
