import { api, humanDate, humanDuration, todayStr } from '../api';
import { typeIcon } from '../meta';
import { PRIORITY_META } from '../meta';
import { useApp } from '../store';
import type { Task } from '../types';

export default function TaskRow({ task, showDate, showTime = true }: { task: Task; showDate?: boolean; showTime?: boolean }) {
  const { refresh, toast, openTask } = useApp();
  const done = task.status === 'done';

  async function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    if (task.blocked && !done) {
      const dep = task.dependencies?.find(d => d.dep_status !== 'done' && d.dep_status !== 'cancelled');
      toast(`Сначала: «${dep?.dep_title ?? 'предыдущая задача'}» — эта задача зависит от незавершённой`);
      return;
    }
    if (done) {
      await api.post(`/tasks/${task.id}/status`, { status: 'planned' });
      toast('Задача возвращена в работу');
    } else {
      const res = await api.post<{ followups: { kind: string; task?: { title: string; date: string } }[]; unblocked: { title: string }[] }>(`/tasks/${task.id}/complete`);
      const fu = res.followups.filter(f => f.task);
      if (fu.length) toast(`Готово! Автоматически создано: ${fu.map(f => `«${f.task!.title}» (${humanDate(f.task!.date)})`).join(', ')}`);
      else if (res.unblocked.length) toast(`Готово! Разблокировано: ${res.unblocked.map(u => `«${u.title}»`).join(', ')}`);
      else toast('Задача выполнена');
    }
    refresh();
  }

  const overdue = !done && task.status !== 'cancelled' && (
    (task.date && task.date < todayStr()) || (task.deadline && task.deadline < todayStr()));
  const prio = PRIORITY_META[task.priority] ?? PRIORITY_META[0];

  return (
    <div className={`task-row${done ? ' done' : ''}`} onClick={() => openTask(task)}>
      {showTime && <div className="t-time">{task.time ?? ''}</div>}
      <div className={`task-check${done ? ' checked' : ''}${task.blocked && !done ? ' blocked' : ''}`} onClick={toggle}>
        {done ? '✓' : ''}
      </div>
      <div className="t-body">
        <div className="t-title">{typeIcon(task.type)} {task.title}</div>
        <div className="t-meta">
          {task.priority > 0 && <span className="prio-dot" style={{ background: prio.color }} title={prio.label} />}
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
    </div>
  );
}
