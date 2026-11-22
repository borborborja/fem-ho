import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { hashPassword } from '../auth/password.js';
import { connect, type Connection } from '../db/connection.js';
import { migrateToLatest } from '../db/migrator.js';
import { connectTestSchema, type TestSchema } from '../db/test-postgres.js';
import { open, seal } from '../crypto/secret-box.js';
import {
  GoogleOAuthError,
  type GoogleMailProvider,
  type GoogleTokens,
  type MailTransport,
} from '../net/google-oauth.js';
import { mailCredentials } from '../services/mail-credentials.js';
import { pruneMailOAuth } from '../services/mail-oauth.js';

const tmp = mkdtempSync(join(tmpdir(), 'femho-oauth-'));
const secret = 'test-instance-secret-'.repeat(3);
const password = 'test-login-password';
let conn: Connection;
const pgUrl = process.env.FEMHO_TEST_POSTGRES_URL;
let pgSchema: TestSchema | undefined;
let app: FastifyInstance;
let auth: { authorization: string };
let otherAuth: { authorization: string };
let userId: string;
let emailIndex = 0;
const exchange = vi.fn<GoogleMailProvider['exchange']>();
const refresh = vi.fn<(token: string) => Promise<GoogleTokens>>();
const provider = {
  authorizationUrl: (state: string, challenge: string, nonce: string) =>
    `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({ state, challenge, nonce })}`,
  exchange,
  refresh,
};
const config = () => ({ ...loadConfig('test'), logLevel: 'silent' as const });
const api = (
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload?: Record<string, unknown>,
  who = auth,
) => app.inject({ method, url: `/api/v1${url}`, headers: who, ...(payload ? { payload } : {}) });
type Attempt = {
  id: string;
  account_id: string;
  authorization_url: string;
  status: string;
  error_code: string | null;
  transport: MailTransport;
};

beforeAll(async () => {
  for (const key of Object.keys(process.env)) if (key.startsWith('FEMHO_')) delete process.env[key];
  pgSchema = pgUrl ? await connectTestSchema(pgUrl, 'mail_oauth') : undefined;
  conn = pgSchema ?? connect(`sqlite://${join(tmp, 'oauth.db')}`);
  await migrateToLatest(conn.db, { engine: conn.engine });
  const hash = await hashPassword(password);
  for (const email of ['owner@example.test', 'other@example.test']) {
    const id = uuidv7();
    if (email.startsWith('owner')) userId = id;
    const now = new Date().toISOString();
    await sql`INSERT INTO users (id,email,name,password_hash,kind,role,created_at,updated_at)
      VALUES (${id},${email},${email},${hash},'human','admin',${now},${now})`.execute(conn.db);
  }
  app = buildApp(config(), { connection: conn, secret, googleMailProvider: provider });
  const login = async (email: string) => {
    const result = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password },
    });
    return { authorization: `Bearer ${result.json<{ access_token: string }>().access_token}` };
  };
  auth = await login('owner@example.test');
  otherAuth = await login('other@example.test');
});
afterAll(async () => {
  await app.close();
  if (pgSchema) await pgSchema.drop();
  else await conn.close();
  rmSync(tmp, { recursive: true, force: true });
});

async function start(
  accountId = uuidv7(),
  reconnect = false,
  transport?: MailTransport,
): Promise<Attempt> {
  const result = await api('POST', '/mail/oauth/google', {
    account_id: accountId,
    reconnect,
    transport,
  });
  expect(result.statusCode, result.body).toBe(200);
  return result.json<Attempt>();
}
function tokens(email = `mail${++emailIndex}@example.test`): GoogleTokens {
  return {
    access_token: 'access-token-private',
    refresh_token: 'refresh-token-private',
    expires_at: Date.now() + 3600_000,
    subject: email,
    email,
  };
}
async function callback(attempt: Attempt, value = tokens()) {
  exchange.mockResolvedValueOnce(value);
  const state = new URL(attempt.authorization_url).searchParams.get('state')!;
  const response = await api(
    'GET',
    `/mail/oauth/google/callback?${new URLSearchParams({ state, code: 'private-auth-code' })}`,
    undefined,
    { authorization: '' },
  );
  expect(response.statusCode).toBe(303);
  expect(response.headers.location).toBe('/settings?tab=mail');
  expect(response.body).not.toContain('private-auth-code');
}
const confirm = (attempt: Attempt) => api('POST', `/mail/oauth/attempts/${attempt.id}/confirm`, {});
async function connected() {
  const attempt = await start();
  await callback(attempt);
  expect((await confirm(attempt)).statusCode).toBe(200);
  return attempt.account_id;
}
async function expireToken(id: string) {
  const row = (
    await sql<{
      secret_enc: string;
    }>`SELECT secret_enc FROM mail_accounts WHERE id = ${id}`.execute(conn.db)
  ).rows[0]!;
  const value = JSON.parse(open(secret, `mail_oauth:${id}`, row.secret_enc)) as GoogleTokens;
  value.expires_at = 0;
  await sql`UPDATE mail_accounts SET secret_enc = ${seal(secret, `mail_oauth:${id}`, JSON.stringify(value))} WHERE id = ${id}`.execute(
    conn.db,
  );
}

