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
import { assertScopeAccess } from './scopes.js';

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

/** L'àmbit de la tasca amfitriona. Tota comprovació de permís hi passa. */
async function scopeOfTask(db: MigrationDb, taskId: string): Promise<string> {
  const found = await sql<{ scope_id: string }>`
    SELECT scope_id FROM tasks WHERE id = ${taskId} AND deleted_at IS NULL
  `.execute(db);
  const row = found.rows[0];
  if (row === undefined) throw notFound('tasca', taskId);
  return row.scope_id;
}

async function taskOfSubtask(
  db: MigrationDb,
  subtaskId: string,
): Promise<{ row: SubtaskRow; scopeId: string }> {
  const found = await sql<SubtaskRow>`
    SELECT id, task_id, title, done, position, version
    FROM subtasks WHERE id = ${subtaskId} AND deleted_at IS NULL
  `.execute(db);
  const row = found.rows[0];
  if (row === undefined) throw notFound('subtasca', subtaskId);
  return { row, scopeId: await scopeOfTask(db, row.task_id) };
}

export async function listSubtasks(
  db: MigrationDb,
  principal: Principal,
  taskId: string,
): Promise<SubtaskView[]> {
  if (!hasCapability(principal, 'tasks:read')) throw missingCapability('tasks:read');
  await assertScopeAccess(db, principal, await scopeOfTask(db, taskId));

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
  if (!hasCapability(principal, 'tasks:write')) throw missingCapability('tasks:write');
  const scopeId = await scopeOfTask(ctx.tx, taskId);
  await assertScopeAccess(ctx.tx, principal, scopeId);

  if (input.title === undefined || input.title.trim() === '') {
    throw new PolicyError('title-required', 'Title required', 422, 'La subtasca necessita títol.');
  }

  const id = input.id ?? uuidv7();
  const existing = await sql<SubtaskRow>`
    SELECT id, task_id, title, done, position, version FROM subtasks WHERE id = ${id}
  `.execute(ctx.tx);
  if (existing.rows[0] !== undefined) {
    ctx.noChange();
    return toView(existing.rows[0]);
  }

  const last = await sql<{ position: string }>`
    SELECT position FROM subtasks WHERE task_id = ${taskId} AND deleted_at IS NULL
    ORDER BY position DESC, id DESC LIMIT 1
  `.execute(ctx.tx);

  await sql`
    INSERT INTO subtasks (id, task_id, title, done, position, created_at, updated_at, version)
    VALUES (${id}, ${taskId}, ${input.title.trim()}, ${dbBool(false)},
            ${input.position ?? generatePosition(last.rows[0]?.position ?? null, null)},
            ${ctx.now}, ${ctx.now}, 1)
  `.execute(ctx.tx);

  ctx.record({ entityType: 'subtask', entityId: id, scopeId, verb: 'created' });

  const created = await sql<SubtaskRow>`
    SELECT id, task_id, title, done, position, version FROM subtasks WHERE id = ${id}
  `.execute(ctx.tx);
  return toView(created.rows[0]!);
}

export async function updateSubtask(
  ctx: AuditContext,
  principal: Principal,
  subtaskId: string,
  input: { title?: string | undefined; done?: boolean | undefined; position?: string | undefined },
): Promise<SubtaskView> {
  if (!hasCapability(principal, 'tasks:write')) throw missingCapability('tasks:write');
  const { row, scopeId } = await taskOfSubtask(ctx.tx, subtaskId);
  await assertScopeAccess(ctx.tx, principal, scopeId);

  if (input.title !== undefined && input.title.trim() === '') {
    throw new PolicyError('title-required', 'Title required', 422, 'El títol no pot quedar buit.');
  }

  const done = input.done ?? isTrue(row.done);
  const title = input.title?.trim() ?? row.title;
  const position = input.position ?? row.position;

  if (done === isTrue(row.done) && title === row.title && position === row.position) {
    ctx.noChange();
    return toView(row);
  }

  await sql`
    UPDATE subtasks SET title = ${title}, done = ${dbBool(done)}, position = ${position},
                        updated_at = ${ctx.now}, version = version + 1
    WHERE id = ${subtaskId}
  `.execute(ctx.tx);

  ctx.record({
    entityType: 'subtask',
    entityId: subtaskId,
    scopeId,
    // Marcar-la i reobrir-la són gestos diferents a l'historial, com a les tasques.
    verb: done === isTrue(row.done) ? 'updated' : done ? 'completed' : 'reopened',
    changes: {
      title: { from: row.title, to: title },
      done: { from: isTrue(row.done), to: done },
    },
  });

  const after = await sql<SubtaskRow>`
    SELECT id, task_id, title, done, position, version FROM subtasks WHERE id = ${subtaskId}
  `.execute(ctx.tx);
  return toView(after.rows[0]!);
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
  const { scopeId } = await taskOfSubtask(ctx.tx, subtaskId);
  await assertScopeAccess(ctx.tx, principal, scopeId);

  await sql`
    UPDATE checklists SET subtask_id = NULL, updated_at = ${ctx.now}, version = version + 1
    WHERE subtask_id = ${subtaskId} AND deleted_at IS NULL
  `.execute(ctx.tx);

  await sql`
    UPDATE subtasks SET deleted_at = ${ctx.now}, updated_at = ${ctx.now}, version = version + 1
    WHERE id = ${subtaskId}
  `.execute(ctx.tx);

  ctx.record({ entityType: 'subtask', entityId: subtaskId, scopeId, verb: 'deleted' });
}
