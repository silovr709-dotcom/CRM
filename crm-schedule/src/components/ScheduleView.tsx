// График монтажей: месяц, неделя, дорожки по бригадам и список дней.
// Даты двигаются перетаскиванием (мышь и палец) и кнопками в карточке события.
import { useEffect, useMemo, useState } from 'react';
import {
  CalendarDays, ChevronLeft, ChevronRight, Clock, MapPin, Printer, Search, TriangleAlert, X,
} from 'lucide-react';
import { useApp } from '../store';
import {
  addDays, fmtDate, fmtTimeRange, fmtWeekday, MONTHS, relativeDay, todayISO, WEEKDAYS,
} from '../lib/dates';
import {
  collectEvents, eventsByDay, eventsOfDay, isWeekend, monthGrid, moveEvent,
  scheduleKindMeta, scheduleStatusMeta, scheduleWarnings, SCHEDULE_KINDS, teamLoad,
  weekGrid, type ScheduleEvent, type ScheduleKind,
} from '../lib/schedule';
import { exportIcs } from '../lib/storage';
import { printDaySheet } from '../lib/print';
import { useDragDrop } from '../lib/dnd';
import { isNarrow, usePrefs } from '../lib/viewPrefs';
import type { CalendarEvent } from '../types';
import Modal from './Modal';
import EmptyState from './EmptyState';
import CalendarEventDialog from './CalendarEventDialog';

