/**
 * Els adjunts.
 *
 * `docs/10` §8 fixa quatre coses que no són opcionals, i cadascuna té la seva prova:
 * fora de l'arrel web, servits per un handler que comprova permisos, mai per una ruta
 * endevinable, i **el tipus inferit del contingut i no de l'extensió**.
 *
 * I una cinquena que surt d'aquesta feina: un adjunt d'un esdeveniment d'un calendari
 * que no s'ha compartit **no ha de sortir**, encara que l'àmbit sí que ho estigui.
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
import { safeFilename, sniffMime } from './attachments.js';

const tmp = mkdtempSync(join(tmpdir(), 'femho-att-'));
const NOW = '2026-08-07T09:00:00.000Z';
const PASSWORD = 'la-contrasenya-de-prova';

let conn: Connection;
let app: FastifyInstance;
let auth: Record<string, string>;
let altreAuth: Record<string, string>;
let scopeId: string;
let taskId: string;

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

/** Puja bytes crus, com ho farà el navegador amb un `File`. */
async function upload(url: string, data: Buffer, headers = auth): Promise<LightMyRequestResponse> {
  return app.inject({
    method: 'POST',
    url,
    headers: { ...headers, 'content-type': 'application/octet-stream' },
    payload: data,
  });
}

/** Les entrades d'historial d'una entitat, per comprovar la regla 4 sense repetir SQL. */
async function rastre(entityId: string): Promise<{ verb: string; entity_type: string }[]> {
  const rows = await sql<{ verb: string; entity_type: string }>`
    SELECT verb, entity_type FROM activity_log WHERE entity_id = ${entityId}
    ORDER BY created_at, id
  `.execute(conn.db);
  return rows.rows;
}

beforeAll(async () => {
  for (const k of Object.keys(process.env)) if (k.startsWith('FEMHO_')) delete process.env[k];

  conn = connect(`sqlite://${join(tmp, 't.db')}`);
  await migrateToLatest(conn.db, { engine: 'sqlite' });

  const hash = await hashPassword(PASSWORD);
  const userId = uuidv7();
  const altreId = uuidv7();
  await sql`
    INSERT INTO users (id, email, name, password_hash, kind, role, created_at, updated_at)
    VALUES (${userId}, 'b@e.com', 'Borja', ${hash}, 'human', 'admin', ${NOW}, ${NOW})
  `.execute(conn.db);
  await sql`
    INSERT INTO users (id, email, name, password_hash, kind, role, created_at, updated_at)
    VALUES (${altreId}, 'a@e.com', 'Alba', ${hash}, 'human', 'member', ${NOW}, ${NOW})
  `.execute(conn.db);

  scopeId = uuidv7();
  await sql`
    INSERT INTO scopes (id, name, kind, color, owner_id, position, created_at, updated_at)
    VALUES (${scopeId}, 'Personal', 'individual', '--plou-blue', ${userId}, 'a1', ${NOW}, ${NOW})
  `.execute(conn.db);

  app = buildApp(
    { ...loadConfig('0.1.0-test'), logLevel: 'silent', dataDir: tmp },
    { connection: conn, secret: 'x'.repeat(40) },
  );

  for (const [email, target] of [
    ['b@e.com', 'owner'],
    ['a@e.com', 'other'],
  ] as const) {
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password: PASSWORD },
    });
    const header = {
      authorization: `Bearer ${login.json<{ access_token: string }>().access_token}`,
    };
    if (target === 'owner') auth = header;
    else altreAuth = header;
  }

  taskId = (await api('POST', '/api/v1/tasks', { scope_id: scopeId, title: 'Amb adjunt' })).json<{
    id: string;
  }>().id;
});

