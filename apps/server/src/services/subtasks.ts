/**
 * Subtasques. docs/01 §4, docs/05 §4.
 *
 * Una subtasca **no és una tasca**: no té àmbit propi, ni estat de kanban, ni data, ni
 * assignat. Té títol i fet/no fet, i viu dins d'una tasca. Aquesta contenció és el que
 * la distingeix d'una llista senzilla, que encara en té menys (P1): una subtasca pot
 * ancorar una llista, un ítem de llista no pot ancorar res.
 */

import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { generatePosition } from '@fem-ho/contracts';
import type { AuditContext } from '../audit/audited-transaction.js';
import { dbBool, isTrue } from '../db/bool.js';
import type { MigrationDb } from '../db/migration-db.js';
import { PolicyError, missingCapability, notFound } from '../policy/errors.js';
import { hasCapability, type Principal } from '../policy/principal.js';
import { assertScopeAccess, assertScopeRole } from './scopes.js';
import { assertWritable, type TaskRow } from './tasks.js';

export interface SubtaskView {
  id: string;
  task_id: string;
  title: string;
  done: boolean;
  position: string;
  version: number;
}

interface SubtaskRow {
  id: string;
  task_id: string;
  title: string;
  done: unknown;
  position: string;
  version: number;
}

type ParentTask = Pick<TaskRow, 'id' | 'scope_id' | 'ai_mode'>;

function toView(row: SubtaskRow): SubtaskView {
  return {
    id: row.id,
    task_id: row.task_id,
    title: row.title,
    done: isTrue(row.done),
    position: row.position,
    version: row.version,
  };
}

/** La subtasca hereta els permisos i la reserva de la tasca que la conté. */
async function parentTask(db: MigrationDb, taskId: string): Promise<ParentTask> {
  const found = await sql<ParentTask>`
    SELECT id, scope_id, ai_mode FROM tasks WHERE id = ${taskId} AND deleted_at IS NULL
  `.execute(db);
  const row = found.rows[0];
  if (row === undefined) throw notFound('task', taskId);
  return row;
}

async function assertParentWritable(
  ctx: AuditContext,
  principal: Principal,
  taskId: string,
): Promise<string> {
  const task = await parentTask(ctx.tx, taskId);
  await assertScopeRole(ctx.tx, principal, task.scope_id, 'content', { type: 'task', id: taskId });
  await assertWritable(ctx, principal, task, 'edit');
  return task.scope_id;
}

async function findSubtask(db: MigrationDb, subtaskId: string): Promise<SubtaskRow> {
  const found = await sql<SubtaskRow>`
    SELECT id, task_id, title, done, position, version
    FROM subtasks WHERE id = ${subtaskId} AND deleted_at IS NULL
  `.execute(db);
  const row = found.rows[0];
  if (row === undefined) throw notFound('subtask', subtaskId);
  return row;
}

export async function listSubtasks(
  db: MigrationDb,
  principal: Principal,
  taskId: string,
): Promise<SubtaskView[]> {
  if (!hasCapability(principal, 'tasks:read')) throw missingCapability('tasks:read');
  await assertScopeAccess(db, principal, (await parentTask(db, taskId)).scope_id);

  const rows = await sql<SubtaskRow>`
    SELECT id, task_id, title, done, position, version
    FROM subtasks WHERE task_id = ${taskId} AND deleted_at IS NULL
    ORDER BY position, id
  `.execute(db);
  return rows.rows.map(toView);
}

export async function createSubtask(
  ctx: AuditContext,
  principal: Principal,
  taskId: string,
  input: { id?: string | undefined; title?: string | undefined; position?: string | undefined },
): Promise<SubtaskView> {
  if (!hasCapability(principal, 'tasks:update')) throw missingCapability('tasks:update');
  const scopeId = await assertParentWritable(ctx, principal, taskId);
  return insertSubtask(ctx, taskId, scopeId, input);
}

/** El cridant ja ha autoritzat l'escriptura a la tasca i n'ha resolt l'àmbit. */
export async function insertSubtask(
  ctx: AuditContext,
  taskId: string,
  scopeId: string,
  input: {
    id?: string | undefined;
    title?: string | undefined;
    position?: string | undefined;
    done?: boolean | undefined;
  },
): Promise<SubtaskView> {
  if (input.title === undefined || input.title.trim() === '') {
    throw new PolicyError('title-required', 'Title required', 422, 'The subtask needs a title.');
  }

  const id = input.id ?? uuidv7();
  const last = await sql<{ position: string }>`
    SELECT position FROM subtasks WHERE task_id = ${taskId} AND deleted_at IS NULL
    ORDER BY position DESC, id DESC LIMIT 1
  `.execute(ctx.tx);

  const created = await sql<SubtaskRow>`
    INSERT INTO subtasks (id, task_id, title, done, position, created_at, updated_at, version)
    VALUES (${id}, ${taskId}, ${input.title.trim()}, ${dbBool(input.done === true)},
            ${input.position ?? generatePosition(last.rows[0]?.position ?? null, null)},
            ${ctx.now}, ${ctx.now}, 1)
    ON CONFLICT (id) DO NOTHING
    RETURNING id, task_id, title, done, position, version
  `.execute(ctx.tx);

  const row = created.rows[0];
  if (row !== undefined) {
    ctx.record({ entityType: 'subtask', entityId: id, scopeId, taskId, verb: 'created' });
    return toView(row);
  }

  // Dos reintents amb el mateix UUID poden arribar abans que cap dels dos hagi confirmat.
  const existing = await findSubtask(ctx.tx, id);
  if (existing.task_id !== taskId) throw notFound('subtask', id);
  ctx.noChange();
  return toView(existing);
}

