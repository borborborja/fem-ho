/**
 * «No puc seguir sense tu», i què el fa marxar.
 *
 * La marca d'atenció és el que fa que una pregunta d'un agent **arribi**: fins ara la podia
 * escriure en un comentari i allà es quedava, i per veure-la calia obrir la tasca —quan el
 * motiu per obrir-la era justament el que no se sabia.
 *
 * El que es prova aquí és la regla sencera, que té tres meitats i totes tres importen:
 *
 *   - **Només un agent** la pot aixecar. Vol dir «un agent espera una resposta teva»; si la
 *     pogués aixecar qualsevol, deixaria de voler dir això.
 *   - **La baixa respondre**, no mirar-la. No hi ha cap botó de «vist»: deixaria la
 *     pantalla neta amb l'agent esperant per sempre.
 *   - **I completar la tasca.** Una tasca feta ja no espera res, i si la marca hi quedés
 *     només es podria treure responent una cosa que ja no cal.
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

const tmp = mkdtempSync(join(tmpdir(), 'femho-attention-'));
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

/** Una tasca delegada, que és l'única que un agent pot arribar a agafar. */
async function tascaDelegada(title: string): Promise<string> {
  const created = await api('POST', '/api/v1/tasks', { scope_id: scopeId, title });
  const id = created.json<{ id: string }>().id;
  await api('POST', `/api/v1/tasks/${id}/ai-mode`, { ai_mode: 'delegated' });
  return id;
}

async function espera(id: string): Promise<boolean> {
  const res = await api('GET', `/api/v1/tasks/${id}`);
  return res.json<{ needs_attention: boolean }>().needs_attention;
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

describe('un agent pregunta i la tasca demana atenció', () => {
  it('la pregunta és un comentari, i a més aixeca la marca', async () => {
    const id = await tascaDelegada('Enviar la factura');
    expect(await espera(id)).toBe(false);

    const res = await api(
      'POST',
      `/api/v1/ai/tasks/${id}/ask-user`,
      { question: 'A quin dels dos correus, el de la gestoria o el teu?' },
      comAgent,
    );
    expect(res.statusCode, res.body).toBe(201);

    // **És un comentari i s'hi queda**: un canal separat voldria dir un lloc més on mirar.
    const comentaris = await api('GET', `/api/v1/tasks/${id}/comments`);
    expect(comentaris.json<{ body: string }[]>().map((c) => c.body)).toContain(
      'A quin dels dos correus, el de la gestoria o el teu?',
    );

    expect(await espera(id)).toBe(true);

    // I «des de quan», que és mitja resposta: una pregunta de fa deu minuts i una de fa
    // tres dies no volen dir el mateix.
    const tasca = await api('GET', `/api/v1/tasks/${id}`);
    expect(tasca.json<{ attention_asked_at: string | null }>().attention_asked_at).not.toBeNull();

    // I queda a l'historial com el que és: t'ha preguntat.
    const historial = await api('GET', `/api/v1/tasks/${id}/activity`);
    expect(historial.json<{ data: { verb: string }[] }>().data.map((e) => e.verb)).toContain(
      'asked',
    );
  });

  it('respondre-hi la baixa, i mirar-la no', async () => {
    const id = await tascaDelegada('Reservar el tren');
    await api(
      'POST',
      `/api/v1/ai/tasks/${id}/ask-user`,
      { question: 'Anada i tornada?' },
      comAgent,
    );

    // Llegir la tasca —que és el que faria un «vist»— no la toca.
    expect(await espera(id)).toBe(true);
    expect(await espera(id)).toBe(true);

    await api('POST', `/api/v1/tasks/${id}/comments`, { body: 'Anada i tornada, sí.' });
    expect(await espera(id)).toBe(false);

    // I es llegeix a l'historial que va marxar perquè algú va respondre.
    const historial = await api('GET', `/api/v1/tasks/${id}/activity`);
    expect(historial.json<{ data: { verb: string }[] }>().data.map((e) => e.verb)).toContain(
      'answered',
    );
  });

  it("un comentari de l'agent no la baixa: seguiria parlant sol", async () => {
    const id = await tascaDelegada('Fer la comanda');
    await api('POST', `/api/v1/ai/tasks/${id}/ask-user`, { question: 'Quantes?' }, comAgent);

    await api('POST', `/api/v1/tasks/${id}/comments`, { body: 'Segueixo esperant.' }, comAgent);
    expect(await espera(id)).toBe(true);
  });

  it('completar la tasca la baixa: una tasca feta no espera res', async () => {
    const id = await tascaDelegada('Comprar els segells');
    await api('POST', `/api/v1/ai/tasks/${id}/ask-user`, { question: 'Quants?' }, comAgent);
    expect(await espera(id)).toBe(true);

    await api('POST', `/api/v1/tasks/${id}/complete`);
    expect(await espera(id)).toBe(false);
  });

  it('una persona no pot aixecar-la: no vol dir «recorda-t’ho»', async () => {
    const id = await tascaDelegada('Trucar al taller');
    const res = await api('POST', `/api/v1/ai/tasks/${id}/ask-user`, { question: 'I ara?' });
    expect(res.statusCode).toBe(403);
    expect(await espera(id)).toBe(false);
  });

  it('una pregunta buida no és cap pregunta', async () => {
    const id = await tascaDelegada('Res a dir');
    const res = await api('POST', `/api/v1/ai/tasks/${id}/ask-user`, { question: '  ' }, comAgent);
    expect(res.statusCode).toBe(422);
    expect(await espera(id)).toBe(false);
  });
});
