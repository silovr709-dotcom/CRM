// Хранение и обмен данными: localStorage, резервная копия JSON, календарь ICS
// и импорт резервной копии калькулятора (проекты + клиенты).

import type {
  Attachment, AttachmentKind,
  AppData, AutomationRule, Client, Deal, DealSchedule, DealStatus, DealTask, HistoryEntry,
  MessageTemplate, RuleId, ScheduleStatus, Settings, TaskKind, TaskRepeat, ThemeMode,
} from '../types';
import { demoData } from './demoData';
import { SCHEDULE_KINDS, scheduleStatusMeta, type ScheduleKind } from './schedule';
import { isoDay, parseDay } from './dates';
import { nowIso, normalizeName, phoneKey, uid } from './utils';
import { DEAL_STATUSES } from './crm';
import { DEFAULT_RULES, normalizeRules } from './crmAutomation';
import { normalizeTemplates } from './templates';
import { defaultSettings } from './settings';
import {
  normalizeDigest, normalizeQuietHours, normalizeReminderRules, normalizeTaskReminder,
} from './reminderSettings';

export const STORAGE_KEY = 'crm-schedule.v1';
const AUTO_BACKUP_KEY = 'crm-schedule.autobackup.v1';

export { defaultSettings } from './settings';

export function emptyData(): AppData {
  return {
    version: 2,
    clients: [],
    deals: [],
    settings: defaultSettings(),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

export function loadData(): AppData | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return validateData(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveData(data: AppData): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...data, updatedAt: nowIso() }));
    return true;
  } catch {
    return false;
  }
}

/** Автоматическая копия «до» опасных действий: импорт, очистка, сброс. */
export function writeAutoBackup(data: AppData, reason: string): boolean {
  try {
    localStorage.setItem(AUTO_BACKUP_KEY, JSON.stringify({ reason, at: nowIso(), data }));
    return true;
  } catch {
    return false;
  }
}

export interface AutoBackupInfo {
  reason: string;
  at: string;
  deals: number;
  clients: number;
}

