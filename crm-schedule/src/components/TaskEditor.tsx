// Одна форма задачи для всех мест: список задач, карточка сделки, карточка клиента.
// Раньше задачу можно было только добавить и удалить, а поменять срок или текст —
// нигде. Теперь любая строка задачи открывается в этом окне.
import { useState } from 'react';
import { Bell, BellOff, CalendarDays, Check, Trash2 } from 'lucide-react';
import type { Deal, DealTask, ReminderChannel, ReminderPriority, TaskKind, TaskReminder, TaskRepeat } from '../types';
import { useApp } from '../store';
import { addDays, todayISO } from '../lib/dates';
import { REPEAT_LABELS, TASK_KINDS, taskKindMeta } from '../lib/crmTasks';
import {
  CHANNEL_META, PRIORITY_META, TASK_OFFSET_PRESETS, defaultTaskReminder, describeTaskReminder, fmtOffset,
} from '../lib/reminders';
import Modal from './Modal';

export interface TaskValues {
  title: string;
  kind: TaskKind;
  dueAt?: string;
  assignee?: string;
  repeat?: TaskRepeat;
  comment?: string;
  done: boolean;
  /** Личные напоминания: undefined — как в общих правилах, enabled:false — тишина. */
  reminder?: TaskReminder;
}

const CHANNELS: ReminderChannel[] = ['inapp', 'browser', 'sound', 'title'];
const PRIORITIES: ReminderPriority[] = ['low', 'normal', 'high'];

type ReminderMode = 'inherit' | 'custom' | 'off';

/** Значок в списках: у задачи своё напоминание или оно выключено. */
export function TaskBell({ reminder }: { reminder?: TaskReminder }) {
  if (!reminder) return null;
  const label = `Напоминание: ${describeTaskReminder(reminder)}`;
  return (
    <span className={`task-bell${reminder.enabled ? '' : ' off'}`} role="img" aria-label={label} title={label}>
      {reminder.enabled ? <Bell size={11} /> : <BellOff size={11} />}
    </span>
  );
}

const QUICK_DAYS: Array<{ label: string; days: number }> = [
  { label: 'сегодня', days: 0 },
  { label: 'завтра', days: 1 },
  { label: 'через неделю', days: 7 },
];

