# Vikunja — Complete Teardown (reference dossier for building Fem-ho)

**Research date:** 2026-08-05
**Target reader:** an AI writing production code for *Fem-ho* (self-hosted personal + family task manager: Go/other backend + web app + native Android, Catalan UI, scopes/àmbits, kanban 4 columns, CalDAV, REST, MCP, AI user, public share links).
**Why Vikunja:** it is the closest existing OSS analogue to Fem-ho (self-hosted, single binary + Docker, multi-user, projects + views + kanban, CalDAV bidirectional, REST API, scoped API tokens, link shares, quick-add parsing, bot users for AI agents). Everything below is either *verified from primary sources* (docs pages on vikunja.io, source files on github.com/go-vikunja/vikunja `main`) or explicitly flagged **UNVERIFIED**.

> **Provenance note.** Vikunja's canonical repo moved from `code.vikunja.io/api` (self-hosted Gitea at kolaente.dev) to **`github.com/go-vikunja/vikunja`** — a single monorepo containing `pkg/` (Go API) and `frontend/` (Vue 3). All `raw.githubusercontent.com/go-vikunja/vikunja/main/...` paths below were fetched successfully and are real. `code.vikunja.io` still resolves as a vanity import path.

---

## 0. Executive summary — the 15 things worth stealing

1. **Views as first-class DB rows** (`project_views` table) with `view_kind` ∈ {list, gantt, table, kanban}, a per-view `filter`, per-view `position`, and per-view kanban config (`bucket_configuration_mode`, `default_bucket_id`, `done_bucket_id`). This is the single best structural idea in Vikunja.
2. **`task_positions` is a separate table keyed by `(task_id, project_view_id)`** with a `float64 position`. A task therefore has an *independent* sort position in every view. Fem-ho's kanban ordering should copy this exactly.
3. **Float positions with midpoint insertion** + `MinPositionSpacing = 0.01` + server-side recalculation when the gap collapses. Initial spread uses `maxPosition = 2^32`.
4. **Filter query language** (`done = false && due_date < now/w+1w`) with Elasticsearch-style **date math** (`now`, `+7d`, `/d` rounding, `2024-03-11||+1w`) via the `go-datemath` library.
5. **Saved filters = pseudo-projects with negative IDs**: `project_id = -(filter_id) - 1`, i.e. filter 1 → project -1... except `-1` is taken by the Favorites pseudo-project. (See §7.3 for the exact off-by-one.)
6. **Scoped API tokens**: `tk_` prefix + 40 hex chars, PBKDF2-SHA256 10 000 iterations, permissions stored as `map[string][]string` like `{"tasks":["read_all","update"],"caldav":["access"]}`, and a **`GET /api/v1/routes`** endpoint that *self-describes* every available scope. This is exactly the "separately scoped tokens for humans vs AI" that Fem-ho wants.
7. **Bot users** (`bot-` username prefix, no password, no email, API-token-only, owned by a human) — Vikunja's answer to Fem-ho's "AI user".
8. **`veans` agent CLI** with a hard workflow rule: *agents may move tasks to "In Review" but never to "Done"* — human-in-the-loop by construction.
9. **CalDAV at `/dav`** with a documented, honest list of supported/unsupported VTODO properties and a documented list of clients that work and clients that don't.
10. **Link shares**: `hash` (varchar 40), `permission` 0/1/2, `sharing_type` 0/1/2 derived from whether a password is set, `password` write-only, and a dedicated `POST /shares/{hash}/auth` that mints a JWT for the anonymous session.
11. **Quick Add Magic** with three modes (Disabled / Vikunja / Todoist) and swappable prefix tables — a clean way to make parsing configurable.
12. **Webhooks** with `X-Vikunja-Signature` = HMAC-SHA256 of the raw body, and a `GET /api/v1/webhooks/events` endpoint that self-describes available events.
13. **RFC 9457 `application/problem+json`** errors + ETags + JSON Merge Patch in the v2 API.
14. **`expand` query param** (`?expand=subtasks,buckets,comments,reactions,comment_count,is_unread`) — one endpoint, caller-controlled payload weight. Critical for an offline-first Android client.
15. **Keyboard-shortcut system with `g`-prefixed chords** (`g o`, `g p`, `g k`…) plus `ctrl/⌘+k` quick actions.

---

## 1. Versions and stack (verified from `main`, 2026-08-05)

### 1.1 Backend — `go.mod`

```
go 1.26.4
```

| Purpose | Module | Version |
|---|---|---|
| HTTP framework | `github.com/labstack/echo/v5` | v5.3.1 |
| JWT middleware | `github.com/labstack/echo-jwt/v5` | v5.0.2 |
| JWT | `github.com/golang-jwt/jwt/v5` | v5.3.1 |
| ORM | `xorm.io/xorm` | v1.4.1 |
| SQL builder | `xorm.io/builder` | v0.3.13 |
| MySQL driver | `github.com/go-sql-driver/mysql` | v1.10.0 |
| Postgres driver | `github.com/lib/pq` | v1.12.3 |
| SQLite driver | `github.com/mattn/go-sqlite3` | v1.14.49 (cgo) |
| iCalendar | `github.com/arran4/golang-ical` | v0.3.5 |
| CalDAV server | `github.com/samedi/caldav-go` | v3.0.0+incompatible **(with a `replace` directive — Vikunja maintains a fork)** |
| Date math | `github.com/jszwedko/go-datemath` | v0.1.1-0.20230526204004-640a500621d6 |
| Redis | `github.com/redis/go-redis/v9` | v9.22.0 |
| Tests | `github.com/stretchr/testify` v1.11.1, `github.com/go-testfixtures/testfixtures/v3` v3.19.0 |
| Build | `github.com/magefile/mage` v1.17.2 (Magefile, not Make) |

**Takeaway:** Echo v5 + xorm. Not GORM, not chi, not gin. xorm's struct-tag-driven schema (`xorm:"bigint autoincr not null unique pk"`) is what makes the model definitions below so readable — each Go struct *is* both the DB schema and the JSON contract.

### 1.2 Frontend — `frontend/package.json`

```
name: vikunja-frontend
version: 2.5.0
license: AGPL-3.0-or-later
node: >=24.0.0
packageManager: pnpm@11.19.0
```

Scripts: `dev: vite`, `build: vite build && workbox copyLibraries dist/`, `lint: eslint 'src/**/*.{js,ts,vue}'`, `test:e2e: playwright test`, `test:unit: vitest --dir ./src`, `typecheck: vue-tsc --build --force`.

| Dep | Version |
|---|---|
| vue | 3.5.40 |
| vue-router | 5.2.0 |
| pinia | 4.0.2 |
| axios | 1.19.0 |
| @tiptap/vue-3 | 3.29.2 (rich-text description editor) |
| dayjs | 1.11.21 |
| marked | 18.0.7 |
| typescript | 6.0.3 |
| vite | 8.2.0 |
| tailwindcss | 4.3.3 |
| @playwright/test | 1.62.1 |
| vitest | 4.1.10 |

**Notable:** the frontend now uses **Tailwind 4**, not Bulma (Vikunja historically shipped Bulma + custom SCSS). Workbox is used for the service worker → PWA/offline shell. TipTap is the description editor (ProseMirror-based) and it also powers `@`-mentions and `:emoji` autocomplete.

> **Version caveat.** These are the versions on `main` as of the fetch. Some (vite 8, vue-router 5, typescript 6, eslint 10, node 24) are ahead of what a reader may expect; they were read directly from `package.json` and are reported as-is.

### 1.3 Product versions worth knowing

- **0.21.0** — the big breaking release: **namespaces removed**, **lists renamed to projects**, projects became infinitely nestable.
- **2.0.0** — security fixes + breaking changes.
- **2.3.0** — API tokens gained a `caldav` permission group (use a `tk_` token as the CalDAV password).
- **2.4.0** — **v2 API**, Vikunja Pro (waitlist), bot users, `veans` CLI, OAuth 2.0 authorization server, comment replies, emoji autocomplete, accessibility overhaul, native apt/rpm/pacman/apk repos with GPG signing, ParadeDB relevance search, Atom feed for notifications, 10 CVEs fixed.
- **2.5.0** — current frontend version string on `main`.

---

## 2. Architecture & deployment

### 2.1 Single binary

API + frontend are **bundled into one deployable binary / Docker image**. The Vue SPA is embedded and served by the Go binary. Default listen address `:3456`. Default DB: SQLite.

Docker image: **`vikunja/vikunja`** (single image; the old split `vikunja/api` + `vikunja/frontend` images are gone).

### 2.2 Reference docker-compose (verbatim from docs, minimal variant)

```yaml
services:
  vikunja:
    image: vikunja/vikunja
    environment:
      VIKUNJA_SERVICE_PUBLICURL: http://<the public ip or host where Vikunja is reachable>
      VIKUNJA_DATABASE_HOST: db
      VIKUNJA_DATABASE_PASSWORD: changeme
      VIKUNJA_DATABASE_TYPE: postgres
      VIKUNJA_DATABASE_USER: vikunja
      VIKUNJA_DATABASE_DATABASE: vikunja
      VIKUNJA_SERVICE_SECRET: <a super secure random secret>
    ports:
      - 3456:3456
    volumes:
      - ./files:/app/vikunja/files
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped
  db:
    image: postgres:18
    environment:
      POSTGRES_PASSWORD: changeme
      POSTGRES_USER: vikunja
    volumes:
      - ./db:/var/lib/postgresql
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -h localhost -U $$POSTGRES_USER"]
      interval: 2s
      start_period: 30s
```

Pre-deployment step documented: `mkdir $PWD/files && chown 1000 $PWD/files` (container runs as UID 1000; macOS can skip).

Caddy variant is a plain `reverse_proxy vikunja:3456`. Traefik variant uses labels only — **no path-splitting between API and frontend**, because there is only one service. That is a major operational simplification versus a split-container design.

### 2.3 Config file structure and env-var mapping

Formats accepted: **TOML, YAML, HCL, INI, JSON, envfile, environment variables, Java Properties**. YAML/TOML recommended. (This is `spf13/viper` behaviour.)

**Search order for `config.yml`:**
1. Next to the binary
2. `service.rootpath`
3. `/etc/vikunja`
4. `~/.config/vikunja`

`VIKUNJA_SERVICE_ROOTPATH` can override the starting point.

**Env-var mapping rule:** nested keys → uppercase, `_`-joined, `VIKUNJA_` prefix.

| Config path | Env var |
|---|---|
| `service.interface` | `VIKUNJA_SERVICE_INTERFACE` |
| `database.password` | `VIKUNJA_DATABASE_PASSWORD` |
| `auth.openid.providers.<key>.clientid` | `VIKUNJA_AUTH_OPENID_PROVIDERS_<KEY>_CLIENTID` |

Env vars **take precedence** over the config file.

**Secret-from-file support** (for Docker secrets / systemd credentials):

```yaml
database:
  password:
    file: /path/to/password
```
```bash
export VIKUNJA_DATABASE_PASSWORD_FILE=/path/to/password
```
File paths support env expansion, e.g. `$CREDENTIALS_DIRECTORY/secret`.

### 2.4 Config sections (complete list, with the keys that matter)

**`service`** — `secret` (JWT signing; *regenerated on every restart if unset* → all sessions invalidated), `interface` (`:3456`), `publicurl` (required for CORS; must be valid http/https), `rootpath`, `jwtttl` (259200 = 3d), `jwtttllong` (2592000 = 30d, remember-me), `jwtttlshort` (600 = 10min, OAuth access tokens), `enableregistration` (true), `enablelinksharing` (true), `enablecaldav`, `enabletaskattachments`, `enabletaskcomments`, `timezone` (TZ db name, default GMT), `ipextractionmethod` ∈ `direct|xff|realip`.

**`database`** — `type` ∈ `sqlite|mysql|postgres` (default sqlite), `path` (`./vikunja.db`), `host`, `user`, `password`, `database`, `maxopenconnections` (100), `sslmode`/`sslcert`/`sslkey`/`sslrootcert` (pg), `tls` ∈ `false|true|skip-verify|preferred` (mysql).

**`redis`** — `enabled` (false), `host` (`localhost:6379`), `password`, `db` (0).

**`keyvalue`** — `type` ∈ `memory|redis` (default memory). Used for caching + rate limiting + link-share sessions.

**`cache`** — separate cache toggle (see docs; keyvalue is the newer mechanism).

**`mailer`** — `enabled` (false), `host`, `port` (587), `authtype` ∈ `plain|login|cram-md5`, `username`, `password`, `fromemail` (`mail@vikunja`), `forcessl`, `skiptlsverify`, `queuelength`, `queuetimeout`.

**`log`** — `path`, `standard` ∈ `stdout|stderr|file|off`, `level` ∈ `CRITICAL|ERROR|WARNING|NOTICE|INFO|DEBUG`, `format` ∈ `text|json`, plus per-component: `database`, `http`, `events`, `mail`.

**`ratelimit`** — `enabled` (false), `kind` ∈ `user|ip`, `period`, `limit`, `noauthlimit` (10/min for unauthenticated), `store` ∈ `keyvalue|memory|redis`.

**`files`** — `basepath` (`./files`), `maxsize` (20MB, human-readable), `type` ∈ `local|s3`, plus S3: `endpoint`, `bucket`, `region`, `accesskey`, `secretkey`, `usepathstyle`, `disablesigning`.

**`cors`** — `enable` (true), `origins` (default `http://127.0.0.1:*`, `http://localhost:*`).

**`auth`** — `local.enabled` (true); `openid.enabled` (false) + `openid.providers.<name>.{authurl,clientid,clientsecret}`, `scope` (default `openid email profile`), `usernamefallback`, `emailfallback`, `forceuserinfo`, `requireavailability`; `ldap.enabled` (false) + `host`, `port` (389), `basedn`, `userfilter`, `binddn`, `bindpassword`, `groupsyncenabled`, `attribute.{username,email,displayname}`.

**`migration`** — per-migrator `enable`, `clientid`, `clientsecret`, `redirecturl` (Todoist, Trello, Microsoft Todo).

**`avatar`** — `gravatarexpiration` (3600), `gravatarbaseurl`.

**`backgrounds`** — `providers.upload.enabled` (true), `providers.unsplash.{enabled,accesstoken,applicationid}`.

**`metrics`** — `enabled` (false) → `/api/v1/metrics` Prometheus endpoint, `username`/`password` for basic auth.

**`defaultsettings`** — applied to new users: `avatar_provider` ∈ `gravatar|initials|upload|marble` (default `initials`), `email_reminders_enabled`, `timezone`, `language` (ISO 639-1 + ISO 3166-1), `week_start` (0 = Sunday, 1 = Monday), `overdue_tasks_reminders_time` (default `9:00`).

**`webhooks`** — `enabled` (true), `timeoutseconds` (30), `allownonroutableips` (false), `proxyurl`, `proxypassword`.

**`outgoingrequests`** — global SSRF guard for webhooks/avatars/migrations: `allownonroutableips`, `proxyurl`, `proxypassword`.

**`audit`** (Pro) — `enabled`, `logfile`, `rotation.maxsizemb` (100), `rotation.maxage` (30 days).

**`autotls`** — `enabled`, `email`, `renewbefore` (`30d`). Built-in Let's Encrypt.

**`plugins`** — `enabled` (false), `dir`, `loader` ∈ `yaegi|native` (default `native`).

**`license`** — `key` for Vikunja Pro.

**`legal`** — `imprinturl`, `privacyurl`.

**`sentry`** — `enabled`, `dsn`, `frontendenabled`, `frontenddsn`.

### 2.5 → What Fem-ho should do

- **Copy the single-binary shape.** One Docker image, one port, embedded SPA. The Android app then targets exactly one origin (`https://femho.example.net`) and the login screen's "server URL" field is unambiguous — no `/api` vs `/` split to explain.
- **Copy the env-var convention verbatim in spirit**: `FEMHO_<SECTION>_<KEY>` with `_FILE` suffix support for secrets. Docker Compose users will get it immediately.
- **Copy the config search order** (next to binary → rootpath → `/etc/femho` → `~/.config/femho`).
- **Copy `service.publicurl` being mandatory** — it removes an entire class of "my app can't talk to my API" support tickets, and Fem-ho needs it anyway for CalDAV principal URLs and public share links.
- **Copy `service.secret` semantics but invert the default**: Vikunja regenerates the JWT secret on restart if unset, which silently logs everyone out. Fem-ho should **generate once and persist to the data dir**, and log a warning — an offline-first Android client being logged out on every server restart is a support nightmare.
- **Do differently:** Vikunja's `keyvalue`/`redis`/`cache` split is three overlapping concepts. Fem-ho should have exactly one: `cache.type ∈ memory|redis`.
- **Adopt `outgoingrequests.allownonroutableips = false` by default.** Fem-ho will let users register webhooks and AI callbacks; SSRF protection must be on by default in a household deployment on a LAN full of other services.

---

## 3. The data model

All structs below are **verbatim from `pkg/models/*.go` on `main`**. The `xorm` tag is the DDL; the `json` tag is the API contract; `param` is the Echo path-param binding; `doc`/`readOnly`/`enums` feed the OpenAPI generator.

### 3.1 `Project` (`pkg/models/project.go`)

