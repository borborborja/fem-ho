/**
 * Agents d'IA. docs/09, D5.
 *
 * **Delegar no és assignar.** `delegate_agent_id` i `assignee_id` són camps diferents i
 * cap substitueix l'altre: una tasca delegada a un agent segueix sent responsabilitat
 * d'una persona, i és `on_behalf_of_user_id` qui diu de quina.
 *
 * L'agent no és un usuari. L'usuari `kind='ai'` de la migració 004 és l'*actor* del
 * registre; l'agent és la *identitat de delegació*. Barrejar-los faria que revocar un
 * agent esborrés els comentaris que havia escrit.
 */

import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import type { AuditContext } from '../audit/audited-transaction.js';
import { dbBool, isTrue } from '../db/bool.js';
import { AI_USER_ID } from '../db/migrations/004-ai-user.js';
import type { MigrationDb } from '../db/migration-db.js';
import { PolicyError, missingCapability, notFound } from '../policy/errors.js';
import { hasCapability, type Principal } from '../policy/principal.js';

export interface AgentView {
  id: string;
  name: string;
  on_behalf_of_user_id: string;
  actor_user_id: string;
  can_create_tasks: boolean;
  enabled: boolean;
  created_at: string;
  version: number;
}

interface AgentRow {
  id: string;
  name: string;
  on_behalf_of_user_id: string;
  actor_user_id: string;
  can_create_tasks: unknown;
  enabled: unknown;
  created_at: string;
  version: number;
}

const AGENT_COLUMNS = sql`
  id, name, on_behalf_of_user_id, actor_user_id, can_create_tasks, enabled, created_at, version
`;

function toView(row: AgentRow): AgentView {
  return {
    id: row.id,
    name: row.name,
    on_behalf_of_user_id: row.on_behalf_of_user_id,
    actor_user_id: row.actor_user_id,
    can_create_tasks: isTrue(row.can_create_tasks),
    enabled: isTrue(row.enabled),
    created_at: row.created_at,
    version: row.version,
  };
}

/**
 * Els agents que actuen en nom de qui pregunta.
 *
 * Un usuari no veu els agents dels altres: un agent és una delegació personal, i
 * ensenyar-los tots convertiria la pestanya en una llista de qui confia en què.
 */
export async function listAgents(db: MigrationDb, principal: Principal): Promise<AgentView[]> {
  if (!hasCapability(principal, 'tasks:read')) throw missingCapability('tasks:read');

  const rows = await sql<AgentRow>`
    SELECT ${AGENT_COLUMNS} FROM ai_agents
    WHERE on_behalf_of_user_id = ${principal.userId}
    ORDER BY created_at, id
  `.execute(db);
  return rows.rows.map(toView);
}

export async function getAgent(
  db: MigrationDb,
  principal: Principal,
  id: string,
): Promise<AgentView> {
  const found = await sql<AgentRow>`SELECT ${AGENT_COLUMNS} FROM ai_agents WHERE id = ${id}`.execute(
    db,
  );
  const row = found.rows[0];
  if (row === undefined) throw notFound('agent', id);
  if (row.on_behalf_of_user_id !== principal.userId) {
    // El mateix error que si no existís: dir "existeix però no és teu" ja és dir de qui és.
    throw notFound('agent', id);
  }
  return toView(row);
}

export interface CreateAgentInput {
  id?: string | undefined;
  name?: string | undefined;
  can_create_tasks?: boolean | undefined;
}