export function autoBackupInfo(): AutoBackupInfo | null {
  try {
    const raw = localStorage.getItem(AUTO_BACKUP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { reason?: string; at?: string; data?: AppData };
    const data = validateData(parsed.data);
    if (!data) return null;
    return {
      reason: parsed.reason ?? 'перед изменениями',
      at: parsed.at ?? '',
      deals: data.deals.length,
      clients: data.clients.length,
    };
  } catch {
    return null;
  }
}

export function readAutoBackup(): AppData | null {
  try {
    const raw = localStorage.getItem(AUTO_BACKUP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { data?: AppData };
    return validateData(parsed.data);
  } catch {
    return null;
  }
}

/* ------------------------------ нормализация ------------------------------ */

function normalizeTheme(value: unknown): ThemeMode {
  return value === 'dark' || value === 'system' || value === 'light' ? value : 'light';
}

export function normalizeSettings(raw: Partial<Settings> | undefined): Settings {
  const base = defaultSettings();
  if (!raw || typeof raw !== 'object') return base;
  return {
    companyName: typeof raw.companyName === 'string' && raw.companyName ? raw.companyName : base.companyName,
    myName: typeof raw.myName === 'string' ? raw.myName : '',
    managers: Array.isArray(raw.managers) ? raw.managers.filter((item): item is string => typeof item === 'string') : [],
    teams: Array.isArray(raw.teams) ? raw.teams.filter((item): item is string => typeof item === 'string') : [],
    hints: raw.hints !== false,
    theme: normalizeTheme(raw.theme),
    notifications: raw.notifications !== false,
    reminderMinutes: Number.isFinite(Number(raw.reminderMinutes)) && Number(raw.reminderMinutes) > 0
      ? Math.min(24 * 60, Math.round(Number(raw.reminderMinutes)))
      : base.reminderMinutes,
    messageTemplates: normalizeTemplates(raw.messageTemplates),
    reminderRules: normalizeReminderRules(raw.reminderRules),
    quietHours: normalizeQuietHours(raw.quietHours),
    digest: normalizeDigest(raw.digest),
    rules: normalizeRules(raw.rules),
    demo: Boolean(raw.demo),
  };
}

/** Клиент из старой копии: обязательные массивы на месте. */
const ATTACHMENT_KINDS: AttachmentKind[] = ['photo', 'document', 'drawing', 'contract', 'other'];

/** Вложения: чиним только описание, сами файлы живут в IndexedDB. */
export function normalizeAttachment(raw: Partial<Attachment>): Attachment | null {
  if (!raw || typeof raw.id !== 'string' || !raw.id) return null;
  if (typeof raw.name !== 'string' || !raw.name.trim()) return null;
  return {
    id: raw.id,
    name: raw.name.trim().slice(0, 200),
    mime: typeof raw.mime === 'string' && raw.mime ? raw.mime : 'application/octet-stream',
    size: Math.max(0, Number(raw.size) || 0),
    kind: ATTACHMENT_KINDS.includes(raw.kind as AttachmentKind) ? raw.kind as AttachmentKind : 'document',
    createdAt: raw.createdAt ?? nowIso(),
    note: typeof raw.note === 'string' && raw.note ? raw.note.slice(0, 500) : undefined,
    width: Number(raw.width) || undefined,
    height: Number(raw.height) || undefined,
    addedBy: typeof raw.addedBy === 'string' ? raw.addedBy.slice(0, 80) : undefined,
  };
}

export function normalizeAttachments(raw: unknown): Attachment[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => normalizeAttachment(item as Partial<Attachment>))
    .filter((item): item is Attachment => item !== null);
}

function normalizeClient(raw: Partial<Client>): Client {
  return {
    id: raw.id ?? uid('cli'),
    name: raw.name?.trim() || 'Без имени',
    phones: Array.isArray(raw.phones) ? raw.phones.filter(Boolean) : [],
    emails: Array.isArray(raw.emails) ? raw.emails.filter(Boolean) : [],
    address: raw.address,
    source: raw.source,
    managerComment: raw.managerComment,
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    attachments: normalizeAttachments(raw.attachments),
    createdAt: raw.createdAt ?? nowIso(),
    updatedAt: raw.updatedAt ?? nowIso(),
  };
}

function normalizeTask(raw: Partial<DealTask>): DealTask {
  const repeats: TaskRepeat[] = ['daily', 'weekdays', 'weekly', 'monthly'];
  return {
    id: raw.id ?? uid('task'),
    title: typeof raw.title === 'string' && raw.title ? raw.title : 'Задача',
    kind: (typeof raw.kind === 'string' ? raw.kind : 'other') as TaskKind,
    dueAt: raw.dueAt?.slice(0, 10),
    done: Boolean(raw.done),
    doneAt: raw.doneAt,
    assignee: raw.assignee,
    comment: raw.comment,
    origin: raw.origin,
    repeat: raw.repeat && repeats.includes(raw.repeat) ? raw.repeat : undefined,
    reminder: normalizeTaskReminder(raw.reminder),
    createdAt: raw.createdAt ?? nowIso(),
  };
}

/** Старые/чужие записи приводим к текущей модели, чтобы ничего не падало. */
function normalizeDeal(raw: Partial<Deal>): Deal {
  const status = DEAL_STATUSES.some((item) => item.value === raw.status) ? raw.status as DealStatus : 'draft';
  const schedule = raw.schedule ?? { status: 'planned' };
  return {
    id: raw.id ?? uid('deal'),
    title: typeof raw.title === 'string' && raw.title ? raw.title : 'Без названия',
    clientId: raw.clientId ?? '',
    amount: Number(raw.amount) || 0,
    manager: raw.manager,
    status,
    nextAction: raw.nextAction,
    nextContactAt: raw.nextContactAt?.slice(0, 10),
    lostReason: raw.lostReason,
    comment: raw.comment,
    // Позиции сметы и выданные документы: без нормализации они терялись
    // при загрузке и при слиянии с общей базой.
    items: Array.isArray(raw.items)
      ? raw.items.map((entry) => ({
        id: entry.id ?? uid('item'),
        title: typeof entry.title === 'string' ? entry.title : '',
        qty: Number(entry.qty) || 0,
        unit: typeof entry.unit === 'string' && entry.unit ? entry.unit : 'шт.',
        price: Number(entry.price) || 0,
        note: entry.note,
      }))
      : [],
    documents: Array.isArray(raw.documents)
      ? raw.documents
        .filter((doc) => ['offer', 'estimate', 'contract', 'work', 'act'].includes(String(doc.kind)))
        .map((doc) => ({
          id: doc.id ?? uid('doc'),
          kind: doc.kind,
          number: typeof doc.number === 'string' ? doc.number : '',
          issuedAt: (doc.issuedAt ?? isoDay(new Date())).slice(0, 10),
          issuedBy: doc.issuedBy,
        }))
      : [],
    tasks: Array.isArray(raw.tasks) ? raw.tasks.map(normalizeTask) : [],
    payments: Array.isArray(raw.payments)
      ? raw.payments.map((payment) => ({
        id: payment.id ?? uid('pay'),
        amount: Number(payment.amount) || 0,
        at: (payment.at ?? isoDay(new Date())).slice(0, 10),
        kind: payment.kind ?? 'prepay',
        comment: payment.comment,
      }))
      : [],
    expenses: Array.isArray(raw.expenses)
      ? raw.expenses.map((entry) => ({
        id: entry.id ?? uid('exp'),
        kind: entry.kind ?? 'other',
        amount: Math.round(Number(entry.amount) || 0),
        at: (entry.at ?? isoDay(new Date())).slice(0, 10),
        comment: entry.comment,
        addedBy: entry.addedBy,
      }))
      : [],
    plan: Array.isArray(raw.plan)
      ? raw.plan.map((entry) => ({
        id: entry.id ?? uid('plan'),
        amount: Math.round(Number(entry.amount) || 0),
        at: (entry.at ?? isoDay(new Date())).slice(0, 10),
        kind: entry.kind ?? 'final',
        comment: entry.comment,
        paidId: entry.paidId,
      }))
      : [],
    history: Array.isArray(raw.history) ? raw.history : [],
    attachments: normalizeAttachments(raw.attachments),
    schedule: {
      ...schedule,
      status: (schedule.status ?? 'planned') as ScheduleStatus,
      measureAt: schedule.measureAt?.slice(0, 10),
      readyAt: schedule.readyAt?.slice(0, 10),
      deliveryAt: schedule.deliveryAt?.slice(0, 10),
      installAt: schedule.installAt?.slice(0, 10),
      timeStart: schedule.timeStart,
      timeEnd: schedule.timeEnd,
      installDays: schedule.installDays ? Math.max(1, Math.min(14, Math.round(schedule.installDays))) : undefined,
    },
    createdAt: raw.createdAt ?? nowIso(),
    updatedAt: raw.updatedAt ?? nowIso(),
  };
}

/** Мягкая проверка: принимаем только то, что похоже на нашу базу. */
export function validateData(raw: unknown): AppData | null {
  const data = raw as Partial<AppData> | null;
  if (!data || typeof data !== 'object') return null;
  if (!Array.isArray(data.deals) || !Array.isArray(data.clients)) return null;
  return {
    version: 2,
    clients: data.clients.map(normalizeClient),
    deals: data.deals.map(normalizeDeal),
    settings: normalizeSettings(data.settings),
    createdAt: data.createdAt ?? nowIso(),
    updatedAt: data.updatedAt ?? nowIso(),
  };
}

export function freshStart(useDemo: boolean): AppData {
  if (!useDemo) return emptyData();
  const demo = demoData();
  return { ...demo, settings: { ...demo.settings, demo: true } };
}

/* ------------------------------ скачивание ------------------------------ */

export function downloadFile(filename: string, content: string | Blob, mime = 'application/octet-stream') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function exportBackup(data: AppData) {
  const payload = {
    kind: 'crm-schedule-backup',
    exportedAt: nowIso(),
    version: 2,
    clients: data.clients,
    deals: data.deals,
    settings: data.settings,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
  downloadFile(`crm-график-${isoDay(new Date())}.json`, JSON.stringify(payload, null, 2), 'application/json');
}

/** Импорт нашей резервной копии. Возвращает данные или бросает понятную ошибку. */
export function parseBackup(raw: string): AppData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Файл не является корректным JSON.');
  }
  const data = validateData(parsed);
  if (!data) throw new Error('Это не файл резервной копии CRM и графика.');
  return data;
}

