/* Единое состояние приложения: клиенты, сделки, настройки и уведомления.
 * Все изменения проходят здесь, поэтому сохраняются в localStorage сразу. */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { AppData, Client, Deal, DealSchedule, DealStatus, HistoryEntry, Settings } from './types';
import { demoData } from './lib/demoData';
import { emptyData, loadData, saveData } from './lib/storage';
import { nowIso, uid } from './lib/utils';
import { defaultNextAction, statusMeta } from './lib/crm';

export interface ToastMessage {
  id: string;
  kind: 'ok' | 'error' | 'info';
  text: string;
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
  saveClient: (client: Client) => void;
  removeClient: (id: string) => void;
  mergeClients: (targetId: string, sourceId: string) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  replaceData: (next: AppData) => void;
  resetDemo: () => void;
  clearAll: () => void;
  toasts: ToastMessage[];
  notify: (text: string, kind?: ToastMessage['kind']) => void;
  dismissToast: (id: string) => void;
  storageOk: boolean;
}

const AppContext = createContext<AppContextValue | null>(null);

function ensureData(): AppData {
  return loadData() ?? demoData();
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData>(ensureData);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [storageOk, setStorageOk] = useState(true);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    setStorageOk(saveData(data));
  }, [data]);

  useEffect(() => () => { timers.current.forEach((id) => window.clearTimeout(id)); }, []);

  const notify = useCallback((text: string, kind: ToastMessage['kind'] = 'ok') => {
    const id = uid('toast');
    setToasts((current) => [...current.slice(-3), { id, kind, text }]);
    const timer = window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 4200);
    timers.current.push(timer);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

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
            text: statusMeta(status).label,
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
    setData((current) => ({
      ...current,
      deals: current.deals.filter((deal) => deal.id !== id),
      updatedAt: nowIso(),
    }));
  }, []);

  const saveClient = useCallback((client: Client) => {
    setData((current) => {
      const exists = current.clients.some((item) => item.id === client.id);
      return {
        ...current,
        clients: exists
          ? current.clients.map((item) => (item.id === client.id ? { ...client, updatedAt: nowIso() } : item))
          : [...current.clients, client],
        updatedAt: nowIso(),
      };
    });
  }, []);

  const removeClient = useCallback((id: string) => {
    setData((current) => ({
      ...current,
      clients: current.clients.filter((client) => client.id !== id),
      deals: current.deals.map((deal) => (deal.clientId === id ? { ...deal, clientId: '' } : deal)),
      updatedAt: nowIso(),
    }));
  }, []);

  const mergeClients = useCallback((targetId: string, sourceId: string) => {
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
  }, []);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setData((current) => ({ ...current, settings: { ...current.settings, ...patch }, updatedAt: nowIso() }));
  }, []);

  const replaceData = useCallback((next: AppData) => setData(next), []);
  const resetDemo = useCallback(() => setData(demoData()), []);
  const clearAll = useCallback(() => setData(emptyData()), []);

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
    updateSettings,
    replaceData,
    resetDemo,
    clearAll,
    toasts,
    notify,
    dismissToast,
    storageOk,
  }), [
    data, clientName, clientFor, updateDeal, patchDeal, changeStatus, updateSchedule, addDeal,
    removeDeal, saveClient, removeClient, mergeClients, updateSettings, replaceData, resetDemo,
    clearAll, toasts, notify, dismissToast, storageOk,
  ]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp должен вызываться внутри AppProvider');
  return context;
}
