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

  it('desa els camps d’una tasca delegada des de la creació i manté les instruccions en repetir-la', async () => {
    const fields = {
      ai_mode: 'delegated',
      ai_instructions: 'Comprova les dades abans de respondre.',
      due_date: '2031-05-04',
      due_time: '09:35',
      deadline: '2031-05-05T14:37:15.000Z',
      rrule: 'FREQ=WEEKLY',
      recurrence_mode: 'schedule',
    };
    const created = await api('POST', '/api/v1/tasks', {
      scope_id: scopeId,
      title: 'Una tasca amb instruccions i dates',
      ...fields,
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json()).toMatchObject(fields);
    const id = created.json<{ id: string }>().id;

    const edited = await api('PATCH', `/api/v1/tasks/${id}`, { title: 'Nom corregit' });
    expect(edited.statusCode, edited.body).toBe(200);
    const stored = await api('GET', `/api/v1/tasks/${id}`);
    expect(stored.json()).toMatchObject({ ...fields, title: 'Nom corregit' });

    const done = await api('POST', `/api/v1/tasks/${id}/complete`);
    expect(done.statusCode, done.body).toBe(200);
    const following = await api('GET', '/api/v1/tasks?due_from=2031-05-11&due_to=2031-05-11');
    expect(following.json()).toMatchObject({
      data: [
        {
          recurrence_parent_id: id,
          due_date: '2031-05-11',
          ai_mode: 'delegated',
          ai_instructions: fields.ai_instructions,
        },
      ],
    });
  });

  it('lliura la tasca històrica amb els seus fills i no els duplica en un reintent', async () => {
    await sql`UPDATE users SET timezone = 'Europe/Madrid' WHERE id = ${userId}`.execute(conn.db);
    const label = await api('POST', '/api/v1/labels', { scope_id: scopeId, name: 'Documentada' });
    expect(label.statusCode, label.body).toBe(201);
    const labelId = label.json<{ id: string }>().id;
    const context = await api('GET', `/api/v1/task-context?scope_id=${scopeId}`);
    expect(context.statusCode, context.body).toBe(200);
    expect(context.json()).toMatchObject({
      timezone: 'Europe/Madrid',
      details: { scope_id: scopeId, assignees: [{ id: userId }], labels: [{ id: labelId }] },
    });
    const id = uuidv7();
    const input = {
      id,
      scope_id: scopeId,
      title: 'Acta finalitzada',
      description: 'Descripció completa',
      status: 'done',
      completed_at: '2024-05-11',
      due_date: '2024-05-11',
      due_time: '12:30',
      rrule: 'FREQ=DAILY',
      assignee_ids: [userId, userId],
      label_ids: [labelId],
      checklists: [{ name: 'A la tasca', items: [{ text: 'Revisat', done: true }] }],
      subtasks: [
        {
          title: 'Redacció',
          done: true,
          checklists: [{ name: 'A la subtasca', items: [{ text: 'Esborrany' }] }],
        },
      ],
      comments: [{ body: 'Verificat' }],
    };

    const created = await api('POST', '/api/v1/tasks', input);
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json()).toMatchObject({
      id,
      completed_at: '2024-05-10T22:00:00.000Z',
      label_ids: [labelId],
      assignee_ids: [userId],
      status: 'done',
      progress: { total: 3, done: 2, lists: 3 },
    });
    expect((await api('POST', '/api/v1/tasks', input)).statusCode).toBe(200);
    const subs = (await api('GET', `/api/v1/tasks/${id}/subtasks`)).json<{ id: string }[]>();
    expect(subs).toEqual([expect.objectContaining({ title: 'Redacció', done: true })]);
    const lists = (await api('GET', `/api/v1/tasks/${id}/checklists`)).json();
    expect(lists).toMatchObject([
      { name: 'A la tasca', subtask_id: null, items: [{ text: 'Revisat', done: true }] },
      {
        name: 'A la subtasca',
        subtask_id: subs[0]!.id,
        items: [{ text: 'Esborrany', done: false }],
      },
    ]);
    const comments = (await api('GET', `/api/v1/tasks/${id}/comments`)).json();
    expect(comments).toEqual([expect.objectContaining({ body: 'Verificat', author_id: userId })]);
    expect(
      (await sql`SELECT id FROM tasks WHERE recurrence_parent_id = ${id}`.execute(conn.db)).rows,
    ).toHaveLength(0);
  });

  it('desfà la creació sencera si una escriptura dels fills falla', async () => {
    const id = uuidv7();
    const failed = await api('POST', '/api/v1/tasks', {
      id,
      title: 'Lliurament incomplet',
      scope_id: scopeId,
      subtasks: [{ title: 'Aquesta arriba a inserir-se' }],
      comments: [{ body: '   ' }],
    });
    expect(failed.statusCode, failed.body).toBe(422);
    expect((await api('GET', `/api/v1/tasks/${id}`)).statusCode).toBe(404);
    expect(
      (await sql`SELECT id FROM subtasks WHERE task_id = ${id}`.execute(conn.db)).rows,
    ).toHaveLength(0);
    expect(
      (await sql`SELECT id FROM activity_log WHERE entity_id = ${id}`.execute(conn.db)).rows,
    ).toHaveLength(0);
  });

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
    it("l'enllaç mostra la tasca i reserva les instruccions per als usuaris autoritzats", async () => {
      const title = 'Per mostrar en un enllaç';
      const created = await api('POST', '/api/v1/tasks', {
        scope_id: scopeId,
        title,
        ai_instructions: 'Notes internes de la tasca.',
      });
      expect(created.statusCode, created.body).toBe(201);
      const taskId = created.json<{ id: string }>().id;
      const share = await api('POST', '/api/v1/shares', { task_id: taskId, permission: 'view' });
      expect(share.statusCode, share.body).toBe(201);

      const opened = await app.inject({
        method: 'POST',
        url: `/s/${share.json<{ token: string }>().token}`,
      });
      expect(opened.statusCode, opened.body).toBe(200);
      expect(opened.json()).toMatchObject({ task: { id: taskId, title, ai_instructions: null } });
    });

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
