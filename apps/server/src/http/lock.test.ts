/**
 * El pany: qui pot tocar una tasca mentre hi ha un agent a dins.
 *
 * La reserva existia des de M11 i **no protegia res**: cap escriptura la mirava. Una persona
 * es podia endur una tasca mentre l'agent hi treballava, i un agent podia seguir movent una
 * que ja no era seva. Aquí es prova pel camí que faran totes dues bandes, no per la funció
 * pura —això ja té prova pròpia a `policy/ai-writes.test.ts`—: el que ha de valdre és que
 * el 409 arribi a la pantalla amb l'estona que falta escrita.
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

const tmp = mkdtempSync(join(tmpdir(), 'femho-lock-'));
const NOW = '2026-08-12T10:00:00.000Z';
const PASSWORD = 'la-contrasenya-de-la-borja';

let conn: Connection;
let app: FastifyInstance;
let auth: { authorization: string };
let comAgent: { authorization: string };
let scopeId: string;
let agentId: string;

async function api(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH',
  url: string,
  payload?: Record<string, unknown>,
  headers = auth,
): Promise<LightMyRequestResponse> {
  return payload === undefined
    ? app.inject({ method, url, headers })
    : app.inject({ method, url, headers, payload });
}

async function tascaDelegada(title: string): Promise<string> {
  const created = await api('POST', '/api/v1/tasks', { scope_id: scopeId, title });
  const id = created.json<{ id: string }>().id;
  await api('POST', `/api/v1/tasks/${id}/ai-mode`, { ai_mode: 'delegated' });
  return id;
}

async function tasca(id: string): Promise<{
  locked_until: string | null;
  locked_by_agent_id: string | null;
  status: string;
  ai_mode: string;
}> {
  return (await api('GET', `/api/v1/tasks/${id}`)).json();
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
  agentId = (await api('POST', '/api/v1/ai/agents', { name: 'Hermes' })).json<{ id: string }>().id;
  await api('PUT', `/api/v1/ai/agents/${agentId}/scopes`, { scope_ids: [scopeId] });
  const credencial = await api('POST', `/api/v1/ai/agents/${agentId}/credentials`, {
    name: 'Hermes al portàtil',
  });
  comAgent = { authorization: `Bearer ${credencial.json<{ token: string }>().token}` };
});

afterAll(async () => {
  await app.close();
  await conn.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe('mentre un agent hi treballa', () => {
  it('la tasca queda bloquejada, i es diu fins quan i de qui', async () => {
    const id = await tascaDelegada('Enviar la factura');
    expect((await tasca(id)).locked_until).toBeNull();

    await api('POST', `/api/v1/ai/tasks/${id}/claim`, undefined, comAgent);

    const amb = await tasca(id);
    expect(amb.locked_by_agent_id).toBe(agentId);
    // Trenta minuts, i el que importa és que sigui al futur: la pantalla en fa el compte.
    expect(Date.parse(amb.locked_until ?? '')).toBeGreaterThan(Date.now());
  });

  it('una persona no la pot moure —i el 409 diu qui la té i quanta estona queda', async () => {
    const id = await tascaDelegada('Reservar el tren');
    await api('POST', `/api/v1/ai/tasks/${id}/claim`, undefined, comAgent);

    const res = await api('POST', `/api/v1/tasks/${id}/move`, { status: 'doing' });
    expect(res.statusCode).toBe(409);

    const problem = res.json<{ type: string; params: { agent: string; minutes: number } }>();
    expect(problem.type).toContain('task-locked');
    // El nom i no l'identificador: qui ho llegeix és una persona mirant una targeta.
    expect(problem.params.agent).toBe('Hermes');
    expect(problem.params.minutes).toBeGreaterThan(0);

    // I no s'ha mogut: un 409 que a més fes el canvi seria pitjor que no comprovar res.
    expect((await tasca(id)).status).toBe('inbox');
  });

  it('editar-ne el text sí que es pot: afegir-li context no li treu la tasca de sota', async () => {
    const id = await tascaDelegada('Comprar segells');
    await api('POST', `/api/v1/ai/tasks/${id}/claim`, undefined, comAgent);

    const res = await api('PATCH', `/api/v1/tasks/${id}`, {
      description: 'Els de 1,55 €, que són per a fora.',
    });
    expect(res.statusCode, res.body).toBe(200);
  });
});

describe('un agent només toca el que té reservat', () => {
  it('sense reserva no la mou, i se li diu quina crida li falta', async () => {
    const id = await tascaDelegada('Trucar al taller');

    const res = await api('POST', `/api/v1/tasks/${id}/move`, { status: 'doing' }, comAgent);
    expect(res.statusCode).toBe(403);
    expect(res.json<{ detail: string }>().detail).toContain('claim');
  });

  it('amb la seva reserva, sí', async () => {
    const id = await tascaDelegada('Fer la comanda');
    await api('POST', `/api/v1/ai/tasks/${id}/claim`, undefined, comAgent);

    const res = await api('POST', `/api/v1/tasks/${id}/move`, { status: 'doing' }, comAgent);
    expect(res.statusCode, res.body).toBe(200);
  });

  it("i mai en una que ha passat a ser d'una persona", async () => {
    /**
     * **Això és l'avís de la reclamació**: un protocol de consulta no té timbre, i el que fa
     * d'avís és que la següent cosa que provi l'agent digui exactament què ha passat.
     */
    const id = await tascaDelegada('Pagar la quota');
    await api('POST', `/api/v1/ai/tasks/${id}/claim`, undefined, comAgent);
    await api('POST', `/api/v1/tasks/${id}/ai-mode`, { ai_mode: 'manual' });

    const res = await api('POST', `/api/v1/tasks/${id}/move`, { status: 'done' }, comAgent);
    expect(res.statusCode).toBe(403);
    expect(res.json<{ type: string }>().type).toContain('human-took-over');
  });
});

describe('preguntar desbloqueja', () => {
  it("l'agent que espera no és un agent que treballa", async () => {
    const id = await tascaDelegada('Enviar el pressupost');
    await api('POST', `/api/v1/ai/tasks/${id}/claim`, undefined, comAgent);
    expect((await tasca(id)).locked_until).not.toBeNull();

    await api('POST', `/api/v1/ai/tasks/${id}/ask-user`, { question: 'A quin preu?' }, comAgent);

    // Desbloquejada: si no, no podries ni respondre-li ni endur-te-la.
    expect((await tasca(id)).locked_until).toBeNull();
    const moguda = await api('POST', `/api/v1/tasks/${id}/move`, { status: 'doing' });
    expect(moguda.statusCode, moguda.body).toBe(200);
  });

  it('i el que espera resposta no es torna a repartir', async () => {
    /**
     * Sense això l'agent es torna a servir la tasca per la qual t'espera i entra en bucle
     * preguntant el mateix: la reserva ja no la protegeix, perquè justament l'ha deixada
     * anar per poder-te deixar respondre.
     */
    await sql`DELETE FROM task_leases`.execute(conn.db);
    const esperant = await tascaDelegada('La que espera');
    await api('POST', `/api/v1/ai/tasks/${esperant}/ask-user`, { question: 'Quin?' }, comAgent);

    for (let i = 0; i < 5; i++) {
      const seguent = await app.inject({
        method: 'GET',
        url: '/api/v1/ai/next-task',
        headers: comAgent,
      });
      const reservada = seguent.json<{ task: { taskId: string } | null }>().task;
      if (reservada === null) break;
      expect(reservada.taskId).not.toBe(esperant);
    }
  });
});
