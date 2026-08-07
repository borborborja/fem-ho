/**
 * Compartir un àmbit dins de la instància.
 *
 * Tres coses decideixen si això és utilitzable, i cap és el camí feliç:
 *
 * 1. Que un convit inventat i un de gastat responguin **igual**, o es poden enumerar.
 * 2. Que qui accepta hi entri de debò i vegi el que hi ha.
 * 3. Que **descompartir descomparteixi**: fins avui, treure un membre el treia del
 *    servidor i li deixava totes les tasques al dispositiu per sempre, perquè el filtre
 *    del sync excloïa les files en comptes d'enviar-les com a esborrades.
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

const tmp = mkdtempSync(join(tmpdir(), 'femho-grants-'));
const NOW = '2026-08-07T09:00:00.000Z';
const PASSWORD = 'la-contrasenya-de-prova';

let conn: Connection;
let app: FastifyInstance;
let ownerAuth: Record<string, string>;
let guestAuth: Record<string, string>;
let ownerId: string;
let guestId: string;
let scopeId: string;

async function api(
  method: 'GET' | 'POST' | 'DELETE',
  url: string,
  payload?: Record<string, unknown>,
  headers = ownerAuth,
): Promise<LightMyRequestResponse> {
  return payload === undefined
    ? app.inject({ method, url, headers })
    : app.inject({ method, url, headers, payload });
}

async function login(email: string): Promise<Record<string, string>> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password: PASSWORD },
  });
  return { authorization: `Bearer ${res.json<{ access_token: string }>().access_token}` };
}

beforeAll(async () => {
  for (const k of Object.keys(process.env)) if (k.startsWith('FEMHO_')) delete process.env[k];

  conn = connect(`sqlite://${join(tmp, 't.db')}`);
  await migrateToLatest(conn.db, { engine: 'sqlite' });

  const hash = await hashPassword(PASSWORD);
  ownerId = uuidv7();
  guestId = uuidv7();
  await sql`
    INSERT INTO users (id, email, name, password_hash, kind, role, created_at, updated_at)
    VALUES (${ownerId}, 'borja@e.com', 'Borja', ${hash}, 'human', 'admin', ${NOW}, ${NOW})
  `.execute(conn.db);
  await sql`
    INSERT INTO users (id, email, name, password_hash, kind, role, created_at, updated_at)
    VALUES (${guestId}, 'alba@e.com', 'Alba', ${hash}, 'human', 'member', ${NOW}, ${NOW})
  `.execute(conn.db);

  scopeId = uuidv7();
  await sql`
    INSERT INTO scopes (id, name, kind, color, owner_id, position, created_at, updated_at)
    VALUES (${scopeId}, 'Família', 'individual', '--plou-pink', ${ownerId}, 'a1', ${NOW}, ${NOW})
  `.execute(conn.db);

  app = buildApp(
    { ...loadConfig('0.1.0-test'), logLevel: 'silent', dataDir: tmp },
    { connection: conn, secret: 'x'.repeat(40) },
  );

  ownerAuth = await login('borja@e.com');
  guestAuth = await login('alba@e.com');
});

afterAll(async () => {
  await app.close();
  await conn.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe('un convit a un àmbit', () => {
  let token: string;

  it("l'emet el propietari i el token surt UN sol cop", async () => {
    const res = await api('POST', `/api/v1/scopes/${scopeId}/invites`, { role: 'collaborator' });
    expect(res.statusCode, res.body).toBe(201);

    const body = res.json<{ invite_url: string; role: string }>();
    expect(body.role).toBe('collaborator');
    token = body.invite_url.split('/join/')[1]!;
    expect(token.length).toBeGreaterThan(24);

    // I a la llista de convits **no hi torna**: del hash no es pot recuperar.
    const llista = await api('GET', `/api/v1/scopes/${scopeId}/invites`);
    expect(llista.body).not.toContain(token);
  });

  it("qui el rep pot mirar de qui és abans d'acceptar", async () => {
    const res = await api('GET', `/api/v1/join/${token}`, undefined, guestAuth);
    expect(res.statusCode).toBe(200);
    const preview = res.json<{ scope_name: string; invited_by: string }>();
    expect(preview.scope_name).toBe('Família');
    expect(preview.invited_by).toBe('Borja');
  });

  /**
   * **Un àmbit compartit és col·lectiu.** El convit es va emetre des d'un àmbit
   * individual; si acceptar-lo no el convertís, les tasques se li assignarien soles al
   * propietari (`docs/01` §4) i qui entra no en veuria cap com a seva.
   */
  it("acceptar-lo hi entra, i converteix l'àmbit a col·lectiu", async () => {
    const res = await api('POST', `/api/v1/join/${token}`, {}, guestAuth);
    expect(res.statusCode, res.body).toBe(200);

    const scopes = await api('GET', '/api/v1/scopes', undefined, guestAuth);
    const seus = scopes.json<{ id: string; kind: string }[]>().find((s) => s.id === scopeId);
    expect(seus).toBeDefined();
    expect(seus?.kind).toBe('collective');
  });

  it('i tornar-lo a obrir no peta ni gasta un altre ús', async () => {
    const res = await api('POST', `/api/v1/join/${token}`, {}, guestAuth);
    expect(res.statusCode).toBe(200);
  });

  /**
   * `docs/10` §4 per als enllaços compartits: no es filtra si un token existeix. Val
   * igual aquí — si un d'inventat digués 404 i un de gastat digués 410, es podrien
   * enumerar convits.
   */
  it('un convit inventat i un de gastat responen igual', async () => {
    const gastat = await api('GET', `/api/v1/join/${token}`, undefined, guestAuth);
    const inventat = await api('GET', `/api/v1/join/${'z'.repeat(32)}`, undefined, guestAuth);

    expect(gastat.statusCode).toBe(inventat.statusCode);
    expect(gastat.json<{ type: string }>().type).toBe(inventat.json<{ type: string }>().type);
  });
});

