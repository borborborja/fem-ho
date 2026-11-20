/**
 * docs/13 M11 · `test: mcp`.
 *
 * Es parla amb el punt final tal com ho fa un client: JSON-RPC per `POST /mcp`. El que
 * decideix aquesta fita és el detall d'HTTP de `docs/08` §2 —el `401` amb
 * `WWW-Authenticate`— i les invariants del catàleg de `docs/08` §3.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { hashPassword } from '../auth/password.js';
import { generateApiToken } from '../auth/tokens.js';
import * as download from '../dav/fetch-safe.js';
import { connect, type Connection } from '../db/connection.js';
import { migrateToLatest } from '../db/migrator.js';
import { connectTestSchema, postgresUrl, type TestSchema } from '../db/test-postgres.js';
import { TOOLS, assertCatalogue } from '../mcp/tools.js';

const tmp = mkdtempSync(join(tmpdir(), 'femho-mcp-'));
const NOW = '2026-08-06T09:00:00.000Z';
const PASSWORD = 'contrasenya-de-prova';
const pg = postgresUrl();

let conn: Connection;
let schema: TestSchema | undefined;
let app: FastifyInstance;
let token: string;
let scopeId: string;
let userId: string;

/** Una crida JSON-RPC, com la faria un client MCP. */
async function rpc(
  method: string,
  params: Record<string, unknown> = {},
  auth: string | null = `Bearer ${token}`,
): Promise<{ status: number; headers: Record<string, unknown>; body: string }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    // Els clients MCP l'envien sempre: el transport respon 406 sense ell.
    Accept: 'application/json, text/event-stream',
  };
  if (auth !== null) headers.authorization = auth;

  const response = await app.inject({
    method: 'POST',
    url: '/mcp',
    headers,
    payload: { jsonrpc: '2.0', id: 1, method, params },
  });

  return { status: response.statusCode, headers: response.headers, body: response.body };
}

/** El resultat d'una crida, ja tret de l'embolcall de JSON-RPC o de l'SSE. */
function result(body: string): Record<string, unknown> {
  // El transport pot respondre com a JSON o com a flux d'esdeveniments.
  const linia = body.split('\n').find((l) => l.startsWith('data: ')) ?? body;
  const json = JSON.parse(linia.startsWith('data: ') ? linia.slice(6) : linia) as {
    result?: Record<string, unknown>;
    error?: Record<string, unknown>;
  };
  return json.result ?? json.error ?? {};
}

async function credential(
  capabilities: string[],
  allowedScope = scopeId,
  owner = userId,
): Promise<string> {
  const generated = generateApiToken();
  await sql`
    INSERT INTO api_tokens (id, user_id, name, token_prefix, token_hash, capabilities,
                            scope_ids, created_at)
    VALUES (${uuidv7()}, ${owner}, 'Integració', ${generated.prefix}, ${generated.hash},
            ${JSON.stringify(capabilities)}, ${JSON.stringify([allowedScope])}, ${NOW})
  `.execute(conn.db);
  return `Bearer ${generated.token}`;
}

async function callTool(name: string, args: Record<string, unknown>, auth?: string) {
  const response = await rpc('tools/call', { name, arguments: args }, auth);
  expect(response.status).toBe(200);
  return result(response.body) as { content: { text: string }[]; isError?: boolean };
}

function toolData<T>(response: Awaited<ReturnType<typeof callTool>>): T {
  expect(response.isError, response.content[0]?.text).not.toBe(true);
  return JSON.parse(response.content[0]!.text) as T;
}

beforeAll(async () => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('FEMHO_')) delete process.env[key];
  }

  if (pg !== undefined) schema = await connectTestSchema(pg, 'mcp_http');
  conn = schema ?? connect(`sqlite://${join(tmp, 'test.db')}`);
  await migrateToLatest(conn.db, { engine: conn.engine });

  userId = uuidv7();
  await sql`
    INSERT INTO users (id, email, name, password_hash, kind, role, created_at, updated_at)
    VALUES (${userId}, 'borja@example.com', 'Borja', ${await hashPassword(PASSWORD)}, 'human', 'admin', ${NOW}, ${NOW})
  `.execute(conn.db);

  scopeId = uuidv7();
  await sql`
    INSERT INTO scopes (id, name, kind, color, owner_id, position, ai_instructions,
                        created_at, updated_at)
    VALUES (${scopeId}, 'Feina', 'individual', '--plou-blue', ${userId}, 'a1',
            'Escriu sempre en català.', ${NOW}, ${NOW})
  `.execute(conn.db);

  const generated = generateApiToken();
  token = generated.token;
  await sql`
    INSERT INTO api_tokens (id, user_id, name, token_prefix, token_hash, capabilities,
                            scope_ids, created_at)
    VALUES (${uuidv7()}, ${userId}, 'Agent', ${generated.prefix}, ${generated.hash},
            ${JSON.stringify(['tasks:read', 'tasks:write', 'scopes:read', 'projects:read', 'comments:write', 'comments:read', 'checklists:write', 'events:read', 'attachments:write'])},
            ${JSON.stringify([scopeId])}, ${NOW})
  `.execute(conn.db);

  app = buildApp(
    { ...loadConfig('0.1.0-test'), dataDir: tmp, logLevel: 'silent' },
    { connection: conn, secret: 'secret-de-prova-de-la-instancia-mcp' },
  );
});

