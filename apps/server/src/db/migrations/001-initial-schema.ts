/**
 * Migració 001 — l'esquema sencer de docs/01-model-de-dades.md.
 *
 * docs/13 M2 és taxatiu: hi entren **des del primer dia** `events`, `calendars`,
 * `change_log`, `activity_log`, `ai_agents` i `shares`. Afegir-los després obliga a
 * reescriure el sync i l'API.
 *
 * L'ordre de creació no és decoratiu: Postgres valida les claus foranes en crear la
 * taula, o sigui que una taula no pot referenciar-ne una que encara no existeix.
 * SQLite ho tolera; Postgres no.
 *
 * Convencions de docs/01, vàlides per a totes les taules:
 *   - `id` és TEXT PRIMARY KEY NOT NULL, UUIDv7 nu generat pel client (D4). Cap prefix.
 *     El `NOT NULL` no és a docs/01 i s'hi afegeix a posta: a SQLite, PRIMARY KEY **no**
 *     implica NOT NULL si la columna no és INTEGER —és un error de les primeres versions
 *     que mantenen per compatibilitat— i sense ell s'hi pot inserir un id nul. A Postgres
 *     la clau primària ja ho implica, o sigui que allà no canvia res.
 *   - Els instants són ISO-8601 UTC amb Z (a Postgres, timestamptz).
 *   - Les dates sense hora són TEXT `YYYY-MM-DD`, sense fus.
 *   - `deleted_at` és esborrat suau. Cap DELETE real en entitats sincronitzables.
 *   - `version` s'incrementa a cada escriptura: és el control de concurrència optimista.
 */

import { sql } from 'kysely';
import { boolLiteral, typeMap, type Engine } from '../dialect.js';
import type { MigrationDb } from '../migration-db.js';

