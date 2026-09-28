import { useEffect, useMemo, useState } from 'react';
import { api, addDays, humanDate, todayStr, weekdayOf, WD_FULL } from '../api';
import { useApp } from '../store';
import TaskRow from '../components/TaskRow';
import type { Task } from '../types';

type Mode = 'day' | '3days' | 'week' | 'month' | 'list';
const MODES: { id: Mode; label: string }[] = [
  { id: 'day', label: 'День' },
  { id: '3days', label: '3 дня' },
  { id: 'week', label: 'Неделя' },
  { id: 'month', label: 'Месяц' },
  { id: 'list', label: 'Список' },
];

export default function Calendar() {
  const { version, openTask, refresh, toast } = useApp();
  const [dragOver, setDragOver] = useState<string | null>(null);

  async function dropOn(date: string, e: React.DragEvent) {
    e.preventDefault();
    setDragOver(null);
    const id = e.dataTransfer.getData('text/task-id');
    if (!id) return;
    await api.patch(`/tasks/${id}`, { date });
    toast(`Перенесено на ${humanDate(date)}`);
    refresh();
  }
  const dropProps = (d: string) => ({
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); setDragOver(d); },
    onDragLeave: () => setDragOver((cur) => (cur === d ? null : cur)),
    onDrop: (e: React.DragEvent) => dropOn(d, e),
  });
  const [mode, setMode] = useState<Mode>('day');
  const [anchor, setAnchor] = useState(todayStr());
  const [tasks, setTasks] = useState<Task[]>([]);

  const range = useMemo(() => {
    if (mode === 'day') return { from: anchor, to: anchor };
    if (mode === '3days') return { from: anchor, to: addDays(anchor, 2) };
    if (mode === 'week') {
      const wd = (weekdayOf(anchor) + 6) % 7; // 0=пн
      const start = addDays(anchor, -wd);
      return { from: start, to: addDays(start, 6) };
    }
    if (mode === 'month') {
      const first = anchor.slice(0, 8) + '01';
      const wd = (weekdayOf(first) + 6) % 7;
      const gridStart = addDays(first, -wd);
      return { from: gridStart, to: addDays(gridStart, 41) };
    }
    return { from: anchor, to: addDays(anchor, 30) };
  }, [mode, anchor]);

  useEffect(() => {
    api.get<Task[]>(`/tasks?from=${range.from}&to=${range.to}&status=inbox,planned,in_progress,paused,done`).then(setTasks).catch(() => {});
  }, [range.from, range.to, version]);

  const byDate = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const t of tasks) {
      if (!t.date) continue;
      if (!m.has(t.date)) m.set(t.date, []);
      m.get(t.date)!.push(t);
    }
    return m;
  }, [tasks]);

  function shift(dir: number) {
    const step = mode === 'day' ? 1 : mode === '3days' ? 3 : mode === 'week' ? 7 : mode === 'month' ? 30 : 30;
    if (mode === 'month') {
      const [y, m] = anchor.split('-').map(Number);
      const d = new Date(y, m - 1 + dir, 1);
      setAnchor(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`);
    } else setAnchor(addDays(anchor, dir * step));
  }

  const days: string[] = [];
  for (let d = range.from; d <= range.to; d = addDays(d, 1)) days.push(d);

  const monthTitle = new Date(Number(anchor.slice(0, 4)), Number(anchor.slice(5, 7)) - 1, 1)
    .toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });

  return (
    <div>
      <div className="page-title">
        <h1>Календарь</h1>
      </div>
      <div className="cal-head">
        <div className="seg">
          {MODES.map(m => <button key={m.id} className={mode === m.id ? 'on' : ''} onClick={() => setMode(m.id)}>{m.label}</button>)}
        </div>
        <div className="spacer" />
        <div className="row-actions">
          <button className="btn small" onClick={() => shift(-1)}>←</button>
          <button className="btn small" onClick={() => setAnchor(todayStr())}>Сегодня</button>
          <button className="btn small" onClick={() => shift(1)}>→</button>
        </div>
      </div>

      {mode === 'month' ? (
        <>
          <h3 style={{ marginBottom: 10, textTransform: 'capitalize' }}>{monthTitle}</h3>
          <div className="cal-month">
            {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(d => <div key={d} className="dow">{d}</div>)}
            {days.map(d => {
              const inMonth = d.slice(5, 7) === anchor.slice(5, 7);
              const list = byDate.get(d) ?? [];
              return (
                <div key={d} className={`cal-cell${inMonth ? '' : ' other'}${d === todayStr() ? ' today' : ''}`}
                  style={dragOver === d ? { borderColor: 'var(--accent)', boxShadow: '0 0 0 2.5px var(--accent-soft)' } : {}}
                  {...dropProps(d)}
                  onClick={() => { setAnchor(d); setMode('day'); }}>
                  <div className="d">{Number(d.slice(8, 10))}</div>
                  {list.slice(0, 3).map(t => <div key={t.id} className="cal-ev">{t.time ? t.time + ' ' : ''}{t.title}</div>)}
                  {list.length > 3 && <div className="cal-more">ещё {list.length - 3}</div>}
                  {list.length > 0 && <div className="cal-dots">{list.slice(0, 5).map(t => <span key={t.id} className="cal-dot" />)}</div>}
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div>
          {days.map(d => {
            const list = (byDate.get(d) ?? []).filter(t => mode === 'list' ? t.status !== 'done' : true);
            if (mode === 'list' && list.length === 0) return null;
            return (
              <div key={d} {...dropProps(d)}
                style={dragOver === d ? { outline: '2px dashed var(--accent)', outlineOffset: 4, borderRadius: 14 } : {}}>
                <div className="date-group-head" style={d === todayStr() ? { color: 'var(--accent-ink)' } : {}}>
                  {humanDate(d)} · {WD_FULL[weekdayOf(d)]}
                </div>
                {list.length === 0 ? (
                  <div className="card empty" style={{ padding: 18 }}>Свободный день — перетащите сюда задачу</div>
                ) : (
                  <div className="card list-plain">
                    {list.map(t => <TaskRow key={t.id} task={t} draggable />)}
                  </div>
                )}
              </div>
            );
          })}
          {mode === 'list' && [...byDate.values()].every(l => l.every(t => t.status === 'done')) && (
            <div className="empty">В ближайшие 30 дней ничего не запланировано</div>
          )}
        </div>
      )}
    </div>
  );
}