it('requires authentication and keeps attempts private, even from other admins', async () => {
  expect(
    (await api('POST', '/mail/oauth/google', { account_id: uuidv7() }, { authorization: '' }))
      .statusCode,
  ).toBe(401);
  const attempt = await start();
  expect(
    (await api('GET', `/mail/oauth/attempts/${attempt.id}`, undefined, otherAuth)).statusCode,
  ).toBe(404);
  expect(
    (await api('POST', `/mail/oauth/attempts/${attempt.id}/confirm`, {}, otherAuth)).statusCode,
  ).toBe(404);
  expect(
    (await api('DELETE', `/mail/oauth/attempts/${attempt.id}`, undefined, otherAuth)).statusCode,
  ).toBe(404);
  await api('DELETE', `/mail/oauth/attempts/${attempt.id}`);
});

it('uses single-use state and requires explicit confirmation before creating an account', async () => {
  const attempt = await start();
  expect((await confirm(attempt)).statusCode).toBe(409);
  const before = exchange.mock.calls.length;
  await api('GET', '/mail/oauth/google/callback?state=wrong&code=bad');
  expect(exchange.mock.calls.length).toBe(before);
  await callback(attempt);
  expect((await api('GET', `/mail/oauth/attempts/${attempt.id}`)).json<Attempt>().status).toBe(
    'ready',
  );
  expect((await api('GET', '/mail/accounts')).body).not.toContain(attempt.account_id);
  const state = new URL(attempt.authorization_url).searchParams.get('state')!;
  await api('GET', `/mail/oauth/google/callback?state=${state}&code=replay`);
  expect(exchange.mock.calls.length).toBe(before + 1);
  const confirmed = await confirm(attempt);
  expect(confirmed.statusCode, confirmed.body).toBe(200);
  expect(confirmed.json()).toMatchObject({
    id: attempt.account_id,
    auth_method: 'google',
    transport: 'gmail_api',
    oauth_status: 'connected',
    has_secret: true,
  });
  expect((await confirm(attempt)).statusCode).toBe(200);
  const rows = await sql<{
    secret_enc: string;
  }>`SELECT secret_enc FROM mail_accounts WHERE id = ${attempt.account_id}`.execute(conn.db);
  expect(rows.rows[0]!.secret_enc).not.toContain('access-token-private');
  const audit = await sql`SELECT * FROM activity_log`.execute(conn.db);
  for (const output of [
    confirmed.body,
    (await api('GET', '/mail/accounts')).body,
    JSON.stringify(audit.rows),
  ]) {
    expect(output).not.toContain('access-token-private');
    expect(output).not.toContain('refresh-token-private');
  }
  const temp = (
    await sql<{
      result_enc: string | null;
      verifier_enc: string | null;
    }>`SELECT result_enc,verifier_enc FROM mail_oauth_attempts WHERE id = ${attempt.id}`.execute(
      conn.db,
    )
  ).rows[0];
  expect(temp).toEqual({ result_enc: null, verifier_enc: null });
  expect(
    await mailCredentials(conn.db, secret, config(), attempt.account_id, userId, provider),
  ).toEqual({
    accessToken: 'access-token-private',
  });
});

