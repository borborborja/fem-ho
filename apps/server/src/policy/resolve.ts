/**
 * Resolutor de principals. docs/05 §1.
 *
 * Converteix una petició HTTP en un `Principal`. **És l'únic lloc del projecte on es
 * mira una credencial.** A partir d'aquí, tot el codi treballa amb el principal i no
 * sap ni li importa si ha entrat una persona amb galeta, una app amb Bearer o una IA
 * amb un token d'abast limitat (regla 8).
 *
 * Els àmbits d'un token es resolen aquí i no a cada consulta: `principal.scopeIds` ja
 * arriba filtrat i intersecat amb els àmbits que el propietari pot veure de veritat.
 * Un token mai supera els permisos de qui el va crear (docs/05 §2).
 */

import { sql } from 'kysely';
import type { Source } from '@fem-ho/contracts';
import type { MigrationDb } from '../db/migration-db.js';
import { isTrue } from '../db/bool.js';
import { visibleScopeIds } from './scope-visibility.js';
import { hashToken, isApiToken } from '../auth/tokens.js';
import { capabilitiesForRole, isCapability, type Capability } from './capabilities.js';
import { unauthenticated } from './errors.js';
import type { Principal } from './principal.js';

interface UserRow {
  id: string;
  role: 'admin' | 'member';
  kind: 'human' | 'ai' | 'caldav_only' | 'remote';
  name: string;
  deleted_at: string | null;
}

interface TokenRow {
  id: string;
  user_id: string;
  ai_agent_id: string | null;
  capabilities: string;
  scope_ids: string | null;
  expires_at: string | null;
  revoked_at: string | null;
}

/**
 * Els àmbits que un usuari pot veure.
 *
 * Delega al predicat únic. Abans era la quarta còpia del mateix SQL, i és **la còpia que
 * fa mal si divergeix**: el que no surti d'aquí, `intersectScopes` l'esborra en silenci.
 */
export async function scopeIdsOwnedBy(tx: MigrationDb, userId: string): Promise<Set<string>> {
  return visibleScopeIds(tx, userId);
}

export interface ResolveInput {
  /** El valor cru de l'Authorization, si n'hi ha. */
  authorization?: string | undefined;
  /** El token de sessió de la galeta, si n'hi ha. */
  sessionToken?: string | undefined;
  source: Source;
  now: string;
}

/**
 * Resol un token d'API a un principal.
 *
 * Aquí és on es materialitza la regla 9: les capacitats i els àmbits surten del
 * **registre del token**, no de cap scope d'OAuth.
 */
export async function resolveApiToken(
  tx: MigrationDb,
  token: string,
  source: Source,
  now: string,
): Promise<Principal> {
  const hash = hashToken(token);
  const found = await sql<TokenRow>`
    SELECT id, user_id, ai_agent_id, capabilities, scope_ids, expires_at, revoked_at
    FROM api_tokens WHERE token_hash = ${hash}
  `.execute(tx);

  const row = found.rows[0];
  // Un token inexistent i un de revocat donen exactament la mateixa resposta: si no,
  // es poden enumerar tokens (el mateix principi que docs/10 §4 per als compartits).
  if (row === undefined || row.revoked_at !== null) throw unauthenticated('Token no vàlid.');
  if (row.expires_at !== null && Date.parse(row.expires_at) <= Date.parse(now)) {
    throw unauthenticated('El token ha caducat.');
  }

  const owner = await loadUser(tx, row.user_id);
  if (owner === null) throw unauthenticated('Token no vàlid.');

  const declared = parseCapabilities(row.capabilities);
  // El token no pot superar el seu propietari: s'interseca amb el que el rol permet.
  const allowedByRole = new Set(capabilitiesForRole(owner.role));
  const capabilities = new Set([...declared].filter((c) => allowedByRole.has(c)));

  const ownerScopes = await scopeIdsOwnedBy(tx, owner.id);
  const scopeIds = intersectScopes(row.scope_ids, ownerScopes);

  await sql`UPDATE api_tokens SET last_used_at = ${now} WHERE id = ${row.id}`.execute(tx);

  if (row.ai_agent_id !== null) {
    const agent = await sql<{
      on_behalf_of_user_id: string;
      name: string;
      enabled: number;
      all_scopes: unknown;
    }>`
      SELECT on_behalf_of_user_id, name, enabled, all_scopes
      FROM ai_agents WHERE id = ${row.ai_agent_id}
    `.execute(tx);
    const a = agent.rows[0];
    if (a === undefined || a.enabled === 0) throw unauthenticated("L'agent no està actiu.");

    /**
     * **L'agent no arriba més enllà dels seus àmbits, i es decideix aquí.**
     *
     * Un àmbit té un sol agent (migració 016), i la manera de fer-ho valer a tot arreu
     * alhora és acotar-li el principal: `next_task`, `list_tasks`, `get_task` i la resta
     * ja respecten `scopeIds`, o sigui que no cal tocar-ne cap ni hi ha una segona còpia
     * de la regla que un dia divergeixi.
     *
     * Amb `all_scopes` no s'acota res més: es queda amb el que ja tenia el token, que és
     * la intersecció amb el que veu la persona en nom de qui actua. Sense àmbits
     * assignats, el conjunt queda **buit** i l'agent no veu res —que és el correcte: un
     * agent acabat de crear encara no és de ningú.
     */
    let abast = scopeIds;
    if (!isTrue(a.all_scopes)) {
      const assignats = await sql<{ scope_id: string }>`
        SELECT scope_id FROM agent_scopes WHERE agent_id = ${row.ai_agent_id}
      `.execute(tx);
      const seus = new Set(assignats.rows.map((r) => r.scope_id));
      abast = scopeIds === null ? seus : new Set([...scopeIds].filter((id) => seus.has(id)));
    }

    return {
      kind: 'agent',
      // L'agent actua SEMPRE en nom d'una persona (D5). La responsabilitat es queda
      // amb ella, i és el seu identificador el que va a l'historial.
      userId: a.on_behalf_of_user_id,
      agentId: row.ai_agent_id,
      capabilities,
      scopeIds: abast,
      source,
      label: `IA · ${a.name}`,
    };
  }

  return { kind: 'user', userId: owner.id, capabilities, scopeIds, source };
}

