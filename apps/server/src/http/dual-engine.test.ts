/**
 * Els camins d'escriptura, **als dos motors** (D11).
 *
 * Fins ara l'única cosa que s'executava contra Postgres eren les migracions i unes
 * quantes curses. Tota la resta de la capa de servei només havia corregut mai contra
 * SQLite, i això va deixar passar un error dur i silenciós:
 *
 * ```
 * UPDATE subtasks SET done = 1 WHERE done = 0
 * ```
 *
 * A SQLite un booleà és un INTEGER i això funciona. A Postgres és un `boolean` de
 * veritat i la sentència ni tan sols s'analitza: `operator does not exist: boolean =
 * integer`. Tot el camí de llistes senzilles, la cascada amunt, les tasques per CalDAV,
 * els esdeveniments de tot el dia i els enllaços compartits amb nom obligatori feien
 * exactament això. Cinc funcionalitats senceres que a Postgres no havien funcionat mai.
 *
 * Aquesta suite no busca curses: busca **diferències de dialecte**. Cada prova toca un
 * camí que escriu o compara un booleà, una data o un `ON CONFLICT`, que és on els dos
 * motors divergeixen. Si Postgres no hi és, **es diu** i no es passa de llarg.
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
import { connectTestSchema, type TestSchema } from '../db/test-postgres.js';
import { migrateToLatest } from '../db/migrator.js';

const NOW = '2026-08-06T09:00:00.000Z';
const PASSWORD = 'la-contrasenya-de-prova';

const pgUrl = process.env.FEMHO_TEST_POSTGRES_URL;
const MOTORS: { engine: 'sqlite' | 'postgres'; url: string | null }[] = [
  { engine: 'sqlite', url: null },
];
if (pgUrl !== undefined && pgUrl !== '') MOTORS.push({ engine: 'postgres', url: pgUrl });

describe.each(MOTORS)('motor $engine', (motor) => {
  let tmp: string;
  let conn: Connection;
  let schema: TestSchema | null = null;
  let app: FastifyInstance;
  let auth: Record<string, string>;
  let userId: string;
  let scopeId: string;

  async function api(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    payload?: Record<string, unknown>,
  ): Promise<LightMyRequestResponse> {
    return payload === undefined
      ? app.inject({ method, url, headers: auth })
      : app.inject({ method, url, headers: auth, payload });
  }

  beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'femho-dual-'));
    // Esquema propi: tres suites comparteixen la base i esborrar `public` les feia
    // xocar entre elles (veure `db/test-postgres.ts`).
    schema = motor.url === null ? null : await connectTestSchema(motor.url, 'dual_engine');
    conn = schema ?? connect(`sqlite://${join(tmp, 't.db')}`);

    await migrateToLatest(conn.db, { engine: motor.engine });

    userId = uuidv7();
    await sql`
      INSERT INTO users (id, email, name, password_hash, kind, role, created_at, updated_at)
      VALUES (${userId}, 'b@e.com', 'Borja', ${await hashPassword(PASSWORD)}, 'human', 'admin',
              ${NOW}, ${NOW})
    `.execute(conn.db);

    scopeId = uuidv7();
    await sql`
      INSERT INTO scopes (id, name, kind, color, owner_id, position, created_at, updated_at)
      VALUES (${scopeId}, 'Casa', 'individual', '--plou-blue', ${userId}, 'a1', ${NOW}, ${NOW})
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
    if (schema !== null) await schema.drop();
    else await conn.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  async function novaTasca(title: string): Promise<string> {
    const res = await api('POST', '/api/v1/tasks', { scope_id: scopeId, title });
    expect(res.statusCode, res.body).toBeLessThan(400);
    return res.json<{ id: string }>().id;
  }

  describe('llistes senzilles', () => {
    it('crear una llista i un ítem no peta a cap motor', async () => {
      const taskId = await novaTasca('Amb llista');

      const llista = await api('POST', `/api/v1/tasks/${taskId}/checklists`, { name: 'Compra' });
      expect(llista.statusCode, llista.body).toBe(201);

      const item = await api(
        'POST',
        `/api/v1/checklists/${llista.json<{ id: string }>().id}/items`,
        {
          text: 'Pa',
        },
      );
      expect(item.statusCode, item.body).toBe(201);
      expect(item.json<{ done: boolean }>().done).toBe(false);
    });

    it('marcar un ítem el deixa fet, i desmarcar-lo el desfà', async () => {
      const taskId = await novaTasca('Per marcar');
      const listId = (
        await api('POST', `/api/v1/tasks/${taskId}/checklists`, { name: 'Coses' })
      ).json<{ id: string }>().id;
      const itemId = (
        await api('POST', `/api/v1/checklists/${listId}/items`, { text: 'Una' })
      ).json<{ id: string }>().id;

      const marcat = await api('PATCH', `/api/v1/checklist-items/${itemId}`, { done: true });
      expect(marcat.statusCode, marcat.body).toBeLessThan(400);

      const fet = await sql<{ done: unknown }>`
        SELECT done FROM checklist_items WHERE id = ${itemId}
      `.execute(conn.db);
      expect(fet.rows[0]?.done === 1 || fet.rows[0]?.done === true).toBe(true);

      await api('PATCH', `/api/v1/checklist-items/${itemId}`, { done: false });
      const desfet = await sql<{ done: unknown }>`
        SELECT done FROM checklist_items WHERE id = ${itemId}
      `.execute(conn.db);
      expect(desfet.rows[0]?.done === 0 || desfet.rows[0]?.done === false).toBe(true);
    });

    it('AQUESTA és la que Postgres no havia passat mai: la cascada amunt', async () => {
      const taskId = await novaTasca('Amb cascada');

      const subtaskId = uuidv7();
      await sql`
        INSERT INTO subtasks (id, task_id, title, position, created_at, updated_at, version)
        VALUES (${subtaskId}, ${taskId}, 'Subtasca', 'a1', ${NOW}, ${NOW}, 1)
      `.execute(conn.db);

      const listId = (
        await api('POST', `/api/v1/tasks/${taskId}/checklists`, {
          name: 'La llista',
          subtask_id: subtaskId,
        })
      ).json<{ id: string }>().id;

      const itemId = (
        await api('POST', `/api/v1/checklists/${listId}/items`, { text: "L'últim" })
      ).json<{ id: string }>().id;

      const res = await api('PATCH', `/api/v1/checklist-items/${itemId}`, { done: true });
      expect(res.statusCode, res.body).toBeLessThan(400);

      // Marcar l'últim ítem marca la subtasca ancorada i, si tot està fet, la tasca (P1).
      const cascada = res.json<{
        cascade: { subtask_completed: boolean; task_completed: boolean };
      }>();
      expect(cascada.cascade.subtask_completed).toBe(true);
      expect(cascada.cascade.task_completed).toBe(true);

      const subtasca = await sql<{ done: unknown }>`
        SELECT done FROM subtasks WHERE id = ${subtaskId}
      `.execute(conn.db);
      expect(subtasca.rows[0]?.done === 1 || subtasca.rows[0]?.done === true).toBe(true);
    });

    it('pinejar i despinejar una llista', async () => {
      const taskId = await novaTasca('Per pinejar');
      const listId = (
        await api('POST', `/api/v1/tasks/${taskId}/checklists`, { name: 'Pinejable' })
      ).json<{ id: string }>().id;

      expect((await api('POST', `/api/v1/checklists/${listId}/pin`)).statusCode).toBe(204);

      const pinejades = await api('GET', '/api/v1/pinned-checklists');
      expect(pinejades.json<{ id: string }[]>().map((c) => c.id)).toContain(listId);

      expect((await api('DELETE', `/api/v1/checklists/${listId}/pin`)).statusCode).toBe(204);
      const després = await api('GET', '/api/v1/pinned-checklists');
      expect(després.json<{ id: string }[]>().map((c) => c.id)).not.toContain(listId);
    });
  });

  describe('completar una tasca', () => {
    it('tanca les subtasques que quedaven obertes', async () => {
      const taskId = await novaTasca('Amb subtasques obertes');
      const subtaskId = uuidv7();
      await sql`
        INSERT INTO subtasks (id, task_id, title, position, created_at, updated_at, version)
        VALUES (${subtaskId}, ${taskId}, 'Oberta', 'a1', ${NOW}, ${NOW}, 1)
      `.execute(conn.db);

      const res = await api('POST', `/api/v1/tasks/${taskId}/complete`);
      expect(res.statusCode, res.body).toBeLessThan(400);

      const subtasca = await sql<{ done: unknown }>`
        SELECT done FROM subtasks WHERE id = ${subtaskId}
      `.execute(conn.db);
      expect(subtasca.rows[0]?.done === 1 || subtasca.rows[0]?.done === true).toBe(true);
    });
  });

  describe('esdeveniments de tot el dia', () => {
    it("`all_day` s'escriu i es llegeix igual als dos motors", async () => {
      const calendarId = uuidv7();
      await sql`
        INSERT INTO calendars (id, scope_id, name, kind, origin, created_at, updated_at)
        VALUES (${calendarId}, ${scopeId}, 'Casa', 'events', 'local', ${NOW}, ${NOW})
      `.execute(conn.db);

      const res = await api('POST', '/api/v1/events', {
        calendar_id: calendarId,
        summary: 'Aniversari',
        starts_at: '2026-09-01',
        ends_at: '2026-09-02',
        all_day: true,
      });
      expect(res.statusCode, res.body).toBeLessThan(400);

      const fila = await sql<{ all_day: unknown }>`
        SELECT all_day FROM events WHERE summary = 'Aniversari'
      `.execute(conn.db);
      expect(fila.rows[0]?.all_day === 1 || fila.rows[0]?.all_day === true).toBe(true);
    });
  });

  describe('enllaços compartits', () => {
    it('un enllaç que demana nom es crea sense petar', async () => {
      const taskId = await novaTasca('Per compartir');
      const res = await api('POST', '/api/v1/shares', {
        task_id: taskId,
        permission: 'view',
        require_name: true,
      });
      expect(res.statusCode, res.body).toBeLessThan(400);

      const fila = await sql<{ require_name: unknown }>`
        SELECT require_name FROM shares WHERE task_id = ${taskId}
      `.execute(conn.db);
      expect(fila.rows[0]?.require_name === 1 || fila.rows[0]?.require_name === true).toBe(true);
    });
  });
});

describe("què s'ha provat", () => {
  it('diu si Postgres ha quedat fora', () => {
    const provats = MOTORS.map((m) => m.engine);
    if (!provats.includes('postgres')) {
      console.warn(
        "\n  AVÍS · Els camins d'escriptura NO s'han provat a Postgres. Posa FEMHO_TEST_POSTGRES_URL.\n" +
          '  Les diferències de dialecte —booleans, dates, ON CONFLICT— no es veuen a SQLite.\n',
      );
    }
    expect(provats).toContain('sqlite');
  });
});
