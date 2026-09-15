import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { connect } from '../db/connection.js';
import { connectTestSchema, postgresUrl } from '../db/test-postgres.js';
import { migrateToLatest } from '../db/migrator.js';
import { hashPassword } from '../auth/password.js';
import { MCP_READ, MCP_WRITE } from '../services/mcp-oauth.js';

const tmp = mkdtempSync(join(tmpdir(), 'femho-external-'));
const pg = postgresUrl();
const pgConnection = pg ? await connectTestSchema(pg, 'external_access') : undefined;
const conn = pgConnection ?? connect(`sqlite://${join(tmp, 'test.db')}`);
const issuer = 'http://localhost:8080';
const resource = `${issuer}/mcp`;
const app = buildApp(
  { ...loadConfig('test'), baseUrl: issuer, registration: 'open', logLevel: 'silent' },
  { connection: conn },
);
const owner = uuidv7();
const other = uuidv7();
const personal = uuidv7();
const work = uuidv7();
const foreign = uuidv7();
const password = 'integration-test-password';
let session: string;
let address: string;
const auth = () => ({ authorization: `Bearer ${session}` });
const request = (
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  url: string,
  payload?: object,
  token = session,
) =>
  app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${token}` },
    ...(payload ? { payload } : {}),
  });

beforeAll(async () => {
  await migrateToLatest(conn.db, { engine: conn.engine });
  const now = new Date().toISOString();
  for (const [id, email] of [
    [owner, 'owner@example.com'],
    [other, 'other@example.com'],
  ]) {
    await sql`INSERT INTO users (id,email,name,password_hash,kind,role,created_at,updated_at) VALUES (${id!},${email!},'Test',${await hashPassword(password)},'human','member',${now},${now})`.execute(
      conn.db,
    );
  }
  for (const [id, name, user] of [
    [personal, 'Personal', owner],
    [work, 'Feina', owner],
    [foreign, 'Secret', other],
  ]) {
    await sql`INSERT INTO scopes (id,name,kind,color,owner_id,position,created_at,updated_at) VALUES (${id!},${name!},'individual','--plou-blue',${user!},'a1',${now},${now})`.execute(
      conn.db,
    );
  }
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: 'owner@example.com', password },
  });
  session = login.json().access_token;
  address = await app.listen({ host: '127.0.0.1', port: 0 });
});
beforeEach(async () => {
  expect(
    (await request('PATCH', '/api/v1/external-access', { api_enabled: true, mcp_enabled: true }))
      .statusCode,
  ).toBe(200);
});
afterAll(async () => {
  await app.close();
  if (pgConnection) await pgConnection.drop();
  else await conn.close();
  rmSync(tmp, { recursive: true, force: true });
});

async function token(capabilities = MCP_READ, scope_ids = [personal], channels = ['api', 'mcp']) {
  const response = await request('POST', '/api/v1/tokens', {
    name: 'Test client',
    capabilities,
    scope_ids,
    channels,
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json() as { token: string; summary: { id: string } };
}
async function oauth(write = false) {
  const registration = await app.inject({
    method: 'POST',
    url: '/oauth/register',
    payload: {
      client_name: 'Test MCP client',
      redirect_uris: ['http://127.0.0.1:8123/callback'],
      token_endpoint_auth_method: 'none',
    },
  });
  expect(registration.statusCode, registration.body).toBe(201);
  const client = registration.json().client_id as string;
  const verifier = randomBytes(32).toString('base64url');
  const query = new URLSearchParams({
    client_id: client,
    redirect_uri: 'http://127.0.0.1:8123/callback',
    resource,
    state: 'test-state',
    response_type: 'code',
    code_challenge_method: 'S256',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    scope: write ? 'femho:read femho:write' : 'femho:read',
  });
  const start = await app.inject({ method: 'GET', url: `/oauth/authorize?${query}` });
  expect(start.statusCode, start.body).toBe(302);
  const id = new URL(start.headers.location!).searchParams.get('request')!;
  return {
    client,
    verifier,
    query,
    id,
    exchange: (code: string, override: Record<string, unknown> = {}) =>
      app.inject({
        method: 'POST',
        url: '/oauth/token',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: client,
          code,
          redirect_uri: 'http://127.0.0.1:8123/callback',
          code_verifier: verifier,
          resource,
          ...(override as Record<string, string>),
        }).toString(),
      }),
  };
}

describe('permisos externs', () => {
  it('el compte nou neix amb API i MCP apagats', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { name: 'New user', email: 'new@example.com', password },
    });
    expect(res.statusCode, res.body).toBe(201);
    const state = await request(
      'GET',
      '/api/v1/external-access',
      undefined,
      res.json().access_token,
    );
    expect(state.json()).toMatchObject({ api_enabled: false, mcp_enabled: false });
  });
  it('limita lectures per àmbit i impedeix escriptures, canvis de perfil, sync i autoescalada', async () => {
    const t = await token();
    const own = await request('POST', '/api/v1/tasks', {
      title: 'Inbox personal',
      scope_id: personal,
    });
    const outside = await request('POST', '/api/v1/tasks', {
      title: 'Feina privada',
      scope_id: work,
    });
    expect(
      (await request('GET', `/api/v1/tasks/${own.json().id}`, undefined, t.token)).statusCode,
    ).toBe(200);
    const denied = await request('GET', `/api/v1/tasks/${outside.json().id}`, undefined, t.token);
    expect([403, 404]).toContain(denied.statusCode);
    expect(denied.body).not.toContain('Feina privada');
    const scopes = await request('GET', '/api/v1/scopes', undefined, t.token);
    expect(scopes.body).toContain(personal);
    expect(scopes.body).not.toContain(work);
    for (const [method, path, body] of [
      ['POST', '/api/v1/tasks', { title: 'No', scope_id: personal }],
      ['PATCH', '/api/v1/auth/me', { name: 'No' }],
      ['PATCH', '/api/v1/external-access', { mcp_enabled: true }],
      [
        'POST',
        '/api/v1/tokens',
        { name: 'Escalate', scope_ids: [personal], capabilities: MCP_WRITE },
      ],
    ] as const)
      expect((await request(method, path, body, t.token)).statusCode).toBe(403);
  });
  it('aplica les edicions immediatament, conserva el secret i deixa rastre', async () => {
    const t = await token(MCP_WRITE);
    const created = await request(
      'POST',
      '/api/v1/tasks',
      { title: 'Write', scope_id: personal },
      t.token,
    );
    expect(created.statusCode, created.body).toBe(201);
    const log = await sql<{
      credential_id: string;
    }>`SELECT credential_id FROM activity_log WHERE entity_id = ${created.json().id} ORDER BY id DESC`.execute(
      conn.db,
    );
    expect(log.rows[0]?.credential_id).toBe(t.summary.id);
    expect(
      (await request('PATCH', `/api/v1/tokens/${t.summary.id}`, { capabilities: MCP_READ }))
        .statusCode,
    ).toBe(200);
    expect(
      (await request('PATCH', `/api/v1/tasks/${created.json().id}`, { title: 'Blocked' }, t.token))
        .statusCode,
    ).toBe(403);
    expect(
      (await request('GET', `/api/v1/tasks/${created.json().id}`, undefined, t.token)).statusCode,
    ).toBe(200);
    expect((await request('DELETE', `/api/v1/tokens/${t.summary.id}`)).statusCode).toBe(204);
    expect((await request('GET', '/api/v1/tasks', undefined, t.token)).statusCode).toBe(401);
  });
  it('canals independents i sessió humana funcional amb tots dos apagats', async () => {
    const t = await token(MCP_READ, [personal], ['mcp']);
    expect((await request('GET', '/api/v1/tasks', undefined, t.token)).statusCode).toBe(403);
    await request('PATCH', '/api/v1/external-access', { api_enabled: false, mcp_enabled: false });
    expect((await request('GET', '/api/v1/tasks')).statusCode).toBe(200);
    const rpc = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };
    expect((await request('POST', '/mcp', rpc, t.token)).statusCode).toBe(403);
    expect((await request('POST', '/mcp', rpc)).statusCode).toBe(401);
    await request('PATCH', '/api/v1/external-access', { mcp_enabled: true });
    const client = new Client({ name: 'Femho integration test', version: '1' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${address}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${t.token}` } },
      }) as never,
    );
    try {
      const list = await client.listTools();
      expect(list.tools.some((tool) => tool.name === 'list_tasks')).toBe(true);
      expect(list.tools.every((tool) => tool.annotations?.readOnlyHint)).toBe(true);
      const identity = await client.callTool({ name: 'whoami', arguments: {} });
      expect(JSON.stringify(identity)).toContain(personal);
      expect(
        (await client.callTool({ name: 'list_tasks', arguments: { limit: 1 } })).isError,
      ).not.toBe(true);
    } finally {
      await client.close();
    }
  });
  it('rebutja àmbits aliens, permisos inventats, caducitat invàlida i no incorpora àmbits futurs', async () => {
    for (const extra of [
      { scope_ids: [] },
      { scope_ids: [foreign] },
      { capabilities: ['instance:manage'] },
      { capabilities: ['invented'] },
      { expires_at: 'wrong' },
      { expires_at: 9999 },
      { channels: 'api' },
    ]) {
      const res = await request('POST', '/api/v1/tokens', {
        name: 'Invalid',
        scope_ids: [personal],
        capabilities: MCP_READ,
        ...extra,
      });
      expect([403, 422]).toContain(res.statusCode);
    }
    const t = await token(MCP_READ, [personal, work]);
    const future = await request('POST', '/api/v1/scopes', {
      name: 'Future',
      color: '--plou-blue',
      kind: 'individual',
    });
    expect(future.statusCode, future.body).toBe(201);
    expect((await request('GET', '/api/v1/scopes', undefined, t.token)).body).not.toContain(
      future.json().id,
    );
  });
});

