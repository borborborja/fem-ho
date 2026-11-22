import { randomUUID } from 'node:crypto';
import { localTimeToInstant } from '@fem-ho/contracts';
import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { auditedTransaction, type AuditContext } from '../audit/audited-transaction.js';
import { dbBool, isTrue } from '../db/bool.js';
import type { Connection } from '../db/connection.js';
import {
  createGoogleCalendarProvider,
  googleCalendarConfigured,
  GoogleCalendarError,
  googleEventHasGuests,
  googleEventWritable,
  isGoogleCalendarWritable,
  isGoogleEventPrivate,
  type GoogleCalendarConfig,
  type GoogleCalendarEvent,
  type GoogleCalendarProvider,
  type GoogleCalendarSnapshot,
} from '../net/google-calendar.js';
import {
  googleCalendarAccessToken,
  googleCalendarSystem,
  pruneGoogleCalendarOAuth,
} from '../services/google-calendar.js';

const DAY = 86_400_000;
const INTERVAL = 15 * 60_000;
const RETRY_AFTER = 3 * 60_000;
const LEASE = 6 * 60_000;

interface Cursor {
  sync_token: string | null;
  sync_window_day: string | null;
  access_role: string;
}

interface LinkRow {
  calendar_id: string;
  scope_id: string;
  account_id: string;
  remote_calendar_id: string;
  write_enabled: boolean | number;
  access_role: string;
  writable: boolean | number;
  auth_updated_at: string;
}

type GoogleEventDate = NonNullable<GoogleCalendarEvent['start']>;

async function fetchSnapshot(
  provider: GoogleCalendarProvider,
  token: string,
  remoteId: string,
  timeMin: string,
  timeMax: string,
  windowDay: string,
  cursor: Cursor,
) {
  if (cursor.sync_window_day === windowDay && cursor.sync_token !== null) {
    try {
      const data = await provider.listEvents(token, remoteId, timeMin, timeMax, cursor.sync_token);
      if (data.accessRole === cursor.access_role) return { data, full: false };
    } catch (error) {
      if (!(error instanceof GoogleCalendarError && error.status === 410)) throw error;
    }
  }
  return { data: await provider.listEvents(token, remoteId, timeMin, timeMax), full: true };
}

function instant(value: GoogleEventDate | undefined): string {
  if (value?.date !== undefined) {
    const stamp = `${value.date}T00:00:00.000Z`;
    if (
      /^\d{4}-\d{2}-\d{2}$/.test(value.date) &&
      Number.isFinite(Date.parse(stamp)) &&
      new Date(stamp).toISOString() === stamp
    )
      return stamp;
    throw new GoogleCalendarError('invalid_event');
  }
  if (value?.dateTime === undefined) throw new GoogleCalendarError('invalid_event');
  if (/(?:Z|[+-]\d{2}:\d{2})$/i.test(value.dateTime) && Number.isFinite(Date.parse(value.dateTime)))
    return new Date(value.dateTime).toISOString();

  const local = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}):(\d{2}(?:\.\d+)?)$/.exec(value.dateTime);
  if (local === null || !value.timeZone) throw new GoogleCalendarError('invalid_event');
  try {
    const minute = localTimeToInstant(value.timeZone, local[1]!, local[2]!);
    return new Date(Date.parse(minute) + Number(local[3]) * 1000).toISOString();
  } catch {
    throw new GoogleCalendarError('invalid_event');
  }
}

function component(event: GoogleCalendarEvent, accessRole: GoogleCalendarSnapshot['accessRole']) {
  if (!event.etag) throw new GoogleCalendarError('invalid_event');
  const startsAt = instant(event.start);
  const allDay = event.start?.date !== undefined;
  const endsAt =
    event.end === undefined
      ? new Date(Date.parse(startsAt) + (allDay ? DAY : 0)).toISOString()
      : instant(event.end);
  if (endsAt < startsAt) throw new GoogleCalendarError('invalid_event');
  const recurrenceId =
    event.recurringEventId === undefined ? null : instant(event.originalStartTime);
  return {
    id: event.id,
    etag: event.etag,
    uid: event.recurringEventId ?? event.id,
    recurrenceId,
    summary: event.summary ?? '',
    description: event.description ?? null,
    location: event.location ?? null,
    startsAt,
    endsAt,
    allDay,
    timezone: allDay ? null : (event.start?.timeZone ?? null),
    status: event.status === 'tentative' ? 'TENTATIVE' : 'CONFIRMED',
    transparency: event.transparency === 'transparent' ? 'TRANSPARENT' : 'OPAQUE',
    classification: isGoogleEventPrivate(event) ? event.visibility!.toUpperCase() : 'PUBLIC',
    writable:
      isGoogleCalendarWritable(accessRole) &&
      !(accessRole === 'writerWithoutPrivateAccess' && isGoogleEventPrivate(event)) &&
      googleEventWritable(event),
    hasGuests: googleEventHasGuests(event),
  };
}

