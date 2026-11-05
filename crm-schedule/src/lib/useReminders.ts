// Хук напоминаний: раз в полминуты смотрит, что пора показать, и разносит
// по каналам. Держит ближайшие напоминания для центра.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReminderRule } from '../types';
import { useApp } from '../store';
import {
  clearSent, clearSnoozes, digestText, evaluateReminders, markSentMap, readSent,
  readSnoozes, reminderRulesWithDigest, snoozeReminder, type PlannedReminder,
} from './reminders';
import { deliverReminders } from './notify';
import { cancelLocalReminder, readLocalSchedule, syncLocalReminderSchedule, wasShownLocally } from './localReminders';
import { isClosedStatus } from './crm';
import { taskStats } from './crmTasks';
import { todayISO } from './dates';

const POLL_MS = 30_000;
const MAX_ACTIVE = 25;

export interface ReminderApi {
  /** Общий выключатель из настроек. */
  enabled: boolean;
  /** Сработавшие и ещё не убранные. */
  active: PlannedReminder[];
  /** Ближайшие 7 дней. */
  upcoming: PlannedReminder[];
  /** Сработали, но ждут окончания тихих часов. */
  waiting: PlannedReminder[];
  rulesActive: number;
  rulesTotal: number;
  refresh: () => void;
  snooze: (id: string, until: Date) => void;
  dismiss: (id: string) => void;
  dismissAll: () => void;
  resetHistory: () => void;
}

export interface ReminderHandlers {
  onOpenDeal?: (id: string) => void;
  onOpenSchedule?: () => void;
}

