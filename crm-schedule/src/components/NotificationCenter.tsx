// Центр напоминаний: колокольчик с панелью — что сработало, что скоро, что отложено.
import { useMemo, useState } from 'react';
import {
  AlarmClock, Bell, BellRing, CalendarClock, Check, ChevronDown, Clock, Moon, Settings2, X,
} from 'lucide-react';
import type { PlannedReminder } from '../lib/reminders';
import { PRIORITY_META, SOURCE_META, snoozePresets } from '../lib/reminders';
import { fmtDate, fmtDateTime, todayISO } from '../lib/dates';
import type { ReminderApi } from '../lib/useReminders';
import { notifyPermission } from '../lib/notify';

function timeOf(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function dayLabel(iso: string, today = todayISO()): string {
  const date = new Date(iso);
  const day = date.toISOString().slice(0, 10);
  if (day === today) return 'Сегодня';
  const tomorrow = new Date(`${today}T12:00:00`);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (day === tomorrow.toISOString().slice(0, 10)) return 'Завтра';
  return fmtDate(day);
}

export default function NotificationCenter({
  reminders,
  onOpenDeal,
  onOpenSettings,
  floating = false,
}: {
  reminders: ReminderApi;
  onOpenDeal?: (id: string) => void;
  onOpenSettings?: () => void;
  floating?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [snoozeFor, setSnoozeFor] = useState<string>('');
  const presets = useMemo(() => snoozePresets(), [open]);

  const badge = reminders.active.length + reminders.waiting.length;
  const permission = notifyPermission();
  const grouped = useMemo(() => {
    const groups = new Map<string, PlannedReminder[]>();
    for (const reminder of reminders.upcoming) {
      const label = dayLabel(reminder.notifyAt);
      groups.set(label, [...(groups.get(label) ?? []), reminder]);
    }
    return Array.from(groups.entries());
  }, [reminders.upcoming]);

  return (
    <div className={`nc${floating ? ' nc-floating' : ''}`}>
      <button
        type="button"
        className={`side-reminders${badge > 0 ? ' has' : ''}${floating ? ' round' : ''}`}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={`Напоминания${badge > 0 ? `: ${badge}` : ''}`}
      >
        {badge > 0 ? <BellRing size={16} /> : <Bell size={16} />}
        {!floating && <span>Напоминания</span>}
        {badge > 0 && <b className="nav-badge">{badge > 9 ? '9+' : badge}</b>}
      </button>

      {open && (
        <div className="nc-panel" role="dialog" aria-label="Центр напоминаний">
          <header className="nc-head">
            <div>
              <b>Напоминания</b>
              <span className="muted small">
                включено правил: {reminders.rulesActive} из {reminders.rulesTotal}
              </span>
            </div>
            <div className="nc-head-actions">
              <button type="button" className="icon-btn" title="Настройки напоминаний" aria-label="Настройки напоминаний" onClick={() => { setOpen(false); onOpenSettings?.(); }}>
                <Settings2 size={15} />
              </button>
              <button type="button" className="icon-btn" title="Закрыть" aria-label="Закрыть" onClick={() => setOpen(false)}>
                <X size={15} />
              </button>
            </div>
          </header>

          {!reminders.enabled && (
            <div className="nc-note nc-note-muted">
              <Bell size={13} />
              <span>Напоминания выключены — правила не срабатывают.</span>
              <button type="button" className="link-btn" onClick={() => { setOpen(false); onOpenSettings?.(); }}>Включить</button>
            </div>
          )}

          {reminders.enabled && permission !== 'granted' && (
            <div className="nc-note">
              <Bell size={13} />
              <span>
                Системные уведомления {permission === 'denied' ? 'запрещены в браузере' : 'не включены'} —
                сейчас напоминания видны только внутри приложения.
              </span>
              <button type="button" className="link-btn" onClick={() => { setOpen(false); onOpenSettings?.(); }}>Включить</button>
            </div>
          )}

          {reminders.waiting.length > 0 && (
            <section className="nc-section">
              <h4><Moon size={13} /> Ждут конца тихих часов</h4>
              {reminders.waiting.map((reminder) => (
                <ReminderRow
                  key={reminder.id}
                  reminder={reminder}
                  onOpen={onOpenDeal}
                  onSnooze={(until) => reminders.snooze(reminder.id, until)}
                  onDismiss={() => reminders.dismiss(reminder.id)}
                  snoozeOpen={snoozeFor === reminder.id}
                  setSnoozeOpen={(value) => setSnoozeFor(value ? reminder.id : '')}
                  presets={presets}
                />
              ))}
            </section>
          )}

          <section className="nc-section">
            <h4><AlarmClock size={13} /> Сейчас {reminders.active.length > 0 && <span className="nc-count">{reminders.active.length}</span>}</h4>
            {reminders.active.length === 0 ? (
              <p className="nc-empty">Новых напоминаний нет. Всё под контролем.</p>
            ) : (
              <>
                {reminders.active.map((reminder) => (
                  <ReminderRow
                    key={reminder.id}
                    reminder={reminder}
                    onOpen={onOpenDeal}
                    onSnooze={(until) => reminders.snooze(reminder.id, until)}
                    onDismiss={() => reminders.dismiss(reminder.id)}
                    snoozeOpen={snoozeFor === reminder.id}
                    setSnoozeOpen={(value) => setSnoozeFor(value ? reminder.id : '')}
                    presets={presets}
                  />
                ))}
                <button type="button" className="link-btn nc-clear" onClick={reminders.dismissAll}>
                  <Check size={13} /> Убрать все
                </button>
              </>
            )}
          </section>

          <section className="nc-section">
            <h4><CalendarClock size={13} /> Ближайшие</h4>
            {grouped.length === 0 ? (
              <p className="nc-empty">В следующие дни напоминаний нет.</p>
            ) : (
              grouped.map(([label, items]) => (
                <div key={label} className="nc-day">
                  <div className="nc-day-title">{label}</div>
                  {items.map((reminder) => (
                    <ReminderRow
                      key={reminder.id}
                      reminder={reminder}
                      onOpen={onOpenDeal}
                      presets={presets}
                      onSnooze={(until) => reminders.snooze(reminder.id, until)}
                      onDismiss={() => reminders.dismiss(reminder.id)}
                      snoozeOpen={snoozeFor === reminder.id}
                      setSnoozeOpen={(value) => setSnoozeFor(value ? reminder.id : '')}
                      quiet
                    />
                  ))}
                </div>
              ))
            )}
          </section>

          <footer className="nc-foot">
            <button type="button" className="link-btn" onClick={reminders.refresh}>
              <Clock size={13} /> Обновить
            </button>
            <span className="muted small">проверка каждые 30 секунд</span>
          </footer>
        </div>
      )}
    </div>
  );
}

function ReminderRow({
  reminder, onOpen, onSnooze, onDismiss, snoozeOpen, setSnoozeOpen, presets, quiet,
}: {
  reminder: PlannedReminder;
  onOpen?: (id: string) => void;
  onSnooze: (until: Date) => void;
  onDismiss: () => void;
  snoozeOpen: boolean;
  setSnoozeOpen: (value: boolean) => void;
  presets: Array<{ label: string; until: Date }>;
  quiet?: boolean;
}) {
  const source = SOURCE_META[reminder.source];
  const when = reminder.source === 'digest' || quiet
    ? timeOf(reminder.notifyAt)
    : timeOf(reminder.notifyAt);

  return (
    <div className={`nc-item priority-${reminder.priority}${quiet ? ' quiet' : ''}`}>
      <div className="nc-time">
        <b>{when}</b>
        <span>{quiet ? dayLabel(reminder.notifyAt) === 'Сегодня' ? 'сегодня' : dayLabel(reminder.notifyAt) : timeOf(reminder.momentAt)}</span>
      </div>
      <div className="nc-main">
        <b className="nc-title">
          {reminder.dealId && onOpen ? (
            <button type="button" className="link-btn" onClick={() => onOpen(reminder.dealId as string)}>{reminder.title}</button>
          ) : reminder.title}
        </b>
        {reminder.detail && <span className="nc-detail">{reminder.detail}</span>}
        <span className="nc-meta">
          {source.label} · {reminder.ruleLabel}
          {reminder.priority === 'high' && <i className="nc-dot" title={PRIORITY_META.high.label} />}
        </span>
      </div>
      <div className="nc-actions">
        <div className="nc-snooze">
          <button
            type="button"
            className="icon-btn"
            aria-expanded={snoozeOpen}
            aria-label="Отложить"
            title="Отложить"
            onClick={() => setSnoozeOpen(!snoozeOpen)}
          >
            <Clock size={15} />
          </button>
          {snoozeOpen && (
            <div className="nc-snooze-menu">
              <b>Отложить на</b>
              {presets.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => { onSnooze(preset.until); setSnoozeOpen(false); }}
                >
                  {preset.label}
                  <small>{fmtDateTime(preset.until.toISOString())}</small>
                </button>
              ))}
            </div>
          )}
        </div>
        {quiet ? (
          <ChevronDown size={14} className="nc-quiet" aria-hidden="true" />
        ) : (
          <button type="button" className="icon-btn" aria-label="Убрать" title="Убрать" onClick={onDismiss}>
            <Check size={15} />
          </button>
        )}
      </div>
    </div>
  );
}
