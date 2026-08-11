/**
 * Migració 013 — el correu com a font d'entrada.
 *
 * QUATRE TAULES, I CADA UNA RESPON UNA PREGUNTA QUE CAP ALTRA POT
 * ---------------------------------------------------------------
 *   `mail_accounts`  on em connecto i amb quines credencials. **Per usuari**: `calendars`
 *                    és per àmbit, i posar-hi una contrasenya personal la deixaria en una
 *                    taula que comparteix tota la casa.
 *   `mail_rules`     aquesta carpeta on va i què se'n fa — **i el cursor**, perquè el
 *                    cursor és per carpeta i aquesta fila ja ÉS la carpeta.
 *   `mail_messages`  què hem ingerit i què en vam decidir. El llibre de comptes que fa la
 *                    ingesta idempotent.
 *   `mail_threads`   quins correus són la mateixa conversa. Agrupar per consulta obligaria
 *                    a recórrer les referències de tots els missatges a cada lectura.
 *
 * LA IDENTITAT ÉS EL `Message-ID`, MAI L'UID
 * ------------------------------------------
 * `UNIQUE (account_id, message_key)`, i **`uid` no hi entra**. És l'argument de la 011
 * traslladat, i aquí les conseqüències les veu l'usuari:
 *
 * - Un UID d'IMAP és estable dins d'una carpeta i **mentre `UIDVALIDITY` no canviï**. Quan
 *   el servidor reindexa, el protocol diu literalment «oblida tots els UID que t'he
 *   donat»: amb l'UID com a clau, això vol dir reingerir la bústia sencera i **duplicar
 *   cada tasca creada des del primer dia**.
 * - Moure un correu de carpeta és `COPY` + `EXPUNGE`, o sigui UID nou. Arrossegar entre
 *   etiquetes és un gest quotidià a Gmail.
 *
 * `uid` i `uid_validity` es desen igualment, però com a **on l'hem vist per última
 * vegada**: serveixen per demanar només els nous i per adonar-se que cal reescanejar.
 *
 * EL FIL NO S'AGRUPA MAI PER ASSUMPTE
 * -----------------------------------
 * `thread_key` surt de `References` / `In-Reply-To`. Agrupar per assumpte normalitzat
 * —treure els `Re:` i comparar text— fusionaria correus de **remitents diferents** que
 * comparteixen assumpte («Factura», «Reunió»), i en aquest disseny una fusió errònia vol
 * dir que **el correu d'un desconegut apareix com a comentari a una tasca teva**.
 *
 * La fallada correcta és l'altra: un fil duplicat es veu i es descarta amb un clic; una
 * fusió no es veu i filtra. `mail_threads.subject` es desa **només per a la llista**.
 *
 * EL PARANY DEL REFET, QUE JA VA COSTAR UN DESPLEGAMENT
 * -----------------------------------------------------
 * `attachments.source` té un `CHECK` tancat que ha d'admetre el correu, i a SQLite això vol
 * dir refer la taula. La 008 porta un ajudant que fa `PRAGMA foreign_keys = OFF` **dins**
 * de la funció, i la 009 va documentar que allà dins **és un no-op**: les migracions corren
 * dins d'una transacció i SQLite l'ignora en silenci. Per això aquesta va al registre amb
 * `needsForeignKeysOff: true` i el refet d'aquí **no torna a posar el pragma**.
 */

import { sql } from 'kysely';
import { boolLiteral, typeMap, type Engine } from '../dialect.js';
import type { MigrationDb } from '../migration-db.js';

/**
 * Les columnes d'`attachments` **tal com són avui**, per copiar-les al refet sense
 * oblidar-ne cap. Que la llista sigui la de la 008 i no una d'ideal és el punt: el refet ha
 * de deixar la taula igual excepte el `CHECK`.
 */
const ATTACHMENT_COLUMNS = [
  'id',
  'task_id',
  'event_id',
  'scope_id',
  'filename',
  'mime_type',
  'size_bytes',
  'storage_path',
  'external_url',
  'source',
  'is_ai_context',
  'uploaded_by',
  'created_at',
  'updated_at',
  'deleted_at',
  'version',
];

