/**
 * Notificacions (docs/11).
 *
 * **Una sola taula i una sola crida d'enviament** per a Web Push i UnifiedPush: fan
 * servir les mateixes RFC i el mateix xifratge, i muntar-ne dos subsistemes seria feina
 * de franc.
 *
 * **Tota notificació surt d'una feina programada al servidor.** L'API del navegador per
 * programar notificacions locals mai es va arribar a implementar i està abandonada
 * (docs/11 §3): no és una tria d'arquitectura, és l'única possibilitat.
 */

import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import webpush from 'web-push';
import type { AuditContext } from '../audit/audited-transaction.js';
import { safeFetch } from '../dav/fetch-safe.js';
import type { MigrationDb } from '../db/migration-db.js';
import { PolicyError } from '../policy/errors.js';

export const VAPID_PUBLIC_KEY = 'vapid_public_key';
export const VAPID_PRIVATE_KEY = 'vapid_private_key';

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

/**
 * Els temps de vida, **explícits** (docs/11 §10).
 *
 * La llibreria en porta un per defecte de setmanes, i per a un recordatori això és
 * catastròfic: un avís de "reunió d'aquí a 1 hora" no s'ha d'entregar tres dies després.
 */
export const TTL_SECONDS = {
  reminder: 60 * 60,
  assignment: 24 * 60 * 60,
  digest: 6 * 60 * 60,
} as const;

export type NotificationKind = keyof typeof TTL_SECONDS;

/**
 * Les claus VAPID de la instància.
 *
 * **Es generen un sol cop, al primer arrencament, i es persisteixen.** Si ja n'hi ha,
 * es tornen tal com estan i no se'n generen de noves — ni tan sols si semblen dolentes.
 * Regenerar-les silenciosament és el que mata totes les subscripcions.
 */
export async function ensureVapidKeys(db: MigrationDb, now: string): Promise<VapidKeys> {
  const found = await sql<{ key: string; value: string }>`
    SELECT key, value FROM instance_settings WHERE key IN (${VAPID_PUBLIC_KEY}, ${VAPID_PRIVATE_KEY})
  `.execute(db);

  const stored = new Map(found.rows.map((row) => [row.key, row.value]));
  const publicKey = stored.get(VAPID_PUBLIC_KEY);
  const privateKey = stored.get(VAPID_PRIVATE_KEY);

  if (publicKey !== undefined && privateKey !== undefined) {
    return { publicKey, privateKey };
  }

  /**
   * Si només n'hi ha una de les dues, la instància està en un estat que no s'hauria de
   * poder donar. Es peta en comptes de generar-ne un parell nou: generar-lo trencaria
   * totes les subscripcions existents en silenci, i **no hi ha rotació** (docs/11 §2).
   */
  if (publicKey !== undefined || privateKey !== undefined) {
    throw new Error(
      "Hi ha mitja clau VAPID a la base de dades. No se n'hi genera una de nova a sobre: " +
        'canviar-la invalidaria totes les subscripcions. Recupera la còpia de seguretat o ' +
        'esborra les dues claus a mà sabent que la gent haurà de tornar a activar les notificacions.',
    );
  }

  const generated = webpush.generateVAPIDKeys();
  const inserted = await sql`
    INSERT INTO instance_settings (key, value, created_at, updated_at)
    VALUES (${VAPID_PUBLIC_KEY}, ${generated.publicKey}, ${now}, ${now}),
           (${VAPID_PRIVATE_KEY}, ${generated.privateKey}, ${now}, ${now})
    ON CONFLICT (key) DO NOTHING
  `.execute(db);

  // En una instal·lació nova, el planificador i el primer navegador es poden avançar l'un a l'altre.
  return inserted.numAffectedRows === 2n ? generated : ensureVapidKeys(db, now);
}

export interface SubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
  platform: 'web' | 'android';
  user_agent?: string | undefined;
  activityOnly?: boolean | undefined;
}

function pushEndpoint(raw: string): URL {
  const url = URL.parse(raw);
  if (url?.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.hash !== '') {
    throw new PolicyError(
      'invalid-push-endpoint',
      'Invalid push endpoint',
      422,
      'The push service needs an HTTPS address without credentials or a fragment.',
    );
  }
  return url;
}

/**
 * Guarda una subscripció.
 *
 * `endpoint` és únic: el mateix navegador que es torna a subscriure ha d'actualitzar la
 * fila, no crear-ne una de nova. Sense això, cada permís reconcedit deixaria una fila
 * morta que rebria errors per sempre.
 */
