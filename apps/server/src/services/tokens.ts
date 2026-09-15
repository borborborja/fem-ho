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
import { isTrue } from '../db/bool.js';
import { v7 as uuidv7 } from 'uuid';
import { generateApiToken } from '../auth/tokens.js';
import type { AuditContext } from '../audit/audited-transaction.js';
import type { MigrationDb } from '../db/migration-db.js';
import { PolicyError, missingCapability } from '../policy/errors.js';
import { isCapability, type Capability } from '../policy/capabilities.js';
import { hasCapability, type Principal } from '../policy/principal.js';
import { requireHumanSession } from './external-access.js';
import { visibleScopeIds } from '../policy/scope-visibility.js';

export interface ApiTokenSummary {
  channels: string[];
  credential_type: 'pat' | 'oauth';
  id: string;
  name: string;
  token_prefix: string;
  capabilities: string[];
  /** De quin agent és, o `null` si és una credencial teva. */
  ai_agent_id: string | null;
  scope_ids: string[];
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
}

interface TokenRow {
  channels: string;
  credential_type: 'pat' | 'oauth';
  id: string;
  name: string;
  token_prefix: string;
  capabilities: string;
  ai_agent_id: string | null;
  scope_ids: string | null;
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
}

function toSummary(row: TokenRow): ApiTokenSummary {
  return {
    channels: JSON.parse(row.channels) as string[],
    credential_type: row.credential_type,
    id: row.id,
    name: row.name,
    token_prefix: row.token_prefix,
    capabilities: JSON.parse(row.capabilities) as string[],
    /**
     * De quin agent és, si ho és.
     *
     * La pantalla d'MCP i API les ensenya **en només lectura i amb un botó que hi porta**:
     * sense això, hi hauria credencials que existeixen i no surten enlloc d'on la gent les
     * busca, i qui en volgués revocar una no sabria on anar.
     */
    ai_agent_id: row.ai_agent_id,
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
  requireHumanSession(principal);
  if (!hasCapability(principal, 'tokens:manage')) throw missingCapability('tokens:manage');

  const found = await sql<TokenRow>`
    SELECT id, name, token_prefix, capabilities, ai_agent_id, scope_ids, created_at,
           expires_at, last_used_at, revoked_at, channels, credential_type
    FROM api_tokens WHERE user_id = ${principal.userId}
    ORDER BY created_at DESC
  `.execute(db);

  return found.rows.map(toSummary);
}

export interface CreateTokenInput {
  channels?: string[] | undefined;
  credential_type?: 'pat' | 'oauth';
  name: string;
  capabilities: string[];
  scope_ids?: string[] | undefined;
  expires_at?: string | null | undefined;
  /**
   * La credencial **és d'aquest agent**: qui la faci servir actua com ell.
   *
   * No arriba mai del cos d'una petició a `/tokens`: la posa el camí de sota d'un agent
   * (`POST /ai/agents/{id}/credentials`), que abans comprova que l'agent sigui d'aquesta
   * persona. Deixar-lo passar per la porta general voldria dir acceptar-hi un
   * identificador d'agent qualsevol i haver-lo de tornar a comprovar allà.
   */
  ai_agent_id?: string | undefined;
}

export function credentialCapabilities(raw: unknown): string[] {
  const allowed = [
    'tasks:read',
    'tasks:write',
    // Les instruccions de l'àmbit i del projecte manen sobre el seu criteri, i
    // per llegir-les cal poder llegir els àmbits: sense això `get_briefing` —la
    // segona crida que fa un agent— responia «no tens la capacitat».
    'scopes:read',
    'projects:read',
    'checklists:read',
    'checklists:write',
    'comments:read',
    'comments:write',
    'attachments:read',
    'events:read',
  ];
  if (raw === undefined) return allowed;
  if (
    !Array.isArray(raw) ||
    raw.length === 0 ||
    raw.some((c) => typeof c !== 'string' || !allowed.includes(c))
  )
    throw new PolicyError(
      'invalid-capabilities',
      'Invalid capabilities',
      422,
      'Select capabilities available to an AI agent.',
    );
  return raw as string[];
}

async function validateToken(ctx: AuditContext, principal: Principal, input: CreateTokenInput) {
  requireHumanSession(principal);
  if (!hasCapability(principal, 'tokens:manage')) throw missingCapability('tokens:manage');

  if (typeof input.name !== 'string' || input.name.trim() === '' || input.name.length > 120) {
    throw new PolicyError(
      'name-required',
      'Name required',
      422,
      'A token with no name cannot be told apart from the others in the list, and then none can be revoked with confidence.',
    );
  }

  if (!Array.isArray(input.capabilities) || input.capabilities.some((c) => !isCapability(c)))
    throw new PolicyError(
      'invalid-capabilities',
      'Invalid capabilities',
      422,
      'Unknown capability.',
    );
  const demanades = input.capabilities.filter((capability): capability is Capability =>
    isCapability(capability),
  );
  if (demanades.length === 0) {
    throw new PolicyError(
      'capabilities-required',
      'Capabilities required',
      422,
      'A token with no capabilities cannot do anything: pick at least one.',
    );
  }

  // Rebutjar evita que el resum prometi permisos diferents dels demanats.
  const meves = principal.capabilities;
  const concedides = demanades.filter((capability) => meves.has(capability));
  if (concedides.length !== demanades.length) {
    throw new PolicyError(
      'capabilities-exceeded',
      'Capabilities exceeded',
      403,
      'None of the requested capabilities are yours: a token cannot do more than whoever creates it.',
    );
  }

  if (input.ai_agent_id !== undefined) credentialCapabilities(input.capabilities);

  // Una credencial antiga d'agent pot heretar; una selecció explícita només l'acota.
  const scopeIds =
    input.ai_agent_id !== undefined && input.scope_ids === undefined
      ? null
      : (input.scope_ids ?? []);
  if (scopeIds !== null) {
    const visible = await visibleScopeIds(ctx.tx, principal.userId);
    if (
      !Array.isArray(scopeIds) ||
      scopeIds.length === 0 ||
      scopeIds.some((id) => typeof id !== 'string' || !visible.has(id))
    )
      throw new PolicyError(
        'invalid-token-scopes',
        'Select accessible scopes',
        422,
        'Select at least one scope you can access.',
      );
    if (input.ai_agent_id !== undefined) {
      const assigned = await sql<{
        scope_id: string;
      }>`SELECT scope_id FROM agent_scopes WHERE agent_id = ${input.ai_agent_id}`.execute(ctx.tx);
      const agent = await sql<{
        all_scopes: unknown;
      }>`SELECT all_scopes FROM ai_agents WHERE id = ${input.ai_agent_id} AND on_behalf_of_user_id = ${principal.userId}`.execute(
        ctx.tx,
      );
      if (
        !agent.rows[0] ||
        (!isTrue(agent.rows[0].all_scopes) &&
          scopeIds.some((id) => !assigned.rows.some((s) => s.scope_id === id)))
      )
        throw new PolicyError(
          'invalid-token-scopes',
          'Select agent scopes',
          422,
          'Select scopes assigned to this agent.',
        );
    }
  }
  const channels = input.channels ?? ['api', 'mcp'];
  if (
    !Array.isArray(channels) ||
    channels.length === 0 ||
    channels.some((c) => c !== 'api' && c !== 'mcp')
  )
    throw new PolicyError(
      'invalid-token-channels',
      'Invalid channels',
      422,
      'Select API, MCP or both.',
    );
  if (
    input.expires_at != null &&
    (typeof input.expires_at !== 'string' ||
      !Number.isFinite(Date.parse(input.expires_at)) ||
      Date.parse(input.expires_at) <= Date.parse(ctx.now))
  )
    throw new PolicyError(
      'invalid-token-expiry',
      'Invalid expiry',
      422,
      'Expiry must be in the future.',
    );

  return { scopeIds, channels, concedides };
}

export async function createToken(
  ctx: AuditContext,
  principal: Principal,
  input: CreateTokenInput,
): Promise<{ token: string; summary: ApiTokenSummary }> {
  const { scopeIds, channels, concedides } = await validateToken(ctx, principal, input);
  const generated = generateApiToken();
  const id = uuidv7();
  await sql`
    INSERT INTO api_tokens (id, user_id, name, token_prefix, token_hash, capabilities,
                            ai_agent_id, scope_ids, expires_at, created_at, channels, credential_type)
    VALUES (${id}, ${principal.userId}, ${input.name.trim()}, ${generated.prefix},
            ${generated.hash}, ${JSON.stringify(concedides)}, ${input.ai_agent_id ?? null},
            ${scopeIds === null ? null : JSON.stringify(scopeIds)},
            ${input.expires_at ?? null}, ${ctx.now}, ${JSON.stringify(channels)}, ${input.credential_type ?? 'pat'})
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
      scope_ids: { from: null, to: scopeIds },
      capabilities: { from: null, to: concedides },
      channels: { from: null, to: channels },
    },
  });

  const summary: ApiTokenSummary = {
    channels,
    credential_type: input.credential_type ?? 'pat',
    id,
    name: input.name.trim(),
    token_prefix: generated.prefix,
    capabilities: concedides,
    ai_agent_id: input.ai_agent_id ?? null,
    // Una credencial d'agent no en porta cap de propi: els hereta de l'agent.
    scope_ids: scopeIds ?? [],
    created_at: ctx.now,
    expires_at: input.expires_at ?? null,
    last_used_at: null,
    revoked_at: null,
  };

  return { token: generated.token, summary };
}

export async function updateToken(
  ctx: AuditContext,
  principal: Principal,
  id: string,
  input: Partial<CreateTokenInput>,
): Promise<ApiTokenSummary> {
  requireHumanSession(principal);
  const before = (await listTokens(ctx.tx, principal)).find((t) => t.id === id);
  if (!before) throw new PolicyError('not-found', 'Not found', 404, 'Unknown credential.');
  if (before.revoked_at !== null || before.credential_type === 'oauth')
    throw new PolicyError(
      'credential-not-editable',
      'Reconnect required',
      409,
      'Reconnect OAuth clients to change their consent.',
    );
  if (input.ai_agent_id !== undefined || input.credential_type !== undefined)
    throw new PolicyError(
      'invalid-token',
      'Invalid token',
      422,
      'Credential identity cannot change.',
    );
  const merged: CreateTokenInput = {
    name: input.name ?? before.name,
    capabilities: input.capabilities ?? before.capabilities,
    scope_ids: input.scope_ids ?? before.scope_ids,
    channels: input.channels ?? before.channels,
    expires_at: input.expires_at === undefined ? before.expires_at : input.expires_at,
    ...(before.ai_agent_id === null ? {} : { ai_agent_id: before.ai_agent_id }),
  };
  const { scopeIds, channels, concedides } = await validateToken(ctx, principal, merged);
  await sql`UPDATE api_tokens SET name = ${merged.name.trim()}, capabilities = ${JSON.stringify(concedides)},
    scope_ids = ${scopeIds === null ? null : JSON.stringify(scopeIds)}, channels = ${JSON.stringify(channels)}, expires_at = ${merged.expires_at ?? null}
    WHERE id = ${id} AND user_id = ${principal.userId}`.execute(ctx.tx);
  const after = {
    ...before,
    name: merged.name.trim(),
    capabilities: concedides,
    scope_ids: scopeIds ?? [],
    channels,
    expires_at: merged.expires_at ?? null,
  };
  ctx.record({
    entityType: 'api_token',
    entityId: id,
    verb: 'updated',
    changes: { permissions: { from: before, to: after } },
  });
  return after;
}

export async function revokeToken(
  ctx: AuditContext,
  principal: Principal,
  id: string,
): Promise<void> {
  requireHumanSession(principal);
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
