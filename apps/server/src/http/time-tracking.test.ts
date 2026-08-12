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
 * Les proves corren en mil·lisegons i el servei descarta el que dura menys d'un minut —passar
 * per Fent en un clic no és temps treballat—, o sigui que sense això no hi hauria res a mirar.
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

  it('passar-hi de llarg en un clic no deixa cap bloc', async () => {
    // Arrossegar de Per fer a Fet travessant la columna del mig no és temps treballat, i una
    // taula plena de línies de zero minuts deixa de ser llegible.
    const id = await novaTasca('De pas');
    await moure(id, 'doing');
    await moure(id, 'done');
    expect(await blocs(id)).toEqual([]);
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