export async function subscribe(
  ctx: AuditContext,
  userId: string,
  input: SubscriptionInput,
): Promise<{ id: string; created: boolean }> {
  pushEndpoint(input.endpoint);
  const id = uuidv7();
  const inserted = await sql<{ id: string }>`
    INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, platform,
                                    user_agent, created_at, fail_count, activity_only)
    VALUES (${id}, ${userId}, ${input.endpoint}, ${input.p256dh}, ${input.auth},
            ${input.platform}, ${input.user_agent ?? null}, ${ctx.now}, 0,
            ${Number(input.activityOnly === true)})
    ON CONFLICT (endpoint) DO NOTHING
    RETURNING id
  `.execute(ctx.tx);
  if (inserted.rows.length === 0) {
    const updated = await sql<{ id: string }>`
      UPDATE push_subscriptions
      SET p256dh = ${input.p256dh}, auth = ${input.auth},
          user_agent = ${input.user_agent ?? null}, fail_count = 0,
          activity_only = CASE WHEN ${Number(input.activityOnly === true)} = 0 THEN 0 ELSE activity_only END
      WHERE endpoint = ${input.endpoint} AND user_id = ${userId} AND platform = ${input.platform}
      RETURNING id
    `.execute(ctx.tx);
    const existing = updated.rows[0];
    if (!existing) {
      throw new PolicyError(
        'push-subscription-in-use',
        'Subscription in use',
        409,
        'Renew the push subscription on this device.',
      );
    }
    ctx.noChange();
    return { id: existing.id, created: false };
  }

  ctx.record({
    entityType: 'push_subscription',
    entityId: id,
    scopeId: null,
    verb: 'created',
    changes: { platform: { from: null, to: input.platform } },
  });

  return { id, created: true };
}

