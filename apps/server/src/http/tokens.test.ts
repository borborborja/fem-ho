/**
 * docs/13 M11 · tokens, mode d'IA i historial.
 *
 * El que decideix aquesta part: que el token es vegi **un sol cop**, que un token no
 * pugui fer més que qui el crea, i que "Desfés" **no esborri res de l'historial**.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { hashPassword } from '../auth/password.js';
import { connect, type Connection } from '../db/connection.js';
import { migrateToLatest } from '../db/migrator.js';

const tmp = mkdtempSync(join(tmpdir(), 'femho-tokens-'));
const NOW = '2026-08-06T09:00:00.000Z';
const PASSWORD = 'la-contrasenya-de-la-borja';

let conn: Connection;
let app: FastifyInstance;
let auth: { authorization: string };
let userId: string;
let scopeId: string;
let agentId: string;

async function api(
  method: 'GET' | 'POST' | 'DELETE',
  url: string,
  payload?: Record<string, unknown>,
): Promise<LightMyRequestResponse> {
  return payload === undefined
    ? app.inject({ method, url, headers: auth })
    : app.inject({ method, url, headers: auth, payload });
}

async function novaTasca(title: string): Promise<string> {
  const res = await api('POST', '/api/v1/tasks', { scope_id: scopeId, title });
  return res.json<{ id: string }>().id;
}

beforeAll(async () => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('FEMHO_')) delete process.env[key];
  }

  conn = connect(`sqlite://${join(tmp, 'test.db')}`);
  await migrateToLatest(conn.db, { engine: 'sqlite' });

  userId = uuidv7();
  await sql`
    INSERT INTO users (id, email, name, password_hash, kind, role, created_at, updated_at)
    VALUES (${userId}, 'borja@example.com', 'Borja', ${await hashPassword(PASSWORD)},
            'human', 'admin', ${NOW}, ${NOW})
  `.execute(conn.db);

  scopeId = uuidv7();
  await sql`
    INSERT INTO scopes (id, name, kind, color, owner_id, position, created_at, updated_at)
    VALUES (${scopeId}, 'Feina', 'individual', '--plou-blue', ${userId}, 'a1', ${NOW}, ${NOW})
  `.execute(conn.db);

  agentId = uuidv7();
  await sql`
    INSERT INTO ai_agents (id, name, on_behalf_of_user_id, actor_user_id, can_create_tasks,
                           created_at, updated_at)
    VALUES (${agentId}, 'Claude', ${userId}, ${userId}, 1, ${NOW}, ${NOW})
  `.execute(conn.db);

  app = buildApp({ ...loadConfig('0.1.0-test'), logLevel: 'silent' }, { connection: conn });

  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: 'borja@example.com', password: PASSWORD },
  });
  auth = { authorization: `Bearer ${login.json<{ access_token: string }>().access_token}` };
});

afterAll(async () => {
  await app.close();
  await conn.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe('crear un token', () => {
  it('el retorna UN SOL COP i mai més', async () => {
    const creat = await api('POST', '/api/v1/tokens', {
      name: 'Per a Claude',
      capabilities: ['tasks:read', 'tasks:write'],
      scope_ids: [scopeId],
    });

    expect(creat.statusCode).toBe(201);
    const cos = creat.json<{ token: string; summary: { id: string; token_prefix: string } }>();
    expect(cos.token).toMatch(/^femho_pat_/u);

    // A la llista només hi ha el prefix: no es pot recuperar del hash, i si l'usuari el
    // perd n'ha de crear un de nou (docs/05 §2).
    const llista = await api('GET', '/api/v1/tokens');
    const trobat = llista
      .json<{ data: { id: string; token_prefix: string }[] }>()
      .data.find((token) => token.id === cos.summary.id);

    expect(trobat?.token_prefix).toBe(cos.summary.token_prefix);
    expect(JSON.stringify(llista.json())).not.toContain(cos.token);
  });

  it('a la base només hi ha el hash, mai el token', async () => {
    const creat = await api('POST', '/api/v1/tokens', {
      name: 'Un altre',
      capabilities: ['tasks:read'],
    });
    const { token } = creat.json<{ token: string }>();

    const files = await sql<{ token_hash: string }>`SELECT token_hash FROM api_tokens`.execute(
      conn.db,
    );
    for (const fila of files.rows) expect(fila.token_hash).not.toBe(token);
  });

  it('sense nom es rebutja', async () => {
    // Un token sense nom no es pot distingir a la llista, i llavors no se'n pot revocar
    // cap amb confiança.
    const res = await api('POST', '/api/v1/tokens', { name: '  ', capabilities: ['tasks:read'] });
    expect(res.statusCode).toBe(422);
  });

  it('sense cap capacitat també', async () => {
    const res = await api('POST', '/api/v1/tokens', { name: 'Buit', capabilities: [] });
    expect(res.statusCode).toBe(422);
  });

  it('les capacitats inventades es descarten', async () => {
    const res = await api('POST', '/api/v1/tokens', {
      name: 'Amb invents',
      capabilities: ['tasks:read', 'esborra:tot', 'instance:destroy'],
    });

    const capabilities = res.json<{ summary: { capabilities: string[] } }>().summary.capabilities;
    expect(capabilities).toEqual(['tasks:read']);
  });

  it('un token sense àmbits vol dir tots els del propietari', async () => {
    const res = await api('POST', '/api/v1/tokens', {
      name: 'Sense abast',
      capabilities: ['tasks:read'],
    });
    expect(res.json<{ summary: { scope_ids: string[] } }>().summary.scope_ids).toEqual([]);
  });

  it('la creació queda a activity_log sense el token a dins', async () => {
    const creat = await api('POST', '/api/v1/tokens', {
      name: 'Amb rastre',
      capabilities: ['tasks:read'],
    });
    const { token } = creat.json<{ token: string }>();

    const fila = await sql<{ verb: string; changes: string }>`
      SELECT verb, changes FROM activity_log ORDER BY id DESC LIMIT 1
    `.execute(conn.db);

    expect(fila.rows[0]?.verb).toBe('token_created');
    // El token en clar no ha d'acabar a l'historial de cap manera.
    expect(fila.rows[0]?.changes).not.toContain(token);
  });
});

describe('revocar', () => {
  it("deixa el token inservible i queda a l'historial", async () => {
    const creat = await api('POST', '/api/v1/tokens', {
      name: 'Per revocar',
      capabilities: ['tasks:read', 'scopes:read'],
    });
    const cos = creat.json<{ token: string; summary: { id: string } }>();

    // Abans de revocar-lo, el token funciona.
    const abans = await app.inject({
      method: 'GET',
      url: '/api/v1/scopes',
      headers: { authorization: `Bearer ${cos.token}` },
    });
    expect(abans.statusCode).toBe(200);

    expect((await api('DELETE', `/api/v1/tokens/${cos.summary.id}`)).statusCode).toBe(204);

    const després = await app.inject({
      method: 'GET',
      url: '/api/v1/scopes',
      headers: { authorization: `Bearer ${cos.token}` },
    });
    expect(després.statusCode).toBe(401);

    const fila = await sql<{ verb: string }>`
      SELECT verb FROM activity_log ORDER BY id DESC LIMIT 1
    `.execute(conn.db);
    expect(fila.rows[0]?.verb).toBe('token_revoked');
  });

  it('revocar-lo dues vegades no és un error', async () => {
    const creat = await api('POST', '/api/v1/tokens', {
      name: 'Dos cops',
      capabilities: ['tasks:read'],
    });
    const { id } = creat.json<{ summary: { id: string } }>().summary;

    expect((await api('DELETE', `/api/v1/tokens/${id}`)).statusCode).toBe(204);
    // El resultat és el que l'usuari volia: no cal queixar-se.
    expect((await api('DELETE', `/api/v1/tokens/${id}`)).statusCode).toBe(204);
  });

  it('un token que no existeix és 404', async () => {
    expect((await api('DELETE', `/api/v1/tokens/${uuidv7()}`)).statusCode).toBe(404);
  });
});

describe("el mode d'IA", () => {
  it("els tres modes es poden posar, i queden a l'historial", async () => {
    const id = await novaTasca('Amb mode');

    for (const mode of ['assisted', 'delegated', 'manual']) {
      const res = await api('POST', `/api/v1/tasks/${id}/ai-mode`, { ai_mode: mode });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ ai_mode: string }>().ai_mode).toBe(mode);
    }

    const historial = await sql<{ n: number }>`
      SELECT COUNT(*) AS n FROM activity_log WHERE entity_id = ${id} AND verb = 'updated'
    `.execute(conn.db);
    expect(Number(historial.rows[0]?.n)).toBe(3);
  });

  it('un mode inventat es rebutja amb un missatge que diu quins hi ha', async () => {
    const id = await novaTasca('Mode dolent');
    // check-ignore vocab-lint: el valor és invàlid A POSTA. La prova comprova que el
    // servidor rebutgi el vocabulari del prototip, i per fer-ho l'ha d'enviar.
    const res = await api('POST', `/api/v1/tasks/${id}/ai-mode`, { ai_mode: 'autonoma' });

    expect(res.statusCode).toBe(422);
    expect(res.json<{ detail: string }>().detail).toContain('delegated');
  });

  it('per defecte una tasca neix manual', async () => {
    // "Tota tasca neix `manual`. Afegir un tercer selector al camp d'afegida trencaria
    // la premissa que escriure una tasca és escriure i prémer Enter" (docs/09 §2).
    const id = await novaTasca('Nova');
    const fila = await sql<{ ai_mode: string }>`
      SELECT ai_mode FROM tasks WHERE id = ${id}
    `.execute(conn.db);
    expect(fila.rows[0]?.ai_mode).toBe('manual');
  });
});

describe("l'historial", () => {
  async function ambCanviDIA(): Promise<{ taskId: string; entryId: string }> {
    const taskId = await novaTasca('Tocada per la IA');

    // Un canvi autònom, tal com el deixaria un agent.
    await sql`
      INSERT INTO activity_log (id, entity_type, entity_id, scope_id, verb, actor_type,
                                actor_agent_id, actor_label, source, changes, created_at)
      VALUES (${uuidv7()}, 'task', ${taskId}, ${scopeId}, 'updated', 'ai_agent', ${agentId},
              'IA · Claude', 'mcp',
              ${JSON.stringify({ title: { from: 'Tocada per la IA', to: 'Reescrita per la IA' } })},
              ${'2026-08-05T10:00:00.000Z'})
    `.execute(conn.db);
    await sql`UPDATE tasks SET title = 'Reescrita per la IA' WHERE id = ${taskId}`.execute(conn.db);

    const fila = await sql<{ id: string }>`
      SELECT id FROM activity_log WHERE entity_id = ${taskId} AND actor_type = 'ai_agent'
    `.execute(conn.db);
    return { taskId, entryId: fila.rows[0]!.id };
  }

  it('distingeix els actors amb una etiqueta llegible', async () => {
    const { taskId } = await ambCanviDIA();
    const res = await api('GET', `/api/v1/tasks/${taskId}/activity`);

    const entrades = res.json<{ data: { actor_type: string; actor_label: string }[] }>().data;
    expect(entrades.some((e) => e.actor_label === 'Borja')).toBe(true);
    expect(entrades.some((e) => e.actor_label === 'IA · Claude')).toBe(true);
  });

  it('ensenya el valor anterior i el nou', async () => {
    const { taskId } = await ambCanviDIA();
    const res = await api('GET', `/api/v1/tasks/${taskId}/activity`);

    const canvi = res
      .json<{ data: { changes: Record<string, { from: string; to: string }> | null }[] }>()
      .data.find((e) => e.changes?.title?.to === 'Reescrita per la IA');

    expect(canvi?.changes?.title?.from).toBe('Tocada per la IA');
  });

  it('només els canvis autònoms porten Desfés', async () => {
    const { taskId } = await ambCanviDIA();
    const entrades = (await api('GET', `/api/v1/tasks/${taskId}/activity`)).json<{
      data: { actor_type: string; undoable: boolean }[];
    }>().data;

    for (const entrada of entrades) {
      // Un canvi que ha fet una persona no en porta: ja el pot desfer ella editant.
      if (entrada.actor_type !== 'ai_agent') expect(entrada.undoable).toBe(false);
    }
    expect(entrades.some((e) => e.actor_type === 'ai_agent' && e.undoable)).toBe(true);
  });

  it('es pot filtrar per actor', async () => {
    const { taskId } = await ambCanviDIA();

    const nomesIa = (await api('GET', `/api/v1/tasks/${taskId}/activity?actor=ai`)).json<{
      data: { actor_type: string }[];
    }>().data;
    expect(nomesIa.every((e) => e.actor_type === 'ai_agent')).toBe(true);
    expect(nomesIa.length).toBeGreaterThan(0);

    const nomesHumans = (await api('GET', `/api/v1/tasks/${taskId}/activity?actor=human`)).json<{
      data: { actor_type: string }[];
    }>().data;
    expect(nomesHumans.every((e) => e.actor_type === 'user')).toBe(true);
  });

  it("AQUESTA és la de docs/09 §7: Desfés NO esborra res de l'historial", async () => {
    const { taskId, entryId } = await ambCanviDIA();

    const abans = (await api('GET', `/api/v1/tasks/${taskId}/activity`)).json<{ data: unknown[] }>()
      .data.length;

    expect((await api('POST', `/api/v1/activity/${entryId}/undo`)).statusCode).toBe(204);

    // El títol ha tornat enrere...
    const fila = await sql<{ title: string }>`
      SELECT title FROM tasks WHERE id = ${taskId}
    `.execute(conn.db);
    expect(fila.rows[0]?.title).toBe('Tocada per la IA');

    // ...i l'historial ha CRESCUT, no minvat: hi consta el que va fer la IA i que algú
    // ho ha desfet.
    const després = (await api('GET', `/api/v1/tasks/${taskId}/activity`)).json<{
      data: { changes: Record<string, { from: string; to: string }> | null }[];
    }>().data;

    expect(després.length).toBe(abans + 1);

    // El canvi invers hi és: el que era `to` ara és `from`. Es busca pel contingut i no
    // per la posició, perquè el que importa és que hi consti, no on.
    const invers = després.find((e) => e.changes?.title?.from === 'Reescrita per la IA');
    expect(invers?.changes?.title?.to).toBe('Tocada per la IA');
  });

  it('un canvi humà no es pot desfer per aquesta via', async () => {
    const taskId = await novaTasca('Feta per mi');
    const fila = await sql<{ id: string }>`
      SELECT id FROM activity_log WHERE entity_id = ${taskId} ORDER BY created_at LIMIT 1
    `.execute(conn.db);

    const res = await api('POST', `/api/v1/activity/${fila.rows[0]!.id}/undo`);
    expect(res.statusCode).toBe(422);
  });
});
