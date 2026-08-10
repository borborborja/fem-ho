/**
 * Migració 011 — les fonts entren a la bústia.
 *
 * Fins ara la bústia era `SELECT ... FROM tasks WHERE status = 'inbox'` i res més: les
 * fonts subscrites es dibuixaven al calendari, en un panell que no es parlava amb el del
 * costat. A partir d'aquí la bústia d'un dia són **les fonts més les tasques**, i això
 * demana tres coses a la base.
 *
 * ES DESA L'EXCEPCIÓ, NO L'ESTAT
 * ------------------------------
 * El principi és el de `hidden_calendar_ids` (migració 006), i val per a les dues peces
 * de visibilitat que hi ha aquí: **només es guarda el que es desvia del que tocaria**.
 * Per això `calendars.inbox_visible` és tri-estat i no un booleà amb defecte:
 *
 *     NULL   cap excepció, val el defecte del seu `source_kind`
 *     TRUE   aquest calendari surt a la bústia encara que el seu defecte digui que no
 *     FALSE  no hi surt encara que el seu defecte digui que sí
 *
 * El defecte és «els calendaris sí, els RSS no», i viu al codi
 * (`policy/inbox-visibility.ts`), no aquí. Si demà es decideix que els RSS també hi
 * entren, les instàncies que no van tocar res segueixen el nou defecte **sense migrar cap
 * fila**; només les que van dir explícitament que no, es queden com estaven. Amb un booleà
 * amb defecte, canviar d'opinió voldria dir no poder distingir mai qui havia triat de qui
 * no havia dit res.
 *
 * PER QUÈ LES MARQUES NO PENGEN D'`events.id`
 * -------------------------------------------
 * Aquesta és la decisió que sosté tota la funció, i el motiu és `applyFetched`
 * (`dav/client.ts`), que és qui reconcilia una font externa amb el que tenim:
 *
 *   - indexa les files existents **per `uid`**, no per `id`;
 *   - si l'etag ha canviat, fa `UPDATE` in-place i **sobreescriu tots els camps de
 *     contingut sense cap `COALESCE`**: l'origen mana i no es fusiona res;
 *   - als uid que deixen d'arribar els posa `deleted_at`.
 *
 * O sigui que un uid que desapareix de l'origen i hi torna —cosa que un `.ics` amb
 * finestra rodant fa contínuament— pot néixer en una **fila nova, amb `id` nou**. Una
 * marca lligada a `events.id` es perdria allà, en silenci i sense que res fallés.
 *
 * Per això `event_inbox_marks` apunta a la **identitat externa**: `(calendar_id, uid,
 * recurrence_id)`, que és el que l'origen promet i el que l'índex únic d'`events` ja fa
 * servir des de la migració 001. La comprovació permanent `external-rows` existeix per
 * impedir que algú desfaci això sense adonar-se'n.
 *
 * `recurrence_id NULL` marca **la sèrie sencera**; amb valor, una ocurrència. La
 * d'ocurrència guanya sobre la de sèrie, i això dona «amaga aquesta reunió del dimarts» i
 * «amaga totes les reunions» amb una sola taula.
 *
 * I EL PREFIX `event_` A `tasks` NO ÉS DECORATIU
 * ----------------------------------------------
 * `tasks.calendar_id` **ja existeix** des de la migració 001 i vol dir una altra cosa: la
 * col·lecció VTODO on s'escriu la tasca quan surt per CalDAV. Les tres columnes noves
 * diuen de quin **esdeveniment** ve la tasca, que no té res a veure. Reutilitzar el nom
 * hauria estat una col·lisió de vocabulari (regla 3) amb aparença innocent.
 *
 * Són una **referència morta**: cap clau forana cap a `events`, ningú hi fa join per
 * obeir-lo. P6 de `docs/14` ja ho va decidir —una tasca feta a partir d'un esdeveniment
 * neix independent— perquè un enllaç viu voldria dir que esborrar un esdeveniment d'un
 * calendari compartit esborrés en silenci la tasca que algú altre s'havia apuntat.
 *
 * `needsForeignKeysOff` no cal: tot són `ADD COLUMN` i una taula nova, cap taula refeta.
 */

import { sql } from 'kysely';
import { typeMap, type Engine } from '../dialect.js';
import type { MigrationDb } from '../migration-db.js';

