# Fem-ho — Dossier 11: Self-hosting, Docker packaging & operations

> **DELIVERY NOTE (read first).** This session is running in **plan mode**, which permits writing
> only to this plan file. The orchestrator requested the path
> `/private/tmp/claude-501/-Users-borja-Codi-fem-ho/4ee9f810-66f8-4e6f-86dc-06e906a11d09/scratchpad/research/11-selfhosting-docker-ops.md`.
> The full dossier content is below; move it to that path once plan mode is exited.

**Scope:** packaging and operating Fem-ho as a self-hosted Docker application — what makes
self-hosters adopt it vs abandon it.
**Audience:** an AI writing production code and repo files for Fem-ho.
**Method:** primary sources only (official docs, RFCs, source repos, spec pages). Everything
not directly observed in a fetched source is flagged **UNVERIFIED**.

---

## 0. Executive summary — the adopt/abandon scorecard

Self-hosters make an adopt/abandon decision within roughly the first 10 minutes. The decision
points, in the order they are hit, and what Fem-ho must do at each:

| # | Moment | Abandon trigger | Fem-ho requirement |
|---|--------|-----------------|--------------------|
| 1 | Copy `docker-compose.yml` from README | More than ~40 lines, or requires editing 8 env vars before it runs | Ship a **10-line SQLite single-container** compose that runs with zero edits |
| 2 | `docker compose up -d` | Container crash-loops because a required secret is unset | **Auto-generate** the signing key on first boot and persist it; never hard-fail on a missing secret that can be generated |
| 3 | Open `http://host:port` | Blank page / 500 / "you must set BASE_URL" | Work on `http://<ip>:<port>` with **no** base-URL config; derive it from `X-Forwarded-*` or `Host` |
| 4 | Create first user | Docs say "run `docker exec ... createsuperuser`" | **In-app first-run wizard**: the first registration becomes admin. Env-seeded admin as the *automation* path, not the primary path |
| 5 | Put it behind a reverse proxy | Wrong scheme in generated links; CalDAV 405s; SSE hangs | Trusted-proxy handling + documented Caddy/Traefik/nginx snippets that are known-good for **PROPFIND/REPORT/MKCALENDAR** and **SSE** |
| 6 | First `docker compose pull` a month later | Migration destroys data, or a breaking change with no notice | Backup-before-migrate, forward-only migrations, `latest` = latest stable, major-pinned tags, CHANGELOG with a `BREAKING` section |
| 7 | Disk fills / needs to move server | "Where is my data?" | **One volume** holding everything (`/data`), documented `tar` backup, and an in-app "export everything" |

**The single strongest adoption lever** observed across every project studied: the compose file
is a *release artifact*, not a moving target. Immich ships `docker-compose.yml` as a GitHub
release asset and warns explicitly that "*The compose file on main may not be compatible with
the latest release.*" Do the same.

---

## 1. Reference deployments — what they actually ship

### 1.1 Vikunja (Go, closest functional analogue to Fem-ho)

Vikunja is the single best reference for Fem-ho: Go backend, tasks/projects/kanban, CalDAV,
REST API, self-hosted, multi-user.

**Config system (this is the model to copy):**

- Supported formats: **TOML, YAML, HCL, INI, JSON, envfile, environment variables, Java
  Properties**. Docs recommend YAML or TOML.
- Env var mapping: nested config keys are flattened with underscores and prefixed.
  `service.secret` → `VIKUNJA_SERVICE_SECRET`. `database.host` → `VIKUNJA_DATABASE_HOST`.
- **Precedence: environment variables win over the config file.** Quote: "If you set the same
  option in both, the environment variable takes precedence."
- Config file search path, in order:
  1. next to the binary
  2. `service.rootpath`
  3. `/etc/vikunja`
  4. `~/.config/vikunja`
- **Secrets from files — two mechanisms:**
  - In the config file, a `file` child key: `database.password.file: /path/to/password`
  - As an env var, a `_FILE` suffix: `VIKUNJA_DATABASE_PASSWORD_FILE=/run/secrets/db_pass`
  - File paths support env expansion via `$VARIABLE_NAME`.
- `service.publicurl` — "The public facing URL where your users can reach Vikunja. Used in
  emails and for API-frontend communication."
- `service.secret` — signs JWT tokens; **generated randomly at startup if unset**. (Note the
  trade-off: random-at-startup means every restart invalidates all sessions. Fem-ho should
  *generate and persist*, see §5.4.)
- Supported DBs: SQLite, MySQL 8.0+, MariaDB 10.2+, PostgreSQL 12+.
  Pool defaults: `maxopenconnections` 100, `maxidleconnections` 50.

**Compose shape:** app + Postgres, `depends_on: db: condition: service_healthy`, Postgres
healthcheck via `pg_isready` (2s interval, 30s start period), volumes `./files:/app/vikunja/files`
and `./db:/var/lib/postgresql`, port 3456. Documented variants: no-proxy, Traefik 2 (labels +
external `web` network), Caddy v2 (Caddyfile with `reverse_proxy vikunja:3456`).

**Operational gotchas documented:** runs as UID 1000 by default → the files directory must be
writable by 1000; under rootless Docker you must run as `0:0` inside the container; MySQL/MariaDB
needs UTF-8 settings; SQLite only for small deployments.

> **What Fem-ho should do:** adopt Vikunja's config model wholesale — layered file + env with
> env winning, a `_FILE` suffix for every secret, and the same search-path idea (but simplify to
> two locations, see §5). Diverge on two points: (a) **persist** the signing key instead of
> regenerating per boot, (b) make `publicurl` *optional* and derived, because forcing it is the
> #1 first-run failure in this class of app.

### 1.2 Immich (the "polished release engineering" reference)

`docker/docker-compose.yml` (verbatim, trimmed of hwaccel comments):

```yaml
name: immich

services:
  immich-server:
    container_name: immich_server
    image: ghcr.io/immich-app/immich-server:${IMMICH_VERSION:-release}
    volumes:
      - ${UPLOAD_LOCATION}:/data
      - /etc/localtime:/etc/localtime:ro
    env_file:
      - .env
    ports:
      - '2283:2283'
    depends_on:
      - redis
      - database
    restart: always
    healthcheck:
      disable: false

  redis:
    container_name: immich_redis
    image: docker.io/valkey/valkey:9@sha256:3acc0687f2a2e1091fae6450d7842dd658c941338cf0a873ddd9e14b9e4ea4dd
    healthcheck:
      test: redis-cli ping || exit 1
    restart: always

  database:
    container_name: immich_postgres
    image: ghcr.io/immich-app/postgres:14-vectorchord0.4.3-pgvectors0.2.0@sha256:bcf63357191b76a916ae5eb93464d65c07511da41e3bf7a8416db519b40b1c23
    environment:
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_USER: ${DB_USERNAME}
      POSTGRES_DB: ${DB_DATABASE_NAME}
      POSTGRES_INITDB_ARGS: '--data-checksums'
    volumes:
      - ${DB_DATA_LOCATION}:/var/lib/postgresql/data
    shm_size: 128mb
    restart: always
    healthcheck:
      disable: false

volumes:
  model-cache:
```

`docker/example.env` (verbatim):

```
# The location where your uploaded files are stored
UPLOAD_LOCATION=./library

# The location where your database files are stored. Network shares are not supported for the database
DB_DATA_LOCATION=./postgres

# TZ=Etc/UTC

# The Immich version to use. You can pin this to a specific version like "v2.1.0"
IMMICH_VERSION=v3

# Connection secret for postgres. You should change it to a random password
# Please use only the characters `A-Za-z0-9`, without special characters or spaces
DB_PASSWORD=postgres

# The values below this line do not need to be changed
###################################################################################
DB_USERNAME=postgres
DB_DATABASE_NAME=immich
```

**Techniques worth stealing:**

1. **Header comment points at the release asset**, not `main`:
   `https://github.com/immich-app/immich/releases/latest/download/docker-compose.yml`
2. **Version pinned by an env var with a default**: `${IMMICH_VERSION:-release}` — the user can
   pin without editing the compose file.
3. **Third-party images pinned by digest** (`valkey:9@sha256:…`) — reproducible, immune to tag
   reuse. Their own image is by tag so updates work.
4. **`healthcheck: disable: false`** — an explicit, self-documenting way to say "the image ships
   a HEALTHCHECK and we want it on" (and gives users an obvious knob to turn it off).
5. **`POSTGRES_INITDB_ARGS: '--data-checksums'`** — silent-corruption detection, essentially free.
6. **`shm_size: 128mb`** on Postgres — avoids the classic `could not resize shared memory segment`
   failure on parallel queries in containers.
7. `.env` splits into "you must change these" above the line and "don't touch" below the line.
8. `name: immich` at the top of the compose file → stable project name regardless of directory.

**Reverse proxy requirements (from their admin docs):** `client_max_body_size 50000M`;
`proxy_request_buffering off`; `proxy_read_timeout 600s`; `proxy_send_timeout 600s`;
`proxy_http_version 1.1` plus upgrade headers for WebSockets. Traefik v3 needs entrypoint
`respondingTimeouts.readTimeout: 600s` and `idleTimeout: 600s` — the default 60s "cause videos
to fail after one minute". **Immich cannot run on a sub-path** like `/immich`; root domain only.

> **What Fem-ho should do:** copy items 1–8 verbatim in spirit. Specifically: publish
> `docker-compose.yml` and `.env.example` as release assets; use `${FEMHO_VERSION:-latest}`;
> pin Postgres by digest in the shipped compose; put `shm_size: 128mb` and `--data-checksums` on
> the Postgres service. Unlike Immich, Fem-ho **should** support sub-path deployment (`/femho`)
> because household users often have one domain — but if that's expensive, say so loudly in the
> README rather than half-supporting it.

### 1.3 Paperless-ngx (the "env-var configuration surface" reference)

`docker/compose/docker-compose.postgres.yml` (verbatim):

```yaml
services:
  broker:
    image: docker.io/valkey/valkey:9-alpine
    restart: unless-stopped
    volumes:
      - redisdata:/data
  db:
    image: docker.io/library/postgres:18
    restart: unless-stopped
    volumes:
      - pgdata:/var/lib/postgresql
    environment:
      POSTGRES_DB: paperless
      POSTGRES_USER: paperless
      POSTGRES_PASSWORD: paperless
  webserver:
    image: ghcr.io/paperless-ngx/paperless-ngx:latest
    restart: unless-stopped
    depends_on:
      - db
      - broker
    ports:
      - "8000:8000"
    volumes:
      - data:/usr/src/paperless/data
      - media:/usr/src/paperless/media
      - ./export:/usr/src/paperless/export
      - ./consume:/usr/src/paperless/consume
    env_file: docker-compose.env
    environment:
      PAPERLESS_REDIS: redis://broker:6379
      PAPERLESS_DBHOST: db
      PAPERLESS_DBENGINE: postgresql
volumes:
  data:
  media:
  pgdata:
  redisdata:
```

**Config facts:**

- Prefix `PAPERLESS_` for everything.
- **`PAPERLESS_URL`** sets three Django settings at once — `ALLOWED_HOSTS`,
  `CORS_ALLOWED_HOSTS`, `CSRF_TRUSTED_ORIGINS`. Cannot contain a path.
  Example: `https://paperless.domain.com`. *This one-var-sets-three pattern is excellent UX.*
- `PAPERLESS_CSRF_TRUSTED_ORIGINS` — "A list of trusted origins for unsafe requests (e.g. POST)."
- `PAPERLESS_USE_X_FORWARD_HOST` (bool, default False) → Django `USE_X_FORWARDED_HOST`.
- `PAPERLESS_PROXY_SSL_HEADER` → Django `SECURE_PROXY_SSL_HEADER`, "which may be needed for
  hosting behind a proxy". Takes a JSON list of two values (header name, expected value).
- `PAPERLESS_SECRET_KEY` — **required**. "Paperless uses this to make session tokens and sign
  sensitive data." Generate with
  `python3 -c "import secrets; print(secrets.token_urlsafe(64))"`.
- `PAPERLESS_ADMIN_USER` + `PAPERLESS_ADMIN_PASSWORD` — creates a superuser at startup.
  **"Won't modify existing users."** This idempotency rule is the important part.
- Splits config across `docker-compose.env` (bulk) and inline `environment:` (wiring). Users edit
  one file; the compose file stays untouched by upgrades.

> Note on `pgdata:/var/lib/postgresql` above with `postgres:18` — this is correct *only* for
> PG18+, where `PGDATA` is `/var/lib/postgresql/18/docker`. See §4.4.

**UNVERIFIED:** the Paperless configuration reference page I fetched did **not** document a
`_FILE` suffix convention. Paperless is widely believed to support it; treat as unconfirmed.

> **What Fem-ho should do:** implement a single `FEMHO_URL` that sets public URL + CSRF trusted
> origins + CORS origins together. Implement env-seeded admin with Paperless's exact idempotency
> semantics: create if absent, **never modify an existing user**. Split config: `.env` for the
> user, `compose.yaml` shipped and unedited.

### 1.4 Miniflux (the "smallest good compose" reference — closest to what Fem-ho should ship)

Verbatim from the official Docker docs:

```yaml
services:
  miniflux:
    image: miniflux/miniflux:latest
    ports:
      - "80:8080"
    depends_on:
      db:
        condition: service_healthy
    environment:
      - DATABASE_URL=postgres://miniflux:secret@db/miniflux?sslmode=disable
      - RUN_MIGRATIONS=1
      - CREATE_ADMIN=1
      - ADMIN_USERNAME=admin
      - ADMIN_PASSWORD=test123
  db:
    image: postgres:18
    environment:
      - POSTGRES_USER=miniflux
      - POSTGRES_PASSWORD=secret
      - POSTGRES_DB=miniflux
    volumes:
      - miniflux-db:/var/lib/postgresql
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "miniflux"]
      interval: 10s
      start_period: 30s
volumes:
  miniflux-db:
```

Optional app healthcheck, using the app's own binary — no `curl` needed in the image:

```yaml
miniflux:
  image: miniflux/miniflux:latest
  healthcheck:
    test: ["CMD", "/usr/bin/miniflux", "-healthcheck", "auto"]
```

**Three ideas worth copying exactly:**

1. **`RUN_MIGRATIONS=1` as an explicit opt-in flag.** Migrations do not run silently. The
   operator decides. (See §7 for why this matters and how to make it safe by default.)
2. **`CREATE_ADMIN=1` + `ADMIN_USERNAME` + `ADMIN_PASSWORD`**, with docs noting the vars are
   "removable after setup" — a clean bootstrap path for automation.
3. **Healthcheck via the app's own binary with a `-healthcheck` flag.** This is the correct
   pattern for a distroless/scratch image where `curl` and `wget` do not exist.

> **What Fem-ho should do:** ship `femho healthcheck` as a subcommand of the same binary, and use
> it in `HEALTHCHECK` inside the Dockerfile. Ship `FEMHO_RUN_MIGRATIONS` (default `true` for
> self-hosters, documented `false` for HA/multi-replica setups) and `FEMHO_CREATE_ADMIN` /
> `FEMHO_ADMIN_EMAIL` / `FEMHO_ADMIN_PASSWORD`.

### 1.5 Gitea (the "config-file-first with env override" reference)

SQLite variant (verbatim):

```yaml
networks:
  gitea:
    external: false

services:
  server:
    image: docker.gitea.com/gitea:1.27.1
    container_name: gitea
    environment:
      - USER_UID=1000
      - USER_GID=1000
    restart: always
    networks:
      - gitea
    volumes:
      - ./gitea:/data
      - /etc/timezone:/etc/timezone:ro
      - /etc/localtime:/etc/localtime:ro
    ports:
      - "3000:3000"
      - "222:22"
```

Postgres variant adds:

```yaml
      - GITEA__database__DB_TYPE=postgres
      - GITEA__database__HOST=db:5432
      - GITEA__database__NAME=gitea
      - GITEA__database__USER=gitea
      - GITEA__database__PASSWD=gitea
```