export function useReminders(handlers: ReminderHandlers = {}): ReminderApi {
  const { deals, tasks, settings, clientName, notify, calendarEvents, role, server, currentAccount } = useApp();
  const [active, setActive] = useState<PlannedReminder[]>([]);
  const [upcoming, setUpcoming] = useState<PlannedReminder[]>([]);
  const [waiting, setWaiting] = useState<PlannedReminder[]>([]);
  const busy = useRef(false);
  const baselineRoleRef = useRef('');
  const baselineIdsRef = useRef<Set<string> | null>(null);
  const deliveredRef = useRef<Set<string> | null>(null);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const deliveredKey = 'crm-schedule.auto-notify.v1';
  const readDelivered = (): Set<string> => {
    if (deliveredRef.current) return deliveredRef.current;
    try {
      const raw = window.localStorage.getItem(deliveredKey);
      const list = raw ? (JSON.parse(raw) as string[]) : [];
      deliveredRef.current = new Set(Array.isArray(list) ? list : []);
    } catch {
      deliveredRef.current = new Set();
    }
    return deliveredRef.current;
  };
  const writeDelivered = (ids: Set<string>) => {
    deliveredRef.current = ids;
    try { window.localStorage.setItem(deliveredKey, JSON.stringify(Array.from(ids))); } catch { /* приватный режим */ }
  };

  const userName = (server?.user?.name || currentAccount?.name || settings.myName || '').trim().toLowerCase();

  const autoIdsForDeal = (deal: (typeof deals)[number]): string[] => {
    const ids: string[] = [];
    if (role.id === 'owner' || role.id === 'manager') {
      ids.push(`auto:deal-added:${deal.id}`);
    }
    if (role.id === 'installer') {
      const team = (deal.schedule?.team || '').toLowerCase();
      if (deal.schedule?.installAt && userName && team.includes(userName)) {
        ids.push(`auto:install-assigned:${deal.id}:${deal.schedule.installAt}:${deal.schedule.team ?? ''}`);
      }
    }
    return ids;
  };

  // Сводка на день идёт отдельным правилом из настроек дайджеста.
  const rules = useMemo<ReminderRule[]>(() => reminderRulesWithDigest(settings), [settings]);

  const digestSummary = useCallback(() => {
    const today = todayISO();
    const open = deals.filter((deal) => !isClosedStatus(deal.status));
    const stats = taskStats(deals, today);
    return digestText({
      installs: deals.filter((deal) => deal.schedule?.installAt === today).length,
      measures: deals.filter((deal) => deal.schedule?.measureAt === today).length,
      contacts: open.filter((deal) => Boolean(deal.nextContactAt) && (deal.nextContactAt as string) <= today).length,
      tasks: stats.today,
      overdue: stats.overdue,
    });
  }, [deals]);

  const tick = useCallback(() => {
    if (busy.current) return;
    busy.current = true;
    try {
      const result = evaluateReminders({
        deals,
        tasks,
        events: calendarEvents,
        rules,
        settings,
        clientName,
        sent: readSent(),
        snoozes: readSnoozes(),
        digestSummary,
      });

      setUpcoming(result.upcoming);

      // Общий выключатель: настройки сохраняются, но ничего не приходит.
      if (settings.notifications === false) {
        setWaiting([]);
        setActive([]);
        // И расписание устройства чистим: выключено — значит выключено везде.
        void syncLocalReminderSchedule([]);
        return;
      }

      setWaiting(result.waiting);

      // Ближайшие напоминания ставим в расписание самого устройства:
      // уведомление придёт в срок и без интернета, и при закрытом приложении
      // (где браузер умеет показывать по расписанию; проверка — внутри).
      void syncLocalReminderSchedule([...result.upcoming, ...result.waiting]);

      // Автоматические уведомления: новая сделка и назначение монтажа.
      // Они не привязаны к правилам-времени: срабатывают один раз, когда
      // запись впервые появилась на этом устройстве (в том числе после синхронизации).
      if (settings.notifications) {
        const roleKey = `${role.id}:${userName}`;
        if (baselineRoleRef.current !== roleKey) {
          baselineRoleRef.current = roleKey;
          baselineIdsRef.current = new Set(deals.flatMap((deal) => autoIdsForDeal(deal)));
        }
        const baseline = baselineIdsRef.current ?? new Set<string>();
        const delivered = readDelivered();
        const autoReminders: PlannedReminder[] = [];
        for (const deal of deals) {
          const client = clientName(deal);
          if (role.id === 'owner' || role.id === 'manager') {
            const id = `auto:deal-added:${deal.id}`;
            if (!baseline.has(id) && !delivered.has(id)) {
              autoReminders.push({
                id,
                ruleId: 'auto-deal-added',
                ruleLabel: 'Автоматическое уведомление',
                source: 'custom',
                dealId: deal.id,
                title: `Новая сделка: ${deal.title}`,
                detail: [client, deal.amount ? `${Math.round(deal.amount).toLocaleString('ru-RU')} ₽` : '', deal.manager].filter(Boolean).join(' · '),
                momentAt: deal.createdAt || new Date().toISOString(),
                notifyAt: new Date().toISOString(),
                offsetMinutes: 0,
                priority: 'normal',
                channels: ['inapp', 'browser', 'sound'],
                waitingForQuiet: false,
              });
              delivered.add(id);
            }
          }
          if (role.id === 'installer') {
            const team = (deal.schedule?.team || '').toLowerCase();
            if (deal.schedule?.installAt && userName && team.includes(userName)) {
              const id = `auto:install-assigned:${deal.id}:${deal.schedule.installAt}:${deal.schedule.team ?? ''}`;
              if (!baseline.has(id) && !delivered.has(id)) {
                autoReminders.push({
                  id,
                  ruleId: 'auto-install-assigned',
                  ruleLabel: 'Автоматическое уведомление',
                  source: 'custom',
                  dealId: deal.id,
                  title: `Назначен монтаж: ${deal.title}`,
                  detail: [client, deal.schedule.installAt ? `монтаж ${deal.schedule.installAt}` : '', deal.schedule.team, deal.schedule.address].filter(Boolean).join(' · '),
                  momentAt: deal.updatedAt || new Date().toISOString(),
                  notifyAt: new Date().toISOString(),
                  offsetMinutes: 0,
                  priority: 'high',
                  channels: ['inapp', 'browser', 'sound', 'title'],
                  waitingForQuiet: false,
                });
                delivered.add(id);
              }
            }
          }
        }
        if (autoReminders.length > 0) {
          writeDelivered(delivered);
          void deliverReminders(autoReminders, {
            onInApp: (reminder) => {
              const action = reminder.dealId
                ? { label: 'Открыть', run: () => handlersRef.current.onOpenDeal?.(reminder.dealId as string) }
                : undefined;
              notify(reminder.title, 'info', action);
            },
            onOpen: (reminder) => {
              if (reminder.dealId) handlersRef.current.onOpenDeal?.(reminder.dealId);
            },
          });
        }
      }

      if (result.skipped.length > 0) markSentMap(result.skipped);

      if (result.fire.length > 0) {
        markSentMap(result.fire.map((reminder) => reminder.id));
        setActive((current) => {
          const ids = new Set(result.fire.map((reminder) => reminder.id));
          return [...result.fire, ...current.filter((item) => !ids.has(item.id))].slice(0, MAX_ACTIVE);
        });
        // Если система уже показала это уведомление по локальному расписанию
        // (приложение было закрыто), второй раз в «браузер» не шлём.
        const localRegistry = readLocalSchedule();
        const forDelivery = result.fire.map((reminder) => (wasShownLocally(reminder.id, localRegistry, Date.now())
          ? { ...reminder, channels: reminder.channels.filter((channel) => channel !== 'browser') }
          : reminder));
        void deliverReminders(forDelivery, {
          pendingCount: result.fire.length,
          onInApp: (reminder) => {
            const action = reminder.dealId
              ? { label: 'Открыть', run: () => handlersRef.current.onOpenDeal?.(reminder.dealId as string) }
              : ['install', 'measure', 'delivery', 'ready', 'custom'].includes(reminder.source)
                ? { label: 'График', run: () => handlersRef.current.onOpenSchedule?.() }
                : undefined;
            notify(reminder.title, 'info', action);
          },
          onOpen: (reminder) => {
            if (reminder.dealId) handlersRef.current.onOpenDeal?.(reminder.dealId);
          },
        });
      }
    } finally {
      busy.current = false;
    }
  }, [calendarEvents, clientName, deals, digestSummary, notify, rules, settings]);

  useEffect(() => {
    tick();
    const timer = window.setInterval(tick, POLL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', tick);
    };
  }, [tick]);

  const snooze = useCallback((id: string, until: Date) => {
    snoozeReminder(id, until);
    void cancelLocalReminder(id);
    setActive((current) => current.filter((item) => item.id !== id));
    setWaiting((current) => current.filter((item) => item.id !== id));
  }, []);

  const dismiss = useCallback((id: string) => {
    markSentMap([id]);
    void cancelLocalReminder(id);
    setActive((current) => current.filter((item) => item.id !== id));
    setWaiting((current) => current.filter((item) => item.id !== id));
  }, []);

  const dismissAll = useCallback(() => {
    markSentMap(active.map((item) => item.id));
    for (const item of active) void cancelLocalReminder(item.id);
    setActive([]);
    setWaiting([]);
  }, [active]);

  const resetHistory = useCallback(() => {
    clearSent();
    clearSnoozes();
    setActive([]);
    tick();
  }, [tick]);

  return {
    enabled: settings.notifications !== false,
    active,
    upcoming,
    waiting,
    rulesActive: rules.filter((rule) => rule.enabled).length,
    rulesTotal: rules.length,
    refresh: tick,
    snooze,
    dismiss,
    dismissAll,
    resetHistory,
  };
}
