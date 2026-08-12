# 01 · Model de dades

El DDL està escrit en dialecte **SQLite**, que és el motor per defecte. Les diferències per a PostgreSQL van marcades a cada punt on n'hi ha.

Convencions que valen per a totes les taules:

- **`id`** és `TEXT PRIMARY KEY`, un **UUIDv7 nu** generat pel client (D4). Cap prefix.
- **Els instants** es guarden com a `TEXT` en ISO-8601 UTC amb `Z` (`2026-08-05T14:30:00Z`). A Postgres, `timestamptz`.
- **Les dates sense hora** es guarden com a `TEXT` `YYYY-MM-DD`, **sense fus**. Una data de venciment de tot el dia no té instant.
- **Els booleans** són `INTEGER` 0/1. A Postgres, `boolean`.
- **`created_at` i `updated_at`** hi són a tota entitat sincronitzable.
- **`deleted_at`** és el esborrat suau. Cap `DELETE` real en entitats sincronitzables (D del sync).
- **`version`** és un enter que s'incrementa a cada escriptura. És la base del control de concurrència optimista.

---

## 1 · Mapa d'entitats

```
user ──┬── scope_member ──── scope ──┬── project ──── task
       │                             │
       │                             └── calendar ──── event ──┬── event_attendee
       │                                                       ├── event_alarm
       │                                                       └── event_occurrence
       │
       ├── api_token
       ├── push_subscription
       ├── user_settings   (1:1)
       ├── webhook
       └── ai_agent (on_behalf_of_user_id)

task ──┬── subtask
       ├── checklist ──── checklist_item
       ├── task_assignee
       ├── task_label ──── label
       ├── comment
       ├── attachment
       ├── reminder
       └── share

activity_log   (tot)
change_log     (tot, per al sync)
```

---

## 2 · Identitat i accés

### `users`

```sql
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT UNIQUE,               -- NULL per a kind='ai'
  name          TEXT NOT NULL,
  password_hash TEXT,                      -- argon2id; NULL per a kind='ai' i 'caldav_only'
  kind          TEXT NOT NULL DEFAULT 'human'
                CHECK (kind IN ('human','ai','caldav_only')),
  role          TEXT NOT NULL DEFAULT 'member'
                CHECK (role IN ('admin','member')),
  timezone      TEXT NOT NULL DEFAULT 'Europe/Madrid',
  locale        TEXT NOT NULL DEFAULT 'ca',
  theme         TEXT NOT NULL DEFAULT 'system'
                CHECK (theme IN ('system','light','dark')),
  accent        TEXT NOT NULL DEFAULT 'default'
                CHECK (accent IN ('default','soft','mono-warm','mono-cool')),
  avatar_color  TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT,
  version       INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_users_kind ON users(kind) WHERE deleted_at IS NULL;
```

Els tres `kind` (D5, P3):

- **`human`** — persona amb compte normal.
- **`ai`** — l'usuari IA. **Exactament una fila**, sembrada per migració amb un UUID fix. No té correu ni contrasenya i no pot entrar per web ni per CalDAV. Existeix perquè el registre d'activitat i els comentaris tinguin un actor uniforme, sense haver de tractar un actor polimòrfic.
- **`caldav_only`** — membre extern d'un àmbit col·lectiu que necessita escriure. La seva única credencial és una app password de CalDAV. Sense accés web ni app.

### `sessions`

```sql
CREATE TABLE sessions (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id),
  refresh_hash   TEXT NOT NULL UNIQUE,     -- mai el token en clar
  user_agent     TEXT,
  created_at     TEXT NOT NULL,
  last_used_at   TEXT NOT NULL,
  expires_at     TEXT NOT NULL,
  revoked_at     TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id) WHERE revoked_at IS NULL;
```

### `api_tokens`

```sql
CREATE TABLE api_tokens (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id),
  ai_agent_id    TEXT REFERENCES ai_agents(id),   -- NOT NULL ⇒ token d'agent
  name           TEXT NOT NULL,
  token_prefix   TEXT NOT NULL,            -- els primers caràcters, per identificar-lo a la UI
  token_hash     TEXT NOT NULL UNIQUE,
  capabilities   TEXT NOT NULL,            -- JSON, veure 05-api-rest.md
  scope_ids      TEXT,                     -- JSON array; NULL = tots els àmbits del propietari
  expires_at     TEXT,
  last_used_at   TEXT,
  created_at     TEXT NOT NULL,
  revoked_at     TEXT
);
CREATE INDEX idx_tokens_prefix ON api_tokens(token_prefix) WHERE revoked_at IS NULL;
```

