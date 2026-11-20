import { createHash, createHmac, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { buildApp } from '../app.js';
import { hashPassword } from '../auth/password.js';
import { loadConfig } from '../config.js';
import * as download from '../dav/fetch-safe.js';
import { dbBool } from '../db/bool.js';
import { connect } from '../db/connection.js';
import { migrateToLatest } from '../db/migrator.js';
import { connectTestSchema, postgresUrl } from '../db/test-postgres.js';
import { processTaskAiExecutions } from '../jobs/task-ai.js';
import type { ApiTokenSummary } from '../services/tokens.js';

const directory = mkdtempSync(join(tmpdir(), 'femho-oauth-grants-'));
const pg = postgresUrl();
const pgConnection = pg ? await connectTestSchema(pg, 'mcp_oauth_grants') : undefined;
const connection = pgConnection ?? connect(`sqlite://${join(directory, 'test.db')}`);
const issuer = 'http://localhost:8080';
const resource = `${issuer}/mcp`;
const redirectUri = 'http://127.0.0.1:8123/callback';
const instanceSecret = 'secret-de-prova-de-la-instancia-mcp-oauth';
const app = buildApp(
  { ...loadConfig('test'), baseUrl: issuer, dataDir: directory, logLevel: 'silent' },
  { connection, secret: instanceSecret },
);
const owner = uuidv7();
const other = uuidv7();
const personal = uuidv7();
const work = uuidv7();
const family = uuidv7();
const password = 'integration-test-password';
let session: string;
let otherSession: string;

function api(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  payload?: object,
  credential = session,
) {
  return app.inject({
    method,
    url: `/api/v1${path}`,
    headers: { authorization: `Bearer ${credential}` },
    ...(payload === undefined ? {} : { payload }),
  });
}

beforeAll(async () => {
  await migrateToLatest(connection.db, { engine: connection.engine });
  const now = new Date().toISOString();
  const passwordHash = await hashPassword(password);
  async function seedAccount(id: string, email: string): Promise<string> {
    await sql`INSERT INTO users (id,email,name,password_hash,kind,role,created_at,updated_at)
      VALUES (${id},${email},'Test',${passwordHash},'human','member',${now},${now})`.execute(
      connection.db,
    );
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password },
    });
    expect(login.statusCode, login.body).toBe(200);
    return login.json<{ access_token: string }>().access_token;
  }
  session = await seedAccount(owner, 'oauth-owner@example.com');
  otherSession = await seedAccount(other, 'oauth-other@example.com');
  for (const [id, name] of [
    [personal, 'Personal'],
    [work, 'Feina'],
    [family, 'Família'],
  ])
    await sql`INSERT INTO scopes (id,name,kind,color,owner_id,position,created_at,updated_at)
      VALUES (${id},${name},'individual','--plou-blue',${owner},'a1',${now},${now})`.execute(
      connection.db,
    );
});

afterAll(async () => {
  await app.close();
  if (pgConnection) await pgConnection.drop();
  else await connection.close();
  rmSync(directory, { recursive: true, force: true });
});

async function summary(id: string) {
  const response = await api('GET', '/tokens');
  expect(response.statusCode, response.body).toBe(200);
  return response.json<{ data: ApiTokenSummary[] }>().data.find((grant) => grant.id === id)!;
}

