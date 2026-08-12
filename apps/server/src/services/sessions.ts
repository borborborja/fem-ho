/**
 * Els blocs de temps treballat.
 *
 * **L'APP HO ANOTA SOLA.** No hi ha cap botó de començar i aturar, i no s'ha de confirmar
 * res: moure una targeta a **Fent** obre un bloc i treure-la'n el tanca. El gest que ja fas
 * per dir «hi estic» és el que compta les hores, i per això no hi ha res a recordar-se.
 *
 * **QUI OBRE I QUI TANCA.** `moveTask`, que és l'únic camí pel qual una tasca canvia de
 * columna. Aquí només hi ha les dues operacions i la reconstrucció del passat.
 *
 * **NOMÉS ALS ÀMBITS QUE HO TENEN ENCÈS.** Un àmbit sense registre no genera blocs: no és
 * una dada que després es filtri, és una dada que no existeix. Encendre'l després no perd
 * res, perquè el passat es reconstrueix de l'historial (`backfillSessions`).
 */

import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import type { AuditContext } from '../audit/audited-transaction.js';
import type { MigrationDb } from '../db/migration-db.js';
import { rebuildSessions, type StatusChange } from '../policy/session-rebuild.js';
import { settingsOf } from './scope-settings.js';

export interface SessionRow {
  id: string;
  task_id: string;
  scope_id: string;
  user_id: string;
  started_at: string;
  ended_at: string | null;
  source: 'board' | 'manual' | 'backfill';
  note: string | null;
}

export const SESSION_COLUMNS = sql`
  id, task_id, scope_id, user_id, started_at, ended_at, source, note
`;

/**
 * Obre un bloc perquè la tasca acaba d'entrar a Fent.
 *
 * **Un agent d'IA també hi compta.** La dedicació és de qui mou la targeta, i un agent actua
 * en nom d'una persona: el temps va al seu compte, com tot el que fa (D5).
 */
export async function openSession(
  ctx: AuditContext,
  userId: string,
  task: { id: string; scope_id: string },
): Promise<void> {
  if (!(await settingsOf(ctx.tx, task.scope_id)).time_tracking) return;

  /**
   * Si ja n'hi ha una d'oberta no se'n fa una altra: dues obertes alhora per a la mateixa
   * tasca voldrien dir que hi és dues vegades, i el total la comptaria doble.
   */
  const oberta = await sql<{ id: string }>`
    SELECT id FROM task_sessions
    WHERE task_id = ${task.id} AND ended_at IS NULL AND deleted_at IS NULL
  `.execute(ctx.tx);
  if (oberta.rows.length > 0) return;

  await sql`
    INSERT INTO task_sessions
      (id, task_id, scope_id, user_id, started_at, ended_at, source, note,
       created_at, updated_at, version)
    VALUES (${uuidv7()}, ${task.id}, ${task.scope_id}, ${userId}, ${ctx.now}, ${null},
            'board', ${null}, ${ctx.now}, ${ctx.now}, 1)
  `.execute(ctx.tx);
}

/**
 * Tanca el bloc obert d'una tasca, perquè acaba de sortir de Fent.
 *
 * **Els de durada zero no es desen.** Passar per Fent en un clic —arrossegant una targeta de
 * Per fer a Fet a través de la columna del mig, o rectificant— no és temps treballat, i el
 * Registre s'ompliria de línies de zero minuts que no diuen res.
 */
export async function closeSession(ctx: AuditContext, taskId: string): Promise<void> {
  const obertes = await sql<{ id: string; started_at: string }>`
    SELECT id, started_at FROM task_sessions
    WHERE task_id = ${taskId} AND ended_at IS NULL AND deleted_at IS NULL
  `.execute(ctx.tx);

  for (const oberta of obertes.rows) {
    const segons = (Date.parse(ctx.now) - Date.parse(oberta.started_at)) / 1000;

    if (segons < MINIM_SEGONS) {
      await sql`DELETE FROM task_sessions WHERE id = ${oberta.id}`.execute(ctx.tx);
      continue;
    }

    await sql`
      UPDATE task_sessions SET ended_at = ${ctx.now}, updated_at = ${ctx.now},
                               version = version + 1
      WHERE id = ${oberta.id}
    `.execute(ctx.tx);
  }
}

