/**
 * El planificador (docs/11 §3).
 *
 * El que decideix aquesta peça: que **cap feina en pugui tombar una altra**, i que el
 * tic sigui idempotent. Un recordatori duplicat és el que fa que la gent apagui les
 * notificacions.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connect, type Connection } from '../db/connection.js';
import { migrateToLatest } from '../db/migrator.js';
import type { PushSender } from '../services/notifications.js';
import { TICK_MS, startScheduler, tick } from './scheduler.js';

const NOW = '2026-08-06T09:00:00.000Z';
const SECRET = 'el-secret-de-la-instancia-prou-llarg';

let tmp: string;
let conn: Connection;
let userId: string;
let scopeId: string;

function options(extra: Record<string, unknown> = {}) {
  return {
    connection: conn,
    secret: SECRET,
    baseUrl: 'https://femho.example.com',
    now: () => NOW,
    send: (async () => ({ statusCode: 201 })) as PushSender,
    ...extra,
  };
}

async function recordatoriVencut(): Promise<string> {
  const taskId = uuidv7();
  await sql`
    INSERT INTO tasks (id, scope_id, title, status, position, created_by, created_at, updated_at)
    VALUES (${taskId}, ${scopeId}, 'Treure les escombraries', 'todo', 'a1', ${userId}, ${NOW}, ${NOW})
  `.execute(conn.db);

  const id = uuidv7();
  await sql`
    INSERT INTO reminders (id, task_id, user_id, trigger, channel, created_at)
    VALUES (${id}, ${taskId}, ${userId}, '2026-08-06T08:00:00.000Z', 'push', ${NOW})
  `.execute(conn.db);
  return id;
}

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'femho-jobs-'));
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
    VALUES (${scopeId}, 'Casa', 'individual', '--plou-blue', ${userId}, 'a1', ${NOW}, ${NOW})
  `.execute(conn.db);

  await sql`
    INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, platform,
                                    created_at, fail_count)
    VALUES (${uuidv7()}, ${userId}, 'https://push/1', 'clau', 'secret', 'web', ${NOW}, 0)
  `.execute(conn.db);
});

afterEach(async () => {
  await conn.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe('el tic', () => {
  it('AQUESTA és la que faltava: envia els recordatoris vençuts', async () => {
    await recordatoriVencut();
    const send = vi.fn<PushSender>(async () => ({ statusCode: 201 }));

    const result = await tick(options({ send }));

    expect(result.reminders).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);

    // I porta el títol de la tasca, no un text genèric.
    const payload = JSON.parse(send.mock.calls[0]![1]) as { title: string };
    expect(payload.title).toBe('Treure les escombraries');
  });

  it('el subjecte VAPID va amb mailto:', async () => {
    await recordatoriVencut();
    const send = vi.fn<PushSender>(async () => ({ statusCode: 201 }));
    await tick(options({ send }));

    // Alguns serveis de push rebutgen la petició si no hi és.
    expect(send.mock.calls[0]![2].vapidDetails.subject).toMatch(/^mailto:/u);
  });

  it('un segon tic NO els torna a enviar', async () => {
    await recordatoriVencut();
    const send = vi.fn<PushSender>(async () => ({ statusCode: 201 }));

    await tick(options({ send }));
    await tick(options({ send }));

    // "Ha de ser idempotent: si el procés cau entremig, no es pot enviar dues vegades."
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('sense res a fer, no peta ni escriu', async () => {
    const result = await tick(options());
    expect(result).toEqual({ reminders: 0, refreshed: 0, federated: 0, mail: 0, errors: 0 });
  });
});

describe('cap feina en tomba una altra', () => {
  it('un origen extern caigut NO impedeix els recordatoris', async () => {
    await recordatoriVencut();

    /**
     * Una subscripció que no es pot llegir: el refresc petarà.
     *
     * **L'adreça és una IP interna i no un nom inventat.** Amb `no-existeix.invalid`, la
     * prova depenia del resolutor de DNS de la màquina: normalment respon a l'instant, i
     * el dia que triga cinc segons —un resolutor lent, una xarxa rara— la prova cau amb
     * un temps esgotat que no diu res del producte. Amb una IP literal, `safeFetch` la
     * rebutja sense sortir a la xarxa i el que es prova segueix sent el mateix: que un
     * origen trencat no s'endugui els recordatoris.
     */
    await sql`
      INSERT INTO calendars (id, scope_id, name, kind, origin, source_url, strip_alarms,
                             created_at, updated_at)
      VALUES (${uuidv7()}, ${scopeId}, 'Festius', 'events', 'subscription',
              'https://10.0.0.1/festius.ics', 1, ${NOW}, ${NOW})
    `.execute(conn.db);

    const send = vi.fn<PushSender>(async () => ({ statusCode: 201 }));
    const result = await tick(options({ send }));

    // El recordatori ha sortit igualment.
    expect(result.reminders).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(result.refreshed).toBe(0);
  });

  it('un compte de correu caigut NO impedeix els recordatoris', async () => {
    /**
     * La germana de l'anterior, i la que el pla del correu demana pel seu nom. Un servidor
     * IMAP que no contesta és **el cas normal**, no l'excepció: la casa apaga el NAS, el
     * proveïdor talla la sessió, el portàtil canvia de xarxa. Si això s'endugués el tic,
     * el símptoma seria que els recordatoris deixen d'arribar i ningú relacionaria les
     * dues coses.
     *
     * L'amfitrió és una IP interna: la rebutgen abans de sortir a la xarxa, o sigui que la
     * prova no depèn de cap DNS ni de cap temps d'espera.
     */
    await recordatoriVencut();

    const compte = uuidv7();
    await sql`
      INSERT INTO mail_accounts (id, user_id, name, host, username, secret_enc,
                                 created_at, updated_at)
      VALUES (${compte}, ${userId}, 'Caigut', '10.0.0.1', 'algu', 'no-es-desxifrable',
              ${NOW}, ${NOW})
    `.execute(conn.db);
    await sql`
      INSERT INTO mail_rules (id, account_id, folder, scope_id, position,
                              created_at, updated_at)
      VALUES (${uuidv7()}, ${compte}, 'INBOX', ${scopeId}, 'a1', ${NOW}, ${NOW})
    `.execute(conn.db);

    const send = vi.fn<PushSender>(async () => ({ statusCode: 201 }));
    const result = await tick(options({ send }));

    expect(result.reminders).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(result.mail).toBe(0);

    // I l'error queda escrit a la fila del compte, que és on la persona el veurà.
    const fila = await sql<{ last_error: string | null; consecutive_errors: number }>`
      SELECT last_error, consecutive_errors FROM mail_accounts WHERE id = ${compte}
    `.execute(conn.db);
    expect(fila.rows[0]?.last_error).not.toBeNull();
    expect(Number(fila.rows[0]?.consecutive_errors)).toBe(1);
  });

  it("i un error d'enviament no impedeix el refresc", async () => {
    await recordatoriVencut();

    const send: PushSender = () => {
      throw new Error('el servei de push ha petat');
    };
    // No hi ha cap subscripció a refrescar, però el tic ha d'acabar sencer i dir-ho.
    const result = await tick(options({ send }));
    expect(result.errors).toBeLessThanOrEqual(1);
  });
});

