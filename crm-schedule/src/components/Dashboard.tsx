// Обзор: главное — «Сегодня». Дальше график, задачи, проверки и деньги.
import { useMemo } from 'react';
import {
  ArrowRight, CalendarDays, CheckSquare, Clock, HandCoins, MessageCircle, Phone, TrendingUp,
  TriangleAlert, Wallet,
} from 'lucide-react';
import { useApp } from '../store';
import { clientReminders } from '../lib/clientReminders';
import { whatsappLink } from '../lib/messaging';
import { fmtDate, fmtMoney, fmtMoneyCompact, fmtTimeRange, relativeDay, todayISO } from '../lib/dates';
import { statusMeta } from '../lib/crm';
import { dealsForToday, longToday, overview, scheduleAhead } from '../lib/metrics';
import { scheduleKindMeta, scheduleWarnings } from '../lib/schedule';
import { allTasks, paymentState, taskStats, toggleTask } from '../lib/crmTasks';
import { receivables } from '../lib/money';
import EmptyState from './EmptyState';
import { usePrefs } from '../lib/viewPrefs';

const TASK_TONE_LABEL = {
  overdue: 'просрочено',
  today: 'сегодня',
  soon: 'скоро',
  later: 'позже',
  none: 'без срока',
  done: 'готово',
} as const;