afterAll(async () => {
  await app.close();
  await conn.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe('el tipus surt del contingut', () => {
  it("i no de l'extensió que digui el client", () => {
    // Un PNG de debò, es digui com es digui.
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(sniffMime(png)).toBe('image/png');
  });

  /**
   * **Mai `text/html`.** Servir HTML de l'usuari amb el seu tipus és XSS emmagatzemat, i
   * el que sembla HTML és exactament el cas que hi porta.
   */
  it('i el que sembla HTML es serveix com a text pla', () => {
    expect(sniffMime(Buffer.from('<script>alert(1)</script>', 'utf8'))).toBe('text/plain');
  });

  it('i el que no es reconeix va a octet-stream, que el navegador baixa', () => {
    expect(sniffMime(Buffer.from([0x00, 0x01, 0x02, 0xff]))).toBe('application/octet-stream');
  });
});

describe('el nom del fitxer', () => {
  it('no pot escapar del directori', () => {
    expect(safeFilename('../../etc/passwd')).toBe('passwd');
    expect(safeFilename('C:\\Windows\\system.ini')).toBe('system.ini');
  });

  it('ni portar un salt de línia, que seria una injecció de capçalera', () => {
    expect(safeFilename('nom\r\nX-Injectat: si.txt')).toBe('nomX-Injectat: si.txt');
  });
});

describe('pujar i baixar', () => {
  let attachmentId: string;

  it("es puja amb el cos cru i torna les metadades sense la ruta d'emmagatzematge", async () => {
    const res = await upload(
      `/api/v1/tasks/${taskId}/attachments?filename=${encodeURIComponent('rebut.pdf')}`,
      Buffer.from('%PDF-1.4 una factura qualsevol', 'utf8'),
    );
    expect(res.statusCode, res.body).toBe(201);

    const row = res.json<{ id: string; mime_type: string; filename: string }>();
    attachmentId = row.id;
    expect(row.filename).toBe('rebut.pdf');
    expect(row.mime_type).toBe('application/pdf');
    // La ruta interna no surt mai: el client demana per identificador.
    expect(res.body).not.toContain('storage_path');
    expect(res.body).not.toContain('attachments/2026');

    // Regla 4: tota escriptura deixa rastre, i el nom hi ha de constar.
    expect(await rastre(attachmentId)).toEqual([{ verb: 'created', entity_type: 'attachment' }]);
  });

  it('i es baixa amb les capçaleres que docs/10 §8 exigeix', async () => {
    const res = await api('GET', `/api/v1/attachments/${attachmentId}/content`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(String(res.headers['content-disposition'])).toContain('attachment');
    expect(String(res.headers['content-disposition'])).toContain('rebut.pdf');
    expect(res.body).toContain('una factura qualsevol');
  });

  /**
   * **Ni per una ruta endevinable ni per a qui no és de l'àmbit.** Les dues coses són el
   * mateix punt: el fitxer només surt del handler que comprova permisos.
   */
  it("i qui no és de l'àmbit no el pot baixar encara que en sàpiga l'identificador", async () => {
    const res = await api(
      'GET',
      `/api/v1/attachments/${attachmentId}/content`,
      undefined,
      altreAuth,
    );
    expect(res.statusCode).toBe(403);
  });

  it("s'esborra en suau, perquè la tombstone pugui viatjar pel sync", async () => {
    const res = await api('DELETE', `/api/v1/attachments/${attachmentId}`);
    expect(res.statusCode).toBe(204);

    const fila = await sql<{ deleted_at: string | null }>`
      SELECT deleted_at FROM attachments WHERE id = ${attachmentId}
    `.execute(conn.db);
    expect(fila.rows[0]?.deleted_at).not.toBeNull();
    expect((await rastre(attachmentId)).map((r) => r.verb)).toEqual(['created', 'deleted']);

    const despres = await api('GET', `/api/v1/attachments/${attachmentId}/content`);
    expect(despres.statusCode).toBe(404);
  });
});

/**
 * El tall dels calendaris.
 *
 * Compartir l'àmbit comparteix el kanban sencer, però **els calendaris es trien un per
 * un**. Un esdeveniment no té `scope_id` propi —el treu del calendari— o sigui que
 * l'`assertScopeAccess` sol el deixaria passar. Aquesta és la fuita que no fa fallar res.
 */
describe("un adjunt d'un esdeveniment", () => {
  let compartitId: string;
  let reservatId: string;
  let reservatEventId: string;

  beforeAll(async () => {
    // Un àmbit col·lectiu de debò: convidem l'Alba i l'hi fem entrar.
    const scope = await api('POST', '/api/v1/scopes', {
      name: 'Casa',
      kind: 'collective',
      color: '--femho-scope-1',
    });
    const casaId = scope.json<{ id: string }>().id;

    const grant = await api('POST', `/api/v1/scopes/${casaId}/invites`, { role: 'collaborator' });
    expect(grant.statusCode, grant.body).toBe(201);
    // El token sencer només surt un cop, dins de l'URL del convit.
    const token = grant.json<{ invite_url: string }>().invite_url.split('/join/')[1]!;
    const join = await api('POST', `/api/v1/join/${token}`, {}, altreAuth);
    expect([200, 201]).toContain(join.statusCode);

    for (const [name, shared] of [
      ['Familiar', true],
      ['Metge', false],
    ] as const) {
      const cal = await api('POST', '/api/v1/calendars', {
        scope_id: casaId,
        name,
        color: '--femho-scope-1',
        kind: 'events',
      });
      expect(cal.statusCode, cal.body).toBe(201);
      const calId = cal.json<{ id: string }>().id;
      await api('PATCH', `/api/v1/calendars/${calId}`, { shared_with_scope: shared });

      const event = await api('POST', '/api/v1/events', {
        calendar_id: calId,
        summary: `Cita ${name}`,
        starts_at: '2026-09-01T10:00:00.000Z',
        ends_at: '2026-09-01T11:00:00.000Z',
      });
      expect([200, 201]).toContain(event.statusCode);
      const eventId = event.json<{ id: string }>().id;
      if (!shared) reservatEventId = eventId;

      const att = await upload(
        `/api/v1/events/${eventId}/attachments?filename=${name}.pdf`,
        Buffer.from(`%PDF-1.4 ${name}`, 'utf8'),
      );
      expect(att.statusCode, att.body).toBe(201);
      const attId = att.json<{ id: string }>().id;
      if (shared) compartitId = attId;
      else reservatId = attId;
    }
  });

  it("d'un calendari compartit el membre el veu sencer", async () => {
    const res = await api(
      'GET',
      `/api/v1/attachments/${compartitId}/content`,
      undefined,
      altreAuth,
    );
    expect(res.statusCode, res.body).toBe(200);
    expect(res.body).toContain('Familiar');
    // Regla 4 també per a l'adjunt d'esdeveniment.
    expect(await rastre(compartitId)).toEqual([{ verb: 'created', entity_type: 'attachment' }]);
  });

  it("d'un calendari que no s'ha compartit no surt, encara que l'àmbit sí que ho estigui", async () => {
    const res = await api('GET', `/api/v1/attachments/${reservatId}/content`, undefined, altreAuth);
    expect(res.statusCode, res.body).toBe(404);
  });

  /**
   * **I la llista es talla igual que els bytes.** Un nom de fitxer ja diu massa: deixar
   * llistar «Analitica-2026.pdf» i només negar-ne el contingut no és tallar res.
   */
  it("ni se'n pot llistar el nom", async () => {
    const res = await api(
      'GET',
      `/api/v1/events/${reservatEventId}/attachments`,
      undefined,
      altreAuth,
    );
    expect(res.statusCode, res.body).toBe(404);
    expect(res.body).not.toContain('Metge.pdf');
  });

  /**
   * **I pel sync, que és on la fuita seria silenciosa.** Les metadades viatgen
   * (`docs/06` §9) i els bytes no; si el post-filtre no cobrís els adjunts, el nom del
   * fitxer d'un calendari reservat acabaria al SQLite del mòbil de l'altra persona i no
   * ho sabria ningú.
   */
  it("ni pel sync, i el que sí que passa no porta la ruta d'emmagatzematge", async () => {
    const res = await api('GET', '/api/v1/sync', undefined, altreAuth);
    expect(res.statusCode, res.body).toBe(200);

    const adjunts = res
      .json<{
        changes: { entity: string; id: string; op: string; data?: { filename?: string } }[];
      }>()
      .changes.filter((c) => c.entity === 'attachment');

    // El compartit arriba com a `upsert` i amb les metadades de debò, no com a tombstone.
    const compartit = adjunts.find((c) => c.id === compartitId);
    expect(compartit?.op).toBe('upsert');
    expect(compartit?.data?.filename).toBe('Familiar.pdf');

    expect(adjunts.map((c) => c.id)).not.toContain(reservatId);
    expect(res.body).not.toContain('storage_path');
    expect(res.body).not.toContain('Metge.pdf');
  });

  it('i el propietari els veu tots dos, que compartir no és perdre de vista', async () => {
    for (const id of [compartitId, reservatId]) {
      expect((await api('GET', `/api/v1/attachments/${id}/content`)).statusCode).toBe(200);
    }
  });
});

describe('la mida', () => {
  it('per damunt del límit es rebutja amb un 413 que diu quin és', async () => {
    const gran = Buffer.alloc(26 * 1_048_576, 0x41);
    const res = await upload(`/api/v1/tasks/${taskId}/attachments?filename=gran.bin`, gran);
    expect(res.statusCode).toBe(413);
    expect(res.body).toContain('25');
  });
});