**Key mechanics:**

- `app.ini` is the source of truth. Env vars map with **double underscores**:
  `GITEA__<section>__<KEY>=value`.
- **`__FILE` suffix** for secrets: `GITEA__<section>__<KEY>__FILE=/path/to/secret`.
- `USER_UID` / `USER_GID` (default 1000) let the user match host volume ownership — the single
  most common bind-mount permission fix in self-hosting.
- One volume: `./gitea:/data`. Everything lives there.

> **What Fem-ho should do:** ship `PUID`/`PGID` (the LinuxServer.io convention, more recognised by
> self-hosters than `USER_UID`) **or** `USER_UID`/`USER_GID`, and pick one and document it. Given
> Fem-ho is Go/Node and can run as a fixed non-root UID from a named volume, prefer **named
> volumes by default** (no permission problem at all) and document `user: "1000:1000"` for people
> who insist on bind mounts. Use single-underscore `FEMHO_` mapping (Vikunja style) — the
> double-underscore is only needed because Gitea's INI keys contain underscores.

### 1.6 Karakeep (bookmarks; modern Node/TS reference)

```yaml
services:
  web:
    image: ghcr.io/karakeep-app/karakeep:${KARAKEEP_VERSION:-release}
    restart: unless-stopped
    volumes:
      - data:/data
    ports:
      - 3000:3000
    env_file:
      - .env
    environment:
      MEILI_ADDR: http://meilisearch:7700
      BROWSER_WEB_URL: http://chrome:9222
      DATA_DIR: /data # DON'T CHANGE THIS
  chrome:
    image: gcr.io/zenika-hub/alpine-chrome:124
    restart: unless-stopped
    command:
      - --no-sandbox
      - --disable-gpu
      - --disable-dev-shm-usage
      - --remote-debugging-address=0.0.0.0
      - --remote-debugging-port=9222
      - --hide-scrollbars
      - --disable-blink-features=AutomationControlled
      - --window-size=1440,900
  meilisearch:
    image: getmeili/meilisearch:v1.41.0
    restart: unless-stopped
    env_file:
      - .env
    environment:
      MEILI_NO_ANALYTICS: "true"
    volumes:
      - meilisearch:/meili_data

volumes:
  meilisearch:
  data:
```

Notes: SQLite-based, single `data` **named volume** (with an in-file comment showing how to swap
in a bind mount), `DATA_DIR: /data # DON'T CHANGE THIS`, `restart: unless-stopped`.
Anti-pattern present: **no healthchecks and no `depends_on` at all** — the web container races
Meilisearch on startup.

> **What Fem-ho should do:** copy the named-volume-with-inline-bind-mount-comment pattern exactly
> — it removes the #1 permissions failure while keeping the escape hatch discoverable. Do **not**
> copy the missing healthchecks.

### 1.7 Linkwarden

```yaml
services:
  postgres:
    image: postgres:16-alpine
    env_file: .env
    restart: always
    volumes:
      - ./pgdata:/var/lib/postgresql/data
  linkwarden:
    env_file: .env
    environment:
      - DATABASE_URL=postgresql://postgres:${POSTGRES_PASSWORD}@postgres:5432/postgres
    restart: always
    image: ghcr.io/linkwarden/linkwarden:latest
    ports:
      - 3000:3000
    volumes:
      - ./data:/data/data
    depends_on:
      - postgres
      - meilisearch
  meilisearch:
    image: getmeili/meilisearch:v1.12.8
    restart: always
    env_file:
      - .env
    volumes:
      - ./meili_data:/meili_data
```

Anti-patterns to avoid: bind mounts everywhere (`./pgdata`, `./data`, `./meili_data`) → root-owned
directories on the host and permission pain; `depends_on` without `condition: service_healthy`
→ startup races; `latest` unpinned; no healthchecks. Also `${POSTGRES_PASSWORD}` is interpolated
into `DATABASE_URL` in the compose file, so the password must be URL-safe and the user has to get
it right in two places.

### 1.8 Actual Budget

Documented run command:

```
docker run --pull=always --restart=unless-stopped -d -p 5006:5006 \
  -v YOUR/PATH/TO/DATA:/data --name my_actual_budget actualbudget/actual-server:latest
```

Port 5006. Data at `/data`, where the app creates `server-files` and `user-files`.
Published to **both** Docker Hub (`actualbudget/actual-server`) and GHCR
(`ghcr.io/actualbudget/actual`). `--pull=always` in the documented command is a nice touch —
it makes `docker run` idempotent-ish for updates.
**UNVERIFIED:** specific env vars (`ACTUAL_PORT`, upload size limit) and healthcheck definition
were not present on the page fetched.

> **What Fem-ho should do:** dual-publish to GHCR **and** Docker Hub (see §12); many self-hosters'
> tooling and mental model defaults to Docker Hub, and Docker Hub rate limits push people to
> GHCR — supporting both removes a whole class of complaint.

### 1.9 Baikal (CalDAV/CardDAV — directly relevant to Fem-ho's CalDAV feature)

Community image `ckulka/baikal`. Tags: `nginx` (recommended, lighter), `apache` (default),
`latest` (Apache, weekly rebuilds), plus version-pinned like `0.10.1-nginx`,
`0.10.1-apache-php8.2`.

Two volumes, both required for backup:
- `/var/www/baikal/Specific` — application data (SQLite DB lives here)
- `/var/www/baikal/config` — configuration

Quote: "These folders should be part of a regular backup."

Env: `BAIKAL_SKIP_CHOWN` (disables the `40-fix-baikal-file-permissions.sh` startup script),
`BAIKAL_SERVERNAME`, `BAIKAL_SERVERALIAS` (Apache variant).

**UNVERIFIED:** the exact `examples/docker-compose.yaml` content; the README references it but
does not inline it. Two variants exist: standard and `docker-compose.localvolumes.yaml` "for
local folder volumes to avoid file permission issues".

### 1.10 Radicale (CalDAV/CardDAV — the reverse-proxy reference)

Multi-platform images for **linux/amd64 and linux/arm64**, on both Docker Hub and GHCR. Tags:
`stable` (recommended), `3.6.1`, `latest`, nightly.

Their nginx block (verbatim) — this is the canonical CalDAV-behind-nginx config:

```nginx
location /radicale/ {
    proxy_pass        http://localhost:5232;
    proxy_set_header  X-Script-Name /radicale;
    proxy_set_header  X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header  X-Forwarded-Host $host;
    proxy_set_header  X-Forwarded-Port $server_port;
    proxy_set_header  X-Forwarded-Proto $scheme;
    proxy_set_header  Host $http_host;
    proxy_pass_header Authorization;
}
```

Caddy:

```
handle_path /radicale/* {
    uri strip_prefix /radicale
    reverse_proxy localhost:5232 {
        header_up Host HOST
        header_up X-Forwarded-Port PORT
    }
}
```

Apache:

```apache
RewriteEngine On
RewriteRule ^/radicale$ /radicale/ [R,L]

<Location "/radicale/">
    ProxyPass        http://localhost:5232/ retry=0
    ProxyPassReverse http://localhost:5232/
    RequestHeader    set X-Script-Name /radicale
    RequestHeader    set X-Forwarded-Port "%{SERVER_PORT}s"
    RequestHeader    set X-Forwarded-Proto expr=%{REQUEST_SCHEME}
    <IfVersion >= 2.4.40>
    Proxy100Continue Off
    </IfVersion>
</Location>
```

**Three critical, non-obvious details:**

1. **`proxy_pass_header Authorization;`** — nginx does not pass certain headers upstream by
   default in some configurations; CalDAV clients rely on Basic auth. Without this, auth
   silently fails.
2. **`X-Script-Name`** — the sub-path prefix is communicated explicitly so the server can
   generate correct absolute URLs inside DAV multistatus responses. This is the DAV analogue of
   "base URL"; getting it wrong produces a client that syncs once and then loops.
3. **`Proxy100Continue Off`** (Apache ≥ 2.4.40) — DAV clients send `Expect: 100-continue`; the
   proxy must not absorb it.
4. Trailing slash on the nginx `location /radicale/` is mandatory.

### 1.11 Nextcloud (the CalDAV `.well-known` reference)

From the official `nginx-root.conf.sample`:

```nginx
location = /.well-known/carddav { return 301 /remote.php/dav/; }
location = /.well-known/caldav  { return 301 /remote.php/dav/; }
```

```nginx
client_max_body_size 512M;
client_body_timeout 300s;
client_body_buffer_size 512k;
```

Env-var surface (official image):

- `NEXTCLOUD_ADMIN_USER`, `NEXTCLOUD_ADMIN_PASSWORD` — first-run admin seeding
- `NEXTCLOUD_TRUSTED_DOMAINS` — "Optional space-separated list of domains"
- `TRUSTED_PROXIES` — space-separated proxy addresses, CIDR supported
- `OVERWRITEHOST`, `OVERWRITEPROTOCOL`, `OVERWRITECLIURL`, `OVERWRITEWEBROOT`, `OVERWRITECONDADDR`
- `APACHE_DISABLE_REWRITE_IP=1`
- **`_FILE` convention**, quoted: "As an alternative to passing sensitive information via
  environment variables, `_FILE` may be appended to the previously listed environment variables,
  causing the initialization script to load the values for those variables from files present in
  the container."

Volumes: `/var/www/html` (install), `/var/www/html/data`, `/var/www/html/config`,
`/var/www/html/custom_apps`.

> The `OVERWRITE*` family exists *because* auto-detection behind a proxy is unreliable. Nextcloud's
> support forums are full of `OVERWRITEPROTOCOL=https` fixes. Fem-ho should ship the equivalent
> escape hatches but make them unnecessary in the common case.

---

## 2. Image build — recommended Dockerfile

### 2.1 Base image decision matrix

| Final base | Size | Use when | Caveats |
|---|---|---|---|
| `scratch` | ~0 | Pure static Go, no TLS to external hosts, no timezone data | No CA certs, no `/etc/passwd`, no tzdata, no shell — must `COPY` all three |
| `gcr.io/distroless/static-debian13:nonroot` | **~2 MiB** ("around 2 MiB", "approximately half the size of Alpine") | **Static Go binary — the recommendation for Fem-ho/Go** | Ships CA certs + tzdata + `/etc/passwd` with `nonroot`; no shell |
| `gcr.io/distroless/base-debian13:nonroot` | ~20 MiB (UNVERIFIED exact) | Go with cgo (e.g. `mattn/go-sqlite3`) — provides glibc | No shell |
| `gcr.io/distroless/cc-debian13:nonroot` | larger | Needs libgcc/libstdc++ | |
| `gcr.io/distroless/nodejs22-debian13:nonroot` / `nodejs24` / `nodejs26` | large-ish | Node/TS runtime | Entrypoint is `node`; no npm, no shell |
| `alpine:3.x` | ~8 MiB base | Need a shell for debugging or an entrypoint script | **musl libc**: Node native modules and Go+cgo need `CGO_ENABLED=0` or musl builds; historically DNS resolver quirks |
| `node:22-alpine` / `node:22-slim` | 50–200 MiB | Node app that needs npm at runtime (avoid) | |

Distroless tags available on **every** image: `latest`, `nonroot`, `debug`, `debug-nonroot`.
The `debug` variants add a BusyBox shell — invaluable for a `docker run --entrypoint sh` support
session. Architectures for Debian 13 distroless: amd64, arm64, arm, s390x, ppc64le, riscv64.

**The `nonroot` user is UID/GID 65532**, home `/home/nonroot` (mode 0700). Always write
`USER 65532:65532` numerically, not `USER nonroot:nonroot` — Kubernetes `runAsNonRoot` cannot
verify a string username, and numeric form is unambiguous when the image is rebased.

> Reference data point from Docker's own Go guide: the same app was **1.11 GB** single-stage
> (full toolchain) vs **28.1 MB** multi-stage on `gcr.io/distroless/base-debian11`.

### 2.2 Size targets for Fem-ho

| Component | Target compressed | Target uncompressed |
|---|---|---|
| Go backend + embedded SPA, distroless/static | **≤ 25 MB** | ≤ 60 MB |
| Go backend + cgo SQLite, distroless/base | ≤ 35 MB | ≤ 80 MB |
| Node/TS backend + SPA, distroless/nodejs22 | ≤ 90 MB | ≤ 250 MB |

These are engineering targets, not measurements. **UNVERIFIED** as applied to Fem-ho.

Strong argument for Go: a 25 MB image on a Raspberry Pi 4 with 2 GB RAM is a *very* different
adoption experience from a 250 MB Node image. Household self-hosters run on ARM SBCs and cheap
VPSes far more than the hosted-SaaS world assumes.

### 2.3 PID 1 and signal handling — the exact rules

From the Dockerfile reference, verbatim:

- Exec form: "the executable will be the container's `PID 1`, and will receive Unix signals."
- Shell form: "The shell form of `ENTRYPOINT` ignores any `CMD` or `docker run` command line
  arguments. It also starts your `ENTRYPOINT` as a subcommand of `/bin/sh -c`, which does not
  pass signals. This means that the executable will not be the container's `PID 1`, and will not
  receive Unix signals."

**Rules for Fem-ho:**

1. `ENTRYPOINT ["/femho"]` — **always JSON exec form**. Never `ENTRYPOINT /femho`.
2. The Go/Node process must install a SIGTERM handler that: stops accepting new connections,
   drains in-flight HTTP requests (including open SSE/MCP streams — send a final event and close),
   closes the DB (SQLite: run `PRAGMA wal_checkpoint(TRUNCATE)`), then exits 0.
3. `STOPSIGNAL SIGTERM` (the default, but state it).
4. Compose: `stop_grace_period: 30s` (Compose default is **10 seconds** before SIGKILL). CalDAV
   syncs and long SSE streams want more.
5. If the container ever runs more than one process, or spawns children, add
   `init: true` in compose — "Runs an init process (PID 1) inside the container that forwards
   signals and reaps processes." For a single static binary this is unnecessary; do not add
   `tini` to a distroless image just for ceremony.
6. If Litestream is bundled in-container, Litestream itself becomes PID 1 via
   `litestream replicate -exec "…"` and handles supervision. (See §8.3.)

### 2.4 HEALTHCHECK

**UNVERIFIED (could not retrieve the section text):** repeated fetches of the Dockerfile
reference truncated before the `HEALTHCHECK` section, so I cannot quote the exact option defaults
(`--interval`, `--timeout`, `--start-period`, `--start-interval`, `--retries`) or the documented
exit-code semantics from the primary source. The Compose spec fields **are** verified:

```yaml
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost"]
  interval: 1m30s
  timeout: 10s
  retries: 3
  start_period: 40s
  start_interval: 5s
```

`test` may be a string or a list beginning with `NONE`, `CMD`, or `CMD-SHELL`. `start_interval`
is the fast-probe interval during `start_period` — use it to get to `healthy` quickly without
hammering the app forever after.

Because distroless has **no shell, no curl, no wget**, the healthcheck must be the app binary
itself (the Miniflux pattern):

```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --start-interval=2s --retries=3 \
  CMD ["/femho", "healthcheck"]
```

`femho healthcheck` should do an HTTP GET to `http://127.0.0.1:${FEMHO_PORT}/healthz` and exit 0
or 1. Note: with `CMD` in **exec (JSON) form** no shell is involved, which is required here.

### 2.5 Recommended Dockerfile — Go backend + embedded SPA

