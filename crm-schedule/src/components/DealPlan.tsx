// План оплат: что и когда клиент должен заплатить. Отсюда же — дебиторка.
import { useState } from 'react';
import { Check, Plus, RotateCcw, X } from 'lucide-react';
import type { Deal, PaymentKind } from '../types';
import { useApp } from '../store';
import { fmtDate, fmtMoney, relativeDay, todayISO } from '../lib/dates';
import { amountFromInput } from '../lib/utils';
import {
  addPlannedPayment, PLAN_KINDS, removePlannedPayment, settlePlannedPayment, unsettlePlannedPayment,
} from '../lib/money';

export default function DealPlan({ deal }: { deal: Deal }) {
  const { updateDeal, undo, notify } = useApp();
  const [draft, setDraft] = useState<{ amount: string; at: string; kind: PaymentKind; comment: string }>({
    amount: '', at: todayISO(), kind: 'final', comment: '',
  });

  const plan = [...(deal.plan ?? [])].sort((left, right) => left.at.localeCompare(right.at));
  const pending = plan.filter((entry) => !entry.paidId);
  const plannedTotal = pending.reduce((sum, entry) => sum + entry.amount, 0);
  const paid = (deal.payments ?? []).reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);
  const remainder = Math.max(0, (deal.amount || 0) - paid);

  const add = () => {
    const amount = amountFromInput(draft.amount);
    if (!amount) {
      notify('Укажите сумму платежа по плану', 'error');
      return;
    }
    updateDeal(addPlannedPayment(deal, { amount, at: draft.at, kind: draft.kind, comment: draft.comment }));
    setDraft({ amount: '', at: todayISO(), kind: 'final', comment: '' });
  };

  return (
    <div className="deal-plan">
      <div className="section-head sub">
        <div>
          <h3>План оплат</h3>
          <span className="muted">что и когда должен клиент</span>
        </div>
        <span className={`margin-chip${plannedTotal > remainder ? ' warn' : ''}`}>
          {pending.length === 0 ? 'план закрыт' : `ждём ${fmtMoney(Math.min(plannedTotal, remainder))}`}
        </span>
      </div>

      {plan.length === 0 ? (
        <div className="empty-note">
          План пуст. Обычно это два платежа: предоплата при подписании и остаток перед монтажом.
        </div>
      ) : (
        <ul className="plan-list">
          {plan.map((entry) => {
            const overdue = !entry.paidId && entry.at < todayISO();
            return (
              <li key={entry.id} className={entry.paidId ? 'paid' : ''}>
                <span className="pay-kind">{PLAN_KINDS.find((item) => item.id === entry.kind)?.label ?? 'Платёж'}</span>
                <b>{fmtMoney(entry.amount)}</b>
                <span className={overdue ? 'danger' : 'muted'}>
                  {fmtDate(entry.at)} · {entry.paidId ? 'получено' : relativeDay(entry.at)}
                </span>
                {entry.paidId ? (
                  <button
                    type="button"
                    className="icon-btn small"
                    aria-label="Снять отметку «получено»"
                    title="Снять отметку"
                    onClick={() => updateDeal(unsettlePlannedPayment(deal, entry.id))}
                  >
                    <RotateCcw size={13} />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="icon-btn small"
                    aria-label={`Отметить полученным: ${fmtMoney(entry.amount)}`}
                    title="Получено"
                    onClick={() => updateDeal(settlePlannedPayment(deal, entry.id))}
                  >
                    <Check size={13} />
                  </button>
                )}
                <button
                  type="button"
                  className="icon-btn small"
                  aria-label="Удалить из плана"
                  onClick={() => {
                    updateDeal(removePlannedPayment(deal, entry.id));
                    notify('Платёж убран из плана', 'info', { label: 'Вернуть', run: undo });
                  }}
                >
                  <X size={13} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="plan-form">
        <label className="field">Сумма, ₽
          <input inputMode="numeric" value={draft.amount} placeholder="0" onChange={(event) => setDraft({ ...draft, amount: event.target.value })} />
        </label>
        <label className="field">Дата
          <input type="date" value={draft.at} onChange={(event) => setDraft({ ...draft, at: event.target.value })} />
        </label>
        <label className="field">Тип
          <select value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as PaymentKind })}>
            {PLAN_KINDS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        <button type="button" className="btn" onClick={add}><Plus size={14} /> В план</button>
      </div>
      <p className="inline-note">
        Отметка «получено» создаёт платёж в списке выше — второй раз вносить его не нужно.
        Строки плана попадают в отчёт «Кто должен» и в дебиторку.
      </p>
    </div>
  );
}
