import { sql } from 'kysely';
import { auditedTransaction, type AuditContext } from '../audit/audited-transaction.js';
import { isTrue } from '../db/bool.js';
import type { Connection } from '../db/connection.js';
import type { MigrationDb } from '../db/migration-db.js';
import { isGoogleCalendarWritable } from '../net/google-calendar.js';
import { PolicyError, notFound } from '../policy/errors.js';
import type { Principal } from '../policy/principal.js';
import { requireHumanSession } from './external-access.js';
import { assertScopeRole } from './scopes.js';

export type GoogleCalendarAction = 'create' | 'update' | 'delete';
export type GoogleCalendarChangeStatus = 'pending' | 'sending' | 'sent' | 'conflict' | 'failed';

export interface CalendarDraft {
  summary: string;
  description: string;
  location: string;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  timezone: string;
}

interface ChangeInput {
  draft?: CalendarDraft;
  notify_guests: boolean;
  fields?: Array<'summary' | 'description' | 'location' | 'start' | 'end'>;
}

export interface GoogleCalendarChangeRow {
  id: string;
  user_id: string;
  calendar_id: string;
  remote_calendar_id: string;
  event_id: string;
  remote_event_id: string;
  base_etag: string | null;
  operation: GoogleCalendarAction;
  draft: string;
  status: GoogleCalendarChangeStatus;
  error_code: string | null;
  attempts: number;
  next_attempt_at: string;
  lock_token: string | null;
  created_at: string;
  updated_at: string;
}

export function calendarChangeInput(row: GoogleCalendarChangeRow): ChangeInput {
  return JSON.parse(row.draft) as ChangeInput;
}

function publicChange(row: GoogleCalendarChangeRow) {
  const { id, calendar_id, event_id, operation, status, error_code, created_at } = row;
  return {
    id,
    calendar_id,
    event_id,
    operation,
    status,
    error_code,
    created_at,
    draft: calendarChangeInput(row).draft ?? null,
  };
}

export async function findCalendarWriteTarget(db: MigrationDb, calendarId: string, user: string) {
  const result = await sql<{
    scope_id: string;
    account_id: string;
    remote_calendar_id: string;
    access_role: string;
    writable: number | boolean;
    oauth_status: string;
  }>`
    SELECT c.scope_id, l.account_id, l.remote_calendar_id, l.access_role, c.writable, a.oauth_status
    FROM google_calendar_links l
    JOIN calendars c ON c.id = l.calendar_id
    JOIN scopes s ON s.id = c.scope_id
    JOIN google_calendar_accounts a ON a.id = l.account_id
    JOIN users u ON u.id = a.user_id
    WHERE l.calendar_id = ${calendarId} AND a.user_id = ${user} AND s.owner_id = a.user_id
      AND c.deleted_at IS NULL AND s.deleted_at IS NULL AND l.deleted_at IS NULL
      AND u.deleted_at IS NULL
  `.execute(db);
  return result.rows[0];
}

function fail(code: string, status: number): never {
  throw new PolicyError(`google-calendar-${code}`, 'Google Calendar', status, code);
}

function cleanDraft(input: Record<string, unknown>): CalendarDraft {
  const text = (key: string): string => {
    const value = input[key];
    if (typeof value !== 'string' || value.length > 32_768) fail('invalid_event', 422);
    return value;
  };
  const draft = {
    summary: text('summary').trim(),
    description: text('description'),
    location: text('location'),
    starts_at: text('starts_at'),
    ends_at: text('ends_at'),
    all_day: input.all_day === true,
    timezone: text('timezone'),
  };
  const start = Date.parse(draft.starts_at);
  const end = Date.parse(draft.ends_at);
  const allDay = /^\d{4}-\d\d-\d\dT00:00:00\.000Z$/u;
  if (
    !draft.summary ||
    typeof input.all_day !== 'boolean' ||
    !Number.isFinite(start) ||
    !(end > start)
  )
    fail('invalid_event', 422);
  if (
    draft.all_day &&
    (!allDay.test(draft.starts_at) ||
      !allDay.test(draft.ends_at) ||
      new Date(start).toISOString() !== draft.starts_at ||
      new Date(end).toISOString() !== draft.ends_at)
  )
    fail('invalid_event', 422);
  try {
    new Intl.DateTimeFormat('en', { timeZone: draft.timezone }).format(start);
  } catch {
    fail('invalid_event', 422);
  }
  return draft;
}

