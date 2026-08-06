/**
 * Tokens d'API (docs/05 §2).
 *
 * **Es guarden només com a hash.** El token sencer es retorna un sol cop en crear-lo i
 * no es pot recuperar: si l'usuari el perd, n'ha de crear un de nou, i això se li ha de
 * dir clarament en aquell moment.
 *
 * Les capacitats i els àmbits van **al registre del token, no a scopes d'OAuth**
 * (regla 9). Un token mai supera els permisos de qui el va crear.
 */

import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { generateApiToken } from '../auth/tokens.js';
import type { AuditContext } from '../audit/audited-transaction.js';
import type { MigrationDb } from '../db/migration-db.js';
import { PolicyError, missingCapability } from '../policy/errors.js';
import { capabilitiesForRole, isCapability, type Capability } from '../policy/capabilities.js';
import { hasCapability, type Principal } from '../policy/principal.js';

export interface ApiTokenSummary {
  id: string;
  name: string;
  token_prefix: string;
  capabilities: string[];
  scope_ids: string[];
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
}

interface TokenRow {
  id: string;
  name: string;
  token_prefix: string;
  capabilities: string;
  scope_ids: string | null;
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
}

function toSummary(row: TokenRow): ApiTokenSummary {
  return {
    id: row.id,
    name: row.name,
    token_prefix: row.token_prefix,
    capabilities: JSON.parse(row.capabilities) as string[],
    scope_ids: row.scope_ids === null ? [] : (JSON.parse(row.scope_ids) as string[]),
    created_at: row.created_at,
    expires_at: row.expires_at,
    last_used_at: row.last_used_at,
    revoked_at: row.revoked_at,
  };
}

export async function listTokens(
  db: MigrationDb,
  principal: Principal,
): Promise<ApiTokenSummary[]> {
  if (!hasCapability(principal, 'tokens:manage')) throw missingCapability('tokens:manage');

  const found = await sql<TokenRow>`
    SELECT id, name, token_prefix, capabilities, scope_ids, created_at, expires_at,
           last_used_at, revoked_at
    FROM api_tokens WHERE user_id = ${principal.userId}
    ORDER BY created_at DESC
  `.execute(db);

  return found.rows.map(toSummary);
}

export interface CreateTokenInput {
  name: string;
  capabilities: string[];
  scope_ids?: string[] | undefined;
  expires_at?: string | null | undefined;
}

export async function createToken(
  ctx: AuditContext,
  principal: Principal,
  input: CreateTokenInput,
): Promise<{ token: string; summary: ApiTokenSummary }> {
  if (!hasCapability(principal, 'tokens:manage')) throw missingCapability('tokens:manage');

  if (input.name.trim() === '') {
    throw new PolicyError(
      'name-required',
      'Name required',
      422,
      "Un token sense nom no es pot distingir dels altres a la llista, i llavors no se'n pot revocar cap amb confiança.",
    );
  }

  const demanades = input.capabilities.filter((capability): capability is Capability =>
    isCapability(capability),
  );
  if (demanades.length === 0) {
    throw new PolicyError(
      'capabilities-required',
      'Capabilities required',
      422,
      'Un token sense cap capacitat no pot fer res: tria almenys una.',
    );
  }

  /**
   * **Un token mai supera els permisos de qui el crea** (docs/05 §2). Es retallen en
   * comptes de rebutjar-ho: qui crea un token per a un agent no ha de saber de memòria
   * quines capacitats té el seu propi rol.
   */
  const meves = new Set(capabilitiesForRole(principal.kind === 'user' ? 'admin' : 'member'));
  const concedides = demanades.filter((capability) => meves.has(capability));
  if (concedides.length === 0) {
    throw new PolicyError(
      'capabilities-exceeded',
      'Capabilities exceeded',
      403,
      'Cap de les capacitats demanades és teva: un token no pot fer més que qui el crea.',
    );
  }

  const generated = generateApiToken();
  const id = uuidv7();
  const scopeIds = input.scope_ids ?? [];

  await sql`
    INSERT INTO api_tokens (id, user_id, name, token_prefix, token_hash, capabilities,
                            scope_ids, expires_at, created_at)
    VALUES (${id}, ${principal.userId}, ${input.name.trim()}, ${generated.prefix},
            ${generated.hash}, ${JSON.stringify(concedides)}, ${JSON.stringify(scopeIds)},
            ${input.expires_at ?? null}, ${ctx.now})
  `.execute(ctx.tx);

  ctx.record({
    entityType: 'api_token',
    entityId: id,
    scopeId: null,
    verb: 'token_created',
    // El token en clar **no** entra a l'historial. Ni el hash: el prefix ja identifica
    // quin és, i és el que la llista ensenya.
    changes: {
      name: { from: null, to: input.name.trim() },
      prefix: { from: null, to: generated.prefix },
    },
  });

  const summary: ApiTokenSummary = {
    id,
    name: input.name.trim(),
    token_prefix: generated.prefix,
    capabilities: concedides,
    scope_ids: scopeIds,
    created_at: ctx.now,
    expires_at: input.expires_at ?? null,
    last_used_at: null,
    revoked_at: null,
  };

  return { token: generated.token, summary };
}

export async function revokeToken(
  ctx: AuditContext,
  principal: Principal,
  id: string,
): Promise<void> {
  if (!hasCapability(principal, 'tokens:manage')) throw missingCapability('tokens:manage');

  const found = await sql<{ name: string; revoked_at: string | null }>`
    SELECT name, revoked_at FROM api_tokens WHERE id = ${id} AND user_id = ${principal.userId}
  `.execute(ctx.tx);

  const row = found.rows[0];
  if (row === undefined) {
    throw new PolicyError('not-found', 'Not found', 404, 'Aquest token no existeix.');
  }
  if (row.revoked_at !== null) {
    // Revocar dues vegades no és un error: el resultat és el que l'usuari volia.
    ctx.noChange();
    return;
  }

  await sql`UPDATE api_tokens SET revoked_at = ${ctx.now} WHERE id = ${id}`.execute(ctx.tx);

  ctx.record({
    entityType: 'api_token',
    entityId: id,
    scopeId: null,
    verb: 'token_revoked',
    changes: { name: { from: row.name, to: null } },
  });
}
