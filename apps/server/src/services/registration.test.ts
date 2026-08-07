/**
 * El registre obert.
 *
 * `FEMHO_REGISTRATION` era **una opció que no feia res**: es publicava a `/info` i no hi
 * havia cap ruta de registre. Aquestes proves comproven que ara la porta la governa de
 * debò, i les tres coses que se'n deriven: qui arriba primer mana, qui arriba després no,
 * i el formulari no es pot fer servir per esbrinar qui té compte en aquesta casa.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../app.js';
import { loadConfig, type RegistrationMode } from '../config.js';
import { connect, type Connection } from '../db/connection.js';
import { migrateToLatest } from '../db/migrator.js';
import { lockout } from '../http/auth.js';

const PASSWORD = 'la-contrasenya-de-prova';

let tmp: string;
let conn: Connection;
let app: FastifyInstance;

/** Una instància nova per a cada prova: el "primer usuari" només passa un cop. */
async function instancia(registration: RegistrationMode): Promise<void> {
  tmp = mkdtempSync(join(tmpdir(), 'femho-reg-'));
  conn = connect(`sqlite://${join(tmp, 'r.db')}`);
  await migrateToLatest(conn.db, { engine: 'sqlite' });
  app = buildApp(
    { ...loadConfig('0.1.0-test'), logLevel: 'silent', dataDir: tmp, registration },
    { connection: conn, secret: 'x'.repeat(40) },
  );
}

async function registrar(
  email: string,
  name = 'Algú',
  password = PASSWORD,
): Promise<LightMyRequestResponse> {
  return app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { email, name, password },
  });
}

beforeEach(() => {
  for (const k of Object.keys(process.env)) if (k.startsWith('FEMHO_')) delete process.env[k];
});

