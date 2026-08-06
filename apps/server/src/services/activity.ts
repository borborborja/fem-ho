/**
 * L'historial d'una tasca (docs/09 §7).
 *
 * "L'historial de canvis hi és per totes les tasques, es registra qualsevol moviment."
 *
 * Tres detalls que compten i que aquest fitxer ha de servir:
 *
 * - **Els actors es distingeixen**: humans, IA i externs són coses diferents i s'han de
 *   poder pintar diferent.
 * - **Els canvis de camp porten el valor anterior i el nou**, que és per a què
 *   `activity_log.changes` guarda `{camp: {from, to}}`.
 * - **Els canvis autònoms de la IA es poden desfer**, i desfer-los **crea un canvi
 *   invers** que també queda registrat. No s'esborra res de l'historial.
 */

import { sql } from 'kysely';
import type { AuditContext } from '../audit/audited-transaction.js';
import type { MigrationDb } from '../db/migration-db.js';
import { PolicyError, missingCapability, notFound } from '../policy/errors.js';
import { hasCapability, type Principal } from '../policy/principal.js';
import { assertScopeAccess } from './scopes.js';

export type ActorFilter = 'all' | 'ai' | 'human';

export interface ActivityEntry {
  /** UUIDv7: ordena per temps sense necessitat d'un comptador a part. */
  id: string;
  entity_type: string;
  entity_id: string;
  verb: string;
  actor_type: string;
  actor_user_id: string | null;
  actor_agent_id: string | null;
  actor_label: string | null;
  source: string;
  changes: Record<string, { from: unknown; to: unknown }> | null;
  created_at: string;
  /** Un canvi autònom d'IA que encara es pot desfer. */
  undoable: boolean;
}

interface Row {
  id: string;
  entity_type: string;
  entity_id: string;
  verb: string;
  actor_type: string;
  actor_user_id: string | null;
  actor_agent_id: string | null;
  actor_label: string | null;
  source: string;
  changes: string | null;
  created_at: string;
  user_name: string | null;
  agent_name: string | null;
}

/**
 * Els verbs que es poden desfer.
 *
 * Un canvi de camp sí; una creació o un esborrat, no: desfer una creació seria esborrar,
 * i Fem-ho no dona a la IA cap manera d'esborrar res (docs/08 §3).
 */
const UNDOABLE_VERBS = new Set(['updated', 'moved', 'completed', 'reopened']);

export async function listActivity(
  db: MigrationDb,
  principal: Principal,
  taskId: string,
  { actor = 'all' }: { actor?: ActorFilter } = {},
): Promise<ActivityEntry[]> {
  if (!hasCapability(principal, 'tasks:read')) throw missingCapability('tasks:read');

  const task = await sql<{ scope_id: string }>`
    SELECT scope_id FROM tasks WHERE id = ${taskId}
  `.execute(db);
  const row = task.rows[0];
  if (row === undefined) throw notFound('task', taskId);
  await assertScopeAccess(db, principal, row.scope_id);

  const actorFilter =
    actor === 'ai'
      ? sql`AND a.actor_type = 'ai_agent'`
      : actor === 'human'
        ? sql`AND a.actor_type = 'user'`
        : sql``;

  const found = await sql<Row>`
    SELECT a.id, a.entity_type, a.entity_id, a.verb, a.actor_type, a.actor_user_id,
           a.actor_agent_id, a.actor_label, a.source, a.changes, a.created_at,
           u.name AS user_name, g.name AS agent_name
    FROM activity_log a
    LEFT JOIN users u ON u.id = a.actor_user_id
    LEFT JOIN ai_agents g ON g.id = a.actor_agent_id
    WHERE a.entity_id = ${taskId} ${actorFilter}
    ORDER BY a.created_at, a.id
  `.execute(db);

  return found.rows.map(toEntry);
}

function toEntry(row: Row): ActivityEntry {
  let changes: ActivityEntry['changes'] = null;
  if (row.changes !== null) {
    try {
      changes = JSON.parse(row.changes) as ActivityEntry['changes'];
    } catch {
      // Un `changes` malmès no ha de fer desaparèixer l'entrada de l'historial: el que
      // va passar hi consta igual, encara que no se'n puguin ensenyar els valors.
      changes = null;
    }
  }

  return {
    id: row.id,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    verb: row.verb,
    actor_type: row.actor_type,
    actor_user_id: row.actor_user_id,
    actor_agent_id: row.actor_agent_id,
    actor_label: labelOf(row),
    source: row.source,
    changes,
    created_at: row.created_at,
    // Només els autònoms: un canvi que ha fet una persona no porta "Desfés" perquè ja
    // el pot desfer ella mateixa editant.
    undoable: row.actor_type === 'ai_agent' && UNDOABLE_VERBS.has(row.verb) && changes !== null,
  };
}

