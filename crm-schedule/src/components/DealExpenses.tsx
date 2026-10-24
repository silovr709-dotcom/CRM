// Затраты по заказу и маржа: материалы, фабрика, монтаж, доставка.
// Отдельный блок вкладки «Оплата»: считается сразу, без кнопки «сохранить».
import { useState } from 'react';
import { Pencil, Plus, TriangleAlert, X } from 'lucide-react';
import type { Deal, ExpenseKind } from '../types';
import { useApp } from '../store';
import { fmtDate, fmtMoney, todayISO } from '../lib/dates';
import { amountFromInput } from '../lib/utils';
import {
  addExpense, dealMoney, EXPENSE_KINDS, expensesByKind, patchExpense, removeExpense,
} from '../lib/money';

export default function DealExpenses({ deal }: { deal: Deal }) {
  const { updateDeal, undo, notify, settings } = useApp();
  const [draft, setDraft] = useState<{ kind: ExpenseKind; amount: string; at: string; comment: string }>({
    kind: 'materials', amount: '', at: todayISO(), comment: '',
  });
  const [editId, setEditId] = useState('');

  const money = dealMoney(deal);
  const slices = expensesByKind(deal);
  const list = [...(deal.expenses ?? [])].sort((left, right) => right.at.localeCompare(left.at));

  const save = () => {
    const amount = amountFromInput(draft.amount);
    if (!amount) {
      notify('Укажите сумму затраты', 'error');
      return;
    }
    if (editId) {
      updateDeal(patchExpense(deal, editId, {
        kind: draft.kind,
        amount,
        at: draft.at,
        comment: draft.comment,
      }));
      setEditId('');
    } else {
      updateDeal(addExpense(deal, {
        kind: draft.kind,
        amount,
        at: draft.at,
        comment: draft.comment,
        addedBy: settings.myName || undefined,
      }));
    }
    setDraft({ kind: draft.kind, amount: '', at: todayISO(), comment: '' });
  };

  return (
    <div className="deal-expenses">
      <div className="section-head sub">
        <div>
          <h3>Затраты и маржа</h3>
          <span className="muted">материалы, фабрика, монтаж, доставка</span>
        </div>
        <span className={`margin-chip${money.loss ? ' danger' : money.thin ? ' warn' : ''}`}>
          {money.incomplete ? 'маржа не посчитана' : `${fmtMoney(money.margin)} · ${money.marginPercent}%`}
        </span>
      </div>

      {money.loss && (
        <div className="inline-warning">
          <TriangleAlert size={14} /> Затраты больше суммы заказа на {fmtMoney(Math.abs(money.margin))}. Проверьте смету.
        </div>
      )}
      {!money.loss && money.thin && (
        <div className="inline-warning">
          <TriangleAlert size={14} /> Маржа всего {money.marginPercent}% — меньше 10%. Стоит пересмотреть смету.
        </div>
      )}

      {slices.length > 0 && (
        <div className="expense-slices">
          {slices.map((slice) => (
            <span key={slice.kind} title={`${slice.label}: ${fmtMoney(slice.amount)}`}>
              <i style={{ width: `${Math.max(4, Math.round(slice.share * 100))}%` }} />
              <b>{slice.label}</b> {fmtMoney(slice.amount)}
            </span>
          ))}
        </div>
      )}

      {list.length > 0 && (
        <ul className="expense-list">
          {list.map((expense) => (
            <li key={expense.id}>
              <span className="pay-kind">{EXPENSE_KINDS.find((item) => item.id === expense.kind)?.short ?? 'Прочее'}</span>
              <b>{fmtMoney(expense.amount)}</b>
              <span className="muted">{fmtDate(expense.at)}{expense.comment ? ` · ${expense.comment}` : ''}</span>
              <button
                type="button"
                className="icon-btn small"
                aria-label={`Изменить затрату: ${fmtMoney(expense.amount)}`}
                title="Изменить"
                onClick={() => {
                  setEditId(expense.id);
                  setDraft({
                    kind: expense.kind,
                    amount: String(expense.amount),
                    at: expense.at,
                    comment: expense.comment ?? '',
                  });
                }}
              >
                <Pencil size={13} />
              </button>
              <button
                type="button"
                className="icon-btn small"
                aria-label="Удалить затрату"
                onClick={() => {
                  updateDeal(removeExpense(deal, expense.id));
                  notify('Затрата удалена', 'info', { label: 'Вернуть', run: undo });
                }}
              >
                <X size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="expense-form">
        <label className="field">Статья
          <select value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as ExpenseKind })}>
            {EXPENSE_KINDS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        <label className="field">Сумма, ₽
          <input inputMode="numeric" value={draft.amount} placeholder="0" onChange={(event) => setDraft({ ...draft, amount: event.target.value })} />
        </label>
        <label className="field">Дата
          <input type="date" value={draft.at} onChange={(event) => setDraft({ ...draft, at: event.target.value })} />
        </label>
        <label className="field">Комментарий
          <input value={draft.comment} placeholder="например, фабрика «Мария»" onChange={(event) => setDraft({ ...draft, comment: event.target.value })} />
        </label>
        <button type="button" className="btn primary" onClick={save}>
          {editId ? 'Сохранить затрату' : <><Plus size={14} /> Добавить затрату</>}
        </button>
        {editId && (
          <button
            type="button"
            className="btn small ghost"
            onClick={() => {
              setEditId('');
              setDraft({ kind: 'materials', amount: '', at: todayISO(), comment: '' });
            }}
          >
            Отменить
          </button>
        )}
      </div>
      <p className="inline-note">
        Маржа = сумма заказа − затраты. Учитываются только внесённые затраты, поэтому без них процент не считается.
      </p>
    </div>
  );
}