```dockerfile
# syntax=docker/dockerfile:1.10

########## 1. Frontend build ##########
FROM --platform=$BUILDPLATFORM node:22-alpine AS frontend
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci
COPY frontend/ ./
RUN npm run build          # -> /src/frontend/dist

########## 2. Backend build ##########
FROM --platform=$BUILDPLATFORM golang:1.24-alpine AS backend
WORKDIR /src

# Dependency layer: cached unless go.mod/go.sum change
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download

COPY . .
# Embedded SPA served by the Go binary via embed.FS
COPY --from=frontend /src/frontend/dist ./internal/web/dist

ARG TARGETOS
ARG TARGETARCH
ARG VERSION=dev
ARG COMMIT=unknown
ARG BUILD_DATE

# CGO_ENABLED=0 -> fully static -> distroless/static works.
# Requires a pure-Go SQLite driver (modernc.org/sqlite or ncruces/go-sqlite3).
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} \
    go build -trimpath \
      -ldflags="-s -w \
        -X main.version=${VERSION} \
        -X main.commit=${COMMIT} \
        -X main.buildDate=${BUILD_DATE}" \
      -o /out/femho ./cmd/femho

########## 3. Runtime ##########
FROM gcr.io/distroless/static-debian13:nonroot

# OCI labels: shown by `docker inspect`, GHCR package page, and Watchtower UIs
LABEL org.opencontainers.image.title="Fem-ho" \
      org.opencontainers.image.description="Self-hosted personal and family task manager" \
      org.opencontainers.image.source="https://github.com/<org>/fem-ho" \
      org.opencontainers.image.documentation="https://<org>.github.io/fem-ho" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later"

COPY --from=backend /out/femho /femho

# /data is the ONE volume. Owned by 65532 so the non-root user can write it.
# (Named volumes inherit the image's directory ownership on first creation.)
COPY --from=backend --chown=65532:65532 /src/build/empty-data /data

ENV FEMHO_DATA_DIR=/data \
    FEMHO_PORT=8080 \
    FEMHO_DATABASE_TYPE=sqlite \
    TZ=UTC

USER 65532:65532
WORKDIR /data
EXPOSE 8080
VOLUME ["/data"]

STOPSIGNAL SIGTERM

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --start-interval=2s --retries=3 \
  CMD ["/femho", "healthcheck"]

ENTRYPOINT ["/femho"]
CMD ["serve"]
```

Notes on the above:

- `--platform=$BUILDPLATFORM` on the build stages + `GOARCH=${TARGETARCH}` = **cross-compilation
  instead of QEMU emulation**. This is the difference between a 4-minute and a 40-minute
  multi-arch CI build. `TARGETPLATFORM`, `TARGETOS`, `TARGETARCH`, `BUILDPLATFORM` are BuildKit
  predefined ARGs; they must be re-declared with `ARG` in the stage that uses them.
- `CGO_ENABLED=0` requires a **pure-Go SQLite driver**. `github.com/mattn/go-sqlite3` needs cgo;
  `modernc.org/sqlite` and `github.com/ncruces/go-sqlite3` (wazero/WASM) do not. If the backend
  dossier picked `mattn/go-sqlite3`, switch the runtime base to
  `gcr.io/distroless/base-debian13:nonroot` and build with `CGO_ENABLED=1` plus a musl/glibc
  cross toolchain — significantly more CI complexity. **Prefer a pure-Go driver.**
- `-trimpath -ldflags="-s -w"` strips paths and debug info: typically 25–30% smaller binary.
- `VOLUME ["/data"]` is debatable — it makes anonymous volumes appear if the user forgets to mount.
  Keep it: an accidental anonymous volume is recoverable, a container that writes to the
  container layer and loses everything on `docker compose down` is not.
- The `COPY --chown=65532:65532 … /data` trick creates the directory with correct ownership.
  A simpler alternative if you have a shell in an earlier stage:
  `RUN mkdir -p /out/data && chown 65532:65532 /out/data` then `COPY --from=backend /out/data /data`.

### 2.6 Recommended Dockerfile — Node/TypeScript backend

```dockerfile
# syntax=docker/dockerfile:1.10

########## deps ##########
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

########## build ##########
FROM deps AS build
COPY . .
RUN npm run build                 # tsc / vite -> /app/dist and /app/public

########## prod deps only ##########
FROM deps AS proddeps
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

########## runtime ##########
FROM gcr.io/distroless/nodejs22-debian13:nonroot

LABEL org.opencontainers.image.title="Fem-ho" \
      org.opencontainers.image.source="https://github.com/<org>/fem-ho" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later"

WORKDIR /app
COPY --from=proddeps --chown=65532:65532 /app/node_modules ./node_modules
COPY --from=build    --chown=65532:65532 /app/dist        ./dist
COPY --from=build    --chown=65532:65532 /app/public      ./public
COPY --from=build    --chown=65532:65532 /app/package.json ./

ENV NODE_ENV=production \
    FEMHO_DATA_DIR=/data \
    FEMHO_PORT=8080

USER 65532:65532
EXPOSE 8080
VOLUME ["/data"]
STOPSIGNAL SIGTERM

# distroless/nodejs ENTRYPOINT is already ["/nodejs/bin/node"], so CMD is just args.
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --start-interval=2s --retries=3 \
  CMD ["/nodejs/bin/node", "dist/healthcheck.js"]

CMD ["dist/server.js"]
```

Node-specific gotchas:

- **`node` is not PID 1 signal-safe by default in the way you'd hope**: Node *does* receive
  SIGTERM as PID 1, but it will **not** exit unless you register a handler. A Node app with no
  `process.on('SIGTERM')` handler hangs until `stop_grace_period` expires and gets SIGKILLed —
  which for SQLite means a hot journal on every single `docker compose restart`. **Always**
  register the handler.
- Native modules (`better-sqlite3`, `bcrypt`, `sharp`) are compiled per-platform. Under multi-arch
  buildx with cross-compilation they will be built for the *build* platform and break at runtime.
  Either (a) build natively per-arch on separate runners (see §12.2), or (b) use pure-JS
  alternatives (`node:sqlite` built-in in Node 22+, `@node-rs/argon2` prebuilds, `argon2-browser`).
- If you must use Alpine + native modules, note **musl**: `better-sqlite3` prebuilds are glibc.
  Use `-bookworm-slim` / distroless (glibc) rather than Alpine for Node.

### 2.7 `.dockerignore` (matters more than people think)

```
.git
.github
node_modules
**/node_modules
dist
build
*.log
.env
.env.*
!.env.example
docs/
*.md
!README.md
coverage/
.vscode
.idea
tmp/
data/
*.db
*.db-wal
*.db-shm
Dockerfile*
compose*.yaml
docker-compose*.yml
```

Without this, `COPY . .` ships the developer's local `data/femho.db` into the image. That has
happened to real projects.

> **What Fem-ho should do:** Go + `modernc.org/sqlite` + `distroless/static-debian13:nonroot`,
> cross-compiled with `--platform=$BUILDPLATFORM`, UID 65532, exec-form entrypoint, `femho
> healthcheck` subcommand, single `/data` volume, target ≤25 MB compressed. If the backend
> dossier chose Node/TS, use `distroless/nodejs22-debian13:nonroot`, avoid native modules, and
> build each arch on its native runner.

---

## 3. Multi-arch (amd64 + arm64)

Non-negotiable for this product category. A large share of household self-hosters run Raspberry
Pi, Rock/Orange Pi, ARM VPSes (Oracle Ampere free tier, Hetzner CAX, AWS Graviton), and Apple
Silicon under Docker Desktop. An amd64-only image is an instant abandon.

**Minimum:** `linux/amd64,linux/arm64`.
**Optional:** `linux/arm/v7` — only if a pure-Go build makes it free. It doubles support burden
(32-bit time_t, memory limits) for a shrinking user base. Recommend **skip**, and say so.

Two strategies:

1. **Cross-compile in one job** (recommended for Go). `docker/setup-qemu-action` is still needed
   if any stage runs target-arch binaries, but with `--platform=$BUILDPLATFORM` on all build
   stages plus `GOARCH=$TARGETARCH`, nothing runs under emulation. One runner, fast.
2. **One runner per platform + merge by digest** (required for Node native modules). Docker's docs
   now point at reusable workflows `docker/github-builder/.github/workflows/build.yml@v1` and
   `bake.yml@v1`; with `distribute: true` (the default) the workflow "splits the build into one
   platform per runner and assembles the final multi-platform image in its finalize phase."

