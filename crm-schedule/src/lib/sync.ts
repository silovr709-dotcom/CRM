// Синхронизация одной базы между устройствами.
//
// Вся база — это один документ: AppData плюс список удалённых записей
// («надгробия»). Лежит он в Supabase, доступ — по секретному коду: сервер
// хранит только SHA-256 от кода, поэтому сам код нигде не записан, а базу
// нельзя перебрать. Код — это и есть «ключ от общей базы».

import type { AppData, CalendarEvent, Client, Deal, WarehouseReceipt } from '../types';
import { validateData } from './storage';
import { nowIso } from './utils';

/** Проект Supabase, в котором живут общие базы. */
export const SYNC_ENDPOINT = 'https://iswkzclegjcbhxaatmbb.supabase.co';
/** Публичный ключ проекта: он и так уходит в браузер, доступ к строкам закрыт. */
export const SYNC_PUBLIC_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlzd2t6Y2xlZ2pjYmh4YWF0bWJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI0NzQzNzMsImV4cCI6MjEwODA1MDM3M30.g_DgKVMd9MvCOLmTctHQowKwroX2RhIS7FfGIZYaR9M';

const SYNC_KEY = 'crm-schedule.sync.v1';

/** Минимальная длина кода: короче — сервер откажет. */
export const MIN_CODE_LENGTH = 20;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 24;
/** Сколько дней помним удаление, чтобы оно доехало до выключенного устройства. */
const TOMBSTONE_TTL_DAYS = 180;

/** Что удалили на устройстве: id → когда. */
export interface Removed {
  clients: Record<string, string>;
  deals: Record<string, string>;
  receipts: Record<string, string>;
  events: Record<string, string>;
}

export function emptyRemoved(): Removed {
  return { clients: {}, deals: {}, receipts: {}, events: {} };
}

export interface SyncConfig {
  /** Секретный код базы. */
  code: string;
  /** Версия документа на сервере — защита от затирания чужих правок. */
  revision: number;
  deviceId: string;
  deviceName: string;
  /** Когда это устройство последний раз обменивалось данными. */
  lastSyncAt: string;
  /** Когда документ менялся на сервере и с какого устройства. */
  serverAt: string;
  serverDevice: string;
  /** Короткий отпечаток того, что лежит на сервере: без него не понять,
   *  совпадает ли локальная копия с серверной, не скачивая документ. */
  serverHash?: string;
  /** База точно существует (успели создать или прочитать). */
  known: boolean;
  removed: Removed;
}

export interface SyncEnvelope {
  kind: 'crm-schedule/sync';
  schema: 1;
  device: string;
  savedAt: string;
  data: AppData;
  removed: Removed;
}

/* ------------------------------ код базы ------------------------------ */