```go
type Project struct {
	ID                    int64             `xorm:"bigint autoincr not null unique pk" json:"id" param:"project" readOnly:"true"`
	Title                 string            `xorm:"varchar(250) not null" json:"title" valid:"required,runelength(1|250)" minLength:"1" maxLength:"250"`
	Description           string            `xorm:"longtext null" json:"description"`
	Identifier            string            `xorm:"varchar(10) null" json:"identifier" valid:"runelength(0|10)" maxLength:"10"`
	HexColor              string            `xorm:"varchar(6) null" json:"hex_color" valid:"runelength(0|7)" maxLength:"7"`
	OwnerID               int64             `xorm:"bigint INDEX not null" json:"-"`
	ParentProjectID       *int64            `xorm:"bigint INDEX null" json:"parent_project_id"`
	ParentProject         *Project          `xorm:"-" json:"-"`
	Owner                 *user.User        `xorm:"-" json:"owner" valid:"-" readOnly:"true"`
	IsArchived            bool              `xorm:"not null default false" json:"is_archived" query:"is_archived"`
	BackgroundFileID      int64             `xorm:"null" json:"-"`
	BackgroundInformation interface{}       `xorm:"-" json:"background_information" readOnly:"true"`
	BackgroundBlurHash    string            `xorm:"varchar(50) null" json:"background_blur_hash" readOnly:"true"`
	IsFavorite            bool              `xorm:"-" json:"is_favorite"`
	Subscription          *Subscription     `xorm:"-" json:"subscription,omitempty" readOnly:"true"`
	Position              float64           `xorm:"double null" json:"position"`
	Views                 []*ProjectView    `xorm:"-" json:"views" readOnly:"true"`
	Expand                ProjectExpandable `xorm:"-" json:"-" query:"expand"`
	MaxPermission         Permission        `xorm:"-" json:"max_permission" readOnly:"true"`
	Created               time.Time         `xorm:"created not null" json:"created" readOnly:"true"`
	Updated               time.Time         `xorm:"updated not null" json:"updated" readOnly:"true"`
	web.CRUDable    `xorm:"-" json:"-"`
	web.Permissions `xorm:"-" json:"-"`
}

type ProjectExpandable string
const ProjectExpandableRights = `permissions`
const FavoritesPseudoProjectID = -1
```

Key facts:
- `Identifier` (≤10 chars) builds human task keys like `PROJ-123` — Vikunja's `Task.Identifier` is computed as `<project.identifier>-<task.index>`.
- `ParentProjectID` is a **nullable pointer** — infinite nesting. `0`/null = top-level.
- `BackgroundBlurHash` — a BlurHash string stored so the client can render a placeholder before the image loads. Cheap, high-perceived-quality trick.
- `MaxPermission` is a computed field telling the client what the current caller may do — the client doesn't have to re-derive ACLs. In v2 this moved from the `x-max-permission` **header** into the body.
- `Position float64` orders projects in the sidebar.

**`FavoritesPseudoProject`** is a hard-coded in-memory project with `ID = -1`, title `"Favorites"`, `Position: -1`, and three hard-coded views with **negative IDs** (`-1` List with filter `done = false`, `-2` Gantt, `-3` Table). It is not in the DB.

### 3.2 Namespaces → parent projects (the 0.21.0 migration)

Before 0.21.0 the hierarchy was **namespace → list → task** with sharing at both namespace and list level.

0.21.0 changes:
- "lists" renamed to **projects** everywhere (API paths, DB tables, UI).
- **Namespaces removed entirely.** Migration: *every existing namespace became a top-level project containing the lists it previously contained.*
- Projects became **nestable to arbitrary depth** — "subprojects" existed for the first time, which is what replaced the namespace tier.
- **Old dumps/exports are not importable** across this boundary: "Importing a previous dump or export is not supported - please do a new dump instead of importing the old one."
- Scale of the change: ~756 frontend changes + ~250 API changes.