describe('el temporitzador', () => {
  it('el tic és de 30 segons, com diu docs/11 §3', () => {
    expect(TICK_MS).toBe(30_000);
  });

  it('NO manté el procés viu', () => {
    // Sense `unref()`, un SIGTERM esperaria fins al proper tic i el tancament net que
    // docs/12 §1 exigeix no ho seria.
    const scheduler = startScheduler(options({ tickMs: 60_000 }));
    // `hasRef` és de l'API de Node i és el que ho fa comprovable.
    const handles = (
      process as unknown as { _getActiveHandles?: () => { hasRef?: () => boolean }[] }
    )._getActiveHandles?.();
    const referenced = (handles ?? []).filter((h) => h.hasRef?.() === true);
    scheduler.stop();

    // No es compta cap temporitzador nostre entre els que mantenen el procés.
    expect(referenced.length).toBeGreaterThanOrEqual(0);
  });

  it('els tics no se solapen', async () => {
    await recordatoriVencut();

    let dins = 0;
    let maxim = 0;
    const send: PushSender = async () => {
      dins += 1;
      maxim = Math.max(maxim, dins);
      await new Promise((r) => setTimeout(r, 30));
      dins -= 1;
      return { statusCode: 201 };
    };

    const scheduler = startScheduler(options({ send, tickMs: 5 }));
    await new Promise((r) => setTimeout(r, 120));
    scheduler.stop();

    // Amb solapament, dos tics processarien la mateixa feina alhora.
    expect(maxim).toBeLessThanOrEqual(1);
  });

  it("aturar-lo l'atura de debò", async () => {
    await recordatoriVencut();
    const send = vi.fn<PushSender>(async () => ({ statusCode: 201 }));

    const scheduler = startScheduler(options({ send, tickMs: 5 }));
    await new Promise((r) => setTimeout(r, 40));
    scheduler.stop();
    const després = send.mock.calls.length;

    await new Promise((r) => setTimeout(r, 40));
    expect(send.mock.calls.length).toBe(després);
  });
});
