// Поля графика сделки: замер, готовность, доставка, монтаж, бригада и адрес.
// Один компонент используется и в карточке сделки, и в быстрой правке из графика.

import type { Deal, DealSchedule, ScheduleStatus } from '../types';
import { addDays, todayISO } from '../lib/dates';
import { SCHEDULE_STATUSES } from '../lib/schedule';
import { useApp } from '../store';

export default function ScheduleFields({ deal, compact = false }: { deal: Deal; compact?: boolean }) {
  const { updateSchedule, settings } = useApp();
  const schedule = deal.schedule;
  const patch = (value: Partial<DealSchedule>) => updateSchedule(deal.id, value);
  const today = todayISO();

  const warning = schedule.readyAt && schedule.installAt && schedule.readyAt > schedule.installAt
    ? 'Монтаж назначен раньше готовности на фабрике'
    : schedule.deliveryAt && schedule.installAt && schedule.deliveryAt > schedule.installAt
      ? 'Доставка назначена позже монтажа'
      : schedule.installAt && !schedule.address?.trim()
        ? 'У монтажа не заполнен адрес'
        : schedule.installAt && !schedule.team?.trim()
          ? 'Не назначена бригада'
          : '';

  return (
    <div className={`schedule-fields${compact ? ' compact' : ''}`}>
      <div className="form-grid">
        <label className="field">Замер
          <div className="date-with-quick">
            <input type="date" value={schedule.measureAt ?? ''} onChange={(event) => patch({ measureAt: event.target.value || undefined })} />
            <button type="button" className="quick" onClick={() => patch({ measureAt: today })}>сегодня</button>
          </div>
        </label>
        <label className="field">Готовность на фабрике
          <div className="date-with-quick">
            <input type="date" value={schedule.readyAt ?? ''} onChange={(event) => patch({ readyAt: event.target.value || undefined })} />
            <button type="button" className="quick" onClick={() => patch({ readyAt: addDays(today, 14) })}>+2 нед</button>
          </div>
        </label>
        <label className="field">Доставка
          <div className="date-with-quick">
            <input type="date" value={schedule.deliveryAt ?? ''} onChange={(event) => patch({ deliveryAt: event.target.value || undefined })} />
            <button type="button" className="quick" onClick={() => patch({ deliveryAt: schedule.installAt ? addDays(schedule.installAt, -1) : addDays(today, 7) })}>перед монтажом</button>
          </div>
        </label>
        <label className="field">Монтаж
          <div className="date-with-quick">
            <input type="date" value={schedule.installAt ?? ''} onChange={(event) => patch({ installAt: event.target.value || undefined })} />
            <button type="button" className="quick" onClick={() => patch({ installAt: today })}>сегодня</button>
          </div>
        </label>
        <label className="field">Дней на монтаж
          <input
            type="number"
            min={1}
            max={14}
            value={schedule.installDays ?? 1}
            onChange={(event) => patch({ installDays: Math.max(1, Math.min(14, Number(event.target.value) || 1)) })}
          />
        </label>
        <label className="field">Статус графика
          <select value={schedule.status} onChange={(event) => patch({ status: event.target.value as ScheduleStatus })}>
            {SCHEDULE_STATUSES.map((status) => <option key={status.id} value={status.id}>{status.label}</option>)}
          </select>
        </label>
        <label className="field">Бригада
          <input
            list="teams-list"
            value={schedule.team ?? ''}
            placeholder="Бригада 1 — Сергей"
            onChange={(event) => patch({ team: event.target.value })}
          />
          <datalist id="teams-list">
            {settings.teams.map((team) => <option key={team} value={team} />)}
          </datalist>
        </label>
        <label className="field">Телефон на объекте
          <input value={schedule.phone ?? ''} inputMode="tel" placeholder="+7 …" onChange={(event) => patch({ phone: event.target.value })} />
        </label>
        <label className="field span-2">Адрес монтажа
          <input value={schedule.address ?? ''} placeholder="улица, дом, квартира" onChange={(event) => patch({ address: event.target.value })} />
        </label>
        <label className="field span-2">Заметка для бригады
          <textarea
            rows={2}
            value={schedule.note ?? ''}
            placeholder="Заезд, парковка, пропуск, особенности объекта"
            onChange={(event) => patch({ note: event.target.value })}
          />
        </label>
      </div>
      {warning && <div className="inline-warning">⚠ {warning}</div>}
    </div>
  );
}
