// Настройки и данные: реквизиты, тема, напоминания, шаблоны, автоматика, бэкапы и импорт.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell, Check, Download, FileDown, FileUp, HardDrive, MessageSquare, Moon, Plus,
  RotateCcw, Save, Settings2, Sun, Trash2, TriangleAlert, Upload, Users,
} from 'lucide-react';
import type { Deal } from '../types';
import { useApp } from '../store';
import { fmtDate, fmtDateTime, fmtMoney, todayISO } from '../lib/dates';
import { fmtBytes } from '../lib/attachments';
import {
  autoBackupInfo, downloadFile, exportBackup, exportIcs, findDuplicateClients, mergeImport,
  previewImport, readAutoBackup, writeAutoBackup, type AutoBackupInfo, type ImportPreview,
} from '../lib/storage';
import { DEFAULT_TEMPLATES, normalizeTemplates, renderTemplate, templateContext } from '../lib/templates';
import { DEFAULT_RULES, normalizeRules } from '../lib/crmAutomation';
import { ruleDaysLabel, ruleTitle } from '../lib/storage';
import {
  collectAttachments, buildBackupZip, readBackupZip, restoreArchiveFiles,
} from '../lib/backupZip';
import { pruneFiles, storageInfo, type StorageInfo } from '../lib/attachments';
import { askNotifyPermission, clearNotificationHistory, notifyPermission } from '../lib/notify';
import Modal from './Modal';

function emptyPreviewDeal(): Deal {
  const stamp = new Date().toISOString();
  return {
    id: 'preview',
    title: 'Кухня на Ленина, 42',
    clientId: '',
    status: 'draft',
    amount: 250000,
    payments: [],
    tasks: [],
    schedule: {
      status: 'planned',
      installDays: 1,
      reminders: [],
      installAt: todayISO(),
    },
    manager: '',
    createdAt: stamp,
    updatedAt: stamp,
    history: [],
  };
}

const REMINDER_OPTIONS = [
  { value: 15, label: 'за 15 минут' },
  { value: 30, label: 'за 30 минут' },
  { value: 60, label: 'за час' },
  { value: 120, label: 'за 2 часа' },
  { value: 1440, label: 'за сутки' },
];

