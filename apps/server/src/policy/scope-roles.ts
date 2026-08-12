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

export const SCOPE_ROLES = ['owner', 'admin', 'collaborator', 'viewer'] as const;
export type ScopeRole = (typeof SCOPE_ROLES)[number];

/**
 * **`admin` va desaparèixer i ha tornat, i és la mateixa regla.**
 *
 * La 008 el va treure perquè llavors no feia res que `owner` no fes, i «un rol que no fa
 * res diferent és pitjor que no tenir-ne: dona la sensació que hi ha una barrera on no
 * n'hi ha». Ara fa dues coses que `collaborator` no pot i que `owner` no hauria de ser
 * l'únic a poder: **convidar i configurar l'àmbit**, i **veure la dedicació de tothom**.
 * El que segueix sense poder és esborrar l'àmbit, que és el que el distingeix del
 * propietari.
 *
 * `member` es diu `collaborator`. "Membre" ja és el nom de la fila (`scope_members`,
 * `listMembers`); un rol dit `member` dins d'una taula de membres és exactament la
 * col·lisió de vocabulari que la regla 3 existeix per evitar.
 */
export type ScopeAction =
  /** Llegir l'àmbit i el que hi ha dins. */
  | 'read'
  /** Crear, editar i completar tasques, esdeveniments, llistes i comentaris. */
  | 'content'
  /**
   * Veure el Registre i les Estadístiques **de tot l'àmbit**, i no només els blocs propis.
   *
   * És una acció a part i no un tros de `read` perquè el que es mira és **la dedicació de la
   * gent**: qui col·labora en un àmbit hi veu les tasques, i que això inclogui quantes hores
   * hi ha dedicat cadascú és una altra decisió, que la pren qui mana a l'àmbit.
   */
  | 'reports'
  /** Convidar, expulsar i canviar rols. */
  | 'membership'
  /** Nom, color, icona, `kind`, i què es comparteix. */
  | 'settings'
  /** Esborrar l'àmbit sencer. */
  | 'delete'
  /** Treure's un mateix de l'àmbit. */
  | 'leave';

const MATRIX: Record<ScopeRole, ReadonlySet<ScopeAction>> = {
  owner: new Set<ScopeAction>(['read', 'content', 'reports', 'membership', 'settings', 'delete']),
  /**
   * Tot menys esborrar l'àmbit i sortir-ne.
   *
   * No pot `leave` perquè seria una porta del darrere: qui pot canviar rols pot treure's a
   * ell mateix el rol i marxar per la porta de `collaborator`, i llavors sortir sense
   * deixar-ho dit és un pas de menys que no aporta res.
   */
  admin: new Set<ScopeAction>(['read', 'content', 'reports', 'membership', 'settings']),
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
