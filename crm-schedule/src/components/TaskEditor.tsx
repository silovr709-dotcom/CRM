// Одна форма задачи для всех мест: список задач, карточка сделки, карточка клиента.
// Раньше задачу можно было только добавить и удалить, а поменять срок или текст —
// нигде. Теперь любая строка задачи открывается в этом окне.
import { useState } from 'react';
import { CalendarDays, Check, Trash2 } from 'lucide-react';
import type { Deal, DealTask, TaskKind, TaskRepeat } from '../types';
import { useApp } from '../store';
import { addDays, todayISO } from '../lib/dates';
import { REPEAT_LABELS, TASK_KINDS, taskKindMeta } from '../lib/crmTasks';
import Modal from './Modal';

export interface TaskValues {
  title: string;
  kind: TaskKind;
  dueAt?: string;
  assignee?: string;
  repeat?: TaskRepeat;
  comment?: string;
  done: boolean;
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
    onSave({
      ...values,
      title,
      dueAt: values.dueAt || undefined,
      assignee: (values.assignee ?? '').trim() || undefined,
      repeat: values.repeat || undefined,
      comment: values.comment?.trim() || undefined,
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
            autoFocus
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
