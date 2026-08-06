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
import { PolicyError, missingCapability, notFound, scopeForbidden } from '../policy/errors.js';
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
    ORDER BY position DESC, id DESC LIMIT 1
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
    ORDER BY position, id
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
    ORDER BY position DESC, id DESC LIMIT 1
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

const SCOPE_COLUMNS = sql`
  id, name, kind, color, icon, ai_instructions, ai_description, position,
  owner_id, created_at, updated_at, version
`;

export async function getScope(
  db: MigrationDb,
  principal: Principal,
  id: string,
): Promise<ScopeRow> {
  if (!hasCapability(principal, 'scopes:read')) throw missingCapability('scopes:read');
  return assertScopeAccess(db, principal, id);
}

export interface UpdateScopeInput {
  name?: string | undefined;
  color?: string | undefined;
  icon?: string | null | undefined;
  ai_instructions?: string | null | undefined;
  ai_description?: string | null | undefined;
  position?: string | undefined;
}

/**
 * **`kind` no es pot canviar.**
 *
 * Passar d'individual a col·lectiu deixaria totes les tasques assignades al propietari
 * per la regla d'assignació automàtica (docs/01 §4) sense que ningú ho hagi demanat; i
 * a l'inrevés, deixaria membres amb accés a un àmbit que ja no en té. Qui vulgui l'altre
 * tipus en crea un de nou i hi mou el que vulgui, que és explícit.
 */
export async function updateScope(
  ctx: AuditContext,
  principal: Principal,
  id: string,
  input: UpdateScopeInput,
): Promise<ScopeRow> {
  if (!hasCapability(principal, 'scopes:write')) throw missingCapability('scopes:write');
  const before = await assertScopeAccess(ctx.tx, principal, id);

  const fields = pickDefined(input, [
    'name',
    'color',
    'icon',
    'ai_instructions',
    'ai_description',
    'position',
  ]);
  if (typeof fields.name === 'string' && fields.name.trim() === '') {
    throw new PolicyError('name-required', 'Name required', 422, "L'àmbit necessita un nom.");
  }

  if (Object.keys(fields).length === 0) {
    ctx.noChange();
    return before;
  }

  await sql`
    UPDATE scopes SET ${assignmentsOf(fields)}, updated_at = ${ctx.now}, version = version + 1
    WHERE id = ${id}
  `.execute(ctx.tx);

  ctx.record({
    entityType: 'scope',
    entityId: id,
    scopeId: id,
    verb: 'updated',
    changes: changesOf(before as unknown as Record<string, unknown>, fields),
  });

  const after = await sql<ScopeRow>`SELECT ${SCOPE_COLUMNS} FROM scopes WHERE id = ${id}`.execute(
    ctx.tx,
  );
  return after.rows[0]!;
}

/**
 * Esborrat suau d'un àmbit.
 *
 * **Es nega si encara té res a dins**, i diu quantes coses. Un esborrat en cascada aquí
 * seria irreversible des de la interfície i faria desaparèixer feina que algú altre de
 * l'àmbit potser encara mira; i deixar les tasques penjades trencaria la invariant que
 * una tasca sempre té àmbit. Buidar-lo primer és una decisió de qui l'esborra, no meva.
 */