/**
 * Per sota d'un minut no és feina.
 *
 * Arrossegar una targeta de Per fer a Fet passant per la columna del mig, o rectificar de
 * seguida, deixaria una fila de zero minuts al Registre. Amb prou d'aquestes, la taula deixa
 * de ser llegible per dir una cosa que ningú necessita saber.
 */
const MINIM_SEGONS = 60;

/**
 * Escriu els blocs del passat que l'historial permet deduir.
 *
 * Es crida en encendre el registre d'un àmbit —i es pot tornar a cridar sempre que es vulgui:
 * **és idempotent**, no duplica el que ja hi és. La decisió de què es pot deduir i què seria
 * suposar viu a `policy/session-rebuild.ts`.
 *
 * Torna quants n'ha escrit, perquè la pantalla pugui dir «s'han recuperat 143 blocs» en
 * comptes de deixar-ho passar en silenci.
 */
export async function backfillSessions(ctx: AuditContext, scopeId: string): Promise<number> {
  const files = await sql<{
    entity_id: string;
    created_at: string;
    changes: string | null;
    actor_user_id: string | null;
  }>`
    SELECT a.entity_id, a.created_at, a.changes, a.actor_user_id
    FROM activity_log a
    JOIN tasks t ON t.id = a.entity_id AND t.deleted_at IS NULL
    WHERE a.entity_type = 'task' AND t.scope_id = ${scopeId} AND a.changes IS NOT NULL
    ORDER BY a.created_at, a.id
  `.execute(ctx.tx);

  const canvis: StatusChange[] = [];
  for (const fila of files.rows) {
    let status: { from?: unknown; to?: unknown } | undefined;
    try {
      status = (
        JSON.parse(fila.changes ?? '{}') as Record<string, { from?: unknown; to?: unknown }>
      ).status;
    } catch {
      // Un `changes` malmès no ha de tombar la reconstrucció sencera: es deixa passar
      // aquella fila, que és el mateix que fa l'historial en pintar-se.
      status = undefined;
    }
    if (status === undefined) continue;

    canvis.push({
      taskId: fila.entity_id,
      at: fila.created_at,
      from: typeof status.from === 'string' ? status.from : null,
      to: typeof status.to === 'string' ? status.to : null,
      userId: fila.actor_user_id,
    });
  }

  const trams = rebuildSessions(canvis);
  if (trams.length === 0) return 0;

  // Els que ja hi són, per no duplicar-los: la parella (tasca, inici) és el que identifica
  // un tram, perquè és el que la reconstrucció torna a deduir igual cada vegada.
  const existents = await sql<{ task_id: string; started_at: string }>`
    SELECT task_id, started_at FROM task_sessions WHERE scope_id = ${scopeId}
  `.execute(ctx.tx);
  const ja = new Set(existents.rows.map((row) => `${row.task_id}|${row.started_at}`));

  let escrits = 0;
  for (const tram of trams) {
    if (ja.has(`${tram.taskId}|${tram.startedAt}`)) continue;
    await sql`
      INSERT INTO task_sessions
        (id, task_id, scope_id, user_id, started_at, ended_at, source, note,
         created_at, updated_at, version)
      VALUES (${uuidv7()}, ${tram.taskId}, ${scopeId}, ${tram.userId}, ${tram.startedAt},
              ${tram.endedAt}, 'backfill', ${null}, ${ctx.now}, ${ctx.now}, 1)
    `.execute(ctx.tx);
    escrits++;
  }

  if (escrits > 0) {
    ctx.record({
      entityType: 'scope',
      entityId: scopeId,
      scopeId,
      verb: 'updated',
      changes: { sessions_backfilled: { from: 0, to: escrits } },
    });
  }

  return escrits;
}

/** Els blocs d'una tasca, per a la fitxa. */
export async function sessionsOfTask(db: MigrationDb, taskId: string): Promise<SessionRow[]> {
  const found = await sql<SessionRow>`
    SELECT ${SESSION_COLUMNS} FROM task_sessions
    WHERE task_id = ${taskId} AND deleted_at IS NULL
    ORDER BY started_at
  `.execute(db);
  return found.rows;
}
