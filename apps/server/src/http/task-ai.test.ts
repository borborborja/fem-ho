import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { hashPassword } from '../auth/password.js';
import { hashToken } from '../auth/tokens.js';
import { loadConfig } from '../config.js';
import * as outbound from '../dav/fetch-safe.js';
import { connect } from '../db/connection.js';
import { MIGRATIONS, migrateDown, migrateToLatest } from '../db/migrator.js';
import { connectTestSchema, postgresUrl } from '../db/test-postgres.js';
import { fireClaudeRoutine, processTaskAiExecutions } from '../jobs/task-ai.js';

const config = {
  ...loadConfig('test'),
  baseUrl: 'https://femho.example',
  logLevel: 'silent' as const,
};
const SECRET = 'secret-d-instancia-per-al-test-de-tasques-amb-ia';
const ROUTINE_TOKEN = 'sk-ant-oat01-token-de-prova';
const adminId = uuidv7();
const readerId = uuidv7();
const scopeId = uuidv7();
const otherScopeId = uuidv7();
const connectionId = uuidv7();
const oauthId = uuidv7();
const projectId = uuidv7();
const taskId = uuidv7();
const sessionUrl = 'https://claude.ai/code/session_prova';
const settingsPath = '/api/v1/ai/task-settings/' + scopeId;
const executionsPath = '/api/v1/tasks/' + taskId + '/ai-executions';
const contextPath = '/api/v1/tasks/' + taskId + '/ai-context';
const activityPath = '/api/v1/tasks/' + taskId + '/activity';
const now = () => new Date().toISOString();

const pg = postgresUrl();
let db: ReturnType<typeof connect>;
let app: ReturnType<typeof buildApp>;
let teardown: () => Promise<void>;
let admin: { authorization: string };
let reader: { authorization: string };

async function login(email: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password: 'contrasenya-de-prova' },
  });
  expect(response.statusCode).toBe(200);
  return { authorization: 'Bearer ' + response.json<{ access_token: string }>().access_token };
}

beforeAll(async () => {
  if (pg === undefined) {
    db = connect('sqlite::memory:');
    teardown = db.close;
  } else {
    const schema = await connectTestSchema(pg, 'task_ai_http');
    db = schema;
    teardown = schema.drop;
  }

  // Les dades prèvies queden a lloc i cap àmbit rep un destí implícit.
  await migrateToLatest(db.db, { engine: db.engine });
  for (const migration of [...MIGRATIONS].reverse()) {
    expect(await migrateDown(db.db, db.engine)).toBe(migration.name);
    if (migration.name === '027-task-ai') break;
  }
  const password = await hashPassword('contrasenya-de-prova');
  await sql`INSERT INTO users (id, email, name, password_hash, kind, role, created_at, updated_at)
    VALUES (${adminId}, 'admin@example.com', 'Admin', ${password}, 'human', 'admin', ${now()}, ${now()}),
      (${readerId}, 'reader@example.com', 'Visitor', ${password}, 'human', 'member', ${now()}, ${now()})`.execute(
    db.db,
  );
  await sql`INSERT INTO scopes (id, name, kind, color, owner_id, position, ai_instructions, created_at, updated_at)
    VALUES (${scopeId}, 'Feina', 'collective', '--plou-blue', ${adminId}, 'a0', 'Instrucció de feina', ${now()}, ${now()}),
      (${otherScopeId}, 'Personal', 'individual', '--plou-blue', ${adminId}, 'a1', NULL, ${now()}, ${now()})`.execute(
    db.db,
  );
  await sql`INSERT INTO projects (id, scope_id, name, position, ai_instructions, created_at, updated_at)
    VALUES (${projectId}, ${scopeId}, 'Projecte de la tasca', 'a0', 'Instrucció del projecte', ${now()}, ${now()})`.execute(
    db.db,
  );
  await sql`INSERT INTO scope_members (id, scope_id, user_id, role, created_at)
    VALUES (${uuidv7()}, ${scopeId}, ${readerId}, 'viewer', ${now()})`.execute(db.db);
  await sql`INSERT INTO tasks (id, scope_id, project_id, title, status, position, due_date, description, ai_instructions, created_by, created_at, updated_at)
    VALUES (${taskId}, ${scopeId}, ${projectId}, 'Context privat', 'todo', 'a0', '2026-12-01',
      'https://example.com/fil', 'Instrucció de la tasca', ${adminId}, ${now()}, ${now()})`.execute(
    db.db,
  );
  await migrateToLatest(db.db, { engine: db.engine });
  const client = uuidv7();
  await sql`INSERT INTO api_tokens (id, user_id, name, token_prefix, token_hash, capabilities, channels,
      scope_ids, credential_type, created_at)
    VALUES (${connectionId}, ${adminId}, 'Claude prova', 'oauth-fixture', ${hashToken(connectionId)},
      '["ai_executions:read","ai_executions:write"]', '["mcp"]',
      ${JSON.stringify([scopeId])}, 'oauth', ${now()})`.execute(db.db);
  await sql`INSERT INTO external_access (user_id, mcp_enabled) VALUES (${adminId}, 1)`.execute(
    db.db,
  );
  await sql`INSERT INTO mcp_oauth_clients (id, name, redirect_uris, auth_method, created_at)
    VALUES (${client}, 'Claude prova', '[]', 'none', ${now()})`.execute(db.db);
  await sql`INSERT INTO mcp_oauth_sessions (id, token_id, client_id, resource, access_hash, refresh_hash,
      access_expires_at, refresh_expires_at)
    VALUES (${oauthId}, ${connectionId}, ${client}, 'https://femho.example/mcp', ${hashToken('access-fixture')},
      ${hashToken('refresh-fixture')}, '2099-01-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`.execute(
    db.db,
  );
  app = buildApp(config, { connection: db, secret: SECRET });
  admin = await login('admin@example.com');
  reader = await login('reader@example.com');
});

