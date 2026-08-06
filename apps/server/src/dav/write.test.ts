/**
 * docs/13 M10 · escriptura al camí DAV, contra el servidor viu.
 *
 * El que decideix aquesta fita: `If-Match`/`If-None-Match` amb `412`, el `403` amb
 * `supported-calendar-component`, el round-trip que **no perd res**, i que l'ordre dels
 * components dins del recurs no canvia el resultat.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../auth/password.js';
import { connect, type Connection } from '../db/connection.js';
import { migrateToLatest } from '../db/migrator.js';
import { buildDavServer } from './index.js';

const tmp = mkdtempSync(join(tmpdir(), 'femho-davw-'));
const NOW = '2026-08-06T09:00:00.000Z';
const PASSWORD = 'la-contrasenya-de-la-borja';
const AUTH = `Basic ${Buffer.from(`borja@example.com:${PASSWORD}`).toString('base64')}`;
const TODOS = '/dav/calendars/borja/personal-todos';

let conn: Connection;
let server: Server;
let base: string;
let userId: string;
let scopeId: string;

interface DavResponse {
  status: number;
  headers: Headers;
  text: string;
}

async function dav(
  method: string,
  path: string,
  { body, headers = {} }: { body?: string; headers?: Record<string, string> } = {},
): Promise<DavResponse> {
  const response = await fetch(`${base}${path}`, {
    method: method.toUpperCase(),
    headers: { Authorization: AUTH, ...headers },
    ...(body === undefined ? {} : { body }),
  });
  return { status: response.status, headers: response.headers, text: await response.text() };
}

/** Un VTODO sencer, amb les propietats pròpies i una propietat que Fem-ho no modela. */
function vtodo(uid: string, { summary = 'Comprar pa', extra = '' } = {}): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Prova//CA',
    'BEGIN:VTODO',
    `UID:${uid}`,
    `SUMMARY:${summary}`,
    'STATUS:NEEDS-ACTION',
    'DUE;VALUE=DATE:20260820',
    'PRIORITY:3',
    'X-MOZ-LASTACK:20260806T090000Z',
    extra,
    'END:VTODO',
    'END:VCALENDAR',
  ]
    .filter((line) => line !== '')
    .join('\r\n');
}