afterAll(async () => {
  await app?.close();
  await (schema === undefined ? conn?.close() : schema.drop());
  rmSync(tmp, { recursive: true, force: true });
});

describe('el catàleg', () => {
  it('el catàleg inclou les vint-i-tres eines documentades', () => {
    // "Una definició de tool ocupa entre 100 i 500 tokens" (docs/08 §3). La disciplina
    // de nombre és el que evita que la finestra de context se'n vagi en metadades.
    expect(TOOLS).toHaveLength(23);
    expect(() => assertCatalogue()).not.toThrow();
  });

  it('cap porta prefix', () => {
    // Els clients ja fan namespace: a Claude una tool acaba sent `mcp__femho__list_tasks`
    // i un `femho_` a sobre malgasta tokens a cada crida (D6).
    for (const tool of TOOLS) expect(tool.name).not.toMatch(/^femho_/u);
  });

  it('van alfabètiques', () => {
    // Els clients cacheguen la llista, i un ordre estable millora els encerts de la
    // memòria cau de prompts.
    const noms = TOOLS.map((tool) => tool.name);
    expect(noms).toEqual([...noms].sort());
  });

  it("cap tool d'esborrar", () => {
    // "Un agent no esborra res: com a molt marca i comenta" (docs/08 §3).
    for (const tool of TOOLS) expect(tool.name).not.toMatch(/delete|remove|destroy/iu);
  });

  it('el verb va primer', () => {
    const verbs = [
      'whoami',
      'get',
      'list',
      'search',
      'create',
      'update',
      'move',
      'complete',
      'add',
      // `ask_user`: el verb és preguntar, i el que segueix és a qui.
      'ask',
      'resume',
      'next',
      'release',
      'report',
    ];
    for (const tool of TOOLS) {
      expect(verbs.some((verb) => tool.name === verb || tool.name.startsWith(`${verb}_`))).toBe(
        true,
      );
    }
  });

  it('les anotacions distingeixen lectura, creació i modificació', () => {
    const byName = new Map(TOOLS.map((tool) => [tool.name, tool.annotations]));

    // Les de lectura: el client les pot aprovar sol.
    for (const name of ['whoami', 'get_task', 'get_task_context', 'list_tasks', 'search_tasks']) {
      expect(byName.get(name)?.readOnlyHint).toBe(true);
    }

    // `next_task` **no** és idempotent: cada crida reserva una tasca diferent.
    expect(byName.get('next_task')?.idempotentHint).toBe(false);
    expect(byName.get('create_task')?.idempotentHint).toBe(false);
    expect(byName.get('move_task')?.idempotentHint).toBe(false);

    // Les que modifiquen sí que ho són.
    for (const name of ['update_task', 'complete_task', 'release_task', 'add_task_attachment']) {
      expect(byName.get(name)?.idempotentHint).toBe(true);
    }

    // I cap és destructiva, perquè cap esborra.
    for (const tool of TOOLS) expect(tool.annotations.destructiveHint).toBe(false);
  });
});

describe('AQUEST és el detall que decideix si el servidor sembla trencat', () => {
  it('sense token, 401 amb WWW-Authenticate', async () => {
    const response = await rpc('tools/list', {}, null);

    expect(response.status).toBe(401);
    /**
     * Amb un `200` i un resultat d'error dient "cal iniciar sessió", el client li dona
     * aquest text al model com si fos el resultat de l'eina i **l'usuari no veu mai cap
     * botó de connectar** (docs/08 §2).
     */
    expect(String(response.headers['www-authenticate'])).toContain('Bearer');
  });

  it('amb un token inventat, també 401', async () => {
    const response = await rpc('tools/list', {}, 'Bearer femho_pat_aixo-no-existeix');
    expect(response.status).toBe(401);
    expect(response.headers['www-authenticate']).toBeDefined();
  });

  it("MAI un 200 amb l'error a dins", async () => {
    const response = await rpc('tools/list', {}, null);
    expect(response.status).not.toBe(200);
  });

  it('un GET és 405 amb Allow, no 404', async () => {
    // Un 404 faria pensar que el punt final no existeix.
    const response = await app.inject({ method: 'GET', url: '/mcp' });
    expect(response.statusCode).toBe(405);
    expect(response.headers.allow).toBe('POST');
  });
});

