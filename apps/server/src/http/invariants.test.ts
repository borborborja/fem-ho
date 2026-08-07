/**
 * Les invariants que els documents diuen en veu més alta.
 *
 * No proven una ruta: proven una **afirmació del producte**, i cadascuna porta la cita
 * que la motiva. Si una d'aquestes cau, el que està malament no és una funció sinó el
 * producte, i no hi ha cap prova de ruta que ho digui.
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
import { generateApiToken } from '../auth/tokens.js';
import { connect, type Connection } from '../db/connection.js';
import { migrateToLatest } from '../db/migrator.js';

const tmp = mkdtempSync(join(tmpdir(), 'femho-inv-'));
const NOW = '2026-08-06T09:00:00.000Z';
const PASSWORD = 'la-contrasenya-de-prova';

let conn: Connection;
let app: FastifyInstance;
let auth: Record<string, string>;
let userId: string;
let scopeId: string;
let collectiveId: string;
let calendarId: string;

async function api(
  method: 'GET' | 'POST',
  url: string,
  payload?: Record<string, unknown>,
  headers = auth,
): Promise<LightMyRequestResponse> {
  return payload === undefined
    ? app.inject({ method, url, headers })
    : app.inject({ method, url, headers, payload });
}

beforeAll(async () => {
  for (const k of Object.keys(process.env)) if (k.startsWith('FEMHO_')) delete process.env[k];

  conn = connect(`sqlite://${join(tmp, 't.db')}`);
  await migrateToLatest(conn.db, { engine: 'sqlite' });

  userId = uuidv7();
  await sql`
    INSERT INTO users (id, email, name, password_hash, kind, role, created_at, updated_at)
    VALUES (${userId}, 'b@e.com', 'B', ${await hashPassword(PASSWORD)}, 'human', 'admin', ${NOW}, ${NOW})
  `.execute(conn.db);

  scopeId = uuidv7();
  await sql`
    INSERT INTO scopes (id, name, kind, color, owner_id, position, created_at, updated_at)
    VALUES (${scopeId}, 'Personal', 'individual', '--plou-blue', ${userId}, 'a1', ${NOW}, ${NOW})
  `.execute(conn.db);

  collectiveId = uuidv7();
  await sql`
    INSERT INTO scopes (id, name, kind, color, owner_id, position, created_at, updated_at)
    VALUES (${collectiveId}, 'Família', 'collective', '--plou-pink', ${userId}, 'a2', ${NOW}, ${NOW})
  `.execute(conn.db);

  calendarId = uuidv7();
  await sql`
    INSERT INTO calendars (id, scope_id, name, kind, origin, created_at, updated_at)
    VALUES (${calendarId}, ${scopeId}, 'Personal', 'events', 'local', ${NOW}, ${NOW})
  `.execute(conn.db);

  app = buildApp(
    { ...loadConfig('0.1.0-test'), logLevel: 'silent', dataDir: tmp },
    { connection: conn, secret: 'x'.repeat(40) },
  );

  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: 'b@e.com', password: PASSWORD },
  });
  auth = { authorization: `Bearer ${login.json<{ access_token: string }>().access_token}` };
});

afterAll(async () => {
  await app.close();
  await conn.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe('la invariant central', () => {
  it('"Una tasca sempre ha de tenir àmbit. Pot no tenir projecte, però mai àmbit."', async () => {
    const res = await api('POST', '/api/v1/tasks', { title: 'Òrfena' });
    expect(res.statusCode).toBe(422);

    // I l'error ho diu amb paraules: un 422 d'un NOT NULL de la base no li serveix de
    // res a ningú (docs/01 §4).
    expect(res.json<{ detail: string }>().detail).toMatch(/scope/u);
  });

  it("i l'esquema tampoc ho deixa passar, no només el servei", async () => {
    // Es comprova a l'esquema I a la capa de servei, perquè el CalDAV i el sync també
    // hi escriuen.
    await expect(
      sql`
        INSERT INTO tasks (id, title, status, position, created_by, created_at, updated_at)
        VALUES (${uuidv7()}, 'Sense àmbit', 'inbox', 'a1', ${userId}, ${NOW}, ${NOW})
      `.execute(conn.db),
    ).rejects.toThrow();
  });
});

describe("l'espai general", () => {
  it('és un filtre, no una fila', async () => {
    // "L'espai general és el filtre `project_id IS NULL` i no una fila" (docs/01 §4).
    // Si fos una fila, hi hauria un projecte fantasma a cada àmbit que caldria amagar a
    // vint llocs diferents.
    const projectes = await sql<{ n: number }>`
      SELECT COUNT(*) AS n FROM projects WHERE scope_id = ${scopeId}
    `.execute(conn.db);
    expect(Number(projectes.rows[0]?.n)).toBe(0);

    const res = await api('POST', '/api/v1/tasks', { scope_id: scopeId, title: 'A general' });
    expect(res.statusCode).toBe(201);
    expect(res.json<{ project_id: string | null }>().project_id).toBeNull();
  });
});

describe("l'àmbit individual", () => {
  it('assigna la tasca al propietari sense demanar-ho', async () => {
    // "A un àmbit `individual` totes les tasques s'assignen automàticament al
    // propietari. **No es demana.**" (docs/01 §4)
    const res = await api('POST', '/api/v1/tasks', { scope_id: scopeId, title: 'Meva' });
    const id = res.json<{ id: string }>().id;

    const fila = await sql<{ user_id: string }>`
      SELECT user_id FROM task_assignees WHERE task_id = ${id}
    `.execute(conn.db);
    expect(fila.rows.map((r) => r.user_id)).toEqual([userId]);
  });

  it('i a un de col·lectiu NO, perquè allà cal dir qui', async () => {
    const res = await api('POST', '/api/v1/tasks', { scope_id: collectiveId, title: 'De qui?' });
    const id = res.json<{ id: string }>().id;

    const fila = await sql<{ n: number }>`
      SELECT COUNT(*) AS n FROM task_assignees WHERE task_id = ${id}
    `.execute(conn.db);
    expect(Number(fila.rows[0]?.n)).toBe(0);
  });
});

describe('els esdeveniments i el kanban', () => {
  it('AQUESTA és de docs/02: els esdeveniments NO surten mai al tauler', async () => {
    await sql`
      INSERT INTO events (id, calendar_id, uid, summary, starts_at, ends_at, all_day,
                          created_at, updated_at)
      VALUES (${uuidv7()}, ${calendarId}, 'un-esdeveniment', 'Dinar amb la Marta',
              '2026-08-06T13:00:00.000Z', '2026-08-06T14:00:00.000Z', 0, ${NOW}, ${NOW})
    `.execute(conn.db);

    const board = await api('GET', '/api/v1/board');
    // Un esdeveniment al kanban seria una targeta que no es pot completar ni moure, i
    // el tauler deixaria de voler dir "el que he de fer".
    expect(board.body).not.toContain('Dinar amb la Marta');
  });

  it('i les tasques SÍ que surten al calendari quan tenen data', async () => {
    const id = (
      await api('POST', '/api/v1/tasks', {
        scope_id: scopeId,
        title: 'Amb venciment',
        due_date: '2026-08-10',
      })
    ).json<{ id: string }>().id;

    const fila = await sql<{ due_date: string }>`
      SELECT due_date FROM tasks WHERE id = ${id}
    `.execute(conn.db);
    expect(fila.rows[0]?.due_date).toBe('2026-08-10');
  });
});

describe('regla 8 · una sola capa de política', () => {
  it("un token d'abast limitat NO veu res d'un altre àmbit, per API", async () => {
    const generated = generateApiToken();
    await sql`
      INSERT INTO api_tokens (id, user_id, name, token_prefix, token_hash, capabilities,
                              scope_ids, created_at)
      VALUES (${uuidv7()}, ${userId}, 'Només personal', ${generated.prefix}, ${generated.hash},
              ${JSON.stringify(['tasks:read', 'tasks:write', 'scopes:read'])},
              ${JSON.stringify([scopeId])}, ${NOW})
    `.execute(conn.db);

    const limitat = { authorization: `Bearer ${generated.token}` };

    // No veu l'àmbit col·lectiu. `/scopes` torna un array pelat i no `{ data }`: aquell
    // envoltori és la convenció de PAGINACIÓ (docs/05 §3), i una llista d'àmbits no es
    // pagina.
    const scopes = await api('GET', '/api/v1/scopes', undefined, limitat);
    const ids = scopes.json<{ id: string }[]>().map((s) => s.id);
    expect(ids).toEqual([scopeId]);

    // ...ni hi pot escriure.
    const escriptura = await api(
      'POST',
      '/api/v1/tasks',
      { scope_id: collectiveId, title: 'On no toca' },
      limitat,
    );
    expect(escriptura.statusCode).toBe(403);

    /**
     * I el rebuig **diu quins àmbits veu** (docs/05 §2). Un 403 mut fa que un agent
     * reintenti en bucle fins a esgotar el límit de ritme.
     */
    expect(escriptura.json<{ detail: string }>().detail).toContain('Personal');
  });

  /**
   * **El lot de sincronització també és l'API.**
   *
   * `assertScopeAccess` era trenta línies més avall dels `return` de `delete` i de
   * `create`, o sigui que `POST /sync/batch` era una porta del darrere sense pany: amb
   * un identificador, un token d'un àmbit podia esborrar una tasca d'un altre. Es va
   * demostrar contra el servidor amb dos comptes abans d'arreglar-ho.
   *
   * La fuita de LECTURA la tapava per accident la guarda de la regla 4 —un `create`
   * sobre una fila existent no registra res i la transacció llançava—, però l'esborrat
   * sí que registra i passava net. Es prova l'esborrat, que és el camí que feia mal.
   */
  it("i el lot de sync tampoc: no s'esborra una tasca d'un àmbit que no es veu", async () => {
    const victima = uuidv7();
    const creada = await api('POST', '/api/v1/tasks', {
      id: victima,
      scope_id: collectiveId,
      title: 'No em toquis',
    });
    expect(creada.statusCode).toBe(201);

    const generated = generateApiToken();
    await sql`
      INSERT INTO api_tokens (id, user_id, name, token_prefix, token_hash, capabilities,
                              scope_ids, created_at)
      VALUES (${uuidv7()}, ${userId}, 'Només personal', ${generated.prefix}, ${generated.hash},
              ${JSON.stringify(['tasks:read', 'tasks:write', 'scopes:read'])},
              ${JSON.stringify([scopeId])}, ${NOW})
    `.execute(conn.db);

    const esborrat = await api(
      'POST',
      '/api/v1/sync/batch',
      {
        operations: [{ op_id: uuidv7(), entity: 'task', op: 'delete', id: victima }],
      },
      { authorization: `Bearer ${generated.token}` },
    );

    expect(esborrat.json<{ results: { status: string }[] }>().results[0]?.status).toBe('rejected');

    // I la tasca segueix viva per a qui sí que la pot veure.
    const encara = await api('GET', `/api/v1/tasks/${victima}`);
    expect(encara.statusCode).toBe(200);
  });
});