export interface GoogleCalendarPullOptions {
  connection: Connection;
  secret: string;
  config: GoogleCalendarConfig;
  provider?: GoogleCalendarProvider | undefined;
  now?: string | undefined;
  log?: ((message: string, error?: unknown) => void) | undefined;
}

export async function runGoogleCalendarPulls(options: GoogleCalendarPullOptions): Promise<number> {
  const { connection, config, secret } = options;
  const now = options.now ?? new Date().toISOString();
  await pruneGoogleCalendarOAuth(connection, now);
  if (config.enabled === false) return 0;
  const provider =
    options.provider ??
    (googleCalendarConfigured(config) ? createGoogleCalendarProvider(config) : undefined);
  if (!provider) return 0;
  const instantNow = Date.parse(now);
  const due = new Date(instantNow - INTERVAL).toISOString();
  const retry = new Date(instantNow - RETRY_AFTER).toISOString();
  const leaseUntil = new Date(instantNow + LEASE).toISOString();
  const day = new Date(instantNow).toISOString().slice(0, 10);
  const midnight = Date.parse(`${day}T00:00:00.000Z`);
  const timeMin = new Date(midnight - 365 * DAY).toISOString();
  const timeMax = new Date(midnight + 365 * DAY).toISOString();
  const { rows } = await sql<LinkRow>`
    SELECT l.calendar_id, l.scope_id, l.account_id, l.remote_calendar_id, l.write_enabled,
           l.access_role, c.writable, a.updated_at AS auth_updated_at
    FROM google_calendar_links l
    JOIN calendars c ON c.id = l.calendar_id
    JOIN google_calendar_accounts a ON a.id = l.account_id
    JOIN scopes s ON s.id = l.scope_id
    JOIN users u ON u.id = a.user_id
    WHERE l.deleted_at IS NULL AND c.deleted_at IS NULL AND s.deleted_at IS NULL
      AND u.deleted_at IS NULL AND s.owner_id = a.user_id
      AND a.oauth_status = 'connected' AND a.client_id = ${config.googleClientId ?? ''}
      AND (c.last_refreshed_at IS NULL OR c.last_refreshed_at <= ${due})
      AND (c.last_error_at IS NULL OR c.last_error_at <= ${retry})
      AND (l.pull_lock IS NULL OR l.pull_lock_until <= ${now})
    ORDER BY COALESCE(c.last_error_at, c.last_refreshed_at, c.created_at), l.calendar_id
    LIMIT 8
  `.execute(connection.db);
  let refreshed = 0;
  for (const link of rows) {
    const lock = randomUUID();
    const claimed = await sql<Cursor>`UPDATE google_calendar_links
      SET pull_lock = ${lock}, pull_lock_until = ${leaseUntil}
      WHERE calendar_id = ${link.calendar_id} AND deleted_at IS NULL
        AND (pull_lock IS NULL OR pull_lock_until <= ${now})
        AND EXISTS (SELECT 1 FROM calendars c WHERE c.id = ${link.calendar_id} AND c.deleted_at IS NULL
          AND (c.last_refreshed_at IS NULL OR c.last_refreshed_at <= ${due})
          AND (c.last_error_at IS NULL OR c.last_error_at <= ${retry}))
      RETURNING sync_token, sync_window_day, access_role`.execute(connection.db);
    const cursor = claimed.rows[0];
    if (!cursor) continue;
    try {
      const token = await googleCalendarAccessToken(
        connection.db,
        secret,
        config,
        link.account_id,
        provider,
      );
      const { data: snapshot, full } = await fetchSnapshot(
        provider,
        token,
        link.remote_calendar_id,
        timeMin,
        timeMax,
        day,
        cursor,
      );
      const components: ReturnType<typeof component>[] = [];
      const removed = new Set<string>();
      for (const event of snapshot.events) {
        if (
          event.status === 'cancelled' ||
          (isGoogleEventPrivate(event) &&
            snapshot.accessRole !== 'owner' &&
            snapshot.accessRole !== 'writer')
        ) {
          removed.add(event.id);
          continue;
        }
        const item = component(event, snapshot.accessRole);
        if (item.startsAt >= timeMax || (item.startsAt < timeMin && item.endsAt <= timeMin))
          removed.add(event.id);
        else components.push(item);
      }
      const applied = await auditedTransaction(
        connection.db,
        googleCalendarSystem,
        async (ctx) => {
          const found = await sql`UPDATE google_calendar_links
          SET pull_lock = NULL, pull_lock_until = NULL, access_role = ${snapshot.accessRole},
            sync_token = ${snapshot.syncToken ?? null}, sync_window_day = ${day}, projected_at = ${ctx.now}
          WHERE calendar_id = ${link.calendar_id} AND pull_lock = ${lock} AND deleted_at IS NULL
          AND EXISTS (
            SELECT 1 FROM google_calendar_accounts a JOIN users u ON u.id = a.user_id
              JOIN scopes s ON s.id = ${link.scope_id}
            WHERE a.id = ${link.account_id} AND a.oauth_status = 'connected'
              AND a.updated_at = ${link.auth_updated_at} AND u.deleted_at IS NULL
              AND s.deleted_at IS NULL AND s.owner_id = a.user_id
          ) RETURNING calendar_id`.execute(ctx.tx);
          if (found.rows.length === 0) {
            ctx.noChange();
            return false;
          }
          await applySnapshot(ctx, link, snapshot.accessRole, components, full, removed);
          return true;
        },
        { engine: connection.engine, now },
      );
      if (applied) refreshed += 1;
    } catch (error) {
      const code = error instanceof GoogleCalendarError ? error.code : 'provider_unavailable';
      options.log?.('El refresc de Google Calendar ha fallat', code);
      await recordPullFailure(connection, link, lock, code, now);
    } finally {
      await sql`UPDATE google_calendar_links SET pull_lock = NULL, pull_lock_until = NULL
        WHERE calendar_id = ${link.calendar_id} AND pull_lock = ${lock}`.execute(connection.db);
    }
  }
  return refreshed;
}

