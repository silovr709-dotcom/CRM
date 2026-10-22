// Хранение и обмен данными: localStorage, резервная копия JSON, календарь ICS
// и импорт резервной копии калькулятора (проекты + клиенты).

import type { AppData, Client, Deal, DealSchedule, DealStatus, DealTask, HistoryEntry, ScheduleStatus, TaskKind } from '../types';
import { demoData } from './demoData';
import { SCHEDULE_KINDS, scheduleStatusMeta, type ScheduleKind } from './schedule';
import { isoDay, parseDay } from './dates';
import { nowIso, normalizeName, phoneKey, uid } from './utils';
import { DEAL_STATUSES } from './crm';

export const STORAGE_KEY = 'crm-schedule.v1';

export function emptyData(): AppData {
  return {
    version: 1,
    clients: [],
    deals: [],
    settings: { companyName: 'Моя студия', managers: [], teams: [], hints: true },
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

/** Мягкая проверка: принимаем только то, что похоже на нашу базу. */
export function validateData(raw: unknown): AppData | null {
  const data = raw as Partial<AppData> | null;
  if (!data || typeof data !== 'object') return null;
  if (!Array.isArray(data.deals) || !Array.isArray(data.clients)) return null;
  return {
    version: 1,
    clients: data.clients.map(normalizeClient),
    deals: data.deals.map(normalizeDeal),
    settings: {
      companyName: data.settings?.companyName ?? 'Моя студия',
      managers: Array.isArray(data.settings?.managers) ? data.settings.managers : [],
      teams: Array.isArray(data.settings?.teams) ? data.settings.teams : [],
      hints: data.settings?.hints !== false,
    },
    createdAt: data.createdAt ?? nowIso(),
    updatedAt: data.updatedAt ?? nowIso(),
  };
}

/** Клиент из старой копии: обязательные массивы на месте. */
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
    createdAt: raw.createdAt ?? nowIso(),
    updatedAt: raw.updatedAt ?? nowIso(),
  };
}

/** Старые/чужие записи приводим к текущей модели, чтобы ничего не падало. */
function normalizeDeal(raw: Partial<Deal>): Deal {
  const status = DEAL_STATUSES.some((item) => item.value === raw.status) ? raw.status as DealStatus : 'draft';
  const schedule = raw.schedule ?? { status: 'planned' };
  return {
    id: raw.id ?? uid('deal'),
    title: raw.title ?? 'Без названия',
    clientId: raw.clientId ?? '',
    amount: Number(raw.amount) || 0,
    manager: raw.manager,
    status,
    nextAction: raw.nextAction,
    nextContactAt: raw.nextContactAt?.slice(0, 10),
    lostReason: raw.lostReason,
    comment: raw.comment,
    tasks: Array.isArray(raw.tasks) ? raw.tasks : [],
    payments: Array.isArray(raw.payments) ? raw.payments : [],
    history: Array.isArray(raw.history) ? raw.history : [],
    schedule: {
      ...schedule,
      status: (schedule.status ?? 'planned') as ScheduleStatus,
      measureAt: schedule.measureAt?.slice(0, 10),
      readyAt: schedule.readyAt?.slice(0, 10),
      deliveryAt: schedule.deliveryAt?.slice(0, 10),
      installAt: schedule.installAt?.slice(0, 10),
    },
    createdAt: raw.createdAt ?? nowIso(),
    updatedAt: raw.updatedAt ?? nowIso(),
  };
}

export function freshStart(useDemo: boolean): AppData {
  return useDemo ? demoData() : emptyData();
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
    version: 1,
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

/** Резервная копия РЕцепта/калькулятора → наша база. Суммы в калькуляторе
 *  не хранятся в файле (они считаются по прайсу), поэтому их нужно заполнить. */
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

  const clients: Client[] = (parsed.clients ?? []).map((item) => ({
    id: item.id ?? uid('cli'),
    name: item.name?.trim() || 'Без имени',
    phones: Array.isArray(item.phones) ? item.phones : [],
    emails: Array.isArray(item.emails) ? item.emails : [],
    address: item.objectAddress || item.deliveryAddress,
    source: item.source,
    managerComment: item.managerComment,
    tags: Array.isArray(item.tags) ? item.tags : [],
    createdAt: item.createdAt ?? nowIso(),
    updatedAt: item.updatedAt ?? nowIso(),
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
      linked = {
        id: uid('cli'),
        name: project.client.trim(),
        phones: project.clientOffer?.clientPhone ? [project.clientOffer.clientPhone] : [],
        emails: project.clientOffer?.clientEmail ? [project.clientOffer.clientEmail] : [],
        address: typeof project.schedule?.address === 'string' ? project.schedule.address : undefined,
        tags: [],
        createdAt: project.createdAt ?? nowIso(),
        updatedAt: project.updatedAt ?? nowIso(),
      };
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
    };

    const tasks: DealTask[] = (project.tasks ?? []).map((task) => ({
      id: typeof task.id === 'string' ? task.id : uid('task'),
      title: typeof task.title === 'string' ? task.title : 'Задача',
      kind: (typeof task.kind === 'string' ? task.kind : 'other') as TaskKind,
      dueAt: asDay(task.dueAt),
      done: Boolean(task.done),
      doneAt: typeof task.doneAt === 'string' ? task.doneAt : undefined,
      assignee: typeof task.assignee === 'string' ? task.assignee : undefined,
      comment: typeof task.comment === 'string' ? task.comment : undefined,
      origin: typeof task.origin === 'string' ? task.origin : undefined,
      createdAt: typeof task.createdAt === 'string' ? task.createdAt : nowIso(),
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

    return {
      id: project.id ?? uid('deal'),
      title: project.name?.trim() || 'Заказ из калькулятора',
      clientId: linked?.id ?? '',
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
      createdAt: project.createdAt ?? nowIso(),
      updatedAt: project.updatedAt ?? nowIso(),
    };
  });

  const data: AppData = {
    version: 1,
    clients,
    deals,
    settings: {
      companyName: 'Студия кухни',
      managers: Array.from(new Set(deals.map((deal) => deal.manager).filter(Boolean) as string[])),
      teams: Array.from(new Set(deals.map((deal) => deal.schedule.team).filter(Boolean) as string[])),
      hints: true,
    },
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  return {
    data,
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
      lines.push(
        'BEGIN:VEVENT',
        `UID:${deal.id}-${event.field}@crm-schedule`,
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${isoDay(start).replace(/-/g, '')}`,
        `DTEND;VALUE=DATE:${isoDay(end).replace(/-/g, '')}`,
        `SUMMARY:${icsEscape(summary)}`,
        schedule.address ? `LOCATION:${icsEscape(schedule.address)}` : '',
        description ? `DESCRIPTION:${icsEscape(description)}` : '',
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

/** Уникальные клиенты для импорта: имя + телефон. */
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
