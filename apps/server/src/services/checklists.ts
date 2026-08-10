/**
 * Servei de llistes senzilles. P1 de docs/14, docs/01 §4.
 *
 * NI SUBPROJECTE NI SUBTASCA: DUES TAULES I UN FLAG DE PRESENTACIÓ
 * ----------------------------------------------------------------
 * El brief dubtava: *"Estic pensant que lo de les subtasques de dins d'un projecte xoca
 * amb que la llista sigui com un subprojecte."* La resolució de P1 és cap de les dues.
 *
 * Una `checklist` pertany **sempre** a una tasca i opcionalment s'ancora a una subtasca.
 * Un `checklist_item` **només té text i fet/no fet**: cap data, cap assignat, cap
 * niuament. La contenció és deliberada i ve de Things 3 — és exactament el que fa que la
 * llista d'avui es mantingui neta i no es converteixi en un segon gestor de tasques dins
 * del gestor de tasques. La riquesa va al CONTENIDOR: la llista es pot pinejar i
 * compartir.
 *
 * LA CASCADA AMUNT
 * -----------------
 * Un dossier de research la prohibia explícitament; **mana el brief**, que la demana:
 * *"aquestes llistes son vives, quan marques un element de la llista com a fet es marca
 * la subtasca i quan tota la llista esta completa es marca com a feta la tasca o la
 * subtasca de la qual es deriva"*.
 *
 * Va tota dins de la MATEIXA transacció i es registra amb `verb='cascade_complete'`,
 * per distingir-la d'un gest directe de l'usuari a l'historial.
 */

import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { generatePosition } from '@fem-ho/contracts';
import { dbBool, isTrue } from '../db/bool.js';
import type { AuditContext } from '../audit/audited-transaction.js';
import type { MigrationDb } from '../db/migration-db.js';
import { PolicyError, missingCapability, notFound } from '../policy/errors.js';
import { hasCapability, type Principal } from '../policy/principal.js';
import { assertScopeAccess } from './scopes.js';

export interface ChecklistItemRow {
  id: string;
  checklist_id: string;
  text: string;
  done: number;
  done_at: string | null;
  done_by: string | null;
  position: string;
}

export interface ChecklistRow {
  id: string;
  task_id: string;
  subtask_id: string | null;
  name: string;
  pinned: number;
  pinned_by: string | null;
  show_completed_inline: number;
  position: string;
  version: number;
}

export interface ChecklistView {
  id: string;
  task_id: string;
  subtask_id: string | null;
  name: string;
  pinned: boolean;
  show_completed_inline: boolean;
  position: string;
  items: {
    id: string;
    checklist_id: string;
    text: string;
    done: boolean;
    done_at: string | null;
    done_by: string | null;
    position: string;
  }[];
  version: number;
}

function toView(row: ChecklistRow, items: ChecklistItemRow[], principal: Principal): ChecklistView {
  return {
    id: row.id,
    task_id: row.task_id,
    subtask_id: row.subtask_id,
    // El pinejat és PER USUARI: la llista només surt pinejada per a qui la va pinejar.
    pinned: isTrue(row.pinned) && row.pinned_by === principal.userId,
    name: row.name,
    show_completed_inline: isTrue(row.show_completed_inline),
    position: row.position,
    items: items.map((item) => ({
      id: item.id,
      checklist_id: item.checklist_id,
      text: item.text,
      done: isTrue(item.done),
      done_at: item.done_at,
      done_by: item.done_by,
      position: item.position,
    })),
    version: row.version,
  };
}

async function itemsOf(
  db: MigrationDb,
  checklistIds: string[],
): Promise<Map<string, ChecklistItemRow[]>> {
  if (checklistIds.length === 0) return new Map();
  const rows = await sql<ChecklistItemRow>`
    SELECT id, checklist_id, text, done, done_at, done_by, position
    FROM checklist_items
    WHERE deleted_at IS NULL AND checklist_id IN (${sql.join(checklistIds)})
    ORDER BY position, id
  `.execute(db);

  const byList = new Map<string, ChecklistItemRow[]>();
  for (const item of rows.rows) {
    const list = byList.get(item.checklist_id) ?? [];
    list.push(item);
    byList.set(item.checklist_id, list);
  }
  return byList;
}

