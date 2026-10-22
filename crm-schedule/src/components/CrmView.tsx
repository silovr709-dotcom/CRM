// CRM: сделки и клиенты, воронка, фильтры и доска.
// Принцип: на экране только то, что помогает выбрать, с кем работать сейчас.
import { useMemo, useState } from 'react';
import type { Deal, DealStatus } from '../types';
import { useApp } from '../store';
import { fmtDate, fmtMoney, relativeDay, todayISO } from '../lib/dates';
import { contactTone, isClosedStatus, statusMeta } from '../lib/crm';
import {
  buildDealRows, compareCrmRows, CRM_FOCUS_LABELS, CRM_STAGES, focusCounts,
  matchesFocus, matchesQuery, summarizeStages, type CrmFocus, type DealRow,
} from '../lib/crmBoard';
import { nextTask, openTasks, paymentState, taskStats } from '../lib/crmTasks';
import Modal from './Modal';

export default function CrmView(props: {
  onOpenDeal: (id: string) => void;
  onOpenClient: (id: string) => void;
  onNewClient: () => void;
}) {
  const { deals, clients, clientName, changeStatus, addDeal, settings, notify } = useApp();
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'deals' | 'clients'>('deals');
  const [focus, setFocus] = useState<CrmFocus>('active');
  const [stage, setStage] = useState('');
  const [board, setBoard] = useState(false);
  const [manager, setManager] = useState('');
  const [sort, setSort] = useState<'urgency' | 'money' | 'updated'>('urgency');
  const [newDealOpen, setNewDealOpen] = useState(false);
  const [newDeal, setNewDeal] = useState({ title: '', clientId: '', amount: '', status: 'draft' as DealStatus, manager: '' });
  const [dragId, setDragId] = useState('');
  const [dropStage, setDropStage] = useState('');

  const today = todayISO();
  const rows = useMemo(() => buildDealRows(
    deals,
    (deal) => clientName(deal),
    today,
    (deal) => {
      const client = clients.find((item) => item.id === deal.clientId);
      return [client?.phones.join(' '), client?.emails.join(' '), client?.source, client?.tags.join(' '), client?.address].filter(Boolean).join(' ');
    },
  ), [deals, clientName, clients, today]);
  const counts = useMemo(() => focusCounts(rows), [rows]);
  const stages = useMemo(() => summarizeStages(rows), [rows]);
  const taskCounts = useMemo(() => taskStats(deals, today), [deals, today]);

  const managers = useMemo(() => {
    const set = new Set<string>(settings.managers);
    for (const deal of deals) if (deal.manager?.trim()) set.add(deal.manager.trim());
    return Array.from(set).sort((left, right) => left.localeCompare(right, 'ru'));
  }, [deals, settings.managers]);

  const visible = useMemo(() => {
    const stageDef = stages.find((item) => item.id === stage);
    const list = rows
      .filter((row) => matchesFocus(row, focus) && matchesQuery(row, query))
      .filter((row) => !stageDef || stageDef.statuses.includes(row.status))
      .filter((row) => !manager || (row.deal.manager ?? '') === manager);
    if (sort === 'money') return [...list].sort((left, right) => right.total - left.total);
    if (sort === 'updated') return [...list].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    return [...list].sort(compareCrmRows);
  }, [rows, focus, query, stage, stages, manager, sort]);

  const clientRows = useMemo(() => {
    const byClient = new Map<string, { id: string; name: string; phone: string; email: string; tags: string[]; deals: Deal[] }>();
    for (const client of clients) {
      byClient.set(client.id, {
        id: client.id,
        name: client.name,
        phone: client.phones[0] ?? '',
        email: client.emails[0] ?? '',
        tags: client.tags,
        deals: [],
      });
    }
    for (const deal of deals) {
      const entry = byClient.get(deal.clientId);
      if (entry) entry.deals.push(deal);
      else if (deal.clientId) byClient.set(deal.clientId, { id: deal.clientId, name: clientName(deal), phone: '', email: '', tags: [], deals: [deal] });
    }
    const needle = query.trim().toLocaleLowerCase('ru-RU');
    return Array.from(byClient.values())
      .map((entry) => {
        const active = entry.deals.filter((deal) => !isClosedStatus(deal.status));
        return {
          ...entry,
          activeCount: active.length,
          openSum: active.reduce((sum, deal) => sum + deal.amount, 0),
          total: entry.deals.reduce((sum, deal) => sum + deal.amount, 0),
          lastTouch: entry.deals.reduce((latest, deal) => (deal.updatedAt > latest ? deal.updatedAt : latest), ''),
        };
      })
      .filter((entry) => !needle || [entry.name, entry.phone, entry.email, entry.tags.join(' ')].join(' ').toLocaleLowerCase('ru-RU').includes(needle))
      .sort((left, right) => right.openSum - left.openSum || right.lastTouch.localeCompare(left.lastTouch));
  }, [clients, deals, clientName, query]);

  const createDeal = () => {
    const title = newDeal.title.trim();
    if (!title) { notify('Укажите название заказа', 'error'); return; }
    if (!newDeal.clientId) { notify('Выберите клиента', 'error'); return; }
    const id = addDeal({
      title,
      clientId: newDeal.clientId,
      amount: Number(newDeal.amount.replace(/\s/g, '').replace(',', '.')) || 0,
      status: newDeal.status,
      manager: newDeal.manager || undefined,
    });
    setNewDealOpen(false);
    setNewDeal({ title: '', clientId: '', amount: '', status: 'draft', manager: '' });
    notify('Сделка создана');
    props.onOpenDeal(id);
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">Клиенты и заказы</div>
          <h1>CRM</h1>
          <p className="muted">Кликните строку — откроется карточка сделки со всеми деталями.</p>
        </div>
        <div className="actions wrap">
          <div className="segmented" role="tablist" aria-label="Что показывать">
            <button type="button" role="tab" aria-selected={mode === 'deals'} className={mode === 'deals' ? 'active' : ''} onClick={() => setMode('deals')}>Сделки</button>
            <button type="button" role="tab" aria-selected={mode === 'clients'} className={mode === 'clients' ? 'active' : ''} onClick={() => setMode('clients')}>Клиенты</button>
          </div>
          <div className="search-wrap">
            <input value={query} placeholder="Клиент, заказ, телефон…" onChange={(event) => setQuery(event.target.value)} />
            {query && <button type="button" className="search-clear" onClick={() => setQuery('')} aria-label="Очистить">✕</button>}
          </div>
          {mode === 'deals' && (
            <div className="segmented" role="tablist" aria-label="Вид">
              <button type="button" role="tab" aria-selected={!board} className={board ? '' : 'active'} onClick={() => setBoard(false)}>Список</button>
              <button type="button" role="tab" aria-selected={board} className={board ? 'active' : ''} onClick={() => setBoard(true)}>Доска</button>
            </div>
          )}
          <button type="button" className="btn ghost" onClick={props.onNewClient}>+ Клиент</button>
          <button type="button" className="btn primary" onClick={() => setNewDealOpen(true)}>+ Сделка</button>
        </div>
      </header>

      {mode === 'deals' && (
        <>
          <section className="focus-bar" aria-label="Фокус">
            {(['today', 'week', 'no-next', 'active', 'closed', 'all'] as CrmFocus[]).map((value) => {
              const count = value === 'today' ? counts.today
                : value === 'week' ? counts.week
                : value === 'no-next' ? counts.noNext
                : value === 'active' ? counts.active
                : value === 'closed' ? counts.closed
                : rows.length;
              return (
                <button key={value} type="button" className={focus === value ? 'active' : ''} onClick={() => { setFocus(value); setStage(''); }}>
                  {CRM_FOCUS_LABELS[value]}<b>{count}</b>
                </button>
              );
            })}
            <span className="focus-money">Активный портфель: <b>{fmtMoney(counts.pipeline)}</b></span>
          </section>

          <section className="funnel" aria-label="Воронка">
            {stages.map((item) => (
              <button key={item.id} type="button" className={stage === item.id ? 'active' : ''}
                onClick={() => { setStage(stage === item.id ? '' : item.id); setFocus('all'); }}>
                <b>{item.count}</b>
                <span>{item.title}</span>
                <small>{fmtMoney(item.total, { compact: true })}</small>
              </button>
            ))}
          </section>

          <section className="toolbar">
            <span className={`task-summary${taskCounts.overdue > 0 ? ' alert' : ''}`}>
              Задачи: <b>{taskCounts.open}</b> открыто
              {taskCounts.overdue > 0 && <> · <b>{taskCounts.overdue}</b> просрочено</>}
              {taskCounts.today > 0 && <> · <b>{taskCounts.today}</b> на сегодня</>}
            </span>
            <label>Ответственный
              <select value={manager} onChange={(event) => setManager(event.target.value)}>
                <option value="">все</option>
                {managers.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
            <label>Сортировать
              <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
                <option value="urgency">по срочности</option>
                <option value="money">по сумме</option>
                <option value="updated">по последнему изменению</option>
              </select>
            </label>
            <span className="toolbar-count">Показано: <b>{visible.length}</b></span>
          </section>

          {board ? (
            <section className="board" aria-label="Доска сделок">
              {CRM_STAGES.map((column) => {
                const items = visible.filter((row) => column.statuses.includes(row.status));
                return (
                  <div
                    key={column.id}
                    className={`board-col${dropStage === column.id ? ' drop' : ''}`}
                    onDragOver={(event) => { event.preventDefault(); setDropStage(column.id); }}
                    onDragLeave={() => setDropStage('')}
                    onDrop={() => {
                      if (dragId) {
                        changeStatus(dragId, column.statuses[0]);
                        notify(`Сделка → «${column.title}»`);
                      }
                      setDragId('');
                      setDropStage('');
                    }}
                  >
                    <header>
                      <b>{column.title}</b>
                      <span>{items.length}</span>
                      <small>{fmtMoney(items.reduce((sum, row) => sum + row.total, 0), { compact: true })}</small>
                    </header>
                    <div className="board-list">
                      {items.map((row) => (
                        <article
                          key={row.deal.id}
                          className="board-card"
                          draggable
                          onDragStart={() => setDragId(row.deal.id)}
                          onDragEnd={() => { setDragId(''); setDropStage(''); }}
                          onClick={() => props.onOpenDeal(row.deal.id)}
                        >
                          <div className="board-card-top">
                            <b>{clientName(row.deal)}</b>
                            <span>{fmtMoney(row.total, { compact: true })}</span>
                          </div>
                          <div className="board-card-title">{row.deal.title}</div>
                          <div className="board-card-meta">
                            <span className={`badge badge-${statusMeta(row.status).tone}`}>{statusMeta(row.status).label}</span>
                            {row.tone !== 'none' && !isClosedStatus(row.status) && (
                              <span className={`board-due tone-${row.tone}`}>{relativeDay(row.deal.nextContactAt, today)}</span>
                            )}
                          </div>
                          {row.deal.manager && <small className="board-manager">{row.deal.manager}</small>}
                        </article>
                      ))}
                      {items.length === 0 && <div className="board-empty">Перетащите сюда сделку</div>}
                    </div>
                  </div>
                );
              })}
            </section>
          ) : (
            <section className="card deal-list">
              {visible.length === 0 ? (
                <div className="empty-note">Ничего не найдено. Смените фильтр или добавьте сделку.</div>
              ) : (
                <ul>
                  {visible.map((row) => <DealListRow key={row.deal.id} row={row} client={clientName(row.deal)} today={today} onOpen={() => props.onOpenDeal(row.deal.id)} />)}
                </ul>
              )}
            </section>
          )}
        </>
      )}

      {mode === 'clients' && (
        <section className="card client-list">
          <div className="section-head">
            <div>
              <h2>Клиенты</h2>
              <span className="muted">{clientRows.length} в базе</span>
            </div>
            <button type="button" className="btn ghost" onClick={props.onNewClient}>+ Клиент</button>
          </div>
          {clientRows.length === 0 ? (
            <div className="empty-note">Клиентов пока нет. Добавьте первого — сделки привяжутся к нему.</div>
          ) : (
            <ul>
              {clientRows.map((row) => (
                <li key={row.id}>
                  <button type="button" className="client-row" onClick={() => props.onOpenClient(row.id)}>
                    <span className="avatar">{row.name.slice(0, 1).toUpperCase()}</span>
                    <span className="client-main">
                      <b>{row.name}</b>
                      <span>{[row.phone, row.email].filter(Boolean).join(' · ') || 'контакты не заполнены'}</span>
                      {row.tags.length > 0 && <em>{row.tags.map((tag) => <i key={tag} className="tag">{tag}</i>)}</em>}
                    </span>
                    <span className="client-deals">
                      <b>{row.activeCount}</b>
                      <small>активных</small>
                    </span>
                    <span className="client-sum">
                      <b>{fmtMoney(row.openSum, { compact: true })}</b>
                      <small>в работе</small>
                    </span>
                    <span className="client-arrow">›</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {newDealOpen && (
        <Modal
          title="Новая сделка"
          subtitle="Заказ привязывается к клиенту. Даты монтажа заполним позже в карточке."
          onClose={() => setNewDealOpen(false)}
          footer={(
            <>
              <button type="button" className="btn ghost" onClick={() => setNewDealOpen(false)}>Отмена</button>
              <button type="button" className="btn primary" onClick={createDeal}>Создать сделку</button>
            </>
          )}
        >
          <div className="form-grid">
            <label className="field span-2">Название заказа
              <input autoFocus value={newDeal.title} placeholder="Кухня на Ленина, 42" onChange={(event) => setNewDeal({ ...newDeal, title: event.target.value })} />
            </label>
            <label className="field span-2">Клиент
              <select value={newDeal.clientId} onChange={(event) => setNewDeal({ ...newDeal, clientId: event.target.value })}>
                <option value="">— выберите клиента —</option>
                {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
              </select>
            </label>
            <label className="field">Сумма, ₽
              <input value={newDeal.amount} inputMode="numeric" placeholder="0" onChange={(event) => setNewDeal({ ...newDeal, amount: event.target.value })} />
            </label>
            <label className="field">Этап
              <select value={newDeal.status} onChange={(event) => setNewDeal({ ...newDeal, status: event.target.value as DealStatus })}>
                {(['draft', 'calculating', 'offerSent', 'clientThinking', 'approved'] as DealStatus[]).map((status) => (
                  <option key={status} value={status}>{statusMeta(status).label}</option>
                ))}
              </select>
            </label>
            <label className="field span-2">Ответственный
              <select value={newDeal.manager} onChange={(event) => setNewDeal({ ...newDeal, manager: event.target.value })}>
                <option value="">не назначен</option>
                {managers.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
            {clients.length === 0 && (
              <p className="form-note span-2">Сначала добавьте клиента — кнопка «+ Клиент» в шапке.</p>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

function DealListRow({ row, client, today, onOpen }: { row: DealRow; client: string; today: string; onOpen: () => void }) {
  const { deal } = row;
  const pay = paymentState(deal);
  const task = nextTask(deal, today);
  const tasks = openTasks(deal).length;
  const tone = contactTone(deal.nextContactAt, today);
  return (
    <li>
      <button type="button" className={`deal-row${row.closed ? ' closed' : ''}`} onClick={onOpen}>
        <span className="deal-main">
          <span className="deal-top">
            <b>{client}</b>
            <i className={`badge badge-${statusMeta(deal.status).tone}`}>{statusMeta(deal.status).label}</i>
            {deal.manager && <i className="badge badge-ghost">{deal.manager}</i>}
          </span>
          <span className="deal-title">{deal.title}</span>
          <span className="deal-action">
            {deal.nextAction?.trim() || (task?.title ?? 'Следующий шаг не назначен')}
          </span>
          <span className="deal-meta">
            {tasks > 0 && <span>{tasks} задач</span>}
            {pay.paid > 0 && <span>{pay.label}</span>}
            {tone !== 'none' && !row.closed && <span className={`tone-${tone}`}>{relativeDay(deal.nextContactAt, today)}</span>}
            {deal.schedule.installAt && <span>монтаж {fmtDate(deal.schedule.installAt)}</span>}
          </span>
        </span>
        <span className="deal-money">
          <b>{fmtMoney(deal.amount)}</b>
          <small>{pay.remainder > 0 ? `остаток ${fmtMoney(pay.remainder, { compact: true })}` : 'оплачено'}</small>
          <i className="pay-bar"><span style={{ width: `${pay.percent}%` }} /></i>
        </span>
        <span className="deal-arrow">›</span>
      </button>
    </li>
  );
}
