/**
 * Feines programades (docs/11 §3, docs/07 §9).
 *
 * **Un planificador dins del procés, sense cua externa.** `docs/11` §3 demana un tic de
 * 30 segons idempotent, i una casa que s'autoallotja no ha de muntar un Redis per
 * enviar recordatoris.
 *
 * Per què això ha d'existir: *"L'API del navegador per programar notificacions locals
 * mai es va arribar a implementar i està abandonada. Per tant tota notificació web surt
 * d'una feina programada al servidor. **No és una tria d'arquitectura: és l'única
 * possibilitat.**"*
 *
 * Aquest fitxer és el que faltava. Els serveis que fa córrer —`fireDueReminders` i
 * `refreshSubscription`— existien i tenien proves des de M12 i M10, però no els cridava
 * ningú: en producció, ni s'enviava cap recordatori ni es refrescava cap origen extern.
 */

import { sql } from 'kysely';
import { auditedTransaction } from '../audit/audited-transaction.js';
import type { Connection } from '../db/connection.js';
import type { MigrationDb } from '../db/migration-db.js';
import { isDue, refreshSubscription, type SubscriptionRow } from '../dav/client.js';
import type { Principal } from '../policy/principal.js';
import {
  ensureVapidKeys,
  realSender,
  sendToUser,
  fireDueReminders,
  type PushSender,
} from '../services/notifications.js';

/** El tic. `docs/11` §3 el fixa a 30 segons. */
export const TICK_MS = 30_000;

export interface SchedulerOptions {
  connection: Connection;
  secret: string;
  baseUrl: string | undefined;
  /** Injectables per a les proves: així no cal esperar mig minut ni piconar cap servei. */
  now?: () => string;
  send?: PushSender;
  log?: (message: string, error?: unknown) => void;
  tickMs?: number;
}

export interface TickResult {
  reminders: number;
  refreshed: number;
  errors: number;
}

/**
 * El principal de les feines programades.
 *
 * `source: 'system'` i cap usuari: el que fa el planificador no és de ningú, i a
 * l'historial ha de constar així i no com si ho hagués fet l'últim que va entrar.
 */
function systemPrincipal(): Principal {
  return {
    kind: 'user',
    userId: '',
    capabilities: new Set(),
    scopeIds: null,
    source: 'system',
  };
}

/**
 * Una passada.
 *
 * **Cap feina pot tombar-ne una altra.** Si el refresc d'un origen extern peta —el
 * servidor de l'altra banda està caigut, que és normal—, els recordatoris s'han d'enviar
 * igualment. Per això cada bloc va dins del seu `try`.
 */
export async function tick(options: SchedulerOptions): Promise<TickResult> {
  const now = (options.now ?? (() => new Date().toISOString()))();
  const log = options.log ?? (() => undefined);
  const principal = systemPrincipal();
  const result: TickResult = { reminders: 0, refreshed: 0, errors: 0 };

  try {
    result.reminders = await runReminders(options, principal, now);
  } catch (error) {
    result.errors += 1;
    log('El tic de recordatoris ha fallat', error);
  }

  try {
    result.refreshed = await runRefreshes(options, principal, now);
  } catch (error) {
    result.errors += 1;
    log("El refresc d'orígens externs ha fallat", error);
  }

  return result;
}

async function runReminders(
  options: SchedulerOptions,
  principal: Principal,
  now: string,
): Promise<number> {
  const { db } = options.connection;
  const keys = await ensureVapidKeys(db, now);
  const send = options.send ?? realSender;

  // `mailto:` és el que l'RFC de VAPID demana com a subjecte, i alguns serveis de push
  // rebutgen la petició si no hi és.
  const subject =
    options.baseUrl === undefined
      ? 'mailto:femho@localhost'
      : `mailto:femho@${new URL(options.baseUrl).hostname}`;

  return auditedTransaction(
    db,
    principal,
    async (ctx) =>
      fireDueReminders(ctx, now, async (reminder) => {
        // `ctx.tx` i no la connexió principal: amb SQLite, consultar la connexió mentre
        // la transacció la té agafada penja el procés fins que salta el temps d'espera.
        // És un bloqueig, no una lentitud, i des de fora sembla que el tic no faci res.
        const title = await titleFor(ctx.tx, reminder);
        await sendToUser(
          ctx,
          reminder.userId,
          'reminder',
          {
            title,
            body: title,
            ...(options.baseUrl === undefined ? {} : { url: options.baseUrl }),
          },
          { keys, subject, send },
        );
      }),
    { engine: options.connection.engine, now },
  );
}

