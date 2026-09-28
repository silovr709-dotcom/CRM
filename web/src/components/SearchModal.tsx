import { useEffect, useRef, useState } from 'react';
import { api, humanDate } from '../api';
import { typeIcon } from '../meta';
import { useApp, useRoute } from '../store';
import type { SearchResult, Task } from '../types';

// Глобальный поиск: Ctrl+K или «/».
// Регистр русских букв на сервере обрабатывает SQL-функция nlower().
export default function SearchModal() {
  const { searchOpen, setSearchOpen, openTask } = useApp();
  const { nav } = useRoute();
  const [q, setQ] = useState('');
  const [res, setRes] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searchOpen) {
      setQ(''); setRes(null);
      window.setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [searchOpen]);

  useEffect(() => {
    if (!searchOpen) return;
    if (q.trim().length < 2) { setRes(null); return; }
    setLoading(true);
    const id = window.setTimeout(() => {
      api.get<SearchResult>(`/search?q=${encodeURIComponent(q.trim())}`)
        .then(setRes).catch(() => {}).finally(() => setLoading(false));
    }, 220);
    return () => window.clearTimeout(id);
  }, [q, searchOpen]);

  if (!searchOpen) return null;

  const close = () => setSearchOpen(false);
  const goTask = async (id: number) => {
    close();
    const full = await api.get<Task>(`/tasks/${id}`);
    openTask(full);
  };

  const empty = res && !res.tasks.length && !res.projects.length && !res.notes.length && !res.contacts.length;

  return (
    <div className="overlay search-overlay" onClick={close}>
      <div className="search-box card" onClick={e => e.stopPropagation()}>
        <div className="search-input-row">
          <span className="search-ico">🔎</span>
          <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') close(); }}
            placeholder="Поиск по задачам, проектам, заметкам, клиентам…" />
          <button className="btn ghost small" onClick={close}>Esc</button>
        </div>

        {q.trim().length < 2 && (
          <div className="small muted" style={{ padding: '14px 16px' }}>
            Введите минимум 2 символа. Подсказка: поиск открывается по <b>Ctrl + K</b> или клавише <b>/</b>.
          </div>
        )}
        {loading && <div className="small muted" style={{ padding: '10px 16px' }}>Ищем…</div>}
        {empty && <div className="small muted" style={{ padding: '14px 16px' }}>Ничего не нашлось</div>}

        {res && (
          <div className="search-results">
            {res.tasks.length > 0 && <div className="search-group">Задачи</div>}
            {res.tasks.map(t => (
              <button key={`t${t.id}`} className="search-item" onClick={() => goTask(t.id)}>
                <span>{typeIcon(t.type)} {t.title}</span>
                <span className="muted small">{t.date ? humanDate(t.date) : 'без даты'}{t.time ? `, ${t.time}` : ''}</span>
              </button>
            ))}

            {res.projects.length > 0 && <div className="search-group">Проекты</div>}
            {res.projects.map(p => (
              <button key={`p${p.id}`} className="search-item" onClick={() => { close(); nav(`/projects/${p.id}`); }}>
                <span>📁 {p.name}</span>
                <span className="muted small">{p.stage || p.status}</span>
              </button>
            ))}

            {res.contacts.length > 0 && <div className="search-group">Клиенты</div>}
            {res.contacts.map(c => (
              <button key={`c${c.id}`} className="search-item" onClick={() => { close(); nav(`/clients/${c.id}`); }}>
                <span>👤 {c.name}</span>
                <span className="muted small">{c.phone}</span>
              </button>
            ))}

            {res.notes.length > 0 && <div className="search-group">Заметки</div>}
            {res.notes.map(n => (
              <button key={`n${n.id}`} className="search-item" onClick={() => { close(); nav('/notes'); }}>
                <span>📝 {n.title || n.content.slice(0, 60)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
