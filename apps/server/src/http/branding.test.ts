/**
 * El logo de la instància, i **el que no s'hi accepta**.
 *
 * Un logo el puja qui administra, i el veu tothom qui obre l'app —fins i tot abans
 * d'entrar-hi. Això vol dir que les comprovacions no són tràmit: un SVG és XML i pot portar
 * `<script>`, i servit al mateix origen seria codi executant-se amb la sessió de tothom.
 *
 * Les tres coses que es proven són les tres que fan que això sigui segur: el tipus, la
 * mida, i les capçaleres amb què surt.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { hashPassword } from '../auth/password.js';
import { connect, type Connection } from '../db/connection.js';
import { migrateToLatest } from '../db/migrator.js';

const tmp = mkdtempSync(join(tmpdir(), 'femho-brand-'));
const NOW = '2026-08-12T10:00:00.000Z';
const PASSWORD = 'la-contrasenya-de-la-borja';

let conn: Connection;
let app: FastifyInstance;
let auth: { authorization: string };

const UN_SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');

beforeAll(async () => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('FEMHO_')) delete process.env[key];
  }
  process.env.FEMHO_DATA_DIR = tmp;

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
});

afterAll(async () => {
  await app.close();
  await conn.close();
  rmSync(tmp, { recursive: true, force: true });
  delete process.env.FEMHO_DATA_DIR;
});

describe('el logo de la instància', () => {
  it("sense cap, /info diu que no n'hi ha i /brand/logo fa 404", async () => {
    expect((await app.inject({ method: 'GET', url: '/brand/logo' })).statusCode).toBe(404);
    const info = await app.inject({ method: 'GET', url: '/info' });
    expect(info.json<{ logo_url: string | null }>().logo_url).toBeNull();
  });

  it('es puja, surt a /info i se serveix amb la cadena que el fa inofensiu', async () => {
    const pujada = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/branding/logo?filename=logo.svg',
      headers: { ...auth, 'content-type': 'image/svg+xml' },
      payload: UN_SVG,
    });
    expect(pujada.statusCode, pujada.body).toBe(200);

    const info = await app.inject({ method: 'GET', url: '/info' });
    expect(info.json<{ logo_url: string | null }>().logo_url).toBe('/brand/logo');

    const res = await app.inject({ method: 'GET', url: '/brand/logo' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/svg+xml');
    /**
     * **`sandbox` és el que fa que un SVG pujat no sigui codi.** Sense això, qui administra
     * podria posar un `<script>` que corre amb la sessió de tothom qui obre l'app.
     */
    expect(res.headers['content-security-policy']).toBe('sandbox');
    expect(res.headers['content-disposition']).toBe('inline');
  });

  it("i és públic: surt abans d'entrar, que és on fa falta", async () => {
    // Login i pàgina d'un enllaç compartit són les dues pantalles sense sessió.
    const res = await app.inject({ method: 'GET', url: '/brand/logo' });
    expect(res.statusCode).toBe(200);
  });

  it('un PDF no és un logo', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/branding/logo',
      headers: { ...auth, 'content-type': 'application/pdf' },
      payload: Buffer.from('%PDF-1.4'),
    });
    // Fastify el rebutja abans d'arribar-hi perquè no hi ha analitzador per a aquest tipus,
    // i si hi arribés el rebutjaria el servei: les dues portes tanquen.
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('i una imatge de dos megues, tampoc', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/branding/logo',
      headers: { ...auth, 'content-type': 'image/png' },
      payload: Buffer.alloc(2 * 1024 * 1024, 1),
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it("es pot treure, i llavors /info torna a dir que no n'hi ha", async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/v1/admin/branding/logo',
      headers: auth,
    });
    expect(res.statusCode).toBe(200);

    const info = await app.inject({ method: 'GET', url: '/info' });
    expect(info.json<{ logo_url: string | null }>().logo_url).toBeNull();
  });

  it('qui no administra no el pot canviar', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/branding/logo',
      headers: { 'content-type': 'image/svg+xml' },
      payload: UN_SVG,
    });
    expect(res.statusCode).toBe(401);
  });
});