/**
 * La taula d'adjunts, calcada de la 008 i amb els valors de `source` que se li passin.
 *
 * `scope_id` **no porta `NOT NULL` ni clau forana**, perquè la 008 la va deixar així i
 * aquesta migració no ve a arreglar-ho: afegir-hi el `NOT NULL` aquí faria petar el refet a
 * qualsevol base amb un adjunt antic sense àmbit resolt, i seria un canvi que ningú ha
 * demanat amagat dins d'una migració de correu.
 */
function attachmentsTable(engine: Engine, sources: string): string {
  const t = typeMap(engine);
  return `CREATE TABLE attachments (
    id            ${t.text} PRIMARY KEY NOT NULL,
    task_id       ${t.text} REFERENCES tasks(id),
    event_id      ${t.text} REFERENCES events(id),
    scope_id      ${t.text},
    filename      ${t.text} NOT NULL,
    mime_type     ${t.text} NOT NULL,
    size_bytes    ${t.int} NOT NULL,
    storage_path  ${t.text},
    external_url  ${t.text},
    source        ${t.text} NOT NULL DEFAULT 'upload'
                  CHECK (source IN (${sources})),
    is_ai_context ${t.bool} NOT NULL DEFAULT ${boolLiteral(engine, false)},
    uploaded_by   ${t.text} REFERENCES users(id),
    created_at    ${t.instant} NOT NULL,
    updated_at    ${t.instant} NOT NULL,
    deleted_at    ${t.instant},
    version       ${t.int} NOT NULL DEFAULT 1,
    CHECK (task_id IS NOT NULL OR event_id IS NOT NULL)
  )`;
}

const SOURCES_AMB_CORREU = "'upload','ical_attach','mail_attach'";
const SOURCES_SENSE_CORREU = "'upload','ical_attach'";