async function authorize(name: string, capabilities = ['tasks:read', 'tasks:create']) {
  const registered = await app.inject({
    method: 'POST',
    url: '/oauth/register',
    payload: { client_name: name, redirect_uris: [redirectUri] },
  });
  expect(registered.statusCode, registered.body).toBe(201);
  const { client_id } = registered.json<{ client_id: string }>();
  const verifier = randomBytes(32).toString('base64url');
  const query = new URLSearchParams({
    client_id,
    redirect_uri: redirectUri,
    resource,
    state: 'test-state',
    response_type: 'code',
    code_challenge_method: 'S256',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    scope: 'femho:read femho:write',
  });
  const start = await app.inject({ method: 'GET', url: `/oauth/authorize?${query}` });
  expect(start.statusCode, start.body).toBe(302);
  const requestId = new URL(start.headers.location!).searchParams.get('request')!;
  const consent = await api('POST', `/mcp/authorization/${requestId}`, {
    approve: true,
    permission: 'custom',
    scope_ids: [personal, work],
    capabilities,
  });
  expect(consent.statusCode, consent.body).toBe(200);
  const code = new URL(consent.json<{ redirect_url: string }>().redirect_url).searchParams.get(
    'code',
  )!;
  const listed = await api('GET', '/tokens');
  const { id } = listed
    .json<{ data: ApiTokenSummary[] }>()
    .data.find((item) => item.name === name)!;
  const token = (payload: object) =>
    app.inject({
      method: 'POST',
      url: '/oauth/token',
      payload: { client_id, resource, ...payload },
    });
  return {
    id,
    clientId: client_id,
    patch: (payload: object, credential?: string) =>
      api('PATCH', `/tokens/${id}`, payload, credential),
    exchange: () =>
      token({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
      }),
    renew: (refresh_token: string) => token({ grant_type: 'refresh_token', refresh_token }),
  };
}

const mcp = (access: string, method: string, params?: object) =>
  app.inject({
    method: 'POST',
    url: '/mcp',
    headers: { authorization: `Bearer ${access}`, accept: 'application/json, text/event-stream' },
    payload: { jsonrpc: '2.0', id: 1, method, params },
  });

function mcpValue(body: string) {
  const data = body.split('\n').find((line) => line.startsWith('data: '));
  return JSON.parse(data?.slice(6) ?? body) as {
    result?: Record<string, unknown>;
    error?: { code: number };
  };
}

async function taskTool(access: string, name: string, args: Record<string, string>) {
  const response = await mcp(access, 'tools/call', { name, arguments: args });
  expect(response.statusCode, response.body).toBe(200);
  return mcpValue(response.body).result as {
    content: { type: 'text'; text: string }[];
    isError?: boolean;
  };
}

it('ofereix les eines noves en tornar a escanejar amb la mateixa connexió OAuth', async () => {
  const grant = await authorize('Catàleg MCP anterior', ['tasks:read', 'tasks:update']);
  const auth = await grant.exchange();
  expect(auth.statusCode, auth.body).toBe(200);
  const { access_token: access } = auth.json<{ access_token: string }>();
  const additions = ['create_subtask', 'list_subtasks', 'update_subtask'];
  const register = McpServer.prototype.registerTool;
  // Primer reproduïm el catàleg que guardaria un client abans del desplegament.
  const oldCatalogue = vi.spyOn(McpServer.prototype, 'registerTool').mockImplementation(function (
    this: McpServer,
    ...args
  ) {
    const tool = Reflect.apply(register, this, args) as ReturnType<McpServer['registerTool']>;
    if (additions.includes(args[0])) tool.remove();
    return tool;
  });
  const scan = async () => {
    const response = await mcp(access, 'tools/list');
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers['cache-control']).toMatch(/no-cache|no-store/u);
    return (mcpValue(response.body).result?.tools as { name: string }[]).map(({ name }) => name);
  };
  const previous = await scan().finally(() => oldCatalogue.mockRestore());
  expect(previous).toContain('update_task');
  expect(previous.filter((name) => additions.includes(name))).toEqual([]);
  expect(await scan()).toEqual([...previous, ...additions].sort());
  expect((await summary(grant.id)).capabilities).toEqual(['tasks:read', 'tasks:update']);
});