export default function Dashboard(props: {
  onOpenDeal: (id: string) => void;
  onOpenSchedule: () => void;
  onOpenCrm: () => void;
  onOpenTasks: () => void;
  onOpenReports: () => void;
  onNewDeal: () => void;
}) {
  const { deals, clientName, updateDeal, settings, clients } = useApp();
  const today = todayISO();
  const [dismissed, patchDismissed] = usePrefs('overview-notes', { warnings: false, money: false });

  const warnings = useMemo(() => scheduleWarnings(deals), [deals]);
  const stats = useMemo(() => overview(deals, warnings.length, today), [deals, warnings.length, today]);
  const urgent = useMemo(() => dealsForToday(deals, today).slice(0, 6), [deals, today]);
  const ahead = useMemo(() => scheduleAhead(deals, 10, today).slice(0, 7), [deals, today]);
  const tasks = useMemo(
    () => allTasks(deals, today).filter(({ tone }) => tone === 'overdue' || tone === 'today').slice(0, 6),
    [deals, today],
  );
  const taskCounts = useMemo(() => taskStats(deals, today), [deals, today]);
  const debts = useMemo(() => receivables(deals, today, clientName), [deals, today, clientName]);
  const overdueDebts = debts.filter((item) => item.overdue > 0);
  // Кому написать сегодня–завтра: замер, доставка, монтаж, оплата.
  const clientNotes = useMemo(
    () => clientReminders(deals, clients, settings, { today, horizonDays: 2 })
      .filter((item) => !item.sentAt)
      .slice(0, 3),
    [deals, clients, settings, today],
  );
  const activeDeals = useMemo(() => deals.filter((deal) => deal.status !== 'delivered' && deal.status !== 'rejected'), [deals]);
  const empty = deals.length === 0 && clients.length === 0;

  const heroCount = stats.contactsToday + stats.contactsOverdue + stats.installsToday;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">{longToday(today)}</div>
          <h1>Обзор</h1>
          <p className="muted">{settings.myName ? `Здравствуйте, ${settings.myName}! ` : ''}Сначала то, что требует внимания сегодня.</p>
        </div>
        <div className="actions">
          <button type="button" className="btn ghost" onClick={props.onOpenCrm}>
            <CheckSquare size={16} /> CRM
          </button>
          <button type="button" className="btn primary" onClick={props.onNewDeal}>
            Новая сделка
          </button>
        </div>
      </header>

      {empty ? (
        <EmptyState
          icon={<CalendarDays size={26} />}
          title="Пока ни одной сделки"
          hint="Заведите клиента и заказ — дальше появятся задачи, оплаты и монтажи в графике."
          action={<button type="button" className="btn primary" onClick={props.onNewDeal}>Создать первую сделку</button>}
        />
      ) : (
        <>
          <section className={`hero-card${stats.contactsOverdue > 0 ? ' alert' : ''}`}>
            <div className="hero-main">
              <span className="hero-label">Сегодня</span>
              <b className="hero-value">{heroCount}</b>
              <span className="hero-hint">
                {[
                  stats.contactsToday + stats.contactsOverdue > 0 && `связаться: ${stats.contactsToday + stats.contactsOverdue}`,
                  stats.installsToday > 0 && `монтажей: ${stats.installsToday}`,
                  stats.contactsOverdue > 0 && `просрочено: ${stats.contactsOverdue}`,
                ].filter(Boolean).join(' · ') || 'свободный день для планов и монтажей'}
              </span>
            </div>
            <div className="hero-points">
              <button type="button" className="hero-point" onClick={props.onOpenCrm}>
                <span><Phone size={15} /> Связаться</span>
                <b>{stats.contactsToday + stats.contactsOverdue}</b>
                <small className={stats.contactsOverdue > 0 ? 'danger' : ''}>
                  {stats.contactsOverdue > 0 ? `${stats.contactsOverdue} просрочено` : 'всё по плану'}
                </small>
              </button>
              <button type="button" className="hero-point" onClick={props.onOpenSchedule}>
                <span><CalendarDays size={15} /> Монтажи</span>
                <b>{stats.installsToday}</b>
                <small>{stats.installsWeek > 0 ? `${stats.installsWeek} на неделе` : 'на этой неделе нет'}</small>
              </button>
              <button type="button" className="hero-point" onClick={props.onOpenTasks}>
                <span><CheckSquare size={15} /> Задачи</span>
                <b>{taskCounts.open}</b>
                <small className={taskCounts.overdue > 0 ? 'danger' : ''}>
                  {taskCounts.overdue > 0 ? `${taskCounts.overdue} просрочено` : 'нет просрочек'}
                </small>
              </button>
            </div>
          </section>

          <section className="metric-strip" aria-label="Показатели">
            <span><Wallet size={15} /> Портфель <b>{fmtMoneyCompact(stats.pipeline)}</b></span>
            <span><TrendingUp size={15} /> Оплаты за месяц <b>{fmtMoneyCompact(stats.paidThisMonth)}</b></span>
            <span><CheckSquare size={15} /> Сделок в работе <b>{stats.activeDeals}</b></span>
            <button
              type="button"
              className={`metric-link${overdueDebts.length > 0 ? ' warn' : ''}`}
              onClick={props.onOpenReports}
              title="Открыть отчёт «Кто должен»"
            >
              <HandCoins size={15} /> Ждём оплату <b>{fmtMoneyCompact(debts.reduce((sum, item) => sum + item.remainder, 0))}</b>
              {overdueDebts.length > 0 && <em>· просрочено {overdueDebts.length}</em>}
            </button>
            <span className={warnings.length > 0 ? 'warn' : ''}>
              <TriangleAlert size={15} /> Проверки графика <b>{warnings.length}</b>
            </span>
          </section>

          <div className="dash-grid">
            <section className="card dash-main">
              <div className="section-head">
                <div>
                  <h2>Связаться сегодня</h2>
                  <span className="muted">просроченные и назначенные на сегодня</span>
                </div>
                <button type="button" className="link-btn" onClick={props.onOpenCrm}>
                  вся CRM <ArrowRight size={13} />
                </button>
              </div>
              {urgent.length === 0 ? (
                <EmptyState
                  compact
                  icon={<Phone size={20} />}
                  title="Контактов на сегодня нет"
                  hint="Можно заняться монтажами или запланировать новые звонки."
                  action={<button type="button" className="btn small ghost" onClick={props.onOpenCrm}>Открыть CRM</button>}
                />
              ) : (
                <ul className="mini-list">
                  {urgent.map((deal) => {
                    const client = clientName(deal);
                    const overdue = Boolean(deal.nextContactAt && deal.nextContactAt < today);
                    return (
                      <li key={deal.id}>
                        <button type="button" className="mini-row" onClick={() => props.onOpenDeal(deal.id)}>
                          <span className={`dot ${overdue ? 'dot-red' : 'dot-amber'}`} />
                          <span className="mini-main">
                            <b>{client}</b>
                            <span>{deal.title}</span>
                            <em>{deal.nextAction || statusMeta(deal.status).label}</em>
                          </span>
                          <span className="mini-side">
                            <i className={`badge badge-${statusMeta(deal.status).tone}`}>{statusMeta(deal.status).label}</i>
                            <small className={overdue ? 'danger' : ''}>{relativeDay(deal.nextContactAt, today)}</small>
                            <small className="money">{deal.amount ? fmtMoney(deal.amount) : 'сумма не заполнена'}</small>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="card">
              <div className="section-head">
                <div>
                  <h2>График на 10 дней</h2>
                  <span className="muted">замеры, доставки и монтажи</span>
                </div>
                <button type="button" className="link-btn" onClick={props.onOpenSchedule}>
                  открыть <ArrowRight size={13} />
                </button>
              </div>
              {ahead.length === 0 ? (
                <EmptyState compact icon={<CalendarDays size={20} />} title="Событий нет" hint="Поставьте монтаж — он появится в графике и в календаре телефона." />
              ) : (
                <ul className="agenda-list">
                  {ahead.map((event) => {
                    const kind = scheduleKindMeta(event.kind);
                    return (
                      <li key={event.id}>
                        <button type="button" className="agenda-row" onClick={() => props.onOpenDeal(event.dealId)}>
                          <span className={`event-chip chip-${kind.color}`}>{kind.short}</span>
                          <span className="agenda-main">
                            <b>{event.dealTitle}</b>
                            <span>
                              {event.client}
                              {event.team ? ` · ${event.team}` : ''}
                              {event.timeStart ? ` · ${fmtTimeRange(event.timeStart, event.timeEnd)}` : ''}
                            </span>
                          </span>
                          <span className="agenda-side">
                            <b>{fmtDate(event.date)}</b>
                            <small>{relativeDay(event.date, today)}</small>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="card">
              <div className="section-head">
                <div>
                  <h2>Написать клиентам</h2>
                  <span className="muted">готовые сообщения к ближайшим датам</span>
                </div>
              </div>
              {clientNotes.length === 0 ? (
                <EmptyState
                  compact
                  icon={<MessageCircle size={20} />}
                  title="Писать пока некому"
                  hint="Заполните даты замера, доставки и монтажа — сообщения появятся сами."
                />
              ) : (
                <ul className="client-note-list">
                  {clientNotes.map((note) => (
                    <li key={note.id} className="client-note-row">
                      <button type="button" className="client-note-main" onClick={() => props.onOpenDeal(note.dealId)}>
                        <b>{note.clientName}</b>
                        <span className="muted">{note.title} · {fmtDate(note.dueAt)}</span>
                      </button>
                      <a
                        className="btn small ghost"
                        href={whatsappLink(note.clientPhone, note.text)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <MessageCircle size={13} /> WhatsApp
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="card">
              <div className="section-head">
                <div>
                  <h2>Задачи</h2>
                  <span className="muted">
                    {taskCounts.overdue > 0 ? `${taskCounts.overdue} просрочено · ${taskCounts.today} на сегодня` : 'просроченные и сегодняшние'}
                  </span>
                </div>
                <button type="button" className="link-btn" onClick={props.onOpenTasks}>
                  все <ArrowRight size={13} />
                </button>
              </div>
              {tasks.length === 0 ? (
                <EmptyState compact icon={<CheckSquare size={20} />} title="Срочных задач нет" hint="Хороший момент, чтобы позвонить клиенту, который «думает»." />
              ) : (
                <ul className="task-list compact">
                  {tasks.map(({ deal, task, tone }) => (
                    <li key={`${deal.id}-${task.id}`} className={`task-row task-${tone}`}>
                      <input
                        type="checkbox"
                        checked={Boolean(task.done)}
                        onChange={() => updateDeal(toggleTask(deal, task.id))}
                        aria-label={`Выполнить: ${task.title}`}
                      />
                      <button type="button" className="task-main" onClick={() => props.onOpenDeal(deal.id)}>
                        <b>{task.title}</b>
                        <span>{clientName(deal)} · {deal.title}</span>
                      </button>
                      <span className={`task-due tone-${tone}`}>{TASK_TONE_LABEL[tone]}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className={`card${warnings.length > 0 && !dismissed.warnings ? ' card-warn' : ''}`}>
              <div className="section-head">
                <div>
                  <h2>Проверка графика</h2>
                  <span className="muted">{warnings.length > 0 ? 'на что обратить внимание' : 'всё сходится'}</span>
                </div>
                <div className="card-head-actions">
                  {warnings.length > 0 && (
                    <button type="button" className="link-btn muted" onClick={() => patchDismissed({ warnings: !dismissed.warnings })}>
                      {dismissed.warnings ? 'показать' : 'скрыть'}
                    </button>
                  )}
                  <button type="button" className="link-btn" onClick={props.onOpenSchedule}>к графику <ArrowRight size={13} /></button>
                </div>
              </div>
              {warnings.length === 0 ? (
                <EmptyState compact title="Накладок нет" hint="Монтажи не пересекаются, адреса и бригады заполнены." />
              ) : dismissed.warnings ? (
                <div className="empty-note">Скрыто · проблем: {warnings.length}</div>
              ) : (
                <ul className="warning-list">
                  {warnings.slice(0, 5).map((warning, index) => (
                    <li key={`${warning.text}-${index}`} className={`warning warning-${warning.kind}`}>
                      <TriangleAlert size={14} />
                      <span>{warning.text}</span>
                    </li>
                  ))}
                  {warnings.length > 5 && (
                    <li className="warning-more">
                      <button type="button" className="link-btn" onClick={props.onOpenSchedule}>ещё {warnings.length - 5} →</button>
                    </li>
                  )}
                </ul>
              )}
            </section>

            <section className="card dash-wide">
              <div className="section-head">
                <div>
                  <h2>Деньги по активным сделкам</h2>
                  <span className="muted">сколько получено и сколько осталось</span>
                </div>
                <button type="button" className="link-btn" onClick={props.onOpenCrm}>все сделки <ArrowRight size={13} /></button>
              </div>
              <div className="money-list">
                {activeDeals.slice(0, 8).map((deal) => {
                  const pay = paymentState(deal);
                  return (
                    <button key={deal.id} type="button" className="money-row" onClick={() => props.onOpenDeal(deal.id)}>
                      <span className="money-main">
                        <b>{deal.title}</b>
                        <span>{clientName(deal)}</span>
                      </span>
                      <span className={`money-bar${pay.remainder > 0 ? ' partial' : ''}`}><i style={{ width: `${pay.percent}%` }} /></span>
                      <span className="money-num">
                        <b>{deal.amount ? fmtMoney(pay.paid) : '—'}</b>
                        <small>{deal.amount ? `из ${fmtMoney(deal.amount)}` : 'сумма не заполнена'}</small>
                      </span>
                    </button>
                  );
                })}
                {activeDeals.length === 0 && <div className="empty-note">Активных сделок нет.</div>}
              </div>
              {activeDeals.some((deal) => deal.amount === 0) && (
                <div className="inline-note">
                  <Clock size={14} /> У части сделок не заполнена сумма — это мешает считать портфель и остатки.
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
