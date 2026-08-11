/**
 * Migració 014 — el correu segueix la mateixa regla de visibilitat que tot.
 *
 * QUÈ CANVIA, I PER QUÈ NO ÉS UN AJUST
 * ------------------------------------
 * La 013 va donar a la regla de correu un camp `action` amb dos valors: «cau a la bústia» o
 * **«es converteix en tasca sola»**. El segon posa coses al kanban sense que ningú ho hagi
 * demanat, i el model del producte és el contrari:
 *
 * > Tot el que arriba d'una font va a la bústia. **Res no arriba sol a la teva llista de
 * > feina.** El que hi ha a l'inbox són correus, cites, titulars i tasques: les tasques les
 * > has escrit tu, i la resta són coses que **pots convertir** en tasca.
 *
 * O sigui que `action` no és una opció que sobri: és una que no hauria d'existir. Fora.
 *
 * EL TRI-ESTAT, I LA LLIÇÓ DE LA 011
 * ----------------------------------
 * `mail_rules.inbox_visible` era `NOT NULL DEFAULT true`: no hi havia manera de dir «no s'hi
 * ha dit res». La 011 ja va argumentar per què això és un error —el defecte ha de viure al
 * codi, perquè canviar-lo no obligui a migrar files— i aquí se'n paga la factura de seguida:
 * el defecte del correu passa a ser **no visible**, i sense el tri-estat caldria endevinar
 * quines files eren una decisió i quines el defecte antic.
 *
 * A SQLite una columna no es fa nul·lable sense refer la taula, i `mail_messages.rule_id` hi
 * apunta: per això va al registre amb `needsForeignKeysOff: true`, i el refet d'aquí **no
 * torna a posar el pragma** —dins d'una transacció SQLite l'ignora en silenci, que és el
 * defecte que la 009 va documentar.
 *
 * EL REBLIMENT: TRES LÍNIES I CAP D'INNOCENT
 * ------------------------------------------
 *   `inbox_visible = NULL` a totes les regles
 *       Ningú pot haver-lo tocat a posta: el camp no ha sortit mai a la interfície. Tot el
 *       que hi ha és el defecte antic, i deixar-hi `TRUE` seria convertir un defecte en una
 *       decisió que ningú va prendre.
 *
 *   `disposition = 'pending'` → `'inbox'`
 *       Eren els que esperaven la conversió automàtica. Ara esperen una persona.
 *
 *   `disposition = 'dismissed'` → `'inbox'` amb `inbox_visible = FALSE`
 *       Descartar era un carreró sense sortida: cap ruta el desfeia. Passa a ser el mateix
 *       «no visible» que la resta, que **es veu al calendari i es pot recuperar d'un clic**.
 */

import { sql } from 'kysely';
import { boolLiteral, typeMap, type Engine } from '../dialect.js';
import type { MigrationDb } from '../migration-db.js';

/** Les columnes de `mail_rules` que sobreviuen. `action` no hi és. */
const RULE_COLUMNS = [
  'id',
  'account_id',
  'folder',
  'scope_id',
  'project_id',
  'inbox_visible',
  'title_template',
  'body_to_description',
  'attachments_to_task',
  'uid_validity',
  'last_uid',
  'last_seen_at',
  'last_error',
  'last_error_at',
  'position',
  'enabled',
  'created_at',
  'updated_at',
  'deleted_at',
  'version',
];

/**
 * La taula de regles, sense `action` i amb `inbox_visible` nul·lable.
 *
 * `nullable` és el paràmetre perquè el `down` pugui refer la de sempre amb la mateixa
 * funció: dues còpies del mateix DDL divergirien el dia que algú n'arregli una.
 */
function rulesTable(engine: Engine, name: string, ambAction: boolean): string {
  const t = typeMap(engine);
  const cert = boolLiteral(engine, true);
  return `CREATE TABLE ${name} (
    id                  ${t.text} PRIMARY KEY NOT NULL,
    account_id          ${t.text} NOT NULL REFERENCES mail_accounts(id),
    folder              ${t.text} NOT NULL,
    scope_id            ${t.text} NOT NULL REFERENCES scopes(id),
    project_id          ${t.text} REFERENCES projects(id),
    ${ambAction ? `action ${t.text} NOT NULL CHECK (action IN ('inbox','task')),` : ''}
    -- Tri-estat: NULL vol dir "no s'hi ha dit res" i val el defecte de la mena de font,
    -- que per al correu és **no visible**.
    inbox_visible       ${t.bool}${ambAction ? ` NOT NULL DEFAULT ${cert}` : ''},
    title_template      ${t.text} NOT NULL DEFAULT '{{subject}}',
    body_to_description ${t.bool} NOT NULL DEFAULT ${cert},
    attachments_to_task ${t.bool} NOT NULL DEFAULT ${cert},
    uid_validity        ${t.text},
    last_uid            ${t.text},
    last_seen_at        ${t.instant},
    last_error          ${t.text},
    last_error_at       ${t.instant},
    position            ${t.text} NOT NULL ${t.binaryCollate},
    enabled             ${t.bool} NOT NULL DEFAULT ${cert},
    created_at ${t.instant} NOT NULL, updated_at ${t.instant} NOT NULL,
    deleted_at ${t.instant}, version ${t.int} NOT NULL DEFAULT 1
  )`;
}