afterAll(async () => {
  await app?.close();
  await teardown?.();
});

describe('tasques amb IA', () => {
  it('la migració conserva la tasca i els ajustos i les credencials són privats', async () => {
    const initial = await app.inject({
      method: 'GET',
      url: '/api/v1/ai/task-settings',
      headers: admin,
    });
    expect(initial.json().data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ scope_id: scopeId, enabled: false, method: 'copy' }),
      ]),
    );
    const saved = await app.inject({
      method: 'PUT',
      url: settingsPath,
      headers: admin,
      payload: {
        enabled: true,
        method: 'claude_routine',
        routine_id: 'trig_123',
        connection_id: connectionId,
        routine_token: ROUTINE_TOKEN,
      },
    });
    expect(saved.json()).toMatchObject({ ready: true, has_routine_token: true });
    expect(saved.body).not.toContain(ROUTINE_TOKEN);
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/ai/task-settings', headers: reader })).json()
        .data,
    ).toEqual([
      expect.objectContaining({
        scope_id: scopeId,
        enabled: false,
        can_dispatch: false,
        connection_id: null,
      }),
    ]);
    const denied = await app.inject({
      method: 'PUT',
      url: settingsPath,
      headers: reader,
      payload: { enabled: true, method: 'claude_routine', connection_id: connectionId },
    });
    expect(denied.statusCode).toBe(403);
    const data = await sql<{
      routine_token_enc: string;
    }>`SELECT routine_token_enc FROM task_ai_settings`.execute(db.db);
    expect(data.rows[0]?.routine_token_enc).not.toContain(ROUTINE_TOKEN);
    const audit =
      await sql`SELECT * FROM activity_log WHERE entity_type = 'task_ai_settings'`.execute(db.db);
    expect(audit.rows).toHaveLength(1);
    expect(JSON.stringify(audit.rows)).not.toContain(ROUTINE_TOKEN);
  });

  it('la còpia obté el context de la tasca i l’àmbit sense disparar cap enviament', async () => {
    const copied = await app.inject({ method: 'GET', url: contextPath, headers: admin });
    expect(copied.statusCode).toBe(200);
    for (const value of [
      'Context privat',
      '2026-12-01',
      'Instrucció del projecte',
      'Instrucció de feina',
      'Instrucció de la tasca',
      'https://example.com/fil',
    ])
      expect(copied.json().text).toContain(value);
    expect(
      (await app.inject({ method: 'GET', url: executionsPath, headers: admin })).json().data,
    ).toEqual([]);
    expect(
      (await app.inject({ method: 'GET', url: activityPath, headers: admin })).json().data,
    ).toEqual([]);
  });

  it('agrupa clics concurrents, conserva els UUID i lliura la rutina una sola vegada', async () => {
    const ids = [uuidv7(), uuidv7()];
    const request = (id: string) =>
      app.inject({ method: 'POST', url: executionsPath, headers: admin, payload: { id } });
    const replies = await Promise.all(ids.map(request));
    expect(replies.map((reply) => reply.statusCode)).toEqual([202, 202]);
    const id = replies[0]!.json().id as string;
    expect(replies[1]!.json().id).toBe(id);
    const expectFire = vi
      .fn<typeof fireClaudeRoutine>()
      .mockResolvedValue({ status: 'delivered', session_url: sessionUrl });
    const transport = { claude: expectFire, event: vi.fn().mockResolvedValue(204) };
    await Promise.all([
      processTaskAiExecutions(db, SECRET, now(), transport),
      processTaskAiExecutions(db, SECRET, now(), transport),
    ]);
    expect(expectFire).toHaveBeenCalledTimes(1);
    expect(expectFire).toHaveBeenCalledWith('trig_123', ROUTINE_TOKEN, id, expect.any(String));
    for (const replay of await Promise.all(ids.map(request)))
      expect(replay.json()).toMatchObject({ id, status: 'delivered', session_url: sessionUrl });
    const history = (await app.inject({ method: 'GET', url: activityPath, headers: reader })).json()
      .data as { verb: string }[];
    expect(history.map((entry) => entry.verb)).toEqual([
      'ai_execution_requested',
      'ai_execution_updated',
      'ai_execution_updated',
    ]);
    expect(JSON.stringify(history)).not.toContain(sessionUrl);
    expect(
      (await app.inject({ method: 'GET', url: executionsPath, headers: reader })).json().data,
    ).toEqual([]);
  });

  it('un tall després de començar la rutina deixa un estat incert i no dispara de nou', async () => {
    const response = await app.inject({
      method: 'POST',
      url: executionsPath,
      headers: admin,
      payload: { id: uuidv7() },
    });
    const id = response.json().id as string;
    await sql`UPDATE task_ai_executions SET status = 'sending', attempts = 1,
      claim_until = '2000-01-01T00:00:00.000Z' WHERE id = ${id}`.execute(db.db);
    const claude = vi.fn<typeof fireClaudeRoutine>();
    await processTaskAiExecutions(db, SECRET, now(), { claude, event: vi.fn() });
    expect(claude).not.toHaveBeenCalled();
    expect(
      (await app.inject({ method: 'GET', url: executionsPath, headers: admin })).json().data,
    ).toEqual(expect.arrayContaining([expect.objectContaining({ id, status: 'uncertain' })]));
  });

  it('cancel·la l’enviament si es revoca la connexió mentre és en cua', async () => {
    const id = uuidv7();
    expect(
      (await app.inject({ method: 'POST', url: executionsPath, headers: admin, payload: { id } }))
        .statusCode,
    ).toBe(202);
    await sql`UPDATE mcp_oauth_sessions SET revoked_at = ${now()} WHERE id = ${oauthId}`.execute(
      db.db,
    );
    const claude = vi.fn<typeof fireClaudeRoutine>();
    await processTaskAiExecutions(db, SECRET, now(), { claude, event: vi.fn() });
    expect(claude).not.toHaveBeenCalled();
    expect(
      (await app.inject({ method: 'GET', url: executionsPath, headers: admin })).json().data,
    ).toEqual(expect.arrayContaining([expect.objectContaining({ id, status: 'cancelled' })]));
  });

  it('Claude rep només l’ID i un 429 indica quan es pot tornar a disparar', async () => {
    const call = vi.spyOn(outbound, 'safeFetch').mockResolvedValue({
      status: 429,
      headers: new Headers({ 'Retry-After': '60' }),
      body: '',
      bytes: Buffer.alloc(0),
      url: 'https://api.anthropic.com/',
    });
    const id = uuidv7();
    const result = await fireClaudeRoutine(
      'trig_123',
      ROUTINE_TOKEN,
      id,
      '2026-12-01T10:00:00.000Z',
    );
    expect(result).toEqual({ status: 'failed', retry_at: '2026-12-01T10:01:00.000Z' });
    expect(call).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/claude_code/routines/trig_123/fire',
      expect.objectContaining({
        body: JSON.stringify({ text: JSON.stringify({ execution_id: id }) }),
        maxRedirects: 0,
      }),
    );
    call.mockRestore();
  });

  it('un reintent després de canviar d’àmbit no recupera la sessió anterior', async () => {
    const { rows } = await sql<{ id: string }>`
      SELECT id FROM task_ai_executions WHERE task_id = ${taskId} AND status = 'delivered'
    `.execute(db.db);
    expect(rows).toHaveLength(1);
    await sql`UPDATE tasks SET scope_id = ${otherScopeId}, project_id = NULL WHERE id = ${taskId}`.execute(
      db.db,
    );
    const replay = await app.inject({
      method: 'POST',
      url: executionsPath,
      headers: admin,
      payload: { id: rows[0]!.id },
    });
    expect(replay.statusCode).toBe(409);
    expect(replay.body).not.toContain(sessionUrl);
    expect(
      (await app.inject({ method: 'GET', url: executionsPath, headers: admin })).json().data,
    ).toEqual([]);
  });
});