`scope_ids` és el que fa possible "aquest token només veu l'àmbit Feina" (regla 9 d'`instruccions.md`). **No va a les scopes d'OAuth**: és dada dinàmica creada per l'usuari, i les scopes d'OAuth han de ser un conjunt petit i estàtic.

### `ai_agents`

```sql
CREATE TABLE ai_agents (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  on_behalf_of_user_id TEXT NOT NULL REFERENCES users(id),
  actor_user_id       TEXT NOT NULL REFERENCES users(id),  -- la fila kind='ai'
  can_create_tasks    INTEGER NOT NULL DEFAULT 0,
  enabled             INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  version             INTEGER NOT NULL DEFAULT 1
);
```

`on_behalf_of_user_id` és la peça que manté la rendició de comptes en mans d'una persona (D5). `can_create_tasks` implementa la distinció del brief entre "la IA només pot processar tasques" i "també en pot afegir".

### `user_settings`

```sql
CREATE TABLE user_settings (
  user_id             TEXT PRIMARY KEY REFERENCES users(id),

  -- Tauler
  done_cleared_at     TEXT,               -- l'últim "netejar la columna Fet"
  inbox_position      TEXT NOT NULL DEFAULT 'right'
                      CHECK (inbox_position IN ('left','right','below')),
  inbox_show_overdue  INTEGER NOT NULL DEFAULT 1,
  collapsed_groups    TEXT,               -- JSON: epígrafs d'àmbit plegats per columna

  -- Dashboard
  show_calendar_widget INTEGER NOT NULL DEFAULT 1,
  show_overdue_section INTEGER NOT NULL DEFAULT 1,

  -- Notificacions (veure 11-notificacions.md §8)
  notify_prefs        TEXT NOT NULL DEFAULT '{}',   -- JSON: canal per tipus d'avís
  quiet_hours_start   TEXT,               -- HH:MM
  quiet_hours_end     TEXT,
  daily_digest_at     TEXT,               -- HH:MM, NULL = desactivat

  updated_at          TEXT NOT NULL
);
```

**`done_cleared_at` és el que fa que netejar la columna Fet sigui un gest personal** (P2). No hi ha cap columna `cleared_at` a `tasks`: netejar no toca cap tasca, només mou el llindar de què veu *aquest* usuari. Una altra persona de la casa continua veient el que hi havia.

`inbox_position` és el que demana el brief a la línia 17: la bústia a l'esquerra, a la dreta o a sota del calendari.

Es crea una fila per usuari en donar-lo d'alta. Tots els camps tenen valor per defecte, així que una fila absent mai no ha de fer petar res: llegeix-la amb `LEFT JOIN` i valors per defecte.

---

## 3 · Àmbits i projectes

### `scopes`

```sql
CREATE TABLE scopes (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'individual'
                CHECK (kind IN ('individual','collective')),
  color         TEXT NOT NULL,             -- token CSS o hex
  icon          TEXT,
  owner_id      TEXT NOT NULL REFERENCES users(id),
  ai_instructions TEXT,                    -- context per a la IA (brief línia 52)
  ai_description  TEXT,
  position      TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT,
  version       INTEGER NOT NULL DEFAULT 1
);
```

Els tres àmbits inicials (Personal, Feina, Família) es creen al registrar un usuari, però **no són especials**: es poden reanomenar i esborrar com qualsevol altre.

### `scope_members`

```sql
CREATE TABLE scope_members (
  id          TEXT PRIMARY KEY,
  scope_id    TEXT NOT NULL REFERENCES scopes(id),
  user_id     TEXT REFERENCES users(id),   -- NULL ⇒ membre extern per subscripció
  external_calendar_id TEXT REFERENCES calendars(id),
  role        TEXT NOT NULL DEFAULT 'member'
              CHECK (role IN ('owner','admin','member','viewer')),
  created_at  TEXT NOT NULL,
  UNIQUE (scope_id, user_id),
  CHECK (user_id IS NOT NULL OR external_calendar_id IS NOT NULL)
);
```

El `CHECK` final codifica P3: un membre és **o bé** un usuari (potser `caldav_only`, si ha d'escriure) **o bé** una subscripció de calendari de només lectura. Un àmbit col·lectiu pot barrejar els dos tipus, com demana el brief.

### `projects`

```sql
CREATE TABLE projects (
  id            TEXT PRIMARY KEY,
  scope_id      TEXT NOT NULL REFERENCES scopes(id),
  name          TEXT NOT NULL,
  ai_instructions TEXT,
  ai_description  TEXT,
  position      TEXT NOT NULL,
  archived_at   TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT,
  version       INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_projects_scope ON projects(scope_id) WHERE deleted_at IS NULL;
```

**L'espai general d'un àmbit no és una fila.** És el filtre `project_id IS NULL`. Crear una fila "General" per àmbit obligaria a mantenir-la sincronitzada amb el nom de l'àmbit i a tractar-la com a no esborrable arreu.

---

## 4 · Tasques

### `tasks`

```sql
CREATE TABLE tasks (
  id            TEXT PRIMARY KEY,
  scope_id      TEXT NOT NULL REFERENCES scopes(id),
  project_id    TEXT REFERENCES projects(id),

  title         TEXT NOT NULL,
  description   TEXT,

  status        TEXT NOT NULL DEFAULT 'inbox'
                CHECK (status IN ('inbox','todo','doing','done')),
  position      TEXT NOT NULL COLLATE BINARY,

  due_date      TEXT,                      -- YYYY-MM-DD, sense fus
  due_time      TEXT,                      -- HH:MM, només si la tasca té hora
  deadline      TEXT,                      -- instant UTC
  completed_at  TEXT,

  view_mode     TEXT NOT NULL DEFAULT 'card'
                CHECK (view_mode IN ('card','simple')),

  ai_mode       TEXT NOT NULL DEFAULT 'manual'
                CHECK (ai_mode IN ('manual','assisted','delegated')),
  delegate_agent_id TEXT REFERENCES ai_agents(id),
  ai_instructions   TEXT,

  rrule         TEXT,                      -- RFC 5545, NULL si no es repeteix
  recurrence_mode TEXT DEFAULT 'schedule'
                CHECK (recurrence_mode IN ('schedule','completion')),
  recurrence_parent_id TEXT REFERENCES tasks(id),

  origin        TEXT NOT NULL DEFAULT 'native'
                CHECK (origin IN ('native','caldav')),
  caldav_uid    TEXT,
  caldav_etag   TEXT,
  calendar_id   TEXT REFERENCES calendars(id),

  search_text   TEXT,                       -- títol+descripció normalitzats

  created_by    TEXT NOT NULL REFERENCES users(id),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT,
  version       INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_tasks_board   ON tasks(scope_id, status, position)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_tasks_due     ON tasks(due_date)
  WHERE deleted_at IS NULL AND status != 'done';
CREATE INDEX idx_tasks_done    ON tasks(completed_at)
  WHERE status = 'done' AND deleted_at IS NULL;
CREATE INDEX idx_tasks_project ON tasks(project_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX idx_tasks_caldav ON tasks(calendar_id, caldav_uid)
  WHERE caldav_uid IS NOT NULL;
```

**`scope_id` és `NOT NULL`.** És la invariant central del producte: *"pot ser que un àmbit tingui una tasca sense projecte definit, però mai sense àmbit"*. Quan hi ha més d'un àmbit seleccionat i l'usuari escriu una tasca sense `#Àmbit`, la UI ha de demanar-lo — no pot endevinar.

**`due_date` i `due_time` separats.** Una tasca normalment no té hora. Guardar-les juntes en un instant obliga a inventar-se una hora i trenca les comparacions de "avui".

**`recurrence_mode`** (`schedule` vs `completion`) és la distinció que Todoist escriu com a `every` contra `every!`: repetir-se cada dimarts contra repetir-se una setmana **després d'haver-la fet**. Per a tasques domèstiques la segona és la que la gent vol, i **RRULE no la sap expressar** — per això és una columna pròpia i, en sortir per CalDAV, una propietat `X-`.

### `subtasks`

```sql
CREATE TABLE subtasks (
  id          TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL REFERENCES tasks(id),
  title       TEXT NOT NULL,
  done        INTEGER NOT NULL DEFAULT 0,
  position    TEXT NOT NULL COLLATE BINARY,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT,
  version     INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_subtasks_task ON subtasks(task_id) WHERE deleted_at IS NULL;
```

Una subtasca **no té àmbit propi**: hereta el de la tasca mare. Tampoc té estat de kanban: només fet o no fet.

### `checklists` i `checklist_items`

```sql
CREATE TABLE checklists (
  id          TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL REFERENCES tasks(id),
  subtask_id  TEXT REFERENCES subtasks(id),   -- ancoratge opcional
  name        TEXT NOT NULL,
  pinned      INTEGER NOT NULL DEFAULT 0,
  pinned_by   TEXT REFERENCES users(id),
  show_completed_inline INTEGER NOT NULL DEFAULT 1,
  position    TEXT NOT NULL COLLATE BINARY,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT,
  version     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE checklist_items (
  id           TEXT PRIMARY KEY,
  checklist_id TEXT NOT NULL REFERENCES checklists(id),
  text         TEXT NOT NULL,
  done         INTEGER NOT NULL DEFAULT 0,
  done_at      TEXT,
  done_by      TEXT REFERENCES users(id),
  position     TEXT NOT NULL COLLATE BINARY,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  deleted_at   TEXT,
  version      INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_items_checklist ON checklist_items(checklist_id) WHERE deleted_at IS NULL;
```

Això és P1 resolta. **Un ítem només té text i fet/no fet**: cap data, cap assignat, cap niuament. La contenció és deliberada i ve de Things 3 — és el que fa que la llista d'avui no es converteixi en un segon gestor de tasques dins del gestor de tasques. La riquesa va al contenidor: la llista es pot pinejar i compartir.

`pinned_by` fa que pinejar sigui **personal**: el rail de llistes pinejades és de cada usuari.

**La cascada amunt** (exigida pel brief): quan l'últim ítem d'una llista passa a fet, en la mateixa transacció es marca la subtasca ancorada; i si totes les llistes i subtasques d'una tasca estan fetes, la tasca passa a `status='done'`. Es registra a `activity_log` amb `verb='cascade_complete'` perquè es distingeixi d'un gest directe de l'usuari.

### Assignació i etiquetes

```sql
CREATE TABLE task_assignees (
  task_id     TEXT NOT NULL REFERENCES tasks(id),
  user_id     TEXT NOT NULL REFERENCES users(id),
  assigned_at TEXT NOT NULL,
  PRIMARY KEY (task_id, user_id)
);

CREATE TABLE labels (
  id         TEXT PRIMARY KEY,
  scope_id   TEXT NOT NULL REFERENCES scopes(id),
  name       TEXT NOT NULL,
  color      TEXT NOT NULL,
  created_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE (scope_id, name)
);

CREATE TABLE task_labels (
  task_id  TEXT NOT NULL REFERENCES tasks(id),
  label_id TEXT NOT NULL REFERENCES labels(id),
  PRIMARY KEY (task_id, label_id)
);
```

`task_assignees` és una taula i no una columna perquè el brief demana "persona o **persones** implicades".

**A un àmbit `individual` totes les tasques s'assignen automàticament al propietari.** No es demana.

### Comentaris, adjunts, recordatoris

```sql
CREATE TABLE comments (
  id          TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL REFERENCES tasks(id),
  author_id   TEXT REFERENCES users(id),
  guest_name  TEXT,                        -- comentari des d'un enllaç compartit
  share_id    TEXT REFERENCES shares(id),
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT,
  version     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE attachments (
  id           TEXT PRIMARY KEY,
  task_id      TEXT NOT NULL REFERENCES tasks(id),
  filename     TEXT NOT NULL,
  mime_type    TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL,
  storage_path TEXT NOT NULL,
  is_ai_context INTEGER NOT NULL DEFAULT 0,
  uploaded_by  TEXT NOT NULL REFERENCES users(id),
  created_at   TEXT NOT NULL,
  deleted_at   TEXT
);

CREATE TABLE reminders (
  id          TEXT PRIMARY KEY,
  task_id     TEXT REFERENCES tasks(id),
  event_id    TEXT REFERENCES events(id),
  user_id     TEXT NOT NULL REFERENCES users(id),
  trigger     TEXT NOT NULL,               -- durada ISO-8601 relativa, o instant absolut
  channel     TEXT NOT NULL
              CHECK (channel IN ('push','email','webhook')),
  fired_at    TEXT,
  created_at  TEXT NOT NULL,
  CHECK (task_id IS NOT NULL OR event_id IS NOT NULL)
);
CREATE INDEX idx_reminders_pending ON reminders(fired_at) WHERE fired_at IS NULL;
```

`is_ai_context` marca els fitxers que el brief descriu com *"arxius que serveixin de context per la IA"*. Determina què s'exposa per MCP.

---

## 5 · Calendaris i esdeveniments

Això és D8: **un esdeveniment no és una tasca**.

### `calendars`

```sql
CREATE TABLE calendars (
  id          TEXT PRIMARY KEY,
  scope_id    TEXT NOT NULL REFERENCES scopes(id),
  project_id  TEXT REFERENCES projects(id),
  name        TEXT NOT NULL,
  color       TEXT,
  kind        TEXT NOT NULL CHECK (kind IN ('events','todos')),
  origin      TEXT NOT NULL DEFAULT 'local'
              CHECK (origin IN ('local','subscription')),

  source_url       TEXT,                   -- si origin='subscription'
  source_username  TEXT,
  source_secret_enc TEXT,                  -- xifrat en repòs
  refresh_interval  INTEGER,               -- segons
  last_refreshed_at TEXT,
  strip_alarms      INTEGER NOT NULL DEFAULT 1,

  sync_seq    INTEGER NOT NULL DEFAULT 0,  -- ctag i sync-token surten d'aquí
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT
);
```

**`kind` és obligatori i únic per col·lecció** (D9). RFC 4791 §5.2 prohibeix recursos de components mixtos, DAVx⁵ classifica una col·lecció només per aquest valor, i el CalDAV de Google no accepta VTODO. Cada àmbit i cada projecte que es publiqui genera **dues** col·leccions.

**`sync_seq`** és un comptador monòton que s'incrementa **dins de la mateixa transacció** que qualsevol escriptura a la col·lecció. D'aquí surten alhora el `ctag` i el `sync-token`. Aquesta és la raó tècnica per la qual la superfície CalDAV **no pot ser un procés a part**: un segon escriptor hauria de compartir aquesta transacció.

Totes les files d'un calendari amb `origin='subscription'` són **de només lectura a la capa de repositori**, no només a la UI.

### `events`

```sql
CREATE TABLE events (
  id            TEXT PRIMARY KEY,
  calendar_id   TEXT NOT NULL REFERENCES calendars(id),
  uid           TEXT NOT NULL,             -- UID d'iCalendar
  recurrence_id TEXT,                      -- NULL ⇒ mestre; si no, instància modificada

  summary       TEXT NOT NULL,
  description   TEXT,
  location      TEXT,

  starts_at     TEXT NOT NULL,
  ends_at       TEXT,
  duration      TEXT,                      -- ISO-8601, alternativa a ends_at
  all_day       INTEGER NOT NULL DEFAULT 0,
  timezone      TEXT,                      -- TZID; NULL si all_day o UTC

  status        TEXT DEFAULT 'CONFIRMED'
                CHECK (status IN ('TENTATIVE','CONFIRMED','CANCELLED')),
  transparency  TEXT DEFAULT 'OPAQUE'
                CHECK (transparency IN ('OPAQUE','TRANSPARENT')),
  classification TEXT DEFAULT 'PUBLIC',

  rrule         TEXT,
  rdate         TEXT,                      -- JSON array
  exdate        TEXT,                      -- JSON array
  is_orphan_override INTEGER NOT NULL DEFAULT 0,

  organizer     TEXT,
  sequence      INTEGER NOT NULL DEFAULT 0,
  etag          TEXT,
  raw_ical      TEXT,                      -- component original, per fidelitat de round-trip

  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT,
  version       INTEGER NOT NULL DEFAULT 1,

  UNIQUE (calendar_id, uid, COALESCE(recurrence_id, 'epoch'))
);
CREATE INDEX idx_events_window ON events(calendar_id, starts_at) WHERE deleted_at IS NULL;
```

**Una fila per component, no per recurs.** El mestre té `recurrence_id IS NULL`; cada instància modificada és una fila germana amb el mateix `uid` i el seu propi `recurrence_id`. És el model de Google (`recurringEventId` + `originalStartTime`), d'Android (`ORIGINAL_ID` + `ORIGINAL_INSTANCE_TIME`) i de Morgen.

`is_orphan_override` tolera el cas d'una excepció importada sense el seu mestre, que passa de veritat en importar calendaris de tercers.

`raw_ical` es guarda per no perdre propietats que no modelem en un round-trip.

```sql
CREATE TABLE event_attendees (
  id         TEXT PRIMARY KEY,
  event_id   TEXT NOT NULL REFERENCES events(id),
  email      TEXT,
  name       TEXT,
  user_id    TEXT REFERENCES users(id),
  partstat   TEXT DEFAULT 'NEEDS-ACTION'
             CHECK (partstat IN ('NEEDS-ACTION','ACCEPTED','DECLINED','TENTATIVE','DELEGATED')),
  role       TEXT DEFAULT 'REQ-PARTICIPANT'
);

CREATE TABLE event_occurrences (
  event_id   TEXT NOT NULL REFERENCES events(id),
  starts_at  TEXT NOT NULL,
  ends_at    TEXT NOT NULL,
  PRIMARY KEY (event_id, starts_at)
);
CREATE INDEX idx_occ_window ON event_occurrences(starts_at, ends_at);
```

`event_occurrences` és la **finestra materialitzada** de les repeticions. L'estratègia és híbrida: es materialitza una finestra rodant (per defecte, d'un any enrere a dos endavant) i s'hi consulta; fora de la finestra s'expandeix al vol. És el que fa que una consulta de rang de temps sigui un índex i no una expansió de recurrències sencera, que és el que RFC 4791 §9.9 obligaria a fer.

**Les repeticions no se sincronitzen mai a Android.** Se sincronitzen components i s'expandeixen localment: és exactament la divisió de feina documentada de DAVx⁵ amb el proveïdor de calendari d'Android.

`RANGE=THISANDFUTURE` **es parseja però no s'emet mai**. "Aquest i els següents" s'implementa partint la sèrie (posar `UNTIL` al mestre i crear-ne un de nou), que és el que fa Google.

---

## 6 · Compartits

```sql
CREATE TABLE shares (
  id             TEXT PRIMARY KEY,
  task_id        TEXT REFERENCES tasks(id),
  checklist_id   TEXT REFERENCES checklists(id),
  created_by     TEXT NOT NULL REFERENCES users(id),

  token_hmac     TEXT NOT NULL UNIQUE,     -- HMAC amb pebre; MAI el token en clar
  secret_version INTEGER NOT NULL DEFAULT 1,
  password_hash  TEXT,                     -- argon2id, NULL si no en té
  require_name   INTEGER NOT NULL DEFAULT 0,

  permission     TEXT NOT NULL DEFAULT 'view'
                 CHECK (permission IN ('view','check','comment')),

  expires_at     TEXT,
  max_views      INTEGER,
  view_count     INTEGER NOT NULL DEFAULT 0,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until   TEXT,

  created_at     TEXT NOT NULL,
  revoked_at     TEXT,
  CHECK (task_id IS NOT NULL OR checklist_id IS NOT NULL)
);

CREATE TABLE share_accesses (
  id          TEXT PRIMARY KEY,
  share_id    TEXT NOT NULL REFERENCES shares(id),
  guest_name  TEXT,
  guest_ref   TEXT NOT NULL,               -- identificador pseudònim estable
  first_seen  TEXT NOT NULL,
  last_seen   TEXT NOT NULL
);
```

Això és D10. Tres detalls que no són opcionals:

- **El token no es guarda mai en clar.** Es busca per `token_hmac`, calculat amb un pebre del servidor. `secret_version` permet rotar el pebre sense invalidar-ho tot de cop.
- **No hi ha cap columna d'IP enlloc.** És una decisió de privadesa explícita, no un descuit.
- **`guest_ref`** és el que permet que el registre d'activitat digui "Extern · Marta" quan el convidat ha posat nom, i "Extern · a4f2" quan no. És pseudònim i estable per sessió, no derivat de dades personals.

`permission` no inclou `edit`: un convidat anònim no edita tasques.

---

## 7 · Auditoria i sincronització

### `activity_log`

```sql
CREATE TABLE activity_log (
  id           TEXT PRIMARY KEY,
  entity_type  TEXT NOT NULL,
  entity_id    TEXT NOT NULL,
  scope_id     TEXT,

  actor_type   TEXT NOT NULL
               CHECK (actor_type IN ('user','ai_agent','guest','system','caldav')),
  actor_user_id TEXT REFERENCES users(id),
  actor_agent_id TEXT REFERENCES ai_agents(id),
  actor_label  TEXT,                       -- "Extern · Marta"

  source       TEXT NOT NULL
               CHECK (source IN ('web','android','api','mcp','caldav','share','system')),

  verb         TEXT NOT NULL,              -- created, updated, moved, completed, cascade_complete, deleted…
  changes      TEXT,                       -- JSON: {camp: {from, to}}
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_activity_entity ON activity_log(entity_type, entity_id, created_at);
CREATE INDEX idx_activity_scope  ON activity_log(scope_id, created_at);
```

Append-only. **S'escriu dins de la mateixa transacció que el canvi** (regla 4 d'`instruccions.md`). `changes` guarda el valor anterior i el nou, que és el que fa possible desfer un canvi autònom de la IA.

