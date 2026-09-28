import { useRef, useState } from 'react';
import { addDays, api, humanDate, humanDuration, todayStr } from '../api';
import { typeIcon } from '../meta';
import { PRIORITY_META } from '../meta';
import { useApp } from '../store';
import type { Task } from '../types';

// Теги #из_названия. ВАЖНО: \w и \b в JS не работают с кириллицей —
// класс символов перечисляем явно.
const TAG_RE = /#([0-9A-Za-zА-Яа-яЁё_-]{2,30})/g;
export function taskTags(title: string): string[] {
  return [...String(title).matchAll(TAG_RE)].map(m => m[1]);
}
function titleWithoutTags(title: string): string {
  return title.replace(TAG_RE, '').replace(/\s{2,}/g, ' ').trim() || title;
}

const SWIPE_THRESHOLD = 70;

export default function TaskRow({ task, showDate, showTime = true, draggable }: { task: Task; showDate?: boolean; showTime?: boolean; draggable?: boolean }) {
  const { refresh, toast, openTask } = useApp();
  const done = task.status === 'done';
  const [dx, setDx] = useState(0);
  const startX = useRef<number | null>(null);
  const startY = useRef<number | null>(null);
  const swiping = useRef(false);

  async function complete() {
    if (task.blocked && !done) {
      const dep = task.dependencies?.find(d => d.dep_status !== 'done' && d.dep_status !== 'cancelled');
      toast(`Сначала: «${dep?.dep_title ?? 'предыдущая задача'}» — эта задача зависит от незавершённой`);
      return;
    }
    const prevStatus = task.status;
    const res = await api.post<{ followups: { kind: string; task?: { title: string; date: string } }[]; unblocked: { title: string }[] }>(`/tasks/${task.id}/complete`);
    const fu = res.followups.filter(f => f.task);
    const msg = fu.length
      ? `Готово! Создано: ${fu.map(f => `«${f.task!.title}»`).join(', ')}`
      : res.unblocked.length
        ? `Готово! Разблокировано: ${res.unblocked.map(u => `«${u.title}»`).join(', ')}`
        : `✅ «${task.title}» выполнена`;
    toast(msg, {
      run: async () => {
        await api.post(`/tasks/${task.id}/status`, { status: prevStatus === 'done' ? 'planned' : prevStatus });
        refresh();
      },
    });
    refresh();
  }

  async function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    if (done) {
      await api.post(`/tasks/${task.id}/status`, { status: 'planned' });
      toast('Задача возвращена в работу');
      refresh();
      return;
    }
    await complete();
  }

  const overdue = !done && task.status !== 'cancelled' && (
    (task.date && task.date < todayStr()) || (task.deadline && task.deadline < todayStr()));
  const prio = PRIORITY_META[task.priority] ?? PRIORITY_META[0];

  async function toTomorrow(e?: React.MouseEvent) {
    e?.stopPropagation();
    const prevDate = task.date;
    const prevTime = task.time;
    await api.patch(`/tasks/${task.id}`, { date: addDays(todayStr(), 1), time: null });
    toast(`«${task.title}» → завтра`, {
      run: async () => {
        await api.patch(`/tasks/${task.id}`, { date: prevDate, time: prevTime });
        refresh();
      },
    });
    refresh();
  }

  // --- Свайпы на телефоне: вправо — выполнено, влево — на завтра ---
  function onTouchStart(e: React.TouchEvent) {
    if (done || task.status === 'cancelled') return;
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
    swiping.current = false;
  }
  function onTouchMove(e: React.TouchEvent) {
    if (startX.current == null || startY.current == null) return;
    const deltaX = e.touches[0].clientX - startX.current;
    const deltaY = e.touches[0].clientY - startY.current;
    if (!swiping.current && Math.abs(deltaX) > 12 && Math.abs(deltaX) > Math.abs(deltaY)) swiping.current = true;
    if (swiping.current) setDx(Math.max(-140, Math.min(140, deltaX)));
  }
  async function onTouchEnd() {
    const delta = dx;
    startX.current = null; startY.current = null;
    setDx(0);
    if (!swiping.current) return;
    swiping.current = false;
    if (delta > SWIPE_THRESHOLD) await complete();
    else if (delta < -SWIPE_THRESHOLD) await toTomorrow();
  }

  const tags = taskTags(task.title);

  return (
    <div className="swipe-wrap">
      {dx > 10 && <div className="swipe-hint left">✅ Выполнено</div>}
      {dx < -10 && <div className="swipe-hint right">→ Завтра</div>}
      <div
        className={`task-row${done ? ' done' : ''}`}
        style={dx ? { transform: `translateX(${dx}px)` } : undefined}
        onClick={() => { if (!swiping.current) openTask(task); }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        draggable={draggable && task.schedule_mode !== 'fixed'}
        onDragStart={draggable ? (e) => { e.dataTransfer.setData('text/task-id', String(task.id)); e.dataTransfer.effectAllowed = 'move'; } : undefined}
      >
        {showTime && <div className="t-time">{task.time ?? ''}</div>}
        <div className={`task-check${done ? ' checked' : ''}${task.blocked && !done ? ' blocked' : ''}`} onClick={toggle}>
          {done ? '✓' : ''}
        </div>
        <div className="t-body">
          <div className="t-title">{typeIcon(task.type)} {titleWithoutTags(task.title)}</div>
          <div className="t-meta">
            {task.priority > 0 && <span className="prio-dot" style={{ background: prio.color }} title={prio.label} />}
            {tags.map(t => <span key={t} className="chip tag">#{t}</span>)}
            {showDate && task.date && <span className={overdue ? 'chip red' : 'chip'}>{humanDate(task.date)}</span>}
            {!showDate && overdue && <span className="chip red">просрочена</span>}
            {task.duration_min != null && <span>{humanDuration(task.duration_min)}</span>}
            {task.deadline && <span className={`chip ${task.deadline < todayStr() && !done ? 'red' : 'amber'}`}>до {humanDate(task.deadline)}</span>}
            {task.project && <span className="chip accent">{task.project.name}</span>}
            {task.category && <span className="chip">{task.category.icon} {task.category.name}</span>}
            {task.blocked && !done && <span className="chip amber">🔗 ждёт предыдущую</span>}
            {(task.subtasks_total ?? 0) > 0 && <span className="chip">{task.subtasks_done}/{task.subtasks_total}</span>}
            {task.recurrence && <span className="chip">🔁</span>}
            {task.status === 'paused' && <span className="chip">⏸ пауза</span>}
            {task.location && <span>📍 {task.location}</span>}
            {(task.location_from || task.location_to) && <span>📍 {task.location_from} → {task.location_to}</span>}
            {task.attention_reason && <span className="chip red">{task.attention_reason}</span>}
          </div>
        </div>
        {!done && task.status !== 'cancelled' && task.schedule_mode !== 'fixed' && (
          <div className="quick-act">
            <button onClick={toTomorrow} title="Перенести на завтра">→ завтра</button>
          </div>
        )}
      </div>
    </div>
  );
}
