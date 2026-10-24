// Печать: лист дня для бригады и карточка заказа.
// Печатаем через скрытый iframe — без всплывающих окон и блокировщиков.
import type { Client, Deal } from '../types';
import type { Period, Slice, Totals, FunnelStage } from './reports';
import { fmtDate, fmtMoney, fmtTimeRange, fmtWeekday, todayISO } from './dates';
import { paidAmount, paymentKindLabel, taskKindMeta } from './crmTasks';
import { statusMeta } from './crm';
import { collectEvents, eventsOfDay, scheduleKindMeta, scheduleStatusMeta } from './schedule';

const PRINT_CSS = `
  * { box-sizing: border-box; }
  body { font: 13px/1.45 -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #111; margin: 0; padding: 24px; }
  h1 { font-size: 20px; margin: 0 0 2px; }
  h2 { font-size: 14px; margin: 18px 0 6px; text-transform: uppercase; letter-spacing: .06em; color: #555; }
  .muted { color: #666; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111; padding-bottom: 10px; }
  .event { border: 1px solid #ccc; border-radius: 6px; padding: 10px 12px; margin-bottom: 10px; page-break-inside: avoid; }
  .event-top { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; }
  .kind { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #666; }
  .time { font-weight: 700; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  td { border-bottom: 1px solid #eee; padding: 4px 0; vertical-align: top; }
  td:first-child { width: 38%; color: #666; }
  .badge { display: inline-block; border: 1px solid #999; border-radius: 999px; padding: 1px 7px; font-size: 11px; }
  .footer { margin-top: 26px; display: flex; gap: 40px; color: #666; font-size: 12px; }
  .line { border-bottom: 1px solid #999; display: inline-block; min-width: 180px; }
  .total { font-size: 16px; font-weight: 700; }
  table.grid th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: #666; border-bottom: 1px solid #999; padding: 4px 0; }
  table.grid td { padding: 4px 0; }
  table.summary { border-collapse: separate; border-spacing: 8px; }
  table.summary td { border: 1px solid #ddd; border-radius: 6px; padding: 8px 10px; width: 25%; }
  table.summary span { display: block; font-size: 11px; }
  table.summary b { font-size: 15px; }
  @page { margin: 14mm; }
`;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function row(label: string, value?: string): string {
  if (!value) return '';
  return `<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(value)}</td></tr>`;
}

