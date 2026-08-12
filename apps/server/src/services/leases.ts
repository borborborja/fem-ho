/**
 * Reserves de tasques delegades (docs/09 §5).
 *
 * "Sense reserva, dos agents amb el mateix token fan la mateixa feina dues vegades."
 *
 * L'assignació és **atòmica per construcció**: `task_leases.task_id` és clau primària, i
 * un `INSERT` que la violi vol dir que algú altre s'hi ha avançat. No cal cap bloqueig
 * explícit i funciona igual als dos motors (D11).
 */

import { sql } from 'kysely';
import type { AuditContext } from '../audit/audited-transaction.js';
import { dbBool } from '../db/bool.js';
import type { MigrationDb } from '../db/migration-db.js';
import { PolicyError } from '../policy/errors.js';
import type { Principal } from '../policy/principal.js';

/** Una reserva dura 30 minuts i es pot renovar (docs/09 §5). */
export const LEASE_MINUTES = 30;

export interface Lease {
  taskId: string;
  userId: string;
  agentId: string | null;
  acquiredAt: string;
  expiresAt: string;
}

/**
 * La clau primària ja existia?
 *
 * SQLite i Postgres ho diuen diferent —`SQLITE_CONSTRAINT_PRIMARYKEY`/`UNIQUE` i el codi
 * `23505`— i comprovar-ho pel text del missatge és el que fa que una traducció del
 * driver trenqui la detecció sense avisar. Es mira el codi.
 */
function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: string }).code ?? '';
  return (
    code === '23505' ||
    code === 'SQLITE_CONSTRAINT_PRIMARYKEY' ||
    code === 'SQLITE_CONSTRAINT_UNIQUE'
  );
}

function expiryFrom(now: string): string {
  return new Date(Date.parse(now) + LEASE_MINUTES * 60_000).toISOString();
}

/**
 * Reserva una tasca concreta.
 *
 * Torna `undefined` si algú altre la té i encara no ha caducat. **No llança**: qui la
 * crida des de `nextTask` ha de poder provar la següent, i una excepció per un cas
 * normal faria que el camí feliç passés per un `try`.
 */
export async function claim(
  ctx: AuditContext,
  principal: Principal,
  taskId: string,
): Promise<Lease | undefined> {
  // Una reserva caducada ja no val: es treu abans de provar-ho, i s'anota que ha
  // caducat perquè a l'historial es vegi que la tasca va tornar a estar disponible.
  const caducada = await sql<{ user_id: string }>`
    SELECT user_id FROM task_leases WHERE task_id = ${taskId} AND expires_at <= ${ctx.now}
  `.execute(ctx.tx);

  if (caducada.rows.length > 0) {
    await sql`DELETE FROM task_leases WHERE task_id = ${taskId}`.execute(ctx.tx);
    ctx.record({
      entityType: 'task',
      entityId: taskId,
      scopeId: null,
      verb: 'released',
      changes: { reason: { from: null, to: 'La reserva ha caducat.' } },
    });
  }

  try {
    await sql`
      INSERT INTO task_leases (task_id, user_id, agent_id, acquired_at, expires_at)
      VALUES (${taskId}, ${principal.userId}, ${principal.agentId ?? null}, ${ctx.now},
              ${expiryFrom(ctx.now)})
    `.execute(ctx.tx);
  } catch (error) {
    /**
     * **Només** la violació d'unicitat es tradueix a "algú altre la té". Qualsevol altre
     * error puja: un `catch` que se'ls empassi tots converteix una clau forana trencada
     * o una taula que falta en un "no hi ha feina disponible", i llavors els agents es
     * queden aturats sense que ningú sàpiga per què.
     */
    if (!isUniqueViolation(error)) throw error;
    return undefined;
  }

  ctx.record({
    entityType: 'task',
    entityId: taskId,
    scopeId: null,
    verb: 'claimed',
    changes: { expires_at: { from: null, to: expiryFrom(ctx.now) } },
  });

  return {
    taskId,
    userId: principal.userId,
    agentId: principal.agentId ?? null,
    acquiredAt: ctx.now,
    expiresAt: expiryFrom(ctx.now),
  };
}

/**
 * La següent tasca delegada disponible, ja reservada.
 *
 * **Només tasques `delegated`** que no estiguin reservades, i només als àmbits que el
 * token pugui veure (docs/09 §5). Es prova amb la següent si una es perd per cursa: dos
 * `next_task` simultanis han de rebre tasques diferents, i això és el que ho garanteix.
 */