/** La tasca d'una llista, amb el seu àmbit, per poder comprovar l'accés. */
async function taskOfChecklist(
  db: MigrationDb,
  checklistId: string,
): Promise<{ checklist: ChecklistRow; taskId: string; scopeId: string }> {
  const found = await sql<ChecklistRow & { scope_id: string }>`
    SELECT c.id, c.task_id, c.subtask_id, c.name, c.pinned, c.pinned_by,
           c.show_completed_inline, c.position, c.version, t.scope_id
    FROM checklists c
    JOIN tasks t ON t.id = c.task_id
    WHERE c.id = ${checklistId} AND c.deleted_at IS NULL AND t.deleted_at IS NULL
  `.execute(db);

  const row = found.rows[0];
  if (row === undefined) throw notFound('checklist', checklistId);
  return { checklist: row, taskId: row.task_id, scopeId: row.scope_id };
}

export async function listChecklists(
  db: MigrationDb,
  principal: Principal,
  taskId: string,
): Promise<ChecklistView[]> {
  if (!hasCapability(principal, 'checklists:read')) throw missingCapability('checklists:read');

  const task = await sql<{ scope_id: string }>`
    SELECT scope_id FROM tasks WHERE id = ${taskId} AND deleted_at IS NULL
  `.execute(db);
  const scopeId = task.rows[0]?.scope_id;
  if (scopeId === undefined) throw notFound('task', taskId);
  await assertScopeAccess(db, principal, scopeId, { type: 'La tasca', id: taskId });

  const rows = await sql<ChecklistRow>`
    SELECT id, task_id, subtask_id, name, pinned, pinned_by, show_completed_inline,
           position, version
    FROM checklists WHERE task_id = ${taskId} AND deleted_at IS NULL ORDER BY position, id
  `.execute(db);

  const items = await itemsOf(
    db,
    rows.rows.map((r) => r.id),
  );
  return rows.rows.map((row) => toView(row, items.get(row.id) ?? [], principal));
}

export async function listPinnedChecklists(
  db: MigrationDb,
  principal: Principal,
): Promise<(ChecklistView & { task_title: string })[]> {
  if (!hasCapability(principal, 'checklists:read')) throw missingCapability('checklists:read');

  /**
   * **El títol de la tasca ve amb la llista.**
   *
   * El menú de la xinxeta ensenya "Tasca · Llista", com els dos prototips: dues llistes
   * que es diguin "Encàrrecs" en tasques diferents són indistingibles pel nom, i el menú
   * existeix precisament per saltar a la que toca. El `JOIN` ja hi era per comprovar que
   * la tasca no estigui esborrada; només calia demanar-ne el títol.
   */
  const rows = await sql<ChecklistRow & { task_title: string }>`
    SELECT c.id, c.task_id, c.subtask_id, c.name, c.pinned, c.pinned_by,
           c.show_completed_inline, c.position, c.version, t.title AS task_title
    FROM checklists c
    JOIN tasks t ON t.id = c.task_id
    WHERE c.deleted_at IS NULL AND t.deleted_at IS NULL
      AND c.pinned = ${dbBool(true)} AND c.pinned_by = ${principal.userId}
    ORDER BY c.position
  `.execute(db);

  const items = await itemsOf(
    db,
    rows.rows.map((r) => r.id),
  );
  return rows.rows.map((row) => ({
    ...toView(row, items.get(row.id) ?? [], principal),
    task_title: row.task_title,
  }));
}