/** Resol una sessió activa a un principal d'usuari amb totes les seves capacitats. */
export async function resolveSession(
  tx: MigrationDb,
  sessionId: string,
  source: Source,
  now: string,
): Promise<Principal> {
  const found = await sql<{ user_id: string; expires_at: string; revoked_at: string | null }>`
    SELECT user_id, expires_at, revoked_at FROM sessions WHERE id = ${sessionId}
  `.execute(tx);

  const row = found.rows[0];
  if (row === undefined || row.revoked_at !== null) throw unauthenticated('Sessió no vàlida.');
  if (Date.parse(row.expires_at) <= Date.parse(now)) throw unauthenticated('La sessió ha caducat.');

  const user = await loadUser(tx, row.user_id);
  if (user === null) throw unauthenticated('Sessió no vàlida.');

  // Una sessió no és un token d'abast limitat: qui ha entrat amb la seva contrasenya
  // pot fer tot el que el seu rol li permet, a tots els seus àmbits.
  return {
    kind: 'user',
    userId: user.id,
    capabilities: new Set(capabilitiesForRole(user.role)),
    scopeIds: null,
    source,
  };
}

async function loadUser(tx: MigrationDb, userId: string): Promise<UserRow | null> {
  const found = await sql<UserRow>`
    SELECT id, role, kind, name, deleted_at FROM users WHERE id = ${userId}
  `.execute(tx);
  const row = found.rows[0];
  if (row === undefined || row.deleted_at !== null) return null;
  /**
   * Qui pot ser el propietari d'un token d'API.
   *
   * Un usuari `ai` no té credencials i un `caldav_only` només té una app password de
   * CalDAV (`docs/01` §2): cap dels dos entra per aquí.
   *
   * **Un `remote` sí**, i és tot el que la federació necessita d'aquesta capa. És
   * l'usuari ombra d'una altra instància, i la seva única credencial és exactament un
   * `api_token` —no té correu ni contrasenya, o sigui que no pot entrar per la porta de
   * davant ni per la de CalDAV—. Deixar-lo passar aquí és el que fa que un servidor remot
   * sigui un client d'API més i que no calgui un segon camí d'autorització, que és el que
   * la regla 8 prohibeix.
   */
  if (row.kind !== 'human' && row.kind !== 'remote') return null;
  return row;
}

function parseCapabilities(raw: string): Set<Capability> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return new Set();
  }
  if (!Array.isArray(parsed)) return new Set();
  return new Set(parsed.filter((c): c is Capability => typeof c === 'string' && isCapability(c)));
}

/**
 * `scope_ids` a null vol dir "tots els àmbits del propietari", no de la instància.
 * Si en porta, s'interseca: un àmbit que el propietari ha perdut no reviu perquè el
 * token encara l'anomeni.
 */
function intersectScopes(raw: string | null, ownerScopes: Set<string>): Set<string> | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return new Set();
  }
  if (!Array.isArray(parsed)) return new Set();
  return new Set(
    parsed.filter((id): id is string => typeof id === 'string' && ownerScopes.has(id)),
  );
}

/** Treu el token d'una capçalera `Authorization: Bearer …`. */
export function bearerFrom(authorization: string | undefined): string | null {
  if (authorization === undefined) return null;
  const m = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return m === null ? null : m[1]!.trim();
}

export { isApiToken };
