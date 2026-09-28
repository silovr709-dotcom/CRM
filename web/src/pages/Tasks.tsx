import { useEffect, useMemo, useState } from 'react';
import { api, humanDate, todayStr } from '../api';
import { TYPE_META } from '../meta';
import { useApp } from '../store';
import TaskRow from '../components/TaskRow';
import type { Task } from '../types';

type Filter = 'active' | 'inbox' | 'today' | 'overdue' | 'nodate' | 'delegated' | 'done';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'active', label: 'Активные' },
  { id: 'inbox', label: 'Входящие' },
  { id: 'today', label: 'Сегодня' },
  { id: 'overdue', label: 'Просроченные' },
  { id: 'nodate', label: 'Без даты' },
  { id: 'delegated', label: 'Поручено мной' },
  { id: 'done', label: 'Выполненные' },
];

export default function Tasks() {
  const { version, openTask, refresh, toast } = useApp();
  const [filter, setFilter] = useState<Filter>('active');
  const [type, setType] = useState('');
  const [search, setSearch] = useState('');
  const [tag, setTag] = useState('');
  const [tags, setTags] = useState<{ tag: string; count: number }[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);

  useEffect(() => { api.get<{ tag: string; count: number }[]>('/tags').then(setTags).catch(() => {}); }, [version]);

  useEffect(() => {
    let q = '';
    if (filter === 'active') q = '?status=inbox,planned,in_progress,paused';
    if (filter === 'inbox') q = '?inbox=1';
    if (filter === 'today') q = `?date=${todayStr()}&status=inbox,planned,in_progress,paused`;
    if (filter === 'overdue') q = '?overdue=1';
    if (filter === 'nodate') q = '?status=inbox,planned,in_progress,paused';
    if (filter === 'done') q = '?status=done&limit=100';
    if (filter === 'delegated') {
      api.get<Task[]>('/tasks/delegated').then(setTasks).catch(() => {});
      return;
    }
    if (type) q += `&type=${type}`;
    if (search) q += `&search=${encodeURIComponent(search)}`;
    if (tag) q += `&tag=${encodeURIComponent(tag)}`;
    api.get<Task[]>(`/tasks${q}`).then(list => {
      setTasks(filter === 'nodate' ? list.filter(t => !t.date && !t.deadline) : list);
    }).catch(() => {});
  }, [filter, type, search, tag, version]);

  const groups = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const t of tasks) {
      const key = t.date ?? (t.deadline ? `дедлайн ${humanDate(t.deadline)}` : 'Без даты');
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(t);
    }
    return [...m.entries()];
  }, [tasks]);

  return (
    <div>
      <div className="page-title">
        <h1>Задачи</h1>
        <button className="btn primary" onClick={() => openTask({})}>+ Задача</button>
      </div>

      <div className="tab-pills">
        {FILTERS.map(f => <button key={f.id} className={filter === f.id ? 'on' : ''} onClick={() => setFilter(f.id)}>{f.label}</button>)}
      </div>

      {tags.length > 0 && (
        <div className="flex wrap tag-bar">
          <span className="small muted">Теги:</span>
          {tags.map(t => (
            <button key={t.tag} className={`chip tag clickable${tag === t.tag ? ' on' : ''}`}
              onClick={() => setTag(tag === t.tag ? '' : t.tag)}>
              #{t.tag} <span className="muted">{t.count}</span>
            </button>
          ))}
          {tag && <button className="btn ghost small" onClick={() => setTag('')}>сбросить</button>}
        </div>
      )}

      <div className="flex wrap" style={{ marginBottom: 14 }}>
        <input
          placeholder="Поиск…" value={search} onChange={e => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 160, padding: '9px 13px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--card)', outline: 'none' }}
        />
        <select value={type} onChange={e => setType(e.target.value)}
          style={{ padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--card)' }}>
          <option value="">Все типы</option>
          {Object.entries(TYPE_META).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
        </select>
      </div>

      {filter === 'delegated' && (
        <div className="small muted" style={{ marginBottom: 12 }}>
          Задачи, которые вы передали жене или мастеру. Они лежат в их списках — здесь видно, что с ними происходит.
        </div>
      )}

      {tasks.length === 0 ? (
        <div className="empty"><div className="big-icon">✨</div>
          {filter === 'delegated' ? 'Вы пока никому ничего не поручали. Откройте задачу и нажмите «Поручить».' : 'Здесь пусто'}
        </div>
      ) : filter === 'delegated' ? (
        <div className="card list-plain">
          {tasks.map(t => (
            <div key={t.id} className="task-row">
              <div className="t-body" onClick={() => openTask(t)}>
                <div className="t-title">{t.title}</div>
                <div className="t-meta">
                  <span className="chip accent">👤 {t.assignee ?? '—'}</span>
                  {t.date && <span className="chip">{humanDate(t.date)}</span>}
                  {t.status === 'in_progress' && <span className="chip green">в работе</span>}
                  {t.status === 'paused' && <span className="chip amber">⏸ пауза</span>}
                </div>
              </div>
              <div className="row-actions">
                <button className="btn small ghost" onClick={async () => {
                  await api.post(`/tasks/${t.id}/recall`);
                  toast('Задача возвращена вам'); refresh();
                }}>Забрать</button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        groups.map(([key, list]) => (
          <div key={key}>
            <div className="date-group-head">{key.startsWith('20') ? humanDate(key) : key}</div>
            <div className="card list-plain">
              {list.map(t => <TaskRow key={t.id} task={t} />)}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
