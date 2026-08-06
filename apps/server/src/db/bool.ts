/**
 * Booleans que serveixen als dos motors.
 *
 * A SQLite un booleà és un INTEGER 0/1; a Postgres és un `boolean` de veritat (docs/01,
 * `dialect.ts`). En **llegir** això ja està resolt: `connection.ts` instal·la un
 * conversor que fa que Postgres torni 0/1 com SQLite. En **escriure**, no ho estava:
 *
 * ```
 * UPDATE subtasks SET done = 1 WHERE done = 0
 * ```
 *
 * és correcte a SQLite i a Postgres és un error dur —`operator does not exist: boolean
 * = integer`—, i el mateix passa lligant un paràmetre `${done ? 1 : 0}` a una columna
 * booleana. Tot el camí de llistes senzilles, la cascada de subtasques i les tasques
 * per CalDAV feien exactament això: funcionaven a SQLite i petaven a Postgres, i cap
 * prova ho veia perquè la capa de servei només s'executava contra SQLite.
 *
 * `CAST(? AS BOOLEAN)` funciona igual als dos: a SQLite, `BOOLEAN` té afinitat numèrica
 * i el valor queda 0/1; a Postgres, el paràmetre viatja com a text i `'1'::boolean` és
 * cert. Comprovat contra tots dos motors abans d'escriure-ho aquí.
 */

import { sql } from 'kysely';

/** Un booleà per lligar o comparar en SQL, vàlid als dos motors. */
export function dbBool(value: boolean): ReturnType<typeof sql> {
  return sql`CAST(${value ? 1 : 0} AS BOOLEAN)`;
}

/** El que torna la base, normalitzat. Postgres dona 0/1, però els fixtures donen booleans. */
export function isTrue(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 't';
}
