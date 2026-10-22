// Карточка сделки: этап, следующий шаг, задачи, деньги, график и история.
import { useState } from 'react';
import type { DealStatus, PaymentKind, TaskKind } from '../types';
import { useApp } from '../store';
import {
  addDays, digitsOnly, fmtDate, fmtDateTime, fmtMoney, relativeDay, telHref, todayISO,
} from '../lib/dates';
import { DEAL_STATUSES, dealMessage, defaultNextAction, statusMeta } from '../lib/crm';
import {
  addPayment, addTask, paymentKindLabel, paymentState, sortedPayments, taskKindMeta,
  taskTone, toggleTask, removePayment, removeTask, TASK_KINDS,
} from '../lib/crmTasks';
import { buildDealTimeline, TIMELINE_META } from '../lib/crmTimeline';
import { nextTask } from '../lib/crmTasks';
import Modal from './Modal';
import ScheduleFields from './ScheduleFields';

const TABS = [
  { id: 'overview', label: 'Обзор' },
  { id: 'tasks', label: 'Задачи' },
  { id: 'money', label: 'Оплата' },
  { id: 'schedule', label: 'График' },
  { id: 'history', label: 'История' },
] as const;

type TabId = typeof TABS[number]['id'];

export default function DealDialog({ dealId, onClose, onOpenClient, onOpenSchedule }: {
  dealId: string;
  onClose: () => void;
  onOpenClient: (id: string) => void;
  onOpenSchedule: () => void;
}) {
  const { deals, clients, patchDeal, updateDeal, removeDeal, settings, notify } = useApp();
  const deal = deals.find((item) => item.id === dealId);
  const [tab, setTab] = useState<TabId>('overview');
  const [taskDraft, setTaskDraft] = useState<{ title: string; kind: TaskKind; dueAt: string; assignee: string }>({ title: '', kind: 'call', dueAt: '', assignee: '' });
  const [payDraft, setPayDraft] = useState<{ amount: string; at: string; kind: PaymentKind; comment: string }>({ amount: '', at: todayISO(), kind: 'prepay', comment: '' });

  if (!deal) return null;
  const client = clients.find((item) => item.id === deal.clientId);
  const pay = paymentState(deal);
  const next = nextTask(deal);
  const timeline = buildDealTimeline(deal);
  const today = todayISO();
  const openTasks = deal.tasks.filter((task) => !task.done).length;

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
      done: false,
    }));
    setTaskDraft({ title: '', kind: 'call', dueAt: '', assignee: '' });
    notify('Задача добавлена');
  };

  const createPayment = () => {
    const amount = Number(payDraft.amount.replace(/\s/g, '').replace(',', '.'));
    if (!amount) { notify('Укажите сумму платежа', 'error'); return; }
    updateDeal(addPayment(deal, {
      amount: payDraft.kind === 'refund' ? -Math.abs(amount) : Math.abs(amount),
      at: payDraft.at || today,
      kind: payDraft.kind,
      comment: payDraft.comment.trim() || undefined,
    }));
    patchDeal(deal.id, {}, { kind: 'payment', title: `${paymentKindLabel(payDraft.kind)}: ${fmtMoney(amount)}` });
    setPayDraft({ amount: '', at: today, kind: 'final', comment: '' });
    notify('Платёж добавлен');
  };

  const copyMessage = async () => {
    const text = dealMessage(deal, client?.name ?? 'Добрый день', pay.paid, fmtMoney);
    try {
      await navigator.clipboard.writeText(text);
      notify('Сообщение скопировано');
    } catch {
      notify('Не удалось скопировать — выделите текст вручную', 'error');
    }
  };

  const message = dealMessage(deal, client?.name ?? 'Добрый день', pay.paid, fmtMoney);
  const phone = client?.phones[0] ?? deal.schedule.phone ?? '';
  const email = client?.emails[0] ?? '';

  return (
    <Modal
      title={(
        <span className="deal-dialog-title">
          <span>{client?.name ?? 'Без клиента'}</span>
          <i className={`badge badge-${statusMeta(deal.status).tone}`}>{statusMeta(deal.status).label}</i>
        </span>
      )}
      subtitle={<>{deal.title} · {fmtMoney(deal.amount)} · создана {fmtDate(deal.createdAt.slice(0, 10))}</>}
      onClose={onClose}
      size="lg"
      footer={(
        <>
          <button type="button" className="btn danger-ghost" onClick={() => {
            if (!confirm(`Удалить сделку «${deal.title}»? Действие нельзя отменить.`)) return;
            removeDeal(deal.id);
            notify('Сделка удалена');
            onClose();
          }}>Удалить</button>
          <span className="foot-spacer" />
          {client && <button type="button" className="btn ghost" onClick={() => onOpenClient(client.id)}>Карточка клиента</button>}
          <button type="button" className="btn ghost" onClick={onOpenSchedule}>График монтажей</button>
          <button type="button" className="btn primary" onClick={onClose}>Готово</button>
        </>
      )}
    >
      <nav className="tabs" aria-label="Разделы карточки">
        {TABS.map((item) => (
          <button key={item.id} type="button" className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}>
            {item.label}
            {item.id === 'tasks' && openTasks > 0 && <b>{openTasks}</b>}
            {item.id === 'schedule' && deal.schedule.installAt && <b>{fmtDate(deal.schedule.installAt)}</b>}
          </button>
        ))}
      </nav>

      {tab === 'overview' && (
        <div className="deal-overview">
          <div className="form-grid">
            <label className="field span-2">Название заказа
              <input value={deal.title} onChange={(event) => patchDeal(deal.id, { title: event.target.value })} />
            </label>
            <label className="field">Этап
              <select value={deal.status} onChange={(event) => setStatus(event.target.value as DealStatus)}>
                {DEAL_STATUSES.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
              </select>
              <small className="field-hint">{statusMeta(deal.status).hint}</small>
            </label>
            <label className="field">Сумма заказа, ₽
              <input
                inputMode="numeric"
                value={deal.amount || ''}
                placeholder="0"
                onChange={(event) => patchDeal(deal.id, { amount: Number(event.target.value.replace(/\s/g, '').replace(',', '.')) || 0 })}
              />
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
            <div className="field span-2">
              <span className="field-label">Когда связаться</span>
              <div className="contact-row">
                <input type="date" value={deal.nextContactAt ?? ''} onChange={(event) => patchDeal(deal.id, { nextContactAt: event.target.value || undefined })} />
                {[0, 1, 3, 7].map((days) => (
                  <button key={days} type="button" className="quick" onClick={() => patchDeal(deal.id, { nextContactAt: addDays(today, days) })}>
                    {days === 0 ? 'сегодня' : `+${days}`}
                  </button>
                ))}
                {deal.nextContactAt && <button type="button" className="quick" onClick={() => patchDeal(deal.id, { nextContactAt: undefined })}>сброс</button>}
                <span className={`tone-${deal.nextContactAt ? (deal.nextContactAt < today ? 'overdue' : deal.nextContactAt === today ? 'today' : 'soon') : 'none'}`}>
                  {relativeDay(deal.nextContactAt, today)}
                </span>
              </div>
            </div>
            {deal.status === 'rejected' && (
              <label className="field span-2">Причина отказа
                <input value={deal.lostReason ?? ''} placeholder="почему клиент отказался" onChange={(event) => patchDeal(deal.id, { lostReason: event.target.value })} />
              </label>
            )}
            <label className="field span-2">Комментарий по заказу
              <textarea rows={3} value={deal.comment ?? ''} placeholder="состав, договорённости, особенности" onChange={(event) => patchDeal(deal.id, { comment: event.target.value })} />
            </label>
          </div>

          <div className="info-grid">
            <div className="info-card">
              <h3>Контакты</h3>
              {phone ? <a href={telHref(phone)} className="big-link">{phone}</a> : <span className="muted">телефон не заполнен</span>}
              {email && <a href={`mailto:${email}`} className="link">{email}</a>}
              {phone && (
                <div className="contact-actions">
                  <a className="btn small ghost" href={telHref(phone)}>Позвонить</a>
                  <a className="btn small ghost" href={`https://wa.me/${digitsOnly(phone)}`} target="_blank" rel="noreferrer">WhatsApp</a>
                  <a className="btn small ghost" href={`sms:${digitsOnly(phone)}`}>SMS</a>
                </div>
              )}
              <div className="muted small">Адрес: {client?.address || deal.schedule.address || 'не указан'}</div>
              {client && <button type="button" className="link-btn" onClick={() => onOpenClient(client.id)}>открыть клиента →</button>}
            </div>
            <div className="info-card">
              <h3>Следующая задача</h3>
              {next ? (
                <>
                  <b>{next.title}</b>
                  <span className={`tone-${taskTone(next, today)}`}>{next.dueAt ? `${fmtDate(next.dueAt)} · ${relativeDay(next.dueAt, today)}` : 'без срока'}</span>
                  <button type="button" className="link-btn" onClick={() => setTab('tasks')}>все задачи →</button>
                </>
              ) : (
                <span className="muted">Задач нет — поставьте звонок или встречу.</span>
              )}
            </div>
            <div className="info-card">
              <h3>Оплата</h3>
              <b>{fmtMoney(pay.paid)} из {fmtMoney(deal.amount)}</b>
              <span className={`tone-${pay.tone === 'ok' ? 'done' : pay.tone === 'bad' ? 'overdue' : 'soon'}`}>{pay.label}</span>
              <div className="pay-bar"><span style={{ width: `${pay.percent}%` }} /></div>
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
              <div className="actions">
                <button type="button" className="btn small ghost" onClick={copyMessage}>Скопировать</button>
                {phone && <a className="btn small ghost" href={`https://wa.me/${digitsOnly(phone)}?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer">Отправить в WhatsApp</a>}
              </div>
            </div>
            <p>{message}</p>
          </div>
        </div>
      )}

      {tab === 'tasks' && (
        <div className="deal-tasks">
          <div className="task-form">
            <input
              value={taskDraft.title}
              placeholder="Что сделать: позвонить, отправить документы…"
              onChange={(event) => setTaskDraft({ ...taskDraft, title: event.target.value })}
              onKeyDown={(event) => { if (event.key === 'Enter') createTask(); }}
            />
            <select value={taskDraft.kind} onChange={(event) => setTaskDraft({ ...taskDraft, kind: event.target.value as TaskKind })}>
              {TASK_KINDS.map((kind) => <option key={kind.id} value={kind.id}>{kind.icon} {kind.label}</option>)}
            </select>
            <input type="date" value={taskDraft.dueAt} onChange={(event) => setTaskDraft({ ...taskDraft, dueAt: event.target.value })} />
            <button type="button" className="btn primary" onClick={createTask}>Добавить</button>
          </div>
          {deal.tasks.length === 0 ? (
            <div className="empty-note">Задач пока нет. Добавьте звонок или встречу — они попадут в общий список задач.</div>
          ) : (
            <ul className="task-list">
              {[...deal.tasks].sort((a, b) => Number(a.done) - Number(b.done)).map((task) => {
                const tone = taskTone(task, today);
                const meta = taskKindMeta(task.kind);
                return (
                  <li key={task.id} className={`task-row task-${tone}`}>
                    <input type="checkbox" checked={Boolean(task.done)} onChange={() => updateDeal(toggleTask(deal, task.id))} />
                    <span className="task-main">
                      <b>{task.title}</b>
                      <span>{meta.icon} {meta.label}{task.assignee ? ` · ${task.assignee}` : ''}{task.origin?.startsWith('auto:') ? ' · автоматика' : ''}</span>
                    </span>
                    <span className={`task-due tone-${tone}`}>
                      {task.dueAt ? relativeDay(task.dueAt, today) : 'без срока'}
                    </span>
                    <button type="button" className="icon-btn small" onClick={() => updateDeal(removeTask(deal, task.id))} aria-label="Удалить задачу">✕</button>
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
            <div><span>Сумма заказа</span><b>{fmtMoney(deal.amount)}</b></div>
            <div><span>Получено</span><b className="ok">{fmtMoney(pay.paid)}</b></div>
            <div><span>Остаток</span><b className={pay.remainder > 0 ? 'warn' : 'ok'}>{fmtMoney(pay.remainder)}</b></div>
          </div>
          <div className="pay-bar large"><span style={{ width: `${pay.percent}%` }} /></div>
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
            <button type="button" className="btn primary" onClick={createPayment}>Внести платёж</button>
          </div>
          {sortedPayments(deal).length === 0 ? (
            <div className="empty-note">Платежей нет. Первый обычно предоплата.</div>
          ) : (
            <ul className="payment-list">
              {sortedPayments(deal).map((payment) => (
                <li key={payment.id}>
                  <span className="pay-kind">{paymentKindLabel(payment.kind)}</span>
                  <b className={payment.amount < 0 ? 'warn' : 'ok'}>{fmtMoney(payment.amount)}</b>
                  <span className="muted">{fmtDate(payment.at)}{payment.comment ? ` · ${payment.comment}` : ''}</span>
                  <button type="button" className="icon-btn small" onClick={() => updateDeal(removePayment(deal, payment.id))} aria-label="Удалить платёж">✕</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'schedule' && (
        <div>
          <ScheduleFields deal={deal} />
          <div className="form-note">Даты сразу попадают в «График монтажей». Бригаду и адрес видно в день монтажа.</div>
        </div>
      )}

      {tab === 'history' && (
        <div className="timeline">
          {timeline.length === 0 ? (
            <div className="empty-note">Событий пока нет.</div>
          ) : (
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
                    <span className="timeline-date">{fmtDateTime(event.at)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
}
