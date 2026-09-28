import { useEffect, useMemo, useState } from 'react';
import { api, humanDate, todayStr } from '../api';
import { TYPE_META } from '../meta';
import { useApp } from '../store';
import TaskRow from '../components/TaskRow';
import type { Task } from '../types';

type Filter = 'active' | 'inbox' | 'today' | 'overdue' | 'nodate' | 'done';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'active', label: 'Активные' },
  { id: 'inbox', label: 'Входящие' },
  { id: 'today', label: 'Сегодня' },
  { id: 'overdue', label: 'Просроченные' },
  { id: 'nodate', label: 'Без даты' },
  { id: 'done', label: 'Выполненные' },
];

export default function Tasks() {
  const { version, openTask } = useApp();
  const [filter, setFilter] = useState<Filter>('active');
  const [type, setType] = useState('');
  const [search, setSearch] = useState('');
  const [tasks, setTasks] = useState<Task[]>([]);

  useEffect(() => {
    let q = '';
    if (filter === 'active') q = '?status=inbox,planned,in_progress,paused';
    if (filter === 'inbox') q = '?inbox=1';
    if (filter === 'today') q = `?date=${todayStr()}&status=inbox,planned,in_progress,paused`;
    if (filter === 'overdue') q = '?overdue=1';
    if (filter === 'nodate') q = '?status=inbox,planned,in_progress,paused';
    if (filter === 'done') q = '?status=done&limit=100';
    if (type) q += `&type=${type}`;
    if (search) q += `&search=${encodeURIComponent(search)}`;
    api.get<Task[]>(`/tasks${q}`).then(list => {
      setTasks(filter === 'nodate' ? list.filter(t => !t.date && !t.deadline) : list);
    }).catch(() => {});
  }, [filter, type, search, version]);

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

      {tasks.length === 0 ? (
        <div className="empty"><div className="big-icon">✨</div>Здесь пусто</div>
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
