/**
 * docs/13 M10 · comparació amb implementacions de referència (docs/07 §11).
 *
 * "És la manera més ràpida de trobar què respons diferent." Es llancen les **mateixes**
 * peticions a Fem-ho, a Radicale i a Xandikos, i es compara la forma de la resposta.
 *
 * No es compara byte a byte: cada servidor té els seus prefixos i el seu ordre, i això
 * és precisament el que un client no ha de mirar. El que es compara és què hi ha:
 * l'element, el codi, i el format dels valors.
 *
 * Per aixecar-los:
 *
 *     sudo docker compose -f tools/caldav-reference/compose.yaml up -d
 *
 * Si no hi són, aquestes proves **se salten i es veu que se salten**. Una comparació que
 * passi en silenci sense haver comparat res és pitjor que no tenir-la.
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
import { DAV, child, children, parseXml } from './xml.js';

const RADICALE = 'http://localhost:15232';
const XANDIKOS = 'http://localhost:15233';
const NOW = '2026-08-06T09:00:00.000Z';
const PASSWORD = 'la-contrasenya-de-la-borja';

const tmp = mkdtempSync(join(tmpdir(), 'femho-ref-'));

let conn: Connection;
let server: Server;
let femho: string;

async function viu(base: string): Promise<boolean> {
  try {
    const response = await fetch(`${base}/`, {
      method: 'OPTIONS',
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function options(base: string): Promise<Headers> {
  return (await fetch(`${base}/`, { method: 'OPTIONS' })).headers;
}

/**
 * La comprovació es fa **aquí dalt i no a `beforeAll`**.
 *
 * `it.skipIf(…)` s'avalua quan es recullen les proves, que és abans que corri cap
 * `beforeAll`. Amb la comprovació allà dins, la condició sempre llegia el valor inicial
 * i les proves se saltaven encara que les referències hi fossin — i la suite ho hauria
 * reportat igual de verda. Una comparació que se salta en silenci és pitjor que no
 * tenir-la.
 */
const disponibles: string[] = (
  await Promise.all([
    viu(RADICALE).then((ok) => (ok ? 'radicale' : '')),
    viu(XANDIKOS).then((ok) => (ok ? 'xandikos' : '')),
  ])
).filter((name) => name !== '');