export async function submitGoogleCalendarChange(
  connection: Connection,
  principal: Principal,
  opId: string,
  eventId: string,
  operation: GoogleCalendarAction,
  version: number | undefined,
  input: Record<string, unknown>,
) {
  requireHumanSession(principal);
  if (!principal.capabilities.has(operation === 'delete' ? 'events:delete' : 'events:write'))
    fail('read_only', 403);
  const calendarId = input.calendar_id;
  const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu;
  if (typeof calendarId !== 'string' || !uuid.test(eventId) || !uuid.test(opId))
    fail('invalid_event', 422);

  return auditedTransaction(
    connection.db,
    principal,
    async (ctx) => {
      const target = await findCalendarWriteTarget(ctx.tx, calendarId, principal.userId);
      if (target === undefined) throw notFound('calendar', calendarId);
      await assertScopeRole(ctx.tx, principal, target.scope_id, 'content');
      const previous = await readChange(ctx.tx, principal.userId, opId);
      if (previous !== undefined) {
        ctx.noChange();
        return publicChange(previous);
      }
      if (!isTrue(target.writable) || !isGoogleCalendarWritable(target.access_role))
        fail('read_only', 403);

      let remoteId = eventId.replaceAll('-', '').toLowerCase();
      let etag: string | null = null;
      let stale = false;
      const draft: ChangeInput = {
        ...(operation === 'delete' ? {} : { draft: cleanDraft(input) }),
        notify_guests: input.notify_guests === true,
      };
      if (operation !== 'create') {
        const result = await sql<{
          version: number;
          summary: string;
          description: string | null;
          location: string | null;
          starts_at: string;
          ends_at: string | null;
          all_day: number | boolean;
          remote_event_id: string;
          remote_etag: string;
          writable: number | boolean;
          has_guests: number | boolean;
        }>`
        SELECT e.version, e.summary, e.description, e.location, e.starts_at, e.ends_at,
               e.all_day, g.remote_event_id, g.remote_etag, g.writable, g.has_guests
        FROM events e JOIN google_calendar_events g ON g.event_id = e.id
        WHERE e.id = ${eventId} AND e.calendar_id = ${calendarId} AND e.deleted_at IS NULL
      `.execute(ctx.tx);
        const event = result.rows[0];
        if (event === undefined) throw notFound('event', eventId);
        if (!isTrue(event.writable)) fail('read_only', 403);
        if (!Number.isInteger(version)) fail('invalid_event', 422);
        stale = Number(event.version) !== version;
        if (isTrue(event.has_guests) && input.notify_guests !== true)
          fail('guests_confirmation_required', 422);
        remoteId = event.remote_event_id;
        etag = event.remote_etag;
        if (draft.draft !== undefined) {
          const edit = draft.draft;
          const fields = ['summary', 'description', 'location', 'start', 'end'] as const;
          const supplied = Array.isArray(input.fields) ? input.fields : null;
          if (supplied?.some((field) => !(fields as readonly unknown[]).includes(field)))
            fail('invalid_event', 422);
          const dateType = edit.all_day !== isTrue(event.all_day);
          const changed = [
            edit.summary !== event.summary,
            edit.description !== (event.description ?? ''),
            edit.location !== (event.location ?? ''),
            dateType || Date.parse(edit.starts_at) !== Date.parse(event.starts_at),
            dateType || Date.parse(edit.ends_at) !== Date.parse(event.ends_at ?? ''),
          ];
          draft.fields = fields.filter(
            (field, index) => supplied?.includes(field) ?? changed[index],
          );
        }
      }
      if (draft.fields?.length === 0) {
        ctx.noChange();
        return {
          id: opId,
          calendar_id: calendarId,
          event_id: eventId,
          operation,
          status: 'sent',
          error_code: null,
          created_at: ctx.now,
          draft: draft.draft ?? null,
        };
      }
      const status = stale ? 'conflict' : 'pending';
      const errorCode = status === 'conflict' ? 'remote_changed' : null;
      const written = await sql<GoogleCalendarChangeRow>`
      INSERT INTO google_calendar_changes
        (id, user_id, calendar_id, event_id, remote_calendar_id, remote_event_id, base_etag,
         operation, draft, status, error_code, next_attempt_at, created_at, updated_at)
      VALUES (${opId}, ${principal.userId}, ${calendarId}, ${eventId}, ${target.remote_calendar_id},
              ${remoteId}, ${etag}, ${operation}, ${JSON.stringify(draft)}, ${status}, ${errorCode}, ${ctx.now},
              ${ctx.now}, ${ctx.now})
      ON CONFLICT DO NOTHING
      RETURNING *
    `.execute(ctx.tx);
      const change = written.rows[0];
      if (change === undefined) {
        const repeated = await readChange(ctx.tx, principal.userId, opId);
        if (repeated === undefined) fail('already_pending', 409);
        ctx.noChange();
        return publicChange(repeated);
      }
      recordCalendarChange(ctx, change.id, 'created');
      return publicChange(change);
    },
    { engine: connection.engine },
  );
}

