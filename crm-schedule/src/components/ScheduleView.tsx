// График монтажей: месяц или неделя, замеры, готовность, доставки и монтажи.
// Даты и бригада правятся прямо здесь — перетаскиванием или в карточке.
import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../store';
import {
  addDays, daysBetween, fmtDate, fmtMoney, MONTHS, relativeDay, todayISO, WEEKDAYS,
} from '../lib/dates';
import {
  collectEvents, eventsByDay, isWeekend, monthGrid, moveEvent,
  scheduleKindMeta, scheduleStatusMeta, scheduleWarnings, SCHEDULE_KINDS, teamLoad,
  weekGrid, type ScheduleEvent, type ScheduleKind,
} from '../lib/schedule';
import { exportIcs } from '../lib/storage';
import Modal from './Modal';

export default function ScheduleView(props: {
  onOpenDeal: (id: string) => void;
  onEditSchedule: (dealId: string) => void;
}) {
  const { data, deals, clientName, settings, updateDeal, updateSchedule, notify } = useApp();
  const today = todayISO();
  const [mode, setMode] = useState<'month' | 'week'>('month');
  const [anchor, setAnchor] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState(today);
  const [kinds, setKinds] = useState<ScheduleKind[]>([]);
  const [team, setTeam] = useState('');
  const [drag, setDrag] = useState<{ dealId: string; kind: ScheduleKind } | null>(null);
  const [dropDay, setDropDay] = useState('');
  const [planOpen, setPlanOpen] = useState(false);
  const [plan, setPlan] = useState({ dealId: '', kind: 'install' as ScheduleKind, date: today, team: '' });

  const allEvents = useMemo(() => collectEvents(deals, (deal) => clientName(deal)), [deals, clientName]);
  const events = useMemo(() => allEvents
    .filter((event) => kinds.length === 0 || kinds.includes(event.kind))
    .filter((event) => !team || (event.team ?? '').trim() === team), [allEvents, kinds, team]);
  const byDay = useMemo(() => eventsByDay(events), [events]);
  const days = useMemo(() => (mode === 'month' ? monthGrid(anchor) : weekGrid(anchor)), [mode, anchor]);
  const warnings = useMemo(() => scheduleWarnings(deals), [deals]);
  const load = useMemo(() => teamLoad(allEvents), [allEvents]);
  const teams = useMemo(() => {
    const set = new Set<string>(settings.teams);
    for (const event of allEvents) if (event.team?.trim()) set.add(event.team.trim());
    return Array.from(set).sort((left, right) => left.localeCompare(right, 'ru'));
  }, [allEvents, settings.teams]);

  const monthTitle = `${MONTHS[anchor.getMonth()]} ${anchor.getFullYear()}`;
  const periodCount = days.reduce((sum, day) => sum + (byDay.get(day)?.length ?? 0), 0);
  const dayEvents = byDay.get(selectedDay) ?? [];

  const shift = (direction: number) => {
    const next = new Date(anchor);
    if (mode === 'month') next.setMonth(next.getMonth() + direction);
    else next.setDate(next.getDate() + direction * 7);
    setAnchor(next);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (planOpen) return;
      if (event.key === 'ArrowLeft') shift(-1);
      else if (event.key === 'ArrowRight') shift(1);
      else if (event.key === 't' || event.key === 'е' || event.key === 'T' || event.key === 'Е') {
        setAnchor(new Date());
        setSelectedDay(today);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mode, anchor, planOpen, today]);

  const dropOn = (date: string) => {
    if (!drag) return;
    const deal = deals.find((item) => item.id === drag.dealId);
    if (!deal) return;
    const next = moveEvent(deal, drag.kind, date);
    updateDeal(next);
    notify(`«${deal.title}» → ${fmtDate(date)}`);
    setDrag(null);
    setDropDay('');
    setSelectedDay(date);
  };

  const planInstall = () => {
    if (!plan.dealId) { notify('Выберите сделку', 'error'); return; }
    const deal = deals.find((item) => item.id === plan.dealId);
    if (!deal) return;
    updateSchedule(deal.id, {
      installAt: plan.date,
      team: plan.team || deal.schedule.team,
      address: deal.schedule.address || undefined,
    });
    notify(`Монтаж «${deal.title}» назначен на ${fmtDate(plan.date)}`);
    setPlanOpen(false);
    setSelectedDay(plan.date);
  };

  const routeAddresses = dayEvents.map((event) => event.address).filter((address): address is string => Boolean(address?.trim()));
  const routeUrl = routeAddresses.length > 0
    ? `https://yandex.ru/maps/?rtext=${routeAddresses.map((address) => encodeURIComponent(address)).join('~')}&rtt=auto`
    : '';

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">Замеры · доставки · монтажи</div>
          <h1>График монтажей</h1>
          <p className="muted">Перетащите событие на другой день, чтобы перенести дату. Клик — быстрая правка.</p>
        </div>
        <div className="actions wrap">
          <button type="button" className="btn ghost" onClick={() => exportIcs(data, clientName)}>Скачать .ics</button>
          <button type="button" className="btn primary" onClick={() => { setPlan({ ...plan, date: selectedDay, team: '' }); setPlanOpen(true); }}>+ Монтаж</button>
        </div>
      </header>

      <section className="schedule-toolbar">
        <div className="segmented">
          <button type="button" className={mode === 'month' ? 'active' : ''} onClick={() => setMode('month')}>Месяц</button>
          <button type="button" className={mode === 'week' ? 'active' : ''} onClick={() => setMode('week')}>Неделя</button>
        </div>
        <div className="period-nav">
          <button type="button" className="icon-btn" onClick={() => shift(-1)} aria-label="Назад">‹</button>
          <b className="period-title">{monthTitle}</b>
          <button type="button" className="icon-btn" onClick={() => shift(1)} aria-label="Вперёд">›</button>
          <button type="button" className="btn small ghost" onClick={() => { setAnchor(new Date()); setSelectedDay(today); }}>Сегодня</button>
        </div>
        <div className="kind-filter">
          {SCHEDULE_KINDS.map((kind) => (
            <button
              key={kind.id}
              type="button"
              className={`kind-chip chip-${kind.color}${kinds.includes(kind.id) ? ' active' : ''}`}
              onClick={() => setKinds((current) => (current.includes(kind.id) ? current.filter((item) => item !== kind.id) : [...current, kind.id]))}
            >
              <i>{kind.short}</i>{kind.label}
            </button>
          ))}
        </div>
        <label className="team-filter">Бригада
          <select value={team} onChange={(event) => setTeam(event.target.value)}>
            <option value="">все</option>
            {teams.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <span className="toolbar-count">Событий: <b>{periodCount}</b></span>
      </section>

      <div className="schedule-layout">
        <section className={`calendar calendar-${mode}`}>
          <div className="calendar-head">
            {WEEKDAYS.map((day) => <span key={day}>{day}</span>)}
          </div>
          <div className="calendar-grid">
            {days.map((day) => {
              const items = byDay.get(day) ?? [];
              const inMonth = day.slice(0, 7) === `${anchor.getFullYear()}-${String(anchor.getMonth() + 1).padStart(2, '0')}`;
              return (
                <div
                  key={day}
                  className={[
                    'calendar-cell',
                    inMonth ? '' : 'out-month',
                    day === today ? 'today' : '',
                    day === selectedDay ? 'selected' : '',
                    isWeekend(day) ? 'weekend' : '',
                    dropDay === day ? 'drop' : '',
                  ].filter(Boolean).join(' ')}
                  onClick={() => setSelectedDay(day)}
                  onDragOver={(event) => { event.preventDefault(); setDropDay(day); }}
                  onDragLeave={() => setDropDay('')}
                  onDrop={() => dropOn(day)}
                >
                  <div className="cell-top">
                    <span className="cell-day">{Number(day.slice(8, 10))}</span>
                    {items.length > 0 && <span className="cell-count">{items.length}</span>}
                  </div>
                  <div className="cell-events">
                    {items.slice(0, mode === 'month' ? 3 : 8).map((event) => (
                      <EventPill key={event.id} event={event} onOpen={() => props.onEditSchedule(event.dealId)} onDragStart={() => setDrag({ dealId: event.dealId, kind: event.kind })} />
                    ))}
                    {items.length > (mode === 'month' ? 3 : 8) && <span className="cell-more">+{items.length - 3}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <aside className="schedule-side">
          <section className="card day-card">
            <div className="section-head">
              <div>
                <h2>{fmtDate(selectedDay, { withYear: true })}</h2>
                <span className="muted">{relativeDay(selectedDay, today)} · {dayEvents.length} событий</span>
              </div>
            </div>
            {dayEvents.length === 0 ? (
              <div className="empty-note">На этот день ничего не назначено.</div>
            ) : (
              <ul className="day-events">
                {dayEvents.map((event) => {
                  const kind = scheduleKindMeta(event.kind);
                  const deal = deals.find((item) => item.id === event.dealId);
                  const status = scheduleStatusMeta(event.status);
                  return (
                    <li key={event.id} className="day-event">
                      <span className={`event-chip chip-${kind.color}`}>{kind.short}</span>
                      <div className="day-event-main">
                        <b>{event.dealTitle}</b>
                        <span>{event.client}{event.team ? ` · ${event.team}` : ''}</span>
                        {event.address && <span className="muted small">{event.address}</span>}
                        {event.note && <span className="muted small">{event.note}</span>}
                        <div className="day-event-actions">
                          <span className={`badge badge-${status.tone}`}>{status.label}</span>
                          {deal && <button type="button" className="link-btn" onClick={() => props.onEditSchedule(deal.id)}>править</button>}
                          <button type="button" className="link-btn" onClick={() => props.onOpenDeal(event.dealId)}>карточка →</button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {routeUrl && (
              <a className="btn small ghost route-btn" href={routeUrl} target="_blank" rel="noreferrer">Маршрут по адресам дня</a>
            )}
          </section>

          <section className="card load-card">
            <div className="section-head"><h2>Загрузка бригад</h2><span className="muted">по монтажам</span></div>
            {load.length === 0 ? <div className="empty-note">Монтажей пока нет.</div> : (
              <ul className="load-list">
                {load.map((item) => (
                  <li key={item.team}>
                    <div className="load-top"><b>{item.team}</b><span>{item.days} дн. · {item.deals} заказ(ов)</span></div>
                    <div className="load-bar"><i style={{ width: `${Math.min(100, item.days * 12)}%` }} /></div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={`card${warnings.length > 0 ? ' card-warn' : ''}`}>
            <div className="section-head"><h2>Проверка графика</h2><span className="muted">{warnings.length || 'чисто'}</span></div>
            {warnings.length === 0 ? <div className="empty-note">✓ Накладок нет.</div> : (
              <ul className="warning-list">
                {warnings.map((warning, index) => (
                  <li key={`${warning.text}-${index}`} className={`warning warning-${warning.kind}`}>
                    <span>{warning.kind === 'error' ? '⛔' : '⚠'}</span>
                    {warning.dealId ? (
                      <button type="button" className="warning-link" onClick={() => props.onEditSchedule(warning.dealId)}>{warning.text}</button>
                    ) : <span>{warning.text}</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card upcoming-card">
            <div className="section-head"><h2>Ближайшие 14 дней</h2><span className="muted">сводка</span></div>
            <ul className="upcoming-list">
              {allEvents.filter((event) => event.kind === 'install' && event.date >= today && event.date <= addDays(today, 14)).slice(0, 8).map((event) => {
                const daysLeft = daysBetween(today, event.date);
                return (
                  <li key={event.id}>
                    <button type="button" className="upcoming-row" onClick={() => props.onEditSchedule(event.dealId)}>
                      <span className="event-chip chip-orange">М</span>
                      <span className="upcoming-main">
                        <b>{event.dealTitle}</b>
                        <span>{event.client}</span>
                      </span>
                      <span className="upcoming-side">
                        <b>{fmtDate(event.date)}</b>
                        <small>{daysLeft === 0 ? 'сегодня' : daysLeft === 1 ? 'завтра' : `через ${daysLeft} дн.`}</small>
                      </span>
                    </button>
                  </li>
                );
              })}
              {allEvents.filter((event) => event.kind === 'install' && event.date >= today && event.date <= addDays(today, 14)).length === 0 && (
                <li><div className="empty-note">Монтажей на две недели нет.</div></li>
              )}
            </ul>
          </section>
        </aside>
      </div>

      {planOpen && (
        <Modal
          title="Запланировать монтаж"
          subtitle="Быстро поставьте дату и бригаду — остальное можно заполнить в карточке."
          onClose={() => setPlanOpen(false)}
          footer={(
            <>
              <button type="button" className="btn ghost" onClick={() => setPlanOpen(false)}>Отмена</button>
              <button type="button" className="btn primary" onClick={planInstall}>Поставить в график</button>
            </>
          )}
        >
          <div className="form-grid">
            <label className="field span-2">Сделка
              <select value={plan.dealId} onChange={(event) => setPlan({ ...plan, dealId: event.target.value })}>
                <option value="">— выберите сделку —</option>
                {deals.filter((deal) => deal.status !== 'delivered' && deal.status !== 'rejected').map((deal) => (
                  <option key={deal.id} value={deal.id}>{clientName(deal)} · {deal.title}</option>
                ))}
              </select>
            </label>
            <label className="field">Тип события
              <select value={plan.kind} onChange={(event) => setPlan({ ...plan, kind: event.target.value as ScheduleKind })}>
                {SCHEDULE_KINDS.map((kind) => <option key={kind.id} value={kind.id}>{kind.label}</option>)}
              </select>
            </label>
            <label className="field">Дата
              <input type="date" value={plan.date} onChange={(event) => setPlan({ ...plan, date: event.target.value })} />
            </label>
            <label className="field span-2">Бригада
              <select value={plan.team} onChange={(event) => setPlan({ ...plan, team: event.target.value })}>
                <option value="">не менять / не назначена</option>
                {teams.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
            <p className="form-note span-2">Сумма последнего заказа: {fmtMoney(deals.find((deal) => deal.id === plan.dealId)?.amount ?? 0)}</p>
          </div>
        </Modal>
      )}
    </div>
  );
}

function EventPill({ event, onOpen, onDragStart }: { event: ScheduleEvent; onOpen: () => void; onDragStart: () => void }) {
  const kind = scheduleKindMeta(event.kind);
  return (
    <button
      type="button"
      className={`event-pill chip-${kind.color} status-${event.status}`}
      draggable
      onDragStart={onDragStart}
      onClick={(clickEvent) => { clickEvent.stopPropagation(); onOpen(); }}
      title={`${kind.label}: ${event.dealTitle}${event.team ? ` · ${event.team}` : ''}`}
    >
      <i>{kind.short}</i>
      <span>{event.dealTitle}{event.dayCount && event.dayCount > 1 ? ` · ${event.dayIndex}/${event.dayCount}` : ''}</span>
    </button>
  );
}
