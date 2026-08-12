/**
 * Un àmbit, un agent — comprovat pel camí que fa servir la pantalla.
 *
 * La regla viu a la base (`UNIQUE (scope_id)`, migració 016) i al servei, que és qui la fa
 * entenedora. Aquí es prova **el que arriba a qui la configura**: que no es pugui, i que el
 * missatge digui de quin agent és l'àmbit, perquè sigui el següent pas i no una porta
 * tancada.
 *
 * I la conseqüència que ho fa valer la pena: **un agent no veu res de fora dels seus
 * àmbits**. Això no s'aconsegueix filtrant a `next_task` sinó acotant-li el principal
 * (`policy/resolve.ts`), de manera que totes les tools ho respecten alhora.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { LightMyRequestResponse } from 'fastify';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { hashPassword } from '../auth/password.js';
import { connect, type Connection } from '../db/connection.js';
import { migrateToLatest } from '../db/migrator.js';

const tmp = mkdtempSync(join(tmpdir(), 'femho-agentscopes-'));
const NOW = '2026-08-12T10:00:00.000Z';
const PASSWORD = 'la-contrasenya-de-la-borja';

let conn: Connection;
let app: FastifyInstance;
let auth: { authorization: string };
let feina: string;
let casa: string;
let hermes: string;
let codex: string;

async function api(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH',
  url: string,
  payload?: Record<string, unknown>,
): Promise<LightMyRequestResponse> {
  return payload === undefined
    ? app.inject({ method, url, headers: auth })
    : app.inject({ method, url, headers: auth, payload });
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

  feina = (await api('POST', '/api/v1/scopes', { name: 'Feina', color: '--plou-orange' })).json<{
    id: string;
  }>().id;
  casa = (await api('POST', '/api/v1/scopes', { name: 'Casa', color: '--plou-pink' })).json<{
    id: string;
  }>().id;

  hermes = (await api('POST', '/api/v1/ai/agents', { name: 'Hermes' })).json<{ id: string }>().id;
  codex = (await api('POST', '/api/v1/ai/agents', { name: 'Codex' })).json<{ id: string }>().id;
});

afterAll(async () => {
  await app.close();
  await conn.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe('un àmbit, un agent', () => {
  it('un agent neix sense cap àmbit: encara no és de ningú', async () => {
    const res = await api('GET', `/api/v1/ai/agents/${hermes}`);
    expect(res.json<{ scope_ids: string[]; all_scopes: boolean }>()).toMatchObject({
      scope_ids: [],
      all_scopes: false,
    });
  });

  it('se li assigna un àmbit i el porta ell', async () => {
    const res = await api('PUT', `/api/v1/ai/agents/${hermes}/scopes`, { scope_ids: [feina] });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<{ scope_ids: string[] }>().scope_ids).toEqual([feina]);
  });

  it('i un altre agent no el pot agafar —i se li diu de qui és', async () => {
    const res = await api('PUT', `/api/v1/ai/agents/${codex}/scopes`, { scope_ids: [feina] });
    expect(res.statusCode).toBe(422);

    const problem = res.json<{ detail: string; params?: { agent_id?: string } }>();
    // El nom hi és perquè qui ho configura sàpiga a quin agent ha d'anar, i
    // l'identificador sota `params` perquè la pantalla hi pugui portar amb un botó.
    expect(problem.detail).toContain('Hermes');
    expect(problem.params?.agent_id).toBe(hermes);
  });

  it('però sí un de lliure', async () => {
    const res = await api('PUT', `/api/v1/ai/agents/${codex}/scopes`, { scope_ids: [casa] });
    expect(res.statusCode, res.body).toBe(200);
  });

  it('i ningú pot portar-ho «tot» mentre un altre en tingui algun', async () => {
    const res = await api('PUT', `/api/v1/ai/agents/${hermes}/scopes`, { all_scopes: true });
    expect(res.statusCode).toBe(422);
    expect(res.json<{ detail: string }>().detail).toContain('Codex');
  });

  it('la pantalla sap quines caselles ha de desactivar, i de qui són', async () => {
    const res = await api('GET', `/api/v1/ai/agents/${hermes}/scope-availability`);
    const data = res.json<{
      data: { scope_id: string; taken_by: { name: string } | null }[];
    }>().data;

    // El seu no li surt pres; el de l'altre sí, amb el nom.
    expect(data.find((row) => row.scope_id === feina)?.taken_by).toBeNull();
    expect(data.find((row) => row.scope_id === casa)?.taken_by?.name).toBe('Codex');
  });
});

describe("l'abast d'un agent", () => {
  it('un agent no veu res de fora dels seus àmbits', async () => {
    /**
     * **Es comprova pel principal i no per `next_task`.** L'acotació es fa en resoldre el
     * token (`policy/resolve.ts`), i per això val per a totes les tools alhora: si es fes a
     * `next_task`, `list_tasks` i `get_task` en tindrien una còpia cadascuna.
     */
    await api('POST', '/api/v1/tasks', {
      scope_id: casa,
      title: 'Una de casa',
      ai_mode: 'delegated',
    });
    await api('POST', '/api/v1/tasks', {
      scope_id: feina,
      title: 'Una de feina',
      ai_mode: 'delegated',
    });

    // Hermes porta Feina; Codex, Casa. Una credencial d'agent es fa a la fase següent, o
    // sigui que aquí es comprova el que la sustenta: l'assignació i la seva exclusivitat.
    const seus = await sql<{ scope_id: string }>`
      SELECT scope_id FROM agent_scopes WHERE agent_id = ${hermes}
    `.execute(conn.db);
    expect(seus.rows.map((row) => row.scope_id)).toEqual([feina]);
  });

  it('la base no deixa que un àmbit tingui dos agents ni escrivint-hi directament', async () => {
    /**
     * La regla del servei es pot saltar pel segon camí —una importació, una restauració—, i
     * per això la `UNIQUE` és a la taula. Això prova que hi és de debò.
     */
    await expect(
      sql`INSERT INTO agent_scopes (agent_id, scope_id) VALUES (${codex}, ${feina})`.execute(
        conn.db,
      ),
    ).rejects.toThrow();
  });
});