export function printHtml(title: string, body: string): void {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(frame);

  const doc = frame.contentDocument;
  if (!doc) {
    frame.remove();
    return;
  }
  doc.open();
  doc.write(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${PRINT_CSS}</style></head><body>${body}</body></html>`);
  doc.close();

  const run = () => {
    try {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    } finally {
      window.setTimeout(() => frame.remove(), 1500);
    }
  };
  if (doc.readyState === 'complete') window.setTimeout(run, 120);
  else frame.onload = () => window.setTimeout(run, 120);
}

/** Лист дня: что и где делает бригада, с телефонами и подписями. */
export function printDaySheet(
  deals: Deal[],
  day: string,
  clientName: (deal: Deal) => string,
  company: string,
): void {
  const events = eventsOfDay(collectEvents(deals, clientName), day);
  const rows = events.map((event) => {
    const deal = deals.find((item) => item.id === event.dealId);
    const kind = scheduleKindMeta(event.kind);
    const status = scheduleStatusMeta(event.status);
    return `<div class="event">
      <div class="event-top">
        <div>
          <div class="kind">${escapeHtml(kind.label)} · ${escapeHtml(status.label)}</div>
          <b>${escapeHtml(event.dealTitle)}</b>
          <div class="muted">${escapeHtml(event.client)}</div>
        </div>
        <div class="time">${escapeHtml(fmtTimeRange(event.timeStart, event.timeEnd) || 'весь день')}</div>
      </div>
      <table>
        ${row('Адрес', event.address)}
        ${row('Телефон', event.phone)}
        ${row('Бригада', event.team)}
        ${row('Сумма заказа', deal ? fmtMoney(deal.amount) : '')}
        ${row('Остаток', deal ? fmtMoney(Math.max(0, deal.amount - paidAmount(deal.payments))) : '')}
        ${row('Заметка', event.note)}
      </table>
    </div>`;
  }).join('');

  printHtml(`Лист дня ${day}`, `
    <div class="head">
      <div>
        <h1>${escapeHtml(company || 'График монтажей')} — лист дня</h1>
        <div class="muted">${escapeHtml(`${fmtWeekday(day)}, ${fmtDate(day, { withYear: true })}`)} · событий: ${events.length}</div>
      </div>
      <div class="muted">Напечатано ${escapeHtml(new Date().toLocaleString('ru-RU'))}</div>
    </div>
    <h2>События дня</h2>
    ${rows || '<p class="muted">На этот день ничего не назначено.</p>'}
    <div class="footer">
      <span>Мастер: <span class="line"></span></span>
      <span>Клиент принял: <span class="line"></span></span>
    </div>
  `);
}

/** Карточка заказа: состав, деньги, график, задачи. */
export function printDealCard(
  deal: Deal,
  client: Client | undefined,
  clientNameFallback: string,
  company: string,
): void {
  const paid = paidAmount(deal.payments);
  const payments = deal.payments
    .map((payment) => `<tr><td>${escapeHtml(fmtDate(payment.at))}</td><td>${escapeHtml(paymentKindLabel(payment.kind))}</td><td>${escapeHtml(fmtMoney(payment.amount))}</td></tr>`)
    .join('');
  const tasks = deal.tasks
    .filter((task) => !task.done)
    .map((task) => `<tr><td>${escapeHtml(task.dueAt ? fmtDate(task.dueAt) : '—')}</td><td>${escapeHtml(taskKindMeta(task.kind).label)}</td><td>${escapeHtml(task.title)}</td></tr>`)
    .join('');

  printHtml(`Заказ ${deal.title}`, `
    <div class="head">
      <div>
        <h1>${escapeHtml(deal.title)}</h1>
        <div class="muted">${escapeHtml(`${company} · ${statusMeta(deal.status).label} · от ${fmtDate(deal.createdAt.slice(0, 10), { withYear: true })}`)}</div>
      </div>
      <div class="total">${escapeHtml(fmtMoney(deal.amount))}</div>
    </div>
    <h2>Клиент</h2>
    <table>
      ${row('Имя', client?.name || clientNameFallback)}
      ${row('Телефон', client?.phones.join(', '))}
      ${row('Email', client?.emails.join(', '))}
      ${row('Адрес объекта', client?.address || deal.schedule.address)}
      ${row('Ответственный', deal.manager)}
    </table>
    <h2>График</h2>
    <table>
      ${row('Замер', deal.schedule.measureAt ? fmtDate(deal.schedule.measureAt, { withYear: true }) : '')}
      ${row('Готовность на фабрике', deal.schedule.readyAt ? fmtDate(deal.schedule.readyAt, { withYear: true }) : '')}
      ${row('Доставка', deal.schedule.deliveryAt ? fmtDate(deal.schedule.deliveryAt, { withYear: true }) : '')}
      ${row('Монтаж', deal.schedule.installAt ? `${fmtDate(deal.schedule.installAt, { withYear: true })} ${fmtTimeRange(deal.schedule.timeStart, deal.schedule.timeEnd)}` : '')}
      ${row('Бригада', deal.schedule.team)}
      ${row('Статус графика', scheduleStatusMeta(deal.schedule.status).label)}
      ${row('Заметка для бригады', deal.schedule.note)}
    </table>
    <h2>Оплата</h2>
    <div>Получено ${escapeHtml(fmtMoney(paid))} из ${escapeHtml(fmtMoney(deal.amount))}, остаток ${escapeHtml(fmtMoney(Math.max(0, deal.amount - paid)))}</div>
    ${payments ? `<table><tr><td><b>Дата</b></td><td><b>Тип</b></td><td><b>Сумма</b></td></tr>${payments}</table>` : '<p class="muted">Платежей нет.</p>'}
    ${tasks ? `<h2>Открытые задачи</h2><table><tr><td><b>Срок</b></td><td><b>Тип</b></td><td><b>Задача</b></td></tr>${tasks}</table>` : ''}
    ${deal.comment ? `<h2>Комментарий</h2><p>${escapeHtml(deal.comment)}</p>` : ''}
    <div class="footer">
      <span>Менеджер: <span class="line"></span></span>
      <span>Клиент: <span class="line"></span></span>
    </div>
    <div class="muted" style="margin-top:14px">Сегодня ${escapeHtml(fmtDate(todayISO(), { withYear: true }))}</div>
  `);
}

/** Отчёт за период: цифры, воронка, менеджеры, источники, причины отказа. */
export function printReport(input: {
  period: Period;
  totals: Totals;
  funnel: FunnelStage[];
  managers: Slice[];
  sources: Slice[];
  losses: Slice[];
  company?: string;
}): void {
  const money = (value: number) => fmtMoney(value);
  const percent = (value: number) => `${value.toLocaleString('ru-RU')} %`;
  const table = (title: string, head: string[], rows: string[][]) => {
    if (rows.length === 0) return `<h2>${escapeHtml(title)}</h2><p class="muted">Нет данных за период.</p>`;
    return `
      <h2>${escapeHtml(title)}</h2>
      <table class="grid">
        <thead><tr>${head.map((cell) => `<th>${escapeHtml(cell)}</th>`).join('')}</tr></thead>
        <tbody>${rows.map((cells) => `<tr>${cells.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>`;
  };

  const body = `
    <div class="head">
      <div>
        <h1>${escapeHtml(input.company || 'Отчёт')}</h1>
        <div class="muted">${escapeHtml(input.period.label)} · ${escapeHtml(input.period.from)} — ${escapeHtml(input.period.to)}</div>
      </div>
      <div class="muted">Напечатано ${escapeHtml(new Date().toLocaleString('ru-RU'))}</div>
    </div>

    <h2>Главное</h2>
    <table class="summary">
      <tr>
        <td><span class="muted">Новых сделок</span><b>${input.totals.bookedCount}</b></td>
        <td><span class="muted">Сумма новых</span><b>${money(input.totals.booked)}</b></td>
        <td><span class="muted">Получено</span><b>${money(input.totals.received)}</b></td>
        <td><span class="muted">Затраты</span><b>${money(input.totals.spent)}</b></td>
      </tr>
      <tr>
        <td><span class="muted">Деньги на руках</span><b>${money(input.totals.cash)}</b></td>
        <td><span class="muted">Маржа</span><b>${money(input.totals.margin)}</b></td>
        <td><span class="muted">Маржа, %</span><b>${percent(input.totals.marginPercent)}</b></td>
        <td><span class="muted">Средний чек</span><b>${money(input.totals.averageDeal)}</b></td>
      </tr>
      <tr>
        <td><span class="muted">В работе</span><b>${input.totals.activeDeals}</b></td>
        <td><span class="muted">Портфель</span><b>${money(input.totals.pipeline)}</b></td>
        <td><span class="muted">Ждём оплату</span><b>${money(input.totals.receivable)}</b></td>
        <td><span class="muted">Отказов</span><b>${input.totals.closedLost}</b></td>
      </tr>
    </table>

    ${table('Воронка', ['Этап', 'Сделок', 'Сумма'], input.funnel.map((stage) => [stage.label, String(stage.count), money(stage.amount)]))}
    ${table('Менеджеры', ['Менеджер', 'Сделок', 'Сумма', 'Оплачено'], input.managers.map((slice) => [slice.label, String(slice.deals), money(slice.amount), money(slice.paid)]))}
    ${table('Источники', ['Источник', 'Сделок', 'Сумма'], input.sources.map((slice) => [slice.label, String(slice.deals), money(slice.amount)]))}
    ${table('Причины отказа', ['Причина', 'Сделок', 'Потеряно'], input.losses.map((slice) => [slice.label, String(slice.deals), money(slice.amount)]))}

    <div class="footer">
      <span>Подпись: <span class="line"></span></span>
      <span>Дата: <span class="line"></span></span>
    </div>
  `;
  printHtml(`Отчёт ${input.period.label}`, body);
}
