/* Единое состояние приложения: клиенты, сделки, настройки, отмена и уведомления.
 * Все изменения проходят здесь, поэтому сохраняются в localStorage сразу. */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  AppData, Attachment, Client, Deal, DealSchedule, DealStatus, HistoryEntry, Settings,
} from './types';
import { demoData } from './lib/demoData';
import { emptyData, loadData, saveData, writeAutoBackup } from './lib/storage';
import { nowIso, uid } from './lib/utils';
import { defaultNextAction, statusMeta } from './lib/crm';
import {
  MAX_FILE_BYTES, compressImage, detectKind, removeFile, saveFile, type OwnerType,
} from './lib/attachments';
import {
  buildEnvelope, clearSyncConfig, deviceName, emptyRemoved, envelopeSignature, isFreshData,
  loadSyncConfig, makeDeviceId, mergeRemoved, mergeSyncData, MIN_CODE_LENGTH, normalizeSyncCode,
  hashEnvelope, pullSpace, pushSpace, saveSyncConfig, syncUiFromConfig,
  type Removed, type SyncConfig, type SyncUiState,
} from './lib/sync';

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface ToastMessage {
  id: string;
  kind: 'ok' | 'error' | 'info';
  text: string;
  action?: ToastAction;
}

export interface AttachmentResult {
  added: number;
  failed: Array<{ name: string; reason: string }>;
}

interface UndoEntry {
  label: string;
  data: AppData;
}

interface AppContextValue {
  data: AppData;
  deals: Deal[];
  clients: Client[];
  settings: Settings;
  clientName: (deal: Deal) => string;
  clientFor: (deal: Deal) => Client | undefined;
  updateDeal: (deal: Deal) => void;
  patchDeal: (id: string, patch: Partial<Deal>, history?: Omit<HistoryEntry, 'id' | 'createdAt'>) => void;
  changeStatus: (id: string, status: DealStatus) => void;
  updateSchedule: (id: string, patch: Partial<DealSchedule>) => void;
  addDeal: (input: { title: string; clientId: string; amount?: number; status?: DealStatus; manager?: string }) => string;
  removeDeal: (id: string) => void;
  saveClient: (client: Client) => string;
  removeClient: (id: string) => void;
  mergeClients: (targetId: string, sourceId: string) => void;
  /** Добавить сделку из ссылки, которую прислал коллега. */
  importSharedDeal: (deal: Deal, client?: Client) => string;
  /** Загрузить файлы в сделку или клиента. Возвращает, что получилось. */
  addAttachments: (ownerType: OwnerType, ownerId: string, files: File[]) => Promise<AttachmentResult>;
  /** Удалить вложение: и запись, и файл. */
  removeAttachment: (ownerType: OwnerType, ownerId: string, attachmentId: string) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  replaceData: (next: AppData, options?: { backupReason?: string; undoLabel?: string }) => void;
  resetDemo: () => void;
  clearAll: () => void;
  undo: () => void;
  canUndo: boolean;
  toasts: ToastMessage[];
  notify: (text: string, kind?: ToastMessage['kind'], action?: ToastAction) => void;
  dismissToast: (id: string) => void;
  storageOk: boolean;
  /** Когда данные последний раз сохранены. */
  savedAt: string;
  /** Общая база: включена ли синхронизация и как она себя чувствует. */
  sync: SyncUiState;
  /** Включить общую базу. `create` — создать новую по новому коду. */
  enableSync: (code: string, options?: { create?: boolean }) => Promise<boolean>;
  /** Выключить синхронизацию на этом устройстве (данные остаются). */
  disableSync: () => void;
  /** Проверить общую базу прямо сейчас. */
  syncNow: () => Promise<void>;
}

interface SyncRoundOptions {
  /** Можно создавать базу, если её ещё нет (так делает первое устройство). */
  allowCreate?: boolean;
}

interface SyncRoundResult {
  ok: boolean;
  error?: string;
  created?: boolean;
}

const SYNC_NOT_FOUND = 'not_found';

const AppContext = createContext<AppContextValue | null>(null);

const MAX_UNDO = 6;

function ensureData(): AppData {
  return loadData() ?? (() => {
    const demo = demoData();
    return { ...demo, settings: { ...demo.settings, demo: true } };
  })();
}

