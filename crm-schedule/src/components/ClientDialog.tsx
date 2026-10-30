// Карточка клиента: контакты, сделки, задачи, документы, история, объединение дублей.
// Задачи живут в сделках, но редактировать их можно прямо здесь — как в карточке сделки.
import { useMemo, useState } from 'react';
import {
  CheckCheck, Copy, Link2, Merge, MessageSquare, Pencil, Phone, Plus, Trash2,
} from 'lucide-react';
import type { Client, DealTask } from '../types';
import { useApp } from '../store';
import {
  digitsOnly, fmtDate, fmtDateTime, fmtMoney, fmtMoneyCompact, relativeDay, telHref, todayISO,
} from '../lib/dates';
import { isClosedStatus, statusMeta } from '../lib/crm';
import { buildClientTimeline, TIMELINE_META } from '../lib/crmTimeline';
import {
  addTask, allTasks, patchTask, postponeTask, removeTask, REPEAT_LABELS, taskKindMeta,
  toggleTask, type TaskTone,
} from '../lib/crmTasks';
import { findDuplicateClients } from '../lib/storage';
import { absoluteLink } from '../lib/router';
import { ContactActions, ContactLine } from './ContactActions';
import Modal from './Modal';
import Attachments from './Attachments';
import EmptyState from './EmptyState';
import TaskEditor, { TaskBell } from './TaskEditor';

const TABS = [
  { id: 'overview', label: 'Обзор' },
  { id: 'tasks', label: 'Задачи' },
  { id: 'files', label: 'Файлы' },
  { id: 'history', label: 'История' },
] as const;

type ClientTab = typeof TABS[number]['id'];

const TONE_GROUPS: Array<{ id: TaskTone; title: string }> = [
  { id: 'overdue', title: 'Просрочено' },
  { id: 'today', title: 'Сегодня' },
  { id: 'soon', title: 'Ближайшие дни' },
  { id: 'later', title: 'Позже' },
  { id: 'none', title: 'Без срока' },
];

function emptyClient(): Client {
  const stamp = new Date().toISOString();
  return {
    id: '',
    name: '',
    phones: [],
    emails: [],
    address: '',
    source: '',
    tags: [],
    managerComment: '',
    createdAt: stamp,
    updatedAt: stamp,
  };
}

