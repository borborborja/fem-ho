/**
 * Quins calendaris d'un àmbit veu cadascú.
 *
 * Compartir un àmbit comparteix el kanban sencer —l'àmbit *és* el kanban— però **els
 * calendaris es trien un per un**: hi pot haver una font externa que el propietari no
 * vol cedir.
 *
 * EL PARANY, I ÉS EL PUNT MÉS DELICAT DE TOTA LA FUNCIÓ
 * -----------------------------------------------------
 * El filtre del sync és `change_log.scope_id`, i **un esdeveniment d'un calendari no
 * compartit porta igualment l'`scope_id` de l'àmbit**: els esdeveniments no en tenen de
 * propi, el treuen del calendari. O sigui que un filtre per àmbit sol el deixaria passar
 * cap al receptor.
 *
 * Les alternatives que s'han descartat:
 *
 * - **Donar `scope_id` als esdeveniments** duplica una veritat que ja és al calendari, i
 *   moure un calendari d'àmbit passaria a demanar un backfill de tots els seus.
 * - **Escriure `change_log.scope_id = NULL`** per als no compartits: `NULL` vol dir "no
 *   viatja mai", o sigui que el propietari deixaria de rebre els seus propis canvis.
 * - **Complicar el `WHERE`** amb una subconsulta per entitat: car i il·legible.
 *
 * El que es fa és un **post-filtre per principal**, un cop per pàgina.
 */

import { sql } from 'kysely';
import type { MigrationDb } from '../db/migration-db.js';
import { dbBool } from '../db/bool.js';
import { visibleScopesPredicate } from './scope-visibility.js';

/**
 * Els calendaris que aquest usuari pot veure.
 *
 * **Si l'àmbit és teu, tots.** Si no, només els marcats com a compartits. El propietari
 * no ha de perdre de vista els seus calendaris pel fet d'haver compartit l'àmbit.
 */
export async function visibleCalendarIds(db: MigrationDb, userId: string): Promise<Set<string>> {
  const rows = await sql<{ id: string }>`
    SELECT c.id
    FROM calendars c
    JOIN scopes s ON s.id = c.scope_id
    WHERE c.deleted_at IS NULL
      AND s.deleted_at IS NULL
      AND ${visibleScopesPredicate(userId)}
      AND (s.owner_id = ${userId} OR c.shared_with_scope = ${dbBool(true)})
  `.execute(db);
  return new Set(rows.rows.map((r) => r.id));
}
