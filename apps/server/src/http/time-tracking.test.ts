/**
 * La dedicació s'anota sola, i el passat es recupera.
 *
 * Fem-ho no havia guardat mai temps treballat. El que decideix aquí és que **no calgui
 * recordar-se de res**: el gest que ja fas per dir «hi estic» —moure la targeta a Fent— és
 * el que compta les hores, i el que ja has fet abans d'encendre-ho també hi surt, perquè
 * l'historial ja ho sabia.
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

const tmp = mkdtempSync(join(tmpdir(), 'femho-time-'));
const NOW = '2026-08-12T10:00:00.000Z';
const PASSWORD = 'la-contrasenya-de-la-borja';

let conn: Connection;
let app: FastifyInstance;
let auth: { authorization: string };
let scopeId: string;

async function api(
  method: 'GET' | 'POST' | 'PATCH',
  url: string,
  payload?: Record<string, unknown>,
): Promise<LightMyRequestResponse> {
  return payload === undefined
    ? app.inject({ method, url, headers: auth })
    : app.inject({ method, url, headers: auth, payload });
}

async function novaTasca(title: string): Promise<string> {
  return (await api('POST', '/api/v1/tasks', { scope_id: scopeId, title })).json<{ id: string }>()
    .id;
}

async function moure(id: string, status: string): Promise<void> {
  await api('POST', `/api/v1/tasks/${id}/move`, { status });
}

async function blocs(
  taskId?: string,
): Promise<{ task_id: string; started_at: string; ended_at: string | null; source: string }[]> {
  const found = await sql<{
    task_id: string;
    started_at: string;
    ended_at: string | null;
    source: string;
  }>`
    SELECT task_id, started_at, ended_at, source FROM task_sessions
    ${taskId === undefined ? sql`` : sql`WHERE task_id = ${taskId}`}
    ORDER BY started_at
  `.execute(conn.db);
  return found.rows;
}

/**
 * Envelleix un bloc obert perquè el tancament no doni zero.
 *
 * Les proves corren en mil·lisegons; situem l'inici abans per comprovar una durada coneguda.
 */
async function feQueFaciEstona(taskId: string, minuts: number): Promise<void> {
  const abans = new Date(Date.now() - minuts * 60_000).toISOString();
  await sql`
    UPDATE task_sessions SET started_at = ${abans} WHERE task_id = ${taskId} AND ended_at IS NULL
  `.execute(conn.db);
}

beforeAll(async () => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('FEMHO_')) delete process.env[key];
  }

  conn = connect(`sqlite://${join(tmp, 'test.db')}`);
  await migrateToLatest(conn.db, { engine: 'sqlite' });
  await sql`
    INSERT INTO users (id, email, name, password_hash, kind, role, created_at, updated_at)
    VALUES (${uuidv7()}, 'borja@example.com', 'Borja', ${await hashPassword(PASSWORD)},
            'human', 'admin', ${NOW}, ${NOW})
  `.execute(conn.db);

  app = buildApp({ ...loadConfig('0.1.0-test'), logLevel: 'silent' }, { connection: conn });
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: 'borja@example.com', password: PASSWORD },
  });
  auth = { authorization: `Bearer ${login.json<{ access_token: string }>().access_token}` };

  scopeId = (await api('POST', '/api/v1/scopes', { name: 'Feina', color: '--plou-orange' })).json<{
    id: string;
  }>().id;
});