it('converts password Gmail in place and preserves rule cursors', async () => {
  const email = 'legacy@example.test';
  const account = (
    await api('POST', '/mail/accounts', {
      host: 'imap.gmail.com',
      username: email,
      name: 'Legacy',
      password: 'app-password',
    })
  ).json<{ id: string }>();
  const scope = (
    await api('POST', '/scopes', { name: 'Mail', kind: 'individual', color: '--plou-blue' })
  ).json<{ id: string }>();
  const rule = await api('POST', '/mail/rules', {
    account_id: account.id,
    scope_id: scope.id,
    folder: 'INBOX',
  });
  expect(rule.statusCode, rule.body).toBe(201);
  const ruleId = rule.json<{ id: string }>().id;
  await sql`UPDATE mail_rules SET uid_validity = '77', last_uid = '123' WHERE id = ${ruleId}`.execute(
    conn.db,
  );
  const attempt = await start(account.id, true);
  await callback(attempt, tokens(email));
  expect((await confirm(attempt)).json()).toMatchObject({
    id: account.id,
    name: 'Legacy',
    auth_method: 'google',
    transport: 'imap',
  });
  expect(
    (await sql`SELECT uid_validity,last_uid FROM mail_rules WHERE id = ${ruleId}`.execute(conn.db))
      .rows[0],
  ).toEqual({ uid_validity: '77', last_uid: '123' });
  expect(
    (await api('PATCH', `/mail/accounts/${account.id}`, { password: 'overwrite' })).statusCode,
  ).toBe(422);
  const wrong = await start(account.id, true);
  await callback(wrong, tokens('wrong@example.test'));
  expect((await api('GET', `/mail/oauth/attempts/${wrong.id}`)).json<Attempt>().error_code).toBe(
    'identity_mismatch',
  );
});

it('cancels consent, discards missing refresh credentials, and expires temporary secrets', async () => {
  const cancelled = await start();
  await api('DELETE', `/mail/oauth/attempts/${cancelled.id}`);
  const state = new URL(cancelled.authorization_url).searchParams.get('state')!;
  const before = exchange.mock.calls.length;
  await api('GET', `/mail/oauth/google/callback?state=${state}&code=late`);
  expect(exchange.mock.calls.length).toBe(before);
  expect((await confirm(cancelled)).statusCode).toBe(409);
  const missing = await start();
  await callback(missing, { ...tokens(), refresh_token: undefined });
  expect((await api('GET', `/mail/oauth/attempts/${missing.id}`)).json<Attempt>().error_code).toBe(
    'missing_refresh_token',
  );
  const expired = await start();
  await callback(expired);
  await sql`UPDATE mail_oauth_attempts SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ${expired.id}`.execute(
    conn.db,
  );
  expect((await confirm(expired)).statusCode).toBe(409);
  await pruneMailOAuth(conn.db, new Date().toISOString());
  expect(
    (await sql`SELECT id FROM mail_oauth_attempts WHERE id = ${expired.id}`.execute(conn.db)).rows,
  ).toHaveLength(0);
});

it('refreshes concurrently only once and persists the replacement for a new connection', async () => {
  const id = await connected();
  await expireToken(id);
  const before = refresh.mock.calls.length;
  refresh.mockImplementationOnce(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
    return { access_token: 'new-access', expires_at: Date.now() + 3600_000 };
  });
  const second = connect(
    conn.engine === 'postgres' ? conn.target.target : `sqlite://${join(tmp, 'oauth.db')}`,
  );
  try {
    const results = await Promise.all(
      [conn, second].map((c) => mailCredentials(c.db, secret, config(), id, userId, provider)),
    );
    expect(results).toEqual([{ accessToken: 'new-access' }, { accessToken: 'new-access' }]);
    expect(refresh.mock.calls.length).toBe(before + 1);
    const row = (
      await sql<{
        secret_enc: string;
      }>`SELECT secret_enc FROM mail_accounts WHERE id = ${id}`.execute(second.db)
    ).rows[0]!;
    expect(JSON.parse(open(secret, `mail_oauth:${id}`, row.secret_enc))).toMatchObject({
      refresh_token: 'refresh-token-private',
      access_token: 'new-access',
    });
  } finally {
    await second.close();
  }
});

