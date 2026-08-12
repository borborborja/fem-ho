/**
 * Les tipologies: un vocabulari tancat, i què passa quan és obligatori.
 *
 * El que decideix aquí és **la diferència amb una etiqueta**. Si qualsevol en pogués crear
 * des de la fitxa, als tres dies hi hauria «Contingut», «contingut» i «Continguts» i les
 * Estadístiques per tipologia deixarien de dir res; i si esborrar-ne una s'endugués les
 * hores, ningú se n'atreviria a tocar cap.
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

const tmp = mkdtempSync(join(tmpdir(), 'femho-types-'));
const NOW = '2026-08-12T10:00:00.000Z';
const PASSWORD = 'la-contrasenya-de-prova';

let conn: Connection;
let app: FastifyInstance;
let auth: { authorization: string };
let comMarta: { authorization: string };
let scopeId: string;
let typeId: string;

async function api(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload?: Record<string, unknown>,
  headers = auth,
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

  const martaId = uuidv7();
  for (const [id, email, name] of [
    [uuidv7(), 'borja@example.com', 'Borja'],
    [martaId, 'marta@example.com', 'Marta'],
  ] as const) {
    await sql`
      INSERT INTO users (id, email, name, password_hash, kind, role, created_at, updated_at)
      VALUES (${id}, ${email}, ${name}, ${await hashPassword(PASSWORD)}, 'human', 'member',
              ${NOW}, ${NOW})
    `.execute(conn.db);
  }

  app = buildApp({ ...loadConfig('0.1.0-test'), logLevel: 'silent' }, { connection: conn });
  const entra = async (email: string): Promise<{ authorization: string }> => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password: PASSWORD },
    });
    return { authorization: `Bearer ${res.json<{ access_token: string }>().access_token}` };
  };
  auth = await entra('borja@example.com');
  comMarta = await entra('marta@example.com');

  scopeId = (
    await api('POST', '/api/v1/scopes', {
      name: 'Feina',
      color: '--plou-orange',
      kind: 'collective',
    })
  ).json<{ id: string }>().id;
  await api('POST', `/api/v1/scopes/${scopeId}/members`, {
    user_id: martaId,
    role: 'collaborator',
  });
});

afterAll(async () => {
  await app.close();
  await conn.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe('un vocabulari tancat', () => {
  it("només qui mana a l'àmbit en pot crear", async () => {
    const meva = await api('POST', '/api/v1/task-types', {
      scope_id: scopeId,
      name: 'Contingut',
      color: '--plou-orange',
    });
    expect(meva.statusCode, meva.body).toBe(201);
    typeId = meva.json<{ id: string }>().id;

    /**
     * **I un col·laborador no.** És tota la diferència amb una etiqueta: un vocabulari que
     * qualsevol pot ampliar des de la fitxa deixa de ser un vocabulari als tres dies.
     */
    const seva = await api(
      'POST',
      '/api/v1/task-types',
      { scope_id: scopeId, name: 'Inventada' },
      comMarta,
    );
    expect(seva.statusCode).toBe(403);
  });

  it('crear-la dues vegades amb el mateix nom dona la mateixa', async () => {
    const altra = await api('POST', '/api/v1/task-types', {
      scope_id: scopeId,
      name: 'Contingut',
    });
    expect(altra.json<{ id: string }>().id).toBe(typeId);
  });

  it('es reanomena i queda dit', async () => {
    const res = await api('PATCH', `/api/v1/task-types/${typeId}`, { name: 'Contingut i xarxes' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<{ name: string }>().name).toBe('Contingut i xarxes');

    const files = await sql<{ changes: string }>`
      SELECT changes FROM activity_log WHERE entity_id = ${typeId} AND verb = 'updated'
    `.execute(conn.db);
    expect(files.rows[0]?.changes).toContain('Contingut i xarxes');
  });

  it("i tothom de l'àmbit les pot llegir, encara que no en pugui crear", async () => {
    const res = await api('GET', `/api/v1/task-types?scope_id=${scopeId}`, undefined, comMarta);
    expect(res.json<{ data: { name: string }[] }>().data.map((row) => row.name)).toEqual([
      'Contingut i xarxes',
    ]);
  });
});

describe('quan és obligatòria', () => {
  it('sense exigir-la, una tasca pot néixer sense', async () => {
    const res = await api('POST', '/api/v1/tasks', { scope_id: scopeId, title: 'Sense tipus' });
    expect(res.statusCode).toBe(201);
  });

  it('exigint-la, no es crea i es diu que en falta una', async () => {
    await api('PATCH', `/api/v1/scopes/${scopeId}/settings`, {
      task_types_enabled: true,
      task_type_required: true,
    });

    const res = await api('POST', '/api/v1/tasks', { scope_id: scopeId, title: 'Enviar factura' });
    expect(res.statusCode).toBe(422);

    const problem = res.json<{ type: string; params: { name: string } }>();
    expect(problem.type).toContain('task-type-required');
    // El nom de l'àmbit hi és perquè amb diversos actius se sàpiga quin ho demana.
    expect(problem.params.name).toBe('Feina');
  });

  it('i amb la tipologia, sí', async () => {
    const res = await api('POST', '/api/v1/tasks', {
      scope_id: scopeId,
      title: 'Enviar factura',
      task_type_id: typeId,
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json<{ task_type_id: string }>().task_type_id).toBe(typeId);
  });

  it("una tipologia d'un altre àmbit es rebutja", async () => {
    /**
     * Si s'acceptés, les Estadístiques d'un àmbit comptarien hores classificades amb el
     * vocabulari d'un altre, que és pitjor que un error: és un número que sembla bo.
     */
    const altre = (
      await api('POST', '/api/v1/scopes', { name: 'Casa', color: '--plou-pink' })
    ).json<{ id: string }>().id;

    const res = await api('POST', '/api/v1/tasks', {
      scope_id: altre,
      title: 'Comprar pa',
      task_type_id: typeId,
    });
    expect(res.statusCode).toBe(422);
    expect(res.json<{ type: string }>().type).toContain('type-other-scope');
  });
});

describe('esborrar-la', () => {
  it("no s'endú les hores: la tasca es queda sense tipologia", async () => {
    const tasca = (
      await api('POST', '/api/v1/tasks', {
        scope_id: scopeId,
        title: 'Feina classificada',
        task_type_id: typeId,
      })
    ).json<{ id: string }>().id;

    const res = await api('DELETE', `/api/v1/task-types/${typeId}`);
    expect(res.statusCode).toBe(204);

    const despres = await api('GET', `/api/v1/tasks/${tasca}`);
    expect(despres.json<{ task_type_id: string | null }>().task_type_id).toBeNull();
    // I la tasca hi és: esborrar una manera de classificar no esborra el que classificava.
    expect(despres.json<{ title: string }>().title).toBe('Feina classificada');
  });
});