Verified current action versions (from Docker's multi-platform CI docs):
`docker/login-action@v4`, `docker/setup-qemu-action@v4`, `docker/setup-buildx-action@v4`,
`docker/build-push-action@v7`, `docker/metadata-action@v6`.

Platforms input syntax: `platforms: linux/amd64,linux/arm64`.

---

## 4. `compose.yaml` for Fem-ho

Ship **two** files. Do not ship one file with half the lines commented out — that is the
single most common source of "it doesn't start" issues.

- `compose.yaml` — SQLite, single container. **This is what the README shows.**
- `compose.postgres.yaml` — Postgres variant, for households with >5 users or an existing PG.

Filename note: modern Compose prefers `compose.yaml`. Also ship a `docker-compose.yml` symlink or
copy for muscle memory / older tooling. (Compose v2 reads both; `compose.yaml` takes precedence.)

### 4.1 Minimal SQLite single-container variant (the README hero)

```yaml
# Fem-ho — minimal self-hosted setup (SQLite, one container).
# 1. curl -O https://github.com/<org>/fem-ho/releases/latest/download/compose.yaml
# 2. docker compose up -d
# 3. open http://<your-server>:8080 and create the first account (it becomes admin)
name: femho

services:
  femho:
    image: ghcr.io/<org>/femho:${FEMHO_VERSION:-1}
    container_name: femho
    restart: unless-stopped
    ports:
      - "${FEMHO_HTTP_PORT:-8080}:8080"
    environment:
      # Everything below is optional. Fem-ho works with zero configuration.
      TZ: ${TZ:-Europe/Madrid}
      # FEMHO_URL: https://femho.example.com   # set once you are behind a reverse proxy
    volumes:
      # Named volume: no permission problems. To use a host directory instead, replace with:
      #   - /srv/femho/data:/data
      # and add:  user: "1000:1000"
      - femho-data:/data
    stop_grace_period: 30s
    healthcheck:
      test: ["CMD", "/femho", "healthcheck"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s
      start_interval: 2s

volumes:
  femho-data:
```

That is **28 lines including comments** and runs with zero edits. That is the bar.

### 4.2 Postgres variant

```yaml
# Fem-ho — PostgreSQL setup. Recommended for >5 users or if you already run Postgres.
# Copy .env.example to .env and set FEMHO_DB_PASSWORD before starting.
name: femho

services:
  femho:
    image: ghcr.io/<org>/femho:${FEMHO_VERSION:-1}
    container_name: femho
    restart: unless-stopped
    ports:
      - "${FEMHO_HTTP_PORT:-8080}:8080"
    environment:
      TZ: ${TZ:-Europe/Madrid}
      FEMHO_URL: ${FEMHO_URL:-}
      FEMHO_DATABASE_TYPE: postgres
      FEMHO_DATABASE_HOST: db
      FEMHO_DATABASE_PORT: "5432"
      FEMHO_DATABASE_NAME: femho
      FEMHO_DATABASE_USER: femho
      FEMHO_DATABASE_PASSWORD_FILE: /run/secrets/db_password
      FEMHO_SECRET_KEY_FILE: /run/secrets/secret_key   # optional; auto-generated if absent
      FEMHO_TRUSTED_PROXIES: ${FEMHO_TRUSTED_PROXIES:-private}
    secrets:
      - db_password
      - secret_key
    volumes:
      - femho-data:/data          # attachments, generated keys, cache
    depends_on:
      db:
        condition: service_healthy
        restart: true
    stop_grace_period: 30s
    healthcheck:
      test: ["CMD", "/femho", "healthcheck"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s
      start_interval: 2s
    deploy:
      resources:
        limits:
          memory: 1g
        reservations:
          memory: 128m

  db:
    image: docker.io/library/postgres:17-alpine
    container_name: femho-db
    restart: unless-stopped
    environment:
      POSTGRES_DB: femho
      POSTGRES_USER: femho
      POSTGRES_PASSWORD_FILE: /run/secrets/db_password
      POSTGRES_INITDB_ARGS: "--data-checksums"
    secrets:
      - db_password
    volumes:
      # PostgreSQL <= 17: the data directory MUST be /var/lib/postgresql/data.
      # PostgreSQL >= 18: use /var/lib/postgresql  (PGDATA moved to /var/lib/postgresql/18/docker)
      - femho-db:/var/lib/postgresql/data
    shm_size: 128mb
    stop_grace_period: 1m
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U femho -d femho"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s
    deploy:
      resources:
        limits:
          memory: 1g

secrets:
  db_password:
    file: ./secrets/db_password.txt
  secret_key:
    file: ./secrets/secret_key.txt

volumes:
  femho-data:
  femho-db:
```

Verified spec details used above:

- `depends_on` long syntax: `condition` ∈ `service_started` | `service_healthy` |
  `service_completed_successfully`; `restart: true` (Compose ≥ 2.17.0) restarts the dependent
  when the dependency is updated; `required: false` (≥ 2.20.0) downgrades a missing dependency to
  a warning.
- `restart` values: `"no"` (default), `always`, `on-failure`, `on-failure:N`, `unless-stopped`.
  **Use `unless-stopped`**, not `always`: `always` restarts containers the operator deliberately
  stopped, which is infuriating during maintenance.
- Compose `secrets` file source mounts under `/run/secrets/<target|source>`, default mode `0444`,
  with optional `uid`/`gid`/`mode`.
- `stop_grace_period` default is **10 seconds**.
- `shm_size: 128mb` for Postgres (matches Immich).
- `POSTGRES_PASSWORD_FILE` etc. are natively supported by the official Postgres image; `_FILE` is
  supported for `POSTGRES_PASSWORD`, `POSTGRES_USER`, `POSTGRES_DB`, `POSTGRES_INITDB_ARGS`.

**Postgres version choice:** pin to `17-alpine` today rather than 18, because of the PGDATA path
change (§4.4) — an unannounced volume-path change is exactly the kind of upgrade that makes
people abandon. If you ship 18, ship it with a loud migration note and a version check on boot.

### 4.3 Reverse-proxy-included variant (`compose.caddy.yaml`)

```yaml
name: femho

services:
  caddy:
    image: docker.io/library/caddy:2-alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
      - "443:443/udp"      # HTTP/3
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
      - caddy-config:/config
    depends_on:
      femho:
        condition: service_healthy

  femho:
    image: ghcr.io/<org>/femho:${FEMHO_VERSION:-1}
    restart: unless-stopped
    expose:
      - "8080"             # NOT published to the host
    environment:
      FEMHO_URL: https://${FEMHO_DOMAIN}
      FEMHO_TRUSTED_PROXIES: private
      TZ: ${TZ:-Europe/Madrid}
    volumes:
      - femho-data:/data
    healthcheck:
      test: ["CMD", "/femho", "healthcheck"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s

volumes:
  femho-data:
  caddy-data:
  caddy-config:
```

### 4.4 Postgres data-directory trap (verified, important)

From the official Postgres image documentation:

- **PostgreSQL 18+**: `PGDATA` defaults to a version-specific path,
  e.g. `/var/lib/postgresql/18/docker`. Mount the volume at `/var/lib/postgresql`.
- **PostgreSQL ≤ 17**: mount at `/var/lib/postgresql/data`.
- Quote: "Mount the data volume at `/var/lib/postgresql/data` and not at `/var/lib/postgresql`
  because mounts at the latter path WILL NOT PERSIST database data."

Note that Paperless-ngx (with `postgres:18`) and Miniflux (`postgres:18`) mount
`/var/lib/postgresql`, while Immich (`postgres:14` base) and Linkwarden (`postgres:16-alpine`)
mount `/var/lib/postgresql/data`. Both are correct for their versions. Getting this backwards
silently discards the database on container recreation — the worst possible failure mode.

> **What Fem-ho should do:** on startup, if `FEMHO_DATABASE_TYPE=postgres`, log the detected
> server version and, in the docs, put the two mount paths in a box with the version each applies
> to. Consider a startup check that queries `pg_stat_file` / `current_setting('data_directory')`
> and warns if the data directory is inside a non-persistent path — **UNVERIFIED** whether this is
> reliably detectable from inside the app; treat as a nice-to-have.

### 4.5 Resource hints

Fem-ho is a task manager, not a photo pipeline. Realistic numbers (**UNVERIFIED** — engineering
estimates, must be measured):

| Service | Reservation | Limit | Note |
|---|---|---|---|
| `femho` (Go, SQLite, family of 5) | 64m | 512m | should idle < 40 MB RSS |
| `femho` (Go, Postgres, 20 users) | 128m | 1g | |
| `femho` (Node/TS) | 256m | 1g | V8 baseline is much higher |
| `db` (Postgres) | 128m | 1g | plus `shm_size: 128mb` |
| `caddy` | 32m | 256m | |

Document the total: **"Fem-ho runs comfortably on a Raspberry Pi 4 with 1 GB free RAM"** — if
true, that sentence in the README is worth more than a feature list.

Add `deploy.resources.limits` but **not** CPU limits by default: CPU limits on a Pi make first-run
migrations painfully slow and produce "it's stuck" reports.

---

## 5. Configuration

### 5.1 12-factor env vars vs mounted config file — the answer is both, layered

Every successful project in §1 supports both. The layering that works:

```
built-in defaults
  ← config file (/data/config.yaml, or FEMHO_CONFIG_FILE)
    ← environment variables (FEMHO_*)
      ← *_FILE indirection resolved last (highest precedence for that specific key)
```

Rationale:
- **Env-only** breaks for anything list- or map-shaped (per-scope CalDAV settings, OIDC providers,
  SMTP templates) and makes `docker inspect` leak secrets.
- **File-only** breaks Docker-native workflows, Portainer/Dockge/Komodo stack editors, and
  Kubernetes ConfigMaps.

**Config file search order for Fem-ho** (keep it to three, unlike Vikunja's four):

1. `$FEMHO_CONFIG_FILE` if set (fail loudly if set and unreadable)
2. `/data/config.yaml`
3. `./config.yaml` (working directory — dev convenience)

The file must be **optional**. Fem-ho must boot with no config file at all.

### 5.2 The `FEMHO_` env prefix and naming rules

Rules:
- Prefix: `FEMHO_`
- Nesting: single underscore per level, matching the YAML path.
  `service.url` → `FEMHO_SERVICE_URL`; `database.host` → `FEMHO_DATABASE_HOST`.
- Avoid config keys that themselves contain underscores (that is why Gitea needs `__`).
  Use `publicUrl` in YAML → `FEMHO_SERVICE_PUBLICURL`, or better: keep keys single-word.
- Lists via comma separation: `FEMHO_TRUSTED_PROXIES=10.0.0.0/8,172.16.0.0/12`.
- Booleans: accept `true/false/1/0/yes/no/on/off`, case-insensitive.
- Durations: Go duration strings (`30s`, `15m`, `720h`) — document the format.

### 5.3 Env var table (proposed, exhaustive for v1)

| Variable | Default | Required | `_FILE` | Purpose |
|---|---|---|---|---|
| `FEMHO_URL` | *(derived)* | no | no | Public base URL. Sets public URL + CSRF trusted origins + CORS origins + CalDAV href base, Paperless-style. Include the path if sub-path hosted: `https://x.com/femho` |
| `FEMHO_PORT` | `8080` | no | no | Listen port inside the container |
| `FEMHO_BIND` | `0.0.0.0` | no | no | Listen address |
| `FEMHO_DATA_DIR` | `/data` | no | no | Root of all persistent state. **Do not change in Docker.** |
| `FEMHO_CONFIG_FILE` | *(unset)* | no | no | Explicit config file path |
| `FEMHO_SECRET_KEY` | *(auto-generated & persisted)* | no | **yes** | Signs sessions/JWTs, encrypts share-link tokens |
| `FEMHO_DATABASE_TYPE` | `sqlite` | no | no | `sqlite` \| `postgres` |
| `FEMHO_DATABASE_PATH` | `${FEMHO_DATA_DIR}/femho.db` | no | no | SQLite file |
| `FEMHO_DATABASE_HOST` | `db` | pg | no | |
| `FEMHO_DATABASE_PORT` | `5432` | no | no | |
| `FEMHO_DATABASE_NAME` | `femho` | no | no | |
| `FEMHO_DATABASE_USER` | `femho` | no | no | |
| `FEMHO_DATABASE_PASSWORD` | — | pg | **yes** | |
| `FEMHO_DATABASE_SSLMODE` | `prefer` | no | no | |
| `FEMHO_DATABASE_URL` | *(unset)* | no | **yes** | Full DSN; overrides the individual vars |
| `FEMHO_RUN_MIGRATIONS` | `true` | no | no | Set `false` for multi-replica / manual control |
| `FEMHO_MIGRATION_BACKUP` | `true` | no | no | SQLite: `VACUUM INTO` snapshot before migrating |
| `FEMHO_TRUSTED_PROXIES` | *(empty)* | no | no | `private` \| comma-separated CIDRs \| `*` (dangerous). Empty ⇒ ignore all `X-Forwarded-*` |
| `FEMHO_CREATE_ADMIN` | `false` | no | no | Env-seeded first admin |
| `FEMHO_ADMIN_EMAIL` | — | if above | no | |
| `FEMHO_ADMIN_PASSWORD` | — | if above | **yes** | |
| `FEMHO_ADMIN_NAME` | `Admin` | no | no | |
| `FEMHO_REGISTRATION_ENABLED` | `true` until first user, then `false` | no | no | Open-registration policy |
| `FEMHO_SETUP_TOKEN` | *(auto, printed to log)* | no | **yes** | One-time token guarding the setup wizard |
| `FEMHO_LOG_LEVEL` | `info` | no | no | `debug`\|`info`\|`warn`\|`error` |
| `FEMHO_LOG_FORMAT` | `auto` | no | no | `json`\|`text`\|`auto` (text if TTY) |
| `FEMHO_METRICS_ENABLED` | `false` | no | no | Exposes `/metrics` |
| `FEMHO_METRICS_TOKEN` | *(unset)* | no | **yes** | Bearer token required for `/metrics` |
| `FEMHO_CALDAV_ENABLED` | `true` | no | no | |
| `FEMHO_MCP_ENABLED` | `true` | no | no | Streamable HTTP MCP endpoint |
| `FEMHO_MCP_ALLOWED_ORIGINS` | *(derived from `FEMHO_URL`)* | no | no | Required by MCP spec's Origin validation |
| `FEMHO_MAX_UPLOAD_SIZE` | `50MiB` | no | no | Attachment cap |
| `FEMHO_SMTP_HOST` / `_PORT` / `_USER` | — | no | user: no | Email for invites & password reset |
| `FEMHO_SMTP_PASSWORD` | — | no | **yes** | |
| `FEMHO_SMTP_FROM` | `femho@localhost` | no | no | |
| `FEMHO_SHARE_LINKS_ENABLED` | `true` | no | no | Public share links feature flag |
| `FEMHO_SHARE_LINK_MAX_TTL` | `720h` | no | no | Hard cap on share-link expiry |
| `FEMHO_DEFAULT_LOCALE` | `ca` | no | no | UI language (Catalan default) |
| `FEMHO_DEFAULT_TIMEZONE` | `Europe/Madrid` | no | no | |
| `TZ` | `UTC` | no | no | Container timezone (standard) |
| `PUID` / `PGID` | `65532` | no | no | **UNVERIFIED as implementable** on distroless (no shell/`usermod`). If bind-mount support with arbitrary UID is required, use compose's `user:` instead |

### 5.4 The `_FILE` suffix convention — exact implementation

The convention, as implemented by Nextcloud, Postgres, Gitea (`__FILE`) and Vikunja (`_FILE`):

```
For any config key K resolvable from env var FEMHO_K:
  if FEMHO_K_FILE is set:
      read the file at that path
      strip exactly one trailing newline (\n or \r\n)
      use the contents as the value of K
      if the file is missing or unreadable -> FATAL, exit non-zero with the path in the message
  else if FEMHO_K is set:
      use it
```

Pseudocode (Go):

```go
func envOrFile(key string) (string, bool, error) {
    if p, ok := os.LookupEnv(key + "_FILE"); ok {
        b, err := os.ReadFile(p)
        if err != nil {
            return "", false, fmt.Errorf("%s_FILE=%s: %w", key, p, err)
        }
        return strings.TrimRight(string(b), "\r\n"), true, nil
    }
    v, ok := os.LookupEnv(key)
    return v, ok, nil
}
```

Rules:
- **Both set → `_FILE` wins**, and log a warning naming both.
- Applies to every secret-shaped key: DB password, DB URL, secret key, SMTP password, admin
  password, metrics token, setup token.
- Trailing-newline stripping is mandatory: `echo "pass" > secret.txt` produces `pass\n` and
  everybody hits this.
- Works with Docker Compose `secrets:` (mounted at `/run/secrets/<name>`), Docker Swarm secrets,
  Kubernetes secret volumes, and plain bind-mounted files. One convention, four platforms.

### 5.5 Generating and persisting the signing key on first boot

This is the difference between a 28-line compose file and a 40-line one with a scary
"generate a secret first" step.

Algorithm:

```
key_path = ${FEMHO_DATA_DIR}/secret.key

1. If FEMHO_SECRET_KEY or FEMHO_SECRET_KEY_FILE is set -> use it, do not touch key_path.
   (Operator-managed. Log "using operator-supplied secret key".)
2. Else if key_path exists and is non-empty -> read it.
   Validate length >= 32 bytes of entropy; if not, FATAL with instructions.
3. Else:
   - Generate 32 bytes from crypto/rand.
   - Write hex/base64 to key_path with mode 0600 via write-to-temp + fsync + atomic rename.
   - Log at WARN:  "Generated a new signing key at /data/secret.key. Back this up: losing it
     logs out every user and invalidates all share links and API tokens."
4. If key_path cannot be created (read-only /data) -> FATAL with a clear message telling the
   user to either make /data writable or set FEMHO_SECRET_KEY.
```

Notes:
- **Never** silently regenerate on each boot (Vikunja's documented default of "generates randomly
  at startup if unset" means every restart logs everyone out — do not copy this).
- The key must be **fsync'd before** the server starts issuing tokens, or a power loss right after
  first boot produces tokens signed by a key that no longer exists.
- Rotation: provide `femho secret rotate --keep-old-for 720h` that adds a new key and keeps the
  old one in a verify-only key set, so rotation doesn't nuke every session and Android client.
- The key file must be included in the documented backup set — call it out explicitly.

### 5.6 The base-URL / behind-a-proxy problem (this breaks CalDAV, OAuth and share links)

This is the highest-frequency failure in self-hosted apps and it has three distinct sub-problems.

**(a) Scheme confusion.** The proxy terminates TLS and talks HTTP to the app. Without
`X-Forwarded-Proto`, the app generates `http://` links: OAuth/OIDC redirect URIs mismatch,
browsers block mixed content, and share links emailed to guests point at plaintext.

**(b) Host confusion.** `Host` may be rewritten by the proxy. CalDAV `multistatus` responses
contain absolute or root-relative `<D:href>` values; if the base is wrong, clients enumerate
collections that 404 and the sync loop never converges.

**(c) Sub-path confusion.** Served at `/femho`, the app must prefix every generated href.
Radicale solves this with an explicit `X-Script-Name` header; Nextcloud with `OVERWRITEWEBROOT`.

**Recommended resolution order for Fem-ho:**

```
1. If FEMHO_URL is set -> it is absolute truth. Scheme, host, port, path prefix all come from it.
   (Also: validate at boot. If it has a trailing slash, strip it. If it has a query or fragment,
   FATAL.)
2. Else, if the request's remote address is within FEMHO_TRUSTED_PROXIES:
       scheme  = X-Forwarded-Proto  (first value)  else Forwarded: proto=  else request scheme
       host    = X-Forwarded-Host   (first value)  else Host
       port    = X-Forwarded-Port                  else implied by scheme
       prefix  = X-Forwarded-Prefix                else X-Script-Name  else ""
3. Else (untrusted): use the request's own scheme/Host and ignore ALL X-Forwarded-* headers.
```

**`FEMHO_TRUSTED_PROXIES` semantics** (copy Caddy's design, which is the best in class):

- Empty / unset (**default**): all `X-Forwarded-*` are ignored. Caddy's docs state incoming
  `X-Forwarded-*` values are "ignored to prevent spoofing" unless `trusted_proxies` is configured.
  Fem-ho must be safe by default too — otherwise anyone can spoof `X-Forwarded-For` and defeat
  rate limiting / audit logging.
- `private` → the RFC1918 + RFC4193 + loopback set:
  `127.0.0.0/8, ::1/128, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, fd00::/8, 169.254.0.0/16`.
  This is Caddy's `private_ranges`. **This is the right default to *document*** for compose
  setups, where the proxy is always on a Docker bridge network (172.16–172.31).
- Explicit CIDR list for anything else.
- `*` accepted but logged as a loud WARN every 5 minutes.

**Concrete failure modes to test in CI:**

| Scenario | Symptom if wrong |
|---|---|
| Caddy `https://x/` → app | CalDAV `href` uses `http://` → Thunderbird/DAVx5 error |
| nginx sub-path `/femho/` | DAVx5 discovers `/dav/...` instead of `/femho/dav/...` |
| Cloudflare Tunnel (no `X-Forwarded-Port`) | port `:443` appended twice or dropped |
| `X-Forwarded-For: 1.2.3.4, 10.0.0.5` (chained) | rate limiter keys on the wrong IP |
| Direct `http://192.168.1.10:8080` (no proxy) | must still work, no config |

**What to output on boot** (this single log line prevents most support tickets):

```
INFO  fem-ho v1.4.2 (commit a1b2c3d) starting
INFO  public base URL: https://femho.example.com  (source: FEMHO_URL)
INFO  trusted proxies: private ranges (127.0.0.0/8, ::1/128, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, fd00::/8)
INFO  database: postgres 17.4 @ db:5432/femho  (migrations: 41 applied, 0 pending)
INFO  data dir: /data (writable, 12.4 GiB free)
INFO  CalDAV:   https://femho.example.com/dav/
INFO  MCP:      https://femho.example.com/mcp
INFO  listening on 0.0.0.0:8080
```

Add a `femho doctor` subcommand that fetches its own `FEMHO_URL` from inside the container and
reports what scheme/host/prefix the request arrived with — turning a two-day forum thread into a
30-second self-diagnosis.

> **What Fem-ho should do:** default to deriving the base URL; make `FEMHO_URL` the single
> override that fixes everything; default `FEMHO_TRUSTED_PROXIES` to empty (safe) but ship
> `private` in every compose file that includes a proxy; support `X-Forwarded-Prefix` **and**
> `X-Script-Name` for sub-path hosting; print the boot banner above.

---

## 6. Reverse proxy configurations

### 6.1 The three hard requirements Fem-ho places on a proxy

1. **Arbitrary HTTP methods must pass through**: `PROPFIND`, `PROPPATCH`, `REPORT`, `MKCALENDAR`,
   `MKCOL`, `OPTIONS`, `COPY`, `MOVE`, `DELETE`, and `LOCK`/`UNLOCK` if implemented.
2. **Response buffering must be off** for SSE and MCP Streamable HTTP, and **request buffering
   must be off** for large uploads.
3. **`Authorization` must reach the app**, including on `OPTIONS` preflight-ish DAV discovery.

### 6.2 nginx

**Important clarification (verified):** nginx's `proxy_pass` **preserves the client's request
method by default** for all methods, including WebDAV methods. `proxy_method` only exists to
*override* it. So plain `proxy_pass` does **not** block PROPFIND.

What *does* block DAV methods, in practice:

- **`limit_except`** — `limit_except GET POST { deny all; }` blocks everything else. Common in
  hardened templates.
- **`ngx_http_dav_module`** — but note: this module is for nginx *serving* WebDAV from the
  filesystem, not proxying. `dav_methods` supports only **PUT, DELETE, MKCOL, COPY, MOVE**;
  default is `dav_methods off;`. The docs warn verbatim: "WebDAV clients that require additional
  WebDAV methods to operate will not work with this module." It is **not built by default**
  (`--with-http_dav_module`). **Do not enable it for Fem-ho** — it is the wrong tool and
  enabling it can intercept `PUT`/`DELETE` before `proxy_pass`.
- **ModSecurity / OWASP CRS** — rule **`911100`**:
  ```
  SecRule REQUEST_METHOD "!@within %{tx.allowed_methods}" \
      "id:911100,phase:1,block,msg:'Method is not allowed by policy',…"
  ```
  `tx.allowed_methods` is set in `crs-setup.conf`. **DAV methods are not in the default list.**
  Fix, in `crs-setup.conf` (or a `before-crs` include):
  ```
  SecAction "id:900200,phase:1,nolog,pass,t:none,\
    setvar:'tx.allowed_methods=GET HEAD POST PUT PATCH DELETE OPTIONS \
      PROPFIND PROPPATCH MKCOL MKCALENDAR COPY MOVE REPORT LOCK UNLOCK'"
  ```
  Also relevant paranoia-level rules in the same file: 911011–911018.
- **Cloudflare / WAFs in front** — **UNVERIFIED**, but widely reported to block or mangle
  non-standard methods on some plans. Document "if you use Cloudflare proxy (orange cloud), create
  a WAF bypass rule for `/dav/*`" as a known-issue note, flagged as community-reported.
- **`if` blocks with `return 405`** in copy-pasted "security" configs.

**Recommended nginx server block for Fem-ho:**

```nginx
# /etc/nginx/conf.d/femho.conf
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 443 ssl;
    http2 on;
    server_name femho.example.com;

    ssl_certificate     /etc/letsencrypt/live/femho.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/femho.example.com/privkey.pem;

    # Attachments. 0 = unlimited; prefer an explicit cap matching FEMHO_MAX_UPLOAD_SIZE.
    client_max_body_size 200M;
    client_body_timeout  300s;

    # RFC 6764 service discovery. MUST be 301/303/307 per the RFC.
    location = /.well-known/caldav  { return 301 /dav/; }
    location = /.well-known/carddav { return 301 /dav/; }

    location / {
        proxy_pass http://femho:8080;

        proxy_http_version 1.1;                 # explicit: default is 1.1 only since nginx 1.29.7
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host  $host;
        proxy_set_header X-Forwarded-Port  $server_port;
        proxy_set_header Upgrade           $http_upgrade;
        proxy_set_header Connection        $connection_upgrade;

        # CalDAV clients rely on Basic auth; make sure it is forwarded.
        proxy_pass_header Authorization;

        # Large uploads: stream to the app instead of spooling to disk first.
        proxy_request_buffering off;

        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
    }

    # SSE + MCP Streamable HTTP: buffering MUST be off, timeouts long.
    location ~ ^/(mcp|api/v1/events|api/v1/stream) {
        proxy_pass http://femho:8080;

        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection        "";     # keep-alive, not "close"

        proxy_buffering    off;
        proxy_cache        off;
        chunked_transfer_encoding off;
        proxy_read_timeout 24h;
        proxy_send_timeout 24h;
    }

    # If sub-path hosted:
    # location /femho/ {
    #     proxy_pass http://femho:8080/;
    #     proxy_set_header X-Forwarded-Prefix /femho;
    #     proxy_set_header X-Script-Name      /femho;   # Radicale-compatible alias
    #     ... (all headers above)
    # }
}
```

**Belt-and-braces:** the app should also emit `X-Accel-Buffering: no` on every SSE/MCP response.
nginx honours it: `X-Accel-Buffering: yes|no` "can override this directive" (`proxy_buffering`),
"unless disabled via `proxy_ignore_headers`". This makes Fem-ho work behind a default nginx config
the user never edited — a huge adoption win.

Verified nginx defaults worth knowing:
- `proxy_buffering on;`
- `proxy_request_buffering on;` (directive added in 1.7.11)
- `proxy_http_version` default is `1.1` **since nginx 1.29.7**; previously `1.0`. Always set it
  explicitly, because most installed nginx is older.
- Default `proxy_set_header Host $proxy_host;` and `proxy_set_header Connection close;` — the
  `Connection: close` default is exactly what kills SSE keep-alive; that is why the SSE block
  above sets `Connection ""`.
- `proxy_read_timeout 60s;`, `proxy_send_timeout 60s;` — 60s will kill an idle SSE stream.

### 6.3 Caddy (the recommended default for Fem-ho docs)

Caddy is the right "recommended" proxy for this audience: automatic HTTPS, no method filtering,
correct SSE handling out of the box, and 6 lines of config.

```caddyfile
# Caddyfile
{
    email you@example.com
    # Trust the Docker bridge so X-Forwarded-* from other proxies is honoured; omit if Caddy
    # is the only/edge proxy.
    servers {
        trusted_proxies static private_ranges
    }
}

femho.example.com {
    encode zstd gzip

    # RFC 6764 discovery
    redir /.well-known/caldav  /dav/ 301
    redir /.well-known/carddav /dav/ 301

    # SSE / MCP Streamable HTTP: force immediate flush, no idle timeout.
    @stream {
        path /mcp /mcp/* /api/v1/events /api/v1/events/*
    }
    reverse_proxy @stream femho:8080 {
        flush_interval -1
        transport http {
            read_timeout  24h
            write_timeout 24h
        }
    }

    reverse_proxy femho:8080 {
        # Large attachments
        request_body {
            max_size 200MB
        }
    }
}
```

Verified Caddy semantics:

- `flush_interval <duration>`; a negative value (`-1`) enables low-latency mode which "disables
  response buffering completely and flushes immediately after each write".
- **Caddy already auto-flushes** when the response has `Content-Type: text/event-stream` or an
  unknown content length. So if Fem-ho sets `Content-Type: text/event-stream` correctly, the
  explicit `flush_interval -1` block is belt-and-braces — but keep it, because MCP Streamable
  HTTP can also return `application/json` on a POST with a long-running tool call.
- Caddy sets `X-Forwarded-For`, `X-Forwarded-Proto`, `X-Forwarded-Host` by default; incoming
  values are "ignored to prevent spoofing" unless `trusted_proxies` is set.
- `trusted_proxies [private_ranges] <ranges...>`; the docs recommend the **global**
  `servers > trusted_proxies` option so it applies to all handlers.
- WebSockets: connections "are forcibly closed when the config is reloaded"; mitigate with
  `stream_close_delay 5m` and `stream_timeout`.
- `request_buffers` / `response_buffers` exist but are described as "very inefficient" — do not
  use them.
- Caddy does **not** filter HTTP methods. PROPFIND/REPORT/MKCALENDAR pass through unmodified.
  (Reasoned from the absence of any method restriction in `reverse_proxy`; **UNVERIFIED** as an
  explicit doc statement.)

Sub-path variant, mirroring Radicale's documented approach:

```caddyfile
handle_path /femho/* {
    reverse_proxy femho:8080 {
        header_up X-Forwarded-Prefix /femho
        header_up X-Script-Name      /femho
    }
}
```

### 6.4 Traefik (labels)

Verified label names:

```yaml
services:
  femho:
    image: ghcr.io/<org>/femho:1
    restart: unless-stopped
    networks: [web, internal]
    environment:
      FEMHO_URL: https://femho.example.com
      FEMHO_TRUSTED_PROXIES: private
    volumes:
      - femho-data:/data
    labels:
      - traefik.enable=true
      - traefik.docker.network=web

      # --- main router ---
      - traefik.http.routers.femho.rule=Host(`femho.example.com`)
      - traefik.http.routers.femho.entrypoints=websecure
      - traefik.http.routers.femho.tls.certresolver=letsencrypt
      - traefik.http.routers.femho.service=femho
      - traefik.http.services.femho.loadbalancer.server.port=8080

      # --- streaming router: SSE + MCP, immediate flush ---
      - traefik.http.routers.femho-stream.rule=Host(`femho.example.com`) && (PathPrefix(`/mcp`) || PathPrefix(`/api/v1/events`))
      - traefik.http.routers.femho-stream.entrypoints=websecure
      - traefik.http.routers.femho-stream.tls.certresolver=letsencrypt
      - traefik.http.routers.femho-stream.priority=100
      - traefik.http.routers.femho-stream.service=femho-stream
      - traefik.http.services.femho-stream.loadbalancer.server.port=8080
      - traefik.http.services.femho-stream.loadbalancer.responseforwarding.flushinterval=1ms

      # --- RFC 6764 .well-known redirects ---
      - traefik.http.middlewares.femho-caldav.redirectregex.regex=^https?://([^/]+)/\.well-known/(cal|card)dav$$
      - traefik.http.middlewares.femho-caldav.redirectregex.replacement=https://$${1}/dav/
      - traefik.http.middlewares.femho-caldav.redirectregex.permanent=true
      - traefik.http.routers.femho.middlewares=femho-caldav

      # --- large uploads ---
      - traefik.http.middlewares.femho-buffer.buffering.maxRequestBodyBytes=209715200
      - traefik.http.middlewares.femho-buffer.buffering.memRequestBodyBytes=2097152
```

Traefik notes:

- `traefik.http.services.<svc>.loadbalancer.responseforwarding.flushinterval` — the documented
  knob for flush timing. Set it small (`1ms`) or `-1` for the streaming service.
  **UNVERIFIED:** whether Traefik v3 accepts `-1` here; `1ms` is safe.
- **Traefik's `buffering` middleware buffers the whole request AND response** — do **not** apply
  it to the streaming router or SSE will break. Apply only to upload paths, or skip it and let the
  app enforce `FEMHO_MAX_UPLOAD_SIZE`.
- Entrypoint timeouts are global, not per-router. In `traefik.yml`:
  ```yaml
  entryPoints:
    websecure:
      address: ":443"
      transport:
        respondingTimeouts:
          readTimeout:  600s
          writeTimeout: 0s     # 0 = no timeout; required for long SSE
          idleTimeout:  600s
  ```
  (Immich documents exactly this class of fix: default 60s "cause videos to fail after one minute".)
- `$$` in compose labels escapes `$` so Compose doesn't interpolate the regex groups.
- **UNVERIFIED:** Traefik does not restrict HTTP methods by default; no method allowlist was found
  in the routing docs. Treat DAV methods as passing through, but test.

### 6.5 `.well-known` discovery (RFC 6764) — exact requirements

From RFC 6764:

- Registered well-known URIs: **`caldav`** and `carddav` → `/.well-known/caldav`,
  `/.well-known/carddav`.
- SRV labels: `_caldav` (plain HTTP) and `_caldavs` (HTTPS). Example records verbatim:
  - `_caldav._tcp     SRV 0 1 80 calendar.example.com.`
  - `_caldavs._tcp    SRV 0 1 443 calendar.example.com.`
- TXT record carries the context path: `_caldavs._tcp    TXT path=/caldav`, and "the value of the
  key MUST be the actual 'context path' to the corresponding service on the server."
- Redirect requirement, verbatim: servers must redirect using "one of the available mechanisms
  provided by HTTP (e.g., using a 301, 303, or 307 response)."
- After redirect, the client issues a `PROPFIND` whose body "SHOULD include the
  DAV:current-user-principal" property.

**Practical consequence for Fem-ho:** the redirect must be handled **by the app**, not only by the
proxy, because many users run Fem-ho with no proxy at all. Implement in-app:

```
GET|PROPFIND /.well-known/caldav   -> 301 Location: {prefix}/dav/
GET|PROPFIND /.well-known/carddav  -> 301 Location: {prefix}/dav/   (or 404 if no CardDAV)
```

Then the proxy snippets in §6.2–6.4 are merely optimisations, and Fem-ho works when someone puts
it behind a proxy you never tested.

Also implement:
- `OPTIONS /dav/` returning `DAV: 1, 2, 3, calendar-access` and an `Allow:` header listing every
  supported method — DAVx5 and Thunderbird both probe this.
- `PROPFIND /dav/` returning `DAV:current-user-principal`.
- Publish a docs page with the DNS records for `_caldavs._tcp` so power users get
  "just type your email address" discovery in DAVx5.

### 6.6 SSE / MCP Streamable HTTP proxy checklist

MCP spec facts that constrain the proxy:

- Single **MCP endpoint** path supporting **both POST and GET** (e.g. `https://example.com/mcp`);
  `DELETE` terminates a session.
- Client `Accept` header **MUST** list both `application/json` and `text/event-stream`.
- Responses are either `Content-Type: application/json` **or** `text/event-stream`.
- `Mcp-Session-Id` response header at initialization; client must echo it on all later requests.
  Session IDs must be visible ASCII 0x21–0x7E.
- `MCP-Protocol-Version: 2025-06-18` header on all requests after initialization; invalid/unsupported
  → `400 Bad Request`; missing → server SHOULD assume `2025-03-26`.
- Servers **MUST validate the `Origin` header** on all incoming connections to prevent DNS
  rebinding attacks.
- Resumability via SSE `id:` fields + the `Last-Event-ID` request header on a reconnecting GET.
- 202 Accepted (no body) for notifications/responses; 404 on an expired session → client
  re-initializes.

Proxy checklist (all three proxies):

| Requirement | nginx | Caddy | Traefik |
|---|---|---|---|
| No response buffering | `proxy_buffering off;` | auto for `text/event-stream`; else `flush_interval -1` | `responseforwarding.flushinterval=1ms` |
| Keep-alive not `close` | `proxy_set_header Connection "";` | default | default |
| Long read timeout | `proxy_read_timeout 24h;` | `transport http { read_timeout 24h }` | entrypoint `respondingTimeouts` |
| Pass `Last-Event-ID` | default (all headers passed) | default | default |
| Pass `Mcp-Session-Id`, `MCP-Protocol-Version` | default | default | default |
| Don't strip/rewrite `Origin` | do not set `proxy_set_header Origin` | default | default |
| No `buffering` middleware on `/mcp` | n/a | n/a | **must exclude** |

Belt-and-braces headers Fem-ho should emit on every SSE/MCP stream response:

```
Content-Type: text/event-stream
Cache-Control: no-cache, no-transform
Connection: keep-alive
X-Accel-Buffering: no
```

`no-transform` additionally prevents gzip-buffering proxies from batching events.
Also send a `: keepalive\n\n` comment every 15–30s so idle streams survive 60s proxy timeouts.

> **What Fem-ho should do:** ship `docs/reverse-proxy.md` with all three configs, verbatim,
> copy-pasteable, plus a "Known WAF issues" section covering CRS 911100 and Cloudflare. Emit
> `X-Accel-Buffering: no` and periodic SSE keepalives so the default nginx config works untouched.
> Handle `/.well-known/caldav` **in the app**.

---

## 7. Database migrations on startup

### 7.1 The pattern

```
on boot:
  1. connect to DB (retry with backoff: 10 attempts, 1s → 30s, then exit 1 with a clear message)
  2. acquire an advisory lock
       Postgres:  SELECT pg_advisory_lock(<constant>)      -- session-scoped, auto-released
       SQLite:    BEGIN IMMEDIATE on a dedicated `_migration_lock` table
  3. read schema_migrations -> current version C, target version T (embedded in the binary)
  4. if C > T:  FATAL. "Database schema is version C, this Fem-ho build understands T.
                 You have downgraded. Restore a backup or use image tag >= X."
  5. if C == T: log "schema up to date (T)"; release lock; continue
  6. if C < T:
       a. if FEMHO_RUN_MIGRATIONS is false -> FATAL, listing pending migrations, and exit 1
       b. if FEMHO_MIGRATION_BACKUP and SQLite -> VACUUM INTO /data/backups/pre-migration-<C>-<ts>.db
          if Postgres -> log a WARN telling the user to pg_dump, and require
          FEMHO_MIGRATION_CONFIRM=yes if the migration set contains a destructive step
       c. apply migrations one at a time, each in its own transaction where the engine allows,
          logging "migration 0042_add_scope_kind: applied in 143ms"
       d. on failure: roll back that migration, log the exact SQL and error, release the lock,
          exit 1. DO NOT continue and DO NOT start serving.
  7. release lock, start HTTP server
```

### 7.2 Rules

- **Forward-only.** Ship no `down` migrations in production. Downgrades are handled by restoring a
  backup. This is what lets you promise "upgrading is safe".
- **Version gate.** Store the app's minimum-supported schema version. Refuse to run against a
  newer schema (protects against `docker compose down && up` with an older pinned tag).
- **Advisory lock** so two replicas / a racing `docker compose up --scale` cannot both migrate.
- **`FEMHO_RUN_MIGRATIONS`** exists (Miniflux's `RUN_MIGRATIONS=1`) but defaults to `true` for
  Fem-ho: self-hosters overwhelmingly want the automatic path, and Miniflux's manual default
  generates a steady stream of "why doesn't it start" issues. Document `false` for advanced users.
- **Never run migrations from the frontend or a background goroutine.** Migrations must complete
  before the listener binds, so `/readyz` and the healthcheck accurately reflect readiness.
- **Long migrations**: if a migration is expected to take > 30s (backfill), log progress every 5s.
  A silent 4-minute startup on a Raspberry Pi looks identical to a hang, and users will
  `docker compose down -v` — the worst possible outcome.

### 7.3 Failing loudly — the message template

```
FATAL Migration 0042_split_scope_projects failed.

  Error: SQLITE_CONSTRAINT: UNIQUE constraint failed: projects.scope_id, projects.slug
  SQL:   CREATE UNIQUE INDEX idx_projects_scope_slug ON projects(scope_id, slug);

  Your database has NOT been modified by this migration (it was rolled back).
  A pre-migration backup was written to:
      /data/backups/pre-migration-0041-20260805T081455Z.db

  Two projects in the same scope share a slug. Fix with:
      docker compose run --rm femho db repair duplicate-project-slugs

  Then restart. Report at https://github.com/<org>/fem-ho/issues if this persists.
```

Every fatal error should name (a) what failed, (b) whether data changed, (c) where the backup is,
(d) the exact command to fix it, (e) where to report.

### 7.4 SQLite specifics

Required PRAGMAs on every connection:

```sql
PRAGMA journal_mode = WAL;        -- concurrent readers during writes; set once, persists
PRAGMA busy_timeout = 5000;       -- ms; MUST be set per-connection or you get SQLITE_BUSY
PRAGMA foreign_keys = ON;         -- per-connection, off by default
PRAGMA synchronous = NORMAL;      -- safe with WAL; FULL is slow on SD cards
```

- WAL creates `femho.db-wal` and `femho.db-shm` next to the DB. **All three must be in the volume**,
  and any backup that copies only `femho.db` is corrupt. This is why `VACUUM INTO` (§8.2) is the
  correct backup mechanism, not `cp`.
- WAL does **not** work on most network filesystems (NFS, SMB, many Synology/QNAP shares). Detect
  at boot and refuse with a clear message rather than corrupting: **UNVERIFIED** whether reliable
  detection is possible; at minimum, document "do not put the SQLite database on a network share".
- Max one writer. For a family instance this is irrelevant; document the SQLite→Postgres threshold
  (suggest: >10 active users or >100k tasks) and **ship a `femho db migrate-to-postgres` command**.
  Being able to start on SQLite and graduate later removes the biggest "which do I pick?" hesitation.

> **What Fem-ho should do:** auto-migrate by default, advisory-locked, forward-only, with an
> automatic `VACUUM INTO` snapshot before every schema change on SQLite, refuse to start on
> schema-newer-than-binary, and provide `femho db migrate-to-postgres`.

---

## 8. Backup and restore

### 8.1 What to document (the user-facing contract)

The README must contain a section titled **"Còpia de seguretat"** listing exactly what to back up:

| Item | SQLite setup | Postgres setup |
|---|---|---|
| Database | `/data/femho.db` (+ `-wal`, `-shm`) — **use `femho backup`, not `cp`** | `pg_dump` of the `femho` DB |
| Signing key | `/data/secret.key` | `/data/secret.key` |
| Attachments | `/data/attachments/` | `/data/attachments/` |
| Config (if used) | `/data/config.yaml` | `/data/config.yaml` |
| Compose + `.env` | your `compose.yaml`, `.env`, `secrets/` | same |

**The single most important sentence in the docs:** *"Everything Fem-ho needs is inside the
`femho-data` volume, plus your `compose.yaml` and `.env`."*

### 8.2 `femho backup` — the one command

Ship a subcommand so users never have to reason about WAL files:

```
docker compose exec femho /femho backup --out /data/backups/femho-$(date +%F).tar.zst
```

Implementation:
1. SQLite: `VACUUM INTO '/tmp/femho-backup.db'`.
   Verified semantics: `VACUUM schema-name INTO filename`; "The file named by the INTO clause must
   not previously exist, or else it must be an empty file"; it is "an alternative to the backup API
   for generating backup copies of a live database"; the output "is a consistent snapshot of the
   original database"; with `PRAGMA synchronous` NORMAL/FULL the output is synced to disk.
   Advantages quoted: "the resulting backup database is minimal in size … all deleted content is
   purged from the backup, leaving behind no forensic traces."
   Postgres: shell out to `pg_dump -Fc` (requires `pg_dump` in the image — **on distroless it is
   not available**, so instead emit instructions, or run the dump from the `db` container).
2. Add `/data/secret.key`, `/data/attachments/`, `/data/config.yaml`.
3. Write a `manifest.json` with `{schemaVersion, appVersion, createdAt, dbEngine, counts:{users,scopes,projects,tasks}}`.
4. Tar + zstd. Print the path and size.

`femho restore --in <file>` must:
- refuse to run if the DB is non-empty unless `--force`,
- refuse if `manifest.schemaVersion > current binary's target`,
- restore, then **run migrations**, then verify counts against the manifest and print a diff.

### 8.3 SQLite continuous replication — Litestream

Verified from Litestream's Docker guide:

- Current line is **v0.5.x** (guide references 0.5.14 and features from 0.5.8–0.5.9).
- `litestream.yml`:
  ```yaml
  access-key-id:     YOUR_ACCESS_KEY_ID
  secret-access-key: YOUR_SECRET_ACCESS_KEY

  dbs:
    - path: /data/db
      replica:
        url: s3://BUCKET/db
  ```
- Sidecar with config file:
  ```
  docker run \
    -v /local/path/to/data:/data \
    -v /local/path/to/litestream.yml:/etc/litestream.yml \
    litestream/litestream replicate
  ```
- Sidecar with inline replica URL and env credentials:
  ```
  docker run \
    --env LITESTREAM_ACCESS_KEY_ID \
    --env LITESTREAM_SECRET_ACCESS_KEY \
    -v /local/path/to/data:/data \
    litestream/litestream replicate /data/db s3://BUCKET/db
  ```
- **Same-container supervision:** `litestream replicate -exec 'myapp -myflag myarg'`, or the
  `exec:` directive in YAML. For multiple processes the guide suggests **s6-overlay**.

**Recommendation for Fem-ho:** do **not** bundle Litestream in the main image (it forces a
non-distroless base and makes Litestream PID 1, complicating signal handling). Instead ship an
**optional** `compose.litestream.yaml` overlay running Litestream as a sidecar over the same
volume, and document it as "off-site backups, advanced". Note in the docs that the app must have
`journal_mode=WAL` (it does) and that the sidecar and app must not both hold write locks
inappropriately — Litestream is designed for this and only reads the WAL.

```yaml
# compose.litestream.yaml  (docker compose -f compose.yaml -f compose.litestream.yaml up -d)
services:
  litestream:
    image: litestream/litestream:0.5
    restart: unless-stopped
    command: replicate
    environment:
      LITESTREAM_ACCESS_KEY_ID: ${S3_ACCESS_KEY_ID}
      LITESTREAM_SECRET_ACCESS_KEY: ${S3_SECRET_ACCESS_KEY}
    volumes:
      - femho-data:/data
      - ./litestream.yml:/etc/litestream.yml:ro
    depends_on:
      femho:
        condition: service_healthy
```

### 8.4 Volume-level backup (the fallback everyone actually uses)

Document this exact command, because it is what people run:

```bash
# Stop first: a live SQLite/Postgres volume tar is NOT consistent.
docker compose stop femho
docker run --rm \
  -v femho_femho-data:/data:ro \
  -v "$PWD":/backup \
  alpine:3 tar czf /backup/femho-data-$(date +%F).tar.gz -C /data .
docker compose start femho
```

Restore:

```bash
docker compose down
docker volume rm femho_femho-data
docker volume create femho_femho-data
docker run --rm \
  -v femho_femho-data:/data \
  -v "$PWD":/backup \
  alpine:3 sh -c 'cd /data && tar xzf /backup/femho-data-2026-08-05.tar.gz'
docker compose up -d
```

Note the volume name is `<project>_<volume>` — spell that out; it trips up everyone.

### 8.5 Postgres dump/restore

```bash
# Dump (custom format, compressed, parallel-restorable)
docker compose exec -T db pg_dump -U femho -Fc femho > femho-$(date +%F).dump

# Restore into a fresh database
docker compose down
docker volume rm femho_femho-db
docker compose up -d db
docker compose exec -T db psql -U femho -d postgres -c 'DROP DATABASE IF EXISTS femho;'
docker compose exec -T db psql -U femho -d postgres -c 'CREATE DATABASE femho OWNER femho;'
docker compose exec -T db pg_restore -U femho -d femho --no-owner < femho-2026-08-05.dump
docker compose up -d
```

### 8.6 The restore drill (put this in the docs as a checklist)

Docs must contain a **"Simulacre de restauració"** page, because a backup nobody has restored is
not a backup:

1. On a second machine (or a second compose project name), create `compose.restore.yaml` with
   `name: femho-restore` and different host ports.
2. Restore the backup into it.
3. Log in as your own user. Verify: scope list, one project's kanban columns, a task with
   subtasks, a pinned checklist, an active share link, and that a CalDAV client can still connect
   to the restored URL.
4. Verify the audit trail is intact (this is a Fem-ho-specific feature and a good canary).
5. Delete the restore project: `docker compose -p femho-restore down -v`.

Add `femho backup verify --in <file>` that opens the archive, checks the manifest, opens the
SQLite snapshot read-only, runs `PRAGMA integrity_check`, and prints the object counts. Run it in
CI against a golden fixture.

> **What Fem-ho should do:** one volume, one `femho backup` command, a documented tar fallback with
> exact volume names, an optional Litestream overlay, and a restore-drill page. Also add a nightly
> in-app scheduled `VACUUM INTO` into `/data/backups/` with a retention count
> (`FEMHO_AUTOBACKUP_KEEP=7`) — enabled by default. Automatic local backups are cheap and have
> saved more self-hosted instances than any other feature.

---

## 9. Observability

### 9.1 Structured logs

- Format: JSON when not a TTY, human-readable text when a TTY (`FEMHO_LOG_FORMAT=auto`).
  Go: `log/slog` with `slog.NewJSONHandler`. Node: `pino`.
- To **stdout only**. Never write log files inside the container (12-factor; also fills volumes).
- Fields on every line: `time` (RFC3339 with ms), `level`, `msg`, `component`, `request_id`,
  `user_id` (never email), `scope_id`, `duration_ms`, `status`.
- **Never log**: passwords, session tokens, API keys, share-link tokens, full request bodies,
  `Authorization` headers, or task titles/descriptions (family task content is personal). Log
  IDs, not content. Add a redaction unit test.
- One request ID per request (`X-Request-Id` if the proxy supplied one and the proxy is trusted,
  else generate). Echo it in the response header so users can quote it in bug reports.
- Access log at `info`; `debug` adds SQL statements with args redacted.

### 9.2 `/healthz` and `/readyz`

| Endpoint | Auth | Checks | Semantics |
|---|---|---|---|
| `GET /healthz` | none | process alive, can allocate | **Liveness.** Must never touch the DB. Always fast. Used by Docker `HEALTHCHECK` and orchestrators to decide *restart*. |
| `GET /readyz` | none | DB reachable (`SELECT 1`, 2s timeout), migrations complete, `/data` writable, signing key loaded | **Readiness.** Used to decide *route traffic*. Returns 503 with a JSON body naming the failing check. |
| `GET /version` | none | — | `{"version","commit","buildDate","schemaVersion","dbEngine"}` — makes bug reports trivially triageable |

`/readyz` body on failure:

```json
{
  "status": "not_ready",
  "checks": {
    "database":   {"status": "fail", "error": "dial tcp db:5432: connect: connection refused"},
    "migrations": {"status": "skip"},
    "datadir":    {"status": "ok",   "freeBytes": 13312000000},
    "secretkey":  {"status": "ok"}
  }
}
```

Docker's `HEALTHCHECK` should hit `/healthz` (liveness) — pointing it at `/readyz` means a
temporarily-unreachable database causes Docker to **restart** the app in a loop, which is exactly
wrong. But compose's `depends_on: condition: service_healthy` uses the *health* status, so for
a proxy that should only start once Fem-ho can serve, use a compose-level healthcheck override
against `/readyz`. Document both.

### 9.3 Prometheus `/metrics`

Off by default (`FEMHO_METRICS_ENABLED=false`). When on, protected by
`FEMHO_METRICS_TOKEN` (bearer) — an unauthenticated `/metrics` on a home server exposed via
Cloudflare Tunnel leaks usage patterns.

Minimum useful metric set:

```
femho_build_info{version,commit,go_version}                       gauge
femho_http_requests_total{method,route,status}                    counter
femho_http_request_duration_seconds{method,route}                 histogram
femho_db_query_duration_seconds{operation}                        histogram
femho_db_connections{state="open|idle|inuse"}                     gauge
femho_tasks_total{scope_kind,status}                              gauge
femho_users_total                                                  gauge
femho_caldav_sync_total{result="ok|conflict|error"}               counter
femho_caldav_sync_duration_seconds                                histogram
femho_mcp_tool_calls_total{tool,result}                           counter
femho_mcp_active_sessions                                          gauge
femho_sse_active_streams                                           gauge
femho_share_links_active                                           gauge
femho_migration_schema_version                                     gauge
femho_last_backup_timestamp_seconds                                gauge
```

`femho_last_backup_timestamp_seconds` is the highest-value one — it lets a user alert on "my
backups stopped 9 days ago", which is the failure nobody notices.

Ship `docs/monitoring.md` with a ready Grafana dashboard JSON and a couple of alert rules.

### 9.4 Debug bundle

`femho debug bundle --out /data/femho-debug.zip` — one command that produces everything a
maintainer needs, with secrets stripped:

Contents:
- `version.json` (same as `/version`) + `runtime.json` (OS, arch, container?, cgroup memory limit,
  CPU count, Docker version if detectable)
- `config-redacted.yaml` — effective merged config, with every secret-shaped key replaced by
  `***REDACTED*** (len=32, sha256=ab12…)` so you can compare values without seeing them
- `env-redacted.txt` — `FEMHO_*` names only, values redacted, plus which came from `_FILE`
- `readyz.json`, `healthz.json`
- `schema.txt` — table list + applied migration versions + row counts (counts only, no data)
- `logs-tail.txt` — last 2000 lines from the in-memory ring buffer (keep a 2000-line ring buffer
  in memory precisely for this; container logs may already be rotated away)
- `proxy-observed.json` — for the last 20 requests: observed `Host`, `X-Forwarded-*`, remote addr,
  and the base URL Fem-ho derived. **This alone resolves most proxy tickets.**
- `caldav-selftest.json` — result of an internal loopback PROPFIND
- `disk.json` — free space on `/data`

The bundle must be **safe to attach to a public GitHub issue**. Say that in the CLI output, and
print a one-line summary of what was redacted.

> **What Fem-ho should do:** `/healthz`, `/readyz`, `/version` unauthenticated; `/metrics` opt-in
> and token-protected; JSON logs to stdout with a strict no-content policy; `femho debug bundle`
> as the first thing the issue template asks for.

---

## 10. Updates: tagging, release notes, breaking changes

### 10.1 Tag strategy

Publish, for release `v1.4.2`:

| Tag | Moves? | Who uses it |
|---|---|---|
| `1.4.2` | never | reproducible deployments, GitOps |
| `1.4` | on patch releases | "patches only" |
| `1` | on minor+patch within major 1 | **the recommended default** |
| `latest` | on every stable release | people who don't think about it |
| `edge` / `main` | every push to main | testers |
| `sha-<short>` | never | CI/debugging |

Generated by `docker/metadata-action@v6`:

```yaml
- name: Docker meta
  id: meta
  uses: docker/metadata-action@v6
  with:
    images: |
      ghcr.io/${{ github.repository }}
      docker.io/${{ vars.DOCKERHUB_ORG }}/femho
    tags: |
      type=semver,pattern={{version}}
      type=semver,pattern={{major}}.{{minor}}
      type=semver,pattern={{major}}
      type=raw,value=latest,enable=${{ startsWith(github.ref, 'refs/tags/v') && !contains(github.ref, '-') }}
      type=edge,branch=main
      type=sha,format=short
      type=ref,event=pr
```

Verified generator behaviours: `type=semver,pattern={{version}}` on tag `v1.2.3` → `1.2.3`;
`type=sha` short → `sha-860c190`; `type=ref,event=pr` → `pr-2`; `type=raw,value=foo`;
`type=edge` → the default-branch tag; `type=pep440`; `type=match,pattern=v(.*),group=1`;
`type=schedule,pattern={{date 'YYYYMMDD'}}` → `20200110`.

Note the `!contains(github.ref, '-')` guard: it stops `v2.0.0-rc.1` from becoming `latest`. That
one line prevents the classic "Watchtower upgraded everyone to a release candidate at 3am".

**Recommend `1` (major-pinned) in the README compose file**, via `${FEMHO_VERSION:-1}`. It gives
users automatic security patches without ever crossing a breaking change. This is the single best
default for this audience.

### 10.2 Breaking-change policy (publish it as `docs/versioning.md`)

Commit to these, in writing:

1. **SemVer applies to**: the REST API surface, the MCP tool schemas, the CalDAV URL layout, env
   var names, volume paths, and the on-disk data layout.
2. **A major bump is required** to: remove/rename an env var, change a volume path, remove a REST
   endpoint or field, remove/rename an MCP tool or change a required argument, change a CalDAV
   URL, or require a manual migration step.
3. **Deprecation window**: a deprecated env var keeps working for **two minor releases** and logs
   `WARN deprecated: FEMHO_OLD is deprecated, use FEMHO_NEW (removal in 2.0)` at startup.
4. **Release notes format** — every release, three sections in this order:
   ```
   ## Breaking changes
   (empty means "none", say so explicitly — never omit the heading)
   ## Upgrade notes
   (manual steps, migration duration estimate, backup reminder)
   ## Changes
   Added / Changed / Fixed / Security
   ```
5. **Data migrations are announced** in the release notes with an estimated duration on a
   Raspberry Pi 4 for a 10k-task database.
6. **Never** ship a breaking change in a patch release. Not once. The moment you do, every user
   pins to a digest and stops updating, and you lose the feedback loop.

### 10.3 Watchtower-friendliness

Watchtower reads labels prefixed `com.centurylinklabs.watchtower.`:

- `enable` — monitor/update this container
- `monitor-only` — "Will only monitor for new images, send notifications and invoke … hooks, but
  will **not** update the containers"
- `no-pull`
- `scope`
- `depends-on`
- lifecycle pre-update / post-update commands

Env vars include `WATCHTOWER_CLEANUP`, `WATCHTOWER_LABEL_ENABLE`, `WATCHTOWER_MONITOR_ONLY`,
`WATCHTOWER_NO_PULL`, `WATCHTOWER_SCOPE`, `WATCHTOWER_LABEL_TAKE_PRECEDENCE` (when set, container
labels override global arguments).

Being Watchtower-friendly means:

1. **The container must be restartable at any moment with no data loss.** Watchtower kills and
   recreates. Therefore: no state outside the volume, SIGTERM handled, WAL checkpointed on
   shutdown, migrations idempotent and safe to interrupt (each in its own transaction).
2. **`latest` and `N` must always be safe to auto-update to.** See §10.2 rule 6.
3. Document `depends-on` so Watchtower restarts `db` before `femho`:
   ```yaml
   labels:
     com.centurylinklabs.watchtower.depends-on: femho-db
   ```
4. Consider shipping a documented **`monitor-only`** recommendation for the `db` service — nobody
   wants Postgres major-version-jumped automatically:
   ```yaml
   db:
     labels:
       com.centurylinklabs.watchtower.monitor-only: "true"
   ```
5. Ship a **pre-update lifecycle hook** that snapshots the DB:
   ```yaml
   femho:
     labels:
       com.centurylinklabs.watchtower.lifecycle.pre-update: "/femho backup --out /data/backups/pre-update.tar.zst"
   ```
   **UNVERIFIED:** exact label key spelling for lifecycle hooks (docs confirm pre-update/post-update
   commands exist but I did not capture the literal key). Verify against
   `containrrr.dev/watchtower/lifecycle-hooks/` before shipping.

Also: publish an **RSS/Atom release feed** (GitHub provides `releases.atom` for free) and link it
in the docs — a meaningful share of self-hosters subscribe rather than enabling auto-update.

> **What Fem-ho should do:** `${FEMHO_VERSION:-1}` in the shipped compose; the metadata-action tag
> block above with the prerelease guard; `docs/versioning.md` with the six commitments; a
> pre-update backup hook documented for Watchtower users; never break in a patch.

---

## 11. First-run UX

### 11.1 The three bootstrap paths (support all three, in this priority order)

**Path A — in-app first-run (primary, this is what the README shows).**

- On first boot with zero users, `/` renders a **setup wizard** instead of the login screen.
- The wizard is guarded by a **one-time setup token**: generated at boot, written to
  `/data/.setup-token`, and printed to the container log:
  ```
  ────────────────────────────────────────────────────────────
   Fem-ho no té cap usuari encara. Obre:
     http://<el-teu-servidor>:8080/setup?token=8f3ca9d2e1b74a06
   (o executa: docker compose logs femho | grep setup)
  ────────────────────────────────────────────────────────────
  ```
  Rationale: without a token, anyone who port-scans your LAN in the 90 seconds before you finish
  setup owns the instance. With a token, the flow is still one click for the legitimate user
  (they have the logs) but closed to everyone else. Immich and Vikunja both leave this open;
  it is a real, if low-frequency, problem.
  Override with `FEMHO_SETUP_TOKEN` / `FEMHO_SETUP_TOKEN_FILE`; disable with
  `FEMHO_SETUP_TOKEN=none` for people on trusted LANs who find it annoying.
- Wizard steps (keep to **three screens**, all skippable except the first):
  1. **Compte d'administració** — name, email, password (+ strength meter), UI language
     (default `ca`), timezone (default from `TZ`).
  2. **Àmbits inicials** — pre-checked: *Personal*, *Feina*, *Família*. User can uncheck, rename,
     or add. Creating the three default scopes here is what makes the app usable in the first
     30 seconds instead of showing an empty board.
  3. **Com hi accediràs** — shows the detected base URL and asks "és correcte?" with a field to
     override (writes `FEMHO_URL` equivalent into `/data/config.yaml`). Shows the resulting CalDAV
     URL. **This screen prevents the #1 support issue.** Includes a "prova-ho" button that makes
     the browser fetch `FEMHO_URL/healthz` and reports success/failure.
- After completion, delete `/data/.setup-token`, set `registration_enabled=false` by default (an
  admin can re-enable, or invite by email).

**Path B — env-seeded admin (automation / Ansible / k8s).**

```yaml
environment:
  FEMHO_CREATE_ADMIN: "true"
  FEMHO_ADMIN_EMAIL: "borja@example.com"
  FEMHO_ADMIN_NAME: "Borja"
  FEMHO_ADMIN_PASSWORD_FILE: /run/secrets/admin_password
```

Semantics, copying Paperless-ngx exactly: create the user if it does not exist; **"Won't modify
existing users."** Log `INFO admin user borja@example.com already exists, not modified`. The vars
can be removed after first boot (Miniflux documents this explicitly).
Skips the wizard entirely, but still creates the three default scopes.

**Path C — CLI.**

```
docker compose run --rm femho user create --email x@y.z --name X --admin
docker compose run --rm femho user set-password --email x@y.z
docker compose run --rm femho user promote --email x@y.z
```

Needed for password recovery when SMTP isn't configured — which is most home instances.
**Make sure this is in the README under "He perdut la contrasenya"**, because that is a top-3
search for every self-hosted app.

### 11.2 Demo data

`FEMHO_SEED_DEMO=true` (default `false`) creates a realistic Catalan dataset:

- Scopes: `Personal`, `Feina`, `Família` (+ a user-created collective scope `Casa` shared with a
  second demo user)
- Projects: `Reforma cuina` (Família), `Q3 Roadmap` (Feina), `Viatge Estiu` (Personal)
- ~25 tasks spread across Inbox / Per fer / Fent / Fet, with due dates relative to *today* (never
  absolute — stale demo data with 2024 dates looks broken)
- One task with 5 subtasks; one pinned checklist (`Llista de la compra`)
- One task marked `AI-delegated` and one `AI-assisted`, with audit-trail entries, so the
  differentiating feature is visible immediately
- One active public share link (expires in 7 days)
- A second demo user `familia@exemple.local` so `@person` assignment and collective scopes are
  demonstrable

Two hard rules:
1. Demo data must be **removable in one click** from Settings → "Elimina les dades de demostració",
   and that action must be exact (tag every demo row with `seed_batch = 'demo'`).
2. Demo mode must be **visible**: a persistent banner "Dades de demostració actives".

Also consider a **public demo instance** with `FEMHO_DEMO_MODE=true` (read-mostly, resets hourly).
For this product category, a demo people can click through converts far better than screenshots.

### 11.3 "Netejar instància" — exact semantics

This is a dangerous action, so define it precisely and offer **three** levels rather than one
ambiguous button. Settings → Administració → Zona perillosa:

| Action (Catalan label) | What it deletes | What it keeps | Confirmation |
|---|---|---|---|
| **Elimina les dades de demostració** | rows where `seed_batch='demo'` | everything else | single click + toast with undo for 10s |
| **Buida el contingut** | all scopes, projects, tasks, subtasks, checklists, attachments, share links, CalDAV collections, audit entries | users, their passwords/sessions, API tokens, instance settings, signing key | type the instance name; requires admin password re-entry; auto-backup taken first |
| **Restableix la instància** (full factory reset) | *everything*: all of the above **plus** users, tokens, settings | only the signing key (see below) | type `RESTABLEIX`; requires admin password; auto-backup taken first; instance returns to the setup wizard |

Rules:

1. **Always take a backup first**, automatically, into `/data/backups/pre-reset-<ts>.tar.zst`, and
   show the path in the confirmation dialog *before* the user confirms and in the success toast.
   The user must be able to undo a mistake.
2. **Revoke, don't orphan.** Deleting content must invalidate every share link (they must return
   410 Gone, not 500) and every CalDAV collection URL. Bump a per-instance `sync-token` so DAV
   clients do a full resync instead of showing ghosts.
3. **Signing key**: keep it on "Buida el contingut" (sessions survive). On full reset, **rotate
   it** — otherwise old API tokens from the previous life still validate. State this in the dialog.
4. **Audit trail**: the reset itself is the last audit entry written before the table is cleared,
   and is echoed to the log at WARN with the actor's user id and IP.
5. Never expose any of these over the REST API or MCP. Web UI + CLI (`femho instance reset
   --confirm`) only. An AI agent with a delegated token must not be able to wipe the family's
   task list; this is a concrete, foreseeable risk given Fem-ho's AI-delegation feature.
6. Post-reset the app should **not** exit — it should return to the setup-wizard state in place,
   because a container that exits after reset looks like a crash.

> **What Fem-ho should do:** wizard-first with a token-guarded setup URL printed in the logs;
> three default scopes created automatically; a base-URL confirmation screen with a live test;
> env-seeded admin with Paperless idempotency for automation; CLI password reset documented in the
> README; demo data off by default, tagged, one-click removable; three distinct reset levels, each
> auto-backed-up, none reachable via API/MCP.

---

## 12. CI/CD: publishing to GHCR + Docker Hub

### 12.1 Verified GHCR workflow shape

From GitHub's own docs (verbatim structure; SHA-pinned action refs replaced with tags here for
readability — **pin to SHAs in production**):

```yaml
name: Create and publish a Docker image

on:
  push:
    branches: ['release']

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  build-and-push-image:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
      attestations: write
      id-token: write
    steps:
      - uses: actions/checkout@v6
      - name: Log in to the Container registry
        uses: docker/login-action@v4
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - name: Extract metadata (tags, labels) for Docker
        id: meta
        uses: docker/metadata-action@v6
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
      - name: Build and push Docker image
        id: push
        uses: docker/build-push-action@v7
        with:
          context: .
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
      - name: Generate artifact attestation
        uses: actions/attest@v4
        with:
          subject-name: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME}}
          subject-digest: ${{ steps.push.outputs.digest }}
          push-to-registry: true
```

Key facts: `GITHUB_TOKEN` is sufficient for GHCR (no PAT), `packages: write` is required, and
`attestations: write` + `id-token: write` are required for provenance attestation.

### 12.2 Full recommended workflow for Fem-ho

`.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    branches: [main]
    tags: ['v*']
  pull_request:
  workflow_dispatch:

env:
  GHCR_IMAGE: ghcr.io/${{ github.repository_owner }}/femho
  DOCKERHUB_IMAGE: docker.io/${{ vars.DOCKERHUB_ORG }}/femho

permissions:
  contents: read

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
      attestations: write
      id-token: write
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0            # needed for version derivation from tags

      - name: Set up QEMU
        uses: docker/setup-qemu-action@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v4

      - name: Log in to GHCR
        if: github.event_name != 'pull_request'
        uses: docker/login-action@v4
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Log in to Docker Hub
        if: github.event_name != 'pull_request'
        uses: docker/login-action@v4
        with:
          username: ${{ secrets.DOCKERHUB_USERNAME }}
          password: ${{ secrets.DOCKERHUB_TOKEN }}

      - name: Docker meta
        id: meta
        uses: docker/metadata-action@v6
        with:
          images: |
            ${{ env.GHCR_IMAGE }}
            ${{ env.DOCKERHUB_IMAGE }}
          tags: |
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=semver,pattern={{major}}
            type=raw,value=latest,enable=${{ startsWith(github.ref, 'refs/tags/v') && !contains(github.ref, '-') }}
            type=edge,branch=main
            type=sha,format=short
            type=ref,event=pr
          labels: |
            org.opencontainers.image.title=Fem-ho
            org.opencontainers.image.description=Gestor de tasques personal i familiar, autoallotjat
            org.opencontainers.image.licenses=AGPL-3.0-or-later

      - name: Build and push
        id: push
        uses: docker/build-push-action@v7
        with:
          context: .
          file: ./Dockerfile
          platforms: linux/amd64,linux/arm64
          push: ${{ github.event_name != 'pull_request' }}
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          annotations: ${{ steps.meta.outputs.annotations }}
          build-args: |
            VERSION=${{ steps.meta.outputs.version }}
            COMMIT=${{ github.sha }}
            BUILD_DATE=${{ fromJSON(steps.meta.outputs.json).labels['org.opencontainers.image.created'] }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
          provenance: mode=max
          sbom: true

      - name: Attest build provenance (GHCR)
        if: github.event_name != 'pull_request'
        uses: actions/attest@v4
        with:
          subject-name: ${{ env.GHCR_IMAGE }}
          subject-digest: ${{ steps.push.outputs.digest }}
          push-to-registry: true

      - name: Attach compose files to the release
        if: startsWith(github.ref, 'refs/tags/v')
        uses: softprops/action-gh-release@v2
        with:
          files: |
            deploy/compose.yaml
            deploy/compose.postgres.yaml
            deploy/compose.caddy.yaml
            deploy/.env.example
            deploy/Caddyfile.example
```

Verified inputs used: `context`, `file`, `platforms`, `push`, `tags`, `labels`, `annotations`,
`build-args`, `cache-from`, `cache-to`, `provenance`, `sbom`. GHA cache syntax
`type=gha,mode=max`; registry cache alternative `type=registry,ref=user/app:buildcache,mode=max`.
`docker/build-push-action` is at **v7**; `metadata-action` at **v6**; `login-action`,
`setup-qemu-action`, `setup-buildx-action` at **v4**.

**Important cost note:** `cache-to: type=gha,mode=max` is capped by GitHub's 10 GB per-repo Actions
cache. For a multi-arch Go build this is fine; for a Node build with `node_modules` it will thrash.
Consider `type=registry,ref=ghcr.io/<org>/femho:buildcache,mode=max` instead — it has no size cap
and survives cache eviction. **UNVERIFIED:** the current GitHub Actions cache quota.

**Attaching the compose files to the release** (last step) is what makes
`https://github.com/<org>/fem-ho/releases/latest/download/compose.yaml` work — the Immich pattern.
Do not skip it.

**Docker Hub description sync:** add `peter-evans/dockerhub-description` (**UNVERIFIED** current
version) as a release step so the Docker Hub page shows the README instead of "no description".
An empty Docker Hub page reads as abandonware.

### 12.3 Extra CI jobs worth having

```yaml
  # Fail the build if the image regresses badly on size
  size-check:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - run: |
          docker pull ${{ env.GHCR_IMAGE }}:sha-${GITHUB_SHA::7}
          SIZE=$(docker image inspect --format '{{.Size}}' ${{ env.GHCR_IMAGE }}:sha-${GITHUB_SHA::7})
          echo "Image size: $((SIZE/1024/1024)) MiB"
          test "$SIZE" -lt 83886080   # 80 MiB uncompressed ceiling

  # Prove the shipped compose file actually works
  smoke:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - run: |
          FEMHO_VERSION=sha-${GITHUB_SHA::7} docker compose -f deploy/compose.yaml up -d --wait
          curl -fsS http://localhost:8080/healthz
          curl -fsS http://localhost:8080/readyz
          curl -fsSI http://localhost:8080/.well-known/caldav | grep -i '^location:'
          curl -fsS -X PROPFIND -u seed:seed http://localhost:8080/dav/ -H 'Depth: 0'
          docker compose -f deploy/compose.yaml down -v
```

`docker compose up --wait` blocks until healthchecks pass — this makes the smoke test also a test
of the healthcheck itself. **Run this on every PR.** A broken shipped compose file is the single
most damaging bug this project can have.

Add a `trivy`/`grype` scan job and, for a security-adjacent app, publish the SBOM.

### 12.4 Docs site

Recommendation: **MkDocs Material**, deployed to GitHub Pages via Actions, source in `docs/`.
Rationale over alternatives: Vikunja, Paperless-ngx, Immich and Karakeep all use static docs sites
tightly coupled to the repo; MkDocs Material gives search, versioning (via `mike`), dark mode, and
copy-buttons on code blocks (essential when your docs are mostly compose files) with almost no
maintenance. **UNVERIFIED:** current MkDocs Material version.

Required pages, in this order in the nav:

```
Inici                      -> what it is, screenshot, 3-line quickstart
Instal·lació
  Docker (SQLite)          -> THE page; compose.yaml + `docker compose up -d`
  Docker (PostgreSQL)
  Actualitzar
  Migrar de SQLite a PostgreSQL
Configuració
  Variables d'entorn       -> the full table from §5.3, generated from code
  Fitxer de configuració
  Secrets (_FILE)
  Darrere un proxy invers  -> Caddy / Traefik / nginx, verbatim configs
Funcions
  Àmbits i projectes
  CalDAV                   -> client setup: DAVx5, Thunderbird, Apple Calendar, .well-known, DNS SRV
  API REST                 -> OpenAPI viewer
  MCP                      -> endpoint, tokens, tool list
  Enllaços públics
  Usuari IA i auditoria
Operació
  Còpia de seguretat
  Restauració (simulacre)
  Observabilitat
  Resolució de problemes   -> symptom -> cause -> fix table
Desenvolupament
Versions i canvis incompatibles
```

**Generate the env-var table from code** (a `go generate` / script that emits the Markdown table
from the config struct tags). A docs table that drifts from the code is worse than none, and this
table is the most-read page in any self-hosted project's docs.

The **Resolució de problemes** page should be symptom-first, matching what users type into search:

| Símptoma | Causa probable | Solució |
|---|---|---|
| "DAVx5 diu 'no calendars found'" | base URL / prefix wrong | set `FEMHO_URL`; check `femho debug bundle` → `proxy-observed.json` |
| "405 Method Not Allowed on PROPFIND" | WAF / `limit_except` | CRS rule 911100, see §6.2 |
| "MCP client hangs, no response" | proxy buffering | `proxy_buffering off` / `flush_interval -1` |
| "Redirected to http:// after login" | missing `X-Forwarded-Proto` or untrusted proxy | set `FEMHO_TRUSTED_PROXIES=private` |
| "Everyone logged out after restart" | `/data` not persistent → new signing key | check the volume |
| "Container restarts every 30s" | healthcheck failing | `docker inspect --format '{{json .State.Health}}' femho` |

---

## 13. Recommended repository files

```
fem-ho/
├── Dockerfile                          # multi-stage, distroless, non-root 65532, HEALTHCHECK
├── .dockerignore                       # §2.7 — prevents shipping local data/*.db
├── README.md                           # 3-line quickstart + the 28-line compose inline
├── LICENSE                             # AGPL-3.0-or-later (recommended for this category)
├── CHANGELOG.md                        # Keep a Changelog; "Breaking changes" heading always present
├── SECURITY.md                         # disclosure policy, supported versions
├── CONTRIBUTING.md
│
├── deploy/                             # everything attached to GitHub releases
│   ├── compose.yaml                    # SQLite, single container — THE hero file (§4.1)
│   ├── compose.postgres.yaml           # Postgres variant (§4.2)
│   ├── compose.caddy.yaml              # + Caddy reverse proxy (§4.3)
│   ├── compose.traefik.yaml            # + Traefik labels (§6.4)
│   ├── compose.litestream.yaml         # optional off-site SQLite replication overlay (§8.3)
│   ├── .env.example                    # "change these" above the line, "don't touch" below
│   ├── Caddyfile.example               # §6.3
│   ├── nginx/femho.conf.example        # §6.2, incl. CalDAV + SSE blocks
│   ├── traefik/dynamic.yml.example
│   └── secrets/.gitkeep                # + README saying how to create db_password.txt
│
├── docs/                               # MkDocs Material source (§12.4)
│   ├── index.md
│   ├── install/{docker-sqlite,docker-postgres,upgrade,sqlite-to-postgres}.md
│   ├── config/{env-vars,config-file,secrets,reverse-proxy}.md   # env-vars.md is GENERATED
│   ├── features/{scopes,caldav,rest-api,mcp,share-links,ai-user}.md
│   ├── ops/{backup,restore-drill,observability,troubleshooting}.md
│   ├── versioning.md                   # the six breaking-change commitments (§10.2)
│   └── assets/
├── mkdocs.yml
│
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                      # lint, unit tests, `docker build` (no push) on PRs
│   │   ├── release.yml                 # §12.2 — multi-arch build+push+attest+release assets
│   │   ├── smoke.yml                   # §12.3 — compose up --wait + healthz/readyz/PROPFIND
│   │   ├── docs.yml                    # mkdocs gh-deploy
│   │   └── scan.yml                    # trivy/grype on the published image, weekly
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug_report.yml              # REQUIRES: output of `femho debug bundle` + `/version`
│   │   ├── feature_request.yml
│   │   └── config.yml
│   ├── dependabot.yml                  # gomod/npm + docker + github-actions ecosystems
│   └── pull_request_template.md
│
├── cmd/femho/                          # main; subcommands below
│   └── (serve | healthcheck | doctor | backup | restore | user | db | instance | debug | version)
├── internal/
│   ├── config/                         # layered defaults ← file ← env ← _FILE (§5)
│   │   ├── config.go
│   │   ├── secretfile.go               # the _FILE resolver (§5.4)
│   │   └── gen_docs.go                 # emits docs/config/env-vars.md
│   ├── proxyheaders/                   # trusted proxies + base URL derivation (§5.6)
│   ├── migrate/                        # embedded migrations + advisory lock + pre-backup (§7)
│   ├── health/                         # /healthz /readyz /version
│   ├── metrics/                        # optional, token-gated /metrics
│   ├── dav/                            # CalDAV incl. /.well-known handlers (§6.5)
│   ├── mcp/                            # Streamable HTTP endpoint (§6.6)
│   └── seed/                           # default scopes + demo data (§11.2)
├── migrations/                         # NNNN_name.up.sql, forward-only, embedded
│
├── scripts/
│   ├── backup.sh                       # documented volume tar (§8.4)
│   ├── restore.sh
│   └── gen-secrets.sh                  # creates deploy/secrets/*.txt with openssl rand
│
└── test/
    ├── e2e/proxy_matrix_test.go        # nginx / Caddy / Traefik × root / sub-path × CalDAV / SSE
    └── fixtures/golden-backup.tar.zst  # for `femho backup verify` in CI
```

### The five files that decide adoption

1. `README.md` — must show a working compose file **above the fold** and get to
   "open your browser" in three commands.
2. `deploy/compose.yaml` — 28 lines, zero required edits, attached to every release.
3. `Dockerfile` — small, multi-arch, non-root, with a working `HEALTHCHECK`.
4. `docs/config/reverse-proxy.md` — verbatim Caddy/Traefik/nginx that handle CalDAV and SSE.
5. `docs/ops/backup.md` — one command, and an explicit list of what is in the volume.

---

## 14. UNVERIFIED items (do not treat as fact)

- Paperless-ngx `_FILE` suffix convention — the configuration reference page fetched did not
  document it.
- Actual Budget env vars (`ACTUAL_PORT`, upload size limits) and healthcheck definition.
- The verbatim `ckulka/baikal` `examples/docker-compose.yaml`.
- Dockerfile `HEALTHCHECK` option defaults and exit-code semantics (0/1/2) from the primary
  Docker reference — the page truncated before that section on three separate fetches. Compose-level
  healthcheck fields **are** verified.
- Exact uncompressed sizes for `distroless/base-debian13`; only `static-debian13` ("around 2 MiB")
  is quoted by the source.
- The claim that Traefik does not restrict HTTP methods by default (no method allowlist was found
  in the routing docs, but no explicit statement either).
- The claim that Caddy's `reverse_proxy` passes arbitrary methods (reasoned from the absence of
  any method filter, not from an explicit statement).
- Cloudflare proxy behaviour with WebDAV methods — widely reported, not verified here.
- Whether Traefik v3 accepts `-1` for `responseforwarding.flushinterval`.
- The literal Watchtower label key for pre-update/post-update lifecycle hooks.
- Current GitHub Actions cache quota (used to argue for registry cache over `type=gha`).
- Current MkDocs Material and `peter-evans/dockerhub-description` versions.
- Whether `PUID`/`PGID` can be implemented on a distroless image (no shell, no `usermod`).
- All Fem-ho resource-usage and image-size numbers in §2.2 and §4.5 — engineering targets, not
  measurements.
- Whether the app can reliably detect a non-persistent Postgres data directory from inside the
  container (§4.4).
- Whether WAL-on-network-filesystem can be reliably detected at boot (§7.4).

---

## 15. Sources

Primary sources actually fetched for this dossier:

- Vikunja — full Docker example: https://vikunja.io/docs/full-docker-example/
- Vikunja — config options: https://vikunja.io/docs/config-options/
- Immich — docker-compose.yml: https://raw.githubusercontent.com/immich-app/immich/main/docker/docker-compose.yml
- Immich — example.env: https://raw.githubusercontent.com/immich-app/immich/main/docker/example.env
- Immich — reverse proxy: https://docs.immich.app/administration/reverse-proxy/
- Paperless-ngx — compose (postgres): https://raw.githubusercontent.com/paperless-ngx/paperless-ngx/main/docker/compose/docker-compose.postgres.yml
- Paperless-ngx — configuration: https://raw.githubusercontent.com/paperless-ngx/paperless-ngx/main/docs/configuration.md
- Miniflux — Docker docs: https://miniflux.app/docs/docker.html
- Miniflux — installation: https://miniflux.app/docs/installation.html
- Gitea — install with Docker: https://docs.gitea.com/installation/install-with-docker
- Karakeep — docker-compose.yml: https://raw.githubusercontent.com/karakeep-app/karakeep/main/docker/docker-compose.yml
- Linkwarden — docker-compose.yml: https://raw.githubusercontent.com/linkwarden/linkwarden/main/docker-compose.yml
- Actual Budget — Docker install: https://actualbudget.org/docs/install/docker
- Baikal Docker (ckulka): https://github.com/ckulka/baikal-docker
- Radicale v3 documentation (proxy + Docker): https://radicale.org/v3.html
- Nextcloud — nginx root config sample: https://raw.githubusercontent.com/nextcloud/documentation/master/admin_manual/installation/nginx-root.conf.sample
- Nextcloud — official Docker image: https://hub.docker.com/_/nextcloud
- PostgreSQL — official Docker image: https://hub.docker.com/_/postgres
- RFC 6764 (CalDAV/CardDAV service discovery): https://www.rfc-editor.org/rfc/rfc6764.html
- Caddy — reverse_proxy directive: https://caddyserver.com/docs/caddyfile/directives/reverse_proxy
- nginx — ngx_http_proxy_module: https://nginx.org/en/docs/http/ngx_http_proxy_module.html
- nginx — ngx_http_dav_module: https://nginx.org/en/docs/http/ngx_http_dav_module.html
- OWASP CRS — REQUEST-911-METHOD-ENFORCEMENT.conf: https://raw.githubusercontent.com/coreruleset/coreruleset/main/rules/REQUEST-911-METHOD-ENFORCEMENT.conf
- Traefik — Docker provider routing configuration: https://doc.traefik.io/traefik/reference/routing-configuration/other-providers/docker/
- Docker Compose — services spec: https://docs.docker.com/reference/compose-file/services/
- Dockerfile reference: https://docs.docker.com/reference/dockerfile/
- Docker — build Go images guide: https://docs.docker.com/guides/golang/build-images/
- Docker — multi-platform builds in GitHub Actions: https://docs.docker.com/build/ci/github-actions/multi-platform/
- GoogleContainerTools/distroless: https://github.com/GoogleContainerTools/distroless
- docker/metadata-action: https://github.com/docker/metadata-action
- docker/build-push-action: https://github.com/docker/build-push-action
- GitHub Docs — publish Docker images: https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images
- Watchtower — arguments/labels: https://containrrr.dev/watchtower/arguments/
- Litestream — Docker guide: https://litestream.io/guides/docker/
- SQLite — VACUUM (INTO): https://www.sqlite.org/lang_vacuum.html
- MCP spec 2025-06-18 — Transports: https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
- sabre.io — webserver configuration: https://sabre.io/dav/webservers/
- Distroless nonroot UID discussion: https://github.com/GoogleContainerTools/distroless/issues/443
