import { AppProvider, useApp, useRoute } from './store';
import Today from './pages/Today';
import Calendar from './pages/Calendar';
import Tasks from './pages/Tasks';
import Projects from './pages/Projects';
import ProjectView from './pages/ProjectView';
import Notes from './pages/Notes';
import More from './pages/More';
import TaskModal from './components/TaskModal';
import AiModal from './components/AiModal';
import QuickAdd from './components/QuickAdd';

const NAV = [
  { path: '/today', icon: '☀️', label: 'Сегодня' },
  { path: '/calendar', icon: '📅', label: 'Календарь' },
  { path: '/tasks', icon: '☑️', label: 'Задачи' },
  { path: '/projects', icon: '📁', label: 'Проекты' },
  { path: '/notes', icon: '📝', label: 'Заметки' },
  { path: '/more', icon: '⋯', label: 'Ещё' },
];

function Shell() {
  const { path, parts, nav } = useRoute();
  const { openAi, setQuickOpen, toastMsg, theme, toggleTheme } = useApp();

  const page = (() => {
    if (parts[0] === 'calendar') return <Calendar />;
    if (parts[0] === 'tasks') return <Tasks />;
    if (parts[0] === 'projects' && parts[1]) return <ProjectView id={Number(parts[1])} />;
    if (parts[0] === 'projects') return <Projects />;
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
        <button className="btn ai ai-btn" onClick={() => openAi()}>✨ Что нужно сделать?</button>
        <button className="btn mt8" onClick={() => setQuickOpen(true)}>+ Быстро добавить</button>
        <button className="theme-toggle mt8" onClick={toggleTheme}>
          {theme === 'dark' ? '🌞 Светлая тема' : '🌙 Тёмная тема'}
        </button>
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
        <button className={isActive('/more') || isActive('/notes') ? 'active' : ''} onClick={() => nav('/more')}>
          <span className="icon">⋯</span>Ещё
        </button>
      </nav>

      <TaskModal />
      <AiModal />
      <QuickAdd />
      {toastMsg && <div className="toast">{toastMsg}</div>}
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