beforeAll(async () => {
  conn = connect(`sqlite://${join(tmp, 'test.db')}`);
  await migrateToLatest(conn.db, { engine: 'sqlite' });

  const userId = uuidv7();
  await sql`
    INSERT INTO users (id, email, name, password_hash, kind, role, created_at, updated_at)
    VALUES (${userId}, 'borja@example.com', 'Borja', ${await hashPassword(PASSWORD)},
            'human', 'admin', ${NOW}, ${NOW})
  `.execute(conn.db);
  await sql`
    INSERT INTO scopes (id, name, kind, color, owner_id, position, created_at, updated_at)
    VALUES (${uuidv7()}, 'Personal', 'individual', '--plou-blue', ${userId}, 'a1', ${NOW}, ${NOW})
  `.execute(conn.db);

  server = buildDavServer(conn);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  femho = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await conn.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe(`referències disponibles: ${disponibles.join(', ') || 'CAP'}`, () => {
  it('la llista surt al nom del bloc, perquè no se salti res en silenci', () => {
    // Aquesta no falla mai: només deixa constància al llistat de proves. Si diu "CAP",
    // les de sota surten com a saltades i es veu que no s'ha comparat res.
    expect(Array.isArray(disponibles)).toBe(true);
  });
});

describe('OPTIONS', () => {
  it.skipIf(disponibles.length === 0)(
    'els tres anuncien els mateixos senyals que un client busca',
    async () => {
      const nostre = (await options(femho)).get('dav') ?? '';
      const senyals = (valor: string): string[] =>
        valor
          .split(',')
          .map((token) => token.trim())
          .filter((token) => token !== '');

      /**
       * Els que decideixen si un client considera que hi ha un CalDAV a l'altra banda.
       * Cada referència n'anuncia més (`extended-mkcol`, `quota`, `add-member`…), però
       * aquests quatre els tenen tots.
       */
      const imprescindibles = ['1', '2', '3', 'calendar-access'];
      for (const senyal of imprescindibles) expect(senyals(nostre)).toContain(senyal);

      for (const base of [RADICALE, XANDIKOS]) {
        if (!(await viu(base))) continue;
        const seus = senyals((await options(base)).get('dav') ?? '');
        for (const senyal of imprescindibles) expect(seus).toContain(senyal);
      }
    },
  );

  it.skipIf(disponibles.length === 0)('tots anuncien els verbs DAV a Allow', async () => {
    const verbs = (valor: string): string[] => valor.split(',').map((token) => token.trim());
    const nostre = verbs((await options(femho)).get('allow') ?? '');

    for (const verb of ['PROPFIND', 'PROPPATCH', 'REPORT', 'PUT', 'DELETE']) {
      expect(nostre).toContain(verb);
    }

    for (const base of [RADICALE, XANDIKOS]) {
      if (!(await viu(base))) continue;
      const seus = verbs((await options(base)).get('allow') ?? '');
      for (const verb of ['PROPFIND', 'REPORT', 'PUT', 'DELETE']) expect(seus).toContain(verb);
    }
  });
});

describe('la forma del multistatus', () => {
  const PETICIO = `<?xml version="1.0" encoding="utf-8"?>
    <d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:no-existeix-aquesta/></d:prop></d:propfind>`;

  async function propfind(base: string, path: string, auth?: string): Promise<string> {
    const headers: Record<string, string> = { Depth: '0', 'Content-Type': 'application/xml' };
    if (auth !== undefined) headers.Authorization = auth;
    return (await fetch(`${base}${path}`, { method: 'PROPFIND', headers, body: PETICIO })).text();
  }

  /** L'estructura d'una resposta, sense mirar prefixos ni ordre. */
  function forma(xml: string): { hrefs: number; estats: string[] } {
    const root = parseXml(xml);
    if (root === undefined) return { hrefs: 0, estats: [] };

    const responses = children(root, DAV, 'response');
    const estats = responses.flatMap((response) =>
      children(response, DAV, 'propstat').map(
        (propstat) => child(propstat, DAV, 'status')?.text.trim() ?? '',
      ),
    );
    return { hrefs: responses.length, estats: [...new Set(estats)].sort() };
  }

  it.skipIf(disponibles.length === 0)(
    'una propietat desconeguda dona un propstat amb 404, com a les referències',
    async () => {
      const auth = `Basic ${Buffer.from(`borja@example.com:${PASSWORD}`).toString('base64')}`;
      const nostra = forma(await propfind(femho, '/dav/calendars/borja/personal-todos/', auth));

      expect(nostra.hrefs).toBe(1);
      // Dos propstat: el que s'ha trobat i el que no. Respondre-ho tot amb 200 i el
      // valor buit fa que el client es pensi que la propietat existeix.
      expect(nostra.estats).toEqual(['HTTP/1.1 200 OK', 'HTTP/1.1 404 Not Found']);

      for (const base of [RADICALE, XANDIKOS]) {
        if (!(await viu(base))) continue;
        const seva = forma(await propfind(base, '/'));
        // La referència ha de fer el mateix: si no, el que està malament és la nostra
        // lectura de l'RFC i no la implementació.
        expect(seva.estats).toContain('HTTP/1.1 404 Not Found');
      }
    },
  );

  it.skipIf(disponibles.length === 0)('tothom posa un href per resposta', async () => {
    for (const base of [RADICALE, XANDIKOS]) {
      if (!(await viu(base))) continue;
      const root = parseXml(await propfind(base, '/'));
      for (const response of children(root!, DAV, 'response')) {
        expect(child(response, DAV, 'href')).toBeDefined();
      }
    }
  });
});

describe('el format dels valors', () => {
  it.skipIf(disponibles.length === 0)('un etag va entre cometes, a tot arreu', async () => {
    // RFC 9110 §8.8.3 ho exigeix, i els clients que comparen la capçalera literalment
    // fallen si no hi són.
    const auth = `Basic ${Buffer.from(`borja@example.com:${PASSWORD}`).toString('base64')}`;
    const uid = 'comparacio';

    const creat = await fetch(`${femho}/dav/calendars/borja/personal-todos/${uid}.ics`, {
      method: 'PUT',
      headers: { Authorization: auth, 'Content-Type': 'text/calendar' },
      body: `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//P//CA\r\nBEGIN:VTODO\r\nUID:${uid}\r\nSUMMARY:X\r\nEND:VTODO\r\nEND:VCALENDAR`,
    });
    expect(creat.headers.get('etag')).toMatch(/^".+"$/u);

    for (const base of [RADICALE, XANDIKOS]) {
      if (!(await viu(base))) continue;
      const response = await fetch(`${base}/user/cal/${uid}.ics`, {
        method: 'PUT',
        headers: { 'Content-Type': 'text/calendar' },
        body: `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//P//CA\r\nBEGIN:VTODO\r\nUID:${uid}\r\nSUMMARY:X\r\nEND:VTODO\r\nEND:VCALENDAR`,
      });
      const etag = response.headers.get('etag');
      // Si la referència no en dona cap, no hi ha res a comparar; si en dona, ha
      // d'anar entre cometes igual que el nostre.
      if (etag !== null) expect(etag).toMatch(/^(W\/)?".+"$/u);
    }
  });
});
