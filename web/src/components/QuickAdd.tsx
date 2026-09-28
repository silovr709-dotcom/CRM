import { useState } from 'react';
import { api, todayStr } from '../api';
import { useApp } from '../store';
import type { Task } from '../types';

// Быстрое создание: умная строка, заметка, задача, ассистент, полная форма.
export default function QuickAdd() {
  const { quickOpen, setQuickOpen, openTask, openAi, refresh, toast } = useApp();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  if (!quickOpen) return null;

  // Умная строка: «завтра в 10:00 замер у Петровых» → готовая задача
  async function smart() {
    if (!text.trim()) return;
    setBusy(true);
    try {
      const res = await api.post<{ created: Task[]; summary: string }>('/tasks/smart', { text: text.trim() });
      setText(''); setQuickOpen(false); refresh();
      const ids = res.created.map(t => t.id);
      toast(res.summary, {
        run: async () => {
          for (const id of ids) await api.del(`/tasks/${id}`);
          refresh();
        },
      });
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

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
        <h2 style={{ fontSize: 17, marginBottom: 4 }}>Быстрое добавление</h2>
        <p className="small muted" style={{ marginBottom: 10 }}>
          Напишите как в жизни: «завтра в 10:00 замер у Петровых» — дату и время пойму сам.
        </p>
        <input
          autoFocus
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && text.trim()) smart(); }}
          placeholder="Завтра в 10:00 замер у Петровых…"
          style={{ width: '100%', padding: '12px 14px', border: '1px solid var(--border)', borderRadius: 12, outline: 'none', fontSize: 15 }}
        />
        <button className="btn primary mt12" style={{ width: '100%', justifyContent: 'center' }}
          onClick={smart} disabled={!text.trim() || busy}>
          {busy ? 'Добавляем…' : '⚡ Добавить задачу (Enter)'}
        </button>
        <div className="sheet-options">
          <button className="sheet-opt" onClick={saveNote} disabled={!text.trim()}>
            <span className="icon">📝</span><b>Заметка</b><span>Просто сохранить, без даты и категории</span>
          </button>
          <button className="sheet-opt" onClick={saveTask} disabled={!text.trim()}>
            <span className="icon">☑️</span><b>Во «Входящие»</b><span>Разберёте позже</span>
          </button>
          <button className="sheet-opt" onClick={toAi}>
            <span className="icon">✨</span><b>Ассистент</b><span>Разобрать длинную фразу на несколько дел</span>
          </button>
          <button className="sheet-opt" onClick={() => { setQuickOpen(false); openTask({ date: todayStr() }); }}>
            <span className="icon">⚙️</span><b>Подробно</b><span>Полная карточка задачи</span>
          </button>
        </div>
      </div>
    </div>
  );
}
