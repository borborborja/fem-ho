/**
 * docs/13 M12 · les rutes de compartits, incloent-hi la pàgina pública.
 *
 * El que decideix aquesta part: que el token **no viatgi mai** —ni al referent, ni als
 * registres—, que marcar des d'un enllaç **escrigui a les dades reals** amb la cascada,
 * i que una sessió de convidat no serveixi per a res més.
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
import { anonymiseToken } from './shares.js';

const tmp = mkdtempSync(join(tmpdir(), 'femho-sharehttp-'));
const NOW = '2026-08-06T09:00:00.000Z';
const PASSWORD = 'la-contrasenya-de-la-borja';
const SECRET = 'el-secret-de-la-instancia-prou-llarg';

let conn: Connection;
let app: FastifyInstance;
let auth: { authorization: string };
let userId: string;
let scopeId: string;
let taskId: string;
let checklistId: string;
let itemIds: string[];

async function api(
  method: 'GET' | 'POST' | 'DELETE',
  url: string,
  payload?: Record<string, unknown>,
): Promise<LightMyRequestResponse> {
  return payload === undefined
    ? app.inject({ method, url, headers: auth })
    : app.inject({ method, url, headers: auth, payload });
}

/** Una petició pública: **sense cap credencial**, com la faria un convidat. */
async function publica(
  url: string,
  payload: Record<string, unknown> = {},
): Promise<LightMyRequestResponse> {
  return app.inject({ method: 'POST', url, payload });
}

async function nouEnllac(
  body: Record<string, unknown> = {},
): Promise<{ token: string; id: string }> {
  const res = await api('POST', '/api/v1/shares', { task_id: taskId, ...body });
  const cos = res.json<{ token: string; share: { id: string } }>();
  return { token: cos.token, id: cos.share.id };
}

beforeAll(async () => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('FEMHO_')) delete process.env[key];
  }

  conn = connect(`sqlite://${join(tmp, 'test.db')}`);
  await migrateToLatest(conn.db, { engine: 'sqlite' });

  userId = uuidv7();
  await sql`
    INSERT INTO users (id, email, name, password_hash, kind, role, created_at, updated_at)
    VALUES (${userId}, 'borja@example.com', 'Borja', ${await hashPassword(PASSWORD)},
            'human', 'admin', ${NOW}, ${NOW})
  `.execute(conn.db);

  scopeId = uuidv7();
  await sql`
    INSERT INTO scopes (id, name, kind, color, owner_id, position, created_at, updated_at)
    VALUES (${scopeId}, 'Casa', 'individual', '--plou-blue', ${userId}, 'a1', ${NOW}, ${NOW})
  `.execute(conn.db);

  app = buildApp(
    { ...loadConfig('0.1.0-test'), logLevel: 'silent', baseUrl: 'https://femho.example.com' },
    { connection: conn, secret: SECRET },
  );

  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: 'borja@example.com', password: PASSWORD },
  });
  auth = { authorization: `Bearer ${login.json<{ access_token: string }>().access_token}` };

  // El cas exacte del brief: "Fer la maleta" amb la llista "Maleta Borja" a dins.
  taskId = (
    await api('POST', '/api/v1/tasks', { scope_id: scopeId, title: 'Fer la maleta' })
  ).json<{
    id: string;
  }>().id;

  checklistId = (
    await api('POST', `/api/v1/tasks/${taskId}/checklists`, { name: 'Maleta Borja' })
  ).json<{ id: string }>().id;

  itemIds = [];
  for (const text of ['Carregador', 'Passaport']) {
    const res = await api('POST', `/api/v1/checklists/${checklistId}/items`, { text });
    itemIds.push(res.json<{ id: string }>().id);
  }
});