### `change_log`

```sql
CREATE TABLE change_log (
  seq          INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type  TEXT NOT NULL,
  entity_id    TEXT NOT NULL,
  scope_id     TEXT,
  operation    TEXT NOT NULL CHECK (operation IN ('upsert','delete')),
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_change_scope ON change_log(scope_id, seq);
```

Aquest és el motor del sync incremental. El cursor que els clients envien és aquest `seq`. **A Postgres, `AUTOINCREMENT` es substitueix per `BIGSERIAL`** — però compte: amb `BIGSERIAL` una fila pot fer-se visible fora d'ordre si una transacció llarga acaba després d'una de curta amb `seq` més alt. El detall i la solució són a [`06-sync.md`](06-sync.md).

`activity_log` i `change_log` són coses diferents i totes dues calen: el primer és per a l'usuari (què va passar i qui ho va fer), el segon per a les màquines (què ha canviat des del cursor N).

### `webhooks`

```sql
CREATE TABLE webhooks (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  url           TEXT NOT NULL,
  secret_enc    TEXT NOT NULL,            -- xifrat en repòs; signa amb HMAC
  events        TEXT NOT NULL,            -- JSON array: task.created, task.completed…
  scope_ids     TEXT,                     -- JSON array; NULL = tots els del propietari
  enabled       INTEGER NOT NULL DEFAULT 1,
  fail_count    INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT,
  last_success_at TEXT,
  disabled_at   TEXT,                     -- desactivat automàticament després de 24 h fallant
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX idx_webhooks_enabled ON webhooks(enabled) WHERE disabled_at IS NULL;
```

