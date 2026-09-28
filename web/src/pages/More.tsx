import { useEffect, useState } from 'react';
import { api, humanDate, humanDuration, todayStr } from '../api';
import { typeIcon, typeLabel, TYPE_META } from '../meta';
import { useApp, useRoute } from '../store';
import type { Template, Automation, Contact, Category, Activity } from '../types';

const SECTIONS = [
  { id: 'analytics', icon: '📊', label: 'Аналитика', desc: 'Продуктивность, распределение дел, хронические переносы' },
  { id: 'templates', icon: '🧩', label: 'Шаблоны', desc: 'Готовые цепочки задач: доставка, монтаж, новый клиент' },
  { id: 'automations', icon: '⚡', label: 'Автоматизации', desc: 'КОГДА событие → ТОГДА действие' },
  { id: 'contacts', icon: '👥', label: 'Контакты', desc: 'Клиенты, поставщики, люди' },
  { id: 'categories', icon: '🏷', label: 'Категории', desc: 'Работа, личное и свои собственные' },
  { id: 'history', icon: '🕓', label: 'История', desc: 'Все изменения: создано, перенесено, выполнено' },
  { id: 'settings', icon: '⚙️', label: 'Настройки', desc: 'Рабочие часы, планирование, интеграции' },
];

const ACTIONS: Record<string, string> = {
  created: 'создано', updated: 'изменено', rescheduled: 'перенесено', completed: 'выполнено',
  cancelled: 'отменено', paused: 'пауза', resumed: 'возобновлено', deleted: 'удалено',
  reopened: 'открыто заново', started: 'в работе', fired: 'автоматизация', instantiated: 'из шаблона',
  plan_applied: 'план применён',
};