/** Новый код базы: 24 символа без похожих друг на друга I, O, 0 и 1. */
export function makeSyncCode(): string {
  const cryptoApi = typeof crypto !== 'undefined' ? crypto : undefined;
  const bytes = new Uint8Array(CODE_LENGTH);
  if (cryptoApi?.getRandomValues) cryptoApi.getRandomValues(bytes);
  else for (let index = 0; index < CODE_LENGTH; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  let code = '';
  for (const byte of bytes) code += ALPHABET[byte % ALPHABET.length];
  return code;
}

/** Код из любого ввода: пробелы, дефисы и регистр не важны. */
export function normalizeSyncCode(input: string): string {
  return (input ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Код для показа и переписывания руками: группами по четыре символа. */
export function formatSyncCode(code: string): string {
  const clean = normalizeSyncCode(code);
  return clean.replace(/(.{4})(?=.)/g, '$1-');
}

/* ---------------------------- локальные данные ---------------------------- */

export function loadSyncConfig(): SyncConfig | null {
  try {
    const raw = localStorage.getItem(SYNC_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SyncConfig>;
    const code = normalizeSyncCode(parsed.code ?? '');
    if (code.length < MIN_CODE_LENGTH) return null;
    return {
      code,
      revision: Number.isFinite(Number(parsed.revision)) ? Number(parsed.revision) : 0,
      deviceId: typeof parsed.deviceId === 'string' ? parsed.deviceId : makeDeviceId(),
      deviceName: typeof parsed.deviceName === 'string' ? parsed.deviceName : deviceName(),
      lastSyncAt: typeof parsed.lastSyncAt === 'string' ? parsed.lastSyncAt : '',
      serverAt: typeof parsed.serverAt === 'string' ? parsed.serverAt : '',
      serverDevice: typeof parsed.serverDevice === 'string' ? parsed.serverDevice : '',
      serverHash: typeof parsed.serverHash === 'string' ? parsed.serverHash : '',
      known: parsed.known === true,
      removed: normalizeRemoved(parsed.removed),
    };
  } catch {
    return null;
  }
}

export function saveSyncConfig(config: SyncConfig): void {
  try {
    localStorage.setItem(SYNC_KEY, JSON.stringify(config));
  } catch {
    /* приватный режим — синхронизация просто не запомнится */
  }
}

export function clearSyncConfig(): void {
  try {
    localStorage.removeItem(SYNC_KEY);
  } catch {
    /* нечего чистить */
  }
}

/** Имя устройства для подписи «последнее изменение с телефона». */
export function deviceName(): string {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  return /iPhone|iPad|iPod|Android|Mobile/i.test(ua) ? 'телефона' : 'компьютера';
}

export function makeDeviceId(): string {
  return `dev-${Math.random().toString(36).slice(2, 10)}`;
}

/** Что показать в интерфейсе рядом с кнопкой сохранения. */
export interface SyncUiState {
  enabled: boolean;
  code: string;
  status: 'off' | 'syncing' | 'ok' | 'error';
  error: string;
  lastSyncAt: string;
  serverAt: string;
  serverDevice: string;
}

export function syncUiFromConfig(config: SyncConfig | null): SyncUiState {
  return {
    enabled: Boolean(config),
    code: config?.code ?? '',
    status: config ? 'ok' : 'off',
    error: '',
    lastSyncAt: config?.lastSyncAt ?? '',
    serverAt: config?.serverAt ?? '',
    serverDevice: config?.serverDevice ?? '',
  };
}

/* ------------------------------- документ ------------------------------- */

export function normalizeRemoved(raw: unknown): Removed {
  const source = (raw ?? {}) as Partial<Removed>;
  const pick = (value: unknown): Record<string, string> => {
    if (!value || typeof value !== 'object') return {};
    const out: Record<string, string> = {};
    for (const [id, at] of Object.entries(value as Record<string, unknown>)) {
      if (typeof id === 'string' && typeof at === 'string' && at) out[id] = at;
    }
    return out;
  };
  return {
    clients: pick(source.clients),
    deals: pick(source.deals),
    receipts: pick(source.receipts),
    events: pick(source.events),
  };
}

export function buildEnvelope(data: AppData, removed: Removed, device: string): SyncEnvelope {
  return {
    kind: 'crm-schedule/sync',
    schema: 1,
    device,
    savedAt: nowIso(),
    data,
    removed: normalizeRemoved(removed),
  };
}

/** Разобрать то, что пришло с сервера. Мусор и старые форматы отбрасываем. */
export function parseEnvelope(raw: unknown): { data: AppData; removed: Removed } | null {
  if (!raw || typeof raw !== 'object') return null;
  const envelope = raw as Partial<SyncEnvelope>;
  const candidate = envelope.data ?? (raw as unknown as AppData);
  const data = validateData(candidate);
  if (!data) return null;
  return { data, removed: normalizeRemoved(envelope.removed) };
}

/**
 * Отпечаток документа. Нужен, чтобы не гонять на сервер то, что там уже есть,
 * и чтобы ключи «надгробий» не влияли на сравнение.
 */
export function envelopeSignature(envelope: { data: AppData; removed: Removed }): string {
  const sort = (map: Record<string, string>) => Object.keys(map).sort().map((key) => [key, map[key]]);
  return JSON.stringify({
    data: envelope.data,
    removed: {
      clients: sort(envelope.removed.clients),
      deals: sort(envelope.removed.deals),
      events: sort(envelope.removed.events ?? {}),
    },
  });
}

/**
 * Короткий отпечаток документа (djb2). Нужен, чтобы не сравнивать мегабайты
 * JSON на каждом опросе: храним 8 символов вместо всей базы.
 */
export function hashEnvelope(envelope: { data: AppData; removed: Removed }): string {
  const text = envelopeSignature(envelope);
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0;
  }
  return `${(hash >>> 0).toString(36)}:${text.length.toString(36)}`;
}

/* ------------------------------- слияние ------------------------------- */

function stamp(item: { createdAt?: string; updatedAt?: string }): string {
  return item.updatedAt || item.createdAt || '';
}

function newerOf<T extends { createdAt?: string; updatedAt?: string }>(local: T, remote: T): T {
  return stamp(local) >= stamp(remote) ? local : remote;
}

export function mergeRemoved(a: Removed, b: Removed): Removed {
  const merge = (left: Record<string, string>, right: Record<string, string>) => {
    const out: Record<string, string> = { ...left };
    for (const [id, at] of Object.entries(right)) {
      if (!out[id] || at > out[id]) out[id] = at;
    }
    return out;
  };
  return {
    clients: merge(a.clients, b.clients),
    deals: merge(a.deals, b.deals),
    receipts: merge(a.receipts ?? {}, b.receipts ?? {}),
    events: merge(a.events ?? {}, b.events ?? {}),
  };
}

function mergeList<T extends { id: string; createdAt?: string; updatedAt?: string }>(
  local: T[],
  remote: T[],
  deleted: Record<string, string>,
  now: number,
): { items: T[]; deleted: Record<string, string> } {
  const remoteById = new Map(remote.map((item) => [item.id, item]));
  const localIds = new Set(local.map((item) => item.id));
  const items: T[] = [];

  const keep = (item: T) => {
    const removedAt = deleted[item.id];
    if (removedAt && removedAt > stamp(item)) return;
    items.push(item);
  };

  for (const item of local) {
    const other = remoteById.get(item.id);
    keep(other ? newerOf(item, other) : item);
  }
  const extras = remote
    .filter((item) => !localIds.has(item.id))
    .sort((left, right) => (stamp(left) < stamp(right) ? 1 : stamp(left) > stamp(right) ? -1 : 0));
  for (const item of extras) keep(item);

  const alive = new Set(items.map((item) => item.id));
  const nextDeleted: Record<string, string> = {};
  for (const [id, at] of Object.entries(deleted)) {
    if (alive.has(id)) continue;
    const ms = Date.parse(at);
    if (Number.isFinite(ms) && now - ms > TOMBSTONE_TTL_DAYS * 86400000) continue;
    nextDeleted[id] = at;
  }

  return { items, deleted: nextDeleted };
}

/**
 * Слияние двух копий базы. Каждая запись побеждает по своему updatedAt,
 * удалённая запись не возвращается, пока её не изменят заново.
 * Настройки берём из более свежего документа, но тема, разрешение на
 * уведомления и флаг «демо» остаются локальными.
 */
export function mergeSyncData(
  local: AppData,
  remote: AppData,
  removed: Removed,
): { data: AppData; removed: Removed } {
  const now = Date.now();
  const deleted = mergeRemoved(removed, emptyRemoved());
  const clients = mergeList<Client>(local.clients, remote.clients, deleted.clients, now);
  const deals = mergeList<Deal>(local.deals, remote.deals, deleted.deals, now);
  // Поступления на склад живут отдельно от сделок: удаление сделки не должно
  // стирать историю «что и когда привезли».
  const receipts = mergeList<WarehouseReceipt>(
    local.receipts ?? [], remote.receipts ?? [], deleted.receipts, now,
  );
  // Свободные события графика — обычные записи: удалённые не воскресают.
  const events = mergeList<CalendarEvent>(
    local.events ?? [], remote.events ?? [], deleted.events, now,
  );

  const localUpdated = local.updatedAt || '';
  const remoteUpdated = remote.updatedAt || '';
  const remoteWins = remoteUpdated > localUpdated;
  const baseSettings = remoteWins ? remote.settings : local.settings;
  // Учётные записи не теряем при слиянии: пароли отпечатками, поэтому
  // объединение по id безопасно и не даёт «потерять сотрудника» на телефоне.
  const baseAccounts = baseSettings.accounts ?? [];
  const otherAccounts = (remoteWins ? local.settings.accounts : remote.settings.accounts) ?? [];
  const seenAccounts = new Set(baseAccounts.map((account) => account.id));
  const accounts = [...baseAccounts, ...otherAccounts.filter((account) => !seenAccounts.has(account.id))];
  const settings = {
    ...baseSettings,
    theme: local.settings.theme,
    notifications: local.settings.notifications,
    demo: local.settings.demo && remote.settings.demo,
    accounts,
  };

  const createdAt = [local.createdAt, remote.createdAt].filter(Boolean).sort()[0] ?? nowIso();

  return {
    data: {
      version: 2,
      clients: clients.items,
      deals: deals.items,
      receipts: receipts.items,
      events: events.items,
      settings,
      createdAt,
      updatedAt: localUpdated > remoteUpdated ? localUpdated : remoteUpdated,
    },
    removed: {
      clients: clients.deleted,
      deals: deals.deleted,
      receipts: receipts.deleted,
      events: events.deleted,
    },
  };
}

/** На этом устройстве ещё нет своей базы: демо-данные или пусто. */
export function isFreshData(data: AppData): boolean {
  return data.settings.demo === true || (data.clients.length === 0 && data.deals.length === 0);
}

/* -------------------------------- сеть -------------------------------- */

export interface PullResult {
  found: boolean;
  /** На сервере та же версия: документ не скачивали, envelope === null. */
  unchanged: boolean;
  revision: number;
  envelope: { data: AppData; removed: Removed } | null;
  signature: string;
  updatedAt: string;
  device: string;
}

export type PushResult =
  | { ok: true; revision: number }
  | { ok: false; conflict: true; revision: number }
  | { ok: false; conflict: false; error: string };

async function callRpc(name: string, body: unknown): Promise<unknown> {
  if (typeof fetch !== 'function') throw new Error('Браузер не умеет сетевые запросы');
  let response: Response;
  try {
    response = await fetch(`${SYNC_ENDPOINT}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: {
        apikey: SYNC_PUBLIC_KEY,
        Authorization: `Bearer ${SYNC_PUBLIC_KEY}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Нет связи с сервером синхронизации');
  }
  if (response.status === 404) throw new Error('Общая база ещё не настроена на сервере');
  if (response.status === 401 || response.status === 403) throw new Error('Сервер не принял ключ синхронизации');
  if (!response.ok) throw new Error(`Сервер синхронизации ответил ${response.status}`);
  return response.json();
}

/**
 * Прочитать базу. Если известна версия, которая уже есть у клиента,
 * сервер отвечает только метаданными (`unchanged`) и не гоняет весь документ.
 */
export async function pullSpace(code: string, knownRevision?: number): Promise<PullResult> {
  const body: Record<string, unknown> = { p_token: normalizeSyncCode(code) };
  if (Number.isFinite(knownRevision) && (knownRevision ?? 0) > 0) body.p_known_revision = knownRevision;

  const raw = (await callRpc('crm_sync_pull', body)) as Record<string, unknown> | null;
  if (!raw || raw.found !== true) {
    return { found: false, unchanged: false, revision: 0, envelope: null, signature: '', updatedAt: '', device: '' };
  }
  const revision = Number(raw.revision) || 0;
  const updatedAt = typeof raw.updated_at === 'string' ? raw.updated_at : '';
  const device = typeof raw.device === 'string' ? raw.device : '';

  // Сервер подтвердил: «у тебя та же версия» — платить за документ не нужно.
  if (raw.unchanged === true) {
    return { found: true, unchanged: true, revision, envelope: null, signature: '', updatedAt, device };
  }

  const envelope = parseEnvelope(raw.payload);
  return {
    found: true,
    unchanged: false,
    revision,
    envelope,
    signature: envelope ? envelopeSignature(envelope) : '',
    updatedAt,
    device,
  };
}

export async function pushSpace(code: string, envelope: SyncEnvelope, revision: number): Promise<PushResult> {
  const raw = (await callRpc('crm_sync_push', {
    p_token: normalizeSyncCode(code),
    p_payload: envelope,
    p_revision: revision,
    p_device: envelope.device,
  })) as Record<string, unknown> | null;

  if (!raw) return { ok: false, conflict: false, error: 'Пустой ответ сервера' };
  if (raw.ok === true) return { ok: true, revision: Number(raw.revision) || revision + 1 };
  if (raw.conflict === true) return { ok: false, conflict: true, revision: Number(raw.revision) || 0 };
  const error = raw.error === 'too_large'
    ? 'База слишком большая для синхронизации — скачайте копию JSON'
    : raw.error === 'short_token'
      ? 'Код базы слишком короткий'
      : 'Сервер синхронизации отклонил запись';
  return { ok: false, conflict: false, error };
}

/* ------------------------------- версии ------------------------------- */

/** Одна сохранённая версия базы на сервере — для «вернуть, как было». */
export interface SpaceVersion {
  revision: number;
  device: string;
  savedAt: string;
  deals: number;
  clients: number;
  bytes: number;
}

/** Список последних версий базы (сервер помнит 12). */
export async function listVersions(code: string): Promise<SpaceVersion[]> {
  const raw = (await callRpc('crm_sync_versions', { p_token: normalizeSyncCode(code) })) as
    | { ok?: boolean; versions?: unknown[] }
    | null;
  if (!raw || raw.ok === false || !Array.isArray(raw.versions)) return [];
  return raw.versions
    .map((item) => {
      const row = (item ?? {}) as Record<string, unknown>;
      return {
        revision: Number(row.revision) || 0,
        device: typeof row.device === 'string' ? row.device : '',
        savedAt: typeof row.saved_at === 'string' ? row.saved_at : '',
        deals: Number(row.deals) || 0,
        clients: Number(row.clients) || 0,
        bytes: Number(row.bytes) || 0,
      };
    })
    .filter((version) => version.revision > 0);
}

/** Содержимое конкретной версии. null — сервер её уже не помнит. */
export async function fetchVersion(
  code: string,
  revision: number,
): Promise<{ data: AppData; removed: Removed } | null> {
  const raw = (await callRpc('crm_sync_version', {
    p_token: normalizeSyncCode(code),
    p_revision: revision,
  })) as { ok?: boolean; payload?: unknown } | null;
  if (!raw || raw.ok !== true) return null;
  return parseEnvelope(raw.payload);
}