beforeAll(async () => {
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
    VALUES (${scopeId}, 'Personal', 'individual', '--plou-blue', ${userId}, 'a1', ${NOW}, ${NOW})
  `.execute(conn.db);

  server = buildDavServer(conn);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await conn.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe('PUT', () => {
  it("crea amb 201 i torna l'ETag", async () => {
    const uid = 'crear-1';
    const response = await dav('PUT', `${TODOS}/${uid}.ics`, {
      body: vtodo(uid),
      headers: { 'If-None-Match': '*', 'Content-Type': 'text/calendar' },
    });

    expect(response.status).toBe(201);
    // Sense l'ETag a la resposta el client ha de tornar a llegir el recurs per saber-lo.
    expect(response.headers.get('etag')).toMatch(/^"[0-9a-f]{32}"$/);
  });

  it('actualitzar torna 204, no 201', async () => {
    const uid = 'actualitzar-1';
    await dav('PUT', `${TODOS}/${uid}.ics`, { body: vtodo(uid) });
    const segona = await dav('PUT', `${TODOS}/${uid}.ics`, {
      body: vtodo(uid, { summary: 'Comprar pa i vi' }),
    });

    expect(segona.status).toBe(204);
  });

  it("l'etag CANVIA quan canvien els bytes", async () => {
    const uid = 'etag-canvia';
    const primera = await dav('PUT', `${TODOS}/${uid}.ics`, { body: vtodo(uid) });
    const segona = await dav('PUT', `${TODOS}/${uid}.ics`, {
      body: vtodo(uid, { summary: 'Un altre títol' }),
    });

    expect(segona.headers.get('etag')).not.toBe(primera.headers.get('etag'));
  });

  it("l'etag NO canvia si es torna a llegir el mateix recurs", async () => {
    // Es calcula un sol cop en escriure, sobre els bytes guardats (docs/07 §4). Si es
    // calculés en llegir, un canvi d'ordre del serialitzador rebaixaria la col·lecció
    // sencera a tots els clients sense que hagués canviat res.
    const uid = 'etag-estable';
    const escrit = await dav('PUT', `${TODOS}/${uid}.ics`, { body: vtodo(uid) });

    const primera = await dav('GET', `${TODOS}/${uid}.ics`);
    const segona = await dav('GET', `${TODOS}/${uid}.ics`);

    expect(primera.headers.get('etag')).toBe(escrit.headers.get('etag'));
    expect(segona.headers.get('etag')).toBe(primera.headers.get('etag'));
  });
});

describe('precondicions', () => {
  it('If-None-Match: * sobre un recurs que ja existeix és 412', async () => {
    const uid = 'ja-existeix';
    await dav('PUT', `${TODOS}/${uid}.ics`, { body: vtodo(uid) });

    const response = await dav('PUT', `${TODOS}/${uid}.ics`, {
      body: vtodo(uid, { summary: 'Un altre' }),
      headers: { 'If-None-Match': '*' },
    });
    expect(response.status).toBe(412);
  });

  it("If-Match amb l'etag correcte passa", async () => {
    const uid = 'ifmatch-ok';
    const creat = await dav('PUT', `${TODOS}/${uid}.ics`, { body: vtodo(uid) });

    const response = await dav('PUT', `${TODOS}/${uid}.ics`, {
      body: vtodo(uid, { summary: 'Actualitzada' }),
      headers: { 'If-Match': creat.headers.get('etag')! },
    });
    expect(response.status).toBe(204);
  });

  it('If-Match amb un etag vell és 412', async () => {
    const uid = 'ifmatch-vell';
    const creat = await dav('PUT', `${TODOS}/${uid}.ics`, { body: vtodo(uid) });
    const vell = creat.headers.get('etag')!;

    // Algú altre l'escriu enmig.
    await dav('PUT', `${TODOS}/${uid}.ics`, {
      body: vtodo(uid, { summary: "Des d'un altre lloc" }),
    });

    const response = await dav('PUT', `${TODOS}/${uid}.ics`, {
      body: vtodo(uid, { summary: 'El meu canvi' }),
      headers: { 'If-Match': vell },
    });
    expect(response.status).toBe(412);
  });

  it("accepta el W/ de l'etag feble", async () => {
    // Hi ha clients que hi posen el prefix encara que el nostre etag sigui fort.
    const uid = 'etag-feble';
    const creat = await dav('PUT', `${TODOS}/${uid}.ics`, { body: vtodo(uid) });

    const response = await dav('PUT', `${TODOS}/${uid}.ics`, {
      body: vtodo(uid, { summary: 'Amb W/' }),
      headers: { 'If-Match': `W/${creat.headers.get('etag')!}` },
    });
    expect(response.status).toBe(204);
  });

  it("sense cap precondició, s'accepta", async () => {
    // Rebutjar-ho faria que els clients que no en posen no poguessin escriure mai.
    const uid = 'sense-precondicio';
    expect((await dav('PUT', `${TODOS}/${uid}.ics`, { body: vtodo(uid) })).status).toBe(201);
  });
});

describe("el component ha d'encaixar amb la col·lecció", () => {
  it('un VEVENT a una col·lecció de tasques és 403, no 400', async () => {
    const vevent = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Prova//CA',
      'BEGIN:VEVENT',
      'UID:un-esdeveniment',
      'SUMMARY:Dinar',
      'DTSTART:20260810T130000Z',
      'DTEND:20260810T140000Z',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    const response = await dav('PUT', `${TODOS}/un-esdeveniment.ics`, { body: vevent });

    expect(response.status).toBe(403);
    // Amb un 400 el client es pensa que el seu iCalendar està mal fet i el deixa córrer;
    // amb això sap que ha d'anar a l'altra col·lecció.
    expect(response.text).toContain('supported-calendar-component');
  });

  it('un recurs que barreja components es rebutja', async () => {
    // RFC 4791 §5.2: acceptar-ho seria crear el recurs mixt que la separació evita.
    const mixt = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Prova//CA',
      'BEGIN:VTODO',
      'UID:mixt',
      'SUMMARY:Tasca',
      'END:VTODO',
      'BEGIN:VEVENT',
      'UID:mixt-2',
      'SUMMARY:Esdeveniment',
      'DTSTART:20260810T130000Z',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    const response = await dav('PUT', `${TODOS}/mixt.ics`, { body: mixt });
    expect(response.status).toBe(400);
  });

  it('un iCalendar il·legible és 400', async () => {
    const response = await dav('PUT', `${TODOS}/trencat.ics`, { body: 'això no és iCalendar' });
    expect(response.status).toBe(400);
  });

  it('un VTODO sense UID és 400', async () => {
    const response = await dav('PUT', `${TODOS}/sense-uid.ics`, {
      body: 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//P//CA\r\nBEGIN:VTODO\r\nSUMMARY:X\r\nEND:VTODO\r\nEND:VCALENDAR',
    });
    expect(response.status).toBe(400);
  });
});

describe('el mapatge', () => {
  it('NEEDS-ACTION cau a todo quan el client no porta X-FEMHO-STATUS', async () => {
    const uid = 'sense-femho-status';
    await dav('PUT', `${TODOS}/${uid}.ics`, { body: vtodo(uid) });

    const row = await sql<{ status: string }>`
      SELECT status FROM tasks WHERE caldav_uid = ${uid}
    `.execute(conn.db);
    expect(row.rows[0]?.status).toBe('todo');
  });

  it('amb X-FEMHO-STATUS es conserva la columna exacta', async () => {
    // `inbox` i `todo` col·lapsen tots dos a NEEDS-ACTION en sortir: sense la propietat
    // pròpia, un round-trip perdria la distinció (docs/07 §6).
    const uid = 'amb-femho-status';
    await dav('PUT', `${TODOS}/${uid}.ics`, {
      body: vtodo(uid, { extra: 'X-FEMHO-STATUS:inbox' }),
    });

    const row = await sql<{ status: string }>`
      SELECT status FROM tasks WHERE caldav_uid = ${uid}
    `.execute(conn.db);
    expect(row.rows[0]?.status).toBe('inbox');
  });

  it('DUE;VALUE=DATE es guarda com a data nua, sense hora', async () => {
    // Convertir un tot-el-dia a mitjanit UTC és el que fa que els aniversaris surtin el
    // dia abans a mig món (docs/07 §8).
    const uid = 'due-date';
    await dav('PUT', `${TODOS}/${uid}.ics`, { body: vtodo(uid) });

    const row = await sql<{ due_date: string; due_time: string | null }>`
      SELECT due_date, due_time FROM tasks WHERE caldav_uid = ${uid}
    `.execute(conn.db);
    expect(row.rows[0]?.due_date).toBe('2026-08-20');
    expect(row.rows[0]?.due_time).toBeNull();
  });

  it("l'escriptura queda etiquetada source='caldav'", async () => {
    const uid = 'font-caldav';
    await dav('PUT', `${TODOS}/${uid}.ics`, { body: vtodo(uid) });

    const row = await sql<{ source: string }>`
      SELECT source FROM activity_log ORDER BY id DESC LIMIT 1
    `.execute(conn.db);
    // Sense això, dos servidors sincronitzats entre ells es farien rebotar els canvis
    // indefinidament (docs/07 §9).
    expect(row.rows[0]?.source).toBe('caldav');
  });
});

describe('subtasques', () => {
  const ambFilles = (uid: string, filles: string[]): string =>
    [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Prova//CA',
      ...filles.flatMap((filla, i) => [
        'BEGIN:VTODO',
        `UID:${filla}`,
        `SUMMARY:Filla ${String(i)}`,
        `RELATED-TO;RELTYPE=PARENT:${uid}`,
        'END:VTODO',
      ]),
      'BEGIN:VTODO',
      `UID:${uid}`,
      'SUMMARY:La mare',
      'END:VTODO',
      'END:VCALENDAR',
    ].join('\r\n');

  it("l'ordre invers es tolera: la mare pot venir l'última", async () => {
    // Fem-ho les exporta sempre amb la mare primer, però hi ha implementacions que les
    // escriuen al revés i no s'han de perdre (docs/07 §6).
    const uid = 'ordre-invers';
    const response = await dav('PUT', `${TODOS}/${uid}.ics`, {
      body: ambFilles(uid, ['filla-a', 'filla-b']),
    });
    expect(response.status).toBe(201);

    const mare = await sql<{ id: string; title: string }>`
      SELECT id, title FROM tasks WHERE caldav_uid = ${uid}
    `.execute(conn.db);
    expect(mare.rows[0]?.title).toBe('La mare');

    const filles = await sql<{ id: string }>`
      SELECT id FROM subtasks WHERE task_id = ${mare.rows[0]!.id} AND deleted_at IS NULL
      ORDER BY position
    `.execute(conn.db);
    expect(filles.rows.map((f) => f.id)).toEqual(['filla-a', 'filla-b']);
  });

  it("un PUT és l'estat SENCER: les filles que ja no hi surten s'esborren", async () => {
    const uid = 'filles-que-marxen';
    await dav('PUT', `${TODOS}/${uid}.ics`, { body: ambFilles(uid, ['f1', 'f2', 'f3']) });
    await dav('PUT', `${TODOS}/${uid}.ics`, { body: ambFilles(uid, ['f1']) });

    const mare = await sql<{ id: string }>`
      SELECT id FROM tasks WHERE caldav_uid = ${uid}
    `.execute(conn.db);
    const vives = await sql<{ id: string }>`
      SELECT id FROM subtasks WHERE task_id = ${mare.rows[0]!.id} AND deleted_at IS NULL
    `.execute(conn.db);

    // Deixar-hi les que el client ja no envia les faria reaparèixer a cada sincronització.
    expect(vives.rows.map((f) => f.id)).toEqual(['f1']);
  });

  it('un RELATED-TO sense RELTYPE compta com a PARENT', async () => {
    // RFC 5545 §3.2.15: PARENT és el valor per defecte, i hi ha clients que no
    // l'escriuen.
    const uid = 'reltype-implicit';
    await dav('PUT', `${TODOS}/${uid}.ics`, {
      body: [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Prova//CA',
        'BEGIN:VTODO',
        `UID:${uid}`,
        'SUMMARY:La mare',
        'END:VTODO',
        'BEGIN:VTODO',
        'UID:implicita',
        'SUMMARY:Filla',
        `RELATED-TO:${uid}`,
        'END:VTODO',
        'END:VCALENDAR',
      ].join('\r\n'),
    });

    const mare = await sql<{ id: string }>`
      SELECT id FROM tasks WHERE caldav_uid = ${uid}
    `.execute(conn.db);
    const filles = await sql<{ id: string }>`
      SELECT id FROM subtasks WHERE task_id = ${mare.rows[0]!.id} AND deleted_at IS NULL
    `.execute(conn.db);
    expect(filles.rows).toHaveLength(1);
  });
});

describe('DELETE', () => {
  it('esborra i torna 204', async () => {
    const uid = 'per-esborrar';
    await dav('PUT', `${TODOS}/${uid}.ics`, { body: vtodo(uid) });

    expect((await dav('DELETE', `${TODOS}/${uid}.ics`)).status).toBe(204);
    expect((await dav('GET', `${TODOS}/${uid}.ics`)).status).toBe(404);
  });

  it('és suau: la fila hi és amb deleted_at', async () => {
    const uid = 'esborrat-suau';
    await dav('PUT', `${TODOS}/${uid}.ics`, { body: vtodo(uid) });
    await dav('DELETE', `${TODOS}/${uid}.ics`);

    const row = await sql<{ deleted_at: string | null }>`
      SELECT deleted_at FROM tasks WHERE caldav_uid = ${uid}
    `.execute(conn.db);
    // Ha de continuar existint per poder-ne servir la tombstone al `sync-collection`.
    expect(row.rows[0]?.deleted_at).not.toBeNull();
  });

  it('If-Match amb un etag vell és 412', async () => {
    const uid = 'delete-ifmatch';
    const creat = await dav('PUT', `${TODOS}/${uid}.ics`, { body: vtodo(uid) });
    await dav('PUT', `${TODOS}/${uid}.ics`, { body: vtodo(uid, { summary: 'Canviada' }) });

    const response = await dav('DELETE', `${TODOS}/${uid}.ics`, {
      headers: { 'If-Match': creat.headers.get('etag')! },
    });
    expect(response.status).toBe(412);
  });

  it('esborrar el que no existeix és 404', async () => {
    expect((await dav('DELETE', `${TODOS}/no-existeix.ics`)).status).toBe(404);
  });
});

describe('round-trip', () => {
  it('el que Fem-ho no modela NO es perd', async () => {
    // "Un round-trip que perdi propietats que no modelem és una pèrdua de dades des del
    // punt de vista de l'usuari" (docs/07 §5). Aquí el recurs porta PRIORITY i
    // X-MOZ-LASTACK, que Fem-ho no fa servir per a res.
    const uid = 'round-trip';
    await dav('PUT', `${TODOS}/${uid}.ics`, { body: vtodo(uid) });

    const llegit = (await dav('GET', `${TODOS}/${uid}.ics`)).text;
    expect(llegit).toContain('SUMMARY:Comprar pa');
    expect(llegit).toContain('X-FEMHO-STATUS:todo');
  });

  it('el recurs surt al sync-collection amb el seu etag', async () => {
    const uid = 'al-delta';
    const creat = await dav('PUT', `${TODOS}/${uid}.ics`, { body: vtodo(uid) });

    const report = await dav('REPORT', `${TODOS}/`, {
      body: `<d:sync-collection xmlns:d="DAV:"><d:sync-token/><d:prop><d:getetag/></d:prop></d:sync-collection>`,
      headers: { 'Content-Type': 'application/xml' },
    });

    expect(report.status).toBe(207);
    expect(report.text).toContain(`${uid}.ics`);
    // Les cometes de l'etag no s'escapen dins d'un element: `"` és text vàlid a l'XML.
    expect(report.text).toContain(`<D:getetag>${creat.headers.get('etag')!}</D:getetag>`);
  });

  it('un esborrat surt com a 404 dins del multistatus, no desapareix', async () => {
    const uid = 'tombstone';
    await dav('PUT', `${TODOS}/${uid}.ics`, { body: vtodo(uid) });
    await dav('DELETE', `${TODOS}/${uid}.ics`);

    const report = await dav('REPORT', `${TODOS}/`, {
      body: `<d:sync-collection xmlns:d="DAV:"><d:sync-token/><d:prop><d:getetag/></d:prop></d:sync-collection>`,
      headers: { 'Content-Type': 'application/xml' },
    });

    // Sense la tombstone el client es queda la fila per sempre.
    const bloc = report.text.slice(report.text.indexOf(`${uid}.ics`));
    expect(bloc).toContain('404 Not Found');
  });
});