export async function createChecklist(
  ctx: AuditContext,
  principal: Principal,
  taskId: string,
  input: {
    id?: string | undefined;
    name?: string | undefined;
    subtask_id?: string | undefined;
    show_completed_inline?: boolean | undefined;
  },
): Promise<ChecklistView> {
  if (!hasCapability(principal, 'checklists:write')) throw missingCapability('checklists:write');
  if (input.name === undefined || input.name.trim() === '') {
    throw new PolicyError('name-required', 'Name required', 422, 'La llista necessita un nom.');
  }

  const task = await sql<{ scope_id: string }>`
    SELECT scope_id FROM tasks WHERE id = ${taskId} AND deleted_at IS NULL
  `.execute(ctx.tx);
  const scopeId = task.rows[0]?.scope_id;
  if (scopeId === undefined) throw notFound('task', taskId);
  await assertScopeAccess(ctx.tx, principal, scopeId, { type: 'La tasca', id: taskId });

  const id = input.id ?? uuidv7();
  const last = await sql<{ position: string }>`
    SELECT position FROM checklists WHERE task_id = ${taskId} AND deleted_at IS NULL
    ORDER BY position DESC, id DESC LIMIT 1
  `.execute(ctx.tx);

  await sql`
    INSERT INTO checklists (id, task_id, subtask_id, name, pinned, show_completed_inline,
                            position, created_at, updated_at, version)
    VALUES (${id}, ${taskId}, ${input.subtask_id ?? null}, ${input.name.trim()}, ${dbBool(false)},
            ${dbBool(input.show_completed_inline !== false)},
            ${generatePosition(last.rows[0]?.position ?? null, null)}, ${ctx.now}, ${ctx.now}, 1)
  `.execute(ctx.tx);

  ctx.record({ entityType: 'checklist', entityId: id, scopeId, verb: 'created' });

  const created = await sql<ChecklistRow>`
    SELECT id, task_id, subtask_id, name, pinned, pinned_by, show_completed_inline,
           position, version FROM checklists WHERE id = ${id}
  `.execute(ctx.tx);
  const row = created.rows[0];
  if (row === undefined) throw notFound('checklist', id);
  return toView(row, [], principal);
}

export async function createChecklistItem(
  ctx: AuditContext,
  principal: Principal,
  checklistId: string,
  input: { id?: string | undefined; text?: string | undefined; position?: string | undefined },
): Promise<ChecklistItemView> {
  if (!hasCapability(principal, 'checklists:write')) throw missingCapability('checklists:write');
  if (input.text === undefined || input.text.trim() === '') {
    throw new PolicyError('text-required', 'Text required', 422, 'The item needs text.');
  }

  const { scopeId } = await taskOfChecklist(ctx.tx, checklistId);
  await assertScopeAccess(ctx.tx, principal, scopeId);

  const id = input.id ?? uuidv7();
  const last = await sql<{ position: string }>`
    SELECT position FROM checklist_items WHERE checklist_id = ${checklistId} AND deleted_at IS NULL
    ORDER BY position DESC, id DESC LIMIT 1
  `.execute(ctx.tx);

  await sql`
    INSERT INTO checklist_items (id, checklist_id, text, done, position, created_at, updated_at, version)
    VALUES (${id}, ${checklistId}, ${input.text.trim()}, ${dbBool(false)},
            ${input.position ?? generatePosition(last.rows[0]?.position ?? null, null)},
            ${ctx.now}, ${ctx.now}, 1)
  `.execute(ctx.tx);

  ctx.record({ entityType: 'checklist_item', entityId: id, scopeId, verb: 'created' });

  const created = await sql<ChecklistItemRow>`
    SELECT id, checklist_id, text, done, done_at, done_by, position
    FROM checklist_items WHERE id = ${id}
  `.execute(ctx.tx);
  const row = created.rows[0];
  if (row === undefined) throw notFound('item', id);
  return toItemView(row);
}

/**
 * L'ítem tal com surt per l'API.
 *
 * **`done` és un booleà de veritat.** La fila de la base porta 0/1 —a Postgres i a
 * SQLite per igual, perquè el conversor de `connection.ts` ho normalitza en llegir— i
 * `GET /tasks/{id}/checklists` ja el convertia, però `POST .../items` i `PATCH
 * /checklist-items/{id}` tornaven la fila crua. El mateix camp sortia com a `0` per una
 * banda i com a `false` per l'altra, i un client que fes `if (item.done)` es comportava
 * diferent segons d'on hagués vingut l'ítem.
 */
export interface ChecklistItemView {
  id: string;
  checklist_id: string;
  text: string;
  done: boolean;
  done_at: string | null;
  done_by: string | null;
  position: string;
}

function toItemView(row: ChecklistItemRow): ChecklistItemView {
  return {
    id: row.id,
    checklist_id: row.checklist_id,
    text: row.text,
    done: isTrue(row.done),
    done_at: row.done_at,
    done_by: row.done_by,
    position: row.position,
  };
}

export interface CascadeResult {
  checklist_completed: boolean;
  subtask_completed: boolean;
  task_completed: boolean;
  suggest_unpin: boolean;
}

