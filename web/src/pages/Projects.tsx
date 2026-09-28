import { useEffect, useState } from 'react';
import { api, humanDate, money } from '../api';
import { typeIcon } from '../meta';
import { useApp, useRoute } from '../store';
import type { Project } from '../types';
import { STAGES } from '../types';

type View = 'board' | 'list';

export default function Projects() {
  const { version, refresh, toast } = useApp();
  const { nav } = useRoute();
  const [projects, setProjects] = useState<Project[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [view, setView] = useState<View>(() => (localStorage.getItem('projects_view') as View) || 'board');
  const [dragId, setDragId] = useState<number | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);

  useEffect(() => {
    const q = showArchived ? '?status=active,paused,done,archived' : '';
    api.get<Project[]>(`/projects${q}`).then(setProjects).catch(() => {});
  }, [version, showArchived]);

  const setViewSaved = (v: View) => { setView(v); localStorage.setItem('projects_view', v); };

  async function create() {
    if (!name.trim()) return;
    await api.post('/projects', { name: name.trim(), stage: 'Замер' });
    setName(''); setCreating(false); refresh();
    toast('Заказ создан');
  }

  // Перетаскивание карточки на другой этап
  async function dropOn(stage: string | null) {
    const id = dragId;
    setDragId(null); setOverStage(null);
    if (!id) return;
    const before = projects.find(p => p.id === id);
    if (!before || before.stage === stage) return;
    setProjects(prev => prev.map(p => (p.id === id ? { ...p, stage } : p)));
    await api.patch(`/projects/${id}`, { stage });
    refresh();
    toast(stage ? `«${before.name}» → ${stage}` : 'Этап снят', {
      label: 'Отменить',
      run: async () => { await api.patch(`/projects/${id}`, { stage: before.stage ?? null }); refresh(); },
    });
  }

  const totalDebt = projects
    .filter(p => ['active', 'paused'].includes(p.status))
    .reduce((sum, p) => sum + (p.debt ?? 0), 0);

  const statusChip = (p: Project) =>
    p.status === 'paused' ? <span className="chip amber">⏸ пауза{p.pause_until ? ` до ${humanDate(p.pause_until)}` : ''}</span>
    : p.status === 'done' ? <span className="chip green">завершён</span>
    : p.status === 'archived' ? <span className="chip">архив</span>
    : null;

  const card = (p: Project) => (
    <div key={p.id} className="card proj-card" onClick={() => nav(`/projects/${p.id}`)}
      draggable={view === 'board'}
      onDragStart={() => setDragId(p.id)}
      onDragEnd={() => { setDragId(null); setOverStage(null); }}>
      <div className="flex" style={{ justifyContent: 'space-between' }}>
        <h3>{p.icon ? p.icon + ' ' : ''}{p.name}</h3>
        {statusChip(p)}
      </div>
      <div className="flex wrap">
        {view === 'list' && p.stage && <span className="chip accent small">{p.stage}</span>}
        {p.deadline && <span className="chip amber small">до {humanDate(p.deadline)}</span>}
        {(p.debt ?? 0) > 0 && <span className="chip red small">должны {money(p.debt!)}</span>}
        {p.price != null && (p.debt ?? 0) === 0 && <span className="chip green small">оплачено</span>}
        {p.contact && <span className="chip small">🤝 {p.contact.name}</span>}
      </div>
      <div className="progress"><div style={{ width: `${p.progress}%`, background: p.color }} /></div>
      <div className="small muted">{p.tasks_done} из {p.tasks_total} задач · {p.progress}%</div>
      {p.next_action ? (
        <div className="next-action">→ <span><b>{typeIcon(p.next_action.type)} {p.next_action.title}</b>{p.next_action.date ? ` · ${humanDate(p.next_action.date)}` : ''}</span></div>
      ) : p.status === 'active' && (
        <div className="next-action" style={{ color: 'var(--amber)' }}>⚠ нет следующего действия</div>
      )}
    </div>
  );

  const columns: { key: string | null; title: string; items: Project[] }[] = [
    { key: null, title: 'Без этапа', items: projects.filter(p => !p.stage) },
    ...STAGES.map(st => ({ key: st as string | null, title: st, items: projects.filter(p => p.stage === st) })),
  ].filter(col => col.key !== null || col.items.length > 0);

  return (
    <div>
      <div className="page-title">
        <div>
          <h1>Заказы</h1>
          <div className="sub">{projects.length} шт. · перетаскивайте карточки между этапами</div>
        </div>
        <div className="row-actions">
          <div className="seg">
            <button className={view === 'board' ? 'on' : ''} onClick={() => setViewSaved('board')}>Доска</button>
            <button className={view === 'list' ? 'on' : ''} onClick={() => setViewSaved('list')}>Список</button>
          </div>
          <button className="btn ghost small" onClick={() => setShowArchived(!showArchived)}>{showArchived ? 'Скрыть завершённые' : 'Показать все'}</button>
          <button className="btn primary" onClick={() => setCreating(true)}>+ Заказ</button>
        </div>
      </div>

      {totalDebt > 0 && (
        <div className="card money-summary" onClick={() => nav('/money')} style={{ cursor: 'pointer' }}>
          <span>💰 Клиенты должны всего</span>
          <b>{money(totalDebt)}</b>
        </div>
      )}

      {creating && (
        <div className="card" style={{ padding: 14, marginBottom: 14 }}>
          <div className="flex">
            <input autoFocus value={name} onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && create()}
              placeholder="Название заказа: «Кухня Ивановых», «Шкаф-купе на Ленина»…"
              style={{ flex: 1, padding: '10px 13px', border: '1px solid var(--border)', borderRadius: 10, outline: 'none' }} />
            <button className="btn primary" onClick={create}>Создать</button>
            <button className="btn ghost" onClick={() => setCreating(false)}>✕</button>
          </div>
        </div>
      )}

      {projects.length === 0 ? (
        <div className="empty"><div className="big-icon">📁</div>Заказов пока нет.<br />
          <span className="small">Заказ — это кухня клиента, шкаф, ремонт: внутри задачи, деньги, файлы и заметки.</span></div>
      ) : view === 'list' ? (
        <div className="proj-grid">{projects.map(card)}</div>
      ) : (
        <div className="board">
          {columns.map(col => {
            const debt = col.items.reduce((s, p) => s + (p.debt ?? 0), 0);
            return (
              <div key={col.title}
                className={`board-col${overStage === col.title ? ' over' : ''}`}
                onDragOver={e => { e.preventDefault(); setOverStage(col.title); }}
                onDragLeave={() => setOverStage(s => (s === col.title ? null : s))}
                onDrop={() => dropOn(col.key)}>
                <div className="board-head">
                  <b>{col.title}</b>
                  <span className="small muted">{col.items.length}</span>
                </div>
                {debt > 0 && <div className="board-debt small">должны {money(debt)}</div>}
                <div className="board-items">
                  {col.items.map(card)}
                  {col.items.length === 0 && <div className="board-empty small muted">перетащите заказ сюда</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