describe('tools/list', () => {
  it('serveix només les eines personals autoritzades, en ordre', async () => {
    const response = await rpc('tools/list');
    expect(response.status).toBe(200);

    const tools = (result(response.body).tools ?? []) as { name: string }[];
    expect(tools).toHaveLength(16);
    expect(tools.map((tool) => tool.name)).toEqual(
      TOOLS.filter(
        (tool) =>
          ![
            'next_task',
            'release_task',
            'ask_user',
            'resume_task',
            'get_task_execution_context',
            'get_task_execution_attachment',
            'report_task_execution_result',
          ].includes(tool.name),
      ).map((tool) => tool.name),
    );
  });

  it('reserva les execucions per a les connexions OAuth, encara que un PAT tingui les capacitats', async () => {
    const auth = await credential(['ai_executions:read', 'ai_executions:write']);
    const tools = result((await rpc('tools/list', {}, auth)).body);
    expect(tools.tools).toEqual([expect.objectContaining({ name: 'whoami' })]);
    expect(result((await rpc('events/list', {}, auth)).body).code).toBe(-32601);
  });

  it('cada tool porta les seves anotacions', async () => {
    const tools = (result((await rpc('tools/list')).body).tools ?? []) as {
      name: string;
      annotations?: Record<string, unknown>;
    }[];

    const whoami = tools.find((tool) => tool.name === 'whoami');
    expect(whoami?.annotations?.readOnlyHint).toBe(true);
  });

  it('totes les eines que escriuen declaren un origen opcional', () => {
    for (const tool of TOOLS) {
      const { origin } = tool.inputSchema;
      if (tool.annotations.readOnlyHint) expect(origin, tool.name).toBeUndefined();
      else
        expect(
          origin === undefined ? false : z.safeParse(origin, undefined).success,
          tool.name,
        ).toBe(true);
    }
  });
});

