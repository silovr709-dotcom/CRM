// Документы заказа: смета из позиций, КП/договор/наряд/акт с номерами,
// печать или PDF, и ссылка со статусом для клиента (с QR-кодом).
import { useMemo, useState } from 'react';
import {
  Copy, Download, FileText, ListPlus, Plus, Printer, QrCode as QrIcon, Trash2,
} from 'lucide-react';
import { useApp } from '../store';
import type { Deal, DealItem } from '../types';
import { STATUS_TEXT, buildDocument, documentFileName, documentSubtitle, itemAmount, itemsTotal } from '../lib/documents';
import { DOC_KINDS, docKindMeta, type DocKind } from '../lib/documentKinds';
import { downloadDocument, printDocument } from '../lib/print';
import { fmtMoney, todayISO } from '../lib/dates';
import { paidAmount } from '../lib/crmTasks';
import { absoluteLink } from '../lib/router';
import { encodeStatus } from '../lib/share';
import Modal from './Modal';
import QrCode from './QrCode';

/** Что показать клиенту: та же сумма, что в документе. */
function dealTotal(deal: Deal): number {
  return deal.items?.length ? Math.round(itemsTotal(deal.items)) : deal.amount;
}

export default function DealDocuments({ deal }: { deal: Deal }) {
  const { clientFor, settings, saveDealItems, issueDocument, updateDeal, notify } = useApp();
  const client = clientFor(deal);
  const items = deal.items ?? [];
  const sum = Math.round(itemsTotal(items));
  const total = dealTotal(deal);
  const paid = paidAmount(deal.payments);
  const remainder = Math.max(0, total - paid);

  const [openKind, setOpenKind] = useState<DocKind | null>(null);
  const [qrOpen, setQrOpen] = useState(false);

  const statusLink = useMemo(
    () => absoluteLink({
      view: 'overview',
      status: encodeStatus(deal, client, settings, { total, paid, remainder }),
    }),
    [deal, client, settings, total, paid, remainder],
  );

  const patchItem = (id: string, patch: Partial<DealItem>) => {
    saveDealItems(deal.id, items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const addItem = (patch: Partial<DealItem> = {}) => {
    const item: DealItem = {
      id: `item-${Math.random().toString(36).slice(2, 9)}`,
      title: '',
      qty: 1,
      unit: 'шт.',
      price: 0,
      ...patch,
    };
    saveDealItems(deal.id, [...items, item]);
  };

  const removeItem = (id: string) => saveDealItems(deal.id, items.filter((item) => item.id !== id));

  const openDocument = (kind: DocKind) => {
    const issued = (deal.documents ?? []).filter((doc) => doc.kind === kind).at(-1);
    if (!issued) {
      const created = issueDocument(deal.id, kind);
      if (created) notify(`Документ ${created.number} готов`);
    }
    setOpenKind(kind);
  };

  const current = openKind
    ? (deal.documents ?? []).filter((doc) => doc.kind === openKind).at(-1)
    : undefined;
  const model = openKind
    ? buildDocument({
      kind: openKind,
      number: current?.number ?? 'черновик',
      issuedAt: current?.issuedAt ?? todayISO(),
      deal,
      client,
      settings,
    })
    : null;

  const copy = async (text: string, message: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notify(message);
    } catch {
      notify(`Скопируйте вручную: ${text}`, 'info');
    }
  };

  return (
    <div className="deal-documents">
      <section className="doc-section">
        <div className="section-head tight">
          <div>
            <h3><ListPlus size={15} /> Смета заказа</h3>
            <span className="muted small">из каких позиций складывается сумма</span>
          </div>
          <button type="button" className="btn small ghost" onClick={() => addItem()}>
            <Plus size={14} /> Позиция
          </button>
        </div>

        {items.length === 0 ? (
          <div className="doc-empty">
            <p className="inline-note">
              Позиций пока нет. Сумма заказа — {fmtMoney(deal.amount)}; КП, смета и акт напечатаются
              одной строкой «по договору».
            </p>
            <button
              type="button"
              className="btn small"
              onClick={() => addItem({ title: deal.title || 'Кухня по договору', qty: 1, unit: 'компл.', price: deal.amount })}
            >
              <FileText size={14} /> Заполнить из суммы заказа
            </button>
          </div>
        ) : (
          <>
            <ul className="item-list">
              {items.map((item) => (
                <li key={item.id} className="item-row">
                  <input
                    className="item-title"
                    aria-label="Название позиции"
                    placeholder="Например, шкафы верхние"
                    value={item.title}
                    onChange={(event) => patchItem(item.id, { title: event.target.value })}
                  />
                  <input
                    className="item-num"
                    aria-label="Количество"
                    type="number"
                    min={0}
                    step="0.1"
                    value={item.qty}
                    onChange={(event) => patchItem(item.id, { qty: Number(event.target.value) || 0 })}
                  />
                  <input
                    className="item-unit"
                    aria-label="Единица измерения"
                    value={item.unit}
                    onChange={(event) => patchItem(item.id, { unit: event.target.value })}
                  />
                  <input
                    className="item-num"
                    aria-label="Цена за единицу"
                    type="number"
                    min={0}
                    value={item.price}
                    onChange={(event) => patchItem(item.id, { price: Number(event.target.value) || 0 })}
                  />
                  <span className="item-sum">{fmtMoney(itemAmount(item))}</span>
                  <button
                    type="button"
                    className="icon-btn small"
                    aria-label="Удалить позицию"
                    onClick={() => removeItem(item.id)}
                  >
                    <Trash2 size={13} />
                  </button>
                </li>
              ))}
            </ul>
            <div className="item-total">
              <span>Итого по смете</span>
              <b>{fmtMoney(sum)}</b>
            </div>
            {sum !== deal.amount && (
              <p className="inline-note warn-note">
                В карточке заказа указано {fmtMoney(deal.amount)}.{' '}
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => {
                    updateDeal({ ...deal, amount: sum });
                    notify('Сумма заказа обновлена по смете');
                  }}
                >
                  Поставить сумму по смете
                </button>
              </p>
            )}
          </>
        )}
      </section>

      <section className="doc-section">
        <div className="section-head tight">
          <div>
            <h3><FileText size={15} /> Документы</h3>
            <span className="muted small">
              номер присваивается один раз и не меняется; печать — сразу или «Сохранить как PDF»
            </span>
          </div>
        </div>

        <div className="doc-grid">
          {DOC_KINDS.map((kind) => {
            const issued = (deal.documents ?? []).filter((doc) => doc.kind === kind.id).at(-1);
            return (
              <div key={kind.id} className={`doc-card${issued ? ' issued' : ''}`}>
                <div className="doc-card-top">
                  <b>{kind.title}</b>
                  <span className={`doc-number${issued ? '' : ' draft'}`}>
                    {issued ? issued.number : 'не выдан'}
                  </span>
                </div>
                <p className="muted small">{kind.hint}</p>
                <div className="doc-card-actions">
                  <button type="button" className="btn small ghost" onClick={() => openDocument(kind.id)}>
                    {issued ? 'Открыть' : 'Создать'}
                  </button>
                  <button
                    type="button"
                    className="icon-btn small"
                    title={`Печать: ${kind.title}`}
                    aria-label={`Печать: ${kind.title}`}
                    onClick={() => {
                      const target = issued ?? issueDocument(deal.id, kind.id);
                      const doc = buildDocument({
                        kind: kind.id,
                        number: target?.number ?? 'черновик',
                        issuedAt: target?.issuedAt ?? todayISO(),
                        deal,
                        client,
                        settings,
                      });
                      printDocument(doc);
                    }}
                  >
                    <Printer size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="doc-section">
        <div className="section-head tight">
          <div>
            <h3><QrIcon size={15} /> Статус для клиента</h3>
            <span className="muted small">страница без входа: этап, сроки, оплата и телефон</span>
          </div>
          <button type="button" className="btn small ghost" onClick={() => setQrOpen(true)}>
            <QrIcon size={14} /> QR-код
          </button>
        </div>
        <p className="inline-note">
          Сейчас клиент увидит: {STATUS_TEXT[deal.status].toLowerCase()}
          {deal.schedule?.installAt ? `, монтаж ${deal.schedule.installAt.split('-').reverse().join('.')}` : ''}.
          Отправьте ссылку в WhatsApp — при следующем изменении просто пришлите новую.
        </p>
        <button type="button" className="btn small" onClick={() => void copy(statusLink, 'Ссылка на статус скопирована')}>
          <Copy size={14} /> Скопировать ссылку клиенту
        </button>
      </section>

      {model && openKind && (
        <Modal
          title={`${docKindMeta(openKind).title} ${model.number}`}
          subtitle={documentSubtitle(model)}
          onClose={() => setOpenKind(null)}
          size="lg"
          footer={(
            <>
              <button type="button" className="btn ghost" onClick={() => setOpenKind(null)}>Закрыть</button>
              <button
                type="button"
                className="btn"
                onClick={() => downloadDocument(model, documentFileName(model))}
              >
                <Download size={14} /> Скачать файл
              </button>
              <button type="button" className="btn primary" onClick={() => printDocument(model)}>
                <Printer size={14} /> Печать / PDF
              </button>
            </>
          )}
        >
          <article className="doc-preview">
            <header>
              <div>
                <div className="muted small">{model.company}</div>
                <h4>{model.title}</h4>
                <div className="muted small">№ {model.number} от {model.issuedAt.split('-').reverse().join('.')}</div>
              </div>
              <div className="doc-preview-client">
                <div className="muted small">Заказчик</div>
                <b>{model.client}</b>
                <div className="muted small">{model.subject}</div>
              </div>
            </header>

            {model.intro.map((text) => <p key={text}>{text}</p>)}

            <table className="doc-preview-grid">
              <thead>
                <tr><th>Наименование</th><th>Кол-во</th><th>Цена</th><th>Сумма</th></tr>
              </thead>
              <tbody>
                {model.rows.map((row, index) => (
                  <tr key={`${row.title}-${index}`}>
                    <td>{row.title || '—'}</td>
                    <td>{row.qty} {row.unit}</td>
                    <td>{fmtMoney(row.price)}</td>
                    <td>{fmtMoney(row.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="doc-preview-money">
              <div><span>Итого</span><b>{fmtMoney(model.total)}</b></div>
              {model.paid > 0 && <div><span>Оплачено</span><b>{fmtMoney(model.paid)}</b></div>}
              {model.kind === 'act' && <div><span>Остаток</span><b>{fmtMoney(model.remainder)}</b></div>}
            </div>

            {model.details.length > 0 && (
              <dl className="doc-preview-details">
                {model.details.filter((row) => row.value).map((row) => (
                  <div key={row.label}>
                    <dt>{row.label}</dt>
                    <dd>{row.value}</dd>
                  </div>
                ))}
              </dl>
            )}

            {model.notes.length > 0 && (
              <ul className="doc-preview-notes">
                {model.notes.map((note) => <li key={note}>{note}</li>)}
              </ul>
            )}

            <footer className="doc-preview-sign">
              <span>{model.signatures[0]}</span>
              <span>{model.signatures[1]}</span>
            </footer>
          </article>
        </Modal>
      )}

      {qrOpen && (
        <Modal
          title="QR-код для клиента"
          subtitle="клиент наводит камеру — открывается страница статуса"
          onClose={() => setQrOpen(false)}
          compact
          footer={(
            <>
              <button type="button" className="btn ghost" onClick={() => setQrOpen(false)}>Закрыть</button>
              <button type="button" className="btn primary" onClick={() => void copy(statusLink, 'Ссылка скопирована')}>
                <Copy size={14} /> Скопировать ссылку
              </button>
            </>
          )}
        >
          <QrCode value={statusLink} />
          <p className="inline-note">
            Ссылка работает без входа и без интернета у вас: все данные заказа закодированы в ней.
            После изменений пришлите новую — старая показывает прежний статус.
          </p>
        </Modal>
      )}
    </div>
  );
}
