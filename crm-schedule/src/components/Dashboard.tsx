// Обзор: с чем работать сегодня, что на монтажах и что требует внимания.
import { useMemo } from 'react';
import { useApp } from '../store';
import { fmtDate, fmtMoney, relativeDay, todayISO } from '../lib/dates';
import { statusMeta } from '../lib/crm';
import { dealsForToday, longToday, overview, scheduleAhead } from '../lib/metrics';
import { scheduleKindMeta, scheduleWarnings } from '../lib/schedule';
import { allTasks, paymentState, taskStats, toggleTask } from '../lib/crmTasks';
import type { TaskTone } from '../lib/crmTasks';

const TASK_TONE_LABEL: Record<TaskTone, string> = {
  overdue: 'просрочено',
  today: 'сегодня',
  soon: 'скоро',
  later: 'позже',
  none: 'без срока',
  done: 'готово',
};

export default function Dashboard(props: {
  onOpenDeal: (id: string) => void;
  onOpenSchedule: () => void;
  onOpenCrm: () => void;
  onOpenTasks: () => void;
}) {
  const { deals, clientName, updateDeal } = useApp();
  const today = todayISO();

  const warnings = useMemo(() => scheduleWarnings(deals), [deals]);
  const stats = useMemo(() => overview(deals, warnings.length, today), [deals, warnings.length, today]);
  const urgent = useMemo(() => dealsForToday(deals, today).slice(0, 6), [deals, today]);
  const ahead = useMemo(() => scheduleAhead(deals, 10, today).slice(0, 8), [deals, today]);
  const tasks = useMemo(() => allTasks(deals, today).filter(({ tone }) => tone !== 'done' && tone !== 'later').slice(0, 7), [deals, today]);
  const taskCounts = useMemo(() => taskStats(deals, today), [deals, today]);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">{longToday(today)}</div>
          <h1>Обзор</h1>
          <p className="muted">Клиенты, деньги и монтажи — одна картина дня.</p>
        </div>
        <div className="actions">
          <button type="button" className="btn ghost" onClick={props.onOpenCrm}>CRM</button>
          <button type="button" className="btn primary" onClick={props.onOpenSchedule}>График монтажей</button>
        </div>
      </header>

      <section className="kpi-grid">
        <button type="button" className="kpi" onClick={props.onOpenCrm}>
          <span className="kpi-label">В работе</span>
          <b className="kpi-value">{stats.activeDeals}</b>
          <span className="kpi-note">на {fmtMoney(stats.pipeline, { compact: true })}</span>
        </button>
        <button type="button" className={`kpi${stats.contactsOverdue > 0 ? ' kpi-alert' : ''}`} onClick={props.onOpenCrm}>
          <span className="kpi-label">Связаться</span>
          <b className="kpi-value">{stats.contactsToday + stats.contactsOverdue}</b>
          <span className="kpi-note">
            {stats.contactsOverdue > 0 ? `${stats.contactsOverdue} просрочено` : 'сегодня и просроченные'}
          </span>
        </button>
        <button type="button" className="kpi" onClick={props.onOpenSchedule}>
          <span className="kpi-label">Монтажи на неделе</span>
          <b className="kpi-value">{stats.installsWeek}</b>
          <span className="kpi-note">{stats.installsToday > 0 ? `сегодня ${stats.installsToday}` : 'по графику'}</span>
        </button>
        <button type="button" className="kpi" onClick={props.onOpenCrm}>
          <span className="kpi-label">Оплаты за месяц</span>
          <b className="kpi-value">{fmtMoney(stats.paidThisMonth, { compact: true })}</b>
          <span className="kpi-note">по всем сделкам</span>
        </button>
        <button type="button" className="kpi" onClick={props.onOpenTasks}>
          <span className="kpi-label">Задачи</span>
          <b className="kpi-value">{taskCounts.open}</b>
          <span className={`kpi-note${taskCounts.overdue > 0 ? ' danger' : ''}`}>
            {taskCounts.overdue > 0 ? `${taskCounts.overdue} просрочено` : 'открытых'}
          </span>
        </button>
      </section>

      <div className="dash-grid">
        <section className="card">
          <div className="section-head">
            <div>
              <h2>Связаться сегодня</h2>
              <span className="muted">просроченные и назначенные на сегодня</span>
            </div>
            <button type="button" className="link-btn" onClick={props.onOpenCrm}>вся CRM →</button>
          </div>
          {urgent.length === 0 ? (
            <div className="empty-note">✓ На сегодня контактов нет. Можно заняться монтажами.</div>
          ) : (
            <ul className="mini-list">
              {urgent.map((deal) => {
                const client = clientName(deal);
                return (
                  <li key={deal.id}>
                    <button type="button" className="mini-row" onClick={() => props.onOpenDeal(deal.id)}>
                      <span className={`dot dot-${deal.nextContactAt && deal.nextContactAt < today ? 'red' : 'amber'}`} />
                      <span className="mini-main">
                        <b>{client}</b>
                        <span>{deal.title}</span>
                        <em>{deal.nextAction || statusMeta(deal.status).label}</em>
                      </span>
                      <span className="mini-side">
                        <i className="badge badge-slate">{statusMeta(deal.status).label}</i>
                        <small className={deal.nextContactAt && deal.nextContactAt < today ? 'danger' : ''}>
                          {relativeDay(deal.nextContactAt, today)}
                        </small>
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
            <button type="button" className="link-btn" onClick={props.onOpenSchedule}>открыть график →</button>
          </div>
          {ahead.length === 0 ? (
            <div className="empty-note">В ближайшие дни событий нет.</div>
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
                        <span>{event.client}{event.team ? ` · ${event.team}` : ''}</span>
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
              <h2>Задачи на сегодня</h2>
              <span className="muted">{taskCounts.today > 0 ? `${taskCounts.today} на сегодня` : 'срочные дела по сделкам'}</span>
            </div>
            <button type="button" className="link-btn" onClick={props.onOpenTasks}>все задачи →</button>
          </div>
          {tasks.length === 0 ? (
            <div className="empty-note">Срочных задач нет — можно планировать дальше.</div>
          ) : (
            <ul className="task-list compact">
              {tasks.map(({ deal, task, tone }) => (
                <li key={`${deal.id}-${task.id}`} className={`task-row task-${tone}`}>
                  <input
                    type="checkbox"
                    checked={Boolean(task.done)}
                    onChange={() => updateDeal(toggleTask(deal, task.id))}
                    aria-label="Выполнено"
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

        <section className={`card${warnings.length > 0 ? ' card-warn' : ''}`}>
          <div className="section-head">
            <div>
              <h2>Проверка графика</h2>
              <span className="muted">{warnings.length > 0 ? 'на что обратить внимание' : 'всё сходится'}</span>
            </div>
            <button type="button" className="link-btn" onClick={props.onOpenSchedule}>к графику →</button>
          </div>
          {warnings.length === 0 ? (
            <div className="empty-note">✓ Накладок и незаполненных данных нет.</div>
          ) : (
            <ul className="warning-list">
              {warnings.slice(0, 6).map((warning, index) => (
                <li key={`${warning.text}-${index}`} className={`warning warning-${warning.kind}`}>
                  <span>{warning.kind === 'error' ? '⛔' : '⚠'}</span>
                  <span>{warning.text}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card dash-wide">
          <div className="section-head">
            <div>
              <h2>Деньги по активным сделкам</h2>
              <span className="muted">сколько получено и сколько осталось</span>
            </div>
          </div>
          <div className="money-list">
            {deals.filter((deal) => deal.status !== 'delivered' && deal.status !== 'rejected').map((deal) => {
              const pay = paymentState(deal);
              return (
                <button key={deal.id} type="button" className="money-row" onClick={() => props.onOpenDeal(deal.id)}>
                  <span className="money-main">
                    <b>{deal.title}</b>
                    <span>{clientName(deal)}</span>
                  </span>
                  <span className="money-bar"><i style={{ width: `${pay.percent}%` }} /></span>
                  <span className="money-num">
                    <b>{fmtMoney(pay.paid, { compact: true })}</b>
                    <small>из {fmtMoney(deal.amount, { compact: true })}</small>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
