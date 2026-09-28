import { useEffect, useState } from 'react';
import { api, money } from '../api';
import { useApp, useRoute } from '../store';
import type { Contact } from '../types';

// Раздел «Клиенты» — те же контакты, но с деньгами, проектами и задачами.
export default function Clients() {
  const { version, refresh, toast } = useApp();
  const { nav } = useRoute();
  const [list, setList] = useState<Contact[]>([]);
  const [form, setForm] = useState<Partial<Contact> | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => { api.get<Contact[]>('/contacts').then(setList).catch(() => {}); }, [version]);

  async function save() {
    if (!form?.name?.trim()) return;
    if (form.id) await api.patch(`/contacts/${form.id}`, form);
    else await api.post('/contacts', form);
    setForm(null); refresh(); toast('Сохранено');
  }

  const totalDebt = list.reduce((s, c) => s + (c.debt ?? 0), 0);
  const filtered = q.trim()
    ? list.filter(c => (c.name + ' ' + c.phone).toLowerCase().includes(q.trim().toLowerCase()))
    : list;

  return (
    <div>
      <div className="page-title">
        <div>
          <h1>🤝 Клиенты</h1>
          <div className="sub">Карточка клиента: задачи, проекты, заметки, файлы и деньги</div>
        </div>
        <button className="btn primary" onClick={() => setForm({})}>+ Клиент</button>
      </div>

      {totalDebt > 0 && (
        <div className="card money-summary">
          <span>💰 Клиенты должны всего</span>
          <b>{money(totalDebt)}</b>
        </div>
      )}

      <div className="flex" style={{ marginBottom: 14 }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Поиск клиента…"
          style={{ flex: 1, padding: '9px 13px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--card)', outline: 'none' }} />
      </div>

      {filtered.length === 0 ? (
        <div className="empty"><div className="big-icon">🤝</div>Клиентов пока нет</div>
      ) : (
        <div className="proj-grid">
          {filtered.map(c => (
            <div key={c.id} className="card proj-card" onClick={() => nav(`/clients/${c.id}`)}>
              <div className="flex" style={{ justifyContent: 'space-between' }}>
                <h3>{c.name}</h3>
                {(c.debt ?? 0) > 0 && <span className="chip red">должен {money(c.debt!)}</span>}
              </div>
              {c.phone && (
                <a className="phone-link" href={`tel:${c.phone.replace(/[^\d+]/g, '')}`} onClick={e => e.stopPropagation()}>
                  📞 {c.phone}
                </a>
              )}
              {c.address && <div className="small muted">📍 {c.address}</div>}
              <div className="small muted mt8">
                📁 проектов: {c.projects_count ?? 0} · ☑️ открытых задач: {c.open_tasks ?? 0}
              </div>
            </div>
          ))}
        </div>
      )}

      {form && (
        <div className="overlay" onClick={() => setForm(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head"><h2>{form.id ? 'Клиент' : 'Новый клиент'}</h2><button className="x" onClick={() => setForm(null)}>✕</button></div>
            <div className="form-grid">
              <div className="field full"><label>Имя</label><input autoFocus value={form.name ?? ''} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
              <div className="field"><label>Телефон</label><input value={form.phone ?? ''} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="+7 900 000-00-00" /></div>
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
