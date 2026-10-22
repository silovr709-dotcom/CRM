// Единое приложение: CRM + график монтажей. Навигация, карточки и автоматика.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from './store';
import Dashboard from './components/Dashboard';
import CrmView from './components/CrmView';
import ScheduleView from './components/ScheduleView';
import TasksView from './components/TasksView';
import DataView from './components/DataView';
import DealDialog from './components/DealDialog';
import ClientDialog from './components/ClientDialog';
import Modal from './components/Modal';
import ScheduleFields from './components/ScheduleFields';
import Toasts from './components/Toasts';
import { fmtDate, fmtMoney, todayISO } from './lib/dates';
import { contactTone, isClosedStatus } from './lib/crm';
import { taskStats } from './lib/crmTasks';
import { collectEvents } from './lib/schedule';
import { loadRules } from './lib/rules';
import { runAutomations } from './lib/crmAutomation';
import { scheduleWarnings } from './lib/schedule';

type ViewId = 'overview' | 'crm' | 'schedule' | 'tasks' | 'data';

const NAV: Array<{ id: ViewId; label: string; icon: string }> = [
  { id: 'overview', label: 'Обзор', icon: '◈' },
  { id: 'crm', label: 'CRM', icon: '◆' },
  { id: 'schedule', label: 'График монтажей', icon: '▦' },
  { id: 'tasks', label: 'Задачи', icon: '☑' },
  { id: 'data', label: 'Данные', icon: '⚙' },
];

const AUTOMATION_KEY = 'crm-schedule.automation.lastRun';
const VIEW_KEY = 'crm-schedule.view';

