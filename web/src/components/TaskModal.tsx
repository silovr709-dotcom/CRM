import { useEffect, useState } from 'react';
import { api, humanDate, todayStr } from '../api';
import { TYPE_META, STATUS_META, PRIORITY_META, RECUR_OPTIONS, MODE_META } from '../meta';
import { useApp } from '../store';
import Attachments from './Attachments';
import type { Task, Recurrence } from '../types';

export default function TaskModal() {
  const { editingTask, openTask, refresh, toast, projects, categories, contacts } = useApp();
  const isNew = !editingTask?.id;
  const [t, setT] = useState<Partial<Task>>({});
  const [full, setFull] = useState<Task | null>(null);
  const [subTitle, setSubTitle] = useState('');
  const [remDate, setRemDate] = useState('');
  const [openTasks, setOpenTasks] = useState<Task[]>([]);
  const [depPick, setDepPick] = useState('');

  useEffect(() => {
    if (!editingTask) return;
    setT({ ...editingTask });
    setFull(null);
    if (editingTask.id) {
      api.get<Task>(`/tasks/${editingTask.id}`).then(ft => { setFull(ft); setT({ ...ft }); });
    }
    api.get<Task[]>('/tasks?status=inbox,planned,in_progress&limit=100').then(setOpenTasks).catch(() => {});
  }, [editingTask?.id]);

  if (!editingTask) return null;

  const set = (patch: Partial<Task>) => setT(prev => ({ ...prev, ...patch }));

  async function save() {
    if (!t.title?.trim()) { toast('Введите название'); return; }
    const payload = {
      title: t.title, description: t.description ?? '', type: t.type ?? 'task',
      status: t.status ?? 'planned', priority: t.priority ?? 0,
      schedule_mode: t.schedule_mode ?? 'flexible',
      date: t.date || null, time: t.time || null,
      duration_min: t.duration_min ? Number(t.duration_min) : null,
      deadline: t.deadline || null,
      project_id: t.project_id || null, category_id: t.category_id || null, contact_id: t.contact_id || null,
      location: t.location ?? '', location_from: t.location_from ?? '', location_to: t.location_to ?? '',
      recurrence: t.recurrence ?? null,
    };
    if (isNew) {
      await api.post('/tasks', payload);
      toast('Задача создана');
    } else {
      await api.patch(`/tasks/${t.id}`, payload);
      toast('Сохранено');
    }
    openTask(null);
    refresh();
  }

  async function remove() {
    if (!confirm('Удалить задачу?')) return;
    await api.del(`/tasks/${t.id}`);
    openTask(null); refresh(); toast('Удалено');
  }

  async function quickStatus(status: string) {
    if (status === 'done') await api.post(`/tasks/${t.id}/complete`);
    else await api.post(`/tasks/${t.id}/status`, { status });
    openTask(null); refresh();
    toast(status === 'done' ? 'Выполнено' : status === 'paused' ? 'Поставлено на паузу' : status === 'cancelled' ? 'Отменено' : 'Обновлено');
  }

  async function addSubtask() {
    if (!subTitle.trim() || !t.id) return;
    await api.post('/tasks', { title: subTitle, parent_id: t.id, type: 'task' });
    setSubTitle('');
    const ft = await api.get<Task>(`/tasks/${t.id}`); setFull(ft); refresh();
  }

  async function addReminder() {
    if (!remDate || !t.id) return;
    await api.post('/reminders', { title: t.title, remind_date: remDate, task_id: t.id });
    setRemDate('');
    const ft = await api.get<Task>(`/tasks/${t.id}`); setFull(ft); refresh();
    toast('Напоминание создано');
  }

  async function addDep() {
    if (!depPick || !t.id) return;
    await api.post(`/tasks/${t.id}/dependencies`, { depends_on_id: Number(depPick) });
    setDepPick('');
    const ft = await api.get<Task>(`/tasks/${t.id}`); setFull(ft); refresh();
  }

  async function delDep(depId: number) {
    await api.del(`/tasks/${t.id}/dependencies/${depId}`);
    const ft = await api.get<Task>(`/tasks/${t.id}`); setFull(ft); refresh();
  }

  const recValue = t.recurrence?.freq ?? '';

  return (
    <div className="overlay" onClick={() => openTask(null)}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{isNew ? 'Новая задача' : 'Задача'}</h2>
          <button className="x" onClick={() => openTask(null)}>✕</button>
        </div>

        <div className="form-grid">
          <div className="field full">
            <input
              placeholder="Что нужно сделать?"
              value={t.title ?? ''}
              autoFocus={isNew}
              onChange={e => set({ title: e.target.value })}
              style={{ fontSize: 16, fontWeight: 600 }}
            />
          </div>

          <div className="field">
            <label>Тип</label>
            <select value={t.type ?? 'task'} onChange={e => set({ type: e.target.value })}>
              {Object.entries(TYPE_META).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Статус</label>
            <select value={t.status ?? 'planned'} onChange={e => set({ status: e.target.value as Task['status'] })}>
              {Object.entries(STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>

          <div className="field">
            <label>Дата</label>
            <input type="date" value={t.date ?? ''} onChange={e => set({ date: e.target.value })} />
          </div>
          <div className="field">
            <label>Время</label>
            <input type="time" value={t.time ?? ''} onChange={e => set({ time: e.target.value })} />
          </div>

          <div className="field">
            <label>Длительность, мин</label>
            <input type="number" min={5} step={5} value={t.duration_min ?? ''} placeholder="30"
              onChange={e => set({ duration_min: e.target.value ? Number(e.target.value) : null })} />
          </div>
          <div className="field">
            <label>Дедлайн</label>
            <input type="date" value={t.deadline ?? ''} onChange={e => set({ deadline: e.target.value })} />
          </div>

          <div className="field">
            <label>Приоритет</label>
            <select value={t.priority ?? 0} onChange={e => set({ priority: Number(e.target.value) })}>
              {PRIORITY_META.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Гибкость</label>
            <select value={t.schedule_mode ?? 'flexible'} onChange={e => set({ schedule_mode: e.target.value as Task['schedule_mode'] })}>
              {Object.entries(MODE_META).map(([k, v]) => <option key={k} value={k}>{v.label} — {v.hint}</option>)}
            </select>
          </div>

          <div className="field">
            <label>Проект</label>
            <select value={t.project_id ?? ''} onChange={e => set({ project_id: e.target.value ? Number(e.target.value) : null })}>
              <option value="">—</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Категория</label>
            <select value={t.category_id ?? ''} onChange={e => set({ category_id: e.target.value ? Number(e.target.value) : null })}>
              <option value="">—</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
            </select>
          </div>

          <div className="field">
            <label>Контакт</label>
            <select value={t.contact_id ?? ''} onChange={e => set({ contact_id: e.target.value ? Number(e.target.value) : null })}>
              <option value="">—</option>
              {contacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Повторение</label>
            <select value={recValue} onChange={e => set({ recurrence: e.target.value ? { freq: e.target.value } as Recurrence : null })}>
              {RECUR_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          {(t.type === 'trip' || t.type === 'delivery') ? (
            <>
              <div className="field">
                <label>Откуда</label>
                <input value={t.location_from ?? ''} onChange={e => set({ location_from: e.target.value })} placeholder="Склад" />
              </div>
              <div className="field">
                <label>Куда</label>
                <input value={t.location_to ?? ''} onChange={e => set({ location_to: e.target.value })} placeholder="Объект" />
              </div>
            </>
          ) : (
            <div className="field full">
              <label>Место</label>
              <input value={t.location ?? ''} onChange={e => set({ location: e.target.value })} placeholder="Адрес или место" />
            </div>
          )}

          <div className="field full">
            <label>Заметки</label>
            <textarea value={t.description ?? ''} onChange={e => set({ description: e.target.value })} />
          </div>
        </div>

        {!isNew && full && (
          <>
            <div className="divider" />
            <div className="field">
              <label>Зависимости — выполнять после:</label>
              {full.dependencies?.length ? full.dependencies.map(d => (
                <div key={d.depends_on_id} className="flex small mt8" style={{ justifyContent: 'space-between' }}>
                  <span>{d.dep_status === 'done' ? '✅' : '⏳'} {d.dep_title}</span>
                  <button className="btn small ghost danger" onClick={() => delDep(d.depends_on_id)}>убрать</button>
                </div>
              )) : <div className="small muted mt8">нет</div>}
              <div className="flex mt8">
                <select value={depPick} onChange={e => setDepPick(e.target.value)} style={{ flex: 1, padding: 8, borderRadius: 10, border: '1px solid var(--border)' }}>
                  <option value="">+ добавить зависимость…</option>
                  {openTasks.filter(o => o.id !== t.id).map(o => <option key={o.id} value={o.id}>{o.title}{o.date ? ` (${humanDate(o.date)})` : ''}</option>)}
                </select>
                {depPick && <button className="btn small" onClick={addDep}>Добавить</button>}
              </div>
            </div>

            <div className="field mt12">
              <label>Подзадачи</label>
              {full.subtasks?.map(st => (
                <div key={st.id} className="flex small mt8">
                  <span
                    className={`task-check${st.status === 'done' ? ' checked' : ''}`}
                    style={{ width: 17, height: 17, fontSize: 10 }}
                    onClick={async () => {
                      if (st.status === 'done') await api.post(`/tasks/${st.id}/status`, { status: 'planned' });
                      else await api.post(`/tasks/${st.id}/complete`);
                      const ft = await api.get<Task>(`/tasks/${t.id}`); setFull(ft); refresh();
                    }}
                  >{st.status === 'done' ? '✓' : ''}</span>
                  <span style={{ textDecoration: st.status === 'done' ? 'line-through' : 'none' }}>{st.title}</span>
                </div>
              ))}
              <div className="flex mt8">
                <input value={subTitle} onChange={e => setSubTitle(e.target.value)} placeholder="+ подзадача"
                  onKeyDown={e => e.key === 'Enter' && addSubtask()}
                  style={{ flex: 1, padding: 8, borderRadius: 10, border: '1px solid var(--border)' }} />
                {subTitle && <button className="btn small" onClick={addSubtask}>OK</button>}
              </div>
            </div>

            <div className="field mt12">
              <label>Напоминания</label>
              {full.reminders?.map(r => (
                <div key={r.id} className="small mt8">⏰ {humanDate(r.remind_date)}{r.remind_time ? ` в ${r.remind_time}` : ''} {r.status !== 'pending' && '(закрыто)'}</div>
              ))}
              <div className="flex mt8">
                <input type="date" value={remDate} min={todayStr()} onChange={e => setRemDate(e.target.value)}
                  style={{ padding: 8, borderRadius: 10, border: '1px solid var(--border)' }} />
                {remDate && <button className="btn small" onClick={addReminder}>Напомнить</button>}
              </div>
            </div>

            <div className="mt12">
              <Attachments taskId={t.id as number} />
            </div>

            {t.postponed_count ? <div className="small muted mt12">Переносилась: {t.postponed_count} раз</div> : null}
          </>
        )}

        <div className="divider" />
        <div className="flex wrap" style={{ justifyContent: 'space-between' }}>
          <div className="row-actions">
            {!isNew && t.status !== 'done' && <button className="btn small" onClick={() => quickStatus('done')}>✓ Выполнить</button>}
            {!isNew && t.status !== 'paused' && t.status !== 'done' && <button className="btn small" onClick={() => quickStatus('paused')}>⏸ Пауза</button>}
            {!isNew && <button className="btn small danger" onClick={remove}>Удалить</button>}
          </div>
          <div className="row-actions">
            <button className="btn ghost" onClick={() => openTask(null)}>Отмена</button>
            <button className="btn primary" onClick={save}>{isNew ? 'Создать' : 'Сохранить'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