it('marks revoked grants for reconnection and never revives a disconnected account during refresh', async () => {
  const id = await connected();
  await expireToken(id);
  refresh.mockRejectedValueOnce(new GoogleOAuthError('reconnect_required'));
  await expect(mailCredentials(conn.db, secret, config(), id, userId, provider)).rejects.toThrow(
    'reconnect_required',
  );
  expect(
    (await sql`SELECT oauth_status FROM mail_accounts WHERE id = ${id}`.execute(conn.db)).rows[0],
  ).toEqual({ oauth_status: 'reconnect_required' });
  const active = await connected();
  await expireToken(active);
  let release!: (value: GoogleTokens) => void;
  let started!: () => void;
  const startedPromise = new Promise<void>((resolve) => {
    started = resolve;
  });
  refresh.mockImplementationOnce(() => {
    started();
    return new Promise((resolve) => {
      release = resolve;
    });
  });
  const work = mailCredentials(conn.db, secret, config(), active, userId, provider);
  const checked = expect(work).rejects.toThrow('reconnect_required');
  await startedPromise;
  expect(
    (await api('POST', `/mail/accounts/${active}/oauth/disconnect`, {}, otherAuth)).statusCode,
  ).toBe(404);
  expect((await api('POST', `/mail/accounts/${active}/oauth/disconnect`, {})).statusCode).toBe(204);
  release(tokens());
  await checked;
  expect(
    (
      await sql`SELECT secret_enc,oauth_status FROM mail_accounts WHERE id = ${active}`.execute(
        conn.db,
      )
    ).rows[0],
  ).toEqual({ secret_enc: null, oauth_status: 'disconnected' });
});

it('keeps ordinary password IMAP available', async () => {
  const account = (
    await api('POST', '/mail/accounts', {
      host: 'imap.example.test',
      username: 'me',
      name: 'IMAP',
      password: 'imap-password',
    })
  ).json<{ id: string }>();
  expect(await mailCredentials(conn.db, secret, config(), account.id, userId)).toEqual({
    password: 'imap-password',
  });
});

it('requires reconnection after a Google client changes even before a cached token expires', async () => {
  const id = await connected();
  const saved = { ...tokens(), client_id: 'old-client.apps.googleusercontent.com' };
  await sql`UPDATE mail_accounts SET secret_enc = ${seal(secret, `mail_oauth:${id}`, JSON.stringify(saved))}
    WHERE id = ${id}`.execute(conn.db);
  const configured = {
    ...config(),
    baseUrl: 'https://femho.example.test',
    googleClientId: 'new-client.apps.googleusercontent.com',
    googleClientSecret: 'new-secret',
  };
  await expect(mailCredentials(conn.db, secret, configured, id, userId)).rejects.toThrow(
    'reconnect_required',
  );
  expect((await api('GET', '/mail/accounts')).json()).toEqual(
    expect.arrayContaining([expect.objectContaining({ id, oauth_status: 'reconnect_required' })]),
  );
});