/* ------------------------- импорт из калькулятора ------------------------- */

interface CalculatorProject {
  id?: string;
  name?: string;
  client?: string;
  clientId?: string;
  comment?: string;
  status?: string;
  orderWorkflow?: { status?: string; nextAction?: string; nextContactAt?: string; managerComment?: string; assignee?: string; lostReason?: string };
  schedule?: Record<string, unknown>;
  tasks?: Array<Record<string, unknown>>;
  createdAt?: string;
  updatedAt?: string;
  modules?: Array<{ name?: string; widthMm?: number; heightMm?: number; depthMm?: number; qty?: number }>;
  clientOffer?: { productionTerms?: string; clientPhone?: string; clientEmail?: string };
  clientOfferSnapshots?: Array<{ createdAt?: string; clientTotal?: number }>;
}

interface CalculatorBackup {
  kind?: string;
  projects?: CalculatorProject[];
  clients?: Array<{
    id?: string; name?: string; phones?: string[]; emails?: string[];
    objectAddress?: string; deliveryAddress?: string; source?: string; managerComment?: string;
    tags?: string[]; createdAt?: string; updatedAt?: string;
    history?: Array<{ id?: string; createdAt?: string; kind?: string; title?: string; text?: string; projectId?: string }>;
  }>;
}

