/**
 * Comentaris.
 *
 * **És la via principal perquè un agent reporti** (docs/09 §6): "és el que ja fa el
 * producte per a humans, es veu a l'historial i no necessita cap concepte nou".
 *
 * Un agent que té un dubte comenta i allibera; un que no pot fer una cosa comenta el
 * motiu i allibera. Res d'això necessita un canal separat.
 */

import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import type { AuditContext } from '../audit/audited-transaction.js';
import type { MigrationDb } from '../db/migration-db.js';
import { PolicyError, missingCapability, notFound } from '../policy/errors.js';
import { hasCapability, type Principal } from '../policy/principal.js';
import { assertScopeAccess } from './scopes.js';

export interface Comment {
  id: string;
  task_id: string;
  author_id: string | null;
  guest_name: string | null;
  body: string;
  created_at: string;
  updated_at: string;
}

export async function addComment(
  ctx: AuditContext,
  principal: Principal,
  taskId: string,
  body: string,
): Promise<Comment> {
  if (!hasCapability(principal, 'comments:write')) throw missingCapability('comments:write');

  if (body.trim() === '') {
    throw new PolicyError(
      'body-required',
      'Body required',
      422,
      'Un comentari buit no diu res: escriu-hi el motiu.',
    );
  }

  const task = await sql<{ scope_id: string }>`
    SELECT scope_id FROM tasks WHERE id = ${taskId} AND deleted_at IS NULL
  `.execute(ctx.tx);
  const row = task.rows[0];
  if (row === undefined) throw notFound('task', taskId);

  await assertScopeAccess(ctx.tx, principal, row.scope_id);

  const id = uuidv7();
  await sql`
    INSERT INTO comments (id, task_id, author_id, guest_name, body, created_at, updated_at)
    VALUES (${id}, ${taskId}, ${principal.userId}, ${principal.label ?? null}, ${body.trim()},
            ${ctx.now}, ${ctx.now})
  `.execute(ctx.tx);

  /**
   * El comentari es registra contra la **tasca**, no contra ell mateix: qui llegeix
   * l'historial d'una tasca vol veure-hi que algú hi ha dit una cosa, no haver de
   * buscar en un historial de comentaris a part.
   */
  ctx.record({
    entityType: 'task',
    entityId: taskId,
    scopeId: row.scope_id,
    verb: 'commented',
    changes: { body: { from: null, to: body.trim() } },
  });

  return {
    id,
    task_id: taskId,
    author_id: principal.userId,
    guest_name: principal.label ?? null,
    body: body.trim(),
    created_at: ctx.now,
    updated_at: ctx.now,
  };
}

export async function listComments(
  db: MigrationDb,
  principal: Principal,
  taskId: string,
): Promise<Comment[]> {
  if (!hasCapability(principal, 'comments:read')) throw missingCapability('comments:read');

  const task = await sql<{ scope_id: string }>`
    SELECT scope_id FROM tasks WHERE id = ${taskId} AND deleted_at IS NULL
  `.execute(db);
  const row = task.rows[0];
  if (row === undefined) throw notFound('task', taskId);
  await assertScopeAccess(db, principal, row.scope_id);

  const found = await sql<Comment>`
    SELECT id, task_id, author_id, guest_name, body, created_at, updated_at
    FROM comments WHERE task_id = ${taskId} AND deleted_at IS NULL
    ORDER BY created_at
  `.execute(db);
  return found.rows;
}