export async function updateSubtask(
  ctx: AuditContext,
  principal: Principal,
  subtaskId: string,
  input: { title?: string | undefined; done?: boolean | undefined; position?: string | undefined },
): Promise<SubtaskView> {
  if (!hasCapability(principal, 'tasks:update')) throw missingCapability('tasks:update');
  let row = await findSubtask(ctx.tx, subtaskId);
  const scopeId = await assertParentWritable(ctx, principal, row.task_id);

  if (input.title !== undefined && input.title.trim() === '') {
    throw new PolicyError(
      'title-required',
      'Title required',
      422,
      'The title cannot be left empty.',
    );
  }

  for (;;) {
    const wasDone = isTrue(row.done);
    const done = input.done ?? wasDone;
    const title = input.title?.trim() ?? row.title;
    const position = input.position ?? row.position;
    const changes = {
      ...(title !== row.title ? { title: { from: row.title, to: title } } : {}),
      ...(done !== wasDone ? { done: { from: wasDone, to: done } } : {}),
      ...(position !== row.position ? { position: { from: row.position, to: position } } : {}),
    };
    if (Object.keys(changes).length === 0) {
      ctx.noChange();
      return toView(row);
    }

    // Una edició i un canvi d'estat simultanis han de conservar els dos camps i el seu rastre.
    const updated = await sql<SubtaskRow>`
      UPDATE subtasks SET title = ${title}, done = ${dbBool(done)}, position = ${position},
                          updated_at = ${ctx.now}, version = version + 1
      WHERE id = ${subtaskId} AND version = ${row.version} AND deleted_at IS NULL
      RETURNING id, task_id, title, done, position, version
    `.execute(ctx.tx);
    const after = updated.rows[0];
    if (after !== undefined) {
      ctx.record({
        entityType: 'subtask',
        entityId: subtaskId,
        scopeId,
        taskId: row.task_id,
        verb: done === wasDone ? 'updated' : done ? 'completed' : 'reopened',
        changes,
      });
      return toView(after);
    }
    row = await findSubtask(ctx.tx, subtaskId);
  }
}

/**
 * Esborrat suau.
 *
 * **Les llistes ancorades a la subtasca es desancoren**, no cauen. Una llista de la
 * compra que penjava d'una subtasca segueix sent la llista de la compra quan la
 * subtasca desapareix; esborrar-la seria decidir per l'usuari.
 */
export async function deleteSubtask(
  ctx: AuditContext,
  principal: Principal,
  subtaskId: string,
): Promise<void> {
  if (!hasCapability(principal, 'tasks:write')) throw missingCapability('tasks:write');
  const { task_id: taskId } = await findSubtask(ctx.tx, subtaskId);
  const scopeId = await assertParentWritable(ctx, principal, taskId);

  const deleted = await sql<{ id: string }>`
    UPDATE subtasks SET deleted_at = ${ctx.now}, updated_at = ${ctx.now}, version = version + 1
    WHERE id = ${subtaskId} AND deleted_at IS NULL
    RETURNING id
  `.execute(ctx.tx);
  if (deleted.rows[0] === undefined) throw notFound('subtask', subtaskId);

  const detached = await sql<{ id: string }>`
    UPDATE checklists SET subtask_id = NULL, updated_at = ${ctx.now}, version = version + 1
    WHERE subtask_id = ${subtaskId} AND deleted_at IS NULL
    RETURNING id
  `.execute(ctx.tx);
  // El canvi de la llista necessita el seu propi delta, a més de la tombstone de la subtasca.
  for (const checklist of detached.rows) {
    ctx.record({
      entityType: 'checklist',
      entityId: checklist.id,
      scopeId,
      taskId,
      verb: 'updated',
      changes: { subtask_id: { from: subtaskId, to: null } },
    });
  }

  ctx.record({ entityType: 'subtask', entityId: subtaskId, scopeId, taskId, verb: 'deleted' });
}
