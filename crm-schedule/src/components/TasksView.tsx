// Все задачи по сделкам в одном списке: звонки, замеры, документы, оплаты.
import { useMemo, useState } from 'react';
import type { TaskKind } from '../types';
import { useApp } from '../store';
import { addDays, fmtDate, relativeDay, todayISO } from '../lib/dates';
import {
  addTask, allTasks, removeTask, taskKindMeta, taskStats, taskTone, toggleTask, TASK_KINDS,
} from '../lib/crmTasks';
import { statusMeta } from '../lib/crm';

type Filter = 'today' | 'overdue' | 'week' | 'open' | 'done';

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'today', label: 'На сегодня' },
  { id: 'overdue', label: 'Просрочено' },
  { id: 'week', label: 'На неделю' },
  { id: 'open', label: 'Все открытые' },
  { id: 'done', label: 'Выполненные' },
];

export default function TasksView({ onOpenDeal }: { onOpenDeal: (id: string) => void }) {
  const { deals, clientName, updateDeal, notify } = useApp();
  const today = todayISO();
  const [filter, setFilter] = useState<Filter>('today');
  const [draft, setDraft] = useState({ dealId: '', title: '', kind: 'call' as TaskKind, dueAt: today });

  const tasks = useMemo(() => allTasks(deals, today), [deals, today]);
  const stats = useMemo(() => taskStats(deals, today), [deals, today]);

  const visible = useMemo(() => tasks.filter(({ task, tone }) => {
    if (filter === 'done') return Boolean(task.done);
    if (task.done) return false;
    if (filter === 'today') return tone === 'today' || tone === 'overdue';
    if (filter === 'overdue') return tone === 'overdue';
    if (filter === 'week') return task.dueAt ? task.dueAt <= addDays(today, 7) : false;
    return true;
  }), [tasks, filter, today]);

  const createTask = () => {
    const deal = deals.find((item) => item.id === draft.dealId);
    if (!deal) { notify('Выберите сделку для задачи', 'error'); return; }
    const title = draft.title.trim();
    if (!title) { notify('Напишите, что нужно сделать', 'error'); return; }
    updateDeal(addTask(deal, { title, kind: draft.kind, dueAt: draft.dueAt || undefined, done: false, assignee: deal.manager }));
    setDraft({ dealId: '', title: '', kind: 'call', dueAt: today });
    notify('Задача добавлена');
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">Дела по сделкам</div>
          <h1>Задачи</h1>
          <p className="muted">Просроченные и сегодняшние — сверху. Отметьте выполненную галочкой.</p>
        </div>
        <div className="actions">
          <span className={`task-summary big${stats.overdue > 0 ? ' alert' : ''}`}>
            Открыто <b>{stats.open}</b>{stats.overdue > 0 && <> · просрочено <b>{stats.overdue}</b></>}
          </span>
        </div>
      </header>

      <section className="task-form screen-task-form">
        <select value={draft.dealId} onChange={(event) => setDraft({ ...draft, dealId: event.target.value })}>
          <option value="">— сделка —</option>
          {deals.filter((deal) => deal.status !== 'delivered' && deal.status !== 'rejected').map((deal) => (
            <option key={deal.id} value={deal.id}>{clientName(deal)} · {deal.title}</option>
          ))}
        </select>
        <input value={draft.title} placeholder="Что сделать" onChange={(event) => setDraft({ ...draft, title: event.target.value })} onKeyDown={(event) => { if (event.key === 'Enter') createTask(); }} />
        <select value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as TaskKind })}>
          {TASK_KINDS.map((kind) => <option key={kind.id} value={kind.id}>{kind.icon} {kind.label}</option>)}
        </select>
        <input type="date" value={draft.dueAt} onChange={(event) => setDraft({ ...draft, dueAt: event.target.value })} />
        <button type="button" className="btn primary" onClick={createTask}>Добавить</button>
      </section>

      <section className="focus-bar">
        {FILTERS.map((item) => {
          const count = item.id === 'today' ? stats.today + stats.overdue
            : item.id === 'overdue' ? stats.overdue
            : item.id === 'open' ? stats.open
            : item.id === 'done' ? tasks.filter(({ task }) => task.done).length
            : tasks.filter(({ task }) => !task.done && task.dueAt && task.dueAt <= addDays(today, 7)).length;
          return (
            <button key={item.id} type="button" className={filter === item.id ? 'active' : ''} onClick={() => setFilter(item.id)}>
              {item.label}<b>{count}</b>
            </button>
          );
        })}
      </section>

      <section className="card">
        {visible.length === 0 ? (
          <div className="empty-note">Здесь пусто. {filter === 'today' ? 'На сегодня задач нет — отличный день для монтажа.' : ''}</div>
        ) : (
          <ul className="task-list big">
            {visible.map(({ deal, task, tone }) => {
              const meta = taskKindMeta(task.kind);
              return (
                <li key={`${deal.id}-${task.id}`} className={`task-row task-${tone}`}>
                  <input type="checkbox" checked={Boolean(task.done)} onChange={() => updateDeal(toggleTask(deal, task.id))} />
                  <span className="task-main">
                    <b>{task.title}</b>
                    <span>
                      {meta.icon} {meta.label}
                      {task.assignee ? ` · ${task.assignee}` : ''}
                      {task.origin?.startsWith('auto:') ? ' · автоматика' : ''}
                    </span>
                    <button type="button" className="link-btn" onClick={() => onOpenDeal(deal.id)}>
                      {clientName(deal)} · {deal.title} <i className={`badge badge-${statusMeta(deal.status).tone}`}>{statusMeta(deal.status).label}</i>
                    </button>
                  </span>
                  <span className={`task-due tone-${tone}`}>
                    {task.dueAt ? `${relativeDay(task.dueAt, today)}` : 'без срока'}
                    {task.dueAt && !task.done && <small>{fmtDate(task.dueAt)}</small>}
                  </span>
                  <span className={`tone-marker tone-${tone}`}>{taskTone(task, today) === 'done' ? '✓' : ''}</span>
                  <button type="button" className="icon-btn small" onClick={() => updateDeal(removeTask(deal, task.id))} aria-label="Удалить">✕</button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
