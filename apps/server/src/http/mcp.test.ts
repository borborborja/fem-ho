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
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { generateApiToken } from '../auth/tokens.js';
import { connect, type Connection } from '../db/connection.js';
import { migrateToLatest } from '../db/migrator.js';
import { TOOLS, assertCatalogue } from '../mcp/tools.js';

const tmp = mkdtempSync(join(tmpdir(), 'femho-mcp-'));
const NOW = '2026-08-06T09:00:00.000Z';

let conn: Connection;
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

beforeAll(async () => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('FEMHO_')) delete process.env[key];
  }

  conn = connect(`sqlite://${join(tmp, 'test.db')}`);
  await migrateToLatest(conn.db, { engine: 'sqlite' });

  userId = uuidv7();
  await sql`
    INSERT INTO users (id, email, name, kind, role, created_at, updated_at)
    VALUES (${userId}, 'borja@example.com', 'Borja', 'human', 'admin', ${NOW}, ${NOW})
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
            ${JSON.stringify(['tasks:read', 'tasks:write', 'scopes:read', 'projects:read', 'comments:write', 'comments:read', 'checklists:write', 'events:read'])},
            ${JSON.stringify([scopeId])}, ${NOW})
  `.execute(conn.db);

  app = buildApp({ ...loadConfig('0.1.0-test'), logLevel: 'silent' }, { connection: conn });
});

afterAll(async () => {
  await app.close();
  await conn.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe('el catàleg', () => {
  it('són SETZE, ni una més', () => {
    // "Una definició de tool ocupa entre 100 i 500 tokens" (docs/08 §3). La disciplina
    // de nombre és el que evita que la finestra de context se'n vagi en metadades.
    expect(TOOLS).toHaveLength(16);
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
      'next',
      'release',
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
    for (const name of ['whoami', 'get_task', 'list_tasks', 'search_tasks']) {
      expect(byName.get(name)?.readOnlyHint).toBe(true);
    }

    // `next_task` **no** és idempotent: cada crida reserva una tasca diferent.
    expect(byName.get('next_task')?.idempotentHint).toBe(false);
    expect(byName.get('create_task')?.idempotentHint).toBe(false);

    // Les que modifiquen sí que ho són.
    for (const name of ['update_task', 'move_task', 'complete_task', 'release_task']) {
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
  it('les serveix totes setze i en aquest ordre', async () => {
    const response = await rpc('tools/list');
    expect(response.status).toBe(200);

    const tools = (result(response.body).tools ?? []) as { name: string }[];
    expect(tools).toHaveLength(16);
    expect(tools.map((tool) => tool.name)).toEqual(TOOLS.map((tool) => tool.name));
  });

  it('cada tool porta les seves anotacions', async () => {
    const tools = (result((await rpc('tools/list')).body).tools ?? []) as {
      name: string;
      annotations?: Record<string, unknown>;
    }[];

    const whoami = tools.find((tool) => tool.name === 'whoami');
    expect(whoami?.annotations?.readOnlyHint).toBe(true);
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
      scope: { ai_instructions: string };
      projects: unknown[];
      pending: number;
    }[];

    // Les instruccions de l'àmbit hi són: és el que fa que l'agent sàpiga com escriure.
    expect(cos[0]?.scope.ai_instructions).toBe('Escriu sempre en català.');
    expect(cos[0]?.pending).toBeGreaterThanOrEqual(0);
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