/**
 * Marca o desmarca un ítem, i aplica **la cascada amunt**.
 *
 * Tot passa dins de la mateixa transacció que la crida: si la cascada fallés, l'ítem
 * tampoc quedaria marcat, i mai es veuria una llista sencera feta amb la tasca oberta.
 */
export async function updateChecklistItem(
  ctx: AuditContext,
  principal: Principal,
  itemId: string,
  input: { text?: string | undefined; done?: boolean | undefined; position?: string | undefined },
): Promise<{ item: ChecklistItemView; cascade: CascadeResult }> {
  if (!hasCapability(principal, 'checklists:write')) throw missingCapability('checklists:write');

  const found = await sql<ChecklistItemRow>`
    SELECT id, checklist_id, text, done, done_at, done_by, position
    FROM checklist_items WHERE id = ${itemId} AND deleted_at IS NULL
  `.execute(ctx.tx);
  const item = found.rows[0];
  if (item === undefined) throw notFound('item', itemId);

  const { checklist, taskId, scopeId } = await taskOfChecklist(ctx.tx, item.checklist_id);
  await assertScopeAccess(ctx.tx, principal, scopeId);

  const done = input.done ?? isTrue(item.done);

  await sql`
    UPDATE checklist_items SET
      text = COALESCE(${input.text ?? null}, text),
      position = COALESCE(${input.position ?? null}, position),
      done = ${dbBool(done)},
      done_at = ${done ? ctx.now : null},
      done_by = ${done ? principal.userId : null},
      updated_at = ${ctx.now},
      version = version + 1
    WHERE id = ${itemId}
  `.execute(ctx.tx);

  ctx.record({
    entityType: 'checklist_item',
    entityId: itemId,
    scopeId,
    verb: done ? 'completed' : 'reopened',
    changes: { done: { from: isTrue(item.done), to: done } },
  });

  const cascade = await applyCascade(ctx, principal, checklist, taskId, scopeId);
  const updated = await sql<ChecklistItemRow>`
    SELECT id, checklist_id, text, done, done_at, done_by, position
    FROM checklist_items WHERE id = ${itemId}
  `.execute(ctx.tx);

  return { item: toItemView(updated.rows[0]!), cascade };
}

/**
 * La cascada amunt: llista → subtasca ancorada → tasca.
 *
 * Cada pas es registra amb `verb='cascade_complete'`, que és el que distingeix "això ho
 * ha fet el sistema perquè tot el que hi havia a sota estava fet" de "això ho ha marcat
 * una persona". A l'historial, la diferència importa.
 */