function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function resolvedTheme(mode: Settings['theme']): 'light' | 'dark' {
  if (mode === 'system') return systemPrefersDark() ? 'dark' : 'light';
  return mode;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [data, setDataState] = useState<AppData>(ensureData);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [storageOk, setStorageOk] = useState(true);
  const [savedAt, setSavedAt] = useState('');
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const timers = useRef<number[]>([]);
  const dataRef = useRef(data);
  dataRef.current = data;

  /* ------------------------- общая база устройств ------------------------- */

  const syncRef = useRef<SyncConfig | null>(loadSyncConfig());
  const [sync, setSync] = useState<SyncUiState>(() => syncUiFromConfig(syncRef.current));
  /** Отпечаток документа, который уже лежит на сервере. */
  const serverSig = useRef('');
  const syncBusy = useRef(false);
  const syncRerun = useRef(false);
  const pushTimer = useRef(0);
  const syncRoundRef = useRef<(options?: SyncRoundOptions) => Promise<SyncRoundResult>>(
    async () => ({ ok: false }),
  );

  const patchSyncUi = useCallback((patch: Partial<SyncUiState>) => {
    setSync((current) => ({ ...current, ...patch }));
  }, []);

  /**
   * Удаления нужно запоминать: без этого запись, удалённая на телефоне,
   * вернулась бы с компьютера при следующем обмене.
   */
  const rememberRemovals = useCallback((prev: AppData, next: AppData) => {
    const config = syncRef.current;
    if (!config) return;
    const at = nowIso();
    const pairs: Array<[keyof Removed, Array<{ id: string }>, Array<{ id: string }>]> = [
      ['clients', prev.clients, next.clients],
      ['deals', prev.deals, next.deals],
    ];
    let touched = false;
    for (const [kind, before, after] of pairs) {
      const beforeIds = new Set(before.map((item) => item.id));
      const afterIds = new Set(after.map((item) => item.id));
      for (const id of beforeIds) {
        if (!afterIds.has(id)) {
          config.removed[kind][id] = at;
          touched = true;
        }
      }
      for (const id of afterIds) {
        if (!beforeIds.has(id) && config.removed[kind][id]) {
          delete config.removed[kind][id];
          touched = true;
        }
      }
    }
    if (touched) saveSyncConfig(config);
  }, []);

  /** Данные с сервера кладём напрямую: их удаления уже учтены в слиянии. */
  const applyRemoteData = useCallback((next: AppData) => {
    setDataState(next);
  }, []);

  /** Любое локальное изменение: сохраняем и попутно отмечаем удалённые записи. */
  const setData = useCallback((updater: AppData | ((current: AppData) => AppData)) => {
    setDataState((current) => {
      const next = typeof updater === 'function' ? (updater as (value: AppData) => AppData)(current) : updater;
      if (next !== current) rememberRemovals(current, next);
      return next;
    });
  }, [rememberRemovals]);

  /** Один круг обмена: прочитать сервер, слить, записать обратно при расхождении. */
  const syncRound = useCallback(async (options: SyncRoundOptions = {}): Promise<SyncRoundResult> => {
    const config = syncRef.current;
    if (!config) return { ok: false, error: 'off' };
    if (syncBusy.current) {
      syncRerun.current = true;
      return { ok: true };
    }
    syncBusy.current = true;
    syncRerun.current = false;
    let failure = '';
    const result: SyncRoundResult = { ok: true };

    patchSyncUi({ status: 'syncing', error: '' });
    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const remote = await pullSpace(config.code, config.revision);

        // Сервер ответил «та же версия»: документ не скачивали.
        // Если и локальных правок нет — делать нечего.
        if (remote.found && remote.unchanged) {
          config.revision = remote.revision;
          config.known = true;
          config.serverAt = remote.updatedAt;
          config.serverDevice = remote.device;
          config.lastSyncAt = nowIso();
          saveSyncConfig(config);

          const localEnvelope = buildEnvelope(dataRef.current, config.removed, config.deviceName);
          if (hashEnvelope(localEnvelope) === (config.serverHash ?? '')) break;

          const pushed = await pushSpace(config.code, localEnvelope, config.revision);
          if (pushed.ok) {
            config.revision = pushed.revision;
            config.lastSyncAt = nowIso();
            config.serverAt = config.lastSyncAt;
            config.serverDevice = config.deviceName;
            config.serverHash = hashEnvelope(localEnvelope);
            saveSyncConfig(config);
            serverSig.current = envelopeSignature(localEnvelope);
            break;
          }
          if (pushed.conflict) continue;
          failure = pushed.error;
          break;
        }

        // Базы ещё нет: создаём её данными этого устройства.
        if (!remote.found) {
          if (!options.allowCreate && !config.known) {
            failure = SYNC_NOT_FOUND;
            break;
          }
          const envelope = buildEnvelope(dataRef.current, config.removed, config.deviceName);
          const created = await pushSpace(config.code, envelope, 0);
          if (created.ok) {
            config.revision = created.revision;
            config.known = true;
            config.lastSyncAt = nowIso();
            config.serverAt = config.lastSyncAt;
            config.serverDevice = config.deviceName;
            config.serverHash = hashEnvelope(envelope);
            saveSyncConfig(config);
            serverSig.current = envelopeSignature(envelope);
            result.created = true;
            break;
          }
          if (created.conflict) continue;
          failure = created.error;
          break;
        }

        if (!remote.envelope) {
          failure = 'Данные в общей базе повреждены';
          break;
        }

        const local = dataRef.current;
        const firstConnect = !config.known && isFreshData(local);
        const merged = firstConnect
          ? {
            data: {
              ...remote.envelope.data,
              settings: {
                ...remote.envelope.data.settings,
                theme: local.settings.theme,
                notifications: local.settings.notifications,
              },
            },
            removed: mergeRemoved(remote.envelope.removed, config.removed),
          }
          : mergeSyncData(local, remote.envelope.data, mergeRemoved(config.removed, remote.envelope.removed));

        // Удаление, сделанное на этом устройстве, не должно «воскресать»
        // при первом подключении к чужой базе.
        if (!firstConnect) {
          merged.removed = mergeRemoved(merged.removed, config.removed);
        }

        config.revision = remote.revision;
        config.known = true;
        config.removed = merged.removed;
        config.serverAt = remote.updatedAt;
        config.serverDevice = remote.device;
        config.lastSyncAt = nowIso();
        config.serverHash = hashEnvelope({ data: remote.envelope.data, removed: remote.envelope.removed });
        saveSyncConfig(config);
        serverSig.current = remote.signature;

        if (JSON.stringify(merged.data) !== JSON.stringify(local)) applyRemoteData(merged.data);

        const envelope = buildEnvelope(merged.data, merged.removed, config.deviceName);
        if (envelopeSignature(envelope) === remote.signature) break;

        const pushed = await pushSpace(config.code, envelope, remote.revision);
        if (pushed.ok) {
          config.revision = pushed.revision;
          config.lastSyncAt = nowIso();
          config.serverAt = config.lastSyncAt;
          config.serverDevice = config.deviceName;
          config.serverHash = hashEnvelope(envelope);
          saveSyncConfig(config);
          serverSig.current = envelopeSignature(envelope);
          break;
        }
        if (pushed.conflict) continue;
        failure = pushed.error;
        break;
      }
    } catch (error) {
      failure = error instanceof Error ? error.message : 'Не удалось связаться с сервером';
    } finally {
      syncBusy.current = false;
    }

    if (failure) {
      patchSyncUi({ status: 'error', error: failure });
      return { ok: false, error: failure, created: result.created };
    }

    const fresh = syncUiFromConfig(syncRef.current);
    setSync({ ...fresh, status: 'ok', error: '' });

    if (syncRerun.current) {
      syncRerun.current = false;
      window.setTimeout(() => { void syncRoundRef.current(options); }, 0);
    }
    return result;
  }, [applyRemoteData, patchSyncUi]);

  useEffect(() => {
    syncRoundRef.current = syncRound;
  }, [syncRound]);

  // Первый обмен при запуске и дальше — раз в 20 секунд, пока экран открыт.
  useEffect(() => {
    const config = syncRef.current;
    if (!config) return undefined;
    void syncRoundRef.current({ allowCreate: config.known });

    const tick = () => {
      if (document.visibilityState === 'hidden') return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      void syncRoundRef.current({ allowCreate: syncRef.current?.known === true });
    };
    const timer = window.setInterval(tick, 20000);
    window.addEventListener('online', tick);
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('online', tick);
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [sync.enabled]);

  // Локальные правки уходят на сервер через секунду после последней.
  useEffect(() => {
    const config = syncRef.current;
    if (!config) return undefined;
    const envelope = buildEnvelope(data, config.removed, config.deviceName);
    if (envelopeSignature(envelope) === serverSig.current) return undefined;
    window.clearTimeout(pushTimer.current);
    pushTimer.current = window.setTimeout(() => {
      const current = syncRef.current;
      if (!current) return;
      void syncRoundRef.current({ allowCreate: current.known });
    }, 1200);
    return () => window.clearTimeout(pushTimer.current);
  }, [data]);

  useEffect(() => {
    const ok = saveData(data);
    setStorageOk(ok);
    if (ok) setSavedAt(nowIso());
  }, [data]);

  // Тема: light / dark / как в системе.
  useEffect(() => {
    const apply = () => {
      const theme = resolvedTheme(data.settings.theme);
      document.documentElement.dataset.theme = theme;
      document.documentElement.style.colorScheme = theme;
      document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
        meta.setAttribute('content', theme === 'dark' ? '#0b1120' : '#f3f5fa');
      });
    };
    apply();
    if (data.settings.theme !== 'system' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [data.settings.theme]);

  useEffect(() => () => { timers.current.forEach((id) => window.clearTimeout(id)); }, []);

  const notify = useCallback((text: string, kind: ToastMessage['kind'] = 'ok', action?: ToastAction) => {
    const id = uid('toast');
    setToasts((current) => [...current.slice(-3), { id, kind, text, action }]);
    const timer = window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, action ? 8000 : 4200);
    timers.current.push(timer);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const enableSync = useCallback(async (rawCode: string, options: { create?: boolean } = {}) => {
    const code = normalizeSyncCode(rawCode);
    if (code.length < MIN_CODE_LENGTH) {
      notify('Код состоит из 24 символов — проверьте, что скопировали его целиком', 'error');
      return false;
    }
    const config: SyncConfig = {
      code,
      revision: 0,
      deviceId: makeDeviceId(),
      deviceName: deviceName(),
      lastSyncAt: '',
      serverAt: '',
      serverDevice: '',
      known: false,
      removed: emptyRemoved(),
    };
    syncRef.current = config;
    saveSyncConfig(config);
    serverSig.current = '';
    setSync(syncUiFromConfig(config));

    const result = await syncRound({ allowCreate: options.create === true });
    if (!result.ok) {
      if (result.error === SYNC_NOT_FOUND) {
        syncRef.current = null;
        clearSyncConfig();
        setSync(syncUiFromConfig(null));
        notify('База с таким кодом не найдена. Проверьте код или создайте новую', 'error');
      } else {
        notify(`Синхронизация не включилась: ${result.error}`, 'error');
      }
      return false;
    }
    notify(
      options.create
        ? 'Общая база создана. Откройте ссылку на телефоне — данные подтянутся сами'
        : 'База подключена, данные синхронизированы',
      'ok',
    );
    return true;
  }, [notify, syncRound]);

  const disableSync = useCallback(() => {
    syncRef.current = null;
    clearSyncConfig();
    serverSig.current = '';
    setSync(syncUiFromConfig(null));
    notify('Синхронизация отключена. Данные остались на этом устройстве', 'info');
  }, [notify]);

  const syncNow = useCallback(async () => {
    if (!syncRef.current) return;
    const result = await syncRound({ allowCreate: syncRef.current.known });
    if (result.ok) notify('Данные синхронизированы', 'ok');
    else notify(`Не удалось синхронизировать: ${result.error}`, 'error');
  }, [notify, syncRound]);


  /** Снимок «как было» для отмены. React не любит побочные эффекты в
   *  обновлении состояния, поэтому снимок берём из ссылки на текущие данные. */
  const pushUndo = useCallback((label: string) => {
    const snapshot = dataRef.current;
    setUndoStack((stack) => [...stack, { label, data: snapshot }].slice(-MAX_UNDO));
  }, []);

  const undo = useCallback(() => {
    setUndoStack((stack) => {
      const last = stack[stack.length - 1];
      if (!last) return stack;
      setData(last.data);
      notify(`Отменено: ${last.label}`, 'info');
      return stack.slice(0, -1);
    });
  }, [notify]);

  const clientName = useCallback((deal: Deal) => {
    const client = data.clients.find((item) => item.id === deal.clientId);
    return client?.name || 'Без клиента';
  }, [data.clients]);

  const clientFor = useCallback((deal: Deal) => data.clients.find((item) => item.id === deal.clientId), [data.clients]);

  const updateDeal = useCallback((deal: Deal) => {
    setData((current) => ({
      ...current,
      deals: current.deals.map((item) => (item.id === deal.id ? { ...deal, updatedAt: nowIso() } : item)),
      updatedAt: nowIso(),
    }));
  }, []);

  const patchDeal = useCallback((id: string, patch: Partial<Deal>, history?: Omit<HistoryEntry, 'id' | 'createdAt'>) => {
    setData((current) => ({
      ...current,
      deals: current.deals.map((deal) => {
        if (deal.id !== id) return deal;
        return {
          ...deal,
          ...patch,
          history: history
            ? [...(deal.history ?? []), { ...history, id: uid('h'), createdAt: nowIso() }]
            : deal.history,
          updatedAt: nowIso(),
        };
      }),
      updatedAt: nowIso(),
    }));
  }, []);

  const changeStatus = useCallback((id: string, status: DealStatus) => {
    setData((current) => ({
      ...current,
      deals: current.deals.map((deal) => {
        if (deal.id !== id) return deal;
        return {
          ...deal,
          status,
          nextAction: deal.nextAction?.trim() || defaultNextAction(status),
          nextContactAt: deal.nextContactAt ?? new Date().toISOString().slice(0, 10),
          history: [...(deal.history ?? []), {
            id: uid('h'),
            createdAt: nowIso(),
            kind: 'status',
            title: 'Смена этапа',
            text: `${statusMeta(deal.status).label} → ${statusMeta(status).label}`,
          }],
          updatedAt: nowIso(),
        };
      }),
      updatedAt: nowIso(),
    }));
  }, []);

  const updateSchedule = useCallback((id: string, patch: Partial<DealSchedule>) => {
    setData((current) => ({
      ...current,
      deals: current.deals.map((deal) => (deal.id === id
        ? { ...deal, schedule: { ...deal.schedule, ...patch }, updatedAt: nowIso() }
        : deal)),
      updatedAt: nowIso(),
    }));
  }, []);

  const addDeal = useCallback((input: { title: string; clientId: string; amount?: number; status?: DealStatus; manager?: string }) => {
    const id = uid('deal');
    const status = input.status ?? 'draft';
    const deal: Deal = {
      id,
      title: input.title,
      clientId: input.clientId,
      amount: input.amount ?? 0,
      manager: input.manager,
      status,
      nextAction: defaultNextAction(status),
      tasks: [],
      payments: [],
      history: [{ id: uid('h'), createdAt: nowIso(), kind: 'project', title: 'Сделка создана' }],
      schedule: { status: 'planned' },
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    setData((current) => ({
      ...current,
      deals: [deal, ...current.deals],
      updatedAt: nowIso(),
    }));
    return id;
  }, []);

  const removeDeal = useCallback((id: string) => {
    const deal = dataRef.current.deals.find((item) => item.id === id);
    if (!deal) return;
    pushUndo(`удалена сделка «${deal.title}»`);
    setData((current) => ({
      ...current,
      deals: current.deals.filter((item) => item.id !== id),
      updatedAt: nowIso(),
    }));
    notify(`Сделка «${deal.title}» удалена`, 'info', { label: 'Вернуть', run: undo });
  }, [notify, pushUndo, undo]);

  const saveClient = useCallback((client: Client): string => {
    const id = client.id || uid('client');
    const saved: Client = { ...client, id, updatedAt: nowIso() };
    setData((current) => {
      const exists = current.clients.some((item) => item.id === id);
      return {
        ...current,
        clients: exists
          ? current.clients.map((item) => (item.id === id ? saved : item))
          : [...current.clients, saved],
        updatedAt: nowIso(),
      };
    });
    return id;
  }, []);

  const removeClient = useCallback((id: string) => {
    const client = dataRef.current.clients.find((item) => item.id === id);
    if (!client) return;
    const dealCount = dataRef.current.deals.filter((deal) => deal.clientId === id).length;
    pushUndo(`удалён клиент «${client.name}»`);
    setData((current) => ({
      ...current,
      clients: current.clients.filter((item) => item.id !== id),
      deals: current.deals.map((deal) => (deal.clientId === id ? { ...deal, clientId: '' } : deal)),
      updatedAt: nowIso(),
    }));
    notify(
      dealCount > 0 ? `Клиент «${client.name}» удалён, сделки остались без клиента` : `Клиент «${client.name}» удалён`,
      'info',
      { label: 'Вернуть', run: undo },
    );
  }, [notify, pushUndo, undo]);

  const mergeClients = useCallback((targetId: string, sourceId: string) => {
    pushUndo('клиенты объединены');
    setData((current) => {
      const target = current.clients.find((item) => item.id === targetId);
      const source = current.clients.find((item) => item.id === sourceId);
      if (!target || !source) return current;
      const merged: Client = {
        ...target,
        phones: Array.from(new Set([...target.phones, ...source.phones])),
        emails: Array.from(new Set([...target.emails, ...source.emails])),
        tags: Array.from(new Set([...target.tags, ...source.tags])),
        address: target.address || source.address,
        source: target.source || source.source,
        managerComment: [target.managerComment, source.managerComment].filter(Boolean).join('\n') || undefined,
        updatedAt: nowIso(),
      };
      return {
        ...current,
        clients: current.clients.filter((item) => item.id !== sourceId).map((item) => (item.id === targetId ? merged : item)),
        deals: current.deals.map((deal) => (deal.clientId === sourceId ? { ...deal, clientId: targetId } : deal)),
        updatedAt: nowIso(),
      };
    });
    notify('Клиенты объединены', 'ok', { label: 'Вернуть', run: () => undo() });
  }, [notify, pushUndo, undo]);

  const addAttachments = useCallback(async (ownerType: OwnerType, ownerId: string, files: File[]): Promise<AttachmentResult> => {
    const result: AttachmentResult = { added: 0, failed: [] };
    if (files.length === 0) return result;

    const list: Attachment[] = [];
    const blobs = new Map<string, Blob>();
    for (const file of files) {
      if (file.size > MAX_FILE_BYTES) {
        result.failed.push({ name: file.name, reason: 'файл больше 25 МБ' });
        continue;
      }
      try {
        const prepared = await compressImage(file);
        const mime = prepared.blob.type || file.type || 'application/octet-stream';
        const attachment: Attachment = {
          id: uid('file'),
          name: file.name,
          mime,
          size: prepared.blob.size,
          kind: detectKind({ name: file.name, mime }),
          createdAt: nowIso(),
          width: prepared.width,
          height: prepared.height,
          addedBy: dataRef.current.settings.myName || undefined,
        };
        await saveFile(attachment, ownerType, ownerId, prepared.blob);
        list.push(attachment);
        blobs.set(attachment.id, prepared.blob);
        result.added += 1;
      } catch (error) {
        result.failed.push({
          name: file.name,
          reason: error instanceof Error ? error.message : 'не удалось сохранить',
        });
      }
    }

    if (list.length === 0) return result;

    pushUndo('добавлены файлы');
    const stamp = nowIso();
    setData((current) => {
      if (ownerType === 'deal') {
        return {
          ...current,
          deals: current.deals.map((deal) => (deal.id === ownerId
            ? {
              ...deal,
              attachments: [...(deal.attachments ?? []), ...list],
              history: [...(deal.history ?? []), {
                id: uid('h'),
                createdAt: stamp,
                kind: 'document' as const,
                title: `Добавлены файлы: ${list.length}`,
                text: list.map((item) => item.name).join(', ').slice(0, 300),
              }],
              updatedAt: stamp,
            }
            : deal)),
          updatedAt: stamp,
        };
      }
      return {
        ...current,
        clients: current.clients.map((client) => (client.id === ownerId
          ? { ...client, attachments: [...(client.attachments ?? []), ...list], updatedAt: stamp }
          : client)),
        updatedAt: stamp,
      };
    });
    return result;
  }, [pushUndo]);

  const removeAttachment = useCallback((ownerType: OwnerType, ownerId: string, attachmentId: string) => {
    pushUndo('удалён файл');
    const stamp = nowIso();
    setData((current) => {
      if (ownerType === 'deal') {
        return {
          ...current,
          deals: current.deals.map((deal) => (deal.id === ownerId
            ? {
              ...deal,
              attachments: (deal.attachments ?? []).filter((item) => item.id !== attachmentId),
              updatedAt: stamp,
            }
            : deal)),
          updatedAt: stamp,
        };
      }
      return {
        ...current,
        clients: current.clients.map((client) => (client.id === ownerId
          ? { ...client, attachments: (client.attachments ?? []).filter((item) => item.id !== attachmentId), updatedAt: stamp }
          : client)),
        updatedAt: stamp,
      };
    });
    removeFile(attachmentId).catch(() => {});
    notify('Файл удалён', 'info', { label: 'Вернуть', run: undo });
  }, [notify, pushUndo, undo]);

  const importSharedDeal = useCallback((deal: Deal, client?: Client) => {
    pushUndo('импорт сделки по ссылке');
    const clientId = client ? uid('cli') : deal.clientId;
    const nextDeal: Deal = {
      ...deal,
      id: uid('deal'),
      clientId,
      history: [
        ...(deal.history ?? []),
        { id: uid('h'), createdAt: nowIso(), kind: 'project', title: 'Добавлено по ссылке от коллеги' },
      ],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    setData((current) => {
      const clients = client && !current.clients.some((item) => item.name === client.name)
        ? [...current.clients, { ...client, id: clientId, createdAt: nowIso(), updatedAt: nowIso() }]
        : current.clients;
      const resolvedClientId = client
        ? (current.clients.find((item) => item.name === client.name)?.id ?? clientId)
        : clientId;
      return {
        ...current,
        clients,
        deals: [{ ...nextDeal, clientId: resolvedClientId }, ...current.deals],
        updatedAt: nowIso(),
      };
    });
    return nextDeal.id;
  }, [pushUndo]);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setData((current) => ({ ...current, settings: { ...current.settings, ...patch }, updatedAt: nowIso() }));
  }, []);

  const replaceData = useCallback((next: AppData, options?: { backupReason?: string; undoLabel?: string }) => {
    if (options?.backupReason) writeAutoBackup(dataRef.current, options.backupReason);
    pushUndo(options?.undoLabel ?? 'замена данных');
    setData(next);
  }, [pushUndo]);

  const resetDemo = useCallback(() => {
    writeAutoBackup(dataRef.current, 'загрузка демо-данных');
    pushUndo('загружены демо-данные');
    const demo = demoData();
    setData({ ...demo, settings: { ...demo.settings, demo: true } });
    notify('Загружены демо-данные', 'info', { label: 'Вернуть', run: undo });
  }, [notify, pushUndo, undo]);

  const clearAll = useCallback(() => {
    const current = dataRef.current;
    writeAutoBackup(current, 'очистка базы');
    pushUndo('все данные удалены');
    // Настройки (компания, шаблоны, правила) остаются: чистим только записи.
    setData({ ...emptyData(), settings: { ...current.settings, demo: false } });
    notify('Все данные удалены. Копию можно вернуть кнопкой ниже', 'info', { label: 'Вернуть', run: undo });
  }, [notify, pushUndo, undo]);

  const value = useMemo<AppContextValue>(() => ({
    data,
    deals: data.deals,
    clients: data.clients,
    settings: data.settings,
    clientName,
    clientFor,
    updateDeal,
    patchDeal,
    changeStatus,
    updateSchedule,
    addDeal,
    removeDeal,
    saveClient,
    removeClient,
    mergeClients,
    importSharedDeal,
    addAttachments,
    removeAttachment,
    updateSettings,
    replaceData,
    resetDemo,
    clearAll,
    undo,
    canUndo: undoStack.length > 0,
    toasts,
    notify,
    dismissToast,
    storageOk,
    savedAt,
    sync,
    enableSync,
    disableSync,
    syncNow,
  }), [
    data, clientName, clientFor, updateDeal, patchDeal, changeStatus, updateSchedule, addDeal,
    removeDeal, saveClient, removeClient, mergeClients, importSharedDeal, addAttachments,
    removeAttachment, updateSettings, replaceData,
    resetDemo, clearAll, undo, undoStack.length, toasts, notify, dismissToast, storageOk, savedAt,
    sync, enableSync, disableSync, syncNow,
  ]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp должен вызываться внутри AppProvider');
  return context;
}
