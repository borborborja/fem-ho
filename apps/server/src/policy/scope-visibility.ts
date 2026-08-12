/**
 * L'ÚNIC predicat de pertinença del projecte.
 *
 * Fins avui n'hi havia **quatre còpies** del mateix SQL: `listScopes`,
 * `visibleScopeNames` i `assertScopeAccess` a `services/scopes.ts`, i `scopeIdsOwnedBy`
 * aquí a `policy/`. Amb àmbits compartits la pertinença deixa de ser trivial i quatre
 * còpies volen dir quatre oportunitats de divergir.
 *
 * **Tot camí que doni accés a un àmbit ha de ser una branca d'aquí i d'enlloc més.**
 * Si se n'afegeix un i no es posa aquí, `intersectScopes` (`resolve.ts`) l'esborrarà en
 * silenci: sense error, sense registre, i **només per als tokens amb abast**. O sigui que
 * passarà la prova manual amb el navegador i fallarà a Android i a MCP. Ho vigila la
 * comprovació permanent `scope-predicate`.
 *
 * Viu a `policy/` i no a `services/` perquè `resolve.ts` corre abans que cap servei i no
 * en pot importar cap; `services/scopes.ts` sí que importa `policy/`. La direcció està
 * forçada.
 */

import { sql, type RawBuilder } from 'kysely';
import type { MigrationDb } from '../db/migration-db.js';
import type { ScopeRole } from './scope-roles.js';

/**
 * El fragment de SQL, per incrustar en un `WHERE`.
 *
 * S'exporta el fragment i no només el conjunt d'identificadors perquè `listScopes` l'ha
 * de posar dins d'una consulta: amb un `Set` hauria de fer un `IN (…)` que creix sense
 * sostre i, sobretot, algú tornaria a escriure el `WHERE` a mà el dia que el conjunt li
 * anés incòmode.
 *
 * `alias` és el nom de la taula `scopes` a la consulta que l'incrusta.
 */
export function visibleScopesPredicate(userId: string, alias = 's'): RawBuilder<unknown> {
  const a = sql.raw(alias);
  return sql`(${a}.owner_id = ${userId}
              OR EXISTS (SELECT 1 FROM scope_members m
                         WHERE m.scope_id = ${a}.id AND m.user_id = ${userId}))`;
}

/** Els identificadors dels àmbits que aquest usuari pot veure. */
export async function visibleScopeIds(db: MigrationDb, userId: string): Promise<Set<string>> {
  const rows = await sql<{ id: string }>`
    SELECT s.id FROM scopes s
    WHERE s.deleted_at IS NULL AND ${visibleScopesPredicate(userId)}
  `.execute(db);
  return new Set(rows.rows.map((r) => r.id));
}

/**
 * Es reexporta de `scope-roles.ts` i no es torna a escriure: **la llista de rols viu en un
 * sol lloc**, que és el que evita que un rol nou existeixi a la matriu de permisos i no
 * aquí, i que qui el tingui es quedi sense res.
 */
export type { ScopeRole } from './scope-roles.js';

/**
 * El rol d'aquest usuari en aquest àmbit, o `null` si no hi és.
 *
 * **`owner_id` mana sempre**, hi hagi fila de membre o no i sigui quin sigui el `kind`.
 * Avui "ser propietari" surt de dos llocs —la columna i una fila de `scope_members` amb
 * `role='owner'`, que només es crea si l'àmbit és col·lectiu— i això és un segon predicat
 * duplicat. Aquí es resol un cop: els àmbits individuals no necessiten cap fila.
 */
export async function roleOf(
  db: MigrationDb,
  userId: string,
  scopeId: string,
): Promise<ScopeRole | null> {
  const found = await sql<{ owner_id: string }>`
    SELECT owner_id FROM scopes WHERE id = ${scopeId} AND deleted_at IS NULL
  `.execute(db);

  const scope = found.rows[0];
  if (scope === undefined) return null;
  if (scope.owner_id === userId) return 'owner';

  const member = await sql<{ role: string }>`
    SELECT role FROM scope_members WHERE scope_id = ${scopeId} AND user_id = ${userId}
  `.execute(db);

  const role = member.rows[0]?.role;
  if (role === undefined) return null;

  /**
   * Un valor que no coneixem cau a `collaborator`, que és el rol que **no mana**.
   *
   * És la direcció segura: una base amb un rol vell o inventat no ha de donar permisos que
   * ningú ha concedit. Els quatre que sí que coneixem es diuen aquí i enlloc més.
   */
  if (role === 'owner' || role === 'admin' || role === 'viewer') return role;
  return 'collaborator';
}