`scope_ids` fa que un webhook tingui el mateix abast per àmbits que un token: un webhook cap a n8n pot rebre només el que passa a Feina.

La URL la dona l'usuari i el servidor hi anirà: **s'hi apliquen les mateixes mitigacions d'SSRF** que als calendaris d'origen ([`10-compartits-i-seguretat.md`](10-compartits-i-seguretat.md) §7).

El comportament d'enviament, signatura i reintents és a [`05-api-rest.md`](05-api-rest.md) §6.

---

## 8 · Temps: la part que es trenca sola

Tres classes de valor temporal, tres formes d'emmagatzematge:

| Què | Com | Exemple |
| --- | --- | --- |
| Data de tot el dia | `TEXT` `YYYY-MM-DD`, **sense fus** | `due_date = '2026-08-05'` |
| Instant | `TEXT` ISO-8601 UTC amb `Z` | `completed_at = '2026-08-05T14:30:00Z'` |
| Hora local d'un dia | data + `HH:MM` + `timezone` a part | `due_date` + `due_time` |

**Una funció, i totes les consultes de "avui" hi passen:**

```
localDayBounds(timezone, date) → { startUTC, endUTC }
```

Es construeix el començament del dia local i el començament del **dia següent** en el mateix fus, i es converteixen a UTC. **No es fa `inici + 24 h`**: els dies de canvi d'hora tenen 23 o 25 hores, i fer-ho amb una suma dona resultats incorrectes dos dies l'any sense cap error visible.

