import { useEffect, useState } from 'react';
import { api } from '../api';
import { useApp } from '../store';
import type { Note } from '../types';

export default function Notes() {
  const { version, refresh, toast, openTask, projects } = useApp();
  const [notes, setNotes] = useState<Note[]>([]);
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Note | null>(null);

  useEffect(() => {
    api.get<Note[]>(`/notes${search ? `?search=${encodeURIComponent(search)}` : ''}`).then(setNotes).catch(() => {});
  }, [version, search]);

  async function quickSave() {
    if (!text.trim()) return;
    await api.post('/notes', { content: text.trim() });
    setText(''); refresh();
    toast('Сохранено');
  }

  async function saveEdit() {
    if (!editing) return;
    await api.patch(`/notes/${editing.id}`, {
      title: editing.title, content: editing.content,
      project_id: editing.project_id, pinned: editing.pinned,
    });
    setEditing(null); refresh();
  }

  async function removeNote(n: Note) {
    if (!confirm('Удалить заметку?')) return;
    await api.del(`/notes/${n.id}`);
    setEditing(null); refresh();
  }

  function toTask(n: Note) {
    setEditing(null);
    openTask({ title: n.content.slice(0, 120), description: n.content, project_id: n.project_id ?? undefined });
  }

  return (
    <div>
      <div className="page-title"><h1>Заметки</h1></div>

      <div className="quick-note">
        <input value={text} autoFocus onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && quickSave()}
          placeholder="Быстрая заметка — просто напишите и нажмите Enter…" />
        <button className="btn primary" onClick={quickSave}>+</button>
      </div>

      <input placeholder="Поиск по заметкам…" value={search} onChange={e => setSearch(e.target.value)}
        style={{ width: '100%', padding: '9px 13px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--card)', outline: 'none', marginBottom: 14 }} />

      {notes.length === 0 ? (
        <div className="empty"><div className="big-icon">📝</div>Заметок пока нет</div>
      ) : (
        <div className="note-grid">
          {notes.map(n => (
            <div key={n.id} className="card note-card" onClick={() => setEditing({ ...n })}>
              <div className="flex" style={{ justifyContent: 'space-between' }}>
                {n.title ? <div className="n-title">{n.title}</div> : <span />}
                {n.pinned ? <span>📌</span> : null}
              </div>
              <div className="n-content">{n.content}</div>
              <div className="t-meta mt8">
                {n.project_name && <span className="chip accent">{n.project_name}</span>}
                {n.task_title && <span className="chip">↳ {n.task_title}</span>}
                <span className="muted small">{n.created_at.slice(0, 10)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <div className="overlay" onClick={() => setEditing(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head"><h2>Заметка</h2><button className="x" onClick={() => setEditing(null)}>✕</button></div>
            <div className="field">
              <label>Заголовок</label>
              <input value={editing.title} onChange={e => setEditing({ ...editing, title: e.target.value })} />
            </div>
            <div className="field mt12">
              <label>Текст</label>
              <textarea rows={6} value={editing.content} onChange={e => setEditing({ ...editing, content: e.target.value })} />
            </div>
            <div className="field mt12">
              <label>Проект</label>
              <select value={editing.project_id ?? ''} onChange={e => setEditing({ ...editing, project_id: e.target.value ? Number(e.target.value) : null })}>
                <option value="">—</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <label className="flex mt12 small">
              <input type="checkbox" checked={!!editing.pinned} onChange={e => setEditing({ ...editing, pinned: e.target.checked ? 1 : 0 })} />
              Закрепить
            </label>
            <div className="divider" />
            <div className="flex" style={{ justifyContent: 'space-between' }}>
              <div className="row-actions">
                <button className="btn small" onClick={() => toTask(editing)}>→ В задачу</button>
                <button className="btn small danger" onClick={() => removeNote(editing)}>Удалить</button>
              </div>
              <button className="btn primary" onClick={saveEdit}>Сохранить</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
