import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { auditedTransaction } from '../audit/audited-transaction.js';
import type { Connection } from '../db/connection.js';
import {
  ensureVapidKeys,
  realSender,
  recordPushOutcome,
  type PushSender,
} from '../services/notifications.js';
import {
  activityAudience,
  activityPayload,
  activityVisibleAt,
  type EligibleActivityRow,
} from '../services/task-activity-notifications.js';

const BATCH_SIZE = 20;
const MAX_ATTEMPTS = 3;
const LEASE_MS = 60_000;

export async function deliverTaskActivity(
  connection: Connection,
  clock: () => string,
  subject: string,
  send: PushSender = realSender,
): Promise<void> {
  const { db } = connection;
  const now = clock();
  await sql`DELETE FROM task_activity_notifications WHERE expires_at <= ${now}`.execute(db);

  const candidates = await sql<{ id: string }>`
    SELECT n.id ${activityAudience}
    JOIN push_subscriptions ps ON ps.id = d.subscription_id AND ps.user_id = d.user_id
    WHERE n.push_finished = 0 AND n.available_at <= ${now}
      AND (n.claim_until IS NULL OR n.claim_until <= ${now}) AND ${activityVisibleAt(now)}
    ORDER BY n.available_at, n.id LIMIT ${BATCH_SIZE}
  `.execute(db);
  if (candidates.rows.length === 0) return;

  const keys = await ensureVapidKeys(db, now);
  for (const { id } of candidates.rows) {
    const claimToken = uuidv7();
    const claimAt = clock();
    const claimUntil = new Date(Date.parse(claimAt) + LEASE_MS).toISOString();
    const claim = await sql<{ attempts: number }>`
      UPDATE task_activity_notifications
      SET claim_token = ${claimToken}, claim_until = ${claimUntil}, attempts = attempts + 1
      WHERE id = ${id} AND push_finished = 0 AND available_at <= ${claimAt}
        AND expires_at > ${claimAt} AND (claim_until IS NULL OR claim_until <= ${claimAt})
      RETURNING attempts
    `.execute(db);
    const attempt = claim.rows[0]?.attempts;
    if (attempt === undefined) continue;

    const found = await sql<
      EligibleActivityRow & {
        subscription_id: string;
        endpoint: string;
        p256dh: string;
        auth: string;
      }
    >`
      SELECT n.id, n.device_id, n.task_id, n.kind, n.created_at, n.expires_at, t.title, u.locale,
             ps.id AS subscription_id, ps.endpoint, ps.p256dh, ps.auth
      ${activityAudience}
      JOIN push_subscriptions ps ON ps.id = d.subscription_id AND ps.user_id = d.user_id
      WHERE n.id = ${id} AND n.claim_token = ${claimToken} AND ${activityVisibleAt(claimAt)}
    `.execute(db);
    const row = found.rows[0];
    if (!row || attempt > MAX_ATTEMPTS) {
      await sql`
        UPDATE task_activity_notifications SET push_finished = 1, claim_token = NULL, claim_until = NULL
        WHERE id = ${id} AND claim_token = ${claimToken}
      `.execute(db);
      continue;
    }

    // La passarel·la pot trigar o respondre després d'un reinici. El mateix identificador
    // i tema de push permeten que el dispositiu substitueixi o descarti una còpia repetida.
    let errorStatus: number | undefined;
    try {
      const result = await send(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        JSON.stringify(activityPayload(row)),
        {
          TTL: Math.max(0, Math.floor((Date.parse(row.expires_at) - Date.parse(claimAt)) / 1000)),
          topic: id.replaceAll('-', ''),
          vapidDetails: { subject, ...keys },
        },
      );
      if (result.statusCode < 200 || result.statusCode >= 300) errorStatus = result.statusCode;
    } catch (error) {
      errorStatus = (error as { statusCode?: number } | null)?.statusCode ?? 0;
    }

    await auditedTransaction(
      db,
      { userId: '', kind: 'user', source: 'system', capabilities: new Set(), scopeIds: null },
      async (ctx) => {
        // Els ajustos també bloquegen el dispositiu abans de tocar l'avís i la subscripció.
        const binding = await sql<{ subscription_id: string | null }>`
          UPDATE notification_devices SET enabled = enabled WHERE id = ${row.device_id}
          RETURNING subscription_id
        `.execute(ctx.tx);
        const temporary =
          errorStatus === 0 ||
          errorStatus === 429 ||
          (errorStatus !== undefined && errorStatus >= 500);
        const available = new Date(Date.parse(claimAt) + attempt * 60_000).toISOString();
        await sql`
          UPDATE task_activity_notifications
          SET claim_token = NULL, claim_until = NULL, available_at = ${available},
              push_finished = ${Number(!temporary || attempt >= MAX_ATTEMPTS)}
          WHERE id = ${id} AND claim_token = ${claimToken}
        `.execute(ctx.tx);
        // Una resposta vella no ha d'esborrar les claus noves després d'una renovació.
        const current =
          binding.rows[0]?.subscription_id === row.subscription_id
            ? await sql<{ id: string }>`
              SELECT id FROM push_subscriptions WHERE id = ${row.subscription_id}
                AND endpoint = ${row.endpoint} AND p256dh = ${row.p256dh} AND auth = ${row.auth}
            `.execute(ctx.tx)
            : undefined;
        if (!current?.rows[0]) {
          ctx.noChange();
          return;
        }
        const outcome = await recordPushOutcome(ctx.tx, row.subscription_id, claimAt, errorStatus);
        if (outcome === 'removed') {
          ctx.record({
            entityType: 'push_subscription',
            entityId: row.subscription_id,
            verb: 'deleted',
          });
        } else ctx.noChange();
      },
      { engine: connection.engine, now: claimAt },
    );
  }
}