it('redueix els permisos i àmbits OAuth en ús, deixa rastre i pot revocar-los sense aturar un token manual', async () => {
  const grant = await authorize('Reducció OAuth');
  const auth = await grant.exchange();
  expect(auth.statusCode, auth.body).toBe(200);
  const issued = auth.json<{ access_token: string; refresh_token: string; scope: string }>();
  expect(issued.scope).toBe('femho:read femho:write');
  const { access_token: access, refresh_token: refresh } = issued;
  const toolsBefore = await mcp(access, 'tools/list');
  expect(toolsBefore.statusCode, toolsBefore.body).toBe(200);
  expect(toolsBefore.body).toContain('"name":"create_task"');
  expect(toolsBefore.body).not.toContain('get_task_execution_context');
  expect(mcpValue((await mcp(access, 'events/list')).body).error?.code).toBe(-32601);
  const manual = await api('POST', '/tokens', {
    name: 'Token independent',
    capabilities: ['tasks:read'],
    scope_ids: [work],
    channels: ['mcp'],
  });
  expect(manual.statusCode, manual.body).toBe(201);
  const { token: pat, summary: patSummary } = manual.json<{
    token: string;
    summary: ApiTokenSummary;
  }>();
  expect((await summary(patSummary.id)).oauth).toBeUndefined();
  for (const [scope_id, title] of [
    [personal, 'Tasca encara visible'],
    [work, 'Tasca d’àmbit retirat'],
  ])
    expect((await api('POST', '/tasks', { scope_id, title })).statusCode).toBe(201);
  const listTasks = () => mcp(access, 'tools/call', { name: 'list_tasks', arguments: {} });
  expect((await listTasks()).body).toContain('Tasca d’àmbit retirat');

  expect((await grant.patch({ capabilities: ['tasks:read'] }, otherSession)).statusCode).toBe(404);
  const otherList = await api('GET', '/tokens', undefined, otherSession);
  expect(otherList.body).not.toContain(grant.id);
  expect((await grant.patch({ capabilities: ['tasks:read'] }, pat)).statusCode).toBe(403);
  for (const input of [
    { capabilities: ['tasks:read', 'events:read'] },
    { scope_ids: [personal, family] },
  ])
    expect((await grant.patch(input)).statusCode).toBe(409);
  for (const input of [
    { capabilities: [] },
    { scope_ids: [] },
    { capabilities: 'tasks:read' },
    { scope_ids: null },
    { scope_ids: [3] },
    { scope_ids: [personal], channels: ['api'] },
    { scope_ids: [personal], expires_at: null },
    { scope_ids: [personal], name: 'Client nou' },
    {},
  ])
    expect((await grant.patch(input)).statusCode).toBe(422);

  const reduced = await grant.patch({ capabilities: ['tasks:read'], scope_ids: [personal] });
  expect(reduced.statusCode, reduced.body).toBe(200);
  expect(reduced.json()).toMatchObject({
    capabilities: ['tasks:read'],
    scope_ids: [personal],
    channels: ['mcp'],
    oauth: { status: 'active' },
  });
  const list = await mcp(access, 'tools/list');
  expect(list.statusCode, list.body).toBe(200);
  expect(list.body).not.toContain('"name":"create_task"');
  const visible = await listTasks();
  expect(visible.statusCode, visible.body).toBe(200);
  expect(visible.body).toContain('Tasca encara visible');
  expect(visible.body).not.toContain('Tasca d’àmbit retirat');

  const audit = await sql<{ actor_user_id: string; changes: string }>`
    SELECT actor_user_id, changes FROM activity_log WHERE entity_type = 'api_token'
      AND entity_id = ${grant.id} AND verb = 'updated'
  `.execute(connection.db);
  expect(audit.rows).toHaveLength(1);
  expect(audit.rows[0]?.actor_user_id).toBe(owner);
  expect(JSON.parse(audit.rows[0]!.changes)).toEqual({
    capabilities: { from: ['tasks:read', 'tasks:create'], to: ['tasks:read'] },
    scope_ids: { from: [personal, work], to: [personal] },
  });

  const renewed = await grant.renew(refresh);
  expect(renewed.statusCode, renewed.body).toBe(200);
  const renewedTokens = renewed.json<typeof issued>();
  expect(renewedTokens.scope).toBe('femho:read');
  expect((await api('DELETE', `/tokens/${grant.id}`)).statusCode).toBe(204);
  expect((await summary(grant.id)).oauth?.status).toBe('revoked');
  expect((await mcp(renewedTokens.access_token, 'tools/list')).statusCode).toBe(401);
  expect((await grant.renew(renewedTokens.refresh_token)).statusCode).toBe(401);
  expect((await mcp(pat, 'tools/list')).statusCode).toBe(200);
});

