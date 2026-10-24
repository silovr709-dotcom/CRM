// Единое приложение: CRM + график монтажей. Маршруты в адресе, ⌘K, тема, карточки.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarDays, ChartColumn, CheckSquare, Download, LayoutDashboard, LogOut, Menu, Moon, Plus,
  Search, Settings2, Smartphone, Sun, TriangleAlert, Users, WifiOff, X,
} from 'lucide-react';
import { useApp } from './store';
import Dashboard from './components/Dashboard';
import CrmView from './components/CrmView';
import ScheduleView from './components/ScheduleView';
import TasksView from './components/TasksView';
import ReportsView from './components/ReportsView';
import DataView from './components/DataView';
import DealDialog from './components/DealDialog';
import ClientDialog from './components/ClientDialog';
import NewDealDialog from './components/NewDealDialog';
import CommandPalette from './components/CommandPalette';
import Toasts from './components/Toasts';
import SavedBadge from './components/SavedBadge';
import SyncBadge from './components/SyncBadge';
import Modal from './components/Modal';
import StatusPage from './components/StatusPage';
import LoginScreen from './components/LoginScreen';
import { fmtDate, fmtMoney, todayISO } from './lib/dates';
import { contactTone, isClosedStatus } from './lib/crm';
import { taskStats } from './lib/crmTasks';
import { collectEvents, scheduleWarnings } from './lib/schedule';
import { normalizeRules, runAutomations } from './lib/crmAutomation';
import { setTitleBadge } from './lib/notify';
import { useReminders } from './lib/useReminders';
import NotificationCenter from './components/NotificationCenter';
import { decodeShare, decodeStatus } from './lib/share';
import {
  applyUpdate, onInstallAvailability, promptInstall, registerServiceWorker, watchOnline,
  isStandalone,
} from './lib/pwa';
import { navigate, useRoute, type ViewId } from './lib/router';

const NAV: Array<{ id: ViewId; label: string; short: string; icon: typeof LayoutDashboard }> = [
  { id: 'overview', label: 'Обзор', short: 'Обзор', icon: LayoutDashboard },
  { id: 'crm', label: 'CRM', short: 'CRM', icon: Users },
  { id: 'schedule', label: 'График монтажей', short: 'График', icon: CalendarDays },
  { id: 'tasks', label: 'Задачи', short: 'Задачи', icon: CheckSquare },
  { id: 'reports', label: 'Отчёты', short: 'Отчёты', icon: ChartColumn },
  { id: 'data', label: 'Данные', short: 'Данные', icon: Settings2 },
];

const AUTOMATION_KEY = 'crm-schedule.automation.lastRun';
const SYNC_HINT_KEY = 'crm-schedule.sync.hint.v1';

