import { useEffect } from 'react';
import { AppProvider, useApp, useRoute } from './store';
import Today from './pages/Today';
import Calendar from './pages/Calendar';
import Tasks from './pages/Tasks';
import Projects from './pages/Projects';
import ProjectView from './pages/ProjectView';
import Clients from './pages/Clients';
import ClientView from './pages/ClientView';
import Notes from './pages/Notes';
import Money from './pages/Money';
import More from './pages/More';
import TaskModal from './components/TaskModal';
import AiModal from './components/AiModal';
import QuickAdd from './components/QuickAdd';
import SearchModal from './components/SearchModal';
import Login, { ForcePasswordChange } from './components/Login';

const NAV = [
  { path: '/today', icon: '☀️', label: 'Сегодня' },
  { path: '/calendar', icon: '📅', label: 'Календарь' },
  { path: '/tasks', icon: '☑️', label: 'Задачи' },
  { path: '/projects', icon: '📁', label: 'Заказы' },
  { path: '/clients', icon: '🤝', label: 'Клиенты' },
  { path: '/money', icon: '💰', label: 'Деньги' },
  { path: '/notes', icon: '📝', label: 'Заметки' },
  { path: '/more', icon: '⋯', label: 'Ещё' },
];

function Shell() {
  const { path, parts, nav } = useRoute();
  const {
    openAi, setQuickOpen, setSearchOpen, toastState, closeToast,
    theme, toggleTheme, user, logout,
  } = useApp();

  // Горячие клавиши: N — добавить, A — ассистент, T — Сегодня, C — календарь,
  // Ctrl+K или «/» — поиск.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault(); setSearchOpen(true); return;
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (e.key === '/') { e.preventDefault(); setSearchOpen(true); }
      else if (k === 'n' || k === 'т') { e.preventDefault(); setQuickOpen(true); }
      else if (k === 'a' || k === 'ф') { e.preventDefault(); openAi(); }
      else if (k === 't' || k === 'е') { nav('/today'); }
      else if (k === 'c' || k === 'с') { nav('/calendar'); }
      else if (k === 'm' || k === 'ь') { nav('/money'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nav, openAi, setQuickOpen, setSearchOpen]);

  const page = (() => {
    if (parts[0] === 'calendar') return <Calendar />;
    if (parts[0] === 'tasks') return <Tasks />;
    if (parts[0] === 'projects' && parts[1]) return <ProjectView id={Number(parts[1])} />;
    if (parts[0] === 'projects') return <Projects />;
    if (parts[0] === 'clients' && parts[1]) return <ClientView id={Number(parts[1])} />;
    if (parts[0] === 'clients') return <Clients />;
    if (parts[0] === 'money') return <Money />;
    if (parts[0] === 'notes') return <Notes />;
    if (parts[0] === 'more') return <More section={parts[1]} />;
    return <Today />;
  })();

  const isActive = (p: string) => path.startsWith(p);

  return (
    <div className="layout">
      {/* Desktop sidebar */}
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">☀️</span> Мой<span>День</span></div>
        {NAV.map(n => (
          <button key={n.path} className={`nav-item${isActive(n.path) ? ' active' : ''}`} onClick={() => nav(n.path)}>
            <span className="icon">{n.icon}</span> {n.label}
          </button>
        ))}
        <button className="nav-item" onClick={() => setSearchOpen(true)}>
          <span className="icon">🔎</span> Поиск <span className="kbd">Ctrl K</span>
        </button>
        <button className="btn ai ai-btn" onClick={() => openAi()}>✨ Что нужно сделать?</button>
        <button className="btn mt8" onClick={() => setQuickOpen(true)}>+ Быстро добавить</button>
        <button className="theme-toggle mt8" onClick={toggleTheme}>
          {theme === 'dark' ? '🌞 Светлая тема' : '🌙 Тёмная тема'}
        </button>
        <div className="sidebar-user">
          <span title={user?.login}>👤 {user?.name || user?.login}</span>
          <button className="btn ghost small" onClick={logout}>Выйти</button>
        </div>
      </aside>

      <main className="main">{page}</main>

      {/* Mobile bottom nav */}
      <nav className="bottomnav">
        {NAV.slice(0, 2).map(n => (
          <button key={n.path} className={isActive(n.path) ? 'active' : ''} onClick={() => nav(n.path)}>
            <span className="icon">{n.icon}</span>{n.label}
          </button>
        ))}
        <button className="fab" onClick={() => setQuickOpen(true)}>+</button>
        {NAV.slice(2, 4).map(n => (
          <button key={n.path} className={isActive(n.path) ? 'active' : ''} onClick={() => nav(n.path)}>
            <span className="icon">{n.icon}</span>{n.label}
          </button>
        ))}
        <button className={isActive('/more') || isActive('/notes') || isActive('/clients') ? 'active' : ''} onClick={() => nav('/more')}>
          <span className="icon">⋯</span>Ещё
        </button>
      </nav>

      <TaskModal />
      <AiModal />
      <QuickAdd />
      <SearchModal />
      {toastState && (
        <div className="toast">
          <span>{toastState.msg}</span>
          {toastState.onUndo && (
            <button className="toast-undo" onClick={async () => { const fn = toastState.onUndo!; closeToast(); await fn(); }}>
              {toastState.undoLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Gate() {
  const { user, authReady } = useApp();
  if (!authReady) return <div className="empty" style={{ marginTop: 80 }}>Загрузка…</div>;
  if (!user) return <Login />;
  if (user.must_change_password) return <ForcePasswordChange />;
  return <Shell />;
}

export default function App() {
  return (
    <AppProvider>
      <Gate />
    </AppProvider>
  );
}