export async function unsubscribe(
  ctx: AuditContext,
  userId: string,
  endpoint: string,
): Promise<void> {
  const found = await sql<{ id: string }>`
    SELECT id FROM push_subscriptions WHERE endpoint = ${endpoint} AND user_id = ${userId}
  `.execute(ctx.tx);

  const row = found.rows[0];
  if (row === undefined) {
    // Desubscriure una cosa que no hi és no és un error: el resultat és el que volia.
    ctx.noChange();
    return;
  }

  await sql`DELETE FROM push_subscriptions WHERE id = ${row.id}`.execute(ctx.tx);
  ctx.record({
    entityType: 'push_subscription',
    entityId: row.id,
    scopeId: null,
    verb: 'deleted',
    changes: {},
  });
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

/** El transport, injectable perquè les proves no piquin a cap servei de push real. */
export type PushSender = (
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
  options: {
    TTL: number;
    topic?: string;
    vapidDetails: { subject: string; publicKey: string; privateKey: string };
  },
) => Promise<{ statusCode: number }>;

export interface SendResult {
  sent: number;
  removed: number;
  failed: number;
}

export async function recordPushOutcome(
  db: MigrationDb,
  subscriptionId: string,
  now: string,
  errorStatus?: number,
): Promise<keyof SendResult> {
  // Per a una subscripció compartida amb l'activitat, conservem el mateix ordre de bloqueig
  // que la renovació i la baixa. Esborrar la subscripció també toca la fila del dispositiu.
  await sql`UPDATE notification_devices SET enabled = enabled WHERE subscription_id = ${subscriptionId}`.execute(
    db,
  );
  if (errorStatus === undefined) {
    await sql`UPDATE push_subscriptions SET last_ok_at = ${now}, fail_count = 0 WHERE id = ${subscriptionId}`.execute(
      db,
    );
    return 'sent';
  }
  if (errorStatus !== 404 && errorStatus !== 410) {
    const updated = await sql<{ fail_count: number }>`
      UPDATE push_subscriptions SET fail_count = fail_count + 1 WHERE id = ${subscriptionId}
      RETURNING fail_count
    `.execute(db);
    if ((updated.rows[0]?.fail_count ?? 0) < 10) return 'failed';
  }
  const removed = await sql`DELETE FROM push_subscriptions WHERE id = ${subscriptionId}`.execute(
    db,
  );
  return removed.numAffectedRows === 1n ? 'removed' : 'failed';
}

/**
 * Envia a totes les subscripcions d'un usuari.
 *
 * Un `404` o un `410` volen dir que la subscripció ja no existeix a l'altra banda: es
 * treu. Qualsevol altre error es compta, i a la desena es treu també — una subscripció
 * que falla sempre és soroll a cada tic de trenta segons.
 */
export async function sendToUser(
  ctx: AuditContext,
  userId: string,
  kind: NotificationKind,
  payload: PushPayload,
  { keys, subject, send }: { keys: VapidKeys; subject: string; send: PushSender },
): Promise<SendResult> {
  const found = await sql<{
    id: string;
    endpoint: string;
    p256dh: string;
    auth: string;
  }>`
    SELECT id, endpoint, p256dh, auth FROM push_subscriptions
    WHERE user_id = ${userId} AND activity_only = 0
  `.execute(ctx.tx);

  const result: SendResult = { sent: 0, removed: 0, failed: 0 };

  for (const row of found.rows) {
    let errorStatus: number | undefined;
    try {
      await send(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        JSON.stringify(payload),
        {
          // El temps de vida explícit: la llibreria en posaria un de setmanes.
          TTL: TTL_SECONDS[kind],
          vapidDetails: { subject, publicKey: keys.publicKey, privateKey: keys.privateKey },
        },
      );
    } catch (error) {
      errorStatus = (error as { statusCode?: number }).statusCode ?? 0;
    }
    result[await recordPushOutcome(ctx.tx, row.id, ctx.now, errorStatus)] += 1;
  }

  /**
   * **Enviar no és una acció auditable**: `last_ok_at` i `fail_count` són comptabilitat
   * del canal, no coses que hagi fet ningú, i registrar-les inundaria l'historial amb un
   * tic cada trenta segons.
   *
   * **Perdre una subscripció sí que ho és.** L'usuari deixa de rebre avisos al seu
   * dispositiu, i quan es pregunti per què, ha de poder trobar-ho escrit.
   */
  if (result.removed > 0) {
    ctx.record({
      entityType: 'push_subscription',
      entityId: userId,
      scopeId: null,
      verb: 'deleted',
      changes: { removed: { from: null, to: result.removed } },
    });
  } else {
    ctx.noChange();
  }

  return result;
}

/**
 * El tic de recordatoris (docs/11 §3).
 *
 * Cada 30 segons agafa els que ja toquen i encara no s'han enviat, i **marca `fired_at`
 * abans d'enviar**. Si el procés cau entremig es perd una notificació; si es marqués
 * després, se n'enviaria una segona al reiniciar. Perdre'n una és millor que enviar-la
 * dues vegades: un recordatori duplicat és el que fa que la gent apagui les
 * notificacions.
 */
export async function fireDueReminders(
  ctx: AuditContext,
  now: string,
  deliver: (reminder: {
    id: string;
    userId: string;
    taskId: string | null;
    eventId: string | null;
  }) => Promise<void>,
  { limit = 100 } = {},
): Promise<number> {
  const found = await sql<{
    id: string;
    user_id: string;
    task_id: string | null;
    event_id: string | null;
  }>`
    SELECT id, user_id, task_id, event_id FROM reminders
    WHERE fired_at IS NULL AND trigger <= ${now} AND channel = 'push'
    ORDER BY trigger
    LIMIT ${limit}
  `.execute(ctx.tx);

  if (found.rows.length === 0) {
    ctx.noChange();
    return 0;
  }

  for (const row of found.rows) {
    // Es marca PRIMER.
    await sql`UPDATE reminders SET fired_at = ${now} WHERE id = ${row.id}`.execute(ctx.tx);
    await deliver({
      id: row.id,
      userId: row.user_id,
      taskId: row.task_id,
      eventId: row.event_id,
    });
  }

  ctx.record({
    entityType: 'reminder',
    entityId: found.rows[0]!.id,
    scopeId: null,
    verb: 'updated',
    changes: { fired: { from: null, to: found.rows.length } },
  });

  return found.rows.length;
}

/**
 * iOS: cal comprovar **les dues** API abans de dir que no es pot (docs/11 §4).
 *
 * A Safari les notificacions només funcionen des d'una app afegida a la pantalla
 * d'inici. Comprovar-ne només una dona un fals negatiu i s'acaba amagant el botó a gent
 * que sí que el podria fer servir.
 */
export function pushAvailability(capabilities: {
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  isStandalone: boolean;
  isIos: boolean;
}): 'available' | 'needs-home-screen' | 'unavailable' {
  if (!capabilities.hasServiceWorker || !capabilities.hasPushManager) {
    // A iOS, que falti l'API no vol dir que no es pugui: vol dir que encara no s'ha
    // afegit a la pantalla d'inici.
    return capabilities.isIos ? 'needs-home-screen' : 'unavailable';
  }
  if (capabilities.isIos && !capabilities.isStandalone) return 'needs-home-screen';
  return 'available';
}

/** L'enviador real. Es passa des de fora perquè les proves no en necessitin cap. */
export const realSender: PushSender = async (subscription, payload, options) => {
  pushEndpoint(subscription.endpoint);
  const request = webpush.generateRequestDetails(subscription, payload, options);
  // Les subscripcions desades també es tornen a resoldre. El transport només fa servir
  // la IP validada i el sobre xifrat i signat mai segueix una redirecció.
  const response = await safeFetch(request.endpoint, {
    method: request.method,
    headers: Object.fromEntries(
      Object.entries(request.headers).map(([name, value]) => [name, String(value)]),
    ),
    ...(request.body === null ? {} : { body: request.body }),
    maxRedirects: 0,
    timeoutMs: 5_000,
    maxBytes: 16_384,
  });
  if (response.status < 200 || response.status >= 300) {
    throw Object.assign(new Error('El servei de notificacions ha rebutjat el missatge.'), {
      statusCode: response.status,
    });
  }
  return { statusCode: response.status };
};