export async function createAgent(
  ctx: AuditContext,
  principal: Principal,
  input: CreateAgentInput,
): Promise<{ agent: AgentView; created: boolean }> {
  if (!hasCapability(principal, 'tasks:write')) throw missingCapability('tasks:write');

  if (input.name === undefined || input.name.trim() === '') {
    throw new PolicyError('name-required', 'Name required', 422, "L'agent necessita un nom.");
  }

  const id = input.id ?? uuidv7();
  const existing = await sql<AgentRow>`
    SELECT ${AGENT_COLUMNS} FROM ai_agents WHERE id = ${id}
  `.execute(ctx.tx);
  if (existing.rows[0] !== undefined) {
    ctx.noChange();
    return { agent: toView(existing.rows[0]), created: false };
  }

  await sql`
    INSERT INTO ai_agents (id, name, on_behalf_of_user_id, actor_user_id, can_create_tasks,
                           enabled, created_at, updated_at, version)
    VALUES (${id}, ${input.name.trim()}, ${principal.userId}, ${AI_USER_ID},
            ${dbBool(input.can_create_tasks === true)}, ${dbBool(true)},
            ${ctx.now}, ${ctx.now}, 1)
  `.execute(ctx.tx);

  ctx.record({ entityType: 'ai_agent', entityId: id, verb: 'created' });

  const created = await sql<AgentRow>`
    SELECT ${AGENT_COLUMNS} FROM ai_agents WHERE id = ${id}
  `.execute(ctx.tx);
  return { agent: toView(created.rows[0]!), created: true };
}

export async function updateAgent(
  ctx: AuditContext,
  principal: Principal,
  id: string,
  input: { name?: string | undefined; can_create_tasks?: boolean | undefined; enabled?: boolean | undefined },
): Promise<AgentView> {
  if (!hasCapability(principal, 'tasks:write')) throw missingCapability('tasks:write');
  const before = await getAgent(ctx.tx, principal, id);

  if (input.name !== undefined && input.name.trim() === '') {
    throw new PolicyError('name-required', 'Name required', 422, 'El nom no pot quedar buit.');
  }

  const name = input.name?.trim() ?? before.name;
  const canCreate = input.can_create_tasks ?? before.can_create_tasks;
  const enabled = input.enabled ?? before.enabled;

  if (name === before.name && canCreate === before.can_create_tasks && enabled === before.enabled) {
    ctx.noChange();
    return before;
  }

  await sql`
    UPDATE ai_agents SET name = ${name}, can_create_tasks = ${dbBool(canCreate)},
                         enabled = ${dbBool(enabled)}, updated_at = ${ctx.now},
                         version = version + 1
    WHERE id = ${id}
  `.execute(ctx.tx);

  /**
   * Desactivar un agent **allibera les seves reserves**.
   *
   * Sense això, una tasca reservada per un agent que acabes de desactivar es quedaria
   * bloquejada fins que la reserva caduqués sola, i des de fora sembla que el producte
   * s'hagi encallat: has apagat la IA i la tasca segueix dient "reservada per la IA".
   */
  if (!enabled && before.enabled) {
    await sql`DELETE FROM task_leases WHERE agent_id = ${id}`.execute(ctx.tx);
  }

  ctx.record({
    entityType: 'ai_agent',
    entityId: id,
    verb: 'updated',
    changes: { enabled: { from: before.enabled, to: enabled } },
  });

  return getAgent(ctx.tx, principal, id);
}

/**
 * Esborra un agent.
 *
 * Les tasques que hi tenien delegació **es queden**, amb `delegate_agent_id` a NULL i el
 * mode d'IA a `manual`: la feina és de la persona, no de l'agent, i D5 ho diu així
 * mateix. Els comentaris que hagi escrit tampoc se'n van, perquè els va escriure l'usuari
 * `kind='ai'`, que no és aquesta fila.
 */
export async function deleteAgent(
  ctx: AuditContext,
  principal: Principal,
  id: string,
): Promise<{ released: number }> {
  if (!hasCapability(principal, 'tasks:write')) throw missingCapability('tasks:write');
  await getAgent(ctx.tx, principal, id);

  await sql`DELETE FROM task_leases WHERE agent_id = ${id}`.execute(ctx.tx);
  const released = await sql`
    UPDATE tasks SET delegate_agent_id = NULL, ai_mode = 'manual', updated_at = ${ctx.now},
                     version = version + 1
    WHERE delegate_agent_id = ${id} AND deleted_at IS NULL
  `.execute(ctx.tx);

  await sql`DELETE FROM ai_agents WHERE id = ${id}`.execute(ctx.tx);

  ctx.record({ entityType: 'ai_agent', entityId: id, verb: 'deleted' });
  return { released: Number(released.numAffectedRows ?? 0n) };
}
