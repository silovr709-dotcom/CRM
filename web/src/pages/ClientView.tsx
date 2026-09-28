import { useEffect, useState } from 'react';
import { api, humanDate, money } from '../api';
import { useApp, useRoute } from '../store';
import TaskRow from '../components/TaskRow';
import Attachments from '../components/Attachments';
import type { ClientFull } from '../types';

// Карточка клиента: задачи, проекты с прогрессом, заметки, файлы,
// кликабельный телефон, кнопка «+ Задача» и долг по деньгам.
export default function ClientView({ id }: { id: number }) {
  const { version, refresh, openTask, toast } = useApp();
  const { nav } = useRoute();
  const [c, setC] = useState<ClientFull | null>(null);
  const [tab, setTab] = useState<'tasks' | 'projects' | 'notes' | 'files'>('tasks');
  const [noteText, setNoteText] = useState('');

  useEffect(() => {
    api.get<ClientFull>(`/contacts/${id}/full`).then(setC).catch(() => {});
  }, [id, version]);

  if (!c) return <div className="empty">Загрузка…</div>;

  const phoneHref = `tel:${(c.phone || '').replace(/[^\d+]/g, '')}`;
  const openTasks = c.tasks.filter(t => !['done', 'cancelled'].includes(t.status));
  const doneTasks = c.tasks.filter(t => ['done', 'cancelled'].includes(t.status));

  async function addNote() {
    if (!noteText.trim()) return;
    await api.post('/notes', { content: noteText.trim(), contact_id: id });
    setNoteText(''); refresh(); toast('Заметка добавлена');
  }

  return (
    <div>
      <button className="btn ghost small" onClick={() => nav('/clients')}>← Клиенты</button>

      <div className="page-title mt8">
        <div>
          <h1>{c.name}</h1>
          <div className="sub flex wrap">
            {c.phone && <a className="phone-link" href={phoneHref}>📞 {c.phone}</a>}
            {c.address && <span>📍 {c.address}</span>}
            {c.email && <span>✉️ {c.email}</span>}
          </div>
        </div>
        <div className="row-actions">
          {c.phone && <a className="btn" href={phoneHref}>📞 Позвонить</a>}
          <button className="btn primary" onClick={() => openTask({ contact_id: c.id })}>+ Задача</button>
        </div>
      </div>

      {/* Деньги */}
      <div className="card money-card">
        <div><span className="lbl">Заказов на</span><b>{money(c.total_price)}</b></div>
        <div><span className="lbl">Получено</span><b className="ok">{money(c.total_paid)}</b></div>
        <div>
          <span className="lbl">Должен</span>
          <b className={c.debt > 0 ? 'danger' : 'ok'}>{c.debt > 0 ? money(c.debt) : 'ничего ✅'}</b>
        </div>
      </div>

      {c.notes.length === 0 && c.projects.length === 0 && (
        <div className="small muted" style={{ marginBottom: 12 }}>
          Создайте проект и укажите в нём клиента — тогда здесь появятся прогресс, деньги и файлы.
        </div>
      )}

      <div className="tab-pills">
        <button className={tab === 'tasks' ? 'on' : ''} onClick={() => setTab('tasks')}>Задачи ({openTasks.length})</button>
        <button className={tab === 'projects' ? 'on' : ''} onClick={() => setTab('projects')}>Проекты ({c.projects.length})</button>
        <button className={tab === 'notes' ? 'on' : ''} onClick={() => setTab('notes')}>Заметки ({c.notes.length})</button>
        <button className={tab === 'files' ? 'on' : ''} onClick={() => setTab('files')}>Файлы ({c.files.length})</button>
      </div>

      {tab === 'tasks' && (
        <>
          {openTasks.length === 0 ? (
            <div className="card empty">Открытых задач нет. <button className="btn small mt8" onClick={() => openTask({ contact_id: c.id })}>+ Задача</button></div>
          ) : (
            <div className="card list-plain">{openTasks.map(t => <TaskRow key={t.id} task={t} showDate />)}</div>
          )}
          {doneTasks.length > 0 && (
            <>
              <div className="date-group-head">Выполнено ({doneTasks.length})</div>
              <div className="card list-plain">{doneTasks.slice(0, 20).map(t => <TaskRow key={t.id} task={t} showDate />)}</div>
            </>
          )}
        </>
      )}

      {tab === 'projects' && (
        c.projects.length === 0 ? <div className="card empty">У клиента пока нет проектов</div> : (
          <div className="proj-grid">
            {c.projects.map(p => (
              <div key={p.id} className="card proj-card" onClick={() => nav(`/projects/${p.id}`)}>
                <div className="flex" style={{ justifyContent: 'space-between' }}>
                  <h3>{p.icon ? p.icon + ' ' : ''}{p.name}</h3>
                  {p.stage && <span className="chip accent">{p.stage}</span>}
                </div>
                <div className="progress"><div style={{ width: `${p.progress}%`, background: p.color }} /></div>
                <div className="small muted">{p.tasks_done} из {p.tasks_total} задач · {p.progress}%</div>
                <div className="flex wrap mt8">
                  {p.price != null && <span className="chip">заказ {money(p.price)}</span>}
                  {p.debt > 0 && <span className="chip red">должны {money(p.debt)}</span>}
                  {p.deadline && <span className="chip amber">до {humanDate(p.deadline)}</span>}
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {tab === 'notes' && (
        <>
          <div className="quick-note">
            <input value={noteText} onChange={e => setNoteText(e.target.value)} onKeyDown={e => e.key === 'Enter' && addNote()}
              placeholder="Новая заметка о клиенте…" />
            <button className="btn primary" onClick={addNote}>+</button>
          </div>
          {c.notes.length === 0 ? <div className="empty">Заметок нет</div> : (
            <div className="note-grid">
              {c.notes.map(n => (
                <div key={n.id} className="card note-card">
                  {n.title && <div className="n-title">{n.title}</div>}
                  <div className="n-content">{n.content}</div>
                  <div className="small muted mt8">{n.created_at.slice(0, 10)}{n.project_name ? ` · ${n.project_name}` : ''}</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'files' && (
        <div className="card" style={{ padding: 16 }}>
          {c.files.length === 0 && <div className="small muted mt8">Файлы появятся здесь, когда вы прикрепите их к проектам клиента.</div>}
          {c.files.map(f => (
            <div key={f.id} className="flex small mt8" style={{ justifyContent: 'space-between' }}>
              <a href={`/api/attachments/${f.id}/download`} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-ink)' }}>
                📎 {f.filename}
              </a>
              <span className="muted">{f.created_at.slice(0, 10)}</span>
            </div>
          ))}
          {c.projects[0] && (
            <div className="mt12">
              <Attachments projectId={c.projects[0].id} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