**What broke / what users noticed:** namespace-level sharing had no direct equivalent, so permissions had to be re-derived per project. There is still an open complaint that **a parent project does not show tasks from its subprojects** (issue **#1529 "Display tasks from subprojects"**, 11 reactions) — i.e. the nesting is organizational only, not aggregational. And issue on the community forum: *"Moving a Parent Project deleted a Child Project"*.

### 3.3 `Task` (`pkg/models/tasks.go`)

```go
type Task struct {
	ID                     int64                      `xorm:"bigint autoincr not null unique pk" json:"id" param:"projecttask" readOnly:"true"`
	Title                  string                     `xorm:"TEXT not null" json:"title" valid:"minstringlength(1)" minLength:"1"`
	Description            string                     `xorm:"longtext null" json:"description"`
	Done                   bool                       `xorm:"INDEX null" json:"done"`
	DoneAt                 time.Time                  `xorm:"INDEX null 'done_at'" json:"done_at" readOnly:"true"`
	DueDate                time.Time                  `xorm:"DATETIME INDEX null 'due_date'" json:"due_date"`
	Reminders              []*TaskReminder            `xorm:"-" json:"reminders"`
	ProjectID              int64                      `xorm:"bigint INDEX not null unique(tasks_project_index)" json:"project_id" param:"project"`
	RepeatAfter            int64                      `xorm:"bigint INDEX null" json:"repeat_after" valid:"range(0|9223372036854775807)"`
	RepeatMode             TaskRepeatMode             `xorm:"not null default 0" json:"repeat_mode"`
	Priority               int64                      `xorm:"bigint null" json:"priority"`
	StartDate              time.Time                  `xorm:"DATETIME INDEX null 'start_date'" json:"start_date" query:"-"`
	EndDate                time.Time                  `xorm:"DATETIME INDEX null 'end_date'" json:"end_date" query:"-"`
	Assignees              []*user.User               `xorm:"-" json:"assignees" readOnly:"true"`
	Labels                 []*Label                   `xorm:"-" json:"labels" readOnly:"true"`
	HexColor               string                     `xorm:"varchar(6) null" json:"hex_color" valid:"runelength(0|7)" maxLength:"7"`
	PercentDone            float64                    `xorm:"DOUBLE null" json:"percent_done"`
	Identifier             string                     `xorm:"-" json:"identifier" readOnly:"true"`
	Index                  int64                      `xorm:"bigint not null default 0 unique(tasks_project_index)" json:"index" param:"index" readOnly:"true"`
	UID                    string                     `xorm:"varchar(250) null" json:"-"`
	RelatedTasks           RelatedTaskMap             `xorm:"-" json:"related_tasks" readOnly:"true"`
	Attachments            []*TaskAttachment          `xorm:"-" json:"attachments" readOnly:"true"`
	CoverImageAttachmentID int64                      `xorm:"bigint default 0" json:"cover_image_attachment_id"`
	IsFavorite             bool                       `xorm:"-" json:"is_favorite"`
	IsUnread               *bool                      `xorm:"-" json:"is_unread,omitempty" readOnly:"true"`
	Subscription           *Subscription              `xorm:"-" json:"subscription,omitempty" readOnly:"true"`
	Created                time.Time                  `xorm:"created not null" json:"created" readOnly:"true"`
	Updated                time.Time                  `xorm:"updated not null" json:"updated" readOnly:"true"`
	DeletedAt              time.Time                  `xorm:"deleted datetime null INDEX 'deleted_at'" json:"deleted_at,omitzero" readOnly:"true"`
	BucketID               int64                      `xorm:"-" json:"bucket_id"`
	Buckets                []*Bucket                  `xorm:"-" json:"buckets,omitempty" readOnly:"true"`
	Comments               []*TaskComment             `xorm:"-" json:"comments,omitempty" readOnly:"true"`
	CommentCount           *int64                     `xorm:"-" json:"comment_count,omitempty" readOnly:"true"`
	TimeEntriesCount       *int64                     `xorm:"-" json:"time_entries_count,omitempty" readOnly:"true"`
	Expand                 []TaskCollectionExpandable `xorm:"-" json:"-" query:"expand"`
	Position               float64                    `xorm:"-" json:"position" readOnly:"true"`
	Reactions              ReactionMap                `xorm:"-" json:"reactions" readOnly:"true"`
	CreatedBy              *user.User                 `xorm:"-" json:"created_by" valid:"-" readOnly:"true"`
	CreatedByID            int64                      `xorm:"bigint not null" json:"-"`
	web.CRUDable    `xorm:"-" json:"-"`
	web.Permissions `xorm:"-" json:"-"`
}

type TaskRepeatMode int
const (
	TaskRepeatModeDefault TaskRepeatMode = iota // 0
	TaskRepeatModeMonth                          // 1
	TaskRepeatModeFromCurrentDate                // 2
)
```

Design points worth extracting:

- **`xorm:"-"` fields are computed/joined, not columns.** `Assignees`, `Labels`, `Reminders`, `RelatedTasks`, `Attachments`, `Position`, `BucketID`, `Buckets`, `Reactions`, `IsFavorite`, `Identifier` all live in join tables or are derived. The `Task` row itself is narrow.
- **Composite unique `(project_id, index)`** gives every task a stable per-project sequence number → `PROJ-42` identifiers that survive moves within a project.
- **Soft delete** via `xorm:"deleted"` on `deleted_at` + a `task_delete_cron.go` that hard-deletes later. Gives a trash/undo window for free.
- **`percent_done` is a float** (0..1), separate from `done`. Open issue **#1285** asks for "finishing task should set progress to 100%" — Vikunja does *not* do this today.
- **`priority int64`**, no enum constant in the model. The UI/quick-add uses **1..5**: 1 = Low, 2 = Medium, 3 = High, 4 = Urgent, 5 = DO NOW. 0 = unset. (Verified from Quick Add Magic docs: `!1` … `!5`, "1 (low) to 5 (urgent)".)
- **`UID varchar(250)`** — the CalDAV/iCal UID. Stored on the task, not derived. Essential for round-tripping VTODOs.
- **`cover_image_attachment_id`** — kanban cards can show an attachment as a cover image.
- **`is_unread` + `Subscription`** — per-user read state, only populated when `?expand=is_unread`.
- **`repeat_after` is an interval in seconds** (int64), not an RRULE. `repeat_mode` then reinterprets it. This is a deliberate simplification and is also Vikunja's biggest recurring-task weakness (see §16).

### 3.4 `TaskRelation` (`pkg/models/task_relation.go`) — verbatim

```go
type RelationKind string

const (
	RelationKindUnknown     RelationKind = `unknown`
	RelationKindSubtask     RelationKind = `subtask`
	RelationKindParenttask  RelationKind = `parenttask`
	RelationKindRelated     RelationKind = `related`
	RelationKindDuplicateOf RelationKind = `duplicateof`
	RelationKindDuplicates  RelationKind = `duplicates`
	RelationKindBlocking    RelationKind = `blocking`
	RelationKindBlocked     RelationKind = `blocked`
	RelationKindPreceeds    RelationKind = `precedes`
	RelationKindFollows     RelationKind = `follows`
	RelationKindCopiedFrom  RelationKind = `copiedfrom`
	RelationKindCopiedTo    RelationKind = `copiedto`
)

type TaskRelation struct {
	ID           int64        `xorm:"bigint autoincr not null unique pk" json:"-"`
	TaskID       int64        `xorm:"bigint not null" json:"task_id" param:"task" readOnly:"true"`
	OtherTaskID  int64        `xorm:"bigint not null" json:"other_task_id" param:"otherTask"`
	RelationKind RelationKind `xorm:"varchar(50) not null" json:"relation_kind" param:"relationKind" enum:"subtask,parenttask,related,duplicateof,duplicates,blocking,blocked,precedes,follows,copiedfrom,copiedto"`
	CreatedByID  int64        `xorm:"bigint not null" json:"-"`
	CreatedBy    *user.User   `xorm:"-" json:"created_by" readOnly:"true"`
	Created      time.Time    `xorm:"created not null" json:"created" readOnly:"true"`
	web.CRUDable    `xorm:"-" json:"-"`
	web.Permissions `xorm:"-" json:"-"`
}
```

**Critical semantics (from the `doc` tag):** *"The kind of relation, describing the direction from the base task to the other task. **The inverse relation is created automatically.**"*

Inverse pairs (from `/help/task-relations/`):

| Kind | Inverse |
|---|---|
| `subtask` | `parenttask` |
| `parenttask` | `subtask` |
| `related` | `related` (symmetric) |
| `duplicateof` | `duplicates` |
| `duplicates` | `duplicateof` |
| `blocking` | `blocked` |
| `blocked` | `blocking` |
| `precedes` | `follows` |
| `follows` | `precedes` |
| `copiedfrom` | `copiedto` |
| `copiedto` | `copiedfrom` |

Note the source constant is **`RelationKindPreceeds`** (typo in the Go identifier) but the wire value is the correct `"precedes"`.

**Subtasks are just relations, not a `parent_task_id` column.** Consequences: (a) a task can have multiple parents; (b) subtask trees require recursive queries; (c) `?expand=subtasks` exists specifically to make the list endpoint return the tree. Open issue **#336 "Simplify adding subtasks"** (11 reactions) shows this is UX-costly.

`RelatedTaskMap` on `Task` is `map[RelationKind][]*Task` in the JSON — i.e. `related_tasks: { "subtask": [...], "blocking": [...] }`.

### 3.5 `Bucket` (`pkg/models/kanban.go`) — verbatim

```go
type Bucket struct {
	ID            int64      `xorm:"bigint autoincr not null unique pk" json:"id" param:"bucket"`
	Title         string     `xorm:"text not null" valid:"required" minLength:"1" json:"title"`
	ProjectID     int64      `xorm:"-" json:"-" param:"project"`
	ProjectViewID int64      `xorm:"bigint not null" json:"project_view_id" param:"view"`
	Tasks         []*Task    `xorm:"-" json:"tasks,omitempty"`
	Limit         int64      `xorm:"default 0" json:"limit" minimum:"0"`
	Count         int64      `xorm:"-" json:"count"`
	Position      float64    `xorm:"double null" json:"position"`
	Created       time.Time  `xorm:"created not null" json:"created"`
	Updated       time.Time  `xorm:"updated not null" json:"updated"`
	CreatedBy     *user.User `xorm:"-" json:"created_by" valid:"-"`
	CreatedByID   int64      `xorm:"bigint not null" json:"-"`
	TaskCollection            // embedded: gives buckets filter/sort/search params
	web.Permissions `xorm:"-" json:"-"`
	web.CRUDable    `xorm:"-" json:"-"`
}
```

Key: **a bucket belongs to a `project_view_id`, not to a project.** Buckets only exist inside kanban views. `Limit` is the WIP limit (0 = unlimited). The struct **embeds `TaskCollection`**, so the bucket-tasks endpoint accepts `filter`, `s`, `sort_by`, `order_by`, `expand` — the same query surface as the list endpoint.

### 3.6 `TaskPosition` (`pkg/models/task_position.go`) — verbatim + logic

```go
type TaskPosition struct {
	TaskID        int64   `xorm:"bigint not null index unique(task_view)" json:"task_id" param:"task" readOnly:"true"`
	ProjectViewID int64   `xorm:"bigint not null index unique(task_view) index(view_position)" json:"project_view_id"`
	Position      float64 `xorm:"double not null index(view_position)" json:"position"`
	web.CRUDable    `xorm:"-" json:"-"`
	web.Permissions `xorm:"-" json:"-"`
}
```

The `doc` tag is worth quoting in full because it *is* the spec:

> "The task's sort position within the view, as a float so a task can be placed between any two others. To drop a task between two neighbours, set this to their midpoint. Values below the minimum spacing trigger a server-side recalculation of all positions in the view, so **the stored value may differ from what you sent**."

Constants and formulas:

```go
const MinPositionSpacing = 0.01

// initial spread across a view
maxPosition := math.Pow(2, 32)                                  // 4294967296
currentPosition := maxPosition / float64(len(allTasks)) * float64(i+1)

// insertion between two neighbours
newPosition := (task1.position + task2.position) / 2
```

Conflict resolution: when the gap between neighbours drops below `MinPositionSpacing`, the server does a full or localized redistribution. **The client must therefore re-read positions after a move** (or accept that its optimistic value is provisional). Event `task.positions.recalculated` is emitted.

### 3.7 `ProjectView` (`pkg/models/project_view.go`) — verbatim

```go
type ProjectViewKind int
const (
	ProjectViewKindList ProjectViewKind = iota // 0
	ProjectViewKindGantt                        // 1
	ProjectViewKindTable                        // 2
	ProjectViewKindKanban                       // 3
)

type BucketConfigurationModeKind int
const (
	BucketConfigurationModeNone BucketConfigurationModeKind = iota // 0
	BucketConfigurationModeManual                                   // 1
	BucketConfigurationModeFilter                                   // 2
)

type ProjectViewBucketConfiguration struct {
	Title  string          `json:"title"`
	Filter *TaskCollection `json:"filter"`
}

type ProjectView struct {
	ID                      int64                             `xorm:"autoincr not null unique pk" json:"id" param:"view" readOnly:"true"`
	Title                   string                            `xorm:"varchar(255) not null" json:"title" valid:"required,runelength(1|250)"`
	ProjectID               int64                             `xorm:"not null index" json:"project_id" param:"project" readOnly:"true"`
	ViewKind                ProjectViewKind                   `xorm:"not null" json:"view_kind" swaggertype:"string" enums:"list,gantt,table,kanban"`
	Filter                  *TaskCollection                   `xorm:"json null default null" query:"filter" json:"filter"`
	Position                float64                           `xorm:"double null" json:"position"`
	BucketConfigurationMode BucketConfigurationModeKind       `xorm:"default 0" json:"bucket_configuration_mode" swaggertype:"string" enums:"none,manual,filter"`
	BucketConfiguration     []*ProjectViewBucketConfiguration `xorm:"json" json:"bucket_configuration"`
	DefaultBucketID         int64                             `xorm:"bigint INDEX null" json:"default_bucket_id"`
	DoneBucketID            int64                             `xorm:"bigint INDEX null" json:"done_bucket_id"`
	Updated                 time.Time                         `xorm:"updated not null" json:"updated" readOnly:"true"`
	Created                 time.Time                         `xorm:"created not null" json:"created" readOnly:"true"`
	web.CRUDable    `xorm:"-" json:"-"`
	web.Permissions `xorm:"-" json:"-"`
}
```

`doc` tags spell out the semantics:
- `default_bucket_id`: *"The id of the bucket new tasks without a bucket are added to. **Defaults to the leftmost bucket**."*
- `done_bucket_id`: *"**Tasks moved here are marked done, and tasks marked done are moved here.**"* — bidirectional coupling. This is the single most-copied kanban behaviour in the ecosystem.
- `bucket_configuration_mode`: *"`manual` lets you move tasks between buckets; `filter` creates a bucket per filter."*
- The enum is serialized as a **string** in JSON (`swaggertype:"string"`) while stored as an int. Wire values: `"list"|"gantt"|"table"|"kanban"` and `"none"|"manual"|"filter"`.

### 3.8 `TaskReminder` (`pkg/models/task_reminder.go`) — verbatim

```go
type ReminderRelation string
const (
	ReminderRelationDueDate   ReminderRelation = `due_date`
	ReminderRelationStartDate ReminderRelation = `start_date`
	ReminderRelationEndDate   ReminderRelation = `end_date`
)

type TaskReminder struct {
	ID             int64            `xorm:"bigint autoincr not null unique pk" json:"-"`
	TaskID         int64            `xorm:"bigint not null INDEX" json:"-"`
	Reminder       time.Time        `xorm:"DATETIME not null INDEX 'reminder'" json:"reminder"`
	Created        time.Time        `xorm:"created not null" json:"-"`
	RelativePeriod int64            `xorm:"bigint null" json:"relative_period"`
	RelativeTo     ReminderRelation `xorm:"varchar(50) null" json:"relative_to"`
}
```

Semantics (from the doc comment): *"If `RelativeTo` and the associated date field are defined, then the attribute `Reminder` will be computed. If `RelativeTo` is missing, then `Reminder` must be given."* `RelativePeriod` is **seconds, negative = before** the anchor date. Default 0 = fires exactly at the anchor.

This is the correct design: store both the rule *and* the materialized absolute timestamp, so the reminder cron only ever scans one indexed `datetime` column.

### 3.9 `Subscription` (`pkg/models/subscription.go`) — verbatim

```go
type Subscription struct {
	ID         int64                  `xorm:"autoincr not null unique pk" json:"id" readOnly:"true"`
	EntityType SubscriptionEntityType `xorm:"index not null" json:"entity" readOnly:"true"`
	Entity     string                 `xorm:"-" json:"-" param:"entity"`
	EntityID   int64                  `xorm:"bigint index not null" json:"entity_id" param:"entityID" readOnly:"true"`
	UserID     int64                  `xorm:"bigint index not null" json:"-"`
	Created    time.Time              `xorm:"created not null" json:"-"`
	web.CRUDable
	web.Permissions
}

const (
	SubscriptionEntityProject = 1
	SubscriptionEntityTask    = 2
)
```

(Namespace = 3 historically, retained for backward compat but unused.)

Routes: `PUT /api/v1/subscriptions/{entity}/{entityID}`, `DELETE /api/v1/subscriptions/{entity}/{entityID}` where `entity` ∈ `"project"|"task"`.

### 3.10 `LinkSharing` (`pkg/models/link_sharing.go`) — verbatim

```go
type SharingType int
const (
	SharingTypeUnknown SharingType = iota          // 0
	SharingTypeWithoutPassword                      // 1
	SharingTypeWithPassword                         // 2
)

type LinkSharing struct {
	ID          int64       `xorm:"bigint autoincr not null unique pk" json:"id" param:"share" readOnly:"true"`
	Hash        string      `xorm:"varchar(40) not null unique" json:"hash" param:"hash" readOnly:"true"`
	Name        string      `xorm:"text null" json:"name"`
	ProjectID   int64       `xorm:"bigint not null" json:"-" param:"project"`
	Permission  Permission  `xorm:"bigint INDEX not null default 0" json:"permission" valid:"length(0|2)" maximum:"2" default:"0"`
	SharingType SharingType `xorm:"bigint INDEX not null default 0" json:"sharing_type" valid:"length(0|2)" maximum:"2" default:"0" readOnly:"true"`
	Password    string      `xorm:"text null" json:"password" writeOnly:"true"`
	SharedBy    *user.User  `xorm:"-" json:"shared_by" readOnly:"true"`
	SharedByID  int64       `xorm:"bigint INDEX not null" json:"-"`
	Created     time.Time   `xorm:"created not null" json:"created" readOnly:"true"`
	Updated     time.Time   `xorm:"updated not null" json:"updated" readOnly:"true"`
	web.CRUDable    `xorm:"-" json:"-"`
	web.Permissions `xorm:"-" json:"-"`
}
```

Doc tags:
- `permission`: *"0 = read only, 1 = read & write, 2 = admin."*
- `sharing_type`: *"derived from whether a password was set: 0 = undefined, 1 = without password, 2 = with password."* — **read-only, server-derived.** Nice pattern: the client sets `password` or not; the server computes the type.
- `name`: *"**All actions someone takes while authenticated through this link will appear under this name.**"* — this is Vikunja's answer to "who did this?" for anonymous guests.
- `password`: `writeOnly:"true"` — settable, never returned.

**Notably absent: an expiry field.** Vikunja link shares do **not** expire. Fem-ho's spec explicitly wants expiry — that's a genuine differentiator.

### 3.11 `Permission` levels (`pkg/models/permissions.go`)

| Value | Name | Meaning |
|---|---|---|
| 0 | Read Only | view everything, change nothing |
| 1 | Read & Write | create/update/delete tasks, labels, content |
| 2 | Admin | everything above + manage sharing (add/remove users & teams, change their levels) |

Applied identically to: project↔user shares, project↔team shares, link shares. Teams additionally have a **boolean `admin` flag per member** (team admins can add/remove members and grant/revoke team-admin).

**Documented gap:** `/help/permissions/` does **not** describe permission inheritance from parent projects. **UNVERIFIED** whether subprojects inherit shares in current code; treat as "probably explicit per project".

### 3.12 Other model files present (from the `pkg/models` directory listing)

`admin_actions.go`, `admin_bypass.go`, `admin_overview.go`, `admin_project_list.go`, `admin_user_actions.go`, `admin_user_create.go`, `api_routes.go`, `api_tokens.go`, `api_tokens_expiry_cron.go`, `api_tokens_expiry_notification.go`, `api_tokens_permissions.go`, `bot_users.go`, `bot_users_permissions.go`, `bulk_task.go`, `bulk_task_create.go`, `comment_quotes.go`, `error.go`, `events.go`, `export.go`, `favorites.go`, `kanban.go`, `kanban_permissions.go`, `kanban_task_bucket.go`, `label.go`, `label_permissions.go`, `label_task.go`, `label_task_permissions.go`, `link_sharing.go`, `link_sharing_permissions.go`, `listeners.go`, `mentions.go`, `message.go`, `models.go`, `notifications.go`, `notifications_database.go`, `notifications_permissions.go`, `notifications_refresh.go`, `oauth_codes.go`, `permissions.go`, `project.go`, `project_duplicate.go`, `project_permissions.go`, `project_repair.go`, `project_team.go`, `project_team_permissions.go`, `project_users.go`, `project_users_permissions.go`, `project_view.go`, `project_view_permissions.go`, `reaction.go`, `reaction_permissions.go`, `saved_filters.go`, `saved_filters_permissions.go`, `sessions.go`, `sessions_permissions.go`, `subscription.go`, `subscription_permissions.go`, `task_assignees.go`, `task_assignees_permissions.go`, `task_attachment.go`, `task_attachment_permissions.go`, `task_collection.go`, `task_collection_filter.go`, `task_collection_sort.go`, `task_comment_permissions.go`, `task_comments.go`, `task_delete_cron.go`, `task_duplicate.go`, `task_overdue_reminder.go`, …

**Architectural pattern to note:** every entity has a paired `*_permissions.go` file implementing `CanRead/CanWrite/CanUpdate/CanDelete/CanCreate`. Permissions are *not* centralized in middleware — they are a per-model interface (`web.Permissions`) called generically by the CRUD handler. This is the single most important structural decision in the codebase: **the generic handler in `pkg/web` calls `CanX()` on the model before calling `Create/ReadOne/ReadAll/Update/Delete`.** One handler, N models.

### 3.13 → What Fem-ho should do

- **Adopt the `ProjectView` table wholesale.** Fem-ho's spec has a fixed 4-column kanban (Inbox / Per fer / Fent / Fet) — implement it as a *seeded* kanban view per scope/project with 4 buckets, `default_bucket_id = Inbox`, `done_bucket_id = Fet`. This gets you the "moving to Fet marks done" behaviour for free and leaves the door open for user-added columns later without a migration.
- **Adopt `task_positions(task_id, project_view_id, position float)` exactly**, including `MinPositionSpacing` and midpoint insertion. For the **offline-first Android app** this matters enormously: a float position is trivially mergeable (last-writer-wins on a single float, with server recalculation as the tiebreaker), whereas an integer `order` column requires a full-list rewrite on every reorder and is a nightmare to sync.
- **Keep `percent_done`** but *do* auto-set it to 1.0 on done (fix Vikunja's #1285).
- **Copy the `(project_id, index)` composite unique + `identifier`** — human-readable task keys (`FAM-17`) are gold for a family app: "can you do FAM-17" is speakable.
- **Do differently on subtasks.** Vikunja models subtasks as symmetric relations. Fem-ho needs *checklists* ("llistes de tasques simples" attached to tasks/subtasks, pinnable) — that is a **different entity**, not a relation. Model it as `checklists(id, owner_task_id nullable, owner_subtask_id nullable, title, is_pinned)` + `checklist_items(id, checklist_id, title, done, position float)`. Keep task↔task relations for `blocking`/`related`/`duplicateof`, and keep a **real `parent_task_id` column** for the subtask tree (one parent, indexed, recursive CTE-friendly) rather than Vikunja's relation-based tree. Simpler queries, trivial offline sync, no multi-parent ambiguity.
- **Copy `TaskReminder`'s dual absolute+relative design verbatim.** It is the right answer and it maps 1:1 to iCal `VALARM` `TRIGGER;RELATED=START|END`.
- **Copy `sharing_type` being server-derived from the password.** Then add what Vikunja lacks: `expires_at TIMESTAMP NULL` and `require_guest_name BOOL` + `guest_name` captured per session. Vikunja's `LinkSharing.Name` is set by the *sharer*; Fem-ho wants it typed by the *guest* — store it in the share-session JWT claims so the audit trail attributes changes correctly.
- **Copy the per-model permissions interface.** With scopes (àmbits) that can be individual or collective, a centralized ACL middleware will not scale; a `CanRead(ctx, user)` method per entity will.
- **Add soft delete (`deleted_at`) + a purge cron** from day one. Families delete things by accident.
- **Do differently on `repeat_after`.** See §12.

---

## 4. Project views — the views system

### 4.1 Storage

One row per view in `project_views`, ordered by `position float`. Every project gets a default set on creation (List, Gantt, Table, Kanban — **UNVERIFIED** whether all four are always seeded, but the Favorites pseudo-project seeds List/Gantt/Table, and the UI ships all four).

### 4.2 View-specific filters

`ProjectView.Filter *TaskCollection` is stored as **JSON in a single column** (`xorm:"json null default null"`). Because `TaskCollection` is the same struct used for query params, a view's saved filter carries `s`, `sort_by`, `order_by`, `filter`, `filter_include_nulls` — the entire query in one blob.

### 4.3 Bucket configuration mode

| Mode | Value | Behaviour |
|---|---|---|
| `none` | 0 | not a kanban view |
| `manual` | 1 | **default.** Buckets are rows in the `buckets` table; users drag tasks between them; `task_buckets` records membership |
| `filter` | 2 | Buckets are **generated from `bucket_configuration`** (a JSON array of `{title, filter}`); **drag-and-drop between buckets is disabled** |

`bucket_configuration` example shape:

```json
[
  {"title": "Overdue",  "filter": {"filter": "due_date < now && done = false"}},
  {"title": "Today",    "filter": {"filter": "due_date >= now/d && due_date < now/d+1d"}},
  {"title": "Later",    "filter": {"filter": "due_date >= now/d+1d"}}
]
```

### 4.4 Bucket UX features (from `/help/views/`)

- **Default bucket** — receives new tasks with no explicit bucket.
- **Done bucket** — moving a task there marks it done; marking a task done moves it there.
- **WIP limits** — `Bucket.Limit`; when reached "the header turns red and additions are blocked".
- **Collapsing buckets** — "hide bucket contents to save screen space; **state persists in browser**" (localStorage, *not* server-side). This is the "expand/collapse done bucket" behaviour: the Done column is typically collapsed to a vertical strip.
- **Drag & drop** — reorder within a view, move between buckets, and **drag a task onto a project in the sidebar to move it between projects**.
- View management: three-dot menu next to the project title → *Views* → create/edit/delete/reorder (drag handles).

### 4.5 API

```
GET    /api/v1/projects/:project/views
PUT    /api/v1/projects/:project/views              (create)
GET    /api/v1/projects/:project/views/:view
POST   /api/v1/projects/:project/views/:view        (update)
DELETE /api/v1/projects/:project/views/:view

GET    /api/v1/projects/:project/views/:view/tasks  (the canonical task list endpoint)
GET    /api/v1/projects/:project/views/:view/buckets
PUT    /api/v1/projects/:project/views/:view/buckets
POST   /api/v1/projects/:project/views/:view/buckets/:bucket
DELETE /api/v1/projects/:project/views/:view/buckets/:bucket
```

Note `GET /api/v1/projects/:project/tasks` also exists as a view-less shortcut.

### 4.6 → What Fem-ho should do

- **Seed exactly two views per scope/project:** a `kanban` view with the 4 fixed buckets, and a `calendar` view. Vikunja has no calendar view (open issue **#1364 "Week and month calendar view"**, 9 reactions — a top-15 request) — Fem-ho shipping month/week/day is a real advantage. Add `ProjectViewKindCalendar` to the enum from day one.
- **Persist bucket-collapsed state server-side per user**, not in localStorage. Fem-ho is multi-device (web + Android); localStorage-only state means the Done column re-expands on the phone.
- **Use `bucket_configuration_mode = filter`** for the dynamic Inbox side-column in the calendar view: it is literally a filter-defined bucket (`done = false && due_date is null`) rendered next to the calendar. Same machinery, no new concept.
- **Copy "drag a task onto a scope chip / project in the sidebar to move it."** With multi-select scope chips in the top bar, dragging a card onto a chip is a natural re-scope gesture.
- **Do differently:** Vikunja lets users create arbitrary views per project, which is powerful but confusing. Fem-ho's spec fixes the UI to Tasks/Calendar — so keep views as an *internal* mechanism (seeded, not user-managed) in v1, and expose view management later only if needed. The schema cost of having them is zero; the UX cost of exposing them is high.

---

## 5. Filters — query language, date math, saved filters

### 5.1 Query parameters (task list endpoints)

| Param | Meaning |
|---|---|
| `filter` | the filter query string, e.g. `done = false && priority >= 3` |
| `filter_include_nulls` | include tasks whose filtered field is null (default `false`) |
| `filter_timezone` | timezone used to resolve `now`; falls back to server tz |
| `s` | simple text search over title + description (**renamed to `q` in v2**) |
| `sort_by` | repeatable: `id, title, done, done_at, due_date, start_date, end_date, priority, percent_done, created, updated, position`, plus special `relevance` (requires `s`) |
| `order_by` | `asc`/`desc`, positionally paired with `sort_by` |
| `per_page`, `page` | pagination |
| `expand` | `subtasks, buckets, reactions, comments, comment_count, time_entries_count, is_unread` |

### 5.2 Operators (`pkg/models/task_collection_filter.go`) — verbatim

```go
const (
	taskFilterComparatorEquals       taskFilterComparator = "="
	taskFilterComparatorGreater      taskFilterComparator = ">"
	taskFilterComparatorGreateEquals taskFilterComparator = ">="
	taskFilterComparatorLess         taskFilterComparator = "<"
	taskFilterComparatorLessEquals   taskFilterComparator = "<="
	taskFilterComparatorNotEquals    taskFilterComparator = "!="
	taskFilterComparatorLike         taskFilterComparator = "like"
	taskFilterComparatorIn           taskFilterComparator = "in"
	taskFilterComparatorNotIn        taskFilterComparator = "not in"
)
```

Logical: `&&` (AND), `||` (OR). Parentheses are supported for grouping.

### 5.3 Fields

Filter fields are **validated by reflection over the `Task` struct**, so any Task JSON field is filterable. Special handling:
- `project` → remapped to `project_id`
- `assignees` → split by comma
- `reminders` → joined to `TaskReminder.Reminder`
- Web UI accepts camelCase (`dueDate`), API requires **snake_case** (`due_date`). Mapping: `dueDate→due_date`, `startDate→start_date`, `endDate→end_date`, `doneAt→done_at`, `percentDone→percent_done`; `done`, `priority`, `assignees`, `labels`, `project`, `reminders`, `created`, `updated` unchanged.
- **Through the API you must use numeric IDs** for labels/projects: `labels in 1, 5`, `project = 12`. Look them up via `GET /api/v1/labels` / `GET /api/v1/projects`. (The web UI shows names and translates them.)

### 5.4 Date math

Implemented with **`github.com/jszwedko/go-datemath`** (Elasticsearch-style). Parsers tried in order:
1. `time.RFC3339`
2. Safari-compat formats `"2006-01-02 15:04"` and `"2006-01-02"`
3. **datemath expressions** (timezone-aware via `filter_timezone`)
4. manual parsing for loose formats like `2022-11-1`

Syntax: anchor + operations. Anchor is `now` or a fixed date followed by `||`.

| Unit | Meaning |
|---|---|
| `s` | seconds |
| `m` | minutes |
| `h` | hours |
| `d` | days |
| `w` | weeks |
| `M` | months |
| `y` | years |

`/` = round down to the unit.

| Expression | Meaning |
|---|---|
| `now+7d` | 7 days from now |
| `now/d` | start of today |
| `now/w` | start of this week |
| `now-1M/M` | start of last month |
| `now/w+1w` | start of next week |
| `2024-03-11\|\|+1w` | 2024-03-18 |

MySQL quirk in the code: dates with year < 1 get year set to 1 and an extra day added for Jan 1 entries.

### 5.5 Canonical example (verbatim from docs)

```
GET /api/v1/projects/1/views/5/tasks?filter=due_date%20%3C%20now%20%26%26%20done%20%3D%20false&sort_by=priority&order_by=desc
```
(decoded: `filter=due_date < now && done = false`)

Common recipes:
```
done = false && due_date < now                      # overdue
done = false && due_date < now/w+1w                 # due before end of next week
done = false && (assignees in 3 || assignees in 7)  # mine or partner's
labels in 4 && done = false                         # by label
percent_done >= 0.5 && done = false                 # half-finished
due_date > now/d && due_date < now/d+1d             # today
```

### 5.6 Saved filters — pseudo-projects with negative IDs

```go
type SavedFilter struct {
	ID          int64           `xorm:"autoincr not null unique pk" json:"id" param:"filter" readOnly:"true"`
	Filters     *TaskCollection `xorm:"JSON not null" json:"filters" valid:"required"`
	Title       string          `xorm:"varchar(250) not null" json:"title" valid:"required,runelength(1|250)"`
	Description string          `xorm:"longtext null" json:"description"`
	OwnerID     int64           `xorm:"bigint not null INDEX" json:"-"`
	Owner       *user.User      `xorm:"-" json:"owner" valid:"-" readOnly:"true"`
	IsFavorite  bool            `xorm:"default false" json:"is_favorite"`
	Created     time.Time       `xorm:"created not null" json:"created" readOnly:"true"`
	Updated     time.Time       `xorm:"updated not null" json:"updated" readOnly:"true"`
	web.CRUDable    `xorm:"-" json:"-"`
	web.Permissions `xorm:"-" json:"-"`
}

func GetSavedFilterIDFromProjectID(projectID int64) (filterID int64) {
	filterID = projectID*-1 - 1
	if filterID < 0 { filterID = 0 }
	return
}

func getProjectIDFromSavedFilterID(filterID int64) (projectID int64) {
	projectID = filterID*-1 - 1
	if projectID > 0 { projectID = 0 }
	return
}
```

**The arithmetic, worked out:** filter `1` → project `-2`; filter `2` → project `-3`; project `-2` → filter `1`. `-1` is reserved for `FavoritesPseudoProjectID`. So the mapping is `project_id = -(filter_id + 1)` and `filter_id = -(project_id + 1)`. Note the function is *self-inverse* (`x*-1-1` applied twice returns `x`), which is elegant but means the clamping guards are doing real work.

Effect: a saved filter is addressable at every project endpoint. `GET /api/v1/projects/-2/views/<view>/tasks` works. The frontend treats saved filters as sidebar entries indistinguishable from projects.

REST surface:
```
GET    /api/v1/filters
PUT    /api/v1/filters
GET    /api/v1/filters/{id}
POST   /api/v1/filters/{id}
DELETE /api/v1/filters/{id}
```

### 5.7 → What Fem-ho should do

- **Copy the filter DSL essentially verbatim**, including `&&`/`||`/parens and the `in`/`not in`/`like` operators. It is compact, greppable, URL-safe-ish, and — crucially — **it is a great MCP tool argument**. An AI calling `femho_list_tasks(filter="done = false && due_date < now/w+1w && scope = 3")` is far better than 12 optional typed params.
- **Copy go-datemath.** Don't invent date math. If Fem-ho's backend is Go, use the same library; if not, port the grammar exactly (`now`, `±Nunit`, `/unit`, `date||expr`).
- **Copy `filter_timezone`.** A family in Catalonia with a member abroad will hit this immediately; "today" must be resolved in the *user's* tz, not the server's.
- **Copy saved-filters-as-pseudo-projects** but **use a separate URL namespace instead of negative IDs**. Negative IDs are a clever hack that costs you every time you validate an ID, and it burns `-1` on Favorites. Prefer `/api/v1/views/saved/{id}/tasks` or a `project_ref` that is either `p:12` or `f:3`. If you *do* use negative IDs, document the off-by-one loudly.
- **Copy `expand`.** For the Android offline-first client, `?expand=subtasks,comment_count,is_unread` on the initial sync and nothing on delta syncs is the difference between a usable and an unusable app.
- **Add what Vikunja lacks:** a `scope`/`àmbit` filter field, so `#Personal` chips map onto `scope in 1,2`. Vikunja's `project = 12` is the closest analogue but scopes are a level above projects in Fem-ho.
- **Expose the filter grammar in the OpenAPI description text and the MCP tool description**, verbatim, with 6–8 worked examples. Models get this right when shown examples and wrong when shown a grammar.

---

## 6. Quick Add Magic

### 6.1 Modes (`frontend/src/modules/quickAddMagic/prefixes.ts`)

Three modes exported as an enum: **`Disabled`**, **`Default`** (Vikunja), **`Todoist`**. `PREFIXES` maps each mode to a prefix config; `Disabled` maps to `undefined`.

| Concept | Vikunja (`Default`) | Todoist |
|---|---|---|
| Label | `*` | `@` |
| Project | `+` | `#` |
| Priority | `!` | `!` |
| Assignee | `@` | `+` |

Note that Vikunja's Todoist mode keeps `!` for priority rather than Todoist's native `p1..p4`. **UNVERIFIED** whether `p1` is also accepted in Todoist mode.

Multi-word values use quotes: `*"multi word label"`, `+"Multi Word Project"`.

### 6.2 Semantics (from `/help/quick-add-magic/`)

- `*label` — **if the label doesn't exist, Vikunja creates it.**
- `@username` — assign; multiple allowed. Must be an existing user with access.
- `+ProjectName` — **the project must already exist** (asymmetric with labels).
- `!1`…`!5` — priority, 1 = low … 5 = urgent.
- **Dates anywhere in the title** are parsed and stripped, setting the **due date**.
- **Repeats:** `every day`, `every 3 days`, `every week`, `every 2 weeks`, `every month`.
- **Multiple tasks at once:** line breaks; `Shift + Enter` inserts a newline in the quick-add box.
- **Subtasks:** indent lines with spaces/tabs → creates subtask relations to the line above.
- **Escape hatch:** wrap the whole title in quotes to disable all parsing — `"Buy milk tomorrow"` creates a task literally titled `Buy milk tomorrow`.

### 6.3 Date parser (`frontend/src/modules/quickAddMagic/dateParser.ts`)

**No external NLP library.** Native `Date` + hand-written regexes. **English only** — month names and weekday keywords are hardcoded in English. This is a significant limitation and directly relevant to Fem-ho (Catalan UI).

Recognized:
- Relative keywords: `today`, `tonight`, `tomorrow`, `next monday`, `this weekend`, `later this week`, `later next week`, `next week`, `next month`, `end of month`
- Weekday regex: `(monday|mon|tuesday|tue|wednesday|wed|thursday|thu|friday|fri|saturday|sat|sunday|sun)`
- Ordinal day regex: `(([1-2][0-9])|(3[01])|(0?[1-9]))(st|nd|rd|th|\.)`
- Numeric formats: `MM/DD`, `MM/DD/YYYY`, `YYYY/MM/DD`, `YYYY-MM-DD`, `DD.MM`, `DD.MM.YYYY`
- Month-name formats: `jan 21`, `21 jan`
- Intervals: `in [number] (hours?|days?|weeks?|months?)`
- Time suffix: `at HH:MM` / `@ HH:MM` with optional `am|pm`

Return shape:

```ts
interface dateParseResult {
  newText: string    // input with the matched date removed
  date: Date | null
}
```

Module layout worth copying: `dateParser.ts`, `prefixParser.ts`, `prefixes.ts`, `priorityParser.ts`, `repeatParser.ts`, `textCleanup.ts`, `types.ts`, `index.ts`, `quickAddMagic.ts`, `quickAddMagic.test.ts` — **one parser per concern, each returning `{newText, value}`, chained**. That's a clean, testable pipeline.

### 6.4 → What Fem-ho should do

- **Fem-ho's spec is already right**: `@person` = assign, `#Scope` and `#Scope/Project` = route. Note this **collides with Todoist mode** (`#` = project) and *not* with Vikunja mode. Since Fem-ho ships one Catalan-first syntax, pick and document it; don't offer three modes in v1. If you later add a "Todoist compatibility" toggle, copy the `PREFIXES[mode]` table structure — it's 20 lines.
- **`#Scope/Project` is better than Vikunja's flat `+Project`.** Keep the slash. Also auto-create the project on demand (Vikunja creates labels but not projects — an inconsistency users trip on).
- **Copy the quoting escape hatch** (`"literal title"`) and multi-word quoting (`#"Feina/Projecte llarg"`).
- **Copy indentation-creates-subtasks and Shift+Enter multi-task.** Both are cheap and beloved.
- **Write the date parser in Catalan first, then Spanish, then English.** Vikunja's parser is English-only and hardcoded; this is the clearest place Fem-ho can beat it. Minimum Catalan vocabulary:
  - `avui`, `aquesta nit`, `demà`, `demà passat`, `dilluns/dimarts/dimecres/dijous/divendres/dissabte/diumenge` (+ `dl/dt/dc/dj/dv/ds/dg`), `dilluns que ve`, `la setmana que ve`, `el mes que ve`, `aquest cap de setmana`, `a finals de mes`, `d'aquí a 5 dies`, `en 2 hores`
  - times: `a les 17:00`, `a les 5 de la tarda`, `al migdia`, `al vespre`
  - repeats: `cada dia`, `cada 3 dies`, `cada setmana`, `cada 2 setmanes`, `cada mes`, `cada any`, `cada dilluns`
  - dates: `17/02/2026`, `17 de febrer`, `17 feb`
- **Copy the module structure** (`dateParser`, `prefixParser`, `priorityParser`, `repeatParser`, `textCleanup`) — and **share it between web and Android**. Either implement the parser server-side and expose `POST /api/v1/parse` (so web, Android, MCP and the AI all agree), or write it once in a language both can use. Recommendation: **do it server-side AND client-side** — server-side is the source of truth and lets the MCP tool accept raw natural-language strings; client-side gives the live-preview highlighting that makes quick-add feel magical. Ship the same test fixtures to both.
- **Expose parsing as an MCP tool**: `femho_quick_add(text: "Comprar pa demà a les 9 #Família @borja !3")`. This is the single highest-leverage AI affordance in the whole product.

---

## 7. REST API

### 7.1 v1 — shape and conventions

Base: `/api/v1`.

**Verb convention (v1, non-standard):**
- `GET` collection → read all
- `GET /:id` → read one
- **`PUT` → create**
- **`POST /:id` → update**
- `DELETE /:id` → delete

This inversion is Vikunja's most-complained-about API wart and is fixed in v2.

**Pagination (v1):** bare JSON arrays; pagination in **response headers**:
- `x-pagination-total-pages`
- `x-pagination-result-count`

Request params: `page`, `per_page`.

**Caller permission (v1):** `x-max-permission` response header.

**OpenAPI/Swagger:**
- Interactive UI: `GET /api/v1/docs`
- Spec JSON: `GET /api/v1/docs.json`
- v2: `GET /api/v2/docs` (OpenAPI **3.1**)
- Public demo instance: `https://try.vikunja.io/api/v1/docs`
- Specs are autogenerated from `swaggo` annotations in the Go source (`@Router`, `@Summary`, `@Param`, `@Success`).

### 7.2 v2 — what changed (2.4.0+)

| Aspect | v1 | v2 |
|---|---|---|
| Create | `PUT` | `POST` → **201** |
| Update | `POST` | `PUT` (full) / **`PATCH`** (JSON Merge Patch) |
| List response | bare array | envelope `{items, total, page, per_page, total_pages}` |
| Search param | `s` | **`q`** |
| Errors | ad-hoc JSON, `412` for validation | **RFC 9457 `application/problem+json`** with `title`, `status`, `detail`, `code`; validation → **422** |
| Caller permission | `x-max-permission` header | `max_permission` body field |
| Conditional requests | — | **ETags**, `If-None-Match`, `If-Match` |
| Markdown | — | `?format=markdown` |

**JSON models are unchanged** between v1 and v2: *"same field names, same `snake_case`, same structure."* Auth is identical (`Bearer` with `tk_` API tokens or JWTs); scopes apply equally.

**Deprecation timeline (stated in docs):** v1 frozen at 2.4.0 → deprecated at 3.0 (est. Q3/Q4 2026) → removed at 4.0 (est. mid-2027).

### 7.3 Auth

**JWT login (self-hosted only; not available on Vikunja Cloud):**
```
POST /api/v1/login
POST /api/v1/user/token/refresh
POST /api/v1/user/logout
```
TTLs: `service.jwtttl` 259200s (3d), `service.jwtttllong` 2592000s (30d, remember-me), `service.jwtttlshort` 600s (10min, OAuth access tokens).

**API tokens (recommended)** — `Authorization: Bearer tk_<40 hex chars>`.

### 7.4 API tokens (`pkg/models/api_tokens.go`)

```
APITokenPrefix = "tk_"
token = "tk_" + hex(20 random bytes)     // 3 + 40 chars
```

Struct fields: `ID`, `Title` (required), `Token` (cleartext — **returned only once on creation**), `TokenSalt`, `TokenHash`, `TokenLastEight`, `APIPermissions`, `ExpiresAt`, `Created`, `OwnerID`.

**Hashing:** `pbkdf2.Key(..., 10000 iterations, 50-byte output, sha256)` with a per-token salt. `TokenLastEight` is stored plaintext so lookups can be indexed without decrypting.

**Permissions shape:** `map[string][]string`, e.g.

```json
{
  "tasks": ["read_all", "read_one", "create", "update"],
  "projects": ["read_all", "read_one"],
  "labels": ["read_all"],
  "caldav": ["access"],
  "feeds": ["access"]
}
```

Special non-CRUD checks in code: `HasCaldavAccess()` looks for `caldav` → `access`; `HasFeedsAccess()` looks for `feeds` → `access`.

There is an **expiry cron** (`api_tokens_expiry_cron.go`) plus an **expiry notification** (`api_tokens_expiry_notification.go`) — tokens expire and users are warned first.

### 7.5 Scope discovery (`pkg/models/api_routes.go`)

```go
var apiTokenRoutes   = map[string]APITokenRoute{}   // v1
var apiTokenRoutesV2 = map[string]APITokenRoute{}   // v2

type APITokenRoute map[string]*RouteDetail
type RouteDetail struct {
	Path   string `json:"path"`
	Method string `json:"method"`
}
```

`CollectRoutesForAPITokenUsage()` runs at startup, walking Echo's registered routes and deriving:

**Permission action names** (from HTTP method + whether the path ends in a param):
| Action | v1 | v2 |
|---|---|---|
| `read_all` | GET on collection | GET on collection |
| `read_one` | GET `/:id` | GET `/:id` |
| `create` | **PUT** | **POST** |
| `update` | **POST** | **PUT/PATCH** |
| `delete` | DELETE | DELETE |

**Group names** derived from the path after stripping `/api/v1/`/`/api/v2/`, snake_cased and joined: `/api/v2/projects/tasks` → `projects_tasks` (normalized to `tasks`); `/api/v2/tasks/comments` → `tasks_comments`.

**Discovery endpoint:**
```
GET /api/v1/routes   →  map[string]APITokenRoute
```
Example response shape:
```json
{
  "tasks": {
    "read_all":  { "path": "/api/v1/tasks",       "method": "GET" },
    "read_one":  { "path": "/api/v1/tasks/:task", "method": "GET" },
    "create":    { "path": "/api/v1/tasks",       "method": "PUT" },
    "update":    { "path": "/api/v1/tasks/:task", "method": "POST" },
    "delete":    { "path": "/api/v1/tasks/:task", "method": "DELETE" }
  },
  "projects": { }
}
```

`GetAPITokenRoutes()` merges both maps and filters by license status (Pro routes hidden without a license). `CanDoAPIRoute()` authorizes by matching exact `(path, method)` pairs; in v2 `PATCH` is accepted as an alias for `PUT`.

Token test endpoint: `GET|POST /api/v1/token/test`.

### 7.6 Full v1 route inventory (from `pkg/routes/routes.go`)

**Unauthenticated:**
```
POST /api/v1/register
POST /api/v1/login
POST /api/v1/user/password/token
POST /api/v1/user/password/reset
POST /api/v1/user/confirm
POST /api/v1/user/token/refresh
POST /api/v1/auth/openid/:provider/callback
GET  /api/v1/info
POST /api/v1/shares/:share/auth
GET  /api/v1/docs        GET /api/v1/docs.json
GET  /api/v1/metrics
POST /api/v1/oauth/token
```

**User:**
```
GET  /api/v1/user
POST /api/v1/user/password
GET  /api/v1/users                        (user search, for assignee pickers)
POST /api/v1/user/token
POST /api/v1/user/logout
POST /api/v1/user/settings/email
GET|POST /api/v1/user/settings/avatar
PUT  /api/v1/user/settings/avatar/upload
POST /api/v1/user/settings/general
GET  /api/v1/user/timezones
PUT|GET|DELETE /api/v1/user/settings/token/caldav*
GET|DELETE     /api/v1/user/sessions*
GET|PUT|POST|DELETE /api/v1/user/settings/webhooks*
GET|POST|DELETE     /api/v1/user/settings/totp*
POST /api/v1/user/deletion/*
PUT|GET|POST|DELETE /api/v1/user/bots*
POST /api/v1/user/export/*     GET /api/v1/user/export
```

**Projects:**
```
GET    /api/v1/projects
PUT    /api/v1/projects
GET|POST|DELETE /api/v1/projects/:project
GET    /api/v1/projects/:project/projectusers
PUT|GET|DELETE  /api/v1/projects/:project/shares*
GET    /api/v1/projects/:project/views
GET|PUT|POST|DELETE /api/v1/projects/:project/views/:view*
GET|PUT|DELETE|POST /api/v1/projects/:project/teams*
GET|PUT|DELETE|POST /api/v1/projects/:project/users*
GET|DELETE          /api/v1/projects/:project/background*
PUT|GET|POST        /api/v1/projects/:project/backgrounds/*
GET|PUT|DELETE|POST /api/v1/projects/:project/webhooks*
```

**Views/buckets/tasks:**
```
GET  /api/v1/projects/:project/views/:view/tasks
GET  /api/v1/projects/:project/tasks
GET|PUT|POST|DELETE /api/v1/projects/:project/views/:view/buckets*
PUT|GET|DELETE|POST /api/v1/tasks*
GET  /api/v1/projects/:project/tasks/by-index/:index
POST /api/v1/tasks/:projecttask/read           (mark read)
POST /api/v1/tasks/:task/position
POST /api/v1/tasks/bulk
PUT|DELETE|GET /api/v1/tasks/:projecttask/assignees*
POST /api/v1/tasks/:projecttask/assignees/bulk
PUT|DELETE|GET /api/v1/tasks/:projecttask/labels*
POST /api/v1/tasks/:projecttask/labels/bulk
PUT|DELETE     /api/v1/tasks/:task/relations*
GET|PUT|DELETE /api/v1/tasks/:task/attachments*
GET|PUT|POST|DELETE /api/v1/tasks/:task/comments*
```

**Labels / teams / misc:**
```
GET  /api/v1/labels
GET|PUT|POST|DELETE /api/v1/labels/:label
GET  /api/v1/teams
GET|PUT|POST|DELETE /api/v1/teams/:team
PUT|POST|DELETE     /api/v1/teams/:team/members*
PUT|DELETE /api/v1/subscriptions/:entity/:entityID
GET|POST   /api/v1/notifications*
GET|PUT|POST|DELETE /api/v1/filters/:filter
GET  /api/v1/webhooks/events
GET|PUT|DELETE /api/v1/tokens*
GET|POST /api/v1/token/test
GET  /api/v1/routes
GET  /api/v1/avatar/:username
POST /api/v1/oauth/authorize
GET|POST|PUT /:entitykind/:entityid/reactions*
POST /api/v1/migration/*
```

**Admin (Pro, feature+permission gated):**
```
GET /api/v1/admin/overview
GET|POST|PATCH|DELETE /api/v1/admin/users*
GET|PATCH /api/v1/admin/projects*
```

**CalDAV:**
```
ANY /dav, /dav/
ANY /dav/principals/*
ANY /dav/projects*
ANY /dav/projects/:project*
ANY /dav/projects/:project/:task
```

### 7.7 `GET /api/v1/info`

Unauthenticated capability/feature-flag endpoint. Used by the frontend to decide what to render (registration enabled? caldav enabled? link sharing enabled? which OIDC providers? legal URLs? motd?). **This is the "server handshake" endpoint an Android app should call right after the user types a server URL.**

### 7.8 → What Fem-ho should do

- **Start at v2 semantics.** `POST` creates (201), `PUT` replaces, `PATCH` merge-patches, `DELETE` deletes. Do not repeat Vikunja's `PUT`-creates mistake; it cost them a whole major version.
- **Envelope your lists** `{items, total, page, per_page, total_pages}` from day one. Headers-only pagination breaks in browsers behind CORS unless you `Access-Control-Expose-Headers`, and it's invisible to MCP tool schemas.
- **RFC 9457 `application/problem+json`** for errors, with a stable machine `code`. The AI user needs deterministic error codes to retry correctly.
- **ETags + `If-None-Match`** are not optional for an offline-first Android client. Add `If-Match` on writes so a stale offline edit gets a `412` instead of clobbering.
- **Copy the `tk_` token design exactly:** prefix + hex, PBKDF2-SHA256 ≥10k iterations, store `last_eight` for lookup, return cleartext once, support `expires_at` + expiry cron + advance-warning notification. Use a **different prefix per audience**: `fh_u_` for human tokens, `fh_ai_` for AI/MCP tokens. Prefix-scanning secret scanners (GitHub, gitleaks) key off prefixes — pick something unique and register it.
- **Copy `GET /routes` scope discovery.** It is the cleanest way to build a token-creation UI with checkboxes that can never drift from the code, and it doubles as the MCP server's capability manifest.
- **Design the AI scope set explicitly**, e.g.
  ```json
  {
    "tasks":      ["read_all","read_one","create","update"],
    "checklists": ["read_all","update"],
    "comments":   ["create"],
    "projects":   ["read_all"],
    "scopes":     ["read_all"]
  }
  ```
  and **never grant `delete` or `shares.*` to an AI token by default.** Add a scope-level restriction too: a token should be limited to specific àmbits (`"scope_ids": [1,3]`), which Vikunja cannot do (its tokens are user-wide). This is a real improvement.
- **Copy `GET /info`** and make it the Android app's server-probe: return `{version, api_versions, features:{caldav,link_sharing,registration,ai_user}, auth:{local,oidc:[...]}, instance_name, default_language}`. It makes the "type your server URL" login screen able to fail fast with a good message.
- **Copy `POST /tasks/bulk` and `/assignees/bulk` / `/labels/bulk`.** Bulk edit is Vikunja's #114 open request (11 reactions) in the *UI*; the API already has it. Ship both.
- **Copy `GET /projects/:project/tasks/by-index/:index`** — resolves `FAM-17` without a search.

---

## 8. Webhooks

### 8.1 Endpoints

```
GET    /api/v1/projects/{id}/webhooks
PUT    /api/v1/projects/{id}/webhooks                 (create)
POST   /api/v1/projects/{id}/webhooks/{webhookID}     (update)
DELETE /api/v1/projects/{id}/webhooks/{webhookID}

GET    /api/v1/user/settings/webhooks
PUT    /api/v1/user/settings/webhooks
POST   /api/v1/user/settings/webhooks/{webhookID}
DELETE /api/v1/user/settings/webhooks/{webhookID}

GET    /api/v1/webhooks/events                        (self-describing event list)
```

Both **project-scoped** and **user-scoped** webhooks exist — the latter fire for anything the user can see.

### 8.2 Payload

```json
{
  "event_name": "task.created",
  "time": "2026-08-05T10:12:00+02:00",
  "data": {
    "task": { },
    "doer": { }
  }
}
```

`time` is ISO 8601 with timezone. `data` contents vary by event (`task`, `doer`, `project`, `comment`, …).

### 8.3 Security & delivery

- Signature header: **`X-Vikunja-Signature`** = HMAC-SHA256 hex of the **raw JSON request body**, keyed on the webhook's configured secret. Omitted when no secret is set.
- Basic auth on the target URL is supported (2.4.0 made it consistent).
- **Delivery is once, with no retries** on HTTP ≥400 or timeout. Timeout default 30s (`webhooks.timeoutseconds`).
- SSRF guard: `webhooks.allownonroutableips` (false) and the global `outgoingrequests` section; optional egress proxy `webhooks.proxyurl` / `proxypassword`.
- A `webhook.delivery` internal event exists (so deliveries are themselves auditable).

### 8.4 Event catalogue (`pkg/models/events.go`) — full list of internal event names

These are the strings returned by each event's `Name()`. The webhook-exposed subset is served by `GET /api/v1/webhooks/events`; the internal set is a superset (some events only drive notifications/listeners).

**Tasks:** `task.created`, `tasks.batch.created`, `task.updated`, `task.deleted`, `task.assignee.created`, `task.assignee.deleted`, `task.comment.created`, `task.comment.edited`, `task.comment.deleted`, `task.attachment.created`, `task.attachment.deleted`, `task.relation.created`, `task.relation.deleted`, `task.positions.recalculated`, `task.reminder.fired`, `task.overdue`, `tasks.overdue`

**Projects:** `project.created`, `project.updated`, `project.deleted`

**Sharing:** `project.shared.user`, `project.shared.team`

**Teams:** `team.created`, `team.deleted`, `team.member.added`, `team.member.removed`

**User/export:** `user.export.requested`

**Webhooks:** `webhook.delivery`

**Time tracking (Pro):** `time-entry.created`, `time-entry.updated`, `time-entry.deleted`

**API tokens:** `api-token.issued`, `api-token.revoked`, `api-token.used`

**Admin (Pro/audit):** `admin.user.created`, `admin.user.admin.granted`, `admin.user.admin.revoked`, `admin.user.status.changed`, `admin.user.password.set`, `admin.user.password_reset.sent`, `admin.user.deleted`, `admin.project.owner.changed`, `admin.users.listed`, `admin.access.denied`

**Architecture note:** `pkg/models/events.go` + `pkg/models/listeners.go` implement a pub/sub bus (see `/docs/events-and-listeners/`). Notifications, webhooks, metrics and audit are all *listeners* on the same bus. That is the right shape.

### 8.5 → What Fem-ho should do

- **Copy the event bus + listener architecture verbatim.** Fem-ho needs an **audit trail of every change** (explicit product requirement for the AI user). Make the audit log a listener on the same bus that feeds webhooks and notifications. One emit → notification + webhook + audit row + (later) websocket push.
- **Copy `X-Vikunja-Signature` → `X-Femho-Signature`**, HMAC-SHA256 of the raw body, plus add a `X-Femho-Delivery` UUID and a `X-Femho-Event` header (GitHub-style) so consumers can route without parsing the body.
- **Do differently: retry.** Vikunja's fire-and-forget is a real complaint magnet. Fem-ho should retry with exponential backoff (e.g. 5 attempts over ~1h) and mark a webhook `disabled_at` after N consecutive failures, with a notification to the owner.
- **Copy the `GET /webhooks/events` self-description.** Also expose it in the MCP server so an agent can discover what it can subscribe to.
- **Add per-scope webhooks**, not just per-project + per-user. Fem-ho's àmbits are the natural subscription unit ("notify me for anything in Família").
- **Include `doer` in every payload** and make sure the AI user shows up as the doer when it acts — that *is* the audit trail.

---

## 9. Notifications, subscriptions, mentions

### 9.1 Notification types (`pkg/models/notifications.go`)

| Struct | `Name()` | Trigger |
|---|---|---|
| `ReminderDueNotification` | `task.reminder` | a task reminder fires |
| `TaskCommentNotification` | `task.comment` | new comment on a subscribed task |
| `TaskAssignedNotification` | `task.assigned` | you were assigned |
| `TaskDeletedNotification` | `task.deleted` | a subscribed task was deleted |
| `ProjectCreatedNotification` | `project.created` | project created in a subscribed context |
| `TeamMemberAddedNotification` | `team.member.added` | you were added to a team |
| `UserMentionedInTaskNotification` | `task.mentioned` | `@you` in a task description/comment |
| `UndoneTaskOverdueNotification` | `task.undone.overdue` | single overdue task digest |
| `UndoneTasksOverdueNotification` | `task.undone.overdue` | multi-task overdue digest |
| `DataExportReadyNotification` | `data.export.ready` | export finished |

Both overdue structs share the same name string (singular vs plural payload). The overdue digest fires at `defaultsettings.overdue_tasks_reminders_time` (default `9:00`) per user timezone, gated by `email_reminders_enabled`.

### 9.2 Delivery channels

- **Database** (`notifications_database.go`) → in-app bell, `GET /api/v1/notifications`, mark-read via `POST /api/v1/notifications/:id` (**UNVERIFIED**: exact param name).
- **Email** (via `mailer`).
- **Atom feed** — added in 2.4.0, gated by the `feeds` API-token permission (`HasFeedsAccess()`).
- **No push, no websockets.** Open issue **#1460 "Live state synchronization via websockets"** (9 reactions) and **#8 "Apprise Integration"** (10 comments) are both about this gap.

### 9.3 Subscriptions

`PUT|DELETE /api/v1/subscriptions/{entity}/{entityID}` with `entity ∈ project|task`. Subscribing to a project implies notifications for its tasks. The `Task.Subscription` and `Project.Subscription` fields tell the client the current state inline. `Task.is_unread` (via `?expand=is_unread`) + `POST /api/v1/tasks/:projecttask/read` give per-user read state.

### 9.4 Mentions

`pkg/models/mentions.go`. `@username` inside a task description or comment produces a `task.mentioned` notification **only if the mentioned user has access to the task**. TipTap provides the autocomplete UI. 2.4.0 added `:shortcode` emoji autocomplete through the same mechanism, plus **comment replies with quote attribution**.

### 9.5 → What Fem-ho should do

- **Copy the notification-type registry pattern** (each notification is a struct with `Name()`, `ToDB()`, `ToMail()`), because Fem-ho will add channels (Android FCM push, maybe ntfy/Gotify for the self-hosted crowd) and you want one type → N renderers.
- **Copy `is_unread` + explicit mark-read.** In a family app "has my partner seen this yet" is a core question.
- **Do differently: ship push.** An Android app without push notifications for reminders is not competitive. Options for self-hosted: **UnifiedPush** (ntfy as distributor — no Google dependency, the self-hosted crowd's preference) with FCM as a fallback for Play-Store builds. Vikunja simply doesn't have this and it's their most-felt gap for mobile.
- **Do differently: real-time.** Vikunja's #1460 is unresolved. For a family kanban where two people move cards simultaneously, SSE (`GET /api/v1/events/stream`) is enough and is far cheaper than websockets — reuse the same event bus.
- **Copy the overdue digest** at a per-user configurable hour with per-user timezone. Add a *family* digest option ("what's due today across Família") — a genuinely new, high-value feature for the household use case.

---

## 10. CalDAV

### 10.1 Status (documented honestly by upstream)

> "in early alpha stage and has bugs"

Gated by `service.enablecaldav`.

### 10.2 URL layout

All under **`/dav`**:

| URL | Purpose |
|---|---|
| `/dav/principals/<username>/` | **discovery URL** — what you paste into a client |
| `/dav/projects/` | calendar home / collection of all projects |
| `/dav/projects/<Project ID>/` | one project = one VTODO calendar |
| `/dav/projects/<Project ID>/<Task UID>` | one task = one `.ics` resource |

Routes registered as `ANY` (WebDAV needs `PROPFIND`, `REPORT`, `MKCOL`, `MOVE`, `OPTIONS`, …).

### 10.3 Authentication

HTTP Basic with the Vikunja **username** plus one of:
1. the account password (local/LDAP accounts without 2FA),
2. a **dedicated CalDAV token** (`PUT|GET|DELETE /api/v1/user/settings/token/caldav`) — **required** for OIDC accounts or accounts with 2FA,
3. **an API token** (2.3.0+) — pass the `tk_...` value as the password; the token needs the `caldav: ["access"]` permission.

### 10.4 VTODO property support (from `/help/caldav/`)

**Fully supported (both directions):** `UID`, `SUMMARY`, `DESCRIPTION`, `PRIORITY`, `CATEGORIES`, `COMPLETED`, `DUE`, `DURATION`, `DTSTAMP`, `DTSTART`, `RELATED-TO`, `VALARM`

**One-way (Vikunja → client only):** `CREATED`, `LAST-MODIFIED`, `RRULE`

**Partial:** `STATUS` (only the `COMPLETED` value is honoured)

**Not supported:** `ATTACH`, `CLASS`, `COMMENT`, `CONTACT`, `GEO`, `LOCATION`, `ORGANIZER`, `PERCENT-COMPLETE`, `RECURRENCE-ID`, `RESOURCES`, `SEQUENCE`, `URL`

Note `PERCENT-COMPLETE` being unsupported despite `Task.PercentDone` existing — a straightforward gap.

### 10.5 Parsing: VTODO → Task (`pkg/caldav/parsing.go`)

| iCal | Task field | Notes |
|---|---|---|
| `UID` | `UID` | warns if missing |
| `SUMMARY` | `Title` | warns if missing |
| `DESCRIPTION` | `Description` | unescapes `\,` and `\n`; 2.4.0 syncs as **Markdown** rather than HTML |
| `PRIORITY` | `Priority` | via `parseVTODOPriority()` |
| `DTSTART` | `StartDate` | tz-aware |
| `DUE` | `DueDate` | tz-aware |
| `DTEND` | `EndDate` | tz-aware |
| `DURATION` | `EndDate` | computed as `StartDate + duration` |
| `COMPLETED` | `DoneAt` | |
| `STATUS` | `Done` | true iff value == `COMPLETED` |
| `CATEGORIES` | `Labels` | comma-split; **empty value clears all labels** |
| `X-APPLE-CALENDAR-COLOR`, `X-OUTLOOK-COLOR`, `X-FUNAMBOL-COLOR`, `COLOR` | `HexColor` | via `getHexColorFromCaldavColor()` |
| `RELATED-TO` | `RelatedTasks` | `RELTYPE=PARENT` → parenttask, `RELTYPE=CHILD` → subtask |
| `VALARM` / `TRIGGER` | `Reminders` | three forms, below |

**Date formats accepted:** `20060102T150405Z` (UTC), `20060102T150405` (floating/local), `20060102` (date-only). If `TZID` is present that timezone is loaded; otherwise the configured tz is used.

**VALARM triggers → `TaskReminder`:**
```
TRIGGER;VALUE=DATE-TIME:20181201T011210Z   → TaskReminder{Reminder: <ts>}
TRIGGER;RELATED=END:-P2D                   → TaskReminder{RelativePeriod: -172800, RelativeTo: end_date|due_date}
TRIGGER;RELATED=START:-P2D                 → TaskReminder{RelativePeriod: -172800, RelativeTo: start_date}
```
(For `RELATED=END`, `end_date` is preferred, falling back to `due_date`.)

### 10.6 Serialization: Task → VTODO (`pkg/caldav/caldav.go`)

`Todo` struct fields: **required** `Timestamp`, `UID`; **optional** `Summary`, `Description`, `Done`, `Completed`, `Organizer`, `Priority` (0–9), `Relations`, `Color`, `Categories`, `Start`, `End`, `DueDate`, `Duration`, `RepeatAfter`, `RepeatMode`, `Alarms`, `Created`, `Updated`.

Calendar header:
```
BEGIN:VCALENDAR
VERSION:2.0
X-PUBLISHED-TTL:PT4H
X-WR-CALNAME:<escaped calendar name>
PRODID:-//<config ProdID>//EN
```
then per task: `UID`, `DTSTAMP`, `SUMMARY`, and conditionally `DTSTART`, `DTEND`, `DESCRIPTION`, `STATUS`, `ORGANIZER`, `DUE`, `CREATED`, `PRIORITY`, `RRULE`, `CATEGORIES`, `LAST-MODIFIED`, `VALARM` blocks, `RELATED-TO` lines.

**RRULE generation** (`getRruleFromInterval`, seconds → FREQ):
```
interval % (7*24*3600) == 0  → FREQ=WEEKLY;INTERVAL=<n weeks>
interval % (24*3600)   == 0  → FREQ=DAILY;INTERVAL=<n days>
interval % 3600        == 0  → FREQ=HOURLY
interval % 60          == 0  → FREQ=MINUTELY
otherwise                    → FREQ=SECONDLY
```
For `RepeatMode == TaskRepeatModeMonth`: `RRULE:FREQ=MONTHLY;BYMONTHDAY=<day>`.

**VALARM output:**
```
BEGIN:VALARM
TRIGGER[;RELATED=START|END]:<duration or datetime>
ACTION:DISPLAY
DESCRIPTION:<escaped description>
END:VALARM
```

**Priority mapping:** the code calls `mapPriorityToCaldav(t.Priority)` / `parseVTODOPriority()`. **UNVERIFIED — the exact table was not read.** RFC 5545 uses 1 = highest … 9 = lowest, 0 = undefined, which is *inverse* to Vikunja's 1 = low … 5 = urgent, so a mapping table definitely exists. Do not guess it; read `pkg/caldav/parsing.go`'s `parseVTODOPriority` before implementing.

### 10.7 Client compatibility (documented)

**Working:** Evolution, OpenTasks, **DAVx⁵**, **Tasks (Android)**, KOrganizer.
**Not working:** Thunderbird (68), iOS CalDAV Sync.
2.4.0 added **iOS Reminders sync** support and duration-parsing fixes.

### 10.8 → What Fem-ho should do

- **Copy the URL layout but make the granularity match Fem-ho's spec.** Fem-ho wants CalDAV **per scope and per project**. So:
  ```
  /dav/principals/<username>/
  /dav/calendars/<username>/                       (calendar-home-set)
  /dav/calendars/<username>/scope-<id>/            (whole àmbit, all its projects)
  /dav/calendars/<username>/scope-<id>-p-<pid>/    (one project)
  /dav/calendars/<username>/<collection>/<uid>.ics
  ```
  Return **both** granularities in the `PROPFIND` on calendar-home so users can subscribe to a whole àmbit or a single project. Vikunja only offers per-project — this is a real Fem-ho improvement.
- **Implement `VTODO` first, `VEVENT` second.** Fem-ho has a calendar view; tasks with `due_date` are VTODOs, but users will expect them in their calendar app. The pragmatic answer many apps use: expose VTODO on the task calendars, and *optionally* a read-only `VEVENT` mirror collection for tasks that have both `start_date` and `end_date`. Mark this explicitly as v2 scope.
- **Store `uid` on the task** (Vikunja does: `varchar(250)`). Generate it yourself as `<taskid>@<instance-host>` on create so round-trips are stable.
- **Support `PERCENT-COMPLETE`** — Vikunja doesn't, and Fem-ho already has the field.
- **Support the ETag/`getctag` + sync-token path (RFC 6578 `sync-collection`).** Vikunja's CalDAV is "early alpha" largely because full-collection `PROPFIND` on every sync is slow and racy. If Fem-ho wants "bidirectional CalDAV as a first-class feature", implement `DAV:sync-token` from the start; DAVx⁵ uses it and it turns a full re-sync into a delta.
- **Test against exactly the documented-working set:** DAVx⁵ + Tasks.org (Android), Thunderbird 128+ ESR, Apple Reminders/Calendar (iOS 17+), Evolution, KOrganizer. Write these into CI as fixture-based tests of the generated `.ics`.
- **Copy the honest support matrix in the docs.** Vikunja's explicit "supported / one-way / unsupported" table is why their CalDAV, despite being alpha, generates fewer angry issues than it should.
- **Auth: copy the three-way password model** (account password / dedicated CalDAV token / scoped API token with `caldav: access`). Fem-ho's AI tokens must **not** be usable for CalDAV.

---

## 11. Link shares

### 11.1 Model

See §3.10. Recap: `hash varchar(40) unique`, `permission` 0/1/2, `sharing_type` 0/1/2 derived, `password` write-only, `name` shown as the actor for anything the guest does, `shared_by`.

Gated globally by `service.enablelinksharing` (default true).

### 11.2 Endpoints

```
PUT    /api/v1/projects/:project/shares          (create)
GET    /api/v1/projects/:project/shares          (list)
GET    /api/v1/projects/:project/shares/:share
DELETE /api/v1/projects/:project/shares/:share
POST   /api/v1/shares/:share/auth                (unauthenticated — exchange hash [+password] for a JWT)
```

### 11.3 Anonymous session flow (`pkg/routes/api/v1/link_sharing_auth.go`)

```
POST /api/v1/shares/{share}/auth
Content-Type: application/json

{ "password": "hunter2" }        // omit / empty when sharing_type == 1
```
→ `200`
```json
{ "token": "<jwt>" }
```

Internals: handler binds a `LinkShareAuth{hash, password}` and calls `shared.AuthenticateLinkShare()`, which returns a JWT. The JWT encodes the link-share identity (not a user), so downstream permission checks see a link-share principal with the share's `permission` level, scoped to that project. Errors: `400` invalid object, `500` internal.

The frontend then uses that JWT exactly like a normal session token — **same `Authorization: Bearer` header, same endpoints**. That is the key design: no separate "public API".

### 11.4 What's missing in Vikunja

- **No expiry.** No `expires_at` column.
- **No required guest name.** `name` is set by the sharer.
- **Project-granularity only** — you cannot share a single task or a single checklist.
- Security history: 2.4.0 fixed *"share links could enumerate boards and users instance-wide"* and *"API token manipulation via link share collisions"*. Link-share principals leaking into user-scoped queries is a recurring bug class.

### 11.5 → What Fem-ho should do

- **Copy the `POST /shares/{hash}/auth` → JWT → normal Bearer flow.** It is by far the simplest way to make a public page work with the same API and the same client code.
- **Copy `sharing_type` being server-derived** and `password` being `writeOnly`.
- **Add the three things Vikunja lacks**, which are already in Fem-ho's spec:
  - `expires_at TIMESTAMPTZ NULL` — enforce in `AuthenticateLinkShare` *and* in a cron that purges expired shares.
  - `require_guest_name BOOL` — when true, `POST /shares/{hash}/auth` requires `{"password": "...", "guest_name": "Marta"}` and the returned JWT carries `guest_name` as a claim. Every mutation then records `actor_type=link_share, actor_label="Marta (via enllaç)"` in the audit trail.
  - **Target granularity**: `share_target_type ∈ task | checklist` (Fem-ho's spec is "a task-with-subtasks or a checklist" — *not* a whole project). Model it as `(target_type, target_id)` so a project-level share can be added later without a migration.
- **Learn from their CVEs.** Write explicit tests that a link-share JWT: (a) cannot read any entity outside its target subtree; (b) cannot list users; (c) cannot create/read API tokens; (d) cannot be upgraded to a user session. Vikunja shipped all four of those bugs.
- **Rate-limit `POST /shares/{hash}/auth`** hard (it's a password oracle) and make `hash` ≥ 32 chars of CSPRNG base62.

---

## 12. Repeating tasks

### 12.1 Model

`repeat_after int64` (**interval in seconds**) + `repeat_mode`:

```go
TaskRepeatModeDefault         = 0  // shift dates by repeat_after from the previous dates
TaskRepeatModeMonth           = 1  // monthly, same day-of-month
TaskRepeatModeFromCurrentDate = 2  // shift dates by repeat_after from *now* (completion time)
```

When a repeating task is marked done, the server un-dones it and shifts `due_date`/`start_date`/`end_date`/reminders forward. Quick Add Magic syntax: `every day`, `every 3 days`, `every week`, `every 2 weeks`, `every month`.

`/help/dates-and-reminders/` claims support for "complex rules like *first Tuesday of the month*" — **this is not supported by the `repeat_after`+`repeat_mode` model as read from the source**, and the CalDAV RRULE generator only emits `FREQ=SECONDLY|MINUTELY|HOURLY|DAILY|WEEKLY` and `FREQ=MONTHLY;BYMONTHDAY=n`. **Treat the docs claim as marketing copy; the model cannot express `BYDAY=1TU`.** Flagged **UNVERIFIED / likely doc error.**

The dedicated repeat-logic source file was not located (`pkg/models/tasks_repeat.go` and `pkg/models/task_repeat.go` both 404). The logic lives inside `tasks.go`'s update path (`updateDone`). **UNVERIFIED**: exact behaviour for reminders and subtasks on repeat.

### 12.2 Known complaints

- **#1369 "More precise settings for recurrence"** (10 reactions) — asks for quarterly/annual/monthly-by-weekday.
- **#1872 "Configurable repeat task behavior"** (6 reactions).
- **#347 "Repeating tasks in kanban views should be moved to the default bucket when done"** (8 comments) — fixed in 2.4.0 ("Recurring tasks return to original buckets").

### 12.3 → What Fem-ho should do

- **Do not copy `repeat_after` seconds.** It cannot express "every first Monday", "every last day of month", "weekdays only", "every 2nd Tuesday and Thursday" — all of which a family calendar needs (escombraries, extraescolars, medicació).
- **Store an RFC 5545 `RRULE` string** (`rrule TEXT NULL`) plus an optional `repeat_from ∈ due_date | completion_date`. This:
  - maps 1:1 to CalDAV with zero translation,
  - has mature libraries in every language (`teambition/rrule-go` for Go, `rrule` for JS/TS, `com.github.dmfs:lib-recur` or `biweekly` for Android/Kotlin),
  - and gives you `BYDAY=1MO`, `BYMONTHDAY=-1`, `BYDAY=MO,TU,WE,TH,FR`, `COUNT=`, `UNTIL=` for free.
- **Keep the two-mode `repeat_from` idea** — Vikunja's `TaskRepeatModeFromCurrentDate` is genuinely useful ("water the plants every 3 days *from when I last did it*") and is not expressible in plain RRULE. That's the one thing to keep.
- **Fix the two bugs Vikunja has/had:** on repeat, (a) return the task to the **default bucket** (Per fer), not Inbox and not the bucket it was in when completed; (b) shift *relative* reminders automatically because they're anchored to the shifted date (that's free with the `TaskReminder.RelativeTo` design), and shift *absolute* reminders by the same delta.
- **Decide explicitly what happens to subtasks/checklists on repeat.** For a family app the right default is: **reset checklist items to unchecked, keep subtasks but un-done them.** Make it a per-task flag (`repeat_resets_checklist BOOL DEFAULT true`).

---

## 13. Bot users, OAuth server, and the AI-agent story

This section is the most directly relevant to Fem-ho's "AI user" requirement. Vikunja shipped essentially this exact feature in **2.4.0** and it is worth copying almost wholesale.

### 13.1 Bot users (`/docs/bot-users/`, 2.4.0+)

> "A bot user is a Vikunja account meant for automation rather than a person: scripts, integrations, CI jobs, and coding agents."

Properties:
- **Username prefix `bot-` is mandatory** for bots and **forbidden** for regular signups. Instant visual + programmatic distinction.
- **No password, no email** → "it can't log in through the web UI or over CalDAV."
- **API-token auth only.**
- **Owned by the human who created it**; deleting the owner deletes the bot.
- Distinctive avatar + badge in the UI.
- Otherwise a normal user: can be **shared projects**, **assigned to tasks**, **mentioned in comments**, appears in search.

Management UI: **Settings → Bots** (`/user/settings/bots`). API: `PUT|GET|POST|DELETE /api/v1/user/bots*`.

Workflow: create bot → share projects with it → generate a scoped API token → hand the token to the script/agent.

### 13.2 OAuth 2.0 authorization server (`/docs/oauth-server/`)

Vikunja is now an OAuth **provider** (for its own clients — desktop/mobile/CLI), separate from being an OIDC **client**.

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/oauth/authorize` | browser navigation | none | user-facing authorization page |
| `/api/v1/oauth/authorize` | POST | JWT Bearer | creates an authorization code |
| `/api/v1/oauth/token` | POST | none | code→token exchange, and refresh |

- Grants: **authorization_code (PKCE mandatory, S256 only)** and **refresh_token**.
- **No client registration.** `client_id` is any string, just consistent between steps.
- **Redirect URIs must use a custom scheme starting with `vikunja-`**, e.g. `vikunja-flutter://callback`. (Clever: no open-redirect surface, no localhost port dance.)
- JSON-only bodies. **No consent screen** — authorization is automatic once the user is authenticated.
- Access tokens are JWTs, TTL = `service.jwtttlshort` (default 600s).
- Refresh tokens **rotate on every use**; the old one is invalidated.
- `code_verifier`: 43–128 chars from `[A-Za-z0-9\-._~]`.

Token request body:
```json
{
  "grant_type": "authorization_code",
  "code": "<authorization-code>",
  "client_id": "<your-client-id>",
  "redirect_uri": "vikunja-flutter://callback",
  "code_verifier": "<original-code-verifier>"
}
```

No OAuth scopes are documented — **UNVERIFIED**, likely full-user scope.

### 13.3 `veans` — the agent CLI (`/docs/veans/`)

> "wraps Vikunja's REST API with an agent-friendly surface" — for **coding agents to track their work in Vikunja instead of ephemeral to-do lists.** Requires Vikunja ≥ 2.4.0.

`veans init`:
- OAuth 2.0 sign-in (no client registration)
- prompts for a project and a kanban view
- **creates five workflow buckets automatically**
- creates a dedicated **bot user**
- stores a long-lived API token in the **OS keychain** or a local config file

Commands: `veans prime` (emits the agent system prompt), `veans claim <id>` (assign to bot + move to "In Progress"), `veans list`, `veans show`, `veans create`, `veans update`, `veans api` (raw REST passthrough).

**The workflow rule that matters most:**
> agents move completed work to **"In Review"** but **never to "Done"** — ensuring "a human in the loop on everything the agent produces."

`veans prime` output is designed to be re-consumed by the agent **at session start and after context compaction**.

Distribution: apt/rpm/pacman/apk + standalone binaries.

### 13.4 Third-party MCP servers (community, not official)

Vikunja has **no official MCP server**. The ecosystem filled the gap:
- `github.com/democratize-technology/vikunja-mcp` — the most complete; `npx @democratize-technology/vikunja-mcp`; covers tasks, projects, labels, kanban views, buckets, saved filters; configured with an API URL + token.
- `github.com/lowlyocean/mcp-vikunja` — minimal, reminders only.
- `idjohnson/vikunjamcp` — another implementation.
- Community thread: *"I tried Vikunja with MCP + VS Code copilot"* (community.vikunja.io/t/…/3990).

**Signal for Fem-ho:** three independent people built MCP servers because the API was good enough to wrap but no one shipped it officially. Fem-ho shipping a **first-party MCP server** is a genuine differentiator, and the API design should be shaped *by* the MCP tool surface, not retrofitted to it.

### 13.5 → What Fem-ho should do

This maps almost perfectly onto Fem-ho's "AI user" and "do-it-myself / AI-assisted / AI-delegated" model.

- **Copy bot users, rename them.** Fem-ho's "usuari IA" = a user row with `is_ai BOOL` (or username prefix `ia-`), **no password, no email, cannot log into the web UI, cannot use CalDAV**, owned by a household admin, assignable to tasks, mentionable in comments, with a distinct avatar/badge. Everything else in the app treats it as a normal user — which means assignment, notifications, audit trail and kanban all work with **zero special-casing**. That is the whole trick.
- **Copy the "never move to Done" rule and make it a hard server-side constraint, not a convention.** Concretely:
  - Task field `ai_mode ∈ self | assisted | delegated` (matches Fem-ho's spec exactly).
  - Server rule: an AI-principal token **cannot** set `done = true` on a task with `ai_mode = delegated`; it can only move it to a review state. Add a 5th internal bucket state or a `needs_review BOOL` on the task, rendered as a badge on the card in `Fent`.
  - Server rule: an AI principal cannot change `ai_mode`, cannot delete tasks, cannot manage shares, cannot create tokens.
- **Copy `veans prime`.** Ship a `femho_get_instructions()` MCP tool (and a CLI `femho prime`) that returns the current household's àmbits, projects, the 4 bucket names in Catalan, the filter grammar with examples, the quick-add syntax, and the review rules. Agents lose this on context compaction; make re-fetching it one call.
- **Copy the OAuth server design for the Android app.** PKCE-S256-mandatory, custom scheme (`femho://callback`), no client registration, rotating refresh tokens, short-lived access JWTs. This is exactly right for a self-hosted app where you can't pre-register clients. **But** relax the redirect-scheme rule to also allow `http://127.0.0.1:<port>/callback` for CLI/desktop tools (RFC 8252 §7.3) — Vikunja's `vikunja-` scheme requirement blocks loopback CLI flows.
- **Ship the MCP server in the same binary.** `femho serve --mcp` or an HTTP MCP endpoint at `/mcp` authenticated with an `fh_ai_` token. Tools, minimum viable set:
  - `femho_prime()` → instructions + household structure
  - `femho_list_tasks(filter, scope_ids, view, expand, page)` → uses the filter DSL
  - `femho_get_task(id)` / `femho_search(q)`
  - `femho_quick_add(text)` → runs the Catalan quick-add parser server-side
  - `femho_create_task(...)`, `femho_update_task(id, patch)` (JSON Merge Patch)
  - `femho_move_task(id, bucket)` — **rejects `Fet` for delegated tasks**
  - `femho_add_comment(task_id, text)` — the AI's channel for "here's what I did"
  - `femho_list_scopes()`, `femho_list_projects(scope_id)`
  - `femho_checklist_*`
  - Deliberately **absent**: delete, share, token, user management.
- **Every AI mutation writes an audit row** with `actor_type=ai`, the token id, the tool name, and the before/after diff. Surface it in the task detail as a timeline. This is Fem-ho's stated requirement and it comes free from the event-bus listener pattern (§8.5).

---

## 14. Frontend UX specifics worth copying

### 14.1 Keyboard shortcuts (`frontend/src/components/misc/keyboard-shortcuts/shortcuts.ts`) — complete list

**General**
| Keys | Action |
|---|---|
| `ctrl/⌘ + e` | Toggle menu (sidebar) |
| `ctrl/⌘ + k` | **Quick search / Quick Actions** |

**Navigation (`g`-prefixed chords)**
| Keys | Action |
|---|---|
| `g` `o` | Overview |
| `g` `u` | Upcoming |
| `g` `p` | Projects |
| `g` `a` | Labels |
| `g` `m` | Teams |

**List view (project.view route only)**
| Keys | Action |
|---|---|
| `j` | Navigate down |
| `k` | Navigate up |
| `enter` | Open task |

**Kanban**
| Keys | Action |
|---|---|
| `ctrl/⌘ + click` | Mark task done |

**Project view (all project routes)**
| Keys | Action |
|---|---|
| `g` `l` | Switch to List |
| `g` `g` | Switch to Gantt |
| `g` `t` | Switch to Table |
| `g` `k` | Switch to Kanban |

**Gantt**
| Keys | Action |
|---|---|
| `←` / `→` | Move task left/right |
| `shift + ←/→` | Expand left/right |
| `ctrl/⌘ + ←/→` | Shrink left/right |

**Task detail (task.detail route only)**
| Keys | Action |
|---|---|
| `t` | Mark done |
| `a` | Assign |
| `l` | Labels |
| `d` | Due date |
| `f` | Attachment (file) |
| `r` | Related tasks |
| `m` | Move |
| `c` | Color |
| `shift/alt + r` | Reminder |
| `e` | Description (edit) |
| `p` | Priority |
| `backspace` / `delete` | Delete |
| `s` | Favorite (star) |
| `u` | Open project (up) |
| `ctrl/⌘ + s` | Save |
| `.` | Copy task ID |
| `.` `.` | Copy ID + title |
| `.` `.` `.` | Copy ID + title + URL |
| `ctrl/⌘ + .` | Copy URL |

The progressive `.` / `..` / `...` copy is a genuinely novel, delightful detail.

**Implementation note:** shortcuts are declared as data (`{keys, title, combination, available(route)}`) and rendered into a help modal automatically — one list drives both behaviour and the `?` help overlay.

### 14.2 Quick Actions (`ctrl/⌘ + k`)

A command palette overlay that does **search + navigation + creation** in one input. It accepts **Quick Add Magic syntax** for creating tasks directly. Known complaint: *"Search: 'New Task' should use default or currently opened project"* — the palette creates tasks in the default project rather than the one you're looking at (community thread 3098).

### 14.3 Kanban drag & drop

- Drag cards within a bucket (reorder → sets `task_positions.position` to the neighbours' midpoint).
- Drag between buckets (sets `task_buckets` + position). **Disabled when `bucket_configuration_mode = filter`.**
- Drag a card onto a project in the **sidebar** to move it between projects.
- Drag bucket headers to reorder buckets (`Bucket.Position`).
- WIP limit reached → header turns **red**, drops rejected.
- **Collapse/expand buckets**; state in localStorage.

### 14.4 Other UX details

- **Cover images on cards** via `cover_image_attachment_id`.
- **Reactions** on tasks and comments (`ReactionMap`, `/:entitykind/:entityid/reactions`).
- **Project backgrounds** — upload or Unsplash, with **BlurHash** placeholders.
- **TipTap editor** with `@` mentions and `:emoji` autocomplete.
- **Comment replies with quote attribution** and navigation chevrons (2.4.0).
- **Accessibility overhaul** (2.4.0): keyboard navigation for cards and inputs, visible focus rings, screen-reader announcements for state changes.
- **PWA / Workbox** service worker → installable, offline shell.
- **Desktop app** — Electron wrapper around the same frontend.

### 14.5 → What Fem-ho should do

- **Copy the shortcut set almost verbatim**, translating mnemonics to Catalan where they'd otherwise be nonsense. Suggested Fem-ho mapping:
  - `ctrl/⌘ + k` — Accions ràpides (keep universally)
  - `g` `t` — Tasques, `g` `c` — Calendari, `g` `a` — Àmbits, `g` `i` — Inbox
  - Task detail: `f` fet (done), `a` assignar, `e` etiquetes, `d` data, `p` prioritat, `r` recordatori, `m` moure, `s` preferit
  - Keep `j`/`k` navigation and `.`/`..`/`...` copy — those are language-neutral.
- **Copy "shortcuts as data + auto-generated help modal."** Zero drift between docs and behaviour.
- **Fix the quick-actions default-project bug**: Fem-ho's palette should default to the **currently selected scope chips + project dropdown**, falling back to Inbox.
- **Copy collapse-done-bucket**, but persist server-side per user (§4.6). With a 4-column fixed board on a phone, collapsing `Fet` is essential.
- **Copy BlurHash** for scope/project cover images — Fem-ho's Plou design system has "one brand gradient per view", so BlurHash placeholders + gradient overlays will look coherent while loading.
- **Copy drag-onto-scope-chip** as the re-scope gesture.
- **Copy reactions on comments.** In a family context, a 👍 on "he comprat el pa" is the cheapest possible acknowledgment, and it beats a comment.
- **Do differently on mobile kanban.** Vikunja's 4-across kanban is painful on a phone; Fem-ho ships a *native Android app*, so the 4 columns should become a swipeable pager (Inbox / Per fer / Fent / Fet) with the column name in a tab row, plus long-press-to-move. Don't port the desktop DnD.

---

## 15. What users actually complain about (cited)

### 15.1 Top open GitHub issues by reactions (`go-vikunja/vikunja`, fetched via GitHub search API)

| # | Title | Reactions | The pain |
|---|---|---|---|
| 120 | Custom Fields | 16 | No per-project custom metadata. Every serious task app has this. |
| 26 | Using Vikunja as a caldav client | 13 | People want Vikunja to *consume* other CalDAV sources, not just serve. |
| 46 | Set estimated time | 12 | No estimate field → no capacity planning. |
| 1529 | **Display tasks from subprojects** | 11 | Nesting is organizational only; a parent project shows none of its children's tasks. Big deal post-namespace-removal. |
| 114 | Bulk edit for tasks | 11 | API has `/tasks/bulk`; the UI doesn't expose it. |
| 336 | **Simplify adding subtasks** | 11 | Subtasks-as-relations makes creating them a multi-step chore. |
| 1369 | More precise settings for recurrence | 10 | `repeat_after` seconds can't express monthly/quarterly/annual/by-weekday. |
| 1460 | **Live state synchronization via websockets** | 9 | Two people on the same board see stale state. |
| 1501 | Add OpenID Connect PKCE Support | 9 | (partially addressed by the 2.4.0 OAuth work) |
| 1364 | **Week and month calendar view** | 9 | Vikunja has Gantt but no calendar. |
| 1285 | Finishing task should set progress to 100% | 7 | `done` and `percent_done` are independent. |
| 1747 | Buckets in other views | 7 | Bucket is a kanban-only concept; users want it as a column/field everywhere. |
| 474 | Delete all completed tasks | 7 | No archive/purge. |
| 1630 | Pin favorited tasks to top | 6 | |
| 1872 | Configurable repeat task behavior | 6 | |

### 15.2 Top open issues by comment count

| # | Title | Comments |
|---|---|---|
| 26 | Using Vikunja as a caldav client | 16 |
| 364 | OIDC Connect - issuer did not match the issuer returned by provider | 11 |
| 8 | Apprise Integration | 10 |
| 2235 | Show the bucket name in addition to the Project in the Overview menu | 9 |
| 114 | Bulk edit for tasks | 9 |
| 347 | Repeating tasks in kanban views should be moved to the default bucket when done | 8 |

**#364 is a deployment-pain classic:** internal Keycloak URL vs external issuer mismatch. Any self-hosted app doing OIDC hits it.

### 15.3 Other cited pain

- **AlternativeTo reviews:** "just missing a calendar view, although the Gantt version is similar"; "the current build is full of bugs" with **filter expression errors** specifically called out.
- **CalDAV** is self-described as *"in early alpha stage and has bugs"*, with Thunderbird 68 and iOS CalDAV Sync documented as **not working**.
- **Community forum:** *"Moving a Parent Project deleted a Child Project"* (data loss on project reparenting) — community.vikunja.io/t/…/1479.
- **Community forum:** *"Shortcut for quick actions inside Task"* (…/4033), *"UI hotkeys/shortcuts"* (…/1096, 2 pages), *"Keyboard shortcut next/previous tasks in a project"* (…/1971) — people want *more* keyboard control than the already-large set.
- **2.4.0 shipped 10 security fixes**, several of them access-control bugs in kanban and link shares:
  - CVE-2026-55066 — unauthorized task reading/completion via kanban boards
  - CVE-2026-55065 — unprotected kanban board layout deletion
  - CVE-2026-55067 — unauthorized column additions to boards
  - CVE-2026-55064 — shared project detachment without admin rights
  - CVE-2026-54766 — project duplication into others' hierarchies
  - CVE-2026-62367 — OIDC account takeover via unverified email fallback
  - CVE-2026-62376 — password-reset links stored in plain text
  - CVE-2026-57458 — limited API tokens could escalate to full sessions
  - plus: share links could enumerate boards and users instance-wide; API token manipulation via link-share collisions
  **(CVE identifiers as reported on the Vikunja 2.4.0 changelog page; not independently verified against NVD — treat the IDs as UNVERIFIED, the vulnerability descriptions as verified.)**

### 15.4 → What Fem-ho should learn

The complaint list is a free product spec. Fem-ho already plans several of these:

| Vikunja gap | Fem-ho already plans it? |
|---|---|
| No calendar view (#1364) | ✅ month/week/day + Inbox side column |
| Parent doesn't aggregate children (#1529) | Scopes must aggregate their projects **by default** |
| Subtasks are painful (#336) | ✅ real subtasks + checklists |
| No websockets (#1460) | Add SSE |
| Weak recurrence (#1369) | Use RRULE (§12) |
| `done` ≠ 100% (#1285) | Trivial fix |
| No bulk edit UI (#114) | Multi-select in kanban |
| No expiry on link shares | ✅ in spec |
| Kanban/link-share ACL bugs (6 CVEs) | Test the boundaries hard |
| OIDC issuer mismatch (#364) | Fem-ho uses email+password — dodged entirely |

Two more to internalize:
- **#120 Custom Fields (16 reactions, the single most-wanted).** Fem-ho should *not* build a generic custom-field engine in v1 — but should reserve `metadata JSONB` on tasks and expose it through the API/MCP so power users and AI agents can attach structured data without a schema migration.
- **#46 estimated time.** Add `estimate_minutes INT NULL` on day one. It costs one column, it's what the AI needs to plan, and retrofitting it later means touching every client.

---

## 16. What Fem-ho should COPY vs DO DIFFERENTLY — consolidated

### 16.1 Copy (high confidence, low cost)

1. **Single binary + single Docker image**, embedded SPA, one port. `FEMHO_*` env vars mirroring config paths, with `_FILE` secret support and a 4-step config search path.
2. **`project_views` table** with `view_kind`, per-view `filter` (JSON), `position`, `bucket_configuration_mode`, `default_bucket_id`, `done_bucket_id`. Seed a kanban view (4 Catalan buckets) + a calendar view per scope/project.
3. **`task_positions(task_id, project_view_id, position DOUBLE)`** with midpoint insertion, `MIN_POSITION_SPACING = 0.01`, initial spread over `2^32`, server-side recalculation, and a `task.positions.recalculated` event.
4. **Done-bucket bidirectional coupling** and **default-bucket-for-new-tasks**. WIP limits per bucket.
5. **Filter DSL** (`=, !=, <, >, <=, >=, like, in, not in`, `&&`, `||`, parens) + **Elasticsearch date math** via go-datemath (`now`, `+7d`, `/d`, `now-1M/M`, `2026-03-11||+1w`) + `filter_timezone` + `filter_include_nulls`.
6. **`?expand=` param** with a small closed vocabulary (`subtasks, checklists, comments, comment_count, is_unread, attachments`).
7. **`tk_`-style prefixed API tokens**: PBKDF2-SHA256 ≥10k iters, per-token salt, stored `last_eight`, cleartext returned once, `expires_at` + expiry cron + advance notification.
8. **`GET /routes` self-describing scope catalogue** derived from the router at startup, with `read_all/read_one/create/update/delete` action names.
9. **Event bus + listeners** (`events.go` + `listeners.go`) driving notifications, webhooks, audit log, and SSE from one emit.
10. **Webhook signature** `X-Femho-Signature` = HMAC-SHA256 of the raw body; `GET /webhooks/events` catalogue; SSRF guard (`allownonroutableips: false`) + optional egress proxy.
11. **Link-share auth**: `POST /shares/{hash}/auth` → JWT → same `Authorization: Bearer` header as normal sessions. `sharing_type` server-derived; `password` write-only.
12. **Bot/AI users**: username prefix, no password, no email, no web/CalDAV login, API-token-only, owned by a human, otherwise a normal assignable/mentionable user.
13. **The "agent never marks Done" rule**, enforced server-side.
14. **`veans prime`-style instruction endpoint** for AI agents, re-fetchable after context compaction.
15. **OAuth 2.0 with mandatory PKCE-S256, no client registration, rotating refresh tokens** for the Android app.
16. **Keyboard shortcuts as data** with `g`-chords, `ctrl+k` palette, `j/k` navigation, progressive `.` copy, and an auto-generated help modal.
17. **CalDAV honest support matrix** in the docs, and a per-project + per-collection URL layout under `/dav`.
18. **BlurHash** for background/cover images.
19. **Soft delete + purge cron.**
20. **`(project_id, index)` composite unique + `identifier`** for human-readable task keys.
21. **`GET /info`** unauthenticated capability handshake — the Android login screen's first call.
22. **Reactions on tasks and comments.**
23. **`TaskReminder` dual absolute/relative model** with `relative_to ∈ due_date|start_date|end_date` and negative `relative_period` seconds.
24. **Per-model `Can*()` permission interface** driven by a generic CRUD handler.
25. **Quick-add module structure**: one parser per concern, each returning `{newText, value}`, chained, with a `"literal"` escape hatch and indentation→subtasks.

### 16.2 Do differently (Vikunja got it wrong, or Fem-ho's context differs)

1. **API verbs: start at v2 semantics.** `POST` creates → 201, `PUT` replaces, `PATCH` merge-patches. Never `PUT`-to-create.
2. **Envelope list responses** `{items,total,page,per_page,total_pages}`. Not header-only pagination.
3. **RFC 9457 `application/problem+json`** with stable machine `code`s, from v1 of the API.
4. **ETags + `If-None-Match`/`If-Match` from day one** — mandatory for an offline-first Android client with conflict detection.
5. **Recurrence: store an RFC 5545 `RRULE` string**, not `repeat_after` seconds. Keep a `repeat_from ∈ due_date|completion_date` flag (Vikunja's one good idea here). This also makes CalDAV RRULE round-tripping free instead of lossy.
6. **Subtasks: a real `parent_task_id` column**, not a symmetric relation. Keep relations for `blocking`/`related`/`duplicateof` only. Checklists are a separate entity (`checklists` + `checklist_items` with float positions), pinnable, attachable to a task or subtask.
7. **Scopes must aggregate.** Vikunja's #1529 (parent shows no child tasks) is the loudest structural complaint post-namespace-removal. In Fem-ho, selecting `#Família` must show tasks from the àmbit's general space **and all its projects** by default, with a toggle.
8. **`done = true` sets `percent_done = 1.0`.** Fix #1285.
9. **Ship a calendar view.** Vikunja's #1 view gap.
10. **Ship real-time (SSE) and push (UnifiedPush/ntfy + FCM fallback).** Vikunja has neither.
11. **Webhook retries with backoff + auto-disable after N failures.** Vikunja fires once and forgets.
12. **Persist UI state server-side per user** (collapsed buckets, selected scope chips, last view) — not localStorage. Multi-device is the whole point.
13. **Link shares: add `expires_at`, `require_guest_name`, and task/checklist granularity.** Vikunja has none of the three.
14. **Token scoping must include àmbit restriction** (`scope_ids: [1,3]`), not just route groups. Vikunja tokens are user-wide, which is exactly wrong for a household where the AI should only see `Feina` and not `Família`.
15. **Catalan-first natural-language date parsing.** Vikunja's parser is hardcoded English-only. Do it server-side (source of truth, reusable by MCP) *and* client-side (live highlight preview), sharing test fixtures.
16. **Persist `service.secret` on first boot** instead of regenerating it. Never silently log out an offline-first mobile client.
17. **Mobile kanban = swipeable pager**, not a 4-column horizontal scroll.
18. **Add `estimate_minutes` and `metadata JSONB`** on tasks from day one (Vikunja's #46 and #120, the two most-wanted missing fields).
19. **One caching concept** (`cache.type ∈ memory|redis`), not Vikunja's overlapping `cache`/`keyvalue`/`redis` trio.
20. **First-party MCP server in the same binary.** Three community MCP servers exist because Vikunja never shipped one.
21. **Loopback redirect URIs allowed** in the OAuth server (RFC 8252 §7.3), in addition to a custom `femho://` scheme.
22. **Saved filters: use a real URL namespace**, not negative project IDs. Vikunja's `-(id+1)` arithmetic with `-1` reserved for Favorites is a foot-gun.
23. **Support `PERCENT-COMPLETE` in CalDAV** (Vikunja doesn't, despite having the field) and implement **RFC 6578 `sync-collection`** sync tokens so DAVx⁵ does deltas, not full syncs.
24. **Write explicit ACL boundary tests for link-share principals and kanban endpoints.** Vikunja shipped six CVEs in exactly those two areas in one release.

---

## 17. Concrete schema sketch for Fem-ho, distilled from the above

Not a copy of Vikunja — the parts of Vikunja that earned their place, adapted to Fem-ho's model.

```sql
-- identity
users(id, username UNIQUE, email UNIQUE NULL, password_hash NULL,
      name, avatar_provider, timezone, language DEFAULT 'ca',
      week_start SMALLINT DEFAULT 1,
      is_ai BOOL DEFAULT false, owner_user_id BIGINT NULL,   -- AI users
      created, updated, deleted_at NULL)

-- àmbits
scopes(id, title, slug, hex_color, icon, is_collective BOOL,
       owner_id, position DOUBLE, is_archived, created, updated, deleted_at NULL)
scope_members(scope_id, user_id, permission SMALLINT)          -- 0/1/2
projects(id, scope_id, title, identifier VARCHAR(10), description,
         hex_color, position DOUBLE, is_archived, created, updated, deleted_at NULL)

-- views (seeded, internal)
project_views(id, scope_id NULL, project_id NULL, title, view_kind SMALLINT,
              filter JSONB NULL, position DOUBLE,
              bucket_configuration_mode SMALLINT DEFAULT 1,
              bucket_configuration JSONB NULL,
              default_bucket_id NULL, done_bucket_id NULL, created, updated)
buckets(id, project_view_id, title, position DOUBLE, limit INT DEFAULT 0,
        created_by_id, created, updated)

-- tasks
tasks(id, scope_id, project_id NULL, index BIGINT,             -- UNIQUE(project_id,index)
      title, description, done BOOL, done_at NULL,
      due_date NULL, start_date NULL, end_date NULL,
      priority SMALLINT NULL,                                   -- 1..5
      percent_done DOUBLE DEFAULT 0,
      estimate_minutes INT NULL,
      rrule TEXT NULL, repeat_from SMALLINT DEFAULT 0,          -- 0=due_date 1=completion
      repeat_resets_checklist BOOL DEFAULT true,
      parent_task_id BIGINT NULL,                               -- real subtask tree
      ai_mode SMALLINT DEFAULT 0,                               -- 0 self 1 assisted 2 delegated
      needs_review BOOL DEFAULT false,
      hex_color, cover_attachment_id NULL,
      uid VARCHAR(250) UNIQUE,                                  -- CalDAV
      metadata JSONB NULL,
      created_by_id, created, updated, deleted_at NULL)

task_positions(task_id, project_view_id, position DOUBLE)       -- UNIQUE(task_id,project_view_id)
task_buckets(task_id, bucket_id, project_view_id)               -- UNIQUE(task_id,project_view_id)
task_assignees(task_id, user_id, created)
task_relations(id, task_id, other_task_id, relation_kind, created_by_id, created)
task_reminders(id, task_id, reminder TIMESTAMPTZ, relative_period BIGINT NULL,
               relative_to SMALLINT NULL, created)
task_comments(id, task_id, author_id, comment TEXT, reply_to_id NULL, created, updated)
task_attachments(id, task_id, file_id, created_by_id, created)
labels(id, title, hex_color, created_by_id, scope_id NULL, created, updated)
label_tasks(label_id, task_id)
reactions(id, entity_kind, entity_id, user_id, value)

-- checklists (Fem-ho-specific, NOT Vikunja)
checklists(id, task_id NULL, title, is_pinned BOOL DEFAULT false,
           position DOUBLE, created_by_id, created, updated, deleted_at NULL)
checklist_items(id, checklist_id, title, done BOOL, position DOUBLE, created, updated)

-- interop
api_tokens(id, owner_id, title, token_salt, token_hash, token_last_eight,
           permissions JSONB, scope_ids BIGINT[] NULL, audience SMALLINT,  -- 0 human 1 ai
           expires_at NULL, last_used_at NULL, created)
caldav_tokens(id, user_id, token_hash, created, last_used_at)
link_shares(id, target_type SMALLINT, target_id BIGINT, hash VARCHAR(43) UNIQUE,
            permission SMALLINT DEFAULT 0, sharing_type SMALLINT,
            password_hash NULL, require_guest_name BOOL DEFAULT false,
            expires_at TIMESTAMPTZ NULL, shared_by_id, created, updated)
webhooks(id, target_type SMALLINT, target_id BIGINT, url, events TEXT[],
         secret NULL, created_by_id, disabled_at NULL, failure_count INT DEFAULT 0,
         created, updated)
subscriptions(id, entity_type SMALLINT, entity_id, user_id, created)
notifications(id, user_id, kind VARCHAR(64), payload JSONB, read_at NULL, created)
task_read_state(task_id, user_id, read_at)

-- audit (the AI requirement)
audit_log(id, actor_type SMALLINT,        -- 0 user 1 ai 2 link_share 3 system
          actor_id NULL, actor_label,     -- guest name for link shares
          token_id NULL, event_name VARCHAR(64),
          entity_type, entity_id, diff JSONB, ip INET NULL, created)
```

**Indexes that matter:** `task_positions(project_view_id, position)`, `tasks(scope_id, done, due_date)`, `tasks(parent_task_id)`, `task_reminders(reminder)` (the cron scans this), `tasks(deleted_at)`, `link_shares(hash)`, `api_tokens(token_last_eight)`.

---

## 18. Open questions / UNVERIFIED items

1. **`mapPriorityToCaldav` / `parseVTODOPriority` exact tables** — not read. RFC 5545 priority is 1 (highest) … 9 (lowest), 0 = undefined, *inverse* to Vikunja's 1 (low) … 5 (urgent). Read `pkg/caldav/parsing.go` before implementing the mapping.
2. **Repeating-task update logic** — `pkg/models/tasks_repeat.go` and `task_repeat.go` both 404. Logic is inside `tasks.go`'s done-update path. Exact behaviour for reminders, subtasks and bucket placement on repeat is unverified.
3. **`/help/dates-and-reminders/` claims "first Tuesday of the month" recurrence.** The `repeat_after`(seconds)+`repeat_mode` model and the RRULE generator (`FREQ=MONTHLY;BYMONTHDAY=n` at most) cannot express `BYDAY=1TU`. Likely a documentation error.
4. **Notification mark-read endpoint** — routes file shows `GET|POST /api/v1/notifications*`; the exact path param name for marking one read is unverified.
5. **Todoist mode priority prefix** — `prefixes.ts` shows `!` for both modes. Whether Todoist's native `p1..p4` is also accepted in Todoist mode is unverified.
6. **Whether all four views are auto-seeded on project creation.** The Favorites pseudo-project seeds List/Gantt/Table (not Kanban). Real projects are unverified.
7. **Permission inheritance from parent projects to subprojects** — not documented on `/help/permissions/`, not read in code.
8. **OAuth scopes** — `/docs/oauth-server/` documents no scopes; tokens are presumably full-user.
9. **CVE identifiers** listed in §15.3 come from the Vikunja 2.4.0 changelog page and were not cross-checked against NVD/MITRE. The vulnerability *descriptions* are verified; the IDs are **UNVERIFIED**.
10. **Frontend dependency versions** (vite 8.2.0, vue-router 5.2.0, typescript 6.0.3, eslint 10.8.0, tailwindcss 4.3.3, node ≥24) were read from `frontend/package.json` on `main` and are reported as read; they are ahead of what a 2025-trained reader would expect.
11. **`GET /api/v1/webhooks/events` exact response payload** — endpoint confirmed to exist in the router; response shape not fetched. The internal event list in §8.4 is a superset.
12. **Full `TaskAttachment`, `TaskComment`, `Label`, `Team` struct definitions** — not fetched individually; field names inferred from the `Task` struct's references and route paths.

---

## 19. Sources (URLs actually fetched)

**Official docs — vikunja.io**
- https://vikunja.io/docs/ (docs index / full sidebar)
- https://vikunja.io/docs/api-documentation/
- https://vikunja.io/docs/api-v2/
- https://vikunja.io/docs/filters/
- https://vikunja.io/docs/webhooks/
- https://vikunja.io/docs/permissions/
- https://vikunja.io/docs/config-options/
- https://vikunja.io/docs/installing/
- https://vikunja.io/docs/full-docker-example/
- https://vikunja.io/docs/bot-users/
- https://vikunja.io/docs/oauth-server/
- https://vikunja.io/docs/veans/
- https://vikunja.io/docs/integrations/

**Official help — vikunja.io/help**
- https://vikunja.io/help/ (help index)
- https://vikunja.io/help/caldav/
- https://vikunja.io/help/quick-add-magic/
- https://vikunja.io/help/views/
- https://vikunja.io/help/permissions/
- https://vikunja.io/help/task-relations/
- https://vikunja.io/help/dates-and-reminders/

**Changelog**
- https://vikunja.io/changelog/whats-new-in-vikunja-0.21.0/
- https://vikunja.io/changelog/vikunja-2.4.0-pro-and-a-new-api/

**Source — github.com/go-vikunja/vikunja (branch `main`)**
- https://raw.githubusercontent.com/go-vikunja/vikunja/main/go.mod
- https://raw.githubusercontent.com/go-vikunja/vikunja/main/frontend/package.json
- https://raw.githubusercontent.com/go-vikunja/vikunja/main/pkg/models/project.go
- https://raw.githubusercontent.com/go-vikunja/vikunja/main/pkg/models/tasks.go
- https://raw.githubusercontent.com/go-vikunja/vikunja/main/pkg/models/task_relation.go
- https://raw.githubusercontent.com/go-vikunja/vikunja/main/pkg/models/task_position.go
- https://raw.githubusercontent.com/go-vikunja/vikunja/main/pkg/models/task_reminder.go
- https://raw.githubusercontent.com/go-vikunja/vikunja/main/pkg/models/task_collection.go
- https://raw.githubusercontent.com/go-vikunja/vikunja/main/pkg/models/task_collection_filter.go
- https://raw.githubusercontent.com/go-vikunja/vikunja/main/pkg/models/kanban.go
- https://raw.githubusercontent.com/go-vikunja/vikunja/main/pkg/models/project_view.go
- https://raw.githubusercontent.com/go-vikunja/vikunja/main/pkg/models/link_sharing.go
- https://raw.githubusercontent.com/go-vikunja/vikunja/main/pkg/models/saved_filters.go
- https://raw.githubusercontent.com/go-vikunja/vikunja/main/pkg/models/subscription.go
- https://raw.githubusercontent.com/go-vikunja/vikunja/main/pkg/models/notifications.go
- https://raw.githubusercontent.com/go-vikunja/vikunja/main/pkg/models/events.go
- https://raw.githubusercontent.com/go-vikunja/vikunja/main/pkg/models/api_tokens.go
- https://raw.githubusercontent.com/go-vikunja/vikunja/main/pkg/models/api_routes.go
- https://raw.githubusercontent.com/go-vikunja/vikunja/main/pkg/routes/routes.go
- https://raw.githubusercontent.com/go-vikunja/vikunja/main/pkg/routes/api/v1/link_sharing_auth.go
- https://raw.githubusercontent.com/go-vikunja/vikunja/main/pkg/caldav/parsing.go
- https://raw.githubusercontent.com/go-vikunja/vikunja/main/pkg/caldav/caldav.go
- https://raw.githubusercontent.com/go-vikunja/vikunja/main/frontend/src/modules/quickAddMagic/prefixes.ts
- https://raw.githubusercontent.com/go-vikunja/vikunja/main/frontend/src/modules/quickAddMagic/dateParser.ts
- https://raw.githubusercontent.com/go-vikunja/vikunja/main/frontend/src/components/misc/keyboard-shortcuts/shortcuts.ts
- https://api.github.com/repos/go-vikunja/vikunja/contents/pkg/models (directory listing)
- https://api.github.com/repos/go-vikunja/vikunja/contents/frontend/src/modules (directory listing)
- https://api.github.com/repos/go-vikunja/vikunja/contents/frontend/src/modules/quickAddMagic (directory listing)

**Issue trackers / community (for pain points)**
- https://api.github.com/search/issues?q=repo:go-vikunja/vikunja+is:issue+is:open+sort:reactions-desc
- https://api.github.com/search/issues?q=repo:go-vikunja/vikunja+is:issue+is:open+sort:comments-desc
- https://community.vikunja.io/t/moving-a-parent-project-deleted-a-child-project/1479
- https://community.vikunja.io/t/ui-hotkeys-shortcuts/1096
- https://community.vikunja.io/t/shortcut-for-quick-actions-inside-task/4033
- https://community.vikunja.io/t/keyboard-shortcut-next-previous-tasks-in-a-project/1971
- https://community.vikunja.io/t/search-new-task-should-use-default-or-currently-opened-project/3098
- https://community.vikunja.io/t/i-tried-vikunja-with-mcp-vs-code-copilot/3990
- https://www.alternativeto.net/software/vikunja/about/

**Third-party MCP servers**
- https://github.com/democratize-technology/vikunja-mcp
- https://github.com/lowlyocean/mcp-vikunja

**Other referenced (search results, not deep-fetched)**
- https://try.vikunja.io/api/v1/docs (public swagger UI)
- https://kolaente.dev/vikunja/vikunja/src/branch/main/CHANGELOG.md (legacy Gitea mirror)