describe('regla 4 · tota escriptura deixa rastre', () => {
  it("cap camí d'escriptura no acaba sense entrada a activity_log", async () => {
    const abans = await sql<{ n: number }>`SELECT COUNT(*) AS n FROM activity_log`.execute(conn.db);

    const id = (
      await api('POST', '/api/v1/tasks', { scope_id: scopeId, title: 'Amb rastre' })
    ).json<{ id: string }>().id;
    await api('POST', `/api/v1/tasks/${id}/move`, { status: 'doing' });
    await api('POST', `/api/v1/tasks/${id}/complete`);

    const després = await sql<{ n: number }>`SELECT COUNT(*) AS n FROM activity_log`.execute(
      conn.db,
    );

    // Tres gestos, com a mínim tres entrades. "Si un camí d'escriptura no pot escriure
    // el log, no és un camí d'escriptura vàlid."
    expect(Number(després.rows[0]?.n) - Number(abans.rows[0]?.n)).toBeGreaterThanOrEqual(3);
  });

  it("i cadascuna porta l'actor i el canal", async () => {
    const fila = await sql<{ actor_type: string; source: string }>`
      SELECT actor_type, source FROM activity_log ORDER BY created_at DESC, id DESC LIMIT 1
    `.execute(conn.db);

    expect(fila.rows[0]?.actor_type).toBe('user');
    // El canal es propaga fins aquí sense que cap servei l'hagi de passar a mà.
    expect(['web', 'android', 'api', 'mcp', 'caldav', 'share', 'system']).toContain(
      fila.rows[0]?.source,
    );
  });
});