it('renova la subscripció i execució OAuth i torna el context, l’adjunt i un sol resultat per MCP', async () => {
  const grant = await authorize('Execucions amb IA', ['ai_executions:read', 'ai_executions:write']);
  const auth = await grant.exchange();
  expect(auth.statusCode, auth.body).toBe(200);
  const { access_token, refresh_token } = auth.json<{
    access_token: string;
    refresh_token: string;
  }>();
  const tools = await mcp(access_token, 'tools/list');
  expect(tools.body).toContain('get_task_execution_context');
  expect(tools.body).toContain('get_task_execution_attachment');
  expect(tools.body).toContain('report_task_execution_result');
  expect(tools.body).not.toContain('"name":"get_task"');
  const initialized = await mcp(access_token, 'initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'test', version: '1.0.0' },
  });
  expect(mcpValue(initialized.body).result?.capabilities).toMatchObject({
    events: {},
    tools: { listChanged: false },
  });
  expect(mcpValue((await mcp(access_token, 'events/list')).body).result?.events).toMatchObject([
    { name: 'task.execution_requested', inputSchema: { required: ['scope_id'] } },
  ]);

  const url = 'https://example.net/mcp-events/first-chat';
  const signingKey = randomBytes(32);
  const secret = `whsec_${signingKey.toString('base64')}`;
  const executionId = uuidv7();
  const mockCallback = vi
    .spyOn(download, 'safeFetch')
    .mockImplementation(async (destination, input) => {
      expect(destination).toBe(url);
      expect(input?.maxRedirects).toBe(0);
      const raw = input!.body!.toString();
      const headers = input!.headers!;
      const signed = createHmac('sha256', signingKey)
        .update(`${headers['webhook-id']}.${headers['webhook-timestamp']}.${raw}`)
        .digest('base64');
      expect(headers['webhook-signature']).toBe(`v1,${signed}`);
      if (headers['webhook-id'] === executionId) {
        expect(JSON.parse(raw)).toMatchObject({ data: { execution_id: executionId } });
        expect(raw).not.toContain('Notes de la feina');
        return { status: 202, headers: new Headers(), url, body: '', bytes: Buffer.alloc(0) };
      }
      const request = JSON.parse(raw) as { type: string; challenge: string };
      expect(request.type).toBe('verification');
      const body = JSON.stringify({ challenge: request.challenge });
      return { status: 200, headers: new Headers(), url, body, bytes: Buffer.from(body) };
    });
  try {
    const name = 'task.execution_requested';
    const params = {
      name,
      arguments: { scope_id: personal },
      delivery: { mode: 'webhook', url, secret },
    };
    const rejected = await mcp(access_token, 'events/subscribe', {
      ...params,
      arguments: { scope_id: family },
    });
    expect(mcpValue(rejected.body).error?.code).toBe(-32024);
    expect(mockCallback).not.toHaveBeenCalled();
    const subscribed = await mcp(access_token, 'events/subscribe', params);
    const result = mcpValue(subscribed.body).result;
    expect(result).toMatchObject({
      id: expect.any(String),
      refreshBefore: expect.any(String),
      cursor: null,
    });
    expect(mockCallback).toHaveBeenCalledTimes(1);
    expect(subscribed.body).not.toContain(secret);

    const renewed = await grant.renew(refresh_token);
    expect(renewed.statusCode, renewed.body).toBe(200);
    const nextToken = renewed.json<{ access_token: string }>().access_token;
    const refreshed = await mcp(nextToken, 'events/subscribe', params);
    expect(mcpValue(refreshed.body).result?.id).toBe(result?.id);
    expect(mockCallback).toHaveBeenCalledTimes(1);

    const settings = await api('PUT', `/ai/task-settings/${personal}`, {
      enabled: true,
      method: 'mcp_events',
      subscription_id: result?.id,
    });
    expect(settings.statusCode, settings.body).toBe(200);
    const task = await api('POST', '/tasks', {
      scope_id: personal,
      title: 'Notes de la feina',
      description: 'Text exclusiu de la tasca',
    });
    expect(task.statusCode, task.body).toBe(201);
    const { id: taskId } = task.json<{ id: string }>();
    const upload = async (aiContext: boolean) => {
      const id = uuidv7();
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/tasks/${taskId}/attachments?id=${id}&filename=${aiContext ? 'notes' : 'privat'}.txt&ai_context=${aiContext}`,
        headers: { authorization: `Bearer ${session}`, 'content-type': 'application/octet-stream' },
        payload: Buffer.from(aiContext ? 'Adjunt autoritzat' : 'Adjunt privat'),
      });
      expect(response.statusCode, response.body).toBe(201);
      return id;
    };
    const contextAttachment = await upload(true);
    const privateAttachment = await upload(false);
    const queued = await api('POST', `/tasks/${taskId}/ai-executions`, { id: executionId });
    expect(queued.statusCode, queued.body).toBe(202);
    const reference = { execution_id: executionId };
    expect((await taskTool(nextToken, 'get_task_execution_context', reference)).isError).toBe(true);
    await processTaskAiExecutions(connection, instanceSecret);
    expect(mockCallback).toHaveBeenCalledTimes(2);

    const context = await taskTool(nextToken, 'get_task_execution_context', reference);
    expect(context.isError, context.content[0]?.text).toBeUndefined();
    const { text, attachments } = JSON.parse(context.content[0]!.text) as {
      text: string;
      attachments: { id: string }[];
    };
    expect(text).toContain('Text exclusiu de la tasca');
    expect(text).not.toContain('privat.txt');
    expect(attachments).toMatchObject([{ id: contextAttachment }]);
    const file = await taskTool(nextToken, 'get_task_execution_attachment', {
      ...reference,
      attachment_id: contextAttachment,
    });
    expect(file.content).toEqual([{ type: 'text', text: 'Adjunt autoritzat' }]);
    const privateFile = await taskTool(nextToken, 'get_task_execution_attachment', {
      ...reference,
      attachment_id: privateAttachment,
    });
    expect(privateFile.isError).toBe(true);

    const otherGrant = await authorize('Un altre xat', ['ai_executions:read']);
    const otherToken = (await otherGrant.exchange()).json<{ access_token: string }>().access_token;
    expect((await taskTool(otherToken, 'get_task_execution_context', reference)).isError).toBe(
      true,
    );
    expect((await mcp(otherToken, 'tools/list')).body).not.toContain(
      'report_task_execution_result',
    );

    await sql`UPDATE tasks SET needs_attention = ${dbBool(true)} WHERE id = ${taskId}`.execute(
      connection.db,
    );
    const report = await taskTool(nextToken, 'report_task_execution_result', {
      ...reference,
      body: 'Resultat de l’execució',
    });
    expect(report.isError, report.content[0]?.text).toBeUndefined();
    expect(
      await taskTool(nextToken, 'report_task_execution_result', {
        ...reference,
        body: 'Reintent del mateix resultat',
      }),
    ).toEqual(report);
    const comments = await api('GET', `/tasks/${taskId}/comments`);
    expect(comments.json()).toMatchObject([{ body: 'Resultat de l’execució' }]);
    expect((await api('GET', `/tasks/${taskId}`)).json()).toMatchObject({
      status: 'inbox',
      ai_mode: 'manual',
      needs_attention: true,
    });
    const history = await api('GET', `/tasks/${taskId}/activity`);
    expect(history.body).toContain('ai_execution_result');
    expect(history.body).not.toContain('Resultat de l’execució');

    const stop = { name, arguments: params.arguments, delivery: { mode: 'webhook', url } };
    for (let attempt = 0; attempt < 2; attempt++) {
      const unsubscribed = await mcp(nextToken, 'events/unsubscribe', stop);
      expect(mcpValue(unsubscribed.body).result).toEqual({});
    }
    expect((await taskTool(nextToken, 'get_task_execution_context', reference)).isError).toBe(true);
  } finally {
    mockCallback.mockRestore();
  }
});

it('mostra l’estat real del codi i de la sessió d’una autorització OAuth', async () => {
  const grant = await authorize('Estat OAuth');
  expect((await summary(grant.id)).oauth).toMatchObject({
    status: 'pending',
    expires_at: expect.any(String),
  });
  expect((await grant.patch({ scope_ids: [work] })).statusCode).toBe(200);
  const issued = await grant.exchange();
  expect(issued.statusCode, issued.body).toBe(200);
  const { refresh_token } = issued.json<{ refresh_token: string }>();
  const expires = (await summary(grant.id)).oauth?.expires_at;
  expect((await summary(grant.id)).oauth?.status).toBe('active');
  await sql`UPDATE mcp_oauth_sessions SET access_expires_at = '2000-01-01T00:00:00Z'
    WHERE token_id = ${grant.id}`.execute(connection.db);
  expect((await summary(grant.id)).oauth).toEqual({ status: 'active', expires_at: expires });
  await sql`UPDATE mcp_oauth_sessions SET refresh_expires_at = '2000-01-02T00:00:00Z'
    WHERE token_id = ${grant.id}`.execute(connection.db);
  expect((await summary(grant.id)).oauth?.status).toBe('expired');
  const revoke = await app.inject({
    method: 'POST',
    url: '/oauth/revoke',
    payload: { client_id: grant.clientId, token: refresh_token },
  });
  expect(revoke.statusCode, revoke.body).toBe(200);
  expect(await summary(grant.id)).toMatchObject({ oauth: { status: 'revoked' }, revoked_at: null });

  const pending = await authorize('Estat OAuth sense bescanviar');
  await sql`UPDATE mcp_oauth_codes SET expires_at = '2000-01-01T00:00:00Z'
    WHERE token_id = ${pending.id}`.execute(connection.db);
  expect((await summary(pending.id)).oauth?.status).toBe('expired');
  expect((await pending.patch({ capabilities: ['tasks:read'] })).statusCode).toBe(409);
});

it('les edicions OAuth simultànies no restauren permisos ni àmbits retirats', async () => {
  const grant = await authorize('Reduccions simultànies');
  const reduceCapabilities = { capabilities: ['tasks:read'], scope_ids: [personal, work] };
  const reduceScopes = { capabilities: ['tasks:read', 'tasks:create'], scope_ids: [personal] };
  const patchBoth = () => Promise.all([grant.patch(reduceCapabilities), grant.patch(reduceScopes)]);
  const edits = pgConnection
    ? (
        await pgConnection.db.transaction().execute(async (tx) => {
          // Ambdós PATCH han de llegir la mateixa concessió abans de deixar passar el primer UPDATE.
          await sql`SELECT id FROM api_tokens WHERE id = ${grant.id} FOR UPDATE`.execute(tx);
          const responses = patchBoth();
          await vi.waitFor(async () => {
            const waiting = await sql<{ count: number }>`
            SELECT COUNT(*) AS count FROM pg_stat_activity WHERE wait_event_type = 'Lock'
              AND query LIKE '%UPDATE api_tokens SET capabilities =%'
          `.execute(pgConnection.db);
            expect(waiting.rows[0]?.count).toBe(2);
          });
          return { responses };
        })
      ).responses
    : patchBoth();
  const [first, second] = await edits;
  expect([first.statusCode, second.statusCode].sort()).toEqual([200, 409]);
  expect(await summary(grant.id)).toMatchObject(
    first.statusCode === 200 ? reduceCapabilities : reduceScopes,
  );
  if (pgConnection)
    expect((first.statusCode === 409 ? first : second).json().type).toMatch(
      /oauth-grant-conflict$/,
    );
});
