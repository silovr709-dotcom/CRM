import { useEffect, useState } from 'react';
import { api, humanDate, humanDuration, todayStr } from '../api';
import { typeIcon, typeLabel, TYPE_META } from '../meta';
import { useApp, useRoute } from '../store';
import type { Template, Automation, Contact, Category, Activity, StockItem, StockMove, User as UserT } from '../types';

const SECTIONS = [
  { id: 'analytics', icon: '📊', label: 'Аналитика', desc: 'Продуктивность, распределение дел, хронические переносы' },
  { id: 'stock', icon: '📦', label: 'Склад', desc: 'Остатки, приход/расход, минимальные запасы' },
  { id: 'templates', icon: '🧩', label: 'Шаблоны', desc: 'Готовые цепочки задач: доставка, монтаж, новый клиент' },
  { id: 'automations', icon: '⚡', label: 'Автоматизации', desc: 'КОГДА событие → ТОГДА действие' },
  { id: 'contacts', icon: '👥', label: 'Контакты', desc: 'Поставщики и прочие люди (клиенты — в разделе «Клиенты»)' },
  { id: 'categories', icon: '🏷', label: 'Категории', desc: 'Работа, личное и свои собственные' },
  { id: 'history', icon: '🕓', label: 'История', desc: 'Все изменения: создано, перенесено, выполнено' },
  { id: 'settings', icon: '⚙️', label: 'Настройки', desc: 'Рабочие часы, планирование, Telegram' },
  { id: 'account', icon: '🔑', label: 'Мой аккаунт', desc: 'Смена пароля и выход' },
  { id: 'users', icon: '👤', label: 'Пользователи', desc: 'Только для администратора: кто имеет доступ' },
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
        {section === 'stock' && <Stock />}
        {section === 'templates' && <Templates />}
        {section === 'automations' && <Automations />}
        {section === 'contacts' && <Contacts />}
        {section === 'categories' && <Categories />}
        {section === 'history' && <History />}
        {section === 'settings' && <Settings />}
        {section === 'account' && <Account />}
        {section === 'users' && <Users />}
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

      <TelegramSettings s={s} setS={setS} />

      <div className="card mt16" style={{ padding: 16, maxWidth: 480 }}>
        <b>🔔 Уведомления в браузере</b>
        <p className="small muted">Разрешите уведомления, чтобы напоминания приходили, даже когда вкладка не активна.</p>
        <button className="btn small" onClick={async () => {
          if (!('Notification' in window)) { toast('Браузер не поддерживает уведомления'); return; }
          const perm = await Notification.requestPermission();
          toast(perm === 'granted' ? 'Уведомления включены ✓' : 'Уведомления не разрешены');
        }}>
          {'Notification' in window && Notification.permission === 'granted' ? '✓ Разрешены' : 'Разрешить уведомления'}
        </button>
      </div>

      <InstallApp />
    </div>
  );
}

function InstallApp() {
  const { toast } = useApp();
  const [, force] = useState(0);
  useEffect(() => {
    const cb = () => force(x => x + 1);
    window.addEventListener('pwa-installable', cb);
    return () => window.removeEventListener('pwa-installable', cb);
  }, []);

  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone;
  const prompt = (window as any).__installPrompt;
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);

  async function install() {
    if (!prompt) return;
    prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === 'accepted') {
      (window as any).__installPrompt = null;
      toast('Приложение устанавливается ✓');
    }
  }

  return (
    <div className="card mt16" style={{ padding: 16, maxWidth: 480 }}>
      <b>📱 Установить как приложение</b>
      {standalone ? (
        <p className="small muted">✓ Уже запущено как приложение.</p>
      ) : prompt ? (
        <>
          <p className="small muted">Приложение появится на рабочем столе / экране «Домой» и будет открываться без браузера.</p>
          <button className="btn primary small" onClick={install}>Установить приложение</button>
        </>
      ) : isIOS ? (
        <p className="small muted">
          На iPhone/iPad: откройте сайт в <b>Safari</b> → нажмите кнопку <b>Поделиться</b> (□↑) → <b>«На экран “Домой”»</b>.
        </p>
      ) : (
        <p className="small muted">
          В <b>Chrome</b>: значок установки в адресной строке (⊕ / монитор со стрелкой) или меню ⋮ → <b>«Установить приложение»</b>.<br />
          Если пункта нет — обновите страницу (Ctrl+Shift+R): браузер должен сначала загрузить оболочку приложения.
        </p>
      )}
    </div>
  );
}

