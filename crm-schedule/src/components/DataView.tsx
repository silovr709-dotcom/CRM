// Настройки и данные: справочники, автоматика, резервные копии и импорт.
import { useRef, useState } from 'react';
import { useApp } from '../store';
import { fmtMoney, todayISO } from '../lib/dates';
import { joinList, splitList } from '../lib/utils';
import {
  exportBackup, exportIcs, importCalculatorBackup, parseBackup,
} from '../lib/storage';
import { loadRules, saveRules } from '../lib/rules';
import { DEFAULT_RULES, runAutomations, type AutomationRule } from '../lib/crmAutomation';
import { paidAmount } from '../lib/crmTasks';
import { collectEvents } from '../lib/schedule';

export default function DataView() {
  const { data, deals, clients, settings, updateSettings, replaceData, resetDemo, clearAll, notify, storageOk } = useApp();
  const [rules, setRules] = useState<AutomationRule[]>(() => loadRules());
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const totalAmount = deals.reduce((sum, deal) => sum + deal.amount, 0);
  const totalPaid = deals.reduce((sum, deal) => sum + paidAmount(deal.payments), 0);
  const events = collectEvents(deals);

  const patchRule = (id: string, patch: Partial<AutomationRule>) => {
    const next = rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule));
    setRules(next);
    saveRules(next);
  };

  const runNow = () => {
    const result = runAutomations(deals, rules);
    if (result.applied.length === 0) {
      notify('Автоматика не нашла, что добавить', 'info');
      return;
    }
    replaceData({ ...data, deals: result.deals, updatedAt: new Date().toISOString() });
    notify(`Автоматика добавила задач: ${result.applied.length}`);
  };

  const importFile = async (file: File) => {
    setBusy(true);
    try {
      const text = await file.text();
      let parsed: { kind?: string } | null = null;
      try { parsed = JSON.parse(text) as { kind?: string }; } catch { throw new Error('Файл не является корректным JSON.'); }
      if (parsed?.kind === 'recept-backup') {
        const result = importCalculatorBackup(text);
        if (!confirm(`Импортировать ${result.deals} заказов и ${result.clients} клиентов из калькулятора?\n\n${result.warning}\n\nТекущие данные будут заменены.`)) {
          setBusy(false);
          return;
        }
        replaceData(result.data);
        notify(`Импортировано сделок: ${result.deals}, клиентов: ${result.clients}`);
      } else {
        const next = parseBackup(text);
        if (!confirm(`Заменить текущие данные резервной копией?\nСделок: ${next.deals.length}, клиентов: ${next.clients.length}.`)) {
          setBusy(false);
          return;
        }
        replaceData(next);
        notify(`Восстановлено: ${next.deals.length} сделок, ${next.clients.length} клиентов`);
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Не удалось прочитать файл', 'error');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">Настройки</div>
          <h1>Данные и автоматика</h1>
          <p className="muted">Всё хранится в этом браузере. Резервную копию можно скачать и перенести на другое устройство.</p>
        </div>
        <div className="actions">
          <button type="button" className="btn ghost" onClick={() => exportBackup(data)}>Скачать копию .json</button>
          <button type="button" className="btn ghost" onClick={() => exportIcs(data, (deal) => clients.find((client) => client.id === deal.clientId)?.name ?? 'Без клиента')}>Календарь .ics</button>
        </div>
      </header>

      {!storageOk && (
        <div className="inline-warning">⚠ В браузере не хватает места для сохранения. Скачайте резервную копию и освободите память.</div>
      )}

      <section className="kpi-grid small">
        <div className="kpi static"><span className="kpi-label">Клиенты</span><b className="kpi-value">{clients.length}</b></div>
        <div className="kpi static"><span className="kpi-label">Сделки</span><b className="kpi-value">{deals.length}</b></div>
        <div className="kpi static"><span className="kpi-label">Портфель</span><b className="kpi-value">{fmtMoney(totalAmount, { compact: true })}</b></div>
        <div className="kpi static"><span className="kpi-label">Получено</span><b className="kpi-value">{fmtMoney(totalPaid, { compact: true })}</b></div>
        <div className="kpi static"><span className="kpi-label">Событий в графике</span><b className="kpi-value">{events.length}</b></div>
      </section>

      <div className="settings-grid">
        <section className="card">
          <div className="section-head"><h2>Справочники</h2><span className="muted">подставляются в карточки</span></div>
          <div className="form-grid">
            <label className="field span-2">Название компании
              <input value={settings.companyName} onChange={(event) => updateSettings({ companyName: event.target.value })} />
            </label>
            <label className="field span-2">Менеджеры
              <input
                value={joinList(settings.managers)}
                placeholder="Ирина, Олег"
                onChange={(event) => updateSettings({ managers: splitList(event.target.value) })}
              />
              <small className="field-hint">через запятую</small>
            </label>
            <label className="field span-2">Бригады
              <input
                value={joinList(settings.teams)}
                placeholder="Бригада 1 — Сергей, Бригада 2 — Андрей"
                onChange={(event) => updateSettings({ teams: splitList(event.target.value) })}
              />
              <small className="field-hint">появятся в подсказках графика</small>
            </label>
            <label className="checkbox-field span-2">
              <input type="checkbox" checked={settings.hints} onChange={(event) => updateSettings({ hints: event.target.checked })} />
              Показывать подсказки на экранах
            </label>
          </div>
        </section>

        <section className="card">
          <div className="section-head">
            <div><h2>Автоматика CRM</h2><span className="muted">правила, которые ставят задачи сами</span></div>
            <button type="button" className="btn small primary" onClick={runNow}>Проверить сейчас</button>
          </div>
          <ul className="rules-list">
            {rules.map((rule) => (
              <li key={rule.id}>
                <label className="rule-toggle">
                  <input type="checkbox" checked={rule.enabled} onChange={(event) => patchRule(rule.id, { enabled: event.target.checked })} />
                  <span>
                    <b>{rule.label}</b>
                    <small>{rule.hint}</small>
                  </span>
                </label>
                <label className="rule-days">
                  через
                  <input
                    type="number"
                    min={0}
                    max={90}
                    value={rule.days}
                    onChange={(event) => patchRule(rule.id, { days: Math.max(0, Math.min(90, Number(event.target.value) || 0)) })}
                  />
                  дн.
                </label>
              </li>
            ))}
          </ul>
          <button type="button" className="link-btn" onClick={() => { setRules(DEFAULT_RULES); saveRules(DEFAULT_RULES); notify('Правила сброшены', 'info'); }}>
            вернуть правила по умолчанию
          </button>
        </section>

        <section className="card">
          <div className="section-head"><h2>Резервная копия</h2><span className="muted">перенос между устройствами</span></div>
          <p className="muted">
            Файл <code>.json</code> содержит клиентов, сделки, задачи, оплаты и график. Импорт принимает
            и резервную копию калькулятора — заказы, клиенты и даты монтажа перенесутся.
          </p>
          <div className="data-actions">
            <button type="button" className="btn ghost" onClick={() => exportBackup(data)}>Скачать .json</button>
            <button type="button" className="btn ghost" disabled={busy} onClick={() => fileRef.current?.click()}>Загрузить .json</button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file); }}
            />
          </div>
          <div className="danger-zone">
            <button type="button" className="btn danger-ghost" onClick={() => {
              if (!confirm('Заменить текущие данные демонстрационными?')) return;
              resetDemo();
              notify('Загружены демо-данные', 'info');
            }}>Демо-данные</button>
            <button type="button" className="btn danger-ghost" onClick={() => {
              if (!confirm('Удалить все данные без возможности отмены?')) return;
              clearAll();
              notify('Все данные удалены', 'info');
            }}>Очистить всё</button>
          </div>
        </section>

        <section className="card">
          <div className="section-head"><h2>Как это работает</h2></div>
          <ul className="about-list">
            <li><b>Сделка</b> — заказ. В ней этап, сумма, задачи, оплаты и даты графика.</li>
            <li><b>CRM</b> — список и доска: видно, с кем связаться сегодня и что зависло.</li>
            <li><b>График</b> — те же даты сделок в календаре: замер, готовность, доставка, монтаж.</li>
            <li><b>Задачи</b> — из всех сделок в одном списке, с отметкой о выполнении.</li>
            <li><b>Проверки</b> — монтаж раньше готовности, доставка после монтажа, бригада в двух местах.</li>
            <li>Сегодня: {todayISO()}. Данные сохраняются автоматически в браузере.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
