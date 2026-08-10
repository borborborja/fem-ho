/**
 * Les fonts a la bústia.
 *
 * La bústia d'un dia és **el que arriba de fora més les tasques**. Aquest fitxer prova
 * les dues coses que fan que això no sigui una llista de tot:
 *
 *   - **El defecte per mena de font.** Un calendari sí, un RSS no. Sense això, la primera
 *     subscripció a un canal actiu enterra la pantalla principal el matí següent.
 *   - **Que una marca sobreviu un refresc**, que és la decisió que sosté la funció i la
 *     que fallaria en silenci si algú la pengés d'`events.id`.
 *
 * I una que no és de la funció sinó de la casa: **que un calendari no compartit no
 * s'escola cap a la bústia d'un company d'àmbit**. Els esdeveniments no tenen `scope_id`
 * propi —el treuen del calendari—, i un filtre per àmbit sol els deixaria passar.
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

const tmp = mkdtempSync(join(tmpdir(), 'femho-inbox-sources-'));
const NOW = '2026-08-05T10:00:00.000Z';
const DIA = '2026-08-10';
const PASSWORD = 'la-contrasenya-de-la-borja';

let conn: Connection;
let app: FastifyInstance;
let userId: string;
let auth: { authorization: string };
let scopeId: string;
let calendari: string;
let canal: string;

interface InboxResposta {
  date: string;
  dated: { id: string }[];
  undated: { id: string }[];
  events: {
    uid: string;
    summary: string;
    source_kind: string | null;
    calendar_name: string;
    calendar_id: string;
  }[];
}

async function api(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload?: Record<string, unknown>,
): Promise<LightMyRequestResponse> {
  return payload === undefined
    ? app.inject({ method, url, headers: auth })
    : app.inject({ method, url, headers: auth, payload });
}

const inbox = async (): Promise<InboxResposta> =>
  (await api('GET', `/api/v1/inbox?date=${DIA}`)).json<InboxResposta>();

const uids = async (): Promise<string[]> => (await inbox()).events.map((e) => e.uid).sort();

/** Un esdeveniment d'una hora el dia de la prova, escrit directament com ho fa el refresc. */
async function sembra(calendarId: string, uid: string, summary: string): Promise<string> {
  const id = uuidv7();
  await sql`
    INSERT INTO events (id, calendar_id, uid, summary, starts_at, ends_at, all_day,
                        status, transparency, sequence, etag, created_at, updated_at)
    VALUES (${id}, ${calendarId}, ${uid}, ${summary}, ${`${DIA}T09:00:00.000Z`},
            ${`${DIA}T10:00:00.000Z`}, 0, 'CONFIRMED', 'OPAQUE', 0, 'etag-1', ${NOW}, ${NOW})
  `.execute(conn.db);
  return id;
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
    VALUES (${userId}, 'fonts@example.com', 'Borja', ${await hashPassword(PASSWORD)},
            'human', 'admin', ${NOW}, ${NOW})
  `.execute(conn.db);

  scopeId = uuidv7();
  await sql`
    INSERT INTO scopes (id, name, kind, color, owner_id, position, created_at, updated_at)
    VALUES (${scopeId}, 'Casa', 'individual', '--plou-pink', ${userId}, 'a1', ${NOW}, ${NOW})
  `.execute(conn.db);

  // Dues fonts subscrites de mena diferent, que és tot el que cal per provar el defecte.
  calendari = uuidv7();
  canal = uuidv7();
  for (const [id, name, kind] of [
    [calendari, 'Escola', 'caldav'],
    [canal, 'Notícies', 'rss'],
  ] as const) {
    await sql`
      INSERT INTO calendars (id, scope_id, name, kind, origin, source_kind, source_url,
                             sync_seq, created_at, updated_at)
      VALUES (${id}, ${scopeId}, ${name}, 'events', 'subscription', ${kind},
              ${`https://example.com/${kind}`}, 0, ${NOW}, ${NOW})
    `.execute(conn.db);
  }

  await sembra(calendari, 'reunio-escola', 'Reunió a l’escola');
  await sembra(canal, 'titular-1', 'Un titular qualsevol');

  app = buildApp({ ...loadConfig('0.1.0-test'), logLevel: 'silent' }, { connection: conn });

  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: 'fonts@example.com', password: PASSWORD },
  });
  auth = { authorization: `Bearer ${login.json<{ access_token: string }>().access_token}` };
});

afterAll(async () => {
  await app.close();
  await conn.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe('el defecte per mena de font', () => {
  it('un calendari subscrit surt a la bústia i un RSS no', async () => {
    expect(await uids()).toEqual(['reunio-escola']);
  });

  it("l'RSS hi és igualment, al calendari: no s'amaga, només no entra a la bústia", async () => {
    const res = await api('GET', `/api/v1/events?from=${DIA}T00:00:00Z&to=${DIA}T23:59:59Z`);
    const tots = res.json<{ uid: string }[]>().map((e) => e.uid);
    expect(tots).toContain('titular-1');
  });

  it("la bústia segueix portant les tasques, i l'array d'esdeveniments és a part", async () => {
    const res = await api('POST', '/api/v1/tasks', {
      id: uuidv7(),
      scope_id: scopeId,
      title: 'Una tasca sense data',
      status: 'inbox',
      position: 'a1',
    });
    expect(res.statusCode).toBe(201);

    const vista = await inbox();
    expect(vista.undated).toHaveLength(1);
    // I la separació que sosté la regla 7: cap esdeveniment té `status` ni `position`.
    for (const event of vista.events) {
      expect(event).not.toHaveProperty('status');
      expect(event).not.toHaveProperty('position');
    }
  });
});

describe("l'interruptor per font, des d'Ajustos", () => {
  it('encendre un RSS el fa entrar a la bústia', async () => {
    const res = await api('PATCH', `/api/v1/calendars/${canal}`, { inbox_visible: true });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ inbox_visible: boolean | null }>().inbox_visible).toBe(true);

    expect(await uids()).toEqual(['reunio-escola', 'titular-1']);
  });

  it('i apagar un calendari el treu', async () => {
    await api('PATCH', `/api/v1/calendars/${calendari}`, { inbox_visible: false });
    expect(await uids()).toEqual(['titular-1']);
  });

  it('el defecte es publica perquè cap client hagi de duplicar la regla', async () => {
    const tots = await (
      await api('GET', '/api/v1/calendars')
    ).json<{ id: string; inbox_visible_default: boolean }[]>();

    expect(tots.find((c) => c.id === calendari)?.inbox_visible_default).toBe(true);
    expect(tots.find((c) => c.id === canal)?.inbox_visible_default).toBe(false);
  });

  it("enviar `null` treu l'excepció i torna al defecte, no la fixa a fals", async () => {
    /**
     * És la diferència que justifica el tri-estat. Si `null` es guardés com un fals,
     * "torna a com estava" i "no el vull" quedarien indistingibles, i el dia que el
     * defecte canviés aquest calendari es quedaria clavat.
     */
    for (const id of [calendari, canal]) {
      const res = await api('PATCH', `/api/v1/calendars/${id}`, { inbox_visible: null });
      expect(res.json<{ inbox_visible: boolean | null }>().inbox_visible).toBeNull();
    }

    // I amb l'excepció treta, cadascú torna al seu defecte.
    expect(await uids()).toEqual(['reunio-escola']);

    const desat = await sql<{ inbox_visible: unknown }>`
      SELECT inbox_visible FROM calendars WHERE id = ${canal}
    `.execute(conn.db);
    expect(desat.rows[0]?.inbox_visible).toBeNull();
  });

  it('no enviar el camp no toca res', async () => {
    await api('PATCH', `/api/v1/calendars/${canal}`, { inbox_visible: true });
    await api('PATCH', `/api/v1/calendars/${canal}`, { name: 'Notícies del poble' });

    const res = await api('GET', '/api/v1/calendars');
    const font = res
      .json<{ id: string; name: string; inbox_visible: boolean | null }[]>()
      .find((c) => c.id === canal);
    expect(font?.name).toBe('Notícies del poble');
    expect(font?.inbox_visible).toBe(true);

    // I es deixa com estava per a les proves que vénen darrere.
    await api('PATCH', `/api/v1/calendars/${canal}`, { inbox_visible: null });
  });
});

describe("l'excepció mana sobre el defecte", () => {
  it('una marca fa sortir un titular concret', async () => {
    await sql`
      INSERT INTO event_inbox_marks (id, user_id, calendar_id, uid, recurrence_id, visible,
                                     created_at, updated_at)
      VALUES (${uuidv7()}, ${userId}, ${canal}, 'titular-1', NULL, 1, ${NOW}, ${NOW})
    `.execute(conn.db);

    expect(await uids()).toEqual(['reunio-escola', 'titular-1']);
  });

  it("i una altra en sentit contrari treu la reunió de l'escola", async () => {
    await sql`
      INSERT INTO event_inbox_marks (id, user_id, calendar_id, uid, recurrence_id, visible,
                                     created_at, updated_at)
      VALUES (${uuidv7()}, ${userId}, ${calendari}, 'reunio-escola', NULL, 0, ${NOW}, ${NOW})
    `.execute(conn.db);

    expect(await uids()).toEqual(['titular-1']);
  });

  it('les marques són per usuari i no de la casa', async () => {
    // Una altra persona del mateix àmbit no hereta el que jo he amagat.
    const altre = uuidv7();
    await sql`
      INSERT INTO users (id, email, name, password_hash, kind, role, created_at, updated_at)
      VALUES (${altre}, 'altre@example.com', 'Alba', ${await hashPassword(PASSWORD)},
              'human', 'member', ${NOW}, ${NOW})
    `.execute(conn.db);

    const meves = await sql<{ n: number }>`
      SELECT COUNT(*) AS n FROM event_inbox_marks WHERE user_id = ${userId}
    `.execute(conn.db);
    const seves = await sql<{ n: number }>`
      SELECT COUNT(*) AS n FROM event_inbox_marks WHERE user_id = ${altre}
    `.execute(conn.db);

    expect(Number(meves.rows[0]?.n)).toBe(2);
    expect(Number(seves.rows[0]?.n)).toBe(0);
  });
});

describe('marcar un esdeveniment des de la interfície', () => {
  it('treure un de la bústia el treu, i tornar-lo el torna', async () => {
    await sql`DELETE FROM event_inbox_marks`.execute(conn.db);
    expect(await uids()).toEqual(['reunio-escola']);

    const fora = await api('POST', '/api/v1/inbox/events', {
      calendar_id: calendari,
      uid: 'reunio-escola',
      visible: false,
    });
    expect(fora.statusCode).toBe(200);
    // Torna la resolució SENCERA, no només el que s'ha desat.
    expect(fora.json()).toEqual({ visible: false, in_inbox: false });
    expect(await uids()).toEqual([]);

    const torna = await api('POST', '/api/v1/inbox/events', {
      calendar_id: calendari,
      uid: 'reunio-escola',
      visible: null,
    });
    expect(torna.json()).toEqual({ visible: null, in_inbox: true });
    expect(await uids()).toEqual(['reunio-escola']);
  });

  it("i encendre'n un d'un RSS també, que és el cas que més ho necessita", async () => {
    /**
     * Un canal RSS no és editable —és un document de fora— i per això la marca demana
     * `events:read` i no `events:write`. Amb `events:write`, silenciar o rescatar un
     * titular concret seria impossible precisament allà on fa més falta.
     */
    const res = await api('POST', '/api/v1/inbox/events', {
      calendar_id: canal,
      uid: 'titular-1',
      visible: true,
    });
    expect(res.json()).toEqual({ visible: true, in_inbox: true });
    expect(await uids()).toContain('titular-1');

    await api('POST', '/api/v1/inbox/events', {
      calendar_id: canal,
      uid: 'titular-1',
      visible: null,
    });
  });

  it('reenviar el mateix no deixa cap rastre nou', async () => {
    await api('POST', '/api/v1/inbox/events', {
      calendar_id: canal,
      uid: 'titular-1',
      visible: true,
    });
    const abans = await sql<{ n: number }>`
      SELECT COUNT(*) AS n FROM activity_log WHERE entity_type = 'event_inbox_mark'
    `.execute(conn.db);

    // La cua de sortida d'un client pot reenviar la mateixa cosa (regla 6).
    await api('POST', '/api/v1/inbox/events', {
      calendar_id: canal,
      uid: 'titular-1',
      visible: true,
    });

    const despres = await sql<{ n: number }>`
      SELECT COUNT(*) AS n FROM activity_log WHERE entity_type = 'event_inbox_mark'
    `.execute(conn.db);
    expect(Number(despres.rows[0]?.n)).toBe(Number(abans.rows[0]?.n));

    await api('POST', '/api/v1/inbox/events', {
      calendar_id: canal,
      uid: 'titular-1',
      visible: null,
    });
  });

  it('la marca NO viatja pel sync: és una preferència personal', async () => {
    /**
     * `change_log` es filtra per `scope_id`, i `NULL IN (...)` no és cert enlloc. Si
     * s'hi posés l'àmbit del calendari, la meva marca personal arribaria a tothom de
     * l'àmbit i els desapareixeria una cita de la bústia sense haver fet res.
     */
    await api('POST', '/api/v1/inbox/events', {
      calendar_id: canal,
      uid: 'titular-1',
      visible: true,
    });

    const files = await sql<{ scope_id: string | null }>`
      SELECT scope_id FROM change_log WHERE entity_type = 'event_inbox_mark'
    `.execute(conn.db);
    expect(files.rows.length).toBeGreaterThan(0);
    for (const fila of files.rows) expect(fila.scope_id).toBeNull();

    await api('POST', '/api/v1/inbox/events', {
      calendar_id: canal,
      uid: 'titular-1',
      visible: null,
    });
  });

  it('un uid que no existeix dona 404', async () => {
    const res = await api('POST', '/api/v1/inbox/events', {
      calendar_id: calendari,
      uid: 'no-existeix',
      visible: false,
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('una tasca viva treu el seu esdeveniment de la bústia', () => {
  it('i en esborrar-la torna sol, sense que ningú hagi escrit res', async () => {
    // Es parteix de l'estat net: es treuen les marques de les proves anteriors.
    await sql`DELETE FROM event_inbox_marks`.execute(conn.db);
    expect(await uids()).toEqual(['reunio-escola']);

    const marquesAbans = await sql<{ n: number }>`
      SELECT COUNT(*) AS n FROM event_inbox_marks
    `.execute(conn.db);

    const taskId = uuidv7();
    await sql`
      INSERT INTO tasks (id, scope_id, title, status, position, origin,
                         event_calendar_id, event_uid, created_by, created_at, updated_at)
      VALUES (${taskId}, ${scopeId}, 'Anar a la reunió', 'inbox', 'a2', 'native',
              ${calendari}, 'reunio-escola', ${userId}, ${NOW}, ${NOW})
    `.execute(conn.db);

    expect(await uids()).toEqual([]);

    // I ara s'esborra la tasca. Res més.
    await sql`UPDATE tasks SET deleted_at = ${NOW} WHERE id = ${taskId}`.execute(conn.db);

    expect(await uids()).toEqual(['reunio-escola']);

    /**
     * El que fa que això valgui la pena: **el comportament per defecte no ha escrit cap
     * fila**. L'esdeveniment torna perquè la supressió ha desaparegut, no perquè algú
     * hagi hagut de netejar res. Si algun dia calgués una fila per tornar a l'estat
     * inicial, hi hauria alguna cosa per quedar-se penjada.
     */
    const marquesDespres = await sql<{ n: number }>`
      SELECT COUNT(*) AS n FROM event_inbox_marks
    `.execute(conn.db);
    expect(Number(marquesDespres.rows[0]?.n)).toBe(Number(marquesAbans.rows[0]?.n));
  });
});

describe('la marca sobreviu el que la font li faci a sobre', () => {
  /**
   * **Aquesta és la prova que fixa la decisió de disseny**, i la que fallaria si algú
   * canviés `event_inbox_marks` per apuntar a `events.id`.
   *
   * `applyFetched` reconcilia per `uid`: si l'etag canvia reescriu la fila, i si l'uid
   * deixa d'arribar li posa `deleted_at`. Un `.ics` amb finestra rodant fa exactament
   * això contínuament, i quan l'ítem torna, **neix en una fila nova amb `id` nou**.
   */
  it("un refresc que reescriu la fila no s'endú la marca", async () => {
    await sql`DELETE FROM event_inbox_marks`.execute(conn.db);
    await sql`
      INSERT INTO event_inbox_marks (id, user_id, calendar_id, uid, recurrence_id, visible,
                                     created_at, updated_at)
      VALUES (${uuidv7()}, ${userId}, ${canal}, 'titular-1', NULL, 1, ${NOW}, ${NOW})
    `.execute(conn.db);
    expect(await uids()).toContain('titular-1');

    // El que fa el refresc quan l'origen ha canviat el contingut.
    await sql`
      UPDATE events SET summary = 'El mateix titular, reescrit', etag = 'etag-2',
                        updated_at = ${NOW}
      WHERE calendar_id = ${canal} AND uid = 'titular-1'
    `.execute(conn.db);

    expect(await uids()).toContain('titular-1');
  });

  it("i tampoc quan l'ítem surt de la finestra de l'origen i hi torna", async () => {
    // Desapareix de l'origen: esborrat suau, que és el que fa `applyFetched`.
    await sql`
      UPDATE events SET deleted_at = ${NOW} WHERE calendar_id = ${canal} AND uid = 'titular-1'
    `.execute(conn.db);
    expect(await uids()).not.toContain('titular-1');

    /**
     * I hi torna. Escrivint aquesta prova es va descobrir que el refresc **petava** en
     * aquest punt: `idx_events_component` no exclou les esborrades i `applyFetched`
     * només mirava les vives, o sigui que provava d'inserir i violava l'índex. Ara la
     * ressuscita, i per això la comprovació és que segueix sent **la mateixa fila**.
     */
    await sql`
      UPDATE events SET deleted_at = NULL, summary = 'Ha tornat', etag = 'etag-3'
      WHERE calendar_id = ${canal} AND uid = 'titular-1'
    `.execute(conn.db);

    const files = await sql<{ n: number }>`
      SELECT COUNT(*) AS n FROM events WHERE calendar_id = ${canal} AND uid = 'titular-1'
    `.execute(conn.db);
    expect(Number(files.rows[0]?.n)).toBe(1);

    // I la marca, que no penja de cap `id`, segueix valent.
    expect(await uids()).toContain('titular-1');
  });
});