afterAll(async () => {
  await app.close();
  await conn.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe('un àmbit sense registre no anota res', () => {
  it('moure una targeta a Fent no deixa cap bloc', async () => {
    const id = await novaTasca('Abans d’encendre-ho');
    await moure(id, 'doing');
    await moure(id, 'todo');
    expect(await blocs(id)).toEqual([]);
  });

  it('i els valors per defecte diuen que està apagat', async () => {
    const res = await api('GET', `/api/v1/scopes/${scopeId}/settings`);
    expect(res.json<{ time_tracking: boolean; work_start: string }>()).toMatchObject({
      time_tracking: false,
      work_start: '09:00',
    });
  });
});

describe('encendre el registre recupera el passat i queda dit', () => {
  it('el que ja s’havia fet surt de l’historial', async () => {
    /**
     * **Aquesta és la raó que això es pugui encendre quan sigui.** L'historial guarda cada
     * entrada i sortida de Fent des del primer dia: estrenar el Registre amb les taules
     * buides seria amagar una cosa que ja tenim.
     */
    const res = await api('PATCH', `/api/v1/scopes/${scopeId}/settings`, { time_tracking: true });
    expect(res.statusCode, res.body).toBe(200);

    const desat = res.json<{ time_tracking: boolean; backfilled: number }>();
    expect(desat.time_tracking).toBe(true);
    expect(desat.backfilled).toBe(1);

    const recuperat = (await blocs())[0];
    expect(recuperat?.source).toBe('backfill');
    expect(recuperat?.ended_at).not.toBeNull();
  });

  it('i tornar-ho a encendre no duplica res', async () => {
    const res = await api('PATCH', `/api/v1/scopes/${scopeId}/settings`, { time_tracking: true });
    expect(res.json<{ backfilled: number }>().backfilled).toBe(0);
    expect(await blocs()).toHaveLength(1);
  });

  it('el canvi queda a l’historial dient QUÈ ha canviat', async () => {
    const files = await sql<{ changes: string }>`
      SELECT changes FROM activity_log
      WHERE entity_id = ${scopeId} AND verb = 'updated' AND changes LIKE '%time_tracking%'
    `.execute(conn.db);
    expect(files.rows).toHaveLength(1);
    expect(files.rows[0]?.changes).toContain('"to":true');
  });
});

describe('a partir d’ara, s’anota sol', () => {
  it('entrar a Fent obre un bloc que encara no té final', async () => {
    const id = await novaTasca('Enviar la factura');
    await moure(id, 'doing');

    const oberts = await blocs(id);
    expect(oberts).toHaveLength(1);
    expect(oberts[0]?.ended_at).toBeNull();
    expect(oberts[0]?.source).toBe('board');
  });

  it('i sortir-ne el tanca', async () => {
    const id = await novaTasca('Reservar el tren');
    await moure(id, 'doing');
    await feQueFaciEstona(id, 50);
    await moure(id, 'done');

    const fets = await blocs(id);
    expect(fets).toHaveLength(1);
    const minuts =
      (Date.parse(fets[0]?.ended_at ?? '') - Date.parse(fets[0]?.started_at ?? '')) / 60_000;
    expect(Math.round(minuts)).toBe(50);
  });

  it('tornar de Fet a Fent en fa un SEGON, no allarga el primer', async () => {
    /**
     * És el cas que va decidir el model. Amb un acumulat a la tasca això seria un sol número
     * i el cronograma —que pinta blocs a hores concretes— no podria existir.
     */
    const id = await novaTasca('Migrar el servidor');
    await moure(id, 'doing');
    await feQueFaciEstona(id, 30);
    await moure(id, 'done');

    await moure(id, 'doing');
    await feQueFaciEstona(id, 20);
    await moure(id, 'done');

    const dos = await blocs(id);
    expect(dos).toHaveLength(2);
    expect(dos.every((bloc) => bloc.ended_at !== null)).toBe(true);
  });

  it('també conserva un tram inferior a un minut', async () => {
    const id = await novaTasca('De pas');
    await moure(id, 'doing');
    await moure(id, 'done');
    const sessions = await blocs(id);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.ended_at).not.toBeNull();
  });

  it('i completar-la pel commutador tanca igual que arrossegar-la', async () => {
    const id = await novaTasca('Pagar la quota');
    await moure(id, 'doing');
    await feQueFaciEstona(id, 15);
    await api('POST', `/api/v1/tasks/${id}/complete`);

    const fets = await blocs(id);
    expect(fets).toHaveLength(1);
    expect(fets[0]?.ended_at).not.toBeNull();
  });
});

describe('completar directament amb una durada', () => {
  async function prepared() {
    const id = await novaTasca('Durada indicada');
    await moure(id, 'todo');
    const task = (await api('GET', `/api/v1/tasks/${id}`)).json<{ version: number }>();
    return {
      id,
      body: {
        status: 'done',
        expected_version: task.version,
        time_entry: { id: uuidv7(), minutes: 23, ended_at: new Date().toISOString() },
      },
    };
  }
  it('desa 23 minuts exactes amb la tasca i un reintent no duplica res', async () => {
    const { id, body } = await prepared();
    const response = await api('POST', `/api/v1/tasks/${id}/move`, body);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json<{ status: string }>().status).toBe('done');
    expect((await api('POST', `/api/v1/tasks/${id}/move`, body)).statusCode).toBe(200);
    const sessions = await blocs(id);
    expect(sessions).toHaveLength(1);
    expect(Date.parse(sessions[0]!.ended_at!) - Date.parse(sessions[0]!.started_at)).toBe(
      23 * 60000,
    );
    const audit = await sql<{ entity_type: string }>`SELECT entity_type FROM activity_log
      WHERE entity_id=${id} AND verb='completed'`.execute(conn.db);
    expect(audit.rows).toHaveLength(1);
    const sessionAudit =
      await sql`SELECT id FROM activity_log WHERE entity_id=${id} AND verb='logged'`.execute(
        conn.db,
      );
    expect(sessionAudit.rows).toHaveLength(1);
    await moure(id, 'doing');
    await feQueFaciEstona(id, 0.25);
    await moure(id, 'done');
    expect(await blocs(id)).toHaveLength(2);
    const board = (await api('GET', `/api/v1/board?scope_ids=${scopeId}`)).json<{
      columns: {
        groups: {
          tasks: {
            id: string;
            time_summary: { seconds: number; segments: number; open_started_at: string[] };
          }[];
        }[];
      }[];
    }>();
    const summary = board.columns
      .flatMap((c) => c.groups.flatMap((g) => g.tasks))
      .find((t) => t.id === id)!.time_summary;
    expect(summary.segments).toBe(2);
    expect(summary.seconds).toBeGreaterThanOrEqual(23 * 60 + 15);
    expect(summary.open_started_at).toEqual([]);
    const report = (await api('GET', `/api/v1/sessions?scope_ids=${scopeId}`)).json<{
      data: { task_id: string }[];
    }>();
    expect(report.data.filter((row) => row.task_id === id)).toHaveLength(2);
  });
  it('un conflicte de versió no completa ni afegeix temps', async () => {
    const { id, body } = await prepared();
    await api('PATCH', `/api/v1/tasks/${id}`, { title: 'Canvi remot' });
    expect((await api('POST', `/api/v1/tasks/${id}/move`, body)).statusCode).toBe(409);
    expect((await api('GET', `/api/v1/tasks/${id}`)).json<{ status: string }>().status).toBe(
      'todo',
    );
    expect(await blocs(id)).toEqual([]);
  });
  it('rebutja durades invàlides sense modificar la tasca', async () => {
    const { id, body } = await prepared();
    for (const minutes of [0, -1, 1.5, 10081]) {
      expect(
        (
          await api('POST', `/api/v1/tasks/${id}/move`, {
            ...body,
            time_entry: { ...body.time_entry, minutes },
          })
        ).statusCode,
      ).toBe(422);
    }
    expect((await api('GET', `/api/v1/tasks/${id}`)).json<{ status: string }>().status).toBe(
      'todo',
    );
    expect(await blocs(id)).toEqual([]);
  });
  it('no admet el temps de compleció si l’àmbit ha desactivat el registre', async () => {
    const { id, body } = await prepared();
    await api('PATCH', `/api/v1/scopes/${scopeId}/settings`, { time_tracking: false });
    expect((await api('POST', `/api/v1/tasks/${id}/move`, body)).statusCode).toBe(409);
    expect(await blocs(id)).toEqual([]);
    expect((await api('POST', `/api/v1/tasks/${id}/move`, { status: 'done' })).statusCode).toBe(
      200,
    );
    await api('PATCH', `/api/v1/scopes/${scopeId}/settings`, { time_tracking: true });
  });
  it('una tasca creada a Fent també comença a registrar temps', async () => {
    const created = await api('POST', '/api/v1/tasks', {
      scope_id: scopeId,
      title: 'Ja fent',
      status: 'doing',
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json<{ id: string }>().id;
    expect(await blocs(id)).toHaveLength(1);
    expect((await blocs(id))[0]?.ended_at).toBeNull();
  });
});
