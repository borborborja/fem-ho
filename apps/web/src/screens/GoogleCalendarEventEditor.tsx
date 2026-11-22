import { useEffect, useRef, useState } from 'react';
import { localDateOf, localTimeToInstant, t, type components } from '@fem-ho/contracts';
import { v7 as uuidv7 } from 'uuid';
import { api } from '../app/api.js';
import { useApi, useMutation } from '../app/useApi.js';
import { useSessionData } from '../app/session.js';
import { useBoardSync } from '../sync/board-sync.js';
import type { Calendar, EventOccurrence } from '../app/types.js';

type Change = components['schemas']['GoogleCalendarChange'];
const changesPath = '/api/v1/calendars/google/changes';
const day = 86_400_000;

function civilDate(value: string, days: number): string {
  return new Date(Date.parse(`${value}T00:00:00Z`) + days * day).toISOString().slice(0, 10);
}

function wallTime(value: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: timezone,
  }).format(new Date(value));
}

export function GoogleCalendarEventEditor({
  timezone,
  date,
  calendars,
  event,
  onClose,
  onQueued,
}: {
  timezone: string;
  date: string;
  calendars: Calendar[];
  event?: EventOccurrence | undefined;
  onClose: () => void;
  onQueued: () => void;
}) {
  const sync = useBoardSync();
  const { scopes } = useSessionData();
  const start = event?.starts_at;
  const end = event?.ends_at;
  const [allDay, setAllDay] = useState(event?.all_day ?? false);
  const [calendar, setCalendar] = useState(event?.calendar_id ?? calendars[0]?.id ?? '');
  const [summary, setSummary] = useState(event?.summary ?? '');
  const [description, setDescription] = useState(event?.description ?? '');
  const [location, setLocation] = useState(event?.location ?? '');
  const [from, setFrom] = useState(
    start === undefined
      ? date
      : allDay
        ? start.slice(0, 10)
        : localDateOf(timezone, new Date(start)),
  );
  const [to, setTo] = useState(
    end === undefined
      ? date
      : allDay
        ? civilDate(end.slice(0, 10), -1)
        : localDateOf(timezone, new Date(end)),
  );
  const [fromTime, setFromTime] = useState(
    start === undefined || allDay ? '09:00' : wallTime(start, timezone),
  );
  const [toTime, setToTime] = useState(
    end === undefined || allDay ? '10:00' : wallTime(end, timezone),
  );
  const [invalid, setInvalid] = useState(false);
  const title = t(event === undefined ? 'calendar.google.create' : 'calendar.google.edit');
  const save = useMutation(async () => {
    setInvalid(false);
    if (!summary.trim() || !calendar || !from || !to || (!allDay && (!fromTime || !toTime))) {
      setInvalid(true);
      return;
    }
    const startsAt = allDay
      ? `${from}T00:00:00.000Z`
      : localTimeToInstant(timezone, from, fromTime);
    const endsAt = allDay
      ? `${civilDate(to, 1)}T00:00:00.000Z`
      : localTimeToInstant(timezone, to, toTime);
    if (!(Date.parse(endsAt) > Date.parse(startsAt))) {
      setInvalid(true);
      return;
    }
    if (event?.google_has_guests && !window.confirm(t('calendar.google.guestNotice'))) return;
    const fields =
      event === undefined
        ? undefined
        : [
            summary.trim() !== event.summary ? 'summary' : null,
            description !== (event.description ?? '') ? 'description' : null,
            location !== (event.location ?? '') ? 'location' : null,
            allDay !== event.all_day || Date.parse(startsAt) !== Date.parse(event.starts_at)
              ? 'start'
              : null,
            allDay !== event.all_day || Date.parse(endsAt) !== Date.parse(event.ends_at)
              ? 'end'
              : null,
          ].filter((field) => field !== null);
    await sync.submit({
      entity_type: 'google_calendar_event',
      entity_id: event?.event_id ?? uuidv7(),
      op: event === undefined ? 'create' : 'update',
      base_version: event?.version,
      task_title: summary.trim(),
      payload: {
        calendar_id: calendar,
        summary: summary.trim(),
        description,
        location,
        starts_at: startsAt,
        ends_at: endsAt,
        timezone: event?.timezone ?? timezone,
        all_day: allDay,
        notify_guests: event?.google_has_guests === true,
        ...(fields === undefined ? {} : { fields }),
      },
    });
    onQueued();
  });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-testid="google-calendar-editor"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
      style={{
        position: 'fixed',
        inset: 0,
        display: 'grid',
        placeItems: 'center',
        padding: 16,
        background: 'var(--scrim)',
        zIndex: 65,
      }}
      onClick={onClose}
    >
      <form
        className="plou-card"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          void save.run();
        }}
        style={{
          display: 'grid',
          gap: 9,
          width: 'min(460px, 100%)',
          padding: 18,
          maxHeight: 'calc(100dvh - 32px)',
          overflowY: 'auto',
        }}
      >
        <strong>{title}</strong>
        {event === undefined ? (
          <label>
            {t('settings.googleCalendar.calendar')}
            <select
              className="plou-input"
              value={calendar}
              onChange={(e) => setCalendar(e.target.value)}
            >
              {calendars.map((item) => {
                const scope = scopes.find((candidate) => candidate.id === item.scope_id);
                return (
                  <option key={item.id} value={item.id}>
                    {scope ? `${item.name} · ${scope.name}` : item.name}
                  </option>
                );
              })}
            </select>
          </label>
        ) : null}
        <label>
          {t('calendar.google.summary')}
          <input
            className="plou-input"
            required
            autoFocus
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
          />
        </label>
        <label>
          {t('calendar.google.description')}
          <textarea
            className="plou-input"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <label>
          {t('calendar.google.location')}
          <input
            className="plou-input"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
        </label>
        <label>
          <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
          {t('calendar.google.allDay')}
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: allDay ? '1fr' : '1fr 1fr', gap: 8 }}>
          <label>
            {t('calendar.google.start')}
            <input
              className="plou-input"
              type="date"
              required
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                if (e.target.value > to) setTo(e.target.value);
              }}
            />
          </label>
          {!allDay ? (
            <input
              aria-label={t('calendar.google.start')}
              className="plou-input"
              type="time"
              required
              value={fromTime}
              onChange={(e) => setFromTime(e.target.value)}
            />
          ) : null}
          <label>
            {t('calendar.google.end')}
            <input
              className="plou-input"
              type="date"
              required
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          {!allDay ? (
            <input
              aria-label={t('calendar.google.end')}
              className="plou-input"
              type="time"
              required
              value={toTime}
              onChange={(e) => setToTime(e.target.value)}
            />
          ) : null}
        </div>
        {invalid || save.error ? <div role="alert">{t('calendar.google.invalid')}</div> : null}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="plou-btn plou-btn-ghost" onClick={onClose}>
            {t('nav.cancel')}
          </button>
          <button type="submit" className="plou-btn plou-btn-primary" disabled={save.busy}>
            {t('nav.save')}
          </button>
        </div>
      </form>
    </div>
  );
}