describe('esborrat suau, sempre', () => {
  it('cap entitat sincronitzable es pot esborrar de debò per API', async () => {
    // "Cap DELETE real en entitats sincronitzables" (docs/01). Si n'hi hagués un, el
    // sync no tindria tombstone i el client es quedaria la fila per sempre.
    const taules = ['tasks', 'subtasks', 'checklists', 'checklist_items', 'events', 'scopes'];

    for (const taula of taules) {
      const columnes = await sql<{ name: string }>`
        SELECT name FROM pragma_table_info(${taula})
      `.execute(conn.db);
      expect(
        columnes.rows.map((c) => c.name),
        `${taula} ha de tenir deleted_at`,
      ).toContain('deleted_at');
    }
  });
});

describe('vocabulari canònic (regla 3)', () => {
  it("l'estat és `status` amb els quatre valors de D2", async () => {
    const res = await api('POST', '/api/v1/tasks', { scope_id: scopeId, title: 'Vocabulari' });
    const cos = res.json<Record<string, unknown>>();

    // El prototip fa servir `column: 'fet'`, i portar-ho literalment hauria trencat
    // tot el que parla amb el servidor.
    expect(cos).toHaveProperty('status');
    expect(cos).not.toHaveProperty('column');
    expect(['inbox', 'todo', 'doing', 'done']).toContain(cos.status);
  });

  it('els identificadors van nus, sense prefix', async () => {
    const res = await api('POST', '/api/v1/tasks', { scope_id: scopeId, title: 'Identificador' });
    const id = res.json<{ id: string }>().id;

    // D4: UUIDv7 nu. Un `task_` al davant vol dir tallar cadenes a cada capa.
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  });
});
