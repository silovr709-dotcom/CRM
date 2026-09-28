import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import { api } from './api';
import type { Category, Project, Task, Contact } from './types';

interface AppCtx {
  version: number;
  refresh: () => void;
  categories: Category[];
  projects: Project[];
  contacts: Contact[];
  // модалки
  editingTask: Partial<Task> | null;
  openTask: (t: Partial<Task> | null) => void;
  aiOpen: boolean;
  aiPrefill: string;
  openAi: (prefill?: string) => void;
  closeAi: () => void;
  quickOpen: boolean;
  setQuickOpen: (v: boolean) => void;
  toast: (msg: string) => void;
  toastMsg: string | null;
}

const Ctx = createContext<AppCtx>(null as unknown as AppCtx);
export const useApp = () => useContext(Ctx);

export function AppProvider({ children }: { children: ReactNode }) {
  const [version, setVersion] = useState(0);
  const [categories, setCategories] = useState<Category[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [editingTask, setEditingTask] = useState<Partial<Task> | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrefill, setAiPrefill] = useState('');
  const [quickOpen, setQuickOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const refresh = useCallback(() => setVersion(v => v + 1), []);

  useEffect(() => {
    api.get<Category[]>('/categories').then(setCategories).catch(() => {});
    api.get<Project[]>('/projects').then(setProjects).catch(() => {});
    api.get<Contact[]>('/contacts').then(setContacts).catch(() => {});
  }, [version]);

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    window.setTimeout(() => setToastMsg(null), 3200);
  }, []);

  const value = useMemo<AppCtx>(() => ({
    version, refresh, categories, projects, contacts,
    editingTask, openTask: setEditingTask,
    aiOpen,
    aiPrefill,
    openAi: (p?: string) => { setAiPrefill(p || ''); setAiOpen(true); },
    closeAi: () => setAiOpen(false),
    quickOpen, setQuickOpen,
    toast, toastMsg,
  }), [version, categories, projects, contacts, editingTask, aiOpen, aiPrefill, quickOpen, toastMsg]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// --- мини-роутер на hash ---
export function useRoute(): { path: string; parts: string[]; nav: (p: string) => void } {
  const [path, setPath] = useState(() => location.hash.slice(1) || '/today');
  useEffect(() => {
    const onHash = () => setPath(location.hash.slice(1) || '/today');
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const nav = useCallback((p: string) => { location.hash = p; }, []);
  return { path, parts: path.split('/').filter(Boolean), nav };
}
