/**
 * docs/13 M12 · `test: notifications`.
 *
 * La que decideix aquesta peça és la de VAPID: **les claus s'han de persistir**. Generar-
 * les a cada arrencada mata silenciosament totes les subscripcions, i ningú se
 * n'assabenta fins que algú es queixa que ja no li arriben els recordatoris.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { auditedTransaction } from '../audit/audited-transaction.js';
import { connect, type Connection } from '../db/connection.js';
import { migrateToLatest } from '../db/migrator.js';
import { capabilitiesForRole } from '../policy/capabilities.js';
import type { Principal } from '../policy/principal.js';
import {
  TTL_SECONDS,
  ensureVapidKeys,
  fireDueReminders,
  pushAvailability,
  sendToUser,
  subscribe,
  unsubscribe,
  type PushSender,
} from './notifications.js';

const tmp = mkdtempSync(join(tmpdir(), 'femho-push-'));
const NOW = '2026-08-06T09:00:00.000Z';

let conn: Connection;
let userId: string;
let scopeId: string;
let principal: Principal;

async function write<T>(work: Parameters<typeof auditedTransaction<T>>[2], now = NOW): Promise<T> {
  return auditedTransaction(conn.db, principal, work, { engine: 'sqlite', now });
}

function subscripcio(endpoint: string) {
  return { endpoint, p256dh: 'clau-publica', auth: 'secret', platform: 'web' as const };
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
    VALUES (${scopeId}, 'Casa', 'individual', '--plou-blue', ${userId}, 'a1', ${NOW}, ${NOW})
  `.execute(conn.db);

  principal = {
    kind: 'user',
    userId,
    capabilities: new Set(capabilitiesForRole('admin')),
    scopeIds: null,
    source: 'system',
  };
});

afterAll(async () => {
  await conn.close();
  rmSync(tmp, { recursive: true, force: true });
});

beforeEach(async () => {
  await sql`DELETE FROM push_subscriptions`.execute(conn.db);
  await sql`DELETE FROM reminders`.execute(conn.db);
});

describe('AQUESTA és la que trenca instal·lacions: les claus VAPID', () => {
  it('es generen un sol cop i es persisteixen', async () => {
    const primera = await ensureVapidKeys(conn.db, NOW);
    expect(primera.publicKey).not.toBe('');

    // La segona crida —un reinici del contenidor— NO en genera unes de noves.
    const segona = await ensureVapidKeys(conn.db, NOW);
    expect(segona.publicKey).toBe(primera.publicKey);
    expect(segona.privateKey).toBe(primera.privateKey);
  });

  it('sobreviuen a reobrir la base de dades', async () => {
    const abans = await ensureVapidKeys(conn.db, NOW);
    await conn.close();

    // El contenidor es reinicia de debò: connexió nova sobre el mateix fitxer.
    conn = connect(`sqlite://${join(tmp, 'test.db')}`);
    const després = await ensureVapidKeys(conn.db, NOW);

    // Si aquí sortissin unes claus noves, totes les subscripcions dels navegadors
    // haurien quedat mortes en silenci (docs/11 §2).
    expect(després.publicKey).toBe(abans.publicKey);
  });

  it('amb mitja clau es queixa en comptes de generar-ne una de nova', async () => {
    await sql`DELETE FROM instance_settings`.execute(conn.db);
    await sql`
      INSERT INTO instance_settings (key, value, created_at, updated_at)
      VALUES ('vapid_public_key', 'nomes-la-publica', ${NOW}, ${NOW})
    `.execute(conn.db);

    // **No hi ha rotació**: generar-ne una de nova a sobre invalidaria totes les
    // subscripcions sense avisar ningú.
    await expect(ensureVapidKeys(conn.db, NOW)).rejects.toThrow(/mitja clau/u);

    await sql`DELETE FROM instance_settings`.execute(conn.db);
  });
});

describe('subscripcions', () => {
  it('el mateix endpoint actualitza, no duplica', async () => {
    const primera = await write(async (ctx) =>
      subscribe(ctx, userId, subscripcio('https://push/1')),
    );
    const segona = await write(async (ctx) =>
      subscribe(ctx, userId, subscripcio('https://push/1')),
    );

    expect(primera.created).toBe(true);
    expect(segona.created).toBe(false);
    expect(segona.id).toBe(primera.id);

    // Sense això, cada permís reconcedit deixaria una fila morta rebent errors per sempre.
    const files = await sql<{ n: number }>`SELECT COUNT(*) AS n FROM push_subscriptions`.execute(
      conn.db,
    );
    expect(Number(files.rows[0]?.n)).toBe(1);
  });

  it('desubscriure una cosa que no hi és no és un error', async () => {
    await expect(
      write(async (ctx) => {
        await unsubscribe(ctx, userId, 'https://push/no-existeix');
      }),
    ).resolves.toBeUndefined();
  });

  it('una taula per als dos clients: web i android', async () => {
    // Web Push i UnifiedPush comparteixen RFC i xifratge (docs/11 §1).
    await write(async (ctx) => subscribe(ctx, userId, subscripcio('https://web/1')));
    await write(async (ctx) =>
      subscribe(ctx, userId, { ...subscripcio('https://unified/1'), platform: 'android' }),
    );

    const files = await sql<{ platform: string }>`
      SELECT platform FROM push_subscriptions ORDER BY platform
    `.execute(conn.db);
    expect(files.rows.map((f) => f.platform)).toEqual(['android', 'web']);
  });
});

describe("l'enviament", () => {
  it('fixa el temps de vida EXPLÍCITAMENT', async () => {
    await write(async (ctx) => subscribe(ctx, userId, subscripcio('https://push/ttl')));
    const send = vi.fn<PushSender>(async () => ({ statusCode: 201 }));

    await write(async (ctx) =>
      sendToUser(
        ctx,
        userId,
        'reminder',
        { title: 'A', body: 'B' },
        {
          keys: { publicKey: 'p', privateKey: 's' },
          subject: 'mailto:borja@example.com',
          send,
        },
      ),
    );

    // "Un avís de reunió d'aquí a 1 hora no s'ha d'entregar tres dies després."
    expect(send.mock.calls[0]?.[2].TTL).toBe(TTL_SECONDS.reminder);
    expect(TTL_SECONDS.reminder).toBe(3600);
    expect(TTL_SECONDS.assignment).toBe(24 * 3600);
    expect(TTL_SECONDS.digest).toBe(6 * 3600);
  });

  it('un 410 treu la subscripció', async () => {
    await write(async (ctx) => subscribe(ctx, userId, subscripcio('https://push/morta')));

    const send: PushSender = async () => {
      throw Object.assign(new Error('Gone'), { statusCode: 410 });
    };

    const result = await write(async (ctx) =>
      sendToUser(
        ctx,
        userId,
        'reminder',
        { title: 'A', body: 'B' },
        {
          keys: { publicKey: 'p', privateKey: 's' },
          subject: 'mailto:x@y',
          send,
        },
      ),
    );

    expect(result.removed).toBe(1);
    const files = await sql<{ n: number }>`SELECT COUNT(*) AS n FROM push_subscriptions`.execute(
      conn.db,
    );
    expect(Number(files.rows[0]?.n)).toBe(0);
  });

  it('un error transitori compta però no esborra de seguida', async () => {
    await write(async (ctx) => subscribe(ctx, userId, subscripcio('https://push/fluixa')));

    const send: PushSender = async () => {
      throw Object.assign(new Error('Boom'), { statusCode: 500 });
    };
    const opcions = {
      keys: { publicKey: 'p', privateKey: 's' },
      subject: 'mailto:x@y',
      send,
    };

    for (let i = 0; i < 3; i += 1) {
      await write(async (ctx) =>
        sendToUser(ctx, userId, 'reminder', { title: 'A', body: 'B' }, opcions),
      );
    }

    const fila = await sql<{ fail_count: number }>`
      SELECT fail_count FROM push_subscriptions
    `.execute(conn.db);
    expect(fila.rows[0]?.fail_count).toBe(3);
  });

  it('però a la desena sí: una que falla sempre és soroll a cada tic', async () => {
    await write(async (ctx) => subscribe(ctx, userId, subscripcio('https://push/perduda')));

    const send: PushSender = async () => {
      throw Object.assign(new Error('Boom'), { statusCode: 500 });
    };
    const opcions = { keys: { publicKey: 'p', privateKey: 's' }, subject: 'mailto:x@y', send };

    for (let i = 0; i < 10; i += 1) {
      await write(async (ctx) =>
        sendToUser(ctx, userId, 'reminder', { title: 'A', body: 'B' }, opcions),
      );
    }

    const files = await sql<{ n: number }>`SELECT COUNT(*) AS n FROM push_subscriptions`.execute(
      conn.db,
    );
    expect(Number(files.rows[0]?.n)).toBe(0);
  });
});

describe('el tic de recordatoris', () => {
  async function recordatori(trigger: string): Promise<string> {
    const taskId = uuidv7();
    await sql`
      INSERT INTO tasks (id, scope_id, title, status, position, created_by, created_at, updated_at)
      VALUES (${taskId}, ${scopeId}, 'Amb recordatori', 'todo', 'a1', ${userId}, ${NOW}, ${NOW})
    `.execute(conn.db);

    const id = uuidv7();
    await sql`
      INSERT INTO reminders (id, task_id, user_id, trigger, channel, created_at)
      VALUES (${id}, ${taskId}, ${userId}, ${trigger}, 'push', ${NOW})
    `.execute(conn.db);
    return id;
  }

  it('agafa els que ja toquen i no els del futur', async () => {
    await recordatori('2026-08-06T08:00:00.000Z');
    await recordatori('2026-08-06T23:00:00.000Z');

    const enviats: string[] = [];
    const n = await write(async (ctx) =>
      fireDueReminders(ctx, NOW, async (r) => {
        enviats.push(r.id);
      }),
    );

    expect(n).toBe(1);
    expect(enviats).toHaveLength(1);
  });

  it("AQUESTA és la d'idempotència: un segon tic no els torna a enviar", async () => {
    await recordatori('2026-08-06T08:00:00.000Z');

    const primer = await write(async (ctx) => fireDueReminders(ctx, NOW, async () => undefined));
    const segon = await write(async (ctx) => fireDueReminders(ctx, NOW, async () => undefined));

    expect(primer).toBe(1);
    // "Si el procés cau entremig, no es pot enviar dues vegades" (docs/11 §3).
    expect(segon).toBe(0);
  });

  it("es marca ABANS d'enviar", async () => {
    const id = await recordatori('2026-08-06T08:00:00.000Z');

    let marcatQuanSEnviava: string | null = null;
    await write(async (ctx) =>
      fireDueReminders(ctx, NOW, async () => {
        const fila = await sql<{ fired_at: string | null }>`
          SELECT fired_at FROM reminders WHERE id = ${id}
        `.execute(ctx.tx);
        marcatQuanSEnviava = fila.rows[0]?.fired_at ?? null;
      }),
    );

    // Marcar-ho després faria que una caiguda entremig enviés una segona notificació al
    // reiniciar. Perdre'n una és millor que duplicar-la: un recordatori duplicat és el
    // que fa que la gent apagui les notificacions.
    expect(marcatQuanSEnviava).toBe(NOW);
  });
});

describe('iOS', () => {
  it('comprova LES DUES API abans de dir que no es pot', () => {
    // Comprovar-ne només una dona un fals negatiu i amaga el botó a gent que sí que el
    // podria fer servir (docs/11 §4).
    expect(
      pushAvailability({
        hasServiceWorker: true,
        hasPushManager: false,
        isStandalone: true,
        isIos: true,
      }),
    ).toBe('needs-home-screen');

    expect(
      pushAvailability({
        hasServiceWorker: false,
        hasPushManager: true,
        isStandalone: true,
        isIos: true,
      }),
    ).toBe('needs-home-screen');
  });

  it("a iOS sense pantalla d'inici, s'ensenyen les instruccions", () => {
    expect(
      pushAvailability({
        hasServiceWorker: true,
        hasPushManager: true,
        isStandalone: false,
        isIos: true,
      }),
    ).toBe('needs-home-screen');
  });

  it("a iOS amb pantalla d'inici, funciona", () => {
    expect(
      pushAvailability({
        hasServiceWorker: true,
        hasPushManager: true,
        isStandalone: true,
        isIos: true,
      }),
    ).toBe('available');
  });

  it('en un navegador que no ho suporta i no és iOS, no es pot i punt', () => {
    expect(
      pushAvailability({
        hasServiceWorker: false,
        hasPushManager: false,
        isStandalone: false,
        isIos: false,
      }),
    ).toBe('unavailable');
  });
});
