/**
 * Etiquetes. docs/01 §4, docs/05 §4 (`GET /labels`).
 *
 * Una etiqueta pertany a un àmbit, no a la instància: "Urgent" a Feina i "Urgent" a
 * Casa són coses diferents i la clau única `(scope_id, name)` ho imposa. Compartir-les
 * entre àmbits obligaria a decidir qui les pot esborrar, que és una discussió que un
 * gestor de tasques d'una casa no necessita.
 */

import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import type { AuditContext } from '../audit/audited-transaction.js';
import type { MigrationDb } from '../db/migration-db.js';
import { PolicyError, missingCapability, notFound } from '../policy/errors.js';
import { hasCapability, type Principal } from '../policy/principal.js';
import { assertScopeAccess, listScopes } from './scopes.js';

export interface LabelRow {
  id: string;
  scope_id: string;
  name: string;
  color: string;
  created_at: string;
}

export async function listLabels(
  db: MigrationDb,
  principal: Principal,
  scopeId?: string | undefined,
): Promise<LabelRow[]> {
  if (!hasCapability(principal, 'tasks:read')) throw missingCapability('tasks:read');

  const scopes = await listScopes(db, principal);
  const allowed = scopes.map((s) => s.id).filter((id) => scopeId === undefined || id === scopeId);
  if (allowed.length === 0) return [];

  const rows = await sql<LabelRow>`
    SELECT id, scope_id, name, color, created_at FROM labels
    WHERE deleted_at IS NULL AND scope_id IN (${sql.join(allowed)})
    ORDER BY name, id
  `.execute(db);
  return rows.rows;
}

export async function createLabel(
  ctx: AuditContext,
  principal: Principal,
  input: { id?: string | undefined; scope_id?: string | undefined; name?: string | undefined; color?: string | undefined },
): Promise<{ label: LabelRow; created: boolean }> {
  if (!hasCapability(principal, 'tasks:write')) throw missingCapability('tasks:write');

  if (input.scope_id === undefined || input.scope_id === '') {
    throw new PolicyError(
      'scope-required',
      'Scope required',
      422,
      "Una etiqueta pertany a un àmbit: la mateixa paraula vol dir coses diferents a cada un.",
    );
  }
  if (input.name === undefined || input.name.trim() === '') {
    throw new PolicyError('name-required', 'Name required', 422, "L'etiqueta necessita un nom.");
  }
  await assertScopeAccess(ctx.tx, principal, input.scope_id);

  const name = input.name.trim();

  // La clau única és `(scope_id, name)`: reenviar la mateixa etiqueta torna la que hi ha
  // en comptes de petar amb una violació que el client no sabria interpretar.
  const existing = await sql<LabelRow>`
    SELECT id, scope_id, name, color, created_at FROM labels
    WHERE scope_id = ${input.scope_id} AND name = ${name} AND deleted_at IS NULL
  `.execute(ctx.tx);
  if (existing.rows[0] !== undefined) {
    ctx.noChange();
    return { label: existing.rows[0], created: false };
  }

  const id = input.id ?? uuidv7();
  await sql`
    INSERT INTO labels (id, scope_id, name, color, created_at)
    VALUES (${id}, ${input.scope_id}, ${name}, ${input.color ?? '--plou-blue'}, ${ctx.now})
  `.execute(ctx.tx);

  ctx.record({ entityType: 'label', entityId: id, scopeId: input.scope_id, verb: 'created' });

  const created = await sql<LabelRow>`
    SELECT id, scope_id, name, color, created_at FROM labels WHERE id = ${id}
  `.execute(ctx.tx);
  return { label: created.rows[0]!, created: true };
}