export async function deleteScope(
  ctx: AuditContext,
  principal: Principal,
  id: string,
): Promise<void> {
  if (!hasCapability(principal, 'scopes:write')) throw missingCapability('scopes:write');
  const scope = await assertScopeAccess(ctx.tx, principal, id);

  if (scope.owner_id !== principal.userId) {
    throw new PolicyError(
      'not-owner',
      'Not the owner',
      403,
      `L'àmbit ${scope.name} només el pot esborrar qui el va crear.`,
    );
  }

  const counts = await sql<{ tasques: number; projectes: number }>`
    SELECT
      (SELECT COUNT(*) FROM tasks WHERE scope_id = ${id} AND deleted_at IS NULL) AS tasques,
      (SELECT COUNT(*) FROM projects WHERE scope_id = ${id} AND deleted_at IS NULL) AS projectes
  `.execute(ctx.tx);
  const tasques = Number(counts.rows[0]?.tasques ?? 0);
  const projectes = Number(counts.rows[0]?.projectes ?? 0);

  if (tasques > 0 || projectes > 0) {
    const parts: string[] = [];
    if (tasques > 0) parts.push(`${String(tasques)} ${tasques === 1 ? 'tasca' : 'tasques'}`);
    if (projectes > 0) {
      parts.push(`${String(projectes)} ${projectes === 1 ? 'projecte' : 'projectes'}`);
    }
    throw new PolicyError(
      'scope-not-empty',
      'Scope not empty',
      409,
      `L'àmbit ${scope.name} encara té ${parts.join(' i ')}. Mou-ho o esborra-ho abans.`,
    );
  }

  await sql`
    UPDATE scopes SET deleted_at = ${ctx.now}, updated_at = ${ctx.now}, version = version + 1
    WHERE id = ${id}
  `.execute(ctx.tx);

  ctx.record({ entityType: 'scope', entityId: id, scopeId: id, verb: 'deleted' });
}

// ------------------------------------------------------------------- membres

export interface MemberRow {
  id: string;
  scope_id: string;
  user_id: string | null;
  external_calendar_id: string | null;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  created_at: string;
  /** Nom llegible, per no obligar la interfície a una segona crida. */
  name: string | null;
  email: string | null;
}

export async function listMembers(
  db: MigrationDb,
  principal: Principal,
  scopeId: string,
): Promise<MemberRow[]> {
  if (!hasCapability(principal, 'scopes:read')) throw missingCapability('scopes:read');
  await assertScopeAccess(db, principal, scopeId);

  const rows = await sql<MemberRow>`
    SELECT m.id, m.scope_id, m.user_id, m.external_calendar_id, m.role, m.created_at,
           COALESCE(u.name, c.name) AS name, u.email AS email
    FROM scope_members m
    LEFT JOIN users u ON u.id = m.user_id
    LEFT JOIN calendars c ON c.id = m.external_calendar_id
    WHERE m.scope_id = ${scopeId}
    ORDER BY m.created_at, m.id
  `.execute(db);
  return rows.rows;
}

export interface AddMemberInput {
  user_id?: string | undefined;
  external_calendar_id?: string | undefined;
  role?: MemberRow['role'] | undefined;
}

/**
 * P3: un membre és **o bé** un usuari **o bé** una subscripció de calendari de només
 * lectura. El CHECK de la taula ho imposa; aquí es diu amb paraules, perquè un CHECK
 * violat no explica res a qui l'ha provocat.
 */
export async function addMember(
  ctx: AuditContext,
  principal: Principal,
  scopeId: string,
  input: AddMemberInput,
): Promise<MemberRow> {
  if (!hasCapability(principal, 'scopes:write')) throw missingCapability('scopes:write');
  const scope = await assertScopeAccess(ctx.tx, principal, scopeId);

  if (scope.kind !== 'collective') {
    throw new PolicyError(
      'scope-not-collective',
      'Scope is not collective',
      422,
      `L'àmbit ${scope.name} és individual: no té membres. Els àmbits col·lectius sí.`,
    );
  }

  const hasUser = input.user_id !== undefined && input.user_id !== '';
  const hasCalendar = input.external_calendar_id !== undefined && input.external_calendar_id !== '';
  if (hasUser === hasCalendar) {
    throw new PolicyError(
      'member-shape',
      'Invalid member',
      422,
      'Un membre és o bé un usuari (`user_id`) o bé una subscripció de calendari ' +
        '(`external_calendar_id`), mai totes dues coses ni cap.',
    );
  }

  if (hasUser) {
    const exists = await sql<{ n: number }>`
      SELECT COUNT(*) AS n FROM scope_members WHERE scope_id = ${scopeId} AND user_id = ${input.user_id}
    `.execute(ctx.tx);
    if (Number(exists.rows[0]?.n ?? 0) > 0) {
      ctx.noChange();
      const current = await listMembersInTx(ctx.tx, scopeId);
      return current.find((m) => m.user_id === input.user_id)!;
    }
  }

  const id = uuidv7();
  await sql`
    INSERT INTO scope_members (id, scope_id, user_id, external_calendar_id, role, created_at)
    VALUES (${id}, ${scopeId}, ${hasUser ? input.user_id : null},
            ${hasCalendar ? input.external_calendar_id : null},
            ${input.role ?? 'member'}, ${ctx.now})
  `.execute(ctx.tx);

  ctx.record({ entityType: 'scope_member', entityId: id, scopeId, verb: 'created' });

  const rows = await listMembersInTx(ctx.tx, scopeId);
  return rows.find((m) => m.id === id)!;
}

