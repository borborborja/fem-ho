import { sql } from 'kysely';
import { z } from 'zod';
import { auditedTransaction } from '../audit/audited-transaction.js';
import type { Connection } from '../db/connection.js';
import type { Engine } from '../db/dialect.js';
import type { MigrationDb } from '../db/migration-db.js';
import { PolicyError } from '../policy/errors.js';
import type { Principal } from '../policy/principal.js';
import { requireHumanSession } from './external-access.js';
import { lockSyncOp, recallOp, rememberOp, type BatchOperation, type BatchResult } from './sync.js';
import { moveTask } from './tasks.js';

const settingSchema = z.strictObject({
  doing_auto_stop_minutes: z.number().int().min(1).max(10080).nullable(),
});

async function lockLimit(db: MigrationDb, engine: Engine, userId: string): Promise<void> {
  // El tic i un canvi de preferència han de poder-se ordenar també abans de la primera fila.
  if (engine === 'postgres') {
    await sql`SELECT pg_advisory_xact_lock(851008, hashtext(${userId}))`.execute(db);
  }
}

async function limitOf(db: MigrationDb, userId: string): Promise<number | null> {
  const result = await sql<{ doing_auto_stop_minutes: number | null }>`
    SELECT s.doing_auto_stop_minutes FROM user_settings s
    JOIN users u ON u.id = s.user_id AND u.kind = 'human' AND u.deleted_at IS NULL
    WHERE s.user_id = ${userId}
  `.execute(db);
  return result.rows[0]?.doing_auto_stop_minutes ?? null;
}

export async function syncDoingAutoStop(
  connection: Connection,
  principal: Principal,
  operation: BatchOperation,
): Promise<BatchResult> {
  requireHumanSession(principal);
  if (operation.op !== 'update' || operation.id !== principal.userId)
    throw new PolicyError(
      'invalid-auto-stop-account',
      'Invalid account',
      422,
      'Update the auto-stop setting for your own account.',
    );
  const input = settingSchema.safeParse(operation.data);
  if (!input.success)
    throw new PolicyError(
      'invalid-auto-stop-limit',
      'Invalid auto-stop limit',
      422,
      'Provide an integer from 1 to 10080 minutes, or null to disable auto-stop.',
    );

  return auditedTransaction(
    connection.db,
    principal,
    async (ctx): Promise<BatchResult> => {
      await lockSyncOp(ctx.tx, connection.engine, principal, operation.op_id);
      await lockLimit(ctx.tx, connection.engine, principal.userId);
      const received = await recallOp(ctx.tx, principal, operation);
      const before = await limitOf(ctx.tx, principal.userId);
      const next = received === undefined ? input.data.doing_auto_stop_minutes : before;
      if (next === before) {
        ctx.noChange();
      } else {
        await sql`
          INSERT INTO user_settings (user_id, doing_auto_stop_minutes, updated_at)
          VALUES (${principal.userId}, ${next}, ${ctx.now})
          ON CONFLICT (user_id) DO UPDATE SET
            doing_auto_stop_minutes = excluded.doing_auto_stop_minutes,
            updated_at = excluded.updated_at
        `.execute(ctx.tx);
        ctx.record({
          entityType: 'user_settings',
          entityId: principal.userId,
          verb: 'updated',
          changes: { doing_auto_stop_minutes: { from: before, to: next } },
        });
      }
      const ack = { op_id: operation.op_id, status: 'ok' } as const;
      if (received === undefined) await rememberOp(ctx.tx, principal, operation, ack, ctx.now);
      return { ...ack, entity: { doing_auto_stop_minutes: next } };
    },
    { engine: connection.engine },
  );
}

interface DoingActivity {
  task_id: string;
  scope_id: string;
  version: number;
  verb: string;
  created_at: string;
  changes: string | null;
  user_id: string | null;
  minutes: number | null;
}

const previousStatuses = new Set<unknown>([null, 'inbox', 'todo', 'done']);

function expired(startedAt: number, minutes: number | null, now: string): boolean {
  return minutes !== null && startedAt + minutes * 60_000 <= Date.parse(now);
}