afterAll(async () => {
  await app.close();
  await conn.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe("crear l'enllaç", () => {
  it("torna l'URL sencer, i és l'única vegada", async () => {
    const res = await api('POST', '/api/v1/shares', { task_id: taskId, permission: 'check' });

    expect(res.statusCode).toBe(201);
    const cos = res.json<{ url: string; token: string }>();
    expect(cos.url).toBe(`https://femho.example.com/s/${cos.token}`);

    // A la llista NO hi torna a ser: no es pot recuperar del hash (docs/10 §6).
    const llista = await api('GET', '/api/v1/shares');
    expect(llista.body).not.toContain(cos.token);
  });

  it('la llista diu si té contrasenya, però no quina', async () => {
    await nouEnllac({ password: 'la-maleta' });
    const llista = await api('GET', '/api/v1/shares');

    const trobat = llista.json<{ data: { has_password: boolean }[] }>().data[0];
    expect(trobat?.has_password).toBe(true);
    expect(llista.body).not.toContain('la-maleta');
  });
});

describe('AQUESTES són les capçaleres que decideixen', () => {
  it('Referrer-Policy: no-referrer a la pàgina pública', async () => {
    const { token } = await nouEnllac();
    const res = await publica(`/s/${token}`);

    /**
     * Sense això, si el convidat clica un enllaç extern des de la pàgina compartida, el
     * token viatja a la capçalera de referent d'un servidor de tercers (docs/10 §4).
     */
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });

  it("hi és també quan l'enllaç no val", async () => {
    // El cas dolent és justament on és més fàcil oblidar-se-la.
    const res = await publica('/s/un-token-inventat-que-no-existeix');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });

  it("no s'indexa ni es guarda a cap memòria cau", async () => {
    const { token } = await nouEnllac();
    const res = await publica(`/s/${token}`);

    expect(String(res.headers['x-robots-tag'])).toContain('noindex');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('el token anonimitzat pels registres no el deixa reconstruir', () => {
    const token = 'aBcDeFgHiJkLmNoPqRsTuVwXyZ234567';
    const anonim = anonymiseToken(token);

    expect(anonim).toHaveLength(8);
    expect(token).not.toContain(anonim);
    // Prou per correlacionar dues línies del mateix enllaç...
    expect(anonymiseToken(token)).toBe(anonim);
    // ...i diferent per a un altre.
    expect(anonymiseToken(`${token}x`)).not.toBe(anonim);
  });
});

describe('obrir-lo', () => {
  it('sense contrasenya, es veu el contingut de seguida', async () => {
    const { token } = await nouEnllac({ permission: 'check' });
    const res = await publica(`/s/${token}`);

    expect(res.statusCode).toBe(200);
    const cos = res.json<{
      permission: string;
      guest_label: string;
      task: { title: string };
      checklists: { name: string; items: unknown[] }[];
    }>();

    expect(cos.permission).toBe('check');
    expect(cos.task.title).toBe('Fer la maleta');
    expect(cos.checklists[0]?.name).toBe('Maleta Borja');
    expect(cos.guest_label).toMatch(/^Extern · [0-9a-f]{4}$/u);
  });

  it('amb contrasenya, primer la demana', async () => {
    const { token } = await nouEnllac({ password: 'la-maleta' });

    const sense = await publica(`/s/${token}`);
    expect(sense.statusCode).toBe(401);
    expect(sense.json<{ reason: string }>().reason).toBe('needs_password');

    const amb = await publica(`/s/${token}`, { password: 'la-maleta' });
    expect(amb.statusCode).toBe(200);
  });

  it('un token inventat respon EXACTAMENT igual que un amb contrasenya', async () => {
    const { token } = await nouEnllac({ password: 'la-maleta' });

    const existent = await publica(`/s/${token}`);
    const inventat = await publica('/s/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');

    expect(inventat.statusCode).toBe(existent.statusCode);
    expect(inventat.json()).toEqual(existent.json());
  });

  it("amb nom demanat, el nom surt a l'etiqueta", async () => {
    const { token } = await nouEnllac({ require_name: true });

    const sense = await publica(`/s/${token}`);
    expect(sense.json<{ reason: string }>().reason).toBe('needs_name');

    const amb = await publica(`/s/${token}`, { name: 'Marta' });
    expect(amb.json<{ guest_label: string }>().guest_label).toBe('Extern · Marta');
  });

  it('un enllaç revocat deixa de servir', async () => {
    const { token, id } = await nouEnllac();
    expect((await publica(`/s/${token}`)).statusCode).toBe(200);

    expect((await api('DELETE', `/api/v1/shares/${id}`)).statusCode).toBe(204);
    expect((await publica(`/s/${token}`)).statusCode).toBe(401);
  });

  it('al sisè intent de contrasenya, 429 amb Retry-After', async () => {
    const { token } = await nouEnllac({ password: 'la-maleta' });

    for (let i = 0; i < 5; i += 1) await publica(`/s/${token}`, { password: 'dolenta' });

    const res = await publica(`/s/${token}`, { password: 'la-maleta' });
    expect(res.statusCode).toBe(429);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });
});

describe('marcar des de fora', () => {
  it('AQUESTA és la del brief: escriu a les dades REALS', async () => {
    const { token } = await nouEnllac({ permission: 'check' });

    const res = await publica(`/s/${token}/items/${itemIds[0]!}`, { done: true });
    expect(res.statusCode).toBe(200);

    const fila = await sql<{ done: number }>`
      SELECT done FROM checklist_items WHERE id = ${itemIds[0]!}
    `.execute(conn.db);
    expect(fila.rows[0]?.done).toBe(1);
  });

  it("queda a l'historial com a guest i amb source share", async () => {
    const { token } = await nouEnllac({ permission: 'check', require_name: true });
    await publica(`/s/${token}/items/${itemIds[1]!}`, { done: true, name: 'Marta' });

    const fila = await sql<{ actor_type: string; source: string; actor_label: string | null }>`
      SELECT actor_type, source, actor_label FROM activity_log
      WHERE actor_type = 'guest' ORDER BY id DESC LIMIT 1
    `.execute(conn.db);

    expect(fila.rows[0]?.actor_type).toBe('guest');
    expect(fila.rows[0]?.source).toBe('share');
    expect(fila.rows[0]?.actor_label).toBe('Extern · Marta');
  });

  it("la cascada amunt s'aplica igual", async () => {
    // Qui marca l'últim ítem de la maleta completa la llista com ho faria qualsevol
    // (docs/10 §5).
    const tasca = (
      await api('POST', '/api/v1/tasks', { scope_id: scopeId, title: 'Amb cascada' })
    ).json<{ id: string }>().id;
    const llista = (
      await api('POST', `/api/v1/tasks/${tasca}/checklists`, { name: 'Única' })
    ).json<{ id: string }>().id;
    const item = (
      await api('POST', `/api/v1/checklists/${llista}/items`, { text: "L'únic" })
    ).json<{ id: string }>().id;

    const res = await api('POST', '/api/v1/shares', { task_id: tasca, permission: 'check' });
    const { token } = res.json<{ token: string }>();

    const marcat = await publica(`/s/${token}/items/${item}`, { done: true });
    expect(marcat.statusCode).toBe(200);
    expect(marcat.json<{ cascade?: unknown }>().cascade).toBeDefined();
  });

  it('un enllaç de només VEURE no pot marcar', async () => {
    const { token } = await nouEnllac({ permission: 'view' });

    const res = await publica(`/s/${token}/items/${itemIds[0]!}`, { done: true });
    expect(res.statusCode).toBe(403);
    // El motiu és accionable: qui ha rebut l'enllaç sap que no és cosa seva.
    expect(res.json<{ reason: string }>().reason).toBe('read-only');
  });

  it('un token inventat no marca res', async () => {
    const res = await publica(`/s/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/items/${itemIds[0]!}`, {
      done: false,
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('el convidat no escala (cas 5 de docs/10 §10)', () => {
  it("l'enllaç no serveix per a cap ruta de l'API", async () => {
    const { token } = await nouEnllac({ permission: 'comment' });

    // Provar el token de compartit com si fos un token d'API.
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/tasks',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('no serveix per a un ALTRE enllaç', async () => {
    const primer = await nouEnllac({ permission: 'check' });
    const segon = await nouEnllac({ permission: 'check' });

    // Un ítem que és al mateix contingut, però demanat amb l'altre token: aquí es veu
    // que el que mana és el token, no la sessió.
    expect(
      (await publica(`/s/${primer.token}/items/${itemIds[0]!}`, { done: true })).statusCode,
    ).toBe(200);
    expect(
      (await publica(`/s/${segon.token}/items/${itemIds[0]!}`, { done: false })).statusCode,
    ).toBe(200);

    // I amb un de revocat, no.
    await api('DELETE', `/api/v1/shares/${primer.id}`);
    expect(
      (await publica(`/s/${primer.token}/items/${itemIds[0]!}`, { done: true })).statusCode,
    ).toBe(401);
  });
});