function TelegramSettings({ s, setS }: { s: Record<string, string>; setS: (v: Record<string, string>) => void }) {
  const { toast } = useApp();
  const [status, setStatus] = useState<{ configured: boolean; valid?: boolean; bot_username?: string | null; linked: boolean } | null>(null);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);

  const loadStatus = () => api.get<any>('/telegram/status').then(setStatus).catch(() => {});
  useEffect(() => { loadStatus(); }, []);

  async function saveToken() {
    setBusy(true);
    try {
      await api.post('/telegram/token', { token: token.trim() });
      setToken('');
      await loadStatus();
      toast('Токен сохранён');
    } finally { setBusy(false); }
  }

  async function saveBrief() {
    await api.put('/settings', {
      brief_morning: s.brief_morning ?? '08:00',
      brief_evening: s.brief_evening ?? '20:30',
      notify_before_min: s.notify_before_min ?? '15',
    });
    toast('Сохранено');
  }

  async function test() {
    const r = await api.post<any>('/telegram/test', {});
    toast(r.ok ? '✅ Сообщение отправлено' : `⚠️ ${r.error || 'Не получилось'}`);
  }

  return (
    <div className="card mt16" style={{ padding: 16, maxWidth: 480 }}>
      <b>✈️ Telegram-бот</b>
      {status?.configured ? (
        <div className="small mt8">
          {status.valid
            ? <>Бот: <b>@{status.bot_username}</b> {status.linked
                ? <span className="chip" style={{ background: 'var(--ok-soft, #dcfce7)', color: 'var(--ok, #16a34a)' }}>подключён ✓</span>
                : <span className="chip">откройте бота и отправьте /start</span>}</>
            : <span style={{ color: 'var(--danger)' }}>Токен не принят Telegram — проверьте его</span>}
        </div>
      ) : (
        <p className="small muted">
          Через бота приходят напоминания, брифинги — и можно ставить задачи текстом.<br />
          1. В Telegram откройте <b>@BotFather</b> → /newbot → получите токен.<br />
          2. Вставьте токен сюда.<br />
          3. Откройте своего бота и отправьте /start.
        </p>
      )}
      <div className="flex mt8" style={{ gap: 8 }}>
        <input
          style={{ flex: 1 }}
          type="password"
          placeholder={status?.configured ? 'Заменить токен…' : 'Токен от @BotFather'}
          value={token}
          onChange={e => setToken(e.target.value)}
        />
        <button className="btn small" disabled={busy || !token.trim()} onClick={saveToken}>Сохранить</button>
      </div>
      {status?.linked && (
        <button className="btn small mt8" onClick={test}>Отправить тестовое сообщение</button>
      )}
      <div className="form-grid mt12">
        <div className="field"><label>Утренний брифинг</label>
          <input type="time" value={s.brief_morning ?? '08:00'} onChange={e => setS({ ...s, brief_morning: e.target.value })} /></div>
        <div className="field"><label>Вечерний разбор</label>
          <input type="time" value={s.brief_evening ?? '20:30'} onChange={e => setS({ ...s, brief_evening: e.target.value })} /></div>
        <div className="field full"><label>Напоминать о задаче за, мин</label>
          <input type="number" value={s.notify_before_min ?? '15'} onChange={e => setS({ ...s, notify_before_min: e.target.value })} /></div>
      </div>
      <button className="btn small mt8" onClick={saveBrief}>Сохранить расписание</button>
    </div>
  );
}


