import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { hashPassword } from '../auth/password.js';
import { loadConfig } from '../config.js';
import { connect, type Connection } from '../db/connection.js';
import { migrateToLatest } from '../db/migrator.js';
import { connectTestSchema, type TestSchema } from '../db/test-postgres.js';
import { runGoogleCalendarPulls } from '../jobs/google-calendar.js';
import {
  GoogleCalendarError,
  type GoogleCalendarProvider,
  type GoogleCalendarSnapshot,
} from '../net/google-calendar.js';

const temp = mkdtempSync(join(tmpdir(), 'femho-google-calendar-'));
const secret = 'test-instance-secret-google-calendar';
const base = '/calendars/google';
const config = {
  ...loadConfig('test'),
  baseUrl: 'https://femho.example.test',
  googleClientId: 'configured-client',
  googleClientSecret: 'configured-client-secret',
  logLevel: 'silent',
};
const exchange = vi.fn<GoogleCalendarProvider['exchange']>();
const listCalendars = vi.fn<GoogleCalendarProvider['listCalendars']>();
const listEvents = vi.fn<GoogleCalendarProvider['listEvents']>();
const provider: GoogleCalendarProvider = {
  authorizationUrl: (state, challenge, nonce) =>
    `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({ state, challenge, nonce })}`,
  exchange,
  refresh: vi.fn(),
  listCalendars,
  listEvents,
  request: vi.fn(),
};

let connection: Connection;
let pg: TestSchema | undefined;
let app: FastifyInstance;
let owner: { id: string; authorization: string };
let other: { id: string; authorization: string };

beforeAll(async () => {
  const url = process.env.FEMHO_TEST_POSTGRES_URL;
  pg = url ? await connectTestSchema(url, 'google_calendar') : undefined;
  connection = pg ?? connect(`sqlite://${join(temp, 'google-calendar.db')}`);
  await migrateToLatest(connection.db, { engine: connection.engine });
  app = buildApp(config, { connection, secret, googleCalendarProvider: provider });
  const password = 'test-login-password';
  const hash = await hashPassword(password);
  async function user(name: string) {
    const id = uuidv7();
    const now = new Date().toISOString();
    const email = `${name}@example.test`;
    await sql`INSERT INTO users (id, email, name, password_hash, kind, role, created_at, updated_at)
      VALUES (${id}, ${email}, ${name}, ${hash}, 'human', 'member', ${now}, ${now})`.execute(
      connection.db,
    );
    const logged = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password },
    });
    expect(logged.statusCode, logged.body).toBe(200);
    return { id, authorization: `Bearer ${logged.json<{ access_token: string }>().access_token}` };
  }
  owner = await user('owner');
  other = await user('other');
});

afterAll(async () => {
  await app?.close();
  if (pg) await pg.drop();
  else await connection?.close();
  rmSync(temp, { recursive: true, force: true });
});

function api(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  payload?: Record<string, unknown>,
  who = owner,
) {
  return app.inject({
    method,
    url: `/api/v1${path}`,
    headers: { authorization: who.authorization },
    ...(payload ? { payload } : {}),
  });
}

interface Attempt {
  id: string;
  account_id: string;
  authorization_url: string;
}

async function start(accountId?: string): Promise<Attempt> {
  const response = await api('POST', `${base}/oauth`, accountId ? { account_id: accountId } : {});
  expect(response.statusCode, response.body).toBe(200);
  return response.json<Attempt>();
}

async function sendCallback(attempt: Attempt, email: string) {
  exchange.mockResolvedValueOnce({
    email,
    subject: email,
    access_token: 'oauth-access-token-private',
    refresh_token: 'oauth-refresh-token-private',
    expires_at: Date.now() + 3600_000,
  });
  const state = new URL(attempt.authorization_url).searchParams.get('state')!;
  const callback = await app.inject({
    method: 'GET',
    url: `/api/v1${base}/oauth/callback?${new URLSearchParams({ state, code: 'provider-private-code' })}`,
  });
  expect(callback.statusCode).toBe(303);
  expect(callback.headers.location).toBe('/settings?tab=calendars');
  expect(callback.headers['cache-control']).toBe('no-store');
  expect(callback.body).not.toContain('provider-private-code');
}

