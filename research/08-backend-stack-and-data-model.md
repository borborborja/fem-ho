# Fem-ho — Backend Stack & Data Model Dossier

> **Delivery note.** This session ran under plan mode, which permits writing only to this
> plan file. The orchestrator requested
> `/private/tmp/claude-501/-Users-borja-Codi-fem-ho/4ee9f810-66f8-4e6f-86dc-06e906a11d09/scratchpad/research/08-backend-stack-and-data-model.md`.
> Copy this file there verbatim; the content below is the dossier.

Research date: 2026-08-05. Every version number below was read off a primary source
(pkg.go.dev, npmjs, official docs, RFC text) during this session unless explicitly marked
**UNVERIFIED**.

---

## 0. Executive decision summary

| Question | Decision | One-line reason |
|---|---|---|
| Language/runtime | **Go 1.22+**, single static binary | Only ecosystem with a maintained CalDAV **server** backend interface *and* a Tier‑1 MCP SDK *and* `CGO_ENABLED=0` single-file deploy |
| Credible alternative | **Node 22+/TypeScript on Fastify or Hono** | Shares types with the SPA, best MCP SDK; but you must hand-write the CalDAV server |
| HTTP layer | `net/http` std `ServeMux` (Go 1.22 method+wildcard patterns) or `chi` | No framework lock-in; CalDAV needs raw `PROPFIND`/`REPORT`/`MKCALENDAR` methods that most frameworks fight |
| Database | **SQLite** (WAL) as the only officially supported store for v1 | Self-hosters will not fight it; one file, one binary, Litestream for backup |
| Postgres | Optional, v2, behind a repository interface | Real cost, near-zero benefit at family scale |
| IDs | **UUIDv7 as TEXT(36)**, client-generatable | Offline-first Android can create rows offline; time-sortable so it doubles as a creation-order index |
| Timestamps | TEXT ISO-8601 UTC, `2006-01-02T15:04:05.000Z` | Lexicographic = chronological; readable in `sqlite3` shell and in backups |
| Kanban column | **Per-task field** `tasks.status`, not per-project bucket membership | Inbox column is shared across scope/project filters and across the Calendar view |
| Ordering | **Fractional indexing**, base62 `TEXT` rank | Drag-and-drop with no renumbering, conflict-tolerant for offline clients |
| Recurrence | **Hybrid**: RRULE stored + rolling materialisation horizon | Instances need their own state (assignee, comments, checked subtasks); calendar needs future occurrences |
| Delete | Soft delete (`deleted_at`) + append-only `change_log` | One table drives Android delta sync **and** the CalDAV `DAV:sync-token` |
| Search | SQLite FTS5, external content, `unicode61 remove_diacritics 2`, app-side Catalan normalisation | Handles `à é í ò ú ç`; `l·l` and elided `l'` need app-level folding, the tokenizer cannot do it |
| Attachments | Content-addressed filesystem (`sha256`), served through the app | No S3 dependency for self-hosters; dedup for free |
| Jobs | In-process scheduler + durable `jobs` table in the same SQLite file | Single binary means single leader; no Redis, no Postgres queue |

---

# PART 1 — STACK EVALUATION

## 1.1 The workload, stated precisely

Fem-ho's server must simultaneously be seven things:

1. **REST API** — JSON, token + session auth, multi-tenant by scope.
2. **CalDAV server** — must answer `OPTIONS`, `PROPFIND`, `REPORT` (`calendar-query`,
   `calendar-multiget`, `sync-collection`), `MKCALENDAR`, `PUT`, `GET`, `DELETE`, and
   serve `DAV:current-user-principal`, `CALDAV:calendar-home-set`,
   `CALDAV:supported-calendar-component-set` (must include `VTODO`), `DAV:getctag`,
   `DAV:sync-token`.
3. **CalDAV client** — poll external calendars, `PROPFIND` ctag, `REPORT sync-collection`,
   `PUT` local changes back.
4. **MCP server** — expose tasks/scopes/projects as MCP tools+resources, over Streamable
   HTTP (remote) and ideally stdio (local).
5. **Realtime push** — SSE or WebSocket to the web app; FCM/WebSocket to Android.
6. **Static web app** — serve the SPA bundle.
7. **Scheduler** — rollover, recurrence, polling, reminders, share expiry.

Plus a non-functional requirement that dominates everything: **an AI writes and maintains
this code**, and **self-hosters must be able to run it with one `docker compose up`.**

## 1.2 Axis 1 — CalDAV server libraries (the discriminator)

This is the axis that actually decides the stack, because writing a spec-correct WebDAV
XML engine from scratch is a multi-week job with a long tail of client-compatibility bugs
(DAVx⁵, Tasks.org, Apple Reminders, Thunderbird each probe differently).

### Go — `github.com/emersion/go-webdav` v0.7.0 (released 2024-10-18)

The only library in any of the candidate ecosystems that ships a **server-side CalDAV
`Backend` interface** you implement against your own database. Exact interface as
published on pkg.go.dev:

```go
// github.com/emersion/go-webdav/caldav v0.7.0
type Backend interface {
	CalendarHomeSetPath(ctx context.Context) (string, error)
	CreateCalendar(ctx context.Context, calendar *Calendar) error
	ListCalendars(ctx context.Context) ([]Calendar, error)
	GetCalendar(ctx context.Context, path string) (*Calendar, error)
	GetCalendarObject(ctx context.Context, path string, req *CalendarCompRequest) (*CalendarObject, error)
	ListCalendarObjects(ctx context.Context, path string, req *CalendarCompRequest) ([]CalendarObject, error)
	QueryCalendarObjects(ctx context.Context, path string, query *CalendarQuery) ([]CalendarObject, error)
	PutCalendarObject(ctx context.Context, path string, calendar *ical.Calendar, opts *PutCalendarObjectOptions) (*CalendarObject, error)
	DeleteCalendarObject(ctx context.Context, path string) error
	webdav.UserPrincipalBackend
}

type Calendar struct {
	Path                  string
	Name                  string
	Description           string
	MaxResourceSize       int64
	SupportedComponentSet []string   // set to []string{"VTODO", "VEVENT"}
}

type CalendarObject struct {
	Path          string
	ModTime       time.Time
	ContentLength int64
	ETag          string
	Data          *ical.Calendar
}

type PutCalendarObjectOptions struct {
	IfNoneMatch webdav.ConditionalMatch // client refuses to overwrite
	IfMatch     webdav.ConditionalMatch // optimistic concurrency, may be ""
}

type Handler struct {
	Backend Backend
	Prefix  string
}
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request)
```

Query filtering types you get for free (`CompFilter`, `PropFilter`, `ParamFilter`,
`TextMatch`), plus helpers:

```go
func Match(query CompFilter, co *CalendarObject) (matched bool, err error)
func Filter(query *CalendarQuery, cos []CalendarObject) ([]CalendarObject, error)
func ValidateCalendarObject(cal *ical.Calendar) (eventType string, uid string, err error)
func NewCalendarHomeSet(path string) webdav.BackendSuppliedHomeSet
func NewPreconditionError(err PreconditionType) error
func DiscoverContextURL(ctx context.Context, domain string) (string, error) // RFC 6764 SRV
```

**Gap you must fill yourself:** the v0.7.0 `caldav` package exposes **no `SyncQuery` /
`SyncResponse` server types**. Release notes show `sync-collection for client` landed in
v0.3.1 — i.e. the *client* side. So the `DAV:sync-collection` **REPORT** on the server
side is on you: intercept `REPORT` before handing off to `caldav.Handler`, parse the body,
answer from `change_log` (§4.6, §7.3). This is ~200 lines and is the single largest
CalDAV-server task in the project. Budget for it explicitly.

The same module gives you the **client**:

```go
func NewClient(c webdav.HTTPClient, endpoint string) (*Client, error)
func (c *Client) FindCalendarHomeSet(ctx context.Context, principal string) (string, error)
func (c *Client) FindCalendars(ctx context.Context, calendarHomeSet string) ([]Calendar, error)
func (c *Client) MultiGetCalendar(ctx context.Context, path string, multiGet *CalendarMultiGet) ([]CalendarObject, error)
func (c *Client) QueryCalendar(ctx context.Context, calendar string, query *CalendarQuery) ([]CalendarObject, error)
func (c *Client) PutCalendarObject(ctx context.Context, path string, cal *ical.Calendar) (*CalendarObject, error)
```

One library, both directions. That is the whole argument.

### Go — `github.com/emersion/go-ical` (pseudo-version `v0.0.0-20250609112844-439c63cef608`, 2025-06-09)

RFC 5545 encoder/decoder. Types and constants read off pkg.go.dev:

```go
type Calendar struct{ *Component }
type Component struct {
	Name     string
	Props    Props
	Children []*Component
}
type Prop struct {
	Name   string
	Params Params
	Value  string
}
type Props  map[string][]Prop
type Params map[string][]string

const (
	CompCalendar = "VCALENDAR"; CompEvent = "VEVENT"; CompToDo = "VTODO"
	CompJournal  = "VJOURNAL";  CompFreeBusy = "VFREEBUSY"
	CompTimezone = "VTIMEZONE"; CompAlarm = "VALARM"
)
const (
	PropUID = "UID"; PropSummary = "SUMMARY"; PropStatus = "STATUS"
	PropDateTimeStart = "DTSTART"; PropDateTimeEnd = "DTEND"; PropDuration = "DURATION"
	PropRecurrenceRule = "RRULE"; PropExceptionDates = "EXDATE"; PropRecurrenceDates = "RDATE"
	PropVersion = "VERSION"; PropProductID = "PRODID"
)
const (MIMEType = "text/calendar"; Extension = "ics")

func (props Props) RecurrenceRule() (*rrule.ROption, error)
func (props Props) SetRecurrenceRule(rule *rrule.ROption)
func (comp *Component) RecurrenceSet(loc *time.Location) (*rrule.Set, error)
```

Note: `go-ical` already depends on `teambition/rrule-go` — the recurrence library is
already in your tree.

**Caveat:** `go-ical` exposes `Calendar.Events()` and a typed `Event` wrapper, but no
typed `Todo` wrapper. `VTODO` handling is `Component`/`Props` level. Write a small
`internal/ical/vtodo.go` adapter. This is trivially AI-writable.

### Node/TypeScript

There is **no maintained CalDAV server library**. Confirmed state of the art:

- `jsDAV` — a port of SabreDAV to Node; unmaintained; forum evidence that CalDAV support
  is incomplete/untested.
- `jsDAVlib` — explicitly "read-only vision of the server".
- `simple-caldav` — a **client**, and a thin one.
- `tsdav` — a **client** (widely used, but client only). *(Not independently fetched this
  session — **UNVERIFIED** as to its current version.)*

So on Node you own `PROPFIND` namespace handling, `REPORT` dispatch, multistatus
serialisation, `Depth` semantics, ETag/precondition handling, and every DAVx⁵ quirk.
Estimate 2–4× the CalDAV effort of Go. That is the decisive mark against Node.

### Python

Excellent **client** ecosystem — `caldav` 3.2.x (`caldav.get_davclient()` is the
recommended entry point since 2.0; `icalendar` is now the internal iCal library),
`icalendar`, and `python-recurring-ical-events` for expansion. The **server** story is
Radicale 3.x — a complete application with a plugin system (`storage`, `auth`, `rights`
plugins; DjRadicale proves a DB-backed storage plugin is feasible). But Radicale is an app
you'd embed and fight, not a library you'd call. Plus a Python deploy is a venv or a
300 MB image, not a binary.

### Rust

`lennart-k/rustical` proves a modern Rust CalDAV/CardDAV server on SQLite is viable (it
stores everything in one SQLite database, supports Apple configuration profiles, partial
RFC 7809). But it is an **application**, not a reusable crate you can point at your own
schema. You'd be reading its source for reference, not depending on it. MCP Rust SDK is
**Tier 2** on the official tiering table.

### Elixir

No CalDAV server library of note. No official MCP SDK (not on the official SDK table at
all). BEAM releases are a directory tree, not a single binary. Phoenix Channels would be
lovely for realtime, and that is the entire upside.

### Verdict on axis 1

**Go wins outright.** Nothing else is close.

## 1.3 Axis 2 — MCP SDK maturity

From the official MCP SDK table (spec revision `2026-07-28`):

| Language | Package / repo | Tier |
|---|---|---|
| TypeScript | `modelcontextprotocol/typescript-sdk` (`@modelcontextprotocol/sdk`, **1.30.0** on npm; a **v2** line exists for the 2026‑07‑28 spec, described as the stable line released alongside that spec) | **Tier 1** |
| Python | `modelcontextprotocol/python-sdk` | **Tier 1** |
| C# | `modelcontextprotocol/csharp-sdk` | **Tier 1** |
| **Go** | `modelcontextprotocol/go-sdk` (maintained with Google) — releases page showed **v1.4.1** stable and **v1.5.0-pre.1**; repo README references **v1.7.0+** for the 2026‑07‑28 spec | **Tier 1** |
| Java | `modelcontextprotocol/java-sdk` | Tier 2 |
| Rust | `modelcontextprotocol/rust-sdk` | Tier 2 |
| Ruby | `modelcontextprotocol/ruby-sdk` | Tier 2 |
| Swift / PHP / Kotlin | — | Tier 3 |
| **Elixir** | **absent from the official table** | — |

> ⚠️ The Go SDK version is the one fact I could not pin to a single number: the releases
> page and the README disagreed (v1.4.1 / v1.5.0-pre.1 vs "v1.7.0+"). **Pin with
> `go get github.com/modelcontextprotocol/go-sdk@latest` and record what you get.** Marked
> **UNVERIFIED** as to the exact current tag.

Minimal Go MCP server, from the official README:

```go
server := mcp.NewServer(&mcp.Implementation{Name: "femho", Version: "v1.0.0"}, nil)
mcp.AddTool(server, &mcp.Tool{Name: "greet", Description: "say hi"}, SayHi)
if err := server.Run(context.Background(), &mcp.StdioTransport{}); err != nil {
	log.Fatal(err)
}
```

The README content I fetched showed `mcp.StdioTransport{}` and `mcp.CommandTransport`
explicitly; the Streamable HTTP server transport exists in the SDK but was not visible in
the fetched excerpt — **UNVERIFIED as to its exact type name.** The SDK module set
includes `mcp`, a `jsonrpc` package, and OAuth packages.

Go and TypeScript tie on this axis (both Tier 1). Python ties too. Rust and Elixir lose.

## 1.4 Axis 3 — deployment simplicity for self-hosters

| Stack | Artifact | Image floor | Runtime deps | Cross-compile |
|---|---|---|---|---|
| **Go + `modernc.org/sqlite`** | one static binary, SPA embedded via `//go:embed` | `FROM scratch` / distroless, ~25–45 MB | none | `GOOS=linux GOARCH=arm64 go build` — works for a Raspberry Pi with zero toolchain |
| Go + `mattn/go-sqlite3` | binary, but CGO | ~60 MB alpine | libc | needs a C cross toolchain |
| Node/TS | `dist/` + `node_modules` (or a bundle) | ~150–250 MB | Node runtime | fine, but native deps (`better-sqlite3`) need prebuilds per arch |
| Python | venv | ~200–350 MB | CPython + wheels | manylinux/musllinux wheel roulette on arm |
| Rust | one static binary | ~20 MB | none | needs `cross`/musl target setup |
| Elixir | release directory | ~80–120 MB | ERTS bundled | painful for arm |

`modernc.org/sqlite` **v1.56.0** (2026-08-03) embeds **SQLite 3.53.3** and supports
darwin `amd64/arm64`, freebsd `amd64/arm64`, linux `386/amd64/arm/arm64/loong64/ppc64le/riscv64/s390x`,
openbsd `amd64/arm64`, windows `386/amd64/arm64`. Driver name is `"sqlite"` (mattn's is
`"sqlite3"` — the *only* code difference is the import path and that string).

`riscv64` and `loong64` in that list matter more than they look: self-hosters run this on
odd SBCs.

**Go wins this axis too**, with Rust second.

## 1.5 Axis 4 — "an AI will write and maintain this code"

Ranked, with the reasoning written out rather than asserted:

1. **Go.** Tiny language surface (no generics gymnastics needed here, no macros, no
   decorators, no metaclasses). Explicit `if err != nil` means an AI cannot silently drop
   an error path. `go vet`, `go build`, `staticcheck` and `go test ./...` all run in
   seconds and give machine-checkable feedback loops — the single most important property
   for autonomous iteration. Standard library covers HTTP, TLS, crypto, time zones,
   templating, embedding. Enormous public training corpus. Refactors are mechanical.
2. **TypeScript.** Also huge corpus, excellent type feedback, and you get **one language
   for SPA + server + shared DTOs**, which halves the "keep the API contract in sync"
   surface. Against it: `tsconfig`/ESM/bundler/`node_modules` yak-shaving is exactly the
   category of failure an AI handles worst, and the type system is expressive enough that
   an AI can write clever code you later cannot debug.
3. **Python.** Great corpus; but dynamic typing means whole classes of bugs escape to
   runtime, and there is no fast, total, machine-checkable compile step.
4. **Rust.** The borrow checker is a superb correctness oracle but a slow one; AI
   iteration cycles on lifetime/`async` errors are long and occasionally non-convergent.
   For a CRUD-and-XML app the safety upside is small.
5. **Elixir.** Smallest corpus, OTP supervision-tree design is idiomatic-or-wrong, and
   there is no MCP SDK.

## 1.6 THE RECOMMENDATION

### Primary: Go

```
go 1.22+  (std ServeMux method+wildcard routing: mux.HandleFunc("GET /api/v1/tasks/{id}", h))

DB      modernc.org/sqlite v1.56.0            // pure Go, SQLite 3.53.3, CGO_ENABLED=0
Queries github.com/jmoiron/sqlx  OR  sqlc     // sqlc generates typed structs from SQL
Migrate github.com/pressly/goose/v3           // embed.FS support, dialect "sqlite3"/"postgres"
CalDAV  github.com/emersion/go-webdav v0.7.0  // caldav server Backend + client
iCal    github.com/emersion/go-ical           // v0.0.0-20250609112844-439c63cef608
RRULE   github.com/teambition/rrule-go v1.8.2
MCP     github.com/modelcontextprotocol/go-sdk/mcp   // Tier 1, pin at install time
Order   github.com/rocicorp/fracdex           // fractional indexing, Go port
Router  net/http std (or github.com/go-chi/chi/v5 if you want middleware chains)
WS      github.com/coder/websocket            // only if you need bidirectional; prefer SSE
Cron    github.com/go-co-op/gocron            // or a hand-rolled ticker; see §8
Argon2  golang.org/x/crypto/argon2            // IDKey = Argon2id
SPA     //go:embed web/dist  +  http.FS
```

Single `main` package wiring, one binary, one SQLite file, one Dockerfile:

```dockerfile
FROM golang:1.24-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/femho ./cmd/femho

FROM gcr.io/distroless/static-debian12
COPY --from=build /out/femho /femho
VOLUME /data
ENV FEMHO_DB=/data/femho.db FEMHO_FILES=/data/files
EXPOSE 8080
ENTRYPOINT ["/femho"]
```

> `golang:1.24-alpine` is a placeholder — use whatever the current stable Go image is at
> build time. **UNVERIFIED** as a specific tag.

### Credible alternative: Node 22+ / TypeScript

- **Runtime:** Fastify (mature plugin/hook model, best-in-class JSON serialisation) or
  Hono (tiny, Web-standard `Request`/`Response`, trivially portable). Prefer **Fastify**
  because CalDAV needs raw method routing and streaming request bodies, and Fastify's
  `addHttpMethod`/`onRequest` hooks handle custom verbs cleanly. **NestJS is the wrong
  choice here** — its decorator/DI layer adds ceremony an AI must re-derive on every edit,
  and its routing abstracts away exactly the HTTP-verb control CalDAV needs.
- **DB:** `better-sqlite3` (synchronous, fastest) or `node:sqlite` (built-in, no native
  build) + **Drizzle ORM** or **Kysely** for typed SQL, `drizzle-kit` for migrations.
- **MCP:** `@modelcontextprotocol/sdk` **1.30.0** (or the v2 line for the 2026-07-28
  spec) — the best MCP SDK in any language.