export default function App() {
  const { data, deals, clientName, replaceData, notify } = useApp();
  const [view, setView] = useState<ViewId>(() => {
    const saved = localStorage.getItem(VIEW_KEY);
    return NAV.some((item) => item.id === saved) ? saved as ViewId : 'overview';
  });
  const [dealId, setDealId] = useState<string | null>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  const [scheduleDealId, setScheduleDealId] = useState<string | null>(null);
  const ranAutomation = useRef(false);

  const today = todayISO();
  const counts = useMemo(() => {
    const active = deals.filter((deal) => !isClosedStatus(deal.status));
    const events = collectEvents(deals);
    const stats = taskStats(deals, today);
    return {
      contacts: active.filter((deal) => ['today', 'overdue'].includes(contactTone(deal.nextContactAt, today))).length,
      installsToday: events.filter((event) => event.kind === 'install' && event.date === today).length,
      tasksOverdue: stats.overdue,
      warnings: scheduleWarnings(deals).length,
      pipeline: active.reduce((sum, deal) => sum + deal.amount, 0),
    };
  }, [deals, today]);

  useEffect(() => {
    localStorage.setItem(VIEW_KEY, view);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [view]);

  // Автоматика проверяет сделки один раз в день при открытии приложения.
  useEffect(() => {
    if (ranAutomation.current) return;
    ranAutomation.current = true;
    if (localStorage.getItem(AUTOMATION_KEY) === today) return;
    const rules = loadRules();
    if (!rules.some((rule) => rule.enabled)) return;
    const timer = window.setTimeout(() => {
      const result = runAutomations(deals, rules);
      localStorage.setItem(AUTOMATION_KEY, today);
      if (result.applied.length > 0) {
        replaceData({ ...data, deals: result.deals, updatedAt: new Date().toISOString() });
        notify(`Автоматика добавила задач: ${result.applied.length}`, 'info');
      }
    }, 700);
    return () => window.clearTimeout(timer);
    // запускаем один раз при старте — дальше правила доступны в «Данных»
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openDeal = (id: string) => {
    setClientId(null);
    setScheduleDealId(null);
    setDealId(id);
  };
  const openClient = (id: string) => {
    setDealId(null);
    setClientId(id);
  };
  const openSchedule = () => setView('schedule');

  const scheduleDeal = scheduleDealId ? deals.find((deal) => deal.id === scheduleDealId) ?? null : null;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">К</div>
          <div>
            <b>CRM + График</b>
            <span>{data.settings.companyName}</span>
          </div>
        </div>

        <nav className="side-nav" aria-label="Разделы">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              className={view === item.id ? 'active' : ''}
              onClick={() => setView(item.id)}
            >
              <i className="nav-icon">{item.icon}</i>
              <span>{item.label}</span>
              {item.id === 'crm' && counts.contacts > 0 && <b className="nav-badge">{counts.contacts}</b>}
              {item.id === 'schedule' && counts.installsToday > 0 && <b className="nav-badge amber">{counts.installsToday}</b>}
              {item.id === 'tasks' && counts.tasksOverdue > 0 && <b className="nav-badge red">{counts.tasksOverdue}</b>}
            </button>
          ))}
        </nav>

        <div className="side-today">
          <span>Сегодня</span>
          <b>{fmtDate(today, { withYear: true })}</b>
          <small>Портфель: {fmtMoney(counts.pipeline, { compact: true })}</small>
          {counts.warnings > 0 && <small className="warn">⚠ Проверок графика: {counts.warnings}</small>}
        </div>

        <div className="side-foot">
          <span className="saved-dot" /> Сохранено в браузере
          <small>Резервная копия — в разделе «Данные»</small>
        </div>
      </aside>

      <main className="content">
        {view === 'overview' && (
          <Dashboard
            onOpenDeal={openDeal}
            onOpenSchedule={openSchedule}
            onOpenCrm={() => setView('crm')}
            onOpenTasks={() => setView('tasks')}
          />
        )}
        {view === 'crm' && (
          <CrmView
            onOpenDeal={openDeal}
            onOpenClient={openClient}
            onNewClient={() => setClientId('new')}
          />
        )}
        {view === 'schedule' && (
          <ScheduleView
            onOpenDeal={openDeal}
            onEditSchedule={(id) => setScheduleDealId(id)}
          />
        )}
        {view === 'tasks' && <TasksView onOpenDeal={openDeal} />}
        {view === 'data' && <DataView />}
      </main>

      <nav className="mobile-nav" aria-label="Мобильная навигация">
        {NAV.map((item) => (
          <button key={item.id} type="button" className={view === item.id ? 'active' : ''} onClick={() => setView(item.id)}>
            <i>{item.icon}</i>
            <span>{item.id === 'schedule' ? 'График' : item.label}</span>
            {item.id === 'crm' && counts.contacts > 0 && <b className="mobile-badge">{counts.contacts}</b>}
          </button>
        ))}
      </nav>

      {dealId && (
        <DealDialog
          dealId={dealId}
          onClose={() => setDealId(null)}
          onOpenClient={(id) => { setDealId(null); openClient(id); }}
          onOpenSchedule={() => { setDealId(null); openSchedule(); }}
        />
      )}

      {clientId && (
        <ClientDialog
          clientId={clientId}
          onClose={() => setClientId(null)}
          onOpenDeal={(id) => { setClientId(null); openDeal(id); }}
        />
      )}

      {scheduleDeal && (
        <Modal
          title={scheduleDeal.title}
          subtitle={`${clientName(scheduleDeal)} · ${fmtMoney(scheduleDeal.amount)}`}
          onClose={() => setScheduleDealId(null)}
          size="lg"
          footer={(
            <>
              <button type="button" className="btn ghost" onClick={() => { const id = scheduleDeal.id; setScheduleDealId(null); openDeal(id); }}>
                Карточка сделки
              </button>
              <span className="foot-spacer" />
              <button type="button" className="btn primary" onClick={() => setScheduleDealId(null)}>Готово</button>
            </>
          )}
        >
          <ScheduleFields deal={scheduleDeal} />
        </Modal>
      )}

      <Toasts />
    </div>
  );
}
