// Хук напоминаний: раз в полминуты смотрит, что пора показать, и разносит
// по каналам. Держит ближайшие напоминания для центра.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReminderRule } from '../types';
import { useApp } from '../store';
import {
  clearSent, clearSnoozes, digestText, evaluateReminders, markSentMap, readSent,
  readSnoozes, snoozeReminder, type PlannedReminder,
} from './reminders';
import { deliverReminders } from './notify';
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
  const { deals, settings, clientName, notify, calendarEvents } = useApp();
  const [active, setActive] = useState<PlannedReminder[]>([]);
  const [upcoming, setUpcoming] = useState<PlannedReminder[]>([]);
  const [waiting, setWaiting] = useState<PlannedReminder[]>([]);
  const busy = useRef(false);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  // Сводка на день идёт отдельным правилом из настроек дайджеста.
  const rules = useMemo<ReminderRule[]>(() => {
    const base = settings.reminderRules ?? [];
    const digestRule: ReminderRule = {
      id: 'rule-digest',
      label: 'Сводка на день',
      enabled: Boolean(settings.digest?.enabled),
      source: 'digest',
      offsets: [0],
      atTime: settings.digest?.at ?? '08:30',
      channels: settings.digest?.channels ?? ['inapp', 'browser'],
      priority: 'low',
      respectQuietHours: true,
    };
    return [...base.filter((rule) => rule.source !== 'digest'), digestRule];
  }, [settings.reminderRules, settings.digest]);

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
        return;
      }

      setWaiting(result.waiting);

      if (result.skipped.length > 0) markSentMap(result.skipped);

      if (result.fire.length > 0) {
        markSentMap(result.fire.map((reminder) => reminder.id));
        setActive((current) => {
          const ids = new Set(result.fire.map((reminder) => reminder.id));
          return [...result.fire, ...current.filter((item) => !ids.has(item.id))].slice(0, MAX_ACTIVE);
        });
        void deliverReminders(result.fire, {
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
    setActive((current) => current.filter((item) => item.id !== id));
    setWaiting((current) => current.filter((item) => item.id !== id));
  }, []);

  const dismiss = useCallback((id: string) => {
    markSentMap([id]);
    setActive((current) => current.filter((item) => item.id !== id));
    setWaiting((current) => current.filter((item) => item.id !== id));
  }, []);

  const dismissAll = useCallback(() => {
    markSentMap(active.map((item) => item.id));
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