async function rebuildRules(db: MigrationDb, engine: Engine, ambAction: boolean): Promise<void> {
  const cols = RULE_COLUMNS.join(', ');
  // Amb `action`, la còpia n'hi ha de posar un valor: tot torna a ser `inbox`, que és el
  // que el producte fa ara. Cap fila torna a la conversió automàtica en desfer.
  const select = ambAction ? `${cols}, 'inbox' AS action` : cols;
  const insert = ambAction ? `${cols}, action` : cols;

  await sql.raw(rulesTable(engine, 'mail_rules__new', ambAction)).execute(db);
  await sql
    .raw(`INSERT INTO mail_rules__new (${insert}) SELECT ${select} FROM mail_rules`)
    .execute(db);
  await sql.raw('DROP TABLE mail_rules').execute(db);
  await sql.raw('ALTER TABLE mail_rules__new RENAME TO mail_rules').execute(db);
  // El `DROP TABLE` se l'emporta. Es torna a crear tal com el va deixar la 013.
  await sql
    .raw(
      `CREATE UNIQUE INDEX idx_mail_rules_folder
         ON mail_rules(account_id, folder) WHERE deleted_at IS NULL`,
    )
    .execute(db);
}

export async function up(db: MigrationDb, engine: Engine): Promise<void> {
  const t = typeMap(engine);

  /**
   * L'excepció per ítem: **el bessó d'`event_inbox_marks`, sense taula**.
   *
   * Als esdeveniments cal una taula perquè la marca és **per usuari** —un calendari el
   * comparteix tot un àmbit i «aquesta cita no és feina meva» és personal—. Un compte de
   * correu és d'una sola persona, o sigui que la columna al missatge ja és per usuari:
   * posar-hi una taula de marques seria una junta amb una sola banda.
   */
  await sql.raw(`ALTER TABLE mail_messages ADD COLUMN inbox_visible ${t.bool}`).execute(db);

  /**
   * On són els adjunts que ja s'han baixat.
   *
   * **Sense conversió automàtica, els adjunts es baixen igualment i esperen.** L'alternativa
   * era baixar-los en convertir, i té dos forats: la conversió necessitaria xarxa en una
   * petició —i fallaria amb el servidor de correu caigut, just al moment pitjor—, i un correu
   * esborrat de la bústia d'origen s'enduria els fitxers.
   *
   * JSON en una columna i no una taula: és una llista curta, no s'hi consulta mai, i el
   * precedent hi és (`reference_ids` aquí mateix, `api_tokens.capabilities`). El dia que
   * calgui buscar-hi, serà una taula.
   */
  await sql.raw(`ALTER TABLE mail_messages ADD COLUMN attachments ${t.text}`).execute(db);

  if (engine === 'sqlite') {
    await rebuildRules(db, engine, false);
  } else {
    await sql.raw('ALTER TABLE mail_rules DROP COLUMN action').execute(db);
    await sql.raw('ALTER TABLE mail_rules ALTER COLUMN inbox_visible DROP NOT NULL').execute(db);
    await sql.raw('ALTER TABLE mail_rules ALTER COLUMN inbox_visible DROP DEFAULT').execute(db);
  }

  // El rebliment. Veure el capçal: cap de les tres línies és innocent.
  await sql.raw('UPDATE mail_rules SET inbox_visible = NULL').execute(db);
  await sql
    .raw("UPDATE mail_messages SET disposition = 'inbox' WHERE disposition = 'pending'")
    .execute(db);
  await sql
    .raw(
      `UPDATE mail_messages SET disposition = 'inbox', inbox_visible = ${boolLiteral(engine, false)}
       WHERE disposition = 'dismissed'`,
    )
    .execute(db);
}

export async function down(db: MigrationDb, engine: Engine): Promise<void> {
  if (engine === 'sqlite') {
    // El que era NULL torna al `true` de la 013: allà no hi havia manera de dir-ne res més.
    await sql
      .raw(
        `UPDATE mail_rules SET inbox_visible = ${boolLiteral(engine, true)}
            WHERE inbox_visible IS NULL`,
      )
      .execute(db);
    await rebuildRules(db, engine, true);
  } else {
    await sql
      .raw(
        `UPDATE mail_rules SET inbox_visible = ${boolLiteral(engine, true)}
            WHERE inbox_visible IS NULL`,
      )
      .execute(db);
    await sql
      .raw(
        `ALTER TABLE mail_rules ADD COLUMN action ${typeMap(engine).text} NOT NULL DEFAULT 'inbox'`,
      )
      .execute(db);
    await sql
      .raw(
        `ALTER TABLE mail_rules ADD CONSTRAINT mail_rules_action_check
           CHECK (action IN ('inbox','task'))`,
      )
      .execute(db);
    await sql.raw('ALTER TABLE mail_rules ALTER COLUMN inbox_visible SET NOT NULL').execute(db);
  }

  await sql.raw('ALTER TABLE mail_messages DROP COLUMN attachments').execute(db);
  await sql.raw('ALTER TABLE mail_messages DROP COLUMN inbox_visible').execute(db);
}
