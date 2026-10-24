// Карточка сделки: этап, следующий шаг, задачи, деньги, график и история.
import { useMemo, useState } from 'react';
import {
  Calendar, Check, CheckCheck, Clock, Copy, Link2, MessageSquare, Pencil, Phone, Plus,
  Printer, Send, Share2, Trash2, Wallet, X,
} from 'lucide-react';
import type { DealStatus, DealTask, PaymentKind, TaskKind, TaskRepeat } from '../types';
import { useApp } from '../store';
import {
  addDays, digitsOnly, fmtDate, fmtDateTime, fmtMoney, relativeDay, telHref, todayISO,
} from '../lib/dates';
import { DEAL_STATUSES, dealMessage, defaultNextAction, statusMeta } from '../lib/crm';
import {
  addPayment, addTask, nextTask, patchPayment, patchTask, paymentKindLabel, paymentState,
  postponeTask, removePayment, removeTask, REPEAT_LABELS, sortedPayments, TASK_KINDS,
  taskKindMeta, taskTone, toggleTask, toggleTasks,
} from '../lib/crmTasks';
import { buildDealTimeline, TIMELINE_META } from '../lib/crmTimeline';
import { enabledTemplates, renderTemplate, templateContext } from '../lib/templates';
import { absoluteLink } from '../lib/router';
import { amountFromInput } from '../lib/utils';
import { dealMoney } from '../lib/money';
import { encodeShare } from '../lib/share';
import { printDealCard } from '../lib/print';
import { ContactActions, ContactLog } from './ContactActions';
import Modal from './Modal';
import ScheduleFields from './ScheduleFields';
import Attachments from './Attachments';
import TaskEditor, { TaskBell } from './TaskEditor';
import DealExpenses from './DealExpenses';
import DealPlan from './DealPlan';
import DealDocuments from './DealDocuments';
import ClientReminders from './ClientReminders';
import { telegramLink, whatsappLink } from '../lib/messaging';

const TABS = [
  { id: 'overview', label: 'Обзор' },
  { id: 'tasks', label: 'Задачи' },
  { id: 'money', label: 'Оплата' },
  { id: 'docs', label: 'Документы' },
  { id: 'schedule', label: 'График' },
  { id: 'files', label: 'Файлы' },
  { id: 'history', label: 'История' },
] as const;

type TabId = typeof TABS[number]['id'];