export default function ClientDialog({ clientId, onClose, onOpenDeal, onNewDeal }: {
  clientId: string;
  onClose: () => void;
  onOpenDeal: (id: string) => void;
  onNewDeal: (clientId: string) => void;
}) {
  const {
    clients, deals, saveClient, removeClient, mergeClients, updateDeal, notify,
  } = useApp();
  const existing = clients.find((item) => item.id === clientId);
  /** Живая карточка из стора: вложения добавляются мимо формы. */
  const live = clients.find((item) => item.id === clientId);
  const [draft, setDraft] = useState<Client>(() => existing ? { ...existing } : emptyClient());
  const [phonesText, setPhonesText] = useState((existing?.phones ?? []).join('\n'));
  const [emailsText, setEmailsText] = useState((existing?.emails ?? []).join('\n'));
  const [tagsText, setTagsText] = useState((existing?.tags ?? []).join(', '));
  const [tab, setTab] = useState<ClientTab>('overview');
  const [editor, setEditor] = useState<{ dealId?: string; task?: DealTask } | null>(null);
  const isNew = !existing;

  const clientDeals = useMemo(
    () => deals.filter((deal) => deal.clientId === clientId).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [deals, clientId],
  );
  const timeline = useMemo(() => buildClientTimeline(clientDeals, 10), [clientDeals]);
  const fullTimeline = useMemo(() => buildClientTimeline(clientDeals, 60), [clientDeals]);
  const openSum = clientDeals.filter((deal) => !isClosedStatus(deal.status)).reduce((sum, deal) => sum + deal.amount, 0);
  const today = todayISO();

  const clientTasks = useMemo(() => allTasks(clientDeals, today), [clientDeals, today]);
  const openClientTasks = clientTasks.filter(({ task }) => !task.done);
  const doneClientTasks = clientTasks.filter(({ task }) => task.done);
  const activeDeals = clientDeals.filter((deal) => !isClosedStatus(deal.status));
  const taskDeals = activeDeals.length > 0 ? activeDeals : clientDeals;

  const duplicates = useMemo(() => {
    if (isNew) return [];
    const groups = findDuplicateClients(clients);
    const mine = groups.filter((group) => group.clients.some((client) => client.id === clientId));
    return mine.flatMap((group) => group.clients.filter((client) => client.id !== clientId));
  }, [clients, clientId, isNew]);

  const candidates = useMemo(
    () => clients.filter((client) => client.id !== clientId && client.name.trim().toLocaleLowerCase('ru-RU') === draft.name.trim().toLocaleLowerCase('ru-RU')),
    [clients, clientId, draft.name],
  );

  /** Что изменили относительно сохранённого — чтобы не потерять правки при закрытии. */
  const dirty = Boolean(!isNew && existing && (
    draft.name.trim() !== existing.name
    || phonesText !== (existing.phones ?? []).join('\n')
    || emailsText !== (existing.emails ?? []).join('\n')
    || tagsText !== (existing.tags ?? []).join(', ')
    || (draft.address ?? '') !== (existing.address ?? '')
    || (draft.source ?? '') !== (existing.source ?? '')
    || (draft.managerComment ?? '') !== (existing.managerComment ?? '')
  ));

  const buildClient = (): Client | null => {
    const name = draft.name.trim();
    if (!name) return null;
    const fresh = clients.find((item) => item.id === clientId);
    return {
      ...draft,
      // Вложения живут отдельно от формы: не затираем то, что добавили в другом окне.
      attachments: fresh?.attachments ?? draft.attachments ?? [],
      name,
      phones: phonesText.split(/[\n,;]+/).map((value) => value.trim()).filter(Boolean),
      emails: emailsText.split(/[\n,;]+/).map((value) => value.trim()).filter(Boolean),
      tags: tagsText.split(/[,;]+/).map((value) => value.trim()).filter(Boolean),
      id: existing?.id ?? '',
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };
  };

  /** Сохранить правки молча — при закрытии карточки, если что-то поменяли. */
  const keepEdits = () => {
    if (isNew || !dirty) return;
    const saved = buildClient();
    if (saved) saveClient(saved);
  };

  const save = () => {
    const saved = buildClient();
    if (!saved) { notify('У клиента должно быть имя', 'error'); return; }
    const id = saveClient(saved);
    notify(isNew ? 'Клиент добавлен' : 'Клиент сохранён');
    onClose();
    if (isNew) onNewDeal(id);
  };

  const close = () => {
    keepEdits();
    onClose();
  };

  const phone = (existing?.phones ?? [])[0] ?? '';

  return (
    <Modal
      title={isNew ? 'Новый клиент' : draft.name || 'Клиент'}
      subtitle={isNew ? 'Имя обязательно, остальное можно позже.' : `В базе с ${fmtDate(draft.createdAt?.slice(0, 10))}`}
      onClose={close}
      size="lg"
      headExtra={!isNew && phone ? (
        <div className="deal-head-actions">
          <a className="btn small primary" href={telHref(phone)} title={phone}>
            <Phone size={15} /> Позвонить
          </a>
          <a className="btn small ghost" href={`https://wa.me/${digitsOnly(phone)}`} target="_blank" rel="noreferrer" aria-label="Написать в WhatsApp" title="Написать в WhatsApp">
            <MessageSquare size={15} /> WhatsApp
          </a>
        </div>
      ) : undefined}
      footer={(
        <>
          {!isNew && (
            <button type="button" className="btn danger-ghost" onClick={() => {
              if (!confirm(`Удалить клиента «${draft.name}»? Сделки останутся без клиента.`)) return;
              removeClient(clientId);
              onClose();
            }}>
              <Trash2 size={14} /> Удалить
            </button>
          )}
          <span className="foot-spacer" />
          {!isNew && <button type="button" className="btn ghost" onClick={() => { keepEdits(); onNewDeal(clientId); }}><Plus size={14} /> Сделка</button>}
          <button type="button" className="btn primary" onClick={save}>{isNew ? 'Добавить клиента' : 'Сохранить'}</button>
        </>
      )}
    >
      {!isNew && (
        <nav className="tabs" aria-label="Разделы карточки">
          {TABS.map((item) => (
            <button key={item.id} type="button" className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}>
              {item.label}
              {item.id === 'tasks' && openClientTasks.length > 0 && <b>{openClientTasks.length}</b>}
              {item.id === 'files' && (live?.attachments?.length ?? 0) > 0 && <b>{live?.attachments?.length}</b>}
            </button>
          ))}
        </nav>
      )}

      {tab === 'overview' && (
        <div className="client-grid">
          <div className="form-grid">
            <label className="field span-2">Имя
              <input data-autofocus value={draft.name} placeholder="Анна Смирнова" onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
            </label>
            <label className="field">Телефоны
              <textarea rows={2} value={phonesText} placeholder="+7 900 000-00-00" inputMode="tel" autoComplete="tel" onChange={(event) => setPhonesText(event.target.value)} />
              <small className="field-hint">по одному в строке</small>
            </label>
            <label className="field">Почта
              <textarea rows={2} value={emailsText} placeholder="anna@example.ru" inputMode="email" autoComplete="email" onChange={(event) => setEmailsText(event.target.value)} />
            </label>
            <label className="field span-2">Адрес
              <input value={draft.address ?? ''} placeholder="город, улица, дом" onChange={(event) => setDraft({ ...draft, address: event.target.value })} />
            </label>
            <label className="field">Источник
              <input value={draft.source ?? ''} placeholder="сайт, знакомые, Авито" onChange={(event) => setDraft({ ...draft, source: event.target.value })} />
            </label>
            <label className="field">Метки
              <input value={tagsText} placeholder="VIP, повторный" onChange={(event) => setTagsText(event.target.value)} />
            </label>
            <label className="field span-2">Заметка
              <textarea rows={2} value={draft.managerComment ?? ''} placeholder="о клиенте, о квартире, о договорённостях" onChange={(event) => setDraft({ ...draft, managerComment: event.target.value })} />
            </label>
          </div>

          {!isNew && (
            <div className="client-side">
              <div className="info-card">
                <h3>Итого</h3>
                <b>{openSum ? fmtMoney(openSum) : '—'}</b>
                <span className="muted small">в активных сделках</span>
                <span className="muted small">всего сделок: {clientDeals.length}</span>
                <div className="contact-actions">
                  {phonesText && <a className="btn small ghost" href={telHref(phonesText.split(/[\n,;]+/)[0])}><Phone size={13} /> Позвонить</a>}
                  <button
                    type="button"
                    className="btn small ghost"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(absoluteLink({ view: 'crm', clientId }));
                        notify('Ссылка на клиента скопирована');
                      } catch { notify('Не удалось скопировать', 'error'); }
                    }}
                  >
                    <Link2 size={13} /> Ссылка
                  </button>
                </div>
              </div>

              {(duplicates.length > 0 || candidates.length > 0) && (
                <div className="info-card warn-card">
                  <h3><Copy size={13} /> Похожие карточки</h3>
                  <p className="muted small">Похоже, это тот же клиент. Объедините — сделки перейдут в эту карточку.</p>
                  <div className="merge-list">
                    {[...new Set([...duplicates.map((client) => client.id), ...candidates.map((client) => client.id)])].map((id) => {
                      const client = clients.find((item) => item.id === id);
                      if (!client) return null;
                      return (
                        <button
                          key={id}
                          type="button"
                          className="btn small ghost"
                          onClick={() => {
                            if (!confirm(`Объединить «${client.name}» с текущей карточкой?`)) return;
                            mergeClients(clientId, id);
                            notify('Карточки объединены');
                            onClose();
                          }}
                        >
                          <Merge size={13} /> {client.name}{client.phones[0] ? ` · ${client.phones[0]}` : ''}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="info-card">
                <h3>Сделки</h3>
                {clientDeals.length === 0 ? (
                  <span className="muted small">Сделок нет.</span>
                ) : (
                  <ul className="mini-deal-list">
                    {clientDeals.map((deal) => {
                      const meta = statusMeta(deal.status);
                      return (
                        <li key={deal.id}>
                          <button type="button" className="mini-deal" onClick={() => onOpenDeal(deal.id)}>
                            <span>
                              <b>{deal.title}</b>
                              <small>{meta.label}{deal.nextContactAt ? ` · ${relativeDay(deal.nextContactAt, today)}` : ''}</small>
                              {(deal.contacts?.length ?? 0) > 0 && <ContactLine deal={deal} />}
                            </span>
                            <span className="mini-deal-sum">{deal.amount ? fmtMoneyCompact(deal.amount) : '—'}</span>
                          </button>
                          <div className="mini-contact">
                            <ContactActions deal={deal} compact />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {timeline.length > 0 && (
                <div className="info-card">
                  <h3>Последние события</h3>
                  <ul className="timeline mini">
                    {timeline.map((event) => (
                      <li key={event.id} className={`timeline-row timeline-${event.kind}`}>
                        <span className="timeline-icon">{TIMELINE_META[event.kind]?.icon ?? '•'}</span>
                        <span className="timeline-main"><b>{event.title}</b>{event.detail && <span>{event.detail}</span>}</span>
                        <span className="timeline-date">{fmtDate(event.at.slice(0, 10))}</span>
                      </li>
                    ))}
                  </ul>
                  <button type="button" className="link-btn" onClick={() => setTab('history')}>вся история →</button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {!isNew && tab === 'tasks' && (
        <div className="client-tasks">
          <div className="task-toolbar">
            <span className="muted">
              Открытых: {openClientTasks.length}
              {doneClientTasks.length > 0 ? ` · выполнено: ${doneClientTasks.length}` : ''}
            </span>
            <button
              type="button"
              className="btn small primary"
              onClick={() => setEditor({ dealId: taskDeals[0]?.id })}
              disabled={taskDeals.length === 0}
            >
              <Plus size={14} /> Задача
            </button>
          </div>

          {clientDeals.length === 0 ? (
            <EmptyState
              icon={<CheckCheck size={24} />}
              title="Пока некуда ставить задачи"
              hint="Задача живёт внутри сделки. Создайте сделку — и задачи клиента появятся здесь."
              action={<button type="button" className="btn small primary" onClick={() => onNewDeal(clientId)}>Создать сделку</button>}
            />
          ) : openClientTasks.length === 0 && doneClientTasks.length === 0 ? (
            <EmptyState
              icon={<CheckCheck size={24} />}
              title="Задач нет"
              hint="Позвонить, отправить документы, назначить замер — всё попадёт в общий список задач."
              action={<button type="button" className="btn small primary" onClick={() => setEditor({ dealId: taskDeals[0]?.id })}>Добавить задачу</button>}
            />
          ) : (
            <>
              {TONE_GROUPS.map((group) => {
                const items = openClientTasks.filter(({ tone }) => tone === group.id);
                if (items.length === 0) return null;
                return (
                  <section key={group.id} className="client-task-group">
                    <h4 className={`client-task-head tone-${group.id}`}>{group.title} <b>{items.length}</b></h4>
                    <ul className="task-list">
                      {items.map(({ task, deal, tone }) => (
                        <ClientTaskRow
                          key={`${deal.id}-${task.id}`}
                          task={task}
                          tone={tone}
                          dealTitle={deal.title}
                          today={today}
                          onOpen={() => setEditor({ dealId: deal.id, task })}
                          onOpenDeal={() => onOpenDeal(deal.id)}
                          onToggle={() => {
                            updateDeal(toggleTask(deal, task.id));
                            notify('Готово');
                          }}
                          onPostpone={(days) => updateDeal(postponeTask(deal, task.id, days))}
                          onDelete={() => {
                            if (!confirm(`Удалить задачу «${task.title}»?`)) return;
                            updateDeal(removeTask(deal, task.id));
                            const removed = task;
                            notify('Задача удалена', 'ok', {
                              label: 'Вернуть',
                              run: () => updateDeal(addTask(deal, { ...removed, done: false })),
                            });
                          }}
                        />
                      ))}
                    </ul>
                  </section>
                );
              })}

              {doneClientTasks.length > 0 && (
                <section className="client-task-group">
                  <h4 className="client-task-head tone-done">Выполнено <b>{doneClientTasks.length}</b></h4>
                  <ul className="task-list done-list">
                    {doneClientTasks.slice(0, 20).map(({ task, deal }) => (
                      <ClientTaskRow
                        key={`${deal.id}-${task.id}`}
                        task={task}
                        tone="done"
                        dealTitle={deal.title}
                        today={today}
                        onOpen={() => setEditor({ dealId: deal.id, task })}
                        onOpenDeal={() => onOpenDeal(deal.id)}
                        onToggle={() => updateDeal(toggleTask(deal, task.id))}
                        onPostpone={() => {}}
                        onDelete={() => updateDeal(removeTask(deal, task.id))}
                      />
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>
      )}

      {!isNew && tab === 'files' && (
        <section className="client-attachments">
          <div className="section-head sub">
            <div>
              <h3>Документы и фото</h3>
              <span className="muted">договор с клиентом, паспорт объекта, фото замеров</span>
            </div>
          </div>
          <Attachments ownerType="client" ownerId={clientId} attachments={live?.attachments ?? []} />
        </section>
      )}

      {!isNew && tab === 'history' && (
        <div className="timeline">
          {fullTimeline.length === 0 ? (
            <div className="empty-note">Событий пока нет.</div>
          ) : (
            <>
              <div className="timeline-toolbar">
                <span className="muted">Всего событий: {fullTimeline.length} · сверху свежие</span>
              </div>
              <ul>
                {fullTimeline.map((event) => (
                  <li key={event.id} className={`timeline-row timeline-${event.kind}`}>
                    <span className="timeline-icon">{TIMELINE_META[event.kind]?.icon ?? '•'}</span>
                    <span className="timeline-main">
                      <b>{event.title}</b>
                      {event.detail && <span>{event.detail}</span>}
                    </span>
                    <span className="timeline-date">{fmtDateTime(event.at)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {!isNew && clientDeals.some((deal) => deal.nextContactAt && deal.nextContactAt < today) && (
        <div className="inline-warning">
          Есть просроченные контакты — проверьте сделки клиента.
        </div>
      )}

      {editor && (
        <TaskEditor
          task={editor.task}
          deals={clientDeals}
          dealId={editor.dealId}
          onClose={() => setEditor(null)}
          onSave={(values, dealId) => {
            const deal = clientDeals.find((item) => item.id === dealId);
            if (!deal) { notify('Сделка не найдена', 'error'); return; }
            if (editor.task) {
              updateDeal(patchTask(deal, editor.task.id, values));
              notify('Задача сохранена');
            } else {
              updateDeal(addTask(deal, values));
              notify('Задача добавлена');
              setTab('tasks');
            }
            setEditor(null);
          }}
          onDelete={editor.task ? () => {
            const deal = clientDeals.find((item) => item.id === editor.dealId);
            if (!deal || !editor.task) return;
            const removed = editor.task;
            updateDeal(removeTask(deal, editor.task.id));
            setEditor(null);
            notify('Задача удалена', 'ok', {
              label: 'Вернуть',
              run: () => updateDeal(addTask(deal, { ...removed, done: false })),
            });
          } : undefined}
          onToggleDone={editor.task ? () => {
            const deal = clientDeals.find((item) => item.id === editor.dealId);
            if (!deal || !editor.task) return;
            updateDeal(toggleTask(deal, editor.task.id));
            setEditor(null);
            notify('Готово');
          } : undefined}
        />
      )}
    </Modal>
  );
}

function ClientTaskRow({
  task, tone, dealTitle, today, onOpen, onOpenDeal, onToggle, onPostpone, onDelete,
}: {
  task: DealTask;
  tone: TaskTone;
  dealTitle: string;
  today: string;
  onOpen: () => void;
  onOpenDeal: () => void;
  onToggle: () => void;
  onPostpone: (days: number) => void;
  onDelete: () => void;
}) {
  const meta = taskKindMeta(task.kind);
  const repeat = REPEAT_LABELS.find((item) => item.id === task.repeat)?.label;
  return (
    <li className={`task-row task-${tone}`}>
      <input
        type="checkbox"
        checked={Boolean(task.done)}
        onChange={onToggle}
        aria-label={`${task.done ? 'Вернуть' : 'Выполнить'}: ${task.title}`}
      />
      <span className="task-main">
        <button type="button" className="task-title-btn" onClick={onOpen}>{task.title}</button>
        <span>
          <button type="button" className="link-btn" onClick={onOpenDeal}>{dealTitle}</button>
          {' · '}{meta.label}
          {task.assignee ? ` · ${task.assignee}` : ''}
          {repeat ? ` · повтор: ${repeat}` : ''}
          {' '}<TaskBell reminder={task.reminder} />
        </span>
      </span>
      <span className={`task-due tone-${tone}`}>
        {task.dueAt ? <>{fmtDate(task.dueAt)}<small>{relativeDay(task.dueAt, today)}</small></> : 'без срока'}
      </span>
      <span className="task-postpone">
        <button type="button" className="icon-btn small" title="Изменить" aria-label={`Изменить задачу: ${task.title}`} onClick={onOpen}>
          <Pencil size={13} />
        </button>
        {!task.done && <button type="button" className="quick" title="Отложить на завтра" onClick={() => onPostpone(1)}>+1</button>}
        {!task.done && <button type="button" className="quick" title="Отложить на неделю" onClick={() => onPostpone(7)}>+7</button>}
        <button type="button" className="icon-btn small" title="Удалить задачу" aria-label="Удалить задачу" onClick={onDelete}>
          <Trash2 size={13} />
        </button>
      </span>
    </li>
  );
}