export function ddl(engine: Engine): string[] {
  const t = typeMap(engine);
  return [
    /**
     * Sense `DEFAULT`: neix `NULL`, que vol dir "no s'ha dit res" i és exactament el que
     * volem per a tots els calendaris que ja existeixen.
     */
    `ALTER TABLE calendars ADD COLUMN inbox_visible ${t.bool}`,

    `CREATE TABLE event_inbox_marks (
      id            ${t.text} PRIMARY KEY NOT NULL,
      user_id       ${t.text} NOT NULL REFERENCES users(id),
      calendar_id   ${t.text} NOT NULL REFERENCES calendars(id),
      uid           ${t.text} NOT NULL,
      recurrence_id ${t.text},
      visible       ${t.bool} NOT NULL,
      created_at    ${t.instant} NOT NULL,
      updated_at    ${t.instant} NOT NULL,
      deleted_at    ${t.instant},
      version       ${t.int} NOT NULL DEFAULT 1
    )`,
    /**
     * El `COALESCE` és el mateix patró que `idx_events_uid` de la 001: sense ell, dues
     * marques de sèrie del mateix esdeveniment no xocarien, perquè a SQL `NULL != NULL`.
     */
    `CREATE UNIQUE INDEX idx_event_inbox_marks_identity
       ON event_inbox_marks(user_id, calendar_id, uid, COALESCE(recurrence_id, 'epoch'))`,
    `CREATE INDEX idx_event_inbox_marks_user
       ON event_inbox_marks(user_id, calendar_id) WHERE deleted_at IS NULL`,

    `ALTER TABLE tasks ADD COLUMN event_calendar_id ${t.text} REFERENCES calendars(id)`,
    `ALTER TABLE tasks ADD COLUMN event_uid ${t.text}`,
    `ALTER TABLE tasks ADD COLUMN event_recurrence_id ${t.text}`,
    /**
     * Serveix la pregunta que la bústia fa a cada càrrega: "d'aquest esdeveniment, ja
     * n'hi ha una tasca viva?". Parcial, perquè la immensa majoria de tasques no vénen de
     * cap esdeveniment i no han d'ocupar índex.
     */
    `CREATE INDEX idx_tasks_source_event ON tasks(event_calendar_id, event_uid)
       WHERE deleted_at IS NULL AND event_uid IS NOT NULL`,

    /**
     * Què passa amb l'esdeveniment quan s'esborra la tasca que en va sortir.
     *
     * `return_to_inbox` (el defecte) **no escriu res enlloc**: en desaparèixer la tasca
     * viva, l'esdeveniment torna sol a la bústia. `hide_from_inbox` escriu una marca. És
     * el principi de dalt portat fins al final: el comportament per defecte no té
     * representació a la base.
     *
     * Valors en anglès (regla 3); el català només als catàlegs de traducció.
     */
    `ALTER TABLE user_settings ADD COLUMN event_task_deleted ${t.text} NOT NULL
       DEFAULT 'return_to_inbox'
       CHECK (event_task_deleted IN ('return_to_inbox', 'hide_from_inbox'))`,

    /**
     * Aquí hi havia d'anar un índex de finestra per a `events(calendar_id, starts_at)`,
     * perquè la bústia passa a demanar-ne una a cada càrrega. **Ja existeix des de la
     * 001** (`idx_events_window`), byte per byte el mateix.
     *
     * Val la pena deixar-ho escrit perquè el `down` d'aquesta migració l'hauria esborrat:
     * una migració que desfà una cosa que no ha fet ella deixa la base pitjor del que se
     * la va trobar, i això no ho hauria vist ningú fins al dia que el calendari va lent.
     */
  ];
}

export async function up(db: MigrationDb, engine: Engine): Promise<void> {
  for (const statement of ddl(engine)) {
    await sql.raw(statement).execute(db);
  }
}

export async function down(db: MigrationDb): Promise<void> {
  for (const statement of [
    'ALTER TABLE user_settings DROP COLUMN event_task_deleted',
    'DROP INDEX IF EXISTS idx_tasks_source_event',
    'ALTER TABLE tasks DROP COLUMN event_recurrence_id',
    'ALTER TABLE tasks DROP COLUMN event_uid',
    'ALTER TABLE tasks DROP COLUMN event_calendar_id',
    'DROP TABLE IF EXISTS event_inbox_marks',
    'ALTER TABLE calendars DROP COLUMN inbox_visible',
  ]) {
    await sql.raw(statement).execute(db);
  }
}