- **iCal:** `ical.js` (Mozilla's, powers Thunderbird) for parse/serialise, `rrule` (npm)
  for recurrence.
- **The cost:** you write the CalDAV server yourself.

**Choose Node only if** the team's real constraint is "one language across Android-web-
server" or "the SPA and server must share generated types". Otherwise Go.

### Deciding factors, written out

1. **CalDAV server library existence.** Go: yes (`go-webdav` v0.7.0 `caldav.Backend`).
   Everyone else: no. This is worth weeks.
2. **CalDAV client in the same library.** Go: yes. Avoids two different iCal object models
   in one process — which is exactly where round-trip data loss bugs breed.
3. **MCP Tier 1.** Go, TS, Python, C#. Rust/Elixir out.
4. **Single artifact for self-hosters.** Go and Rust only.
5. **Pure-Go SQLite.** `modernc.org/sqlite` removes the CGO cross-compile tax that would
   otherwise cancel factor 4.
6. **AI-maintainability with a fast total type/vet/test loop.** Go first, TS second.
7. **Non-factor: raw throughput.** A household of 5 with 20k tasks. Every candidate is
   1000× fast enough. Do not let benchmarks into this decision.

---

# PART 2 — DATABASE

## 2.1 SQLite vs PostgreSQL for Fem-ho

### The case for SQLite as the default

- **Self-hoster ergonomics.** One `docker-compose.yml` service, one volume. No
  `POSTGRES_PASSWORD`, no `depends_on` + healthcheck race, no `pg_upgrade` on major
  version bumps (the #1 self-hosted-app support burden in the wild).
- **Backup is `cp` (almost).** `VACUUM INTO '/backup/femho-2026-08-05.db'` produces a
  consistent single-file backup with no downtime. Add Litestream for point-in-time.
- **Scale is trivially sufficient.** Family of 5, ~50k tasks lifetime, ~10 writes/minute
  peak. SQLite handles 4–5 orders of magnitude more than this.
- **Tests are instant.** `:memory:` DB per test.
- **Android parity.** The Android offline-first store is SQLite too — same SQL dialect,
  same date handling, same FTS5 tokenizer. You can literally share migration SQL for the
  overlapping tables. This is a real, underrated win.

### WAL mode — exact semantics you must design around

From `sqlite.org/wal.html`:

- Readers do not block the writer; the writer does not block readers. **Exactly one writer
  at a time.**
- `PRAGMA journal_mode=WAL` is **persistent** across close/reopen (unlike `TRUNCATE` etc.).
  The file format version goes 1 → 2; SQLite < 3.7.0 cannot read it.
- `-wal` and `-shm` files must travel with the DB. Separating them "can cause data loss or
  corruption". `-shm` is a memory-mapped wal-index.
- **`wal_autocheckpoint` default is 1000 pages (~4 MB)**; a `COMMIT` that pushes the WAL to
  ≥1000 pages triggers a checkpoint.
- `PRAGMA synchronous=NORMAL` in WAL mode: writers **omit `fsync()` on each commit**; only
  checkpoints fsync. Trade-off: "transactions may be lost following power failure or hard
  reboot" — but the DB is never *corrupted*. This is the right setting for a task app.
- **WAL does not work over network filesystems** — the wal-index needs shared memory, which
  NFS/SMB cannot provide. **Document loudly**: the Docker volume for `femho.db` must be
  local disk, not an NFS/CIFS mount. This is the single most common self-hoster
  data-corruption report for SQLite apps.
- Since SQLite 3.22.0 a read-only WAL DB can be opened if `-shm`/`-wal` exist and are
  readable, or the directory is writable, or `?immutable` is used.

### Connection setup (Go, exact)

```go
const writeDSN = "file:/data/femho.db?" +
	"_pragma=journal_mode(WAL)" +
	"&_pragma=busy_timeout(5000)" +
	"&_pragma=synchronous(NORMAL)" +
	"&_pragma=foreign_keys(1)" +
	"&_pragma=temp_store(MEMORY)" +
	"&_pragma=cache_size(-65536)" +   // 64 MiB page cache
	"&_pragma=mmap_size(268435456)" + // 256 MiB
	"&_txlock=immediate"              // BEGIN IMMEDIATE: fail fast, no upgrade deadlock

// TWO pools. This is the pattern that eliminates SQLITE_BUSY.
writeDB, _ := sql.Open("sqlite", writeDSN)
writeDB.SetMaxOpenConns(1)          // serialise writers in Go, not in SQLite
writeDB.SetMaxIdleConns(1)
writeDB.SetConnMaxLifetime(0)

readDB, _ := sql.Open("sqlite", strings.Replace(writeDSN, "_txlock=immediate", "mode=ro", 1))
readDB.SetMaxOpenConns(max(4, runtime.NumCPU()))
```

Why `_txlock=immediate`: without it, a transaction that starts read-only and later writes
must upgrade the lock, and if another writer got there first SQLite returns
`SQLITE_BUSY_SNAPSHOT` **which `busy_timeout` does not retry**. `BEGIN IMMEDIATE` takes
the write lock up front, so `busy_timeout` works. Litestream's own tips page independently
recommends setting `busy_timeout` (5 s) and enabling `foreign_keys` per connection, since
FKs are off by default.

### Litestream (v0.5.x) — backup config

Litestream "only works with the SQLite WAL journaling mode" and will set WAL automatically.
Replication is **asynchronous** — "changes are replicated out-of-band from the transaction",
default every second, so there is a ~1 s data-loss window. Two apps replicating into the
same bucket+path can make restore impossible.

```yaml
# /etc/litestream.yml
access-key-id: ${AWS_ACCESS_KEY_ID}
secret-access-key: ${AWS_SECRET_ACCESS_KEY}
addr: ":9090"                 # Prometheus metrics

logging:
  level: info
  type: text

snapshot:
  interval: 24h
  retention: 24h

levels:
  - interval: 30s
  - interval: 5m
  - interval: 1h

validation:
  interval: 5m

dbs:
  - path: /data/femho.db
    monitor-interval: 1s        # change detection, default 1s
    checkpoint-interval: 1m     # default 1m
    restore-if-db-not-exists: true
    replica:
      type: s3
      bucket: femho-backups
      path: femho
      region: eu-west-3
      sync-interval: 1s

  # A second, zero-dependency option every self-hoster can use:
  # replica:
  #   type: file
  #   path: /backup/femho
```

Supported replica backends include S3, GCS, Azure Blob, Backblaze B2, DigitalOcean Spaces,
Scaleway, Linode, Tigris, Supabase Storage, Alibaba OSS, **SFTP**, **local file paths**,
**NATS JetStream**, and **WebDAV** — the file and SFTP and WebDAV options mean a
self-hoster with no cloud account can still have off-box backups.

CLI: `litestream replicate`, `restore`, `sync`, `status`, `list`, `info`. To delete a DB
you must remove `.db`, `.db-shm`, `.db-wal` and then run `litestream reset`.

If you disable autocheckpointing under heavy write load (`PRAGMA wal_autocheckpoint=0`),
Litestream v0.5.0+ has improved checkpoint detection so full snapshots are needed less
often. For Fem-ho's write volume, leave autocheckpoint at the default.

**Ship both**: Litestream as an optional sidecar/`s6` process, plus a built-in nightly
`VACUUM INTO /data/backups/femho-YYYY-MM-DD.db` with N-day retention, so the zero-config
user still has backups.

### When PostgreSQL genuinely wins

- More than ~10 concurrent writers, or write bursts that exceed the single-writer lock.
- You want the DB on a different host / already run a Postgres for other services.
- You want `LISTEN/NOTIFY` to fan out realtime events across multiple app replicas.
- Richer FTS (stemming via `catalan_stem`, weighted `tsvector`, `ts_headline`).

None of these apply to a household task manager. **Default SQLite.**

### How to support both, if you must

Do it with discipline, not an ORM:

1. **Repository interface.** `internal/store` defines `type Store interface { ... }` with
   ~60 methods. `internal/store/sqlite` and `internal/store/postgres` implement it. No SQL
   escapes the package.
2. **Two migration directories.** goose supports this cleanly:
   `migrations/sqlite/*.sql` and `migrations/postgres/*.sql`, selected by
   `goose.SetDialect("sqlite3"|"postgres")` + `goose.SetBaseFS(embedFS)` +
   `goose.Up(db, "migrations/"+dialect)`.
3. **Dialect deltas to plan for** (these are the ones that actually bite):

| Concern | SQLite | Postgres |
|---|---|---|
| ID column | `TEXT NOT NULL PRIMARY KEY` | `uuid` (or `text`, keep it `text` for parity) |
| Timestamps | `TEXT` ISO-8601 UTC | `timestamptz` |
| Dates | `TEXT` `'YYYY-MM-DD'` | `date` |
| Booleans | `INTEGER` 0/1 | `boolean` |
| JSON | `TEXT` + `json_*()` functions | `jsonb` |
| Autoinc seq | `INTEGER PRIMARY KEY AUTOINCREMENT` | `bigserial` / `GENERATED ALWAYS AS IDENTITY` |
| Upsert | `ON CONFLICT(col) DO UPDATE` | same (PG 9.5+) — portable |
| FTS | `fts5` virtual table + triggers | generated `tsvector` + GIN |
| Case-insensitive email | store `email_normalized` lowercased | same (do **not** rely on `citext`/collation) |
| Partial index | supported | supported — portable |
| `RETURNING` | supported (3.35+) | supported — portable |

4. **Never rely on collation for correctness.** Store an explicit normalised column
   (`email_normalized`, `search_text`) and index that. This makes SQLite and Postgres agree
   and makes the Catalan folding rules (§9) explicit and testable.

**Recommendation: build the interface from day one (it costs ~nothing), implement SQLite
only, and ship Postgres in v2 if a user actually asks.** Advertise SQLite as *the*
supported store so nobody feels they picked the second-class option.

## 2.2 Migration tooling per stack

| Stack | Tool | Notes |
|---|---|---|
| **Go (recommended)** | `github.com/pressly/goose/v3` | CLI + library. Supports Postgres, MySQL, MariaDB, SQLite, ClickHouse, MSSQL, Spanner, YDB, Vertica. Embeds via `embed.FS`. Supports Go-function migrations for data backfills. |
| Go (alt) | `golang-migrate/migrate` | Simpler, up/down file pairs, no Go migrations. |
| Go (schema-as-desired-state) | Atlas (`ariga.io/atlas`) | Declarative schema + diffing; heavier; useful if you want a single `schema.hcl`. **UNVERIFIED** current version. |
| Node/TS | `drizzle-kit generate` / `migrate` | Schema-first TS, generates SQL. |
| Node/TS (alt) | Kysely + `kysely-ctl` | Hand-written SQL migrations, typed queries. |
| Python | Alembic | Autogenerate from SQLAlchemy models. |
| Rust | `sqlx migrate` (`sqlx::migrate!()` embeds at compile time) or `refinery` | |
| Elixir | Ecto migrations | |

goose embedded pattern (copy-adaptable):

```go
//go:embed migrations/sqlite/*.sql
var embedMigrations embed.FS

func Migrate(db *sql.DB) error {
	goose.SetBaseFS(embedMigrations)
	if err := goose.SetDialect("sqlite3"); err != nil {
		return err
	}
	return goose.Up(db, "migrations/sqlite")
}
```

Migration file shape:

```sql
-- +goose Up
-- +goose StatementBegin
CREATE TABLE tasks ( ... );
-- +goose StatementEnd

-- +goose Down
DROP TABLE tasks;
```

**Rules for an AI maintaining migrations:**
- Migrations are **append-only and immutable once released**. Never edit a shipped file.
- SQLite `ALTER TABLE` supports `ADD COLUMN`, `RENAME COLUMN`, `RENAME TO`, `DROP COLUMN`
  (3.35+) — but **not** changing a column type or adding a constraint. For those, use the
  12-step table rebuild (`PRAGMA foreign_keys=off; CREATE new; INSERT SELECT; DROP old;
  ALTER RENAME; PRAGMA foreign_key_check; PRAGMA foreign_keys=on;`) inside one transaction.
- Every migration must run inside a transaction, and goose must be run **before** the HTTP
  server binds.
- Add `PRAGMA user_version` sanity assertions in tests.

---

# PART 3 — THE HARD MODELLING DECISIONS

These are the decisions where a wrong choice is expensive to reverse. Each one gets:
options, the failure mode of each, and a recommendation.

## 3.1 Kanban column vs due date vs per-project boards

**The question:** is `Inbox / Per fer / Fent / Fet` a **per-task field** or a **membership
row in a per-project bucket table**?

**Option A — per-task enum field.**
```sql
status TEXT NOT NULL DEFAULT 'inbox'
    CHECK (status IN ('inbox','todo','doing','done'))
```

**Option B — buckets table** (Vikunja/Trello style):
```sql
buckets(id, project_id, title, position, is_done_bucket)
task_buckets(task_id, bucket_id)   -- or tasks.bucket_id
```

**Decide from the product spec, not from taste.** Fem-ho's spec says:

- The top bar has **multi-select scope chips** and a project dropdown. So a board can show
  tasks from *many scopes at once*, and from *no particular project*.
- Each scope has "a general space plus PROJECTS" — tasks can exist with `project_id IS NULL`.
- The **Calendar view has a dynamic Inbox side column shared with the tasks view**. The
  Inbox therefore exists outside any project.
- The four columns are **fixed and named in the product**, not user-configurable.

Under Option B, a task with `project_id IS NULL` has no bucket to belong to, and a
multi-scope board would have to union buckets from N projects and then decide which of the
N "To do" buckets a cross-project card lives in. That is incoherent.

### ✅ RECOMMENDATION: Option A — `tasks.status` is a per-task field.

Consequences to implement deliberately:

1. **Moving a card in *any* board changes the same global field.** If you drag a task from
   "Per fer" to "Fent" while filtered to `#Família`, it is "Fent" everywhere. This is
   correct and is what a household expects ("is anyone doing this?" is a global question).
2. **Ordering is also global per status** (see §3.4). A drag in a filtered board reorders
   the task among *all* tasks in that status; the filter merely hides the neighbours.
   Document this; it is the only mildly surprising consequence and it is far less
   surprising than per-view rank tables.
3. **Due date is fully orthogonal.** A task can be `status='inbox'` and have
   `due_date='2026-08-07'`. The Calendar view queries by date; the Tasks view queries by
   status. Never derive one from the other.
4. **Keep `status_changed_at`** so "how long has this been in Fent?" is answerable and so
   the Done-column-clears-daily rule (§3.3) has a timestamp that is not `updated_at`.
5. **If you later want per-project custom columns**, add a nullable
   `tasks.project_column_id` alongside `status` — an *additional* axis, never a
   replacement. Do not design for this now.
6. **CalDAV mapping** (RFC 5545 §3.8.1.11 `STATUS` for `VTODO` allows exactly
   `NEEDS-ACTION` / `COMPLETED` / `IN-PROCESS` / `CANCELLED`):

| Fem-ho `status` | `VTODO` `STATUS` | Round-trip note |
|---|---|---|
| `inbox` | `NEEDS-ACTION` + `X-FEMHO-STATUS:inbox` | inbound `NEEDS-ACTION` with no X-prop → `todo` |
| `todo` | `NEEDS-ACTION` | |
| `doing` | `IN-PROCESS` | |
| `done` | `COMPLETED` (+ `COMPLETED:<utc>` , `PERCENT-COMPLETE:100`) | |
| (soft-deleted) | `CANCELLED` | only emitted for tombstone window |

  The `X-FEMHO-STATUS` X-property is how you keep `inbox` distinguishable from `todo`
  across a round-trip through DAVx⁵/Tasks.org, which only know the four RFC values.

## 3.2 A task that *is* a list vs a task that *has* lists

Fem-ho spec: "simple task lists (checklists) attached to tasks/subtasks, pinnable" and
"public share links for a task-with-subtasks **or** a checklist". So both readings are
real, and they are different objects.

**Reading 1 — "a task HAS subtasks."** Subtasks are full tasks: own due date, own
assignee, own kanban status, can appear on the calendar, can be shared. Model: self-FK
`tasks.parent_task_id`.

**Reading 2 — "a task HAS checklists."** A checklist is a lightweight ordered list of
title+checked lines. No dates, no kanban column, not on the calendar. Model:
`checklists` + `checklist_items`.

### Three candidate models

**(a) Unify everything into `tasks`.** A checklist is `tasks.kind='checklist'`, its items
are child tasks. *Pro:* one table, sharing/ordering/labels/permissions all free. *Con:*
your kanban and calendar queries must filter out thousands of checklist-item rows
everywhere (`AND kind='task'`), `tasks` grows 10× and every index with it, and the API/MCP
schema for "task" becomes mushy — an AI agent calling `list_tasks` gets shopping-list
lines. **This is the trap.** It looks elegant and it degrades every query and every tool
description.

**(b) Fully separate, no relationship.** Checklists live only under a scope/project.
*Con:* violates "attached to tasks/subtasks".

**(c) Two tables, one attachment rule.** `tasks` (self-FK for real subtasks) and
`checklists` (nullable `task_id`, nullable `scope_id`/`project_id`) + `checklist_items`.

### ✅ RECOMMENDATION: (c), plus a purely presentational flag.

```sql
tasks.view_mode TEXT NOT NULL DEFAULT 'task'
    CHECK (view_mode IN ('task','checklist'))
```

`view_mode='checklist'` means "render this task as its (single) attached checklist,
collapsed chrome". It changes **nothing** in storage or permissions — it is a UI hint.
That gives you "this task *is* a list" as a first-class user experience without polluting
the data model.

Attachment rule, enforced by CHECK:

```sql
-- a checklist is attached to exactly one of: a task, a project, a scope
CHECK (
  (task_id IS NOT NULL AND project_id IS NULL AND scope_id IS NULL) OR
  (task_id IS NULL AND project_id IS NOT NULL AND scope_id IS NULL) OR
  (task_id IS NULL AND project_id IS NULL AND scope_id IS NOT NULL)
)
```

Because subtasks are rows in `tasks`, "attached to a subtask" needs no extra machinery.

**Promotion path.** Users will want "turn this checklist item into a real task."
Implement `POST /checklist-items/{id}/promote` → creates a `tasks` row with
`parent_task_id = checklist.task_id`, sets `checklist_items.promoted_task_id`, and marks
the item `converted_at`. Keep the item row (do not delete) so the checklist's history and
any share link stay coherent.

**Interop mapping.** Checklist items are **not** exported as separate `VTODO`s (that would
flood a user's Tasks.org with 400 line items). Instead serialise them into the parent
`VTODO`'s `DESCRIPTION` inside a fenced marker so the round trip is lossless-ish:

```
DESCRIPTION:Comprar per la festa\n\n[femho:checklist:0192f3...]\n- [x] Pa\n- [ ] Formatge\n- [ ] Vi\n[/femho:checklist]
```

On inbound `PUT`, parse the fence back; text outside the fence is the description. If the
fence is absent on a task that had one, treat it as "external client rewrote the
description" and **do not delete the checklist** — log a conflict in `activity_log`. Also
emit `X-FEMHO-CHECKLIST-COUNT` / `X-FEMHO-CHECKLIST-DONE` so clients that show only
`SUMMARY` still convey progress.

Real subtasks *are* exported as separate `VTODO`s linked with
`RELATED-TO;RELTYPE=PARENT:<parent-uid>` (Vikunja does exactly this and it works in
Tasks.org/OpenTasks).

## 3.3 "The Done column clears daily" — without losing history

**The requirement decomposed:**
- The `Fet` column shows only what was finished "today".
- Nothing is deleted; `Fet` history is queryable forever.
- "Show me everything done today" must be exactly right, per user, across DST.

**Option A — a nightly job that moves done tasks to `archived`.** Requires a job to be
correct, breaks for users in other timezones, and the boundary is whenever the job ran.
Fragile.

**Option B — a `board_cleared_at` flag set nightly.** Same problems, plus a column that
means nothing outside the board.

**Option C — no state at all; the column is a *query*.**

### ✅ RECOMMENDATION: Option C.

Store:
```sql
completed_at   TEXT,     -- ISO-8601 UTC instant, NULL unless status='done'
completed_tz   TEXT,     -- IANA tz of the actor at completion, e.g. 'Europe/Madrid'
completed_by   TEXT,     -- user id (or the AI user id)
```

The Done column is:
```sql
SELECT * FROM tasks
WHERE deleted_at IS NULL
  AND status = 'done'
  AND completed_at >= :day_start_utc
  AND completed_at <  :day_end_utc
ORDER BY completed_at DESC;
```

where `:day_start_utc` / `:day_end_utc` are computed **in the viewer's timezone** in Go:

```go
func LocalDayBounds(tz *time.Location, d time.Time) (startUTC, endUTC time.Time) {
	y, m, day := d.In(tz).Date()
	start := time.Date(y, m, day, 0, 0, 0, 0, tz)
	// NOT start.Add(24*time.Hour) — that is wrong on DST days (23h or 25h).
	end := time.Date(y, m, day+1, 0, 0, 0, 0, tz)
	return start.UTC(), end.UTC()
}
```

`time.Date` normalises out-of-range day values and resolves the wall clock through the
zone's DST rules, so `day+1` is correct on 23-hour and 25-hour days. `Add(24*time.Hour)`
is **not**. This single function is the DST-correctness linchpin of the whole app; unit
test it against `Europe/Madrid` on the last Sunday of March and October.

**Why this beats a job:** the column empties itself at each viewer's local midnight, with
zero moving parts, and two family members in different timezones each see their own
"today". No backfill, no clock skew, no missed cron.

**Why keep `completed_tz` if the query uses the viewer's tz?** For reporting ("what did
Marta do on her Tuesday?") and for correct `COMPLETED` serialisation in CalDAV. Cheap
insurance; never used in the hot query.

**Still add a nightly job**, but only for these, none of which affect correctness:
- write one `activity_log` row of kind `day_rollover` per scope (gives the UI a "yesterday"
  divider and gives users a sense the app is alive);
- set `archived_at` on tasks `status='done' AND completed_at < now-90d` so the default
  board query can add `AND archived_at IS NULL` and stay on a small index;
- `INSERT INTO tasks_fts(tasks_fts) VALUES('optimize')`.

**Index that makes it fast:**
```sql
CREATE INDEX idx_tasks_done_recent ON tasks(completed_at DESC)
  WHERE status='done' AND deleted_at IS NULL;
```
(SQLite and Postgres both support partial indexes; this keeps the Done index tiny.)

## 3.4 Ordering under drag-and-drop — fractional indexing

**Why not `position INTEGER`:** every reorder rewrites O(n) rows, which on an offline-first
Android client means an O(n) sync payload and guaranteed conflicts when two people drag at
once.

**Why not `position REAL`:** float64 mantissa exhausts after ~50 consecutive
"insert between the same two items" operations, and then you silently get duplicate
positions.

### ✅ RECOMMENDATION: string fractional indexing (base62), `rank TEXT NOT NULL`.

Library: `github.com/rocicorp/fracdex` (Go port of `rocicorp/fractional-indexing`).
JS/TS API for the web client (identical semantics, cross-language compatible):

```ts
generateKeyBetween(
  a: string | null | undefined,
  b: string | null | undefined,
  digits?: string,      // default BASE_62_DIGITS = "0-9A-Za-z"
  intDigits?: string    // default BASE_52_DIGITS = A-Z (negative) / a-z (positive)
): string;

generateNKeysBetween(a, b, n, digits?, intDigits?): string[];
```

Generated keys look like: first `"a0"`, then `"a1"`, `"a2"`; prepend gives `"Zz"`;
midpoint between `a1` and `a2` gives `"a1V"`.

**Documented caveats you must honour:**
- Keys are **case-sensitive**. Compare with plain byte/string comparison. **Never**
  `localeCompare`, and in SQL never a `COLLATE NOCASE` column — declare
  `rank TEXT NOT NULL COLLATE BINARY`.
- Concurrent generation between the same neighbours **can produce identical keys**. Two
  mitigations, use both:
  1. A deterministic tie-break in every `ORDER BY`: `ORDER BY rank, id` (UUIDv7 → stable
     and roughly creation-ordered).
  2. Append 2–3 random base62 chars ("jitter") to generated keys on the *client*, as
     `nathanhleung/jittered-fractional-indexing` does. Cheap and it makes collisions
     effectively impossible for a household.
- Alphabet chars must be single-byte, ASCII, sorted by code point, no duplicates.

**Where ranks live in Fem-ho — four independent orderings:**

| Ordering | Column | Scope of the ordering |
|---|---|---|
| Kanban card order within a status column | `tasks.board_rank` | global per `status` |
| Subtask order under a parent | `tasks.sibling_rank` | per `parent_task_id` |
| Checklist item order | `checklist_items.rank` | per `checklist_id` |
| Project order in the dropdown | `projects.rank` | per `scope_id` |
| Scope chip order | `scope_members.rank` | per user (each user orders their own chips) |

Note the last one: chip order is *per user*, so it belongs on `scope_members`, not on
`scopes`. That is easy to get wrong.

**Drag API shape** — send neighbours, not an index. The server generates the key, so two
clients dragging simultaneously converge:

```http
PATCH /api/v1/tasks/{id}/move
{ "status": "doing", "before_id": "0192...", "after_id": "0192..." }
```

Server: `newRank = fracdex.KeyBetween(rank(before_id), rank(after_id))`. Accept
`before_id: null` (top) and `after_id: null` (bottom).

**Rebalance escape hatch:** a maintenance job that, if `max(length(rank)) > 40` within a
bucket, regenerates the whole bucket with `generateNKeysBetween(null, null, n)`. Log it.
It should essentially never fire.

## 3.5 Recurring tasks — which model

**Option A — materialise the next occurrence only** (Todoist-ish). On completing instance
N, compute and insert instance N+1. *Pro:* simple, each instance has real state.
*Con:* the Calendar month/week view cannot show future repeats; a missed completion means
the series stalls.

**Option B — store RRULE, expand on read** (pure CalDAV-ish). *Pro:* infinite future,
zero storage, trivially exportable. *Con:* an occurrence has **no identity**, so you cannot
assign Tuesday's rubbish duty to Pau and Thursday's to Aina, cannot comment on one
occurrence, cannot check off subtasks per occurrence, and cannot reorder it on the board.
For a family task manager, this is disqualifying.

**Option C — hybrid: RRULE of record + rolling materialisation horizon.**

### ✅ RECOMMENDATION: Option C.

Design:

- A **series** is a `recurrences` row: `rrule` (RFC 5545 RRULE string), `dtstart`,
  `timezone` (IANA), `anchor`, `count_remaining`, `until_at`.
- Each **instance** is a normal `tasks` row with `series_id` set and
  `recurrence_instance_date` = its `RECURRENCE-ID` value (a DATE or an ISO instant).
  `UNIQUE(series_id, recurrence_instance_date)` prevents double materialisation.
- The **series template** is a `tasks` row with `is_series_template=1`,
  `status='todo'`, and `deleted_at IS NULL`, excluded from all board/calendar queries by
  `AND is_series_template = 0`. It holds the canonical title/description/assignees that new
  instances inherit.
- A job materialises instances up to `now + horizon` (default **60 days**, configurable per
  scope), capped at e.g. 200 instances per series.

**`anchor` is the field everyone forgets:**

```sql
anchor TEXT NOT NULL DEFAULT 'schedule'
    CHECK (anchor IN ('schedule','completion'))
```

- `'schedule'` — "every Monday": next instance derives from `RRULE` + `DTSTART`,
  regardless of when you completed the last one. Materialise ahead.
- `'completion'` — "every 3 days after I do it" (Todoist's `every! 3 days`): next instance
  derives from `completed_at`. **Only ever one open instance**; materialise on completion,
  not ahead. `RRULE` still describes the interval.

Two different jobs, driven off one column. Get this wrong and "water the plants every 3
days" produces 20 overdue tasks.

**RRULE evaluation in Go** — `github.com/teambition/rrule-go` **v1.8.2**:

```go
opt := rrule.ROption{
	Freq:      rrule.WEEKLY,
	Interval:  1,
	Byweekday: []rrule.Weekday{rrule.MO, rrule.TH},
	Dtstart:   time.Date(2026, 8, 3, 9, 0, 0, 0, madrid),
	Wkst:      rrule.MO,          // ISO week start; matters for BYWEEKNO / WEEKLY+INTERVAL>1
}
r, err := rrule.NewRRule(opt)
next := r.After(time.Now(), false)
window := r.Between(horizonStart, horizonEnd, true)

// Round-trip through the stored string form:
set, err := rrule.StrToRRuleSet("DTSTART;TZID=Europe/Madrid:20260803T090000\nRRULE:FREQ=WEEKLY;BYDAY=MO,TH\nEXDATE:20260817T090000")
occurrences := set.Between(from, to, true)
```

Full `ROption` fields available: `Freq, Dtstart, Interval, Wkst, Count, Until, Bysetpos,
Bymonth, Bymonthday, Byyearday, Byweekno, Byweekday, Byhour, Byminute, Bysecond, Byeaster`.
`Set` supports `RRule`, `RDate`/`SetRDates`, `ExDate`/`SetExDates`, `All`, `Between`,
`After`, `Before`, `Recurrence() []string`.

**Store the rule in the series' timezone, and expand in that timezone.** "Every day at
08:00" must stay 08:00 local across the DST switch — that only works if you expand with
`Dtstart` in a `*time.Location`, never in UTC. Use `StrToRRuleSetInLoc` /
`StrToROptionInLocation` when parsing inbound CalDAV rules with a `TZID`.

**Edits to a series.** Offer the three CalDAV-native choices and store them honestly:
- *this occurrence only* → edit the instance row; set `is_exception=1`; on export emit an
  override component with `RECURRENCE-ID`.
- *this and future* → set `recurrences.until_at` on the old series at the split point,
  create a new `recurrences` row + template, repoint future instances.
- *all* → edit the template; regenerate non-exception future instances.

**Skips/deletes of a single occurrence** → append the instance date to
`recurrences.exdates` (a JSON array of ISO strings) *and* soft-delete the instance row, so
re-materialisation does not resurrect it.

## 3.6 Soft deletes and tombstones for sync

The Android app is offline-first and always paired to a server; CalDAV clients need
`sync-collection`; the web app wants live updates. All three need the same thing: **an
authoritative, monotonic, gap-free change feed.**

### ✅ RECOMMENDATION: `deleted_at` on entities + one append-only `change_log`.

```sql
CREATE TABLE change_log (
  seq          INTEGER PRIMARY KEY AUTOINCREMENT,   -- monotonic, gap-free-enough, never reused
  entity_type  TEXT NOT NULL,        -- 'task','checklist','checklist_item','project','scope',...
  entity_id    TEXT NOT NULL,
  op           TEXT NOT NULL CHECK (op IN ('create','update','delete','undelete')),
  scope_id     TEXT,                 -- for authorisation filtering of the feed
  project_id   TEXT,
  actor_kind   TEXT NOT NULL CHECK (actor_kind IN ('user','ai','system','caldav','share_guest')),
  actor_id     TEXT,
  via_token_id TEXT,
  at           TEXT NOT NULL
);
CREATE INDEX idx_change_log_scope_seq ON change_log(scope_id, seq);
CREATE INDEX idx_change_log_entity    ON change_log(entity_type, entity_id, seq);
```

`AUTOINCREMENT` (not bare `INTEGER PRIMARY KEY`) matters: it guarantees monotonically
increasing, **never-reused** rowids via `sqlite_sequence`, which is exactly the property a
sync cursor needs.

Everything derives from this one table:

- **Android delta sync:** `GET /api/v1/sync?since=<seq>&scopes=a,b` → changed entity ids +
  their current state + a new cursor. Deleted rows come back as
  `{id, deleted: true, deleted_at}`.
- **CalDAV `DAV:sync-token`:** `urn:femho:sync:<seq>` (opaque to clients; RFC 6578 only
  requires opacity). Removed members are reported as `404` responses inside the
  multistatus, exactly per RFC 6578.
- **SSE reconnect:** `Last-Event-ID: <seq>`.
- **Audit trail for AI actions** (a product requirement): `actor_kind`, `actor_id`,
  `via_token_id` on every row.

**Retention.** Tombstones must outlive the longest plausible offline period. Keep
`change_log` rows for **180 days** (configurable). When a client presents a cursor older
than the oldest retained `seq`, respond `409` with `{"error":"sync_reset"}` and make the
client do a full resync — and for CalDAV, RFC 6578 already defines this: reply
`403 Forbidden` with `DAV:valid-sync-token` and the client restarts with an empty token.

**Hard delete** only via a `purge` job for: soft-deleted rows older than retention, expired
shares past grace, orphaned attachment blobs. Write a final `op='delete'` row *before*
purging, never after.

**Do not use DB triggers to populate `change_log`.** Write it in the repository layer in
the same transaction. Reason: an AI maintaining trigger bodies across a 12-step SQLite
table rebuild will drop them silently. Application-level writes are visible in code review
and in tests. (The one exception is FTS5 sync triggers — see §9 — because FTS5 basically
requires them.)

## 3.7 External CalDAV items vs native items

Two *different* directions must both be modelled, and they are frequently conflated:

- **Fem-ho as a CalDAV server** (`caldav_collections`, `caldav_objects`): DAVx⁵ and Apple
  Reminders connect *to* Fem-ho. Objects here are projections of native tasks.
- **Fem-ho as a CalDAV client** (`calendar_sources`, `calendar_sync_state`): Fem-ho pulls
  from Nextcloud/Google/Fastmail and pushes back.

### ✅ RECOMMENDATION for distinguishing origin

On `tasks`:

```sql
origin          TEXT NOT NULL DEFAULT 'native'
                  CHECK (origin IN ('native','caldav','ics_feed','api')),
source_id       TEXT REFERENCES calendar_sources(id) ON DELETE SET NULL,
remote_uid      TEXT,      -- iCalendar UID as seen on the remote
remote_href     TEXT,      -- absolute or collection-relative path of the .ics resource
remote_etag     TEXT,      -- last ETag we successfully read/wrote
remote_payload  TEXT,      -- the FULL raw VCALENDAR text we last saw
remote_synced_at TEXT,
sync_state      TEXT NOT NULL DEFAULT 'clean'
                  CHECK (sync_state IN ('clean','local_dirty','remote_dirty','conflict'))
```

with `UNIQUE(source_id, remote_uid)` (partial, `WHERE source_id IS NOT NULL`).

`origin='native'` ⟺ `source_id IS NULL`. Enforce it:
```sql
CHECK ((origin = 'native') = (source_id IS NULL))
```

**The `remote_payload` column is the most important one in this section.** Never
re-serialise an external object from your own fields alone. On write-back:

1. Parse `remote_payload` into an `ical.Calendar`.
2. Overwrite **only** the properties Fem-ho owns (`SUMMARY`, `DESCRIPTION`, `DUE`,
   `DTSTART`, `STATUS`, `COMPLETED`, `PERCENT-COMPLETE`, `PRIORITY`, `CATEGORIES`,
   `LAST-MODIFIED`, `SEQUENCE`, plus `X-FEMHO-*`).
3. Leave everything else (`ORGANIZER`, `ATTENDEE`, `GEO`, `X-APPLE-*`, `X-MOZ-*`,
   `VALARM`s you did not create, `RELATED-TO` you did not create) byte-identical.
4. `PUT` with `If-Match: <remote_etag>`; on `412` mark `sync_state='conflict'` and refetch.

This is the difference between a sync that users trust and one that quietly eats their
Apple Reminders metadata. Vikunja's documented CalDAV support drops `CLASS`, `GEO`,
`LOCATION`, `ORGANIZER`, `PERCENT-COMPLETE`, `RECURRENCE-ID`, `SEQUENCE`, `URL` and
others — Fem-ho can do better essentially for free with `remote_payload`.

**Read-only sources.** `calendar_sources.direction TEXT CHECK (direction IN ('pull','push','both'))`.
For `'pull'` sources (school calendars, ICS subscription feeds), also set
`tasks.readonly=1` and reject writes at the API layer with `409`.

**Deletion semantics.** If a remote object disappears from a `sync-collection` report:
- `direction='pull'` → soft-delete the local task.
- `direction='both'` → soft-delete, **but** log to `activity_log` and, if the task has
  local comments/attachments, instead set `sync_state='conflict'` and keep it. Losing a
  family task because a phone deleted a calendar entry is unacceptable.

**Never trust remote `UID`s as primary keys.** Some servers rewrite them on `PUT`. Keep
Fem-ho's UUIDv7 `id` authoritative and `remote_uid` as a lookup key only.

---

# PART 4 — TIME ZONES AND "TODAY"

This is where task managers break. The rules below are non-negotiable.

## 4.1 Three kinds of temporal value, three storage shapes

| Kind | Example | Storage | Never |
|---|---|---|---|
| **All-day / date-only** | "due Thursday", a birthday | `TEXT 'YYYY-MM-DD'` (SQLite) / `date` (PG). **No timezone. No time. No UTC conversion, ever.** | Storing `2026-08-07T00:00:00Z` — it becomes Aug 6 in Hawaii and Aug 7 in Madrid |
| **Timed instant** | "meeting at 17:30", a reminder firing | `TEXT` ISO-8601 **UTC** with `Z` + a sibling `*_tz` IANA column | Storing local wall-clock without the zone |
| **Recurring wall-clock** | "every day at 08:00" | the **rule** in `recurrences` with `timezone`, expanded in that `*time.Location` | Expanding in UTC |

`tasks` therefore carries a pair, with exactly-one-set enforced:

```sql
due_date TEXT,          -- 'YYYY-MM-DD'  (all-day)
due_at   TEXT,          -- '2026-08-07T15:30:00.000Z' (timed, UTC)
due_tz   TEXT,          -- 'Europe/Madrid'; required iff due_at IS NOT NULL
CHECK (due_date IS NULL OR due_at IS NULL),
CHECK ((due_at IS NULL) = (due_tz IS NULL))
```

Same pair for `start_date`/`start_at`/`start_tz`.

**Why keep `due_tz` when `due_at` is already an absolute instant?** Because if the task
recurs, or if the user later edits "17:30" after moving countries, or if a DST rule
changes (tzdata updates happen several times a year), you need to know the wall-clock
intent. `due_at` alone loses it irrecoverably.

## 4.2 Per-user and per-scope timezone

```sql
users.timezone   TEXT NOT NULL DEFAULT 'UTC'   -- IANA, set from the client on first login
scopes.timezone  TEXT                          -- NULL = "use each viewer's own"
```

- **Personal scopes**: use `users.timezone` of the viewer.
- **Família / collective scopes**: a shared "today" is usually what a household wants
  ("did anyone do the bins today?"). Set `scopes.timezone` at creation to the creator's
  zone and let it be edited. Resolution order: `scopes.timezone ?? users.timezone ?? 'UTC'`.
- Reject invalid zones at write time with `time.LoadLocation` — never store a raw offset
  like `+02:00`, which cannot survive DST.
- The Android client must send its IANA zone on every session refresh (`X-Femho-Timezone`
  header) so travelling users get correct boundaries; store the last seen value on
  `sessions.timezone` for reminder dispatch while the device is offline.

## 4.3 The three date computations, done correctly

```go
// 1. Local day bounds — see §3.3. time.Date(y,m,day+1,...) NOT Add(24h).
func LocalDayBounds(loc *time.Location, t time.Time) (start, end time.Time)

// 2. "Today" as a DATE string, for comparing against all-day due_date.
func LocalToday(loc *time.Location, now time.Time) string {
	return now.In(loc).Format("2006-01-02")
}

// 3. All-day due_date -> the UTC instant it "starts" (only for calendar layout).
func AllDayStartUTC(dateStr string, loc *time.Location) (time.Time, error) {
	d, err := time.ParseInLocation("2006-01-02", dateStr, loc)
	return d.UTC(), err
}
```

## 4.4 "Carry over yesterday's unfinished tasks" — correctly, across DST

Two possible semantics; pick deliberately.

**Semantics A — virtual carry-over (recommended).** Nothing is mutated. A task is
"overdue/carried over" if it is unfinished and its due point is before the viewer's local
today:

```sql
-- all-day tasks
(due_date IS NOT NULL AND due_date < :local_today)   -- pure string compare, DST-immune
OR
-- timed tasks
(due_at IS NOT NULL AND due_at < :local_day_start_utc)
```

Note the beautiful property of the all-day branch: comparing `'2026-08-04' < '2026-08-05'`
is a lexicographic string comparison with **zero timezone arithmetic**, so DST cannot break
it. This is the single strongest argument for storing all-day dates as `TEXT`/`date` and
not as instants.

The board's "Per fer" column then renders carried-over tasks with an overdue badge and
sorts them first. **No job runs. Nothing is written. History is intact.** Users who
completed a task at 23:58 and see it in yesterday's Done are not confused, because Done is
also queried by local day.

**Semantics B — rewriting due dates.** If the product truly wants "yesterday's tasks get
today's date", then:
- add `tasks.original_due_date TEXT` (set once, on the first rollover, never overwritten)
  and `tasks.rollover_count INTEGER NOT NULL DEFAULT 0`;
- the job must run **per timezone**, not once globally;
- every rewrite must emit an `activity_log` row and a `change_log` row (so Android and
  CalDAV see it);
- and it will fight CalDAV: an external client that set `DUE` will see it change under it,
  and `SEQUENCE` must be bumped each time.

**Recommendation:** implement A. Expose B as an opt-in per-scope setting
`settings.key='rollover_mode'` with values `'virtual' | 'rewrite'`, defaulting to
`'virtual'`, and only build the `rewrite` job if a user asks.

**The per-timezone job pattern** (needed for B, and for reminders and daily digests
regardless):

```go
// Run every 15 minutes. For each distinct timezone in use, check whether local midnight
// fell inside the last interval. Idempotent via a marker row.
for _, tz := range distinctTimezones(ctx) {
	loc, err := time.LoadLocation(tz)
	if err != nil { continue }
	localNow := now.In(loc)
	dayKey := localNow.Format("2006-01-02")
	if alreadyRan("rollover", tz, dayKey) { continue }
	if localNow.Hour() == 0 && localNow.Minute() < 15 {
		runRollover(ctx, tz, dayKey)
		markRan("rollover", tz, dayKey)
	}
}
```

The `(job, tz, dayKey)` marker makes it idempotent, which is what makes it safe on the
25-hour DST day when local 00:00–00:15 happens **twice**. Without the marker, the autumn
DST change silently doubles every rollover. That is the DST bug that actually ships.

## 4.5 Reminders and DST

```sql
reminders(
  ...
  trigger_kind TEXT,     -- 'absolute' | 'relative'
  offset_seconds INTEGER,-- for 'relative': negative = before due
  fire_at TEXT NOT NULL, -- materialised UTC instant, what the dispatcher polls
  ...
)
```

- `fire_at` is a **derived cache**. Recompute it whenever `due_at`/`due_date`/`due_tz`/
  `offset_seconds` changes.
- Recompute **all future `fire_at` values** after a tzdata update. In Go, tzdata comes from
  the OS unless you `import _ "time/tzdata"` (which embeds it in the binary — **do that**,
  so distroless/scratch images work). Then a tzdata refresh means a new binary, so run the
  recompute on startup when the embedded tzdata version changes. Store the version in
  `settings`.
- For an all-day task, "remind me at 09:00 on the day" is a *wall-clock* rule:
  `fire_at = time.Date(y, m, d, 9, 0, 0, 0, loc).UTC()`. Recomputed per instance, this is
  DST-correct by construction.
- Dispatcher polls `WHERE fire_at <= now AND fired_at IS NULL` every 30 s and sets
  `fired_at` in the same transaction it enqueues the push. At-least-once delivery; make the
  push payload idempotent with `reminders.id`.

## 4.6 CalDAV and timezones

- Emit `DTSTART`/`DUE` for all-day as `;VALUE=DATE:20260807`. For timed, either UTC
  (`20260807T153000Z`) or `;TZID=Europe/Madrid:20260807T173000` with an accompanying
  `VTIMEZONE` component. **Emit `TZID` + `VTIMEZONE`** for recurring items (required for
  correct client-side expansion) and plain `Z` for one-offs (simpler, no `VTIMEZONE`).
- `COMPLETED` **must** be UTC per RFC 5545.
- On inbound parse, `go-ical`'s `Event.DateTimeStart(loc)` / `Props.RecurrenceRule()` take
  a `*time.Location` used as the fallback when no `TZID` is present — pass the *source's*
  configured timezone, not `time.UTC`, or floating times land in the wrong day.

## 4.7 What Fem-ho should do — timezone checklist

1. `import _ "time/tzdata"` in `main.go`. Non-negotiable for distroless images.
2. Store all-day as `TEXT 'YYYY-MM-DD'`; never convert it to an instant for storage.
3. Store timed as UTC ISO-8601 + IANA `*_tz` sibling.
4. One `LocalDayBounds` helper, used by every "today" query. Unit-tested on
   `Europe/Madrid` DST Sundays and on `Pacific/Chatham` (+12:45 / +13:45) to catch
   half-hour-offset assumptions.
5. Never `Add(24*time.Hour)` to cross a day boundary. Add a `golangci-lint` forbidigo rule
   for the literal `24 * time.Hour` if you can.
6. Overdue and carry-over are **read-time predicates**, not stored state.
7. Every timezone-sensitive scheduled job is idempotent on `(job, tz, local_date)`.

---

# PART 5 — THE SCHEMA

SQLite dialect. Postgres deltas are noted inline. Conventions:

- **IDs**: `TEXT` UUIDv7 (RFC 9562 — *cited from knowledge, not re-fetched this session*),
  lowercase hyphenated. Client-generatable so the offline Android app never needs temp-id
  remapping.
- **Timestamps**: `TEXT` ISO-8601 UTC, `strftime('%Y-%m-%dT%H:%M:%fZ','now')`, Go
  `t.UTC().Format("2006-01-02T15:04:05.000Z")`.
- **Dates**: `TEXT` `'YYYY-MM-DD'`.
- **Booleans**: `INTEGER` 0/1.
- **JSON**: `TEXT` validated with `CHECK (json_valid(col))`.
- Every user-visible entity has `created_at`, `updated_at`, `deleted_at`.
- `PRAGMA foreign_keys = ON` on every connection (off by default — Litestream's tips page
  calls this out).

## 5.1 Identity, auth, tokens

```sql
-- ---------------------------------------------------------------- users
CREATE TABLE users (
  id                TEXT PRIMARY KEY,                    -- UUIDv7
  email             TEXT NOT NULL,
  email_normalized  TEXT NOT NULL,                       -- lower(trim(email)); the real key
  password_hash     TEXT,                                -- Argon2id PHC string; NULL for the AI user
  display_name      TEXT NOT NULL,
  avatar_path       TEXT,                                -- relative to FEMHO_FILES
  timezone          TEXT NOT NULL DEFAULT 'UTC',         -- IANA
  locale            TEXT NOT NULL DEFAULT 'ca',          -- 'ca' | 'es' | 'en'
  week_start        INTEGER NOT NULL DEFAULT 1           -- ISO: 1=Monday
                      CHECK (week_start BETWEEN 0 AND 6),
  theme             TEXT NOT NULL DEFAULT 'system'
                      CHECK (theme IN ('system','light','dark')),
  accent            TEXT NOT NULL DEFAULT 'default',     -- Plou: 4 accent variants
  kind              TEXT NOT NULL DEFAULT 'human'
                      CHECK (kind IN ('human','ai','system')),
  is_admin          INTEGER NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active','invited','disabled')),
  failed_logins     INTEGER NOT NULL DEFAULT 0,
  locked_until      TEXT,
  last_login_at     TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  deleted_at        TEXT
);
CREATE UNIQUE INDEX ux_users_email ON users(email_normalized) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_kind ON users(kind) WHERE deleted_at IS NULL;
```

**Non-obvious constraints & notes**

- `email_normalized` is the uniqueness key, not `email`. Do the lowering in Go
  (`strings.ToLower(strings.TrimSpace(e))`), not in SQL, so SQLite and Postgres agree and
  so no collation surprises. Do **not** strip Gmail dots — for a family server that is
  surprising behaviour.
- The partial unique index (`WHERE deleted_at IS NULL`) lets a deleted user's email be
  reused. That is what self-hosters expect.
- **`kind='ai'`** is the "AI user" from the product spec: a real row so it can be an
  assignee, a comment author, and an `activity_log` actor, but with `password_hash IS NULL`
  so it can never log in interactively. Exactly one such row, seeded by migration with a
  fixed UUID.
- `avatar_path` not `avatar_url` — avatars go through the same authenticated blob serving
  as attachments (§10).

```sql
-- ------------------------------------------------------------- sessions
CREATE TABLE sessions (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash      TEXT NOT NULL,          -- SHA-256 hex of a 256-bit random token
  refresh_hash    TEXT,                   -- SHA-256 hex of the refresh token
  device_name     TEXT,                   -- 'Pixel 8 · Fem-ho Android 1.2'
  device_kind     TEXT NOT NULL DEFAULT 'web'
                    CHECK (device_kind IN ('web','android','ios','cli','other')),
  timezone        TEXT,                   -- last IANA zone reported by this device
  user_agent      TEXT,
  ip_hash         TEXT,                   -- HMAC-SHA256(ip, server_pepper); never the raw IP
  push_token      TEXT,                   -- FCM registration token for this device
  created_at      TEXT NOT NULL,
  last_seen_at    TEXT NOT NULL,
  expires_at      TEXT NOT NULL,
  revoked_at      TEXT
);
CREATE UNIQUE INDEX ux_sessions_token   ON sessions(token_hash);
CREATE UNIQUE INDEX ux_sessions_refresh ON sessions(refresh_hash) WHERE refresh_hash IS NOT NULL;
CREATE INDEX idx_sessions_user  ON sessions(user_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_sessions_expiry ON sessions(expires_at) WHERE revoked_at IS NULL;
```

**Non-obvious**

- Store **SHA-256 of the token, not Argon2id**. The token is 256 bits of server-generated
  randomness, so there is no dictionary to attack; a slow KDF here just burns CPU on every
  request. (Contrast `users.password_hash`, which is user-chosen and *must* be Argon2id.)
  This distinction is the single most common auth performance mistake in self-hosted apps.
- `ip_hash` rather than `ip`: GDPR-friendly and still lets you show "3 sessions from a new
  location".
- One row per device gives the profile screen a real "sign out this device" button, and
  gives reminders a `push_token` + `timezone` even while the device is offline.

```sql
-- ----------------------------------------------------------- api_tokens
CREATE TABLE api_tokens (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,               -- 'DAVx5 al mòbil', 'Claude MCP'
  prefix         TEXT NOT NULL,               -- first 8 chars, shown in the UI
  token_hash     TEXT NOT NULL,               -- SHA-256 hex (see note above)
  audience       TEXT NOT NULL                -- THE separation the product asks for
                   CHECK (audience IN ('api','caldav','mcp','share')),
  subject_kind   TEXT NOT NULL DEFAULT 'human'
                   CHECK (subject_kind IN ('human','ai')),
  scope_ids      TEXT,                        -- JSON array; NULL = all scopes the user can see
  project_ids    TEXT,                        -- JSON array; NULL = all projects in scope_ids
  permissions    TEXT NOT NULL DEFAULT '["read"]',  -- JSON: read, write, delete, admin, share
  rate_limit_rpm INTEGER,                     -- NULL = default
  expires_at     TEXT,
  last_used_at   TEXT,
  use_count      INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  revoked_at     TEXT,
  CHECK (scope_ids   IS NULL OR json_valid(scope_ids)),
  CHECK (project_ids IS NULL OR json_valid(project_ids)),
  CHECK (json_valid(permissions))
);
CREATE UNIQUE INDEX ux_api_tokens_hash ON api_tokens(token_hash);
CREATE INDEX idx_api_tokens_user ON api_tokens(user_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_api_tokens_prefix ON api_tokens(prefix);
```

**Non-obvious**

- **`audience` is how "separately scoped tokens/API keys for humans vs AI" is enforced.**
  A `caldav` token cannot call `/api/v1/*`; an `mcp` token cannot be used as a CalDAV
  password. Check it in one middleware, once.
- `audience='caldav'` tokens exist because **CalDAV clients only speak HTTP Basic**. The
  user's real password must never be typed into DAVx⁵. Emit these as "app passwords" from
  the profile screen, and accept them as the Basic-auth password with the user's email as
  the username. This is exactly what Vikunja does (username + dedicated CalDAV token) and
  it is required if you ever add 2FA.
- `subject_kind='ai'` is what makes the audit trail meaningful: every `change_log` and
  `activity_log` row carries `via_token_id`, so "what did the AI change last Tuesday" is a
  single indexed query.
- Token wire format: `femho_<audience>_<43 base64url chars>` (256 bits). `prefix` =
  `femho_mcp_AbCd`. Never store the plaintext.

## 5.2 Scopes ("àmbits"), membership, projects

```sql
-- --------------------------------------------------------------- scopes
CREATE TABLE scopes (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,               -- 'Personal', 'Feina', 'Família', or user-created
  slug          TEXT NOT NULL,               -- normalised for '#Scope' quick-add parsing
  kind          TEXT NOT NULL DEFAULT 'custom'
                  CHECK (kind IN ('personal','work','family','custom')),
  collectivity  TEXT NOT NULL DEFAULT 'individual'
                  CHECK (collectivity IN ('individual','collective')),
  owner_id      TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  timezone      TEXT,                        -- NULL = each viewer's own; set for collective
  color         TEXT,                        -- Plou accent token, e.g. 'accent-2'
  gradient      TEXT,                        -- Plou "one brand gradient per view" token
  icon          TEXT,
  description   TEXT,
  is_default    INTEGER NOT NULL DEFAULT 0,  -- the scope the '+' button targets by default
  archived_at   TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT
);
CREATE UNIQUE INDEX ux_scopes_slug_owner ON scopes(owner_id, slug) WHERE deleted_at IS NULL;
CREATE INDEX idx_scopes_owner ON scopes(owner_id) WHERE deleted_at IS NULL;
```

**Non-obvious**

- `slug` exists **because of the quick-add parser**. `#Família` and `#familia` must resolve
  to the same scope, so `slug = casefold + NFD-strip-diacritics + Catalan folding` (§9.4) —
  i.e. `'familia'`. Uniqueness is per owner, not global, so two family members can each
  have a `#Personal`.
- `collectivity` is orthogonal to `kind`: a `custom` scope can be `collective` ("Casa de
  muntanya" shared with the in-laws), and `family` could theoretically be individual.
  Do not conflate them.
- `owner_id ON DELETE RESTRICT`: you cannot delete a user who owns a collective scope.
  Force an explicit ownership transfer in the UI. Cascading here would silently destroy the
  whole family's data.
- `is_default` needs a partial unique index per user — but the "user" here is the owner:
  `CREATE UNIQUE INDEX ux_scopes_default ON scopes(owner_id) WHERE is_default=1 AND deleted_at IS NULL;`

```sql
-- -------------------------------------------------------- scope_members
CREATE TABLE scope_members (
  scope_id     TEXT NOT NULL REFERENCES scopes(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  role         TEXT NOT NULL DEFAULT 'member'
                 CHECK (role IN ('owner','admin','member','viewer')),
  rank         TEXT NOT NULL COLLATE BINARY,   -- THIS USER's chip order for THIS scope
  chip_hidden  INTEGER NOT NULL DEFAULT 0,     -- hidden from the chip bar but still readable
  notify       TEXT NOT NULL DEFAULT 'assigned'
                 CHECK (notify IN ('all','assigned','none')),
  joined_at    TEXT NOT NULL,
  invited_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at   TEXT NOT NULL,
  deleted_at   TEXT,
  PRIMARY KEY (scope_id, user_id)
);
CREATE INDEX idx_scope_members_user ON scope_members(user_id) WHERE deleted_at IS NULL;
```

**Non-obvious**

- **`rank` lives here, not on `scopes`.** Each family member orders their own chips. Putting
  it on `scopes` would make Aina's reordering move Pau's chips. Easy mistake, annoying bug.
- `role='viewer'` is what a public-ish family calendar needs (grandparents see, cannot edit).
- `notify` per membership, not per user: "tell me about everything in Família, only my own
  stuff in Feina."
- Authorisation rule, stated once: **a user may read a task iff there exists a non-deleted
  `scope_members` row for `(task.scope_id, user)`.** Every query joins through this. There
  is no per-task ACL in v1 — resist adding one.

```sql
-- ------------------------------------------------------------- projects
CREATE TABLE projects (
  id            TEXT PRIMARY KEY,
  scope_id      TEXT NOT NULL REFERENCES scopes(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL,                -- for '#Scope/Project' quick-add
  description   TEXT,
  color         TEXT,
  icon          TEXT,
  rank          TEXT NOT NULL COLLATE BINARY, -- order in the project dropdown
  is_archived   INTEGER NOT NULL DEFAULT 0,
  default_status TEXT NOT NULL DEFAULT 'todo' -- where '+' inside this project lands
                  CHECK (default_status IN ('inbox','todo','doing','done')),
  created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT
);
CREATE UNIQUE INDEX ux_projects_slug ON projects(scope_id, slug) WHERE deleted_at IS NULL;
CREATE INDEX idx_projects_scope ON projects(scope_id, rank) WHERE deleted_at IS NULL AND is_archived = 0;
```

**Non-obvious**

- There is **no "general space" project row.** The scope's general space is
  `project_id IS NULL`. Creating a phantom "General" project would leak into the project
  dropdown, into CalDAV collection lists, and into `#Scope/General` parsing. Keep it NULL.
- `default_status='todo'`: inside a project the `+` button should create in *Per fer*, but
  the global `+` (no project selected) should create in *Inbox*. That asymmetry is a real
  product decision; encode it here rather than in the client.

## 5.3 Tasks — the central table

```sql
CREATE TABLE tasks (
  id                 TEXT PRIMARY KEY,                       -- UUIDv7, client-generatable
  scope_id           TEXT NOT NULL REFERENCES scopes(id)   ON DELETE CASCADE,
  project_id         TEXT          REFERENCES projects(id) ON DELETE SET NULL,
  parent_task_id     TEXT          REFERENCES tasks(id)    ON DELETE CASCADE,

  title              TEXT NOT NULL,
  description        TEXT,                                   -- markdown
  notes_format       TEXT NOT NULL DEFAULT 'markdown'
                       CHECK (notes_format IN ('markdown','plain')),

  -- kanban (§3.1)
  status             TEXT NOT NULL DEFAULT 'inbox'
                       CHECK (status IN ('inbox','todo','doing','done')),
  status_changed_at  TEXT NOT NULL,
  board_rank         TEXT NOT NULL COLLATE BINARY,           -- fractional index, per status
  sibling_rank       TEXT NOT NULL COLLATE BINARY,           -- order among siblings of parent

  -- completion (§3.3)
  completed_at       TEXT,
  completed_tz       TEXT,
  completed_by       TEXT REFERENCES users(id) ON DELETE SET NULL,
  percent_complete   INTEGER CHECK (percent_complete BETWEEN 0 AND 100),

  -- dates (§4.1)
  start_date         TEXT,   -- 'YYYY-MM-DD'
  start_at           TEXT,   -- ISO-8601 UTC
  start_tz           TEXT,
  due_date           TEXT,
  due_at             TEXT,
  due_tz             TEXT,
  duration_seconds   INTEGER,                                -- iCal DURATION (VTODO: XOR DUE)
  all_day            INTEGER NOT NULL DEFAULT 1,             -- derived, but stored for indexing

  priority           INTEGER NOT NULL DEFAULT 0              -- 0=none; 1..9 = iCal PRIORITY
                       CHECK (priority BETWEEN 0 AND 9),
  estimate_minutes   INTEGER,

  -- presentation (§3.2)
  view_mode          TEXT NOT NULL DEFAULT 'task'
                       CHECK (view_mode IN ('task','checklist')),
  is_pinned          INTEGER NOT NULL DEFAULT 0,
  color              TEXT,

  -- recurrence (§3.5)
  series_id          TEXT REFERENCES recurrences(id) ON DELETE SET NULL,
  is_series_template INTEGER NOT NULL DEFAULT 0,
  recurrence_instance_date TEXT,                             -- RECURRENCE-ID value
  is_exception       INTEGER NOT NULL DEFAULT 0,

  -- AI delegation (product requirement)
  ai_mode            TEXT NOT NULL DEFAULT 'self'
                       CHECK (ai_mode IN ('self','assisted','delegated')),
  ai_state           TEXT NOT NULL DEFAULT 'none'
                       CHECK (ai_state IN ('none','queued','running','needs_review','done','failed')),

  -- interop / origin (§3.7)
  origin             TEXT NOT NULL DEFAULT 'native'
                       CHECK (origin IN ('native','caldav','ics_feed','api')),
  source_id          TEXT REFERENCES calendar_sources(id) ON DELETE SET NULL,
  remote_uid         TEXT,
  remote_href        TEXT,
  remote_etag        TEXT,
  remote_payload     TEXT,
  remote_synced_at   TEXT,
  sync_state         TEXT NOT NULL DEFAULT 'clean'
                       CHECK (sync_state IN ('clean','local_dirty','remote_dirty','conflict')),
  readonly           INTEGER NOT NULL DEFAULT 0,

  -- CalDAV serving identity
  ical_uid           TEXT NOT NULL,                          -- our UID; stable forever
  ical_sequence      INTEGER NOT NULL DEFAULT 0,
  etag               TEXT NOT NULL,                          -- bumped on every write

  -- search (§9)
  search_text        TEXT NOT NULL DEFAULT '',               -- normalised title+desc

  created_by         TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  archived_at        TEXT,
  deleted_at         TEXT,

  -- ---- non-obvious constraints ----
  CHECK (due_date   IS NULL OR due_at   IS NULL),
  CHECK (start_date IS NULL OR start_at IS NULL),
  CHECK ((due_at   IS NULL) = (due_tz   IS NULL)),
  CHECK ((start_at IS NULL) = (start_tz IS NULL)),
  CHECK (NOT (due_at IS NOT NULL AND duration_seconds IS NOT NULL)),  -- RFC 5545: DUE xor DURATION
  CHECK ((status = 'done') = (completed_at IS NOT NULL)),
  CHECK ((origin = 'native') = (source_id IS NULL)),
  CHECK (parent_task_id IS NULL OR parent_task_id <> id),
  CHECK (is_series_template = 0 OR series_id IS NOT NULL)
);
```

**Indexes** — these are the ones that carry the app; every one maps to a real screen:

```sql
-- The kanban board: scope chips (multi-select) + optional project + column.
CREATE INDEX idx_tasks_board ON tasks(scope_id, status, board_rank)
  WHERE deleted_at IS NULL AND parent_task_id IS NULL AND is_series_template = 0 AND archived_at IS NULL;

-- Same, narrowed to a project.
CREATE INDEX idx_tasks_board_project ON tasks(project_id, status, board_rank)
  WHERE deleted_at IS NULL AND project_id IS NOT NULL AND is_series_template = 0;

-- Calendar month/week/day: all-day lane.
CREATE INDEX idx_tasks_due_date ON tasks(scope_id, due_date)
  WHERE deleted_at IS NULL AND due_date IS NOT NULL AND is_series_template = 0;

-- Calendar: timed lane.
CREATE INDEX idx_tasks_due_at ON tasks(scope_id, due_at)
  WHERE deleted_at IS NULL AND due_at IS NOT NULL AND is_series_template = 0;

-- The Done column (§3.3) — tiny partial index.
CREATE INDEX idx_tasks_completed ON tasks(scope_id, completed_at DESC)
  WHERE status = 'done' AND deleted_at IS NULL;

-- Subtree expansion.
CREATE INDEX idx_tasks_parent ON tasks(parent_task_id, sibling_rank) WHERE deleted_at IS NULL;

-- Recurrence materialisation + dedupe.
CREATE UNIQUE INDEX ux_tasks_series_instance ON tasks(series_id, recurrence_instance_date)
  WHERE series_id IS NOT NULL AND recurrence_instance_date IS NOT NULL;

-- CalDAV: resource lookup by UID within a collection.
CREATE UNIQUE INDEX ux_tasks_ical_uid ON tasks(ical_uid) WHERE deleted_at IS NULL;

-- CalDAV client: map remote objects back.
CREATE UNIQUE INDEX ux_tasks_remote ON tasks(source_id, remote_uid)
  WHERE source_id IS NOT NULL;

-- Overdue sweep / carry-over badge.
CREATE INDEX idx_tasks_open_due ON tasks(due_date)
  WHERE deleted_at IS NULL AND status IN ('inbox','todo','doing') AND due_date IS NOT NULL;

-- AI work queue.
CREATE INDEX idx_tasks_ai ON tasks(ai_state, updated_at)
  WHERE ai_mode <> 'self' AND deleted_at IS NULL;

-- Pinned checklists/tasks strip.
CREATE INDEX idx_tasks_pinned ON tasks(scope_id, board_rank) WHERE is_pinned = 1 AND deleted_at IS NULL;
```

**Discussion of the non-obvious choices**

- **`all_day` is denormalised.** It is derivable (`due_at IS NULL`), but the calendar
  renders two lanes and having a plain integer column keeps the query planner honest and
  the Android query simple. Maintain it in the repository layer, assert it in tests.
- **`etag`** is a random 16-byte hex regenerated on every write, not a hash of the content.
  Hashing invites "same content, same etag" bugs when only a relation changed (an assignee
  was added), which makes CalDAV clients skip a real update. Random-on-write is always safe.
- **`ical_sequence`** must increase on every *semantic* change you publish. Bump it in the
  same place you regenerate `etag`, but only for fields that appear in the exported VTODO.
- **`search_text`** is written by the app, not a trigger, so the Catalan normalisation rules
  live in one Go function that the query path also calls. See §9.4.
- **`parent_task_id ON DELETE CASCADE`** is right for hard deletes (which only the purge job
  does); soft-delete of a parent must explicitly soft-delete descendants in the repository,
  recursively, in one transaction. Write that as a recursive CTE:

```sql
WITH RECURSIVE sub(id) AS (
  SELECT :root
  UNION ALL
  SELECT t.id FROM tasks t JOIN sub ON t.parent_task_id = sub.id WHERE t.deleted_at IS NULL
)
UPDATE tasks SET deleted_at = :now, updated_at = :now WHERE id IN (SELECT id FROM sub);
```

- **Depth limit.** Enforce max nesting depth 3 in the application (task → subtask →
  sub-subtask). Unbounded nesting makes the board, the CalDAV `RELATED-TO` graph and the
  share view all incoherent. There is no cheap SQL constraint for this; check it on insert.

## 5.4 Task relations, assignees, labels

```sql
-- -------------------------------------------------------- task_relations
CREATE TABLE task_relations (
  id            TEXT PRIMARY KEY,
  from_task_id  TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  to_task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL
                  CHECK (kind IN ('blocks','blocked_by','duplicates','duplicated_by',
                                  'relates_to','precedes','follows','copied_from')),
  created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL,
  deleted_at    TEXT,
  CHECK (from_task_id <> to_task_id)
);
CREATE UNIQUE INDEX ux_task_relations ON task_relations(from_task_id, to_task_id, kind)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_task_relations_to ON task_relations(to_task_id) WHERE deleted_at IS NULL;
```

**Non-obvious**

- **Parent/child is NOT a relation row.** It is `tasks.parent_task_id`. Putting hierarchy in
  a generic relation table means every board query needs a join to know whether a row is a
  subtask. Keep them separate.
- **Store both directions or one?** Store **one row, and materialise the inverse on read.**
  `blocks`/`blocked_by` are the same edge. Writing both rows doubles the sync payload and
  invites them to drift. Keep a Go map `inverse[kind]` and expose both directions in the API.
  (If you prefer symmetry, the alternative is a trigger writing the mirror — do not; see the
  no-triggers rule in §3.6.)
- CalDAV export: `RELATED-TO;RELTYPE=PARENT` for hierarchy, `RELTYPE=SIBLING` for
  `relates_to`. `blocks` has no RFC 5545 equivalent — emit `X-FEMHO-RELATION`.

```sql
-- -------------------------------------------------------- task_assignees
-- (the prompt calls this `assignees`; name it task_assignees for clarity)
CREATE TABLE task_assignees (
  task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT 'assignee'
                CHECK (role IN ('assignee','reviewer','watcher')),
  assigned_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  assigned_at TEXT NOT NULL,
  accepted_at TEXT,
  deleted_at  TEXT,
  PRIMARY KEY (task_id, user_id, role)
);
CREATE INDEX idx_task_assignees_user ON task_assignees(user_id) WHERE deleted_at IS NULL;
```

**Non-obvious**

- Many-to-many from day one. "Pau **and** Aina take the kids to swimming" is the normal
  family case; a single `assignee_id` column will be regretted within a week.
- The **AI user** is assigned exactly like a human: `task_assignees(task_id, ai_user_id)`
  plus `tasks.ai_mode='delegated'`. That makes "show me everything the AI owns" a normal
  query and keeps the UI uniform.
- `role='watcher'` powers notifications without implying responsibility.
- Constraint you must enforce in code (no cheap SQL form): the assignee must be a member of
  `tasks.scope_id`. Check on write; add a periodic integrity job.
- CalDAV: assignees map to `ATTENDEE;CN=...;PARTSTAT=NEEDS-ACTION:mailto:...`, organiser to
  `ORGANIZER`. Most task clients ignore these, so also emit `X-FEMHO-ASSIGNEE`.

```sql
-- --------------------------------------------------------------- labels
CREATE TABLE labels (
  id          TEXT PRIMARY KEY,
  scope_id    TEXT REFERENCES scopes(id) ON DELETE CASCADE,  -- NULL = global to the instance
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL,               -- normalised, for '!label' or '#label' parsing
  color       TEXT,
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT
);
CREATE UNIQUE INDEX ux_labels_slug ON labels(COALESCE(scope_id,''), slug) WHERE deleted_at IS NULL;

-- ----------------------------------------------------------- task_labels
CREATE TABLE task_labels (
  task_id    TEXT NOT NULL REFERENCES tasks(id)  ON DELETE CASCADE,
  label_id   TEXT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  added_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  added_at   TEXT NOT NULL,
  PRIMARY KEY (task_id, label_id)
);
CREATE INDEX idx_task_labels_label ON task_labels(label_id);
```

**Non-obvious**

- `scope_id` nullable so an instance-wide vocabulary ("urgent", "compres") coexists with
  scope-private labels. `COALESCE(scope_id,'')` in the unique index because SQLite (and
  Postgres) treat `NULL` as distinct in unique indexes, which would allow duplicate global
  labels.
- **Do not reuse labels as the quick-add `#` token.** `#` is taken by scopes/projects per
  the product spec. Use `!urgent` or `+urgent` for labels, or a plain `@`-free keyword; pick
  one and document it in the parser.
- CalDAV: labels map to `CATEGORIES:a,b,c` — one of the few genuinely portable fields;
  Vikunja round-trips it successfully.

## 5.5 Checklists ("llistes simples")

```sql
-- ------------------------------------------------------------ checklists
CREATE TABLE checklists (
  id           TEXT PRIMARY KEY,
  task_id      TEXT REFERENCES tasks(id)    ON DELETE CASCADE,
  project_id   TEXT REFERENCES projects(id) ON DELETE CASCADE,
  scope_id     TEXT REFERENCES scopes(id)   ON DELETE CASCADE,
  title        TEXT NOT NULL,
  rank         TEXT NOT NULL COLLATE BINARY,   -- order among sibling checklists
  is_pinned    INTEGER NOT NULL DEFAULT 0,     -- "pinnable" per the product spec
  pinned_rank  TEXT COLLATE BINARY,            -- order in the pinned strip
  reset_policy TEXT NOT NULL DEFAULT 'never'   -- shopping lists want 'manual'/'daily'
                 CHECK (reset_policy IN ('never','manual','daily','weekly')),
  last_reset_at TEXT,
  item_count   INTEGER NOT NULL DEFAULT 0,     -- denormalised counters
  done_count   INTEGER NOT NULL DEFAULT 0,
  created_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  deleted_at   TEXT,
  CHECK (
    (task_id IS NOT NULL AND project_id IS NULL AND scope_id IS NULL) OR
    (task_id IS NULL AND project_id IS NOT NULL AND scope_id IS NULL) OR
    (task_id IS NULL AND project_id IS NULL AND scope_id IS NOT NULL)
  ),
  CHECK ((is_pinned = 0) = (pinned_rank IS NULL))
);
CREATE INDEX idx_checklists_task   ON checklists(task_id, rank) WHERE deleted_at IS NULL;
CREATE INDEX idx_checklists_pinned ON checklists(pinned_rank)   WHERE is_pinned = 1 AND deleted_at IS NULL;

-- ------------------------------------------------------- checklist_items
CREATE TABLE checklist_items (
  id                TEXT PRIMARY KEY,
  checklist_id      TEXT NOT NULL REFERENCES checklists(id) ON DELETE CASCADE,
  text              TEXT NOT NULL,
  is_checked        INTEGER NOT NULL DEFAULT 0,
  checked_at        TEXT,
  checked_by        TEXT REFERENCES users(id) ON DELETE SET NULL,
  checked_by_guest  TEXT,                     -- share_accesses.guest_name, for public links
  quantity          TEXT,                     -- '2 kg', free text; shopping lists want it
  note              TEXT,
  rank              TEXT NOT NULL COLLATE BINARY,
  promoted_task_id  TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  converted_at      TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  deleted_at        TEXT,
  CHECK ((is_checked = 1) = (checked_at IS NOT NULL))
);
CREATE INDEX idx_checklist_items ON checklist_items(checklist_id, rank) WHERE deleted_at IS NULL;
CREATE INDEX idx_checklist_items_open ON checklist_items(checklist_id)
  WHERE is_checked = 0 AND deleted_at IS NULL;
```

**Non-obvious**

- **`checked_by_guest`** exists because a public share link can allow ticking items and the
  guest is not a `users` row. The product asks for "optional required name for the guest" —
  this is where that name lands. `checked_by` and `checked_by_guest` are mutually exclusive
  in practice; do not add a CHECK, because a guest-checked item later edited by a member is
  legitimate.
- **`item_count`/`done_count` are denormalised** and maintained in the repository layer in
  the same transaction. A checklist strip showing "3/12" for 20 pinned lists must not run 20
  `COUNT(*)` queries. Add a nightly integrity job that recomputes and logs drift.
- **`reset_policy`** turns a checklist into a recurring routine ("esmorzars", "motxilla del
  cole") without dragging the full `recurrences` machinery in. `daily` resets all items to
  unchecked at the scope's local midnight — and it must write a `checklist_resets` history
  row if you want "did we do the routine yesterday?" (add later; not in v1).
- Checklist items are **not** in `change_log` individually if the volume is high — but for
  Fem-ho's scale they should be, so offline Android can sync a partially-ticked shopping
  list. Include them.

## 5.6 Comments, attachments, reminders, recurrences

```sql
-- ------------------------------------------------------------- comments
CREATE TABLE comments (
  id            TEXT PRIMARY KEY,
  task_id       TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  author_kind   TEXT NOT NULL DEFAULT 'user'
                  CHECK (author_kind IN ('user','ai','system','share_guest')),
  guest_name    TEXT,
  via_token_id  TEXT REFERENCES api_tokens(id) ON DELETE SET NULL,
  body          TEXT NOT NULL,                 -- markdown
  reply_to_id   TEXT REFERENCES comments(id) ON DELETE SET NULL,
  edited_at     TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT
);
CREATE INDEX idx_comments_task ON comments(task_id, created_at) WHERE deleted_at IS NULL;
```

```sql
-- ----------------------------------------------------------- attachments
-- Content-addressed blob registry. One row per distinct byte-sequence.
CREATE TABLE attachments (
  id            TEXT PRIMARY KEY,
  sha256        TEXT NOT NULL,                 -- lowercase hex, 64 chars
  byte_size     INTEGER NOT NULL,
  mime_type     TEXT NOT NULL,                 -- SNIFFED server-side, never trusted from client
  storage       TEXT NOT NULL DEFAULT 'fs'
                  CHECK (storage IN ('fs','s3')),
  storage_key   TEXT NOT NULL,                 -- 'ab/cd/abcd...' for fs; object key for s3
  width         INTEGER, height INTEGER,       -- images only
  thumb_key     TEXT,
  ref_count     INTEGER NOT NULL DEFAULT 0,    -- how many task_attachments point here
  uploaded_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL,
  deleted_at    TEXT
);
CREATE UNIQUE INDEX ux_attachments_sha ON attachments(sha256) WHERE deleted_at IS NULL;
CREATE INDEX idx_attachments_gc ON attachments(ref_count) WHERE ref_count = 0 AND deleted_at IS NULL;

-- The link table: same blob can be attached to many tasks/comments with different names.
CREATE TABLE task_attachments (
  id             TEXT PRIMARY KEY,
  attachment_id  TEXT NOT NULL REFERENCES attachments(id) ON DELETE RESTRICT,
  task_id        TEXT REFERENCES tasks(id)    ON DELETE CASCADE,
  comment_id     TEXT REFERENCES comments(id) ON DELETE CASCADE,
  scope_id       TEXT NOT NULL REFERENCES scopes(id) ON DELETE CASCADE,  -- denormalised for authz
  filename       TEXT NOT NULL,                -- original name, sanitised
  rank           TEXT NOT NULL COLLATE BINARY,
  added_by       TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL,
  deleted_at     TEXT,
  CHECK ((task_id IS NOT NULL) <> (comment_id IS NOT NULL))
);
CREATE INDEX idx_task_attachments_task ON task_attachments(task_id, rank) WHERE deleted_at IS NULL;
```

**Non-obvious**

- **Splitting `attachments` (blobs) from `task_attachments` (references)** gives free
  deduplication — the same PDF forwarded to three tasks stores once — and makes GC a simple
  `ref_count = 0` sweep. `ON DELETE RESTRICT` on `attachment_id` prevents orphaning a
  referenced blob.
- **`scope_id` is denormalised onto `task_attachments`** so the download handler can
  authorise with one indexed read and no joins. That handler is on the hot path for every
  image in a task description.
- **`mime_type` must be sniffed** (`http.DetectContentType` on the first 512 bytes) and then
  constrained to an allowlist for inline rendering. Anything else is served as
  `application/octet-stream` with `Content-Disposition: attachment`.

```sql
-- ------------------------------------------------------------- reminders
CREATE TABLE reminders (
  id              TEXT PRIMARY KEY,
  task_id         TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id         TEXT REFERENCES users(id) ON DELETE CASCADE,   -- NULL = every assignee
  trigger_kind    TEXT NOT NULL CHECK (trigger_kind IN ('absolute','relative')),
  offset_seconds  INTEGER,                     -- relative: negative = before due
  relative_to     TEXT CHECK (relative_to IN ('due','start')),
  local_time      TEXT,                        -- 'HH:MM' for all-day tasks
  fire_at         TEXT NOT NULL,               -- materialised UTC instant (see §4.5)
  channel         TEXT NOT NULL DEFAULT 'push'
                    CHECK (channel IN ('push','email','webhook','none')),
  fired_at        TEXT,
  delivery_state  TEXT NOT NULL DEFAULT 'pending'
                    CHECK (delivery_state IN ('pending','sent','failed','skipped')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  ical_uid        TEXT,                        -- VALARM UID for round-trip
  created_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  deleted_at      TEXT,
  CHECK ((trigger_kind = 'relative') = (offset_seconds IS NOT NULL))
);
-- THE dispatcher index. Partial so it only holds pending future work.
CREATE INDEX idx_reminders_due ON reminders(fire_at)
  WHERE fired_at IS NULL AND deleted_at IS NULL AND delivery_state = 'pending';
CREATE INDEX idx_reminders_task ON reminders(task_id) WHERE deleted_at IS NULL;
```

```sql
-- ----------------------------------------------------------- recurrences
CREATE TABLE recurrences (
  id             TEXT PRIMARY KEY,
  scope_id       TEXT NOT NULL REFERENCES scopes(id) ON DELETE CASCADE,
  template_task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,  -- the is_series_template row
  rrule          TEXT NOT NULL,               -- 'FREQ=WEEKLY;BYDAY=MO,TH' (no DTSTART inside)
  dtstart        TEXT NOT NULL,               -- ISO instant or 'YYYY-MM-DD' for all-day series
  timezone       TEXT NOT NULL,               -- IANA; the rule is expanded in THIS zone
  is_all_day     INTEGER NOT NULL DEFAULT 1,
  anchor         TEXT NOT NULL DEFAULT 'schedule'
                   CHECK (anchor IN ('schedule','completion')),   -- §3.5
  exdates        TEXT NOT NULL DEFAULT '[]',  -- JSON array of skipped RECURRENCE-ID values
  rdates         TEXT NOT NULL DEFAULT '[]',  -- JSON array of extra occurrences
  until_at       TEXT,                        -- series split point / RRULE UNTIL mirror
  count_total    INTEGER,                     -- RRULE COUNT mirror
  materialized_through TEXT,                  -- last date we generated instances up to
  max_instances  INTEGER NOT NULL DEFAULT 200,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  deleted_at     TEXT,
  CHECK (json_valid(exdates) AND json_valid(rdates))
);
CREATE INDEX idx_recurrences_materialize ON recurrences(materialized_through)
  WHERE deleted_at IS NULL;
```

**Non-obvious**

- **`rrule` stores the rule only, `dtstart` and `timezone` are separate columns.** RFC 5545
  puts `DTSTART` outside `RRULE` too. Keeping them apart means you can change the start time
  without string-editing the rule, and it forces you to always pass a `*time.Location` to
  `rrule-go`.
- **`materialized_through`** is the whole scheduler contract: the job selects
  `WHERE materialized_through < :horizon` and does the minimum work. Without it, the job
  re-expands every series every run.
- `anchor='completion'` series must have `materialized_through` left NULL and are advanced
  only by the completion handler.
- `max_instances` protects against a user pasting `FREQ=SECONDLY`.

## 5.7 Audit, sharing, sync, AI, settings, jobs

```sql
-- ---------------------------------------------------------- activity_log
-- Human-readable history, shown in the task detail panel. Distinct from change_log,
-- which is machine sync. Do NOT merge them: they have different retention and
-- different volume, and merging makes the UI query scan sync noise.
CREATE TABLE activity_log (
  id            TEXT PRIMARY KEY,
  scope_id      TEXT NOT NULL REFERENCES scopes(id) ON DELETE CASCADE,
  project_id    TEXT,
  entity_type   TEXT NOT NULL,     -- 'task','checklist','project','scope','share','source'
  entity_id     TEXT NOT NULL,
  action        TEXT NOT NULL,     -- 'created','status_changed','assigned','commented',
                                   -- 'due_changed','completed','ai_run','synced','day_rollover'
  actor_kind    TEXT NOT NULL
                  CHECK (actor_kind IN ('user','ai','system','caldav','share_guest')),
  actor_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_label   TEXT,              -- guest name, or source name, for non-user actors
  via_token_id  TEXT REFERENCES api_tokens(id) ON DELETE SET NULL,
  ai_run_id     TEXT REFERENCES ai_runs(id) ON DELETE SET NULL,
  field         TEXT,              -- 'status', 'due_date', ...
  old_value     TEXT,
  new_value     TEXT,
  metadata      TEXT,              -- JSON
  at            TEXT NOT NULL,
  CHECK (metadata IS NULL OR json_valid(metadata))
);
CREATE INDEX idx_activity_entity ON activity_log(entity_type, entity_id, at DESC);
CREATE INDEX idx_activity_scope  ON activity_log(scope_id, at DESC);
CREATE INDEX idx_activity_actor  ON activity_log(actor_kind, actor_id, at DESC);
CREATE INDEX idx_activity_ai     ON activity_log(ai_run_id) WHERE ai_run_id IS NOT NULL;
```

**Non-obvious**

- **`activity_log` ≠ `change_log`.** `change_log` (§3.6) is the sync cursor: one row per
  mutation, retained 180 days, never shown to users. `activity_log` is the story: field-level
  diffs, retained forever, rendered in the UI, and it is the **audit trail of every AI
  change** the product requires. Merging them looks like DRY and is a mistake.
- `old_value`/`new_value` as TEXT, not JSON blobs of the whole row. The panel renders
  "Pau ha mogut «Comprar pa» de Per fer a Fent"; storing whole rows makes that a parsing job.
- `ai_run_id` links a batch of changes to one AI invocation, so the UI can show
  "L'assistent ha fet 4 canvis" collapsible.

```sql
-- ---------------------------------------------------------------- shares
CREATE TABLE shares (
  id               TEXT PRIMARY KEY,
  token_hash       TEXT NOT NULL,             -- SHA-256 of a 128-bit random, base62 (22 chars)
  slug             TEXT NOT NULL,             -- short public id used in the URL path
  kind             TEXT NOT NULL CHECK (kind IN ('task','checklist')),
  task_id          TEXT REFERENCES tasks(id)      ON DELETE CASCADE,
  checklist_id     TEXT REFERENCES checklists(id) ON DELETE CASCADE,
  scope_id         TEXT NOT NULL REFERENCES scopes(id) ON DELETE CASCADE,
  include_subtasks INTEGER NOT NULL DEFAULT 1,
  permission       TEXT NOT NULL DEFAULT 'view'
                     CHECK (permission IN ('view','check','comment','edit')),
  password_hash    TEXT,                      -- Argon2id (user-chosen -> slow KDF REQUIRED)
  require_name     INTEGER NOT NULL DEFAULT 0,
  expires_at       TEXT,
  max_views        INTEGER,
  view_count       INTEGER NOT NULL DEFAULT 0,
  created_by       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  revoked_at       TEXT,
  CHECK ((kind = 'task') = (task_id IS NOT NULL)),
  CHECK ((kind = 'checklist') = (checklist_id IS NOT NULL))
);
CREATE UNIQUE INDEX ux_shares_token ON shares(token_hash);
CREATE UNIQUE INDEX ux_shares_slug  ON shares(slug);
CREATE INDEX idx_shares_expiry ON shares(expires_at) WHERE revoked_at IS NULL AND expires_at IS NOT NULL;

-- --------------------------------------------------------- share_accesses
CREATE TABLE share_accesses (
  id             TEXT PRIMARY KEY,
  share_id       TEXT NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
  guest_name     TEXT,                        -- captured when shares.require_name = 1
  guest_key      TEXT NOT NULL,               -- random id in a cookie; identifies a returning guest
  ip_hash        TEXT,                        -- HMAC(ip, pepper)
  user_agent     TEXT,
  country        TEXT,
  first_seen_at  TEXT NOT NULL,
  last_seen_at   TEXT NOT NULL,
  view_count     INTEGER NOT NULL DEFAULT 1,
  action_count   INTEGER NOT NULL DEFAULT 0,  -- items ticked, comments added
  password_ok_at TEXT
);
CREATE UNIQUE INDEX ux_share_accesses ON share_accesses(share_id, guest_key);
CREATE INDEX idx_share_accesses_share ON share_accesses(share_id, last_seen_at DESC);
```

**Non-obvious**

- **`slug` and `token_hash` are different things.** The URL is `/s/<slug>` where `slug` is a
  short public identifier; the *secret* is a separate token in the fragment or a query param
  — or, simpler and recommended: `slug` **is** the secret (22 base62 chars = 128 bits), you
  store only its SHA-256 as `token_hash`, and `slug` column holds a **non-secret prefix** for
  display in the owner's share list. Pick one and be explicit; ambiguity here is a security
  bug.
- **`password_hash` uses Argon2id, unlike every other hash in this schema**, because it is
  user-chosen and low-entropy. OWASP's current minimum: **Argon2id m=19456 (19 MiB), t=2,
  p=1**; equivalent alternatives are m=47104/t=1/p=1, m=12288/t=3/p=1, m=9216/t=4/p=1,
  m=7168/t=5/p=1. Same parameters for `users.password_hash`. (If you must use bcrypt: work
  factor ≥10 and enforce a 72-byte max password length. scrypt fallback: N=2^17, r=8, p=1.)
- **Rate-limit password attempts per `share_id`**, not per IP — a shared family link is hit
  from one NAT.
- `permission='check'` is the checklist case: guests can tick items but not edit text. This
  is the main reason `checklist_items.checked_by_guest` exists.
- Public share pages must send `X-Robots-Tag: noindex, nofollow` and
  `Referrer-Policy: no-referrer`, and must never include the raw token in a redirect
  `Location`.

```sql
-- ------------------------------------------------------ calendar_sources
-- Fem-ho AS A CLIENT: external calendars we sync with.
CREATE TABLE calendar_sources (
  id               TEXT PRIMARY KEY,
  scope_id         TEXT NOT NULL REFERENCES scopes(id)   ON DELETE CASCADE,
  project_id       TEXT          REFERENCES projects(id) ON DELETE SET NULL,
  owner_id         TEXT NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  name             TEXT NOT NULL,
  kind             TEXT NOT NULL CHECK (kind IN ('caldav','ics_url')),
  base_url         TEXT NOT NULL,
  principal_url    TEXT,                      -- discovered DAV:current-user-principal
  home_set_url     TEXT,                      -- discovered CALDAV:calendar-home-set
  collection_url   TEXT,                      -- the specific calendar collection
  auth_kind        TEXT NOT NULL DEFAULT 'basic'
                     CHECK (auth_kind IN ('none','basic','bearer','oauth2')),
  username         TEXT,
  secret_enc       BLOB,                      -- AES-256-GCM, key from FEMHO_SECRET_KEY
  secret_nonce     BLOB,
  direction        TEXT NOT NULL DEFAULT 'both'
                     CHECK (direction IN ('pull','push','both')),
  component_kinds  TEXT NOT NULL DEFAULT '["VTODO"]',   -- JSON: VTODO and/or VEVENT
  poll_interval_s  INTEGER NOT NULL DEFAULT 900,
  enabled          INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  deleted_at       TEXT,
  CHECK (json_valid(component_kinds))
);
CREATE INDEX idx_calendar_sources_scope ON calendar_sources(scope_id) WHERE deleted_at IS NULL;

-- --------------------------------------------------- calendar_sync_state
CREATE TABLE calendar_sync_state (
  source_id          TEXT PRIMARY KEY REFERENCES calendar_sources(id) ON DELETE CASCADE,
  ctag               TEXT,                    -- CS:getctag, cheap change probe
  sync_token         TEXT,                    -- DAV:sync-token from RFC 6578
  last_poll_at       TEXT,
  last_success_at    TEXT,
  next_poll_at       TEXT NOT NULL,
  consecutive_errors INTEGER NOT NULL DEFAULT 0,
  backoff_until      TEXT,
  last_error         TEXT,
  objects_seen       INTEGER NOT NULL DEFAULT 0,
  full_resync_needed INTEGER NOT NULL DEFAULT 1,
  updated_at         TEXT NOT NULL
);
CREATE INDEX idx_sync_state_next ON calendar_sync_state(next_poll_at);
```

**Non-obvious**

- **`secret_enc` is encrypted at rest**, not plaintext, and not hashed (you must be able to
  *use* the password to authenticate to the remote). AES-256-GCM with a key derived from a
  `FEMHO_SECRET_KEY` env var. If the key is missing, refuse to start rather than silently
  storing plaintext.
- **Two-phase change detection.** `ctag` first (a single `PROPFIND` returning one property —
  cheap, works on every server); only if it changed, do a `REPORT sync-collection` with
  `sync_token`. Servers that do not support sync-collection reply `403` with
  `DAV:valid-sync-token` or do not advertise it — fall back to a `PROPFIND Depth:1` ETag
  diff. Track that fallback in `full_resync_needed`.
- **`backoff_until` + `consecutive_errors`**: exponential backoff capped at ~6 h. A
  self-hoster whose Nextcloud is down must not generate a request every 15 minutes forever.
- `direction='pull'` sources set `tasks.readonly=1`; the API rejects writes with `409`.

```sql
-- ---------------------------------------------------- caldav_collections
-- Fem-ho AS A SERVER: the calendars DAVx5/Apple see.
CREATE TABLE caldav_collections (
  id            TEXT PRIMARY KEY,
  owner_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope_id      TEXT NOT NULL REFERENCES scopes(id) ON DELETE CASCADE,
  project_id    TEXT REFERENCES projects(id) ON DELETE CASCADE,   -- NULL = whole scope
  path_segment  TEXT NOT NULL,               -- URL-safe: '/dav/<user>/<path_segment>/'
  display_name  TEXT NOT NULL,               -- 'Família — Compres'
  description   TEXT,
  color         TEXT,                        -- Apple CS:calendar-color '#RRGGBBFF'
  components    TEXT NOT NULL DEFAULT '["VTODO"]',
  ctag          TEXT NOT NULL,               -- bumped on ANY member change
  sync_seq      INTEGER NOT NULL DEFAULT 0,  -- mirrors max(change_log.seq) at last bump
  enabled       INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT,
  CHECK (json_valid(components))
);
CREATE UNIQUE INDEX ux_caldav_collections ON caldav_collections(owner_id, path_segment)
  WHERE deleted_at IS NULL;

-- ---------------------------------------------------------- caldav_objects
-- One row per .ics resource we serve. Cache + name stability.
CREATE TABLE caldav_objects (
  id             TEXT PRIMARY KEY,
  collection_id  TEXT NOT NULL REFERENCES caldav_collections(id) ON DELETE CASCADE,
  object_name    TEXT NOT NULL,              -- '<ical_uid>.ics'
  task_id        TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  ical_uid       TEXT NOT NULL,
  etag           TEXT NOT NULL,
  ics_cache      TEXT,                       -- generated VCALENDAR text
  ics_size       INTEGER,
  component_kind TEXT NOT NULL DEFAULT 'VTODO',
  change_seq     INTEGER NOT NULL,           -- change_log.seq at generation time
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  deleted_at     TEXT,                       -- tombstone: reported as 404 in sync-collection
  deleted_seq    INTEGER
);
CREATE UNIQUE INDEX ux_caldav_objects ON caldav_objects(collection_id, object_name);
CREATE INDEX idx_caldav_objects_sync ON caldav_objects(collection_id, change_seq);
CREATE INDEX idx_caldav_objects_task ON caldav_objects(task_id);
```

**Non-obvious**

- **`caldav_objects` rows are kept after deletion** (`deleted_at` + `deleted_seq`) because
  RFC 6578 requires reporting removed members as `404` responses in the sync multistatus.
  Purge them only after the `change_log` retention window.
- **`object_name` must never change** once a client has seen it. Derive it from `ical_uid`,
  which is immutable.
- **`ics_cache`** avoids re-serialising on every `calendar-multiget`; invalidate by comparing
  `change_seq` to the task's latest `change_log.seq`.
- `ctag` on the collection is a cheap `getctag` answer; bump it (new random) inside the same
  transaction as any member write.
- One collection **per scope**, plus optionally **per project** — which is exactly the
  product requirement "bidirectional CalDAV (per scope, per project)". Generate scope-level
  collections automatically; make project-level ones opt-in per project, or DAVx⁵ users with
  30 projects get 30 calendars.

```sql
-- ------------------------------------------------------- ai_instructions
-- Standing instructions the AI reads before acting. The "prompt" side of the AI user.
CREATE TABLE ai_instructions (
  id           TEXT PRIMARY KEY,
  level        TEXT NOT NULL CHECK (level IN ('instance','user','scope','project','task')),
  scope_id     TEXT REFERENCES scopes(id)   ON DELETE CASCADE,
  project_id   TEXT REFERENCES projects(id) ON DELETE CASCADE,
  task_id      TEXT REFERENCES tasks(id)    ON DELETE CASCADE,
  user_id      TEXT REFERENCES users(id)    ON DELETE CASCADE,
  title        TEXT,
  body         TEXT NOT NULL,               -- markdown; injected into MCP resource/prompt
  priority     INTEGER NOT NULL DEFAULT 0,  -- higher wins on conflict
  enabled      INTEGER NOT NULL DEFAULT 1,
  created_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  deleted_at   TEXT
);
CREATE INDEX idx_ai_instructions_scope ON ai_instructions(scope_id, priority DESC)
  WHERE enabled = 1 AND deleted_at IS NULL;

-- --------------------------------------------------------------- ai_runs
CREATE TABLE ai_runs (
  id              TEXT PRIMARY KEY,
  task_id         TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  scope_id        TEXT REFERENCES scopes(id) ON DELETE CASCADE,
  token_id        TEXT REFERENCES api_tokens(id) ON DELETE SET NULL,
  trigger         TEXT NOT NULL CHECK (trigger IN ('user','schedule','webhook','mcp','api')),
  surface         TEXT NOT NULL CHECK (surface IN ('mcp','rest')),
  tool_name       TEXT,                      -- 'create_task', 'search_tasks', ...
  request_summary TEXT,
  request_json    TEXT,
  result_summary  TEXT,
  result_json     TEXT,
  status          TEXT NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running','succeeded','failed','cancelled','needs_review')),
  error           TEXT,
  changes_count   INTEGER NOT NULL DEFAULT 0,
  started_at      TEXT NOT NULL,
  finished_at     TEXT,
  duration_ms     INTEGER,
  CHECK (request_json IS NULL OR json_valid(request_json)),
  CHECK (result_json  IS NULL OR json_valid(result_json))
);
CREATE INDEX idx_ai_runs_task  ON ai_runs(task_id, started_at DESC);
CREATE INDEX idx_ai_runs_scope ON ai_runs(scope_id, started_at DESC);
CREATE INDEX idx_ai_runs_token ON ai_runs(token_id, started_at DESC);
```

**Non-obvious**

- **`ai_instructions.level` with a 5-level hierarchy** and `priority` resolves as
  instance < user < scope < project < task, with `priority` breaking ties. Resolve in Go,
  concatenate the winning set, and expose it as an **MCP resource** (`femho://instructions`)
  so the external model reads it as context rather than you smuggling it into tool
  descriptions.
- **`ai_runs` is the required audit spine.** Every MCP tool call opens a run; every mutation
  it makes writes `activity_log` rows carrying `ai_run_id`; the UI can then show and *undo*
  a whole run. Build the "undo run" endpoint early — it is the feature that makes users
  comfortable with `ai_mode='delegated'`.
- `request_json`/`result_json` can be large. Cap at ~64 KB and truncate with a marker; do not
  let an MCP transcript bloat the SQLite file.

```sql
-- -------------------------------------------------------------- settings
-- Key/value with an explicit ownership axis. One table, not five.
CREATE TABLE settings (
  id         TEXT PRIMARY KEY,
  level      TEXT NOT NULL CHECK (level IN ('instance','user','scope','project')),
  owner_id   TEXT,                          -- user_id / scope_id / project_id; NULL for instance
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,                 -- JSON scalar or object
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL,
  CHECK (json_valid(value)),
  CHECK ((level = 'instance') = (owner_id IS NULL))
);
CREATE UNIQUE INDEX ux_settings ON settings(level, COALESCE(owner_id,''), key);
```

Known keys (document them; an AI editing this app needs the list):
`rollover_mode` (`virtual|rewrite`), `recurrence_horizon_days` (60), `change_log_retention_days`
(180), `attachment_max_bytes` (26214400), `attachment_allow_inline_mimes` (JSON array),
`caldav_project_collections` (bool), `share_default_expiry_days`, `ai_enabled`,
`ai_require_review` (bool), `tzdata_version`, `week_start`, `search_language` (`ca`),
`smtp_*`, `push_*`.

```sql
-- -------------------------------------------------------------- webhooks
CREATE TABLE webhooks (
  id             TEXT PRIMARY KEY,
  scope_id       TEXT REFERENCES scopes(id) ON DELETE CASCADE,  -- NULL = instance-wide
  name           TEXT NOT NULL,
  url            TEXT NOT NULL,
  secret         TEXT NOT NULL,             -- HMAC-SHA256 signing key
  events         TEXT NOT NULL,             -- JSON array: ['task.created','task.completed',...]
  active         INTEGER NOT NULL DEFAULT 1,
  headers        TEXT,                      -- JSON object of extra headers
  failure_count  INTEGER NOT NULL DEFAULT 0,
  disabled_at    TEXT,                      -- auto-disabled after N consecutive failures
  last_status    INTEGER,
  last_error     TEXT,
  last_delivery_at TEXT,
  created_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  deleted_at     TEXT,
  CHECK (json_valid(events)),
  CHECK (headers IS NULL OR json_valid(headers))
);
CREATE INDEX idx_webhooks_active ON webhooks(scope_id) WHERE active = 1 AND deleted_at IS NULL;

CREATE TABLE webhook_deliveries (
  id            TEXT PRIMARY KEY,
  webhook_id    TEXT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event         TEXT NOT NULL,
  payload       TEXT NOT NULL,
  attempt       INTEGER NOT NULL DEFAULT 1,
  status_code   INTEGER,
  response_body TEXT,                       -- truncated to 2 KB
  error         TEXT,
  duration_ms   INTEGER,
  delivered_at  TEXT,
  next_retry_at TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_webhook_deliveries_retry ON webhook_deliveries(next_retry_at)
  WHERE delivered_at IS NULL AND next_retry_at IS NOT NULL;
```

**Non-obvious**

- Sign with `X-Femho-Signature: sha256=<hex hmac of the raw body>` and
  `X-Femho-Delivery: <id>`, `X-Femho-Event: <event>`, `X-Femho-Timestamp: <unix>`. Include
  the timestamp *inside* the signed payload to prevent replay.
- **SSRF is the real risk in a self-hosted app**: a family member can point a webhook at
  `http://192.168.1.1/admin`. Resolve the hostname, reject RFC 1918 / loopback / link-local /
  IPv6 ULA destinations unless `FEMHO_ALLOW_PRIVATE_WEBHOOKS=1`, and re-check after redirect.
- Auto-disable after 20 consecutive failures and surface it in the UI.

```sql
-- ------------------------------------------------------------------ jobs
-- Durable, retryable background work. Same SQLite file, single leader (§8).
CREATE TABLE jobs (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,             -- 'reminder.dispatch','caldav.poll','webhook.deliver',...
  payload       TEXT NOT NULL DEFAULT '{}',
  dedupe_key    TEXT,                      -- NULL or a unique key to collapse duplicates
  run_at        TEXT NOT NULL,
  priority      INTEGER NOT NULL DEFAULT 0,
  attempts      INTEGER NOT NULL DEFAULT 0,
  max_attempts  INTEGER NOT NULL DEFAULT 8,
  locked_by     TEXT,                      -- worker id
  locked_until  TEXT,
  state         TEXT NOT NULL DEFAULT 'pending'
                  CHECK (state IN ('pending','running','done','failed','cancelled')),
  last_error    TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  finished_at   TEXT,
  CHECK (json_valid(payload))
);
CREATE INDEX idx_jobs_ready ON jobs(run_at, priority DESC)
  WHERE state = 'pending';
CREATE UNIQUE INDEX ux_jobs_dedupe ON jobs(kind, dedupe_key)
  WHERE dedupe_key IS NOT NULL AND state IN ('pending','running');

-- ------------------------------------------------------------ job_markers
-- Idempotency for timezone-sensitive periodic work (§4.4).
CREATE TABLE job_markers (
  job_kind   TEXT NOT NULL,
  timezone   TEXT NOT NULL,
  local_date TEXT NOT NULL,
  ran_at     TEXT NOT NULL,
  PRIMARY KEY (job_kind, timezone, local_date)
);
```

The claim step, written so it is correct under SQLite's single-writer model:

```sql
-- inside BEGIN IMMEDIATE
UPDATE jobs
   SET state='running', locked_by=:worker, locked_until=:now_plus_5m,
       attempts=attempts+1, updated_at=:now
 WHERE id = (
   SELECT id FROM jobs
    WHERE state='pending' AND run_at <= :now
    ORDER BY priority DESC, run_at
    LIMIT 1
 )
RETURNING id, kind, payload, attempts;
```

`RETURNING` is supported in SQLite 3.35+ (you have 3.53.3 via modernc v1.56.0) and in
Postgres, so this statement is portable as written.

---

# PART 6 — REALTIME AND DELTA SYNC

## 6.1 SSE, not WebSocket

Choose **Server-Sent Events** for server→client push:

- It is plain HTTP `text/event-stream`; every reverse proxy, Cloudflare tunnel and
  corporate firewall a self-hoster will put in front of Fem-ho handles it.
- Automatic reconnection with `Last-Event-ID` is built into the browser `EventSource` API —
  and that header maps **exactly** onto `change_log.seq`. You get resumable sync for free.
- Client→server traffic is already REST; you do not need a bidirectional channel.
- Go implementation is ~40 lines with `http.Flusher`; no library, no upgrade handshake, no
  ping/pong keepalive protocol to get wrong.

Add a WebSocket **only** if you later build collaborative text editing or presence
indicators. `github.com/coder/websocket` is the current maintained choice (successor to
`nhooyr.io/websocket`).

```go
func (s *Server) handleEvents(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no") // nginx: do not buffer SSE
	flusher, ok := w.(http.Flusher)
	if !ok { http.Error(w, "streaming unsupported", 500); return }

	since := parseSeq(r.Header.Get("Last-Event-ID"), r.URL.Query().Get("since"))
	sub := s.bus.Subscribe(userID, scopeIDs) // in-process fan-out
	defer s.bus.Unsubscribe(sub)

	// 1. Catch-up from the durable log, so no event is ever missed across a reconnect.
	for _, ev := range s.store.ChangesSince(r.Context(), scopeIDs, since, 500) {
		writeSSE(w, ev.Seq, "change", ev)
	}
	flusher.Flush()

	// 2. Live tail.
	keepalive := time.NewTicker(25 * time.Second)
	defer keepalive.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case ev := <-sub.C:
			writeSSE(w, ev.Seq, "change", ev); flusher.Flush()
		case <-keepalive.C:
			io.WriteString(w, ": ping\n\n"); flusher.Flush()
		}
	}
}

func writeSSE(w io.Writer, id int64, event string, v any) {
	b, _ := json.Marshal(v)
	fmt.Fprintf(w, "id: %d\nevent: %s\ndata: %s\n\n", id, event, b)
}
```

The catch-up-then-tail pattern is the important part: without step 1, every reconnect has a
race window where a change is published to the bus but not yet delivered, and the client
silently diverges. With `change_log` as the source of truth, the client's cursor is exact.

The 25-second `: ping` comment line keeps idle proxies from timing the connection out
(nginx default `proxy_read_timeout` is 60 s).

## 6.2 The delta sync endpoint (Android)

```http
GET /api/v1/sync?since=41827&scopes=0192a...,0192b...&limit=500
Authorization: Bearer femho_api_...

200 OK
{
  "cursor": 42019,
  "has_more": false,
  "reset": false,
  "entities": {
    "tasks":           [ {...full row...}, {"id":"0192...","deleted":true,"deleted_at":"..."} ],
    "checklists":      [ ... ],
    "checklist_items": [ ... ],
    "projects":        [ ... ],
    "scopes":          [ ... ],
    "task_assignees":  [ ... ]
  },
  "server_time": "2026-08-05T09:12:33.123Z"
}
```

Rules:
- `since=0` (or omitted) = full snapshot for the requested scopes.
- If `since` is older than the oldest retained `change_log.seq`, reply `200` with
  `"reset": true` and a full snapshot — do **not** 409; a 409 makes the Android client
  write error-handling code that a boolean makes unnecessary.
- **The response must be built from a single read transaction** so `cursor` and the payload
  are consistent. In SQLite that means one `BEGIN DEFERRED` on the read pool.
- The client uploads with `POST /api/v1/sync` carrying rows it changed offline, each with its
  own client-generated UUIDv7 `id` and a `base_updated_at`. Conflict rule: **last-writer-wins
  per field**, with the exception that `status`, `completed_at` and `deleted_at` use
  **server-wins-on-tie** and any conflict writes an `activity_log` entry. Field-level LWW
  (not row-level) is what stops "Aina added a due date offline" from wiping "Pau renamed it
  online".

## 6.3 Where `change_log` rows get written

One helper, called inside every mutating repository method, in the same transaction:

```go
func (r *repo) recordChange(ctx context.Context, tx *sql.Tx, c Change) (int64, error) {
	res, err := tx.ExecContext(ctx, `
		INSERT INTO change_log(entity_type, entity_id, op, scope_id, project_id,
		                       actor_kind, actor_id, via_token_id, at)
		VALUES (?,?,?,?,?,?,?,?,?)`,
		c.EntityType, c.EntityID, c.Op, c.ScopeID, c.ProjectID,
		c.ActorKind, c.ActorID, c.ViaTokenID, nowISO())
	if err != nil { return 0, err }
	return res.LastInsertId()
}
```

Then, **after** the transaction commits (never inside it), publish to the SSE bus and bump
the affected `caldav_collections.ctag`. Publishing inside the transaction means subscribers
can observe a change that later rolls back.

---

# PART 7 — CALDAV WIRING (what the schema has to support)

## 7.1 URL layout

```
/.well-known/caldav                     -> 301 to /dav/            (RFC 6764)
/dav/                                   -> principal discovery
/dav/principals/<user-slug>/            -> DAV:current-user-principal target
/dav/calendars/<user-slug>/             -> CALDAV:calendar-home-set
/dav/calendars/<user-slug>/<coll>/      -> a caldav_collections row
/dav/calendars/<user-slug>/<coll>/<uid>.ics
```

RFC 6764 requires `/.well-known/caldav` to redirect to the real context path with **301,
303 or 307**. Use **301** — DAVx⁵ and Apple both cache it happily. Also publish SRV records
in the docs for users with their own domain:

```
_caldavs._tcp.example.org. 3600 IN SRV 0 1 443 femho.example.org.
_caldavs._tcp.example.org. 3600 IN TXT "path=/dav/"
```

Client bootstrap sequence you must satisfy, per RFC 6764: SRV lookup → TXT `path` (else
`/.well-known/caldav`) → authenticated `PROPFIND` for `DAV:current-user-principal` →
`PROPFIND` the principal for `CALDAV:calendar-home-set` → `PROPFIND Depth:1` the home set to
enumerate calendars.

## 7.2 Properties you must answer

On the collection:
- `DAV:resourcetype` → `<D:collection/><C:calendar/>`
- `DAV:displayname` → `caldav_collections.display_name`
- `CALDAV:supported-calendar-component-set` → `<C:comp name="VTODO"/>` (and `VEVENT` if
  enabled). **Apple Reminders will not show a calendar that omits `VTODO`.**
- `CALDAV:calendar-description`, `CALDAV:max-resource-size` (`Calendar.MaxResourceSize` in
  go-webdav), `CALDAV:supported-calendar-data`
- `CS:getctag` (`http://calendarserver.org/ns/`) → `caldav_collections.ctag`
- `DAV:sync-token` → `urn:femho:sync:<sync_seq>`
- `ICAL:calendar-color` / `CS:calendar-color` → `caldav_collections.color` as `#RRGGBBFF`
- `DAV:current-user-privilege-set` → derived from `scope_members.role`
- `DAV:supported-report-set` → `calendar-query`, `calendar-multiget`, `sync-collection`

On objects: `DAV:getetag`, `DAV:getcontenttype` (`text/calendar; charset=utf-8;
component=vtodo`), `CALDAV:calendar-data`.

## 7.3 `sync-collection` — the piece go-webdav v0.7.0 does not give you

Request (RFC 6578; `DAV:sync-token`, `DAV:sync-level`, `DAV:prop` mandatory, `DAV:limit`
optional):

```xml
<D:sync-collection xmlns:D="DAV:">
  <D:sync-token>urn:femho:sync:41827</D:sync-token>
  <D:sync-level>1</D:sync-level>
  <D:limit><D:nresults>500</D:nresults></D:limit>
  <D:prop><D:getetag/></D:prop>
</D:sync-collection>
```

Answer it straight from `caldav_objects` joined to `change_log`:

```sql
SELECT object_name, etag, deleted_at, MAX(change_seq, COALESCE(deleted_seq,0)) AS seq
  FROM caldav_objects
 WHERE collection_id = :coll
   AND MAX(change_seq, COALESCE(deleted_seq,0)) > :since_seq
 ORDER BY seq
 LIMIT :limit;
```

Serialise:

```xml
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>/dav/calendars/pau/familia/0192abc.ics</D:href>
    <D:propstat>
      <D:prop><D:getetag>"a1b2c3"</D:getetag></D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
  <D:response>
    <D:href>/dav/calendars/pau/familia/0192def.ics</D:href>
    <D:status>HTTP/1.1 404 Not Found</D:status>   <!-- removed member -->
  </D:response>
  <D:sync-token>urn:femho:sync:42019</D:sync-token>
</D:multistatus>
```

Required behaviours from RFC 6578:
- **Empty `<D:sync-token/>`** → return **all** member URLs (initial sync).
- **Truncated results** → include a `DAV:response` with status **507 Insufficient Storage**
  and a `DAV:error` containing `DAV:number-of-matches-within-limits`; return a sync-token
  representing the partial state so the client can page.
- **Unrecognised/expired token** → `403 Forbidden` with `DAV:valid-sync-token`, forcing a
  full resync.
- `DAV:sync-level` must be `1` or `infinite`; a child collection that cannot report gets
  `403`.

## 7.4 VTODO mapping table (RFC 5545 §3.6.2)

RFC 5545 constrains VTODO: `DTSTART`, `DUE`, `DURATION`, `COMPLETED`, `PERCENT-COMPLETE`,
`STATUS`, `PRIORITY`, `RRULE` may each appear at most once, and **"`DUE` and `DURATION`
MUST NOT occur in the same `VTODO`"** — which is why `tasks` has the
`CHECK (NOT (due_at IS NOT NULL AND duration_seconds IS NOT NULL))`.

| Fem-ho column | VTODO property | Notes |
|---|---|---|
| `ical_uid` | `UID` | immutable |
| `title` | `SUMMARY` | |
| `description` + checklist fence | `DESCRIPTION` | §3.2 |
| `status` | `STATUS` | `NEEDS-ACTION`/`IN-PROCESS`/`COMPLETED`/`CANCELLED` only |
| `status='inbox'` | `X-FEMHO-STATUS:inbox` | preserves the 4th column |
| `completed_at` | `COMPLETED` | **must be UTC** |
| `percent_complete` | `PERCENT-COMPLETE` | 100 when done |
| `due_date` | `DUE;VALUE=DATE` | |
| `due_at`+`due_tz` | `DUE;TZID=` or `DUE:...Z` | |
| `start_date`/`start_at` | `DTSTART` | |
| `duration_seconds` | `DURATION` | XOR with `DUE` |
| `priority` | `PRIORITY` | 1–9; 0 → omit |
| labels | `CATEGORIES` | comma list |
| `parent_task_id` | `RELATED-TO;RELTYPE=PARENT` | |
| relations | `RELATED-TO;RELTYPE=SIBLING`, `X-FEMHO-RELATION` | |
| `recurrences.rrule` | `RRULE` (+ `EXDATE`, `RDATE`) | with `DTSTART;TZID=` |
| `recurrence_instance_date` | `RECURRENCE-ID` | overrides only |
| `reminders` | `VALARM` (`TRIGGER`, `ACTION:DISPLAY`) | |
| `task_assignees` | `ATTENDEE` + `X-FEMHO-ASSIGNEE` | most task clients ignore ATTENDEE |
| `created_at` / `updated_at` | `CREATED` / `LAST-MODIFIED` / `DTSTAMP` | |
| `ical_sequence` | `SEQUENCE` | bump on published change |
| `attachments` | `ATTACH;VALUE=URI` (signed URL) | optional; §10.4 |

Emit `PRODID:-//Fem-ho//Fem-ho <version>//CA` and `VERSION:2.0`, and always
`CALSCALE:GREGORIAN`.

## 7.5 Client compatibility targets

Vikunja's documented results are the best available prior: **working** with Evolution,
OpenTasks, DAVx⁵, Tasks (Android), KOrganizer; **not working** with Thunderbird 68 and iOS
CalDAV Sync. Test Fem-ho against, in priority order:

1. **DAVx⁵ + Tasks.org** (Android) — the pairing most self-hosters use, and Fem-ho already
   ships an Android app, so this is the interop story.
2. **Apple Reminders** (macOS/iOS) — strictest about `supported-calendar-component-set` and
   about `VTODO` collections not also containing `VEVENT`. **Recommendation: serve
   `VTODO`-only collections by default**, with `VEVENT` as an opt-in second collection.
3. **Thunderbird** — historically the worst; treat failures as low priority.
4. **Nextcloud Tasks / Evolution / KOrganizer**.

---

# PART 8 — BACKGROUND JOBS

## 8.1 The scheduler choice, per stack

| Stack | Recommended | Why |
|---|---|---|
| **Go (chosen)** | **In-process ticker loop + the `jobs` table above**, optionally `github.com/go-co-op/gocron` for cron expressions | Single binary = single leader. No Redis, no Postgres, no second container. |
| Go, if you had Postgres | `riverqueue/river` — transaction-safe enqueue, periodic + cron jobs, PostgreSQL-backed | Excellent, but **Postgres-only**; it does not fit the SQLite default |
| Go, if you had Redis | `asynq` | Redis-backed; another container for self-hosters to run |
| Node/TS | `node-cron` + a `jobs` table, or BullMQ if Redis already exists | |
| Python | APScheduler (in-process) or Celery+beat (needs a broker) | |
| Rust | `tokio-cron-scheduler` + a `jobs` table | |
| Elixir | `Oban` (Postgres) or `Quantum` | |

**Do not add Redis to a household task manager.** Every extra container is a support ticket.

## 8.2 The runner

```go
type Scheduler struct {
	store  Store
	clock  func() time.Time
	worker string // hostname+pid, written into jobs.locked_by
}

func (s *Scheduler) Run(ctx context.Context) {
	// Cron-ish: enqueue jobs; never do the work on the tick itself.
	cronTick := time.NewTicker(60 * time.Second)
	// Work: drain the jobs table.
	workTick := time.NewTicker(2 * time.Second)
	// Reclaim jobs whose lease expired (crash recovery).
	reapTick := time.NewTicker(60 * time.Second)
	...
}
```

Two-phase design (enqueue on a tick, execute from the table) is what makes the whole thing
crash-safe and observable: a restart never loses a due reminder, and `SELECT * FROM jobs
WHERE state='failed'` is your entire ops dashboard.

Lease-based locking (`locked_by` + `locked_until`) rather than a transaction held open for
the duration of the job — SQLite has one writer, so a long-held write transaction blocks the
whole app.

## 8.3 The job catalogue

| Job kind | Cadence | What it does | Idempotency key |
|---|---|---|---|
| `rollover.daily` | every 15 min | per timezone: emit `day_rollover` activity rows; optionally rewrite due dates if `rollover_mode='rewrite'`; archive done tasks older than 90 d | `job_markers(kind, tz, local_date)` |
| `recurrence.materialize` | hourly | for each `recurrences` with `anchor='schedule'` and `materialized_through < now+horizon`, expand with rrule-go and insert missing instances | `ux_tasks_series_instance` |
| `recurrence.advance` | on completion (not scheduled) | for `anchor='completion'` series, create the single next instance from `completed_at` | same unique index |
| `caldav.poll` | every 60 s, selects due sources | `PROPFIND` ctag; if changed, `REPORT sync-collection`; apply changes; push local dirty | `jobs.dedupe_key = source_id` |
| `caldav.push` | on change (enqueued) | write `sync_state='local_dirty'` tasks back with `If-Match` | `dedupe_key = task_id` |
| `reminder.dispatch` | every 30 s | `SELECT ... WHERE fire_at <= now AND fired_at IS NULL` on the partial index; send push/email; mark `fired_at` | `reminders.id` |
| `reminder.recompute` | on startup + on tzdata change | recompute all future `fire_at` | `settings.tzdata_version` |
| `share.expire` | hourly | mark shares past `expires_at`; purge `share_accesses` past retention | date marker |
| `webhook.deliver` | enqueued | HMAC-sign and POST; exponential backoff via `next_retry_at` | `webhook_deliveries.id` |
| `attachment.gc` | daily | delete blobs with `ref_count=0` older than 24 h; unlink files | — |
| `changelog.purge` | daily | delete `change_log` older than retention; purge `caldav_objects` tombstones | — |
| `fts.optimize` | weekly | `INSERT INTO tasks_fts(tasks_fts) VALUES('optimize')` | — |
| `db.backup` | daily | `VACUUM INTO '/data/backups/femho-<date>.db'`; prune to N copies | date marker |
| `integrity.check` | weekly | `PRAGMA foreign_key_check`, `PRAGMA integrity_check`, recompute checklist counters, verify `all_day` consistency | — |

**Backoff formula** (use it for CalDAV polling and webhooks alike):
`delay = min(6h, 30s * 2^(attempts-1)) * jitter(0.8..1.2)`.

**A note on `VACUUM INTO` and Litestream:** `VACUUM INTO` writes a brand-new file and does
not disturb the live DB or the WAL, so it is safe to run alongside Litestream. Plain
`VACUUM` rewrites the whole database and forces Litestream to take a full snapshot — avoid
it, or schedule it rarely and knowingly.

---

# PART 9 — SEARCH, WITH CATALAN

## 9.1 SQLite FTS5 setup

Use an **external-content** table so the text is not stored twice:

```sql
CREATE VIRTUAL TABLE tasks_fts USING fts5(
  title,
  description,
  search_text,                       -- app-normalised (§9.4)
  content = 'tasks',
  content_rowid = 'rowid',
  tokenize = "unicode61 remove_diacritics 2",
  prefix = '2 3'
);
```

- **`remove_diacritics 2`** is the correct value. Per the SQLite docs the **default is `1`**,
  which "does not remove diacritics in the fairly uncommon case where a single unicode
  codepoint is used to represent a character with more than one diacritic"; `2` "correctly
  removes diacritics from all Latin characters"; `0` disables removal entirely. Always pass
  `2` explicitly — never rely on the default.
- `prefix = '2 3'` builds prefix indexes so `col*` and `ca*` are direct lookups instead of
  range scans. Costs disk, buys instant type-ahead.
- Default `categories` for unicode61 is `'L* N* Co'` — letters, numbers, private use. That
  is right for Catalan.

**Sync triggers** (this is the one place triggers are justified — FTS5 external content
requires the delete-before-update dance and there is no cleaner option):

```sql
CREATE TRIGGER tasks_fts_ai AFTER INSERT ON tasks BEGIN
  INSERT INTO tasks_fts(rowid, title, description, search_text)
  VALUES (new.rowid, new.title, new.description, new.search_text);
END;

CREATE TRIGGER tasks_fts_ad AFTER DELETE ON tasks BEGIN
  INSERT INTO tasks_fts(tasks_fts, rowid, title, description, search_text)
  VALUES ('delete', old.rowid, old.title, old.description, old.search_text);
END;

CREATE TRIGGER tasks_fts_au AFTER UPDATE ON tasks BEGIN
  INSERT INTO tasks_fts(tasks_fts, rowid, title, description, search_text)
  VALUES ('delete', old.rowid, old.title, old.description, old.search_text);
  INSERT INTO tasks_fts(rowid, title, description, search_text)
  VALUES (new.rowid, new.title, new.description, new.search_text);
END;
```

The `('delete', rowid, <old values>)` form is mandatory: FTS5 needs the *original* column
values to remove the right postings. If they ever drift, repair with
`INSERT INTO tasks_fts(tasks_fts) VALUES('rebuild');`.

**Because these triggers exist, every 12-step SQLite table rebuild of `tasks` must
re-create them.** Put a test in CI that asserts the trigger set after migrations.

## 9.2 Querying and ranking

```sql
SELECT t.*,
       bm25(tasks_fts, 10.0, 2.0, 1.0) AS rank,          -- title 10x, description 2x
       snippet(tasks_fts, 1, '<mark>', '</mark>', '…', 20) AS excerpt
  FROM tasks_fts
  JOIN tasks t ON t.rowid = tasks_fts.rowid
 WHERE tasks_fts MATCH :q
   AND t.deleted_at IS NULL
   AND t.scope_id IN (SELECT scope_id FROM scope_members WHERE user_id = :me AND deleted_at IS NULL)
 ORDER BY rank                                            -- bm25 returns NEGATIVE; lower = better
 LIMIT 50;
```

Exact signatures confirmed from the FTS5 docs:
- `bm25(table [, w0 [, w1 ...]])` — k1=1.2, b=0.75 hard-coded; weights map left-to-right to
  columns. `ORDER BY bm25(...)` ascending because the value is negated.
- `highlight(table, column_index, open, close)` — 0-based column index.
- `snippet(table, column_index, open, close, ellipsis, max_tokens)` — `column_index = -1`
  auto-selects; `max_tokens` must be 1..64.
- Persist a default: `INSERT INTO tasks_fts(tasks_fts, rank) VALUES('rank','bm25(10.0,2.0,1.0)');`

**Escape user input.** FTS5 query syntax treats `"`, `*`, `:`, `^`, `-`, `AND`, `OR`, `NOT`,
`NEAR` specially. Wrap each user token in double quotes (doubling internal quotes) and join
with `AND`, appending `*` to the last token for type-ahead:

```go
func ftsQuery(raw string) string {
	toks := tokenizeCatalan(raw) // §9.4
	for i, t := range toks {
		toks[i] = `"` + strings.ReplaceAll(t, `"`, `""`) + `"`
	}
	if n := len(toks); n > 0 { toks[n-1] = strings.TrimSuffix(toks[n-1], `"`) + `"*` }
	return strings.Join(toks, " AND ")
}
```

## 9.3 Substring search (the `trigram` option)

If users expect "contains" behaviour (searching `legi` finding `col·legi`), add a second
FTS5 table with `tokenize="trigram"`. Trigram supports `LIKE '%x%'`/`GLOB` acceleration and
substring `MATCH`, but **substrings shorter than 3 characters never match**, and
`remove_diacritics` is only valid with `case_sensitive 0`. Recommendation: **do not ship
trigram in v1.** Prefix indexes plus the normalisation in §9.4 cover the real cases at a
fraction of the index size.

## 9.4 Catalan-specific normalisation — the part no tokenizer does for you

Four Catalan features break naive search:

1. **Accents**: `à è é í ï ò ó ú ü`. Handled by `remove_diacritics 2`.
2. **Ç / ç**: cedilla is a diacritic in the Latin mapping, so `remove_diacritics 2` folds
   `ç → c` (`caça` ≈ `caca`). *(I did not execute SQLite to confirm this specific mapping —
   **UNVERIFIED**; assert it in a unit test at build time, see the snippet below.)*
3. **Ela geminada `l·l`** — written as `l` + U+00B7 MIDDLE DOT + `l` (`col·legi`,
   `paral·lel`, `intel·ligent`). U+00B7 is Unicode category `Po`, so with the default
   `categories = 'L* N* Co'` unicode61 treats it as a **separator**: `col·legi` tokenizes as
   `col` + `legi`. A user typing `collegi` or `col·legi` then matches nothing useful.
   Also exists as precomposed `Ŀ` U+013F / `ŀ` U+0140.
4. **Elided articles/pronouns**: `l'aigua`, `d'acord`, `s'ha`, `n'hi`, `m'agrada`,
   `t'estimo`, plus the typographic apostrophe `’` U+2019. unicode61 splits on the
   apostrophe, leaving one-letter noise tokens.

### ✅ RECOMMENDATION: normalise in Go, write the result into `tasks.search_text`, and run
### the identical function over the query string.

```go
var elisions = []string{"l'", "d'", "s'", "n'", "m'", "t'", "c'"} // after apostrophe folding

// NormalizeCatalan is the single source of truth for search folding.
// It MUST be applied to indexed text and to query text identically.
func NormalizeCatalan(s string) string {
	s = strings.ToLower(s)

	// 1. Typographic punctuation -> ASCII.
	s = strings.NewReplacer(
		"’", "'", // ’ RIGHT SINGLE QUOTATION MARK
		"ʼ", "'", // ʼ MODIFIER LETTER APOSTROPHE
		"‘", "'",
	).Replace(s)

	// 2. Ela geminada -> plain double l, all three spellings.
	s = strings.NewReplacer(
		"l·l", "ll", // l·l  MIDDLE DOT
		"l‧l", "ll", // l‧l  HYPHENATION POINT (seen in some fonts/pastes)
		"ŀ", "l",    // ŀ
		"Ŀ", "l",    // Ŀ
	).Replace(s)

	// 3. Strip elided prefixes so "l'aigua" indexes as "aigua".
	//    Do it token-wise, not globally, so "d'acord" -> "acord".
	var out []string
	for _, tok := range strings.FieldsFunc(s, isSep) {
		for _, e := range elisions {
			if strings.HasPrefix(tok, e) && len(tok) > len(e) {
				tok = tok[len(e):]
				break
			}
		}
		if tok != "" { out = append(out, tok) }
	}
	s = strings.Join(out, " ")

	// 4. NFD + strip combining marks (belt-and-braces; FTS5 also folds, but the
	//    query path and the '#Scope' slug path both need it and neither goes through FTS5).
	s = removeDiacritics(s) // golang.org/x/text/unicode/norm + runes.Remove(runes.In(unicode.Mn))
	// 5. Explicit ç -> c so behaviour is ours, not the tokenizer's.
	s = strings.ReplaceAll(s, "ç", "c")
	return s
}
```

Then index `search_text` and search against it. Two consequences worth stating:

- `col·legi`, `collegi` and `colegi` all become `collegi`/`colegi` variants that a
  `prefix='2 3'` index plus a trailing `*` will match. Over-matching (`caça`/`caca`) is
  acceptable in a family task manager; under-matching is not.
- The **same function** produces `scopes.slug`, `projects.slug` and `labels.slug`, so
  `#Família` and `#familia` route identically in the quick-add parser. One function, four
  call sites, one behaviour.

Verification test to write on day one (this is how you settle the `ç` question empirically
rather than trusting this dossier):

```go
func TestFTSFolding(t *testing.T) {
	db := openMemory(t)
	mustExec(db, `CREATE VIRTUAL TABLE f USING fts5(x, tokenize="unicode61 remove_diacritics 2")`)
	mustExec(db, `INSERT INTO f(x) VALUES ('caça col·legi l''aigua Àngel')`)
	for _, q := range []string{"caca", "caça", "angel", "Àngel", "aigua"} {
		var n int
		db.QueryRow(`SELECT count(*) FROM f WHERE f MATCH ?`, q).Scan(&n)
		t.Logf("%q -> %d", q, n)   // record the ACTUAL behaviour, then assert it
	}
}
```

## 9.5 Postgres equivalent (if you ever add it)

```sql
CREATE EXTENSION IF NOT EXISTS unaccent;

-- PostgreSQL ships a catalan_stem Snowball dictionary; verify on your server with
--   SELECT cfgname FROM pg_ts_config;  SELECT dictname FROM pg_ts_dict;
CREATE TEXT SEARCH CONFIGURATION femho_ca ( COPY = simple );
ALTER TEXT SEARCH CONFIGURATION femho_ca
  ALTER MAPPING FOR hword, hword_part, word
  WITH unaccent, catalan_stem;

ALTER TABLE tasks
  ADD COLUMN tsv tsvector GENERATED ALWAYS AS (
      setweight(to_tsvector('femho_ca', coalesce(title, '')),       'A') ||
      setweight(to_tsvector('femho_ca', coalesce(description, '')), 'B')
  ) STORED;

CREATE INDEX idx_tasks_tsv ON tasks USING GIN (tsv);
```

Query:

```sql
SELECT id, title,
       ts_rank_cd('{0.1,0.2,0.4,1.0}'::float4[], tsv, q, 32) AS rank,
       ts_headline('femho_ca', description, q,
                   'StartSel=<mark>, StopSel=</mark>, MaxWords=25, MinWords=10, MaxFragments=2')
  FROM tasks, websearch_to_tsquery('femho_ca', :q) q
 WHERE tsv @@ q AND deleted_at IS NULL
 ORDER BY rank DESC LIMIT 50;
```

Confirmed details from the PostgreSQL docs:
- `setweight(tsvector, "char")` with weights `A`–`D`; `ts_rank`/`ts_rank_cd` default weight
  array is `{0.1, 0.2, 0.4, 1.0}` = `{D, C, B, A}`.
- Normalization bitmask: `0` none, `1` ÷(1+log(len)), `2` ÷len, `4` ÷mean harmonic distance
  (`ts_rank_cd` only), `8` ÷unique words, `16` ÷(1+log(unique words)), `32` ÷(rank+1). Use
  `32` to get a 0..1 range.
- `websearch_to_tsquery` understands quoted phrases (`<->`), `OR`, and leading `-` for NOT —
  the right parser for a user-facing search box. `plainto_tsquery` ANDs everything;
  `phraseto_tsquery` uses `<->` throughout.
- `unaccent(dictionary regdictionary, string text)` and `unaccent(string text)` exist as
  functions too. **`ts_headline` output is not XSS-safe** — escape before rendering.
- Two caveats: (a) `unaccent()` used *directly in an index expression* requires it to be
  marked `IMMUTABLE` (it is `STABLE` by default in some builds) — using it as a **dictionary
  inside the text-search configuration**, as above, sidesteps that entirely. (b) A
  non-deterministic ICU collation (`CREATE COLLATION ... (provider=icu, deterministic=false,
  locale='und-u-ks-level1')`) gives accent/case-insensitive `=` and `LIKE`-free comparison,
  but **breaks some pattern matching** and is only available with the ICU provider. Prefer
  the explicit `search_text` column over collation tricks — it behaves identically on SQLite.

## 9.6 What Fem-ho should do — search checklist

1. One `NormalizeCatalan` function; used for `search_text`, for query parsing, and for all
   slugs.
2. FTS5 external content on `tasks`, `tokenize="unicode61 remove_diacritics 2"`,
   `prefix='2 3'`, triggers as above, weekly `optimize`.
3. A second FTS table for `comments` and `checklist_items` if search should reach them —
   union the results in Go, do not try to do it in one virtual table.
4. Always filter by `scope_members` **after** the `MATCH`, and always in the same SQL
   statement (never post-filter in Go, or `LIMIT` lies).
5. Quote every user token; append `*` only to the final token.
6. Ship the folding test in CI.

---

# PART 10 — FILE ATTACHMENTS

## 10.1 Filesystem, content-addressed — not object storage

Default to the filesystem. A self-hoster who has to create an S3 bucket to attach a photo of
a permission slip will not finish setup.

```
$FEMHO_FILES/
  blobs/
    ab/cd/abcdef0123...              # sha256 hex; 2-level fan-out (256*256 dirs)
  thumbs/
    ab/cd/abcdef0123...-512.webp
  avatars/
    <user-id>.webp
  tmp/
    <upload-id>.part                 # same filesystem as blobs/, so the final move is atomic
```

Fan-out by the first two byte-pairs keeps any single directory under a few thousand entries
even at 10⁶ blobs — which matters on ext4 and on the SD cards self-hosters actually use.

Upload flow:

1. Stream to `tmp/<upload-id>.part` through an `io.TeeReader` into a `sha256.New()` **and** a
   byte counter, aborting past `attachment_max_bytes`. Never buffer in memory.
2. Sniff the type with `http.DetectContentType(first512)`. Ignore the client's
   `Content-Type` entirely.
3. On completion, `os.Rename` (atomic within a filesystem) to `blobs/ab/cd/<sha>`. If the
   destination already exists, discard the temp file — you just deduplicated.
4. Insert/upsert `attachments` (unique on `sha256`), insert `task_attachments`, increment
   `ref_count`, write `change_log` — all in **one** transaction.
5. Enqueue a thumbnail job for images.

Because the blob is written **before** the DB row, a crash leaves an orphan file, which the
`attachment.gc` job removes. The reverse order would leave a DB row pointing at nothing —
always fail in the direction of orphaned bytes, never dangling references.

## 10.2 Limits

| Setting | Default | Note |
|---|---|---|
| `attachment_max_bytes` | 25 MiB (26214400) | per file; configurable |
| max files per task | 50 | prevents pathological rows |
| max total per scope | unlimited by default, soft warning at 5 GiB | |
| request body cap | `http.MaxBytesReader` at `attachment_max_bytes + 1 MiB` | belt and braces |
| thumbnail long edge | 512 px WebP | |
| inline-renderable MIME allowlist | `image/png`, `image/jpeg`, `image/gif`, `image/webp`, `application/pdf`, `text/plain` | everything else downloads |

## 10.3 Serving with auth — the security-critical handler

```go
// GET /api/v1/attachments/{id}/{filename}
func (s *Server) getAttachment(w http.ResponseWriter, r *http.Request) {
	ta, err := s.store.TaskAttachment(r.Context(), chi.URLParam(r, "id"))
	// One indexed read authorises it, thanks to the denormalised scope_id.
	if err != nil || !s.can(r, ta.ScopeID, PermRead) { http.NotFound(w, r); return }

	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; sandbox")
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable") // sha-addressed
	w.Header().Set("ETag", `"`+ta.SHA256+`"`)

	ct := ta.MimeType
	disp := "attachment"
	if inlineAllowed[ct] { disp = "inline" } else { ct = "application/octet-stream" }
	w.Header().Set("Content-Type", ct)
	w.Header().Set("Content-Disposition",
		mime.FormatMediaType(disp, map[string]string{"filename": ta.Filename}))

	f, _ := os.Open(s.blobPath(ta.SHA256))
	defer f.Close()
	http.ServeContent(w, r, ta.Filename, ta.CreatedAt, f) // Range support for free
}
```

Non-negotiables:
- **`X-Content-Type-Options: nosniff` and a restrictive CSP on every attachment response.**
  Without them a user-uploaded `.html` or SVG becomes stored XSS against the app's own
  origin, and the session cookie is right there.
- **Serve SVG as `application/octet-stream`**, always. SVG is a script container.
- Serve attachments from a **separate hostname or path with no cookies** if you can
  (`FEMHO_FILES_ORIGIN`); this is the only complete mitigation. Document it as recommended.
- **`http.ServeContent`** gives conditional requests and `Range` (needed for video scrubbing)
  with no extra code.
- `mime.FormatMediaType` handles the RFC 5987 `filename*` encoding — Catalan filenames with
  accents break naive `Content-Disposition` string concatenation.

## 10.4 Public shares and CalDAV `ATTACH`

Neither a share guest nor a CalDAV client has a session. Use **HMAC-signed, expiring URLs**:

```
/f/{attachment_id}/{filename}?exp=1754381553&sig=<base64url HMAC-SHA256>
sig = HMAC(server_pepper, attachment_id + "\n" + exp + "\n" + share_id_or_token_id)
```

Verify constant-time, check `exp`, and check that the referenced share/token is still valid.
Default TTL 1 hour for share pages, 24 hours for `ATTACH` URIs in exported `.ics`.

## 10.5 Optional S3

Keep a two-method interface so S3 is a 200-line addition, not a refactor:

```go
type BlobStore interface {
	Put(ctx context.Context, key string, r io.Reader, size int64, ct string) error
	Open(ctx context.Context, key string) (io.ReadSeekCloser, error)
	Delete(ctx context.Context, key string) error
	SignedURL(ctx context.Context, key string, ttl time.Duration) (string, bool)
}
```

`SignedURL` returns `ok=false` for the filesystem implementation, and the handler falls back
to streaming. That single boolean is what keeps the two backends from forking the handler.

## 10.6 Backup implications

Litestream replicates the **database only**. Say this loudly in the docs and in the admin UI:
`$FEMHO_FILES` needs its own backup (`restic`, `rclone`, a bind mount on a backed-up path).
The nightly `db.backup` job should also emit a `MANIFEST.txt` listing blob count and total
bytes so a restore can be verified.

---

# PART 11 — THE RECOMMENDED STACK, RESTATED, AND THE MIGRATION PLAN

## 11.1 Final stack

```
Runtime      Go 1.22+ , CGO_ENABLED=0 , distroless/static image
HTTP         net/http std ServeMux (method+wildcard patterns) [+ chi if middleware sugar wanted]
DB           SQLite via modernc.org/sqlite v1.56.0 (embeds SQLite 3.53.3), WAL,
             two pools (1 writer / N readers), _txlock=immediate
Migrations   github.com/pressly/goose/v3, migrations embedded with //go:embed
CalDAV       github.com/emersion/go-webdav v0.7.0  (caldav.Backend server + caldav.Client)
             + ~200 lines of your own DAV:sync-collection REPORT handler
iCalendar    github.com/emersion/go-ical (v0.0.0-20250609112844-439c63cef608)
Recurrence   github.com/teambition/rrule-go v1.8.2
MCP          github.com/modelcontextprotocol/go-sdk/mcp (Tier 1; pin the tag at install time)
Ordering     github.com/rocicorp/fracdex   (web client: rocicorp/fractional-indexing)
Passwords    golang.org/x/crypto/argon2 — Argon2id m=19456 t=2 p=1 (OWASP minimum)
Tokens       crypto/rand 256-bit + SHA-256 at rest (NOT Argon2id — see §5.1)
Timezones    import _ "time/tzdata"   (mandatory for scratch/distroless)
Realtime     SSE over net/http; coder/websocket only if bidirectional is later needed
Jobs         in-process scheduler + `jobs` table (no Redis, no Postgres)
Backup       Litestream v0.5.x (file / SFTP / WebDAV / S3 replicas) + nightly VACUUM INTO
Frontend     served from //go:embed web/dist via http.FS
```

Alternative if the team insists on one language across web+server: **Node 22 / TypeScript,
Fastify, better-sqlite3 + Drizzle, `@modelcontextprotocol/sdk` 1.30.0 (or v2),
`ical.js` + `rrule`** — accepting that you write the CalDAV server yourself.

## 11.2 Migration file order (goose, `migrations/sqlite/`)

```
0001_users_sessions_tokens.sql          users, sessions, api_tokens
0002_scopes_projects.sql                scopes, scope_members, projects
0003_tasks.sql                          tasks + all indexes
0004_relations_assignees_labels.sql     task_relations, task_assignees, labels, task_labels
0005_checklists.sql                     checklists, checklist_items
0006_comments_attachments.sql           comments, attachments, task_attachments
0007_reminders_recurrences.sql          recurrences, reminders  (note: tasks.series_id FK
                                        is added HERE, after recurrences exists — SQLite
                                        cannot add an FK later without a table rebuild, so
                                        declare tasks.series_id as a plain TEXT in 0003 and
                                        rely on application-level integrity, OR create
                                        recurrences before tasks. RECOMMENDED: create
                                        recurrences in 0003 before tasks.)
0008_audit_sync.sql                     activity_log, change_log
0009_shares.sql                         shares, share_accesses
0010_caldav.sql                         calendar_sources, calendar_sync_state,
                                        caldav_collections, caldav_objects
0011_ai.sql                             ai_instructions, ai_runs
0012_settings_webhooks_jobs.sql         settings, webhooks, webhook_deliveries, jobs, job_markers
0013_fts.sql                            tasks_fts + triggers
0014_seed.sql                           the AI user row (fixed UUID), default labels
```

**The FK ordering note in 0007 is a real SQLite trap** and worth restating: SQLite has no
`ALTER TABLE ... ADD CONSTRAINT`. Any foreign key must exist in the original
`CREATE TABLE`, so the *creation order* of tables is part of your schema design.
`recurrences` must be created before `tasks`, and `calendar_sources` before `tasks` too.
Reorder the list accordingly:

```
0001 users/sessions/api_tokens
0002 scopes/scope_members/projects
0003 calendar_sources + calendar_sync_state     <-- before tasks (tasks.source_id FK)
0004 recurrences (with template_task_id declared but NOT as an FK yet)
0005 tasks (FKs to scopes, projects, tasks, calendar_sources, recurrences)
...
```

`recurrences.template_task_id` and `tasks.series_id` are mutually referencing. Break the
cycle by declaring `recurrences.template_task_id` as plain `TEXT` with no FK and enforcing it
in the repository. Document the exception in a comment in the migration.

## 11.3 Test fixtures the AI should generate first

Before writing features, generate a seed dataset that exercises every hard case — it is the
cheapest defence against regressions in exactly the areas this dossier flags:

1. A task with `due_date` on the DST spring-forward day in `Europe/Madrid`.
2. A task completed at 23:58 local on the DST fall-back day (the 25-hour day).
3. A weekly series (`anchor='schedule'`) with one `EXDATE` and one `RECURRENCE-ID` override.
4. A 3-day `anchor='completion'` series with two completions.
5. A checklist of 40 items, 17 checked, pinned, shared publicly with `permission='check'`
   and `require_name=1`.
6. A task imported from a CalDAV source carrying `X-APPLE-SORT-ORDER` and a `VALARM` you did
   not create — assert both survive a local edit + write-back.
7. A three-level subtask tree with `RELATED-TO` export.
8. 200 tasks in `status='todo'` reordered 500 times, asserting `max(length(board_rank)) < 30`.
9. Catalan text: `Col·legi`, `caça`, `l'aigua`, `d'acord`, `Àngel`, `Nadal`. Assert each is
   findable by its unaccented, un-geminated, un-elided form.
10. Two users in different timezones both viewing the same `Família` scope's Done column.

---

# PART 12 — THE 10 RISKIEST MODELLING DECISIONS

Ranked by cost-to-reverse × probability-of-getting-it-wrong.

### 1. Kanban column as a per-task field vs per-project bucket membership
**Risk:** reversing this touches every board query, the drag API, the Android schema and the
sync payload. **Recommendation: per-task `tasks.status` enum with four fixed values**
(§3.1). The Inbox column is shared with the Calendar view and exists outside any project;
bucket membership cannot express that. If per-project custom columns are ever needed, add a
*second* nullable axis, never replace `status`.

### 2. Unifying checklists into `tasks` vs keeping them separate
**Risk:** the "elegant" unification makes every board/calendar query carry
`AND kind='task'`, multiplies row count ~10×, and produces a mushy MCP tool schema that
makes the AI return shopping-list lines from `list_tasks`. **Recommendation: separate
`checklists` + `checklist_items` tables, plus a purely presentational
`tasks.view_mode='checklist'`** (§3.2). Add an explicit `promote` endpoint for
item → task.

### 3. Whether "Done clears daily" is stored state or a query
**Risk:** a stored flag needs a job, has one global boundary, and is wrong for every user
outside the server's timezone. **Recommendation: no state. Query
`completed_at BETWEEN local_day_start_utc AND local_day_end_utc`, with bounds computed in
the viewer's timezone via `time.Date(y,m,d+1,...)`** (§3.3). Zero moving parts, correct per
user, DST-safe.

### 4. Rewriting due dates on rollover vs computing overdue at read time
**Risk:** rewriting destroys history, fights CalDAV (`SEQUENCE` churn, external clients see
dates move), and doubles on the 25-hour DST day if the job is not idempotent.
**Recommendation: virtual carry-over — a read-time predicate
(`due_date < local_today`, a pure string comparison)** (§4.4). Expose rewriting as an opt-in
`rollover_mode` setting only if a user asks.

### 5. Integer/float `position` vs fractional string index for drag-and-drop
**Risk:** integers force O(n) rewrites and O(n) sync payloads; floats silently collide after
~50 same-gap inserts. **Recommendation: base62 fractional index in
`rank TEXT COLLATE BINARY`, generated server-side from the neighbour IDs the client sends,
with `ORDER BY rank, id` as the deterministic tie-break and client-side jitter** (§3.4).
Ship a rebalance job that should never fire.

### 6. Recurrence: materialise-next-only vs expand-RRULE-on-read vs hybrid
**Risk:** pure expansion gives occurrences no identity, so per-occurrence assignees,
comments and checked subtasks are impossible — and you discover this after the calendar is
built. Pure next-only leaves the calendar blank for future weeks.
**Recommendation: hybrid — RRULE of record in `recurrences`, instances materialised to a
rolling 60-day horizon, tracked by `materialized_through`, deduped by
`UNIQUE(series_id, recurrence_instance_date)`** (§3.5). And **model `anchor` (`schedule` vs
`completion`) from day one** — retrofitting it means reinterpreting every existing series.

### 7. One `change_log` for both Android delta sync and the CalDAV `sync-token`
**Risk:** building two independent change-tracking mechanisms and having them disagree; or
building none and discovering that RFC 6578 needs one. **Recommendation: a single
append-only `change_log(seq INTEGER PRIMARY KEY AUTOINCREMENT, ...)`, written in the
repository layer inside the mutation transaction, with `DAV:sync-token =
urn:femho:sync:<seq>` and SSE `Last-Event-ID = seq`** (§3.6, §6, §7.3). Keep it **separate**
from the human-readable `activity_log` — different volume, different retention, different
consumers.

### 8. Preserving unknown iCalendar properties from external sources
**Risk:** silently destroying users' Apple/Nextcloud metadata on the first write-back. It is
invisible until a user complains, and by then the data is gone from both sides.
**Recommendation: `tasks.remote_payload` holds the full raw VCALENDAR; write-back is a
property-level merge that overwrites only Fem-ho-owned properties, with
`If-Match: <remote_etag>` and a `sync_state='conflict'` path on 412** (§3.7). This is a small
amount of code that buys a categorically better sync than most competitors.

### 9. Storing all-day dates as instants
**Risk:** `2026-08-07T00:00:00Z` becomes 6 August in Hawaii, 7 August in Madrid, and a
recurring "every day at 08:00" drifts by an hour twice a year. It is the classic bug and it
is expensive to unwind because the original intent is unrecoverable.
**Recommendation: three distinct shapes — `TEXT 'YYYY-MM-DD'` for all-day (never converted),
UTC instant + IANA `*_tz` sibling for timed, and the rule + `timezone` for recurring,
expanded with `rrule-go` in a `*time.Location`** (§4.1). Enforce with CHECK constraints; add
`import _ "time/tzdata"`.

### 10. Hashing high-entropy tokens with Argon2id
**Risk:** the "secure by default" instinct puts a 19 MiB / 2-iteration KDF on the path of
every CalDAV `PROPFIND`, which DAVx⁵ issues on a poll loop. The server becomes unusable on a
Raspberry Pi and nobody suspects the password hasher.
**Recommendation: Argon2id (m=19456, t=2, p=1) for user-chosen secrets only —
`users.password_hash` and `shares.password_hash`. SHA-256 (or HMAC-SHA256 with a server
pepper) for the 256-bit random values in `sessions.token_hash` and `api_tokens.token_hash`**
(§5.1, §5.7). And **issue `audience='caldav'` app passwords** so a real password never enters
DAVx⁵.

### Honourable mentions (get these right too)

- **`scope_members.rank`, not `scopes.rank`** — chip order is per user (§5.2).
- **No phantom "General" project** — the scope's general space is `project_id IS NULL` (§5.2).
- **`etag` random-on-write, not a content hash** — content hashes make clients skip updates
  when only a relation changed (§5.3).
- **`caldav_objects` tombstones retained** — RFC 6578 requires reporting removed members as
  404 (§5.7).
- **No DB triggers except FTS5** — an AI doing a 12-step SQLite table rebuild will drop them
  (§3.6, §9.1).
- **Blob written before DB row** — fail toward orphaned bytes, never dangling references
  (§10.1).
- **SSRF guard on webhooks** — a self-hosted app on a LAN is one `POST` away from the router
  admin page (§5.7).

---

# SOURCES

Fetched or searched during this session (2026-08-05):

**Go CalDAV / iCal / recurrence**
- https://pkg.go.dev/github.com/emersion/go-webdav/caldav — v0.7.0 `Backend`, `Calendar`, `CalendarObject`, `CalendarQuery`, `PutCalendarObjectOptions`, `Handler`, client methods
- https://github.com/emersion/go-webdav — repo overview
- https://github.com/emersion/go-webdav/releases — v0.1.0 … v0.7.0 (2024-10-18) with notes
- https://pkg.go.dev/github.com/emersion/go-ical — types, component/property constants, `RecurrenceSet`, MIME type
- https://pkg.go.dev/github.com/teambition/rrule-go — v1.8.2 `ROption`, `RRule`, `Set`, parsing helpers

**MCP**
- https://modelcontextprotocol.io/docs/2026-07-28/sdk — official SDK table and tiers
- https://github.com/modelcontextprotocol/go-sdk — minimal server snippet, transports
- https://www.npmjs.com/package/@modelcontextprotocol/sdk (via search) — 1.30.0; v2 line
- https://github.com/modelcontextprotocol/go-sdk/releases (via search) — v1.4.1 / v1.5.0-pre.1

**SQLite / Litestream**
- https://www.sqlite.org/wal.html — WAL concurrency, `-wal`/`-shm`, persistence, `wal_autocheckpoint`=1000, `synchronous=NORMAL`, network-FS restriction, read-only access rules
- https://www.sqlite.org/fts5.html — external content tables, sync triggers, `bm25`, `highlight`, `snippet`, prefix indexes, trigram tokenizer
- https://sqlite.org/fts5.html#unicode61_tokenizer — `remove_diacritics` 0/1/2 with **default 1**; `categories` default `'L* N* Co'`; `tokenchars`/`separators`
- https://pkg.go.dev/modernc.org/sqlite — v1.56.0 (2026-08-03), SQLite 3.53.3, GOOS/GOARCH matrix, driver name `"sqlite"`
- https://litestream.io/getting-started/ — v0.5.x, replica backends
- https://litestream.io/tips/ — `busy_timeout` 5 s, WAL requirement, `foreign_keys` off by default, `synchronous=NORMAL`, `wal_autocheckpoint=0` guidance, async replication window, multi-app bucket caveat, `litestream reset`
- https://litestream.io/reference/config/ — YAML keys (`dbs`, `path`, `monitor-interval`, `checkpoint-interval`, `replica`, `type`, `bucket`, `region`, `sync-interval`, `snapshot`, `levels`, `validation`), CLI commands

**PostgreSQL**
- https://www.postgresql.org/docs/current/unaccent.html — `CREATE EXTENSION unaccent`, both `unaccent()` signatures, dictionary-in-configuration pattern
- https://www.postgresql.org/docs/current/textsearch-tables.html — `GENERATED ALWAYS AS (to_tsvector(...)) STORED`, GIN index
- https://www.postgresql.org/docs/current/textsearch-controls.html — `setweight`, `ts_rank`/`ts_rank_cd` default weights `{0.1,0.2,0.4,1.0}`, normalization bitmask 0/1/2/4/8/16/32, `websearch_to_tsquery`, `plainto_tsquery`, `phraseto_tsquery`, `ts_headline` options
- https://www.postgresql.org/docs/current/sql-createcollation.html + https://www.postgresql.org/docs/current/collation.html (via search) — ICU non-deterministic collations, `und-u-ks-level1`, pattern-matching limitation
- https://www.postgresql.org/docs/16/textsearch-psql.html (via search) — snowball dictionary listing incl. `catalan_stem`

**RFCs**
- https://datatracker.ietf.org/doc/html/rfc6578 — `DAV:sync-collection` elements, sync-level, `DAV:limit`/`nresults`, multistatus + 404 for removed members, empty-token semantics, 507 + `DAV:number-of-matches-within-limits`
- https://datatracker.ietf.org/doc/html/rfc5545#section-3.6.2 — VTODO property cardinality; "DUE and DURATION MUST NOT occur in the same VTODO"
- https://datatracker.ietf.org/doc/html/rfc5545#section-3.8.1.11 — STATUS values: VEVENT `TENTATIVE/CONFIRMED/CANCELLED`; **VTODO `NEEDS-ACTION/COMPLETED/IN-PROCESS/CANCELLED`**; VJOURNAL `DRAFT/FINAL/CANCELLED`
- https://datatracker.ietf.org/doc/html/rfc6764 — `_caldav._tcp` / `_caldavs._tcp` SRV, TXT `path=`, `/.well-known/caldav`, redirect with 301/303/307, bootstrap via `DAV:current-user-principal` → `calendar-home-set`

**Ordering / security / prior art**
- https://github.com/rocicorp/fractional-indexing/blob/main/README.md — `generateKeyBetween` / `generateNKeysBetween` signatures, BASE_62/BASE_52 alphabets, example keys, case-sensitivity and collision caveats, cross-language ports (`rocicorp/fracdex` for Go)
- https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html — Argon2id m=19456/t=2/p=1 and equivalents, scrypt N=2^17/r=8/p=1, bcrypt work factor ≥10 and 72-byte cap, peppering guidance
- https://vikunja.io/docs/caldav/ — `/dav/principals/<user>/`, `/dav/projects/<id>/<uid>`, supported/unsupported VTODO properties, tested clients, token-based auth
- https://github.com/lennart-k/rustical (via search) — Rust CalDAV/CardDAV server on a single SQLite database
- https://github.com/Kozea/Radicale + https://radicale.org/master.html (via search) — Python CalDAV server, storage/auth/rights plugin system
- https://github.com/pressly/goose (via search) — dialect list, `SetBaseFS` + `embed.FS` pattern
- https://caldav.readthedocs.io/stable/about.html (via search) — Python `caldav` 3.2.x, `get_davclient()`, icalendar internals
- https://github.com/riverqueue/river + https://github.com/go-co-op/gocron (via search) — River is PostgreSQL-backed; gocron for in-process cron

---

# UNVERIFIED / OPEN ITEMS

Flagged honestly. Everything **not** in this list was read off a primary source above.

1. **Exact current tag of the Go MCP SDK.** The releases page showed `v1.4.1` stable and
   `v1.5.0-pre.1` (dated 2026-03-31); the repo README referenced "v1.7.0+" as supporting the
   2026-07-28 spec. Pin with `go get ...@latest` and record the result.
2. **Streamable HTTP server transport type name in the Go MCP SDK.** The fetched README
   excerpt showed only `mcp.StdioTransport{}` and `mcp.CommandTransport`. The HTTP transport
   exists (the spec and SDK docs reference it) but I did not see its Go type name.
3. **`ç → c` folding under FTS5 `remove_diacritics 2`.** Highly likely (cedilla is in the
   Latin diacritic mapping) but not executed. The test in §9.4 settles it in one run.
4. **Whether `pg_catalog.catalan` ships as a full text search *configuration*** (as opposed
   to just the `catalan_stem` dictionary). Search results confirmed the dictionary in the
   PG 14/16 docs and showed Catalan historically *absent* from the default configuration
   list. The §9.5 snippet therefore builds `femho_ca` explicitly rather than assuming a
   `catalan` config exists. Verify with `SELECT cfgname FROM pg_ts_config;`.
5. **`tsdav` current version and feature set** (Node CalDAV client) — referenced from
   general knowledge, not fetched.
6. **Atlas (`ariga.io/atlas`) current version** — mentioned as an alternative, version not
   checked.
7. **`golang:1.24-alpine` Docker tag** in the sample Dockerfile is illustrative; use whatever
   the current stable Go image is.
8. **RFC 9562 (UUIDv7)** — cited from knowledge, not re-fetched this session. The version-7
   layout (48-bit big-endian Unix ms timestamp, 4-bit version, 12-bit rand_a, 2-bit variant,
   62-bit rand_b) is stable and widely implemented; confirm against the RFC before writing
   the generator, or use a maintained library.
9. **Whether `emersion/go-webdav` has added server-side `sync-collection` after v0.7.0.**
   v0.7.0 is the latest release listed (2024-10-18) and its `caldav` package documents no
   Sync types; `master` may have moved. Check `git log` before writing the handler by hand.
10. **`http.DetectContentType` coverage for the inline allowlist** — it sniffs the common
    image types and PDF correctly, but confirm behaviour for `image/webp` on your Go version
    before relying on it for the inline decision.