it('switches legacy Gmail atomically and preserves the rule destinations', async () => {
  const email = 'switch-gmail@example.test';
  const account = (
    await api('POST', '/mail/accounts', {
      host: 'imap.gmail.com',
      username: email,
      name: 'Switch',
      password: 'app-password',
    })
  ).json<{ id: string }>();
  const scope = (
    await api('POST', '/scopes', { name: 'Switch', kind: 'individual', color: '--plou-blue' })
  ).json<{ id: string }>();
  const rule = (
    await api('POST', '/mail/rules', {
      account_id: account.id,
      scope_id: scope.id,
      folder: 'Feina',
    })
  ).json<{ id: string }>();
  const unmapped = (
    await api('POST', '/mail/rules', {
      account_id: account.id,
      scope_id: scope.id,
      folder: 'Carpeta antiga',
      title_template: '{{from_name}} - {{subject}}',
    })
  ).json<{ id: string }>();
  const attempt = await start(account.id, true, 'gmail_api');
  await callback(attempt, tokens(email));

  const fetchMock = vi.fn().mockImplementation(async () =>
    Response.json({
      labels: [
        { id: 'Label_11', name: 'Feina' },
        { id: 'Label_12', name: 'Feina nova' },
      ],
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  try {
    const confirmed = await confirm(attempt);
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmed.json()).toMatchObject({ id: account.id, transport: 'gmail_api' });
    expect((await api('GET', '/mail/rules')).json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: rule.id,
          scope_id: scope.id,
          gmail_label_id: 'Label_11',
          enabled: true,
        }),
        expect.objectContaining({
          id: unmapped.id,
          scope_id: scope.id,
          folder: 'Carpeta antiga',
          title_template: '{{from_name}} - {{subject}}',
          gmail_label_id: null,
          enabled: false,
          last_error: 'gmail-label-required',
        }),
      ]),
    );
    const rulePath = `/mail/rules/${unmapped.id}`;
    expect((await api('PATCH', rulePath, { enabled: true })).statusCode).toBe(422);
    const repairs = await api('PATCH', rulePath, { gmail_label_id: 'Label_12' });
    expect(repairs.statusCode, repairs.body).toBe(200);
    expect(repairs.json()).toMatchObject({
      id: unmapped.id,
      gmail_label_id: 'Label_12',
      enabled: false,
      last_error: null,
    });
    expect((await api('PATCH', rulePath, { enabled: true })).json()).toMatchObject({
      id: unmapped.id,
      gmail_label_id: 'Label_12',
      enabled: true,
    });
  } finally {
    vi.unstubAllGlobals();
  }
});

it('connects two Gmail API mailboxes and routes their INBOX labels independently', async () => {
  const fetchMock = vi.fn<(url: URL, init: RequestInit) => Promise<Response>>();
  fetchMock.mockImplementation(async (url, init) => {
    expect(url.origin).toBe('https://gmail.googleapis.com');
    expect(url.pathname).toBe('/gmail/v1/users/me/labels');
    expect(init.method).toBe('GET');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer access-token-private' });
    return Response.json({ labels: [{ id: 'INBOX', name: 'INBOX' }] });
  });
  vi.stubGlobal('fetch', fetchMock);
  try {
    const rules = [];
    for (const name of ['Feina Gmail', 'Personal Gmail']) {
      const attempt = await start();
      await callback(attempt);
      expect(attempt.transport).toBe('gmail_api');
      expect((await confirm(attempt)).statusCode).toBe(200);
      const scope = await api('POST', '/scopes', {
        name,
        kind: 'individual',
        color: '--plou-blue',
      });
      expect(scope.statusCode).toBe(201);
      const accountId = attempt.account_id;
      const scopeId = scope.json<{ id: string }>().id;
      const folders = await api('GET', `/mail/accounts/${accountId}/folders`);
      expect(folders.json()).toMatchObject({
        folders: ['INBOX'],
        labels: [{ id: 'INBOX', name: 'INBOX' }],
      });
      const rule = await api('POST', '/mail/rules', {
        account_id: accountId,
        scope_id: scopeId,
        gmail_label_id: 'INBOX',
      });
      expect(rule.statusCode, rule.body).toBe(201);
      expect(rule.json()).toMatchObject({
        account_id: accountId,
        scope_id: scopeId,
        gmail_label_id: 'INBOX',
      });
      rules.push(rule.json<{ id: string }>().id);
    }
    expect(rules[0]).not.toBe(rules[1]);
  } finally {
    vi.unstubAllGlobals();
  }
});

it('hides unavailable Google setup but still lets owners cancel saved attempts', async () => {
  const attempt = await start();
  const withoutGoogle = buildApp(config(), { connection: conn, secret });
  try {
    const availability = await withoutGoogle.inject({
      method: 'GET',
      url: '/api/v1/mail/oauth/google',
      headers: auth,
    });
    expect(availability.json()).toEqual({ enabled: false });
    const startResult = await withoutGoogle.inject({
      method: 'POST',
      url: '/api/v1/mail/oauth/google',
      headers: auth,
      payload: { account_id: uuidv7() },
    });
    expect(startResult.statusCode).toBe(503);
    expect(
      (
        await withoutGoogle.inject({
          method: 'DELETE',
          url: `/api/v1/mail/oauth/attempts/${attempt.id}`,
          headers: auth,
        })
      ).statusCode,
    ).toBe(204);
  } finally {
    await withoutGoogle.close();
  }
});