async function applyCascade(
  ctx: AuditContext,
  principal: Principal,
  checklist: ChecklistRow,
  taskId: string,
  scopeId: string,
): Promise<CascadeResult> {
  const result: CascadeResult = {
    checklist_completed: false,
    subtask_completed: false,
    task_completed: false,
    suggest_unpin: false,
  };

  const pending = await sql<{ n: number }>`
    SELECT COUNT(*) AS n FROM checklist_items
    WHERE checklist_id = ${checklist.id} AND deleted_at IS NULL AND done = ${dbBool(false)}
  `.execute(ctx.tx);
  const total = await sql<{ n: number }>`
    SELECT COUNT(*) AS n FROM checklist_items
    WHERE checklist_id = ${checklist.id} AND deleted_at IS NULL
  `.execute(ctx.tx);

  // Una llista buida no està "completa": no hi ha res a completar-hi.
  const complete = Number(total.rows[0]?.n ?? 0) > 0 && Number(pending.rows[0]?.n ?? 0) === 0;
  result.checklist_completed = complete;

  if (!complete) return result;

  // Quan una llista PINEJADA es completa del tot, es pregunta si es vol despinejar (P1).
  // Es proposa, no es fa: despinejar-la sola seria decidir per l'usuari.
  result.suggest_unpin = isTrue(checklist.pinned) && checklist.pinned_by === principal.userId;

  // Pas 1: la subtasca ancorada, si n'hi ha.
  if (checklist.subtask_id !== null) {
    const others = await sql<{ n: number }>`
      SELECT COUNT(*) AS n FROM checklists c
      WHERE c.subtask_id = ${checklist.subtask_id} AND c.deleted_at IS NULL
        AND EXISTS (SELECT 1 FROM checklist_items i
                    WHERE i.checklist_id = c.id AND i.deleted_at IS NULL AND i.done = ${dbBool(false)})
    `.execute(ctx.tx);

    if (Number(others.rows[0]?.n ?? 0) === 0) {
      await sql`
        UPDATE subtasks SET done = ${dbBool(true)}, updated_at = ${ctx.now}, version = version + 1
        WHERE id = ${checklist.subtask_id} AND done = ${dbBool(false)}
      `.execute(ctx.tx);

      result.subtask_completed = true;
      ctx.record({
        entityType: 'subtask',
        entityId: checklist.subtask_id,
        scopeId,
        verb: 'cascade_complete',
      });
    }
  }

  // Pas 2: la tasca, si TOTES les seves llistes i subtasques estan fetes.
  const pendingSubtasks = await sql<{ n: number }>`
    SELECT COUNT(*) AS n FROM subtasks
    WHERE task_id = ${taskId} AND deleted_at IS NULL AND done = ${dbBool(false)}
  `.execute(ctx.tx);
  const pendingLists = await sql<{ n: number }>`
    SELECT COUNT(*) AS n FROM checklists c
    WHERE c.task_id = ${taskId} AND c.deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM checklist_items i
                  WHERE i.checklist_id = c.id AND i.deleted_at IS NULL AND i.done = ${dbBool(false)})
  `.execute(ctx.tx);

  if (Number(pendingSubtasks.rows[0]?.n ?? 0) === 0 && Number(pendingLists.rows[0]?.n ?? 0) === 0) {
    const task = await sql<{ status: string }>`
      SELECT status FROM tasks WHERE id = ${taskId}
    `.execute(ctx.tx);

    if (task.rows[0]?.status !== 'done') {
      await sql`
        UPDATE tasks SET status = 'done', completed_at = ${ctx.now}, updated_at = ${ctx.now},
                         version = version + 1
        WHERE id = ${taskId}
      `.execute(ctx.tx);

      result.task_completed = true;
      ctx.record({
        entityType: 'task',
        entityId: taskId,
        scopeId,
        verb: 'cascade_complete',
        changes: { status: { from: task.rows[0]?.status ?? 'inbox', to: 'done' } },
      });
    }
  }

  return result;
}

export async function setPinned(
  ctx: AuditContext,
  principal: Principal,
  checklistId: string,
  pinned: boolean,
): Promise<void> {
  if (!hasCapability(principal, 'checklists:write')) throw missingCapability('checklists:write');

  const { scopeId } = await taskOfChecklist(ctx.tx, checklistId);
  await assertScopeAccess(ctx.tx, principal, scopeId);

  await sql`
    UPDATE checklists SET pinned = ${dbBool(pinned)},
                          pinned_by = ${pinned ? principal.userId : null},
                          updated_at = ${ctx.now}, version = version + 1
    WHERE id = ${checklistId}
  `.execute(ctx.tx);

  ctx.record({
    entityType: 'checklist',
    entityId: checklistId,
    scopeId,
    verb: 'updated',
    changes: { pinned: { from: !pinned, to: pinned } },
  });
}

/**
 * Una llista sola, amb els seus ítems.
 *
 * És el que necessita la vista de llista senzilla (docs/02 §6), que hi arriba des del
 * desplegable de projectes i no des d'una tasca: demanar-la per tasca obligaria la
 * interfície a saber de quina tasca penja abans de poder-la ensenyar.
 */
export async function getChecklist(
  db: MigrationDb,
  principal: Principal,
  checklistId: string,
): Promise<ChecklistView & { task_title: string }> {
  if (!hasCapability(principal, 'checklists:read')) throw missingCapability('checklists:read');

  const { checklist, taskId, scopeId } = await taskOfChecklist(db, checklistId);
  await assertScopeAccess(db, principal, scopeId);

  const items = await itemsOf(db, [checklistId]);
  const task = await sql<{ title: string }>`SELECT title FROM tasks WHERE id = ${taskId}`.execute(
    db,
  );

  // El títol de la tasca hi va perquè la vista de llista el pinta com a molla de pa
  // clicable (docs/02 §6), i una segona crida per a un sol camp és una segona fallada.
  return {
    ...toView(checklist, items.get(checklistId) ?? [], principal),
    task_title: task.rows[0]?.title ?? '',
  };
}