/**
 * "Borja", "IA · Claude", "Extern · Marta".
 *
 * Si l'escriptura ja en va guardar una, mana aquella: és la que descrivia l'actor en
 * aquell moment. Un convidat que ha marcat una cosa fa un mes s'ha de continuar veient
 * amb el nom que va donar, encara que el seu enllaç ja no existeixi.
 */
function labelOf(row: Row): string | null {
  if (row.actor_label !== null && row.actor_label !== '') return row.actor_label;
  if (row.actor_type === 'ai_agent') return `IA · ${row.agent_name ?? 'agent'}`;
  if (row.actor_type === 'guest') return 'Extern';
  if (row.actor_type === 'caldav') return 'CalDAV';
  if (row.actor_type === 'system') return 'Sistema';
  return row.user_name;
}

/**
 * Desfà un canvi autònom.
 *
 * **Crea un canvi invers i el registra com a tal.** No s'esborra res de l'historial: qui
 * el llegeixi ha de poder veure què va fer la IA *i* que algú ho va desfer, i quan.
 */
export async function undo(
  ctx: AuditContext,
  principal: Principal,
  entryId: string,
): Promise<void> {
  if (!hasCapability(principal, 'tasks:write')) throw missingCapability('tasks:write');

  const found = await sql<Row>`
    SELECT a.id, a.entity_type, a.entity_id, a.verb, a.actor_type, a.actor_user_id,
           a.actor_agent_id, a.actor_label, a.source, a.changes, a.created_at,
           NULL AS user_name, NULL AS agent_name
    FROM activity_log a WHERE a.id = ${entryId}
  `.execute(ctx.tx);

  const row = found.rows[0];
  if (row === undefined) throw notFound('activity', entryId);

  const entry = toEntry(row);
  if (!entry.undoable) {
    throw new PolicyError(
      'not-undoable',
      'Not undoable',
      422,
      "Això no és un canvi autònom d'IA amb valors anteriors: no hi ha res a restaurar.",
    );
  }

  const task = await sql<{ scope_id: string }>`
    SELECT scope_id FROM tasks WHERE id = ${entry.entity_id}
  `.execute(ctx.tx);
  const scopeId = task.rows[0]?.scope_id;
  if (scopeId === undefined) throw notFound('task', entry.entity_id);
  await assertScopeAccess(ctx.tx, principal, scopeId);

  const camps = Object.entries(entry.changes ?? {});
  const assignments = camps.map(([field, change]) => sql`${sql.raw(field)} = ${change.from}`);
  if (assignments.length === 0) {
    throw new PolicyError(
      'not-undoable',
      'Not undoable',
      422,
      'Aquest canvi no diu què hi havia abans.',
    );
  }

  await sql`
    UPDATE tasks SET ${sql.join(assignments)}, updated_at = ${ctx.now}, version = version + 1
    WHERE id = ${entry.entity_id}
  `.execute(ctx.tx);

  ctx.record({
    entityType: 'task',
    entityId: entry.entity_id,
    scopeId,
    verb: 'updated',
    // El canvi invers: el que era `to` ara és `from`. Llegit a l'historial, es veu que
    // algú ha tornat enrere el que havia fet la IA.
    changes: Object.fromEntries(
      camps.map(([field, change]) => [field, { from: change.to, to: change.from }]),
    ),
  });
}

/**
 * Hi ha canvis autònoms que l'usuari encara no ha vist?
 *
 * És el que pinta el **punt de 6px** a la cantonada de la targeta (docs/09 §3), i
 * desapareix en obrir la tasca.
 */
export async function hasUnseenAiChanges(
  db: MigrationDb,
  taskId: string,
  seenAt: string | null,
): Promise<boolean> {
  const found = await sql<{ n: number }>`
    SELECT COUNT(*) AS n FROM activity_log
    WHERE entity_id = ${taskId} AND actor_type = 'ai_agent'
      ${seenAt === null ? sql`` : sql`AND created_at > ${seenAt}`}
  `.execute(db);
  return Number(found.rows[0]?.n ?? 0) > 0;
}
