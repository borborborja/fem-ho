/**
 * docs/13 M7 · criteris d'acceptació dels esdeveniments:
 *   - Es poden crear esdeveniments i tasques des del calendari.
 *   - Una sèrie recurrent es pot editar en mode instància, futures o tota.
 *   - Editar "aquest i els següents" parteix la sèrie i **no emet `RANGE=THISANDFUTURE`**.
 *   - **Els esdeveniments no surten mai al kanban.**
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

const tmp = mkdtempSync(join(tmpdir(), 'femho-events-'));
const NOW = '2026-08-05T10:00:00.000Z';
const PASSWORD = 'la-contrasenya-de-la-borja';

let conn: Connection;
let app: FastifyInstance;
let userId: string;
let auth: { authorization: string };
let scopeId: string;
let eventsCalendar: string;
let todosCalendar: string;

async function api(
  method: 'GET' | 'POST' | 'PATCH',
  url: string,
  payload?: Record<string, unknown>,
): Promise<LightMyRequestResponse> {
  return payload === undefined
    ? app.inject({ method, url, headers: auth })
    : app.inject({ method, url, headers: auth, payload });
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
    VALUES (${scopeId}, 'Família', 'individual', '--plou-pink', ${userId}, 'a1', ${NOW}, ${NOW})
  `.execute(conn.db);

  // D9: DUES col·leccions per contenidor, sempre. RFC 4791 §5.2 prohibeix recursos de
  // components mixtos.
  eventsCalendar = uuidv7();
  todosCalendar = uuidv7();
  for (const [id, kind] of [
    [eventsCalendar, 'events'],
    [todosCalendar, 'todos'],
  ] as const) {
    await sql`
      INSERT INTO calendars (id, scope_id, name, kind, origin, sync_seq, created_at, updated_at)
      VALUES (${id}, ${scopeId}, ${`Família ${kind}`}, ${kind}, 'local', 0, ${NOW}, ${NOW})
    `.execute(conn.db);
  }

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
});

describe('calendaris', () => {
  it('cada àmbit en publica DUES: esdeveniments i tasques', async () => {
    const res = await api('GET', '/api/v1/calendars');
    expect(res.statusCode).toBe(200);
    const kinds = res
      .json<{ kind: string }[]>()
      .map((c) => c.kind)
      .sort();
    expect(kinds).toEqual(['events', 'todos']);
  });
});

describe('crear esdeveniments', () => {
  it('crea un esdeveniment i deixa rastre', async () => {
    const abans = Number(
      (
        await sql<{
          n: number;
        }>`SELECT COUNT(*) AS n FROM activity_log WHERE entity_type = 'event'`.execute(conn.db)
      ).rows[0]?.n ?? 0,
    );

    const res = await api('POST', '/api/v1/events', {
      calendar_id: eventsCalendar,
      summary: 'Sopar amb els avis',
      starts_at: '2026-08-10T19:00:00Z',
      ends_at: '2026-08-10T21:00:00Z',
    });

    expect(res.statusCode).toBe(201);
    const event = res.json<{ status: string; transparency: string }>();
    // Els STATUS de VEVENT, no els d'una tasca (D8).
    expect(event.status).toBe('CONFIRMED');
    expect(event.transparency).toBe('OPAQUE');

    const despres = Number(
      (
        await sql<{
          n: number;
        }>`SELECT COUNT(*) AS n FROM activity_log WHERE entity_type = 'event'`.execute(conn.db)
      ).rows[0]?.n ?? 0,
    );
    expect(despres).toBe(abans + 1);
  });

  it('un calendari de tasques NO accepta esdeveniments', async () => {
    // RFC 4791 §5.2 prohibeix recursos de components mixtos (D9).
    const res = await api('POST', '/api/v1/events', {
      calendar_id: todosCalendar,
      summary: 'Això no hi cap',
      starts_at: '2026-08-10T19:00:00Z',
    });
    expect(res.statusCode).toBe(403);
    expect(res.json<{ detail: string }>().detail).toContain('tasques');
  });

  it('crear incrementa el sync_seq de la col·lecció', async () => {
    // D'aquí surten alhora el ctag i el sync-token de CalDAV (docs/07 §4).
    const abans = Number(
      (
        await sql<{
          sync_seq: number;
        }>`SELECT sync_seq FROM calendars WHERE id = ${eventsCalendar}`.execute(conn.db)
      ).rows[0]?.sync_seq ?? 0,
    );

    await api('POST', '/api/v1/events', {
      calendar_id: eventsCalendar,
      summary: 'Un altre',
      starts_at: '2026-08-11T10:00:00Z',
    });

    const despres = Number(
      (
        await sql<{
          sync_seq: number;
        }>`SELECT sync_seq FROM calendars WHERE id = ${eventsCalendar}`.execute(conn.db)
      ).rows[0]?.sync_seq ?? 0,
    );
    expect(despres).toBeGreaterThan(abans);
  });
});

describe('GET /events', () => {
  it('REQUEREIX from i to', async () => {
    // "Sense finestra no es poden expandir repeticions" (docs/05 §4).
    const res = await api('GET', '/api/v1/events');
    expect(res.statusCode).toBe(422);
    expect(res.json<{ detail: string }>().detail).toContain('finestra');
  });

  it('rebutja una finestra que no són dates', async () => {
    const res = await api('GET', '/api/v1/events?from=ahir&to=demà');
    expect(res.statusCode).toBe(422);
  });

  it('expandeix una sèrie dins de la finestra', async () => {
    const creat = await api('POST', '/api/v1/events', {
      calendar_id: eventsCalendar,
      summary: 'Anglès',
      starts_at: '2026-09-02T17:00:00Z',
      ends_at: '2026-09-02T18:00:00Z',
      rrule: 'FREQ=WEEKLY',
    });
    expect(creat.statusCode).toBe(201);

    const res = await api(
      'GET',
      '/api/v1/events?from=2026-09-01T00:00:00Z&to=2026-10-01T00:00:00Z',
    );
    const ocurrencies = res
      .json<{ summary: string; starts_at: string }[]>()
      .filter((o) => o.summary === 'Anglès');

    // 2, 9, 16, 23 i 30 de setembre.
    expect(ocurrencies).toHaveLength(5);
  });
});

describe("AQUESTA és la de docs/13: 'aquest i els següents' parteix la sèrie", () => {
  let seriesId: string;

  it('partir la sèrie deixa rastre dels dos costats', async () => {
    const creat = await api('POST', '/api/v1/events', {
      calendar_id: eventsCalendar,
      summary: 'Reunió setmanal',
      starts_at: '2026-10-07T09:00:00Z',
      ends_at: '2026-10-07T10:00:00Z',
      rrule: 'FREQ=WEEKLY',
    });
    seriesId = creat.json<{ id: string }>().id;

    const res = await api(
      'PATCH',
      `/api/v1/events/${seriesId}?series_mode=future&occurrence=2026-10-21T09:00:00Z`,
      { summary: 'Reunió setmanal (nou horari)' },
    );
    expect(res.statusCode).toBe(200);

    // El mestre ha rebut UNTIL i la sèrie nova existeix: dues entrades a l'historial.
    const entrades = await sql<{ verb: string; entity_id: string }>`
      SELECT verb, entity_id FROM activity_log
      WHERE entity_type = 'event' AND created_at >= ${NOW}
      ORDER BY id DESC LIMIT 2
    `.execute(conn.db);
    expect(entrades.rows).toHaveLength(2);
  });

  it('el mestre queda amb UNTIL i cap RANGE=THISANDFUTURE', async () => {
    const master = await sql<{ rrule: string }>`
      SELECT rrule FROM events WHERE id = ${seriesId}
    `.execute(conn.db);

    const rrule = master.rows[0]?.rrule ?? '';
    expect(rrule).toContain('UNTIL=');
    // docs/01 §5: es parseja però NO S'EMET MAI.
    expect(rrule).not.toMatch(/THISANDFUTURE/i);
  });

  it('les ocurrències no es dupliquen al tall', async () => {
    const res = await api(
      'GET',
      '/api/v1/events?from=2026-10-01T00:00:00Z&to=2026-11-01T00:00:00Z',
    );
    const reunions = res
      .json<{ summary: string; starts_at: string }[]>()
      .filter((o) => o.summary.startsWith('Reunió setmanal'))
      .map((o) => o.starts_at);

    // Cap instant repetit: el tall és net.
    expect(new Set(reunions).size).toBe(reunions.length);
  });
});

describe('mode instància', () => {
  it('crea una fila germana amb el seu RECURRENCE-ID', async () => {
    const creat = await api('POST', '/api/v1/events', {
      calendar_id: eventsCalendar,
      summary: 'Gimnàs',
      starts_at: '2026-11-02T07:00:00Z',
      ends_at: '2026-11-02T08:00:00Z',
      rrule: 'FREQ=DAILY;COUNT=5',
    });
    const id = creat.json<{ id: string }>().id;

    const res = await api(
      'PATCH',
      `/api/v1/events/${id}?series_mode=single&occurrence=2026-11-04T07:00:00Z`,
      { summary: 'Gimnàs (moguda)', starts_at: '2026-11-04T19:00:00Z' },
    );
    expect(res.statusCode).toBe(200);

    const override = res.json<{ recurrence_id: string | null; uid: string }>();
    expect(override.recurrence_id).toBeTruthy();

    // I la instància modificada SUBSTITUEIX l'ocurrència: no en surten dues.
    const llista = await api(
      'GET',
      '/api/v1/events?from=2026-11-01T00:00:00Z&to=2026-11-10T00:00:00Z',
    );
    const gimnas = llista
      .json<{ summary: string }[]>()
      .filter((o) => o.summary.startsWith('Gimnàs'));
    expect(gimnas).toHaveLength(5);
    expect(gimnas.filter((o) => o.summary.includes('moguda'))).toHaveLength(1);
  });

  it('els modes single i future exigeixen saber quina ocurrència', async () => {
    const res = await api('PATCH', `/api/v1/events/${uuidv7()}?series_mode=single`, {});
    // 404 o 422 segons què falti primer; el que no pot fer és aplicar-ho a cegues.
    expect([404, 422]).toContain(res.statusCode);
  });
});

describe('AQUESTA és la de docs/13: els esdeveniments no surten mai al kanban', () => {
  it('/board no en retorna cap', async () => {
    const res = await api('GET', '/api/v1/board');
    const board = res.json<{ columns: { groups: { tasks: { title: string }[] }[] }[] }>();

    const titols = board.columns.flatMap((c) =>
      c.groups.flatMap((g) => g.tasks.map((t) => t.title)),
    );
    // Cap dels esdeveniments creats en aquesta prova hi és.
    for (const summary of ['Sopar amb els avis', 'Anglès', 'Reunió setmanal', 'Gimnàs']) {
      expect(titols).not.toContain(summary);
    }
  });

  it('/tasks tampoc', async () => {
    const res = await api('GET', '/api/v1/tasks');
    const titols = res.json<{ data: { title: string }[] }>().data.map((t) => t.title);
    expect(titols).not.toContain('Sopar amb els avis');
  });

  it('i les tasques no surten a /events', async () => {
    // La separació val en les dues direccions (D8).
    await api('POST', '/api/v1/tasks', { scope_id: scopeId, title: 'Una tasca qualsevol' });
    const res = await api(
      'GET',
      '/api/v1/events?from=2026-01-01T00:00:00Z&to=2027-01-01T00:00:00Z',
    );
    const summaries = res.json<{ summary: string }[]>().map((o) => o.summary);
    expect(summaries).not.toContain('Una tasca qualsevol');
  });
});