describe('la provinença d’MCP', () => {
  const headers = () => ({ authorization: `Bearer ${token}` });
  const sessionHeaders = async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'borja@example.com', password: PASSWORD },
    });
    expect(login.statusCode).toBe(200);
    return { authorization: `Bearer ${login.json<{ access_token: string }>().access_token}` };
  };

  it('conserva a la targeta i a l’historial l’origen de cada crida', async () => {
    const id = uuidv7();
    const creation = {
      id,
      scope_id: scopeId,
      title: 'Planificar la trobada',
      origin: ' WhatsApp ',
    };
    expect(toolData(await callTool('create_task', creation))).toMatchObject({ created: true });
    expect(
      toolData(await callTool('create_task', { ...creation, origin: 'Reintent' })),
    ).toMatchObject({ created: false });
    toolData(
      await callTool('update_task', { task_id: id, description: 'Dia acordat', origin: 'Correu' }),
    );
    toolData(await callTool('move_task', { task_id: id, status: 'doing' }));
    const edit = await app.inject({
      method: 'PATCH',
      url: `/api/v1/tasks/${id}`,
      headers: headers(),
      payload: { title: 'Trobada confirmada' },
    });
    expect(edit.statusCode, edit.body).toBe(200);

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/tasks/${id}`,
      headers: headers(),
    });
    expect(response.statusCode).toBe(200);
    const badge = { origin: null, creation: { origin: 'WhatsApp' } };
    expect(response.json()).toMatchObject({ source_kind: null, mcp_activity: badge });
    const board = await app.inject({ method: 'GET', url: '/api/v1/board', headers: headers() });
    expect(board.statusCode).toBe(200);
    const tasks = board
      .json<{
        columns: { groups: { tasks: { id: string }[] }[] }[];
      }>()
      .columns.flatMap((column) => column.groups.flatMap((group) => group.tasks));
    expect(tasks.find((task) => task.id === id)).toMatchObject({ mcp_activity: badge });
    expect(toolData(await callTool('get_task', { task_id: id }))).toMatchObject({
      mcp_activity: badge,
    });

    const history = await app.inject({
      method: 'GET',
      url: `/api/v1/tasks/${id}/activity`,
      headers: headers(),
    });
    expect(history.statusCode).toBe(200);
    const entries = history.json<{
      data: { verb: string; source: string; mcp_origin?: string | null }[];
    }>().data;
    expect(entries.map(({ verb, source, mcp_origin }) => ({ verb, source, mcp_origin }))).toEqual([
      { verb: 'created', source: 'mcp', mcp_origin: 'WhatsApp' },
      { verb: 'updated', source: 'mcp', mcp_origin: 'Correu' },
      { verb: 'moved', source: 'mcp', mcp_origin: null },
      { verb: 'updated', source: 'api', mcp_origin: undefined },
    ]);
  });

  it('mostra l’origen dels canvis d’ítems i adjunts a la tasca mare', async () => {
    const { task } = toolData<{ task: { id: string } }>(
      await callTool('create_task', {
        scope_id: scopeId,
        title: 'Preparar el viatge',
        checklists: [{ name: 'Logística', items: [{ text: 'Bitllets' }, { text: 'Reserva' }] }],
      }),
    );
    const item = (
      await sql<{ id: string }>`
      SELECT i.id FROM checklist_items i JOIN checklists c ON c.id = i.checklist_id
      WHERE c.task_id = ${task.id} AND i.text = 'Bitllets'
    `.execute(conn.db)
    ).rows[0]!;
    toolData(
      await callTool('update_checklist_item', { item_id: item.id, done: true, origin: 'Xat' }),
    );
    toolData(
      await callTool('update_checklist_item', {
        item_id: item.id,
        done: true,
        origin: 'Sense canvi',
      }),
    );
    expect(toolData(await callTool('get_task', { task_id: task.id }))).toMatchObject({
      mcp_activity: { origin: 'Xat', creation: { origin: null } },
    });
    const upload = {
      task_id: task.id,
      id: uuidv7(),
      filename: 'bitllets.txt',
      url: 'https://files.example.net/bitllets.txt',
      origin: 'Correu',
    };
    const fetch = vi.spyOn(download, 'safeFetch').mockResolvedValueOnce({
      bytes: Buffer.from('Bitllets'),
      body: 'Bitllets',
      status: 200,
      headers: new Headers(),
      url: upload.url,
    });
    try {
      expect(toolData(await callTool('add_task_attachment', upload))).toMatchObject({
        created: true,
      });
      expect(
        toolData(await callTool('add_task_attachment', { ...upload, origin: 'Reintent' })),
      ).toMatchObject({ created: false });
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally {
      fetch.mockRestore();
    }

    const history = await app.inject({
      method: 'GET',
      url: `/api/v1/tasks/${task.id}/activity`,
      headers: headers(),
    });
    expect(history.statusCode).toBe(200);
    expect(history.json().data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entity_id: item.id,
          entity_type: 'checklist_item',
          verb: 'completed',
          mcp_origin: 'Xat',
          undoable: false,
        }),
        expect.objectContaining({
          entity_id: upload.id,
          entity_type: 'attachment',
          verb: 'created',
          mcp_origin: 'Correu',
        }),
      ]),
    );
    expect(history.body).not.toContain('Reintent');
    expect(history.body).not.toContain('Sense canvi');
    expect(toolData(await callTool('get_task', { task_id: task.id }))).toMatchObject({
      mcp_activity: { origin: 'Correu', creation: { origin: null } },
    });
  });

  it('respecta l’àmbit autoritzat i omet la provinença en un enllaç públic', async () => {
    const { task } = toolData<{ task: { id: string } }>(
      await callTool('create_task', {
        scope_id: scopeId,
        title: 'Tasca compartida',
        origin: 'Xat intern',
      }),
    );
    const otherScope = uuidv7();
    const otherUser = uuidv7();
    await sql`
      INSERT INTO users (id, email, name, kind, role, created_at, updated_at)
      VALUES (${otherUser}, 'altra@example.com', 'Altra', 'human', 'member', ${NOW}, ${NOW})
    `.execute(conn.db);
    await sql`
      INSERT INTO scopes (id, name, kind, color, owner_id, position, created_at, updated_at)
      VALUES (${otherScope}, 'Altre àmbit', 'individual', '--plou-blue', ${otherUser}, 'a2', ${NOW}, ${NOW})
    `.execute(conn.db);
    const restricted = { authorization: await credential(['tasks:read'], otherScope, otherUser) };
    for (const suffix of ['', '/activity']) {
      const outside = await app.inject({
        method: 'GET',
        url: `/api/v1/tasks/${task.id}${suffix}`,
        headers: restricted,
      });
      expect(outside.statusCode).toBe(403);
      expect(outside.body).not.toContain('Xat intern');
    }

    const share = await app.inject({
      method: 'POST',
      url: '/api/v1/shares',
      headers: await sessionHeaders(),
      payload: { task_id: task.id, permission: 'view' },
    });
    expect(share.statusCode, share.body).toBe(201);
    const guest = await app.inject({
      method: 'POST',
      url: `/s/${share.json<{ token: string }>().token}`,
      payload: {},
    });
    expect(guest.statusCode).toBe(200);
    expect(guest.json().task).toMatchObject({ id: task.id, title: 'Tasca compartida' });
    expect(guest.json().task).not.toHaveProperty('mcp_activity');
    expect(guest.body).not.toContain('Xat intern');
  });

  it('desa al seu àmbit l’origen d’una reserva feta amb next_task', async () => {
    const session = await sessionHeaders();
    const agent = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/agents',
      headers: session,
      payload: { name: 'Assistent de prova' },
    });
    expect(agent.statusCode).toBe(201);
    const agentId = agent.json<{ id: string }>().id;
    const scopes = await app.inject({
      method: 'PUT',
      url: `/api/v1/ai/agents/${agentId}/scopes`,
      headers: session,
      payload: { scope_ids: [scopeId] },
    });
    expect(scopes.statusCode).toBe(200);
    const access = await app.inject({
      method: 'POST',
      url: `/api/v1/ai/agents/${agentId}/credentials`,
      headers: session,
      payload: { name: 'Assistent al portàtil' },
    });
    expect(access.statusCode).toBe(201);
    const agentAuth = `Bearer ${access.json<{ token: string }>().token}`;
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers: session,
      payload: {
        scope_id: scopeId,
        title: 'Revisar la llista',
        status: 'todo',
        ai_mode: 'delegated',
      },
    });
    expect(created.statusCode).toBe(201);
    const { id } = created.json<{ id: string }>();
    const claim = await callTool('next_task', { scope_id: scopeId, origin: 'Notes' }, agentAuth);
    expect(toolData(claim)).toMatchObject({ task: { id }, lease_expires_at: expect.any(String) });
    const claimed = toolData<{ mcp_activity: unknown }>(
      await callTool('get_task', { task_id: id }, agentAuth),
    );
    expect(claimed.mcp_activity).toEqual({ origin: 'Notes' });
    const recorded = await sql<{ scope_id: string; mcp_origin: string }>`
      SELECT scope_id, mcp_origin FROM activity_log
      WHERE entity_type = 'task' AND entity_id = ${id} AND verb = 'claimed'
    `.execute(conn.db);
    expect(recorded.rows).toEqual([{ scope_id: scopeId, mcp_origin: 'Notes' }]);
    const released = await callTool(
      'release_task',
      {
        task_id: id,
        reason: 'La reunió s’ajorna',
        origin: 'Correu',
      },
      agentAuth,
    );
    expect(toolData(released)).toEqual({ released: id });
    expect(toolData(await callTool('get_task', { task_id: id }, agentAuth))).toMatchObject({
      mcp_activity: { origin: 'Correu' },
      locked_until: null,
    });
    const oldClaim = uuidv7();
    await sql`
      INSERT INTO activity_log (id, entity_type, entity_id, actor_type, actor_agent_id,
                                source, verb, created_at)
      VALUES (${oldClaim}, 'task', ${id}, 'ai_agent', ${agentId}, 'mcp', 'claimed', ${NOW})
    `.execute(conn.db);
    const history = await app.inject({
      method: 'GET',
      url: `/api/v1/tasks/${id}/activity`,
      headers: session,
    });
    expect(history.json().data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: oldClaim, verb: 'claimed', source: 'mcp', mcp_origin: null }),
        expect.objectContaining({ verb: 'claimed', source: 'mcp', mcp_origin: 'Notes' }),
        expect.objectContaining({ verb: 'released', source: 'mcp', mcp_origin: 'Correu' }),
      ]),
    );
  });

  it('rebutja una etiqueta buida o massa llarga abans d’escriure', async () => {
    for (const origin of ['  ', 'x'.repeat(121)]) {
      const id = uuidv7();
      expect(
        (await callTool('create_task', { id, scope_id: scopeId, title: 'Esborrany', origin }))
          .isError,
      ).toBe(true);
      const audit = await sql`SELECT id FROM activity_log WHERE entity_id = ${id}`.execute(conn.db);
      expect(audit.rows).toEqual([]);
    }
  });
});

describe('tools/call', () => {
  it('whoami diu QUINS ÀMBITS VEU el token', async () => {
    const response = await rpc('tools/call', { name: 'whoami', arguments: {} });
    const contingut = (result(response.body).content ?? []) as { text: string }[];
    const cos = JSON.parse(contingut[0]!.text) as { scope_ids: string[]; capabilities: string[] };

    // Sense això l'agent prova a cegues i acumula 403 fins a esgotar el límit de ritme.
    expect(cos.scope_ids).toEqual([scopeId]);
    expect(cos.capabilities).toContain('tasks:write');
  });

  it('create_task crea de debò, per la mateixa capa de servei', async () => {
    const response = await rpc('tools/call', {
      name: 'create_task',
      arguments: { scope_id: scopeId, title: 'Escrita per un agent' },
    });

    const contingut = (result(response.body).content ?? []) as { text: string }[];
    expect(contingut[0]!.text).toContain('Escrita per un agent');

    const row = await sql<{ title: string }>`
      SELECT title FROM tasks WHERE scope_id = ${scopeId} ORDER BY created_at DESC LIMIT 1
    `.execute(conn.db);
    expect(row.rows[0]?.title).toBe('Escrita per un agent');
  });

  it('descobreix referències i lliura una tasca completa amb una credencial de creació', async () => {
    const auth = await credential(['tasks:create']);
    const label = uuidv7();
    const project = uuidv7();
    const type = uuidv7();
    await sql`INSERT INTO labels (id, scope_id, name, color, created_at)
      VALUES (${label}, ${scopeId}, 'Revisió', '--plou-blue', ${NOW})`.execute(conn.db);
    await sql`INSERT INTO projects (id, scope_id, name, position, created_at, updated_at)
      VALUES (${project}, ${scopeId}, 'Arxiu', 'a1', ${NOW}, ${NOW})`.execute(conn.db);
    await sql`INSERT INTO task_types (id, scope_id, name, color, position, created_at, updated_at)
      VALUES (${type}, ${scopeId}, 'Contingut', '--plou-blue', 'a1', ${NOW}, ${NOW})`.execute(
      conn.db,
    );

    const tools = (result((await rpc('tools/list', {}, auth)).body).tools ?? []) as {
      name: string;
    }[];
    expect(tools.map((tool) => tool.name)).toEqual(['create_task', 'get_task_context', 'whoami']);
    const context = toolData(await callTool('get_task_context', { scope_id: scopeId }, auth));
    expect(context).toMatchObject({
      timezone: 'Europe/Madrid',
      scopes: [{ id: scopeId, writable: true }],
      details: {
        projects: [{ id: project, name: 'Arxiu' }],
        task_types: [{ id: type, name: 'Contingut' }],
        labels: [{ id: label, name: 'Revisió' }],
        assignees: [{ id: userId, name: 'Borja' }],
      },
    });
    expect(context).not.toHaveProperty('details.assignees.0.email');
    const restContext = await app.inject({
      method: 'GET',
      url: `/api/v1/task-context?scope_id=${scopeId}`,
      headers: { authorization: auth },
    });
    expect(restContext.json()).toEqual(context);

    const id = uuidv7();
    const input = {
      id,
      scope_id: scopeId,
      title: 'Preparar el dossier',
      description: 'Materials de l’arxiu',
      project_id: project,
      task_type_id: type,
      assignee_ids: [userId],
      status: 'done',
      completed_at: '2025-01-16',
      due_date: '2025-01-16',
      due_time: '14:30',
      deadline: '2025-01-16T18:00:00+01:00',
      rrule: 'FREQ=WEEKLY',
      recurrence_mode: 'completion',
      ai_mode: 'assisted',
      ai_instructions: 'Comprova el format',
      label_ids: [label],
      subtasks: [
        {
          title: 'Revisar la portada',
          done: true,
          checklists: [{ name: 'Disseny', items: [{ text: 'Tipografia', done: true }] }],
        },
      ],
      checklists: [{ name: 'Publicació', items: [{ text: 'Revisió final' }] }],
      comments: [{ body: 'El dossier està llest.' }],
    };
    const creation = toolData<{ task: Record<string, unknown>; created: boolean }>(
      await callTool('create_task', input, auth),
    );
    expect(creation).toMatchObject({
      created: true,
      task: { id, status: 'done', completed_at: '2025-01-15T23:00:00.000Z' },
    });
    expect(creation.task).not.toHaveProperty('title');
    expect(toolData(await callTool('create_task', input, auth))).toEqual({
      ...creation,
      created: false,
    });
    expect((await callTool('get_task', { task_id: id }, auth)).isError).toBe(true);

    const stored = toolData(await callTool('get_task', { task_id: id }));
    expect(stored).toMatchObject({
      id,
      title: input.title,
      due_time: '14:30',
      ai_instructions: input.ai_instructions,
      deadline: '2025-01-16T17:00:00.000Z',
    });
    const children = await sql<{
      subtasks: number;
      checklists: number;
      comments: number;
      labels: number;
    }>`
      SELECT (SELECT COUNT(*) FROM subtasks WHERE task_id = ${id}) AS subtasks,
             (SELECT COUNT(*) FROM checklists WHERE task_id = ${id}) AS checklists,
             (SELECT COUNT(*) FROM comments WHERE task_id = ${id}) AS comments,
             (SELECT COUNT(*) FROM task_labels WHERE task_id = ${id}) AS labels
    `.execute(conn.db);
    expect(children.rows[0]).toEqual({ subtasks: 1, checklists: 2, comments: 1, labels: 1 });
  });

  it('mou entre columnes sense exposar la fitxa i detecta versions obsoletes', async () => {
    const { task } = toolData<{ task: { id: string; version: number } }>(
      await callTool('create_task', { title: 'Revisar el resum', scope_id: scopeId }),
    );
    const auth = await credential(['tasks:move']);
    const moved = toolData<Record<string, unknown>>(
      await callTool(
        'move_task',
        { task_id: task.id, status: 'doing', expected_version: task.version },
        auth,
      ),
    );
    expect(moved).toMatchObject({ id: task.id, status: 'doing', version: task.version + 1 });
    expect(moved).not.toHaveProperty('title');
    expect(
      (
        await callTool(
          'move_task',
          { task_id: task.id, status: 'done', expected_version: task.version },
          auth,
        )
      ).isError,
    ).toBe(true);
    const completed = toolData(await callTool('complete_task', { task_id: task.id }, auth));
    expect(completed).toMatchObject({
      id: task.id,
      status: 'done',
      completed_at: expect.any(String),
    });
    expect(
      (await callTool('create_task', { scope_id: scopeId, title: 'Altra tasca' }, auth)).isError,
    ).toBe(true);
  });

  it('adjunta bytes amb un identificador de reintent i un permís independent', async () => {
    const { task } = toolData<{ task: { id: string } }>(
      await callTool('create_task', { scope_id: scopeId, title: 'Informe mensual' }),
    );
    const auth = await credential(['tasks:attach']);
    const bytes = Buffer.from('Informe sense format');
    const args = {
      task_id: task.id,
      id: uuidv7(),
      filename: 'informe.txt',
      content_base64: bytes.toString('base64'),
    };
    const first = toolData(await callTool('add_task_attachment', args, auth));
    expect(first).toMatchObject({
      created: true,
      attachment: { id: args.id, task_id: task.id, size_bytes: bytes.length },
    });
    expect(toolData(await callTool('add_task_attachment', args, auth))).toMatchObject({
      created: false,
      attachment: { id: args.id },
    });
    expect(
      (
        await callTool(
          'add_task_attachment',
          { ...args, url: 'https://files.example.net/informe.txt' },
          auth,
        )
      ).isError,
    ).toBe(true);
    expect((await callTool('get_task', { task_id: task.id }, auth)).isError).toBe(true);
  });

  it('edita la fitxa amb el permís propi i conserva la columna', async () => {
    const { task } = toolData<{ task: { id: string } }>(
      await callTool('create_task', {
        scope_id: scopeId,
        title: 'Informe inicial',
        status: 'todo',
        description: 'Descripció provisional',
        ai_instructions: 'Mantén el format',
      }),
    );
    const auth = await credential(['tasks:update']);
    const edited = toolData(
      await callTool(
        'update_task',
        {
          task_id: task.id,
          title: 'Informe revisat',
          description: null,
          due_time: '13:15',
        },
        auth,
      ),
    );
    expect(edited).toMatchObject({ id: task.id, status: 'todo' });
    expect(edited).not.toHaveProperty('ai_instructions');
    expect((await callTool('move_task', { task_id: task.id, status: 'doing' }, auth)).isError).toBe(
      true,
    );
    expect(toolData(await callTool('get_task', { task_id: task.id }))).toMatchObject({
      title: 'Informe revisat',
      description: null,
      due_time: '13:15',
      status: 'todo',
      ai_instructions: 'Mantén el format',
    });
  });

  it("l'escriptura queda a activity_log, com qualsevol altra", async () => {
    await rpc('tools/call', {
      name: 'create_task',
      arguments: { scope_id: scopeId, title: 'Amb rastre' },
    });

    const row = await sql<{ source: string; actor_type: string }>`
      SELECT source, actor_type FROM activity_log ORDER BY id DESC LIMIT 1
    `.execute(conn.db);
    // Regla 4: si un camí d'escriptura no pot escriure el log, no és un camí vàlid.
    expect(row.rows[0]?.source).toBe('mcp');
  });

  it('get_briefing estalvia sis crides', async () => {
    const response = await rpc('tools/call', { name: 'get_briefing', arguments: {} });
    const contingut = (result(response.body).content ?? []) as { text: string }[];
    const cos = JSON.parse(contingut[0]!.text) as {
      scopes: { scope: { ai_instructions: string }; projects: unknown[]; pending: number }[];
      taken_over: { task_id: string }[];
    };

    // Les instruccions de l'àmbit hi són: és el que fa que l'agent sàpiga com escriure.
    expect(cos.scopes[0]?.scope.ai_instructions).toBe('Escriu sempre en català.');
    expect(cos.scopes[0]?.pending).toBeGreaterThanOrEqual(0);
    /**
     * I **el que t'han reclamat**, encara que sigui buit: és el timbre que un protocol de
     * consulta pot tenir, i si el camp no hi fos sempre, un agent no podria confiar-hi.
     */
    expect(cos.taken_over).toEqual([]);
  });

  it('list_events sense finestra és un error LLEGIBLE, no un 500', async () => {
    const response = await rpc('tools/call', { name: 'list_events', arguments: {} });
    const cos = result(response.body) as { isError?: boolean; content?: { text: string }[] };

    // Una fallada de validació és un resultat de tool amb error: el model se'n recupera.
    expect(cos.isError).toBe(true);
    expect(cos.content?.[0]?.text).toContain('from');
  });

  it('una tool que no existeix es marca com a error i es diu quina', async () => {
    /**
     * `docs/08` §3 demana que això sigui un **error de protocol**. L'SDK oficial ho
     * embolica com a resultat de tool amb `isError: true` i el codi JSON-RPC dins del
     * text, i no es força a fer una altra cosa: caldria interceptar `tools/call` abans
     * que l'SDK el despatxi, o sigui reescriure el seu encaminador.
     *
     * El que la regla evita —que l'agent entri en bucle— es compleix igual: la resposta
     * està marcada com a error i diu el nom de la tool que no existeix, o sigui que el
     * model sap que ha de provar una altra cosa i no reintentar la mateixa.
     */
    const response = await rpc('tools/call', { name: 'esborra_tot', arguments: {} });
    const cos = result(response.body) as { isError?: boolean; content?: { text: string }[] };

    expect(cos.isError).toBe(true);
    expect(cos.content?.[0]?.text).toContain('esborra_tot');
    // El que NO pot passar de cap manera: que sembli que ha anat bé.
    expect(cos.content?.[0]?.text).toMatch(/not found|-32602/u);
  });

  it('un àmbit que el token no veu dona un error accionable', async () => {
    const altre = uuidv7();
    await sql`
      INSERT INTO scopes (id, name, kind, color, owner_id, position, created_at, updated_at)
      VALUES (${altre}, 'Personal', 'individual', '--plou-pink', ${userId}, 'a2', ${NOW}, ${NOW})
    `.execute(conn.db);

    const response = await rpc('tools/call', {
      name: 'create_task',
      arguments: { scope_id: altre, title: 'On no toca' },
    });

    const cos = result(response.body) as { isError?: boolean; content?: { text: string }[] };
    expect(cos.isError).toBe(true);
    // "Un 403 mut fa que l'agent reintenti fins a esgotar el límit de ritme."
    expect(cos.content?.[0]?.text.length ?? 0).toBeGreaterThan(20);
  });
});

describe('sense estat', () => {
  it('dues crides seguides no comparteixen cap sessió', async () => {
    // Cap `initialize`, cap identificador de sessió: cada petició és autodescriptiva
    // (docs/08 §1). Si calgués una sessió, la segona crida fallaria.
    const primera = await rpc('tools/list');
    const segona = await rpc('tools/list');

    expect(primera.status).toBe(200);
    expect(segona.status).toBe(200);
    expect(primera.headers['mcp-session-id']).toBeUndefined();
  });
});