export async function stopExpiredDoingTasks(
  connection: Connection,
  system: Principal,
  now: string,
): Promise<void> {
  // L’índex d’historial per entitat evita llegir tasques fora de Fent. Cal mirar l’última
  // transició real abans de mirar de qui és: el límit d’un compte no regeix un tram posterior.
  const found = await sql<DoingActivity>`
    SELECT t.id AS task_id, t.scope_id, t.version, a.verb, a.created_at, a.changes,
           u.id AS user_id, settings.doing_auto_stop_minutes AS minutes
    FROM tasks t
    JOIN scopes s ON s.id = t.scope_id AND s.deleted_at IS NULL
    JOIN activity_log a ON a.entity_type = 'task' AND a.entity_id = t.id
    LEFT JOIN users u ON u.id = a.actor_user_id AND u.kind = 'human' AND u.deleted_at IS NULL
      AND a.actor_type IN ('user', 'ai_agent', 'caldav') AND a.source <> 'system'
    LEFT JOIN user_settings settings ON settings.user_id = u.id
    WHERE t.status = 'doing' AND t.deleted_at IS NULL
      AND (a.changes LIKE '%"status":%' OR a.verb IN ('deleted', 'restored'))
      AND NOT EXISTS (SELECT 1 FROM instance_links link WHERE link.scope_id = t.scope_id)
      AND EXISTS (SELECT 1 FROM user_settings WHERE doing_auto_stop_minutes IS NOT NULL)
    ORDER BY t.id, a.created_at DESC, a.id DESC
  `.execute(connection.db);

  const seen = new Set<string>();
  for (const activity of found.rows) {
    if (seen.has(activity.task_id)) continue;
    if (activity.verb === 'deleted' || activity.verb === 'restored') {
      seen.add(activity.task_id);
      continue;
    }
    let changes: {
      status?: { from?: unknown; to?: unknown } | null;
      occurred_at?: { to?: unknown };
    };
    try {
      changes = JSON.parse(activity.changes ?? '{}') as typeof changes;
    } catch {
      // Amb un forat a l’historial no podem saber si l’estada anterior encara és la bona.
      seen.add(activity.task_id);
      continue;
    }
    const status = changes.status;
    if (status === undefined || (typeof status?.to === 'string' && status.from === status.to))
      continue;
    seen.add(activity.task_id);
    if (status?.to !== 'doing' || !previousStatuses.has(status.from) || activity.user_id === null)
      continue;
    const startedAt = Date.parse(
      typeof changes.occurred_at?.to === 'string' ? changes.occurred_at.to : activity.created_at,
    );
    if (!expired(startedAt, activity.minutes, now)) continue;

    const actor: Principal = {
      kind: 'user',
      userId: activity.user_id,
      capabilities: new Set(['tasks:move']),
      scopeIds: new Set([activity.scope_id]),
      source: 'system',
    };
    try {
      await auditedTransaction(
        connection.db,
        { ...system, label: 'Fem-ho' },
        async (ctx) => {
          await lockLimit(ctx.tx, connection.engine, actor.userId);
          if (!expired(startedAt, await limitOf(ctx.tx, actor.userId), ctx.now)) {
            ctx.noChange();
            return;
          }
          // El pany de fila ordena el moviment amb una reserva d’IA, que també toca
          // la tasca en auditar-se. La versió descarta una estada que hagi canviat.
          const current = await sql<{ id: string }>`
            SELECT id FROM tasks WHERE id = ${activity.task_id} AND status = 'doing'
              AND version = ${activity.version} AND deleted_at IS NULL
            ${connection.engine === 'postgres' ? sql`FOR UPDATE` : sql``}
          `.execute(ctx.tx);
          if (current.rows.length === 0) {
            ctx.noChange();
            return;
          }
          await moveTask(ctx, actor, activity.task_id, {
            status: 'todo',
            expected_version: activity.version,
          });
        },
        { engine: connection.engine, now },
      );
    } catch (error) {
      // Les reserves d’IA, els moviments simultanis i els canvis de permisos es reavaluen al tic següent.
      if (!(error instanceof PolicyError) || ![403, 404, 409].includes(error.status)) throw error;
    }
  }
}
