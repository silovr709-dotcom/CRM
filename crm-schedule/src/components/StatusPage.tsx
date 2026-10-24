// Страница статуса заказа для клиента: #/status/<payload>.
// Открывается без входа и без общей базы — данные пришли в самой ссылке,
// поэтому её можно отправить в WhatsApp или показать QR-кодом.
import { CalendarCheck, Check, Clock, Home, Phone, Printer } from 'lucide-react';
import type { SharedStatus } from '../lib/share';
import { STATUS_TEXT, docDate } from '../lib/documents';
import { fmtMoney } from '../lib/dates';
import type { DealStatus } from '../types';
import { navigate } from '../lib/router';

function stageText(status: string): string {
  return STATUS_TEXT[status as DealStatus] ?? 'Заказ в работе';
}

/** Что заказано и когда — только важное для клиента. */
const STEPS: { key: keyof SharedStatus['order']; label: string }[] = [
  { key: 'measureAt', label: 'Замер' },
  { key: 'readyAt', label: 'Готово на фабрике' },
  { key: 'deliveryAt', label: 'Доставка' },
  { key: 'installAt', label: 'Монтаж' },
];

export default function StatusPage({ payload }: { payload: SharedStatus | null }) {
  if (!payload) {
    return (
      <div className="status-page">
        <div className="status-card">
          <h1>Ссылка не открылась</h1>
          <p className="muted">
            Скорее всего, она скопирована не целиком. Попросите менеджера отправить ссылку ещё раз —
            или позвоните ему, чтобы узнать статус заказа.
          </p>
          <button type="button" className="btn primary" onClick={() => navigate({ view: 'overview' })}>
            Открыть CRM
          </button>
        </div>
      </div>
    );
  }

  const order = payload.order;
  const steps = STEPS.filter((step) => Boolean(order[step.key]));
  const paidPercent = order.total > 0 ? Math.min(100, Math.round((order.paid / order.total) * 100)) : 0;

  return (
    <div className="status-page">
      <div className="status-card">
        <header className="status-head">
          <div>
            <div className="status-company">{order.company}</div>
            <h1>{order.title}</h1>
            <div className="muted">{order.client ? `Заказчик: ${order.client}` : 'Заказ'}</div>
          </div>
          <span className="status-stage">{stageText(order.stage)}</span>
        </header>

        <div className="status-progress" aria-label={`Этап: ${stageText(order.stage)}`}>
          <div className="status-track"><i style={{ width: `${Math.max(6, paidPercent)}%` }} /></div>
          <div className="muted small">
            Оплачено {fmtMoney(order.paid)} из {fmtMoney(order.total)}
          </div>
        </div>

        {order.address && (
          <p className="status-line"><Home size={15} /> {order.address}</p>
        )}

        {steps.length > 0 && (
          <div className="status-block">
            <h2><CalendarCheck size={16} /> Сроки</h2>
            <ul className="status-steps">
              {steps.map((step) => (
                <li key={step.key}>
                  <Clock size={14} />
                  <span>{step.label}</span>
                  <b>
                    {docDate(String(order[step.key]))}
                    {step.key === 'installAt' && order.timeStart ? `, ${order.timeStart}` : ''}
                  </b>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="status-money">
          <div><span>Сумма заказа</span><b>{fmtMoney(order.total)}</b></div>
          <div><span>Оплачено</span><b>{fmtMoney(order.paid)}</b></div>
          <div><span>Остаток</span><b>{fmtMoney(order.remainder)}</b></div>
        </div>

        {order.remainder <= 0 && order.total > 0 && (
          <p className="status-line ok"><Check size={15} /> Заказ оплачен полностью</p>
        )}

        <div className="status-contact">
          {order.phone && (
            <a className="btn primary" href={`tel:${order.phone.replace(/[^\d+]/g, '')}`}>
              <Phone size={15} /> {order.manager || 'Позвонить'}
            </a>
          )}
          <button type="button" className="btn ghost" onClick={() => window.print()}>
            <Printer size={15} /> Распечатать
          </button>
        </div>

        <p className="muted small status-updated">
          Обновлено {docDate(order.updatedAt.slice(0, 10))}. Если статус изменился, менеджер пришлёт
          новую ссылку — она всегда свежая.
        </p>
      </div>
    </div>
  );
}
