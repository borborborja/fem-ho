/**
 * Tipologies de tasca: **en què** es va anar el temps.
 *
 * «Contingut», «Reunió», «Gravació». Serveixen per a una sola cosa —mesurar la dedicació per
 * mena de feina a les Estadístiques— i per això són **d'àmbit** i **tancades**.
 *
 * **NO SÓN ETIQUETES, I NO S'HI CONSTRUEIXEN A SOBRE**
 * ---------------------------------------------------
 * S'assemblen molt: totes dues són d'àmbit, tenen nom i color, i es pengen d'una tasca. La
 * diferència és el que en fa una cosa diferent:
 *
 * | | Etiqueta | Tipologia |
 * | --- | --- | --- |
 * | Quantes per tasca | les que vulguis | **una** |
 * | Qui en crea | qualsevol, des de la fitxa | **qui mana a l'àmbit** |
 * | Pot ser obligatòria | no | **sí** |
 *
 * Amb una sola taula, «quantes n'hi pot haver» dependria d'un indicador i cada lloc que les
 * toca hauria de preguntar-s'ho. I l'historial no en guardaria quina hi havia abans: avui
 * `setTaskLabel` registra dos booleans i no diu **quina** etiqueta, cosa que en una
 * classificació que es factura seria un forat.
 */

import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import type { AuditContext } from '../audit/audited-transaction.js';
import type { MigrationDb } from '../db/migration-db.js';
import { PolicyError, missingCapability, notFound } from '../policy/errors.js';
import { hasCapability, type Principal } from '../policy/principal.js';
import { assertScopeRole, listScopes } from './scopes.js';

export interface TaskTypeRow {
  id: string;
  scope_id: string;
  name: string;
  color: string;
  position: string;
}

const COLUMNS = sql`id, scope_id, name, color, position`;

/** Les tipologies dels àmbits visibles, en l'ordre que hi hagi posat qui mana. */
export async function listTaskTypes(
  db: MigrationDb,
  principal: Principal,
  scopeId?: string | undefined,
): Promise<TaskTypeRow[]> {
  if (!hasCapability(principal, 'tasks:read')) throw missingCapability('tasks:read');

  const scopes = await listScopes(db, principal);
  const allowed = scopes.map((s) => s.id).filter((id) => scopeId === undefined || id === scopeId);
  if (allowed.length === 0) return [];

  const rows = await sql<TaskTypeRow>`
    SELECT ${COLUMNS} FROM task_types
    WHERE deleted_at IS NULL AND scope_id IN (${sql.join(allowed)})
    ORDER BY position, name
  `.execute(db);
  return rows.rows;
}

/**
 * Crea'n una.
 *
 * **Només qui pot els ajustos de l'àmbit**, i és tota la diferència amb una etiqueta: un
 * vocabulari que qualsevol pot ampliar des de la fitxa deixa de ser un vocabulari als tres
 * dies, i les Estadístiques per tipologia deixen de dir res.
 */
export async function createTaskType(
  ctx: AuditContext,
  principal: Principal,
  input: {
    scope_id?: string | undefined;
    name?: string | undefined;
    color?: string | undefined;
    position?: string | undefined;
  },
): Promise<TaskTypeRow> {
  if (!hasCapability(principal, 'tasks:write')) throw missingCapability('tasks:write');

  const scopeId = input.scope_id ?? '';
  if (scopeId === '') {
    throw new PolicyError(
      'scope-required',
      'Scope required',
      422,
      'A task type belongs to a scope: say which one.',
    );
  }
  await assertScopeRole(ctx.tx, principal, scopeId, 'settings');

  const name = (input.name ?? '').trim();
  if (name === '') {
    throw new PolicyError('name-required', 'Name required', 422, 'A task type needs a name.');
  }

  // Idempotent pel nom, com les etiquetes: crear dues vegades «Contingut» a la mateixa
  // pantalla és un doble clic, no una intenció.
  const ja = await sql<TaskTypeRow>`
    SELECT ${COLUMNS} FROM task_types
    WHERE scope_id = ${scopeId} AND name = ${name} AND deleted_at IS NULL
  `.execute(ctx.tx);
  const existent = ja.rows[0];
  if (existent !== undefined) {
    ctx.noChange();
    return existent;
  }

  const id = uuidv7();
  const row: TaskTypeRow = {
    id,
    scope_id: scopeId,
    name,
    color: input.color ?? '--plou-blue',
    position: input.position ?? 'm',
  };

  await sql`
    INSERT INTO task_types (id, scope_id, name, color, position, created_at, updated_at)
    VALUES (${id}, ${scopeId}, ${name}, ${row.color}, ${row.position}, ${ctx.now}, ${ctx.now})
  `.execute(ctx.tx);

  ctx.record({
    entityType: 'task_type',
    entityId: id,
    scopeId,
    verb: 'created',
    changes: { name: { from: null, to: name } },
  });

  return row;
}