export default function More({ section }: { section?: string }) {
  const { nav } = useRoute();
  const { theme, toggleTheme } = useApp();

  if (!section) {
    return (
      <div>
        <div className="page-title">
          <h1>Ещё</h1>
          <button className="btn small" onClick={toggleTheme}>{theme === 'dark' ? '🌞 Светлая' : '🌙 Тёмная'}</button>
        </div>
        <div className="proj-grid">
          <div className="card proj-card" onClick={() => nav('/notes')}>
            <h3>📝 Заметки</h3>
            <div className="small muted">Быстрые и привязанные к проектам заметки</div>
          </div>
          {SECTIONS.map(s => (
            <div key={s.id} className="card proj-card" onClick={() => nav(`/more/${s.id}`)}>
              <h3>{s.icon} {s.label}</h3>
              <div className="small muted">{s.desc}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <button className="btn ghost small" onClick={() => nav('/more')}>← Ещё</button>
      <div className="mt12">
        {section === 'analytics' && <Analytics />}
        {section === 'templates' && <Templates />}
        {section === 'automations' && <Automations />}
        {section === 'contacts' && <Contacts />}
        {section === 'categories' && <Categories />}
        {section === 'history' && <History />}
        {section === 'settings' && <Settings />}
      </div>
    </div>
  );
}

interface Stats {
  days: { date: string; done: number }[];
  week_done: number; week_created: number; open_total: number; overdue: number; total_postpones: number;
  by_type: { type: string; c: number }[];
  by_category: { name: string; icon: string; c: number }[];
  chronic: { id: number; title: string; postponed_count: number }[];
  projects: { id: number; name: string; total: number; done: number; progress: number }[];
}

function Analytics() {
  const { version } = useApp();
  const [s, setS] = useState<Stats | null>(null);
  useEffect(() => { api.get<Stats>('/planner/stats').then(setS).catch(() => {}); }, [version]);
  if (!s) return <div className="empty">Загрузка…</div>;

  const max = Math.max(1, ...s.days.map(d => d.done));
  const maxCat = Math.max(1, ...s.by_category.map(c => c.c));

  return (
    <div>
      <div className="page-title"><h1>📊 Аналитика</h1></div>

      <div className="ana-grid">
        <div className="card ana-stat"><div className="num">{s.week_done}</div><div className="lbl">выполнено за 7 дней</div></div>
        <div className="card ana-stat"><div className="num">{s.week_created}</div><div className="lbl">создано за 7 дней</div></div>
        <div className="card ana-stat"><div className="num">{s.open_total}</div><div className="lbl">открытых задач</div></div>
        <div className="card ana-stat"><div className="num" style={s.overdue ? { color: 'var(--red)' } : {}}>{s.overdue}</div><div className="lbl">просрочено</div></div>
      </div>

      <div className="section">
        <div className="section-head"><h3>Выполнено по дням · 14 дней</h3></div>
        <div className="card ana-bars">
          {s.days.map(d => (
            <div key={d.date} className="ana-bar">
              {d.done > 0 && <span className="bv">{d.done}</span>}
              <div className="bar" style={{ height: `${Math.max(3, (d.done / max) * 82)}%` }} />
              <span className="bl">{d.date.slice(8)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="section">
        <div className="section-head"><h3>Открытые задачи по категориям</h3></div>
        <div className="card" style={{ padding: '8px 18px' }}>
          {s.by_category.map(c => (
            <div key={c.name} className="ana-row">
              <span style={{ width: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.icon} {c.name}</span>
              <div className="track2"><div style={{ width: `${(c.c / maxCat) * 100}%` }} /></div>
              <b style={{ width: 26, textAlign: 'right' }}>{c.c}</b>
            </div>
          ))}
          {s.by_category.length === 0 && <div className="empty">Нет данных</div>}
        </div>
      </div>

      <div className="section">
        <div className="section-head"><h3>Типы открытых задач</h3></div>
        <div className="flex wrap">
          {s.by_type.map(x => <span key={x.type} className="chip accent">{typeIcon(x.type)} {typeLabel(x.type)} · {x.c}</span>)}
        </div>
      </div>

      {s.chronic.length > 0 && (
        <div className="section">
          <div className="section-head"><h3>Постоянно переносятся</h3></div>
          <div className="card" style={{ padding: '8px 18px' }}>
            {s.chronic.map(c => (
              <div key={c.id} className="ana-row">
                <span style={{ flex: 1 }}>{c.title}</span>
                <span className="chip red">{c.postponed_count} переносов</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {s.projects.length > 0 && (
        <div className="section">
          <div className="section-head"><h3>Активные проекты</h3></div>
          <div className="card" style={{ padding: '8px 18px' }}>
            {s.projects.map(p => (
              <div key={p.id} className="ana-row">
                <span style={{ width: 170, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                <div className="track2"><div style={{ width: `${p.progress}%` }} /></div>
                <b style={{ width: 42, textAlign: 'right' }}>{p.progress}%</b>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="small muted">Здесь видно, «какие дела я постоянно переношу» — тот же вопрос можно задать ассистенту.</p>
    </div>
  );
}

function Templates() {
  const { version, refresh, toast } = useApp();
  const [list, setList] = useState<Template[]>([]);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => { api.get<Template[]>('/templates').then(setList).catch(() => {}); }, [version]);

  async function instantiate(t: Template) {
    const ctx = prompt(`Создать цепочку «${t.name}» (${t.steps.length} задач).\nКонтекст (например, имя клиента) — можно оставить пустым:`) ?? undefined;
    const res = await api.post<{ created: unknown[] }>(`/templates/${t.id}/instantiate`, { start_date: todayStr(), context_title: ctx || undefined });
    toast(`Создано задач: ${res.created.length}`);
    refresh();
  }

  return (
    <div>
      <div className="page-title"><h1>🧩 Шаблоны</h1></div>
      <p className="small muted" style={{ marginTop: -10 }}>Шаблон генерирует цепочку связанных задач со смещениями по дням и зависимостями.</p>
      {list.map(t => (
        <div key={t.id} className="card" style={{ padding: 16, marginBottom: 10 }}>
          <div className="flex" style={{ justifyContent: 'space-between' }}>
            <div>
              <b>{t.name}</b> <span className="small muted">· {t.steps.length} шагов</span>
              <div className="small muted">{t.description}</div>
            </div>
            <div className="row-actions">
              <button className="btn small ghost" onClick={() => setOpen(open === t.id ? null : t.id)}>{open === t.id ? 'Скрыть' : 'Шаги'}</button>
              <button className="btn small primary" onClick={() => instantiate(t)}>Запустить</button>
            </div>
          </div>
          {open === t.id && (
            <div className="mt12">
              {t.steps.map((s, i) => (
                <div key={s.id} className="small" style={{ padding: '5px 0', borderBottom: '1px solid var(--border)' }}>
                  {i + 1}. {typeIcon(s.type)} {s.title}
                  <span className="muted"> · {s.offset_days === 0 ? 'в день старта' : `+${s.offset_days} ${s.workdays ? 'раб. ' : ''}дн.`}
                    {s.duration_min ? ` · ${humanDuration(s.duration_min)}` : ''}{s.depends_prev ? ' · после предыдущего' : ''}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Automations() {
  const { version, refresh, toast } = useApp();
  const [list, setList] = useState<Automation[]>([]);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', title_contains: '', task_type: '', action_title: '', offset_days: 1, workdays: true });

  useEffect(() => { api.get<Automation[]>('/automations').then(setList).catch(() => {}); }, [version]);

  async function create() {
    if (!form.name || !form.action_title) { toast('Заполните название и действие'); return; }
    await api.post('/automations', {
      name: form.name,
      trigger_type: 'task_completed',
      conditions: {
        ...(form.title_contains ? { title_contains: form.title_contains } : {}),
        ...(form.task_type ? { task_type: form.task_type } : {}),
      },
      action_type: 'create_task',
      action_params: { title: form.action_title, offset_days: Number(form.offset_days), workdays: form.workdays ? 1 : 0 },
    });
    setCreating(false); setForm({ name: '', title_contains: '', task_type: '', action_title: '', offset_days: 1, workdays: true });
    refresh(); toast('Автоматизация создана');
  }

  return (
    <div>
      <div className="page-title">
        <h1>⚡ Автоматизации</h1>
        <button className="btn primary small" onClick={() => setCreating(!creating)}>+ Правило</button>
      </div>
      <p className="small muted" style={{ marginTop: -10 }}>КОГДА задача завершена и подходит под условия → ТОГДА создать следующую задачу через N (рабочих) дней.</p>

      {creating && (
        <div className="card" style={{ padding: 16, marginBottom: 14 }}>
          <div className="form-grid">
            <div className="field full"><label>Название правила</label>
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Контроль производства" /></div>
            <div className="field"><label>КОГДА: заголовок содержит</label>
              <input value={form.title_contains} onChange={e => setForm({ ...form, title_contains: e.target.value })} placeholder="на производство" /></div>
            <div className="field"><label>И тип задачи (необязательно)</label>
              <select value={form.task_type} onChange={e => setForm({ ...form, task_type: e.target.value })}>
                <option value="">любой</option>
                {Object.entries(TYPE_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select></div>
            <div className="field full"><label>ТОГДА: создать задачу</label>
              <input value={form.action_title} onChange={e => setForm({ ...form, action_title: e.target.value })} placeholder="Проверить статус" /></div>
            <div className="field"><label>Через дней</label>
              <input type="number" min={0} value={form.offset_days} onChange={e => setForm({ ...form, offset_days: Number(e.target.value) })} /></div>
            <div className="field"><label>Считать</label>
              <select value={form.workdays ? '1' : '0'} onChange={e => setForm({ ...form, workdays: e.target.value === '1' })}>
                <option value="1">рабочие дни</option>
                <option value="0">календарные дни</option>
              </select></div>
          </div>
          <button className="btn primary mt12" onClick={create}>Создать правило</button>
        </div>
      )}

      {list.map(a => (
        <div key={a.id} className="card" style={{ padding: 14, marginBottom: 10 }}>
          <div className="flex" style={{ justifyContent: 'space-between' }}>
            <b>{a.name}</b>
            <div className="row-actions">
              <button className="btn small" onClick={async () => { await api.patch(`/automations/${a.id}`, { enabled: a.enabled ? 0 : 1 }); refresh(); }}>
                {a.enabled ? '✅ Вкл' : '⬜ Выкл'}
              </button>
              <button className="btn small ghost danger" onClick={async () => { if (confirm('Удалить?')) { await api.del(`/automations/${a.id}`); refresh(); } }}>✕</button>
            </div>
          </div>
          <div className="small muted mt8">
            КОГДА: задача завершена
            {a.conditions.title_contains ? ` · заголовок содержит «${a.conditions.title_contains}»` : ''}
            {a.conditions.task_type ? ` · тип «${typeLabel(a.conditions.task_type)}»` : ''}
            <br />ТОГДА: создать «{a.action_params.title}» через {a.action_params.offset_days ?? 0} {a.action_params.workdays ? 'раб. ' : ''}дн.
          </div>
        </div>
      ))}
    </div>
  );
}

function Contacts() {
  const { version, refresh, toast } = useApp();
  const [list, setList] = useState<Contact[]>([]);
  const [form, setForm] = useState<Partial<Contact> | null>(null);

  useEffect(() => { api.get<Contact[]>('/contacts').then(setList).catch(() => {}); }, [version]);

  async function save() {
    if (!form?.name?.trim()) return;
    if (form.id) await api.patch(`/contacts/${form.id}`, form);
    else await api.post('/contacts', form);
    setForm(null); refresh(); toast('Сохранено');
  }

  return (
    <div>
      <div className="page-title">
        <h1>👥 Контакты</h1>
        <button className="btn primary small" onClick={() => setForm({})}>+ Контакт</button>
      </div>
      {list.length === 0 && <div className="empty">Контактов пока нет</div>}
      {list.map(c => (
        <div key={c.id} className="card" style={{ padding: 14, marginBottom: 8, cursor: 'pointer' }} onClick={() => setForm({ ...c })}>
          <b>{c.name}</b>
          <div className="small muted">{[c.phone, c.email, c.address].filter(Boolean).join(' · ')}</div>
          {c.notes && <div className="small mt8">{c.notes}</div>}
        </div>
      ))}
      {form && (
        <div className="overlay" onClick={() => setForm(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head"><h2>{form.id ? 'Контакт' : 'Новый контакт'}</h2><button className="x" onClick={() => setForm(null)}>✕</button></div>
            <div className="form-grid">
              <div className="field full"><label>Имя</label><input value={form.name ?? ''} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
              <div className="field"><label>Телефон</label><input value={form.phone ?? ''} onChange={e => setForm({ ...form, phone: e.target.value })} /></div>
              <div className="field"><label>Email</label><input value={form.email ?? ''} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
              <div className="field full"><label>Адрес</label><input value={form.address ?? ''} onChange={e => setForm({ ...form, address: e.target.value })} /></div>
              <div className="field full"><label>Заметки</label><textarea value={form.notes ?? ''} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
            </div>
            <div className="flex mt16" style={{ justifyContent: 'flex-end' }}>
              {form.id && <button className="btn ghost danger" onClick={async () => { await api.del(`/contacts/${form.id}`); setForm(null); refresh(); }}>Удалить</button>}
              <button className="btn primary" onClick={save}>Сохранить</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Categories() {
  const { version, refresh, categories } = useApp();
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('🏷');

  async function create() {
    if (!name.trim()) return;
    await api.post('/categories', { name: name.trim(), icon });
    setName(''); refresh();
  }

  return (
    <div>
      <div className="page-title"><h1>🏷 Категории</h1></div>
      <p className="small muted" style={{ marginTop: -10 }}>Категории позволяют держать рабочие и личные дела в одном календаре, не смешивая их.</p>
      <div className="flex" style={{ marginBottom: 14 }}>
        <input value={icon} onChange={e => setIcon(e.target.value)} style={{ width: 52, padding: '9px', border: '1px solid var(--border)', borderRadius: 10, textAlign: 'center' }} />
        <input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && create()} placeholder="Своя категория…"
          style={{ flex: 1, padding: '9px 13px', border: '1px solid var(--border)', borderRadius: 10, outline: 'none' }} />
        <button className="btn primary" onClick={create}>+</button>
      </div>
      {categories.map(c => (
        <div key={c.id} className="card flex" style={{ padding: '11px 14px', marginBottom: 6, justifyContent: 'space-between' }}>
          <span>{c.icon} <b>{c.name}</b> {c.builtin ? <span className="small muted">· встроенная</span> : null}</span>
          {!c.builtin && <button className="btn small ghost danger" onClick={async () => { await api.del(`/categories/${c.id}`); refresh(); }}>✕</button>}
        </div>
      ))}
    </div>
  );
}

function History() {
  const { version } = useApp();
  const [list, setList] = useState<Activity[]>([]);
  useEffect(() => { api.get<Activity[]>('/activity?limit=200').then(setList).catch(() => {}); }, [version]);

  const TYPE_LABEL: Record<string, string> = { task: 'задача', project: 'проект', note: 'заметка', reminder: 'напоминание', automation: 'правило', template: 'шаблон', contact: 'контакт', assistant: 'AI' };

  return (
    <div>
      <div className="page-title"><h1>🕓 История</h1></div>
      <div className="card" style={{ padding: '4px 16px' }}>
        {list.map(h => (
          <div key={h.id} className="history-row">
            <span className="when">{h.created_at.slice(5, 16)}</span>
            <span className="act">{ACTIONS[h.action] ?? h.action}</span>
            <span className="chip">{TYPE_LABEL[h.entity_type] ?? h.entity_type}</span>
            <span className="muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.details}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Settings() {
  const { refresh, toast } = useApp();
  const [s, setS] = useState<Record<string, string>>({});
  useEffect(() => { api.get<Record<string, string>>('/settings').then(setS).catch(() => {}); }, []);

  async function save() {
    await api.put('/settings', s);
    refresh(); toast('Настройки сохранены');
  }

  return (
    <div>
      <div className="page-title"><h1>⚙️ Настройки</h1></div>
      <div className="card" style={{ padding: 16, maxWidth: 480 }}>
        <div className="form-grid">
          <div className="field"><label>Начало рабочего дня</label>
            <input type="time" value={s.work_start ?? '09:00'} onChange={e => setS({ ...s, work_start: e.target.value })} /></div>
          <div className="field"><label>Конец рабочего дня</label>
            <input type="time" value={s.work_end ?? '19:00'} onChange={e => setS({ ...s, work_end: e.target.value })} /></div>
          <div className="field"><label>Буфер между задачами, мин</label>
            <input type="number" value={s.plan_buffer_min ?? '15'} onChange={e => setS({ ...s, plan_buffer_min: e.target.value })} /></div>
          <div className="field"><label>Заполнять день не более, %</label>
            <input type="number" min={30} max={100} value={String(Math.round(Number(s.plan_fill_ratio ?? 0.8) * 100))}
              onChange={e => setS({ ...s, plan_fill_ratio: String(Number(e.target.value) / 100) })} /></div>
          <div className="field full"><label>Время на дорогу по умолчанию, мин</label>
            <input type="number" value={s.default_travel_min ?? '30'} onChange={e => setS({ ...s, default_travel_min: e.target.value })} /></div>
        </div>
        <button className="btn primary mt16" onClick={save}>Сохранить</button>
      </div>

      <div className="card mt16" style={{ padding: 16, maxWidth: 480 }}>
        <b>Интеграции</b>
        <p className="small muted">Архитектура уведомлений готова к подключению внешних каналов. Сейчас работают внутренние напоминания; провайдеры подключаются без изменения бизнес-логики:</p>
        {['Push-уведомления', 'Apple Calendar', 'Apple Reminders', 'Email', 'Telegram'].map(x => (
          <div key={x} className="flex small" style={{ padding: '7px 0', borderBottom: '1px solid var(--border)', justifyContent: 'space-between' }}>
            <span>{x}</span><span className="chip">скоро</span>
          </div>
        ))}
        <p className="small muted mt12">Внешний LLM для разбора фраз подключается через переменные окружения <code>LLM_API_URL</code> / <code>LLM_API_KEY</code> — ключи не хранятся в коде.</p>
      </div>
    </div>
  );
}
