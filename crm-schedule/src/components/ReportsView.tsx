// Отчёты: сколько заработали, сколько должны, откуда пришли заказы и почему теряем.
// Всё считается из сделок: платежи по датам, затраты по датам, план оплат — дебиторка.
import { useMemo, useState } from 'react';
import {
  ArrowLeft, ArrowRight, Banknote, ChartColumn, Download, HandCoins, Printer,
  TrendingDown, TrendingUp, Wallet,
} from 'lucide-react';
import { useApp } from '../store';
import { fmtDate, fmtMoney, fmtMoneyCompact, todayISO } from '../lib/dates';
import { downloadFile } from '../lib/storage';
import { receivables } from '../lib/money';
import {
  byManager, bySource, conversion, dailyMoney, dealsCsv, funnel, lostReasons, monthlyMoney,
  periodRange, reportCsv, shiftPeriod, totals, type PeriodId,
} from '../lib/reports';
import { printReport } from '../lib/print';
import { usePrefs } from '../lib/viewPrefs';
import EmptyState from './EmptyState';

const PERIODS: Array<{ id: PeriodId; label: string }> = [
  { id: 'month', label: 'Месяц' },
  { id: 'quarter', label: 'Квартал' },
  { id: 'year', label: 'Год' },
];

export default function ReportsView(props: { onOpenDeal: (id: string) => void }) {
  const { deals, clients, settings, clientName, notify } = useApp();
  const today = todayISO();
  const [prefs, patchPrefs] = usePrefs('reports', {
    period: 'month' as PeriodId,
    anchor: '',
  });
  const [custom, setCustom] = useState<{ from: string; to: string }>({ from: '', to: '' });

  // «Якорь» — первый день выбранного периода: от него считаются стрелки назад/вперёд.
  const anchor = prefs.anchor || today;
  const base = useMemo(
    () => periodRange(prefs.period, anchor, custom.from && custom.to ? custom : undefined),
    [prefs.period, anchor, custom],
  );

  const range = useMemo(() => {
    if (prefs.period === 'custom' && custom.from && custom.to) {
      return { ...base, from: custom.from, to: custom.to };
    }
    return base;
  }, [base, custom, prefs.period]);

  const stats = useMemo(() => totals(deals, range), [deals, range]);
  const stages = useMemo(() => funnel(deals, range), [deals, range]);
  const managers = useMemo(() => byManager(deals, range), [deals, range]);
  const sources = useMemo(() => bySource(deals, clients, range), [deals, clients, range]);
  const losses = useMemo(() => lostReasons(deals, range), [deals, range]);
  const conv = useMemo(() => conversion(deals, range), [deals, range]);
  const debts = useMemo(() => receivables(deals, today, clientName), [deals, today, clientName]);
  const debtTotal = debts.reduce((sum, item) => sum + item.remainder, 0);
  const overdue = debts.filter((item) => item.overdue > 0);
  const overdueTotal = overdue.reduce((sum, item) => sum + item.remainder, 0);

  const days = useMemo(() => dailyMoney(deals, range), [deals, range]);
  const months = useMemo(() => monthlyMoney(deals, Number(range.from.slice(0, 4))), [deals, range]);
  const useMonths = range.to.slice(0, 4) === range.from.slice(0, 4) && range.to.slice(0, 7) !== range.from.slice(0, 7)
    && days.length > 62;

  const shift = (direction: -1 | 1) => {
    const next = shiftPeriod(prefs.period === 'custom' ? 'month' : prefs.period, range, direction);
    patchPrefs({ period: prefs.period, anchor: next.from });
    setCustom({ from: '', to: '' });
  };

  const noMoneyData = deals.length > 0 && stats.received === 0 && stats.spent === 0;

  return (
    <div className="reports-view">
      <header className="page-head">
        <div>
          <h1>Отчёты</h1>
          <p className="muted">Выручка, маржа, дебиторка и конверсия за период</p>
        </div>
        <div className="card-head-actions">
          <button
            type="button"
            className="btn small ghost"
            onClick={() => {
              downloadFile(`сделки-${range.from}_${range.to}.csv`, dealsCsv(deals, range, clientName), 'text/csv;charset=utf-8');
              notify('Сделки выгружены в CSV');
            }}
          >
            <Download size={14} /> Сделки .csv
          </button>
          <button
            type="button"
            className="btn small ghost"
            onClick={() => {
              downloadFile(
                `отчёт-${range.from}_${range.to}.csv`,
                reportCsv(stats, managers, sources, losses, range),
                'text/csv;charset=utf-8',
              );
              notify('Отчёт выгружен в CSV');
            }}
          >
            <Download size={14} /> Отчёт .csv
          </button>
          <button
            type="button"
            className="btn small"
            onClick={() => printReport({
              period: range,
              totals: stats,
              funnel: stages,
              managers,
              sources,
              losses,
              company: settings.companyName,
            })}
          >
            <Printer size={14} /> Печать
          </button>
        </div>
      </header>

      <div className="report-period" role="group" aria-label="Период отчёта">
        <button type="button" className="icon-btn" onClick={() => shift(-1)} aria-label="Предыдущий период">
          <ArrowLeft size={16} />
        </button>
        <b>{range.label}</b>
        <button type="button" className="icon-btn" onClick={() => shift(1)} aria-label="Следующий период">
          <ArrowRight size={16} />
        </button>
        <div className="report-periods">
          {PERIODS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={prefs.period === item.id ? 'active' : ''}
              onClick={() => { patchPrefs({ period: item.id, anchor: '' }); setCustom({ from: '', to: '' }); }}
            >
              {item.label}
            </button>
          ))}
          <button
            type="button"
            className={prefs.period === 'custom' ? 'active' : ''}
            onClick={() => {
              patchPrefs({ period: 'custom', anchor: '' });
              setCustom((current) => (current.from && current.to
                ? current
                : { from: range.from, to: range.to }));
            }}
          >
            Свой
          </button>
        </div>
      </div>

      {prefs.period === 'custom' && (
        <div className="report-custom">
          <label className="field">С
            <input type="date" value={custom.from} onChange={(event) => setCustom({ ...custom, from: event.target.value })} />
          </label>
          <label className="field">По
            <input type="date" value={custom.to} onChange={(event) => setCustom({ ...custom, to: event.target.value })} />
          </label>
          {custom.from && custom.to && custom.from > custom.to && (
            <span className="field-error">Дата «с» позже даты «по»</span>
          )}
        </div>
      )}

      <section className="report-kpi" aria-label="Главные цифры">
        <div className="report-tile">
          <span><Wallet size={14} /> Новых сделок</span>
          <b>{stats.bookedCount}</b>
          <small>{stats.booked > 0 ? `на ${fmtMoneyCompact(stats.booked)}` : 'за период ничего не создано'}</small>
        </div>
        <div className="report-tile">
          <span><Banknote size={14} /> Получено денег</span>
          <b>{fmtMoney(stats.received)}</b>
          <small>по датам платежей</small>
        </div>
        <div className="report-tile">
          <span><TrendingDown size={14} /> Затраты</span>
          <b>{fmtMoney(stats.spent)}</b>
          <small>материалы, фабрика, монтаж</small>
        </div>
        <div className={`report-tile${stats.cash < 0 ? ' danger' : ''}`}>
          <span><TrendingUp size={14} /> На руках</span>
          <b>{fmtMoney(stats.cash)}</b>
          <small>получено минус затраты</small>
        </div>
        <div className={`report-tile${stats.marginPercent > 0 && stats.marginPercent < 10 ? ' warn' : ''}`}>
          <span><ChartColumn size={14} /> Маржа по новым</span>
          <b>{stats.marginPercent > 0 || stats.margin !== 0 ? `${stats.marginPercent}%` : '—'}</b>
          <small>{fmtMoney(stats.margin)} после затрат</small>
        </div>
        <div className={`report-tile${overdueTotal > 0 ? ' danger' : ''}`}>
          <span><HandCoins size={14} /> Ждём оплату</span>
          <b>{fmtMoney(debtTotal)}</b>
          <small className={overdueTotal > 0 ? 'danger' : ''}>
            {overdueTotal > 0 ? `просрочено ${fmtMoney(overdueTotal)}` : 'просрочек нет'}
          </small>
        </div>
      </section>

      {noMoneyData && (
        <div className="inline-warning">
          <Wallet size={14} /> За период нет платежей и затрат. Внесите их в карточке сделки — на вкладке «Оплата» — и цифры появятся.
        </div>
      )}

      {deals.length === 0 ? (
        <EmptyState
          title="Пока нечего считать"
          hint="Добавьте сделку — отчёт построится сам по её сумме, платежам и затратам."
        />
      ) : (
        <div className="report-grid">
          <section className="card">
            <div className="section-head">
              <div>
                <h2>Деньги по дням</h2>
                <span className="muted">{useMonths ? 'по месяцам' : 'получено и потрачено'}</span>
              </div>
            </div>
            <MoneyChart
              points={useMonths
                ? months.map((row) => ({ day: row.month, received: row.received, spent: row.spent }))
                : days.map((row) => ({ day: row.day, received: row.received, spent: row.spent }))}
              byMonth={useMonths}
            />
          </section>

          <section className="card">
            <div className="section-head">
              <div>
                <h2>Кто должен</h2>
                <span className="muted">{debts.length > 0 ? `сделок с остатком: ${debts.length}` : 'все оплачено'}</span>
              </div>
            </div>
            {debts.length === 0 ? (
              <div className="empty-note">Долгов нет — все счета закрыты.</div>
            ) : (
              <ul className="debt-list">
                {debts.slice(0, 6).map((item) => (
                  <li key={item.deal.id}>
                    <button type="button" className="link-btn" onClick={() => props.onOpenDeal(item.deal.id)}>
                      {item.deal.title}
                    </button>
                    <span className="muted">{item.client}</span>
                    <b>{fmtMoney(item.remainder)}</b>
                    <span className={item.overdue > 0 ? 'badge badge-red' : 'badge'}>
                      {item.overdue > 0
                        ? `просрочено ${item.overdue} дн.`
                        : item.dueAt ? `к ${fmtDate(item.dueAt)}` : 'без плана'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {debts.length > 6 && (
              <p className="inline-note">Ещё {debts.length - 6} — в CRM, фокус «С неоплаченным остатком».</p>
            )}
          </section>

          <section className="card">
            <div className="section-head">
              <div>
                <h2>Воронка периода</h2>
                <span className="muted">
                  {conv.leads} новых · до монтажа дошло {conv.installed} · {conv.winRate}%
                </span>
              </div>
            </div>
            {stages.length === 0 ? (
              <div className="empty-note">За период новых сделок нет.</div>
            ) : (
              <ul className="funnel-list">
                {stages.map((stage) => (
                  <li key={stage.status}>
                    <span className="funnel-label">{stage.label}</span>
                    <span className="funnel-bar"><i style={{ width: `${Math.max(4, Math.round(stage.share * 100))}%` }} /></span>
                    <b>{stage.count}</b>
                    <span className="muted">{fmtMoneyCompact(stage.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
            {conv.lost > 0 && (
              <p className="inline-note">Отказов за период: {conv.lost}. Причины — ниже.</p>
            )}
          </section>

          <section className="card">
            <div className="section-head">
              <div>
                <h2>Источники</h2>
                <span className="muted">откуда пришли новые заказы</span>
              </div>
            </div>
            <SliceTable slices={sources} empty="Источник не заполнен ни у одной сделки периода." amountLabel="Сумма" />
          </section>

          <section className="card">
            <div className="section-head">
              <div>
                <h2>Менеджеры</h2>
                <span className="muted">кто сколько принёс</span>
              </div>
            </div>
            <SliceTable slices={managers} empty="У сделок периода не указан ответственный." amountLabel="Сумма" paid />
          </section>

          <section className="card">
            <div className="section-head">
              <div>
                <h2>Причины отказа</h2>
                <span className="muted">что теряем и почему</span>
              </div>
            </div>
            <SliceTable slices={losses} empty="Отказов за период нет — хорошо." amountLabel="Потеряно" />
          </section>
        </div>
      )}
    </div>
  );
}

function SliceTable(props: { slices: Array<{ key: string; label: string; deals: number; amount: number; paid: number; share: number }>; empty: string; amountLabel: string; paid?: boolean }) {
  if (props.slices.length === 0) return <div className="empty-note">{props.empty}</div>;
  return (
    <table className="slice-table">
      <thead>
        <tr>
          <th>Название</th>
          <th>Сделок</th>
          <th>{props.amountLabel}</th>
          {props.paid && <th>Оплачено</th>}
          <th>Доля</th>
        </tr>
      </thead>
      <tbody>
        {props.slices.map((slice) => (
          <tr key={slice.key}>
            <td>{slice.label}</td>
            <td>{slice.deals}</td>
            <td className="num">{fmtMoney(slice.amount)}</td>
            {props.paid && <td className="num">{fmtMoney(slice.paid)}</td>}
            <td className="num">{Math.round(slice.share * 100)}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Простая столбчатая диаграмма без библиотек: две серии, подписи по краям. */
function MoneyChart(props: { points: Array<{ day: string; received: number; spent: number }>; byMonth: boolean }) {
  const max = Math.max(1, ...props.points.map((point) => Math.max(point.received, point.spent)));
  const visible = props.points.filter((point) => point.received > 0 || point.spent > 0);
  if (visible.length === 0) {
    return <div className="empty-note">За период денег не было.</div>;
  }
  // Для месяца показываем все дни, но столбики только там, где движение;
  // для года — все месяцы подряд.
  const points = props.byMonth ? props.points : visible;
  return (
    <div className={`money-chart${props.byMonth ? ' months' : ''}`} role="img" aria-label="Получено и потрачено по периодам">
      {points.map((point) => {
        const height = (value: number) => `${Math.round((value / max) * 100)}%`;
        const title = props.byMonth
          ? `${point.day}: получено ${fmtMoney(point.received)}, затраты ${fmtMoney(point.spent)}`
          : `${fmtDate(point.day)}: получено ${fmtMoney(point.received)}, затраты ${fmtMoney(point.spent)}`;
        return (
          <div className="money-bar" key={point.day} title={title}>
            <div className="money-bar-cols">
              <i className="in" style={{ height: height(point.received) }} />
              <i className="out" style={{ height: height(point.spent) }} />
            </div>
            <span>{props.byMonth ? point.day.slice(5) : point.day.slice(8)}</span>
          </div>
        );
      })}
      <div className="money-chart-legend">
        <span><i className="in" /> получено</span>
        <span><i className="out" /> затраты</span>
      </div>
    </div>
  );
}