async function titleFor(
  db: MigrationDb,
  reminder: { taskId: string | null; eventId: string | null },
): Promise<string> {
  if (reminder.taskId !== null) {
    const found = await sql<{ title: string }>`
      SELECT title FROM tasks WHERE id = ${reminder.taskId}
    `.execute(db);
    return found.rows[0]?.title ?? 'Recordatori';
  }
  if (reminder.eventId !== null) {
    const found = await sql<{ summary: string }>`
      SELECT summary FROM events WHERE id = ${reminder.eventId}
    `.execute(db);
    return found.rows[0]?.summary ?? 'Recordatori';
  }
  return 'Recordatori';
}

/**
 * Refresca els orígens externs que toquin.
 *
 * Un que falli **no atura els altres**: que el servidor d'un calendari de festius estigui
 * caigut no és motiu perquè la resta es quedin sense refrescar.
 */
async function runRefreshes(
  options: SchedulerOptions,
  principal: Principal,
  now: string,
): Promise<number> {
  const { db } = options.connection;
  const log = options.log ?? (() => undefined);

  const found = await sql<SubscriptionRow>`
    SELECT id, scope_id, name, source_kind, source_url, source_username, source_secret_enc,
           refresh_interval, last_refreshed_at, strip_alarms
    FROM calendars
    WHERE origin = 'subscription' AND source_url IS NOT NULL AND deleted_at IS NULL
  `.execute(db);

  let refreshed = 0;
  for (const subscription of found.rows) {
    if (!isDue(subscription, null, Date.parse(now))) continue;

    try {
      await refreshSubscription(db, principal, subscription, {
        masterSecret: options.secret,
        engine: options.connection.engine,
      });
      refreshed += 1;
      await sql`
        UPDATE calendars SET last_error = NULL, last_error_at = NULL WHERE id = ${subscription.id}
      `.execute(db);
    } catch (error) {
      log(`No s'ha pogut refrescar "${subscription.name}"`, error);
      /**
       * **El motiu es guarda a la fila**, no només al registre.
       *
       * Una font que ha deixat d'anar es veu exactament igual que una que no té
       * esdeveniments: buida. Sense el motiu a mà, l'usuari no té cap manera de saber
       * que el que mira ja no és el que hi ha a l'origen, i el registre del servidor
       * no el llegirà mai ningú d'una casa.
       */
      await sql`
        UPDATE calendars
        SET last_error = ${error instanceof Error ? error.message : String(error)},
            last_error_at = ${now}
        WHERE id = ${subscription.id}
      `.execute(db);
    }
  }

  return refreshed;
}

export interface Scheduler {
  stop: () => void;
}

/**
 * Engega el planificador.
 *
 * El temporitzador va amb `unref()`: **no ha de mantenir el procés viu**. Sense això,
 * un `SIGTERM` esperaria fins al proper tic i el tancament net que `docs/12` §1 exigeix
 * no ho seria.
 *
 * Els tics **no se solapen**: si un triga més de trenta segons —un origen extern lent—,
 * el següent espera. Amb solapament, dos tics processarien la mateixa feina alhora.
 */
export function startScheduler(options: SchedulerOptions): Scheduler {
  const interval = options.tickMs ?? TICK_MS;
  const log = options.log ?? (() => undefined);
  let running = false;
  let stopped = false;

  const run = async (): Promise<void> => {
    if (running || stopped) return;
    running = true;
    try {
      const result = await tick(options);
      if (result.reminders > 0 || result.refreshed > 0) {
        log(
          `planificador · ${String(result.reminders)} recordatoris, ` +
            `${String(result.refreshed)} orígens refrescats`,
        );
      }
    } catch (error) {
      log('El planificador ha petat', error);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void run(), interval);
  timer.unref();

  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}