Aquesta funció és el punt on es decideix si "què he de fer avui" és correcte. S'ha de provar amb `Europe/Madrid` els dos diumenges de canvi d'hora, i amb un fus de desplaçament no sencer com `Pacific/Chatham` (+12:45 / +13:45).

**Cada usuari té el seu `timezone`.** Les consultes es resolen en el fus de **qui mira**, no en el del servidor ni en el de qui va crear la tasca.

### La columna "Fet"

Això és P2. **No hi ha cap estat "netejat" a la tasca ni cap tasca programada a mitjanit.**

```sql
-- El que es veu per defecte
SELECT * FROM tasks
WHERE status = 'done'
  AND deleted_at IS NULL
  AND completed_at >= :seven_days_ago
ORDER BY completed_at DESC;
```

El client agrupa el resultat: avui desplegat, i "Ahir" i "Aquesta setmana" plegats amb el recompte. `user_settings.done_cleared_at` es guarda **per usuari** i només mou el llindar de què es veu desplegat: no esborra res i no afecta ningú altre de la casa.

El mini-calendari de la capçalera consulta qualsevol dia passat amb el mateix índex. El botó "veure tot el fet d'avui" ignora el `done_cleared_at`.

### Arrossegar les tasques no fetes

"Per fer" és rígid i les tasques hi queden fins que algú les mou. No cal cap feina programada: una tasca amb `status='todo'` hi continua demà per construcció. El que **sí** que és configurable és si l'Inbox ensenya les tasques amb `due_date` anterior a avui i encara no fetes.

