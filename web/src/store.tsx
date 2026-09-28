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
  theme: 'light' | 'dark';
  toggleTheme: () => void;
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
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('theme');
    if (saved === 'light' || saved === 'dark') return saved;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  const refresh = useCallback(() => setVersion(v => v + 1), []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = useCallback(() => setTheme(t => (t === 'dark' ? 'light' : 'dark')), []);

  useEffect(() => {
    api.get<Category[]>('/categories').then(setCategories).catch(() => {});
    api.get<Project[]>('/projects').then(setProjects).catch(() => {});
    api.get<Contact[]>('/contacts').then(setContacts).catch(() => {});
  }, [version]);

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    window.setTimeout(() => setToastMsg(null), 3200);
  }, []);

  // Живые напоминания: раз в минуту проверяем, не подошло ли время
  useEffect(() => {
    const notified = new Set<number>(JSON.parse(sessionStorage.getItem('notified') || '[]'));
    const check = async () => {
      try {
        const reminders = await api.get<{ id: number; title: string; remind_date: string; remind_time: string | null }[]>('/reminders');
        const now = new Date();
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const nowTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        for (const r of reminders) {
          const due = r.remind_date < today || (r.remind_date === today && (!r.remind_time || r.remind_time <= nowTime));
          if (due && !notified.has(r.id)) {
            notified.add(r.id);
            sessionStorage.setItem('notified', JSON.stringify([...notified]));
            toast(`⏰ Напоминание: ${r.title}`);
            break; // не больше одного за проверку
          }
        }
      } catch { /* offline */ }
    };
    check();
    const iv = window.setInterval(check, 60000);
    return () => window.clearInterval(iv);
  }, [toast]);

  const value = useMemo<AppCtx>(() => ({
    version, refresh, categories, projects, contacts,
    editingTask, openTask: setEditingTask,
    aiOpen,
    aiPrefill,
    openAi: (p?: string) => { setAiPrefill(p || ''); setAiOpen(true); },
    closeAi: () => setAiOpen(false),
    quickOpen, setQuickOpen,
    toast, toastMsg,
    theme, toggleTheme,
  }), [version, categories, projects, contacts, editingTask, aiOpen, aiPrefill, quickOpen, toastMsg, theme]);

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
