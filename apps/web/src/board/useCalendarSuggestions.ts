import { liveQuery } from 'dexie';
import { useEffect, useState } from 'react';
import { calendarSuggestionWindow, localDateOf } from '@fem-ho/contracts';
import { ApiError } from '../app/api.js';
import { useSessionData } from '../app/session.js';
import type {
  CalendarSuggestionCommand,
  CalendarSuggestionOccurrence,
  CalendarSuggestionSnapshot,
  CalendarTaskSuggestion,
} from '../app/types.js';
import { useBoardQuery, useBoardSync } from '../sync/board-sync.js';
import { CALENDAR_SUGGESTIONS_PATH, readSnapshot } from '../sync/cache.js';
import { compareOperations } from '../sync/outbox.js';

export function calendarOccurrence({
  calendar_id,
  uid,
  recurrence_id,
}: CalendarSuggestionOccurrence): CalendarSuggestionOccurrence {
  return { calendar_id, uid, recurrence_id };
}

export function calendarSuggestionKey(item: CalendarSuggestionOccurrence): string {
  return JSON.stringify([item.calendar_id, item.uid, item.recurrence_id]);
}

function scheduledKey(item: CalendarSuggestionOccurrence, startsAt: string) {
  return `${calendarSuggestionKey(item)}:${Date.parse(startsAt)}`;
}

export function useCalendarSuggestions() {
  const { profile } = useSessionData();
  const { db, pending, submit } = useBoardSync();
  const { data, reload, error } =
    useBoardQuery<CalendarSuggestionSnapshot>(CALENDAR_SUGGESTIONS_PATH);
  const [stored, setStored] = useState<CalendarSuggestionSnapshot>();
  const [now, setNow] = useState(Date.now);
  const confirmed = stored ?? data;
  const unsupported = error instanceof ApiError && error.status === 404;

  useEffect(() => {
    const subscription = liveQuery(() =>
      readSnapshot<CalendarSuggestionSnapshot>(db, CALENDAR_SUGGESTIONS_PATH),
    ).subscribe({ next: setStored, error: () => undefined });
    return () => subscription.unsubscribe();
  }, [db]);

  useEffect(() => {
    const refresh = () => {
      setNow(Date.now());
      if (navigator.onLine && !document.hidden) reload();
    };
    window.addEventListener('online', refresh);
    window.addEventListener('pageshow', refresh);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    const tick = unsupported ? undefined : window.setInterval(refresh, 15_000);
    return () => {
      window.removeEventListener('online', refresh);
      window.removeEventListener('pageshow', refresh);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
      window.clearInterval(tick);
    };
  }, [reload, unsupported]);

  const timezone = confirmed?.timezone ?? profile.timezone;
  const today = localDateOf(timezone, new Date(now));
  const dayEnd = Date.parse(confirmed?.day_ends_at ?? '');
  let enabled = confirmed?.enabled ?? false;
  let configurationIssue: string | undefined;
  const ofToday = confirmed?.date === today && now < dayEnd;
  const started = new Set<string>();
  const declined = new Set<string>();
  for (const row of pending
    .filter((item) => item.entity_type === 'calendar_suggestions')
    .sort(compareOperations)) {
    const command = row.payload as CalendarSuggestionCommand;
    if (row.status === 'failed' || row.status === 'conflict') {
      if (command.type === 'configure') configurationIssue = row.id;
      continue;
    }
    if (command.type === 'configure') enabled = command.enabled;
    if (command.type === 'start') started.add(scheduledKey(command.occurrence, command.starts_at));
    if (command.type === 'decline')
      declined.add(scheduledKey(command.occurrence, command.starts_at));
  }

  const items =
    enabled && ofToday && !unsupported
      ? (confirmed?.items ?? [])
          .filter((item) => !started.has(scheduledKey(item, item.starts_at)))
          .map((item) =>
            declined.has(scheduledKey(item, item.starts_at)) ? { ...item, declined: true } : item,
          )
      : [];
  let next = ofToday ? dayEnd : Infinity;
  for (const item of items) {
    if (item.all_day || item.declined) continue;
    const { start, end } = calendarSuggestionWindow(item);
    if (start > now) next = Math.min(next, start);
    if (end > now) next = Math.min(next, end);
  }
  useEffect(() => {
    if (!Number.isFinite(next)) return;
    const timer = window.setTimeout(
      () => {
        setNow(Date.now());
        if (next === dayEnd && navigator.onLine) reload();
      },
      Math.max(0, next - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [dayEnd, next, reload]);

  const stage = (command: CalendarSuggestionCommand, item?: CalendarTaskSuggestion) =>
    submit({
      entity_type: 'calendar_suggestions',
      entity_id: profile.id,
      op: 'update',
      payload: { ...command },
      task_title: item?.title,
      calendar_suggestion: item,
    });

  return {
    enabled,
    configurationIssue,
    available: confirmed !== undefined && !unsupported,
    items,
    now,
    reload,
    timezone,
    stage,
  };
}
