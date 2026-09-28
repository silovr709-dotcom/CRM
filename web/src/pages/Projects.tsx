import { useEffect, useState } from 'react';
import { api, humanDate } from '../api';
import { typeIcon } from '../meta';
import { useApp, useRoute } from '../store';
import type { Project } from '../types';

export default function Projects() {
  const { version, refresh, toast } = useApp();
  const { nav } = useRoute();
  const [projects, setProjects] = useState<Project[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    const q = showArchived ? '?status=active,paused,done,archived' : '';
    api.get<Project[]>(`/projects${q}`).then(setProjects).catch(() => {});
  }, [version, showArchived]);

  async function create() {
    if (!name.trim()) return;
    await api.post('/projects', { name: name.trim() });
    setName(''); setCreating(false); refresh();
    toast('Проект создан');
  }

  const statusChip = (p: Project) =>
    p.status === 'paused' ? <span className="chip amber">⏸ пауза{p.pause_until ? ` до ${humanDate(p.pause_until)}` : ''}</span>
    : p.status === 'done' ? <span className="chip green">завершён</span>
    : p.status === 'archived' ? <span className="chip">архив</span>
    : null;

  return (
    <div>
      <div className="page-title">
        <h1>Проекты</h1>
        <div className="row-actions">
          <button className="btn ghost small" onClick={() => setShowArchived(!showArchived)}>{showArchived ? 'Скрыть завершённые' : 'Показать все'}</button>
          <button className="btn primary" onClick={() => setCreating(true)}>+ Проект</button>
        </div>
      </div>

      {creating && (
        <div className="card" style={{ padding: 14, marginBottom: 14 }}>
          <div className="flex">
            <input autoFocus value={name} onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && create()}
              placeholder="Название проекта: «Кухня Ивановых», «Ремонт дома», «Поездка в Москву»…"
              style={{ flex: 1, padding: '10px 13px', border: '1px solid var(--border)', borderRadius: 10, outline: 'none' }} />
            <button className="btn primary" onClick={create}>Создать</button>
            <button className="btn ghost" onClick={() => setCreating(false)}>✕</button>
          </div>
        </div>
      )}

      {projects.length === 0 ? (
        <div className="empty"><div className="big-icon">📁</div>Проектов пока нет.<br /><span className="small">Проект — контейнер для связанных задач: кухня клиента, сайт, ремонт, поездка.</span></div>
      ) : (
        <div className="proj-grid">
          {projects.map(p => (
            <div key={p.id} className="card proj-card" onClick={() => nav(`/projects/${p.id}`)}>
              <div className="flex" style={{ justifyContent: 'space-between' }}>
                <h3>{p.icon ? p.icon + ' ' : ''}{p.name}</h3>
                {statusChip(p)}
              </div>
              {p.deadline && <span className="chip amber small">до {humanDate(p.deadline)}</span>}
              <div className="progress"><div style={{ width: `${p.progress}%`, background: p.color }} /></div>
              <div className="small muted">{p.tasks_done} из {p.tasks_total} задач · {p.progress}%</div>
              {p.next_action ? (
                <div className="next-action">→ <span><b>{typeIcon(p.next_action.type)} {p.next_action.title}</b>{p.next_action.date ? ` · ${humanDate(p.next_action.date)}` : ''}</span></div>
              ) : p.status === 'active' && (
                <div className="next-action" style={{ color: 'var(--amber)' }}>⚠ нет следующего действия</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