async function recordPullFailure(
  connection: Connection,
  link: LinkRow,
  lock: string,
  code: string,
  now: string,
): Promise<void> {
  await auditedTransaction(
    connection.db,
    googleCalendarSystem,
    async (ctx) => {
      const found =
        await sql`UPDATE google_calendar_links SET pull_lock = NULL, pull_lock_until = NULL
      WHERE calendar_id = ${link.calendar_id} AND pull_lock = ${lock} AND deleted_at IS NULL
      RETURNING calendar_id`.execute(ctx.tx);
      if (found.rows.length === 0) {
        ctx.noChange();
        return;
      }
      const blockWrites = ['reconnect_required', 'access_denied', 'not_found'].includes(code);
      await sql`UPDATE calendars SET last_error = ${`google-calendar-${code}`}, last_error_at = ${ctx.now},
      ${blockWrites ? sql`writable = ${dbBool(false)}` : sql`writable = writable`}
      WHERE id = ${link.calendar_id}`.execute(ctx.tx);
      ctx.record({
        entityType: 'calendar',
        entityId: link.calendar_id,
        scopeId: link.scope_id,
        verb: 'updated',
      });
    },
    { engine: connection.engine, now },
  );
}

async function applySnapshot(
  ctx: AuditContext,
  link: LinkRow,
  role: GoogleCalendarSnapshot['accessRole'],
  components: ReturnType<typeof component>[],
  full: boolean,
  removed: Set<string>,
): Promise<void> {
  const snapshot = new Map(components.map((item) => [item.id, item]));
  if (snapshot.size !== components.length) throw new GoogleCalendarError('invalid_event');
  const existing = await sql<{
    id: string;
    uid: string;
    recurrence_id: string | null;
    remote_event_id: string;
    remote_etag: string;
    deleted_at: string | null;
    summary: string;
    description: string | null;
    location: string | null;
    classification: string | null;
    writable: boolean | number;
    has_guests: boolean | number;
  }>`SELECT e.id, e.uid, e.recurrence_id, g.remote_event_id, g.remote_etag, e.deleted_at, g.writable, g.has_guests,
           e.summary, e.description, e.location, e.classification
      FROM google_calendar_events g JOIN events e ON e.id = g.event_id
      WHERE g.calendar_id = ${link.calendar_id}`.execute(ctx.tx);
  const old = new Map(existing.rows.map((row) => [row.remote_event_id, row]));
  const componentKey = (uid: string, recurrenceId: string | null): string =>
    `${uid}\u0000${recurrenceId ?? ''}`;
  const byComponent = new Map(
    existing.rows.map((row) => [componentKey(row.uid, row.recurrence_id), row]),
  );
  let changes = 0;
  for (const item of snapshot.values()) {
    const key = componentKey(item.uid, item.recurrenceId);
    const prior = old.get(item.id) ?? byComponent.get(key);
    if (prior !== undefined) old.delete(prior.remote_event_id);
    if (
      prior?.deleted_at === null &&
      prior.remote_event_id === item.id &&
      prior.remote_etag === item.etag &&
      prior.summary === item.summary &&
      prior.description === item.description &&
      prior.location === item.location &&
      prior.classification === item.classification &&
      isTrue(prior.writable) === item.writable &&
      isTrue(prior.has_guests) === item.hasGuests
    )
      continue;
    const id = prior?.id ?? uuidv7();
    if (prior === undefined) {
      await sql`INSERT INTO events (id, calendar_id, uid, recurrence_id, summary, description, location,
        starts_at, ends_at, all_day, timezone, status, transparency, classification, created_at, updated_at)
        VALUES (${id}, ${link.calendar_id}, ${item.uid}, ${item.recurrenceId}, ${item.summary},
          ${item.description}, ${item.location}, ${item.startsAt}, ${item.endsAt}, ${dbBool(item.allDay)},
          ${item.timezone}, ${item.status}, ${item.transparency}, ${item.classification}, ${ctx.now}, ${ctx.now})`.execute(
        ctx.tx,
      );
    } else {
      await sql`UPDATE events SET uid = ${item.uid}, recurrence_id = ${item.recurrenceId},
        summary = ${item.summary}, description = ${item.description}, location = ${item.location},
        starts_at = ${item.startsAt}, ends_at = ${item.endsAt}, all_day = ${dbBool(item.allDay)},
        timezone = ${item.timezone}, status = ${item.status}, transparency = ${item.transparency},
        classification = ${item.classification}, updated_at = ${ctx.now},
        deleted_at = NULL, version = version + 1 WHERE id = ${id}`.execute(ctx.tx);
    }
    await sql`INSERT INTO google_calendar_events (event_id, calendar_id, remote_event_id, remote_etag, writable, has_guests)
      VALUES (${id}, ${link.calendar_id}, ${item.id}, ${item.etag}, ${dbBool(item.writable)}, ${dbBool(item.hasGuests)})
      ON CONFLICT (event_id) DO UPDATE SET remote_event_id = excluded.remote_event_id, remote_etag = excluded.remote_etag,
        writable = excluded.writable, has_guests = excluded.has_guests`.execute(ctx.tx);
    ctx.record({
      entityType: 'event',
      entityId: id,
      scopeId: link.scope_id,
      verb: prior === undefined ? 'created' : prior.deleted_at === null ? 'updated' : 'restored',
    });
    changes += 1;
  }
  for (const prior of old.values()) {
    if (
      prior.deleted_at !== null ||
      (!full && !removed.has(prior.remote_event_id) && !removed.has(prior.uid))
    )
      continue;
    await sql`UPDATE events SET deleted_at = ${ctx.now}, updated_at = ${ctx.now}, version = version + 1
      WHERE id = ${prior.id}`.execute(ctx.tx);
    ctx.record({
      entityType: 'event',
      entityId: prior.id,
      scopeId: link.scope_id,
      verb: 'deleted',
    });
    changes += 1;
  }
  const writable = isTrue(link.write_enabled) && isGoogleCalendarWritable(role);
  await sql`UPDATE calendars SET writable = ${dbBool(writable)}, last_refreshed_at = ${ctx.now},
    last_error = NULL, last_error_at = NULL, updated_at = ${ctx.now}, sync_seq = sync_seq + ${changes > 0 ? 1 : 0}
    WHERE id = ${link.calendar_id}`.execute(ctx.tx);
  if (changes > 0 || role !== link.access_role || writable !== isTrue(link.writable)) {
    ctx.record({
      entityType: 'calendar',
      entityId: link.calendar_id,
      scopeId: link.scope_id,
      verb: 'refreshed',
    });
  } else {
    ctx.noChange();
  }
}