export async function updateChecklist(
  ctx: AuditContext,
  principal: Principal,
  checklistId: string,
  input: {
    name?: string | undefined;
    show_completed_inline?: boolean | undefined;
    subtask_id?: string | null | undefined;
    position?: string | undefined;
  },
): Promise<ChecklistView> {
  if (!hasCapability(principal, 'checklists:write')) throw missingCapability('checklists:write');

  const { checklist, scopeId } = await taskOfChecklist(ctx.tx, checklistId);
  await assertScopeAccess(ctx.tx, principal, scopeId);

  if (input.name !== undefined && input.name.trim() === '') {
    throw new PolicyError('name-required', 'Name required', 422, 'La llista necessita un nom.');
  }

  const name = input.name?.trim() ?? checklist.name;
  const inline = input.show_completed_inline ?? isTrue(checklist.show_completed_inline);
  const subtaskId = input.subtask_id === undefined ? checklist.subtask_id : input.subtask_id;
  const position = input.position ?? checklist.position;

  const igual =
    name === checklist.name &&
    inline === isTrue(checklist.show_completed_inline) &&
    subtaskId === checklist.subtask_id &&
    position === checklist.position;
  if (igual) {
    ctx.noChange();
    const items = await itemsOf(ctx.tx, [checklistId]);
    return toView(checklist, items.get(checklistId) ?? [], principal);
  }

  await sql`
    UPDATE checklists SET name = ${name}, show_completed_inline = ${dbBool(inline)},
                          subtask_id = ${subtaskId}, position = ${position},
                          updated_at = ${ctx.now}, version = version + 1
    WHERE id = ${checklistId}
  `.execute(ctx.tx);

  ctx.record({
    entityType: 'checklist',
    entityId: checklistId,
    scopeId,
    verb: 'updated',
    changes: { name: { from: checklist.name, to: name } },
  });

  const after = await taskOfChecklist(ctx.tx, checklistId);
  const items = await itemsOf(ctx.tx, [checklistId]);
  return toView(after.checklist, items.get(checklistId) ?? [], principal);
}

export async function deleteChecklist(
  ctx: AuditContext,
  principal: Principal,
  checklistId: string,
): Promise<void> {
  if (!hasCapability(principal, 'checklists:write')) throw missingCapability('checklists:write');

  const { scopeId } = await taskOfChecklist(ctx.tx, checklistId);
  await assertScopeAccess(ctx.tx, principal, scopeId);

  // Els ítems cauen amb la llista: no existeixen fora d'ella (P1).
  await sql`
    UPDATE checklist_items SET deleted_at = ${ctx.now}, updated_at = ${ctx.now},
                               version = version + 1
    WHERE checklist_id = ${checklistId} AND deleted_at IS NULL
  `.execute(ctx.tx);
  await sql`
    UPDATE checklists SET deleted_at = ${ctx.now}, updated_at = ${ctx.now}, version = version + 1
    WHERE id = ${checklistId}
  `.execute(ctx.tx);

  ctx.record({ entityType: 'checklist', entityId: checklistId, scopeId, verb: 'deleted' });
}

export async function deleteChecklistItem(
  ctx: AuditContext,
  principal: Principal,
  itemId: string,
): Promise<void> {
  if (!hasCapability(principal, 'checklists:write')) throw missingCapability('checklists:write');

  const found = await sql<ChecklistItemRow>`
    SELECT id, checklist_id, text, done, done_at, done_by, position
    FROM checklist_items WHERE id = ${itemId} AND deleted_at IS NULL
  `.execute(ctx.tx);
  const item = found.rows[0];
  if (item === undefined) throw notFound('item', itemId);

  const { scopeId } = await taskOfChecklist(ctx.tx, item.checklist_id);
  await assertScopeAccess(ctx.tx, principal, scopeId);

  await sql`
    UPDATE checklist_items SET deleted_at = ${ctx.now}, updated_at = ${ctx.now},
                               version = version + 1
    WHERE id = ${itemId}
  `.execute(ctx.tx);

  ctx.record({ entityType: 'checklist_item', entityId: itemId, scopeId, verb: 'deleted' });
}
