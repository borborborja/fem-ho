import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { hashPassword } from '../auth/password.js';
import { loadConfig } from '../config.js';
import { seal } from '../crypto/secret-box.js';
import { dbBool } from '../db/bool.js';
import { connect, type Connection } from '../db/connection.js';
import { migrateToLatest } from '../db/migrator.js';
import { connectTestSchema, type TestSchema } from '../db/test-postgres.js';
import { runGoogleCalendarChanges } from '../jobs/google-calendar-changes.js';
import { GoogleCalendarError, type GoogleCalendarProvider } from '../net/google-calendar.js';
import type { Principal } from '../policy/principal.js';
import { resolveGoogleConfig } from '../services/google-config.js';

const secret = 'test-google-calendar-write-queue-secret';
const config = {
  ...loadConfig('test'),
  baseUrl: 'https://instance.example.test',
  googleClientId: 'google-client',
  googleClientSecret: 'test-only',
  logLevel: 'silent',
};
const request = vi.fn<GoogleCalendarProvider['request']>();
const provider: GoogleCalendarProvider = {
  request,
  authorizationUrl: vi.fn(),
  exchange: vi.fn(),
  refresh: vi.fn(),
  listCalendars: vi.fn(),
  listEvents: vi.fn(),
};
const principal: Principal = {
  kind: 'user',
  userId: '',
  capabilities: new Set(),
  scopeIds: null,
  source: 'system',
};
const userId = uuidv7();
const calendarId = uuidv7();
const scopeId = uuidv7();
const accountId = uuidv7();
let connection: Connection;
let pg: TestSchema | undefined;
let app: FastifyInstance;
let authorization: string;

beforeAll(async () => {
  const url = process.env.FEMHO_TEST_POSTGRES_URL;
  pg = url ? await connectTestSchema(url, 'google_calendar_changes') : undefined;
  connection = pg ?? connect('sqlite::memory:');
  const { db, engine } = connection;
  await migrateToLatest(db, { engine });
  app = buildApp(config, { connection, secret, googleCalendarProvider: provider });
  const now = new Date().toISOString();
  const password = 'test-login-password';
  const encrypted = seal(
    secret,
    `google_calendar_oauth:${accountId}`,
    JSON.stringify({
      access_token: 'test-only-access',
      refresh_token: 'test-only-refresh',
      expires_at: Date.now() + 86400_000,
    }),
  );
  await sql`INSERT INTO users (id, email, name, password_hash, kind, role, created_at, updated_at)
    VALUES (${userId}, 'owner@example.test', 'Owner', ${await hashPassword(password)}, 'human',
      'member', ${now}, ${now})`.execute(db);
  await sql`INSERT INTO scopes (id, owner_id, name, color, kind, position, created_at, updated_at)
    VALUES (${scopeId}, ${userId}, 'Feina', '--plou-blue', 'individual', 'a0', ${now}, ${now})`.execute(
    db,
  );
  await sql`INSERT INTO google_calendar_accounts
      (id, user_id, google_subject, email, client_id, secret_enc, oauth_status, created_at, updated_at)
    VALUES (${accountId}, ${userId}, 'verified', 'owner@example.test', ${config.googleClientId}, ${encrypted},
      'connected', ${now}, ${now})`.execute(db);
  await sql`INSERT INTO calendars
      (id, scope_id, name, kind, origin, source_provider, writable, created_at, updated_at)
    VALUES (${calendarId}, ${scopeId}, 'Agenda', 'events', 'subscription', 'google', ${dbBool(true)},
      ${now}, ${now})`.execute(db);
  await sql`INSERT INTO google_calendar_links
      (calendar_id, scope_id, account_id, remote_calendar_id, access_role, write_enabled)
    VALUES (${calendarId}, ${scopeId}, ${accountId}, 'external-calendar', 'owner', ${dbBool(true)})`.execute(
    db,
  );
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: 'owner@example.test', password },
  });
  expect(login.statusCode, login.body).toBe(200);
  authorization = `Bearer ${login.json<{ access_token: string }>().access_token}`;
});

beforeEach(() => request.mockReset());

afterAll(async () => {
  await app?.close();
  if (pg) await pg.drop();
  else await connection?.close();
});

const date = {
  starts_at: '2026-11-23T00:00:00.000Z',
  ends_at: '2026-11-25T00:00:00.000Z',
  all_day: true,
  timezone: 'Europe/Madrid',
};
const draft = { calendar_id: calendarId, summary: 'Cita', description: '', location: '', ...date };
const changesPath = '/api/v1/calendars/google/changes';

async function batch(
  op: 'create' | 'update' | 'delete',
  id: string,
  data: unknown,
  opId = uuidv7(),
) {
  const result = await app.inject({
    method: 'POST',
    url: '/api/v1/sync/batch',
    headers: { authorization },
    payload: {
      operations: [{ op_id: opId, entity: 'google_calendar_event', op, id, data, base_version: 1 }],
    },
  });
  expect(result.statusCode, result.body).toBe(200);
  return result.json<{ results: Array<{ status: string; entity?: { id: string } }> }>().results[0];
}

async function tick(seconds = 0) {
  await runGoogleCalendarChanges({
    connection,
    secret,
    principal,
    provider,
    config: await resolveGoogleConfig(connection.db, secret, config),
    now: new Date(Date.now() + seconds * 1000).toISOString(),
  });
}

