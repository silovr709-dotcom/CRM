// Карточка клиента: контакты, сделки, история, объединение дублей.
import { useMemo, useState } from 'react';
import { Copy, Link2, Merge, Phone, Plus, Trash2 } from 'lucide-react';
import type { Client } from '../types';
import { useApp } from '../store';
import { fmtDate, fmtMoney, fmtMoneyCompact, telHref, todayISO } from '../lib/dates';
import { isClosedStatus, statusMeta } from '../lib/crm';
import { buildClientTimeline, TIMELINE_META } from '../lib/crmTimeline';
import { findDuplicateClients } from '../lib/storage';
import { absoluteLink } from '../lib/router';
import Modal from './Modal';

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
  const { clients, deals, saveClient, removeClient, mergeClients, notify } = useApp();
  const existing = clients.find((item) => item.id === clientId);
  const [draft, setDraft] = useState<Client>(() => existing ? { ...existing } : emptyClient());
  const [phonesText, setPhonesText] = useState((existing?.phones ?? []).join('\n'));
  const [emailsText, setEmailsText] = useState((existing?.emails ?? []).join('\n'));
  const [tagsText, setTagsText] = useState((existing?.tags ?? []).join(', '));
  const isNew = !existing;

  const clientDeals = useMemo(
    () => deals.filter((deal) => deal.clientId === clientId).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [deals, clientId],
  );
  const timeline = useMemo(() => buildClientTimeline(clientDeals, 10), [clientDeals]);
  const openSum = clientDeals.filter((deal) => !isClosedStatus(deal.status)).reduce((sum, deal) => sum + deal.amount, 0);
  const today = todayISO();

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

  const save = () => {
    const name = draft.name.trim();
    if (!name) { notify('У клиента должно быть имя', 'error'); return; }
    const saved: Client = {
      ...draft,
      name,
      phones: phonesText.split(/[\n,;]+/).map((value) => value.trim()).filter(Boolean),
      emails: emailsText.split(/[\n,;]+/).map((value) => value.trim()).filter(Boolean),
      tags: tagsText.split(/[,;]+/).map((value) => value.trim()).filter(Boolean),
      id: existing?.id ?? '',
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };
    const id = saveClient(saved);
    notify(isNew ? 'Клиент добавлен' : 'Клиент сохранён');
    onClose();
    if (isNew) onNewDeal(id);
  };

  return (
    <Modal
      title={isNew ? 'Новый клиент' : draft.name || 'Клиент'}
      subtitle={isNew ? 'Имя обязательно, остальное можно позже.' : `В базе с ${fmtDate(draft.createdAt?.slice(0, 10))}`}
      onClose={onClose}
      size="lg"
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
          {!isNew && <button type="button" className="btn ghost" onClick={() => onNewDeal(clientId)}><Plus size={14} /> Сделка</button>}
          <button type="button" className="btn primary" onClick={save}>{isNew ? 'Добавить клиента' : 'Сохранить'}</button>
        </>
      )}
    >
      <div className="client-grid">
        <div className="form-grid">
          <label className="field span-2">Имя
            <input data-autofocus autoFocus value={draft.name} placeholder="Анна Смирнова" onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          </label>
          <label className="field">Телефоны
            <textarea rows={2} value={phonesText} placeholder="+7 900 000-00-00" onChange={(event) => setPhonesText(event.target.value)} />
            <small className="field-hint">по одному в строке</small>
          </label>
          <label className="field">Почта
            <textarea rows={2} value={emailsText} placeholder="anna@example.ru" onChange={(event) => setEmailsText(event.target.value)} />
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
                            <small>{meta.label}</small>
                          </span>
                          <span className="mini-deal-sum">{deal.amount ? fmtMoneyCompact(deal.amount) : '—'}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {timeline.length > 0 && (
              <div className="info-card">
                <h3>История</h3>
                <ul className="timeline mini">
                  {timeline.map((event) => (
                    <li key={event.id} className={`timeline-row timeline-${event.kind}`}>
                      <span className="timeline-icon">{TIMELINE_META[event.kind]?.icon ?? '•'}</span>
                      <span className="timeline-main"><b>{event.title}</b>{event.detail && <span>{event.detail}</span>}</span>
                      <span className="timeline-date">{fmtDate(event.at.slice(0, 10))}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

          </div>
        )}
      </div>

      {!isNew && clientDeals.some((deal) => deal.nextContactAt && deal.nextContactAt < today) && (
        <div className="inline-warning">
          Есть просроченные контакты — проверьте сделки клиента.
        </div>
      )}
    </Modal>
  );
}
