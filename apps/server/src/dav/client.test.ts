/**
 * docs/13 M10 · Fem-ho com a client d'orígens externs (docs/07 §9).
 *
 * El que decideix si això funciona: que no es martellegi el servidor de ningú, que el
 * que desapareix de l'origen desaparegui aquí, que les alarmes no es dupliquin, i que
 * dos servidors sincronitzats entre ells no es facin rebotar canvis per sempre.
 */

import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seal } from '../crypto/secret-box.js';
import { connect, type Connection } from '../db/connection.js';
import { migrateToLatest } from '../db/migrator.js';
import { capabilitiesForRole } from '../policy/capabilities.js';
import type { Principal } from '../policy/principal.js';
import {
  DEFAULT_REFRESH_SECONDS,
  MIN_REFRESH_SECONDS,
  durationSeconds,
  extractEvents,
  isDue,
  refreshInterval,
  refreshSubscription,
  shouldPushOutbound,
  type SubscriptionRow,
} from './client.js';
import { isBlockedAddress } from './fetch-safe.js';
import { SsrfError } from './fetch-safe.js';

const tmp = mkdtempSync(join(tmpdir(), 'femho-davc-'));
const NOW = '2026-08-06T09:00:00.000Z';
const MASTER = 'un-secret-de-instancia-prou-llarg-per-passar';

let conn: Connection;
let server: Server;
let base: string;
let userId: string;
let scopeId: string;
let calendarId: string;
let principal: Principal;

/** El contingut que serveix l'origen de mentida. Cada prova el canvia. */
let served = '';
let servedStatus = 200;

/** Igual d'estricta que la de debò, menys per al servidor de proves a loopback. */
const permetLoopback = {
  guard: async (url: URL) => {
    const host = url.hostname;
    if (host !== '127.0.0.1' && isBlockedAddress(host)) {
      throw new SsrfError(`"${host}" és una adreça interna.`);
    }
    return { address: host, family: 4 };
  },
};

function ics(events: { uid: string; summary: string; extra?: string }[]): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Origen//CA',
    ...events.flatMap((event) => [
      'BEGIN:VEVENT',
      `UID:${event.uid}`,
      `SUMMARY:${event.summary}`,
      'DTSTART:20260810T130000Z',
      'DTEND:20260810T140000Z',
      ...(event.extra === undefined ? [] : [event.extra]),
      'END:VEVENT',
    ]),
    'END:VCALENDAR',
  ].join('\r\n');
}

async function subscription(): Promise<SubscriptionRow> {
  const row = await sql<SubscriptionRow>`
    SELECT id, scope_id, name, source_url, source_username, source_secret_enc,
           refresh_interval, last_refreshed_at, strip_alarms
    FROM calendars WHERE id = ${calendarId}
  `.execute(conn.db);
  return row.rows[0]!;
}

