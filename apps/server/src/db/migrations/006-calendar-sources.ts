/**
 * Migració 006 — les fonts de dades d'un calendari.
 *
 * `docs/07` §9 ja preveu que un àmbit tingui un CalDAV o un `.ics` com a origen, i la
 * pestanya de Calendaris del disseny validat hi afegeix un tercer tipus: **RSS**. Fins
 * ara `calendars.origin` només distingia `local` de `subscription`, i quina mena de
 * subscripció era s'havia d'endevinar de la URL. Endevinar-ho està bé fins que algú
 * publica un `.ics` sense extensió.
 *
 * Tres columnes:
 *
 * - `source_kind` diu de quina mena és: `caldav`, `ical` o `rss`. Només té sentit amb
 *   `origin='subscription'`, i el `CHECK` no ho força perquè un `local` amb la columna
 *   a `NULL` ja ho diu.
 * - `writable` és el que fa que una font sigui **bidireccional**. Només un CalDAV pot
 *   ser-ho: un `.ics` publicat i un RSS són documents, no col·leccions on es pugui
 *   escriure. Amb `writable`, les escriptures locals surten cap a l'origen; sense, la
 *   font és de només lectura **a la capa de repositori** i no només a la interfície
 *   (docs/01 §5).
 * - `last_error` guarda per què va fallar l'últim refresc. Sense això, una font que ha
 *   deixat d'anar es veu igual que una que no té esdeveniments, i l'usuari no té cap
 *   manera de saber que el que mira ja no és el que hi ha.
 */

import { sql } from 'kysely';
import { boolLiteral, typeMap, type Engine } from '../dialect.js';
import type { MigrationDb } from '../migration-db.js';

function ddl(engine: Engine): string[] {
  const t = typeMap(engine);

  return [
    `ALTER TABLE calendars ADD COLUMN source_kind ${t.text}`,
    `ALTER TABLE calendars ADD COLUMN writable ${t.bool} NOT NULL DEFAULT ${boolLiteral(engine, false)}`,
    `ALTER TABLE calendars ADD COLUMN last_error ${t.text}`,
    `ALTER TABLE calendars ADD COLUMN last_error_at ${t.instant}`,
    /**
     * Les que ja hi eren són CalDAV o iCal, i no se sap quina.
     *
     * `ical` és la tria segura: una subscripció tractada com un `.ics` es baixa sencera
     * i funciona igualment contra un CalDAV que serveixi el calendari per `GET`. A
     * l'inrevés —tractar un `.ics` com una col·lecció CalDAV— no funciona.
     */
    `UPDATE calendars SET source_kind = 'ical' WHERE origin = 'subscription'`,
    /**
     * Quines fonts NO vol veure aquest usuari al calendari.
     *
     * Amagades i no esborrades: la font és de l'àmbit i la comparteix tothom qui hi és,
     * i que algú deixi de mirar el calendari de festius no vol dir que ningú més el
     * vulgui. Es guarda el que s'amaga i no el que es veu perquè una font nova ha de
     * sortir sola: si es guardés el que es veu, ningú se n'assabentaria.
     */
    `ALTER TABLE user_settings ADD COLUMN hidden_calendar_ids ${t.text}`,
  ];
}

export async function up(db: MigrationDb, engine: Engine): Promise<void> {
  for (const statement of ddl(engine)) {
    await sql.raw(statement).execute(db);
  }
}

export async function down(db: MigrationDb, engine: Engine): Promise<void> {
  for (const column of ['source_kind', 'writable', 'last_error', 'last_error_at']) {
    await sql.raw(`ALTER TABLE calendars DROP COLUMN ${column}`).execute(db);
  }
  void engine;
}
