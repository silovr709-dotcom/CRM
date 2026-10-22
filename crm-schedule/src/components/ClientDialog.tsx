// Карточка клиента: контакты, теги, заметки и все его сделки.
import { useState } from 'react';
import type { Client } from '../types';
import { useApp } from '../store';
import { fmtDate, fmtMoney, digitsOnly, telHref } from '../lib/dates';
import { statusMeta } from '../lib/crm';
import { nowIso, splitList, uid } from '../lib/utils';
import Modal from './Modal';

const TAG_PRESETS = ['Горячий', 'Постоянный', 'Дизайнер', 'Рекомендация', 'Срочно', 'Проблема'];

export default function ClientDialog({ clientId, onClose, onOpenDeal }: {
  clientId: string;
  onClose: () => void;
  onOpenDeal: (id: string) => void;
}) {
  const { clients, deals, saveClient, removeClient, notify } = useApp();
  const existing = clients.find((item) => item.id === clientId);
  const isNew = !existing;
  const [draft, setDraft] = useState<Client>(existing ?? {
    id: uid('cli'),
    name: '',
    phones: [],
    emails: [],
    tags: [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });
  const [phoneText, setPhoneText] = useState((existing?.phones ?? []).join(', '));
  const [emailText, setEmailText] = useState((existing?.emails ?? []).join(', '));
  const [tagText, setTagText] = useState('');

  const clientDeals = deals.filter((deal) => deal.clientId === draft.id);

  const save = () => {
    const name = draft.name.trim();
    if (!name) { notify('Укажите имя клиента', 'error'); return; }
    const next: Client = {
      ...draft,
      name,
      phones: splitList(phoneText),
      emails: splitList(emailText),
      tags: draft.tags,
      updatedAt: nowIso(),
    };
    saveClient(next);
    notify(isNew ? 'Клиент добавлен' : 'Карточка клиента сохранена');
    onClose();
  };

  const toggleTag = (tag: string) => {
    setDraft((current) => ({
      ...current,
      tags: current.tags.includes(tag) ? current.tags.filter((item) => item !== tag) : [...current.tags, tag],
    }));
  };

  const addCustomTag = () => {
    const tag = tagText.trim();
    if (!tag) return;
    if (!draft.tags.includes(tag)) setDraft((current) => ({ ...current, tags: [...current.tags, tag] }));
    setTagText('');
  };

  return (
    <Modal
      title={isNew ? 'Новый клиент' : draft.name || 'Клиент'}
      subtitle={isNew ? 'Заполните контакты — сделки привяжутся к этой карточке.' : `${clientDeals.length} сделок · в базе с ${fmtDate(draft.createdAt.slice(0, 10), { withYear: true })}`}
      onClose={onClose}
      size="lg"
      footer={(
        <>
          {!isNew && (
            <button type="button" className="btn danger-ghost" onClick={() => {
              if (!confirm(`Удалить клиента «${draft.name}»? Сделки останутся, но без привязки к клиенту.`)) return;
              removeClient(draft.id);
              notify('Клиент удалён');
              onClose();
            }}>Удалить</button>
          )}
          <span className="foot-spacer" />
          <button type="button" className="btn ghost" onClick={onClose}>Отмена</button>
          <button type="button" className="btn primary" onClick={save}>Сохранить</button>
        </>
      )}
    >
      <div className="form-grid">
        <label className="field span-2">Имя
          <input autoFocus value={draft.name} placeholder="Анна Смирнова" onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        </label>
        <label className="field">Телефоны
          <input value={phoneText} placeholder="+7 …, +7 …" onChange={(event) => setPhoneText(event.target.value)} />
          <small className="field-hint">через запятую, если их несколько</small>
        </label>
        <label className="field">Email
          <input value={emailText} placeholder="mail@example.ru" onChange={(event) => setEmailText(event.target.value)} />
        </label>
        <label className="field">Адрес объекта
          <input value={draft.address ?? ''} placeholder="улица, дом, квартира" onChange={(event) => setDraft({ ...draft, address: event.target.value || undefined })} />
        </label>
        <label className="field">Источник
          <input value={draft.source ?? ''} placeholder="рекомендация, сайт, Instagram…" onChange={(event) => setDraft({ ...draft, source: event.target.value || undefined })} />
        </label>
        <div className="field span-2">
          <span className="field-label">Теги</span>
          <div className="tag-picker">
            {TAG_PRESETS.map((tag) => (
              <button key={tag} type="button" className={`tag-btn${draft.tags.includes(tag) ? ' active' : ''}`} onClick={() => toggleTag(tag)}>{tag}</button>
            ))}
            {draft.tags.filter((tag) => !TAG_PRESETS.includes(tag)).map((tag) => (
              <button key={tag} type="button" className="tag-btn active" onClick={() => toggleTag(tag)}>{tag} ✕</button>
            ))}
            <input
              value={tagText}
              placeholder="свой тег"
              onChange={(event) => setTagText(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addCustomTag(); } }}
            />
          </div>
        </div>
        <label className="field span-2">Заметка менеджера
          <textarea rows={3} value={draft.managerComment ?? ''} placeholder="особенности клиента, договорённости" onChange={(event) => setDraft({ ...draft, managerComment: event.target.value })} />
        </label>
      </div>

      {(draft.phones.length > 0 || phoneText) && (
        <div className="client-contact-bar">
          {splitList(phoneText).map((phone) => (
            <span key={phone} className="contact-pill">
              <a href={telHref(phone)}>{phone}</a>
              <a href={`https://wa.me/${digitsOnly(phone)}`} target="_blank" rel="noreferrer" title="WhatsApp">WA</a>
            </span>
          ))}
        </div>
      )}

      {!isNew && (
        <section className="client-deals-block">
          <div className="section-head">
            <h3>Сделки клиента</h3>
            <span className="muted">{fmtMoney(clientDeals.reduce((sum, deal) => sum + deal.amount, 0))} всего</span>
          </div>
          {clientDeals.length === 0 ? (
            <div className="empty-note">Сделок пока нет. Создайте её в CRM — клиент подставится автоматически.</div>
          ) : (
            <ul className="client-deal-list">
              {clientDeals.map((deal) => (
                <li key={deal.id}>
                  <button type="button" onClick={() => onOpenDeal(deal.id)}>
                    <span>
                      <b>{deal.title}</b>
                      <small>{deal.schedule.installAt ? `монтаж ${fmtDate(deal.schedule.installAt)}` : 'монтаж не назначен'}</small>
                    </span>
                    <i className={`badge badge-${statusMeta(deal.status).tone}`}>{statusMeta(deal.status).label}</i>
                    <b className="client-deal-sum">{fmtMoney(deal.amount, { compact: true })}</b>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </Modal>
  );
}
