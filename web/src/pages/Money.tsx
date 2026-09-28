import { useEffect, useState } from 'react';
import { api, money, humanDate, todayStr } from '../api';
import { useApp, useRoute } from '../store';
import type { MoneyReport, Debtor } from '../types';

const MONTH_NAMES = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const monthLabel = (ym: string) => `${MONTH_NAMES[Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}`;

export default function Money() {
  const { version, refresh, toast } = useApp();
  const { nav } = useRoute();
  const [rep, setRep] = useState<MoneyReport | null>(null);

  useEffect(() => { api.get<MoneyReport>('/projects/money/report').then(setRep).catch(() => {}); }, [version]);

  if (!rep) return <div className="empty">Загрузка…</div>;

  const maxMonth = Math.max(1, ...rep.months.map(m => m.received));

  // Напомнить о долге: создаём задачу-звонок на сегодня
  async function remind(d: Debtor) {
    await api.post('/tasks', {
      title: `Позвонить ${d.contact_name || d.name} — оплата ${Math.round(d.debt).toLocaleString('ru-RU')} ₽`,
      type: 'call', date: todayStr(), priority: 1,
      project_id: d.id, contact_id: d.contact_id ?? null,
    });
    refresh();
    toast('Задача-напоминание создана на сегодня');
  }

  return (
    <div>
      <div className="page-title">
        <div>
          <h1>💰 Деньги</h1>
          <div className="sub">Сколько получено, сколько ещё ждём и кто должен</div>
        </div>
        <div className="row-actions">
          <button className="btn ghost small" onClick={() => { window.location.href = '/api/export/payments.csv'; }}>⬇ Платежи в Excel</button>
          <button className="btn ghost small" onClick={() => { window.location.href = '/api/export/projects.csv'; }}>⬇ Заказы в Excel</button>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="card kpi">
          <div className="kpi-label">Получено в этом месяце</div>
          <div className="kpi-value green">{money(rep.received_this_month)}</div>
          <div className="small muted">за 30 дней: {money(rep.received_last_30)}</div>
        </div>
        <div className="card kpi">
          <div className="kpi-label">Ждём по заказам в работе</div>
          <div className="kpi-value">{money(rep.expected)}</div>
          <div className="small muted">всего заказов на {money(rep.active_price)}</div>
        </div>
        <div className="card kpi">
          <div className="kpi-label">Должны сейчас</div>
          <div className={`kpi-value${rep.total_debt > 0 ? ' red' : ''}`}>{money(rep.total_debt)}</div>
          <div className="small muted">{rep.debtors.length ? `заказов с остатком: ${rep.debtors.length}` : 'все рассчитались 🎉'}</div>
        </div>
      </div>

      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <b>Поступления по месяцам</b>
        <div className="bars mt12">
          {rep.months.map(m => (
            <div key={m.month} className="bar-col" title={`${monthLabel(m.month)}: ${money(m.received)}`}>
              <div className="bar-val small">{m.received ? Math.round(m.received / 1000) + 'к' : ''}</div>
              <div className="bar" style={{ height: `${Math.max(3, (m.received / maxMonth) * 100)}%` }} />
              <div className="bar-label small muted">{monthLabel(m.month)}</div>
            </div>
          ))}
        </div>
      </div>

      <h2 className="sec-title">Кто должен</h2>
      {rep.debtors.length === 0 ? (
        <div className="empty">Долгов нет — красота.</div>
      ) : (
        <div className="card list-plain" style={{ marginBottom: 16 }}>
          {rep.debtors.map(d => (
            <div key={d.id} className="debtor-row">
              <div className="debtor-main" onClick={() => nav(`/projects/${d.id}`)}>
                <b>{d.name}</b>
                <div className="small muted">
                  {d.contact_name || 'без клиента'}
                  {d.stage ? ` · ${d.stage}` : ''}
                  {d.last_payment ? ` · последняя оплата ${humanDate(d.last_payment)}` : ' · оплат не было'}
                </div>
              </div>
              <div className="debtor-sum">
                <b className="red">{money(d.debt)}</b>
                <span className="small muted">из {money(d.price)}</span>
              </div>
              <div className="row-actions">
                {d.contact_phone && <a className="btn small" href={`tel:${d.contact_phone}`}>📞</a>}
                <button className="btn small" onClick={() => remind(d)}>Напомнить</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <h2 className="sec-title">Последние платежи</h2>
      {rep.recent.length === 0 ? (
        <div className="empty">Платежей пока нет. Добавьте оплату в карточке заказа.</div>
      ) : (
        <div className="card list-plain">
          {rep.recent.map(p => (
            <div key={p.id} className="pay-row" onClick={() => nav(`/projects/${p.project_id}`)}>
              <span className="pay-date small muted">{humanDate(p.date)}</span>
              <span className="pay-sum green"><b>+{money(p.amount)}</b></span>
              <span className="pay-proj">{p.project_name}{p.contact_name ? ` · ${p.contact_name}` : ''}</span>
              <span className="chip small">{p.method}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