---

### `task_sessions` — el temps treballat

```sql
CREATE TABLE task_sessions (
  id         TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL REFERENCES tasks(id),
  scope_id   TEXT NOT NULL REFERENCES scopes(id),   -- desnormalitzat: tot el filtratge hi passa
  user_id    TEXT NOT NULL REFERENCES users(id),    -- qui va moure la targeta
  started_at INSTANT NOT NULL,
  ended_at   INSTANT,                               -- NULL = s'està fent ara
  source     TEXT NOT NULL CHECK (source IN ('board','manual','backfill')),
  note       TEXT,
  created_at, updated_at, deleted_at, version
);
```

**Un bloc per estada a «Fent», i cap acumulat** (P27). Els obre i els tanca `moveTask`, que
és l'únic camí pel qual una tasca canvia de columna: no hi ha cronòmetre, perquè el gest que
ja fas per dir «hi estic» és el que compta les hores.

**Aquí no hi ha cap `minutes`**: la suma es calcula sempre dels blocs. Guardar el total i els
trams és guardar el mateix número dues vegades, i el dia que discrepin ningú sabrà quin mana.

Per sota d'un minut no es desa: passar per Fent en un clic no és temps treballat.

### `scope_settings` — com es comporta un àmbit

Una fila per àmbit, **i la fila absent és el cas normal**: `time_tracking`, `work_start`,
`work_end`, `work_days` (set caràcters començant en dilluns), `overtime_visible`,
`long_session_hours`, `project_noun` (`project` | `client`), `task_types_enabled` i
`task_type_required`.

