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
  // Un comentari. És la via principal perquè un agent reporti (docs/09 §6), i per tant
  // ha de sortir a l'historial de la tasca com qualsevol altre gest.
  | 'commented'
  // Un agent que no pot seguir sense tu, i la resposta que el desencalla. Són dos verbs i
  // no un de sol amb un valor: a l'historial el que es llegeix és «t'ha preguntat» i «li
  // has respost», que és exactament el que ha passat.
  | 'asked'
  | 'answered'
  // Una persona s'ha endut una tasca que era de la IA. És el que llegeix l'agent per saber
  // per què la seva següent escriptura ha fallat.
  | 'taken_over'
  // Un refresc d'un origen extern. Es distingeix d'una edició perquè no l'ha fet ningú
  // d'aquí: ve d'un calendari de fora, i a l'historial s'ha de poder llegir així.
  | 'refreshed'
  | 'deleted'
  | 'restored'
  | 'shared'
  | 'delegated'
  | 'claimed'
  | 'released'
  | 'left'
  | 'revoked'
  | 'joined'
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
  /**
   * Declara que aquesta transacció no ha canviat res i per tant no ha de deixar rastre.
   *
   * L'únic cas legítim és la **reenviada idempotent**: amb identificadors generats pel
   * client (D4), el mateix `id` pot arribar dues vegades —una reconnexió, un reintent de
   * la cua de sortida— i la segona no és cap canvi d'estat. Registrar-la ompliria
   * l'historial d'entrades que l'usuari no ha fet.
   *
   * S'ha de DIR explícitament. Si no es diu i no hi ha cap entrada, la transacció
   * llança: oblidar-se de registrar ha de petar, no passar desapercebut.
   */
  noChange: () => void;
  /** L'instant únic de tota la transacció, perquè les entrades no es desordenin. */
  now: string;
}

/**
 * EL PARANY DE LA VISIBILITAT FORA D'ORDRE
 *
 * docs/06 §2: "amb un comptador autoincremental, una transacció llarga que agafa el
 * `seq` 100 pot fer-se visible DESPRÉS d'una de curta amb el `seq` 101. Un client que
 * hagi llegit fins al 101 no veurà mai el 100."
 *
 * De les dues solucions que el document dona, s'implementa la recomanada: **assignar el
 * `seq` al final de la transacció, sota un bloqueig curt**, de manera que l'ordre
 * d'assignació sigui l'ordre de compromís.
 *
 * A SQLite en mode WAL hi ha un sol escriptor i el problema pràcticament no existeix.
 * **A PostgreSQL sí que hi és**, i per això s'hi pren un bloqueig d'assessorament de
 * transacció just abans d'escriure a `change_log`. És barat perquè és a la CUA de la
 * transacció: el que se serialitza són uns quants INSERT, no la feina.
 *
 * L'identificador del bloqueig és una constant arbitrària però FIXA: si canviés entre
 * versions del servidor, dos processos de versions diferents no es bloquejarien entre
 * ells i el parany tornaria.
 */
const CHANGE_LOG_LOCK_ID = 851_002_026;

export interface AuditedTransactionOptions {
  /**
   * Una transacció de només lectura no ha de deixar rastre i no s'hi exigeix cap
   * entrada. S'ha de dir explícitament: el defecte és escriptura, perquè oblidar-se de
   * marcar-ho ha de fallar cap al costat segur.
   */
  readOnly?: boolean;
  now?: string;
  /**
   * El motor. Cal per saber si s'ha de prendre el bloqueig d'assessorament, que és
   * exclusiu de Postgres.
   */
  engine?: 'sqlite' | 'postgres';
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
    let declaredNoChange = false;

    const result = await work({
      tx,
      record: (entry) => entries.push(entry),
      noChange: () => {
        declaredNoChange = true;
      },
      now,
    });

    if (entries.length === 0) {
      if (options.readOnly === true || declaredNoChange) return result;
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
    }

    // El `seq` s'assigna AQUÍ, al final i sota bloqueig, no a mesura que es treballa.
    if (options.engine === 'postgres') {
      await sql`SELECT pg_advisory_xact_lock(${CHANGE_LOG_LOCK_ID})`.execute(tx);
    }
    for (const entry of entries) {
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

  /**
   * Un principal **sense usuari** —un convidat d'un enllaç compartit, o el sistema
   * obrint-lo abans de saber qui hi ha darrere— escriu `NULL` i no una cadena buida.
   *
   * `actor_user_id` té clau forana cap a `users(id)`, i `''` no és cap usuari: la
   * inserció petava amb un error de clau forana que, des de fora, semblava que la
   * pàgina compartida estigués trencada.
   *
   * Un convidat també escriu `NULL` encara que porti l'identificador de qui va crear
   * l'enllaç: el necessita per poder tocar les seves dades, però **el que fa és seu**, i
   * apuntar-ho al compte de qui li va passar l'enllaç seria mentir a l'historial.
   */
  const actorUserId =
    principal.kind === 'guest' || principal.userId === '' ? null : principal.userId;

  await sql`
    INSERT INTO activity_log
      (id, entity_type, entity_id, scope_id, actor_type, actor_user_id, actor_agent_id,
       actor_label, source, verb, changes, created_at)
    VALUES
      (${uuidv7()}, ${entry.entityType}, ${entry.entityId}, ${entry.scopeId ?? null},
       ${actorType}, ${actorUserId}, ${principal.agentId ?? null},
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
