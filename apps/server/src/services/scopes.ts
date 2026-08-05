/**
 * Servei d'àmbits i projectes.
 *
 * Regla 8: **la comprovació de permisos es fa a la capa de servei, no al handler.**
 * Cada funció d'aquí rep el principal i decideix. Els handlers HTTP només tradueixen.
 * Un token d'IA i un d'usuari travessen exactament aquestes mateixes funcions.
 */

import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { generatePosition } from '@fem-ho/contracts';
import type { AuditContext } from '../audit/audited-transaction.js';
import type { MigrationDb } from '../db/migration-db.js';
import { missingCapability, notFound, scopeForbidden } from '../policy/errors.js';
import { canSeeScope, hasCapability, type Principal } from '../policy/principal.js';

export interface ScopeRow {
  id: string;
  name: string;
  kind: 'individual' | 'collective';
  color: string;
  icon: string | null;
  ai_instructions: string | null;
  ai_description: string | null;
  position: string;
  owner_id: string;
  created_at: string;
  updated_at: string;
  version: number;
}

/**
 * Els àmbits que el principal pot veure.
 *
 * És la funció que decideix l'abast, i **totes les consultes hi passen**. Si una
 * consulta filtrés per àmbit pel seu compte, un dia se n'oblidaria una i un token
 * limitat veuria coses que no li toquen.
 */
export async function listScopes(db: MigrationDb, principal: Principal): Promise<ScopeRow[]> {
  if (!hasCapability(principal, 'scopes:read')) throw missingCapability('scopes:read');

  const rows = await sql<ScopeRow>`
    SELECT s.id, s.name, s.kind, s.color, s.icon, s.ai_instructions, s.ai_description,
           s.position, s.owner_id, s.created_at, s.updated_at, s.version
    FROM scopes s
    WHERE s.deleted_at IS NULL
      AND (s.owner_id = ${principal.userId}
           OR EXISTS (SELECT 1 FROM scope_members m
                      WHERE m.scope_id = s.id AND m.user_id = ${principal.userId}))
    ORDER BY s.position
  `.execute(db);

  // El filtre d'abast del token s'aplica DESPRÉS del de propietat: un token mai supera
  // els permisos de qui el va crear (docs/05 §2).
  return rows.rows.filter((s) => canSeeScope(principal, s.id));
}

/** Els noms dels àmbits visibles, per construir errors d'abast que diguin alguna cosa. */
export async function visibleScopeNames(db: MigrationDb, principal: Principal): Promise<string[]> {
  const scopes = await sql<{ id: string; name: string }>`
    SELECT s.id, s.name FROM scopes s
    WHERE s.deleted_at IS NULL
      AND (s.owner_id = ${principal.userId}
           OR EXISTS (SELECT 1 FROM scope_members m
                      WHERE m.scope_id = s.id AND m.user_id = ${principal.userId}))
    ORDER BY s.name
  `.execute(db);
  return scopes.rows.filter((s) => canSeeScope(principal, s.id)).map((s) => s.name);
}

/**
 * Comprova que el principal pot arribar a aquest àmbit, i llança un error **que diu
 * quins àmbits veu i on és el que s'ha demanat** si no.
 */
export async function assertScopeAccess(
  db: MigrationDb,
  principal: Principal,
  scopeId: string,
  entity?: { type: string; id: string },
): Promise<ScopeRow> {
  const found = await sql<ScopeRow>`
    SELECT id, name, kind, color, icon, ai_instructions, ai_description, position,
           owner_id, created_at, updated_at, version
    FROM scopes WHERE id = ${scopeId} AND deleted_at IS NULL
  `.execute(db);

  const scope = found.rows[0];
  const visible = await visibleScopeNames(db, principal);

  if (scope === undefined) throw scopeForbidden(visible, undefined, entity);

  const isMember = await sql<{ n: number }>`
    SELECT COUNT(*) AS n FROM scopes s
    WHERE s.id = ${scopeId}
      AND (s.owner_id = ${principal.userId}
           OR EXISTS (SELECT 1 FROM scope_members m
                      WHERE m.scope_id = s.id AND m.user_id = ${principal.userId}))
  `.execute(db);

  if (Number(isMember.rows[0]?.n ?? 0) === 0 || !canSeeScope(principal, scopeId)) {
    throw scopeForbidden(visible, scope.name, entity);
  }

  return scope;
}

export interface CreateScopeInput {
  id?: string | undefined;
  name: string;
  kind?: 'individual' | 'collective' | undefined;
  color: string;
  icon?: string | undefined;
  ai_instructions?: string | undefined;
  ai_description?: string | undefined;
  position?: string | undefined;
}

export interface CreateResult<T> {
  entity: T;
  /** Fals si ja existia amb aquest `id`: idempotència (docs/05 §3). */
  created: boolean;
}

