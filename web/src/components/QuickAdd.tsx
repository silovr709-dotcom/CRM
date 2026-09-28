import { useState } from 'react';
import { api, todayStr } from '../api';
import { useApp } from '../store';

// Быстрое создание: заметка мгновенно, задача, AI-ввод, полная форма.
export default function QuickAdd() {
  const { quickOpen, setQuickOpen, openTask, openAi, refresh, toast } = useApp();
  const [text, setText] = useState('');

  if (!quickOpen) return null;

  async function saveNote() {
    if (!text.trim()) return;
    await api.post('/notes', { content: text.trim() });
    setText(''); setQuickOpen(false); refresh();
    toast('Заметка сохранена. Позже можно превратить её в задачу.');
  }

  async function saveTask() {
    if (!text.trim()) return;
    await api.post('/tasks', { title: text.trim(), status: 'inbox' });
    setText(''); setQuickOpen(false); refresh();
    toast('Задача добавлена во «Входящие»');
  }

  function toAi() {
    const t = text; setText(''); setQuickOpen(false);
    openAi(t);
  }

  return (
    <div className="overlay" onClick={() => setQuickOpen(false)}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <h2 style={{ fontSize: 17, marginBottom: 10 }}>Быстрое добавление</h2>
        <input
          autoFocus
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && text.trim()) saveNote(); }}
          placeholder="Запишите мысль, дело или фразу…"
          style={{ width: '100%', padding: '12px 14px', border: '1px solid var(--border)', borderRadius: 12, outline: 'none', fontSize: 15 }}
        />
        <div className="sheet-options">
          <button className="sheet-opt" onClick={saveNote} disabled={!text.trim()}>
            <span className="icon">📝</span><b>Заметка</b><span>Просто сохранить, без даты и категории</span>
          </button>
          <button className="sheet-opt" onClick={saveTask} disabled={!text.trim()}>
            <span className="icon">☑️</span><b>Задача</b><span>Во «Входящие», разберёте позже</span>
          </button>
          <button className="sheet-opt" onClick={toAi}>
            <span className="icon">✨</span><b>AI-разбор</b><span>Разобрать фразу на план из задач</span>
          </button>
          <button className="sheet-opt" onClick={() => { setQuickOpen(false); openTask({ date: todayStr() }); }}>
            <span className="icon">⚙️</span><b>Подробно</b><span>Полная карточка задачи</span>
          </button>
        </div>
      </div>
    </div>
  );
}