function Stock() {
  const { toast } = useApp();
  const [items, setItems] = useState<StockItem[]>([]);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', qty: '0', unit: 'шт', min_qty: '0', location: '' });
  const [openMoves, setOpenMoves] = useState<number | null>(null);
  const [moves, setMoves] = useState<StockMove[]>([]);

  const load = () => api.get<StockItem[]>('/stock').then(setItems).catch(() => {});
  useEffect(() => { load(); }, []);

  async function add() {
    if (!form.name.trim()) return;
    await api.post('/stock', { ...form, qty: Number(form.qty), min_qty: Number(form.min_qty) });
    setForm({ name: '', qty: '0', unit: 'шт', min_qty: '0', location: '' });
    setAdding(false);
    load();
  }

  async function move(it: StockItem, sign: 1 | -1) {
    const raw = prompt(`${sign > 0 ? 'Приход' : 'Расход'} «${it.name}», ${it.unit}:`, '1');
    if (!raw) return;
    const qty = Math.abs(Number(raw.replace(',', '.')));
    if (!qty) return;
    const reason = prompt('Причина / комментарий (не обязательно):') || '';
    await api.post(`/stock/${it.id}/move`, { delta: sign * qty, reason });
    toast(sign > 0 ? `+${qty} ${it.unit}` : `−${qty} ${it.unit}`);
    load();
    if (openMoves === it.id) showMoves(it.id);
  }

  async function showMoves(id: number) {
    if (openMoves === id) { setOpenMoves(null); return; }
    setMoves(await api.get<StockMove[]>(`/stock/${id}/moves`));
    setOpenMoves(id);
  }

  async function removeItem(it: StockItem) {
    if (!confirm(`Удалить позицию «${it.name}»?`)) return;
    await api.del(`/stock/${it.id}`);
    load();
  }

  const low = items.filter(i => i.min_qty > 0 && i.qty <= i.min_qty);

  return (
    <div>
      <div className="page-title">
        <h1>📦 Склад</h1>
        <button className="btn primary" onClick={() => setAdding(!adding)}>{adding ? 'Отмена' : '+ Позиция'}</button>
      </div>

      {low.length > 0 && (
        <div className="card mt12" style={{ padding: '10px 14px', borderColor: 'var(--danger)' }}>
          <span className="small" style={{ color: 'var(--danger)' }}>
            ⚠️ Заканчивается: {low.map(i => `${i.name} (${i.qty} ${i.unit})`).join(', ')}
          </span>
        </div>
      )}

      {adding && (
        <div className="card mt12" style={{ padding: 16 }}>
          <div className="form-grid">
            <div className="field full"><label>Название</label>
              <input autoFocus value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Например: Фасады МДФ белые" /></div>
            <div className="field"><label>Количество</label>
              <input type="number" value={form.qty} onChange={e => setForm({ ...form, qty: e.target.value })} /></div>
            <div className="field"><label>Единица</label>
              <input value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} /></div>
            <div className="field"><label>Мин. запас</label>
              <input type="number" value={form.min_qty} onChange={e => setForm({ ...form, min_qty: e.target.value })} /></div>
            <div className="field"><label>Где лежит</label>
              <input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} placeholder="Склад / цех / гараж" /></div>
          </div>
          <button className="btn primary mt12" onClick={add}>Добавить</button>
        </div>
      )}

      {items.length === 0 && !adding ? (
        <div className="card empty mt12" style={{ padding: 24 }}>Пока пусто. Добавьте первую позицию — материалы, фурнитуру, инструменты.</div>
      ) : (
        <div className="card list-plain mt12">
          {items.map(it => (
            <div key={it.id} style={{ borderBottom: '1px solid var(--border)' }}>
              <div className="flex" style={{ padding: '10px 14px', gap: 10, alignItems: 'center' }}>
                <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => showMoves(it.id)}>
                  <div style={{ fontWeight: 600 }}>
                    {it.name}
                    {it.min_qty > 0 && it.qty <= it.min_qty && <span className="chip" style={{ marginLeft: 8, color: 'var(--danger)' }}>мало</span>}
                  </div>
                  <div className="small muted">
                    {it.qty} {it.unit}{it.location ? ` · ${it.location}` : ''}{it.min_qty > 0 ? ` · мин. ${it.min_qty}` : ''}
                  </div>
                </div>
                <button className="btn small" onClick={() => move(it, 1)}>+</button>
                <button className="btn small" onClick={() => move(it, -1)}>−</button>
                <button className="btn small ghost danger" onClick={() => removeItem(it)}>✕</button>
              </div>
              {openMoves === it.id && (
                <div style={{ padding: '0 14px 12px' }}>
                  {moves.length === 0 ? <div className="small muted">Движений нет</div> : moves.map(m => (
                    <div key={m.id} className="flex small" style={{ justifyContent: 'space-between', padding: '3px 0' }}>
                      <span className="muted">{m.created_at?.slice(0, 16).replace('T', ' ')}</span>
                      <span>{m.reason || '—'}</span>
                      <b style={{ color: m.delta > 0 ? 'var(--ok, #16a34a)' : 'var(--danger)' }}>{m.delta > 0 ? '+' : ''}{m.delta} {it.unit}</b>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


// ---------- Мой аккаунт ----------
function Account() {
  const { user, logout, setUser, toast } = useApp();
  const [oldPassword, setOld] = useState('');
  const [newPassword, setNew] = useState('');
  const [repeat, setRepeat] = useState('');

  async function change() {
    if (newPassword !== repeat) { toast('Пароли не совпадают'); return; }
    try {
      const res = await api.post<{ user: UserT }>('/auth/password', { old_password: oldPassword, new_password: newPassword });
      setUser(res.user);
      setOld(''); setNew(''); setRepeat('');
      toast('Пароль изменён ✓');
    } catch (e) {
      toast((e as Error).message);
    }
  }

  return (
    <div>
      <div className="page-title"><h1>🔑 Мой аккаунт</h1></div>
      <div className="card" style={{ padding: 16, maxWidth: 420 }}>
        <div className="small muted">Логин</div>
        <b>{user?.login}</b>
        <div className="small muted mt8">Имя</div>
        <b>{user?.name || '—'}</b>
        <div className="small muted mt8">Права</div>
        <b>{user?.role === 'admin' ? 'администратор' : 'пользователь'}</b>
      </div>

      <div className="card mt16" style={{ padding: 16, maxWidth: 420 }}>
        <b>Сменить пароль</b>
        <div className="form-grid mt8">
          <div className="field full"><label>Текущий пароль</label>
            <input type="password" value={oldPassword} onChange={e => setOld(e.target.value)} /></div>
          <div className="field full"><label>Новый пароль</label>
            <input type="password" value={newPassword} onChange={e => setNew(e.target.value)} /></div>
          <div className="field full"><label>Повторите пароль</label>
            <input type="password" value={repeat} onChange={e => setRepeat(e.target.value)} /></div>
        </div>
        <button className="btn primary mt12" disabled={!oldPassword || !newPassword} onClick={change}>Сохранить пароль</button>
      </div>

      {user?.role === 'admin' && <BackupCard />}

      <button className="btn mt16" onClick={logout}>Выйти из аккаунта</button>
    </div>
  );
}

// ---------- Резервная копия базы (только администратор) ----------
type StorageStatus = { enabled: boolean; ok: boolean; message: string; bucket?: string; last_snapshot_at?: string | null };

function BackupCard() {
  const { toast } = useApp();
  const [info, setInfo] = useState<{ tasks: number; projects: number; notes: number; backups: { name: string; created_at: string }[] } | null>(null);
  const [storage, setStorage] = useState<StorageStatus | null>(null);
  const [checking, setChecking] = useState(false);
  useEffect(() => { api.get<any>('/admin/info').then(setInfo).catch(() => {}); }, []);
  useEffect(() => { api.get<StorageStatus>('/admin/storage').then(setStorage).catch(() => {}); }, []);
  const last = info?.backups?.[0];

  return (
    <div className="card mt16" style={{ padding: 16, maxWidth: 420 }}>
      <b>💾 Резервная копия</b>
      <p className="small muted">
        Все ваши данные — один файл. Скачайте его и сохраните на компьютер:
        если что-то случится с сервером, из этого файла всё восстанавливается.
        {last ? ` Последняя копия на сервере: ${last.name}.` : ''}
      </p>
      <div className="flex wrap">
        <button className="btn primary small" onClick={() => { window.location.href = '/api/admin/backups/latest/download'; }}>
          Скачать копию
        </button>
        <button className="btn small" onClick={async () => {
          try { await api.post('/admin/backups', {}); const fresh = await api.get<any>('/admin/info'); setInfo(fresh); toast('Копия создана на сервере'); }
          catch (e) { toast((e as Error).message); }
        }}>Создать копию сейчас</button>
      </div>
      {info && (
        <div className="small muted mt8">
          В базе: задач {info.tasks}, проектов {info.projects}, заметок {info.notes}.
          Копии создаются автоматически раз в сутки.
        </div>
      )}

      <div className="divider" />
      <b>☁️ Облачное хранилище</b>
      <p className="small muted">
        {storage
          ? (storage.enabled
              ? `${storage.ok ? '✅' : '⚠️'} ${storage.message}${storage.last_snapshot_at ? ` · последний снимок: ${new Date(storage.last_snapshot_at).toLocaleString('ru-RU')}` : ''}`
              : '⚠️ Хранилище не подключено: данные живут только на диске сервера.')
          : 'Проверяю…'}
      </p>
      <div className="flex wrap">
        <button className="btn small" disabled={checking} onClick={async () => {
          setChecking(true);
          try { setStorage(await api.get<StorageStatus>('/admin/storage')); toast('Проверил связь с хранилищем'); }
          catch (e) { toast((e as Error).message); }
          finally { setChecking(false); }
        }}>{checking ? 'Проверяю…' : 'Проверить связь'}</button>
        {storage?.enabled && (
          <button className="btn small" onClick={async () => {
            try { await api.post('/admin/storage/snapshot', {}); setStorage(await api.get<StorageStatus>('/admin/storage')); toast('Копия отправлена в облако ✓'); }
            catch (e) { toast((e as Error).message); }
          }}>Сохранить в облако сейчас</button>
        )}
      </div>
    </div>
  );
}

// ---------- Пользователи (только администратор) ----------
function Users() {
  const { user, toast } = useApp();
  const [list, setList] = useState<UserT[]>([]);
  const [form, setForm] = useState<{ login: string; name: string; password: string; role: 'admin' | 'user' } | null>(null);
  const [error, setError] = useState('');

  const load = () => api.get<UserT[]>('/auth/users').then(setList).catch(() => setList([]));
  useEffect(() => { load(); }, []);

  if (user?.role !== 'admin') {
    return <div className="empty">Раздел доступен только администратору.</div>;
  }

  async function create() {
    if (!form) return;
    setError('');
    try {
      await api.post('/auth/users', form);
      setForm(null); await load(); toast('Пользователь создан');
    } catch (e) { setError((e as Error).message); }
  }

  async function resetPassword(u: UserT) {
    const pass = prompt(`Новый пароль для «${u.login}»:`);
    if (!pass) return;
    try {
      await api.patch(`/auth/users/${u.id}`, { password: pass });
      toast('Пароль обновлён — передайте его пользователю');
    } catch (e) { toast((e as Error).message); }
  }

  return (
    <div>
      <div className="page-title">
        <div>
          <h1>👤 Пользователи</h1>
          <div className="sub">Публичной регистрации нет — аккаунты создаёте только вы</div>
        </div>
        <button className="btn primary" onClick={() => setForm({ login: '', name: '', password: '', role: 'user' })}>+ Пользователь</button>
      </div>

      {list.map(u => (
        <div key={u.id} className="card" style={{ padding: 14, marginBottom: 8 }}>
          <div className="flex" style={{ justifyContent: 'space-between' }}>
            <div>
              <b>{u.name || u.login}</b> <span className="muted small">@{u.login}</span>
              <div className="small muted">
                {u.role === 'admin' ? '👑 администратор' : 'пользователь'}
                {!u.active ? ' · отключён' : ''}
                {u.must_change_password ? ' · пароль временный' : ''}
              </div>
            </div>
            <div className="row-actions">
              <button className="btn small" onClick={() => resetPassword(u)}>Сменить пароль</button>
              {u.id !== user?.id && (
                <button className="btn small ghost danger" onClick={async () => {
                  if (!confirm(`Удалить «${u.login}» вместе со всеми его задачами и проектами?`)) return;
                  try { await api.del(`/auth/users/${u.id}`); await load(); toast('Удалён'); }
                  catch (e) { toast((e as Error).message); }
                }}>Удалить</button>
              )}
            </div>
          </div>
        </div>
      ))}

      {form && (
        <div className="overlay" onClick={() => setForm(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head"><h2>Новый пользователь</h2><button className="x" onClick={() => setForm(null)}>✕</button></div>
            <div className="form-grid">
              <div className="field"><label>Логин (латиницей)</label>
                <input autoFocus value={form.login} onChange={e => setForm({ ...form, login: e.target.value })} placeholder="sergey" /></div>
              <div className="field"><label>Имя</label>
                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Мастер Сергей" /></div>
              <div className="field"><label>Пароль</label>
                <input value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} /></div>
              <div className="field"><label>Права</label>
                <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value as 'admin' | 'user' })}>
                  <option value="user">Пользователь</option>
                  <option value="admin">Администратор</option>
                </select></div>
            </div>
            {error && <div className="login-error">{error}</div>}
            <p className="small muted mt8">
              У каждого пользователя свои задачи, проекты, заметки, напоминания и свой Telegram-бот.
            </p>
            <div className="flex mt16" style={{ justifyContent: 'flex-end' }}>
              <button className="btn primary" onClick={create}>Создать</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
