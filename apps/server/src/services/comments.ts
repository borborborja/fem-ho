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
import { clearAttention, raiseAttention } from './attention.js';
import { releaseIfHeld } from './leases.js';
import { assertScopeAccess } from './scopes.js';

export interface Comment {
  id: string;
  task_id: string;
  author_id: string | null;
  /**
   * Quin agent ho ha dit, si ho ha dit un agent.
   *
   * Un agent actua **en nom d'una persona** (D5), o sigui que `author_id` és la persona.
   * Sense aquesta columna, saber qui parla a la conversa de la pestanya IA voldria dir
   * mirar si l'etiqueta comença per «IA · », que és endevinar-ho pel nom.
   */
  agent_id: string | null;
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
      'An empty comment says nothing: write the reason in it.',
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
    INSERT INTO comments (id, task_id, author_id, author_agent_id, guest_name, body,
                          created_at, updated_at)
    VALUES (${id}, ${taskId}, ${principal.userId}, ${principal.agentId ?? null},
            ${principal.label ?? null}, ${body.trim()}, ${ctx.now}, ${ctx.now})
  `.execute(ctx.tx);

  /**
   * **Respondre baixa la marca d'atenció.** No hi ha cap botó de «vist»: el que desencalla
   * l'agent és la resposta, i marcar-ho com a vist deixaria la pantalla neta amb l'agent
   * esperant per sempre. Ho fa només una persona —un agent que comenta segueix parlant
   * sol— i queda dit a l'historial perquè es pugui llegir per què va marxar.
   */
  if (principal.kind === 'user' && (await clearAttention(ctx, taskId))) {
    ctx.record({
      entityType: 'task',
      entityId: taskId,
      scopeId: row.scope_id,
      verb: 'answered',
    });
  }

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
    agent_id: principal.agentId ?? null,
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
    SELECT id, task_id, author_id, author_agent_id AS agent_id, guest_name, body,
           created_at, updated_at
    FROM comments WHERE task_id = ${taskId} AND deleted_at IS NULL
    ORDER BY created_at
  `.execute(db);
  return found.rows;
}

/**
 * L'agent pregunta i **es queda esperant**.
 *
 * És `addComment` amb conseqüència, i és a posta: la pregunta ha de sortir a l'historial
 * i a la conversa com tota la resta —un canal separat voldria dir un lloc més on mirar—,
 * i el que hi afegeix és que la tasca passi a demanar atenció.
 *
 * **Només un agent.** Una persona que té un dubte no s'ho pregunta a ella mateixa: la
 * marca vol dir «un agent espera una resposta teva», i si la pogués aixecar qualsevol
 * deixaria de voler dir això.
 */
export async function askUser(
  ctx: AuditContext,
  principal: Principal,
  taskId: string,
  question: string,
): Promise<Comment> {
  if (principal.kind !== 'agent') {
    throw new PolicyError(
      'not-an-agent',
      'Not an agent',
      403,
      'Only an agent can ask for attention: the mark means an agent is waiting for you.',
    );
  }

  const comment = await addComment(ctx, principal, taskId, question);

  const task = await sql<{ scope_id: string }>`
    SELECT scope_id FROM tasks WHERE id = ${taskId}
  `.execute(ctx.tx);

  await raiseAttention(ctx, taskId);

  /**
   * **Preguntar desbloqueja.** Un agent que espera no està treballant, i mentre la reserva
   * visqui ningú pot respondre-li ni endur-se la tasca: el pany voldria dir «hi ha algú a
   * dins» quan el que hi ha és algú esperant a fora.
   */
  await releaseIfHeld(ctx, taskId, 'Espera resposta de la persona.');

  ctx.record({
    entityType: 'task',
    entityId: taskId,
    scopeId: task.rows[0]?.scope_id ?? null,
    verb: 'asked',
  });

  return comment;
}
