import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import { api, AUTH_EVENT } from './api';
import type { Category, Project, Task, Contact, User } from './types';

export interface ToastState {
  msg: string;
  undoLabel?: string;
  onUndo?: () => void | Promise<void>;
}

interface AppCtx {
  version: number;
  refresh: () => void;
  user: User | null;
  setUser: (u: User | null) => void;
  logout: () => Promise<void>;
  authReady: boolean;
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
  searchOpen: boolean;
  setSearchOpen: (v: boolean) => void;
  toast: (msg: string, undo?: { label?: string; run: () => void | Promise<void> }) => void;
  toastState: ToastState | null;
  closeToast: () => void;
  theme: 'light' | 'dark';
  toggleTheme: () => void;
}

const Ctx = createContext<AppCtx>(null as unknown as AppCtx);
export const useApp = () => useContext(Ctx);

export function AppProvider({ children }: { children: ReactNode }) {
  const [version, setVersion] = useState(0);
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [editingTask, setEditingTask] = useState<Partial<Task> | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrefill, setAiPrefill] = useState('');
  const [quickOpen, setQuickOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [toastState, setToastState] = useState<ToastState | null>(null);
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

  // Кто вошёл
  useEffect(() => {
    api.get<{ user: User }>('/auth/me')
      .then(r => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setAuthReady(true));
    const onUnauthorized = () => setUser(null);
    window.addEventListener(AUTH_EVENT, onUnauthorized);
    return () => window.removeEventListener(AUTH_EVENT, onUnauthorized);
  }, []);

  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => {});
    setUser(null);
  }, []);

  useEffect(() => {
    if (!user) return;
    api.get<Category[]>('/categories').then(setCategories).catch(() => {});
    api.get<Project[]>('/projects').then(setProjects).catch(() => {});
    api.get<Contact[]>('/contacts').then(setContacts).catch(() => {});
  }, [version, user]);

  const toast = useCallback((msg: string, undo?: { label?: string; run: () => void | Promise<void> }) => {
    setToastState({ msg, undoLabel: undo?.label ?? 'Отменить', onUndo: undo?.run });
    const delay = undo ? 7000 : 3200;
    const id = window.setTimeout(() => setToastState(cur => (cur && cur.msg === msg ? null : cur)), delay);
    return () => window.clearTimeout(id);
  }, []);

  const closeToast = useCallback(() => setToastState(null), []);

  // Живые напоминания: раз в минуту проверяем, не подошло ли время
  useEffect(() => {
    if (!user) return;
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
            // тост с кнопкой «💤 Через час»
            setToastState({
              msg: `⏰ Напоминание: ${r.title}`,
              undoLabel: '💤 Через час',
              onUndo: async () => {
                await api.post(`/reminders/${r.id}/snooze`, { minutes: 60 });
                notified.delete(r.id);
                sessionStorage.setItem('notified', JSON.stringify([...notified]));
                refresh();
              },
            });
            window.setTimeout(() => setToastState(cur => (cur && cur.msg.includes(r.title) ? null : cur)), 15000);
            // системное уведомление, если пользователь разрешил
            if ('Notification' in window && Notification.permission === 'granted') {
              try { new Notification('⏰ Напоминание', { body: r.title, icon: '/icons/icon-192.png' }); } catch { /* ignore */ }
            }
            break; // не больше одного за проверку
          }
        }
      } catch { /* offline */ }
    };
    check();
    const iv = window.setInterval(check, 60000);
    return () => window.clearInterval(iv);
  }, [user, refresh]);

  const value = useMemo<AppCtx>(() => ({
    version, refresh, user, setUser, logout, authReady,
    categories, projects, contacts,
    editingTask, openTask: setEditingTask,
    aiOpen,
    aiPrefill,
    openAi: (p?: string) => { setAiPrefill(p || ''); setAiOpen(true); },
    closeAi: () => setAiOpen(false),
    quickOpen, setQuickOpen,
    searchOpen, setSearchOpen,
    toast, toastState, closeToast,
    theme, toggleTheme,
  }), [version, user, authReady, categories, projects, contacts, editingTask, aiOpen, aiPrefill,
    quickOpen, searchOpen, toastState, theme, refresh, logout, toast, closeToast, toggleTheme]);

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
