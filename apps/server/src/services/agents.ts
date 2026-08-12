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
import { visibleScopeIds } from '../policy/scope-visibility.js';
import {
  assignmentConflict,
  availability,
  holders,
  type AgentAssignment,
} from '../policy/agent-scopes.js';

export interface AgentView {
  id: string;
  name: string;
  on_behalf_of_user_id: string;
  actor_user_id: string;
  can_create_tasks: boolean;
  enabled: boolean;
  /**
   * Els àmbits d'on aquest agent agafa feina. **Un àmbit té un sol agent** (migració 016).
   *
   * Amb `all_scopes`, la llista va buida i el que val és l'indicador: veure `policy/
   * agent-scopes.ts` per què no s'hi copia el conjunt d'avui.
   */
  scope_ids: string[];
  all_scopes: boolean;
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
  all_scopes: unknown;
  created_at: string;
  version: number;
}

const AGENT_COLUMNS = sql`
  id, name, on_behalf_of_user_id, actor_user_id, can_create_tasks, enabled, all_scopes,
  created_at, version
`;

function toView(row: AgentRow, scopeIds: string[]): AgentView {
  return {
    id: row.id,
    name: row.name,
    on_behalf_of_user_id: row.on_behalf_of_user_id,
    actor_user_id: row.actor_user_id,
    can_create_tasks: isTrue(row.can_create_tasks),
    enabled: isTrue(row.enabled),
    scope_ids: scopeIds,
    all_scopes: isTrue(row.all_scopes),
    created_at: row.created_at,
    version: row.version,
  };
}

/**
 * Els àmbits de cada agent, **en una consulta per a tots** i no una per agent.
 *
 * És el mateix criteri que `withAssignees` a `services/tasks.ts`: la pantalla d'Ajustos els
 * demana tots alhora, i una consulta per fila és com una llista de cinc agents fa sis
 * viatges a la base.
 */
async function scopesOf(db: MigrationDb, agentIds: string[]): Promise<Map<string, string[]>> {
  const per = new Map<string, string[]>();
  if (agentIds.length === 0) return per;

  const rows = await sql<{ agent_id: string; scope_id: string }>`
    SELECT agent_id, scope_id FROM agent_scopes WHERE agent_id IN (${sql.join(agentIds)})
    ORDER BY scope_id
  `.execute(db);

  for (const row of rows.rows) {
    per.set(row.agent_id, [...(per.get(row.agent_id) ?? []), row.scope_id]);
  }
  return per;
}

/**
 * Tots els agents d'aquesta persona amb el que tenen assignat.
 *
 * Ho necessita qui comprova l'exclusivitat: per saber si un àmbit és lliure cal saber de
 * tots els altres, no només del que s'està tocant.
 */
async function assignments(db: MigrationDb, userId: string): Promise<AgentAssignment[]> {
  const rows = await sql<{ id: string; name: string; all_scopes: unknown }>`
    SELECT id, name, all_scopes FROM ai_agents WHERE on_behalf_of_user_id = ${userId}
  `.execute(db);

  const per = await scopesOf(
    db,
    rows.rows.map((row) => row.id),
  );
  return rows.rows.map((row) => ({
    id: row.id,
    name: row.name,
    allScopes: isTrue(row.all_scopes),
    scopeIds: per.get(row.id) ?? [],
  }));
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
  const per = await scopesOf(
    db,
    rows.rows.map((row) => row.id),
  );
  return rows.rows.map((row) => toView(row, per.get(row.id) ?? []));
}