export default function TaskEditor({
  task,
  deals,
  dealId,
  onClose,
  onSave,
  onDelete,
  onToggleDone,
  formId = 'task-editor',
}: {
  /** Есть — редактируем, нет — создаём. */
  task?: DealTask;
  /** Сделки для выбора, если создаём из общего списка. */
  deals: Deal[];
  dealId?: string;
  onClose: () => void;
  onSave: (values: TaskValues, dealId: string) => void;
  onDelete?: () => void;
  onToggleDone?: () => void;
  formId?: string;
}) {
  const { settings, clientName } = useApp();
  const isNew = !task;
  const [values, setValues] = useState<TaskValues>({
    title: task?.title ?? '',
    kind: task?.kind ?? 'call',
    dueAt: task?.dueAt ?? '',
    assignee: task?.assignee ?? '',
    repeat: task?.repeat,
    comment: task?.comment ?? '',
    done: Boolean(task?.done),
  });
  const [target, setTarget] = useState(dealId ?? deals[0]?.id ?? '');
  const [error, setError] = useState('');
  const [mode, setMode] = useState<ReminderMode>(
    task?.reminder ? (task.reminder.enabled ? 'custom' : 'off') : 'inherit',
  );
  const [reminder, setReminder] = useState<TaskReminder>(task?.reminder ?? defaultTaskReminder());

  const assignees = Array.from(new Set([
    ...settings.managers,
    settings.myName,
    ...deals.flatMap((deal) => (deal.tasks ?? []).map((item) => item.assignee ?? '')),
    ...(task?.assignee ? [task.assignee] : []),
  ].map((name) => name.trim()).filter(Boolean))).sort((left, right) => left.localeCompare(right, 'ru'));

  const deal = deals.find((item) => item.id === target) ?? deals.find((item) => item.id === dealId);

  const submit = () => {
    const title = values.title.trim();
    if (!title) {
      setError('Напишите, что нужно сделать');
      return;
    }
    if (!target) {
      setError('Выберите сделку — задача живёт внутри сделки');
      return;
    }
    if (mode === 'custom' && reminder.offsets.length === 0) {
      setError('Выберите хотя бы один момент для напоминания');
      return;
    }
    onSave({
      ...values,
      title,
      dueAt: values.dueAt || undefined,
      assignee: (values.assignee ?? '').trim() || undefined,
      repeat: values.repeat || undefined,
      comment: values.comment?.trim() || undefined,
      reminder: mode === 'inherit'
        ? undefined
        : { ...reminder, enabled: mode === 'custom' },
    }, target);
  };

  return (
    <Modal
      title={isNew ? 'Новая задача' : 'Задача'}
      subtitle={deal ? `${clientName(deal)} · ${deal.title}` : 'Задача привязывается к сделке'}
      onClose={onClose}
      footer={(
        <>
          {!isNew && onDelete && (
            <button
              type="button"
              className="btn danger-ghost"
              onClick={() => {
                if (!confirm(`Удалить задачу «${values.title}»?`)) return;
                onDelete();
              }}
            >
              <Trash2 size={14} /> Удалить
            </button>
          )}
          <span className="foot-spacer" />
          {!isNew && onToggleDone && (
            <button type="button" className="btn ghost" onClick={onToggleDone}>
              <Check size={14} /> {values.done ? 'Вернуть в работу' : 'Выполнено'}
            </button>
          )}
          <button type="button" className="btn ghost" onClick={onClose}>Отмена</button>
          <button type="submit" form={formId} className="btn primary">{isNew ? 'Добавить задачу' : 'Сохранить'}</button>
        </>
      )}
    >
      <form
        id={formId}
        className="task-editor form-grid"
        onSubmit={(event) => { event.preventDefault(); submit(); }}
      >
        <label className="field span-2">Что сделать
          <input
            data-autofocus
            value={values.title}
            placeholder="позвонить, отправить документы, замерить"
            onChange={(event) => { setValues({ ...values, title: event.target.value }); setError(''); }}
          />
        </label>

        {isNew && (
          <label className="field span-2">Сделка
            <select value={target} onChange={(event) => { setTarget(event.target.value); setError(''); }}>
              <option value="">— выберите сделку —</option>
              {deals.map((item) => (
                <option key={item.id} value={item.id}>{clientName(item)} · {item.title}</option>
              ))}
            </select>
          </label>
        )}

        <label className="field">Тип
          <select value={values.kind} onChange={(event) => setValues({ ...values, kind: event.target.value as TaskKind })}>
            {TASK_KINDS.map((kind) => <option key={kind.id} value={kind.id}>{kind.label}</option>)}
          </select>
          <small className="field-hint">{taskKindMeta(values.kind).icon} {taskKindMeta(values.kind).label}</small>
        </label>

        <div className="field">
          <span className="field-label">Срок</span>
          <input type="date" value={values.dueAt ?? ''} aria-label="Срок" onChange={(event) => setValues({ ...values, dueAt: event.target.value })} />
          <div className="quick-row">
            {QUICK_DAYS.map((quick) => {
              const day = addDays(todayISO(), quick.days);
              return (
                <button
                  key={quick.label}
                  type="button"
                  className={`quick${values.dueAt === day ? ' active' : ''}`}
                  onClick={() => setValues({ ...values, dueAt: day })}
                >
                  {quick.label}
                </button>
              );
            })}
            <button
              type="button"
              className={`quick${values.dueAt ? '' : ' active'}`}
              onClick={() => setValues({ ...values, dueAt: '' })}
            >
              без срока
            </button>
          </div>
        </div>

        <label className="field">Исполнитель
          <input
            list={`${formId}-assignees`}
            value={values.assignee ?? ''}
            placeholder={settings.myName || 'кто делает'}
            onChange={(event) => setValues({ ...values, assignee: event.target.value })}
          />
          <datalist id={`${formId}-assignees`}>
            {assignees.map((name) => <option key={name} value={name} />)}
          </datalist>
        </label>

        <label className="field">Повтор
          <select
            value={values.repeat ?? ''}
            onChange={(event) => setValues({ ...values, repeat: (event.target.value || undefined) as TaskRepeat | undefined })}
          >
            <option value="">без повтора</option>
            {REPEAT_LABELS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
          <small className="field-hint">новая задача появится после выполнения</small>
        </label>

        <label className="field span-2">Комментарий
          <textarea
            rows={2}
            value={values.comment ?? ''}
            placeholder="что уточнить, о чём договорились"
            onChange={(event) => setValues({ ...values, comment: event.target.value })}
          />
        </label>

        <div className="field span-2 task-reminder-block">
          <span className="field-label">Напоминание об этой задаче</span>
          <div className="segmented reminder-mode" role="group" aria-label="Напоминание об этой задаче">
            <button type="button" className={mode === 'inherit' ? 'active' : ''} onClick={() => setMode('inherit')}>Как у всех</button>
            <button
              type="button"
              className={mode === 'custom' ? 'active' : ''}
              onClick={() => {
                setMode('custom');
                if (reminder.offsets.length === 0) setReminder({ ...reminder, offsets: [60] });
                setError('');
              }}
            >
              Своё
            </button>
            <button type="button" className={mode === 'off' ? 'active' : ''} onClick={() => setMode('off')}>Не напоминать</button>
          </div>

          {mode === 'inherit' && (
            <small className="field-hint">
              Действуют правила «Задачи» из «Данных» → «Напоминания».
            </small>
          )}
          {mode === 'off' && (
            <small className="field-hint">
              По этой задаче уведомлений не будет, даже если общие правила включены.
            </small>
          )}
          {mode === 'custom' && (
            <div className="task-reminder-body">
              <div className="task-reminder-row">
                <span className="field-label">Когда</span>
                <div className="quick-row">
                  {TASK_OFFSET_PRESETS.map((preset) => {
                    const has = reminder.offsets.includes(preset.minutes);
                    return (
                      <button
                        key={preset.minutes}
                        type="button"
                        className={`quick${has ? ' active' : ''}`}
                        onClick={() => setReminder({
                          ...reminder,
                          offsets: has
                            ? reminder.offsets.filter((item) => item !== preset.minutes)
                            : [...reminder.offsets, preset.minutes].sort((left, right) => right - left),
                        })}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>
                {reminder.offsets.length === 0 && (
                  <small className="field-hint">Пока ничего не выбрано — напоминать не о чем.</small>
                )}
              </div>

              <div className="task-reminder-row two">
                <label className="field">Время дня
                  <input
                    type="time"
                    value={reminder.atTime ?? '09:00'}
                    onChange={(event) => setReminder({ ...reminder, atTime: event.target.value })}
                  />
                  <small className="field-hint">если у задачи только дата</small>
                </label>
                <label className="field">Важность
                  <select
                    value={reminder.priority ?? 'normal'}
                    onChange={(event) => setReminder({ ...reminder, priority: event.target.value as ReminderPriority })}
                  >
                    {PRIORITIES.map((priority) => (
                      <option key={priority} value={priority}>{PRIORITY_META[priority].label}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="task-reminder-row">
                <span className="field-label">Куда</span>
                <div className="quick-row">
                  {CHANNELS.map((channel) => {
                    const channels = reminder.channels ?? ['inapp'];
                    const has = channels.includes(channel);
                    return (
                      <button
                        key={channel}
                        type="button"
                        className={`quick${has ? ' active' : ''}`}
                        title={CHANNEL_META[channel].hint}
                        onClick={() => {
                          const next = has
                            ? channels.filter((item) => item !== channel)
                            : [...channels, channel];
                          setReminder({ ...reminder, channels: next.length > 0 ? next : ['inapp'] });
                        }}
                      >
                        {CHANNEL_META[channel].label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="quick-row">
                <label className="chip-toggle">
                  <input
                    type="checkbox"
                    checked={Boolean(reminder.repeatDaily)}
                    onChange={(event) => setReminder({ ...reminder, repeatDaily: event.target.checked })}
                  />
                  каждый день, пока не выполнена
                </label>
                <label className="chip-toggle">
                  <input
                    type="checkbox"
                    checked={reminder.respectQuietHours !== false}
                    onChange={(event) => setReminder({ ...reminder, respectQuietHours: event.target.checked })}
                  />
                  не будить в тихие часы
                </label>
              </div>

              {!values.dueAt && (
                <small className="field-hint tone-overdue">
                  Без срока напоминание не сработает — выберите дату выше.
                </small>
              )}
              <small className="field-hint">
                Будет: {describeTaskReminder({ ...reminder, enabled: true })}
                {reminder.offsets.length > 0
                  ? ` · ${reminder.offsets.slice().sort((left, right) => right - left).map(fmtOffset).join(', ')}`
                  : ''}
              </small>
            </div>
          )}
        </div>

        {error && <p className="field-error span-2" role="alert">{error}</p>}

        {task?.origin?.startsWith('auto:') && (
          <p className="form-note span-2">
            <CalendarDays size={13} /> Задачу поставила автоматика. Если она нужна постоянно, поправьте правило в «Данных».
          </p>
        )}
      </form>
    </Modal>
  );
}