/** Резервная копия РЕцепта/калькулятора → наша база. */
export function importCalculatorBackup(raw: string): { data: AppData; deals: number; clients: number; warning: string } {
  let parsed: CalculatorBackup;
  try {
    parsed = JSON.parse(raw) as CalculatorBackup;
  } catch {
    throw new Error('Файл не является корректным JSON.');
  }
  if (!Array.isArray(parsed.projects)) {
    throw new Error('Это не резервная копия калькулятора (нет списка проектов).');
  }

  const clients: Client[] = (parsed.clients ?? []).map((item) => normalizeClient({
    id: item.id,
    name: item.name,
    phones: item.phones,
    emails: item.emails,
    address: item.objectAddress || item.deliveryAddress,
    source: item.source,
    managerComment: item.managerComment,
    tags: item.tags,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }));

  const findClient = (name?: string, id?: string): Client | undefined => {
    if (id) {
      const byId = clients.find((item) => item.id === id);
      if (byId) return byId;
    }
    const normalized = normalizeName(name);
    return clients.find((item) => normalizeName(item.name) === normalized);
  };

  const clientHistory = (parsed.clients ?? []).flatMap((item) => (item.history ?? []).map((entry) => ({
    ...entry,
    clientId: item.id,
  })));

  const deals: Deal[] = parsed.projects.map((project) => {
    let linked = findClient(project.client, project.clientId);
    if (!linked && project.client?.trim()) {
      linked = normalizeClient({
        id: uid('cli'),
        name: project.client,
        phones: project.clientOffer?.clientPhone ? [project.clientOffer.clientPhone] : [],
        emails: project.clientOffer?.clientEmail ? [project.clientOffer.clientEmail] : [],
        address: typeof project.schedule?.address === 'string' ? project.schedule.address : undefined,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      });
      clients.push(linked);
    }

    // Сумма из сохранённых версий КП: калькулятор хранит её в снимках.
    const snapshots = [...(project.clientOfferSnapshots ?? [])]
      .filter((snapshot) => Number(snapshot.clientTotal) > 0)
      .sort((left, right) => (left.createdAt ?? '').localeCompare(right.createdAt ?? ''));
    const amount = Number(snapshots[snapshots.length - 1]?.clientTotal) || 0;

    const workflow = project.orderWorkflow ?? {};
    const status = DEAL_STATUSES.some((item) => item.value === workflow.status)
      ? workflow.status as DealStatus
      : project.status === 'sent' ? 'offerSent'
        : project.status === 'approved' ? 'approved'
          : project.status === 'archived' ? 'rejected' : 'draft';

    const scheduleRaw = (project.schedule ?? {}) as Record<string, unknown>;
    const schedule: DealSchedule = {
      status: (scheduleRaw.status as ScheduleStatus) ?? 'planned',
      measureAt: asDay(scheduleRaw.measureAt),
      readyAt: asDay(scheduleRaw.readyAt),
      deliveryAt: asDay(scheduleRaw.deliveryAt),
      installAt: asDay(scheduleRaw.installAt),
      installDays: Number(scheduleRaw.installDays) || undefined,
      team: typeof scheduleRaw.team === 'string' ? scheduleRaw.team : undefined,
      address: typeof scheduleRaw.address === 'string' ? scheduleRaw.address : undefined,
      phone: typeof scheduleRaw.phone === 'string' ? scheduleRaw.phone : project.clientOffer?.clientPhone,
      note: typeof scheduleRaw.note === 'string' ? scheduleRaw.note : undefined,
      timeStart: typeof scheduleRaw.timeStart === 'string' ? scheduleRaw.timeStart : undefined,
      timeEnd: typeof scheduleRaw.timeEnd === 'string' ? scheduleRaw.timeEnd : undefined,
    };

    const tasks: DealTask[] = (project.tasks ?? []).map((task) => normalizeTask({
      id: typeof task.id === 'string' ? task.id : undefined,
      title: typeof task.title === 'string' ? task.title : undefined,
      kind: (typeof task.kind === 'string' ? task.kind : 'other') as TaskKind,
      dueAt: asDay(task.dueAt),
      done: Boolean(task.done),
      doneAt: typeof task.doneAt === 'string' ? task.doneAt : undefined,
      assignee: typeof task.assignee === 'string' ? task.assignee : undefined,
      comment: typeof task.comment === 'string' ? task.comment : undefined,
      origin: typeof task.origin === 'string' ? task.origin : undefined,
      createdAt: typeof task.createdAt === 'string' ? task.createdAt : undefined,
    }));

    const history: HistoryEntry[] = [
      ...clientHistory
        .filter((entry) => entry.projectId === project.id)
        .map((entry) => ({
          id: entry.id ?? uid('h'),
          createdAt: entry.createdAt ?? nowIso(),
          kind: (entry.kind ?? 'note') as HistoryEntry['kind'],
          title: entry.title ?? 'Событие',
          text: entry.text,
        })),
      {
        id: uid('h'),
        createdAt: nowIso(),
        kind: 'project',
        title: 'Импортировано из калькулятора',
        text: amount > 0
          ? `Сумма взята из сохранённой версии КП: ${amount.toLocaleString('ru-RU')} ₽.`
          : 'Суммы нет в файле калькулятора — заполните её вручную.',
      },
    ];

    const modules = (project.modules ?? [])
      .map((module) => `${module.name ?? 'Модуль'}${module.widthMm ? ` ${module.widthMm}×${module.heightMm ?? '—'}` : ''}`)
      .join(', ');

    const comment = [project.comment, workflow.managerComment, modules ? `Состав: ${modules}` : '']
      .filter(Boolean).join('\n');

    return normalizeDeal({
      id: project.id,
      title: project.name,
      clientId: linked?.id,
      amount,
      manager: workflow.assignee,
      status,
      nextAction: workflow.nextAction,
      nextContactAt: asDay(workflow.nextContactAt),
      lostReason: workflow.lostReason,
      comment,
      tasks,
      payments: [],
      history,
      schedule,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    });
  });

  const settings = defaultSettings();
  settings.managers = Array.from(new Set(deals.map((deal) => deal.manager).filter(Boolean) as string[]));
  settings.teams = Array.from(new Set(deals.map((deal) => deal.schedule.team).filter(Boolean) as string[]));

  return {
    data: {
      version: 2,
      clients,
      deals,
      settings,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
    deals: deals.length,
    clients: clients.length,
    warning: 'Суммы переносятся из сохранённых версий КП. Где их нет — заполните суммы в карточках сделок вручную.',
  };
}

function asDay(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  return value.slice(0, 10);
}

/* --------------------------------- ICS --------------------------------- */

function icsEscape(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** Время в ICS: дата + HHMMSS в локальном времени (без Z). */
function icsDateTime(day: string, time: string): string {
  return `${day.replace(/-/g, '')}T${time.replace(':', '')}00`;
}

/** Календарь для телефона: все события графика как ICS. */
export function buildIcs(data: AppData, clientName: (deal: Deal) => string): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CRM + График монтажей//RU',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${icsEscape(data.settings.companyName || 'График монтажей')}`,
  ];

  for (const deal of data.deals) {
    const schedule = deal.schedule;
    if (!schedule) continue;
    const events: Array<{ field: 'measureAt' | 'readyAt' | 'deliveryAt' | 'installAt'; kind: ScheduleKind }> = [
      { field: 'measureAt', kind: 'measure' },
      { field: 'readyAt', kind: 'ready' },
      { field: 'deliveryAt', kind: 'delivery' },
      { field: 'installAt', kind: 'install' },
    ];
    for (const event of events) {
      const date = schedule[event.field];
      if (!date) continue;
      const start = parseDay(date);
      const end = new Date(start);
      const days = event.field === 'installAt' ? Math.max(1, schedule.installDays ?? 1) : 1;
      end.setDate(start.getDate() + days);
      const kindMeta = SCHEDULE_KINDS.find((item) => item.id === event.kind);
      const statusMeta = scheduleStatusMeta(schedule.status);
      const summary = `${kindMeta?.label ?? event.kind}: ${deal.title}`;
      const description = [
        `Клиент: ${clientName(deal)}`,
        schedule.phone ? `Телефон: ${schedule.phone}` : '',
        schedule.team ? `Бригада: ${schedule.team}` : '',
        `Статус: ${statusMeta.label}`,
        schedule.note ?? '',
        deal.comment ?? '',
      ].filter(Boolean).join('\n');
      const timed = event.kind === 'install' && schedule.timeStart;
      const startLine = timed
        ? `DTSTART;TZID=Europe/Moscow:${icsDateTime(date, schedule.timeStart as string)}`
        : `DTSTART;VALUE=DATE:${date.replace(/-/g, '')}`;
      const endLine = timed
        ? `DTEND;TZID=Europe/Moscow:${icsDateTime(date, schedule.timeEnd || schedule.timeStart || '10:00')}`
        : `DTEND;VALUE=DATE:${isoDay(end).replace(/-/g, '')}`;
      lines.push(
        'BEGIN:VEVENT',
        `UID:${deal.id}-${event.field}@crm-schedule`,
        `DTSTAMP:${stamp}`,
        startLine,
        endLine,
        `SUMMARY:${icsEscape(summary)}`,
        schedule.address ? `LOCATION:${icsEscape(schedule.address)}` : '',
        description ? `DESCRIPTION:${icsEscape(description)}` : '',
        schedule.reminders?.length ? `BEGIN:VALARM\r\nTRIGGER:-PT${Math.max(...schedule.reminders)}M\r\nACTION:DISPLAY\r\nDESCRIPTION:${icsEscape(summary)}\r\nEND:VALARM` : '',
        'END:VEVENT',
      );
    }
  }

  lines.push('END:VCALENDAR');
  return lines.filter(Boolean).join('\r\n');
}