async function connected(email: string) {
  const attempt = await start();
  await sendCallback(attempt, email);
  const result = await api('POST', `${base}/oauth/attempts/${attempt.id}/confirm`);
  expect(result.statusCode, result.body).toBe(200);
  expect(result.json()).toEqual({ id: attempt.account_id, email, oauth_status: 'connected' });
  return attempt;
}

async function scope(name: string, who = owner): Promise<string> {
  const response = await api('POST', '/scopes', { name, kind: 'collective' }, who);
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ id: string }>().id;
}

it('ofereix Google amb la configuració activa i aïlla els intents, comptes i credencials', async () => {
  expect((await api('GET', `${base}/oauth`)).json()).toEqual({ enabled: true });
  const pending = await start();
  expect(
    (await api('GET', `${base}/oauth/attempts/${pending.id}`, undefined, other)).statusCode,
  ).toBe(404);
  expect((await api('DELETE', `${base}/oauth/attempts/${pending.id}`)).statusCode).toBe(204);
  const first = await connected('personal@gmail.example');
  const second = await connected('feina@gmail.example');
  const wrong = await start(first.account_id);
  await sendCallback(wrong, 'altra-adreca@gmail.example');
  expect((await api('GET', `${base}/oauth/attempts/${wrong.id}`)).json()).toMatchObject({
    status: 'failed',
    error_code: 'identity_mismatch',
  });
  expect((await api('GET', `${base}/accounts`, undefined, other)).json()).toEqual([]);
  expect(
    (await api('GET', `${base}/accounts/${first.account_id}/calendars`, undefined, other))
      .statusCode,
  ).toBe(404);
  expect(
    (await api('POST', `${base}/accounts/${first.account_id}/disconnect`, undefined, other))
      .statusCode,
  ).toBe(404);
  expect((await api('POST', `${base}/accounts/${first.account_id}/disconnect`)).statusCode).toBe(
    204,
  );
  const accounts = await api('GET', `${base}/accounts`);
  expect(accounts.json()).toEqual([
    { id: second.account_id, email: 'feina@gmail.example', oauth_status: 'connected' },
    { id: first.account_id, email: 'personal@gmail.example', oauth_status: 'disconnected' },
  ]);
  expect(accounts.body).not.toContain('-token-private');

  const credentials = await sql<{ id: string; secret_enc: string | null }>`
    SELECT id, secret_enc FROM google_calendar_accounts`.execute(connection.db);
  expect(credentials.rows.find(({ id }) => id === first.account_id)?.secret_enc).toBeNull();
  expect(credentials.rows.find(({ id }) => id === second.account_id)?.secret_enc).not.toContain(
    'token-private',
  );
  const audit = await sql<{ verb: string; changes: string | null }>`SELECT verb, changes
    FROM activity_log WHERE entity_id IN (${pending.id}, ${first.id}, ${first.account_id})`.execute(
    connection.db,
  );
  expect(audit.rows.map((row) => row.verb)).toEqual(
    expect.arrayContaining(['created', 'updated', 'revoked']),
  );
  expect(JSON.stringify(audit.rows)).not.toContain('token-private');
  expect(JSON.stringify(audit.rows)).not.toContain('provider-private-code');
});

