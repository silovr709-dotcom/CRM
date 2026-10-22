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
}

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
  const [data, setData] = useState<AppData>(ensureData);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [storageOk, setStorageOk] = useState(true);
  const [savedAt, setSavedAt] = useState('');
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const timers = useRef<number[]>([]);
  const dataRef = useRef(data);
  dataRef.current = data;

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
  }), [
    data, clientName, clientFor, updateDeal, patchDeal, changeStatus, updateSchedule, addDeal,
    removeDeal, saveClient, removeClient, mergeClients, importSharedDeal, addAttachments,
    removeAttachment, updateSettings, replaceData,
    resetDemo, clearAll, undo, undoStack.length, toasts, notify, dismissToast, storageOk, savedAt,
  ]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp должен вызываться внутри AppProvider');
  return context;
}
