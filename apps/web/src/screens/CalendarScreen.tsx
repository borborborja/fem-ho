/**
 * El calendari. docs/02 §5.
 *
 * Graella de dues columnes: calendari flexible i rail de 340px, **amb la posició del
 * rail configurable** a Ajustos (esquerra, dreta o a sota). Per sota de 860px el rail
 * passa a sota sempre, en scroll vertical (docs/02 §10).
 *
 * **El rail és el MATEIX component que la columna Inbox del kanban** (P4). No una còpia
 * amb els mateixos estils: la mateixa. Si divergissin es notaria, i el document ho diu
 * amb aquestes paraules.
 */

import { useMemo, useState } from 'react';
import { t } from '@fem-ho/contracts';
import { DayView, MonthView, WeekView, useIsMobile } from '@fem-ho/design-system/femho';
import { api } from '../app/api.js';
import { useSession, useSessionData } from '../app/session.js';
import { useApi } from '../app/useApi.js';
import type { Calendar, EventOccurrence, Inbox } from '../app/types.js';
import { InboxRail } from '../board/InboxRail.js';
import { ErrorBanner } from './BoardScreen.js';

type Mode = 'month' | 'week' | 'day';

/** `YYYY-MM-DD` d'una data local, sense passar per UTC. */
function iso(date: Date): string {
  return `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** El dilluns de la setmana d'una data. La setmana comença en dilluns (docs/00). */
function mondayOf(date: Date): Date {
  return addDays(date, -((date.getDay() + 6) % 7));
}

export interface CalendarScreenProps {
  activeScopeIds: string[];
  onOpenTask: (id: string) => void;
}

export function CalendarScreen({ activeScopeIds, onOpenTask }: CalendarScreenProps) {
  const { scopes, settings } = useSessionData();
  const { updateSettings } = useSession();
  const mobile = useIsMobile();
  const [mode, setMode] = useState<Mode>('month');
  const [selected, setSelected] = useState<string>(() => iso(new Date()));
  const [cursor, setCursor] = useState<Date>(() => new Date());

  // La finestra que es demana depèn de la vista: el mes sencer per a la graella, la
  // setmana per a la setmanal, el dia per a la diària. Demanar sempre el mes seria
  // portar trenta dies de dades per pintar-ne un.
  const [from, to] = useMemo<[string, string]>(() => {
    if (mode === 'day') return [selected, selected];
    if (mode === 'week') {
      const monday = mondayOf(new Date(`${selected}T12:00:00`));
      return [iso(monday), iso(addDays(monday, 6))];
    }
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    return [iso(addDays(first, -7)), iso(addDays(last, 7))];
  }, [mode, selected, cursor]);

  const scopeQuery = activeScopeIds.length > 0 ? `&scope_ids=${activeScopeIds.join(',')}` : '';
  const events = useApi<EventOccurrence[]>(`/api/v1/events?from=${from}&to=${to}${scopeQuery}`);
  const inbox = useApi<Inbox>(
    `/api/v1/inbox?date=${selected}&include_overdue=${String(settings.inbox_show_overdue ?? true)}${scopeQuery}`,
  );

  const colorOf = (scopeId: string): string => {
    const scope = scopes.find((candidate) => candidate.id === scopeId);
    return scope === undefined ? 'var(--ink-faint)' : `var(${scope.color})`;
  };

  /**
   * Les fonts de dades dels àmbits actius, i quines es veuen.
   *
   * **S'amaga, no s'esborra**: la font és de l'àmbit i la comparteix tothom qui hi és.
   * Que algú deixi de mirar el calendari de festius no vol dir que ningú més el vulgui.
   * I es guarda el que s'amaga, no el que es veu: així una font nova surt sola, que és
   * el que ha de passar quan algú de la casa n'afegeix una.
   */
  const calendars = useApi<Calendar[]>('/api/v1/calendars');
  const hidden = settings.hidden_calendar_ids ?? [];
  const sources = (calendars.data ?? []).filter(
    (calendar) =>
      calendar.kind === 'events' &&
      (activeScopeIds.length === 0 || activeScopeIds.includes(calendar.scope_id)),
  );

  const occurrences = (events.data ?? []).filter(
    (occurrence) =>
      occurrence.calendar_id === undefined || !hidden.includes(occurrence.calendar_id),
  );

  const toggleSource = (id: string): void => {
    void updateSettings({
      hidden_calendar_ids: hidden.includes(id)
        ? hidden.filter((value) => value !== id)
        : [...hidden, id],
    });
  };

  const dotsByDate = useMemo<Record<string, string[]>>(() => {
    const map: Record<string, string[]> = {};
    for (const occurrence of occurrences) {
      const day = occurrence.starts_at.slice(0, 10);
      const color = colorOf(occurrence.scope_id);
      const list = map[day] ?? [];
      // Fins a 3 punts per dia (docs/02 §5), i sense repetir el color d'un mateix àmbit.
      if (!list.includes(color) && list.length < 3) list.push(color);
      map[day] = list;
    }
    return map;
  }, [occurrences, scopes]);

  const months = t('calendar.months').split(',');
  const weekdays = t('calendar.weekdays').split(',');

  const dayItems = occurrences
    .filter((occurrence) => occurrence.starts_at.slice(0, 10) === selected)
    .map((occurrence) => ({
      // Una ocurrència no té identitat pròpia: la clau és l'esdeveniment més l'instant,
      // perquè dues ocurrències del mateix mestre comparteixen `event_id` (D8).
      id: `${occurrence.event_id}@${occurrence.starts_at}`,
      title: occurrence.summary,
      color: colorOf(occurrence.scope_id),
      time: occurrence.all_day ? undefined : occurrence.starts_at.slice(11, 16),
    }));

  const weekDays = useMemo(() => {
    const monday = mondayOf(new Date(`${selected}T12:00:00`));
    return Array.from({ length: 7 }, (_, index) => {
      const date = addDays(monday, index);
      const key = iso(date);
      return {
        iso: key,
        weekday: weekdays[index] ?? '',
        number: date.getDate(),
        items: occurrences
          .filter((occurrence) => occurrence.starts_at.slice(0, 10) === key)
          .map((occurrence) => ({
            id: `${occurrence.event_id}@${occurrence.starts_at}`,
            title: occurrence.summary,
          })),
      };
    });
  }, [selected, occurrences]);

  const position = mobile ? 'below' : (settings.inbox_position ?? 'right');
  const railFirst = position === 'left';

  const rail = (
    <InboxRail
      tasks={[...(inbox.data?.dated ?? []), ...(inbox.data?.overdue ?? [])].map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        scope_id: task.scope_id,
        time: task.due_time ?? undefined,
      }))}
      undated={(inbox.data?.undated ?? []).map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        scope_id: task.scope_id,
      }))}
      scopes={scopes
        .filter((scope) => activeScopeIds.includes(scope.id))
        .map((scope) => ({ id: scope.id, name: scope.name, color: `var(${scope.color})` }))}
      placement="rail"
      dayLabel={t('calendar.selectedDay', {
        day: String(Number(selected.slice(8, 10))),
        month: months[Number(selected.slice(5, 7)) - 1] ?? '',
      })}
      onOpen={onOpenTask}
      onChanged={inbox.reload}
      onMove={(taskId, status) => {
        void api.post(`/api/v1/tasks/${taskId}/move`, { status }).then(() => {
          inbox.reload();
        });
      }}
    />
  );

  const calendar = (
    <div style={{ display: 'grid', gap: 14 }}>
      <div
        role="tablist"
        data-testid="calendar-modes"
        style={{
          display: 'inline-flex',
          padding: 3,
          borderRadius: 100,
          background: 'var(--ghost-bg)',
          width: 'fit-content',
        }}
      >
        {(
          [
            { key: 'month', label: t('calendar.month') },
            { key: 'week', label: t('calendar.week') },
            { key: 'day', label: t('calendar.day') },
          ] as const
        ).map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={mode === tab.key}
            data-testid={`calendar-mode-${tab.key}`}
            onClick={() => setMode(tab.key)}
            style={{
              padding: '7px 18px',
              minHeight: mobile ? 44 : undefined,
              borderRadius: 100,
              border: 'none',
              cursor: 'pointer',
              font: 'inherit',
              fontSize: 12.5,
              fontWeight: mode === tab.key ? 700 : 500,
              background: mode === tab.key ? 'var(--card-bg)' : 'transparent',
              color: mode === tab.key ? 'var(--ink)' : 'var(--ink-soft)',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/*
        Les fonts de l'àmbit actiu, per encendre i apagar.
        Amb una sola no hi ha res a triar, i una fila de commutadors d'un element és
        soroll: només surt quan n'hi ha més d'una.
      */}
      {sources.length < 2 ? null : (
        <div
          data-testid="calendar-sources"
          style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}
        >
          <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink-soft)' }}>
            {t('calendar.sources')}
          </span>
          {sources.map((source) => {
            const on = !hidden.includes(source.id);
            return (
              <button
                key={source.id}
                type="button"
                data-testid={`calendar-source-${source.id}`}
                aria-pressed={on}
                aria-label={t(on ? 'calendar.sources.hide' : 'calendar.sources.show', {
                  name: source.name,
                })}
                onClick={() => toggleSource(source.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 11px',
                  borderRadius: 100,
                  border: 'none',
                  cursor: 'pointer',
                  font: 'inherit',
                  fontSize: 11.5,
                  fontWeight: on ? 700 : 500,
                  background: on ? 'var(--ghost-bg)' : 'transparent',
                  // El color no és mai l'únic senyal (docs/02 §12): el punt s'apaga i
                  // el text també.
                  color: on ? 'var(--ink)' : 'var(--ink-faint)',
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background: on ? colorOf(source.scope_id) : 'var(--ink-faint)',
                    opacity: on ? 1 : 0.4,
                  }}
                />
                {source.name}
              </button>
            );
          })}
        </div>
      )}

      {events.error !== undefined ? <ErrorBanner onRetry={events.reload} /> : null}

      <div style={{ opacity: events.revalidating ? 0.6 : 1 }}>
        {mode === 'month' ? (
          <MonthView
            year={cursor.getFullYear()}
            month={cursor.getMonth()}
            monthLabel={months[cursor.getMonth()] ?? ''}
            weekdayLabels={{
              days: weekdays,
              prevLabel: t('calendar.prevMonth'),
              nextLabel: t('calendar.nextMonth'),
            }}
            selectedDate={selected}
            today={iso(new Date())}
            dotsByDate={dotsByDate}
            onPrev={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
            onNext={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
            onSelect={setSelected}
          />
        ) : mode === 'week' ? (
          <WeekView
            days={weekDays}
            selectedDate={selected}
            onSelect={setSelected}
            emptyLabel={t('calendar.empty.week')}
          />
        ) : (
          <DayView
            label={t('calendar.selectedDay', {
              day: String(Number(selected.slice(8, 10))),
              month: months[Number(selected.slice(5, 7)) - 1] ?? '',
            })}
            items={dayItems}
            emptyLabel={t('calendar.empty.day')}
          />
        )}
      </div>
    </div>
  );

  if (position === 'below') {
    return (
      <div data-testid="calendar-screen" style={{ display: 'grid', gap: 20 }}>
        {calendar}
        {rail}
      </div>
    );
  }

  return (
    <div
      data-testid="calendar-screen"
      style={{
        display: 'grid',
        gridTemplateColumns: railFirst ? '340px 1fr' : '1fr 340px',
        gap: 20,
        alignItems: 'start',
      }}
    >
      {railFirst ? rail : calendar}
      {railFirst ? calendar : rail}
    </div>
  );
}
