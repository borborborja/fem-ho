/**
 * Migració 008 — els fonaments dels àmbits compartits.
 *
 * **Cinc `CHECK` a la vegada, i no de cinc en cinc.** Ampliar una unió tancada a SQLite
 * no és un `ALTER`: cal crear la taula nova, copiar-hi, esborrar la vella i renombrar. És
 * l'operació més perillosa d'una actualització i és la font més probable de deixar algú
 * amb una base a mitges. Fer-ho un cop, aquí, amb tot el que caldrà fins a la federació,
 * val més que repetir-ho a cada fase.
 *
 * Què s'amplia i per què:
 *
 * | Taula | Columna | Valors nous | Per a |
 * | --- | --- | --- | --- |
 * | `scope_members` | `role` | `collaborator` substitueix `member`; fora `admin` | F1 |
 * | `activity_log` | `actor_type` | `remote` | la federació |
 * | `activity_log` | `source` | `federation` | la federació |
 * | `users` | `kind` | `remote` | usuaris d'una altra instància |
 * | `attachments` | `task_id` | passa a nul·lable, i entra `event_id` | els adjunts |
 *
 * I dues taules noves que no depenen de cap `CHECK`: `grants` i `sync_op_ids`.
 *
 * **`admin` desapareix i `member` es diu `collaborator`.** El primer no feia res que
 * `owner` no fes; el segon xocava amb el nom de la fila (`scope_members`), que és
 * exactament la col·lisió que la regla 3 prohibeix.
 */

import { sql } from 'kysely';
import { typeMap, type Engine } from '../dialect.js';
import type { MigrationDb } from '../migration-db.js';

/**
 * Refà una taula amb un `CHECK` nou.
 *
 * A Postgres n'hi ha prou amb `DROP CONSTRAINT` / `ADD CONSTRAINT`; a SQLite cal el ball
 * sencer. El `PRAGMA foreign_keys` es desactiva durant el ball perquè les taules que hi
 * apunten no es quedin apuntant a la taula temporal — i es torna a activar sempre, també
 * si peta.
 */
async function rebuildSqlite(
  db: MigrationDb,
  table: string,
  createNew: string,
  columns: string[],
): Promise<void> {
  const cols = columns.join(', ');
  await sql.raw('PRAGMA foreign_keys = OFF').execute(db);
  try {
    await sql
      .raw(createNew.replace(`CREATE TABLE ${table}`, `CREATE TABLE ${table}__new`))
      .execute(db);
    await sql.raw(`INSERT INTO ${table}__new (${cols}) SELECT ${cols} FROM ${table}`).execute(db);
    await sql.raw(`DROP TABLE ${table}`).execute(db);
    await sql.raw(`ALTER TABLE ${table}__new RENAME TO ${table}`).execute(db);
  } finally {
    await sql.raw('PRAGMA foreign_keys = ON').execute(db);
  }
}

