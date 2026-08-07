/**
 * Escriptures simultànies, **als dos motors** (D11).
 *
 * El que es prova aquí no és una ruta sinó una propietat de tot el sistema: cap
 * seqüència de peticions concurrents ha de deixar la base en un estat incoherent, ni
 * perdre escriptures, ni duplicar-les, ni tornar un 500.
 *
 * **I això només diu res de veritat a Postgres.** Amb SQLite les transaccions es
 * serialitzen i la concurrència és aparent: dues peticions alhora acaben anant una
 * darrere l'altra i qualsevol cursa queda amagada. A Postgres corren de debò.
 *
 * Fins ara l'única cosa que es provava als dos motors eren les migracions: tota la capa
 * de servei i d'HTTP només s'havia executat mai contra SQLite, que és exactament on D11
 * avisa que les diferències no es veuen fins que algú desplega l'altre.
 *
 * Postgres només corre si hi ha `FEMHO_TEST_POSTGRES_URL`, i quan no hi és **es diu**.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { comparePositions } from '@fem-ho/contracts';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { hashPassword } from '../auth/password.js';
import { connect, type Connection } from '../db/connection.js';
import { connectTestSchema, type TestSchema } from '../db/test-postgres.js';
import { migrateToLatest } from '../db/migrator.js';

const tmp = mkdtempSync(join(tmpdir(), 'femho-conc-'));
const NOW = '2026-08-06T09:00:00.000Z';
const PASSWORD = 'la-contrasenya-de-prova';

const pgUrl = process.env.FEMHO_TEST_POSTGRES_URL;
const MOTORS: { engine: 'sqlite' | 'postgres'; url: string }[] = [
  { engine: 'sqlite', url: `sqlite://${join(tmp, 't.db')}` },
];
if (pgUrl !== undefined && pgUrl !== '') MOTORS.push({ engine: 'postgres', url: pgUrl });

let conn: Connection;
let schema: TestSchema | null = null;
let app: FastifyInstance;
let auth: Record<string, string>;
let scopeId: string;

async function api(
  method: 'GET' | 'POST',
  url: string,
  payload?: Record<string, unknown>,
): Promise<LightMyRequestResponse> {
  return payload === undefined
    ? app.inject({ method, url, headers: auth })
    : app.inject({ method, url, headers: auth, payload });
}

describe.each(MOTORS)('motor $engine', (motor) => {
  beforeAll(async () => {
    // Esquema propi per no xocar amb les altres suites que corren alhora contra la
    // mateixa base (veure `db/test-postgres.ts`).
    schema = motor.engine === 'postgres' ? await connectTestSchema(motor.url, 'concurrency') : null;
    conn = schema ?? connect(motor.url);

    await migrateToLatest(conn.db, { engine: motor.engine });

    const uid = uuidv7();
    await sql`
    INSERT INTO users (id, email, name, password_hash, kind, role, created_at, updated_at)
    VALUES (${uid}, 'b@e.com', 'B', ${await hashPassword(PASSWORD)}, 'human', 'admin', ${NOW}, ${NOW})
  `.execute(conn.db);

    scopeId = uuidv7();
    await sql`
    INSERT INTO scopes (id, name, kind, color, owner_id, position, created_at, updated_at)
    VALUES (${scopeId}, 'Casa', 'individual', '--plou-blue', ${uid}, 'a1', ${NOW}, ${NOW})
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

  describe('creacions simultànies', () => {
    it('vint tasques alhora es creen totes i cap comparteix posició', async () => {
      const respostes = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          api('POST', '/api/v1/tasks', { scope_id: scopeId, title: `Alhora ${String(i)}` }),
        ),
      );

      expect(respostes.every((r) => r.statusCode === 201 || r.statusCode === 200)).toBe(true);

      /**
       * **Dues targetes amb la mateixa posició és el bug que no dona cap error.** La
       * columna es veuria en un ordre diferent a cada client i no hi hauria res a mirar.
       * La posició la calcula el client (D3), però quan no en dona una, el servidor la
       * posa al final llegint l'última — i aquí és on dues peticions alhora podrien
       * llegir la mateixa.
       */
      const files = await sql<{ position: string }>`
      SELECT position FROM tasks WHERE scope_id = ${scopeId} AND deleted_at IS NULL
    `.execute(conn.db);

      const posicions = files.rows.map((r) => r.position);
      expect(posicions).toHaveLength(20);
      expect(new Set(posicions).size).toBe(20);
    });

    it('i queden ordenades de manera estricta', async () => {
      const files = await sql<{ position: string }>`
      SELECT position FROM tasks WHERE scope_id = ${scopeId} AND deleted_at IS NULL
      ORDER BY position
    `.execute(conn.db);

      for (let i = 1; i < files.rows.length; i += 1) {
        expect(
          comparePositions(files.rows[i - 1]!.position, files.rows[i]!.position),
          `"${files.rows[i - 1]!.position}" hauria d'anar abans de "${files.rows[i]!.position}"`,
        ).toBe(-1);
      }
    });

    it('la creació amb identificador de client és idempotent sota concurrència', async () => {
      const id = uuidv7();
      const respostes = await Promise.all(
        Array.from({ length: 8 }, () =>
          api('POST', '/api/v1/tasks', { id, scope_id: scopeId, title: 'Amb id de client' }),
        ),
      );

      expect(respostes.every((r) => r.statusCode < 400)).toBe(true);

      const files = await sql<{ n: number }>`
      SELECT COUNT(*) AS n FROM tasks WHERE id = ${id}
    `.execute(conn.db);
      expect(Number(files.rows[0]?.n)).toBe(1);
    });
  });

  describe('edicions simultànies de la mateixa fila', () => {
    it('la versió puja una vegada per escriptura, sense saltar-se cap número', async () => {
      const id = (
        await api('POST', '/api/v1/tasks', { scope_id: scopeId, title: 'Per editar molt' })
      ).json<{ id: string }>().id;

      await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          api('POST', `/api/v1/tasks/${id}/ai-mode`, {
            ai_mode: i % 2 === 0 ? 'assisted' : 'delegated',
          }),
        ),
      );

      const fila = await sql<{ version: number }>`
      SELECT version FROM tasks WHERE id = ${id}
    `.execute(conn.db);

      // Deu escriptures, deu increments: comença a 1.
      expect(fila.rows[0]?.version).toBe(11);
    });

    it("cada escriptura deixa la seva entrada a l'historial", async () => {
      const id = (
        await api('POST', '/api/v1/tasks', { scope_id: scopeId, title: 'Amb historial' })
      ).json<{ id: string }>().id;

      await Promise.all(
        Array.from({ length: 6 }, () =>
          api('POST', `/api/v1/tasks/${id}/ai-mode`, { ai_mode: 'assisted' }),
        ),
      );

      const fila = await sql<{ n: number }>`
      SELECT COUNT(*) AS n FROM activity_log WHERE entity_id = ${id} AND verb = 'updated'
    `.execute(conn.db);
      // Regla 4: si un camí d'escriptura no deixa rastre, no és un camí vàlid. Sota
      // concurrència tampoc.
      expect(Number(fila.rows[0]?.n)).toBe(6);
    });
  });

  describe('el change_log sota concurrència', () => {
    it('els seq són únics i sense forats', async () => {
      await Promise.all(
        Array.from({ length: 15 }, (_, i) =>
          api('POST', '/api/v1/tasks', { scope_id: scopeId, title: `Per al log ${String(i)}` }),
        ),
      );

      const files = await sql<{ seq: number }>`SELECT seq FROM change_log ORDER BY seq`.execute(
        conn.db,
      );
      const seqs = files.rows.map((r) => Number(r.seq));

      // Duplicats voldrien dir que un client que llegeixi fins al seq N es podria saltar
      // un canvi (docs/06 §2).
      expect(new Set(seqs).size).toBe(seqs.length);

      // I van seguits: un forat vol dir una transacció que va agafar un número i va
      // avortar, i el cursor del client el saltaria per sempre.
      for (let i = 1; i < seqs.length; i += 1) {
        expect(seqs[i]! - seqs[i - 1]!).toBe(1);
      }
    });

    it('el sync serveix tots els canvis, sense repetir-ne cap', async () => {
      const primera = await api('GET', '/api/v1/sync');
      const cos = primera.json<{ changes: { seq: number }[]; next_cursor: string }>();

      const seqs = cos.changes.map((c) => c.seq);
      expect(new Set(seqs).size).toBe(seqs.length);

      // I des del cursor, res de nou: tot el que hi havia ja s'ha servit.
      const segona = await api('GET', `/api/v1/sync?cursor=${encodeURIComponent(cos.next_cursor)}`);
      expect(segona.json<{ changes: unknown[] }>().changes).toHaveLength(0);
    });
  });

  describe('lectures i escriptures barrejades', () => {
    it("llegir mentre s'escriu no dona cap 500 ni cap fila a mitges", async () => {
      const operacions = Array.from({ length: 30 }, (_, i) =>
        i % 3 === 0
          ? api('POST', '/api/v1/tasks', { scope_id: scopeId, title: `Barrejada ${String(i)}` })
          : api('GET', '/api/v1/board'),
      );

      const respostes = await Promise.all(operacions);
      const errors = respostes.filter((r) => r.statusCode >= 500);
      expect(errors.map((r) => r.body.slice(0, 120))).toEqual([]);
    });
  });
});

describe("què s'ha provat", () => {
  it('diu si Postgres ha quedat fora', () => {
    // Una comprovació que se salta en silenci és pitjor que no tenir-la: si Postgres no
    // s'ha provat, la sortida ho ha de dir.
    const provats = MOTORS.map((m) => m.engine);
    if (!provats.includes('postgres')) {
      console.warn(
        "\n  AVÍS · La concurrència NO s'ha provat a Postgres. Posa FEMHO_TEST_POSTGRES_URL.\n" +
          '  Amb SQLite les transaccions es serialitzen i les curses queden amagades.\n',
      );
    }
    expect(provats).toContain('sqlite');
  });
});