export function ddl(engine: Engine): string[] {
  const t = typeMap(engine);
  const cert = boolLiteral(engine, true);
  const fals = boolLiteral(engine, false);

  return [
    `CREATE TABLE mail_accounts (
      id                 ${t.text} PRIMARY KEY NOT NULL,
      user_id            ${t.text} NOT NULL REFERENCES users(id),
      name               ${t.text} NOT NULL,
      host               ${t.text} NOT NULL,
      port               ${t.int} NOT NULL DEFAULT 993,
      -- **No hi ha 'none'.** Oferir IMAP en clar vol dir que algú el triarà i les seves
      -- credencials viatjaran nues per la xarxa de casa.
      security           ${t.text} NOT NULL DEFAULT 'tls'
                         CHECK (security IN ('tls','starttls')),
      username           ${t.text} NOT NULL,
      -- seal(secret, 'mail_account:<id>', contrasenya). No surt mai del servei.
      secret_enc         ${t.text},
      poll_interval      ${t.int},
      enabled            ${t.bool} NOT NULL DEFAULT ${cert},
      last_polled_at     ${t.instant},
      last_error         ${t.text},
      last_error_at      ${t.instant},
      -- La retirada exponencial. Reintentar una contrasenya errònia cada cinc minuts
      -- contra Gmail és com es bloqueja un compte.
      consecutive_errors ${t.int} NOT NULL DEFAULT 0,
      created_at ${t.instant} NOT NULL, updated_at ${t.instant} NOT NULL,
      deleted_at ${t.instant}, version ${t.int} NOT NULL DEFAULT 1
    )`,
    `CREATE INDEX idx_mail_accounts_user ON mail_accounts(user_id) WHERE deleted_at IS NULL`,

    `CREATE TABLE mail_rules (
      id                  ${t.text} PRIMARY KEY NOT NULL,
      account_id          ${t.text} NOT NULL REFERENCES mail_accounts(id),
      folder              ${t.text} NOT NULL,
      scope_id            ${t.text} NOT NULL REFERENCES scopes(id),
      -- NULL = l'espai general de l'àmbit.
      project_id          ${t.text} REFERENCES projects(id),
      action              ${t.text} NOT NULL CHECK (action IN ('inbox','task')),
      inbox_visible       ${t.bool} NOT NULL DEFAULT ${cert},
      title_template      ${t.text} NOT NULL DEFAULT '{{subject}}',
      body_to_description ${t.bool} NOT NULL DEFAULT ${cert},
      attachments_to_task ${t.bool} NOT NULL DEFAULT ${cert},
      -- El cursor viu aquí perquè és per carpeta, i aquesta fila ÉS la carpeta.
      uid_validity        ${t.text},
      last_uid            ${t.text},
      last_seen_at        ${t.instant},
      last_error          ${t.text},
      last_error_at       ${t.instant},
      position            ${t.text} NOT NULL ${t.binaryCollate},
      enabled             ${t.bool} NOT NULL DEFAULT ${cert},
      created_at ${t.instant} NOT NULL, updated_at ${t.instant} NOT NULL,
      deleted_at ${t.instant}, version ${t.int} NOT NULL DEFAULT 1
    )`,
    `CREATE UNIQUE INDEX idx_mail_rules_folder
       ON mail_rules(account_id, folder) WHERE deleted_at IS NULL`,

    `CREATE TABLE mail_threads (
      id            ${t.text} PRIMARY KEY NOT NULL,
      account_id    ${t.text} NOT NULL REFERENCES mail_accounts(id),
      thread_key    ${t.text} NOT NULL,
      subject       ${t.text},
      message_count ${t.int} NOT NULL DEFAULT 0,
      first_at      ${t.instant},
      last_at       ${t.instant},
      -- Referència morta cap a la tasca: cap clau forana. Esborrar la tasca no toca el fil.
      task_id       ${t.text},
      created_at ${t.instant} NOT NULL, updated_at ${t.instant} NOT NULL,
      deleted_at ${t.instant}, version ${t.int} NOT NULL DEFAULT 1
    )`,
    `CREATE UNIQUE INDEX idx_mail_threads_key ON mail_threads(account_id, thread_key)`,

    `CREATE TABLE mail_messages (
      id            ${t.text} PRIMARY KEY NOT NULL,
      account_id    ${t.text} NOT NULL REFERENCES mail_accounts(id),
      thread_id     ${t.text} NOT NULL REFERENCES mail_threads(id),
      -- LA IDENTITAT.
      message_key   ${t.text} NOT NULL,
      message_id    ${t.text},
      -- LA POSICIÓ: pot canviar sota nostre i no passa res.
      folder        ${t.text} NOT NULL,
      uid_validity  ${t.text} NOT NULL,
      uid           ${t.text} NOT NULL,
      -- La posa el servidor que el va rebre. sent_at la posa el remitent i pot mentir.
      internal_date ${t.instant},
      sent_at       ${t.instant},
      from_name     ${t.text},
      from_address  ${t.text},
      to_addresses  ${t.text},
      subject       ${t.text},
      body_text     ${t.text},
      has_html      ${t.bool} NOT NULL DEFAULT ${fals},
      raw_path      ${t.text},
      raw_bytes     ${t.int} NOT NULL DEFAULT 0,
      in_reply_to   ${t.text},
      reference_ids ${t.text},
      disposition   ${t.text} NOT NULL DEFAULT 'pending'
                    CHECK (disposition IN
                      ('pending','inbox','task','comment','skipped','failed','dismissed')),
      rule_id       ${t.text} REFERENCES mail_rules(id),
      task_id       ${t.text},
      error         ${t.text},
      created_at ${t.instant} NOT NULL, updated_at ${t.instant} NOT NULL,
      deleted_at ${t.instant}, version ${t.int} NOT NULL DEFAULT 1
    )`,
    // La clau de tot: el que fa la ingesta idempotent. **`uid` no hi entra.**
    `CREATE UNIQUE INDEX idx_mail_messages_identity ON mail_messages(account_id, message_key)`,
    `CREATE INDEX idx_mail_messages_inbox ON mail_messages(account_id, disposition)
       WHERE deleted_at IS NULL`,
    `CREATE INDEX idx_mail_messages_thread ON mail_messages(thread_id, internal_date)`,

    /**
     * La referència morta a `tasks`, el patró d'`event_*` de la 011.
     *
     * **`_key` i no `_id`**: la fila del fil es pot purgar per retenció, i la tasca ha de
     * sobreviure a la purga amb la provinença intacta. Amb una clau forana, purgar
     * obligaria a triar entre trencar-la i esborrar tasques d'algú.
     */
    `ALTER TABLE tasks ADD COLUMN mail_account_id ${t.text} REFERENCES mail_accounts(id)`,
    `ALTER TABLE tasks ADD COLUMN mail_thread_key ${t.text}`,
    `ALTER TABLE tasks ADD COLUMN mail_message_key ${t.text}`,
    `CREATE INDEX idx_tasks_source_mail ON tasks(mail_account_id, mail_thread_key)
       WHERE deleted_at IS NULL AND mail_thread_key IS NOT NULL`,
  ];
}

