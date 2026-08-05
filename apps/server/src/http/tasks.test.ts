/**
 * docs/13 M4 · comprovació de la fita: `test: tasks + positions`.
 *
 * Els criteris d'acceptació:
 *   - Es poden crear àmbits individuals i col·lectius.
 *   - **Una tasca sense àmbit es rebutja.**
 *   - Moure entre columnes conserva l'ordre.
 *   - Mil moviments consecutius no degeneren les claus  → position.test.ts
 *   - `/board` retorna les quatre columnes agrupades per àmbit.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { LightMyRequestResponse } from 'fastify';
import { comparePositions } from '@fem-ho/contracts';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { hashPassword } from '../auth/password.js';
import { generateApiToken } from '../auth/tokens.js';
import { connect, type Connection } from '../db/connection.js';
import { migrateToLatest } from '../db/migrator.js';

const tmp = mkdtempSync(join(tmpdir(), 'femho-tasks-'));
const NOW = '2026-08-05T10:00:00.000Z';
const PASSWORD = 'la-contrasenya-de-la-borja';

let conn: Connection;
let app: FastifyInstance;
let userId: string;
let auth: { authorization: string };
let scopePersonal: string;
let scopeFamilia: string;

async function api(
  method: 'GET' | 'POST',
  url: string,
  payload?: Record<string, unknown>,
  headers: Record<string, string> = auth,
): Promise<LightMyRequestResponse> {
  return payload === undefined
    ? app.inject({ method, url, headers })
    : app.inject({ method, url, headers, payload });
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

describe('àmbits', () => {
  it('es pot crear un àmbit individual', async () => {
    const res = await api('POST', '/api/v1/scopes', {
      name: 'Personal',
      kind: 'individual',
      color: '--plou-blue',
    });
    expect(res.statusCode).toBe(201);
    const scope = res.json<{ id: string; kind: string; position: string }>();
    expect(scope.kind).toBe('individual');
    expect(scope.position).toBeTruthy();
    scopePersonal = scope.id;
  });

  it('i un de col·lectiu', async () => {
    const res = await api('POST', '/api/v1/scopes', {
      name: 'Família',
      kind: 'collective',
      color: '--plou-pink',
    });
    expect(res.statusCode).toBe(201);
    scopeFamilia = res.json<{ id: string }>().id;

    // El propietari hi consta com a membre des del primer moment.
    const membres = await sql<{ n: number }>`
      SELECT COUNT(*) AS n FROM scope_members WHERE scope_id = ${scopeFamilia}
    `.execute(conn.db);
    expect(Number(membres.rows[0]?.n)).toBe(1);
  });

  it('el mateix id reenviat no duplica res', async () => {
    const id = uuidv7();
    const primera = await api('POST', '/api/v1/scopes', {
      id,
      name: 'Techie',
      color: '--plou-orange',
    });
    const segona = await api('POST', '/api/v1/scopes', {
      id,
      name: 'Techie',
      color: '--plou-orange',
    });

    expect(primera.statusCode).toBe(201);
    expect(segona.statusCode).toBe(200);
    expect(segona.json<{ id: string }>().id).toBe(id);
  });

  it('els llista en ordre de posició', async () => {
    const res = await api('GET', '/api/v1/scopes');
    expect(res.statusCode).toBe(200);
    const scopes = res.json<{ id: string; position: string }[]>();
    expect(scopes.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < scopes.length; i += 1) {
      expect(comparePositions(scopes[i - 1]!.position, scopes[i]!.position)).toBe(-1);
    }
  });
});

describe('AQUESTA és la de docs/13: una tasca sense àmbit es rebutja', () => {
  it('sense scope_id dona 422 i ho explica', async () => {
    const res = await api('POST', '/api/v1/tasks', { title: 'Sense àmbit' });
    expect(res.statusCode).toBe(422);

    const problem = res.json<{ detail: string; title: string }>();
    expect(problem.title).toBe('Scope required');
    // L'error diu la invariant amb paraules. Un 422 mut no li serveix de res a ningú.
    expect(problem.detail).toContain('àmbit');
  });

  it('amb scope_id buit, igual', async () => {
    const res = await api('POST', '/api/v1/tasks', { title: 'Buit', scope_id: '' });
    expect(res.statusCode).toBe(422);
  });

  it('i sense títol també es rebutja', async () => {
    const res = await api('POST', '/api/v1/tasks', { scope_id: scopePersonal, title: '   ' });
    expect(res.statusCode).toBe(422);
  });

  it('a un àmbit que no es veu, dona 403 dient quins es veuen', async () => {
    const res = await api('POST', '/api/v1/tasks', {
      scope_id: uuidv7(),
      title: 'A un àmbit inventat',
    });
    expect(res.statusCode).toBe(403);
    expect(res.json<{ detail: string }>().detail).toContain('àmbit');
  });
});

describe('tasques', () => {
  it("a un àmbit individual s'assignen soles al propietari", async () => {
    // docs/01 §4: "A un àmbit individual totes les tasques s'assignen automàticament
    // al propietari. No es demana."
    const res = await api('POST', '/api/v1/tasks', {
      scope_id: scopePersonal,
      title: 'Comprar pa',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json<{ assignee_ids: string[] }>().assignee_ids).toEqual([userId]);
  });

  it("a un de col·lectiu no s'assigna sola a ningú", async () => {
    const res = await api('POST', '/api/v1/tasks', {
      scope_id: scopeFamilia,
      title: 'Fer la maleta',
    });
    expect(res.json<{ assignee_ids: string[] }>().assignee_ids).toEqual([]);
  });

  it('neixen a la bústia i en mode manual', async () => {
    const res = await api('POST', '/api/v1/tasks', {
      scope_id: scopePersonal,
      title: 'Una tasca nova',
    });
    const task = res.json<{ status: string; ai_mode: string }>();
    // Tota tasca neix `manual`: afegir un tercer selector al camp d'afegida trencaria
    // la premissa que escriure una tasca és escriure i prémer Enter (docs/09 §2).
    expect(task.status).toBe('inbox');
    expect(task.ai_mode).toBe('manual');
  });

  it('el client pot posar la seva posició, que és el camí normal', async () => {
    const res = await api('POST', '/api/v1/tasks', {
      scope_id: scopePersonal,
      title: 'Amb posició de client',
      position: 'a5',
    });
    expect(res.json<{ position: string }>().position).toBe('a5');
  });
});

describe("AQUESTA és la de docs/13: moure entre columnes conserva l'ordre", () => {
  it('mou de columna i manté la seqüència', async () => {
    const scope = (
      await api('POST', '/api/v1/scopes', { name: 'Moviments', color: '--femho-scope-1' })
    ).json<{ id: string }>().id;

    // Cinc tasques a la bústia.
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const res = await api('POST', '/api/v1/tasks', { scope_id: scope, title: `Tasca ${i}` });
      ids.push(res.json<{ id: string }>().id);
    }

    const ordre = async (status: string): Promise<string[]> => {
      const res = await api('GET', `/api/v1/tasks?scope_id=${scope}&status=${status}`);
      return res.json<{ data: { id: string }[] }>().data.map((t) => t.id);
    };

    expect(await ordre('inbox')).toEqual(ids);

    // Es mouen la 2a i la 4a a "todo", en aquest ordre.
    for (const id of [ids[1]!, ids[3]!]) {
      const res = await api('POST', `/api/v1/tasks/${id}/move`, { status: 'todo' });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ status: string }>().status).toBe('todo');
    }

    // A la bústia queden les altres tres, en el mateix ordre relatiu.
    expect(await ordre('inbox')).toEqual([ids[0], ids[2], ids[4]]);
    // I a "todo" hi són les dues, en l'ordre en què s'hi han mogut.
    expect(await ordre('todo')).toEqual([ids[1], ids[3]]);
  });

  it('el servidor sap calcular la posició des dels veïns, per a clients simples', async () => {
    const scope = (
      await api('POST', '/api/v1/scopes', { name: 'Veïns', color: '--femho-scope-2' })
    ).json<{
      id: string;
    }>().id;

    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const res = await api('POST', '/api/v1/tasks', { scope_id: scope, title: `T${i}` });
      ids.push(res.json<{ id: string }>().id);
    }

    // La tercera es mou entre la primera i la segona, sense donar posició.
    const res = await api('POST', `/api/v1/tasks/${ids[2]}/move`, {
      before_id: ids[0],
      after_id: ids[1],
    });
    expect(res.statusCode).toBe(200);

    const llista = await api('GET', `/api/v1/tasks?scope_id=${scope}`);
    expect(llista.json<{ data: { id: string }[] }>().data.map((t) => t.id)).toEqual([
      ids[0],
      ids[2],
      ids[1],
    ]);
  });

  it('moure deixa rastre amb el valor anterior i el nou', async () => {
    const scope = (
      await api('POST', '/api/v1/scopes', { name: 'Rastre', color: '--femho-scope-3' })
    ).json<{
      id: string;
    }>().id;
    const id = (
      await api('POST', '/api/v1/tasks', { scope_id: scope, title: 'Amb historial' })
    ).json<{ id: string }>().id;

    await api('POST', `/api/v1/tasks/${id}/move`, { status: 'doing' });

    const entrada = await sql<{ verb: string; changes: string }>`
      SELECT verb, changes FROM activity_log
      WHERE entity_id = ${id} AND verb = 'moved' ORDER BY created_at DESC LIMIT 1
    `.execute(conn.db);

    const fila = entrada.rows[0];
    expect(fila?.verb).toBe('moved');
    // És el que fa possible desfer un canvi autònom de la IA (docs/01 §7).
    const changes = JSON.parse(fila?.changes ?? '{}') as Record<
      string,
      { from: string; to: string }
    >;
    expect(changes.status?.from).toBe('inbox');
    expect(changes.status?.to).toBe('doing');
  });
});

describe('completar', () => {
  it('marca la tasca i les seves subtasques', async () => {
    const scope = (
      await api('POST', '/api/v1/scopes', { name: 'Completar', color: '--femho-scope-4' })
    ).json<{ id: string }>().id;
    const id = (
      await api('POST', '/api/v1/tasks', { scope_id: scope, title: 'Amb subtasques' })
    ).json<{ id: string }>().id;

    await sql`
      INSERT INTO subtasks (id, task_id, title, done, position, created_at, updated_at, version)
      VALUES (${uuidv7()}, ${id}, 'Una subtasca', 0, 'a1', ${NOW}, ${NOW}, 1)
    `.execute(conn.db);

    const res = await api('POST', `/api/v1/tasks/${id}/complete`);
    expect(res.statusCode).toBe(200);

    const task = res.json<{ status: string; completed_at: string | null }>();
    expect(task.status).toBe('done');
    expect(task.completed_at).toBeTruthy();

    const pendents = await sql<{ n: number }>`
      SELECT COUNT(*) AS n FROM subtasks WHERE task_id = ${id} AND done = 0
    `.execute(conn.db);
    expect(Number(pendents.rows[0]?.n)).toBe(0);
  });
});

describe('AQUESTA és la de docs/13: /board retorna les quatre columnes', () => {
  it('sempre les quatre, agrupades per àmbit', async () => {
    const res = await api('GET', '/api/v1/board');
    expect(res.statusCode).toBe(200);

    const board = res.json<{
      columns: { status: string; groups: { scope_id: string; tasks: unknown[] }[] }[];
    }>();

    // Sempre les QUATRE, encara que alguna sigui buida: si les buides desapareguessin,
    // la interfície hauria de saber quines existeixen pel seu compte.
    expect(board.columns.map((c) => c.status)).toEqual(['inbox', 'todo', 'doing', 'done']);

    const inbox = board.columns.find((c) => c.status === 'inbox');
    expect(inbox?.groups.length).toBeGreaterThan(1);
    // Els grups porten l'àmbit, que és el que la interfície fa servir per als epígrafs
    // plegables (docs/02 §4).
    for (const group of inbox?.groups ?? []) {
      expect(group.scope_id).toBeTruthy();
    }
  });

  it('es pot limitar als àmbits actius', async () => {
    const res = await api('GET', `/api/v1/board?scope_ids=${scopePersonal}`);
    const board = res.json<{ columns: { groups: { scope_id: string }[] }[] }>();

    for (const column of board.columns) {
      for (const group of column.groups) {
        expect(group.scope_id).toBe(scopePersonal);
      }
    }
  });
});

describe("l'abast del token val també per a les tasques", () => {
  it('un token limitat a un àmbit no en veu les tasques dels altres', async () => {
    const { token, hash, prefix } = generateApiToken();
    await sql`
      INSERT INTO api_tokens (id, user_id, name, token_prefix, token_hash, capabilities, scope_ids, created_at)
      VALUES (${uuidv7()}, ${userId}, 'Només personal', ${prefix}, ${hash},
              ${JSON.stringify(['tasks:read', 'tasks:write', 'scopes:read', 'projects:read'])},
              ${JSON.stringify([scopePersonal])}, ${NOW})
    `.execute(conn.db);

    const limitat = { authorization: `Bearer ${token}` };

    const scopes = await api('GET', '/api/v1/scopes', undefined, limitat);
    expect(scopes.json<{ id: string }[]>().map((s) => s.id)).toEqual([scopePersonal]);

    const board = await api('GET', '/api/v1/board', undefined, limitat);
    for (const column of board.json<{ columns: { groups: { scope_id: string }[] }[] }>().columns) {
      for (const group of column.groups) {
        expect(group.scope_id).toBe(scopePersonal);
      }
    }

    // I escriure a un àmbit que el token no veu es rebutja dient-ho.
    const rebutjada = await api(
      'POST',
      '/api/v1/tasks',
      { scope_id: scopeFamilia, title: 'No hauria de poder' },
      limitat,
    );
    expect(rebutjada.statusCode).toBe(403);
    expect(rebutjada.json<{ detail: string }>().detail).toContain('Personal');
  });
});
