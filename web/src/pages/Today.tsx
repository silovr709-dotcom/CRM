import { useEffect, useState } from 'react';
import { api, humanDate, humanDuration, todayStr, addDays } from '../api';
import { typeIcon } from '../meta';
import { useApp } from '../store';
import TaskRow from '../components/TaskRow';
import type { TodayView } from '../types';

function Ring({ pct }: { pct: number }) {
  const r = 17, c = 2 * Math.PI * r;
  return (
    <div className="ring-wrap" title={`Выполнено ${pct}% дня`}>
      <svg className="ring" width="44" height="44" viewBox="0 0 44 44">
        <circle className="track" cx="22" cy="22" r={r} strokeWidth="4" />
        <circle className="val" cx="22" cy="22" r={r} strokeWidth="4"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} />
      </svg>
      <span className="ring-num">{pct}%</span>
    </div>
  );
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return 'Доброй ночи';
  if (h < 12) return 'Доброе утро';
  if (h < 18) return 'Добрый день';
  return 'Добрый вечер';
}

export default function Today() {
  const { version, refresh, openAi, openTask, toast } = useApp();
  const [v, setV] = useState<TodayView | null>(null);

  useEffect(() => {
    api.get<TodayView>('/planner/today').then(setV).catch(() => {});
  }, [version]);

  if (!v) return <div className="empty">Загрузка…</div>;

  const isEvening = new Date().getHours() >= 17;

  async function carryOver() {
    if (!v) return;
    const ids = v.evening.undone.map(u => u.id);
    await api.post('/planner/carry-over', { task_ids: ids, to_date: addDays(todayStr(), 1) });
    toast(`Перенесено на завтра: ${ids.length}`);
    refresh();
  }

  async function closeReminder(id: number) {
    await api.patch(`/reminders/${id}`, { status: 'done' });
    refresh();
  }

  return (
    <div>
      <div className="page-title">
        <div>
          <h1>{greeting()}</h1>
          <div className="sub" style={{ textTransform: 'capitalize' }}>{new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
        </div>
        <div className="row-actions">
          <button className="btn ai" onClick={() => openAi()}>✨ Что нужно сделать?</button>
        </div>
      </div>

      {/* Брифинг */}
      <div className="brief">
        <div className="stat">📅 <b>{v.briefing.events_count}</b> событий</div>
        <div className="stat">☑️ <b>{v.briefing.tasks_count}</b> задач</div>
        <div className="stat">🚗 <b>{v.briefing.trips_count}</b> поездки</div>
        {v.briefing.overdue_count > 0 && <div className="stat" style={{ color: 'var(--red)' }}>🔴 <b>{v.briefing.overdue_count}</b> просрочено</div>}
        <div className="stat">⏱ свободно <b>{v.briefing.free_human || '0 мин'}</b></div>
      </div>

      {/* Сейчас / Далее */}
      <div className="hero">
        <div className="hero-card hero-now">
          <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div className="label">Сейчас · {v.now_time}</div>
            <Ring pct={(() => {
              const total = v.evening.done_count + v.briefing.tasks_count;
              return total ? Math.round((v.evening.done_count / total) * 100) : 0;
            })()} />
          </div>
          {v.current ? (
            <>
              <div className="big">{typeIcon(v.current.type)} {v.current.title}</div>
              <div className="sub2">{v.current.time} · {humanDuration(v.current.duration_min ?? 30)}</div>
            </>
          ) : (
            <>
              <div className="big">Свободное время</div>
              <div className="sub2">ничего не запланировано прямо сейчас</div>
            </>
          )}
        </div>
        <div className="hero-card hero-next">
          <div className="label" style={{ color: 'var(--muted)' }}>Далее</div>
          {v.next ? (
            <>
              <div className="big">{typeIcon(v.next.type)} {v.next.title}</div>
              <div className="sub2 muted">{v.next.time} · {humanDuration(v.next.duration_min ?? 30)}</div>
            </>
          ) : (
            <div className="big muted">Больше ничего по времени</div>
          )}
        </div>
      </div>

      <div className="flex wrap" style={{ marginBottom: 20 }}>
        <button className="btn" onClick={() => openAi('Распланируй мой день')}>🗓 Распланировать день</button>
        <button className="btn" onClick={() => openAi('Разгрузи мой день')}>🪶 Разгрузить день</button>
        <button className="btn" onClick={() => openAi('Что я забыл?')}>🤔 Что я забыл?</button>
      </div>

      {/* Требует внимания */}
      {v.attention.length > 0 && (
        <div className="section">
          <div className="section-head"><h3>⚠️ Требует внимания</h3></div>
          <div className="card attention-card list-plain">
            {v.attention.map(t => <TaskRow key={t.id} task={t} showDate showTime={false} />)}
          </div>
        </div>
      )}

      {/* Напоминания */}
      {v.reminders.length > 0 && (
        <div className="section">
          <div className="section-head"><h3>⏰ Напоминания</h3></div>
          <div className="card list-plain">
            {v.reminders.map(r => (
              <div key={r.id} className="task-row" style={{ cursor: 'default' }}>
                <div className="t-body">
                  <div className="t-title">⏰ {r.title}</div>
                  <div className="t-meta"><span>{humanDate(r.remind_date)}{r.remind_time ? ` в ${r.remind_time}` : ''}</span></div>
                </div>
                <button className="btn small" onClick={() => closeReminder(r.id)}>OK</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Таймлайн */}
      <div className="section">
        <div className="section-head"><h3>Сегодня по времени</h3></div>
        {v.timeline.filter(b => b.kind === 'task').length === 0 ? (
          <div className="card empty">
            <div className="big-icon">🌿</div>
            Ничего не запланировано по времени.<br />
            <span className="small">Скажите ассистенту, что нужно сделать — он составит план.</span>
          </div>
        ) : (
          <div className="timeline">
            {v.timeline.map((b, i) => (
              <div className="tl-block" key={i}>
                <div className="tl-time">{b.start}</div>
                <div className="tl-rail">{b.kind === 'task' && <span className="dot" style={{ background: b.task!.status === 'done' ? 'var(--green)' : 'var(--accent)' }} />}</div>
                {b.kind === 'task' ? (
                  <div className={`tl-card task${v.current?.id === b.task!.id ? ' now' : ''}`} onClick={() => openTask(b.task!)}>
                    <div className="t-title" style={{ textDecoration: b.task!.status === 'done' ? 'line-through' : 'none' }}>
                      {typeIcon(b.task!.type)} {b.task!.title}
                    </div>
                    <div className="tl-range">
                      {b.start}–{b.end}
                      {b.task!.project ? ` · ${b.task!.project.name}` : ''}
                      {b.task!.blocked ? ' · 🔗 ждёт предыдущую' : ''}
                    </div>
                  </div>
                ) : (
                  <div className="tl-card free">🟢 Свободно · {humanDuration(b.minutes ?? 0)}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Задачи без времени */}
      {v.untimed.length > 0 && (
        <div className="section">
          <div className="section-head"><h3>Просто сделать сегодня</h3><span className="small muted">{v.untimed.length}</span></div>
          <div className="card list-plain">
            {v.untimed.map(t => <TaskRow key={t.id} task={t} showTime={false} />)}
          </div>
        </div>
      )}

      {/* Вечерний разбор */}
      {isEvening && (
        <div className="section">
          <div className="section-head"><h3>🌙 Вечерний разбор</h3></div>
          <div className="card" style={{ padding: 16 }}>
            <div className="flex wrap">
              <span className="chip green">Выполнено: {v.evening.done_count}</span>
              <span className="chip amber">Перенесено: {v.evening.moved_count}</span>
              <span className="chip red">Не выполнено: {v.evening.undone.length}</span>
            </div>
            <div className="mt12 small muted">{v.evening.suggestion}</div>
            {v.evening.undone.length > 0 && (
              <button className="btn primary small mt12" onClick={carryOver}>Перенести невыполненные на завтра</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
