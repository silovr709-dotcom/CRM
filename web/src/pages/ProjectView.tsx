import { useEffect, useState } from 'react';
import { api, humanDate, todayStr, addDays } from '../api';
import { useApp, useRoute } from '../store';
import TaskRow from '../components/TaskRow';
import type { Project, Template } from '../types';

const ACTIONS: Record<string, string> = {
  created: 'создано', updated: 'изменено', rescheduled: 'перенесено', completed: 'выполнено',
  cancelled: 'отменено', paused: 'пауза', resumed: 'возобновлено', deleted: 'удалено',
  reopened: 'возобновлено', started: 'в работе', fired: 'сработало', instantiated: 'создан из шаблона',
};

export default function ProjectView({ id }: { id: number }) {
  const { version, refresh, toast, openTask } = useApp();
  const { nav } = useRoute();
  const [p, setP] = useState<Project | null>(null);
  const [tab, setTab] = useState<'tasks' | 'notes' | 'history'>('tasks');
  const [noteText, setNoteText] = useState('');
  const [templates, setTemplates] = useState<Template[]>([]);
  const [tplPick, setTplPick] = useState('');
  const [showDone, setShowDone] = useState(false);

  useEffect(() => {
    api.get<Project>(`/projects/${id}`).then(setP).catch(() => {});
    api.get<Template[]>('/templates').then(setTemplates).catch(() => {});
  }, [id, version]);

  if (!p) return <div className="empty">Загрузка…</div>;

  async function setStatus(status: string, pauseUntil?: string) {
    await api.patch(`/projects/${id}`, { status, pause_until: pauseUntil ?? null });
    refresh();
    toast(status === 'paused' ? 'Проект на паузе' : status === 'active' ? 'Проект возобновлён' : 'Статус обновлён');
  }

  async function addNote() {
    if (!noteText.trim()) return;
    await api.post('/notes', { content: noteText.trim(), project_id: id });
    setNoteText(''); refresh();
  }

  async function applyTemplate() {
    if (!tplPick) return;
    const res = await api.post<{ created: unknown[] }>(`/templates/${tplPick}/instantiate`, {
      project_id: id, start_date: todayStr(), context_title: p!.name,
    });
    setTplPick(''); refresh();
    toast(`Создано задач из шаблона: ${res.created.length}`);
  }

  const openTasks = (p.tasks ?? []).filter(t => !['done', 'cancelled'].includes(t.status) && !t.parent_id);
  const doneTasks = (p.tasks ?? []).filter(t => ['done', 'cancelled'].includes(t.status) && !t.parent_id);

  return (
    <div>
      <button className="btn ghost small" onClick={() => nav('/projects')}>← Проекты</button>
      <div className="page-title mt8">
        <div>
          <h1>{p.icon ? p.icon + ' ' : ''}{p.name}</h1>
          <div className="sub">
            {p.description || ''} {p.deadline && <span className="chip amber">дедлайн {humanDate(p.deadline)}</span>}
            {p.status === 'paused' && <span className="chip">⏸ пауза{p.pause_until ? ` до ${humanDate(p.pause_until)}` : ''}</span>}
          </div>
        </div>
        <div className="row-actions">
          {p.status === 'active' && (
            <button className="btn small" onClick={() => {
              const until = prompt('Пауза до какой даты? (ГГГГ-ММ-ДД, пусто — без напоминания)', addDays(todayStr(), 14));
              setStatus('paused', until || undefined);
            }}>⏸ Пауза</button>
          )}
          {p.status === 'paused' && <button className="btn small" onClick={() => setStatus('active')}>▶ Возобновить</button>}
          {p.status !== 'done' && <button className="btn small" onClick={() => setStatus('done')}>✓ Завершить</button>}
        </div>
      </div>

      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div className="progress" style={{ margin: '0 0 8px' }}><div style={{ width: `${p.progress}%`, background: p.color }} /></div>
        <div className="small muted">{p.tasks_done} из {p.tasks_total} задач · {p.progress}%</div>
        {p.next_action ? (
          <div className="next-action mt8">→ Следующее действие: <b>{p.next_action.title}</b>{p.next_action.date ? ` · ${humanDate(p.next_action.date)}` : ''}</div>
        ) : p.status === 'active' && (
          <div className="next-action mt8" style={{ color: 'var(--amber)' }}>⚠ Нет следующего действия — проект может «потеряться». Добавьте задачу.</div>
        )}
      </div>

      <div className="tab-pills">
        <button className={tab === 'tasks' ? 'on' : ''} onClick={() => setTab('tasks')}>Задачи ({openTasks.length})</button>
        <button className={tab === 'notes' ? 'on' : ''} onClick={() => setTab('notes')}>Заметки ({p.notes?.length ?? 0})</button>
        <button className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}>История</button>
      </div>

      {tab === 'tasks' && (
        <>
          <div className="flex wrap" style={{ marginBottom: 12 }}>
            <button className="btn primary small" onClick={() => openTask({ project_id: id })}>+ Задача</button>
            <select value={tplPick} onChange={e => setTplPick(e.target.value)}
              style={{ padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 9, background: 'var(--card)', fontSize: 13 }}>
              <option value="">Из шаблона…</option>
              {templates.map(t => <option key={t.id} value={t.id}>{t.name} ({t.steps.length} шагов)</option>)}
            </select>
            {tplPick && <button className="btn small" onClick={applyTemplate}>Создать цепочку</button>}
          </div>
          {openTasks.length === 0 ? <div className="card empty">Нет открытых задач</div> : (
            <div className="card list-plain">{openTasks.map(t => <TaskRow key={t.id} task={t} showDate />)}</div>
          )}
          {doneTasks.length > 0 && (
            <>
              <button className="btn ghost small mt12" onClick={() => setShowDone(!showDone)}>
                {showDone ? 'Скрыть' : 'Показать'} выполненные ({doneTasks.length})
              </button>
              {showDone && <div className="card list-plain mt8">{doneTasks.map(t => <TaskRow key={t.id} task={t} showDate />)}</div>}
            </>
          )}
        </>
      )}

      {tab === 'notes' && (
        <>
          <div className="quick-note">
            <input value={noteText} onChange={e => setNoteText(e.target.value)} onKeyDown={e => e.key === 'Enter' && addNote()}
              placeholder="Новая заметка к проекту…" />
            <button className="btn primary" onClick={addNote}>+</button>
          </div>
          {(p.notes ?? []).length === 0 ? <div className="empty">Заметок нет</div> : (
            <div className="note-grid">
              {p.notes!.map(n => (
                <div key={n.id} className="card note-card" onClick={async () => {
                  const upd = prompt('Заметка:', n.content);
                  if (upd !== null && upd !== n.content) { await api.patch(`/notes/${n.id}`, { content: upd }); refresh(); }
                }}>
                  {n.title && <div className="n-title">{n.title}</div>}
                  <div className="n-content">{n.content}</div>
                  <div className="small muted mt8">{n.created_at.slice(0, 10)}</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'history' && (
        <div className="card" style={{ padding: '4px 16px' }}>
          {(p.history ?? []).map(h => (
            <div key={h.id} className="history-row">
              <span className="when">{h.created_at.slice(5, 16)}</span>
              <span className="act">{ACTIONS[h.action] ?? h.action}</span>
              <span className="muted">{h.details}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