`scopes` guarda **qui és** l'àmbit; això, **com es comporta**. Van separats perquè són coses
de vides diferents: la identitat la mira tothom qui pinta un xip, i el comportament només qui
obre el Registre. I sense fila, tot pren el valor de `policy/scope-settings.ts`, que és el
que fa que la migració no encengui res a ningú.

### `task_types` — en què es va anar el temps

`(id, scope_id, name, color, position)` amb `UNIQUE (scope_id, name)`, i `tasks.task_type_id`
amb `ON DELETE SET NULL`: esborrada la tipologia, la feina feta segueix comptant sota «Sense
tipologia».

**No són etiquetes** (P27): n'hi ha **una** per tasca, la manté qui mana a l'àmbit, i pot ser
obligatòria. El sigil de l'afegida ràpida és `$`, perquè `#` ja és l'àmbit i el projecte.

---

## 9 · Recurrència

`rrule` guarda una **RRULE d'RFC 5545**, no un nombre de segons. Vikunja fa servir segons i és la seva limitació més citada: no pot expressar "el primer dimarts de cada mes", que és exactament el tipus de norma domèstica que Fem-ho necessita.

L'estratègia és **materialització de la següent ocurrència**: existeix la instància actual i, en completar-la, es crea la següent amb `recurrence_parent_id` apuntant a la sèrie. Així una instància es pot editar, moure de columna o comentar sense afectar les altres.

