/**
 * L'embolcall de transacció auditada.
 *
 * Regla 4 d'instruccions.md: cada canvi d'estat escriu una entrada a `activity_log`
 * dins de **la mateixa transacció** que el canvi. **Si un camí d'escriptura no pot
 * escriure el log, no és un camí d'escriptura vàlid.**
 *
 * docs/13 M3 diu com s'implementa i per què: "com a embolcall de transacció, no com a
 * crida que cada servei ha de recordar". Una crida que cada servei ha de recordar
 * s'oblida a la tercera setmana, i quan s'oblida no falla res — simplement deixa de
 * quedar rastre, que és el pitjor error possible en un sistema de registre.
 *
 * Aquí això s'imposa de dues maneres:
 *   1. Les entrades s'escriuen dins de la mateixa transacció que el canvi. Si la
 *      transacció es desfà, el log també.
 *   2. Una transacció marcada com a escriptura que acabi **sense cap entrada** llança.
 *      No hi ha manera d'escriure en silenci sense que peti a la cara.
 */

import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import type { MigrationDb } from '../db/migration-db.js';
import type { Principal } from '../policy/principal.js';

/** Els verbs de docs/01 §7. `cascade_complete` distingeix la cascada d'un gest directe. */
export type AuditVerb =
  | 'created'
  | 'updated'
  | 'moved'
  | 'completed'
  | 'reopened'
  | 'cascade_complete'
  | 'deleted'
  | 'restored'
  | 'shared'
  | 'delegated'
  | 'claimed'
  | 'released'
  | 'logged_in'
  | 'logged_out'
  | 'token_created'
  | 'token_revoked';

export interface AuditEntry {
  entityType: string;
  entityId: string;
  scopeId?: string | null;
  verb: AuditVerb;
  /** `{camp: {from, to}}`. És el que fa possible desfer un canvi autònom de la IA. */
  changes?: Record<string, { from: unknown; to: unknown }>;
}

export interface AuditContext {
  /** La transacció. Tota escriptura hi ha de passar, o no serà atòmica amb el log. */
  tx: MigrationDb;
  /** Registra un canvi. Les entrades s'escriuen al final, dins de la transacció. */
  record: (entry: AuditEntry) => void;
  /** L'instant únic de tota la transacció, perquè les entrades no es desordenin. */
  now: string;
}

export interface AuditedTransactionOptions {
  /**
   * Una transacció de només lectura no ha de deixar rastre i no s'hi exigeix cap
   * entrada. S'ha de dir explícitament: el defecte és escriptura, perquè oblidar-se de
   * marcar-ho ha de fallar cap al costat segur.
   */
  readOnly?: boolean;
  now?: string;
}

/**
 * Executa `work` dins d'una transacció i hi escriu `activity_log` abans de confirmar.
 *
 * Llança si la transacció és d'escriptura i no s'hi ha registrat cap entrada.
 */
export async function auditedTransaction<T>(
  db: MigrationDb,
  principal: Principal,
  work: (ctx: AuditContext) => Promise<T>,
  options: AuditedTransactionOptions = {},
): Promise<T> {
  const now = options.now ?? new Date().toISOString();

  return db.transaction().execute(async (tx) => {
    const entries: AuditEntry[] = [];

    const result = await work({
      tx,
      record: (entry) => entries.push(entry),
      now,
    });

    if (entries.length === 0) {
      if (options.readOnly === true) return result;
      throw new Error(
        "Regla 4: una transacció d'escriptura ha acabat sense cap entrada a activity_log. " +
          "Si aquest camí no ha de deixar rastre, marca'l com a readOnly explícitament.",
      );
    }

    if (options.readOnly === true && entries.length > 0) {
      throw new Error(
        'Una transacció marcada com a readOnly ha registrat canvis. O no és de lectura, ' +
          'o el registre és un error.',
      );
    }

    for (const entry of entries) {
      await writeEntry(tx, principal, entry, now);
      await writeChangeLog(tx, entry, now);
    }

    return result;
  });
}

async function writeEntry(
  tx: MigrationDb,
  principal: Principal,
  entry: AuditEntry,
  now: string,
): Promise<void> {
  // L'actor surt del principal, no d'un paràmetre: així no hi ha manera d'escriure una
  // entrada amb un actor que no sigui qui de veritat ha fet la petició.
  const actorType =
    principal.kind === 'agent' ? 'ai_agent' : principal.kind === 'guest' ? 'guest' : 'user';

  await sql`
    INSERT INTO activity_log
      (id, entity_type, entity_id, scope_id, actor_type, actor_user_id, actor_agent_id,
       actor_label, source, verb, changes, created_at)
    VALUES
      (${uuidv7()}, ${entry.entityType}, ${entry.entityId}, ${entry.scopeId ?? null},
       ${actorType}, ${principal.userId}, ${principal.agentId ?? null},
       ${principal.label ?? null}, ${principal.source}, ${entry.verb},
       ${entry.changes === undefined ? null : JSON.stringify(entry.changes)}, ${now})
  `.execute(tx);
}

/**
 * `change_log` és una cosa diferent d'`activity_log` i totes dues calen (docs/01 §7):
 * la primera és per a l'usuari —què va passar i qui ho va fer—, la segona per a les
 * màquines —què ha canviat des del cursor N—.
 *
 * S'escriuen juntes perquè tot canvi que interessa a una persona també ha d'arribar als
 * altres clients.
 */
async function writeChangeLog(tx: MigrationDb, entry: AuditEntry, now: string): Promise<void> {
  const operation = entry.verb === 'deleted' ? 'delete' : 'upsert';
  await sql`
    INSERT INTO change_log (entity_type, entity_id, scope_id, operation, created_at)
    VALUES (${entry.entityType}, ${entry.entityId}, ${entry.scopeId ?? null}, ${operation}, ${now})
  `.execute(tx);
}