/**
 * Refà una taula amb un `CHECK` nou, a SQLite.
 *
 * **Sense `PRAGMA foreign_keys` aquí dins**, a diferència de l'ajudant de la 008: la 009 va
 * documentar que dins d'una transacció SQLite l'ignora en silenci. El pragma el posa el
 * migrador, fora, perquè aquesta migració entra a `MIGRATIONS` amb `needsForeignKeysOff`.
 */
async function rebuildAttachments(db: MigrationDb, engine: Engine, sources: string): Promise<void> {
  const cols = ATTACHMENT_COLUMNS.join(', ');
  const create = attachmentsTable(engine, sources).replace(
    'CREATE TABLE attachments',
    'CREATE TABLE attachments__new',
  );
  await sql.raw(create).execute(db);
  await sql
    .raw(`INSERT INTO attachments__new (${cols}) SELECT ${cols} FROM attachments`)
    .execute(db);
  await sql.raw('DROP TABLE attachments').execute(db);
  await sql.raw('ALTER TABLE attachments__new RENAME TO attachments').execute(db);
  // El `DROP TABLE` se'ls emporta. Es tornen a crear tal com els va deixar la 008.
  await sql.raw('CREATE INDEX idx_attachments_task ON attachments(task_id)').execute(db);
  await sql.raw('CREATE INDEX idx_attachments_event ON attachments(event_id)').execute(db);
}

export async function up(db: MigrationDb, engine: Engine): Promise<void> {
  for (const statement of ddl(engine)) {
    await sql.raw(statement).execute(db);
  }

  /**
   * `attachments.source` ha d'admetre el correu.
   *
   * A SQLite cal refer la taula. **A Postgres la columna no té cap `CHECK`**: la 001 no
   * tenia `source` i la 008 la va afegir com a columna plana pel camí de Postgres, o sigui
   * que allà la restricció mai ha existit. Aquí se li posa, que és el que hauria de tenir,
   * i el `down` la treu sense reposar-ne cap —perquè no n'hi havia—.
   *
   * `tasks.source_kind` no s'ha de tocar: la 012 ja llista les quatre menes, pel mateix
   * motiu que fa car aquest refet.
   */
  if (engine === 'sqlite') {
    await rebuildAttachments(db, engine, SOURCES_AMB_CORREU);
  } else {
    await sql
      .raw('ALTER TABLE attachments DROP CONSTRAINT IF EXISTS attachments_source_check')
      .execute(db);
    await sql
      .raw(
        `ALTER TABLE attachments ADD CONSTRAINT attachments_source_check
           CHECK (source IN (${SOURCES_AMB_CORREU}))`,
      )
      .execute(db);
  }
}

export async function down(db: MigrationDb, engine: Engine): Promise<void> {
  /**
   * **No s'esborren adjunts per poder desfer una migració.** Si n'hi ha de correu, això
   * falla i ho diu: desfer no pot voler dir perdre fitxers d'algú.
   */
  const mail = await sql<{ n: number }>`
    SELECT COUNT(*) AS n FROM attachments WHERE source = 'mail_attach'
  `.execute(db);
  if (Number(mail.rows[0]?.n ?? 0) > 0) {
    throw new Error(
      'hi ha adjunts de correu: desfer la 013 els esborraria. Treu-los primer si de debò ho vols.',
    );
  }

  for (const statement of [
    'DROP INDEX IF EXISTS idx_tasks_source_mail',
    'ALTER TABLE tasks DROP COLUMN mail_message_key',
    'ALTER TABLE tasks DROP COLUMN mail_thread_key',
    'ALTER TABLE tasks DROP COLUMN mail_account_id',
    'DROP TABLE IF EXISTS mail_messages',
    'DROP TABLE IF EXISTS mail_threads',
    'DROP TABLE IF EXISTS mail_rules',
    'DROP TABLE IF EXISTS mail_accounts',
  ]) {
    await sql.raw(statement).execute(db);
  }

  if (engine === 'sqlite') {
    await rebuildAttachments(db, engine, SOURCES_SENSE_CORREU);
  } else {
    // No se'n reposa cap: pel camí de Postgres aquesta restricció no havia existit mai.
    await sql
      .raw('ALTER TABLE attachments DROP CONSTRAINT IF EXISTS attachments_source_check')
      .execute(db);
  }
}
