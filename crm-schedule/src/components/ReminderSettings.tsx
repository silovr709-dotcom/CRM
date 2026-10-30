// Настройки напоминаний: правила «когда × о чём × куда», тихие часы и сводка.
import { useState } from 'react';
import {
  Bell, BellRing, Check, ChevronDown, Copy, Moon, Plus, RotateCcw, Settings2, Trash2, Volume2,
} from 'lucide-react';
import type { ReminderChannel, ReminderPriority, ReminderRule, ReminderSource } from '../types';
import { useApp } from '../store';
import {
  CHANNEL_META, OFFSET_PRESETS, PRIORITY_META, SOURCE_META, defaultDigest, defaultQuietHours,
  defaultReminderRules, describeRule, evaluateReminders, fmtOffset, inQuietHours,
  readSnoozes, reminderRulesWithDigest,
} from '../lib/reminders';
import { askNotifyPermission, notifyPermission, permissionHint, testNotification } from '../lib/notify';
import { localScheduledCount, supportsLocalScheduling } from '../lib/localReminders';
import { downloadRemindersIcs } from '../lib/reminderCalendar';

const SOURCES: ReminderSource[] = [
  'install', 'measure', 'delivery', 'ready', 'task', 'contact', 'payment', 'stale',
];
const CHANNELS: ReminderChannel[] = ['inapp', 'browser', 'sound', 'title'];
const PRIORITIES: ReminderPriority[] = ['low', 'normal', 'high'];

function newRule(source: ReminderSource = 'install'): ReminderRule {
  return {
    id: `rule-${Date.now().toString(36)}`,
    label: SOURCE_META[source].label,
    enabled: true,
    source,
    offsets: [0],
    atTime: '09:00',
    channels: ['inapp'],
    priority: 'normal',
    respectQuietHours: true,
  };
}