export default function DealDialog({ dealId, initialTab, onClose, onOpenClient, onOpenSchedule, queue, onQueueNext }: {
  dealId: string;
  /** Открыть сразу нужную вкладку: из графика — «График». */
  initialTab?: TabId;
  onClose: () => void;
  onOpenClient: (id: string) => void;
  onOpenSchedule: () => void;
  /** Очередь разбора: сколько сделок осталось после этой. */
  queue?: { index: number; total: number };
  onQueueNext?: () => void;
}) {
  const {
    deals, clients, patchDeal, updateDeal, removeDeal, settings, notify, role, snoozeContact,
  } = useApp();
  const deal = deals.find((item) => item.id === dealId);
  const visibleTabs = TABS.filter((item) => role.canSeeMoney || (item.id !== 'money' && item.id !== 'docs'));
  const [tab, setTab] = useState<TabId>(() => {
    const wanted = initialTab ?? 'overview';
    const hidden = !role.canSeeMoney && (wanted === 'money' || wanted === 'docs');
    return hidden ? 'overview' : wanted;
  });
  const [taskDraft, setTaskDraft] = useState<{ title: string; kind: TaskKind; dueAt: string; assignee: string; repeat: '' | TaskRepeat }>({
    title: '', kind: 'call', dueAt: '', assignee: '', repeat: '',
  });
  const [payDraft, setPayDraft] = useState<{ amount: string; at: string; kind: PaymentKind; comment: string }>({
    amount: '', at: todayISO(), kind: 'prepay', comment: '',
  });
  const [payEditId, setPayEditId] = useState('');
  const [noteDraft, setNoteDraft] = useState('');
  const [editingTask, setEditingTask] = useState<DealTask | null>(null);
  const [templateId, setTemplateId] = useState('');
  const [messageDraft, setMessageDraft] = useState('');

  const client = deal ? clients.find((item) => item.id === deal.clientId) : undefined;
  const pay = deal ? paymentState(deal) : null;
  const timeline = useMemo(() => (deal ? buildDealTimeline(deal) : []), [deal]);
  const today = todayISO();

  if (!deal || !pay) return null;

  const money = dealMoney(deal);

  const next = nextTask(deal);
  const openCount = deal.tasks.filter((task) => !task.done).length;
  const phone = client?.phones[0] ?? deal.schedule.phone ?? '';
  const email = client?.emails[0] ?? '';

  const context = templateContext(deal, client?.name ?? '', settings.companyName);
  const templates = enabledTemplates(settings.messageTemplates);
  const activeTemplate = templates.find((item) => item.id === templateId) ?? templates[0];
  const message = messageDraft || (activeTemplate
    ? renderTemplate(activeTemplate.text, context)
    : dealMessage(deal, client?.name ?? 'Добрый день', pay.paid, fmtMoney));

  const setStatus = (status: DealStatus) => {
    patchDeal(deal.id, {
      status,
      nextAction: deal.nextAction?.trim() || defaultNextAction(status),
      nextContactAt: deal.nextContactAt ?? addDays(today, status === 'clientThinking' ? 2 : 1),
    }, { kind: 'status', title: `Этап: ${statusMeta(status).label}` });
  };

  const createTask = () => {
    const title = taskDraft.title.trim();
    if (!title) { notify('Введите текст задачи', 'error'); return; }
    updateDeal(addTask(deal, {
      title,
      kind: taskDraft.kind,
      dueAt: taskDraft.dueAt || undefined,
      assignee: taskDraft.assignee || deal.manager,
      repeat: taskDraft.repeat || undefined,
      done: false,
    }));
    setTaskDraft({ title: '', kind: 'call', dueAt: '', assignee: '', repeat: '' });
    notify('Задача добавлена');
  };

  const createPayment = () => {
    const amount = Number(payDraft.amount.replace(/\s/g, '').replace(',', '.'));
    if (!amount) { notify('Укажите сумму платежа', 'error'); return; }
    const patch = {
      amount: payDraft.kind === 'refund' ? -Math.abs(amount) : Math.abs(amount),
      at: payDraft.at || today,
      kind: payDraft.kind,
      comment: payDraft.comment.trim() || undefined,
      author: settings.myName.trim() || undefined,
    };
    if (payEditId) {
      updateDeal(patchPayment(deal, payEditId, patch));
    } else {
      updateDeal(addPayment(deal, patch));
      patchDeal(deal.id, {}, { kind: 'payment', title: `${paymentKindLabel(payDraft.kind)}: ${fmtMoney(amount)}` });
    }
    setPayDraft({ amount: '', at: today, kind: 'final', comment: '' });
    setPayEditId('');
    notify(payEditId ? 'Платёж сохранён' : 'Платёж добавлен');
  };

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notify(label);
    } catch {
      notify('Не удалось скопировать — выделите текст вручную', 'error');
    }
  };

  const markDone = () => {
    const open = deal.tasks.filter((task) => !task.done);
    if (open.length === 0) { notify('Открытых задач нет', 'info'); return; }
    updateDeal(toggleTasks(deal, open.map((task) => task.id)));
    notify(`Выполнено задач: ${open.length}`);
  };

  const shareLink = () => absoluteLink({ view: 'crm', share: encodeShare(deal, client) });

  return (
    <Modal
      title={(
        <span className="deal-dialog-title">
          <span>{client?.name ?? 'Без клиента'}</span>
          <i className={`badge badge-${statusMeta(deal.status).tone}`}>{statusMeta(deal.status).label}</i>
          {queue && <i className="badge badge-ghost">очередь {queue.index + 1} из {queue.total}</i>}
        </span>
      )}
      subtitle={(
        <>
          {deal.title} · {deal.amount ? fmtMoney(deal.amount) : 'сумма не заполнена'}
          {pay.remainder > 0 && deal.amount > 0 ? ` · остаток ${fmtMoney(pay.remainder)}` : ''}
        </>
      )}
      onClose={onClose}
      size="xl"
      headExtra={(
        <div className="deal-head-actions">
          {phone && (
            <a className="btn small primary" href={telHref(phone)} title={phone}>
              <Phone size={15} /> Позвонить
            </a>
          )}
          {phone && (
            <a
              className="btn small ghost"
              href={whatsappLink(phone, message)}
              target="_blank"
              rel="noreferrer"
            >
              <MessageSquare size={15} /> WhatsApp
            </a>
          )}
          <a
            className="btn small ghost"
            href={telegramLink(message, shareLink())}
            target="_blank"
            rel="noreferrer"
            title="Отправить в Telegram"
          >
            <Send size={15} /> Telegram
          </a>
          <button type="button" className="icon-btn" title="Скопировать ссылку на сделку" onClick={() => copy(shareLink(), 'Ссылка на сделку скопирована')}>
            <Link2 size={16} />
          </button>
          <button type="button" className="icon-btn" title="Печать карточки заказа" onClick={() => printDealCard(deal, client, client?.name ?? '', settings.companyName)}>
            <Printer size={16} />
          </button>
        </div>
      )}
      footer={(
        <>
          {role.canDelete && (
            <button type="button" className="btn danger-ghost" onClick={() => {
              if (!confirm(`Удалить сделку «${deal.title}»?`)) return;
              removeDeal(deal.id);
              onClose();
            }}>
              <Trash2 size={14} /> Удалить
            </button>
          )}
          <span className="foot-spacer" />
          {client && <button type="button" className="btn ghost" onClick={() => onOpenClient(client.id)}>Клиент</button>}
          <button type="button" className="btn ghost" onClick={onOpenSchedule}>График</button>
          {queue && onQueueNext ? (
            <button type="button" className="btn primary" onClick={onQueueNext}>
              Следующая сделка <CheckCheck size={15} />
            </button>
          ) : (
            <button type="button" className="btn primary" onClick={onClose}>Готово</button>
          )}
        </>
      )}
    >
      <nav className="tabs" aria-label="Разделы карточки">
        {visibleTabs.map((item) => (
          <button key={item.id} type="button" className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}>
            {item.label}
            {item.id === 'tasks' && openCount > 0 && <b>{openCount}</b>}
            {item.id === 'money' && pay.remainder > 0 && deal.amount > 0 && <b className="warn">{fmtMoney(pay.remainder)}</b>}
            {item.id === 'schedule' && (deal.schedule.installAt
              ? <b>{fmtDate(deal.schedule.installAt)}</b>
              : <b className="warn">нет</b>)}
            {item.id === 'docs' && (deal.documents?.length ?? 0) > 0 && <b>{deal.documents?.length}</b>}
            {item.id === 'files' && (deal.attachments?.length ?? 0) > 0 && <b>{deal.attachments?.length}</b>}
          </button>
        ))}
      </nav>

      {tab === 'overview' && (
        <div className="deal-overview">
          <div className="form-grid three">
            <label className="field span-2">Название заказа
              <input value={deal.title} onChange={(event) => patchDeal(deal.id, { title: event.target.value })} />
            </label>
            <div className="field">
              <span className="field-label">Этап</span>
              <div className="status-picker">
                {DEAL_STATUSES.map((status) => (
                  <button
                    key={status.value}
                    type="button"
                    className={`status-chip badge-${status.tone}${deal.status === status.value ? ' active' : ''}`}
                    title={status.hint}
                    onClick={() => setStatus(status.value)}
                  >
                    {status.label}
                  </button>
                ))}
              </div>
            </div>
            <label className="field">Сумма заказа, ₽
              {role.canSeeMoney ? (
                <input
                  inputMode="numeric"
                  value={deal.amount || ''}
                  placeholder="0"
                  onChange={(event) => patchDeal(deal.id, { amount: amountFromInput(event.target.value) })}
                />
              ) : (
                <input value="скрыто ролью «Монтажник»" readOnly aria-label="Сумма заказа скрыта" />
              )}
            </label>
            <label className="field">Ответственный
              <input list="managers-list" value={deal.manager ?? ''} placeholder="менеджер" onChange={(event) => patchDeal(deal.id, { manager: event.target.value || undefined })} />
              <datalist id="managers-list">
                {settings.managers.map((name) => <option key={name} value={name} />)}
              </datalist>
            </label>
            <label className="field">Клиент
              <select value={deal.clientId} onChange={(event) => patchDeal(deal.id, { clientId: event.target.value })}>
                <option value="">— без клиента —</option>
                {clients.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <label className="field span-2">Следующий шаг
              <input
                value={deal.nextAction ?? ''}
                placeholder={defaultNextAction(deal.status)}
                onChange={(event) => patchDeal(deal.id, { nextAction: event.target.value })}
              />
            </label>
            <div className="field">
              <span className="field-label">Когда связаться</span>
              <input type="date" value={deal.nextContactAt ?? ''} onChange={(event) => patchDeal(deal.id, { nextContactAt: event.target.value || undefined })} />
              <div className="quick-row">
                {[0, 1, 3, 7].map((days) => (
                  <button key={days} type="button" className="quick" onClick={() => patchDeal(deal.id, { nextContactAt: addDays(today, days) })}>
                    {days === 0 ? 'сегодня' : `+${days}`}
                  </button>
                ))}
                {deal.nextContactAt && (
                  <button type="button" className="quick" onClick={() => patchDeal(deal.id, { nextContactAt: undefined })}>сброс</button>
                )}
              </div>
              <small className={`field-hint tone-${deal.nextContactAt ? (deal.nextContactAt < today ? 'overdue' : deal.nextContactAt === today ? 'today' : 'soon') : 'none'}`}>
                {relativeDay(deal.nextContactAt, today)}
              </small>
            </div>
            {deal.status === 'rejected' && (
              <label className="field span-2">Причина отказа
                <input value={deal.lostReason ?? ''} placeholder="почему клиент отказался" onChange={(event) => patchDeal(deal.id, { lostReason: event.target.value })} />
              </label>
            )}
            <label className="field span-full">Комментарий по заказу
              <textarea rows={2} value={deal.comment ?? ''} placeholder="состав, договорённости, особенности" onChange={(event) => patchDeal(deal.id, { comment: event.target.value })} />
            </label>
          </div>

          <div className="deal-columns">
            <div className="info-grid">
              <div className="info-card">
                <h3>Контакты</h3>
                {phone ? <a href={telHref(phone)} className="big-link">{phone}</a> : <span className="muted">телефон не заполнен</span>}
                {email && <a href={`mailto:${email}`} className="link">{email}</a>}
                <div className="contact-actions">
                  {phone && <a className="btn small ghost" href={`sms:${digitsOnly(phone)}`}>SMS</a>}
                  {phone && <button type="button" className="btn small ghost" onClick={() => copy(phone, 'Телефон скопирован')}><Copy size={13} /> Телефон</button>}
                  {client && <button type="button" className="btn small ghost" onClick={() => onOpenClient(client.id)}>Карточка клиента</button>}
                </div>
                <div className="muted small">Адрес: {client?.address || deal.schedule.address || 'не указан'}</div>
              </div>

              <div className="info-card">
                <h3>Связь с клиентом</h3>
                <ContactActions deal={deal} />
                <div className="quick-row">
                  <button type="button" className="quick" onClick={() => snoozeContact(deal.id, 1)}>+1 день</button>
                  <button type="button" className="quick" onClick={() => snoozeContact(deal.id, 7)}>+1 неделя</button>
                </div>
                <ContactLog deal={deal} limit={4} />
              </div>

              <div className="info-card">
                <h3>Следующая задача</h3>
                {next ? (
                  <>
                    <b>{next.title}</b>
                    <span className={`tone-${taskTone(next, today)}`}>
                      {next.dueAt ? `${fmtDate(next.dueAt)} · ${relativeDay(next.dueAt, today)}` : 'без срока'}
                    </span>
                    <div className="contact-actions">
                      <button type="button" className="btn small ghost" onClick={() => updateDeal(toggleTask(deal, next.id))}>
                        <Check size={13} /> Выполнено
                      </button>
                      <button type="button" className="btn small ghost" onClick={() => updateDeal(postponeTask(deal, next.id, 1))}>
                        <Clock size={13} /> На завтра
                      </button>
                      <button type="button" className="btn small ghost" onClick={() => setEditingTask(next)}>
                        <Pencil size={13} /> Изменить
                      </button>
                    </div>
                    <button type="button" className="link-btn" onClick={() => setTab('tasks')}>все задачи →</button>
                  </>
                ) : (
                  <span className="muted">Задач нет — поставьте звонок или встречу.</span>
                )}
              </div>

              <div className="info-card">
                <h3>Оплата</h3>
                <b>{deal.amount ? `${fmtMoney(pay.paid)} из ${fmtMoney(deal.amount)}` : 'сумма не заполнена'}</b>
                <span className={`tone-${pay.tone === 'ok' ? 'done' : pay.tone === 'bad' ? 'overdue' : 'soon'}`}>{pay.label}</span>
                <div className={`pay-bar${pay.remainder > 0 ? ' partial' : ''}`}><span style={{ width: `${pay.percent}%` }} /></div>
                <button type="button" className="link-btn" onClick={() => setTab('money')}>внести платёж →</button>
              </div>

              <div className="info-card">
                <h3>График</h3>
                <b>{deal.schedule.installAt ? `Монтаж ${fmtDate(deal.schedule.installAt)}` : 'Монтаж не назначен'}</b>
                <span className="muted small">{deal.schedule.team || 'бригада не выбрана'}</span>
                <button type="button" className="link-btn" onClick={() => setTab('schedule')}>даты и бригада →</button>
              </div>
            </div>

            <div className="message-card">
              <div className="section-head">
                <h3>Сообщение клиенту</h3>
                <select
                  className="template-select"
                  value={activeTemplate?.id ?? ''}
                  onChange={(event) => { setTemplateId(event.target.value); setMessageDraft(''); }}
                  aria-label="Шаблон сообщения"
                >
                  {templates.map((template) => <option key={template.id} value={template.id}>{template.title}</option>)}
                  {templates.length === 0 && <option value="">свой текст</option>}
                </select>
              </div>
              <textarea
                rows={5}
                value={message}
                onChange={(event) => setMessageDraft(event.target.value)}
                aria-label="Текст сообщения"
              />
              <div className="message-actions">
                <button type="button" className="btn small ghost" onClick={() => copy(message, 'Сообщение скопировано')}>
                  <Copy size={13} /> Скопировать
                </button>
                {phone && (
                  <a className="btn small ghost" href={`https://wa.me/${digitsOnly(phone)}?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer">
                    <MessageSquare size={13} /> WhatsApp
                  </a>
                )}
                {email && (
                  <a className="btn small ghost" href={`mailto:${email}?subject=${encodeURIComponent(deal.title)}&body=${encodeURIComponent(message)}`}>
                    Почта
                  </a>
                )}
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => copy(shareLink(), 'Ссылка на сделку скопирована')}
                >
                  <Share2 size={13} /> ссылка коллеге
                </button>
              </div>
              <p className="field-hint">
                Подстановки: {'{client} {deal} {total} {paid} {remainder} {date} {team} {address}'} — свои шаблоны в «Данных».
              </p>
            </div>
          </div>
        </div>
      )}

      {tab === 'tasks' && (
        <div className="deal-tasks">
          <div className="task-form">
            <input
              data-autofocus
              value={taskDraft.title}
              placeholder="Что сделать: позвонить, отправить документы…"
              onChange={(event) => setTaskDraft({ ...taskDraft, title: event.target.value })}
              onKeyDown={(event) => { if (event.key === 'Enter') createTask(); }}
            />
            <select value={taskDraft.kind} onChange={(event) => setTaskDraft({ ...taskDraft, kind: event.target.value as TaskKind })} aria-label="Тип задачи">
              {TASK_KINDS.map((kind) => <option key={kind.id} value={kind.id}>{kind.label}</option>)}
            </select>
            <input type="date" value={taskDraft.dueAt} onChange={(event) => setTaskDraft({ ...taskDraft, dueAt: event.target.value })} aria-label="Срок" />
            <select
              value={taskDraft.repeat}
              onChange={(event) => setTaskDraft({ ...taskDraft, repeat: event.target.value as '' | TaskRepeat })}
              aria-label="Повторение"
            >
              <option value="">без повтора</option>
              {REPEAT_LABELS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
            <button type="button" className="btn primary" onClick={createTask}><Plus size={15} /> Добавить</button>
          </div>

          {openCount > 0 && (
            <div className="task-toolbar">
              <span className="muted">Открытых: {openCount}</span>
              <button type="button" className="btn small ghost" onClick={markDone}><CheckCheck size={14} /> Выполнить все</button>
            </div>
          )}

          {deal.tasks.length === 0 ? (
            <div className="empty-note">Задач пока нет. Добавьте звонок или встречу — они попадут в общий список задач.</div>
          ) : (
            <ul className="task-list">
              {[...deal.tasks]
                .sort((left, right) => Number(left.done) - Number(right.done) || (left.dueAt ?? '9999').localeCompare(right.dueAt ?? '9999'))
                .map((task) => {
                  const tone = taskTone(task, today);
                  const meta = taskKindMeta(task.kind);
                  const repeat = REPEAT_LABELS.find((item) => item.id === task.repeat)?.label;
                  return (
                    <li key={task.id} className={`task-row task-${tone}`}>
                      <input type="checkbox" checked={Boolean(task.done)} onChange={() => updateDeal(toggleTask(deal, task.id))} aria-label={`Выполнить: ${task.title}`} />
                      <span className="task-main">
                        <b>{task.title}</b>
                        <span>
                          {meta.label}
                          {task.assignee ? ` · ${task.assignee}` : ''}
                          {repeat ? ` · повтор: ${repeat}` : ''}
                          {task.origin?.startsWith('auto:') ? ' · автоматика' : ''}
                          {' '}<TaskBell reminder={task.reminder} />
                        </span>
                      </span>
                      {!task.done && (
                        <span className="task-postpone">
                          <button type="button" className="quick" onClick={() => updateDeal(postponeTask(deal, task.id, 1))} title="Отложить на завтра">+1</button>
                          <button type="button" className="quick" onClick={() => updateDeal(postponeTask(deal, task.id, 7))} title="Отложить на неделю">+7</button>
                        </span>
                      )}
                      <span className={`task-due tone-${tone}`}>{task.dueAt ? relativeDay(task.dueAt, today) : 'без срока'}</span>
                      <button
                        type="button"
                        className="icon-btn small"
                        onClick={() => setEditingTask(task)}
                        aria-label={`Изменить задачу: ${task.title}`}
                        title="Изменить"
                      >
                        <Pencil size={13} />
                      </button>
                      <button type="button" className="icon-btn small" onClick={() => updateDeal(removeTask(deal, task.id))} aria-label="Удалить задачу">
                        <X size={13} />
                      </button>
                    </li>
                  );
                })}
            </ul>
          )}
        </div>
      )}

      {tab === 'money' && (
        <div className="deal-money-tab">
          <div className="money-summary">
            <div><span>Сумма заказа</span><b>{deal.amount ? fmtMoney(deal.amount) : '—'}</b></div>
            <div><span>Получено</span><b className="ok">{fmtMoney(pay.paid)}</b></div>
            <div><span>Остаток</span><b className={pay.remainder > 0 ? 'warn' : 'ok'}>{fmtMoney(pay.remainder)}</b></div>
            <div>
              <span>Маржа</span>
              <b className={money.loss ? 'warn' : 'ok'}>
                {money.incomplete ? '—' : `${fmtMoney(money.margin)} · ${money.marginPercent}%`}
              </b>
            </div>
          </div>
          <div className={deal.amount ? 'pay-bar large' : 'pay-bar large empty'}><span style={{ width: `${pay.percent}%` }} /></div>
          {!deal.amount && (
            <div className="inline-warning">
              <Wallet size={14} /> Сумма заказа не заполнена — остаток и оплаты считать не из чего.
            </div>
          )}
          {payEditId && (
            <div className="form-note payment-editing">
              Правим существующий платёж.
              <button
                type="button"
                className="link-btn"
                onClick={() => { setPayEditId(''); setPayDraft({ amount: '', at: today, kind: 'final', comment: '' }); }}
              >
                отменить правку
              </button>
            </div>
          )}
          <div className="payment-form">
            <label className="field">Сумма, ₽
              <input inputMode="numeric" value={payDraft.amount} placeholder="0" onChange={(event) => setPayDraft({ ...payDraft, amount: event.target.value })} />
            </label>
            <label className="field">Дата
              <input type="date" value={payDraft.at} onChange={(event) => setPayDraft({ ...payDraft, at: event.target.value })} />
            </label>
            <label className="field">Тип
              <select value={payDraft.kind} onChange={(event) => setPayDraft({ ...payDraft, kind: event.target.value as PaymentKind })}>
                <option value="prepay">Предоплата</option>
                <option value="final">Доплата</option>
                <option value="extra">Доп. работы</option>
                <option value="refund">Возврат</option>
              </select>
            </label>
            <label className="field">Комментарий
              <input value={payDraft.comment} placeholder="например, наличными" onChange={(event) => setPayDraft({ ...payDraft, comment: event.target.value })} />
            </label>
            <button type="button" className="btn primary" onClick={createPayment}>{payEditId ? 'Сохранить платёж' : 'Внести платёж'}</button>
          </div>
          {deal.payments.length > 0 && pay.remainder > 0 && (
            <button type="button" className="btn small ghost" onClick={() => setPayDraft({ ...payDraft, amount: String(pay.remainder), kind: 'final' })}>
              Заполнить остаток {fmtMoney(pay.remainder)}
            </button>
          )}
          {sortedPayments(deal).length === 0 ? (
            <div className="empty-note">Платежей нет. Первый обычно предоплата.</div>
          ) : (
            <ul className="payment-list">
              {sortedPayments(deal).map((payment) => (
                <li key={payment.id}>
                  <span className="pay-kind">{paymentKindLabel(payment.kind)}</span>
                  <b className={payment.amount < 0 ? 'warn' : 'ok'}>{fmtMoney(payment.amount)}</b>
                  <span className="muted">{fmtDate(payment.at)}{payment.comment ? ` · ${payment.comment}` : ''}</span>
                  <button
                    type="button"
                    className="icon-btn small"
                    aria-label={`Изменить платёж: ${fmtMoney(payment.amount)}`}
                    title="Изменить"
                    onClick={() => {
                      setPayEditId(payment.id);
                      setPayDraft({
                        amount: String(Math.abs(payment.amount)),
                        at: payment.at,
                        kind: payment.kind,
                        comment: payment.comment ?? '',
                      });
                    }}
                  >
                    <Pencil size={13} />
                  </button>
                  <button type="button" className="icon-btn small" onClick={() => updateDeal(removePayment(deal, payment.id))} aria-label="Удалить платёж">
                    <X size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {role.canSeeExpenses && <DealExpenses deal={deal} />}
          <DealPlan deal={deal} />
        </div>
      )}

      {tab === 'docs' && <DealDocuments deal={deal} />}

      {tab === 'schedule' && (
        <div>
          <ScheduleFields deal={deal} />
          <ClientReminders deal={deal} />
          <div className="form-note">
            Даты сразу попадают в «График монтажей». Перетащите событие в календаре или сдвиньте кнопками — сделка обновится.
          </div>
          <div className="schedule-print">
            <button
              type="button"
              className="btn small ghost"
              onClick={() => printDealCard(deal, client, client?.name ?? '', settings.companyName)}
            >
              <Printer size={14} /> Печать карточки
            </button>
            <button type="button" className="btn small ghost" onClick={onOpenSchedule}>
              <Calendar size={14} /> Открыть в графике
            </button>
          </div>
        </div>
      )}

      {tab === 'files' && (
        <Attachments ownerType="deal" ownerId={deal.id} attachments={deal.attachments ?? []} />
      )}

      {tab === 'history' && (
        <div className="timeline">
          <div className="note-form">
            <input
              value={noteDraft}
              placeholder="Заметка по сделке: о чём договорились, что уточнить…"
              aria-label="Новая заметка"
              onChange={(event) => setNoteDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || !noteDraft.trim()) return;
                patchDeal(deal.id, {}, { kind: 'note', title: noteDraft.trim() });
                setNoteDraft('');
                notify('Заметка добавлена');
              }}
            />
            <button
              type="button"
              className="btn small ghost"
              disabled={!noteDraft.trim()}
              onClick={() => {
                patchDeal(deal.id, {}, { kind: 'note', title: noteDraft.trim() });
                setNoteDraft('');
                notify('Заметка добавлена');
              }}
            >
              <Plus size={13} /> Заметка
            </button>
          </div>
          {timeline.length === 0 ? (
            <div className="empty-note">Событий пока нет.</div>
          ) : (
            <>
              <div className="timeline-toolbar">
                <span className="muted">Всего событий: {timeline.length} · сверху свежие</span>
              </div>
              <ul>
                {timeline.map((event) => {
                  const meta = TIMELINE_META[event.kind] ?? TIMELINE_META.note;
                  return (
                    <li key={event.id} className={`timeline-row timeline-${event.kind}`}>
                      <span className="timeline-icon">{meta.icon}</span>
                      <span className="timeline-main">
                        <b>{event.title}</b>
                        {event.detail && <span>{event.detail}</span>}
                      </span>
                      <span className="timeline-date">
                        {event.author && <b className="timeline-author">{event.author}</b>}
                        {fmtDateTime(event.at)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      )}
      {editingTask && (
        <TaskEditor
          task={editingTask}
          deals={[deal]}
          dealId={deal.id}
          onClose={() => setEditingTask(null)}
          onSave={(values) => {
            updateDeal(patchTask(deal, editingTask.id, values));
            setEditingTask(null);
            notify('Задача сохранена');
          }}
          onDelete={() => {
            updateDeal(removeTask(deal, editingTask.id));
            setEditingTask(null);
            notify('Задача удалена', 'ok', {
              label: 'Вернуть',
              run: () => updateDeal(addTask(deal, { ...editingTask, done: false })),
            });
          }}
          onToggleDone={() => {
            updateDeal(toggleTask(deal, editingTask.id));
            setEditingTask(null);
          }}
        />
      )}

    </Modal>
  );
}
