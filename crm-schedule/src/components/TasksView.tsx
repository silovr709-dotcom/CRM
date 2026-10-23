// Задачи: единый список по всем сделкам, повторения, откладывание.
import { useMemo, useState } from 'react';
import { Check, CheckCheck, Clock, Pencil, Phone, Plus, Search, X } from 'lucide-react';
import type { DealTask, TaskKind } from '../types';
import { addTask, patchTask } from '../lib/crmTasks';
import { useApp } from '../store';
import { fmtDate, relativeDay, todayISO } from '../lib/dates';
import {
  allTasks, postponeTask, removeTask, REPEAT_LABELS, taskKindMeta, taskStats,
  toggleTask, TASK_KINDS, type TaskTone,
} from '../lib/crmTasks';
import { usePrefs } from '../lib/viewPrefs';
import EmptyState from './EmptyState';
import TaskEditor, { TaskBell } from './TaskEditor';

const GROUPS: Array<{ id: TaskTone; title: string; hint: string; tone: string }> = [
  { id: 'overdue', title: 'Просрочено', hint: 'сначала это', tone: 'overdue' },
  { id: 'today', title: 'Сегодня', hint: 'на этот день', tone: 'today' },
  { id: 'soon', title: 'Ближайшие 7 дней', hint: 'на неделе', tone: 'soon' },
  { id: 'later', title: 'Позже', hint: 'дальний срок', tone: 'later' },
  { id: 'none', title: 'Без срока', hint: 'нужно назначить дату', tone: 'none' },
];