export function exportIcs(data: AppData, clientName: (deal: Deal) => string) {
  downloadFile(`график-монтажей-${isoDay(new Date())}.ics`, buildIcs(data, clientName), 'text/calendar;charset=utf-8');
}

/** Похожие клиенты: общий телефон или одинаковое имя. */
export function findDuplicateClients(clients: Client[]): Array<{ reason: string; clients: Client[] }> {
  const groups: Array<{ reason: string; clients: Client[] }> = [];
  const seenPhones = new Map<string, Client[]>();
  for (const client of clients) {
    for (const phone of client.phones) {
      const key = phoneKey(phone);
      if (!key) continue;
      seenPhones.set(key, [...(seenPhones.get(key) ?? []), client]);
    }
  }
  for (const [phone, list] of seenPhones) {
    if (list.length < 2) continue;
    const unique = Array.from(new Map(list.map((item) => [item.id, item])).values());
    if (unique.length > 1) groups.push({ reason: `телефон ${phone}`, clients: unique });
  }
  const byName = new Map<string, Client[]>();
  for (const client of clients) {
    const key = normalizeName(client.name);
    if (!key) continue;
    byName.set(key, [...(byName.get(key) ?? []), client]);
  }
  for (const [name, list] of byName) {
    if (list.length > 1) groups.push({ reason: `имя «${name}»`, clients: list });
  }
  return groups;
}