export async function updateTaskType(
  ctx: AuditContext,
  principal: Principal,
  id: string,
  input: { name?: string | undefined; color?: string | undefined; position?: string | undefined },
): Promise<TaskTypeRow> {
  if (!hasCapability(principal, 'tasks:write')) throw missingCapability('tasks:write');

  const found = await sql<TaskTypeRow>`
    SELECT ${COLUMNS} FROM task_types WHERE id = ${id} AND deleted_at IS NULL
  `.execute(ctx.tx);
  const abans = found.rows[0];
  if (abans === undefined) throw notFound('task_type', id);
  await assertScopeRole(ctx.tx, principal, abans.scope_id, 'settings');

  const despres: TaskTypeRow = {
    ...abans,
    name: input.name === undefined ? abans.name : input.name.trim(),
    color: input.color ?? abans.color,
    position: input.position ?? abans.position,
  };
  if (despres.name === '') {
    throw new PolicyError('name-required', 'Name required', 422, 'A task type needs a name.');
  }

  await sql`
    UPDATE task_types SET name = ${despres.name}, color = ${despres.color},
                          position = ${despres.position}, updated_at = ${ctx.now}
    WHERE id = ${id}
  `.execute(ctx.tx);

  ctx.record({
    entityType: 'task_type',
    entityId: id,
    scopeId: abans.scope_id,
    verb: 'updated',
    changes: { name: { from: abans.name, to: despres.name } },
  });

  return despres;
}

/**
 * Esborra'n una.
 *
 * **La feina feta no es toca**: les tasques que la portaven es queden sense tipologia
 * —`ON DELETE SET NULL` a l'esquema— i el que ja hi ha registrat segueix comptant a les
 * Estadístiques sota «Sense tipologia». Esborrar una manera de classificar no ha de fer
 * desaparèixer les hores classificades.
 */
export async function deleteTaskType(
  ctx: AuditContext,
  principal: Principal,
  id: string,
): Promise<void> {
  if (!hasCapability(principal, 'tasks:write')) throw missingCapability('tasks:write');

  const found = await sql<TaskTypeRow>`
    SELECT ${COLUMNS} FROM task_types WHERE id = ${id} AND deleted_at IS NULL
  `.execute(ctx.tx);
  const tipus = found.rows[0];
  if (tipus === undefined) throw notFound('task_type', id);
  await assertScopeRole(ctx.tx, principal, tipus.scope_id, 'settings');

  await sql`UPDATE tasks SET task_type_id = ${null} WHERE task_type_id = ${id}`.execute(ctx.tx);
  await sql`
    UPDATE task_types SET deleted_at = ${ctx.now}, updated_at = ${ctx.now} WHERE id = ${id}
  `.execute(ctx.tx);

  ctx.record({
    entityType: 'task_type',
    entityId: id,
    scopeId: tipus.scope_id,
    verb: 'deleted',
    changes: { name: { from: tipus.name, to: null } },
  });
}

/**
 * Comprova que la tipologia que es vol posar a una tasca sigui **d'aquell àmbit**.
 *
 * Una tipologia d'un altre àmbit posada a una tasca faria que les Estadístiques d'un àmbit
 * comptessin hores d'un altre, que és pitjor que un error.
 */
export async function assertTypeInScope(
  db: MigrationDb,
  scopeId: string,
  taskTypeId: string,
): Promise<void> {
  const found = await sql<{ scope_id: string; name: string }>`
    SELECT scope_id, name FROM task_types WHERE id = ${taskTypeId} AND deleted_at IS NULL
  `.execute(db);
  const tipus = found.rows[0];
  if (tipus === undefined) throw notFound('task_type', taskTypeId);
  if (tipus.scope_id !== scopeId) {
    throw new PolicyError(
      'type-other-scope',
      'Type from another scope',
      422,
      `The task type ${tipus.name} belongs to another scope. Create it in this one too.`,
      { name: tipus.name },
    );
  }
}