`recurrence_mode` decideix des d'on es compta:

- `schedule` — la següent surt de la RRULE aplicada a la data prevista.
- `completion` — la següent surt de la RRULE aplicada a **`completed_at`**. "Regar les plantes cada 5 dies" vol dir 5 dies des que les vaig regar, no des que tocava.

En sortir per CalDAV, `recurrence_mode='completion'` viatja com una propietat `X-`, perquè iCalendar no ho sap dir.

---

## 10 · Origen: natiu contra importat

`tasks.origin` i `calendars.origin` distingeixen el que s'ha creat a Fem-ho del que ve de fora.

Per evitar bucles de sincronització:

1. Cada objecte importat guarda el `caldav_etag` amb què va arribar.
2. En escriure cap enfora, es compara l'etag; si el remot ha canviat pel seu compte, es resol el conflicte abans d'escriure.
3. **Les escriptures originades per la sincronització CalDAV s'etiqueten `source='caldav'`** a `activity_log` i **no** tornen a disparar una sortida cap al mateix origen.

El detall del bucle és a [`07-caldav.md`](07-caldav.md).

---

## 11 · Cerca

SQLite amb FTS5 sobre `tasks.search_text`, que es manté amb triggers.

El català necessita normalització que cap tokenitzador fa sol:

- Accents: `à è é í ò ó ú ï ü` → lletra base, perquè "Reunio" trobi "Reunió".
- `ç` → `c`.
- La ela geminada `l·l` → `ll`, i el punt volat s'elimina també quan es fa servir com a separador.
- Apòstrofs `'` i `'` normalitzats abans de tokenitzar, perquè "l'informe" indexi també "informe".

La normalització es fa **a l'aplicació** i el resultat s'escriu a `search_text`. La consulta es normalitza igual abans de llançar-la.

A PostgreSQL, `tsvector` amb `unaccent`. Cal provar les dues a CI (D11): és aquí on es nota.

---

## 12 · Esborrat i tombstones

Cap `DELETE` real en entitats sincronitzables. `deleted_at` marca l'esborrat i `change_log` rep una fila `operation='delete'`.

Les tombstones es conserven **90 dies**. Un client que torni després d'aquest període rep un senyal de resincronització completa en comptes d'un delta — el mateix mecanisme que el `507` de CalDAV amb un sync-token caducat. Està especificat a [`06-sync.md`](06-sync.md).

L'esborrat definitiu (buidar tombstones, esborrar fitxers dels adjunts) el fa una feina programada, i "netejar instància" d'Ajustos → Admin és la versió manual i total, descrita a [`10-compartits-i-seguretat.md`](10-compartits-i-seguretat.md).
