import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { auditedTransaction } from '../audit/audited-transaction.js';
import { isTrue } from '../db/bool.js';
import type { Connection } from '../db/connection.js';
import {
  GoogleCalendarError,
  googleEventHasGuests,
  googleEventSchema,
  googleEventWritable,
  isGoogleCalendarWritable,
  isGoogleEventPrivate,
  type GoogleCalendarProvider,
} from '../net/google-calendar.js';
import { z } from 'zod';
import type { Principal } from '../policy/principal.js';
import {
  calendarChangeInput,
  findCalendarWriteTarget,
  recordCalendarChange,
  type GoogleCalendarChangeRow,
  type GoogleCalendarChangeStatus,
} from '../services/google-calendar-changes.js';
import { googleCalendarAccessToken } from '../services/google-calendar.js';
import type { EffectiveGoogleConfig } from '../services/google-config.js';

interface Options {
  connection: Connection;
  principal: Principal;
  now: string;
  secret: string;
  config: EffectiveGoogleConfig;
  provider: GoogleCalendarProvider;
}

const remoteSchema = googleEventSchema.extend({
  extendedProperties: z.object({ private: z.record(z.string(), z.string()).optional() }).optional(),
});
type RemoteEvent = z.infer<typeof remoteSchema>;

interface Result {
  status: GoogleCalendarChangeStatus;
  reason: string | null;
  retryAfter?: number;
}

const sent: Result = { status: 'sent', reason: null };
const conflict: Result = { status: 'conflict', reason: 'remote_changed' };

async function claim(options: Options, id: string, remoteId: string) {
  const { connection, now, principal } = options;
  const token = uuidv7();
  const expiration = new Date(Date.parse(now) + 120_000).toISOString();
  return auditedTransaction(
    connection.db,
    principal,
    async (ctx) => {
      const lease = await sql`
      INSERT INTO google_calendar_write_leases (remote_calendar_id, token, expires_at)
      VALUES (${remoteId}, ${token}, ${expiration})
      ON CONFLICT (remote_calendar_id) DO UPDATE SET token = EXCLUDED.token, expires_at = EXCLUDED.expires_at
      WHERE google_calendar_write_leases.expires_at <= ${now}
      RETURNING token
    `.execute(ctx.tx);
      if (!lease.rows.length) {
        ctx.noChange();
        return undefined;
      }
      const result = await sql<GoogleCalendarChangeRow>`
      UPDATE google_calendar_changes SET status = 'sending', lock_token = ${token},
        next_attempt_at = ${expiration}, attempts = attempts + 1, updated_at = ${now}
      WHERE id = ${id} AND status IN ('pending', 'sending') AND next_attempt_at <= ${now}
      RETURNING *
    `.execute(ctx.tx);
      if (result.rows[0] === undefined) {
        await sql`DELETE FROM google_calendar_write_leases WHERE token = ${token}`.execute(ctx.tx);
        ctx.noChange();
        return undefined;
      }
      recordCalendarChange(ctx, id, 'updated');
      return result.rows[0];
    },
    { engine: connection.engine, now },
  );
}

async function sendChange(options: Options, change: GoogleCalendarChangeRow): Promise<Result> {
  const { connection, secret, config, provider } = options;
  const target = await findCalendarWriteTarget(connection.db, change.calendar_id, change.user_id);
  if (target === undefined) return { status: 'failed', reason: 'removed' };
  if (!isTrue(target.writable) || !isGoogleCalendarWritable(target.access_role))
    return { status: 'failed', reason: 'read_only' };
  if (target.oauth_status !== 'connected')
    return { status: 'pending', reason: 'reconnect_required', retryAfter: 300 };

  const token = await googleCalendarAccessToken(
    connection.db,
    secret,
    config,
    target.account_id,
    provider,
  );
  const collection = ['calendars', change.remote_calendar_id, 'events'];
  const resource = [...collection, change.remote_event_id];
  const { draft, notify_guests, fields } = calendarChangeInput(change);
  const marker = { femho_change: change.id };
  const currentEvent = async (): Promise<RemoteEvent | undefined> => {
    try {
      const result = remoteSchema.safeParse(
        await provider.request(token, resource, { method: 'GET' }),
      );
      if (!result.success) throw new GoogleCalendarError('invalid_response');
      return result.data;
    } catch (error) {
      if (error instanceof GoogleCalendarError && [404, 410].includes(error.status))
        return undefined;
      throw error;
    }
  };
  const details =
    draft === undefined
      ? {}
      : {
          summary: draft.summary,
          description: draft.description,
          location: draft.location,
          start: draft.all_day
            ? { date: draft.starts_at.slice(0, 10) }
            : { dateTime: draft.starts_at, timeZone: draft.timezone },
          end: draft.all_day
            ? { date: draft.ends_at.slice(0, 10) }
            : { dateTime: draft.ends_at, timeZone: draft.timezone },
        };
  const patch =
    fields === undefined
      ? details
      : Object.fromEntries(
          Object.entries(details).filter(([key]) =>
            fields.includes(key as (typeof fields)[number]),
          ),
        );

  if (change.operation === 'create') {
    try {
      await provider.request(token, collection, {
        method: 'POST',
        query: { sendUpdates: 'none' },
        body: { ...details, id: change.remote_event_id, extendedProperties: { private: marker } },
      });
      return sent;
    } catch (error) {
      if (!(error instanceof GoogleCalendarError) || error.status !== 409) throw error;
      const remote = await currentEvent();
      return remote?.extendedProperties?.private?.femho_change === change.id ? sent : conflict;
    }
  }

  const remote = await currentEvent();
  if (remote === undefined || remote.status === 'cancelled')
    return change.operation === 'delete' ? sent : conflict;
  if (remote.extendedProperties?.private?.femho_change === change.id) return sent;
  if (!remote.etag || (change.base_etag !== null && remote.etag !== change.base_etag))
    return conflict;
  if (
    !googleEventWritable(remote) ||
    (target.access_role === 'writerWithoutPrivateAccess' && isGoogleEventPrivate(remote))
  )
    return { status: 'failed', reason: 'read_only' };
  const guests = googleEventHasGuests(remote);
  if (guests && !notify_guests) return { status: 'failed', reason: 'guests_confirmation_required' };
  const query = { sendUpdates: guests ? 'all' : 'none' };
  if (change.operation === 'delete' && remote.recurringEventId === undefined) {
    await provider.request(token, resource, { method: 'DELETE', etag: remote.etag, query });
  } else {
    await provider.request(token, resource, {
      method: 'PATCH',
      etag: remote.etag,
      query: { ...query, supportsAttachments: 'true', conferenceDataVersion: '1' },
      body: {
        ...(change.operation === 'delete' ? { status: 'cancelled' } : patch),
        extendedProperties: { private: { ...remote.extendedProperties?.private, ...marker } },
      },
    });
  }
  return sent;
}