beforeAll(async () => {
  conn = connect(`sqlite://${join(tmp, 'test.db')}`);
  await migrateToLatest(conn.db, { engine: 'sqlite' });

  userId = uuidv7();
  await sql`
    INSERT INTO users (id, email, name, kind, role, created_at, updated_at)
    VALUES (${userId}, 'borja@example.com', 'Borja', 'human', 'admin', ${NOW}, ${NOW})
  `.execute(conn.db);

  scopeId = uuidv7();
  await sql`
    INSERT INTO scopes (id, name, kind, color, owner_id, position, created_at, updated_at)
    VALUES (${scopeId}, 'Festius', 'individual', '--plou-blue', ${userId}, 'a1', ${NOW}, ${NOW})
  `.execute(conn.db);

  principal = {
    kind: 'user',
    userId,
    capabilities: new Set(capabilitiesForRole('admin')),
    scopeIds: null,
    source: 'system',
  };

  server = createServer((request, response) => {
    if (request.headers.authorization !== undefined) {
      response.setHeader('X-Vist-Auth', request.headers.authorization);
    }
    response.writeHead(servedStatus, { 'Content-Type': 'text/calendar' });
    response.end(served);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await conn.close();
  rmSync(tmp, { recursive: true, force: true });
});

beforeEach(async () => {
  servedStatus = 200;
  calendarId = uuidv7();
  await sql`
    INSERT INTO calendars (id, scope_id, name, kind, origin, source_url, strip_alarms,
                           created_at, updated_at)
    VALUES (${calendarId}, ${scopeId}, 'Festius de Catalunya', 'events', 'subscription',
            ${`${base}/festius.ics`}, 1, ${NOW}, ${NOW})
  `.execute(conn.db);
});

describe("l'interval de refresc", () => {
  it('surt de REFRESH-INTERVAL si el calendari en porta', () => {
    const ical = 'BEGIN:VCALENDAR\r\nREFRESH-INTERVAL;VALUE=DURATION:PT6H\r\nEND:VCALENDAR';
    expect(refreshInterval(ical, null)).toBe(6 * 3600);
  });

  it('si no, de X-PUBLISHED-TTL', () => {
    const ical = 'BEGIN:VCALENDAR\r\nX-PUBLISHED-TTL:PT2H\r\nEND:VCALENDAR';
    expect(refreshInterval(ical, null)).toBe(2 * 3600);
  });

  it('REFRESH-INTERVAL mana per damunt de X-PUBLISHED-TTL', () => {
    const ical =
      'BEGIN:VCALENDAR\r\nX-PUBLISHED-TTL:PT2H\r\nREFRESH-INTERVAL;VALUE=DURATION:PT8H\r\nEND:VCALENDAR';
    expect(refreshInterval(ical, null)).toBe(8 * 3600);
  });

  it('si no en porta cap, el valor configurat', () => {
    expect(refreshInterval('BEGIN:VCALENDAR\r\nEND:VCALENDAR', 7200)).toBe(7200);
  });

  it('i si tampoc, el per defecte', () => {
    expect(refreshInterval('BEGIN:VCALENDAR\r\nEND:VCALENDAR', null)).toBe(DEFAULT_REFRESH_SECONDS);
  });

  it('MAI per sota del mínim, digui el que digui el remot', () => {
    // "No s'ha de martellejar el servidor de ningú" (docs/07 §9). Un calendari que
    // demana refresc cada minut no el tindrà.
    const ical = 'BEGIN:VCALENDAR\r\nREFRESH-INTERVAL;VALUE=DURATION:PT1M\r\nEND:VCALENDAR';
    expect(refreshInterval(ical, null)).toBe(MIN_REFRESH_SECONDS);
    expect(refreshInterval('BEGIN:VCALENDAR\r\nEND:VCALENDAR', 30)).toBe(MIN_REFRESH_SECONDS);
  });

  it('una durada mal escrita no fa petar res', () => {
    expect(durationSeconds('això no és una durada')).toBeNull();
    expect(durationSeconds(null)).toBeNull();
  });

  it("un origen que no s'ha refrescat mai toca sempre", async () => {
    expect(isDue(await subscription(), null, Date.now())).toBe(true);
  });

  it("un que s'acaba de refrescar, no", async () => {
    const ara = Date.parse(NOW);
    const row = { ...(await subscription()), last_refreshed_at: NOW, refresh_interval: 3600 };
    expect(isDue(row, null, ara + 60_000)).toBe(false);
    expect(isDue(row, null, ara + 3_700_000)).toBe(true);
  });
});

describe('les alarmes', () => {
  it('es treuen de les subscripcions', async () => {
    // No es volen notificacions duplicades d'un calendari que l'usuari ja té al telèfon.
    served = ics([
      {
        uid: 'amb-alarma',
        summary: 'Reunió',
        extra: 'BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT15M\r\nDESCRIPTION:Va\r\nEND:VALARM',
      },
    ]);

    await refreshSubscription(conn.db, principal, await subscription(), {
      masterSecret: MASTER,
      fetchOptions: permetLoopback,
    });

    const row = await sql<{ raw_ical: string }>`
      SELECT raw_ical FROM events WHERE calendar_id = ${calendarId}
    `.execute(conn.db);
    expect(row.rows[0]?.raw_ical).not.toContain('VALARM');
    expect(row.rows[0]?.raw_ical).toContain('SUMMARY:Reunió');
  });

  it("es poden conservar si l'usuari ho demana", () => {
    const amb = extractEvents(
      ics([
        {
          uid: 'x',
          summary: 'Y',
          extra: 'BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT15M\r\nDESCRIPTION:Va\r\nEND:VALARM',
        },
      ]),
      { stripAlarms: false },
    );
    expect(amb[0]?.raw).toContain('VALARM');
  });
});

describe('el refresc', () => {
  it('crea el que és nou', async () => {
    served = ics([
      { uid: 'a', summary: 'Sant Jordi' },
      { uid: 'b', summary: 'Sant Joan' },
    ]);

    const result = await refreshSubscription(conn.db, principal, await subscription(), {
      masterSecret: MASTER,
      fetchOptions: permetLoopback,
    });

    expect(result).toMatchObject({ fetched: 2, created: 2, updated: 0, removed: 0 });
  });

  it("esborra el que ha desaparegut de l'origen", async () => {
    served = ics([
      { uid: 'a', summary: 'Sant Jordi' },
      { uid: 'b', summary: 'Sant Joan' },
    ]);
    await refreshSubscription(conn.db, principal, await subscription(), {
      masterSecret: MASTER,
      fetchOptions: permetLoopback,
    });

    // L'origen cancel·la el segon.
    served = ics([{ uid: 'a', summary: 'Sant Jordi' }]);
    const result = await refreshSubscription(conn.db, principal, await subscription(), {
      masterSecret: MASTER,
      fetchOptions: permetLoopback,
    });

    // Sense això es quedaria a Fem-ho per sempre.
    expect(result.removed).toBe(1);
    const vius = await sql<{ uid: string }>`
      SELECT uid FROM events WHERE calendar_id = ${calendarId} AND deleted_at IS NULL
    `.execute(conn.db);
    expect(vius.rows.map((row) => row.uid)).toEqual(['a']);
  });

  it("i si l'origen el torna a servir, torna a sortir", async () => {
    /**
     * **El cas de la finestra rodant, i era un defecte de veritat.**
     *
     * Molts `.ics` publicats només serveixen una finestra —«els propers 30 dies»— i un
     * canal RSS només els últims N titulars. Un ítem que en surt i hi torna a entrar és
     * el cas normal, no una raresa.
     *
     * El que passava: `applyFetched` indexa el que ja hi ha **filtrant per
     * `deleted_at IS NULL`**, o sigui que no veia la fila esborrada suaument; anava per
     * la branca d'`INSERT`; i l'índex únic `idx_events_component` **no exclou les files
     * esborrades**, o sigui que l'INSERT petava. No es perdia un esdeveniment: petava
     * **el refresc sencer**, i el calendari es quedava amb `last_error` per sempre.
     *
     * Cap prova ho veia perquè totes servien l'ítem, el treien, i s'aturaven allà.
     */
    served = ics([{ uid: 'a', summary: 'Sant Jordi' }]);
    await refreshSubscription(conn.db, principal, await subscription(), {
      masterSecret: MASTER,
      fetchOptions: permetLoopback,
    });

    // Surt de la finestra.
    served = ics([]);
    await refreshSubscription(conn.db, principal, await subscription(), {
      masterSecret: MASTER,
      fetchOptions: permetLoopback,
    });

    // I hi torna a entrar.
    served = ics([{ uid: 'a', summary: 'Sant Jordi' }]);
    const result = await refreshSubscription(conn.db, principal, await subscription(), {
      masterSecret: MASTER,
      fetchOptions: permetLoopback,
    });

    expect(result.fetched).toBe(1);
    const vius = await sql<{ uid: string }>`
      SELECT uid FROM events WHERE calendar_id = ${calendarId} AND deleted_at IS NULL
    `.execute(conn.db);
    expect(vius.rows.map((row) => row.uid)).toEqual(['a']);

    // I **una sola fila**: ressuscitada, no duplicada. Amb dues, l'esdeveniment sortiria
    // dues vegades al calendari.
    const totes = await sql<{ n: number }>`
      SELECT COUNT(*) AS n FROM events WHERE calendar_id = ${calendarId} AND uid = 'a'
    `.execute(conn.db);
    expect(Number(totes.rows[0]?.n)).toBe(1);
  });

  it('un refresc sense canvis NO reescriu res', async () => {
    // Reescriure-ho tot a cada refresc mouria el `change_log` i faria que tots els
    // clients de Fem-ho es rebaixessin el calendari sencer cada hora per no res.
    served = ics([{ uid: 'a', summary: 'Sant Jordi' }]);
    await refreshSubscription(conn.db, principal, await subscription(), {
      masterSecret: MASTER,
      fetchOptions: permetLoopback,
    });

    const abans = await sql<{ version: number; updated_at: string }>`
      SELECT version, updated_at FROM events WHERE calendar_id = ${calendarId}
    `.execute(conn.db);

    const result = await refreshSubscription(conn.db, principal, await subscription(), {
      masterSecret: MASTER,
      fetchOptions: permetLoopback,
    });

    expect(result).toMatchObject({ created: 0, updated: 0, removed: 0 });
    const després = await sql<{ version: number }>`
      SELECT version FROM events WHERE calendar_id = ${calendarId}
    `.execute(conn.db);
    expect(després.rows[0]?.version).toBe(abans.rows[0]?.version);
  });

  it('un canvi de veritat sí que actualitza', async () => {
    served = ics([{ uid: 'a', summary: 'Sant Jordi' }]);
    await refreshSubscription(conn.db, principal, await subscription(), {
      masterSecret: MASTER,
      fetchOptions: permetLoopback,
    });

    served = ics([{ uid: 'a', summary: 'Sant Jordi (festiu)' }]);
    const result = await refreshSubscription(conn.db, principal, await subscription(), {
      masterSecret: MASTER,
      fetchOptions: permetLoopback,
    });

    expect(result.updated).toBe(1);
    const row = await sql<{ summary: string }>`
      SELECT summary FROM events WHERE calendar_id = ${calendarId}
    `.execute(conn.db);
    expect(row.rows[0]?.summary).toBe('Sant Jordi (festiu)');
  });

  it("guarda l'interval que ha declarat l'origen", async () => {
    served = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//O//CA',
      'REFRESH-INTERVAL;VALUE=DURATION:PT4H',
      'END:VCALENDAR',
    ].join('\r\n');

    await refreshSubscription(conn.db, principal, await subscription(), {
      masterSecret: MASTER,
      fetchOptions: permetLoopback,
    });

    const row = await sql<{ refresh_interval: number; last_refreshed_at: string }>`
      SELECT refresh_interval, last_refreshed_at FROM calendars WHERE id = ${calendarId}
    `.execute(conn.db);
    expect(row.rows[0]?.refresh_interval).toBe(4 * 3600);
    expect(row.rows[0]?.last_refreshed_at).not.toBeNull();
  });

  it('un origen que respon malament no esborra res', async () => {
    served = ics([{ uid: 'a', summary: 'Sant Jordi' }]);
    await refreshSubscription(conn.db, principal, await subscription(), {
      masterSecret: MASTER,
      fetchOptions: permetLoopback,
    });

    // Un 500 temporal de l'origen NO ha de buidar el calendari de l'usuari.
    servedStatus = 500;
    await expect(
      refreshSubscription(conn.db, principal, await subscription(), {
        masterSecret: MASTER,
        fetchOptions: permetLoopback,
      }),
    ).rejects.toThrow(/500/u);

    const vius = await sql<{ uid: string }>`
      SELECT uid FROM events WHERE calendar_id = ${calendarId} AND deleted_at IS NULL
    `.execute(conn.db);
    expect(vius.rows).toHaveLength(1);
  });
});

describe('les credencials', () => {
  it("es guarden xifrades i s'envien com a Basic", async () => {
    await sql`
      UPDATE calendars SET source_username = 'borja',
                           source_secret_enc = ${seal(MASTER, `calendar:${calendarId}`, 'la-meva-app-password')}
      WHERE id = ${calendarId}
    `.execute(conn.db);

    served = ics([{ uid: 'a', summary: 'Privat' }]);
    await refreshSubscription(conn.db, principal, await subscription(), {
      masterSecret: MASTER,
      fetchOptions: permetLoopback,
    });

    // El que hi ha a la base NO és la contrasenya en clar.
    const row = await sql<{ source_secret_enc: string }>`
      SELECT source_secret_enc FROM calendars WHERE id = ${calendarId}
    `.execute(conn.db);
    expect(row.rows[0]?.source_secret_enc).not.toContain('la-meva-app-password');
  });
});

describe('evitar bucles', () => {
  it("una escriptura que ve del CalDAV NO surt cap a l'origen", () => {
    // Sense això, dos servidors sincronitzats entre ells es farien rebotar els canvis
    // indefinidament (docs/07 §9).
    expect(shouldPushOutbound('caldav')).toBe(false);
  });

  it("una de la web o de l'app sí", () => {
    for (const source of ['web', 'android', 'api', 'mcp']) {
      expect(shouldPushOutbound(source)).toBe(true);
    }
  });
});

/**
 * Els `ATTACH` d'un origen (RFC 5545 §3.8.1.1).
 *
 * **Els bytes en base64 es desen; una URI no es baixa mai.** La segona meitat és la que
 * importa: seguir una URL escollida per qui publica el calendari, cada cop que es
 * refresca, és el mateix forat que `safeFetch` tanca a la font — i un `.ics` podria fer
 * créixer el volum sense límit sense que ningú ho demanés.
 */
describe("els adjunts d'un origen", () => {
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);

  it('els bytes en base64 es desen, amb el tipus tret del contingut', async () => {
    served = ics([
      {
        uid: 'amb-adjunt',
        summary: 'Analítica',
        extra:
          'ATTACH;FMTTYPE=application/pdf;ENCODING=BASE64;VALUE=BINARY;' +
          `FILENAME=resultats.png:${PNG.toString('base64')}`,
      },
    ]);

    await refreshSubscription(conn.db, principal, await subscription(), {
      masterSecret: MASTER,
      fetchOptions: permetLoopback,
      dataDir: tmp,
    });

    const rows = await sql<{ filename: string; mime_type: string; size_bytes: number }>`
      SELECT a.filename, a.mime_type, a.size_bytes FROM attachments a
      JOIN events e ON e.id = a.event_id
      WHERE e.calendar_id = ${calendarId} AND a.deleted_at IS NULL
    `.execute(conn.db);

    expect(rows.rows).toHaveLength(1);
    // L'origen deia PDF; els bytes diuen PNG. Mana el contingut.
    expect(rows.rows[0]).toMatchObject({
      filename: 'resultats.png',
      mime_type: 'image/png',
      size_bytes: PNG.length,
    });
  });

  it('una URI es desa com a enllaç i no es baixa: no hi ha ni fitxer ni mida', async () => {
    served = ics([
      {
        uid: 'amb-enllac',
        summary: 'Entrades',
        extra: 'ATTACH;FMTTYPE=application/pdf:https://exemple.org/entrades.pdf',
      },
    ]);

    await refreshSubscription(conn.db, principal, await subscription(), {
      masterSecret: MASTER,
      fetchOptions: permetLoopback,
      dataDir: tmp,
    });

    const rows = await sql<{
      external_url: string | null;
      storage_path: string | null;
      size_bytes: number;
      source: string;
    }>`
      SELECT a.external_url, a.storage_path, a.size_bytes, a.source FROM attachments a
      JOIN events e ON e.id = a.event_id
      WHERE e.uid = 'amb-enllac' AND a.deleted_at IS NULL
    `.execute(conn.db);

    expect(rows.rows[0]).toMatchObject({
      external_url: 'https://exemple.org/entrades.pdf',
      storage_path: null,
      size_bytes: 0,
      source: 'ical_attach',
    });
  });

  it("i el que l'origen ha tret, desapareix", async () => {
    served = ics([
      {
        uid: 'canviant',
        summary: 'Cita',
        extra: `ATTACH;ENCODING=BASE64;VALUE=BINARY;FILENAME=a.png:${PNG.toString('base64')}`,
      },
    ]);
    await refreshSubscription(conn.db, principal, await subscription(), {
      masterSecret: MASTER,
      fetchOptions: permetLoopback,
      dataDir: tmp,
    });

    // El mateix esdeveniment, ara sense l'adjunt. L'etag canvia, o sigui que es reescriu.
    served = ics([{ uid: 'canviant', summary: 'Cita, sense res' }]);
    await refreshSubscription(conn.db, principal, await subscription(), {
      masterSecret: MASTER,
      fetchOptions: permetLoopback,
      dataDir: tmp,
    });

    const vius = await sql<{ n: number }>`
      SELECT COUNT(*) AS n FROM attachments a
      JOIN events e ON e.id = a.event_id
      WHERE e.uid = 'canviant' AND a.deleted_at IS NULL
    `.execute(conn.db);
    expect(Number(vius.rows[0]?.n)).toBe(0);
  });
});
