// Свободное событие графика: встреча, отгрузка, обучение, выходной —
// всё, что нужно видеть в календаре, но ради чего сделку не заводят.
import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useApp } from '../store';
import type { CalendarEvent } from '../types';
import { fmtDate } from '../lib/dates';
import Modal from './Modal';

const CATEGORY_HINTS = ['Встреча', 'Созвон', 'Отгрузка', 'Выезд', 'Обучение', 'Совещание', 'Выходной', 'Праздник'];

export default function CalendarEventDialog(props: {
  /** Существующее событие — режим правки; без него создаём новое. */
  item?: CalendarEvent;
  /** День, с которого открыли редактор. */
  date: string;
  onClose: () => void;
}) {
  const { settings, addCalendarEvent, updateCalendarEvent, removeCalendarEvent, notify } = useApp();
  const item = props.item;
  const [draft, setDraft] = useState({
    title: item?.title ?? '',
    date: item?.date ?? props.date,
    timeStart: item?.timeStart ?? '',
    timeEnd: item?.timeEnd ?? '',
    days: item?.days ?? 1,
    category: item?.category ?? '',
    team: item?.team ?? '',
    place: item?.place ?? '',
    note: item?.note ?? '',
  });
  const [confirmDelete, setConfirmDelete] = useState(false);

  const save = () => {
    const title = draft.title.trim();
    if (!title) {
      notify('Укажите название события', 'error');
      return;
    }
    if (!draft.date) {
      notify('Укажите дату события', 'error');
      return;
    }
    const input = {
      title,
      date: draft.date,
      timeStart: draft.timeStart || undefined,
      timeEnd: draft.timeEnd || undefined,
      days: Math.max(1, Math.min(14, Math.round(draft.days || 1))),
      category: draft.category.trim() || undefined,
      team: draft.team.trim() || undefined,
      place: draft.place.trim() || undefined,
      note: draft.note.trim() || undefined,
    };
    if (item) {
      updateCalendarEvent(item.id, input);
      notify(`Событие «${title}» — ${fmtDate(input.date)}`, 'ok');
    } else {
      addCalendarEvent(input);
      notify(`Событие «${title}» добавлено на ${fmtDate(input.date)}`, 'ok');
    }
    props.onClose();
  };

  return (
    <Modal
      title={item ? 'Событие графика' : 'Новое событие'}
      subtitle={item ? `${fmtDate(item.date, { withYear: true })} · без сделки и клиента` : 'Без сделки и клиента — сразу в календарь'}
      onClose={props.onClose}
      footer={(
        <>
          {item && (
            confirmDelete ? (
              <>
                <button
                  type="button"
                  className="btn danger-ghost"
                  onClick={() => { removeCalendarEvent(item.id); props.onClose(); }}
                >
                  Точно удалить
                </button>
                <button type="button" className="btn ghost" onClick={() => setConfirmDelete(false)}>Оставить</button>
              </>
            ) : (
              <button type="button" className="btn danger-ghost" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={14} /> Удалить
              </button>
            )
          )}
          <span className="foot-spacer" />
          <button type="button" className="btn ghost" onClick={props.onClose}>Отмена</button>
          <button type="button" className="btn primary" onClick={save}>{item ? 'Сохранить' : 'Добавить в график'}</button>
        </>
      )}
    >
      <div className="form-grid">
        <label className="field span-2">Название события
          <input
            data-autofocus
            value={draft.title}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            placeholder="Например: обучение по фурнитуре, выходной Ивана"
          />
        </label>
        <label className="field">Дата
          <input type="date" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} />
        </label>
        <label className="field">Длительность, дней
          <input
            type="number"
            min={1}
            max={14}
            value={draft.days}
            onChange={(event) => setDraft({ ...draft, days: Number(event.target.value) || 1 })}
          />
        </label>
        <label className="field">Время с
          <input type="time" value={draft.timeStart} onChange={(event) => setDraft({ ...draft, timeStart: event.target.value })} />
        </label>
        <label className="field">Время до
          <input type="time" value={draft.timeEnd} onChange={(event) => setDraft({ ...draft, timeEnd: event.target.value })} />
        </label>
        <label className="field">Вид события
          <input
            value={draft.category}
            onChange={(event) => setDraft({ ...draft, category: event.target.value })}
            placeholder="встреча, выходной, отгрузка…"
            list="calendar-event-categories"
          />
          <datalist id="calendar-event-categories">
            {CATEGORY_HINTS.map((hint) => <option key={hint} value={hint} />)}
          </datalist>
        </label>
        <label className="field">Кто / бригада
          <input
            value={draft.team}
            onChange={(event) => setDraft({ ...draft, team: event.target.value })}
            placeholder="кому относится"
            list="calendar-event-teams"
          />
          <datalist id="calendar-event-teams">
            {settings.teams.map((team) => <option key={team} value={team} />)}
            {settings.managers.map((name) => <option key={name} value={name} />)}
          </datalist>
        </label>
        <label className="field span-2">Место
          <input
            value={draft.place}
            onChange={(event) => setDraft({ ...draft, place: event.target.value })}
            placeholder="адрес или «салон», «склад», «фабрика»"
          />
        </label>
        <label className="field span-2">Заметка
          <textarea
            rows={2}
            value={draft.note}
            onChange={(event) => setDraft({ ...draft, note: event.target.value })}
            placeholder="что взять, кому позвонить, детали"
          />
        </label>
        <p className="form-note span-2">
          Событие видно в месяце, неделе и списке дней всем сотрудникам фирмы — сделки и клиента ради него заводить не нужно.
        </p>
      </div>
    </Modal>
  );
}
