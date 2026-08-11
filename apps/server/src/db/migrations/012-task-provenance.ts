/**
 * Migració 012 — d'on ve una tasca.
 *
 * PER QUÈ UNA COLUMNA I NO QUATRE
 * -------------------------------
 * La provinença ja existia, però **escampada en columnes específiques de cada mena**:
 * `event_calendar_id`, `event_uid` i `event_recurrence_id` diuen que una tasca ve d'un
 * esdeveniment. Amb el correu n'hi hauria tres més, i amb Slack i Telegram tres cadascun.
 *
 * La pregunta que cal respondre a la interfície és **una de sola** —«d'on ve això?»— i amb
 * aquella forma no es podia respondre sense mirar totes les columnes i endevinar quina
 * família n'omplia quina. Amb un valor canònic, afegir una font nova és un valor més a
 * `SOURCE_KINDS`, una icona més i una ingesta més: **mai una columna més aquí**.
 *
 * Les referències específiques es queden on són. Cada mena identifica el seu origen d'una
 * manera diferent —un esdeveniment amb `(calendari, uid, recurrència)`, un correu amb un
 * `Message-ID`— i aplanar-les en una columna polimòrfica faria que cap de les dues es
 * pogués consultar bé.
 *
 * NUL·LABLE, I SENSE VALOR PER A «HO VAS ESCRIURE TU»
 * ---------------------------------------------------
 * Una tasca que has escrit tu **no té provinença**. Posar-hi `'manual'` seria inventar una
 * font que no existeix i obligaria cada consulta futura a excloure-la explícitament. `NULL`
 * vol dir exactament el que sembla, i la icona es dibuixa quan hi ha valor.
 *
 * EL REBLIMENT
 * ------------
 * Les tasques que ja venen d'un esdeveniment són d'abans d'aquesta columna i es quedarien
 * sense icona per sempre. Se'ls hi posa la mena del calendari d'on van sortir. Un calendari
 * d'aquesta casa (`origin = 'local'`) no té `source_kind`, i llavors la tasca es queda sense
 * provinença: **ve d'un esdeveniment que has escrit tu, o sigui de tu**.
 */

import { sql } from 'kysely';
import { typeMap, type Engine } from '../dialect.js';
import type { MigrationDb } from '../migration-db.js';

export function ddl(engine: Engine): string[] {
  const t = typeMap(engine);
  return [
    /**
     * El `CHECK` no llista `mail`, i és a posta: aquesta migració no en sap res. La 013
     * l'amplia quan el correu existeix, i així cada migració diu la veritat del dia que es
     * va escriure.
     */
    `ALTER TABLE tasks ADD COLUMN source_kind ${t.text}
       CHECK (source_kind IN ('caldav', 'ical', 'rss'))`,

    /**
     * Parcial: la immensa majoria de tasques les escriu una persona i no han d'ocupar
     * índex. Serveix la pregunta «quines venen de fora», que és la que farà la interfície
     * el dia que hi hagi un filtre per provinença.
     */
    `CREATE INDEX idx_tasks_source_kind ON tasks(source_kind)
       WHERE deleted_at IS NULL AND source_kind IS NOT NULL`,
  ];
}

export async function up(db: MigrationDb, engine: Engine): Promise<void> {
  for (const statement of ddl(engine)) {
    await sql.raw(statement).execute(db);
  }

  /**
   * I les que ja hi eren.
   *
   * `source_kind` del calendari i no una constant: una tasca feta a partir d'una cita d'un
   * `.ics` publicat i una d'un CalDAV bidireccional no vénen del mateix lloc, i la icona
   * ho ha de dir.
   */
  await sql`
    UPDATE tasks SET source_kind = (
      SELECT c.source_kind FROM calendars c WHERE c.id = tasks.event_calendar_id
    )
    WHERE event_calendar_id IS NOT NULL AND source_kind IS NULL
  `.execute(db);
}

export async function down(db: MigrationDb): Promise<void> {
  await sql.raw('DROP INDEX IF EXISTS idx_tasks_source_kind').execute(db);
  await sql.raw('ALTER TABLE tasks DROP COLUMN source_kind').execute(db);
}
