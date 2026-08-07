/**
 * Qui pot fer què dins d'un àmbit.
 *
 * Fins avui `scope_members.role` es validava i **no governava res**: `viewer` i `member`
 * tenien exactament els mateixos permisos efectius, i qualsevol membre podia expulsar-ne
 * un altre. L'única comprovació real de propietat era a `deleteScope`.
 *
 * Amb àmbits compartits això deixa de ser acceptable, i la regla és la que va demanar
 * l'usuari: **col·labora, però no mana.**
 *
 * Una matriu i no una cascada d'`if`: amb sis accions i tres rols, la versió imperativa es
 * dispersa per mitja dotzena de funcions i la matriu es llegeix d'un cop.
 */

export const SCOPE_ROLES = ['owner', 'collaborator', 'viewer'] as const;
export type ScopeRole = (typeof SCOPE_ROLES)[number];

/**
 * `admin` desapareix. Res del que s'ha demanat necessita un graó entre "pot convidar" i
 * "no pot", i un rol que no fa res diferent és pitjor que no tenir-ne: dona la sensació
 * que hi ha una barrera on no n'hi ha.
 *
 * `member` passa a dir-se `collaborator`. "Membre" ja és el nom de la fila
 * (`scope_members`, `listMembers`); un rol dit `member` dins d'una taula de membres és
 * exactament la col·lisió de vocabulari que la regla 3 existeix per evitar.
 */
export type ScopeAction =
  /** Llegir l'àmbit i el que hi ha dins. */
  | 'read'
  /** Crear, editar i completar tasques, esdeveniments, llistes i comentaris. */
  | 'content'
  /** Convidar, expulsar i canviar rols. */
  | 'membership'
  /** Nom, color, icona, `kind`, i què es comparteix. */
  | 'settings'
  /** Esborrar l'àmbit sencer. */
  | 'delete'
  /** Treure's un mateix de l'àmbit. */
  | 'leave';

const MATRIX: Record<ScopeRole, ReadonlySet<ScopeAction>> = {
  owner: new Set<ScopeAction>(['read', 'content', 'membership', 'settings', 'delete']),
  collaborator: new Set<ScopeAction>(['read', 'content', 'leave']),
  viewer: new Set<ScopeAction>(['read', 'leave']),
};

export function roleCan(role: ScopeRole, action: ScopeAction): boolean {
  return MATRIX[role].has(action);
}

/**
 * El propietari **no pot sortir** del seu propi àmbit: el deixaria orfe. Ha d'esborrar-lo
 * o traspassar-lo, i se li ha de dir amb aquestes paraules.
 */
export function canLeave(role: ScopeRole): boolean {
  return roleCan(role, 'leave');
}
