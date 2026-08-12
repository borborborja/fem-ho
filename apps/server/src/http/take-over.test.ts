/**
 * «Ho agafo jo»: el camí de tornada que no existia.
 *
 * Fins avui una tasca delegada només sortia del kanban d'IA arrossegant-la a la bústia —o
 * sigui que la manera d'agafar una cosa a mig fer era desfer-li el lloc—, i l'agent no
 * s'assabentava de res.
 *
 * El que decideix aquí és el que fa que valgui la pena reclamar-la: **que no es perdi res**.
 * Els comentaris i l'historial són de la tasca, no del mode, i són justament el que l'agent
 * hi ha deixat escrit mentre hi treballava.
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

const tmp = mkdtempSync(join(tmpdir(), 'femho-takeover-'));
const NOW = '2026-08-12T10:00:00.000Z';
const PASSWORD = 'la-contrasenya-de-la-borja';

let conn: Connection;
let app: FastifyInstance;
let auth: { authorization: string };
let comAgent: { authorization: string };
let scopeId: string;
let agentId: string;

async function api(
  method: 'GET' | 'POST' | 'PUT',
  url: string,
  payload?: Record<string, unknown>,
  headers = auth,
): Promise<LightMyRequestResponse> {
  return payload === undefined
    ? app.inject({ method, url, headers })
    : app.inject({ method, url, headers, payload });
}

/** Una tasca delegada que l'agent ja ha començat: reservada, moguda i comentada. */
async function aMigFer(title: string): Promise<string> {
  const created = await api('POST', '/api/v1/tasks', { scope_id: scopeId, title });
  const id = created.json<{ id: string }>().id;
  await api('POST', `/api/v1/tasks/${id}/ai-mode`, { ai_mode: 'delegated' });
  await api('POST', `/api/v1/ai/tasks/${id}/claim`, undefined, comAgent);
  await api('POST', `/api/v1/tasks/${id}/move`, { status: 'doing' }, comAgent);
  await api('POST', `/api/v1/tasks/${id}/comments`, { body: 'He trobat dues factures.' }, comAgent);
  return id;
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

describe('reclamar una tasca a mig fer', () => {
  it('no es pot mentre l’agent hi treballa', async () => {
    const id = await aMigFer('Enviar la factura');

    const res = await api('POST', `/api/v1/tasks/${id}/take-over`, { status: 'doing' });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ params: { agent: string } }>().params.agent).toBe('Hermes');
  });

  it('i quan es pot, va a la columna que tries i es queda tot el que hi havia', async () => {
    const id = await aMigFer('Reservar el tren');
    // L'agent pregunta: això el desbloqueja, que és quan la pots agafar.
    await api('POST', `/api/v1/ai/tasks/${id}/ask-user`, { question: 'Quin horari?' }, comAgent);

    const res = await api('POST', `/api/v1/tasks/${id}/take-over`, { status: 'todo' });
    expect(res.statusCode, res.body).toBe(200);

    const task = res.json<{ ai_mode: string; status: string; needs_attention: boolean }>();
    expect(task.ai_mode).toBe('manual');
    expect(task.status).toBe('todo');
    // Ja no espera ningú: la pregunta te l'has quedada tu amb la tasca.
    expect(task.needs_attention).toBe(false);

    /**
     * **I això és el que la fa valdre la pena.** El que l'agent hi va deixar escrit és de la
     * tasca i no del mode: si en reclamar-la es perdés, reclamar-la seria començar de zero.
     */
    const comentaris = await api('GET', `/api/v1/tasks/${id}/comments`);
    expect(comentaris.json<{ body: string }[]>().map((c) => c.body)).toEqual(
      expect.arrayContaining(['He trobat dues factures.', 'Quin horari?']),
    );

    const historial = await api('GET', `/api/v1/tasks/${id}/activity`);
    const verbs = historial.json<{ data: { verb: string }[] }>().data.map((e) => e.verb);
    expect(verbs).toEqual(expect.arrayContaining(['claimed', 'moved', 'asked', 'taken_over']));
  });

  it("i llavors l'agent no hi pot escriure —i llegeix per què", async () => {
    const id = await aMigFer('Comprar segells');
    await api('POST', `/api/v1/ai/tasks/${id}/ask-user`, { question: 'Quants?' }, comAgent);
    await api('POST', `/api/v1/tasks/${id}/take-over`, { status: 'doing' });

    const res = await api('POST', `/api/v1/tasks/${id}/move`, { status: 'done' }, comAgent);
    expect(res.statusCode).toBe(403);
    expect(res.json<{ type: string }>().type).toContain('human-took-over');
  });

  it('una columna que no és `todo` ni `doing` es rebutja', async () => {
    // A la bústia no: la bústia és on entren les coses, no on tornen les començades. I a
    // Fet tampoc: reclamar-la no és acabar-la.
    const id = await aMigFer('Pagar la quota');
    await api('POST', `/api/v1/ai/tasks/${id}/ask-user`, { question: 'Quant?' }, comAgent);

    const res = await api('POST', `/api/v1/tasks/${id}/take-over`, { status: 'done' });
    expect(res.statusCode).toBe(422);
  });

  it("es reclama i queda a l'historial com el que és", async () => {
    const id = await aMigFer('Trucar al taller');
    await api('POST', `/api/v1/ai/tasks/${id}/ask-user`, { question: 'A quina hora?' }, comAgent);
    await api('POST', `/api/v1/tasks/${id}/take-over`, { status: 'doing' });

    const files = await sql<{ verb: string; actor_type: string }>`
      SELECT verb, actor_type FROM activity_log WHERE entity_id = ${id} AND verb = 'taken_over'
    `.execute(conn.db);
    expect(files.rows).toHaveLength(1);
    // Una persona, no la IA: qui se l'ha enduta importa.
    expect(files.rows[0]?.actor_type).toBe('user');
  });
});

describe("l'agent ho sap abans de tocar res", () => {
  it('el briefing porta el que t’has endut', async () => {
    const id = await aMigFer('Preparar la reunió');
    await api('POST', `/api/v1/ai/tasks/${id}/ask-user`, { question: 'Amb qui?' }, comAgent);
    await api('POST', `/api/v1/tasks/${id}/take-over`, { status: 'doing' });

    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { ...comAgent, accept: 'application/json, text/event-stream' },
      payload: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'get_briefing', arguments: {} },
      },
    });

    const text = res.body;
    expect(text).toContain('taken_over');
    expect(text).toContain('Preparar la reunió');
  });
});