export default function App() {
  const {
    data, deals, clients, settings, clientName, importSharedDeal, updateSettings,
    replaceData, updateSchedule, notify, undo, sync, role, currentAccount, needsLogin, logout,
  } = useApp();
  const route = useRoute();
  const view = route.view;
  // Роль «Монтажник» не видит денег — значит, и отчёт ей не нужен.
  const visibleNav = NAV.filter((item) => item.id !== 'reports' || role.canSeeMoney);
  const today = todayISO();

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [newClientOpen, setNewClientOpen] = useState(false);
  const [newDealClient, setNewDealClient] = useState<string | null>(null);
  const [installDay, setInstallDay] = useState<string | null>(null);
  const [sharePreview, setSharePreview] = useState<string | null>(null);
  const [shareError, setShareError] = useState(false);
  const [queue, setQueue] = useState<string[] | null>(null);
  const [online, setOnline] = useState(true);
  const [installable, setInstallable] = useState(false);
  const [updateReady, setUpdateReady] = useState(false);
  const [syncHint, setSyncHint] = useState(() => {
    try {
      return !localStorage.getItem(SYNC_HINT_KEY);
    } catch {
      return false;
    }
  });
  const ranAutomation = useRef(false);

  const dismissSyncHint = useCallback(() => {
    try {
      localStorage.setItem(SYNC_HINT_KEY, '1');
    } catch {
      /* приватный режим — подсказка просто скроется до перезагрузки */
    }
    setSyncHint(false);
  }, []);

  const counts = useMemo(() => {
    const active = deals.filter((deal) => !isClosedStatus(deal.status));
    const events = collectEvents(deals);
    const stats = taskStats(deals, today);
    return {
      contacts: active.filter((deal) => ['today', 'overdue'].includes(contactTone(deal.nextContactAt, today))).length,
      installsToday: events.filter((event) => event.kind === 'install' && event.date === today).length,
      tasksOverdue: stats.overdue,
      tasksOpen: stats.open,
      warnings: scheduleWarnings(deals).length,
      pipeline: active.reduce((sum, deal) => sum + deal.amount, 0),
    };
  }, [deals, today]);

  const go = useCallback((next: ViewId) => {
    setMenuOpen(false);
    navigate({ view: next });
  }, []);

  const openDeal = useCallback((id: string, tab?: string) => {
    navigate({ view: 'crm', dealId: id, tab });
  }, []);

  const openClient = useCallback((id: string) => {
    navigate({ view: 'crm', clientId: id });
  }, []);

  const reminders = useReminders({
    onOpenDeal: (id) => navigate({ view: 'crm', dealId: id }),
    onOpenSchedule: () => navigate({ view: 'schedule' }),
  });


  const closeOverlays = useCallback(() => {
    setSharePreview(null);
    setShareError(false);
    setQueue(null);
    navigate({ view: route.view }, { replace: true, keepScroll: true });
  }, [route.view]);

  // ⌘K / Ctrl+K — поиск, «/» — тоже открывает поиск, Esc закрывает меню.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable);
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      if (!typing && event.key === '/') {
        event.preventDefault();
        setPaletteOpen(true);
      }
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Ссылка на сделку: #/share/<payload> — предлагаем добавить в базу.
  useEffect(() => {
    if (!route.share) return;
    const payload = decodeShare(route.share);
    if (!payload) { setShareError(true); return; }
    setSharePreview(route.share);
  }, [route.share]);

  // PWA: сеть, установка на телефон, обновление версии.
  useEffect(() => watchOnline(setOnline), []);
  useEffect(() => onInstallAvailability(setInstallable), []);
  useEffect(() => registerServiceWorker({ onUpdateReady: () => setUpdateReady(true) }), []);
  useEffect(() => {
    if (!updateReady) return;
    notify('Доступна новая версия приложения', 'info', {
      label: 'Обновить',
      run: () => { applyUpdate().catch(() => window.location.reload()); },
    });
  }, [updateReady, notify]);

  const install = async () => {
    const done = await promptInstall();
    if (done) notify('Приложение установлено на устройство');
  };

  // ?new=deal|client|install — быстрые ссылки «создать» из меню и писем.
  useEffect(() => {
    if (!route.create) return;
    if (route.create === 'deal') setNewDealClient('');
    if (route.create === 'client') setNewClientOpen(true);
    if (route.create === 'install') setInstallDay(today);
    navigate({ view: route.view }, { replace: true, keepScroll: true });
  }, [route.create, route.view, today]);

  // Автоматика — раз в день при открытии; правила берём из настроек.
  useEffect(() => {
    if (ranAutomation.current) return;
    ranAutomation.current = true;
    if (localStorage.getItem(AUTOMATION_KEY) === today) return;
    const rules = normalizeRules(settings.rules);
    if (!rules.some((rule) => rule.enabled)) return;
    const timer = window.setTimeout(() => {
      const result = runAutomations(deals, rules);
      localStorage.setItem(AUTOMATION_KEY, today);
      if (result.applied.length > 0) {
        replaceData({ ...data, deals: result.deals, updatedAt: new Date().toISOString() }, { undoLabel: 'автоматика' });
        notify(`Автоматика добавила задач: ${result.applied.length}`, 'info');
      }
    }, 800);
    return () => window.clearTimeout(timer);
    // запускаем один раз при старте
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Заголовок вкладки: раздел + счётчик напоминаний из канала «в заголовке».
  const titleCount = reminders.active.filter((reminder) => reminder.channels.includes('title')).length;
  useEffect(() => {
    setTitleBadge(titleCount, `${NAV.find((item) => item.id === view)?.label ?? 'CRM'} · CRM + График`);
  }, [view, titleCount]);

  const theme = settings.theme;
  const toggleTheme = () => {
    updateSettings({ theme: theme === 'dark' ? 'light' : 'dark' });
  };

  const dealForRoute = route.dealId ? deals.find((deal) => deal.id === route.dealId) : undefined;
  const clientForRoute = route.clientId ? clients.find((client) => client.id === route.clientId) : undefined;

  const shared = sharePreview ? decodeShare(sharePreview) : null;
  const statusPayload = route.status ? decodeStatus(route.status) : null;
  const queueDeal = queue && queue.length > 0 ? deals.find((deal) => deal.id === queue[0]) : undefined;

  const startQueue = (ids: string[]) => {
    if (ids.length === 0) { notify('Очередь пуста — все контакты на сегодня закрыты', 'info'); return; }
    setQueue(ids);
    openDeal(ids[0]);
  };

  const queueNext = () => {
    if (!queue) return;
    const rest = queue.slice(1);
    if (rest.length === 0) {
      setQueue(null);
      notify('Очередь разобрана', 'ok');
      navigate({ view: 'crm' }, { keepScroll: true });
      return;
    }
    setQueue(rest);
    openDeal(rest[0]);
  };

  // Страница для клиента живёт вне CRM: без меню, без правок, без общей базы.
  if (route.status) return <StatusPage payload={statusPayload} />;

  // Учётные записи заведены — без пароля внутрь не пускаем.
  if (needsLogin) return <LoginScreen />;

  return (
    <div className="app-shell">
      <NotificationCenter
        reminders={reminders}
        onOpenDeal={(id) => openDeal(id)}
        onOpenSettings={() => go('data')}
        floating
      />

      <aside className="sidebar">
        <button
          type="button"
          className="brand"
          title="На обзор"
          onClick={() => go('overview')}
        >
          <span className="brand-mark">К</span>
          <span className="brand-text">
            <b>CRM + График</b>
            <span>{settings.companyName || 'монтажи и заказы'}</span>
          </span>
        </button>

        <button type="button" className="search-trigger" onClick={() => setPaletteOpen(true)}>
          <Search size={15} />
          <span>Поиск и действия</span>
          <kbd>⌘K</kbd>
        </button>

        <nav className="side-nav" aria-label="Разделы">
          {visibleNav.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                className={view === item.id ? 'active' : ''}
                aria-current={view === item.id ? 'page' : undefined}
                onClick={() => go(item.id)}
              >
                <Icon size={17} />
                <span>{item.label}</span>
                {item.id === 'crm' && counts.contacts > 0 && <b className="nav-badge">{counts.contacts}</b>}
                {item.id === 'schedule' && counts.installsToday > 0 && <b className="nav-badge amber">{counts.installsToday}</b>}
                {item.id === 'tasks' && counts.tasksOverdue > 0 && <b className="nav-badge red">{counts.tasksOverdue}</b>}
              </button>
            );
          })}
        </nav>

        <NotificationCenter
          reminders={reminders}
          onOpenDeal={(id) => openDeal(id)}
          onOpenSettings={() => go('data')}
        />

        {currentAccount && (
          <div className="side-user">
            <span className="side-user-main">
              <b>{currentAccount.name}</b>
              <small>{role.label}</small>
            </span>
            <button type="button" className="icon-btn small" title="Выйти" aria-label="Выйти" onClick={logout}>
              <LogOut size={14} />
            </button>
          </div>
        )}

        <button type="button" className="side-new" onClick={() => setNewDealClient('')}>
          <Plus size={16} /> Новая сделка
        </button>

        <div className="side-today">
          <span>Сегодня</span>
          <b>{fmtDate(today, { withYear: true })}</b>
          <small>Портфель: {fmtMoney(counts.pipeline)}</small>
          {counts.warnings > 0 && (
            <button type="button" className="side-warn" onClick={() => go('schedule')}>
              <TriangleAlert size={12} /> проверок графика: {counts.warnings}
            </button>
          )}
        </div>

        <div className="side-foot">
          <SavedBadge />
          <SyncBadge />
          {installable && !isStandalone() && (
            <button type="button" className="side-install" onClick={install}>
              <Download size={13} /> Установить на телефон
            </button>
          )}
          {settings.demo && (
            <button
              type="button"
              className="demo-hint"
              onClick={() => go('data')}
              title="Это пример данных — замените своими в разделе «Данные»"
            >
              демо-данные
            </button>
          )}
        </div>
      </aside>

      <header className="topbar">
        <button type="button" className="icon-btn" onClick={() => setMenuOpen(!menuOpen)} aria-label="Меню" aria-expanded={menuOpen}>
          <Menu size={18} />
        </button>
        <span className="topbar-title">{NAV.find((item) => item.id === view)?.label}</span>
        <button type="button" className="icon-btn" onClick={() => setPaletteOpen(true)} aria-label="Поиск">
          <Search size={17} />
        </button>
        <button type="button" className="icon-btn" onClick={toggleTheme} aria-label="Переключить тему" title="Тема">
          {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
        </button>
        <button type="button" className="btn small primary" onClick={() => setNewDealClient('')}>+ Сделка</button>
      </header>

      {menuOpen && (
        <div className="mobile-menu" role="dialog" aria-label="Разделы">
          <div className="mobile-menu-head">
            <b>Разделы</b>
            <button type="button" className="icon-btn" onClick={() => setMenuOpen(false)} aria-label="Закрыть"><X size={16} /></button>
          </div>
          {NAV.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.id} type="button" className={view === item.id ? 'active' : ''} onClick={() => go(item.id)}>
                <Icon size={17} /> {item.label}
              </button>
            );
          })}
          <button type="button" onClick={() => { setMenuOpen(false); setNewClientOpen(true); }}>
            <Users size={17} /> Новый клиент
          </button>
          <button type="button" onClick={() => { setMenuOpen(false); setInstallDay(today); }}>
            <CalendarDays size={17} /> Поставить монтаж
          </button>
          {installable && !isStandalone() && (
            <button type="button" onClick={() => { setMenuOpen(false); install(); }}>
              <Download size={17} /> Установить приложение
            </button>
          )}
          <div className="mobile-menu-foot"><SavedBadge /><SyncBadge /></div>
        </div>
      )}

      {!online && (
        <div className="offline-banner" role="status">
          <WifiOff size={15} />
          <span>Нет сети. Приложение работает, изменения сохраняются в браузере и никуда не денутся.</span>
        </div>
      )}

      {settings.demo && (
        <div className="demo-banner" role="status">
          <span>Это демонстрационные данные. Замените их своими — или скачайте копию перед началом.</span>
          <button type="button" className="link-btn" onClick={() => go('data')}>Настроить</button>
          <button
            type="button"
            className="icon-btn small"
            aria-label="Скрыть подсказку о демо-данных"
            title="Скрыть"
            onClick={() => updateSettings({ demo: false })}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {syncHint && !sync.enabled && (
        <div className="demo-banner sync-hint" role="status">
          <Smartphone size={15} />
          <span>
            Клиенты и сделки могут быть сразу на телефоне и компьютере. Включите общую базу —
            код и ссылка появятся в «Данных».
          </span>
          <button type="button" className="link-btn" onClick={() => { dismissSyncHint(); go('data'); }}>
            Включить
          </button>
          <button
            type="button"
            className="icon-btn small"
            aria-label="Скрыть подсказку об общей базе"
            title="Скрыть"
            onClick={dismissSyncHint}
          >
            <X size={14} />
          </button>
        </div>
      )}

      <main className="content">
        {view === 'overview' && (
          <Dashboard
            onOpenDeal={openDeal}
            onOpenSchedule={() => go('schedule')}
            onOpenCrm={() => go('crm')}
            onOpenTasks={() => go('tasks')}
            onOpenReports={() => go('reports')}
            onNewDeal={() => setNewDealClient('')}
          />
        )}

        {view === 'crm' && (
          <CrmView
            onOpenDeal={openDeal}
            onOpenClient={openClient}
            onNewClient={() => setNewClientOpen(true)}
            onNewDeal={() => setNewDealClient('')}
            onStartQueue={startQueue}
          />
        )}

        {view === 'schedule' && (
          <ScheduleView
            onOpenDeal={(id) => { setInstallDay(null); openDeal(id); }}
            onEditSchedule={(id) => { setInstallDay(null); navigate({ view: 'crm', dealId: id, tab: 'schedule' }); }}
            onCreateInstall={(day) => setInstallDay(day ?? today)}
          />
        )}

        {view === 'tasks' && <TasksView onOpenDeal={openDeal} />}

        {view === 'reports' && (
          role.canSeeMoney ? <ReportsView onOpenDeal={openDeal} /> : (
            <section className="card empty-card">
              <h2>Отчёты скрыты ролью</h2>
              <p className="muted">
                На этом устройстве выбрана роль «{role.label}»: суммы, маржа и отчёты не показываются.
                Сменить роль можно в «Данных» — это делает руководитель.
              </p>
            </section>
          )
        )}

        {view === 'data' && <DataView />}
      </main>

      <nav className="mobile-nav" aria-label="Мобильная навигация">
        {visibleNav.map((item) => {
          const Icon = item.icon;
          return (
            <button key={item.id} type="button" className={view === item.id ? 'active' : ''} onClick={() => go(item.id)}>
              <Icon size={19} />
              <span>{item.short}</span>
              {item.id === 'crm' && counts.contacts > 0 && <b className="mobile-badge">{counts.contacts}</b>}
              {item.id === 'tasks' && counts.tasksOverdue > 0 && <b className="mobile-badge red">{counts.tasksOverdue}</b>}
            </button>
          );
        })}
      </nav>

      {dealForRoute && (
        <DealDialog
          key={dealForRoute.id}
          dealId={dealForRoute.id}
          initialTab={(['schedule', 'tasks', 'money', 'docs', 'history', 'files'] as const).find((tab) => tab === route.tab)}
          onClose={closeOverlays}
          onOpenClient={(id) => openClient(id)}
          onOpenSchedule={() => go('schedule')}
          queue={queue ? { index: 0, total: queue.length } : undefined}
          onQueueNext={queue ? queueNext : undefined}
        />
      )}

      {clientForRoute && (
        <ClientDialog
          key={clientForRoute.id}
          clientId={clientForRoute.id}
          onClose={closeOverlays}
          onOpenDeal={openDeal}
          onNewDeal={(id) => setNewDealClient(id)}
        />
      )}

      {newClientOpen && (
        <ClientDialog
          clientId="new"
          onClose={() => setNewClientOpen(false)}
          onOpenDeal={openDeal}
          onNewDeal={(id) => { setNewClientOpen(false); setNewDealClient(id); }}
        />
      )}

      {newDealClient !== null && (
        <NewDealDialog
          onClose={() => setNewDealClient(null)}
          onCreated={(id) => { setNewDealClient(null); openDeal(id); }}
          onNewClient={() => { setNewDealClient(null); setNewClientOpen(true); }}
        />
      )}

      {installDay && (
        <Modal
          title="Новый монтаж"
          subtitle={`Дата: ${fmtDate(installDay, { withYear: true })} · выберите сделку`}
          onClose={() => setInstallDay(null)}
        >
          <ul className="deal-picker">
            {deals
              .filter((deal) => !isClosedStatus(deal.status))
              .filter((deal) => !deal.schedule.installAt)
              .slice(0, 25)
              .map((deal) => (
                <li key={deal.id}>
                  <button
                    type="button"
                    className="deal-picker-row"
                    onClick={() => {
                      updateSchedule(deal.id, { installAt: installDay });
                      setInstallDay(null);
                      notify(`Монтаж «${deal.title}» — ${fmtDate(installDay)}`, 'ok', {
                        label: 'Вернуть',
                        run: () => updateSchedule(deal.id, { installAt: undefined }),
                      });
                      openDeal(deal.id);
                    }}
                  >
                    <span>
                      <b>{clientName(deal)}</b>
                      <small>{deal.title}</small>
                    </span>
                    <span className="muted small">{deal.amount ? fmtMoney(deal.amount) : 'сумма не заполнена'}</span>
                  </button>
                </li>
              ))}
            {deals.filter((deal) => !isClosedStatus(deal.status) && !deal.schedule.installAt).length === 0 && (
              <li><p className="muted">У всех активных сделок монтаж уже поставлен.</p></li>
            )}
          </ul>
        </Modal>
      )}

      {paletteOpen && (
        <CommandPalette
          onClose={() => setPaletteOpen(false)}
          onOpenDeal={openDeal}
          onOpenClient={openClient}
          onView={go}
          onNewDeal={() => setNewDealClient('')}
          onNewClient={() => setNewClientOpen(true)}
          onNewInstall={() => setInstallDay(today)}
        />
      )}

      {shared && (
        <Modal
          title="Сделка по ссылке"
          subtitle="Коллега поделился карточкой. Добавьте её в свою базу — данные останутся вашими."
          onClose={closeOverlays}
          footer={(
            <>
              <button type="button" className="btn ghost" onClick={closeOverlays}>Не сейчас</button>
              <span className="foot-spacer" />
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  const id = importSharedDeal(shared.deal, shared.client);
                  setSharePreview(null);
                  notify('Сделка добавлена из ссылки', 'ok', { label: 'Отменить', run: undo });
                  openDeal(id);
                }}
              >
                Добавить в базу
              </button>
            </>
          )}
        >
          <ul className="preview-list">
            <li><span>Клиент</span><b>{shared.client?.name ?? clientName(shared.deal)}</b></li>
            <li><span>Заказ</span><b>{shared.deal.title}</b></li>
            <li><span>Сумма</span><b>{shared.deal.amount ? fmtMoney(shared.deal.amount) : '—'}</b></li>
            <li><span>Монтаж</span><b>{shared.deal.schedule?.installAt ? fmtDate(shared.deal.schedule.installAt) : 'не назначен'}</b></li>
            <li><span>Задач</span><b>{shared.deal.tasks?.length ?? 0}</b></li>
          </ul>
        </Modal>
      )}

      {shareError && (
        <Modal title="Ссылка не читается" onClose={closeOverlays} footer={<button type="button" className="btn primary" onClick={closeOverlays}>Понятно</button>}>
          <p className="muted">Ссылка повреждена или скопирована не полностью. Попросите коллегу отправить её ещё раз.</p>
        </Modal>
      )}

      {queueDeal && !dealForRoute && (
        <Modal
          title="Разбор очереди"
          subtitle={`Сделок в очереди: ${queue?.length ?? 0}`}
          onClose={() => setQueue(null)}
          footer={<button type="button" className="btn primary" onClick={() => openDeal(queueDeal.id)}>Продолжить</button>}
        >
          <p className="muted">Открываем сделки по одной: связаться, зафиксировать результат, перейти к следующей.</p>
        </Modal>
      )}

      <Toasts />
    </div>
  );
}