afterEach(async () => {
  await app.close();
  await conn.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe('amb el registre tancat', () => {
  beforeEach(async () => {
    await instancia('disabled');
  });

  it("no es pot fer cap compte, i es diu què s'ha de fer", async () => {
    const res = await registrar('algu@e.com');
    expect(res.statusCode).toBe(403);
    expect(res.body).toContain('invitation');

    const quants = await sql<{ n: number }>`
      SELECT COUNT(*) AS n FROM users WHERE kind = 'human'
    `.execute(conn.db);
    expect(Number(quants.rows[0]?.n)).toBe(0);
  });

  /**
   * **`invite` tampoc obre la porta.** És el mode en què l'administrador convida un per
   * un; si el registre hi passés, convidar no voldria dir res.
   */
  it("i amb 'invite' tampoc, que per això hi ha els convits", async () => {
    await app.close();
    await conn.close();
    await instancia('invite');
    expect((await registrar('algu@e.com')).statusCode).toBe(403);
  });
});

describe('amb el registre obert', () => {
  beforeEach(async () => {
    await instancia('open');
  });

  it('el primer que es registra és administrador i deixa la sessió oberta', async () => {
    const res = await registrar('primera@e.com', 'Primera');
    expect(res.statusCode, res.body).toBe(201);

    // No cal tornar a iniciar sessió: qui acaba de posar la contrasenya ja ha demostrat
    // que la sap.
    const tokens = res.json<{ access_token: string; refresh_token: string }>();
    expect(tokens.access_token).toBeTruthy();
    expect(tokens.refresh_token).toBeTruthy();

    const qui = await sql<{ role: string; kind: string; name: string }>`
      SELECT role, kind, name FROM users WHERE email = 'primera@e.com'
    `.execute(conn.db);
    expect(qui.rows[0]).toMatchObject({ role: 'admin', kind: 'human', name: 'Primera' });
  });

  /**
   * **El primer registre ÉS el primer arrencament**, no una cosa al costat: la persona es
   * troba els tres àmbits inicials, com si hagués passat per `/setup`. Si algun dia són
   * dos camins diferents, un dels dos es quedarà enrere i serà el que decideixi qui mana.
   */
  it("i es troba els àmbits inicials, com qui passa per l'arrencada", async () => {
    await registrar('primera@e.com', 'Primera');

    const ambits = await sql<{ n: number }>`SELECT COUNT(*) AS n FROM scopes`.execute(conn.db);
    expect(Number(ambits.rows[0]?.n)).toBe(3);
  });

  it("i la porta d'arrencada queda tancada darrere seu", async () => {
    await registrar('primera@e.com', 'Primera');
    const setup = await app.inject({ method: 'GET', url: '/api/v1/setup' });
    expect(setup.json<{ open: boolean }>().open).toBe(false);
  });

  /** Sense això, obrir el registre seria regalar la instància a qui passés per allà. */
  it('el segon NO és administrador', async () => {
    await registrar('primera@e.com', 'Primera');
    const res = await registrar('segona@e.com', 'Segona');
    expect(res.statusCode, res.body).toBe(201);

    const qui = await sql<{ role: string }>`
      SELECT role FROM users WHERE email = 'segona@e.com'
    `.execute(conn.db);
    expect(qui.rows[0]?.role).toBe('member');
  });

  it('però sí que té un àmbit propi on posar la primera tasca', async () => {
    await registrar('primera@e.com', 'Primera');
    const res = await registrar('segona@e.com', 'Segona');
    const auth = {
      authorization: `Bearer ${res.json<{ access_token: string }>().access_token}`,
    };

    const ambits = await app.inject({ method: 'GET', url: '/api/v1/scopes', headers: auth });
    expect(ambits.json<{ id: string }[]>()).toHaveLength(1);
  });

  it('i pot entrar amb la contrasenya que ha posat', async () => {
    await registrar('primera@e.com', 'Primera');
    await registrar('segona@e.com', 'Segona');

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'segona@e.com', password: PASSWORD },
    });
    expect(login.statusCode, login.body).toBe(200);
  });

  /**
   * **El formulari no diu qui té compte aquí.**
   *
   * Un registre que respongui "aquest correu ja existeix" és una manera d'enumerar les
   * persones d'aquesta casa, i el login ja s'aguanta de no dir-ho (`docs/02` §2).
   */
  it('un correu que ja hi és respon igual que un de nou, i no crea res', async () => {
    await registrar('primera@e.com', 'Primera');
    const repetit = await registrar('primera@e.com', 'Un impostor', 'una-altra-de-prova');
    expect(repetit.statusCode).toBe(201);

    const quants = await sql<{ n: number }>`
      SELECT COUNT(*) AS n FROM users WHERE email = 'primera@e.com'
    `.execute(conn.db);
    expect(Number(quants.rows[0]?.n)).toBe(1);

    // I el nom i la contrasenya de qui hi era no s'han tocat.
    const qui = await sql<{ name: string }>`
      SELECT name FROM users WHERE email = 'primera@e.com'
    `.execute(conn.db);
    expect(qui.rows[0]?.name).toBe('Primera');

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'primera@e.com', password: 'una-altra-de-prova' },
    });
    expect(login.statusCode).toBe(401);
  });

  it('un correu que no ho sembla es rebutja', async () => {
    expect((await registrar('aixo-no-es-un-correu')).statusCode).toBe(422);
  });

  it('i un nom buit també, que si no ningú sap qui és', async () => {
    expect((await registrar('algu@e.com', '   ')).statusCode).toBe(422);
  });

  it('i una contrasenya massa curta', async () => {
    expect((await registrar('algu@e.com', 'Algú', 'curta')).statusCode).toBe(422);
  });

  /**
   * **El mateix bloqueig que el login.** Sense ell, una instància oberta és un formulari
   * per crear comptes en massa: cada intent fa treballar argon2id i deixa una fila.
   */
  it('els intents fallits es compten, i el bloqueig acaba responent 429', async () => {
    lockout.recordSuccess('insistent@e.com');

    let vist429 = false;
    for (let i = 0; i < 14; i += 1) {
      const res = await registrar('insistent@e.com', '', PASSWORD);
      if (res.statusCode === 429) {
        expect(res.headers['retry-after']).toBeDefined();
        vist429 = true;
        break;
      }
    }
    expect(vist429).toBe(true);
    lockout.recordSuccess('insistent@e.com');
  });
});