export default function ReminderSettings() {
  const { settings, updateSettings, notify, deals, clientName, calendarEvents } = useApp();
  const [expanded, setExpanded] = useState<string>('');
  const [permission, setPermission] = useState(() => notifyPermission());
  const [customOpen, setCustomOpen] = useState<string>('');
  const rules = settings.reminderRules ?? [];
  const quiet = settings.quietHours ?? defaultQuietHours();
  const digest = settings.digest ?? defaultDigest();

  const patchRule = (id: string, patch: Partial<ReminderRule>) => {
    updateSettings({ reminderRules: rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)) });
  };

  const toggleOffset = (rule: ReminderRule, minutes: number) => {
    const has = rule.offsets.includes(minutes);
    const offsets = has ? rule.offsets.filter((item) => item !== minutes) : [...rule.offsets, minutes];
    patchRule(rule.id, { offsets: offsets.sort((left, right) => right - left).slice(0, 8) });
  };

  const addCustomOffset = (rule: ReminderRule, value: string) => {
    const hours = Number(value.replace(',', '.'));
    if (!Number.isFinite(hours) || hours === 0) return;
    const minutes = Math.round(hours * 60);
    if (rule.offsets.includes(minutes)) return;
    patchRule(rule.id, { offsets: [...rule.offsets, minutes].sort((left, right) => right - left).slice(0, 8) });
  };

  const quietNow = inQuietHours(quiet, new Date());

  return (
    <section className="card reminders-card">
      <div className="section-head">
        <div>
          <h2><BellRing size={16} /> Напоминания</h2>
          <span className="muted">правила: когда, о чём и куда присылать</span>
        </div>
        <div className="card-head-actions">
          <button
            type="button"
            className="btn small ghost"
            onClick={() => {
              updateSettings({ reminderRules: defaultReminderRules() });
              notify('Правила вернули к стандартным');
            }}
          >
            <RotateCcw size={14} /> Стандартные
          </button>
          <button
            type="button"
            className="btn small primary"
            onClick={() => {
              const rule = newRule();
              updateSettings({ reminderRules: [...rules, rule] });
              setExpanded(rule.id);
            }}
          >
            <Plus size={14} /> Правило
          </button>
        </div>
      </div>

      <div className="reminder-master">
        <label className="chip-toggle active">
          <input
            type="checkbox"
            checked={settings.notifications}
            onChange={async (event) => {
              const value = event.target.checked;
              updateSettings({ notifications: value });
              if (value && notifyPermission() !== 'granted') {
                await askNotifyPermission();
                setPermission(notifyPermission());
              }
            }}
          />
          <Bell size={13} /> Уведомления включены
        </label>

        <span className={`reminder-permission permission-${permission}`}>
          {permissionHint(permission)}
        </span>

        <div className="reminder-test">
          <button
            type="button"
            className="btn small ghost"
            onClick={async () => {
              const result = await testNotification(['browser', 'sound']);
              notify(result.browser ? 'Уведомление отправлено' : permissionHint(notifyPermission()), result.browser ? 'ok' : 'error');
            }}
          >
            <Volume2 size={14} /> Проверить
          </button>
          <button
            type="button"
            className="btn small ghost"
            onClick={async () => {
              const value = await askNotifyPermission();
              setPermission(value);
              notify(value === 'granted' ? 'Разрешение выдано' : permissionHint(value), value === 'granted' ? 'ok' : 'info');
            }}
          >
            Разрешить
          </button>
        </div>
      </div>

      <div className="reminder-offline">
        <p>
          <b>Без интернета.</b>{' '}
          {supportsLocalScheduling()
            ? 'Это устройство умеет само показывать уведомления по расписанию: ближайшие напоминания ставятся в расписание телефона/компьютера при открытии приложения и сработают в срок даже без сети и при закрытом приложении.'
            : 'Этот браузер не умеет будить приложение по расписанию, если оно полностью закрыто (так устроен, например, iPhone). Чтобы напоминания приходили без интернета и при закрытом приложении, скачайте их в календарь телефона — дальше телефон напомнит сам.'}
        </p>
        <p className="muted">
          В расписании устройства сейчас: {localScheduledCount()} уведомлений.
          Файл календаря содержит напоминания на 90 дней вперёд; после больших правок в графике скачайте его заново.
        </p>
        <button
          type="button"
          className="btn small ghost"
          onClick={() => {
            const result = evaluateReminders({
              deals,
              events: calendarEvents,
              rules: reminderRulesWithDigest(settings),
              settings,
              clientName,
              snoozes: readSnoozes(),
              horizonDays: 90,
              digestSummary: () => 'Дела на сегодня из CRM',
            });
            const count = downloadRemindersIcs(
              [...result.upcoming, ...result.waiting],
              settings.companyName,
            );
            notify(
              count > 0
                ? `Календарь скачан: ${count} напоминаний. Импортируйте файл в календарь телефона.`
                : 'На ближайшие 90 дней напоминаний нет — календарь пустой.',
              count > 0 ? 'ok' : 'info',
            );
          }}
        >
          <Bell size={14} /> Скачать напоминания в календарь телефона (.ics)
        </button>
      </div>

      <ul className="reminder-rules">
        {rules.map((rule) => {
          const isOpen = expanded === rule.id;
          const meta = SOURCE_META[rule.source];
          return (
            <li key={rule.id} className={`reminder-rule${rule.enabled ? '' : ' off'}${isOpen ? ' open' : ''}`}>
              <div className="rule-head">
                <label className="rule-toggle">
                  <input
                    type="checkbox"
                    checked={rule.enabled}
                    onChange={(event) => patchRule(rule.id, { enabled: event.target.checked })}
                    aria-label={`Включить правило ${rule.label}`}
                  />
                  <span>
                    <b>{rule.label}</b>
                    <small>{describeRule(rule)}</small>
                  </span>
                </label>
                <div className="rule-actions">
                  <button
                    type="button"
                    className="icon-btn small"
                    title="Дублировать правило"
                    aria-label="Дублировать правило"
                    onClick={() => {
                      const copy = { ...rule, id: `rule-${Date.now().toString(36)}`, label: `${rule.label} (копия)` };
                      updateSettings({ reminderRules: [...rules, copy] });
                    }}
                  >
                    <Copy size={13} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn small"
                    title="Удалить правило"
                    aria-label="Удалить правило"
                    onClick={() => updateSettings({ reminderRules: rules.filter((item) => item.id !== rule.id) })}
                  >
                    <Trash2 size={13} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn small"
                    aria-expanded={isOpen}
                    title="Настроить"
                    aria-label="Настроить правило"
                    onClick={() => setExpanded(isOpen ? '' : rule.id)}
                  >
                    <ChevronDown size={14} className={isOpen ? 'rotated' : ''} />
                  </button>
                </div>
              </div>

              {isOpen && (
                <div className="rule-body">
                  <label className="field">Название
                    <input value={rule.label} onChange={(event) => patchRule(rule.id, { label: event.target.value })} />
                  </label>
                  <label className="field">О чём напоминать
                    <select value={rule.source} onChange={(event) => patchRule(rule.id, { source: event.target.value as ReminderSource })}>
                      {SOURCES.map((source) => <option key={source} value={source}>{SOURCE_META[source].label}</option>)}
                    </select>
                    <small className="field-hint">{meta.hint}</small>
                  </label>

                  {rule.source === 'stale' && (
                    <label className="field">Дней без движения
                      <input
                        type="number"
                        min={1}
                        max={90}
                        value={rule.staleDays ?? 10}
                        onChange={(event) => patchRule(rule.id, { staleDays: Math.max(1, Math.min(90, Number(event.target.value) || 10)) })}
                      />
                    </label>
                  )}

                  <div className="field span-2">
                    <span className="field-label">Когда напоминать</span>
                    <div className="offset-chips">
                      {OFFSET_PRESETS.map((preset) => (
                        <button
                          key={preset.minutes}
                          type="button"
                          className={`quick${rule.offsets.includes(preset.minutes) ? ' active' : ''}`}
                          onClick={() => toggleOffset(rule, preset.minutes)}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                    <div className="offset-custom">
                      {rule.offsets
                        .filter((minutes) => !OFFSET_PRESETS.some((preset) => preset.minutes === minutes))
                        .map((minutes) => (
                          <span key={minutes} className="offset-custom-chip">
                            {fmtOffset(minutes)}
                            <button type="button" aria-label="Убрать" onClick={() => toggleOffset(rule, minutes)}>×</button>
                          </span>
                        ))}
                      {customOpen === rule.id ? (
                        <input
                          type="number"
                          placeholder="часов до срока"
                          step="0.5"
                          autoFocus
                          onBlur={(event) => { addCustomOffset(rule, event.target.value); setCustomOpen(''); }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              addCustomOffset(rule, (event.target as HTMLInputElement).value);
                              setCustomOpen('');
                            }
                            if (event.key === 'Escape') setCustomOpen('');
                          }}
                        />
                      ) : (
                        <button type="button" className="quick" onClick={() => setCustomOpen(rule.id)}>
                          <Plus size={11} /> своё
                        </button>
                      )}
                    </div>
                    <small className="field-hint">
                      можно выбрать несколько: например, за сутки и за час до срока.
                      {rule.offsets.length === 0 && ' Без смещения правило не сработает.'}
                    </small>
                  </div>

                  {(rule.source === 'task' || rule.source === 'contact' || rule.source === 'payment'
                    || rule.source === 'stale' || rule.source === 'digest') && (
                    <label className="field">Время дня
                      <input type="time" value={rule.atTime ?? '09:00'} onChange={(event) => patchRule(rule.id, { atTime: event.target.value })} />
                      <small className="field-hint">для дат без часов и повторных напоминаний</small>
                    </label>
                  )}

                  <div className="field">
                    <span className="field-label">Куда</span>
                    <div className="channel-chips">
                      {CHANNELS.map((channel) => (
                        <button
                          key={channel}
                          type="button"
                          className={`quick${rule.channels.includes(channel) ? ' active' : ''}`}
                          title={CHANNEL_META[channel].hint}
                          onClick={() => {
                            const channels = rule.channels.includes(channel)
                              ? rule.channels.filter((item) => item !== channel)
                              : [...rule.channels, channel];
                            patchRule(rule.id, { channels: channels.length > 0 ? channels : ['inapp'] });
                          }}
                        >
                          {rule.channels.includes(channel) && <Check size={11} />}
                          {CHANNEL_META[channel].label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <label className="field">Важность
                    <select value={rule.priority} onChange={(event) => patchRule(rule.id, { priority: event.target.value as ReminderPriority })}>
                      {PRIORITIES.map((priority) => <option key={priority} value={priority}>{PRIORITY_META[priority].label}</option>)}
                    </select>
                  </label>

                  <div className="rule-toggles span-2">
                    <label className="chip-toggle">
                      <input type="checkbox" checked={Boolean(rule.respectQuietHours)} onChange={(event) => patchRule(rule.id, { respectQuietHours: event.target.checked })} />
                      <Moon size={12} /> не будить в тихие часы
                    </label>
                    <label className="chip-toggle">
                      <input type="checkbox" checked={Boolean(rule.repeatDaily)} onChange={(event) => patchRule(rule.id, { repeatDaily: event.target.checked })} />
                      повторять каждый день, пока не закрыто
                    </label>
                    <label className="chip-toggle">
                      <input type="checkbox" checked={Boolean(rule.onlyMine)} onChange={(event) => patchRule(rule.id, { onlyMine: event.target.checked })} />
                      только мои сделки{settings.myName ? ` (${settings.myName})` : ''}
                    </label>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {rules.length === 0 && (
        <p className="nc-empty">Правил нет — напоминания не приходят. Добавьте первое или верните стандартные.</p>
      )}

      <div className="quiet-hours">
        <div className="section-head sub">
          <h3><Moon size={14} /> Тихие часы</h3>
          <span className={`badge ${quietNow ? 'badge-violet' : 'badge-muted'}`}>{quietNow ? 'сейчас тихо' : 'сейчас можно'}</span>
        </div>
        <label className="chip-toggle">
          <input type="checkbox" checked={quiet.enabled} onChange={(event) => updateSettings({ quietHours: { ...quiet, enabled: event.target.checked } })} />
          не беспокоить в это время
        </label>
        <div className="quiet-row">
          <label className="field">С
            <input type="time" value={quiet.from} onChange={(event) => updateSettings({ quietHours: { ...quiet, from: event.target.value } })} />
          </label>
          <label className="field">До
            <input type="time" value={quiet.to} onChange={(event) => updateSettings({ quietHours: { ...quiet, to: event.target.value } })} />
          </label>
          <label className="field">Что делать
            <select value={quiet.mode} onChange={(event) => updateSettings({ quietHours: { ...quiet, mode: event.target.value as 'wait' | 'skip' } })}>
              <option value="wait">дождаться утра и показать</option>
              <option value="skip">пропустить совсем</option>
            </select>
          </label>
          <label className="chip-toggle">
            <input type="checkbox" checked={quiet.skipWeekends} onChange={(event) => updateSettings({ quietHours: { ...quiet, skipWeekends: event.target.checked } })} />
            в выходные не действуют
          </label>
        </div>
      </div>

      <div className="digest-settings">
        <div className="section-head sub">
          <h3><Bell size={14} /> Сводка на день</h3>
          <span className="muted small">одно сообщение вместо десяти</span>
        </div>
        <div className="quiet-row">
          <label className="chip-toggle">
            <input type="checkbox" checked={digest.enabled} onChange={(event) => updateSettings({ digest: { ...digest, enabled: event.target.checked } })} />
            присылать сводку
          </label>
          <label className="field">Во сколько
            <input type="time" value={digest.at} onChange={(event) => updateSettings({ digest: { ...digest, at: event.target.value } })} />
          </label>
          <label className="chip-toggle">
            <input type="checkbox" checked={digest.weekdaysOnly} onChange={(event) => updateSettings({ digest: { ...digest, weekdaysOnly: event.target.checked } })} />
            только по будням
          </label>
          <div className="channel-chips">
            {CHANNELS.filter((channel) => channel !== 'sound' && channel !== 'title').map((channel) => (
              <button
                key={channel}
                type="button"
                className={`quick${digest.channels.includes(channel) ? ' active' : ''}`}
                onClick={() => {
                  const channels = digest.channels.includes(channel)
                    ? digest.channels.filter((item) => item !== channel)
                    : [...digest.channels, channel];
                  updateSettings({ digest: { ...digest, channels: channels.length > 0 ? channels : ['inapp'] } });
                }}
              >
                {CHANNEL_META[channel].label}
              </button>
            ))}
          </div>
        </div>
        <p className="field-hint">
          Сводка собирает монтажи, замеры, задачи и контакты на сегодня. Даже в тихие часы
          она ждёт своего времени и приходит одной строкой.
        </p>
      </div>

      <div className="reminder-reset">
        <button
          type="button"
          className="btn small ghost"
          onClick={() => {
            if (!confirm('Забыть, что уже отправлено? Напоминания на сегодня придут снова.')) return;
            localStorage.removeItem('crm-schedule.sent.v2');
            localStorage.removeItem('crm-schedule.snooze.v1');
            notify('История отправленных сброшена');
          }}
        >
          <RotateCcw size={13} /> Сбросить отправленные
        </button>
        <button
          type="button"
          className="btn small ghost"
          onClick={() => {
            updateSettings({
              reminderRules: defaultReminderRules(),
              quietHours: defaultQuietHours(),
              digest: defaultDigest(),
            });
            notify('Настройки напоминаний вернули к стандартным');
          }}
        >
          <Settings2 size={13} /> Вернуть всё к стандартным
        </button>
      </div>
    </section>
  );
}
