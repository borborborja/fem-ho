/**
 * Capacitats. docs/05 §2.
 *
 * Una capacitat és `recurs:acció`. Un token en porta un conjunt **i** una llista
 * d'àmbits, i les dues coses són independents: "pot escriure tasques" i "només a
 * l'àmbit Feina" es combinen.
 *
 * Regla 9: els permisos per àmbit **no** van a les scopes d'OAuth. Les scopes d'OAuth
 * han de ser un conjunt petit i estàtic; els àmbits són dades que l'usuari crea i
 * esborra. Van al registre del token.
 */

export const CAPABILITIES = [
  'tasks:read',
  'tasks:write',
  'tasks:delete',
  'events:read',
  'events:write',
  'events:delete',
  'checklists:read',
  'checklists:write',
  'comments:read',
  'comments:write',
  'attachments:read',
  'attachments:write',
  'projects:read',
  'projects:write',
  'scopes:read',
  'scopes:write',
  'shares:read',
  'shares:write',
  'tokens:manage',
  'users:manage',
  'instance:manage',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

const CAPABILITY_SET: ReadonlySet<string> = new Set(CAPABILITIES);

export function isCapability(value: string): value is Capability {
  return CAPABILITY_SET.has(value);
}

/**
 * Les capacitats d'un usuari humà amb sessió de navegador o d'app.
 *
 * Una sessió no és un token d'abast limitat: qui ha entrat amb la seva contrasenya pot
 * fer tot el que el seu rol li permet. El que es limita amb capacitats són els tokens
 * (integracions, MCP, IA), que és on viu el risc que la regla 9 vol acotar.
 */
export function capabilitiesForRole(role: 'admin' | 'member'): Capability[] {
  const base = CAPABILITIES.filter(
    (c) => c !== 'users:manage' && c !== 'instance:manage',
  ) as Capability[];
  return role === 'admin' ? [...CAPABILITIES] : base;
}

/**
 * Grups predefinits per a la UI de tokens (docs/08 §5: "només lectura, lectura i
 * escriptura, o personalitzat").
 */
export const CAPABILITY_PRESETS = {
  read_only: CAPABILITIES.filter((c) => c.endsWith(':read')),
  read_write: CAPABILITIES.filter((c) => c.endsWith(':read') || c.endsWith(':write')),
} as const satisfies Record<string, readonly Capability[]>;