async function listMembersInTx(tx: MigrationDb, scopeId: string): Promise<MemberRow[]> {
  const rows = await sql<MemberRow>`
    SELECT m.id, m.scope_id, m.user_id, m.external_calendar_id, m.role, m.created_at,
           COALESCE(u.name, c.name) AS name, u.email AS email
    FROM scope_members m
    LEFT JOIN users u ON u.id = m.user_id
    LEFT JOIN calendars c ON c.id = m.external_calendar_id
    WHERE m.scope_id = ${scopeId}
    ORDER BY m.created_at, m.id
  `.execute(tx);
  return rows.rows;
}

export async function updateMember(
  ctx: AuditContext,
  principal: Principal,
  scopeId: string,
  memberId: string,
  role: MemberRow['role'],
): Promise<MemberRow> {
  if (!hasCapability(principal, 'scopes:write')) throw missingCapability('scopes:write');
  const scope = await assertScopeAccess(ctx.tx, principal, scopeId);

  const members = await listMembersInTx(ctx.tx, scopeId);
  const member = members.find((m) => m.id === memberId);
  if (member === undefined) throw notFound('membre', memberId);

  // Deixar un àmbit col·lectiu sense cap propietari el faria ingovernable: ningú no en
  // podria tornar a canviar els permisos.
  if (member.role === 'owner' && role !== 'owner') {
    const owners = members.filter((m) => m.role === 'owner').length;
    if (owners <= 1) {
      throw new PolicyError(
        'last-owner',
        'Last owner',
        409,
        `${scope.name} es quedaria sense cap propietari. Fes propietari algú altre primer.`,
      );
    }
  }

  await sql`UPDATE scope_members SET role = ${role} WHERE id = ${memberId}`.execute(ctx.tx);
  ctx.record({
    entityType: 'scope_member',
    entityId: memberId,
    scopeId,
    verb: 'updated',
    changes: { role: { from: member.role, to: role } },
  });

  return { ...member, role };
}

export async function removeMember(
  ctx: AuditContext,
  principal: Principal,
  scopeId: string,
  memberId: string,
): Promise<void> {
  if (!hasCapability(principal, 'scopes:write')) throw missingCapability('scopes:write');
  const scope = await assertScopeAccess(ctx.tx, principal, scopeId);

  const members = await listMembersInTx(ctx.tx, scopeId);
  const member = members.find((m) => m.id === memberId);
  if (member === undefined) throw notFound('membre', memberId);

  if (member.role === 'owner' && members.filter((m) => m.role === 'owner').length <= 1) {
    throw new PolicyError(
      'last-owner',
      'Last owner',
      409,
      `${scope.name} es quedaria sense cap propietari.`,
    );
  }

  await sql`DELETE FROM scope_members WHERE id = ${memberId}`.execute(ctx.tx);
  ctx.record({ entityType: 'scope_member', entityId: memberId, scopeId, verb: 'deleted' });
}

// ------------------------------------------------------------------ projectes

const PROJECT_COLUMNS = sql`
  id, scope_id, name, ai_instructions, ai_description, position, archived_at,
  created_at, updated_at, version
`;

export async function getProject(
  db: MigrationDb,
  principal: Principal,
  id: string,
): Promise<ProjectRow> {
  if (!hasCapability(principal, 'projects:read')) throw missingCapability('projects:read');
  const found = await sql<ProjectRow>`
    SELECT ${PROJECT_COLUMNS} FROM projects WHERE id = ${id} AND deleted_at IS NULL
  `.execute(db);
  const row = found.rows[0];
  if (row === undefined) throw notFound('projecte', id);
  await assertScopeAccess(db, principal, row.scope_id, { type: 'El projecte', id });
  return row;
}

