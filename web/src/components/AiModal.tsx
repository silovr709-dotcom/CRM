import { useEffect, useRef, useState } from 'react';
import { api, humanDate, humanDuration } from '../api';
import { typeIcon } from '../meta';
import { useApp } from '../store';
import type { AiResponse, PlanItem } from '../types';

interface Msg {
  role: 'user' | 'bot';
  text: string;
  payload?: AiResponse;
  resolved?: string; // текст результата после подтверждения
  chosenTask?: number;
}

const SUGGESTIONS = [
  'Что у меня сегодня?',
  'Что я забыл?',
  'Что просрочено?',
  'Распланируй мой день',
  'Что мне нужно купить?',
  'Когда у меня есть три свободных часа?',
];

export default function AiModal() {
  const { aiOpen, aiPrefill, closeAi, refresh, toast } = useApp();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const recRef = useRef<{ stop: () => void } | null>(null);

  const speechSupported = typeof window !== 'undefined' &&
    Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  function toggleVoice() {
    if (listening) { recRef.current?.stop(); return; }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.lang = 'ru-RU';
    rec.interimResults = true;
    rec.continuous = false;
    let final = '';
    rec.onresult = (e: any) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) final += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }
      setInput(final + interim);
    };
    rec.onend = () => {
      setListening(false);
      recRef.current = null;
      if (final.trim()) send(final.trim());
    };
    rec.onerror = () => { setListening(false); recRef.current = null; };
    recRef.current = rec;
    setListening(true);
    rec.start();
  }

  useEffect(() => {
    if (aiOpen) {
      if (!msgs.length) {
        setMsgs([{ role: 'bot', text: 'Опишите обычным языком, что нужно сделать — я разберу это на задачи и предложу план. Или задайте вопрос о ваших делах.' }]);
      }
      if (aiPrefill) {
        // фраза передана извне (быстрое добавление / кнопки «Сегодня») — отправляем сразу
        void send(aiPrefill);
      }
    }
  }, [aiOpen]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs]);

  if (!aiOpen) return null;

  async function send(text?: string) {
    const message = (text ?? input).trim();
    if (!message || busy) return;
    setInput('');
    setBusy(true);
    setMsgs(m => [...m, { role: 'user', text: message }]);
    try {
      const res = await api.post<AiResponse>('/assistant', { message });
      const text2 = res.kind === 'plan' ? (res.summary ?? '')
        : res.kind === 'plan_day' ? (res.summary ?? '')
        : res.kind === 'unload' ? (res.summary ?? '')
        : res.kind === 'command' ? (res.text ?? '')
        : (res.text ?? '');
      setMsgs(m => [...m, { role: 'bot', text: text2, payload: res }]);
    } catch {
      setMsgs(m => [...m, { role: 'bot', text: 'Что-то пошло не так. Попробуйте ещё раз.' }]);
    } finally {
      setBusy(false);
    }
  }

  function updateItem(mi: number, ii: number, patch: Partial<PlanItem>) {
    setMsgs(m => m.map((msg, i) => {
      if (i !== mi || !msg.payload?.items) return msg;
      const items = msg.payload.items.map((it, j) => j === ii ? { ...it, ...patch } : it);
      return { ...msg, payload: { ...msg.payload, items } };
    }));
  }

  async function confirmPlan(mi: number) {
    const msg = msgs[mi];
    if (!msg.payload?.items) return;
    const res = await api.post<{ created: { id: number; title: string }[] }>('/assistant/confirm', { items: msg.payload.items });
    setMsgs(m => m.map((x, i) => i === mi ? { ...x, resolved: `✅ Создано задач: ${res.created.length}` } : x));
    refresh();
    toast(`План создан: ${res.created.length} задач(и)`);
  }

  async function executeCommand(mi: number) {
    const msg = msgs[mi];
    if (!msg.payload) return;
    const p = msg.payload;
    const res = await api.post<{ ok: boolean; text: string }>('/assistant/execute', {
      ...p, task_id: msg.chosenTask ?? p.candidates?.[0]?.id,
    });
    setMsgs(m => m.map((x, i) => i === mi ? { ...x, resolved: (res.ok ? '✅ ' : '⚠️ ') + res.text } : x));
    refresh();
  }

  async function applyDayPlan(mi: number) {
    const msg = msgs[mi];
    if (!msg.payload?.placed) return;
    await api.post('/planner/apply-plan', { placed: msg.payload.placed });
    setMsgs(m => m.map((x, i) => i === mi ? { ...x, resolved: `✅ План применён: ${msg.payload!.placed!.length} задач(и) расставлены по времени` } : x));
    refresh();
    toast('День распланирован');
  }

  async function applyUnloadMove(mi: number, taskId: number, toDate: string) {
    await api.patch(`/tasks/${taskId}`, { date: toDate, time: null });
    refresh();
    toast('Перенесено');
    setMsgs(m => m.map((x, i) => i === mi ? { ...x, resolved: (x.resolved ?? '') + ' ✅' } : x));
  }

  function reject(mi: number) {
    setMsgs(m => m.map((x, i) => i === mi ? { ...x, resolved: 'Отклонено — ничего не меняю.' } : x));
  }

  return (
    <div className="overlay" onClick={closeAi}>
      <div className="modal ai-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h2>✨ Ассистент</h2>
          <button className="x" onClick={closeAi}>✕</button>
        </div>

        <div className="ai-messages">
          {msgs.map((m, mi) => (
            <div key={mi} style={{ display: 'contents' }}>
              <div className={`msg ${m.role}`} style={{ whiteSpace: 'pre-wrap' }}>
                {m.role === 'bot' && (m.payload as any)?.source === 'llm' && (
                  <span className="small muted" style={{ display: 'block', marginBottom: 2 }}>🧠 ChatGPT</span>
                )}
                {m.text}
              </div>

              {/* План из фразы */}
              {m.role === 'bot' && m.payload?.kind === 'plan' && m.payload.items && !m.resolved && (
                <div className="plan-card">
                  {(m.payload.assumptions ?? []).map((a, i) => <div key={i} className="plan-item small muted">💡 {a}</div>)}
                  {(m.payload.questions ?? []).map((q, i) => <div key={i} className="plan-item small" style={{ color: 'var(--amber)' }}>❓ {q}</div>)}
                  {m.payload.items.map((it, ii) => (
                    <div key={ii} className={`plan-item${it.skip ? ' off' : ''}`}>
                      <input type="checkbox" checked={!it.skip} onChange={e => updateItem(mi, ii, { skip: !e.target.checked })} />
                      <span className="pi-time">{it.time ?? '—'}</span>
                      <span>{typeIcon(it.type)}</span>
                      <span style={{ flex: 1 }}>
                        {it.title}
                        <div className="pi-dep">
                          {humanDate(it.date)} · {humanDuration(it.duration_min)}
                          {it.depends_on_prev ? ' · после предыдущей' : ''}
                          {it.is_reminder ? ' · с напоминанием' : ''}
                          {it.recurrence ? ' · 🔁' : ''}
                        </div>
                      </span>
                      <input
                        type="time" value={it.time ?? ''}
                        onChange={e => updateItem(mi, ii, { time: e.target.value || null })}
                        style={{ width: 78, padding: '3px 6px', border: '1px solid var(--border)', borderRadius: 7, fontSize: 12 }}
                      />
                    </div>
                  ))}
                  <div className="plan-actions">
                    <button className="btn primary small" onClick={() => confirmPlan(mi)}>✓ Создать план</button>
                    <button className="btn small ghost" onClick={() => reject(mi)}>Отмена</button>
                  </div>
                </div>
              )}

              {/* Команда */}
              {m.role === 'bot' && m.payload?.kind === 'command' && !m.resolved && !['plan_day', 'unload_day'].includes(m.payload.command ?? '') && (
                <div className="plan-card">
                  {(m.payload.candidates?.length ?? 0) > 1 && (
                    <div className="plan-item" style={{ display: 'block' }}>
                      <div className="small muted">Нашёл несколько задач — выберите:</div>
                      {m.payload.candidates!.map(c => (
                        <label key={c.id} className="flex small mt8">
                          <input type="radio" name={`cand-${mi}`}
                            checked={(m.chosenTask ?? m.payload!.candidates![0].id) === c.id}
                            onChange={() => setMsgs(ms => ms.map((x, i) => i === mi ? { ...x, chosenTask: c.id } : x))} />
                          {c.title} {c.date && <span className="muted">({humanDate(c.date)})</span>}
                        </label>
                      ))}
                    </div>
                  )}
                  {m.payload.candidates?.length === 0 && !m.payload.need_task && m.payload.command !== 'remind' && (
                    <div className="plan-item small muted">Не нашёл подходящую задачу.</div>
                  )}
                  <div className="plan-actions">
                    <button className="btn primary small" onClick={() => executeCommand(mi)}
                      disabled={m.payload.command !== 'remind' && !m.payload.candidates?.length}>✓ Подтвердить</button>
                    <button className="btn small ghost" onClick={() => reject(mi)}>Отмена</button>
                  </div>
                </div>
              )}

              {/* Распланировать день */}
              {m.role === 'bot' && m.payload?.kind === 'plan_day' && !m.resolved && (
                <div className="plan-card">
                  {(m.payload.fixed ?? []).map(f => (
                    <div key={`f${f.id}`} className="plan-item">
                      <span className="pi-time">{f.time}</span><span>📌</span>
                      <span style={{ flex: 1 }}>{f.title}<div className="pi-dep">жёсткая · {humanDuration(f.duration_min)}</div></span>
                    </div>
                  ))}
                  {(m.payload.placed ?? []).map((p, i) => (
                    <div key={i} className="plan-item">
                      <span className="pi-time">{p.time}</span><span>{typeIcon(p.type)}</span>
                      <span style={{ flex: 1 }}>{p.title}
                        <div className="pi-dep">{humanDuration(p.duration_min)}{p.overdue ? ' · была просрочена' : ''}</div>
                      </span>
                    </div>
                  ))}
                  {(m.payload.unplaced?.length ?? 0) > 0 && (
                    <div className="plan-item small muted">Не поместилось: {m.payload.unplaced!.map(u => u.title).join(', ')}</div>
                  )}
                  {(m.payload.placed?.length ?? 0) > 0 ? (
                    <div className="plan-actions">
                      <button className="btn primary small" onClick={() => applyDayPlan(mi)}>✓ Применить план</button>
                      <button className="btn small ghost" onClick={() => reject(mi)}>Отмена</button>
                    </div>
                  ) : null}
                </div>
              )}

              {/* Разгрузить день */}
              {m.role === 'bot' && m.payload?.kind === 'unload' && !m.resolved && (m.payload.suggestions?.length ?? 0) > 0 && (
                <div className="plan-card">
                  {m.payload.suggestions!.map((sg, i) => (
                    <div key={i} className="plan-item">
                      <span style={{ flex: 1 }}>{sg.title}<div className="pi-dep">{sg.reason}</div></span>
                      {sg.action === 'move' && sg.task_id && sg.to_date && (
                        <button className="btn small" onClick={() => applyUnloadMove(mi, sg.task_id!, sg.to_date!)}>→ {humanDate(sg.to_date)}</button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {m.resolved && <div className="msg bot" style={{ background: 'var(--green-soft)', color: 'var(--green)' }}>{m.resolved}</div>}
            </div>
          ))}
          {busy && <div className="msg bot muted">…</div>}
          <div ref={bottomRef} />
        </div>

        <div className="ai-suggest">
          {SUGGESTIONS.map(s => <button key={s} onClick={() => send(s)}>{s}</button>)}
        </div>
        <div className="ai-input">
          <input
            value={input}
            placeholder={listening ? '🎙 Говорите…' : 'Что нужно сделать?'}
            autoFocus
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && send()}
          />
          {speechSupported && (
            <button className={`btn${listening ? ' ai' : ''}`} onClick={toggleVoice} title="Голосовой ввод">
              {listening ? '⏹' : '🎙'}
            </button>
          )}
          <button className="btn ai" onClick={() => send()}>➤</button>
        </div>
      </div>
    </div>
  );
}
