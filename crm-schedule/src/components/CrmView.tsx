// CRM: сделки и клиенты, воронка, фильтры, доска и разбор очереди.
import { useMemo, useState } from 'react';
import {
  ArrowRight, Copy, Filter, LayoutGrid, List, Paperclip, Phone, Play, Search, Trash2,
  Users, X,
} from 'lucide-react';
import type { Deal, DealStatus } from '../types';
import { useApp } from '../store';
import { fmtDate, fmtMoney, fmtMoneyCompact, relativeDay, todayISO } from '../lib/dates';
import { contactTone, isClosedStatus, statusMeta } from '../lib/crm';
import {
  buildDealRows, compareCrmRows, CRM_FOCUS_LABELS, CRM_STAGES, focusCounts,
  matchesFocus, matchesQuery, summarizeStages, type CrmFocus, type DealRow,
} from '../lib/crmBoard';
import { nextTask, openTasks, paymentState, taskStats } from '../lib/crmTasks';
import { findDuplicateClients } from '../lib/storage';
import { usePrefs } from '../lib/viewPrefs';
import { useDragDrop } from '../lib/dnd';
import EmptyState from './EmptyState';
import Modal from './Modal';

const PAGE_SIZE = 30;

export default function CrmView(props: {
  onOpenDeal: (id: string) => void;
  onOpenClient: (id: string) => void;
  onNewClient: () => void;
  onNewDeal: () => void;
  onStartQueue: (ids: string[]) => void;
}) {
  const {
    deals, clients, clientName, changeStatus, patchDeal, removeDeal, settings, mergeClients, notify,
  } = useApp();
  const [prefs, patchPrefs] = usePrefs('crm', {
    mode: 'deals' as 'deals' | 'clients',
    focus: 'active' as CrmFocus,
    stage: '',
    board: false,
    manager: '',
    sort: 'urgency' as 'urgency' | 'money' | 'updated',
    mine: false,
  });
  const [query, setQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [selected, setSelected] = useState<string[]>([]);
  const [duplicatesOpen, setDuplicatesOpen] = useState(false);

  const today = todayISO();
  const rows = useMemo(() => buildDealRows(
    deals,
    (deal) => clientName(deal),
    today,
    (deal) => {
      const client = clients.find((item) => item.id === deal.clientId);
      return [client?.phones.join(' '), client?.emails.join(' '), client?.source, client?.tags.join(' '), client?.address]
        .filter(Boolean).join(' ');
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
    const stageDef = stages.find((item) => item.id === prefs.stage);
    const list = rows
      .filter((row) => matchesFocus(row, prefs.focus) && matchesQuery(row, query))
      .filter((row) => !stageDef || stageDef.statuses.includes(row.status))
      .filter((row) => !prefs.manager || (row.deal.manager ?? '') === prefs.manager)
      .filter((row) => !prefs.mine || (row.deal.manager ?? '') === settings.myName);
    if (prefs.sort === 'money') return [...list].sort((left, right) => right.total - left.total);
    if (prefs.sort === 'updated') return [...list].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    return [...list].sort(compareCrmRows);
  }, [rows, prefs, query, stages, settings.myName]);

  const duplicates = useMemo(() => findDuplicateClients(clients), [clients]);

  const clientRows = useMemo(() => {
    type ClientRow = { id: string; name: string; phone: string; email: string; tags: string[]; deals: Deal[]; files: number };
    const byClient = new Map<string, ClientRow>();
    for (const client of clients) {
      byClient.set(client.id, {
        id: client.id,
        name: client.name,
        phone: client.phones[0] ?? '',
        email: client.emails[0] ?? '',
        tags: client.tags,
        deals: [],
        files: client.attachments?.length ?? 0,
      });
    }
    for (const deal of deals) {
      const entry = byClient.get(deal.clientId);
      if (entry) entry.deals.push(deal);
      else if (deal.clientId) byClient.set(deal.clientId, { id: deal.clientId, name: clientName(deal), phone: '', email: '', tags: [], deals: [deal], files: 0 });
    }
    const needle = query.trim().toLocaleLowerCase('ru-RU');
    return Array.from(byClient.values())
      .map((entry) => {
        const active = entry.deals.filter((deal) => !isClosedStatus(deal.status));
        return {
          ...entry,
          activeCount: active.length,
          openSum: active.reduce((sum, deal) => sum + deal.amount, 0),
          lastTouch: entry.deals.reduce((latest, deal) => (deal.updatedAt > latest ? deal.updatedAt : latest), ''),
        };
      })
      .filter((entry) => !needle || [entry.name, entry.phone, entry.email, entry.tags.join(' ')].join(' ').toLocaleLowerCase('ru-RU').includes(needle))
      .sort((left, right) => right.openSum - left.openSum || right.lastTouch.localeCompare(left.lastTouch));
  }, [clients, deals, clientName, query]);

  const { drag, over, bind } = useDragDrop((payload, target) => {
    if (payload.kind !== 'deal') return;
    const stage = CRM_STAGES.find((item) => item.id === target);
    if (!stage) return;
    const deal = deals.find((item) => item.id === payload.id);
    if (!deal) return;
    if (stage.statuses.includes(deal.status)) return;
    changeStatus(deal.id, stage.statuses[0]);
    notify(`«${deal.title}» → ${stage.title}`, 'ok', {
      label: 'Вернуть',
      run: () => changeStatus(deal.id, deal.status),
    });
  });

  const toggleSelected = (id: string) => {
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  };

  const bulk = {
    status: (status: DealStatus) => {
      selected.forEach((id) => changeStatus(id, status));
      notify(`Этап изменён у ${selected.length} сделок`);
      setSelected([]);
    },
    manager: (manager: string) => {
      selected.forEach((id) => patchDeal(id, { manager: manager || undefined }));
      notify(`Ответственный назначен у ${selected.length} сделок`);
      setSelected([]);
    },
    followUp: (days: number) => {
      selected.forEach((id) => patchDeal(id, { nextContactAt: new Date(Date.now() + days * 86400000).toISOString().slice(0, 10) }));
      notify(`Следующий контакт сдвинут на ${days === 0 ? 'сегодня' : `+${days} дн.`} у ${selected.length} сделок`);
      setSelected([]);
    },
    remove: () => {
      if (!confirm(`Удалить ${selected.length} сделок? Их можно вернуть кнопкой «Вернуть».`)) return;
      selected.forEach((id) => removeDeal(id));
      setSelected([]);
    },
  };

  const copyPhone = async (phone: string) => {
    try {
      await navigator.clipboard.writeText(phone);
      notify('Телефон скопирован');
    } catch {
      notify('Не удалось скопировать', 'error');
    }
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
          <button type="button" className="btn ghost" onClick={props.onNewClient}>
            <Users size={16} /> Клиент
          </button>
          <button type="button" className="btn primary" onClick={props.onNewDeal}>+ Сделка</button>
        </div>
      </header>

      <section className="crm-controls">
        <div className="segmented" role="tablist" aria-label="Что показывать">
          <button type="button" role="tab" aria-selected={prefs.mode === 'deals'} className={prefs.mode === 'deals' ? 'active' : ''} onClick={() => patchPrefs({ mode: 'deals' })}>
            <List size={14} /> Сделки
          </button>
          <button type="button" role="tab" aria-selected={prefs.mode === 'clients'} className={prefs.mode === 'clients' ? 'active' : ''} onClick={() => patchPrefs({ mode: 'clients' })}>
            <Users size={14} /> Клиенты
          </button>
        </div>

        <div className="search-wrap">
          <Search size={15} />
          <input
            value={query}
            placeholder="Клиент, заказ, телефон…"
            onChange={(event) => { setQuery(event.target.value); setVisibleCount(PAGE_SIZE); }}
            aria-label="Поиск по CRM"
          />
          {query && (
            <button type="button" className="search-clear" onClick={() => setQuery('')} aria-label="Очистить поиск">
              <X size={14} />
            </button>
          )}
        </div>

        {prefs.mode === 'deals' && (
          <>
            <div className="segmented" role="tablist" aria-label="Вид">
              <button type="button" role="tab" aria-selected={!prefs.board} className={prefs.board ? '' : 'active'} onClick={() => patchPrefs({ board: false })}>
                <List size={14} /> Список
              </button>
              <button type="button" role="tab" aria-selected={prefs.board} className={prefs.board ? 'active' : ''} onClick={() => patchPrefs({ board: true })}>
                <LayoutGrid size={14} /> Доска
              </button>
            </div>
            {settings.myName && (
              <label className="chip-toggle">
                <input type="checkbox" checked={prefs.mine} onChange={(event) => patchPrefs({ mine: event.target.checked })} />
                только мои
              </label>
            )}
          </>
        )}

        {duplicates.length > 0 && (
          <button type="button" className="chip-toggle warn" onClick={() => setDuplicatesOpen(true)}>
            <Copy size={14} /> дубли: {duplicates.length}
          </button>
        )}
      </section>

      {prefs.mode === 'deals' && (
        <>
          <section className="focus-bar" aria-label="Фокус списка">
            {(['today', 'week', 'no-next', 'active', 'closed', 'all'] as CrmFocus[]).map((value) => {
              const count = value === 'today' ? counts.today
                : value === 'week' ? counts.week
                : value === 'no-next' ? counts.noNext
                : value === 'active' ? counts.active
                : value === 'closed' ? counts.closed
                : rows.length;
              return (
                <button key={value} type="button" className={prefs.focus === value ? 'active' : ''} onClick={() => patchPrefs({ focus: value, stage: '' })}>
                  {CRM_FOCUS_LABELS[value]}<b>{count}</b>
                </button>
              );
            })}
            <span className="focus-money">Портфель: <b>{fmtMoney(counts.pipeline)}</b></span>
          </section>

          <section className="funnel" aria-label="Воронка">
            {stages.map((item) => (
              <button key={item.id} type="button" className={prefs.stage === item.id ? 'active' : ''}
                onClick={() => patchPrefs({ stage: prefs.stage === item.id ? '' : item.id, focus: 'all' })}>
                <b>{item.count}</b>
                <span>{item.title}</span>
                <small>{fmtMoneyCompact(item.total)}</small>
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
              <select value={prefs.manager} onChange={(event) => patchPrefs({ manager: event.target.value })}>
                <option value="">все</option>
                {managers.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
            <label>Сортировать
              <select value={prefs.sort} onChange={(event) => patchPrefs({ sort: event.target.value as typeof prefs.sort })}>
                <option value="urgency">по срочности</option>
                <option value="money">по сумме</option>
                <option value="updated">по последнему изменению</option>
              </select>
            </label>
            <span className="toolbar-count">
              <Filter size={13} /> показано <b>{Math.min(visibleCount, visible.length)}</b> из {visible.length}
            </span>
            {visible.some((row) => row.tone === 'overdue' || row.tone === 'today') && (
              <button
                type="button"
                className="btn small primary"
                onClick={() => props.onStartQueue(visible.filter((row) => row.tone === 'overdue' || row.tone === 'today').map((row) => row.deal.id))}
              >
                <Play size={14} /> Разобрать очередь
              </button>
            )}
          </section>

          {selected.length > 0 && (
            <section className="bulk-bar" aria-label="Массовые действия">
              <b>Выбрано: {selected.length}</b>
              <label>Этап
                <select defaultValue="" onChange={(event) => { if (event.target.value) bulk.status(event.target.value as DealStatus); }}>
                  <option value="">— изменить —</option>
                  {(['calculating', 'offerSent', 'clientThinking', 'approved', 'techCheck', 'factorySent', 'production', 'ready', 'delivered', 'rejected'] as DealStatus[])
                    .map((status) => <option key={status} value={status}>{statusMeta(status).label}</option>)}
                </select>
              </label>
              <label>Ответственный
                <select defaultValue="" onChange={(event) => { if (event.target.value) bulk.manager(event.target.value); }}>
                  <option value="">— назначить —</option>
                  {managers.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </label>
              <button type="button" className="btn small ghost" onClick={() => bulk.followUp(1)}>Контакт завтра</button>
              <button type="button" className="btn small ghost" onClick={() => bulk.followUp(7)}>Через неделю</button>
              <button type="button" className="btn small danger-ghost" onClick={bulk.remove}><Trash2 size={14} /> Удалить</button>
              <button type="button" className="icon-btn" onClick={() => setSelected([])} aria-label="Снять выбор"><X size={15} /></button>
            </section>
          )}

          {prefs.board ? (
            <section className={`board${drag ? ' dragging' : ''}`} aria-label="Доска сделок">
              {CRM_STAGES.map((column) => {
                const items = visible.filter((row) => column.statuses.includes(row.status));
                return (
                  <div key={column.id} className={`board-col${over === column.id ? ' drop' : ''}`} data-drop={column.id}>
                    <header>
                      <b>{column.title}</b>
                      <span>{items.length}</span>
                      <small>{fmtMoneyCompact(items.reduce((sum, row) => sum + row.total, 0))}</small>
                    </header>
                    <div className="board-list">
                      {items.map((row) => (
                        <article
                          key={row.deal.id}
                          className={`board-card${drag?.id === row.deal.id ? ' is-dragged' : ''}`}
                          {...bind({ id: row.deal.id, kind: 'deal', label: row.deal.title })}
                          onClick={() => props.onOpenDeal(row.deal.id)}
                          tabIndex={0}
                          onKeyDown={(event) => { if (event.key === 'Enter') props.onOpenDeal(row.deal.id); }}
                        >
                          <div className="board-card-top">
                            <b>{clientName(row.deal)}</b>
                            <span>{row.total ? fmtMoneyCompact(row.total) : '—'}</span>
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
                <EmptyState
                  icon={<Search size={22} />}
                  title="Ничего не найдено"
                  hint="Смените фильтр или добавьте новую сделку."
                  action={<button type="button" className="btn small primary" onClick={props.onNewDeal}>+ Сделка</button>}
                />
              ) : (
                <>
                  <ul>
                    {visible.slice(0, visibleCount).map((row) => (
                      <DealListRow
                        key={row.deal.id}
                        row={row}
                        client={clientName(row.deal)}
                        today={today}
                        selected={selected.includes(row.deal.id)}
                        onSelect={() => toggleSelected(row.deal.id)}
                        onOpen={() => props.onOpenDeal(row.deal.id)}
                        onCopyPhone={(phone) => copyPhone(phone)}
                      />
                    ))}
                  </ul>
                  {visibleCount < visible.length && (
                    <button type="button" className="load-more" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}>
                      Показать ещё {Math.min(PAGE_SIZE, visible.length - visibleCount)} из {visible.length - visibleCount}
                    </button>
                  )}
                </>
              )}
            </section>
          )}
        </>
      )}

      {prefs.mode === 'clients' && (
        <section className="card client-list">
          <div className="section-head">
            <div>
              <h2>Клиенты</h2>
              <span className="muted">{clientRows.length} в базе</span>
            </div>
            <button type="button" className="btn small ghost" onClick={props.onNewClient}>+ Клиент</button>
          </div>
          {clientRows.length === 0 ? (
            <EmptyState
              icon={<Users size={22} />}
              title="Клиентов пока нет"
              hint="Добавьте первого — сделки привяжутся к его карточке."
              action={<button type="button" className="btn small primary" onClick={props.onNewClient}>Добавить клиента</button>}
            />
          ) : (
            <ul>
              {clientRows.map((row) => (
                <li key={row.id}>
                  <button type="button" className="client-row" onClick={() => props.onOpenClient(row.id)}>
                    <span className="avatar">{row.name.slice(0, 1).toUpperCase()}</span>
                    <span className="client-main">
                      <b>{row.name}</b>
                      <span>{[row.phone, row.email].filter(Boolean).join(' · ') || 'контакты не заполнены'}</span>
                      {(row.tags.length > 0 || row.files > 0) && (
                        <em>
                          {row.tags.map((tag) => <i key={tag} className="tag">{tag}</i>)}
                          {row.files > 0 && <i className="tag tag-file"><Paperclip size={10} /> {row.files}</i>}
                        </em>
                      )}
                    </span>
                    <span className="client-deals">
                      <b>{row.activeCount}</b>
                      <small>активных</small>
                    </span>
                    <span className="client-sum">
                      <b>{row.openSum ? fmtMoneyCompact(row.openSum) : '—'}</b>
                      <small>в работе</small>
                    </span>
                    <span className="client-arrow"><ArrowRight size={16} /></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {duplicatesOpen && (
        <Modal
          title="Похожие клиенты"
          subtitle="Одинаковый телефон или имя. Объединение переносит сделки в одну карточку."
          onClose={() => setDuplicatesOpen(false)}
        >
          {duplicates.length === 0 ? (
            <EmptyState icon={<Copy size={22} />} title="Дублей нет" hint="База клиентов выглядит чисто." />
          ) : (
            <ul className="duplicate-list">
              {duplicates.map((group, index) => (
                <li key={`${group.reason}-${index}`}>
                  <b>{group.reason}</b>
                  <div className="duplicate-people">
                    {group.clients.map((client, clientIndex) => (
                      <span key={client.id} className="duplicate-person">
                        {client.name}
                        {clientIndex === 0 && <i className="tag">оставить</i>}
                        {clientIndex > 0 && (
                          <button
                            type="button"
                            className="btn small ghost"
                            onClick={() => {
                              mergeClients(group.clients[0].id, client.id);
                              setDuplicatesOpen(false);
                            }}
                          >
                            объединить с «{group.clients[0].name}»
                          </button>
                        )}
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}
    </div>
  );
}

function DealListRow({ row, client, today, selected, onSelect, onOpen, onCopyPhone }: {
  row: DealRow;
  client: string;
  today: string;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onCopyPhone: (phone: string) => void;
}) {
  const { clientFor } = useApp();
  const { deal } = row;
  const pay = paymentState(deal);
  const task = nextTask(deal, today);
  const tasks = openTasks(deal).length;
  const tone = contactTone(deal.nextContactAt, today);
  const phone = clientFor(deal)?.phones[0] ?? '';
  const meta = statusMeta(deal.status);

  return (
    <li className={`deal-item status-${meta.stage}${selected ? ' selected' : ''}`}>
      <span className="deal-select">
        <input
          type="checkbox"
          checked={selected}
          onChange={onSelect}
          aria-label={`Выбрать сделку ${deal.title}`}
        />
      </span>
      <button type="button" className={`deal-row${row.closed ? ' closed' : ''}`} onClick={onOpen}>
        <span className="deal-main">
          <span className="deal-top">
            <b>{client}</b>
            <i className={`badge badge-${meta.tone}`}>{meta.label}</i>
            {deal.manager && <i className="badge badge-ghost">{deal.manager}</i>}
            {phone && <span className="deal-phone">{phone}</span>}
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
            {(deal.attachments?.length ?? 0) > 0 && (
              <span className="with-icon"><Paperclip size={11} /> {deal.attachments?.length}</span>
            )}
          </span>
        </span>
        <span className="deal-money">
          <b className={deal.amount ? '' : 'muted'}>{deal.amount ? fmtMoney(deal.amount) : 'сумма не заполнена'}</b>
          <small>{deal.amount ? (pay.remainder > 0 ? `остаток ${fmtMoney(pay.remainder)}` : 'оплачено') : '—'}</small>
          <i className={`pay-bar${pay.remainder > 0 ? ' partial' : ''}`}><span style={{ width: `${pay.percent}%` }} /></i>
        </span>
        <span className="deal-arrow"><ArrowRight size={16} /></span>
      </button>
      {phone && (
        <span className="deal-quick-actions">
          <a className="icon-btn" href={`tel:+${phone.replace(/\D/g, '')}`} title="Позвонить" aria-label={`Позвонить ${client}`}>
            <Phone size={15} />
          </a>
          <button type="button" className="icon-btn" onClick={() => onCopyPhone(phone)} title="Скопировать телефон" aria-label="Скопировать телефон">
            <Copy size={15} />
          </button>
        </span>
      )}
    </li>
  );
}
