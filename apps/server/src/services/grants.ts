/**
 * Les concessions: **la capa de bescanvi**, no la d'autenticació.
 *
 * Fem-ho ja té dos motlles de token i cap dels dos serveix per a això:
 *
 * | | Què fa | Es presenta a… |
 * | --- | --- | --- |
 * | `api_tokens` | **presenta** una identitat | cada petició |
 * | `shares` | **presenta** una identitat de convidat | cada petició |
 * | `user_invites` | **bescanvia** una relació | un cop |
 *
 * `user_invites` és l'únic dels tres que no és una credencial: és un **val**. S'ensenya
 * una vegada, es consumeix, i el que en surt és un canvi d'estat durador. Convidar algú a
 * un àmbit i federar amb una altra instància són exactament això. Per tant `grants` és
 * `user_invites` generalitzat, i **no una quarta capa paral·lela**: no competeix amb
 * `api_tokens`, l'alimentarà quan arribi la federació.
 *
 * Per què `api_tokens` i `shares` NO s'hi absorbeixen: el primer es resol a cada petició
 * i vol un hash ràpid, porta prefix visible i `last_used_at` que s'escriu constantment;
 * el segon porta contrasenya argon2id, comptador de visites, `require_name` i una taula
 * filla d'accessos, amb un model d'amenaça propi. Fondre'ls seria reescriure dues coses
 * que funcionen per estalviar una taula.
 */

import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import type { AuditContext } from '../audit/audited-transaction.js';
import type { MigrationDb } from '../db/migration-db.js';
import { PolicyError, missingCapability } from '../policy/errors.js';
import { hasCapability, type Principal } from '../policy/principal.js';
import { SCOPE_ROLES, type ScopeRole } from '../policy/scope-roles.js';
import { generateOpaqueToken, tokenHmac } from '../util/opaque-token.js';
import { roleOf } from '../policy/scope-visibility.js';
import { assertScopeRole, joinScope } from './scopes.js';

/**
 * Els tipus de concessió.
 *
 * La columna `kind` **no porta CHECK a la base**, i és deliberat: aquesta taula existeix
 * per absorbir tipus futurs i un CHECK la convertiria en una migració cada vegada. La
 * unió tancada viu aquí, que és on hi ha el `switch` que hi falla igualment.
 */
export const GRANT_KINDS = ['scope_invite', 'scope_federation'] as const;
export type GrantKind = (typeof GRANT_KINDS)[number];