export interface UpdateProjectInput {
  name?: string | undefined;
  ai_instructions?: string | null | undefined;
  ai_description?: string | null | undefined;
  position?: string | undefined;
  /** Arxivar és posar-hi data; desarxivar és treure-la. No és un esborrat. */
  archived?: boolean | undefined;
}

export async function updateProject(
  ctx: AuditContext,
  principal: Principal,
  id: string,
  input: UpdateProjectInput,
): Promise<ProjectRow> {
  if (!hasCapability(principal, 'projects:write')) throw missingCapability('projects:write');
  const before = await getProject(ctx.tx, principal, id);

  const fields = pickDefined(input, ['name', 'ai_instructions', 'ai_description', 'position']);
  if (input.archived !== undefined) {
    fields.archived_at = input.archived ? ctx.now : null;
  }
  if (typeof fields.name === 'string' && fields.name.trim() === '') {
    throw new PolicyError('name-required', 'Name required', 422, 'El projecte necessita un nom.');
  }

  if (Object.keys(fields).length === 0) {
    ctx.noChange();
    return before;
  }

  await sql`
    UPDATE projects SET ${assignmentsOf(fields)}, updated_at = ${ctx.now}, version = version + 1
    WHERE id = ${id}
  `.execute(ctx.tx);

  ctx.record({
    entityType: 'project',
    entityId: id,
    scopeId: before.scope_id,
    verb: 'updated',
    changes: changesOf(before as unknown as Record<string, unknown>, fields),
  });

  const after = await sql<ProjectRow>`
    SELECT ${PROJECT_COLUMNS} FROM projects WHERE id = ${id}
  `.execute(ctx.tx);
  return after.rows[0]!;
}

/**
 * Esborrat suau d'un projecte.
 *
 * **Les tasques no cauen amb ell**: tornen a l'espai general de l'àmbit, que és el
 * filtre `project_id IS NULL` i no una fila (docs/01 §4). Esborrar una carpeta no és
 * demanar que es cremi el que hi havia a dins.
 */
export async function deleteProject(
  ctx: AuditContext,
  principal: Principal,
  id: string,
): Promise<{ moved: number }> {
  if (!hasCapability(principal, 'projects:write')) throw missingCapability('projects:write');
  const project = await getProject(ctx.tx, principal, id);

  const moved = await sql`
    UPDATE tasks SET project_id = NULL, updated_at = ${ctx.now}, version = version + 1
    WHERE project_id = ${id} AND deleted_at IS NULL
  `.execute(ctx.tx);

  await sql`
    UPDATE projects SET deleted_at = ${ctx.now}, updated_at = ${ctx.now}, version = version + 1
    WHERE id = ${id}
  `.execute(ctx.tx);

  ctx.record({
    entityType: 'project',
    entityId: id,
    scopeId: project.scope_id,
    verb: 'deleted',
  });

  return { moved: Number(moved.numAffectedRows ?? 0n) };
}

// -------------------------------------------------------------------- auxiliars

/**
 * Els camps que s'han donat, distingint `undefined` ("no el toquis") de `null`
 * ("buida'l"). És el mateix criteri que `updateTask`, i viu aquí perquè tots els
 * `PATCH` el necessiten igual.
 */
export function pickDefined<T extends object>(
  input: T,
  keys: readonly (keyof T & string)[],
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const key of keys) {
    if (input[key] !== undefined) fields[key] = input[key];
  }
  return fields;
}

export function assignmentsOf(fields: Record<string, unknown>): ReturnType<typeof sql> {
  return sql.join(Object.entries(fields).map(([field, value]) => sql`${sql.raw(field)} = ${value}`));
}

export function changesOf(
  before: Record<string, unknown>,
  fields: Record<string, unknown>,
): Record<string, { from: unknown; to: unknown }> {
  return Object.fromEntries(
    Object.keys(fields).map((field) => [field, { from: before[field], to: fields[field] }]),
  );
}