/** Что изменится при импорте — показываем до подтверждения. */
export interface ImportPreview {
  kind: 'crm-schedule' | 'calculator' | 'unknown';
  deals: number;
  clients: number;
  tasks: number;
  events: number;
  amount: number;
  /** Совпадают по id со текущими — будут заменены. */
  conflicts: number;
  error?: string;
  data?: AppData;
  warning?: string;
}

export function previewImport(raw: string, current: AppData): ImportPreview {
  const empty: ImportPreview = { kind: 'unknown', deals: 0, clients: 0, tasks: 0, events: 0, amount: 0, conflicts: 0, error: 'Файл не похож ни на копию CRM, ни на копию калькулятора.' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...empty, error: 'Файл не является корректным JSON.' };
  }
  const kind = (parsed as { kind?: string } | null)?.kind;
  try {
    const isCalculator = kind === 'recept-backup';
    const data = isCalculator ? importCalculatorBackup(raw).data : parseBackup(raw);
    const ids = new Set(current.deals.map((deal) => deal.id));
    return {
      kind: isCalculator ? 'calculator' : 'crm-schedule',
      deals: data.deals.length,
      clients: data.clients.length,
      tasks: data.deals.reduce((sum, deal) => sum + deal.tasks.length, 0),
      events: data.deals.reduce((sum, deal) => sum + [
        deal.schedule.measureAt, deal.schedule.readyAt, deal.schedule.deliveryAt, deal.schedule.installAt,
      ].filter(Boolean).length, 0),
      amount: data.deals.reduce((sum, deal) => sum + deal.amount, 0),
      conflicts: data.deals.filter((deal) => ids.has(deal.id)).length,
      data,
      warning: isCalculator ? importCalculatorBackup(raw).warning : undefined,
    };
  } catch (error) {
    return { ...empty, error: error instanceof Error ? error.message : 'Не удалось прочитать файл.', kind: kind === 'recept-backup' ? 'calculator' : 'unknown' };
  }
}

/** Слияние импорта с текущей базой: новые записи добавляются, совпадающие по id — обновляются. */
export function mergeImport(current: AppData, incoming: AppData): AppData {
  const clients = [...current.clients];
  for (const client of incoming.clients) {
    const index = clients.findIndex((item) => item.id === client.id);
    if (index >= 0) clients[index] = client;
    else clients.push(client);
  }
  const deals = [...current.deals];
  for (const deal of incoming.deals) {
    const index = deals.findIndex((item) => item.id === deal.id);
    if (index >= 0) deals[index] = deal;
    else deals.push(deal);
  }
  return {
    ...current,
    clients,
    deals,
    settings: current.settings,
    updatedAt: nowIso(),
  };
}

/** Сводка правила автоматики для отображения в настройках. */
export function ruleTitle(rule: AutomationRule): string {
  return rule.label;
}

export function ruleDaysLabel(rule: AutomationRule): string {
  return rule.days === 0 ? 'сразу' : `через ${rule.days} дн.`;
}

/** Проверка ключа правила из резервной копии. */
export function isRuleId(value: string): value is RuleId {
  return DEFAULT_RULES.some((rule) => rule.id === value);
}

export type { MessageTemplate };