export default function TasksView(props: { onOpenDeal: (id: string) => void }) {
  const { deals, clientName, updateDeal, settings, notify } = useApp();
  const [prefs, patchPrefs] = usePrefs('tasks', {
    hideDone: true,
    assignee: '',
    kind: '' as '' | TaskKind,
  });
  const [query, setQuery] = useState('');
  const [doneOpen, setDoneOpen] = useState(false);
  const [editor, setEditor] = useState<{ dealId?: string; task?: DealTask } | null>(null);

  const today = todayISO();
  const stats = useMemo(() => taskStats(deals, today), [deals, today]);
  const tasks = useMemo(() => allTasks(deals, today), [deals, today]);

  const assignees = useMemo(() => {
    const set = new Set<string>(settings.managers);
    if (settings.myName) set.add(settings.myName);
    for (const { task } of tasks) if (task.assignee?.trim()) set.add(task.assignee.trim());
    return Array.from(set).filter(Boolean).sort((left, right) => left.localeCompare(right, 'ru'));
  }, [tasks, settings]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('ru-RU');
    return tasks
      .filter(({ task, deal }) => (!needle
        ? true
        : [task.title, clientName(deal), deal.title, task.assignee].filter(Boolean).join(' ').toLocaleLowerCase('ru-RU').includes(needle)))
      .filter(({ task }) => !prefs.kind || task.kind === prefs.kind)
      .filter(({ task }) => !prefs.assignee || (task.assignee ?? '') === prefs.assignee)
      .filter(({ task }) => (prefs.hideDone ? !task.done : true));
  }, [tasks, query, prefs, clientName]);

  const done = useMemo(() => tasks.filter(({ task }) => task.done).slice(0, 30), [tasks]);

  const complete = (dealId: string, taskId: string) => {
    const deal = deals.find((item) => item.id === dealId);
    if (!deal) return;
    const task = deal.tasks.find((item) => item.id === taskId);
    updateDeal(toggleTask(deal, taskId));
    if (task && !task.done && task.repeat) {
      notify(`Повтор задачи запланирован`, 'ok');
    } else {
      notify('Задача выполнена', 'ok', { label: 'Вернуть', run: () => updateDeal(toggleTask(deal, taskId)) });
    }
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">Что сделать сейчас</div>
          <h1>Задачи</h1>
          <p className="muted">Все задачи из карточек сделок. Повторяющиеся восстанавливаются сами.</p>
        </div>
        <div className="actions wrap">
          <button type="button" className="btn primary" onClick={() => setEditor({})}><Plus size={15} /> Задача</button>
        </div>
      </header>

      <section className="metric-strip small">
        <div className="metric">
          <span>Открытых задач</span>
          <b>{stats.open}</b>
        </div>
        <div className={`metric${stats.overdue > 0 ? ' alert' : ''}`}>
          <span>Просрочено</span>
          <b>{stats.overdue}</b>
        </div>
        <div className="metric">
          <span>На сегодня</span>
          <b>{stats.today}</b>
        </div>
      </section>

      <section className="toolbar">
        <div className="search-wrap">
          <Search size={15} />
          <input value={query} placeholder="Задача, клиент, заказ…" onChange={(event) => setQuery(event.target.value)} aria-label="Поиск по задачам" />
          {query && <button type="button" className="search-clear" onClick={() => setQuery('')} aria-label="Очистить"><X size={14} /></button>}
        </div>
        <label>Тип
          <select value={prefs.kind} onChange={(event) => patchPrefs({ kind: event.target.value as '' | TaskKind })}>
            <option value="">все</option>
            {TASK_KINDS.map((kind) => <option key={kind.id} value={kind.id}>{kind.label}</option>)}
          </select>
        </label>
        {assignees.length > 0 && (
          <label>Исполнитель
            <select value={prefs.assignee} onChange={(event) => patchPrefs({ assignee: event.target.value })}>
              <option value="">все</option>
              {assignees.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
        )}
        <label className="chip-toggle">
          <input type="checkbox" checked={prefs.hideDone} onChange={(event) => patchPrefs({ hideDone: event.target.checked })} />
          скрыть выполненные
        </label>
        {stats.overdue > 0 && (
          <button
            type="button"
            className="btn small ghost"
            onClick={() => {
              const overdue = tasks.filter(({ tone, task }) => tone === 'overdue' && !task.done);
              overdue.forEach(({ deal, task }) => updateDeal(postponeTask(deal, task.id, 1)));
              notify(`Перенесено на завтра: ${overdue.length}`);
            }}
          >
            <Clock size={14} /> Просроченные на завтра
          </button>
        )}
      </section>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<CheckCheck size={24} />}
          title={prefs.hideDone ? 'Открытых задач нет' : 'Задач нет'}
          hint="Поставьте звонок из карточки сделки или нажмите «Задача»."
          action={<button type="button" className="btn small primary" onClick={() => setEditor({})}>Добавить задачу</button>}
        />
      ) : (
        <div className="task-groups">
          {GROUPS.map((group) => {
            const items = filtered.filter(({ tone }) => tone === group.id);
            if (items.length === 0) return null;
            return (
              <section key={group.id} className={`card task-group tone-${group.tone}`}>
                <div className="section-head">
                  <div>
                    <h2>{group.title}</h2>
                    <span className="muted">{group.hint}</span>
                  </div>
                  <span className="group-count">{items.length}</span>
                </div>
                <ul className="task-list">
                  {items.map(({ task, deal, tone }) => {
                    const meta = taskKindMeta(task.kind);
                    const repeat = REPEAT_LABELS.find((item) => item.id === task.repeat)?.label;
                    return (
                      <li key={`${deal.id}-${task.id}`} className={`task-row task-${tone}`}>
                        <input
                          type="checkbox"
                          checked={Boolean(task.done)}
                          onChange={() => complete(deal.id, task.id)}
                          aria-label={`Выполнить: ${task.title}`}
                        />
                        <span className="task-main">
                          <button type="button" className="task-title-btn" onClick={() => setEditor({ dealId: deal.id, task })}>
                            {task.title}
                          </button>
                          <span>
                            <button type="button" className="link-btn" onClick={() => props.onOpenDeal(deal.id)}>
                              {clientName(deal)}
                            </button>
                            {' · '}{deal.title}{' · '}{meta.label}
                            {task.assignee ? ` · ${task.assignee}` : ''}
                            {repeat ? ` · повтор: ${repeat}` : ''}
                            {' '}<TaskBell reminder={task.reminder} />
                          </span>
                        </span>
                        <span className={`task-due tone-${tone}`}>
                          {task.dueAt ? <>{fmtDate(task.dueAt)}<small>{relativeDay(task.dueAt, today)}</small></> : 'без срока'}
                        </span>
                        <span className="task-postpone">
                          <button
                            type="button"
                            className="icon-btn small"
                            title="Изменить задачу"
                            aria-label={`Изменить задачу: ${task.title}`}
                            onClick={() => setEditor({ dealId: deal.id, task })}
                          >
                            <Pencil size={13} />
                          </button>
                          {!task.done && <button type="button" className="quick" title="Отложить на завтра" onClick={() => updateDeal(postponeTask(deal, task.id, 1))}>+1</button>}
                          {!task.done && <button type="button" className="quick" title="Отложить на неделю" onClick={() => updateDeal(postponeTask(deal, task.id, 7))}>+7</button>}
                          <button type="button" className="icon-btn small" title="Удалить задачу" aria-label="Удалить задачу" onClick={() => updateDeal(removeTask(deal, task.id))}>
                            <X size={13} />
                          </button>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {done.length > 0 && (
        <section className="card done-card">
          <button type="button" className="collapse-head" onClick={() => setDoneOpen(!doneOpen)} aria-expanded={doneOpen}>
            <Check size={14} /> Выполненные ({done.length})
          </button>
          {doneOpen && (
            <ul className="task-list done-list">
              {done.map(({ task, deal }) => (
                <li key={`${deal.id}-${task.id}`} className="task-row task-done">
                  <input type="checkbox" checked onChange={() => complete(deal.id, task.id)} aria-label={`Вернуть: ${task.title}`} />
                  <span className="task-main">
                    <button type="button" className="task-title-btn" onClick={() => setEditor({ dealId: deal.id, task })}>{task.title}</button>
                    <span><button type="button" className="link-btn" onClick={() => props.onOpenDeal(deal.id)}>{clientName(deal)}</button> · {deal.title}</span>
                  </span>
                  <span className="task-due">{task.dueAt ? fmtDate(task.dueAt) : '—'}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="card quick-task">
        <div className="section-head">
          <div>
            <h2>Быстрая задача из карточки</h2>
            <span className="muted">откройте сделку и добавьте звонок на вкладке «Задачи»</span>
          </div>
        </div>
        <ul className="deal-shortcuts">
          {deals
            .filter((deal) => !deal.nextContactAt && deal.status !== 'delivered' && deal.status !== 'rejected')
            .slice(0, 5)
            .map((deal) => (
              <li key={deal.id}>
                <button type="button" className="shortcut-row" onClick={() => props.onOpenDeal(deal.id)}>
                  <Phone size={14} />
                  <span>{clientName(deal)}</span>
                  <small>нет даты контакта</small>
                </button>
              </li>
            ))}
          {deals.filter((deal) => !deal.nextContactAt && deal.status !== 'delivered' && deal.status !== 'rejected').length === 0 && (
            <li><span className="muted small">У всех активных сделок назначен следующий контакт.</span></li>
          )}
        </ul>
      </section>

      {editor && (
        <TaskEditor
          task={editor.task}
          deals={deals.filter((deal) => deal.status !== 'delivered' && deal.status !== 'rejected')}
          dealId={editor.dealId}
          onClose={() => setEditor(null)}
          onSave={(values, dealId) => {
            const deal = deals.find((item) => item.id === dealId);
            if (!deal) { notify('Сделка не найдена', 'error'); return; }
            if (editor.task) {
              updateDeal(patchTask(deal, editor.task.id, values));
              notify('Задача сохранена');
            } else {
              updateDeal(addTask(deal, values));
              notify('Задача добавлена');
            }
            setEditor(null);
          }}
          onDelete={editor.task ? () => {
            const deal = deals.find((item) => item.id === editor.dealId) ?? deals.find((item) => (item.tasks ?? []).some((task) => task.id === editor.task?.id));
            if (!deal || !editor.task) return;
            updateDeal(removeTask(deal, editor.task.id));
            setEditor(null);
            notify('Задача удалена');
          } : undefined}
          onToggleDone={editor.task ? () => {
            const deal = deals.find((item) => item.id === editor.dealId) ?? deals.find((item) => (item.tasks ?? []).some((task) => task.id === editor.task?.id));
            if (!deal || !editor.task) return;
            updateDeal(toggleTask(deal, editor.task.id));
            setEditor(null);
            notify('Готово');
          } : undefined}
        />
      )}
    </div>
  );
}