export async function deleteLabel(
  ctx: AuditContext,
  principal: Principal,
  id: string,
): Promise<void> {
  if (!hasCapability(principal, 'tasks:write')) throw missingCapability('tasks:write');

  const found = await sql<LabelRow>`
    SELECT id, scope_id, name, color, created_at FROM labels
    WHERE id = ${id} AND deleted_at IS NULL
  `.execute(ctx.tx);
  const label = found.rows[0];
  if (label === undefined) throw notFound('etiqueta', id);
  await assertScopeAccess(ctx.tx, principal, label.scope_id);

  // Els lligams sí que es treuen de debò: `task_labels` no és una entitat sincronitzable
  // amb identitat pròpia, és una relació. Deixar-la penjant faria que reaparegués si
  // algun dia es restaurés l'etiqueta.
  await sql`DELETE FROM task_labels WHERE label_id = ${id}`.execute(ctx.tx);
  await sql`UPDATE labels SET deleted_at = ${ctx.now} WHERE id = ${id}`.execute(ctx.tx);

  ctx.record({ entityType: 'label', entityId: id, scopeId: label.scope_id, verb: 'deleted' });
}

/** Les etiquetes d'un conjunt de tasques, per no fer una consulta per targeta. */
export async function labelsOfTasks(
  db: MigrationDb,
  taskIds: string[],
): Promise<Map<string, LabelRow[]>> {
  const byTask = new Map<string, LabelRow[]>();
  if (taskIds.length === 0) return byTask;

  const rows = await sql<LabelRow & { task_id: string }>`
    SELECT tl.task_id, l.id, l.scope_id, l.name, l.color, l.created_at
    FROM task_labels tl
    JOIN labels l ON l.id = tl.label_id AND l.deleted_at IS NULL
    WHERE tl.task_id IN (${sql.join(taskIds)})
    ORDER BY l.name, l.id
  `.execute(db);

  for (const row of rows.rows) {
    const { task_id: taskId, ...label } = row;
    const list = byTask.get(taskId) ?? [];
    list.push(label);
    byTask.set(taskId, list);
  }
  return byTask;
}

export async function setTaskLabel(
  ctx: AuditContext,
  principal: Principal,
  taskId: string,
  labelId: string,
  attached: boolean,
): Promise<void> {
  if (!hasCapability(principal, 'tasks:write')) throw missingCapability('tasks:write');

  const task = await sql<{ scope_id: string }>`
    SELECT scope_id FROM tasks WHERE id = ${taskId} AND deleted_at IS NULL
  `.execute(ctx.tx);
  const scopeId = task.rows[0]?.scope_id;
  if (scopeId === undefined) throw notFound('tasca', taskId);
  await assertScopeAccess(ctx.tx, principal, scopeId);

  const label = await sql<{ scope_id: string; name: string }>`
    SELECT scope_id, name FROM labels WHERE id = ${labelId} AND deleted_at IS NULL
  `.execute(ctx.tx);
  const found = label.rows[0];
  if (found === undefined) throw notFound('etiqueta', labelId);

  // Una etiqueta d'un altre àmbit no s'hi pot posar: seria l'única via per fer que dues
  // targetes de dos àmbits compartissin una etiqueta i trencaria la clau `(scope, name)`.
  if (found.scope_id !== scopeId) {
    throw new PolicyError(
      'label-other-scope',
      'Label from another scope',
      422,
      `L'etiqueta ${found.name} és d'un altre àmbit. Crea-la també en aquest.`,
    );
  }

  if (attached) {
    const already = await sql<{ n: number }>`
      SELECT COUNT(*) AS n FROM task_labels WHERE task_id = ${taskId} AND label_id = ${labelId}
    `.execute(ctx.tx);
    if (Number(already.rows[0]?.n ?? 0) > 0) {
      ctx.noChange();
      return;
    }
    await sql`
      INSERT INTO task_labels (task_id, label_id) VALUES (${taskId}, ${labelId})
    `.execute(ctx.tx);
  } else {
    const removed = await sql`
      DELETE FROM task_labels WHERE task_id = ${taskId} AND label_id = ${labelId}
    `.execute(ctx.tx);
    if (Number(removed.numAffectedRows ?? 0n) === 0) {
      ctx.noChange();
      return;
    }
  }

  ctx.record({
    entityType: 'task',
    entityId: taskId,
    scopeId,
    verb: 'updated',
    changes: { labels: { from: !attached, to: attached } },
  });
}
