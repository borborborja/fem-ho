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
import { v7 as uuidv7, validate as validUuid } from 'uuid';
import type { AuditContext } from '../audit/audited-transaction.js';
import type { MigrationDb } from '../db/migration-db.js';
import { missingCapability, notFound, PolicyError } from '../policy/errors.js';
import { hasCapability, type Principal } from '../policy/principal.js';
import { rebuildSessions, type StatusChange } from '../policy/session-rebuild.js';
import { settingsOf } from './scope-settings.js';
import { assertScopeAccess } from './scopes.js';
import { roleOf } from '../policy/scope-visibility.js';
import { canEditSession } from '../policy/session-writes.js';
import { createTask, updateTask, type CreateTaskInput } from './tasks.js';

export interface SessionRow {
  version: number;
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
  id, task_id, scope_id, user_id, started_at, ended_at, source, note, version
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
 * Cada sortida tanca el seu tram, també si dura menys d’un minut. Reobrir la tasca
 * conserva els trams tancats i n’obre un altre.
 */
export async function closeSession(ctx: AuditContext, taskId: string): Promise<void> {
  const obertes = await sql<{ id: string; started_at: string }>`
    SELECT id, started_at FROM task_sessions
    WHERE task_id = ${taskId} AND ended_at IS NULL AND deleted_at IS NULL
  `.execute(ctx.tx);

  for (const oberta of obertes.rows) {
    await sql`
      UPDATE task_sessions SET ended_at = ${ctx.now}, updated_at = ${ctx.now},
                               version = version + 1
      WHERE id = ${oberta.id}
    `.execute(ctx.tx);
  }
}

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

/**
 * L'ajust del cronograma: **cinc minuts**.
 *
 * Arrossegar una vora amb el ratolí no té precisió de segons, i sense ajust els blocs
 * quedarien a les 9:03:47. És el mateix criteri de l'eina que això substitueix, i el que fa
 * que dos blocs seguits encaixin sense un forat d'un minut.
 */
export const SNAP_MINUTS = 5;

function snap(instant: string): string {
  const ms = Date.parse(instant);
  if (!Number.isFinite(ms)) throw invalidInstant(instant);
  const pas = SNAP_MINUTS * 60_000;
  return new Date(Math.round(ms / pas) * pas).toISOString();
}

function invalidInstant(value: string): PolicyError {
  return new PolicyError(
    'invalid-instant',
    'Invalid instant',
    422,
    `"${value}" is not an ISO instant.`,
    { value },
  );
}

/** Comprova que el bloc tingui sentit i que qui el toca hi tingui accés. */
async function assertBlockWritable(
  ctx: AuditContext,
  principal: Principal,
  scopeId: string,
  started: string,
  ended: string,
): Promise<void> {
  await assertScopeAccess(ctx.tx, principal, scopeId);

  if (Date.parse(ended) <= Date.parse(started)) {
    throw new PolicyError(
      'empty-session',
      'Empty session',
      422,
      'A block has to end after it starts.',
    );
  }
}

export interface ManualSessionInput {
  id?: string | undefined;
  task_id?: string | undefined;
  new_task?: (CreateTaskInput & { id: string }) | undefined;
  started_at: string;
  ended_at: string;
  note?: string | undefined;
  /** De qui és el temps. Per defecte, de qui l'escriu. */
  user_id?: string | undefined;
}

/**
 * Un bloc escrit a mà: l'entrada manual i el que es dibuixa al cronograma.
 *
 * **Els solapaments no es prohibeixen.** Dues persones poden treballar alhora a la mateixa
 * tasca, i una persona pot tenir raons per apuntar dues coses a la mateixa hora. El que sí
 * que es fa és ensenyar-ho: al cronograma els blocs que es trepitgen es veuen trepitjats.
 */
async function assertSessionWritable(
  ctx: AuditContext,
  principal: Principal,
  scopeId: string,
  userId: string,
) {
  await assertScopeAccess(ctx.tx, principal, scopeId);
  if (!canEditSession(principal, await roleOf(ctx.tx, principal.userId, scopeId), userId))
    throw new PolicyError(
      'session-forbidden',
      'Session forbidden',
      403,
      'You cannot edit this work session.',
    );
}
function invalidSession(message: string): never {
  throw new PolicyError('invalid-session', 'Invalid session', 422, message);
}
function conflict(): never {
  throw new PolicyError(
    'session-conflict',
    'Session conflict',
    409,
    'The session changed. Reload before editing.',
  );
}
export async function createSession(
  ctx: AuditContext,
  principal: Principal,
  input: ManualSessionInput,
  engine: 'sqlite' | 'postgres' = 'sqlite',
  roundTimes = true,
): Promise<SessionRow> {
  if (!hasCapability(principal, 'tasks:write')) throw missingCapability('tasks:write');
  if (!!input.task_id === !!input.new_task)
    invalidSession('Choose an existing task or a new task.');
  const id = input.id ?? uuidv7();
  if (!validUuid(id)) invalidSession('Invalid session identifier.');
  const started = roundTimes ? snap(input.started_at) : new Date(input.started_at).toISOString(),
    ended = roundTimes ? snap(input.ended_at) : new Date(input.ended_at).toISOString();
  const userId = input.user_id ?? principal.userId;
  // Serialitza els reintents del mateix identificador abans de crear una tasca nova.
  if (engine === 'postgres')
    await sql`SELECT pg_advisory_xact_lock(851003, hashtext(${id}))`.execute(ctx.tx);
  const existing = (
    await sql<
      SessionRow & { deleted_at: string | null }
    >`SELECT ${SESSION_COLUMNS}, deleted_at FROM task_sessions WHERE id=${id}`.execute(ctx.tx)
  ).rows[0];
  if (existing) {
    await assertSessionWritable(ctx, principal, existing.scope_id, existing.user_id);
    if (
      existing.deleted_at !== null ||
      existing.task_id !== (input.task_id ?? input.new_task?.id) ||
      existing.user_id !== userId ||
      existing.started_at !== started ||
      existing.ended_at !== ended
    )
      conflict();
    ctx.noChange();
    const { deleted_at: _deleted, ...row } = existing;
    return row;
  }
  let taskId = input.task_id;
  if (input.new_task) {
    const draft = input.new_task;
    if (!draft.id || !validUuid(draft.id) || !draft.scope_id)
      invalidSession('A new task needs an identifier and scope.');
    await assertSessionWritable(ctx, principal, draft.scope_id, userId);
    await assertBlockWritable(ctx, principal, draft.scope_id, started, ended);
    if (!(await settingsOf(ctx.tx, draft.scope_id)).time_tracking)
      invalidSession('Time tracking is disabled.');
    if (draft.project_id) {
      const project = (
        await sql<{
          scope_id: string;
        }>`SELECT scope_id FROM projects WHERE id=${draft.project_id} AND deleted_at IS NULL`.execute(
          ctx.tx,
        )
      ).rows[0];
      if (project?.scope_id !== draft.scope_id) invalidSession('Project belongs to another scope.');
    }
    const created = await createTask(ctx, principal, { ...draft, status: 'done' }, engine);
    if (!created.created) conflict();
    taskId = created.task.id;
    await sql`UPDATE tasks SET completed_at=${ended} WHERE id=${taskId}`.execute(ctx.tx);
    ctx.record({
      entityType: 'task',
      entityId: taskId,
      scopeId: draft.scope_id,
      verb: 'completed',
      changes: { completed_at: { from: null, to: ended } },
    });
  }
  const task = (
    await sql<{
      scope_id: string;
    }>`SELECT scope_id FROM tasks WHERE id=${taskId!} AND deleted_at IS NULL`.execute(ctx.tx)
  ).rows[0];
  if (!task) throw notFound('task', taskId!);
  await assertSessionWritable(ctx, principal, task.scope_id, userId);
  await assertScopeAccess(ctx.tx, { ...principal, userId }, task.scope_id);
  await assertBlockWritable(ctx, principal, task.scope_id, started, ended);
  await sql`INSERT INTO task_sessions (id,task_id,scope_id,user_id,started_at,ended_at,source,note,created_at,updated_at,version)
    VALUES (${id},${taskId!},${task.scope_id},${userId},${started},${ended},'manual',${input.note ?? null},${ctx.now},${ctx.now},1)`.execute(
    ctx.tx,
  );
  ctx.record({
    entityType: 'task',
    entityId: taskId!,
    scopeId: task.scope_id,
    verb: 'logged',
    changes: { session: { from: null, to: `${started}/${ended}` } },
  });
  return {
    id,
    task_id: taskId!,
    scope_id: task.scope_id,
    user_id: userId,
    started_at: started,
    ended_at: ended,
    source: 'manual',
    note: input.note ?? null,
    version: 1,
  };
}

/** El projecte és de tota la tasca; el canvi i els instants comparteixen transacció. */
export async function updateSession(
  ctx: AuditContext,
  principal: Principal,
  id: string,
  input: {
    started_at?: string;
    ended_at?: string;
    note?: string | null;
    task_id?: string;
    project_id?: string | null;
    expected_version?: number;
  },
): Promise<SessionRow> {
  if (!hasCapability(principal, 'tasks:write')) throw missingCapability('tasks:write');
  if (
    input.expected_version !== undefined &&
    (!Number.isInteger(input.expected_version) || input.expected_version < 1)
  )
    invalidSession('Invalid expected version.');
  if (input.task_id !== undefined && input.project_id !== undefined)
    invalidSession('Cannot reassign task and project together.');
  const before = (
    await sql<SessionRow>`SELECT ${SESSION_COLUMNS} FROM task_sessions WHERE id=${id} AND deleted_at IS NULL`.execute(
      ctx.tx,
    )
  ).rows[0];
  if (!before) throw notFound('session', id);
  await assertSessionWritable(ctx, principal, before.scope_id, before.user_id);
  if (input.expected_version !== undefined && input.expected_version !== before.version) conflict();
  let taskId = before.task_id,
    scopeId = before.scope_id;
  if (input.task_id !== undefined && input.task_id !== taskId) {
    const task = (
      await sql<{
        scope_id: string;
      }>`SELECT scope_id FROM tasks WHERE id=${input.task_id} AND deleted_at IS NULL`.execute(
        ctx.tx,
      )
    ).rows[0];
    if (!task) throw notFound('task', input.task_id);
    await assertSessionWritable(ctx, principal, task.scope_id, before.user_id);
    taskId = input.task_id;
    scopeId = task.scope_id;
  }
  // Un desplaçament en passos de cinc minuts conserva els segons del registre automàtic.
  // També conserva una vora intacta quan el formulari només canvia el projecte.
  const adjusted = (value: string | undefined, previous: string | null) => {
    if (value === undefined) return previous;
    const ms = Date.parse(value);
    if (
      previous !== null &&
      Number.isFinite(ms) &&
      (ms - Date.parse(previous)) % (SNAP_MINUTS * 60000) === 0
    )
      return new Date(ms).toISOString();
    return snap(value);
  };
  const started = adjusted(input.started_at, before.started_at)!;
  const ended = adjusted(input.ended_at, before.ended_at);
  await assertBlockWritable(ctx, principal, scopeId, started, ended ?? ctx.now);
  // La condició de versió també és al UPDATE: dos gestos simultanis no se sobreescriuen.
  const changed =
    await sql`UPDATE task_sessions SET task_id=${taskId},scope_id=${scopeId},started_at=${started},ended_at=${ended},
    note=${input.note === undefined ? before.note : input.note},updated_at=${ctx.now},version=version+1
    WHERE id=${id} AND deleted_at IS NULL ${input.expected_version === undefined ? sql`` : sql`AND version=${input.expected_version}`}`.execute(
      ctx.tx,
    );
  if (Number(changed.numAffectedRows ?? 0) === 0) conflict();
  if (input.project_id !== undefined)
    await updateTask(ctx, principal, taskId, { project_id: input.project_id });
  ctx.record({
    entityType: 'task',
    entityId: taskId,
    scopeId,
    verb: 'logged',
    changes: {
      session: {
        from: `${before.started_at}/${before.ended_at ?? ''}`,
        to: `${started}/${ended ?? ''}`,
      },
    },
  });
  return {
    ...before,
    task_id: taskId,
    scope_id: scopeId,
    started_at: started,
    ended_at: ended,
    note: input.note === undefined ? before.note : input.note,
    version: before.version + 1,
  };
}

/**
 * Esborra un bloc.
 *
 * **Suau**, com tota la resta: la tombstone ha de poder viatjar als altres dispositius, i un
 * bloc esborrat de debò tornaria a aparèixer al primer `backfill` que passés per allà.
 */
export async function deleteSession(
  ctx: AuditContext,
  principal: Principal,
  id: string,
): Promise<void> {
  if (!hasCapability(principal, 'tasks:write')) throw missingCapability('tasks:write');

  const found = await sql<SessionRow>`
    SELECT ${SESSION_COLUMNS} FROM task_sessions WHERE id = ${id} AND deleted_at IS NULL
  `.execute(ctx.tx);
  const bloc = found.rows[0];
  if (bloc === undefined) throw notFound('session', id);
  await assertSessionWritable(ctx, principal, bloc.scope_id, bloc.user_id);

  await sql`
    UPDATE task_sessions SET deleted_at = ${ctx.now}, updated_at = ${ctx.now},
                             version = version + 1
    WHERE id = ${id}
  `.execute(ctx.tx);

  ctx.record({
    entityType: 'task',
    entityId: bloc.task_id,
    scopeId: bloc.scope_id,
    verb: 'logged',
    changes: { session: { from: `${bloc.started_at}/${bloc.ended_at ?? ''}`, to: null } },
  });
}