export function GoogleCalendarChanges({
  revision,
  onSynced,
}: {
  revision: number;
  onSynced: () => void;
}) {
  const changes = useApi<Change[]>(changesPath, [revision]);
  const latest = useRef(changes.data);
  const { reloadInBackground } = changes;
  const pending = changes.data?.some((change) =>
    ['pending', 'sending', 'sent'].includes(change.status),
  );
  useEffect(() => {
    if (!pending) return;
    const timer = window.setInterval(reloadInBackground, 3500);
    return () => window.clearInterval(timer);
  }, [pending, reloadInBackground]);
  useEffect(() => {
    if (changes.data === undefined) return;
    const outstanding = (latest.current ?? []).filter((item) =>
      ['pending', 'sending', 'sent'].includes(item.status),
    );
    latest.current = changes.data;
    if (
      outstanding.some(
        (item) => !changes.data?.some((next) => next.id === item.id && next.status === item.status),
      )
    )
      onSynced();
  }, [changes.data, onSynced]);
  const resolve = useMutation(async (change: Change, retry: boolean) => {
    if (retry && !window.confirm(t('calendar.google.reapplyConfirm'))) return;
    const confirmGuests = change.error_code === 'guests_confirmation_required';
    if (retry && confirmGuests && !window.confirm(t('calendar.google.guestNotice'))) return;
    if (retry)
      await api.post(`${changesPath}/${change.id}/retry`, { notify_guests: confirmGuests });
    else await api.delete(`${changesPath}/${change.id}`);
    changes.reload();
  });
  if (!changes.data?.length) return null;
  return (
    <details className="plou-card" data-testid="google-calendar-changes" style={{ padding: 8 }}>
      <summary>
        {t('calendar.google.changes')} · {changes.data.length}
      </summary>
      {changes.data.map((change) => (
        <div
          key={change.id}
          style={{
            marginBlock: 6,
            display: 'flex',
            gap: 8,
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
          {change.draft ? <span>{change.draft.summary}</span> : null}
          <span>
            {t(
              change.error_code === 'reconnect_required'
                ? 'settings.mail.oauth.error.reconnect_required'
                : `calendar.google.${change.status}`,
            )}
          </span>
          {change.draft && (change.status === 'failed' || change.status === 'conflict') ? (
            <details>
              <summary>{t('calendar.google.edit')}</summary>
              <p>{change.draft.summary}</p>
              {change.draft.location ? <p>{change.draft.location}</p> : null}
              {change.draft.description ? (
                <p style={{ whiteSpace: 'pre-wrap' }}>{change.draft.description}</p>
              ) : null}
            </details>
          ) : null}
          {change.status === 'failed' || change.status === 'conflict' ? (
            <button
              type="button"
              className="plou-btn"
              disabled={resolve.busy}
              onClick={() => void resolve.run(change, true)}
            >
              {t('calendar.google.retry')}
            </button>
          ) : null}
          {change.status !== 'sending' && change.status !== 'sent' ? (
            <button
              type="button"
              className="plou-btn plou-btn-ghost"
              disabled={resolve.busy}
              onClick={() => void resolve.run(change, false)}
            >
              {t('calendar.google.discard')}
            </button>
          ) : null}
        </div>
      ))}
      {resolve.error ? <div role="alert">{t('settings.googleCalendar.error')}</div> : null}
    </details>
  );
}