export async function createScope(
  ctx: AuditContext,
  principal: Principal,
  input: CreateScopeInput,
): Promise<CreateResult<ScopeRow>> {
  if (!hasCapability(principal, 'scopes:write')) throw missingCapability('scopes:write');

  const id = input.id ?? uuidv7();

  // Idempotència: amb identificadors generats pel client, el mateix `id` reenviat
  // retorna el recurs existent en comptes de duplicar-lo.
  const existing = await sql<ScopeRow>`
    SELECT id, name, kind, color, icon, ai_instructions, ai_description, position,
           owner_id, created_at, updated_at, version
    FROM scopes WHERE id = ${id}
  `.execute(ctx.tx);
  const already = existing.rows[0];
  if (already !== undefined) {
    ctx.noChange();
    return { entity: already, created: false };
  }

  const last = await sql<{ position: string }>`
    SELECT position FROM scopes
    WHERE owner_id = ${principal.userId} AND deleted_at IS NULL
    ORDER BY position DESC LIMIT 1
  `.execute(ctx.tx);

  const position = input.position ?? generatePosition(last.rows[0]?.position ?? null, null);
  const kind = input.kind ?? 'individual';

  await sql`
    INSERT INTO scopes (id, name, kind, color, icon, owner_id, ai_instructions,
                        ai_description, position, created_at, updated_at, version)
    VALUES (${id}, ${input.name}, ${kind}, ${input.color}, ${input.icon ?? null},
            ${principal.userId}, ${input.ai_instructions ?? null},
            ${input.ai_description ?? null}, ${position}, ${ctx.now}, ${ctx.now}, 1)
  `.execute(ctx.tx);

  // Un àmbit col·lectiu té el seu propietari com a primer membre. Sense això, la
  // consulta de pertinença no el trobaria si algun dia deixés de ser propietari.
  if (kind === 'collective') {
    await sql`
      INSERT INTO scope_members (id, scope_id, user_id, role, created_at)
      VALUES (${uuidv7()}, ${id}, ${principal.userId}, 'owner', ${ctx.now})
    `.execute(ctx.tx);
  }

  ctx.record({ entityType: 'scope', entityId: id, scopeId: id, verb: 'created' });

  const created = await sql<ScopeRow>`
    SELECT id, name, kind, color, icon, ai_instructions, ai_description, position,
           owner_id, created_at, updated_at, version
    FROM scopes WHERE id = ${id}
  `.execute(ctx.tx);

  const row = created.rows[0];
  if (row === undefined) throw notFound('àmbit', id);
  return { entity: row, created: true };
}

export interface ProjectRow {
  id: string;
  scope_id: string;
  name: string;
  ai_instructions: string | null;
  ai_description: string | null;
  position: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  version: number;
}

export async function listProjects(
  db: MigrationDb,
  principal: Principal,
  scopeId?: string,
): Promise<ProjectRow[]> {
  if (!hasCapability(principal, 'projects:read')) throw missingCapability('projects:read');

  const scopes = await listScopes(db, principal);
  const allowed = scopes.map((s) => s.id).filter((id) => scopeId === undefined || id === scopeId);
  if (allowed.length === 0) return [];

  const rows = await sql<ProjectRow>`
    SELECT id, scope_id, name, ai_instructions, ai_description, position, archived_at,
           created_at, updated_at, version
    FROM projects
    WHERE deleted_at IS NULL AND scope_id IN (${sql.join(allowed)})
    ORDER BY position
  `.execute(db);

  return rows.rows;
}

export interface CreateProjectInput {
  id?: string | undefined;
  scope_id: string;
  name: string;
  ai_instructions?: string | undefined;
  ai_description?: string | undefined;
  position?: string | undefined;
}

export async function createProject(
  ctx: AuditContext,
  principal: Principal,
  input: CreateProjectInput,
): Promise<CreateResult<ProjectRow>> {
  if (!hasCapability(principal, 'projects:write')) throw missingCapability('projects:write');
  await assertScopeAccess(ctx.tx, principal, input.scope_id);

  const id = input.id ?? uuidv7();
  const existing = await sql<ProjectRow>`
    SELECT id, scope_id, name, ai_instructions, ai_description, position, archived_at,
           created_at, updated_at, version
    FROM projects WHERE id = ${id}
  `.execute(ctx.tx);
  const already = existing.rows[0];
  if (already !== undefined) {
    ctx.noChange();
    return { entity: already, created: false };
  }

  const last = await sql<{ position: string }>`
    SELECT position FROM projects
    WHERE scope_id = ${input.scope_id} AND deleted_at IS NULL
    ORDER BY position DESC LIMIT 1
  `.execute(ctx.tx);
  const position = input.position ?? generatePosition(last.rows[0]?.position ?? null, null);

  await sql`
    INSERT INTO projects (id, scope_id, name, ai_instructions, ai_description, position,
                          created_at, updated_at, version)
    VALUES (${id}, ${input.scope_id}, ${input.name}, ${input.ai_instructions ?? null},
            ${input.ai_description ?? null}, ${position}, ${ctx.now}, ${ctx.now}, 1)
  `.execute(ctx.tx);

  ctx.record({
    entityType: 'project',
    entityId: id,
    scopeId: input.scope_id,
    verb: 'created',
  });

  const created = await sql<ProjectRow>`
    SELECT id, scope_id, name, ai_instructions, ai_description, position, archived_at,
           created_at, updated_at, version
    FROM projects WHERE id = ${id}
  `.execute(ctx.tx);

  const row = created.rows[0];
  if (row === undefined) throw notFound('projecte', id);
  return { entity: row, created: true };
}