export async function nextTask(
  ctx: AuditContext,
  principal: Principal,
  { scopeId }: { scopeId?: string | undefined } = {},
): Promise<{ taskId: string; lease: Lease } | undefined> {
  const scopeFilter =
    principal.scopeIds === null
      ? sql`TRUE`
      : principal.scopeIds.size === 0
        ? sql`FALSE`
        : sql`t.scope_id IN (${sql.join([...principal.scopeIds].map((id) => sql`${id}`))})`;

  const candidates = await sql<{ id: string }>`
    SELECT t.id FROM tasks t
    LEFT JOIN task_leases l ON l.task_id = t.id AND l.expires_at > ${ctx.now}
    WHERE t.ai_mode = 'delegated'
      AND t.status <> 'done'
      AND t.deleted_at IS NULL
      AND l.task_id IS NULL
      /*
        **El que espera resposta no es torna a repartir.** Sense això, l'agent que pregunta
        i allibera es torna a servir la mateixa tasca a la crida següent i entra en bucle
        preguntant el mateix: la reserva ja no la protegeix, perquè justament l'ha deixada
        anar per poder-te deixar respondre.
      */
      AND t.needs_attention = ${dbBool(false)}
      AND ${scopeFilter}
      ${scopeId === undefined ? sql`` : sql`AND t.scope_id = ${scopeId}`}
    ORDER BY t.position
    LIMIT 20
  `.execute(ctx.tx);

  for (const candidate of candidates.rows) {
    const lease = await claim(ctx, principal, candidate.id);
    if (lease !== undefined) return { taskId: candidate.id, lease };
  }

  ctx.noChange();
  return undefined;
}

/**
 * Allibera una reserva.
 *
 * **Exigeix un motiu, i es publica com a comentari** (docs/09 §5): una tasca que torna a
 * la pila sense explicació fa que el següent agent repeteixi el mateix intent fallit.
 */
export async function release(
  ctx: AuditContext,
  principal: Principal,
  taskId: string,
  reason: string,
): Promise<void> {
  if (reason.trim() === '') {
    throw new PolicyError(
      'reason-required',
      'Reason required',
      422,
      'Releasing a task needs a reason: the next agent has to be able to read it.',
    );
  }

  const found = await sql<{ user_id: string }>`
    SELECT user_id FROM task_leases WHERE task_id = ${taskId}
  `.execute(ctx.tx);
  if (found.rows.length === 0) {
    throw new PolicyError('no-lease', 'No lease', 404, 'This task is not claimed.');
  }

  await sql`DELETE FROM task_leases WHERE task_id = ${taskId}`.execute(ctx.tx);

  ctx.record({
    entityType: 'task',
    entityId: taskId,
    scopeId: null,
    verb: 'released',
    changes: { reason: { from: null, to: reason } },
  });
}

/**
 * Deixa anar la reserva **si n'hi ha**, sense queixar-se si no.
 *
 * `release` exigeix motiu i es queixa si no hi ha res a alliberar, que és el correcte quan
 * ho demana un agent. Aquí serveix per als casos on desbloquejar és **una conseqüència** i
 * no una petició: l'agent que pregunta i es queda esperant, o la persona que reclama la
 * tasca. Que no hi hagi reserva no és cap error en cap dels dos casos.
 */
export async function releaseIfHeld(
  ctx: AuditContext,
  taskId: string,
  reason: string,
): Promise<boolean> {
  const result = await sql`DELETE FROM task_leases WHERE task_id = ${taskId}`.execute(ctx.tx);
  if (Number(result.numAffectedRows ?? 0n) === 0) return false;

  ctx.record({
    entityType: 'task',
    entityId: taskId,
    scopeId: null,
    verb: 'released',
    changes: { reason: { from: null, to: reason } },
  });
  return true;
}

/** La reserva viva d'una tasca, si en té. */
export async function leaseOf(
  db: MigrationDb,
  taskId: string,
  now: string,
): Promise<Lease | undefined> {
  const found = await sql<{
    task_id: string;
    user_id: string;
    agent_id: string | null;
    acquired_at: string;
    expires_at: string;
  }>`
    SELECT task_id, user_id, agent_id, acquired_at, expires_at
    FROM task_leases WHERE task_id = ${taskId} AND expires_at > ${now}
  `.execute(db);

  const row = found.rows[0];
  if (row === undefined) return undefined;
  return {
    taskId: row.task_id,
    userId: row.user_id,
    agentId: row.agent_id,
    acquiredAt: row.acquired_at,
    expiresAt: row.expires_at,
  };
}