async function readChange(db: MigrationDb, user: string, id: string) {
  const result = await sql<GoogleCalendarChangeRow>`
    SELECT * FROM google_calendar_changes WHERE user_id = ${user} AND id = ${id}
  `.execute(db);
  return result.rows[0];
}

export async function listGoogleCalendarChanges(db: MigrationDb, principal: Principal) {
  requireHumanSession(principal);
  const recent = new Date(Date.now() - 600_000).toISOString();
  const result = await sql<GoogleCalendarChangeRow>`
    SELECT g.* FROM google_calendar_changes g JOIN google_calendar_links l ON l.calendar_id = g.calendar_id
    WHERE g.user_id = ${principal.userId}
      AND (g.status <> 'sent' OR (l.deleted_at IS NULL AND g.updated_at >= ${recent}
        AND (l.projected_at IS NULL OR l.projected_at < g.updated_at)))
    ORDER BY g.created_at DESC LIMIT 100
  `.execute(db);
  return result.rows.map(publicChange);
}

export async function resolveGoogleCalendarChange(
  ctx: AuditContext,
  principal: Principal,
  id: string,
  retry: boolean,
  notifyGuests = false,
): Promise<void> {
  requireHumanSession(principal);
  const change = await readChange(ctx.tx, principal.userId, id);
  if (change === undefined) throw notFound('google-calendar-change', id);
  if (change.status === 'sending' || change.status === 'sent') fail('already_sending', 409);
  if (!retry) {
    const deleted = await sql`
      DELETE FROM google_calendar_changes WHERE id = ${id} AND status IN ('pending', 'failed', 'conflict')
    `.execute(ctx.tx);
    if (!deleted.numAffectedRows) fail('already_sending', 409);
    recordCalendarChange(ctx, id, 'deleted');
    return;
  }
  const target = await findCalendarWriteTarget(ctx.tx, change.calendar_id, principal.userId);
  if (target === undefined || !isTrue(target.writable)) fail('read_only', 403);
  await assertScopeRole(ctx.tx, principal, target.scope_id, 'content');
  if (change.status === 'pending') {
    ctx.noChange();
    return;
  }
  const draft = calendarChangeInput(change);
  if (notifyGuests) draft.notify_guests = true;
  const result = await sql`
    UPDATE google_calendar_changes SET status = 'pending', error_code = NULL,
      draft = ${JSON.stringify(draft)}, base_etag = NULL, next_attempt_at = ${ctx.now},
      attempts = 0, updated_at = ${ctx.now}
    WHERE id = ${id} AND status IN ('failed', 'conflict')
      AND NOT EXISTS (
        SELECT 1 FROM google_calendar_changes active
        WHERE active.user_id = ${principal.userId} AND active.calendar_id = ${change.calendar_id}
          AND active.remote_event_id = ${change.remote_event_id}
          AND active.status IN ('pending', 'sending')
      )
  `.execute(ctx.tx);
  if (!result.numAffectedRows) fail('already_pending', 409);
  recordCalendarChange(ctx, id, 'updated');
}

export function recordCalendarChange(
  ctx: AuditContext,
  id: string,
  verb: 'created' | 'updated' | 'deleted',
  status?: { from: GoogleCalendarChangeStatus; to: GoogleCalendarChangeStatus },
): void {
  // L'historial pot arribar a altres membres. El cos i els identificadors de Google són privats.
  ctx.record({
    entityType: 'google_calendar_change',
    entityId: id,
    verb,
    ...(status === undefined ? {} : { changes: { status } }),
  });
}