/** Les sentències de creació, en ordre. */
function ddl(engine: Engine): string[] {
  const t = typeMap(engine);
  const F = boolLiteral(engine, false);
  const T = boolLiteral(engine, true);

  // `position` porta sempre ordenació binària (D3). Amb una collation lingüística
  // l'ordre de les claus fraccionals és incorrecte i les targetes es desordenen sense
  // cap error visible.
  const position = `${t.text} NOT NULL ${t.binaryCollate}`;

  return [
    // ---------------------------------------------------------------- identitat
    `CREATE TABLE users (
      id            ${t.text} PRIMARY KEY NOT NULL,
      email         ${t.text} UNIQUE,
      name          ${t.text} NOT NULL,
      password_hash ${t.text},
      kind          ${t.text} NOT NULL DEFAULT 'human'
                    CHECK (kind IN ('human','ai','caldav_only')),
      role          ${t.text} NOT NULL DEFAULT 'member'
                    CHECK (role IN ('admin','member')),
      timezone      ${t.text} NOT NULL DEFAULT 'Europe/Madrid',
      locale        ${t.text} NOT NULL DEFAULT 'ca',
      theme         ${t.text} NOT NULL DEFAULT 'system'
                    CHECK (theme IN ('system','light','dark')),
      accent        ${t.text} NOT NULL DEFAULT 'default'
                    CHECK (accent IN ('default','soft','mono-warm','mono-cool')),
      avatar_color  ${t.text},
      created_at    ${t.instant} NOT NULL,
      updated_at    ${t.instant} NOT NULL,
      deleted_at    ${t.instant},
      version       ${t.int} NOT NULL DEFAULT 1
    )`,
    `CREATE INDEX idx_users_kind ON users(kind) WHERE deleted_at IS NULL`,

    // ai_agents va abans que api_tokens perquè aquesta l'hi referencia.
    `CREATE TABLE ai_agents (
      id                   ${t.text} PRIMARY KEY NOT NULL,
      name                 ${t.text} NOT NULL,
      on_behalf_of_user_id ${t.text} NOT NULL REFERENCES users(id),
      actor_user_id        ${t.text} NOT NULL REFERENCES users(id),
      can_create_tasks     ${t.bool} NOT NULL DEFAULT ${F},
      enabled              ${t.bool} NOT NULL DEFAULT ${T},
      created_at           ${t.instant} NOT NULL,
      updated_at           ${t.instant} NOT NULL,
      version              ${t.int} NOT NULL DEFAULT 1
    )`,

    `CREATE TABLE sessions (
      id           ${t.text} PRIMARY KEY NOT NULL,
      user_id      ${t.text} NOT NULL REFERENCES users(id),
      refresh_hash ${t.text} NOT NULL UNIQUE,
      user_agent   ${t.text},
      created_at   ${t.instant} NOT NULL,
      last_used_at ${t.instant} NOT NULL,
      expires_at   ${t.instant} NOT NULL,
      revoked_at   ${t.instant}
    )`,
    `CREATE INDEX idx_sessions_user ON sessions(user_id) WHERE revoked_at IS NULL`,

    `CREATE TABLE api_tokens (
      id           ${t.text} PRIMARY KEY NOT NULL,
      user_id      ${t.text} NOT NULL REFERENCES users(id),
      ai_agent_id  ${t.text} REFERENCES ai_agents(id),
      name         ${t.text} NOT NULL,
      token_prefix ${t.text} NOT NULL,
      token_hash   ${t.text} NOT NULL UNIQUE,
      capabilities ${t.text} NOT NULL,
      scope_ids    ${t.text},
      expires_at   ${t.instant},
      last_used_at ${t.instant},
      created_at   ${t.instant} NOT NULL,
      revoked_at   ${t.instant}
    )`,
    `CREATE INDEX idx_tokens_prefix ON api_tokens(token_prefix) WHERE revoked_at IS NULL`,

    `CREATE TABLE user_settings (
      user_id              ${t.text} PRIMARY KEY NOT NULL REFERENCES users(id),
      done_cleared_at      ${t.instant},
      inbox_position       ${t.text} NOT NULL DEFAULT 'right'
                           CHECK (inbox_position IN ('left','right','below')),
      inbox_show_overdue   ${t.bool} NOT NULL DEFAULT ${T},
      collapsed_groups     ${t.text},
      show_calendar_widget ${t.bool} NOT NULL DEFAULT ${T},
      show_overdue_section ${t.bool} NOT NULL DEFAULT ${T},
      notify_prefs         ${t.text} NOT NULL DEFAULT '{}',
      quiet_hours_start    ${t.text},
      quiet_hours_end      ${t.text},
      daily_digest_at      ${t.text},
      updated_at           ${t.instant} NOT NULL
    )`,

    // ------------------------------------------------------- àmbits i projectes
    `CREATE TABLE scopes (
      id              ${t.text} PRIMARY KEY NOT NULL,
      name            ${t.text} NOT NULL,
      kind            ${t.text} NOT NULL DEFAULT 'individual'
                      CHECK (kind IN ('individual','collective')),
      color           ${t.text} NOT NULL,
      icon            ${t.text},
      owner_id        ${t.text} NOT NULL REFERENCES users(id),
      ai_instructions ${t.text},
      ai_description  ${t.text},
      position        ${position},
      created_at      ${t.instant} NOT NULL,
      updated_at      ${t.instant} NOT NULL,
      deleted_at      ${t.instant},
      version         ${t.int} NOT NULL DEFAULT 1
    )`,

    `CREATE TABLE projects (
      id              ${t.text} PRIMARY KEY NOT NULL,
      scope_id        ${t.text} NOT NULL REFERENCES scopes(id),
      name            ${t.text} NOT NULL,
      ai_instructions ${t.text},
      ai_description  ${t.text},
      position        ${position},
      archived_at     ${t.instant},
      created_at      ${t.instant} NOT NULL,
      updated_at      ${t.instant} NOT NULL,
      deleted_at      ${t.instant},
      version         ${t.int} NOT NULL DEFAULT 1
    )`,
    `CREATE INDEX idx_projects_scope ON projects(scope_id) WHERE deleted_at IS NULL`,

    // -------------------------------------------------------------- calendaris
    // D9: dues col·leccions per contenidor, sempre. `kind` és obligatori i únic per
    // col·lecció; RFC 4791 §5.2 prohibeix recursos de components mixtos.
    `CREATE TABLE calendars (
      id                ${t.text} PRIMARY KEY NOT NULL,
      scope_id          ${t.text} NOT NULL REFERENCES scopes(id),
      project_id        ${t.text} REFERENCES projects(id),
      name              ${t.text} NOT NULL,
      color             ${t.text},
      kind              ${t.text} NOT NULL CHECK (kind IN ('events','todos')),
      origin            ${t.text} NOT NULL DEFAULT 'local'
                        CHECK (origin IN ('local','subscription')),
      source_url        ${t.text},
      source_username   ${t.text},
      source_secret_enc ${t.text},
      refresh_interval  ${t.int},
      last_refreshed_at ${t.instant},
      strip_alarms      ${t.bool} NOT NULL DEFAULT ${T},
      sync_seq          ${t.int} NOT NULL DEFAULT 0,
      created_at        ${t.instant} NOT NULL,
      updated_at        ${t.instant} NOT NULL,
      deleted_at        ${t.instant}
    )`,

    // P3: un membre és O BÉ un usuari (potser caldav_only) O BÉ una subscripció de
    // calendari de només lectura. El CHECK final ho codifica.
    `CREATE TABLE scope_members (
      id                   ${t.text} PRIMARY KEY NOT NULL,
      scope_id             ${t.text} NOT NULL REFERENCES scopes(id),
      user_id              ${t.text} REFERENCES users(id),
      external_calendar_id ${t.text} REFERENCES calendars(id),
      role                 ${t.text} NOT NULL DEFAULT 'member'
                           CHECK (role IN ('owner','admin','member','viewer')),
      created_at           ${t.instant} NOT NULL,
      UNIQUE (scope_id, user_id),
      CHECK (user_id IS NOT NULL OR external_calendar_id IS NOT NULL)
    )`,

    // ----------------------------------------------------------- esdeveniments
    // D8: una fila per component, no per recurs. El mestre té recurrence_id IS NULL;
    // cada instància modificada és una fila germana amb el seu RECURRENCE-ID.
    `CREATE TABLE events (
      id                 ${t.text} PRIMARY KEY NOT NULL,
      calendar_id        ${t.text} NOT NULL REFERENCES calendars(id),
      uid                ${t.text} NOT NULL,
      recurrence_id      ${t.text},
      summary            ${t.text} NOT NULL,
      description        ${t.text},
      location           ${t.text},
      starts_at          ${t.instant} NOT NULL,
      ends_at            ${t.instant},
      duration           ${t.text},
      all_day            ${t.bool} NOT NULL DEFAULT ${F},
      timezone           ${t.text},
      status             ${t.text} DEFAULT 'CONFIRMED'
                         CHECK (status IN ('TENTATIVE','CONFIRMED','CANCELLED')),
      transparency       ${t.text} DEFAULT 'OPAQUE'
                         CHECK (transparency IN ('OPAQUE','TRANSPARENT')),
      classification     ${t.text} DEFAULT 'PUBLIC',
      rrule              ${t.text},
      rdate              ${t.text},
      exdate             ${t.text},
      is_orphan_override ${t.bool} NOT NULL DEFAULT ${F},
      organizer          ${t.text},
      sequence           ${t.int} NOT NULL DEFAULT 0,
      etag               ${t.text},
      raw_ical           ${t.text},
      created_at         ${t.instant} NOT NULL,
      updated_at         ${t.instant} NOT NULL,
      deleted_at         ${t.instant},
      version            ${t.int} NOT NULL DEFAULT 1
    )`,
    // El mestre i les instàncies modificades comparteixen uid; el que els distingeix és
    // recurrence_id. COALESCE perquè NULL no és igual a NULL en un índex únic.
    `CREATE UNIQUE INDEX idx_events_component
       ON events(calendar_id, uid, COALESCE(recurrence_id, 'epoch'))`,
    `CREATE INDEX idx_events_window ON events(calendar_id, starts_at) WHERE deleted_at IS NULL`,

    `CREATE TABLE event_attendees (
      id       ${t.text} PRIMARY KEY NOT NULL,
      event_id ${t.text} NOT NULL REFERENCES events(id),
      email    ${t.text},
      name     ${t.text},
      user_id  ${t.text} REFERENCES users(id),
      partstat ${t.text} DEFAULT 'NEEDS-ACTION'
               CHECK (partstat IN ('NEEDS-ACTION','ACCEPTED','DECLINED','TENTATIVE','DELEGATED')),
      role     ${t.text} DEFAULT 'REQ-PARTICIPANT'
    )`,

    // La finestra materialitzada de les repeticions (docs/01 §5). És el que fa que una
    // consulta de rang sigui un índex i no una expansió de recurrències sencera.
    `CREATE TABLE event_occurrences (
      event_id  ${t.text} NOT NULL REFERENCES events(id),
      starts_at ${t.instant} NOT NULL,
      ends_at   ${t.instant} NOT NULL,
      PRIMARY KEY (event_id, starts_at)
    )`,
    `CREATE INDEX idx_occ_window ON event_occurrences(starts_at, ends_at)`,

    // ----------------------------------------------------------------- tasques
    // scope_id és NOT NULL: és la invariant central del producte.
    `CREATE TABLE tasks (
      id                   ${t.text} PRIMARY KEY NOT NULL,
      scope_id             ${t.text} NOT NULL REFERENCES scopes(id),
      project_id           ${t.text} REFERENCES projects(id),
      title                ${t.text} NOT NULL,
      description          ${t.text},
      status               ${t.text} NOT NULL DEFAULT 'inbox'
                           CHECK (status IN ('inbox','todo','doing','done')),
      position             ${position},
      due_date             ${t.text},
      due_time             ${t.text},
      deadline             ${t.instant},
      completed_at         ${t.instant},
      view_mode            ${t.text} NOT NULL DEFAULT 'card'
                           CHECK (view_mode IN ('card','simple')),
      ai_mode              ${t.text} NOT NULL DEFAULT 'manual'
                           CHECK (ai_mode IN ('manual','assisted','delegated')),
      delegate_agent_id    ${t.text} REFERENCES ai_agents(id),
      ai_instructions      ${t.text},
      rrule                ${t.text},
      recurrence_mode      ${t.text} DEFAULT 'schedule'
                           CHECK (recurrence_mode IN ('schedule','completion')),
      recurrence_parent_id ${t.text} REFERENCES tasks(id),
      origin               ${t.text} NOT NULL DEFAULT 'native'
                           CHECK (origin IN ('native','caldav')),
      caldav_uid           ${t.text},
      caldav_etag          ${t.text},
      calendar_id          ${t.text} REFERENCES calendars(id),
      search_text          ${t.text},
      created_by           ${t.text} NOT NULL REFERENCES users(id),
      created_at           ${t.instant} NOT NULL,
      updated_at           ${t.instant} NOT NULL,
      deleted_at           ${t.instant},
      version              ${t.int} NOT NULL DEFAULT 1
    )`,
    `CREATE INDEX idx_tasks_board ON tasks(scope_id, status, position) WHERE deleted_at IS NULL`,
    `CREATE INDEX idx_tasks_due ON tasks(due_date) WHERE deleted_at IS NULL AND status != 'done'`,
    `CREATE INDEX idx_tasks_done ON tasks(completed_at) WHERE status = 'done' AND deleted_at IS NULL`,
    `CREATE INDEX idx_tasks_project ON tasks(project_id) WHERE deleted_at IS NULL`,
    `CREATE UNIQUE INDEX idx_tasks_caldav ON tasks(calendar_id, caldav_uid) WHERE caldav_uid IS NOT NULL`,

    `CREATE TABLE subtasks (
      id         ${t.text} PRIMARY KEY NOT NULL,
      task_id    ${t.text} NOT NULL REFERENCES tasks(id),
      title      ${t.text} NOT NULL,
      done       ${t.bool} NOT NULL DEFAULT ${F},
      position   ${position},
      created_at ${t.instant} NOT NULL,
      updated_at ${t.instant} NOT NULL,
      deleted_at ${t.instant},
      version    ${t.int} NOT NULL DEFAULT 1
    )`,
    `CREATE INDEX idx_subtasks_task ON subtasks(task_id) WHERE deleted_at IS NULL`,

    // P1: la llista pertany sempre a una tasca i opcionalment s'ancora a una subtasca.
    // `pinned_by` fa que pinejar sigui personal.
    `CREATE TABLE checklists (
      id                    ${t.text} PRIMARY KEY NOT NULL,
      task_id               ${t.text} NOT NULL REFERENCES tasks(id),
      subtask_id            ${t.text} REFERENCES subtasks(id),
      name                  ${t.text} NOT NULL,
      pinned                ${t.bool} NOT NULL DEFAULT ${F},
      pinned_by             ${t.text} REFERENCES users(id),
      show_completed_inline ${t.bool} NOT NULL DEFAULT ${T},
      position              ${position},
      created_at            ${t.instant} NOT NULL,
      updated_at            ${t.instant} NOT NULL,
      deleted_at            ${t.instant},
      version               ${t.int} NOT NULL DEFAULT 1
    )`,

    // Un ítem només té text i fet/no fet. Cap data, cap assignat, cap niuament: la
    // contenció és deliberada i ve de Things 3 (P1).
    `CREATE TABLE checklist_items (
      id           ${t.text} PRIMARY KEY NOT NULL,
      checklist_id ${t.text} NOT NULL REFERENCES checklists(id),
      text         ${t.text} NOT NULL,
      done         ${t.bool} NOT NULL DEFAULT ${F},
      done_at      ${t.instant},
      done_by      ${t.text} REFERENCES users(id),
      position     ${position},
      created_at   ${t.instant} NOT NULL,
      updated_at   ${t.instant} NOT NULL,
      deleted_at   ${t.instant},
      version      ${t.int} NOT NULL DEFAULT 1
    )`,
    `CREATE INDEX idx_items_checklist ON checklist_items(checklist_id) WHERE deleted_at IS NULL`,

    // És una taula i no una columna perquè el brief demana "persona o persones".
    `CREATE TABLE task_assignees (
      task_id     ${t.text} NOT NULL REFERENCES tasks(id),
      user_id     ${t.text} NOT NULL REFERENCES users(id),
      assigned_at ${t.instant} NOT NULL,
      PRIMARY KEY (task_id, user_id)
    )`,

    `CREATE TABLE labels (
      id         ${t.text} PRIMARY KEY NOT NULL,
      scope_id   ${t.text} NOT NULL REFERENCES scopes(id),
      name       ${t.text} NOT NULL,
      color      ${t.text} NOT NULL,
      created_at ${t.instant} NOT NULL,
      deleted_at ${t.instant},
      UNIQUE (scope_id, name)
    )`,

    `CREATE TABLE task_labels (
      task_id  ${t.text} NOT NULL REFERENCES tasks(id),
      label_id ${t.text} NOT NULL REFERENCES labels(id),
      PRIMARY KEY (task_id, label_id)
    )`,

    // ------------------------------------------------------------- compartits
    // D10: el token no es guarda mai en clar; es busca per HMAC amb pebre.
    // No hi ha cap columna d'IP enlloc, i és una decisió de privadesa explícita.
    `CREATE TABLE shares (
      id              ${t.text} PRIMARY KEY NOT NULL,
      task_id         ${t.text} REFERENCES tasks(id),
      checklist_id    ${t.text} REFERENCES checklists(id),
      created_by      ${t.text} NOT NULL REFERENCES users(id),
      token_hmac      ${t.text} NOT NULL UNIQUE,
      secret_version  ${t.int} NOT NULL DEFAULT 1,
      password_hash   ${t.text},
      require_name    ${t.bool} NOT NULL DEFAULT ${F},
      permission      ${t.text} NOT NULL DEFAULT 'view'
                      CHECK (permission IN ('view','check','comment')),
      expires_at      ${t.instant},
      max_views       ${t.int},
      view_count      ${t.int} NOT NULL DEFAULT 0,
      failed_attempts ${t.int} NOT NULL DEFAULT 0,
      locked_until    ${t.instant},
      created_at      ${t.instant} NOT NULL,
      revoked_at      ${t.instant},
      CHECK (task_id IS NOT NULL OR checklist_id IS NOT NULL)
    )`,

    // guest_ref és pseudònim i estable per sessió. No es deriva de dades personals.
    `CREATE TABLE share_accesses (
      id         ${t.text} PRIMARY KEY NOT NULL,
      share_id   ${t.text} NOT NULL REFERENCES shares(id),
      guest_name ${t.text},
      guest_ref  ${t.text} NOT NULL,
      first_seen ${t.instant} NOT NULL,
      last_seen  ${t.instant} NOT NULL
    )`,

    // ------------------------------------------ comentaris, adjunts, avisos
    `CREATE TABLE comments (
      id         ${t.text} PRIMARY KEY NOT NULL,
      task_id    ${t.text} NOT NULL REFERENCES tasks(id),
      author_id  ${t.text} REFERENCES users(id),
      guest_name ${t.text},
      share_id   ${t.text} REFERENCES shares(id),
      body       ${t.text} NOT NULL,
      created_at ${t.instant} NOT NULL,
      updated_at ${t.instant} NOT NULL,
      deleted_at ${t.instant},
      version    ${t.int} NOT NULL DEFAULT 1
    )`,
    `CREATE INDEX idx_comments_task ON comments(task_id) WHERE deleted_at IS NULL`,

    `CREATE TABLE attachments (
      id            ${t.text} PRIMARY KEY NOT NULL,
      task_id       ${t.text} NOT NULL REFERENCES tasks(id),
      filename      ${t.text} NOT NULL,
      mime_type     ${t.text} NOT NULL,
      size_bytes    ${t.int} NOT NULL,
      storage_path  ${t.text} NOT NULL,
      is_ai_context ${t.bool} NOT NULL DEFAULT ${F},
      uploaded_by   ${t.text} NOT NULL REFERENCES users(id),
      created_at    ${t.instant} NOT NULL,
      deleted_at    ${t.instant}
    )`,

    `CREATE TABLE reminders (
      id         ${t.text} PRIMARY KEY NOT NULL,
      task_id    ${t.text} REFERENCES tasks(id),
      event_id   ${t.text} REFERENCES events(id),
      user_id    ${t.text} NOT NULL REFERENCES users(id),
      trigger    ${t.text} NOT NULL,
      channel    ${t.text} NOT NULL CHECK (channel IN ('push','email','webhook')),
      fired_at   ${t.instant},
      created_at ${t.instant} NOT NULL,
      CHECK (task_id IS NOT NULL OR event_id IS NOT NULL)
    )`,
    `CREATE INDEX idx_reminders_pending ON reminders(fired_at) WHERE fired_at IS NULL`,

    // ------------------------------------------------- auditoria i sincronia
    // Append-only. S'escriu dins de la MATEIXA transacció que el canvi (regla 4).
    `CREATE TABLE activity_log (
      id             ${t.text} PRIMARY KEY NOT NULL,
      entity_type    ${t.text} NOT NULL,
      entity_id      ${t.text} NOT NULL,
      scope_id       ${t.text},
      actor_type     ${t.text} NOT NULL
                     CHECK (actor_type IN ('user','ai_agent','guest','system','caldav')),
      actor_user_id  ${t.text} REFERENCES users(id),
      actor_agent_id ${t.text} REFERENCES ai_agents(id),
      actor_label    ${t.text},
      source         ${t.text} NOT NULL
                     CHECK (source IN ('web','android','api','mcp','caldav','share','system')),
      verb           ${t.text} NOT NULL,
      changes        ${t.text},
      created_at     ${t.instant} NOT NULL
    )`,
    `CREATE INDEX idx_activity_entity ON activity_log(entity_type, entity_id, created_at)`,
    `CREATE INDEX idx_activity_scope ON activity_log(scope_id, created_at)`,

    // El motor del sync incremental. El cursor que envien els clients és aquest seq.
    `CREATE TABLE change_log (
      seq         ${t.bigserial},
      entity_type ${t.text} NOT NULL,
      entity_id   ${t.text} NOT NULL,
      scope_id    ${t.text},
      operation   ${t.text} NOT NULL CHECK (operation IN ('upsert','delete')),
      created_at  ${t.instant} NOT NULL
    )`,
    `CREATE INDEX idx_change_scope ON change_log(scope_id, seq)`,

    `CREATE TABLE webhooks (
      id              ${t.text} PRIMARY KEY NOT NULL,
      user_id         ${t.text} NOT NULL REFERENCES users(id),
      url             ${t.text} NOT NULL,
      secret_enc      ${t.text} NOT NULL,
      events          ${t.text} NOT NULL,
      scope_ids       ${t.text},
      enabled         ${t.bool} NOT NULL DEFAULT ${T},
      fail_count      ${t.int} NOT NULL DEFAULT 0,
      last_error      ${t.text},
      last_success_at ${t.instant},
      disabled_at     ${t.instant},
      created_at      ${t.instant} NOT NULL,
      updated_at      ${t.instant} NOT NULL
    )`,
    `CREATE INDEX idx_webhooks_enabled ON webhooks(enabled) WHERE disabled_at IS NULL`,

    // docs/11 §1: Web Push i UnifiedPush comparteixen RFC, o sigui que una sola taula
    // i una sola crida d'enviament serveixen per a la PWA i per a Android.
    `CREATE TABLE push_subscriptions (
      id         ${t.text} PRIMARY KEY NOT NULL,
      user_id    ${t.text} NOT NULL REFERENCES users(id),
      endpoint   ${t.text} NOT NULL UNIQUE,
      p256dh     ${t.text} NOT NULL,
      auth       ${t.text} NOT NULL,
      platform   ${t.text} NOT NULL CHECK (platform IN ('web','android')),
      user_agent ${t.text},
      created_at ${t.instant} NOT NULL,
      last_ok_at ${t.instant},
      fail_count ${t.int} NOT NULL DEFAULT 0
    )`,
  ];
}

/** L'ordre invers per desfer. Les taules amb claus foranes cauen primer. */
const DROP_ORDER = [
  'push_subscriptions',
  'webhooks',
  'change_log',
  'activity_log',
  'reminders',
  'attachments',
  'comments',
  'share_accesses',
  'shares',
  'task_labels',
  'labels',
  'task_assignees',
  'checklist_items',
  'checklists',
  'subtasks',
  'tasks',
  'event_occurrences',
  'event_attendees',
  'events',
  'scope_members',
  'calendars',
  'projects',
  'scopes',
  'user_settings',
  'api_tokens',
  'sessions',
  'ai_agents',
  'users',
];

export async function up(db: MigrationDb, engine: Engine): Promise<void> {
  for (const statement of ddl(engine)) {
    await sql.raw(statement).execute(db);
  }
}

export async function down(db: MigrationDb, _engine: Engine): Promise<void> {
  for (const table of DROP_ORDER) {
    await sql.raw(`DROP TABLE IF EXISTS ${table}`).execute(db);
  }
}