export async function up(db: MigrationDb, engine: Engine): Promise<void> {
  const t = typeMap(engine);
  const sqlite = engine === 'sqlite';

  // ---------------------------------------------------------------- els rols
  //
  // Les dades primer, el CHECK després: si es fes al revés, les files amb `member`
  // violarien el CHECK nou en el moment de copiar-les.
  await sql.raw(`UPDATE scope_members SET role = 'owner' WHERE role = 'admin'`).execute(db);
  await sql.raw(`UPDATE scope_members SET role = 'collaborator' WHERE role = 'member'`).execute(db);

  if (sqlite) {
    await rebuildSqlite(
      db,
      'scope_members',
      `CREATE TABLE scope_members (
        id                   ${t.text} PRIMARY KEY NOT NULL,
        scope_id             ${t.text} NOT NULL REFERENCES scopes(id),
        user_id              ${t.text} REFERENCES users(id),
        external_calendar_id ${t.text} REFERENCES calendars(id),
        role                 ${t.text} NOT NULL DEFAULT 'collaborator'
                             CHECK (role IN ('owner','collaborator','viewer')),
        created_at           ${t.instant} NOT NULL,
        UNIQUE (scope_id, user_id),
        CHECK (user_id IS NOT NULL OR external_calendar_id IS NOT NULL)
      )`,
      ['id', 'scope_id', 'user_id', 'external_calendar_id', 'role', 'created_at'],
    );
  } else {
    await sql
      .raw('ALTER TABLE scope_members DROP CONSTRAINT IF EXISTS scope_members_role_check')
      .execute(db);
    await sql
      .raw(
        `ALTER TABLE scope_members ADD CONSTRAINT scope_members_role_check
         CHECK (role IN ('owner','collaborator','viewer'))`,
      )
      .execute(db);
    await sql
      .raw(`ALTER TABLE scope_members ALTER COLUMN role SET DEFAULT 'collaborator'`)
      .execute(db);
  }

  // ------------------------------------------------- l'actor i el canal nous
  if (sqlite) {
    await rebuildSqlite(
      db,
      'activity_log',
      `CREATE TABLE activity_log (
        id             ${t.text} PRIMARY KEY NOT NULL,
        entity_type    ${t.text} NOT NULL,
        entity_id      ${t.text} NOT NULL,
        scope_id       ${t.text},
        actor_type     ${t.text} NOT NULL
                       CHECK (actor_type IN ('user','ai_agent','guest','system','caldav','remote')),
        actor_user_id  ${t.text} REFERENCES users(id),
        actor_agent_id ${t.text} REFERENCES ai_agents(id),
        actor_label    ${t.text},
        source         ${t.text} NOT NULL
                       CHECK (source IN ('web','android','api','mcp','caldav','share','system','federation')),
        verb           ${t.text} NOT NULL,
        changes        ${t.text},
        created_at     ${t.instant} NOT NULL
      )`,
      [
        'id',
        'entity_type',
        'entity_id',
        'scope_id',
        'actor_type',
        'actor_user_id',
        'actor_agent_id',
        'actor_label',
        'source',
        'verb',
        'changes',
        'created_at',
      ],
    );
    await sql
      .raw('CREATE INDEX idx_activity_entity ON activity_log(entity_type, entity_id, created_at)')
      .execute(db);
    await sql
      .raw('CREATE INDEX idx_activity_scope ON activity_log(scope_id, created_at)')
      .execute(db);
  } else {
    for (const [name, check] of [
      [
        'activity_log_actor_type_check',
        `actor_type IN ('user','ai_agent','guest','system','caldav','remote')`,
      ],
      [
        'activity_log_source_check',
        `source IN ('web','android','api','mcp','caldav','share','system','federation')`,
      ],
    ] as const) {
      await sql.raw(`ALTER TABLE activity_log DROP CONSTRAINT IF EXISTS ${name}`).execute(db);
      await sql.raw(`ALTER TABLE activity_log ADD CONSTRAINT ${name} CHECK (${check})`).execute(db);
    }
  }

  // ------------------------------------------------------- els usuaris remots
  //
  // Una fila ombra a `users` i no una taula d'usuaris remots: `scope_members`,
  // `task_assignees`, `activity_log.actor_user_id` i `comments.author_id` ja hi apunten,
  // i una taula nova obligaria a tocar una dotzena de claus foranes.
  //
  // I un regal: `loadUser` ja rebutja tot el que no sigui `human`, o sigui que un usuari
  // remot no pot tenir sessió ni contrasenya sense escriure cap comprovació.
  if (sqlite) {
    await sql.raw(`UPDATE users SET kind = kind`).execute(db);
  }
  await sql.raw(`ALTER TABLE users ADD COLUMN instance_link_id ${t.text}`).execute(db);
  await sql.raw(`ALTER TABLE users ADD COLUMN remote_user_id ${t.text}`).execute(db);

  if (!sqlite) {
    await sql.raw('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_kind_check').execute(db);
    await sql
      .raw(
        `ALTER TABLE users ADD CONSTRAINT users_kind_check
         CHECK (kind IN ('human','ai','caldav_only','remote'))`,
      )
      .execute(db);
  }

  // ------------------------------------------------------------- concessions
  //
  // El motlle és `user_invites` (migració 005) generalitzat: un val que s'ensenya un cop,
  // es bescanvia, i el que en surt és un canvi d'estat durador. **No és una credencial**:
  // no es presenta a cada petició. Per això no absorbeix `api_tokens` ni `shares`.
  //
  // `kind` NO porta CHECK a posta: aquesta taula existeix per absorbir tipus futurs i un
  // CHECK la convertiria en una migració cada vegada. La unió tancada viu al TypeScript,
  // que és on hi ha el `switch` que hi falla igualment.
  await sql
    .raw(
      `CREATE TABLE grants (
        id              ${t.text} PRIMARY KEY NOT NULL,
        kind            ${t.text} NOT NULL,
        subject_type    ${t.text} NOT NULL,
        subject_id      ${t.text},
        token_hmac      ${t.text} NOT NULL UNIQUE,
        secret_version  ${t.int} NOT NULL DEFAULT 1,
        issuer_user_id  ${t.text} REFERENCES users(id),
        role            ${t.text},
        capabilities    ${t.text},
        payload         ${t.text},
        max_uses        ${t.int} NOT NULL DEFAULT 1,
        use_count       ${t.int} NOT NULL DEFAULT 0,
        expires_at      ${t.instant},
        revoked_at      ${t.instant},
        first_used_at   ${t.instant},
        last_used_at    ${t.instant},
        created_at      ${t.instant} NOT NULL
      )`,
    )
    .execute(db);
  await sql
    .raw('CREATE INDEX idx_grants_open ON grants(token_hmac) WHERE revoked_at IS NULL')
    .execute(db);
  await sql.raw('CREATE INDEX idx_grants_subject ON grants(subject_type, subject_id)').execute(db);

  // ------------------------------------------- idempotència que sobreviu a un reinici
  //
  // `appliedOps` era un Map en memòria de 10.000 entrades. Per a dos clients de casa
  // n'hi havia prou; per a la federació no: un parell que reintenti travessant el nostre
  // reinici duplicaria creacions.
  //
  // `principal_key` tanca de passada la fuita entre principals: l'`op_id` el genera el
  // client i viatja al cos de cada lot, o sigui que no és cap secret.
  await sql
    .raw(
      `CREATE TABLE sync_op_ids (
        op_id         ${t.text} NOT NULL,
        principal_key ${t.text} NOT NULL,
        result        ${t.text} NOT NULL,
        created_at    ${t.instant} NOT NULL,
        PRIMARY KEY (op_id, principal_key)
      )`,
    )
    .execute(db);
  await sql.raw('CREATE INDEX idx_sync_op_ids_age ON sync_op_ids(created_at)').execute(db);

  // ---------------------------------------------------- perdre accés a un àmbit
  //
  // El comentari de `services/sync.ts` afirmava que qui perd accés a un àmbit rep
  // tombstones i que "això ho aconsegueix la consulta sola". **És fals**: el
  // `WHERE scope_id IN (permesos)` simplement EXCLOU aquelles files. Qui surti d'un
  // àmbit compartit es quedaria les tasques al SQLite d'Android i a l'IndexedDB de la
  // web per sempre, sense senyal de cap mena.
  //
  // Sense això, compartir no es pot desplegar: compartir sense poder descompartir de
  // debò no és compartir.
  await sql
    .raw(
      `CREATE TABLE scope_access_revocations (
        id         ${t.text} PRIMARY KEY NOT NULL,
        scope_id   ${t.text} NOT NULL,
        user_id    ${t.text} NOT NULL,
        revoked_at ${t.instant} NOT NULL
      )`,
    )
    .execute(db);
  await sql
    .raw('CREATE INDEX idx_revocations_user ON scope_access_revocations(user_id, revoked_at)')
    .execute(db);

  // ---------------------------------------------- què es comparteix d'un àmbit
  //
  // La polaritat és l'OPOSADA a `hidden_calendar_ids`, i és deliberat. Allà es desa el
  // que s'amaga perquè una font nova ha de sortir sola; aquí el defecte ha de ser
  // `false` perquè un calendari creat DESPRÉS de compartir l'àmbit no pot filtrar-se tot
  // sol. El fracàs de l'un és una molèstia; el de l'altre és una divulgació.
  await sql
    .raw(`ALTER TABLE calendars ADD COLUMN shared_with_scope ${t.bool} NOT NULL DEFAULT FALSE`)
    .execute(db);
  await sql.raw(`ALTER TABLE calendars ADD COLUMN version ${t.int} NOT NULL DEFAULT 1`).execute(db);

  // -------------------------------------------------------------- els adjunts
  //
  // `task_id` passa a nul·lable i entra `event_id`, amb el mateix patró de CHECK que
  // `scope_members` ja fa servir. Dues taules doblarien servei, endpoint, comprovació de
  // permisos i entitat de sync per zero guany.
  //
  // `scope_id` va denormalitzat i no per JOIN: per a un adjunt d'esdeveniment la cadena
  // és `attachment → event → calendar → scope`, tres salts a cada fila del sync, i
  // `change_log.scope_id` el necessita en el moment d'escriure igualment.
  if (sqlite) {
    await rebuildSqlite(
      db,
      'attachments',
      `CREATE TABLE attachments (
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
                      CHECK (source IN ('upload','ical_attach')),
        is_ai_context ${t.bool} NOT NULL DEFAULT FALSE,
        uploaded_by   ${t.text} REFERENCES users(id),
        created_at    ${t.instant} NOT NULL,
        updated_at    ${t.instant} NOT NULL,
        deleted_at    ${t.instant},
        version       ${t.int} NOT NULL DEFAULT 1,
        CHECK (task_id IS NOT NULL OR event_id IS NOT NULL)
      )`,
      [
        'id',
        'task_id',
        'filename',
        'mime_type',
        'size_bytes',
        'storage_path',
        'is_ai_context',
        'uploaded_by',
        'created_at',
        'deleted_at',
      ],
    );
  } else {
    await sql.raw('ALTER TABLE attachments ALTER COLUMN task_id DROP NOT NULL').execute(db);
    for (const [name, type] of [
      ['event_id', `${t.text} REFERENCES events(id)`],
      ['scope_id', t.text],
      ['external_url', t.text],
      ['source', `${t.text} NOT NULL DEFAULT 'upload'`],
      ['updated_at', t.instant],
      ['version', `${t.int} NOT NULL DEFAULT 1`],
    ] as const) {
      await sql.raw(`ALTER TABLE attachments ADD COLUMN ${name} ${type}`).execute(db);
    }
    await sql.raw('ALTER TABLE attachments ALTER COLUMN storage_path DROP NOT NULL').execute(db);
    await sql
      .raw(
        `ALTER TABLE attachments ADD CONSTRAINT attachments_parent_check
         CHECK (task_id IS NOT NULL OR event_id IS NOT NULL)`,
      )
      .execute(db);
  }

  // El `scope_id` de les files que ja hi eren surt de la seva tasca.
  await sql
    .raw(
      `UPDATE attachments SET scope_id =
         (SELECT t.scope_id FROM tasks t WHERE t.id = attachments.task_id)
       WHERE task_id IS NOT NULL`,
    )
    .execute(db);
  await sql
    .raw(`UPDATE attachments SET updated_at = created_at WHERE updated_at IS NULL`)
    .execute(db);

  await sql.raw('CREATE INDEX idx_attachments_task ON attachments(task_id)').execute(db);
  await sql.raw('CREATE INDEX idx_attachments_event ON attachments(event_id)').execute(db);
}

export async function down(db: MigrationDb, engine: Engine): Promise<void> {
  await sql.raw('DROP TABLE IF EXISTS scope_access_revocations').execute(db);
  await sql.raw('DROP TABLE IF EXISTS sync_op_ids').execute(db);
  await sql.raw('DROP TABLE IF EXISTS grants').execute(db);
  await sql.raw('ALTER TABLE calendars DROP COLUMN shared_with_scope').execute(db);
  await sql.raw('ALTER TABLE calendars DROP COLUMN version').execute(db);
  await sql.raw('ALTER TABLE users DROP COLUMN instance_link_id').execute(db);
  await sql.raw('ALTER TABLE users DROP COLUMN remote_user_id').execute(db);
  await sql.raw(`UPDATE scope_members SET role = 'member' WHERE role = 'collaborator'`).execute(db);
  void engine;
}
