/**
 * docs/13 M10 · el camí DAV contra el servidor VIU, no contra funcions soltes.
 *
 * "CalDAV no es pot donar per bo amb tests unitaris" (docs/07 §11). Aquí s'engega el
 * servidor de debò en un port efímer i s'hi llancen les mateixes peticions que fa un
 * client, amb els verbs en majúscules.
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
import { ALLOWED_METHODS, DAV_COMPLIANCE } from './server.js';
import { CALDAV, CALENDARSERVER, DAV, attribute, child, children, parseXml } from './xml.js';

const tmp = mkdtempSync(join(tmpdir(), 'femho-dav-'));
const NOW = '2026-08-06T09:00:00.000Z';
const PASSWORD = 'la-contrasenya-de-la-borja';

let conn: Connection;
let server: Server;
let base: string;
let userId: string;
let scopeId: string;
let projectId: string;

interface DavResponse {
  status: number;
  headers: Headers;
  text: string;
}

async function dav(
  method: string,
  path: string,
  {
    body,
    depth,
    auth = `Basic ${Buffer.from(`borja@example.com:${PASSWORD}`).toString('base64')}`,
  }: { body?: string; depth?: string; auth?: string | null } = {},
): Promise<DavResponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/xml; charset=utf-8' };
  if (auth !== null) headers.Authorization = auth;
  if (depth !== undefined) headers.Depth = depth;

  // El verb va en MAJÚSCULES: `fetch` només normalitza els estàndard, i `propfind` en
  // minúscules viatja així i el servidor remot respon 501 (docs/07 §1).
  const response = await fetch(`${base}${path}`, {
    method: method.toUpperCase(),
    headers,
    ...(body === undefined ? {} : { body }),
    redirect: 'manual',
  });

  return { status: response.status, headers: response.headers, text: await response.text() };
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
    VALUES (${scopeId}, 'Casa i família', 'individual', '--plou-blue', ${userId}, 'a1', ${NOW}, ${NOW})
  `.execute(conn.db);

  projectId = uuidv7();
  await sql`
    INSERT INTO projects (id, scope_id, name, position, created_at, updated_at)
    VALUES (${projectId}, ${scopeId}, 'Reforma l·lògica', 'a1', ${NOW}, ${NOW})
  `.execute(conn.db);

  await sql`
    INSERT INTO tasks (id, scope_id, title, status, position, created_by, created_at, updated_at)
    VALUES (${uuidv7()}, ${scopeId}, 'Comprar pa', 'todo', 'a1', ${userId}, ${NOW}, ${NOW})
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

describe('OPTIONS', () => {
  it('anuncia calendar-access, o DAVx⁵ no el considera un CalDAV', async () => {
    const response = await dav('OPTIONS', '/dav/');
    expect(response.status).toBe(200);
    expect(response.headers.get('dav')).toBe(DAV_COMPLIANCE);
    expect(response.headers.get('dav')).toContain('calendar-access');
    expect(response.headers.get('allow')).toBe(ALLOWED_METHODS);
  });

  it('es respon SENSE credencials', async () => {
    // Els clients el fan servir per saber si hi ha un CalDAV a l'altra banda abans de
    // tenir credencials. Demanar-les aquí fa que alguns es rendeixin.
    const response = await dav('OPTIONS', '/dav/', { auth: null });
    expect(response.status).toBe(200);
  });

  it("anuncia tots els verbs DAV, no només els d'HTTP", async () => {
    const allow = (await dav('OPTIONS', '/dav/')).headers.get('allow') ?? '';
    for (const verb of ['PROPFIND', 'PROPPATCH', 'REPORT', 'MKCALENDAR', 'MKCOL']) {
      expect(allow).toContain(verb);
    }
  });
});

describe('autenticació', () => {
  it('sense credencials, 401 amb WWW-Authenticate', async () => {
    const response = await dav('PROPFIND', '/dav/', { auth: null, depth: '0' });
    expect(response.status).toBe(401);
    // Sense aquesta capçalera el client no ensenya cap finestra de credencials.
    expect(response.headers.get('www-authenticate')).toContain('Basic');
  });

  it('una contrasenya dolenta també és 401', async () => {
    const response = await dav('PROPFIND', '/dav/', {
      auth: `Basic ${Buffer.from('borja@example.com:no').toString('base64')}`,
      depth: '0',
    });
    expect(response.status).toBe(401);
  });

  it('un usuari que no existeix triga el mateix que una contrasenya dolenta', async () => {
    const mesura = async (credential: string): Promise<number> => {
      const inici = process.hrtime.bigint();
      await dav('PROPFIND', '/dav/', {
        auth: `Basic ${Buffer.from(credential).toString('base64')}`,
        depth: '0',
      });
      return Number(process.hrtime.bigint() - inici) / 1e6;
    };

    const inexistent = await mesura('ningu@example.com:sigui-el-que-sigui');
    const dolenta = await mesura('borja@example.com:no-és-aquesta');

    // Si l'usuari inexistent tornés de seguida, el temps de resposta diria quins
    // correus existeixen. Es verifica contra el hash de mentida i per tant triga igual.
    expect(inexistent).toBeGreaterThan(dolenta * 0.3);
  });

  it("l'esquema Basic no distingeix majúscules", async () => {
    const response = await dav('PROPFIND', '/dav/', {
      auth: `basic ${Buffer.from(`borja@example.com:${PASSWORD}`).toString('base64')}`,
      depth: '0',
    });
    expect(response.status).toBe(207);
  });
});

describe('descobriment', () => {
  it('.well-known redirigeix', async () => {
    const response = await dav('PROPFIND', '/.well-known/caldav', { auth: null });
    expect(response.status).toBe(301);
    expect(response.headers.get('location')).toContain('/dav/');
  });

  it('current-user-principal, que és el pas 2 de la cadena', async () => {
    const response = await dav('PROPFIND', '/dav/', {
      depth: '0',
      body: `<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>`,
    });

    expect(response.status).toBe(207);
    const root = parseXml(response.text)!;
    const principal = findProp(root, DAV, 'current-user-principal');
    expect(child(principal!, DAV, 'href')!.text).toBe('/dav/principals/borja/');
  });

  it('calendar-home-set, que és el pas 3', async () => {
    const response = await dav('PROPFIND', '/dav/principals/borja/', {
      depth: '0',
      body: `<propfind xmlns="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
               <prop><c:calendar-home-set/></prop>
             </propfind>`,
    });

    const home = findProp(parseXml(response.text)!, CALDAV, 'calendar-home-set');
    expect(child(home!, DAV, 'href')!.text).toBe('/dav/calendars/borja/');
  });

  it('Depth: 1 sobre el home retorna DUES col·leccions per contenidor', async () => {
    const response = await dav('PROPFIND', '/dav/calendars/borja/', {
      depth: '1',
      body: `<d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:displayname/></d:prop></d:propfind>`,
    });

    const hrefs = collectionHrefs(response.text);

    // Àmbit i projecte, i cadascun amb -events i -todos (D9).
    expect(hrefs).toContain('/dav/calendars/borja/casa-i-familia-events/');
    expect(hrefs).toContain('/dav/calendars/borja/casa-i-familia-todos/');
    expect(hrefs).toContain('/dav/calendars/borja/casa-i-familia-reforma-llogica-events/');
    expect(hrefs).toContain('/dav/calendars/borja/casa-i-familia-reforma-llogica-todos/');
  });

  it("l'ela geminada i els accents surten llegibles a la URL", async () => {
    const hrefs = collectionHrefs(
      (await dav('PROPFIND', '/dav/calendars/borja/', { depth: '1' })).text,
    );
    // `l·l` → `ll`, no `l-l`: si es tragués el punt volat DESPRÉS dels accents, la
    // ela geminada quedaria partida.
    expect(hrefs.some((h) => h.includes('reforma-llogica'))).toBe(true);
    expect(hrefs.some((h) => h.includes('l-logica'))).toBe(false);
  });
});

describe('supported-calendar-component-set', () => {
  it('AQUESTA és la que decideix si DAVx⁵ veu res', async () => {
    const response = await dav('PROPFIND', '/dav/calendars/borja/casa-i-familia-todos/', {
      depth: '0',
      body: `<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
               <d:prop><c:supported-calendar-component-set/></d:prop>
             </d:propfind>`,
    });

    const set = findProp(parseXml(response.text)!, CALDAV, 'supported-calendar-component-set');
    const comp = child(set!, CALDAV, 'comp');
    expect(attribute(comp!, 'name')).toBe('VTODO');
  });

  it("la col·lecció d'esdeveniments diu VEVENT i no barreja", async () => {
    const response = await dav('PROPFIND', '/dav/calendars/borja/casa-i-familia-events/', {
      depth: '0',
      body: `<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
               <d:prop><c:supported-calendar-component-set/></d:prop>
             </d:propfind>`,
    });

    const set = findProp(parseXml(response.text)!, CALDAV, 'supported-calendar-component-set');
    // RFC 4791 §5.2 prohibeix recursos de components mixtos: mai les dues.
    expect(children(set!, CALDAV, 'comp')).toHaveLength(1);
    expect(attribute(child(set!, CALDAV, 'comp')!, 'name')).toBe('VEVENT');
  });

  it('PROPPATCH no la pot canviar: és protegida', async () => {
    const response = await dav('PROPPATCH', '/dav/calendars/borja/casa-i-familia-todos/', {
      body: `<d:propertyupdate xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
               <d:set><d:prop><c:supported-calendar-component-set>
                 <c:comp name="VEVENT"/>
               </c:supported-calendar-component-set></d:prop></d:set>
             </d:propertyupdate>`,
    });

    expect(response.status).toBe(207);
    // 403 per propietat, no un 403 sencer: així el client sap QUINA no ha pogut canviar.
    expect(response.text).toContain('403 Forbidden');

    const encara = await dav('PROPFIND', '/dav/calendars/borja/casa-i-familia-todos/', {
      depth: '0',
      body: `<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
               <d:prop><c:supported-calendar-component-set/></d:prop></d:propfind>`,
    });
    expect(encara.text).toContain('VTODO');
  });
});

describe('propietats de sincronització', () => {
  it('ctag i sync-token surten del mateix comptador', async () => {
    const response = await dav('PROPFIND', '/dav/calendars/borja/casa-i-familia-todos/', {
      depth: '0',
      body: `<d:propfind xmlns:d="DAV:" xmlns:cs="http://calendarserver.org/ns/">
               <d:prop><cs:getctag/><d:sync-token/></d:prop></d:propfind>`,
    });

    const root = parseXml(response.text)!;
    const ctag = findProp(root, CALENDARSERVER, 'getctag')!.text;
    const token = findProp(root, DAV, 'sync-token')!.text;

    expect(ctag).not.toBe('');
    // Els dos porten el mateix `seq` a dins: un canvi els mou tots dos alhora.
    expect(token).toContain(ctag.split('-').at(-1));
  });

  it('una propietat que no existeix es respon 404, no 200 buida', async () => {
    const response = await dav('PROPFIND', '/dav/calendars/borja/casa-i-familia-todos/', {
      depth: '0',
      body: `<d:propfind xmlns:d="DAV:"><d:prop><d:no-existeix-aquesta/></d:prop></d:propfind>`,
    });

    // Amb un 200 i el valor buit el client es pensa que existeix i la torna a demanar
    // per sempre.
    expect(response.text).toContain('404 Not Found');
  });
});

describe('robustesa', () => {
  it('un verb DAV que encara no es gestiona és 405 amb Allow', async () => {
    // `LOCK` és a la taula de mètodes de Node i per tant hi arriba. Un verb inventat
    // com `BREW` el rebutja el parser d'HTTP abans, amb un 400, i no prova res d'aquí.
    const response = await dav('LOCK', '/dav/calendars/borja/');
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toContain('PROPFIND');
  });

  it('una ruta inventada és 404, no 500', async () => {
    const response = await dav('PROPFIND', '/dav/calendars/borja/no-existeix-todos/', {
      depth: '0',
    });
    expect(response.status).toBe(404);
  });

  it('una col·lecció sense sufix de tipus no existeix', async () => {
    // Sense `-events` o `-todos` no se sap quin component serveix, i inventar-s'ho
    // seria exactament el recurs de components mixtos que l'RFC prohibeix.
    const response = await dav('PROPFIND', '/dav/calendars/borja/casa-i-familia/', { depth: '0' });
    expect(response.status).toBe(404);
  });

  it('un PROPFIND sense cos és allprop, no un error', async () => {
    const response = await dav('PROPFIND', '/dav/calendars/borja/casa-i-familia-todos/', {
      depth: '0',
    });
    expect(response.status).toBe(207);
    expect(response.text).toContain('resourcetype');
  });
});

/** La primera propietat amb aquest nom, dins de qualsevol `propstat` de la resposta. */
function findProp(root: ReturnType<typeof parseXml>, uri: string, local: string) {
  for (const response of children(root!, DAV, 'response')) {
    for (const propstat of children(response, DAV, 'propstat')) {
      const found = child(child(propstat, DAV, 'prop')!, uri, local);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

function collectionHrefs(xml: string): string[] {
  return children(parseXml(xml)!, DAV, 'response').map(
    (response) => child(response, DAV, 'href')!.text,
  );
}