describe('descompartir descomparteix de debò', () => {
  it("qui surt d'un àmbit el rep a `dropped_scopes` i esborra el que en tingui", async () => {
    // Una tasca dins de l'àmbit compartit, i el convidat sincronitza fins avui.
    await api('POST', '/api/v1/tasks', { scope_id: scopeId, title: 'La compra' });

    const primera = await api('GET', '/api/v1/sync', undefined, guestAuth);
    const cursor = primera.json<{ next_cursor: string; changes: unknown[] }>();
    expect(cursor.changes.length).toBeGreaterThan(0);

    // I ara se'n va.
    const fora = await api('DELETE', `/api/v1/scopes/${scopeId}/members/me`, undefined, guestAuth);
    expect(fora.statusCode).toBe(204);

    /**
     * **Aquesta és l'asserció que abans hauria fallat.** El comentari del codi deia que
     * arribaven tombstones i el que passava era que les files quedaven excloses: el
     * client no rebia res i es quedava les tasques per sempre.
     */
    const segona = await api(
      'GET',
      `/api/v1/sync?cursor=${encodeURIComponent(cursor.next_cursor)}`,
      undefined,
      guestAuth,
    );
    expect(segona.json<{ dropped_scopes: string[] }>().dropped_scopes).toContain(scopeId);
  });
});

/**
 * Els calendaris es comparteixen **un per un**.
 *
 * Aquest és el punt més delicat de la funció: un esdeveniment no té `scope_id` propi —el
 * treu del calendari— i per tant la seva fila del registre de canvis porta l'`scope_id`
 * de l'àmbit. Un filtre per àmbit sol el deixaria arribar al receptor encara que el
 * calendari no s'hagi compartit, i **no faria fallar res**.
 */
describe('un calendari no compartit no arriba al membre', () => {
  let privat: string;
  let compartit: string;
  let altreScope: string;

  beforeAll(async () => {
    altreScope = uuidv7();
    await sql`
      INSERT INTO scopes (id, name, kind, color, owner_id, position, created_at, updated_at)
      VALUES (${altreScope}, 'Casa', 'collective', '--plou-blue', ${ownerId}, 'a2', ${NOW}, ${NOW})
    `.execute(conn.db);
    await sql`
      INSERT INTO scope_members (id, scope_id, user_id, role, created_at)
      VALUES (${uuidv7()}, ${altreScope}, ${guestId}, 'collaborator', ${NOW})
    `.execute(conn.db);

    privat = uuidv7();
    compartit = uuidv7();
    await sql`
      INSERT INTO calendars (id, scope_id, name, kind, origin, shared_with_scope,
                             created_at, updated_at)
      VALUES (${privat}, ${altreScope}, 'El meu', 'events', 'local', 0, ${NOW}, ${NOW})
    `.execute(conn.db);
    await sql`
      INSERT INTO calendars (id, scope_id, name, kind, origin, shared_with_scope,
                             created_at, updated_at)
      VALUES (${compartit}, ${altreScope}, 'De tots', 'events', 'local', 1, ${NOW}, ${NOW})
    `.execute(conn.db);

    /**
     * Per l'API i no per SQL: el sync només envia el que hi ha a `change_log`, i una
     * inserció directa no hi escriu. Una prova que hi inserís a mà passaria pel filtre
     * de la pantalla i no diria res del camí que acaba al telèfon.
     */
    for (const [calendar, titol] of [
      [privat, 'Metge'],
      [compartit, 'Sopar'],
    ] as const) {
      const res = await api('POST', '/api/v1/events', {
        calendar_id: calendar,
        summary: titol,
        starts_at: '2026-08-10T18:00:00.000Z',
        ends_at: '2026-08-10T19:00:00.000Z',
      });
      expect(res.statusCode, res.body).toBe(201);
    }
  });

  it('el propietari veu els seus dos calendaris', async () => {
    const res = await api('GET', '/api/v1/calendars');
    const ids = res.json<{ id: string }[]>().map((c) => c.id);
    expect(ids).toContain(privat);
    expect(ids).toContain(compartit);
  });

  it('i el membre només el compartit', async () => {
    const res = await api('GET', '/api/v1/calendars', undefined, guestAuth);
    const ids = res.json<{ id: string }[]>().map((c) => c.id);
    expect(ids).toContain(compartit);
    expect(ids).not.toContain(privat);
  });

  it("ni els esdeveniments del que no s'ha compartit", async () => {
    const res = await api(
      'GET',
      '/api/v1/events?from=2026-08-01&to=2026-08-31',
      undefined,
      guestAuth,
    );
    expect(res.body).toContain('Sopar');
    expect(res.body).not.toContain('Metge');
  });

  /**
   * I **pel sync tampoc**, que és el camí que acaba al SQLite del telèfon. Si arribés
   * aquí, la fuita seria permanent encara que la pantalla el filtrés.
   */
  it('ni pel sync', async () => {
    const res = await api('GET', '/api/v1/sync', undefined, guestAuth);
    expect(res.body).toContain('Sopar');
    expect(res.body).not.toContain('Metge');
  });
});
