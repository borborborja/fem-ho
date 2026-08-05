/**
 * El principal. docs/05 §1.
 *
 * Regla 8: **no es dupliquen lògiques entre l'API d'usuari i la d'IA.** Hi ha un motor
 * de decisió. Cada petició es resol a un principal amb un conjunt de capacitats, i un
 * token d'IA i un d'usuari travessen exactament el mateix codi: només difereix el
 * principal amb què hi entren.
 */

import type { Source } from '@fem-ho/contracts';
import type { Capability } from './capabilities.js';

export type PrincipalKind = 'user' | 'agent' | 'guest';

export interface Principal {
  kind: PrincipalKind;
  /** Identitat efectiva. Per a un agent, la persona en nom de qui actua. */
  userId: string;
  /** Present si kind = 'agent'. */
  agentId?: string;
  /** Present si kind = 'guest'. */
  shareId?: string;
  capabilities: ReadonlySet<Capability>;
  /**
   * Àmbits accessibles, o `null` per a tots els del propietari.
   *
   * `null` vol dir tots els àmbits **del propietari**, no de la instància: un token
   * mai supera els permisos de qui el va crear (docs/05 §2).
   */
  scopeIds: ReadonlySet<string> | null;
  /**
   * El canal. Es propaga fins a activity_log sense que cap servei l'hagi de passar a
   * mà (docs/05 §1).
   */
  source: Source;
  /** Etiqueta llegible per a l'historial: "Extern · Marta", "IA · Claude". */
  label?: string;
}

export function hasCapability(principal: Principal, capability: Capability): boolean {
  return principal.capabilities.has(capability);
}

/** Un principal pot veure aquest àmbit? `scopeIds` a null vol dir tots els seus. */
export function canSeeScope(principal: Principal, scopeId: string): boolean {
  return principal.scopeIds === null || principal.scopeIds.has(scopeId);
}

/** Els àmbits que pot veure, o null si són tots els seus. */
export function visibleScopeIds(principal: Principal): ReadonlySet<string> | null {
  return principal.scopeIds;
}
