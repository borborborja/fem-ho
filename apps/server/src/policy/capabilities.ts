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
  // Emetre un convit no és el mateix poder que reanomenar un àmbit: un token
  // d'automatització que pot editar no ha de poder regalar-lo a un desconegut.
  'scopes:share',
  'shares:read',
  'shares:write',
  // El correu com a font d'entrada. Van al final i **fora dels dos predefinits**: veure
  // el motiu a `CAPABILITY_PRESETS`.
  'mail:read',
  'mail:write',
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
/**
 * **El correu no entra a cap predefinit, i s'exclou a mà.**
 *
 * Els predefinits es deriven filtrant pel sufix, o sigui que `mail:read` hi entraria sol
 * i «només lectura» —el que la gent tria sense pensar— donaria **la bústia sencera de
 * qui l'ha emès**. Un token de correu s'ha de triar a «personalitzat», sabent què es dona.
 *
 * És una llista i no un `endsWith` invertit perquè el dia que hi hagi Slack o Telegram,
 * la pregunta «això és tan sensible com el correu?» s'ha de respondre escrivint-hi el nom.
 */
const FORA_DELS_PREDEFINITS: readonly string[] = ['mail:read', 'mail:write'];

const perPredefinit = (sufixos: string[]): Capability[] =>
  CAPABILITIES.filter(
    (c) => sufixos.some((s) => c.endsWith(s)) && !FORA_DELS_PREDEFINITS.includes(c),
  );

export const CAPABILITY_PRESETS = {
  read_only: perPredefinit([':read']),
  read_write: perPredefinit([':read', ':write']),
} as const satisfies Record<string, readonly Capability[]>;