export default function ScheduleView(props: {
  onOpenDeal: (id: string) => void;
  onEditSchedule: (dealId: string) => void;
  onCreateInstall: (day?: string) => void;
}) {
  const { data, deals, clientName, settings, updateDeal, notify, calendarEvents } = useApp();
  const today = todayISO();
  const [prefs, patchPrefs] = usePrefs('schedule', {
    // На телефоне сразу «Список дней»: календарь там тесный.
    mode: (isNarrow() ? 'list' : 'month') as 'month' | 'week' | 'teams' | 'list',
    kinds: [] as ScheduleKind[],
    team: '',
    day: today,
  });
  const [anchor, setAnchor] = useState(() => new Date());
  const [query, setQuery] = useState('');
  /** Редактор свободного события: существующее или новое на выбранный день. */
  const [eventEditor, setEventEditor] = useState<{ item?: CalendarEvent; date: string } | null>(null);

  const day = prefs.day || today;

  const allEvents = useMemo(
    () => collectEvents(deals, (deal) => clientName(deal), calendarEvents),
    [deals, clientName, calendarEvents],
  );

  /** Клик по событию: свободное открывает свой редактор, событие сделки — карточку сделки. */
  const openEvent = (event: ScheduleEvent) => {
    if (event.customId) {
      const item = calendarEvents.find((entry) => entry.id === event.customId);
      if (item) {
        patchPrefs({ day: event.date });
        setEventEditor({ item, date: item.date });
        return;
      }
    }
    props.onEditSchedule(event.dealId);
  };
  const events = useMemo(() => allEvents
    .filter((event) => prefs.kinds.length === 0 || prefs.kinds.includes(event.kind))
    .filter((event) => !prefs.team || (event.team ?? '').trim() === prefs.team)
    .filter((event) => {
      const needle = query.trim().toLocaleLowerCase('ru-RU');
      if (!needle) return true;
      return [event.dealTitle, event.client, event.address, event.team, event.note]
        .filter(Boolean).join(' ').toLocaleLowerCase('ru-RU').includes(needle);
    }), [allEvents, prefs.kinds, prefs.team, query]);

  const byDay = useMemo(() => eventsByDay(events), [events]);
  const days = useMemo(() => (prefs.mode === 'week' ? weekGrid(anchor) : monthGrid(anchor)), [prefs.mode, anchor]);
  const warnings = useMemo(() => scheduleWarnings(deals, calendarEvents), [deals, calendarEvents]);
  const load = useMemo(() => teamLoad(allEvents), [allEvents]);
  const teams = useMemo(() => {
    const set = new Set<string>(settings.teams);
    for (const event of allEvents) if (event.team?.trim()) set.add(event.team.trim());
    return Array.from(set).sort((left, right) => left.localeCompare(right, 'ru'));
  }, [allEvents, settings.teams]);

  const monthTitle = `${MONTHS[anchor.getMonth()]} ${anchor.getFullYear()}`;
  const periodCount = days.reduce((sum, date) => sum + (byDay.get(date)?.length ?? 0), 0);
  const dayEvents = useMemo(() => eventsOfDay(allEvents, day), [allEvents, day]);

  const shift = (direction: number) => {
    const next = new Date(anchor);
    if (prefs.mode === 'week') next.setDate(next.getDate() + direction * 7);
    else next.setMonth(next.getMonth() + direction);
    setAnchor(next);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.key === 'ArrowLeft') shift(-1);
      else if (event.key === 'ArrowRight') shift(1);
      else if (event.key === 't' || event.key === 'е' || event.key === 'T' || event.key === 'Е') {
        setAnchor(new Date());
        patchPrefs({ day: today });
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const { drag, over, bind } = useDragDrop((payload, target) => {
    if (payload.kind !== 'event') return;
    const deal = deals.find((item) => item.id === payload.id);
    if (!deal) return;
    const kind = (payload.label ?? 'install') as ScheduleKind;
    if (deal.schedule[fieldFor(kind)] === target) return;
    const previous = deal.schedule[fieldFor(kind)];
    updateDeal(moveEvent(deal, kind, target));
    notify(`${scheduleKindMeta(kind).label} «${deal.title}» → ${fmtDate(target)}`, 'ok', {
      label: 'Вернуть',
      run: () => {
        const current = deals.find((item) => item.id === deal.id);
        if (current && previous) updateDeal(moveEvent(current, kind, previous));
      },
    });
    patchPrefs({ day: target });
  });

  const toggleKind = (kind: ScheduleKind) => {
    patchPrefs({
      kinds: prefs.kinds.includes(kind) ? prefs.kinds.filter((item) => item !== kind) : [...prefs.kinds, kind],
    });
  };

  const routeAddresses = dayEvents.map((event) => event.address).filter((address): address is string => Boolean(address?.trim()));
  const routeUrl = routeAddresses.length > 0
    ? `https://yandex.ru/maps/?rtext=${routeAddresses.map((address) => encodeURIComponent(address)).join('~')}&rtt=auto`
    : '';

  const modeButtons: Array<{ id: typeof prefs.mode; label: string }> = [
    { id: 'month', label: 'Месяц' },
    { id: 'week', label: 'Неделя' },
    { id: 'teams', label: 'Бригады' },
    { id: 'list', label: 'Список' },
  ];

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">Замеры · доставки · монтажи · события</div>
          <h1>График монтажей</h1>
          <p className="muted">Перетащите событие на другой день мышью или пальцем. Клик — быстрая правка. Кнопка «+ Событие» — любое дело без сделки: встреча, отгрузка, выходной.</p>
        </div>
        <div className="actions wrap">
          <button type="button" className="btn ghost" onClick={() => exportIcs(data, clientName)}>Скачать .ics</button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => printDaySheet(deals, day, clientName, settings.companyName, data.events)}
            title={`Печать листа на ${fmtDate(day)}`}
          >
            <Printer size={15} /> Лист дня
          </button>
          <button type="button" className="btn ghost" onClick={() => setEventEditor({ date: day })}>+ Событие</button>
          <button type="button" className="btn primary" onClick={() => props.onCreateInstall(day)}>+ Монтаж</button>
        </div>
      </header>

      <section className="schedule-toolbar">
        <div className="segmented" aria-label="Вид графика">
          {modeButtons.map((item) => (
            <button key={item.id} type="button" className={prefs.mode === item.id ? 'active' : ''} onClick={() => patchPrefs({ mode: item.id })}>
              {item.label}
            </button>
          ))}
        </div>

        <div className="period-nav">
          <button type="button" className="icon-btn" onClick={() => shift(-1)} aria-label="Предыдущий период"><ChevronLeft size={16} /></button>
          <b className="period-title">{monthTitle}</b>
          <button type="button" className="icon-btn" onClick={() => shift(1)} aria-label="Следующий период"><ChevronRight size={16} /></button>
          <button type="button" className="btn small ghost" onClick={() => { setAnchor(new Date()); patchPrefs({ day: today }); }}>Сегодня</button>
        </div>

        <div className="kind-filter">
          {SCHEDULE_KINDS.map((kind) => (
            <button
              key={kind.id}
              type="button"
              className={`kind-chip chip-${kind.color}${prefs.kinds.includes(kind.id) ? ' active' : ''}`}
              onClick={() => toggleKind(kind.id)}
            >
              <i>{kind.short}</i>{kind.label}
            </button>
          ))}
        </div>

        <label className="team-filter">Бригада
          <select value={prefs.team} onChange={(event) => patchPrefs({ team: event.target.value })}>
            <option value="">все</option>
            {teams.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>

        <div className="search-wrap small">
          <Search size={14} />
          <input value={query} placeholder="адрес, бригада, заказ" onChange={(event) => setQuery(event.target.value)} aria-label="Поиск по графику" />
          {query && <button type="button" className="search-clear" onClick={() => setQuery('')} aria-label="Очистить"><X size={13} /></button>}
        </div>

        <span className="toolbar-count">Событий: <b>{periodCount}</b></span>
      </section>

      <div className="schedule-layout">
        <div className="schedule-main">
          {prefs.mode === 'teams' ? (
            <section className="team-board card">
              <div className="section-head">
                <div>
                  <h2>По бригадам</h2>
                  <span className="muted">кто чем занят — видно сразу</span>
                </div>
              </div>
              <TeamLanes
                days={weekGrid(anchor)}
                teams={teams}
                events={events}
                today={today}
                onOpenDeal={props.onEditSchedule}
                onPlan={props.onCreateInstall}
              />
            </section>
          ) : prefs.mode === 'list' ? (
            <section className="card day-list">
              <div className="section-head">
                <div>
                  <h2>Список дней</h2>
                  <span className="muted">удобно на телефоне и для печати</span>
                </div>
                <button type="button" className="link-btn" onClick={() => printDaySheet(deals, day, clientName, settings.companyName, data.events)}>
                  <Printer size={13} /> печать дня
                </button>
              </div>
              <DayList
                days={days.filter((date) => (byDay.get(date)?.length ?? 0) > 0 || date === today)}
                byDay={byDay}
                today={today}
                day={day}
                onSelect={(date) => patchPrefs({ day: date })}
                onOpenEvent={openEvent}
              />
            </section>
          ) : (
            <section className={`calendar calendar-${prefs.mode}`}>
              <div className="calendar-head">
                {WEEKDAYS.map((weekday) => <span key={weekday}>{weekday}</span>)}
              </div>
              <div className="calendar-grid">
                {days.map((date) => {
                  const items = byDay.get(date) ?? [];
                  const inMonth = date.slice(0, 7) === `${anchor.getFullYear()}-${String(anchor.getMonth() + 1).padStart(2, '0')}`;
                  const limit = prefs.mode === 'week' ? 8 : 3;
                  return (
                    <div
                      key={date}
                      className={[
                        'calendar-cell',
                        inMonth ? '' : 'out-month',
                        date === today ? 'today' : '',
                        date === day ? 'selected' : '',
                        isWeekend(date) ? 'weekend' : '',
                        over === date ? 'drop' : '',
                      ].filter(Boolean).join(' ')}
                      data-drop={date}
                      onClick={() => patchPrefs({ day: date })}
                    >
                      <div className="cell-top">
                        <span className="cell-day">{Number(date.slice(8, 10))}</span>
                        {items.length > 0 && <span className="cell-count">{items.length}</span>}
                      </div>
                      <div className="cell-events">
                        {items.slice(0, limit).map((event) => (
                          <EventPill
                            key={event.id}
                            event={event}
                            dragging={drag?.id === event.dealId && drag?.label === event.kind}
                            onOpen={() => openEvent(event)}
                            bind={() => (event.customId ? {} : bind({ id: event.dealId, kind: 'event', label: event.kind }))}
                          />
                        ))}
                        {items.length > limit && <span className="cell-more">+{items.length - limit}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>

        <aside className="schedule-side">
          <section className="card day-card">
            <div className="section-head">
              <div>
                <h2>{fmtDate(day, { withYear: true })}</h2>
                <span className="muted">{fmtWeekday(day)} · {relativeDay(day, today)} · событий: {dayEvents.length}</span>
              </div>
              <div className="card-head-actions">
                <button type="button" className="icon-btn" title="День раньше" aria-label="День раньше" onClick={() => patchPrefs({ day: addDays(day, -1) })}>
                  <ChevronLeft size={15} />
                </button>
                <button type="button" className="icon-btn" title="День позже" aria-label="День позже" onClick={() => patchPrefs({ day: addDays(day, 1) })}>
                  <ChevronRight size={15} />
                </button>
              </div>
            </div>
            {dayEvents.length === 0 ? (
              <EmptyState
                compact
                icon={<CalendarDays size={20} />}
                title="На этот день пусто"
                hint="Поставьте монтаж, замер или обычное событие — всё появится в календаре."
                action={(
                  <>
                    <button type="button" className="btn small ghost" onClick={() => setEventEditor({ date: day })}>Добавить событие</button>
                    <button type="button" className="btn small ghost" onClick={() => props.onCreateInstall(day)}>Поставить монтаж</button>
                  </>
                )}
              />
            ) : (
              <ul className="day-events">
                {dayEvents.map((event) => {
                  const kind = scheduleKindMeta(event.kind);
                  const status = scheduleStatusMeta(event.status);
                  return (
                    <li key={event.id} className="day-event">
                      <span className={`event-chip chip-${kind.color}`}>{kind.short}</span>
                      <div className="day-event-main">
                        <b>{event.dealTitle}</b>
                        <span>{event.client}{event.team ? ` · ${event.team}` : ''}</span>
                        {event.timeStart && (
                          <span className="with-icon"><Clock size={12} /> {fmtTimeRange(event.timeStart, event.timeEnd)}</span>
                        )}
                        {event.address && <span className="with-icon"><MapPin size={12} /> {event.address}</span>}
                        {event.note && <span className="muted small">{event.note}</span>}
                        <div className="day-event-actions">
                          {!event.customId && <span className={`badge badge-${status.tone}`}>{status.label}</span>}
                          <button type="button" className="link-btn" onClick={() => openEvent(event)}>править</button>
                          {!event.customId && (
                            <button type="button" className="link-btn" onClick={() => props.onOpenDeal(event.dealId)}>карточка →</button>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="day-card-actions">
              <button type="button" className="btn small ghost" onClick={() => setEventEditor({ date: day })}>
                + Событие
              </button>
              {routeUrl && (
                <a className="btn small ghost" href={routeUrl} target="_blank" rel="noreferrer">
                  <MapPin size={13} /> Маршрут по адресам
                </a>
              )}
              <button type="button" className="btn small ghost" onClick={() => printDaySheet(deals, day, clientName, settings.companyName, data.events)}>
                <Printer size={13} /> Печать листа
              </button>
            </div>
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
            {warnings.length === 0 ? (
              <EmptyState compact title="Накладок нет" hint="Бригады не пересекаются, адреса и время заполнены." />
            ) : (
              <ul className="warning-list">
                {warnings.map((warning, index) => (
                  <li key={`${warning.text}-${index}`} className={`warning warning-${warning.kind}`}>
                    <TriangleAlert size={14} />
                    {warning.dealId
                      ? <button type="button" className="warning-link" onClick={() => props.onEditSchedule(warning.dealId)}>{warning.text}</button>
                      : <span>{warning.text}</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card upcoming-card">
            <div className="section-head"><h2>Ближайшие 14 дней</h2><span className="muted">сводка</span></div>
            <ul className="upcoming-list">
              {allEvents.filter((event) => event.kind === 'install' && event.date >= today && event.date <= addDays(today, 14)).slice(0, 8).map((event) => {
                const daysLeft = Math.round((new Date(`${event.date}T12:00:00`).getTime() - new Date(`${today}T12:00:00`).getTime()) / 86400000);
                return (
                  <li key={event.id}>
                    <button type="button" className="upcoming-row" onClick={() => props.onEditSchedule(event.dealId)}>
                      <span className="event-chip chip-orange">М</span>
                      <span className="upcoming-main">
                        <b>{event.dealTitle}</b>
                        <span>{event.client}{event.timeStart ? ` · ${event.timeStart}` : ''}</span>
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

      {eventEditor && (
        <CalendarEventDialog
          item={eventEditor.item}
          date={eventEditor.date}
          onClose={() => setEventEditor(null)}
        />
      )}
    </div>
  );
}

function fieldFor(kind: ScheduleKind): 'measureAt' | 'readyAt' | 'deliveryAt' | 'installAt' {
  if (kind === 'measure') return 'measureAt';
  if (kind === 'ready') return 'readyAt';
  if (kind === 'delivery') return 'deliveryAt';
  return 'installAt';
}

function EventPill({ event, dragging, onOpen, bind }: {
  event: ScheduleEvent;
  dragging: boolean;
  onOpen: () => void;
  bind: () => Record<string, unknown>;
}) {
  const kind = scheduleKindMeta(event.kind);
  return (
    <button
      type="button"
      className={`event-pill chip-${kind.color} status-${event.status}${dragging ? ' is-dragged' : ''}`}
      {...bind()}
      onClick={(clickEvent) => { clickEvent.stopPropagation(); onOpen(); }}
      title={`${kind.label}: ${event.dealTitle}${event.timeStart ? ` · ${event.timeStart}` : ''}${event.team ? ` · ${event.team}` : ''}`}
    >
      <i>{kind.short}</i>
      <span>{event.timeStart ? `${event.timeStart} ` : ''}{event.dealTitle}{event.dayCount && event.dayCount > 1 ? ` · ${event.dayIndex}/${event.dayCount}` : ''}</span>
    </button>
  );
}

function DayList({ days, byDay, today, day, onSelect, onOpenEvent }: {
  days: string[];
  byDay: Map<string, ScheduleEvent[]>;
  today: string;
  day: string;
  onSelect: (date: string) => void;
  onOpenEvent: (event: ScheduleEvent) => void;
}) {
  return (
    <ul className="day-list-items">
      {days.map((date) => {
        const items = byDay.get(date) ?? [];
        return (
          <li key={date} className={date === day ? 'selected' : ''}>
            <button type="button" className="day-list-head" onClick={() => onSelect(date)}>
              <b>{fmtDate(date)}</b>
              <span>{fmtWeekday(date)}{date === today ? ' · сегодня' : ''}</span>
              <small>{items.length} событий</small>
            </button>
            <div className="day-list-events">
              {items.map((event) => {
                const kind = scheduleKindMeta(event.kind);
                return (
                  <button key={event.id} type="button" className="day-list-event" onClick={() => onOpenEvent(event)}>
                    <span className={`event-chip chip-${kind.color}`}>{kind.short}</span>
                    <span className="day-list-text">
                      <b>{event.dealTitle}</b>
                      <span>{event.client}{event.team ? ` · ${event.team}` : ''}{event.address ? ` · ${event.address}` : ''}</span>
                    </span>
                    <span className="day-list-time">{fmtTimeRange(event.timeStart, event.timeEnd) || 'весь день'}</span>
                  </button>
                );
              })}
              {items.length === 0 && <span className="muted small">нет событий</span>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function TeamLanes({ days, teams, events, today, onOpenDeal, onPlan }: {
  days: string[];
  teams: string[];
  events: ScheduleEvent[];
  today: string;
  onOpenDeal: (id: string) => void;
  onPlan: (day: string) => void;
}) {
  const installs = events.filter((event) => event.kind === 'install');
  const lanes = teams.length > 0 ? teams : ['Без бригады'];
  return (
    <div className="team-lanes">
      <div className="lane-header">
        <span className="lane-name" />
        {days.map((day) => (
          <span key={day} className={`lane-day${day === today ? ' today' : ''}`}>
            {fmtWeekday(day)}<b>{Number(day.slice(8, 10))}</b>
          </span>
        ))}
      </div>
      {lanes.map((team) => (
        <div key={team} className="lane">
          <span className="lane-name">{team}</span>
          {days.map((day) => {
            const items = installs.filter((event) => event.date === day && (event.team ?? 'Без бригады').trim() === team);
            return (
              <div key={`${team}-${day}`} className={`lane-cell${day === today ? ' today' : ''}`}>
                {items.map((event) => (
                  <button key={event.id} type="button" className="lane-event" onClick={() => onOpenDeal(event.dealId)}>
                    <b>{event.timeStart ?? '—'}</b>
                    <span>{event.dealTitle}</span>
                  </button>
                ))}
                {items.length === 0 && (
                  <button type="button" className="lane-add" onClick={() => onPlan(day)} aria-label={`Поставить монтаж на ${fmtDate(day)}`}>+</button>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function InstallDialog({ dealId, day, onClose }: { dealId: string; day: string; onClose: () => void }) {
  const { deals, clientName, updateSchedule, notify } = useApp();
  const deal = deals.find((item) => item.id === dealId);
  const [date, setDate] = useState(day);
  const [draft, setDraft] = useState({ team: '', timeStart: '09:00', timeEnd: '14:00' });
  if (!deal) return null;

  return (
    <Modal
      title="Запланировать монтаж"
      subtitle={`${clientName(deal)} · ${deal.title}`}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn ghost" onClick={onClose}>Отмена</button>
          <span className="foot-spacer" />
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              updateSchedule(deal.id, {
                installAt: date,
                team: draft.team || deal.schedule.team,
                timeStart: draft.timeStart || undefined,
                timeEnd: draft.timeEnd || undefined,
                address: deal.schedule.address || undefined,
              });
              notify(`Монтаж «${deal.title}» — ${fmtDate(date)}`);
              onClose();
            }}
          >
            Поставить в график
          </button>
        </>
      )}
    >
      <div className="form-grid">
        <label className="field span-2">Дата
          <input type="date" data-autofocus value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
        <label className="field">Начало
          <input type="time" value={draft.timeStart} onChange={(event) => setDraft({ ...draft, timeStart: event.target.value })} />
        </label>
        <label className="field">Окончание
          <input type="time" value={draft.timeEnd} onChange={(event) => setDraft({ ...draft, timeEnd: event.target.value })} />
        </label>
        <label className="field span-2">Бригада
          <select value={draft.team} onChange={(event) => setDraft({ ...draft, team: event.target.value })}>
            <option value="">не менять / не назначена</option>
            {Array.from(new Set([...deals.map((item) => item.schedule.team).filter(Boolean) as string[]])).map((team) => (
              <option key={team} value={team}>{team}</option>
            ))}
          </select>
        </label>
        <p className="form-note span-2">Остальное (адрес, заметки, напоминания) — в карточке сделки на вкладке «График».</p>
      </div>
    </Modal>
  );
}

export { eventsOfDay };