export default function DataView() {
  const {
    data, deals, clients, settings, updateSettings, replaceData, resetDemo, clearAll,
    undo, canUndo, notify, storageOk, savedAt,
  } = useApp();
  const [draft, setDraft] = useState(() => ({
    companyName: settings.companyName,
    myName: settings.myName,
    managers: settings.managers.join(', '),
    teams: settings.teams.join(', '),
    hints: settings.hints,
    theme: settings.theme,
    notifications: settings.notifications,
    reminderMinutes: settings.reminderMinutes,
  }));
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [backupInfo, setBackupInfo] = useState<AutoBackupInfo | null>(() => autoBackupInfo());
  const [permission, setPermission] = useState(() => notifyPermission());
  const [archive, setArchive] = useState<{ preview: ImportPreview; files: number; blobs: Map<string, Blob> } | null>(null);
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [templates, setTemplates] = useState(() => normalizeTemplates(settings.messageTemplates));
  const [rules, setRules] = useState(() => normalizeRules(settings.rules));

  useEffect(() => {
    setTemplates(normalizeTemplates(settings.messageTemplates));
    setRules(normalizeRules(settings.rules));
  }, [settings.messageTemplates, settings.rules]);

  useEffect(() => {
    let active = true;
    storageInfo().then((info) => { if (active) setStorage(info); }).catch(() => {});
    return () => { active = false; };
  }, [data.deals, data.clients]);

  const attachments = useMemo(() => collectAttachments(data), [data]);
  const attachmentsSize = useMemo(() => attachments.reduce((sum, item) => sum + item.attachment.size, 0), [attachments]);

  const duplicates = useMemo(() => findDuplicateClients(clients), [clients]);
  const totalTasks = deals.reduce((sum, deal) => sum + deal.tasks.length, 0);
  const totalPaid = deals.reduce((sum, deal) => sum + deal.payments.reduce((inner, payment) => inner + payment.amount, 0), 0);
  const importRef = useMemo(
    () => templateContext(deals[0] ?? emptyPreviewDeal(), deals[0] ? 'Клиент' : 'Анна', draft.companyName),
    [deals, draft.companyName],
  );

  const saveSettings = () => {
    updateSettings({
      companyName: draft.companyName.trim(),
      myName: draft.myName.trim(),
      managers: draft.managers.split(',').map((value) => value.trim()).filter(Boolean),
      teams: draft.teams.split(',').map((value) => value.trim()).filter(Boolean),
      hints: draft.hints,
      theme: draft.theme,
      notifications: draft.notifications,
      reminderMinutes: draft.reminderMinutes,
    });
    notify('Настройки сохранены');
  };

  const readFile = async (file: File) => {
    const isZip = /\.zip$/i.test(file.name) || file.type === 'application/zip';
    if (isZip) {
      try {
        const archiveImport = await readBackupZip(file);
        const preview = previewImport(JSON.stringify(archiveImport.payload), data);
        if (preview.error) { notify(preview.error, 'error'); return; }
        setArchive({ preview, files: archiveImport.files, blobs: archiveImport.blobs });
        setPreview(preview);
        if (archiveImport.skipped.length > 0) {
          notify(`Файлы со сжатием пропущены: ${archiveImport.skipped.length}`, 'info');
        }
      } catch (error) {
        notify(error instanceof Error ? error.message : 'Не удалось прочитать архив', 'error');
      }
      return;
    }
    setArchive(null);
    const text = await file.text();
    setPreview(previewImport(text, data));
  };

  const importArchive = async (mode: 'replace' | 'merge') => {
    if (!preview?.data) return;
    const next = mode === 'merge' ? mergeImport(data, preview.data) : preview.data;
    if (mode === 'replace' && !confirm('Заменить все данные содержимым архива? Текущая база уйдёт в авто-копию.')) return;
    replaceData(next, { backupReason: 'перед импортом архива', undoLabel: 'импорт архива' });
    if (archive) {
      const restored = await restoreArchiveFiles(preview.data, archive.blobs);
      notify(`Файлов восстановлено: ${restored.saved}${restored.missing ? `, не найдено: ${restored.missing}` : ''}`, 'ok');
    }
    setPreview(null);
    setArchive(null);
  };

  const applyPreview = (mode: 'replace' | 'merge') => {
    if (!preview?.data) return;
    if (mode === 'merge') {
      replaceData(mergeImport(data, preview.data), { backupReason: 'перед импортом', undoLabel: 'импорт' });
      notify('Импорт добавлен к текущей базе', 'ok', { label: 'Отменить', run: undo });
    } else {
      if (!confirm('Заменить все данные содержимым файла? Текущая база уйдёт в авто-копию.')) return;
      replaceData(preview.data, { backupReason: 'перед импортом', undoLabel: 'импорт' });
      notify('Данные заменены импортом', 'ok', { label: 'Отменить', run: undo });
    }
    setPreview(null);
    setArchive(null);
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">Настройки и перенос</div>
          <h1>Данные</h1>
          <p className="muted">Всё хранится в этом браузере. Копию можно скачать и открыть на другом компьютере.</p>
        </div>
        <div className="actions wrap">
          <button type="button" className="btn ghost" onClick={() => exportBackup(data)}><Download size={15} /> Скачать копию</button>
          <button type="button" className="btn primary" onClick={() => fileRef.current?.click()}><Upload size={15} /> Загрузить файл</button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json,application/zip,.zip"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) readFile(file);
              event.target.value = '';
            }}
          />
        </div>
      </header>

      {!storageOk && (
        <div className="inline-warning">
          <TriangleAlert size={15} /> Браузер не даёт сохранить данные (приватный режим или переполнение).
          Скачайте копию, чтобы не потерять работу.
        </div>
      )}

      <section className="stat-row">
        <div><span>Сделок</span><b>{deals.length}</b></div>
        <div><span>Клиентов</span><b>{clients.length}</b></div>
        <div><span>Задач</span><b>{totalTasks}</b></div>
        <div><span>Оплачено</span><b>{fmtMoney(totalPaid)}</b></div>
        <div><span>Обновлено</span><b>{fmtDateTime(data.updatedAt)}</b></div>
        <div><span>Сохранено</span><b>{savedAt ? fmtDateTime(savedAt) : '—'}</b></div>
      </section>

      <div className="data-grid">
        <section className="card">
          <div className="section-head">
            <div>
              <h2>Реквизиты и команда</h2>
              <span className="muted">подставляются в сообщения и печать</span>
            </div>
          </div>
          <div className="form-grid">
            <label className="field">Название компании
              <input value={draft.companyName} onChange={(event) => setDraft({ ...draft, companyName: event.target.value })} />
            </label>
            <label className="field">Ваше имя
              <input value={draft.myName} placeholder="например, Ирина" onChange={(event) => setDraft({ ...draft, myName: event.target.value })} />
              <small className="field-hint">включает фильтр «только мои»</small>
            </label>
            <label className="field span-2">Менеджеры
              <input value={draft.managers} placeholder="Ирина, Сергей" onChange={(event) => setDraft({ ...draft, managers: event.target.value })} />
              <small className="field-hint">через запятую</small>
            </label>
            <label className="field span-2">Бригады
              <input value={draft.teams} placeholder="Бригада 1 — Сергей, Бригада 2 — Олег" onChange={(event) => setDraft({ ...draft, teams: event.target.value })} />
            </label>
          </div>

          <div className="section-head sub">
            <h3>Тема и подсказки</h3>
          </div>
          <div className="theme-picker" role="radiogroup" aria-label="Тема оформления">
            {([
              { value: 'light' as const, label: 'Светлая', icon: <Sun size={14} /> },
              { value: 'dark' as const, label: 'Тёмная', icon: <Moon size={14} /> },
              { value: 'system' as const, label: 'Как в системе', icon: <Settings2 size={14} /> },
            ]).map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={draft.theme === option.value}
                className={draft.theme === option.value ? 'active' : ''}
                onClick={() => setDraft({ ...draft, theme: option.value })}
              >
                {option.icon} {option.label}
              </button>
            ))}
          </div>
          <label className="chip-toggle">
            <input type="checkbox" checked={draft.hints} onChange={(event) => setDraft({ ...draft, hints: event.target.checked })} />
            показывать подсказки на экранах
          </label>

          <div className="section-head sub">
            <h3><Bell size={14} /> Напоминания</h3>
          </div>
          <label className="chip-toggle">
            <input
              type="checkbox"
              checked={draft.notifications}
              onChange={async (event) => {
                const value = event.target.checked;
                setDraft({ ...draft, notifications: value });
                if (value && notifyPermission() === 'default') {
                  await askNotifyPermission();
                  setPermission(notifyPermission());
                }
              }}
            />
            браузерные уведомления о монтажах
          </label>
          <label className="field">Напомнить заранее
            <select value={draft.reminderMinutes} onChange={(event) => setDraft({ ...draft, reminderMinutes: Number(event.target.value) })}>
              {REMINDER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <p className="field-hint">
            Разрешение: {permission === 'granted' ? 'выдано' : permission === 'denied' ? 'запрещено в браузере' : 'не запрошено'}.
            {' '}Напоминания работают, пока приложение открыто.
            <button type="button" className="link-btn" onClick={() => { clearNotificationHistory(); notify('Отметки об отправке сброшены'); }}>
              сбросить отправленные
            </button>
          </p>

          <div className="save-row">
            <button type="button" className="btn primary" onClick={saveSettings}><Save size={15} /> Сохранить настройки</button>
            <span className="muted small">изменения применяются сразу после сохранения</span>
          </div>
        </section>

        <section className="card">
          <div className="section-head">
            <div>
              <h2><MessageSquare size={16} /> Шаблоны сообщений</h2>
              <span className="muted">текст для WhatsApp, почты и SMS</span>
            </div>
            <div className="card-head-actions">
              <button type="button" className="btn small ghost" onClick={() => setTemplates(DEFAULT_TEMPLATES)}>Сбросить</button>
              <button
                type="button"
                className="btn small primary"
                onClick={() => {
                  updateSettings({ messageTemplates: templates });
                  notify('Шаблоны сохранены');
                }}
              >
                <Check size={14} /> Сохранить
              </button>
            </div>
          </div>

          <ul className="template-list">
            {templates.map((template, index) => (
              <li key={template.id} className="template-row">
                <div className="template-head">
                  <input
                    className="template-title"
                    value={template.title}
                    onChange={(event) => {
                      const next = [...templates];
                      next[index] = { ...template, title: event.target.value };
                      setTemplates(next);
                    }}
                  />
                  <label className="chip-toggle">
                    <input
                      type="checkbox"
                      checked={template.enabled}
                      onChange={(event) => {
                        const next = [...templates];
                        next[index] = { ...template, enabled: event.target.checked };
                        setTemplates(next);
                      }}
                    />
                    вкл.
                  </label>
                  <button
                    type="button"
                    className="icon-btn small"
                    aria-label="Удалить шаблон"
                    onClick={() => setTemplates(templates.filter((item) => item.id !== template.id))}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
                <textarea
                  rows={3}
                  value={template.text}
                  onChange={(event) => {
                    const next = [...templates];
                    next[index] = { ...template, text: event.target.value };
                    setTemplates(next);
                  }}
                />
                <small className="field-hint preview">{renderTemplate(template.text, importRef).slice(0, 160)}…</small>
              </li>
            ))}
          </ul>
          <div className="template-add">
            <button
              type="button"
              className="btn small ghost"
              onClick={() => setTemplates([...templates, {
                id: `tpl_custom_${Date.now()}`,
                title: 'Новый шаблон',
                text: 'Добрый день, {client}! По заказу «{deal}» — {remainder} ₽ к оплате.',
                enabled: true,
              }])}
            >
              <Plus size={14} /> Добавить шаблон
            </button>
            <button
              type="button"
              className="link-btn"
              onClick={() => setTemplates(DEFAULT_TEMPLATES.map((item) => ({ ...item })))}
            >
              вернуть примеры
            </button>
          </div>
          <p className="field-hint">
            Подстановки: <code>{'{client}'}</code> <code>{'{deal}'}</code> <code>{'{total}'}</code>{' '}
            <code>{'{paid}'}</code> <code>{'{remainder}'}</code> <code>{'{date}'}</code>{' '}
            <code>{'{team}'}</code> <code>{'{address}'}</code> <code>{'{manager}'}</code> <code>{'{company}'}</code>
          </p>
        </section>

        <section className="card">
          <div className="section-head">
            <div>
              <h2>Автоматика</h2>
              <span className="muted">сама ставит задачи и следующий контакт</span>
            </div>
            <span className="muted small">сегодня {fmtDate(todayISO())}</span>
          </div>
          <ul className="rule-list">
            {rules.map((rule, index) => {
              const preset = DEFAULT_RULES.find((item) => item.id === rule.id);
              return (
                <li key={rule.id} className="rule-row">
                  <label className="chip-toggle">
                    <input
                      type="checkbox"
                      checked={rule.enabled}
                      onChange={(event) => {
                        const next = [...rules];
                        next[index] = { ...rule, enabled: event.target.checked };
                        setRules(next);
                      }}
                    />
                    <b>{ruleTitle(rule)}</b>
                  </label>
                  <span className="muted small">{ruleDaysLabel(rule)} · {preset?.hint ?? 'своё правило'}</span>
                </li>
              );
            })}
          </ul>
          <div className="save-row">
            <button
              type="button"
              className="btn small primary"
              onClick={() => { updateSettings({ rules }); notify('Правила сохранены'); }}
            >
              Сохранить правила
            </button>
            <button type="button" className="btn small ghost" onClick={() => setRules(DEFAULT_RULES)}>Сбросить</button>
          </div>
        </section>

        <section className="card">
          <div className="section-head">
            <div>
              <h2><FileUp size={16} /> Резервные копии</h2>
              <span className="muted">скачать, восстановить, перенести</span>
            </div>
          </div>

          <div className="backup-actions">
            <button type="button" className="btn ghost" onClick={() => exportBackup(data)}>
              <Download size={14} /> Только данные .json
            </button>
            <button
              type="button"
              className="btn primary"
              onClick={async () => {
                const payload = {
                  kind: 'crm-schedule-backup',
                  exportedAt: new Date().toISOString(),
                  version: 2,
                  clients: data.clients,
                  deals: data.deals,
                  settings: data.settings,
                  createdAt: data.createdAt,
                  updatedAt: data.updatedAt,
                };
                const { blob, files, missing } = await buildBackupZip(data, payload);
                downloadFile(`crm-архив-${todayISO()}.zip`, blob, 'application/zip');
                notify(`Архив: ${files} файлов${missing ? `, ${missing} не найдено` : ''}`);
              }}
            >
              <FileDown size={14} /> Архив с файлами .zip
            </button>
            <button type="button" className="btn ghost" onClick={() => exportIcs(data, () => '')}>
              <FileDown size={14} /> Календарь .ics
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                const name = `crm-clients-${todayISO()}.csv`;
                const rows = [
                  ['Имя', 'Телефоны', 'Почта', 'Адрес', 'Источник', 'Метки'],
                  ...clients.map((client) => [client.name, client.phones.join('; '), client.emails.join('; '), client.address ?? '', client.source ?? '', client.tags.join('; ')]),
                ];
                downloadFile(name, `\uFEFF${rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(';')).join('\n')}`, 'text/csv;charset=utf-8');
                notify('Клиенты выгружены в CSV');
              }}
            >
              <Users size={14} /> Клиенты .csv
            </button>
          </div>

          <p className="field-hint">
            .ics открывается в Google Календаре, Яндекс Календаре и на телефоне. .csv — для Excel и рассылок.
          </p>

          <div className="storage-box">
            <HardDrive size={15} />
            <div>
              <b>Файлы вложений: {attachments.length} · {fmtBytes(attachmentsSize)}</b>
              <span className="muted small">
                {storage && storage.quota > 0
                  ? `Занято приложением ${fmtBytes(storage.usage)} из ${fmtBytes(storage.quota)}`
                  : 'Хранятся в этом браузере (IndexedDB)'}
                {storage && storage.quota > 0 && storage.usage / storage.quota > 0.8 ? ' · место почти закончилось' : ''}
                {attachments.length > 0 ? ' · после удаления сделок файлы остаются для отмены' : ''}
              </span>
            </div>
            {attachments.length > 0 && (
              <button
                type="button"
                className="btn small ghost"
                onClick={async () => {
                  if (!confirm('Удалить файлы, которые больше не привязаны к сделкам и клиентам?')) return;
                  const removed = await pruneFiles(attachments.map((item) => item.attachment.id));
                  storageInfo().then(setStorage).catch(() => {});
                  notify(removed > 0 ? `Удалено лишних файлов: ${removed}` : 'Лишних файлов нет');
                }}
              >
                Почистить лишние
              </button>
            )}
          </div>

          <div className="section-head sub">
            <h3>Восстановление</h3>
          </div>

          <div className="restore-row">
            <button type="button" className="btn small ghost" onClick={() => fileRef.current?.click()}>
              <Upload size={14} /> Выбрать .json или .zip
            </button>
            <span className="muted small">перед заменой покажем, что внутри</span>
          </div>

          <div className="restore-row">
            <button
              type="button"
              className="btn small ghost"
              disabled={!backupInfo}
              onClick={() => {
                const backup = readAutoBackup();
                if (!backup) { notify('Авто-копия пуста', 'error'); return; }
                if (!confirm('Вернуть состояние из авто-копии? Текущие данные сохранятся в истории.')) return;
                replaceData(backup, { undoLabel: 'авто-копия' });
                notify('Восстановлено из авто-копии', 'ok', { label: 'Отменить', run: undo });
              }}
            >
              <RotateCcw size={14} /> Вернуть авто-копию
            </button>
            <span className="muted small">
              {backupInfo ? `${backupInfo.reason} · ${fmtDateTime(backupInfo.at)}` : 'авто-копий пока нет'}
            </span>
          </div>

          <p className="field-hint">
            Авто-копия делается автоматически перед очисткой, сбросом и импортом.
            <button type="button" className="link-btn" onClick={() => { writeAutoBackup(data, 'вручную'); setBackupInfo(autoBackupInfo()); notify('Авто-копия обновлена'); }}>
              сделать сейчас
            </button>
          </p>

          {duplicates.length > 0 && (
            <div className="inline-warning">
              <TriangleAlert size={14} /> Похожих клиентов: {duplicates.length}. Объединять удобнее в карточке клиента.
            </div>
          )}
        </section>

        <section className="card danger-card">
          <div className="section-head">
            <div>
              <h2>Опасная зона</h2>
              <span className="muted">сначала сделайте копию</span>
            </div>
          </div>
          <div className="danger-actions">
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                if (!confirm('Заменить данные демонстрационными? Текущие уйдут в авто-копию.')) return;
                resetDemo();
                notify('Загружены демо-данные', 'ok', { label: 'Отменить', run: undo });
              }}
            >
              Загрузить демо-данные
            </button>
            <button
              type="button"
              className="btn danger-ghost"
              onClick={() => {
                if (!confirm('Удалить всех клиентов и сделки? Останется чистая база.')) return;
                clearAll();
                notify('Все данные удалены', 'ok', { label: 'Отменить', run: undo });
              }}
            >
              <Trash2 size={14} /> Очистить всё
            </button>
            {canUndo && (
              <button type="button" className="btn small ghost" onClick={undo}>
                <RotateCcw size={13} /> Отменить последнее действие
              </button>
            )}
          </div>
          <p className="field-hint">
            Данные хранятся в localStorage браузера (ключ crm-schedule.v1). Очистка истории браузера удалит их
            безвозвратно — держите свежую копию .json.
          </p>
        </section>
      </div>

      {preview && (
        <Modal
          title="Импорт файла"
          subtitle={archive
            ? `Архив с файлами: ${archive.files}`
            : preview.kind === 'calculator' ? 'Копия калькулятора — переносим сделки и график' : 'Копия CRM и графика'}
          onClose={() => setPreview(null)}
          footer={(
            <>
              <button type="button" className="btn ghost" onClick={() => setPreview(null)}>Отмена</button>
              <span className="foot-spacer" />
              <button
                type="button"
                className="btn ghost"
                disabled={!preview.data}
                onClick={() => (archive ? importArchive('merge') : applyPreview('merge'))}
              >
                Добавить к текущим
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={!preview.data}
                onClick={() => (archive ? importArchive('replace') : applyPreview('replace'))}
              >
                Заменить всё
              </button>
            </>
          )}
        >
          {preview.error ? (
            <div className="inline-warning"><TriangleAlert size={15} /> {preview.error}</div>
          ) : (
            <>
              <ul className="preview-list">
                <li><span>Сделок</span><b>{preview.deals}</b></li>
                <li><span>Клиентов</span><b>{preview.clients}</b></li>
                <li><span>Задач</span><b>{preview.tasks}</b></li>
                <li><span>Событий графика</span><b>{preview.events}</b></li>
                <li><span>Сумма сделок</span><b>{fmtMoney(preview.amount)}</b></li>
                <li><span>Совпадений с текущими</span><b>{preview.conflicts}</b></li>
                {archive && <li><span>Файлов в архиве</span><b>{archive.files}</b></li>}
              </ul>
              {preview.warning && <div className="inline-warning"><TriangleAlert size={14} /> {preview.warning}</div>}
              <p className="field-hint">
                «Добавить к текущим» сохранит ваши записи и дополнит новыми. Совпадающие по id обновятся.
                «Заменить всё» сделает базу точной копией файла — текущее состояние уйдёт в авто-копию.
              </p>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}