export async function getAgent(
  db: MigrationDb,
  principal: Principal,
  id: string,
): Promise<AgentView> {
  const found =
    await sql<AgentRow>`SELECT ${AGENT_COLUMNS} FROM ai_agents WHERE id = ${id}`.execute(db);
  const row = found.rows[0];
  if (row === undefined) throw notFound('agent', id);
  if (row.on_behalf_of_user_id !== principal.userId) {
    // El mateix error que si no existís: dir "existeix però no és teu" ja és dir de qui és.
    throw notFound('agent', id);
  }
  const per = await scopesOf(db, [row.id]);
  return toView(row, per.get(row.id) ?? []);
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
    const seus = await scopesOf(ctx.tx, [existing.rows[0].id]);
    return { agent: toView(existing.rows[0], seus.get(existing.rows[0].id) ?? []), created: false };
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
  // Neix sense cap àmbit: assignar-n'hi és un segon gest, i el primer no pot fallar per
  // un xoc d'exclusivitat quan encara no s'ha triat res.
  return { agent: toView(created.rows[0]!, []), created: true };
}

export async function updateAgent(
  ctx: AuditContext,
  principal: Principal,
  id: string,
  input: {
    name?: string | undefined;
    can_create_tasks?: boolean | undefined;
    enabled?: boolean | undefined;
  },
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
/**
 * Els àmbits d'on aquest agent agafa feina.
 *
 * **La regla és a la base** (`UNIQUE (scope_id)` a la migració 016) i aquí es fa
 * entenedora: es mira abans d'escriure per poder dir **de quin agent és** l'àmbit que
 * xoca. Sense això, el que arribaria a la pantalla seria una violació de restricció, que
 * és certa i no serveix de res a qui l'ha de resoldre.
 *
 * Es desa **el conjunt sencer** i no diferències: la pantalla envia les caselles tal com
 * han quedat, i calcular què s'ha afegit i què s'ha tret des de fora és com dues pestanyes
 * obertes acaben deixant un àmbit sense agent.
 */
export async function setAgentScopes(
  ctx: AuditContext,
  principal: Principal,
  id: string,
  wanted: { scope_ids: string[]; all_scopes: boolean },
): Promise<AgentView> {
  if (!hasCapability(principal, 'tasks:write')) throw missingCapability('tasks:write');
  const before = await getAgent(ctx.tx, principal, id);

  /**
   * **Els àmbits han de ser d'aquesta persona.** Un agent actua en nom seu (D5); deixar-li
   * un àmbit que ella no veu seria donar-li més abast del que té qui en respon.
   *
   * Es pregunta a `policy/scope-visibility.ts` i no s'hi escriu una segona consulta: la
   * pertinença a un àmbit es decideix en un sol lloc, i una còpia aquí seria la que un dia
   * es quedaria enrere quan canviïn les regles dels àmbits compartits.
   */
  const visibles = await visibleScopeIds(ctx.tx, principal.userId);

  const demanats = [...new Set(wanted.scope_ids)].filter((scopeId) => visibles.has(scopeId));
  const fora = wanted.scope_ids.find((scopeId) => !visibles.has(scopeId));
  if (fora !== undefined) {
    throw new PolicyError(
      'scope-not-visible',
      'Scope not visible',
      422,
      `L'àmbit ${fora} no és teu, i un agent no pot arribar més lluny que tu.`,
    );
  }

  const xoc = assignmentConflict(
    id,
    { allScopes: wanted.all_scopes, scopeIds: demanats },
    await assignments(ctx.tx, principal.userId),
  );
  if (xoc !== null) {
    const detall =
      xoc.reason === 'scope-taken'
        ? `L'àmbit ja el porta l'agent "${xoc.byAgentName}". Un àmbit té un sol agent.`
        : xoc.reason === 'all-taken'
          ? `L'agent "${xoc.byAgentName}" porta tots els àmbits. Treu-l'hi abans.`
          : `L'agent "${xoc.byAgentName}" ja porta algun àmbit, i "tots" els vol tots.`;
    throw new PolicyError('scope-taken', 'Scope already assigned', 422, detall, {
      agent_id: xoc.byAgentId,
      agent_name: xoc.byAgentName,
      ...(xoc.reason === 'scope-taken' ? { scope_id: xoc.scopeId } : {}),
    });
  }

  const igual =
    before.all_scopes === wanted.all_scopes &&
    before.scope_ids.length === demanats.length &&
    before.scope_ids.every((scopeId) => demanats.includes(scopeId));
  if (igual) {
    ctx.noChange();
    return before;
  }

  await sql`DELETE FROM agent_scopes WHERE agent_id = ${id}`.execute(ctx.tx);
  // Amb «tots» no s'hi desa cap fila: l'indicador és el que mana, i les files serien una
  // còpia que demà mentiria (veure `policy/agent-scopes.ts`).
  if (!wanted.all_scopes) {
    for (const scopeId of demanats) {
      await sql`
        INSERT INTO agent_scopes (agent_id, scope_id) VALUES (${id}, ${scopeId})
      `.execute(ctx.tx);
    }
  }
  await sql`
    UPDATE ai_agents SET all_scopes = ${dbBool(wanted.all_scopes)}, updated_at = ${ctx.now},
                         version = version + 1
    WHERE id = ${id}
  `.execute(ctx.tx);

  ctx.record({
    entityType: 'ai_agent',
    entityId: id,
    verb: 'updated',
    changes: {
      scope_ids: { from: before.scope_ids.join(','), to: demanats.join(',') },
      all_scopes: { from: String(before.all_scopes), to: String(wanted.all_scopes) },
    },
  });

  return getAgent(ctx.tx, principal, id);
}

/**
 * Quins àmbits pot marcar aquest agent i quins li surten presos, per a la pantalla.
 *
 * Desactivar la casella **dient de qui és** val més que deixar-la marcar i respondre amb un
 * error: l'error arriba després d'haver decidit, i això arriba abans.
 */
export async function agentScopeAvailability(
  db: MigrationDb,
  principal: Principal,
  id: string,
): Promise<{ scope_id: string; taken_by: { id: string; name: string } | null }[]> {
  await getAgent(db, principal, id);

  // Els mateixos àmbits que veu la persona, en l'ordre en què els ensenya la barra.
  const visibles = await visibleScopeIds(db, principal.userId);
  const ordenats = await sql<{ id: string }>`
    SELECT id FROM scopes WHERE deleted_at IS NULL ORDER BY position, id
  `.execute(db);

  return availability(
    id,
    ordenats.rows.map((row) => row.id).filter((scopeId) => visibles.has(scopeId)),
    await assignments(db, principal.userId),
  ).map((row) => ({ scope_id: row.scopeId, taken_by: row.takenBy }));
}

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

/**
 * Quins àmbits tenen agent, i si l'agent està engegat.
 *
 * **Perquè una tasca delegada a un àmbit orfe no s'hi quedi per sempre.** El kanban d'IA no
 * distingeix una tasca que un agent està a punt d'agafar d'una que no agafarà mai ningú, i
 * la diferència no és de la tasca sinó de l'àmbit: si no hi ha cap agent que el porti —o el
 * que el porta està aturat—, allò no es farà i s'ha de dir en el moment de deixar-la-hi.
 */
export async function agentCoverage(
  db: MigrationDb,
  principal: Principal,
): Promise<{ scope_id: string; agent: { id: string; name: string; enabled: boolean } | null }[]> {
  if (!hasCapability(principal, 'tasks:read')) throw missingCapability('tasks:read');

  const visibles = await visibleScopeIds(db, principal.userId);
  const ordenats = await sql<{ id: string }>`
    SELECT id FROM scopes WHERE deleted_at IS NULL ORDER BY position, id
  `.execute(db);

  const actius = await sql<{ id: string; enabled: unknown }>`
    SELECT id, enabled FROM ai_agents WHERE on_behalf_of_user_id = ${principal.userId}
  `.execute(db);
  const engegat = new Map(actius.rows.map((row) => [row.id, isTrue(row.enabled)]));

  return holders(
    ordenats.rows.map((row) => row.id).filter((scopeId) => visibles.has(scopeId)),
    await assignments(db, principal.userId),
  ).map((row) => ({
    scope_id: row.scopeId,
    agent:
      row.agent === null
        ? null
        : { id: row.agent.id, name: row.agent.name, enabled: engegat.get(row.agent.id) ?? false },
  }));
}