export interface GrantRow {
  id: string;
  kind: string;
  subject_type: string;
  subject_id: string | null;
  issuer_user_id: string | null;
  role: string | null;
  capabilities: string | null;
  payload: string | null;
  max_uses: number;
  use_count: number;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

const GRANT_COLUMNS = sql`
  id, kind, subject_type, subject_id, issuer_user_id, role, capabilities, payload,
  max_uses, use_count, expires_at, revoked_at, created_at
`;

/** Les mateixes, qualificades: a les consultes amb JOIN, `id` sol és ambigu. */
const G = sql`
  g.id, g.kind, g.subject_type, g.subject_id, g.issuer_user_id, g.role, g.capabilities,
  g.payload, g.max_uses, g.use_count, g.expires_at, g.revoked_at, g.created_at
`;

/**
 * **L'estat es deriva, no es guarda.**
 *
 * Una columna `state` necessitaria una feina del planificador per no mentir el minut
 * després de caducar; una derivada no pot divergir.
 */
export function isOpen(grant: GrantRow, now: string): boolean {
  if (grant.revoked_at !== null) return false;
  if (grant.use_count >= grant.max_uses) return false;
  return grant.expires_at === null || grant.expires_at > now;
}

/**
 * L'error de bescanvi és **sempre el mateix**.
 *
 * Un token inventat, un de caducat, un d'exhaurit i un de revocat responen igual i
 * triguen igual. Si es distingissin, es podrien enumerar concessions — la mateixa regla
 * que `docs/10` §4 imposa als enllaços compartits.
 */
function invalidGrant(): PolicyError {
  return new PolicyError(
    'invalid-grant',
    'Invalid invitation',
    404,
    'This invitation is not valid: it may have been used, revoked or expired.',
  );
}

export interface IssueGrantInput {
  kind: GrantKind;
  scopeId: string;
  role?: ScopeRole | undefined;
  maxUses?: number | undefined;
  expiresInDays?: number | undefined;
}

export interface IssuedGrant {
  grant: GrantRow;
  /** **El token sencer va aquí i enlloc més.** No es pot recuperar del hash. */
  token: string;
}

const DEFAULT_EXPIRY_DAYS = 7;

/**
 * Emet una concessió per a un àmbit.
 *
 * Demana `scopes:share` i **no `scopes:write`**: regalar l'àmbit a un desconegut no és el
 * mateix poder que reanomenar-lo, i un token d'automatització que pot editar no ha de
 * poder convidar-hi gent.
 */
export async function issueGrant(
  ctx: AuditContext,
  principal: Principal,
  input: IssueGrantInput,
  pepper: string,
): Promise<IssuedGrant> {
  if (!hasCapability(principal, 'scopes:share')) throw missingCapability('scopes:share');
  const scope = await assertScopeRole(ctx.tx, principal, input.scopeId, 'membership');

  const role: ScopeRole = input.role ?? 'collaborator';
  if (!SCOPE_ROLES.includes(role) || role === 'owner') {
    throw new PolicyError(
      'invalid-role',
      'Invalid role',
      422,
      'An invitation can grant `collaborator` or `viewer`, never `owner`.',
      { role },
    );
  }

  const token = generateOpaqueToken();
  const id = uuidv7();
  const days = input.expiresInDays ?? DEFAULT_EXPIRY_DAYS;
  const expiresAt = new Date(Date.parse(ctx.now) + days * 86_400_000).toISOString();

  await sql`
    INSERT INTO grants (id, kind, subject_type, subject_id, token_hmac, issuer_user_id,
                        role, max_uses, use_count, expires_at, created_at)
    VALUES (${id}, ${input.kind}, 'scope', ${input.scopeId}, ${tokenHmac(token, pepper)},
            ${principal.userId}, ${role}, ${input.maxUses ?? 1}, 0, ${expiresAt}, ${ctx.now})
  `.execute(ctx.tx);

  // El token no hi va mai: qui llegeixi l'historial no ha de poder-lo fer servir.
  ctx.record({
    entityType: 'scope',
    entityId: input.scopeId,
    scopeId: input.scopeId,
    verb: 'shared',
    changes: { invitation: { from: null, to: role } },
  });

  const found = await sql<GrantRow>`
    SELECT ${GRANT_COLUMNS} FROM grants WHERE id = ${id}
  `.execute(ctx.tx);

  void scope;
  return { grant: found.rows[0]!, token };
}

export interface GrantPreview {
  kind: string;
  scope_name: string;
  role: string;
  /** Qui convida. Que el receptor sàpiga de qui és abans d'acceptar. */
  invited_by: string;
}

/**
 * Què hi ha darrere d'un token, **sense consumir-lo**.
 *
 * És el que fa que la pantalla pugui dir "L'Alba et convida a Família" en comptes de
 * demanar-te que acceptis a cegues.
 */
export async function peekGrant(
  db: MigrationDb,
  token: string,
  pepper: string,
  now: string,
): Promise<GrantPreview> {
  const found = await sql<GrantRow & { scope_name: string | null; issuer_name: string | null }>`
    SELECT ${G}, s.name AS scope_name, u.name AS issuer_name
    FROM grants g
    LEFT JOIN scopes s ON s.id = g.subject_id AND g.subject_type = 'scope'
    LEFT JOIN users u ON u.id = g.issuer_user_id
    WHERE g.token_hmac = ${tokenHmac(token, pepper)}
  `.execute(db);

  const grant = found.rows[0];
  if (grant === undefined || !isOpen(grant, now) || grant.scope_name === null) {
    throw invalidGrant();
  }

  return {
    kind: grant.kind,
    scope_name: grant.scope_name,
    role: grant.role ?? 'collaborator',
    invited_by: grant.issuer_name ?? '',
  };
}

export interface RedeemResult {
  scope_id: string;
  scope_name: string;
  role: string;
}

/**
 * Bescanvia una concessió: el receptor passa a ser membre de l'àmbit.
 *
 * És idempotent per a qui ja hi és: tornar a obrir el mateix enllaç no ha de donar cap
 * error ni gastar un ús. El que passa dues vegades és una recàrrega, no un atac.
 */
export async function redeemGrant(
  ctx: AuditContext,
  principal: Principal,
  token: string,
  pepper: string,
): Promise<RedeemResult> {
  const found = await sql<GrantRow & { scope_name: string | null }>`
    SELECT ${G}, s.name AS scope_name
    FROM grants g
    LEFT JOIN scopes s ON s.id = g.subject_id AND g.subject_type = 'scope'
    WHERE g.token_hmac = ${tokenHmac(token, pepper)}
  `.execute(ctx.tx);

  const grant = found.rows[0];
  if (grant === undefined || grant.subject_id === null || grant.scope_name === null) {
    throw invalidGrant();
  }

  const scopeId = grant.subject_id;
  const role = grant.role ?? 'collaborator';

  // Pel predicat únic, no per una consulta pròpia: és el que fa que no hi hagi una
  // setena còpia de "qui pertany a un àmbit".
  const already = await roleOf(ctx.tx, principal.userId, scopeId);

  const owner = await sql<{ owner_id: string }>`
    SELECT owner_id FROM scopes WHERE id = ${scopeId} AND deleted_at IS NULL
  `.execute(ctx.tx);
  if (owner.rows[0] === undefined) throw invalidGrant();

  /**
   * **Qui ja hi és, hi és.**
   *
   * Es mira ABANS que l'estat del convit: un d'un sol ús queda exhaurit en acceptar-lo,
   * i tornar a obrir l'enllaç —una recàrrega, un botó enrere— donaria un 404 que sembla
   * que la cosa no ha funcionat. No filtra res: per arribar aquí ja s'ha de ser membre.
   */
  if (already !== null || owner.rows[0].owner_id === principal.userId) {
    ctx.noChange();
    return { scope_id: scopeId, scope_name: grant.scope_name, role };
  }

  // I per entrar-hi de nou, el convit ha d'estar obert.
  if (!isOpen(grant, ctx.now)) throw invalidGrant();

  /**
   * **Un àmbit compartit és col·lectiu.** Si el propietari va emetre el convit des d'un
   * àmbit individual, acceptar-lo l'ha de convertir: si no, la persona hi entraria i les
   * tasques se li assignarien soles al propietari (`docs/01` §4).
   */
  await sql`
    UPDATE scopes SET kind = 'collective', updated_at = ${ctx.now}, version = version + 1
    WHERE id = ${scopeId} AND kind = 'individual'
  `.execute(ctx.tx);

  await joinScope(ctx, scopeId, principal.userId, role as ScopeRole);

  await sql`
    UPDATE grants SET use_count = use_count + 1, last_used_at = ${ctx.now},
                      first_used_at = COALESCE(first_used_at, ${ctx.now})
    WHERE id = ${grant.id}
  `.execute(ctx.tx);

  ctx.record({
    entityType: 'scope_member',
    entityId: `${scopeId}:${principal.userId}`,
    scopeId,
    verb: 'joined',
  });

  return { scope_id: scopeId, scope_name: grant.scope_name, role };
}

/** Les concessions obertes d'un àmbit, per ensenyar-les a qui mana. */
export async function listGrants(
  db: MigrationDb,
  principal: Principal,
  scopeId: string,
): Promise<GrantRow[]> {
  if (!hasCapability(principal, 'scopes:read')) throw missingCapability('scopes:read');
  await assertScopeRole(db, principal, scopeId, 'membership');

  const rows = await sql<GrantRow>`
    SELECT ${GRANT_COLUMNS} FROM grants
    WHERE subject_type = 'scope' AND subject_id = ${scopeId} AND revoked_at IS NULL
    ORDER BY created_at DESC
  `.execute(db);
  return rows.rows;
}

export async function revokeGrant(
  ctx: AuditContext,
  principal: Principal,
  grantId: string,
): Promise<void> {
  if (!hasCapability(principal, 'scopes:share')) throw missingCapability('scopes:share');

  const found = await sql<GrantRow>`
    SELECT ${GRANT_COLUMNS} FROM grants WHERE id = ${grantId}
  `.execute(ctx.tx);
  const grant = found.rows[0];
  if (grant === undefined || grant.subject_id === null) throw invalidGrant();

  await assertScopeRole(ctx.tx, principal, grant.subject_id, 'membership');

  if (grant.revoked_at !== null) {
    ctx.noChange();
    return;
  }

  await sql`UPDATE grants SET revoked_at = ${ctx.now} WHERE id = ${grantId}`.execute(ctx.tx);
  ctx.record({
    entityType: 'scope',
    entityId: grant.subject_id,
    scopeId: grant.subject_id,
    verb: 'revoked',
  });
}