async function finish(options: Options, change: GoogleCalendarChangeRow, result: Result) {
  const { connection, now, principal } = options;
  const due = new Date(Date.parse(now) + (result.retryAfter ?? 0) * 1000).toISOString();
  await auditedTransaction(
    connection.db,
    principal,
    async (ctx) => {
      const locked = await sql`
      DELETE FROM google_calendar_write_leases WHERE remote_calendar_id = ${change.remote_calendar_id}
        AND token = ${change.lock_token} RETURNING token
    `.execute(ctx.tx);
      if (!locked.rows.length) {
        ctx.noChange();
        return;
      }
      await sql`
      UPDATE google_calendar_changes SET status = ${result.status}, error_code = ${result.reason},
        lock_token = NULL, next_attempt_at = ${due}, updated_at = ${now}
      WHERE id = ${change.id} AND lock_token = ${change.lock_token}
    `.execute(ctx.tx);
      if (result.status === 'sent' || result.status === 'conflict') {
        // Cada vinculació torna a llegir amb els seus permisos. El pany de lectura
        // impedeix que una resposta obtinguda abans de l'escriptura substitueixi el resultat.
        await sql`
        UPDATE google_calendar_links SET pull_lock = NULL, pull_lock_until = NULL
        WHERE remote_calendar_id = ${change.remote_calendar_id} AND deleted_at IS NULL
      `.execute(ctx.tx);
        await sql`
        UPDATE calendars SET last_refreshed_at = NULL, last_error_at = NULL WHERE id IN (
          SELECT calendar_id FROM google_calendar_links
          WHERE remote_calendar_id = ${change.remote_calendar_id} AND deleted_at IS NULL
        )
      `.execute(ctx.tx);
      }
      recordCalendarChange(ctx, change.id, 'updated', { from: 'sending', to: result.status });
    },
    { engine: connection.engine, now },
  );
}

export async function runGoogleCalendarChanges(options: Options): Promise<void> {
  if (!options.config.enabled) return;
  const { rows } = await sql<{ id: string; remote_calendar_id: string }>`
    SELECT id, remote_calendar_id FROM google_calendar_changes
    WHERE status IN ('pending', 'sending') AND next_attempt_at <= ${options.now}
    ORDER BY next_attempt_at, created_at, id LIMIT 20
  `.execute(options.connection.db);
  for (const candidate of rows) {
    const change = await claim(options, candidate.id, candidate.remote_calendar_id);
    if (change === undefined) continue;
    let result: Result;
    try {
      result = await sendChange(options, change);
    } catch (error) {
      const code = error instanceof GoogleCalendarError ? error.code : 'provider_unavailable';
      const status = error instanceof GoogleCalendarError ? error.status : 503;
      if (status === 412) result = conflict;
      else if (status === 401 || code === 'reconnect_required') {
        result = { status: 'pending', reason: 'reconnect_required', retryAfter: 300 };
      } else if (
        status === 429 ||
        status >= 500 ||
        code === 'rate_limited' ||
        code === 'provider_unavailable'
      ) {
        result = {
          status: 'pending',
          reason: 'provider_unavailable',
          retryAfter: Math.min(3600, 30 * 2 ** Number(change.attempts)),
        };
      } else if (status === 404 || status === 410) result = conflict;
      else
        result = { status: 'failed', reason: status === 403 ? 'read_only' : 'provider_rejected' };
    }
    await finish(options, change, result);
  }
}