it('recupera una alta confirmada remotament encara que se n’hagi perdut la resposta', async () => {
  const event = uuidv7();
  const id = uuidv7();
  expect(await batch('create', event, draft, id)).toMatchObject({ status: 'ok', entity: { id } });
  expect(await batch('create', event, draft, id)).toMatchObject({ status: 'ok', entity: { id } });
  expect(request).not.toHaveBeenCalled();
  request.mockRejectedValueOnce(new GoogleCalendarError('provider_unavailable'));
  await tick();
  expect(request).toHaveBeenCalledWith(
    'test-only-access',
    ['calendars', 'external-calendar', 'events'],
    expect.objectContaining({
      method: 'POST',
      body: {
        summary: draft.summary,
        description: '',
        location: '',
        start: { date: '2026-11-23' },
        end: { date: '2026-11-25' },
        id: event.replaceAll('-', ''),
        extendedProperties: { private: { femho_change: id } },
      },
    }),
  );
  request.mockRejectedValueOnce(new GoogleCalendarError('already_exists', 409));
  request.mockResolvedValueOnce({
    id: event,
    extendedProperties: { private: { femho_change: id } },
  });
  await tick(120);
  const list = await app.inject({ method: 'GET', url: changesPath, headers: { authorization } });
  expect(list.json()).toEqual([expect.objectContaining({ id, status: 'sent' })]);
  const row = await sql<{ status: string; attempts: number }>`SELECT status, attempts
    FROM google_calendar_changes WHERE id = ${id}`.execute(connection.db);
  expect(row.rows[0]).toMatchObject({ status: 'sent', attempts: 2 });
  await sql`UPDATE google_calendar_links SET projected_at = ${new Date(Date.now() + 120_000).toISOString()}
    WHERE calendar_id = ${calendarId}`.execute(connection.db);
  expect(
    (await app.inject({ method: 'GET', url: changesPath, headers: { authorization } })).json(),
  ).toEqual([]);
});

it('conserva el canvi en conflicte, permet reaplicar-lo i cancel·la una sola ocurrència', async () => {
  const event = uuidv7();
  const now = new Date().toISOString();
  await sql`INSERT INTO events
      (id, calendar_id, uid, summary, starts_at, ends_at, all_day, recurrence_id, created_at, updated_at)
    VALUES (${event}, ${calendarId}, 'series', 'Cita', ${date.starts_at}, ${date.ends_at}, ${dbBool(true)},
      ${date.starts_at}, ${now}, ${now})`.execute(connection.db);
  await sql`INSERT INTO google_calendar_events
      (event_id, calendar_id, remote_event_id, remote_etag, writable, has_guests)
    VALUES (${event}, ${calendarId}, 'remote-occurrence', '"before"', ${dbBool(true)}, ${dbBool(true)})`.execute(
    connection.db,
  );
  expect((await batch('delete', event, { calendar_id: calendarId }))?.status).toBe('rejected');
  const id = uuidv7();
  const update = { ...draft, summary: 'La meva edició', notify_guests: true, fields: ['summary'] };
  expect((await batch('update', event, update, id))?.status).toBe('ok');
  const remote = {
    id: 'remote-occurrence',
    etag: '"after"',
    organizer: { self: true },
    recurringEventId: 'series',
    attendees: [{ self: false }],
  };
  request.mockResolvedValue(remote);
  await tick();
  expect(request.mock.calls.map((call) => call[2].method)).toEqual(['GET']);
  const current = await app.inject({ method: 'GET', url: changesPath, headers: { authorization } });
  expect(current.json()).toEqual([
    expect.objectContaining({
      status: 'conflict',
      draft: expect.objectContaining({ summary: update.summary }),
    }),
  ]);
  const retry = await app.inject({
    method: 'POST',
    url: `${changesPath}/${id}/retry`,
    headers: { authorization },
  });
  expect(retry.statusCode, retry.body).toBe(204);
  await tick();
  expect(request.mock.calls.at(-1)?.[2]).toMatchObject({
    method: 'PATCH',
    etag: '"after"',
    query: { sendUpdates: 'all' },
    body: { summary: update.summary, extendedProperties: { private: { femho_change: id } } },
  });
  expect(request.mock.calls.at(-1)?.[2].body).not.toHaveProperty('start');
  const cancel = uuidv7();
  expect(
    (await batch('delete', event, { calendar_id: calendarId, notify_guests: true }, cancel))
      ?.status,
  ).toBe('ok');
  request.mockResolvedValue({ ...remote, etag: '"before"' });
  await tick();
  expect(request.mock.calls.at(-1)).toMatchObject([
    'test-only-access',
    ['calendars', 'external-calendar', 'events', 'remote-occurrence'],
    { method: 'PATCH', body: { status: 'cancelled' } },
  ]);
  const discarded = uuidv7();
  await batch('create', uuidv7(), draft, discarded);
  const deleted = await app.inject({
    method: 'DELETE',
    url: `${changesPath}/${discarded}`,
    headers: { authorization },
  });
  expect(deleted.statusCode, deleted.body).toBe(204);
  const audited = await sql<{
    verb: string;
    changes: string;
  }>`SELECT verb, changes FROM activity_log
    WHERE entity_id IN (${id}, ${discarded})`.execute(connection.db);
  expect(audited.rows.map((row) => row.verb)).toContain('deleted');
  expect(JSON.stringify(audited.rows)).not.toContain(update.summary);
});