it('vincula un calendari a diversos àmbits i conserva identitat, privadesa i darrer refresc complet', async () => {
  const account = await connected('calendar@gmail.example');
  const firstScope = await scope('Equip');
  const secondScope = await scope('Personal');
  const foreignScope = await scope('Extern', other);
  await sql`INSERT INTO scope_members (id, scope_id, user_id, role, created_at)
    VALUES (${uuidv7()}, ${firstScope}, ${other.id}, 'collaborator', ${new Date().toISOString()})`.execute(
    connection.db,
  );
  const remote = 'calendar@example.test';
  listCalendars.mockResolvedValue([
    { id: remote, name: 'Agenda Google', access_role: 'owner', primary: true, writable: true },
  ]);
  const bind = (scopeId: string, id = uuidv7(), remoteId = remote) =>
    api('POST', `${base}/links`, {
      id,
      scope_id: scopeId,
      account_id: account.account_id,
      remote_calendar_id: remoteId,
    });
  expect((await bind(foreignScope)).statusCode).toBe(403);
  expect((await bind(firstScope, uuidv7(), 'unknown')).statusCode).toBe(404);
  const first = await bind(firstScope);
  expect(first.statusCode, first.body).toBe(201);
  expect(first.json()).toMatchObject({
    source_provider: 'google',
    source_kind: null,
    source_url: null,
    name: 'Agenda Google',
    scope_id: firstScope,
  });
  expect(first.body).not.toContain(remote);
  const firstId = first.json<{ id: string }>().id;
  const repeated = await bind(firstScope);
  expect(repeated.statusCode).toBe(200);
  expect(repeated.json<{ id: string }>().id).toBe(firstId);
  const [second, raced] = await Promise.all([bind(secondScope), bind(secondScope)]);
  expect([second.statusCode, raced.statusCode].sort()).toEqual([200, 201]);
  const secondId = second.json<{ id: string }>().id;
  expect(raced.json<{ id: string }>().id).toBe(secondId);
  expect(secondId).not.toBe(firstId);
  expect(
    (await api('PATCH', `/calendars/${firstId}`, { shared_with_scope: true })).statusCode,
  ).toBe(200);

  listEvents.mockResolvedValue({
    accessRole: 'owner',
    syncToken: 'first',
    events: [
      {
        id: 'google-instance',
        etag: '"revision-1"',
        summary: 'Cita moguda',
        description: 'Detall',
        location: 'Lloc',
        recurringEventId: 'google-series',
        originalStartTime: { dateTime: '2026-11-23T11:00:00+01:00' },
        start: { dateTime: '2026-11-23T12:00:00+01:00', timeZone: 'Europe/Madrid' },
        end: { dateTime: '2026-11-23T13:00:00+01:00' },
        attendees: [{ self: false }],
        organizer: { self: true },
      },
      {
        id: 'private-all-day',
        etag: '"private-etag"',
        summary: 'Cita privada',
        visibility: 'private',
        start: { date: '2026-11-23' },
        end: { date: '2026-11-24' },
      },
      {
        id: 'cancelled-instance',
        status: 'cancelled',
        recurringEventId: 'google-series',
        originalStartTime: { dateTime: '2026-11-24T11:00:00+01:00' },
      },
    ],
  });

  const refresh = (now: string) =>
    runGoogleCalendarPulls({ connection, secret, config, provider, now });
  expect(await refresh('2026-11-22T09:00:00.000Z')).toBe(2);
  const window = '/events?from=2026-11-23T00:00:00Z&to=2026-11-25T00:00:00Z';
  const happenings = (await api('GET', window)).json<
    { event_id: string; scope_id: string; summary: string }[]
  >();
  expect(happenings).toHaveLength(4);
  const inFirst = happenings.find(
    (item) => item.scope_id === firstScope && item.summary === 'Cita moguda',
  )!;
  const privateId = happenings.find(
    (item) => item.scope_id === firstScope && item.summary === 'Cita privada',
  )!.event_id;
  expect(inFirst).toMatchObject({
    recurrence_id: '2026-11-23T10:00:00.000Z',
    starts_at: '2026-11-23T11:00:00.000Z',
    timezone: 'Europe/Madrid',
    version: 1,
    description: 'Detall',
    google_can_edit: true,
    google_has_guests: true,
  });
  const shared = await api('GET', window, undefined, other);
  expect(shared.json()).toEqual([
    expect.objectContaining({ event_id: inFirst.event_id, google_can_edit: false }),
  ]);
  expect((await api('GET', `/events/${privateId}`, undefined, other)).statusCode).toBe(404);
  expect((await api('GET', `/events/${privateId}/attachments`, undefined, other)).statusCode).toBe(
    404,
  );
  expect((await api('GET', `/events/${privateId}/attachments`)).statusCode).toBe(200);
  expect(
    (
      await api(
        'POST',
        '/tasks',
        {
          scope_id: firstScope,
          title: 'Cita convertida',
          source_event: { calendar_id: firstId, uid: 'private-all-day' },
        },
        other,
      )
    ).statusCode,
  ).toBe(404);
  expect(
    (
      await api(
        'POST',
        '/inbox/events',
        { calendar_id: firstId, uid: 'private-all-day', visible: false },
        other,
      )
    ).statusCode,
  ).toBe(404);
  expect(
    (
      await api('POST', '/inbox/events', {
        calendar_id: firstId,
        uid: 'private-all-day',
        visible: false,
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (await api('PATCH', `/events/${inFirst.event_id}`, { summary: 'Canvi local' })).statusCode,
  ).toBe(403);
  expect((await api('GET', `/events/${privateId}`)).json()).toMatchObject({
    all_day: expect.anything(),
    starts_at: '2026-11-23T00:00:00.000Z',
    ends_at: '2026-11-24T00:00:00.000Z',
  });
  listEvents.mockResolvedValue({ accessRole: 'owner', events: [], syncToken: 'second' });
  expect(await refresh('2026-11-22T09:16:00.000Z')).toBe(2);
  expect(listEvents.mock.calls.at(-1)?.[4]).toBe('first');
  expect((await api('GET', window)).json()).toHaveLength(4);
  expect((await api('GET', `/events/${inFirst.event_id}`)).json()).toMatchObject({ version: 1 });

  listEvents.mockRejectedValue(new GoogleCalendarError('provider_unavailable'));
  expect(await refresh('2026-11-22T09:32:00.000Z')).toBe(0);
  expect((await api('GET', window)).json()).toHaveLength(4);
  listEvents.mockResolvedValue({
    accessRole: 'owner',
    events: [{ id: 'google-instance', status: 'cancelled' }],
    syncToken: 'third',
  });
  expect(await refresh('2026-11-22T09:36:00.000Z')).toBe(2);
  expect(listEvents.mock.calls.at(-1)?.[4]).toBe('second');
  expect((await api('GET', window)).json()).toHaveLength(2);

  listEvents.mockImplementation(async (_token, _remote, _min, _max, cursor) => {
    if (cursor !== undefined) throw new GoogleCalendarError('not_found', 410);
    return { accessRole: 'owner', events: [], syncToken: 'reset' };
  });
  expect(await refresh('2026-11-22T09:52:00.000Z')).toBe(2);
  expect(listEvents.mock.calls.slice(-2).map((call) => call[4])).toEqual(['third', undefined]);
  expect((await api('GET', window)).json()).toEqual([]);
  expect(await refresh('2026-11-23T09:52:00.000Z')).toBe(2);
  expect(listEvents.mock.calls.slice(-2).map((call) => call[4])).toEqual([undefined, undefined]);
  expect((await api('GET', window)).json()).toEqual([]);
  const audit = await sql<{ verb: string }>`SELECT verb FROM activity_log
    WHERE entity_id = ${firstId}`.execute(connection.db);
  expect(audit.rows.map(({ verb }) => verb)).toEqual(
    expect.arrayContaining(['created', 'refreshed']),
  );
  expect((await api('DELETE', `/calendars/${firstId}`)).statusCode).toBe(204);
  const replacement = await bind(firstScope);
  expect(replacement.statusCode).toBe(201);

  let notifyStarted!: () => void;
  let releaseSnapshot!: (value: GoogleCalendarSnapshot) => void;
  const started = new Promise<void>((resolve) => {
    notifyStarted = resolve;
  });
  const stale = new Promise<GoogleCalendarSnapshot>((resolve) => {
    releaseSnapshot = resolve;
  });
  listEvents.mockImplementationOnce(() => {
    notifyStarted();
    return stale;
  });
  const pendingPull = refresh('2026-11-23T09:53:00.000Z');
  await started;
  const replacementId = replacement.json<{ id: string }>().id;
  expect((await api('DELETE', `/calendars/${replacementId}`)).statusCode).toBe(204);
  releaseSnapshot({
    accessRole: 'owner',
    syncToken: 'stale',
    events: [{ id: 'late-result', etag: 'etag', start: { date: '2026-11-23' } }],
  });
  expect(await pendingPull).toBe(0);
  const leaked = await sql`SELECT id FROM events WHERE calendar_id = ${replacementId}`.execute(
    connection.db,
  );
  expect(leaked.rows).toEqual([]);
});