describe('OAuth MCP', () => {
  it('descobreix OAuth sense exposar dades i rebutja redireccions insegures', async () => {
    const mcp = await app.inject({ method: 'POST', url: '/mcp', payload: {} });
    expect(mcp.statusCode).toBe(401);
    expect(mcp.headers['www-authenticate']).toContain('/.well-known/oauth-protected-resource');
    expect(
      (await app.inject({ method: 'GET', url: '/.well-known/oauth-protected-resource' })).json()
        .resource,
    ).toBe(resource);
    const bad = await app.inject({
      method: 'POST',
      url: '/oauth/register',
      payload: { redirect_uris: ['http://attacker.example/callback'] },
    });
    expect(bad.statusCode).toBe(400);
  });
  it('consentiment, PKCE, lectura, renovació i revocació passen per HTTP', async () => {
    const flow = await oauth(true);
    const info = await request('GET', `/api/v1/mcp/authorization/${flow.id}`);
    expect(info.json()).toMatchObject({ client_name: 'Test MCP client', write_requested: true });
    const approved = await request('POST', `/api/v1/mcp/authorization/${flow.id}`, {
      approve: true,
      scope_ids: [personal],
      permission: 'read_only',
    });
    expect(approved.statusCode, approved.body).toBe(200);
    const url = new URL(approved.json().redirect_url);
    expect(url.searchParams.get('state')).toBe('test-state');
    expect(url.searchParams.get('iss')).toBe(issuer);
    const code = url.searchParams.get('code')!;
    expect((await flow.exchange(code, { code_verifier: 'x'.repeat(43) })).statusCode).toBe(400);
    expect((await flow.exchange(code, { resource: 'https://evil.example/mcp' })).statusCode).toBe(
      400,
    );
    const issued = await flow.exchange(code);
    expect(issued.statusCode, issued.body).toBe(200);
    expect(issued.headers['cache-control']).toBe('no-store');
    const tokens = issued.json();
    expect(tokens.scope).toBe('femho:read');
    expect((await flow.exchange(code)).statusCode).toBe(400);
    expect((await request('GET', '/api/v1/tasks', undefined, tokens.access_token)).statusCode).toBe(
      401,
    );
    const client = new Client({ name: 'OAuth client', version: '1' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${address}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${tokens.access_token}` } },
      }) as never,
    );
    try {
      expect((await client.callTool({ name: 'list_tasks', arguments: {} })).isError).not.toBe(true);
    } finally {
      await client.close();
    }
    const renew = (refresh: string) =>
      app.inject({
        method: 'POST',
        url: '/oauth/token',
        payload: {
          grant_type: 'refresh_token',
          client_id: flow.client,
          refresh_token: refresh,
          resource,
        },
      });
    const next = await renew(tokens.refresh_token);
    expect(next.statusCode, next.body).toBe(200);
    expect(next.json().refresh_token).not.toBe(tokens.refresh_token);
    expect((await renew(tokens.refresh_token)).statusCode).toBe(400);
    expect((await renew(next.json().refresh_token)).statusCode).toBe(400);
    const log = await sql<{
      n: number;
    }>`SELECT COUNT(*) AS n FROM activity_log WHERE entity_type = 'oauth_session' AND verb = 'revoked'`.execute(
      conn.db,
    );
    expect(Number(log.rows[0]?.n)).toBeGreaterThan(0);
  });
  it('no es poden afegir escriptures al consentiment de lectura ni aprovar des d’un altre origen', async () => {
    const flow = await oauth();
    const url = `/api/v1/mcp/authorization/${flow.id}`;
    expect(
      (
        await request('POST', url, {
          approve: true,
          scope_ids: [personal],
          permission: 'read_write',
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url,
          headers: { ...auth(), origin: 'https://evil.example' },
          payload: { approve: true, scope_ids: [personal], permission: 'read_only' },
        })
      ).statusCode,
    ).toBe(400);
    const denied = await request('POST', url, { approve: false });
    expect(new URL(denied.json().redirect_url).searchParams.get('error')).toBe('access_denied');
    expect(
      (
        await request('POST', url, {
          approve: true,
          scope_ids: [personal],
          permission: 'read_only',
        })
      ).statusCode,
    ).toBe(400);
  });
});

it('pausa i revoca OAuth sense afectar la sessió humana, i verifica caducitats', async () => {
  const flow = await oauth(true);
  const approved = await request('POST', `/api/v1/mcp/authorization/${flow.id}`, {
    approve: true,
    scope_ids: [personal],
    permission: 'read_write',
  });
  const issued = await flow.exchange(
    new URL(approved.json().redirect_url).searchParams.get('code')!,
  );
  expect(issued.statusCode).toBe(200);
  const access = issued.json().access_token as string;
  const rpc = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'create_task', arguments: { title: 'OAuth write', scope_id: personal } },
  };
  const call = () =>
    app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { authorization: `Bearer ${access}`, accept: 'application/json, text/event-stream' },
      payload: rpc,
    });
  expect((await call()).body).toContain('OAuth write');
  await request('PATCH', '/api/v1/external-access', { mcp_enabled: false });
  expect((await call()).statusCode).toBe(403);
  expect((await request('GET', '/api/v1/tasks')).statusCode).toBe(200);
  await request('PATCH', '/api/v1/external-access', { mcp_enabled: true });
  expect((await call()).statusCode).toBe(200);
  const { rows } = await sql<{
    id: string;
    token_id: string;
  }>`SELECT id, token_id FROM mcp_oauth_sessions WHERE client_id = ${flow.client}`.execute(conn.db);
  await sql`UPDATE mcp_oauth_sessions SET access_expires_at = '2000-01-01T00:00:00Z' WHERE id = ${rows[0]!.id}`.execute(
    conn.db,
  );
  expect((await call()).statusCode).toBe(401);
  await sql`UPDATE mcp_oauth_sessions SET access_expires_at = '2099-01-01T00:00:00Z' WHERE id = ${rows[0]!.id}`.execute(
    conn.db,
  );
  await request('DELETE', `/api/v1/tokens/${rows[0]!.token_id}`);
  expect((await call()).statusCode).toBe(401);
  const refresh = await app.inject({
    method: 'POST',
    url: '/oauth/token',
    payload: {
      grant_type: 'refresh_token',
      client_id: flow.client,
      resource,
      refresh_token: issued.json().refresh_token,
    },
  });
  expect(refresh.statusCode).toBe(401);
  const audit = await sql<{
    verb: string;
  }>`SELECT verb FROM activity_log WHERE entity_id = ${owner} AND entity_type = 'external_access'`.execute(
    conn.db,
  );
  expect(audit.rows.length).toBeGreaterThan(0);
});

it('el client OAuth confidencial exigeix el seu secret i pot revocar sense descobrir tokens aliens', async () => {
  const registration = await app.inject({
    method: 'POST',
    url: '/oauth/register',
    payload: {
      client_name: 'Confidential',
      redirect_uris: ['https://client.example/callback'],
      token_endpoint_auth_method: 'client_secret_basic',
    },
  });
  expect(registration.statusCode).toBe(201);
  const c = registration.json();
  const noSecret = await app.inject({
    method: 'POST',
    url: '/oauth/token',
    payload: {
      client_id: c.client_id,
      resource,
      grant_type: 'refresh_token',
      refresh_token: 'unknown',
    },
  });
  expect(noSecret.statusCode).toBe(401);
  const revoked = await app.inject({
    method: 'POST',
    url: '/oauth/revoke',
    headers: {
      authorization: `Basic ${Buffer.from(`${c.client_id}:${c.client_secret}`).toString('base64')}`,
    },
    payload: { token: 'unknown' },
  });
  expect(revoked.statusCode).toBe(200);
  const log = await sql<{
    n: number;
  }>`SELECT COUNT(*) AS n FROM activity_log WHERE entity_type = 'oauth_client' AND entity_id = ${c.client_id}`.execute(
    conn.db,
  );
  expect(Number(log.rows[0]?.n)).toBe(1);
});

it('un client revoca la seva sessió i el consentiment no es pot bescanviar caducat', async () => {
  const flow = await oauth();
  const approved = await request('POST', `/api/v1/mcp/authorization/${flow.id}`, {
    approve: true,
    scope_ids: [personal],
    permission: 'read_only',
  });
  const code = new URL(approved.json().redirect_url).searchParams.get('code')!;
  await sql`UPDATE mcp_oauth_codes SET expires_at = '2000-01-01T00:00:00Z' WHERE request_id = ${flow.id}`.execute(
    conn.db,
  );
  expect((await flow.exchange(code)).statusCode).toBe(400);
  await sql`UPDATE mcp_oauth_codes SET expires_at = '2099-01-01T00:00:00Z' WHERE request_id = ${flow.id}`.execute(
    conn.db,
  );
  const issued = await flow.exchange(code);
  expect(issued.statusCode).toBe(200);
  const revoked = await app.inject({
    method: 'POST',
    url: '/oauth/revoke',
    payload: { client_id: flow.client, token: issued.json().refresh_token },
  });
  expect(revoked.statusCode).toBe(200);
  const refresh = await app.inject({
    method: 'POST',
    url: '/oauth/token',
    payload: {
      client_id: flow.client,
      resource,
      grant_type: 'refresh_token',
      refresh_token: issued.json().refresh_token,
    },
  });
  expect(refresh.statusCode).toBe(400);
  const log = await sql<{
    n: number;
  }>`SELECT COUNT(*) AS n FROM activity_log WHERE entity_type = 'oauth_session' AND verb = 'revoked'`.execute(
    conn.db,
  );
  expect(Number(log.rows[0]?.n)).toBeGreaterThan(0);
});

it('les credencials IA poden acotar àmbits i permisos però no escalar-los', async () => {
  const created = await request('POST', '/api/v1/ai/agents', { name: 'Scoped agent' });
  expect(created.statusCode, created.body).toBe(201);
  const id = created.json().id;
  const assigned = await request('PUT', `/api/v1/ai/agents/${id}/scopes`, {
    scope_ids: [personal, work],
  });
  expect(assigned.statusCode, assigned.body).toBe(200);
  const credential = await request('POST', `/api/v1/ai/agents/${id}/credentials`, {
    name: 'Read personal',
    scope_ids: [personal],
    channels: ['api'],
    capabilities: ['tasks:read', 'scopes:read'],
  });
  expect(credential.statusCode, credential.body).toBe(201);
  expect(
    (await request('GET', '/api/v1/scopes', undefined, credential.json().token)).body,
  ).not.toContain(work);
  expect(
    (
      await request(
        'POST',
        '/api/v1/tasks',
        { title: 'No', scope_id: personal },
        credential.json().token,
      )
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await request('PATCH', `/api/v1/tokens/${credential.json().summary.id}`, {
        capabilities: ['tokens:manage'],
      })
    ).statusCode,
  ).toBe(422);
  await request('PATCH', '/api/v1/external-access', { api_enabled: false });
  expect(
    (await request('GET', '/api/v1/scopes', undefined, credential.json().token)).statusCode,
  ).toBe(403);
});
