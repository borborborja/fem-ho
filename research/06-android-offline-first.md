# Fem-ho — Dossier 06: Native Android, Offline-First, Paired to a Self-Hosted Server (2026)

> **File-location note.** This dossier was requested at
> `/private/tmp/claude-501/-Users-borja-Codi-fem-ho/4ee9f810-66f8-4e6f-86dc-06e906a11d09/scratchpad/research/06-android-offline-first.md`.
> The session ran under plan mode, which permits writing only to this plan file. Copy this file verbatim to the
> requested path when execution is enabled. Content is identical to what was requested; only the path differs.

**Scope.** Everything the implementing AI needs to build the Fem-ho Android client: stack choices with real
versions, offline-first data layer, sync engine (pull with change token + push via outbox), conflict resolution
including kanban ordering, on-device auth/TLS for a self-hosted server, push notification strategy without
Google, widgets/shortcuts/quick-add, Compose implementation notes for the specific Fem-ho UI, testing, release,
and a concrete module layout + sync pseudocode.

**Verification convention.** Facts below were fetched from primary sources in August 2026. Anything I could not
confirm from a primary source is tagged **UNVERIFIED** inline and re-listed in §16.

---

## 0. TL;DR — the decisions

| Question | Decision | Why |
|---|---|---|
| Language / UI | Kotlin 2.3.x + Jetpack Compose | Only viable modern choice; Compose BOM `2026.06.01`. |
| Design system | Material 3 `1.4.0` stable; **do not** ship on `1.5.0-alphaNN` Expressive | Plou is a custom design system — you override tokens anyway; alpha churn is pure cost. |
| Navigation | Navigation 3 (`androidx.navigation3` **1.1.5**, stable since 1.1.0 on 2026-04-08) | Compose-native, state-list backstack model fits the "scope chips + project dropdown" top-level shell. |
| DI | **Hilt** (Dagger `2.59.x`) | Compile-time validation, first-class `HiltWorker` for WorkManager — you will have many Workers. Koin 4.1.1 is the fallback if build times hurt. |
| HTTP | **Ktor client 3.5.1** with the **OkHttp engine** | You need WebSocket + a runtime-configurable base URL + runtime-configurable TLS trust. Ktor gives WS and typed config; OkHttp engine gives the `SSLSocketFactory`/`X509TrustManager` hooks you need for self-signed certs. |
| JSON | kotlinx.serialization `1.11.0` | Multiplatform, no reflection, R8-friendly. |
| Local store | **Room 2.8.4** as single source of truth | Official offline-first guidance; Flow-backed queries; `@Upsert`; auto-migrations. |
| Sync | WorkManager `2.11.2` unique work + expedited kick + outbox table | Official pattern (Now in Android). |
| Conflict | **Per-field LWW with server-assigned HLC/version**, never whole-row LWW | Task managers get independent field edits constantly (assignee vs. due date vs. column). |
| Ordering | **Fractional indexing** (base-62 order keys) + jitter, tie-break on id | Moves touch one row; no renumbering; survives offline moves. |
| Secrets | **DataStore + `datastore-tink` `AeadSerializer`** (or hand-rolled Keystore AES-GCM) | `androidx.security:security-crypto` is **fully deprecated** as of `1.1.0-beta01` (2025-06-04). |
| Push | **UnifiedPush (spec AND_3.1.0)** primary, WebSocket-while-foreground, periodic WorkManager floor; FCM only in a separate Play flavour | Self-hosted product must not require Google Play Services. |
| Distribution | GitHub Releases (universal APK, signed) + F-Droid metadata; Play flavour optional | Play forces `targetSdk 36` by 2026-08-31 anyway. |

---

## 1. Platform baseline and toolchain

### 1.1 SDK levels

- **`compileSdk = 36`**, **`targetSdk = 36`** (Android 16). Google Play requires new apps *and updates* to target
  API 36 from **2026-08-31**; extension available to **2026-11-01**. Existing apps must target ≥35 to stay
  discoverable to new users.
- **`minSdk = 26`** (Android 8.0) recommended. Rationale:
  - WorkManager 2.11.0+ already raised its own minimum to **API 23**.
  - API 26 gives you notification channels unconditionally, `java.time` via desugaring, adaptive icons,
    and `ShortcutManager` without compat branches.
  - Room/KMP, Glance, and Compose all support 21+, so 26 is a comfort choice, not a hard constraint.
- Enable core library desugaring for `java.time` on <API 26 if you drop to `minSdk 21`:
  `coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.4")` (version used by Now in Android).

### 1.2 Android 16 behaviour changes that hit a sync app

Fetched from `developer.android.com/about/versions/16/behavior-changes-all`:

- **JobScheduler quota tightening.** Job runtime quotas are now adjusted by App Standby Bucket. Two changes bite:
  1. Jobs started while the app is visible **continue to obey runtime quotas after the app becomes invisible**.
  2. Jobs running concurrently with a foreground service **now obey job runtime quotas** (previously exempt).
  Affects WorkManager, JobScheduler, DownloadManager.
- **Debugging APIs:** `WorkInfo.getStopReason()`, `JobParameters.getStopReason()`, and the new
  `JobScheduler#getPendingJobReasonsHistory()`.
- **`STOP_REASON_TIMEOUT_ABANDONED`** — new stop reason when `JobParameters` is GC'd without
  `JobService#jobFinished()`. Repeated occurrences cause the system to *reduce your job frequency*.
  WorkManager is not affected (it manages the lifecycle), but do not hand-roll `JobService`.
- **`JobInfo.Builder#setImportantWhileForeground(boolean)` is now non-functional**;
  `isImportantWhileForeground()` returns `false`.
- **Ordered broadcast priority is now scoped to your own process.** `android:priority` /
  `IntentFilter#setPriority` no longer compete globally. Relevant if you ever intercept UnifiedPush broadcasts.
- **Intent redirection hardening on by default.** If you ever forward a nested `Intent` extra (e.g. a share
  target that re-launches a caller intent), it is blocked unless you call
  `Intent#removeLaunchSecurityProtection()`. **Do not do this in Fem-ho** — restructure instead.
- **16 KB page size compatibility mode.** Align native libs to 16 KB. Fem-ho has no NDK code unless you bundle
  SQLCipher — if you do, this matters. `android:pageSizeCompat` in the manifest suppresses the dialog.

Testing commands worth putting in the repo's `docs/`:

```bash
adb shell am set-standby-bucket cat.femho active|working_set|frequent|rare|restricted
adb shell am get-standby-bucket cat.femho
adb shell am compat enable OVERRIDE_QUOTA_ENFORCEMENT_TO_TOP_STARTED_JOBS cat.femho
adb shell am compat enable OVERRIDE_QUOTA_ENFORCEMENT_TO_FGS_JOBS cat.femho
```

### 1.3 Certificate Transparency & ECH (new, matters for self-hosted)

From the network security config reference:

- `<certificateTransparency enabled="true|false">` — **enabled by default on Android 17+ (API 37+)**,
  **disabled by default on Android 16 (API 36)**, unavailable ≤ API 35.
- `<domainEncryption mode="enabled|disabled">` (Encrypted Client Hello) — **enabled by default on API 37+**.

**Consequence for Fem-ho:** a self-hosted server with a *private* CA or a self-signed cert has no CT logs. On
API 37+ a CT-enforced connection to such a host **will fail**. Because the server host is entered at runtime you
cannot pre-list it in `network_security_config.xml`. See §8.5 for the runtime-trust design that sidesteps this
entirely (a custom `X509TrustManager` on the OkHttp engine bypasses the platform config path for CT as well —
**UNVERIFIED** whether CT enforcement applies to custom trust managers on API 37; test on a Pixel with API 37
before release, and keep a per-server "advanced: disable CT" escape hatch behind a warning).

---

## 2. Stack — concrete versions (August 2026)

### 2.1 Version table (all fetched, dated)

| Artifact | Version | Source / date |
|---|---|---|
| Compose BOM | `2026.06.01` | developer.android.com BOM mapping |
| ↳ `compose.ui` / `foundation` / `runtime` | `1.11.4` | same |
| ↳ `compose.material3` | `1.4.0` (stable) | material3 release page, 2026-07-29 |
| `compose.material3` alpha | `1.5.0-alpha25` | 2026-07-29 |
| `androidx.navigation3:navigation3-runtime` / `-ui` | `1.1.5` stable (2026-07-29); `1.2.0-alpha07` alpha | navigation3 release page |
| `androidx.room:*` | `2.8.4` stable (2025-11-19) | Room release page |
| `androidx.work:work-runtime-ktx` | `2.11.2` stable (2026-03-25); `2.12.0-beta01` (2026-07-29) | WorkManager release page |
| `androidx.datastore:datastore-preferences` | `1.2.1` stable (2026-03-11) | DataStore release page |
| `androidx.datastore:datastore-tink` | `1.3.0-alpha07` | DataStore release page |
| `androidx.glance:glance-appwidget` | `1.1.1` stable (2024-10-16); `1.2.0-rc01` (2025-12-03); `1.3.0-alpha02` (2026-07-01) | Glance release page |
| `androidx.security:security-crypto` | `1.1.0` — **all APIs deprecated** | security release page |
| Ktor | `3.5.1` (2026-06-26) | ktor.io/docs/releases |
| OkHttp | `5.4.0` (2026-06-08); 5.0.0 GA 2025-07-02 | square/okhttp CHANGELOG |
| Retrofit | `3.0.0` (2025-05-15), depends on OkHttp 4.12 | square/retrofit CHANGELOG |
| kotlinx.serialization | `1.11.0` (2026-04-09) | kotlinx.serialization CHANGELOG |
| Hilt / Dagger | `2.59.2` (docs recommend), NiA pins `2.59` | dagger.dev/hilt/gradle-setup + NiA toml |
| Koin BOM | `4.1.1`; Koin Compiler `1.0.0-RC3.8` (needs Koin 4.2.0+, Kotlin 2.3.x) | insert-koin.io |
| `sh.calvin.reorderable:reorderable` | `3.1.0` | Calvin-LL/Reorderable README |
| `com.kizitonwose.calendar:compose` | ~`2.10.1` (**UNVERIFIED** exact latest) | libraries.io for `:data` 2.10.1 |
| `androidx.benchmark:benchmark-macro-junit4` | `1.4.1`+ | baseline profiles overview |
| `androidx.profileinstaller:profileinstaller` | `1.4.1`+ | same |

### 2.2 Now in Android's actual `libs.versions.toml` (fetched verbatim, `main`)

Useful as a known-good, mutually-compatible pin set. Note NiA trails the newest androidx releases:

```toml
androidGradlePlugin = "9.0.0"
androidTools = "32.0.0"
kotlin = "2.3.0"
ksp = "2.3.4"
androidxComposeBom = "2025.09.01"
androidxCore = "1.15.0"
androidxActivity = "1.9.3"
androidxLifecycle = "2.10.0"
androidxNavigation3 = "1.0.0"
androidxDataStore = "1.2.0"
androidxWork = "2.10.0"
room = "2.8.3"
hilt = "2.59"
hiltExt = "1.2.0"
kotlinxCoroutines = "1.10.1"
kotlinxSerializationJson = "1.8.0"
kotlinxDatetime = "0.6.1"
okhttp = "4.12.0"
retrofit = "2.11.0"
androidxProfileinstaller = "1.4.1"
androidxMacroBenchmark = "1.5.0-alpha01"
robolectric = "4.16"
roborazzi = "1.56.0"
turbine = "1.2.0"
coil = "2.7.0"
androidDesugarJdkLibs = "2.1.4"
```

**AGP 9.0.0 and Kotlin 2.3.0 are what Google's own flagship sample is on.** Use those.

### 2.3 Ktor vs Retrofit — recommendation and reasoning

**Recommend Ktor 3.5.1 client with the OkHttp engine.** Reasons specific to Fem-ho:

1. **Runtime base URL.** Fem-ho's login screen takes a server URL. Retrofit bakes `baseUrl` into the
   `Retrofit` instance at build time; changing servers means rebuilding the whole `Retrofit` + service proxies
   (doable via a `@Provides` factory, but it fights the design). Ktor's `defaultRequest { url(serverUrl) }`
   plus `HttpClient` re-creation is a first-class pattern.
2. **WebSockets.** You want a foreground WebSocket for live kanban updates (§9.3). Ktor has
   `install(WebSockets)` and `client.webSocketSession { }` returning a `Flow`-friendly session with
   `incoming: ReceiveChannel<Frame>`. With Retrofit you'd drop to raw OkHttp `WebSocketListener` and bridge it
   to Flow by hand.
3. **Runtime TLS trust.** The OkHttp engine exposes `config { sslSocketFactory(f, tm) }` / `engine { preconfigured = okHttpClient }`, so the same self-signed-cert machinery (§8.5) serves both HTTP and WS.
4. **Auth token refresh.** `install(Auth) { bearer { loadTokens { }; refreshTokens { } } }` is built-in;
   Retrofit needs an `Authenticator` + `Interceptor` pair.
5. **kotlinx.serialization is native**: `install(ContentNegotiation) { json(Json { ignoreUnknownKeys = true }) }`.

Retrofit 3.0.0 is fine engineering, but note it still pins **OkHttp 4.12**, not 5.x, and its group/artifact
naming after 3.0 is ambiguous in the sources I read (`com.squareup.retrofit2:converter-kotlinx-serialization:3.0.0`
appears on libraries.io, while some posts write `com.squareup.retrofit3:`) — **UNVERIFIED**, another small reason
to skip it.

Skeleton:

```kotlin
// core/network/src/main/kotlin/cat/femho/core/network/FemhoHttpClientFactory.kt
class FemhoHttpClientFactory @Inject constructor(
    private val trustStore: ServerTrustStore,      // §8.5
    private val tokenStore: TokenStore,            // §8.2
) {
    fun create(server: ServerConfig): HttpClient = HttpClient(OkHttp) {
        expectSuccess = false                       // we map status codes ourselves

        engine {
            config {
                callTimeout(30, TimeUnit.SECONDS)
                connectTimeout(10, TimeUnit.SECONDS)
                retryOnConnectionFailure(true)
                trustStore.sslConfigFor(server)?.let { (factory, tm) ->
                    sslSocketFactory(factory, tm)
                }
            }
        }

        defaultRequest {
            url(server.baseUrl)                     // e.g. https://femho.casa.example/api/v1/
            header(HttpHeaders.Accept, ContentType.Application.Json)
            header("X-Femho-Client", "android/${BuildConfig.VERSION_NAME}")
            header("X-Femho-Device-Id", server.deviceId)
        }

        install(ContentNegotiation) {
            json(Json {
                ignoreUnknownKeys = true            // forward-compat with newer servers
                explicitNulls = false               // patch semantics: absent != null
                encodeDefaults = false
            })
        }

        install(HttpTimeout) { requestTimeoutMillis = 30_000 }

        install(Auth) {
            bearer {
                loadTokens { tokenStore.bearerTokens(server.id) }
                refreshTokens { tokenStore.refresh(server.id, client) }
                sendWithoutRequest { true }
            }
        }

        install(WebSockets) { pingIntervalMillis = 20_000 }

        install(Logging) {
            level = if (BuildConfig.DEBUG) LogLevel.HEADERS else LogLevel.NONE
        }
    }
}
```

**What Fem-ho should do (§2):** pin AGP 9.0.0 / Kotlin 2.3.0 / KSP 2.3.4 / Compose BOM 2026.06.01 /
material3 1.4.0 / Room 2.8.4 / WorkManager 2.11.2 / Navigation3 1.1.5 / Hilt 2.59.2 in a
`gradle/libs.versions.toml`, use Ktor 3.5.1 + OkHttp engine, and keep `material3` on **stable 1.4.0** —
Plou overrides colours/type/shape anyway, so Expressive's alpha API churn buys nothing.

---

## 3. Offline-first data layer

### 3.1 The official rules (developer.android.com/topic/architecture/data-layer/offline-first)

Verbatim-faithful summary of the guidance:

- An offline-first app performs all/critical core functionality **without** internet.
- The **local data source is the canonical source of truth**. Higher layers read *exclusively* from it.
- Every repository that uses the network needs at least two data sources: a **local** one (Room/DataStore/files)
  and a **network** one.
- **Reads are reactive** (`Flow`/`StateFlow`); **writes are `suspend`**.
- Three model tiers, with explicit converters: `NetworkX` (`@Serializable`) → `XEntity` (`@Entity`) →
  `X` (domain). Converters named `NetworkX.asEntity()` and `XEntity.asExternalModel()`.
- Reads/writes must be **main-safe**; the data layer moves work to the right dispatcher.
- Write strategies: **online-only** (banking), **queued** (analytics — fire and forget),
  **lazy** (write local first, queue the network update, requires conflict resolution).
  → **Fem-ho is "lazy writes" for essentially everything.**
- Sync strategies: **pull-based** (on demand, Paging `RemoteMediator`), **push-based** (local mirrors network,
  server tells you what's stale), **hybrid**.
  → **Fem-ho is push-based for tasks/scopes/projects, pull-based for attachments and audit history.**
- Conflict resolution baseline: **last write wins with timestamp metadata**.

### 3.2 Model tiers for Fem-ho

```kotlin
// --- network tier -------------------------------------------------------
@Serializable
data class NetworkTask(
    val id: String,                       // server UUID (v7 preferred: time-sortable)
    val scopeId: String,
    val projectId: String? = null,
    val title: String,
    val notes: String? = null,
    val column: String,                   // "inbox" | "todo" | "doing" | "done"
    val position: String,                 // fractional index order key, e.g. "a0V"
    val assigneeIds: List<String> = emptyList(),
    val dueAt: Instant? = null,
    val startAt: Instant? = null,
    val allDay: Boolean = false,
    val recurrence: String? = null,       // RRULE
    val aiMode: String = "self",          // "self" | "assisted" | "delegated"
    val parentTaskId: String? = null,
    val checklistId: String? = null,
    val deleted: Boolean = false,         // tombstone
    val updatedAt: Instant,               // SERVER clock
    val version: Long,                    // monotonic per-entity server version
    val fieldVersions: Map<String, Long> = emptyMap(),  // per-field LWW stamps, §5
    val etag: String? = null,
)

// --- local tier ---------------------------------------------------------
@Entity(
    tableName = "tasks",
    indices = [
        Index("scope_id", "project_id", "column", "position"),
        Index("due_at"),
        Index("parent_task_id"),
    ],
)
data class TaskEntity(
    @PrimaryKey val id: String,
    @ColumnInfo("scope_id") val scopeId: String,
    @ColumnInfo("project_id") val projectId: String?,
    val title: String,
    val notes: String?,
    val column: String,
    val position: String,
    @ColumnInfo("due_at") val dueAt: Long?,           // epoch millis, UTC
    @ColumnInfo("start_at") val startAt: Long?,
    @ColumnInfo("all_day") val allDay: Boolean,
    val recurrence: String?,
    @ColumnInfo("ai_mode") val aiMode: String,
    @ColumnInfo("parent_task_id") val parentTaskId: String?,
    @ColumnInfo("checklist_id") val checklistId: String?,
    val deleted: Boolean,
    // --- sync bookkeeping, never sent to UI ---
    @ColumnInfo("updated_at") val updatedAt: Long,          // server clock
    @ColumnInfo("server_version") val serverVersion: Long,
    @ColumnInfo("local_dirty") val localDirty: Boolean,     // has un-pushed outbox ops
    @ColumnInfo("local_only") val localOnly: Boolean,       // created offline, no server id yet
)
```

Keep `assigneeIds` in a junction table `task_assignees(task_id, user_id)` so scope-member filtering is a JOIN,
not a JSON scan.

### 3.3 DAO shape

```kotlin
@Dao
interface TaskDao {
    @Query("""
        SELECT * FROM tasks
        WHERE deleted = 0
          AND scope_id IN (:scopeIds)
          AND (:projectId IS NULL OR project_id = :projectId)
        ORDER BY column, position, id
    """)
    fun observeBoard(scopeIds: List<String>, projectId: String?): Flow<List<TaskEntity>>

    @Query("SELECT * FROM tasks WHERE id = :id")
    fun observeTask(id: String): Flow<TaskEntity?>

    @Upsert suspend fun upsertAll(tasks: List<TaskEntity>)

    @Query("DELETE FROM tasks WHERE id IN (:ids)")
    suspend fun hardDelete(ids: List<String>)

    /** Neighbours for fractional-index insertion. */
    @Query("""
        SELECT position FROM tasks
        WHERE scope_id = :scopeId AND column = :column AND deleted = 0
          AND (:projectId IS NULL OR project_id = :projectId)
        ORDER BY position
    """)
    suspend fun positionsIn(scopeId: String, projectId: String?, column: String): List<String>

    @Transaction
    suspend fun applyServerSnapshot(upserts: List<TaskEntity>, tombstones: List<String>) {
        upsertAll(upserts)
        hardDelete(tombstones)
    }
}
```

`ORDER BY position` relies on **BINARY collation**. SQLite's default for `TEXT` is BINARY, which sorts base-62
order keys correctly because the base-62 alphabet `0-9A-Za-z` is in ascending ASCII order. **Never** declare
`position` with `COLLATE NOCASE` — it would collapse `A` and `a` and break ordering.

### 3.4 Database

```kotlin
@Database(
    entities = [
        TaskEntity::class, TaskAssigneeEntity::class, SubtaskEntity::class,
        ChecklistEntity::class, ChecklistItemEntity::class,
        ScopeEntity::class, ProjectEntity::class, UserEntity::class,
        OutboxEntity::class, SyncStateEntity::class, AuditEntity::class,
        ShareLinkEntity::class,
    ],
    version = 1,
    exportSchema = true,
)
@TypeConverters(FemhoConverters::class)
abstract class FemhoDatabase : RoomDatabase() {
    abstract fun taskDao(): TaskDao
    abstract fun outboxDao(): OutboxDao
    abstract fun syncStateDao(): SyncStateDao
    // ...
}

// Room 2.7+/2.8 builder
Room.databaseBuilder<FemhoDatabase>(context, dbFilePath)
    .setDriver(BundledSQLiteDriver())
    .setQueryCoroutineContext(Dispatchers.IO)
    .build()
```

Room Gradle plugin for schema export (needed for auto-migrations and for CI diffing):

```kotlin
plugins { id("androidx.room") version "2.8.4" }
android { room { schemaDirectory("$projectDir/schemas") } }
ksp { arg("room.generateKotlin", "true") }
```

### 3.5 Multi-server / multi-account

Fem-ho pairs to a self-hosted server whose URL the user types. Design decision:

**One database file per (serverUrl, userId) pair.** Name it
`femho-${sha256(serverUrl + "|" + userId).take(16)}.db`. Reasons:
- Wiping an account = deleting one file; no cascading deletes, no orphan rows.
- No accidental cross-server leakage of scopes/tasks (a real hazard: a family server and a work server).
- Row-level `serverId` columns everywhere would pollute every query and every index.

Hold the active `FemhoDatabase` behind a `@Singleton` holder that can swap instances, and re-create the Ktor
`HttpClient` at the same time. Everything downstream is `Flow`, so a `flatMapLatest` on the active-account
`Flow` rewires the whole UI on account switch.

**What Fem-ho should do (§3):** Room is the single source of truth; the UI never sees a network model; three
model tiers with explicit converters; one DB file per (server, user); `position` is `TEXT` with default BINARY
collation; every entity carries `updatedAt`, `serverVersion`, `localDirty`, `deleted`.

---

## 4. Sync engine — pull with a change token, push with an outbox

### 4.1 The Now in Android pattern (the reference)

NiA models pull sync as **change lists + change-list versions**. The shape (from the architecture docs and the
`Synchronizer` API surface):

- A `Synchronizer` interface exposes the persisted `ChangeListVersions` and lets a repository update them.
- `ChangeListVersions` is a small data class of per-model version cursors
  (e.g. `topicVersion`, `newsResourceVersion`).
- A generic helper `changeListSync(versionReader, changeListFetcher, versionUpdater, modelDeleter, modelUpdater)`:
  - `versionReader` — reads the current cursor out of `ChangeListVersions`
    (e.g. `ChangeListVersions::newsResourceVersion`),
  - `changeListFetcher` — `suspend (Int) -> List<NetworkChangeList>`, given the cursor,
  - `versionUpdater` — returns updated `ChangeListVersions` after the batch,
  - `modelDeleter` — consumes the ids of deleted models,
  - `modelUpdater` — consumes the ids of changed models (then fetches them by id).
- `SyncWorker : CoroutineWorker(), Synchronizer` runs the repositories' `sync()` in parallel with `awaitAll`,
  returning `Result.retry()` on any failure so WorkManager applies exponential backoff.
- `suspendRunCatching` wraps each step so a `CancellationException` is not swallowed.

Exact `Synchronizer.kt` source could not be fetched (404 on the raw paths I tried) — the parameter names above
come from Google's Horologist port of the same API and NiA docs. **UNVERIFIED at the character level**, but the
*shape* is confirmed by two independent sources.

### 4.2 Fem-ho's server contract (design this into the REST API dossier too)

Pull endpoint:

```
GET /api/v1/sync/changes?since=<token>&limit=500
Authorization: Bearer <access-token>

200 OK
{
  "changes": [
    { "entity": "task",     "id": "018f...", "op": "upsert", "version": 4211 },
    { "entity": "task",     "id": "018e...", "op": "delete", "version": 4212 },
    { "entity": "checklist","id": "018d...", "op": "upsert", "version": 4213 }
  ],
  "nextToken": "4213",
  "hasMore": false,
  "serverTime": "2026-08-05T09:14:22.113Z"
}
```

Hydration endpoint (batch by id, so a change list of 400 ids is 1–2 requests, not 400):

```
POST /api/v1/tasks/batch-get
{ "ids": ["018f...", "018e...", ...] }
→ { "tasks": [ NetworkTask, ... ], "missing": ["018c..."] }
```

Bootstrap (first sync, or after token expiry / server compaction):

```
GET /api/v1/sync/snapshot?scopes=all
→ full state + a fresh token
```

Server must return **`409 Conflict` with `{"error":"stale_token","reason":"compacted"}`** when `since` is older
than the retained change-log window, so the client falls back to snapshot instead of silently missing changes.

Push endpoint (the outbox drain):

```
POST /api/v1/sync/mutations
Idempotency-Key: <outbox batch uuid>
{
  "mutations": [
    {
      "opId": "8c2e...",                     // client UUID, idempotency unit
      "entity": "task",
      "entityId": "018f...",
      "type": "update",                       // create | update | delete | move
      "baseVersion": 4207,                    // version the client last saw
      "fields": { "column": "doing", "position": "a1V" },
      "clientTime": "2026-08-05T09:12:00.000Z"
    }
  ]
}

200 OK
{
  "results": [
    { "opId": "8c2e...", "status": "applied",  "entity": {NetworkTask}, "version": 4214 },
    { "opId": "9a11...", "status": "merged",   "entity": {NetworkTask}, "version": 4215 },
    { "opId": "bb03...", "status": "rejected", "code": 422, "reason": "scope_not_found" },
    { "opId": "cc44...", "status": "conflict", "code": 409, "entity": {NetworkTask} }
  ],
  "nextToken": "4215"
}
```

Two properties make this robust:
1. **Per-mutation results.** One bad op never blocks the queue (compare: a naive `POST` per op that returns 422
   and jams the head).
2. **The applied entity is echoed back**, so the client can write the authoritative row without a follow-up GET.

### 4.3 Sync trigger matrix

| Trigger | Mechanism | Work name |
|---|---|---|
| App cold start / account switch | `enqueueUniqueWork(SYNC_ONE_SHOT, KEEP, expedited)` | `femho-sync-oneshot` |
| App foregrounded | Same, `ExistingWorkPolicy.KEEP` | `femho-sync-oneshot` |
| Local mutation enqueued | `enqueueUniqueWork(OUTBOX_DRAIN, APPEND_OR_REPLACE, expedited)` | `femho-outbox-drain` |
| UnifiedPush message received | `enqueueUniqueWork(SYNC_ONE_SHOT, REPLACE, expedited)` | `femho-sync-oneshot` |
| WebSocket frame (foreground) | direct in-process sync, no Worker | — |
| Periodic floor | `enqueueUniquePeriodicWork(PERIODIC, KEEP, 1h)` | `femho-sync-periodic` |
| Manual pull-to-refresh | `enqueueUniqueWork(SYNC_ONE_SHOT, REPLACE, expedited)` + observe `WorkInfo` | `femho-sync-oneshot` |

### 4.4 WorkManager specifics

```kotlin
val SyncConstraints: Constraints
    get() = Constraints.Builder()
        .setRequiredNetworkType(NetworkType.CONNECTED)
        .build()

fun oneShotSyncWork(): OneTimeWorkRequest =
    OneTimeWorkRequestBuilder<SyncWorker>()
        .setConstraints(SyncConstraints)
        .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
        .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
        .addTag(TAG_SYNC)
        .build()

fun periodicSyncWork(): PeriodicWorkRequest =
    PeriodicWorkRequestBuilder<SyncWorker>(1, TimeUnit.HOURS)
        .setConstraints(SyncConstraints)
        .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 5, TimeUnit.MINUTES)
        .addTag(TAG_SYNC)
        .build()

WorkManager.getInstance(context).apply {
    enqueueUniqueWork(SYNC_ONE_SHOT, ExistingWorkPolicy.KEEP, oneShotSyncWork())
    enqueueUniquePeriodicWork(SYNC_PERIODIC, ExistingPeriodicWorkPolicy.KEEP, periodicSyncWork())
}
```

Facts to respect:

- **Minimum periodic interval is 15 minutes.** Anything shorter is silently clamped. Use 1 hour as the *floor*;
  UnifiedPush/WebSocket carry the latency-sensitive path.
- **`setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)`** is the safe form: if the app's expedited
  quota is exhausted, the request degrades to a normal job instead of throwing. On API 31+ it maps to
  JobScheduler expedited jobs; below that, to a foreground service — which is why the fallback policy matters.
- **`setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, SECONDS)`**: minimum backoff is 10s, maximum 5h.
- **`ExistingWorkPolicy`**: `KEEP` (don't restart a running sync), `REPLACE` (cancel + restart — use for push-
  triggered sync so the newest cursor wins), `APPEND_OR_REPLACE` (serialise outbox drains).
- **Observe progress in the UI** with `getWorkInfosForUniqueWorkFlow(SYNC_ONE_SHOT)` (Flow APIs added in 2.9.0).
- **Android 16 quotas** (§1.2) mean you must not assume a Worker started while visible keeps running unbounded
  after backgrounding. Design `SyncWorker` to be **resumable**: persist the cursor after every batch so a
  stopped worker restarts cheaply.
- **`WorkInfo.getStopReason()`** — log it; `STOP_REASON_CONSTRAINT_CONNECTIVITY`, `STOP_REASON_TIMEOUT`,
  `STOP_REASON_QUOTA` are the ones you'll see.
- **WorkManager 2.12.0-alpha01** adds a `work-analytics` artifact with `WorkMetricsInfo` /
  `WorkMetricsInfoRepository` (default 7-day retention) and the worker class name in `WorkInfo` — nice for a
  self-hosted app's diagnostics screen, but it's alpha; gate it behind a debug flavour.

Hilt worker wiring:

```kotlin
@HiltWorker
class SyncWorker @AssistedInject constructor(
    @Assisted appContext: Context,
    @Assisted params: WorkerParameters,
    private val syncEngine: SyncEngine,
) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result = when (syncEngine.syncOnce()) {
        SyncOutcome.Success -> Result.success()
        SyncOutcome.Retryable -> Result.retry()
        SyncOutcome.Fatal -> Result.failure()      // e.g. auth revoked; UI shows re-login
    }
}
```

with `HiltWorkerFactory` installed via `Configuration.Provider` on the `Application`.

**What Fem-ho should do (§4):** implement `GET /sync/changes?since=` + `POST /tasks/batch-get` +
`POST /sync/mutations` with per-mutation results and an `Idempotency-Key`; drive it from a single unique
`SyncWorker` with `NetworkType.CONNECTED`, exponential backoff from 30s, expedited-with-fallback; persist the
cursor per batch so the worker is resumable under Android 16 quotas; 1-hour periodic floor.

---

## 5. Conflict resolution

### 5.1 What a task manager actually collides on

Be concrete. In a household task manager the realistic concurrent-edit cases are:

| Case | Frequency | Naive whole-row LWW result | Acceptable? |
|---|---|---|---|
| A edits `title`, B edits `dueAt` | common | one edit silently lost | **No** |
| A sets `column=done`, B sets `column=doing` | common | last writer wins | Yes (with a caveat, §5.4) |
| A assigns `@marta`, B assigns `@pau` | common | one assignment lost | **No** — set semantics |
| A moves card to position 3, B moves the same card to position 7 | occasional | last wins | Yes |
| A moves card X above Y, B moves card Z above Y (different cards) | common | both fine if fractional indices | Yes |
| A checks checklist item 2, B checks item 5 | common | per-item rows, no collision | Yes |
| A deletes task, B edits task | rare | depends on ordering | Needs an explicit rule |
| A edits notes (long text), B edits notes | rare | one lost | Tolerable, but warn |

**Conclusion: whole-row LWW is wrong; full CRDT is overkill.** The right answer is **per-field LWW** plus
**two special-cased field types**: sets (assignees, tags, labels) and ordering (`position`).

### 5.2 Recommended scheme — server-stamped per-field LWW

**Do not trust device clocks.** A phone with a wrong clock would win or lose every conflict forever. Instead:

- The **server** assigns a monotonically increasing `version` (a per-tenant sequence, or an HLC) on every
  accepted mutation.
- Each entity carries a `fieldVersions: Map<String, Long>` — the server `version` at which each field last
  changed.
- A client mutation sends `baseVersion` (the entity version it was editing) and only the **fields it changed**.
- Server merge rule, per field `f` in the incoming mutation:
  ```
  if mutation.baseVersion >= entity.fieldVersions[f]  -> accept (client saw the current value of f)
  else                                                -> reject that field only; keep server value
  ```
  Then bump `entity.version` and set `fieldVersions[f] = entity.version` for accepted fields.
- Response status:
  - `applied` — all fields accepted,
  - `merged` — some fields rejected; the echoed entity is authoritative and the client overwrites,
  - `conflict` (409) — the whole mutation is unapplicable (entity deleted, moved to a scope you can't see).

This gives you: A's `title` and B's `dueAt` both survive; genuine same-field races resolve deterministically and
identically on every device, because the server is the arbiter.

Client side, the merge is trivial — **the server's echoed entity always wins**:

```kotlin
suspend fun applyMutationResult(r: MutationResult) = db.withTransaction {
    when (r.status) {
        Applied, Merged -> {
            taskDao.upsert(r.entity.asEntity().copy(localDirty = outboxDao.hasPending(r.entity.id)))
            outboxDao.deleteByOpId(r.opId)
            if (r.status == Merged) conflictLog.record(r.opId, r.entity.id, r.rejectedFields)
        }
        Conflict -> {
            // server state wins; drop our op, refresh entity, surface a soft notice
            r.entity?.let { taskDao.upsert(it.asEntity()) } ?: taskDao.hardDelete(listOf(r.entityId))
            outboxDao.deleteByOpId(r.opId)
            conflictLog.record(r.opId, r.entityId, reason = r.reason)
        }
        Rejected -> outboxDao.markPermanentlyFailed(r.opId, r.code, r.reason)   // §6.5
    }
}
```

### 5.3 Set-valued fields (assignees, tags)

Model as **add/remove deltas**, not as whole-list replacement. Mutation payload:

```json
{ "type": "update", "entity": "task", "entityId": "018f...",
  "setOps": { "assignees": { "add": ["u_marta"], "remove": [] } } }
```

Server applies as an **OR-Set-ish** union with tombstones: an element is present if its latest add version
exceeds its latest remove version. This makes "A assigns Marta while B assigns Pau" produce *both*, which is what
a household expects. Concurrent add+remove of the *same* element resolves add-wins (safer: an accidental
un-assign is more annoying than a duplicate).

If you send the whole `assigneeIds` array instead, you get lost updates — do not.

### 5.4 The `done` toggle caveat

`column = done` is worth special handling. Case: A marks it done offline at 09:00; B (who did not see that) edits
the notes at 09:05 and the merge bumps versions. With per-field LWW the `column` field is untouched by B, so
`done` survives — correct.

The genuinely awkward case is **recurring tasks**: completing an instance of a recurring task usually means
"create the next occurrence and archive this one". If two devices both complete it offline, you get two next
occurrences. Fix: make completion of a recurring task carry a **deterministic child id** derived from
`(taskId, occurrenceStart)` — e.g. `uuidv5(namespace, "$taskId|$occurrenceIso")`. Both devices generate the same
id; the server upserts once. This is the cheapest de-duplication primitive in the whole system and you should use
the same trick anywhere offline actions can spawn entities.

### 5.5 Why not CRDTs

Options considered:

- **LWW-Element-Set / LWW-Register per field.** This is effectively what §5.2 is, but with a *server* as the
  timestamp authority rather than device clocks. Strictly weaker than a true CRDT (needs a server) — which is
  fine, because Fem-ho is *always paired to a server*; it is offline-tolerant, not peer-to-peer.
- **Full CRDT (Automerge / Yjs / Loro).** Buys: true P2P merge, character-level text merge, no server arbiter.
  Costs: a large Kotlin/JNI dependency (or a Rust `.so` — reintroducing the 16 KB page alignment problem, §1.2),
  a document-oriented storage model that fights Room's relational queries (you can't `ORDER BY position` inside
  an opaque CRDT blob without materialising it), garbage/tombstone growth, and a much harder server
  implementation because the server must also speak the CRDT.
- **Verdict: no.** The only place a CRDT genuinely helps Fem-ho is *concurrent editing of a long `notes` field*,
  which is rare in a family task manager. Handle that with a "someone else changed these notes while you were
  offline — keep yours / keep theirs / view both" resolution card. Ship a real diff UI, not a silent merge.

The literature consensus is on your side here: LWW is "easy to implement but notoriously prone to data loss"
when applied at document granularity; at *field* granularity with a single arbiter it is the standard,
boring, correct choice for this class of app.

### 5.6 Ordering under concurrent moves — fractional indexing

#### 5.6.1 Why not integer positions

`position INTEGER` requires renumbering neighbours on every move (`UPDATE ... SET position = position + 1
WHERE position >= n`), which:
- writes N rows per move → N outbox ops → N conflicts,
- is not commutative: two offline devices reordering the same column produce interleaved garbage,
- makes a single drag a multi-row transaction that can partially fail.

#### 5.6.2 The two real options

**LexoRank (Jira).** Rank is a string like `0|hzzzzz:`. The leading digit before `|` is a **bucket** (0, 1, 2)
used by the rebalance job. Facts from Atlassian's docs:
- Three buckets exist; rebalancing moves rows from bucket *n* to bucket *n+1 mod 3* one at a time, driven by an
  imbalance between min/max marker rows and `LexoRankOperation` `MOVE_NEXT`.
- Rebalance thresholds are on the **longest rank string in the table**: at **128 characters** a rebalance is
  *scheduled* for 12 hours later; at **160 characters** it starts **immediately**.
- Rebalancing is a global, server-side, long-running maintenance operation.

**Fractional indexing (Figma).** Keys are order-preserving strings; inserting between two neighbours produces a
string strictly between them; no global rebalance is required, keys just get longer. Figma uses arbitrary-precision
fractions (not doubles, which run out of precision), stores them as strings, omits the leading `"0."`, and uses
base 95 (the printable ASCII range) for compactness. Reordering a child in Figma typically updates **only the
moved node**.

**Recommendation for Fem-ho: fractional indexing, base 62.** LexoRank's bucket/rebalance machinery is
server-side operational complexity you do not want in a Docker-compose homelab app, and the algorithm is
proprietary-ish and under-specified publicly. Fractional indexing has a CC0 reference implementation, needs no
maintenance job, and touches one row per move — which is exactly what an outbox wants.

Base 62 (`0-9A-Za-z`) specifically because those 62 characters are in **ascending ASCII byte order**, so SQLite's
default BINARY collation and Postgres' `C` collation both sort them correctly with no collation configuration.

#### 5.6.3 The algorithm, in enough detail to implement

This is the Greenspan/Rocicorp design (`rocicorp/fractional-indexing`, CC0). Structure of an **order key**:

```
orderKey := integerPart fractionalPart?
integerPart := head digits*
```

- `digits` alphabet: `BASE_62_DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"`.
- `head` is a magnitude marker from `a..z` (non-negative) or `A..Z` (negative). The head encodes **how many
  digits follow**, so the integer part is self-delimiting and lexicographic order equals numeric order:

```
getIntegerLength(head):            // total length INCLUDING the head char
    if head in 'a'..'z' -> (head - 'a') + 2      // 'a'->2 ("a0"), 'b'->3, ... 'z'->27
    if head in 'A'..'Z' -> ('Z' - head) + 2      // 'Z'->2,        'Y'->3, ... 'A'->27
    else -> error("Invalid order key head")
```

  So the outermost heads (`z`, `A`) mark the longest integers and the heads straddling the midpoint (`a`, `Z`)
  mark the shortest. `INTEGER_ZERO = "a0"`. `SMALLEST_INTEGER = "A" + "0".repeat(26)`.
- The optional `fractionalPart` is any number of `digits` with **no trailing `'0'`** (a trailing zero would make
  two distinct strings compare as different while representing the same value — the implementation rejects it).

Core operations:

```
incrementInteger(x, digits):
    head = x[0]; digs = x[1..]
    carry = true
    for i from last(digs) downto 0 while carry:
        d = indexOf(digits, digs[i]) + 1
        if d == digits.length: digs[i] = digits[0]            // wrap, keep carrying
        else:                  digs[i] = digits[d]; carry = false
    if carry:
        if head == 'Z' return "a" + digits[0]                  // cross zero: "Z9..9" -> "a0"
        if head == 'z' return null                             // overflow: no larger key
        h = head + 1
        if h > 'a' then digs.push(digits[0]) else digs.pop()   // integer got longer / shorter
        return h + digs
    return head + digs

decrementInteger(x, digits):
    head = x[0]; digs = x[1..]
    borrow = true
    for i from last(digs) downto 0 while borrow:
        d = indexOf(digits, digs[i]) - 1
        if d == -1: digs[i] = last(digits)                     // wrap, keep borrowing
        else:       digs[i] = digits[d]; borrow = false
    if borrow:
        if head == 'a' return "Z" + last(digits)
        if head == 'A' return null                             // underflow
        h = head - 1
        if h < 'Z' then digs.push(last(digits)) else digs.pop()
        return h + digs
    return head + digs

midpoint(a, b, digits):      // a < b (or b == null meaning +infinity); both are FRACTIONAL parts
    require(b == null || a < b)
    require(!a.endsWith("0") && (b == null || !b.endsWith("0")))
    if b != null:
        n = length of common prefix of a (padded with '0') and b
        if n > 0: return b[0..n) + midpoint(a.drop(n), b.drop(n), digits)
    digitA = if (a.isEmpty()) 0 else indexOf(digits, a[0])
    digitB = if (b == null) digits.length else indexOf(digits, b[0])
    if digitB - digitA > 1:
        return digits[round(0.5 * (digitA + digitB))]          // room between them
    else:
        if b != null && b.length > 1: return b.take(1)          // e.g. mid("4","50") = "5"
        // digits are consecutive and b is null or a single digit:
        return digits[digitA] + midpoint(a.drop(1), null, digits)   // e.g. mid("49","5") = "495"

generateKeyBetween(a, b, digits = BASE_62_DIGITS):
    if a != null: validate(a); if b != null: validate(b)
    require(a == null || b == null || a < b)
    if a == null && b == null: return INTEGER_ZERO             // "a0"
    if a == null:                                              // insert before everything
        ib = integerPartOf(b); fb = b.drop(ib.length)
        if ib == SMALLEST_INTEGER: return ib + midpoint("", fb, digits)
        if ib < b: return ib                                   // b had a fractional tail: use its integer
        return decrementInteger(ib, digits) ?: error("cannot decrement any more")
    if b == null:                                              // append after everything
        ia = integerPartOf(a); fa = a.drop(ia.length)
        return incrementInteger(ia, digits) ?: (ia + midpoint(fa, null, digits))
    ia = integerPartOf(a); fa = a.drop(ia.length)
    ib = integerPartOf(b); fb = b.drop(ib.length)
    if ia == ib: return ia + midpoint(fa, fb, digits)
    i = incrementInteger(ia, digits) ?: error("cannot increment any more")
    return if (i < b) i else ia + midpoint(fa, null, digits)
```

`generateNKeysBetween(a, b, n)` exists too and produces **shorter keys than n successive
`generateKeyBetween` calls** — use it when the server seeds a fresh board or when the app imports a list.

Worked intuition:
- First card in an empty column → `"a0"`.
- Append after `"a0"` → `incrementInteger("a0")` → `"a1"`.
- Insert between `"a0"` and `"a1"` → same integer part, `midpoint("", "")` on the fractional parts →
  `"a0V"` (V ≈ midpoint of the 62-digit alphabet).
- Insert between `"a0"` and `"a0V"` → `"a0F"`. Keys grow ~1 char per halving; a column would need ~2^k inserts at
  the same spot to reach length k. In practice they stay under ~10 chars forever.

#### 5.6.4 Kotlin API surface to implement

Put this in `core:ordering` with 100% unit-test coverage (it is the highest-risk pure function in the app):

```kotlin
object OrderKey {
    const val BASE_62: String = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
    const val INTEGER_ZERO = "a0"

    fun between(a: String?, b: String?, digits: String = BASE_62): String
    fun nBetween(a: String?, b: String?, n: Int, digits: String = BASE_62): List<String>
    fun validate(key: String, digits: String = BASE_62)
}
```

Property-based tests (use `kotest-property` or hand-rolled): for random sequences of inserts/moves, assert
(1) `a < between(a,b) < b` lexicographically for every generated key, (2) the resulting sort order matches the
intended index order, (3) key length stays below a sane bound (e.g. 32) for 10⁴ random operations.

#### 5.6.5 Jitter — required for concurrent inserts

Two devices offline, both inserting between the same neighbours, both compute the *same* key. Then ordering is
ambiguous and, worse, a `UNIQUE(scope, column, position)` constraint would reject one.

Fix: append 1–2 random base-62 characters as **jitter**:

```kotlin
fun betweenJittered(a: String?, b: String?, rng: Random = Random.Default): String {
    val base = OrderKey.between(a, b)
    val jitter = buildString(2) { repeat(2) { append(BASE_62[rng.nextInt(BASE_62.length)]) } }
    return base + jitter          // still strictly between a and b: appending never crosses b
}
```

Appending digits to a key keeps it `> base` and `< b` as long as `base < b` strictly and `base` is not a prefix
of `b`… which the algorithm guarantees except in the "consecutive digits" branch. **Safe formulation:** generate
`nBetween(a, b, 3)` and pick one of the three at random — that is collision-resistant *and* provably in range.
(Simpler and I'd ship that.)

**Never make `position` unique.** Always sort `ORDER BY position, id` so identical keys still have a total,
device-independent order.

#### 5.6.6 Move mutation shape

A drag from column `todo` to column `doing` between two cards is **one** mutation:

```json
{ "opId": "…", "entity": "task", "entityId": "018f…", "type": "move",
  "baseVersion": 4207,
  "fields": { "column": "doing", "position": "a1F7", "projectId": "p_123" } }
```

The client computes `position` **locally** from its own view of the neighbours. If the server's neighbours differ
(someone else moved things), the resulting absolute position may be slightly off but is never *invalid* — the card
lands somewhere sensible in the target column. That is the whole point of fractional indexing: **moves are
approximately commutative and never corrupt the list.**

Server may optionally re-derive `position` if it detects the two neighbour ids the client sent
(`afterId` / `beforeId`) no longer bracket that range. Recommended: send **both** the computed `position` *and*
`afterId`/`beforeId`, and let the server prefer the ids when they still exist. Best of both worlds.

**What Fem-ho should do (§5):** per-field LWW arbitrated by server `version` + `fieldVersions`; add/remove deltas
for assignee sets; deterministic UUIDv5 ids for recurrence spawns; fractional indexing base-62 in a
`core:ordering` module with property tests; send `position` **plus** `afterId`/`beforeId` on moves;
`ORDER BY position, id`, no unique constraint; no CRDT library.

---

## 6. The local mutation queue (outbox)

### 6.1 Schema

```kotlin
@Entity(
    tableName = "outbox",
    indices = [
        Index("entity_type", "entity_id"),
        Index("state", "next_attempt_at"),
        Index("created_at"),
    ],
)
data class OutboxEntity(
    @PrimaryKey val opId: String,                 // client UUID; the idempotency unit
    @ColumnInfo("entity_type") val entityType: String,   // "task" | "checklist" | "project" | ...
    @ColumnInfo("entity_id")   val entityId: String,     // client-generated UUIDv7 even for creates
    @ColumnInfo("op_type")     val opType: String,       // "create" | "update" | "delete" | "move"
    @ColumnInfo("base_version") val baseVersion: Long,   // entity.serverVersion when queued; 0 for create
    @ColumnInfo("payload_json") val payloadJson: String, // JsonObject of changed fields only
    @ColumnInfo("set_ops_json") val setOpsJson: String?, // add/remove deltas for set fields
    @ColumnInfo("created_at")  val createdAt: Long,      // device clock, ordering only
    @ColumnInfo("state")       val state: String,        // PENDING | IN_FLIGHT | FAILED | DEAD
    @ColumnInfo("attempts")    val attempts: Int = 0,
    @ColumnInfo("next_attempt_at") val nextAttemptAt: Long = 0,
    @ColumnInfo("last_error")  val lastError: String? = null,
    @ColumnInfo("last_error_code") val lastErrorCode: Int? = null,
    @ColumnInfo("batch_id")    val batchId: String? = null,  // set while IN_FLIGHT
)
```

Design decisions baked into this schema:

1. **Client-generated entity ids (UUIDv7).** A task created offline gets its final id immediately. No
   "temp id → real id" remapping, which is the single largest source of bugs in naive outbox designs (subtasks
   pointing at a temp parent, share links referencing a temp task, etc.). The server accepts client ids and
   rejects duplicates with `409`. UUIDv7 is time-sortable, which makes `ORDER BY id` a decent stable tiebreak.
2. **`opId` is the idempotency key.** A retried batch after a network timeout must not double-apply. The server
   stores seen `opId`s for, say, 7 days.
3. **`payloadJson` holds only changed fields.** Required for per-field LWW (§5.2) and for coalescing (§6.3).
4. **`state` + `nextAttemptAt`** give you a real scheduler, not just "try everything again".

### 6.2 Enqueue path — one transaction, always

```kotlin
@Singleton
class TaskRepositoryImpl @Inject constructor(
    private val db: FemhoDatabase,
    private val taskDao: TaskDao,
    private val outboxDao: OutboxDao,
    private val syncScheduler: SyncScheduler,
    private val clock: Clock,
) : TaskRepository {

    override suspend fun moveTask(
        taskId: String, toColumn: BoardColumn, afterId: String?, beforeId: String?,
    ) = db.withTransaction {
        val current = taskDao.getById(taskId) ?: return@withTransaction
        val after = afterId?.let { taskDao.getById(it)?.position }
        val before = beforeId?.let { taskDao.getById(it)?.position }
        val newPos = OrderKey.nBetween(after, before, 3).random()

        // 1. optimistic local write — the UI updates in this same frame
        taskDao.upsert(current.copy(column = toColumn.wire, position = newPos, localDirty = true))

        // 2. durable intent
        outboxDao.enqueue(
            OutboxEntity(
                opId = uuid4(),
                entityType = "task",
                entityId = taskId,
                opType = "move",
                baseVersion = current.serverVersion,
                payloadJson = json.encodeToString(
                    MovePayload(column = toColumn.wire, position = newPos,
                                afterId = afterId, beforeId = beforeId)
                ),
                setOpsJson = null,
                createdAt = clock.now().toEpochMilliseconds(),
                state = OutboxState.PENDING.name,
            )
        )
    }.also { syncScheduler.kickOutboxDrain() }   // outside the transaction
}
```

Rules:
- The local write and the outbox insert are in **one Room transaction**. If the process dies between them you
  either have both or neither. This is the entire reason the outbox lives in Room and not in DataStore or memory.
- `syncScheduler.kickOutboxDrain()` is called **after** the transaction commits (WorkManager's enqueue does its
  own DB write; nesting them can deadlock on some devices).
- The UI updated from step 1 via the `Flow` — nothing waits for the network.

### 6.3 Coalescing / dedup

Without coalescing, dragging a card across four columns produces four ops; renaming a task keystroke-by-keystroke
produces dozens. Coalesce on enqueue, inside the same transaction:

```kotlin
suspend fun OutboxDao.enqueue(op: OutboxEntity) {
    val mergeable = findPending(op.entityType, op.entityId)
        .filter { it.state == OutboxState.PENDING.name }     // never touch IN_FLIGHT

    when {
        // delete supersedes everything pending for that entity
        op.opType == "delete" -> {
            deleteAll(mergeable.map { it.opId })
            // a create that never left the device + a delete = nothing to send at all
            if (mergeable.any { it.opType == "create" }) return
            insert(op)
        }
        // update/move merges into an existing pending create or update
        op.opType in setOf("update", "move") -> {
            val target = mergeable.lastOrNull { it.opType in setOf("create", "update", "move") }
            if (target == null) insert(op) else {
                deleteAll(mergeable.map { it.opId } - target.opId)
                update(
                    target.copy(
                        // keep "create" if it was a create; otherwise it becomes a generic update
                        opType = if (target.opType == "create") "create" else "update",
                        payloadJson = mergeJson(target.payloadJson, op.payloadJson),   // right wins per key
                        setOpsJson = mergeSetOps(target.setOpsJson, op.setOpsJson),
                        createdAt = op.createdAt,
                        // baseVersion stays the ORIGINAL one — that's what the server compares against
                    )
                )
            }
        }
        else -> insert(op)
    }
}
```

Critical subtleties:
- **Never coalesce into an `IN_FLIGHT` op.** You'd mutate a payload that is already on the wire. Only `PENDING`
  rows merge.
- **Keep the *oldest* `baseVersion`.** It represents "the version this user was looking at when they started
  editing", which is what per-field LWW must compare against. Taking the newest would make you win conflicts you
  should lose.
- **`mergeJson` is a shallow per-key overwrite** (right operand wins), which is exactly right for scalar fields.
- **Set ops merge as delta composition**: `add ∪ add`, `remove ∪ remove`, and an element appearing in the later
  op's `remove` cancels it from the earlier `add`.
- **Text fields:** debounce in the ViewModel (e.g. 500 ms `debounce()` on the title `TextFieldState` flow) so the
  outbox sees one op per pause, not per keystroke. Coalescing then handles the rest.

### 6.4 Drain algorithm

```kotlin
suspend fun drainOutbox(): DrainOutcome {
    while (true) {
        val batch = outboxDao.claimBatch(limit = 50, now = clock.nowMillis())   // PENDING & nextAttemptAt<=now
        if (batch.isEmpty()) return DrainOutcome.Empty

        val batchId = uuid4()
        outboxDao.markInFlight(batch.map { it.opId }, batchId)

        val response = try {
            api.postMutations(idempotencyKey = batchId, mutations = batch.map { it.toWire() })
        } catch (e: IOException) {
            outboxDao.releaseWithBackoff(batch.map { it.opId }, e.message)
            return DrainOutcome.Retryable
        } catch (e: ClientRequestException) {
            if (e.response.status == HttpStatusCode.Unauthorized) return DrainOutcome.AuthFailed
            outboxDao.releaseWithBackoff(batch.map { it.opId }, e.message)
            return DrainOutcome.Retryable
        }

        db.withTransaction { response.results.forEach { applyMutationResult(it) } }
        response.nextToken?.let { syncStateDao.advanceCursorAtLeast(it) }
    }
}
```

Ordering guarantees:
- **Drain strictly before pulling.** Otherwise a pull overwrites the local optimistic state with the pre-mutation
  server state and the UI visibly flickers backwards. Order per sync cycle: **drain outbox → pull changes →
  hydrate → apply**.
- **Preserve `createdAt` order within an entity.** `claimBatch` must `ORDER BY created_at, rowid` so a create is
  never sent after the update that depends on it. Across entities, order barely matters — except
  *parent-before-child*: sort so that `create` ops for a task precede `create` ops for its subtasks/checklist
  items. Simplest robust rule: `ORDER BY created_at, rowid` globally, since children are always created after
  parents in wall-clock terms.

### 6.5 Retry, backoff, and permanent failure

```kotlin
fun backoffMillis(attempts: Int): Long =
    (30_000L shl minOf(attempts, 6))                 // 30s,1m,2m,4m,8m,16m,32m
        .coerceAtMost(TimeUnit.HOURS.toMillis(6))
        .let { it + Random.nextLong(0, it / 4) }     // jitter, avoids family-wide thundering herd
```

Classification table — this is the part naive implementations get wrong:

| HTTP / condition | Meaning | Outbox action | User-visible? |
|---|---|---|---|
| `IOException`, timeout, DNS | offline / server down | `PENDING`, backoff, keep retrying forever | badge "pendent de sincronitzar" |
| `401` | token expired/revoked | pause **all** draining, attempt refresh; if refresh fails → re-login screen | yes, blocking |
| `403` | lost permission on that scope | `DEAD` | yes, per-item |
| `404` | entity gone server-side | for `update`/`move`: drop op + delete local row. For `create`: retry (may be a route error) | no |
| `409 Conflict` | version/uniqueness conflict | server echoed the winning entity → overwrite local, drop op, log conflict | soft toast |
| `422 Unprocessable` | payload invalid (bad scope id, title too long, malformed RRULE) | `DEAD` immediately — **never retry**, it will never succeed | yes, per-item with the reason |
| `429` | rate limited | honour `Retry-After` header; `PENDING` with that delay | no |
| `5xx` | server bug/restart | `PENDING`, backoff | badge only |
| `attempts > 12` on a retryable error | probably poisoned | `DEAD` | yes, per-item |

`DEAD` handling — this is a product decision, make it explicitly:

- The row stays in the outbox with `state = DEAD` and a human-readable `lastError`.
- The local entity keeps `localDirty = true` and is rendered with an **error** affordance (red dot + tap for
  detail), not a pending affordance.
- A "Canvis no sincronitzats" screen (Settings → Sincronització) lists all `DEAD` ops with three actions:
  **Reintentar** (reset to `PENDING`, attempts=0), **Descartar el canvi** (delete op; next pull restores the
  server value), **Copiar detalls** (for bug reports — invaluable for a self-hosted app where the user is also
  the sysadmin).
- Never silently drop a `DEAD` op. In a family task manager, silently losing "buy the birthday present" is a
  product failure.

### 6.6 Surfacing sync state in the UI

Three distinct signals, do not conflate them:

```kotlin
enum class ItemSyncState { SYNCED, PENDING, ERROR }

data class GlobalSyncState(
    val isSyncing: Boolean,
    val pendingCount: Int,
    val deadCount: Int,
    val lastSuccessfulSyncAt: Instant?,
    val connectivity: Connectivity,     // ONLINE | OFFLINE | SERVER_UNREACHABLE
)
```

- **Per-item**: derived from `TaskEntity.localDirty` + whether any `DEAD` op exists for that id.
  Render as a small pill on the card, in Plou's muted accent for `PENDING` and error accent for `ERROR`.
  Do **not** use a spinner per card — it's visual noise on a 4-column board.
- **Global**: a thin bar under the top bar, or a state on the profile button. Shown only when
  `pendingCount > 0 || deadCount > 0 || connectivity != ONLINE`. Copy in Catalan:
  - `Sense connexió · 3 canvis pendents`
  - `Sincronitzant…`
  - `3 canvis no s'han pogut desar` (tappable → the failures screen)
- **`lastSuccessfulSyncAt`** in Settings. For a self-hosted app this is the #1 diagnostic the user needs
  ("is my server actually up?").

```kotlin
val globalSyncState: StateFlow<GlobalSyncState> = combine(
    workManager.getWorkInfosForUniqueWorkFlow(SYNC_ONE_SHOT),
    outboxDao.observeCounts(),                 // Flow<OutboxCounts>
    syncStateDao.observeLastSuccess(),
    connectivityMonitor.state,
) { workInfos, counts, lastSuccess, connectivity ->
    GlobalSyncState(
        isSyncing = workInfos.any { it.state == WorkInfo.State.RUNNING },
        pendingCount = counts.pending,
        deadCount = counts.dead,
        lastSuccessfulSyncAt = lastSuccess,
        connectivity = connectivity,
    )
}.stateIn(scope, SharingStarted.WhileSubscribed(5_000), GlobalSyncState.Initial)
```

`ConnectivityMonitor` wraps `ConnectivityManager.registerDefaultNetworkCallback` and exposes a `callbackFlow`.
Distinguish `OFFLINE` (no network) from `SERVER_UNREACHABLE` (network up, but the last N requests to the paired
server failed) — for a self-hosted app these are completely different user problems ("turn on wifi" vs
"your NAS is down / you're outside the VPN").

**What Fem-ho should do (§6):** Room-backed outbox with client UUIDv7 entity ids (no temp-id remapping); local
write + outbox insert in one transaction; coalesce PENDING ops per entity keeping the oldest `baseVersion`;
drain-before-pull; classify `422`/`403` as permanently DEAD and expose a "Canvis no sincronitzats" screen with
retry/discard; three-level sync state in the UI with Catalan copy; distinguish offline from server-unreachable.

---

## 7. Auth and server pairing on device

### 7.1 What must be stored

| Item | Sensitivity | Store |
|---|---|---|
| Server base URL | low (but privacy-relevant) | DataStore Preferences (plain) |
| Server display name, icon | low | DataStore / Room |
| Pinned server cert SHA-256 (if self-signed) | integrity-critical, not secret | DataStore (plain is fine — it's a public key hash) |
| Access token (short-lived JWT) | **high** | encrypted DataStore |
| Refresh token (long-lived) | **highest** | encrypted DataStore |
| User id, email, display name | medium | Room (per-account DB) |
| API keys shown to the user (for MCP/CalDAV) | high | **never cache** — fetch on demand, show once |

### 7.2 `androidx.security:security-crypto` is deprecated — what to use instead

**Fact (verified, security release notes):** `androidx.security:security-crypto` `1.1.0` (2025-07-30) is the
latest release, and **all APIs in the library were deprecated in `1.1.0-beta01` (2025-06-04)** "in favour of
existing platform APIs and direct use of Android Keystore". This covers `EncryptedSharedPreferences`,
`EncryptedFile`, `MasterKey`, `MasterKeys`, and the `-ktx` variant.

**So: do not use `EncryptedSharedPreferences` in new code in 2026.** Two supported replacements:

**Option A — `androidx.datastore:datastore-tink` (`1.3.0-alpha07`).** Official, uses Tink AEAD with a keyset
wrapped by an Android Keystore master key:

```kotlin
val keysetHandle = AndroidKeysetManager.Builder()
    .withSharedPref(appContext, "femho_keyset", "femho_keyset_prefs")
    .withKeyTemplate(KeyTemplate.createFrom(PredefinedAeadParameters.AES256_GCM))
    .withMasterKeyUri("android-keystore://femho_master_key")
    .build()
    .keysetHandle

val aeadSerializer = AeadSerializer(
    aead = keysetHandle.getPrimitive(RegistryConfiguration.get(), Aead::class.java),
    wrappedSerializer = CredentialsSerializer,      // your kotlinx.serialization-backed Serializer
    associatedData = "femho_credentials.pb".encodeToByteArray(),
)

private val Context.credentialsStore by dataStore(
    fileName = "femho_credentials.pb",
    serializer = aeadSerializer,
)
```

Downside: it's **alpha** and pulls in Tink. Acceptable for a v1 if you're comfortable with an alpha dependency
in the credentials path; pin the exact version.

**Option B — hand-rolled Keystore AES/GCM + plain DataStore (recommended for v1).** ~60 lines, zero new
dependencies, no alpha:

```kotlin
private const val KEY_ALIAS = "femho_credentials_key"
private const val TRANSFORM = "AES/GCM/NoPadding"
private const val GCM_TAG_BITS = 128

class KeystoreCipher @Inject constructor() {
    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                // Do NOT set setUserAuthenticationRequired(true) unless you accept that
                // background sync cannot decrypt the token while the device is locked.
                .setRandomizedEncryptionRequired(true)
                .build()
        )
        return gen.generateKey()
    }

    fun encrypt(plain: ByteArray): ByteArray {
        val c = Cipher.getInstance(TRANSFORM).apply { init(Cipher.ENCRYPT_MODE, key()) }
        val iv = c.iv                                        // 12 bytes for GCM
        return byteArrayOf(iv.size.toByte()) + iv + c.doFinal(plain)
    }

    fun decrypt(blob: ByteArray): ByteArray {
        val ivLen = blob[0].toInt()
        val iv = blob.copyOfRange(1, 1 + ivLen)
        val c = Cipher.getInstance(TRANSFORM).apply {
            init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(GCM_TAG_BITS, iv))
        }
        return c.doFinal(blob, 1 + ivLen, blob.size - 1 - ivLen)
    }
}
```

Store the Base64 of the blob in a Preferences DataStore key. Handle `KeyPermanentlyInvalidatedException` /
`UnrecoverableKeyException` (happens when the user adds/removes a screen lock, or after some restores) by
**wiping credentials and routing to the login screen** — never crash.

**Also do:** `android:allowBackup="false"` and `android:dataExtractionRules` excluding the credentials store and
the database. A Keystore-encrypted blob restored to a different device is undecryptable garbage that will look
like corruption.

### 7.3 Token model

Recommended server contract:

```
POST /api/v1/auth/login       { "email": "...", "password": "...", "deviceName": "Pixel 9 de Borja" }
  → { "accessToken": "...", "expiresIn": 900,
      "refreshToken": "...", "refreshExpiresIn": 5184000,
      "user": {...}, "server": { "name": "Casa", "version": "1.4.2", "capabilities": [...] } }

POST /api/v1/auth/refresh     { "refreshToken": "..." }   → new pair (rotate the refresh token)
POST /api/v1/auth/logout      { "refreshToken": "..." }   → 204, revokes the device session
GET  /api/v1/auth/sessions                                → list of devices, for revocation in the web UI
```

- **Access token short (15 min), refresh long (60 days), rotating.** Rotation means a stolen refresh token is
  detectable (reuse of a rotated token ⇒ revoke the whole family).
- **Token scoping.** Fem-ho already separates human vs AI tokens. The Android client uses a **human, full-scope
  device session**; it must never be issued an AI-scoped key. Make the scope visible in
  `GET /auth/sessions` so the user can audit.
- Ktor's `Auth`/`bearer` plugin drives `refreshTokens { }` automatically on `401`; make sure the refresh call
  itself is excluded from the plugin (use a separate bare `HttpClient` or `markAsRefreshTokenRequest()`), or you
  get infinite recursion.
- **Concurrency:** wrap refresh in a `Mutex` so ten parallel 401s trigger one refresh, not ten.

### 7.4 Login-with-server-URL UX

This is the screen that makes or breaks a self-hosted app. Concrete spec:

**Fields:** `Servidor` (URL), `Correu`, `Contrasenya`. Plus an "Avançat" expander.

**URL normalisation ladder.** Given raw input, try candidates in order and use the first that answers a valid
`GET {candidate}/api/v1/server-info`:

```kotlin
fun candidateUrls(raw: String): List<String> {
    val t = raw.trim().removeSuffix("/")
    val hasScheme = t.startsWith("http://") || t.startsWith("https://")
    val bare = t.removePrefix("https://").removePrefix("http://")
    val isPrivate = bare.substringBefore(':').let {
        it == "localhost" || it.endsWith(".local") || it.endsWith(".lan") ||
        it.matches(Regex("""^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.).*"""))
    }
    return buildList {
        if (hasScheme) { add(t); return@buildList }
        add("https://$bare")
        add("https://$bare/femho")            // common reverse-proxy subpath
        if (isPrivate) add("http://$bare")    // only offer cleartext for private ranges
    }
}
```

**`GET /api/v1/server-info`** should be **unauthenticated** and return:

```json
{ "product": "femho", "apiVersion": 1, "serverVersion": "1.4.2",
  "name": "Casa Balsera", "authMethods": ["password"],
  "minClientVersion": 12, "features": ["caldav","mcp","share-links"] }
```

The client uses this to (a) confirm it's talking to a Fem-ho server and not a random 200-returning page,
(b) show the server's friendly name for confirmation, (c) refuse gracefully if `minClientVersion` exceeds the
installed build ("Actualitza l'aplicació per connectar amb aquest servidor").

**HTTP vs HTTPS.** Rules:
- Default to HTTPS. Never silently downgrade.
- If HTTPS fails and the host is a private-range/`.local`/`localhost` address, offer HTTP behind an **explicit
  checkbox** in "Avançat": `Permet connexió sense xifrar (només xarxa local)` with a red warning. Record the
  choice **per server**, never globally.
- Enabling cleartext requires `cleartextTrafficPermitted="true"` — see §7.6 for how to scope that without
  opening cleartext to the whole internet.

**Untrusted-certificate flow.** On `SSLHandshakeException` / `CertificateException`, do **not** show a generic
error. Show a **cert-review sheet**:

```
No es pot verificar el certificat del servidor
  Servidor      femho.casa.local
  Emès per      Casa Balsera Root CA
  Vàlid fins    2027-03-11
  Empremta SHA-256
     3A:7F:2C:...:9E

[ Cancel·la ]   [ Confia en aquest certificat ]
```

On accept, store the SHA-256 of the leaf certificate's DER encoding (and optionally the whole DER) against that
server id, and use it as a **pin** from then on (§7.5). This is TOFU — Trust On First Use — and it is the correct
model for a homelab. It is materially *stronger* than public-CA trust for this scenario, because after pairing
only that exact key is accepted.

**Discovery (optional, nice).** Two cheap wins:
1. **QR pairing.** The web UI shows a QR containing
   `femho://pair?url=https%3A%2F%2Ffemho.casa.local&fp=3A7F2C…&name=Casa`. Scanning it pre-fills the URL *and*
   the expected fingerprint, so the TOFU step becomes a *verified* first use. Implement with CameraX +
   `com.google.mlkit:barcode-scanning` — but note ML Kit's bundled model adds ~3 MB and the unbundled one needs
   Play Services. For a Google-free build use **ZXing** (`com.journeydev:zxing-android-embedded`
   — **UNVERIFIED coordinate**; the widely used one is `com.journeyapps:zxing-android-embedded`).
2. **mDNS/NSD.** `NsdManager.discoverServices("_femho._tcp", PROTOCOL_DNS_SD, listener)` to list servers on the
   LAN. Cheap to add, delightful when it works, must never be the only path.

### 7.5 Runtime certificate trust — implementation

Because the server host is unknown at build time, `network_security_config.xml` cannot express "trust this one
cert for this one host". You need a **runtime `X509TrustManager`** on the OkHttp engine.

```kotlin
class ServerTrustStore @Inject constructor(private val prefs: ServerPrefs) {

    /** Returns null when the platform trust store suffices (Let's Encrypt etc.). */
    suspend fun sslConfigFor(server: ServerConfig): Pair<SSLSocketFactory, X509TrustManager>? {
        val pinnedDer = prefs.pinnedCertDer(server.id) ?: return null
        val cert = CertificateFactory.getInstance("X.509")
            .generateCertificate(pinnedDer.inputStream()) as X509Certificate

        val ks = KeyStore.getInstance(KeyStore.getDefaultType()).apply {
            load(null, null)
            setCertificateEntry("femho-${server.id}", cert)
        }
        val tmf = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm())
            .apply { init(ks) }
        val tm = tmf.trustManagers.filterIsInstance<X509TrustManager>().first()

        // Compose: platform CAs OR the pinned cert. Lets a homelab move to Let's Encrypt
        // later without forcing a re-pair.
        val composite = CompositeX509TrustManager(listOf(platformTrustManager(), tm))
        val ctx = SSLContext.getInstance("TLS").apply {
            init(null, arrayOf<TrustManager>(composite), SecureRandom())
        }
        return ctx.socketFactory to composite
    }
}
```

`CompositeX509TrustManager.checkServerTrusted` tries each delegate and succeeds if any accepts; it must
concatenate `getAcceptedIssuers()`.

**Hostname verification.** A self-signed cert for `femho.casa.local` still needs a matching SAN. If the user's
cert has no SAN (common for hand-rolled certs), `OkHostnameVerifier` rejects it. Two options:
- **Preferred:** tell the user to regenerate with a SAN (document the `openssl` one-liner in the app's help and
  in the server's Docker docs — this is a self-hosted product, documentation *is* the feature).
- **Escape hatch:** when the pinned cert is an *exact* match by SHA-256, hostname verification adds nothing —
  the pin is strictly stronger. So permit `hostnameVerifier { hostname, session ->
    session.peerCertificates.firstOrNull()?.sha256() == pinnedSha256 }` **only** on pinned servers.

**Never ship a trust-all `X509TrustManager`.** It is the single most common self-hosted-app vulnerability, it
will be flagged by Play's pre-launch report, and it silently disables all MITM protection including on the
public internet. If you feel tempted, that's the signal to implement the pin flow properly.

**`CertificatePinner` caveat (verified):** OkHttp's `CertificatePinner` **cannot** pin a self-signed certificate
that the `TrustManager` does not already accept — pinning runs *after* trust validation. So the pin must live in
the `TrustManager`, as above; `CertificatePinner` is only useful for CA-issued certs.

### 7.6 `network_security_config.xml` for Fem-ho

Full reference of the elements (fetched): `<network-security-config>` → `<base-config>`, `<domain-config>`,
`<debug-overrides>`; `<domain includeSubdomains>`, `<trust-anchors>` → `<certificates src="system|user|@raw/x"
overridePins>`, `<pin-set expiration="yyyy-MM-dd">` → `<pin digest="SHA-256">base64(SPKI)</pin>`,
`<certificateTransparency enabled>`, `<domainEncryption mode>`. Manifest:
`<application android:networkSecurityConfig="@xml/network_security_config">`.

Fem-ho's file:

```xml
<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <!-- Default: HTTPS only, system CAs only. -->
    <base-config cleartextTrafficPermitted="false">
        <trust-anchors>
            <certificates src="system" />
        </trust-anchors>
    </base-config>

    <!-- Private ranges: allow cleartext so the "advanced" opt-in can work at all.
         The app still refuses HTTP unless the user explicitly enabled it per server. -->
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="false">localhost</domain>
        <domain includeSubdomains="true">local</domain>
        <domain includeSubdomains="true">lan</domain>
        <domain includeSubdomains="true">home.arpa</domain>
    </domain-config>

    <!-- Debug builds only: trust user-installed CAs so mitmproxy/Charles work. -->
    <debug-overrides>
        <trust-anchors>
            <certificates src="system" />
            <certificates src="user" />
        </trust-anchors>
    </debug-overrides>
</network-security-config>
```

Notes:
- You cannot enumerate RFC1918 *IP* addresses in `<domain>` — it matches hostnames. For raw private IPs you
  either need `cleartextTrafficPermitted="true"` in `base-config` (too broad) or you require the user to use a
  hostname. **Pragmatic answer:** ship two build variants of this file — the default strict one, and accept that
  bare-IP HTTP requires the user to use `http://192.168.1.10.nip.io`-style hostnames, **or** set
  `base-config cleartextTrafficPermitted="true"` and enforce the HTTPS-only policy *in application code*
  (the URL ladder in §7.4 already does). I'd take the latter: the platform config is a blunt instrument, and
  your own code has the per-server context the platform lacks. **Document the choice in the repo.**
- `src="user"` **only** inside `<debug-overrides>`. Trusting user CAs in release builds re-opens the corporate/
  malware MITM surface that Android 7 deliberately closed.
- Do not put `<pin-set>` in this file — Fem-ho's pins are runtime, per-server (§7.5).

**What Fem-ho should do (§7):** never use `EncryptedSharedPreferences`; use Keystore AES-GCM + DataStore (or
`datastore-tink` if you accept alpha); `allowBackup=false`; short access token + rotating refresh with a Mutex;
`GET /api/v1/server-info` for validation; URL candidate ladder with HTTPS-first and private-range-only HTTP
opt-in; TOFU cert pinning with a fingerprint review sheet and QR pairing to make first use *verified*; runtime
composite `X509TrustManager` (never trust-all); user CAs only in `debug-overrides`.

---

## 8. Push / learning about remote changes

### 8.1 The four mechanisms, compared

| Mechanism | Latency | Works without Google | Battery | Server complexity | Verdict for Fem-ho |
|---|---|---|---|---|---|
| **FCM** | seconds | ❌ requires Play Services + a Google project + your self-hosted server talking to Google | best (shared socket) | low | **Optional Play-flavour only** |
| **UnifiedPush** (ntfy/NextPush/Sunup) | seconds | ✅ | good (one shared socket per distributor, across all apps) | low (an HTTP POST) | **Primary** |
| **WebSocket while foreground** | instant | ✅ | fine (app is open anyway) | medium | **Yes, complementary** |
| **Periodic WorkManager** | ≥15 min (use 1 h) | ✅ | acceptable | none | **Yes, as the floor** |
| Long-lived foreground-service socket | instant | ✅ | bad; persistent notification; Android 16 quota pressure | medium | **No** |

**The answer for a self-hosted, must-not-depend-on-Google app is a layered one:**
`UnifiedPush (if a distributor is installed) → WebSocket (while the app is foregrounded) →
periodic WorkManager (always, as a floor) → manual pull-to-refresh (always available)`.

This degrades gracefully: a user with ntfy installed gets seconds; a user without gets ≤1 hour plus instant
updates whenever the app is open. Crucially, **no configuration is mandatory** — the app works out of the box
and gets better if you opt in.

### 8.2 UnifiedPush — concrete integration

**Spec version: AND_3.1.0** (fetched from unifiedpush.org/developers/spec/android/).

Intent actions the **distributor** listens for:
- `org.unifiedpush.android.distributor.REGISTER`
- `org.unifiedpush.android.distributor.UNREGISTER`
- `org.unifiedpush.android.distributor.MESSAGE_ACK`

Intent actions **your app's** receiver must handle:
- `org.unifiedpush.android.connector.NEW_ENDPOINT`
- `org.unifiedpush.android.connector.REGISTRATION_FAILED`
- `org.unifiedpush.android.connector.MESSAGE`
- `org.unifiedpush.android.connector.UNREGISTERED`
- `org.unifiedpush.android.connector.TEMP_UNAVAILABLE`

Plus a service action `org.unifiedpush.android.connector.RAISE_TO_FOREGROUND`.

Extras (name / type / required):

| Action | Extra | Type | Required |
|---|---|---|---|
| `REGISTER` | `token` | String, ≤100 bytes | yes |
| `REGISTER` | `vapid` | String, 87 bytes | optional |
| `REGISTER` | `message` | String, ≤100 bytes | optional (shown to user) |
| `REGISTER` | `pi` / `FLAG_SHARE_IDENTITY` | PendingIntent / flag | yes (SDK-dependent) |
| `NEW_ENDPOINT` | `token`, `endpoint` | String | yes |
| `NEW_ENDPOINT` | `id` | String, ≤100 bytes | optional |
| `MESSAGE` | `token`, `bytesMessage` | String, ByteArray | yes |
| `MESSAGE` | `id` | String | optional |
| `REGISTRATION_FAILED` | `token`, `reason` | String | yes / optional |

Registration flow (spec order):
1. App resolves the deep link `unifiedpush://link` to let the user pick a distributor.
2. The distributor's link Activity returns `RESULT_OK` with a `PendingIntent`.
3. App broadcasts `REGISTER` with a **UUIDv4 `token`** (unique per app instance/account).
4. Distributor replies `NEW_ENDPOINT` carrying the push **endpoint URL**.
5. App acknowledges with `MESSAGE_ACK` (`token` + `id`).
6. App sends the endpoint to **your** Fem-ho server.

Message delivery:
1. Fem-ho server POSTs an encrypted payload to the endpoint URL.
2. Distributor receives it from the push server, broadcasts `MESSAGE` with `bytesMessage`.
3. App acknowledges with `MESSAGE_ACK`.
4. Distributor raises the app to foreground for 5 seconds (so you can do work).

Crypto and limits (verified):
- **VAPID**: P-256, uncompressed point, base64url — an **87-byte** string.
- **Encryption: RFC 8291** (Message Encryption for Web Push). Payload size **1–4096 bytes**, cleartext max
  **~3993 bytes**.
- If the distributor requires VAPID and the app omitted it, it replies `REGISTRATION_FAILED` with
  `reason="VAPID_REQUIRED"`.

**Fem-ho server must therefore implement RFC 8291 Web Push encryption + RFC 8292 VAPID.** That is a solved
problem in every backend language (`pywebpush`, `web-push` for Node, `webpush-java`). Flag it to the backend
dossier — the Android side cannot work around a server that sends cleartext.

Connector library: the official Android connector lives at `codeberg.org/UnifiedPush/android-connector`
(GitHub mirror `UnifiedPush/android-connector`). Its **Maven coordinates and current version could not be
fetched** — **UNVERIFIED**; historically `org.unifiedpush.android:connector:<version>`. Resolve before coding.

Sketch of the app side:

```kotlin
class FemhoPushReceiver : MessagingReceiver() {

    override fun onNewEndpoint(context: Context, endpoint: PushEndpoint, instance: String) {
        // instance == our token; register the endpoint with the Fem-ho server
        PushRegistrationWorker.enqueue(context, endpoint.url, endpoint.pubKeySet)
    }

    override fun onMessage(context: Context, message: PushMessage, instance: String) {
        // message.content is already decrypted by the connector (RFC 8291)
        // Treat it as a HINT ONLY. Never trust its contents as data.
        SyncScheduler.kickSync(context, reason = "unifiedpush")
    }

    override fun onRegistrationFailed(context: Context, reason: FailedReason, instance: String) {
        PushStateStore.markFailed(reason)          // surface in Settings, fall back to polling
    }

    override fun onUnregistered(context: Context, instance: String) {
        PushStateStore.clear(); SyncScheduler.ensurePeriodic(context)
    }
}
```

Manifest:

```xml
<receiver
    android:name=".push.FemhoPushReceiver"
    android:exported="true">
    <intent-filter>
        <action android:name="org.unifiedpush.android.connector.MESSAGE" />
        <action android:name="org.unifiedpush.android.connector.NEW_ENDPOINT" />
        <action android:name="org.unifiedpush.android.connector.REGISTRATION_FAILED" />
        <action android:name="org.unifiedpush.android.connector.UNREGISTERED" />
        <action android:name="org.unifiedpush.android.connector.TEMP_UNAVAILABLE" />
    </intent-filter>
</receiver>
```

**Design rule: the push payload is a wake-up hint, never data.** Send `{"t":"sync","scopes":["s_familia"]}` at
most. Reasons: the 4 KB limit, the fact that push ordering is not guaranteed, and the security property that a
compromised push server learns nothing about the family's tasks. Everything real comes from the authenticated
`GET /sync/changes` that the hint triggers.

### 8.3 ntfy as the reference distributor/push server

ntfy is the distributor most Fem-ho users will pick, and it self-hosts in the same Docker compose.

Verified configuration facts:
- **`base-url`** — the ntfy server's external URL.
- **`upstream-base-url: "https://ntfy.sh"`** — a *private* ntfy instance forwards poll requests upstream so that
  devices can be woken via ntfy.sh's Firebase/APNS connectivity. Note the privacy trade-off: with upstream
  enabled, ntfy.sh learns that *a* message arrived for an opaque topic (not its content). Document this;
  a purist homelab omits it and relies on ntfy's own foreground service instead.
- UnifiedPush topics use the **`up*` prefix** (e.g. `up123456789012`).
- On a locked-down instance (`auth-default-access: "deny-all"`), grant anonymous publish to UnifiedPush topics:
  ```
  ntfy access '*' 'up*' write-only
  ```
- Publish API: `POST /<topic>` with the body as the message; headers `X-Title`, `X-Priority` (1–5), `X-Tags`.
- **`visitor-subscriber-rate-limiting: true`** applies the *first subscriber's* limits instead of the
  publisher's — important when one Fem-ho server publishes for a whole family, or you will exhaust the
  publisher quota.

Put a ready-made `docker-compose.yml` fragment for ntfy in Fem-ho's own deployment docs. For a self-hosted
product, "here is the compose file that makes push work" is worth more than any amount of in-app polish.

### 8.4 WebSocket while foregrounded

```kotlin
class LiveSyncController @Inject constructor(
    private val clientProvider: HttpClientProvider,
    private val syncEngine: SyncEngine,
) {
    fun connectWhileActive(scope: CoroutineScope, lifecycle: Lifecycle) = scope.launch {
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            var backoff = 1_000L
            while (isActive) {
                try {
                    clientProvider.current().webSocket(
                        path = "/api/v1/sync/live",
                        request = { header(HttpHeaders.Authorization, "Bearer ${tokens.access()}") },
                    ) {
                        backoff = 1_000L
                        for (frame in incoming) {
                            if (frame is Frame.Text) syncEngine.syncOnce()   // hint only, again
                        }
                    }
                } catch (e: CancellationException) { throw e }
                catch (e: Exception) {
                    delay(backoff); backoff = (backoff * 2).coerceAtMost(60_000L)
                }
            }
        }
    }
}
```

`repeatOnLifecycle(STARTED)` guarantees the socket is torn down when the app is backgrounded — no foreground
service, no persistent notification, no Android 16 quota exposure. Ping interval 20 s (set on the Ktor
`WebSockets` plugin) keeps NAT mappings alive on home routers.

### 8.5 FCM — how to keep it optional and isolated

If you ship a Play flavour, put **all** FCM code in `src/gplay/` and the UnifiedPush code in `src/foss/`, behind
a common interface:

```kotlin
interface PushProvider {
    val id: String                       // "unifiedpush" | "fcm" | "none"
    suspend fun register(): PushEndpointInfo?
    suspend fun unregister()
    val state: Flow<PushState>
}
```

`productFlavors { foss { dimension = "distribution" }; gplay { dimension = "distribution" } }`.
The `foss` flavour must have **zero** `com.google.*` dependencies — F-Droid's build will otherwise flag
anti-features (`NonFreeDep`, `NonFreeNet`). Verify with
`./gradlew :app:dependencies --configuration fossReleaseRuntimeClasspath | grep -i google`.

### 8.6 Notifications themselves

- Permission: **`android.permission.POST_NOTIFICATIONS`**, runtime, Android 13 (API 33)+.
  Declared in the manifest; requested with `ActivityResultContracts.RequestPermission()`.
  On upgrade from ≤API 32, apps with an existing channel and un-disabled notifications are **auto-granted**;
  new installs default to *off*.
- **Ask in context, not at launch.** For Fem-ho: after the user first assigns a task to someone else, or first
  sets a due date/reminder. Show a short Catalan rationale sheet first
  (`Vols que t'avisem quan et assignin una tasca?`), then the system dialog. A swipe-away leaves state
  unchanged (no prompt again until you re-request); a "Don't allow" is sticky.
- Check `NotificationManagerCompat.from(context).areNotificationsEnabled()` before posting, and surface a
  "notificacions desactivades" row in Settings that deep-links to
  `Settings.ACTION_APP_NOTIFICATION_SETTINGS`.
- **Channels** (create at first launch, API 26+): `femho_assignments` (assignat a tu),
  `femho_due` (venciments/recordatoris), `femho_shared` (canvis en àmbits compartits),
  `femho_sync_errors` (low importance). Per-channel control is what stops users nuking all notifications.
- Reminders for due dates must fire **offline**. Do not depend on a server push for them: schedule locally with
  `AlarmManager.setExactAndAllowWhileIdle` (needs `SCHEDULE_EXACT_ALARM`/`USE_EXACT_ALARM` — prefer
  `setAndAllowWhileIdle` and avoid the permission unless the product truly needs to-the-minute alarms) or with
  a `OneTimeWorkRequest` + `setInitialDelay` for tolerant reminders. Re-schedule on `BOOT_COMPLETED` and after
  every sync that changes a due date.

**What Fem-ho should do (§8):** layered push — UnifiedPush primary (spec AND_3.1.0, RFC 8291 payloads, hint-only
content), WebSocket while foregrounded via `repeatOnLifecycle(STARTED)`, 1-hour periodic WorkManager floor,
manual refresh always; FCM confined to a `gplay` flavour behind a `PushProvider` interface; ship an ntfy compose
snippet in the server docs; four notification channels; in-context `POST_NOTIFICATIONS` request; local
offline-capable reminder scheduling.

---

## 9. Platform surfaces: widgets, quick-add, shortcuts

### 9.1 Glance widgets

Versions (verified): `androidx.glance:glance-appwidget` — stable **1.1.1** (2024-10-16), **1.2.0-rc01**
(2025-12-03), **1.3.0-alpha02** (2026-07-01). Companion artifacts `androidx.glance:glance-material3`
(M3 theming) and `androidx.glance:glance` (core).

Recommendation: **ship on 1.2.0-rc01** if it has gone stable by implementation time (check the release page),
otherwise 1.1.1. 1.2.0 brings `providePreview()` / `GlanceAppWidgetManager.setWidgetPreview()`, which gives a
real widget preview in the picker instead of a placeholder — a visible quality win.

Available API surface (from the release page): `Box`/`Row`/`Column`/`LazyColumn`/`LazyVerticalGrid`,
`Text`/`Image`/`Button`/`Spacer`, `Checkbox`/`RadioButton`/`Switch`,
`LinearProgressIndicator`/`CircularProgressIndicator`; actions
`actionStartActivity()`, `actionRunCallback()` (with lambda support), `actionStartService()`,
`actionSendBroadcast()`, `actionStartBroadcastReceiver()`; state via `updateAppWidgetState()` /
`currentState<Preferences>()`; theming via `GlanceTheme`, `GlanceTheme.colors`, `ColorProvider`,
`DayNightColorProvider`; sizing via `SizeMode.Single` / `SizeMode.Exact` / `SizeMode.Responsive`;
`MultiProcessGlanceAppWidget` for multi-process apps.

**Three widgets worth building for Fem-ho:**

1. **`AvuiWidget`** — today's tasks across the user's selected scopes. `LazyColumn` of rows; each row is a
   `Checkbox` + title. Tapping the checkbox runs an `actionRunCallback<CompleteTaskAction>()` that writes
   straight into Room + outbox (so it works offline) and calls `updateAll()`.
2. **`AfegirRapidWidget`** — a 1×1 "+" that launches the quick-add sheet transparently
   (`actionStartActivity<QuickAddActivity>()`).
3. **`ColumnaWidget`** (resizable) — one kanban column (configurable scope/project/column).

```kotlin
class AvuiWidget : GlanceAppWidget() {
    override val sizeMode = SizeMode.Responsive(
        setOf(DpSize(140.dp, 110.dp), DpSize(250.dp, 110.dp), DpSize(250.dp, 250.dp))
    )

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        // Pull from Room via an EntryPoint (Glance is not a Hilt injection site)
        val repo = EntryPointAccessors
            .fromApplication(context, WidgetEntryPoint::class.java).taskRepository()

        provideContent {
            val tasks by repo.observeToday().collectAsState(emptyList())
            GlanceTheme(colors = PlouGlanceColors) {
                Column(GlanceModifier.fillMaxSize().background(GlanceTheme.colors.widgetBackground)
                    .padding(12.dp)) {
                    Text("Avui", style = PlouGlanceText.title)
                    LazyColumn {
                        items(tasks, itemId = { it.id.hashCode().toLong() }) { t ->
                            Row(GlanceModifier.fillMaxWidth().padding(vertical = 4.dp)) {
                                CheckBox(
                                    checked = t.done,
                                    onCheckedChange = actionRunCallback<ToggleDoneAction>(
                                        actionParametersOf(TaskIdKey to t.id)
                                    ),
                                )
                                Text(t.title, maxLines = 2)
                            }
                        }
                    }
                }
            }
        }
    }
}
```

Gotchas: Glance recomposes into `RemoteViews`, so **no** arbitrary Compose modifiers, no custom `Canvas`, no
gradients beyond what `ColorProvider`/`ImageProvider` allows. Plou's per-view brand gradient therefore has to be
either a pre-rendered drawable per accent variant or a flat approximation. Widget updates are rate-limited by
the launcher — drive them from the sync engine (`AvuiWidget().updateAll(context)` at the end of each successful
sync), not from a timer.

### 9.2 App shortcuts

Static (`res/xml/shortcuts.xml`, referenced from the launcher activity by
`<meta-data android:name="android.app.shortcuts" android:resource="@xml/shortcuts"/>`):

```xml
<shortcuts xmlns:android="http://schemas.android.com/apk/res/android">
    <shortcut
        android:shortcutId="quick_add"
        android:enabled="true"
        android:icon="@drawable/ic_shortcut_add"
        android:shortcutShortLabel="@string/sc_add_short"      <!-- ≤10 chars: "Afegeix" -->
        android:shortcutLongLabel="@string/sc_add_long">       <!-- ≤25 chars: "Afegeix una tasca" -->
        <intent
            android:action="cat.femho.action.QUICK_ADD"
            android:targetPackage="cat.femho"
            android:targetClass="cat.femho.quickadd.QuickAddActivity" />
    </shortcut>
    <shortcut android:shortcutId="today" ... />                 <!-- "Avui" -->
    <shortcut android:shortcutId="inbox" ... />                 <!-- "Safata d'entrada" -->
</shortcuts>
```

Attributes and limits (verified): `shortcutId` must be a literal (no string resource);
`shortcutShortLabel` ≤10 chars and required; `shortcutLongLabel` ≤25 chars; `shortcutDisabledMessage`;
most launchers display **max 4**. `<capability-binding android:key="actions.intent.CREATE_MESSAGE"/>` binds a
shortcut to a built-in App Action.

Dynamic shortcuts — push the user's most-used scopes/projects:

```kotlin
val shortcut = ShortcutInfoCompat.Builder(context, "scope_${scope.id}")
    .setShortLabel(scope.shortName)
    .setLongLabel("Obre ${scope.name}")
    .setIcon(IconCompat.createWithResource(context, R.drawable.ic_scope))
    .setIntent(Intent(Intent.ACTION_VIEW, "femho://scope/${scope.id}".toUri()))
    .build()
ShortcutManagerCompat.pushDynamicShortcut(context, shortcut)
```

Pinned shortcuts: guard with `ShortcutManagerCompat.isRequestPinShortcutSupported(context)` and use
**stable, server-derived ids** (`scope_<uuid>`, never an index) so backup/restore and re-pinning behave.

### 9.3 Quick-add from everywhere

Fem-ho's quick-add already parses `@person`, `#Scope`, `#Scope/Project` inline. Wire it to four entry points:

**(a) Share sheet.** Accept `text/plain` (and `text/*` for notes from other apps):

```xml
<activity android:name=".quickadd.QuickAddActivity"
          android:theme="@style/Theme.Femho.Transparent"
          android:excludeFromRecents="true"
          android:exported="true">
    <intent-filter>
        <action android:name="android.intent.action.SEND" />
        <category android:name="android.intent.category.DEFAULT" />
        <data android:mimeType="text/plain" />
    </intent-filter>
    <intent-filter>
        <action android:name="cat.femho.action.QUICK_ADD" />
        <category android:name="android.intent.category.DEFAULT" />
    </intent-filter>
</activity>
```

Read `intent.getStringExtra(Intent.EXTRA_TEXT)` (the shared text) and `Intent.EXTRA_SUBJECT` (page title when
sharing from a browser — use it as the task title and put the URL in notes).

**(b) Direct Share / sharing shortcuts.** To appear as a *target row* in the share sheet (e.g. "Afegeix a
Família"), publish dynamic shortcuts with a `<share-target>` declaration in `shortcuts.xml`:

```xml
<share-target android:targetClass="cat.femho.quickadd.QuickAddActivity">
    <data android:mimeType="text/plain" />
    <category android:name="cat.femho.category.SCOPE_TARGET" />
</share-target>
```

and set the matching category on the dynamic shortcut via
`ShortcutInfoCompat.Builder(...).setCategories(setOf("cat.femho.category.SCOPE_TARGET")).setLongLived(true)`.
Note `ChooserTargetService` (the old Direct Share API) is deprecated — sharing shortcuts is the supported path.

**(c) Notification reply.** Add a `RemoteInput` action ("Afegeix una tasca") to a low-importance persistent-ish
notification, or better, to the reminder notifications: `Marca com a feta` / `Ajorna 1 h` /
`Respon` (RemoteInput → creates a subtask). Handle in a `BroadcastReceiver` that writes to Room + outbox.

**(d) Assistant / App Actions.** `<capability android:name="actions.intent.CREATE_TASK">` in
`res/xml/shortcuts.xml` binds "Hey Google, afegeix una tasca a Fem-ho". **Caveat:** App Actions requires Google
Assistant, i.e. Play Services — put the capability declaration in the `gplay` flavour's `shortcuts.xml` only, so
the FOSS build stays Google-free. **UNVERIFIED** whether `actions.intent.CREATE_TASK` is a currently supported
built-in intent name — check `developer.android.com/reference/app-actions/built-in-intents/` before relying on it.
A safe universal fallback: an `ACTION_VIEW` deep link `femho://add?text=...` that any automation app
(Tasker, Macrodroid, KDE Connect) can fire.

**What Fem-ho should do (§9):** three Glance widgets (Avui / Afegir ràpid / Columna) driven from Room and
refreshed at end-of-sync; 3 static shortcuts + dynamic scope shortcuts with stable ids; share-sheet
`ACTION_SEND text/plain` into quick-add, with sharing-shortcut share targets per scope; notification actions
`Feta` / `Ajorna` / `RemoteInput`; a `femho://add?text=` deep link as the automation-friendly universal entry;
App Actions only in the `gplay` flavour.

---

## 10. Compose implementation notes for the Fem-ho UI

### 10.1 App shell

```
Scaffold(
  topBar = FemhoTopBar {            // Tasques ⇄ Calendari switch, scope chips, project dropdown, +, profile
      SegmentedButtonRow(Tasques | Calendari)
      LazyRow of FilterChip(scopes, multi-select)
      ProjectDropdown(enabled = exactly one scope selected)
  },
  floatingActionButton = null       // "+" lives in the top bar per the spec
) { padding ->
  when (mode) {
    Tasques  -> KanbanPager(...)
    Calendari -> CalendarPane(...) + InboxSideColumn(...)
  }
}
```

Navigation 3 (`androidx.navigation3` 1.1.5) models the back stack as an observable *list of keys* you own:

```kotlin
@Serializable sealed interface Route {
    @Serializable data object Board : Route
    @Serializable data class TaskDetail(val id: String) : Route
    @Serializable data class Checklist(val id: String) : Route
    @Serializable data object Settings : Route
}

val backStack = rememberNavBackStack<Route>(Route.Board)

NavDisplay(
    backStack = backStack,
    onBack = { backStack.removeLastOrNull() },
    entryProvider = entryProvider {
        entry<Route.Board> { BoardScreen(onOpenTask = { backStack.add(Route.TaskDetail(it)) }) }
        entry<Route.TaskDetail> { key -> TaskDetailScreen(key.id) }
        // ...
    },
)
```

The win over Navigation 2 for Fem-ho: the scope-chip/project selection is **app state, not navigation state**,
and Nav3 stops pushing you to encode it in a route string. Keep selection in a `BoardFiltersViewModel` backed by
DataStore (it should survive process death and be shared between the Tasks and Calendar views, per the spec's
"dynamic Inbox side column shared with the tasks view").

### 10.2 Horizontally paged kanban columns

Four columns (Inbox / Per fer / Fent / Fet) will not fit side by side on a phone. Use `HorizontalPager` with a
`PageSize` that shows ~1.1 columns on phones and all four on tablets:

```kotlin
@Composable
fun KanbanPager(columns: List<BoardColumn>, windowSize: WindowSizeClass) {
    val pagerState = rememberPagerState(pageCount = { columns.size })

    val pageSize = remember(windowSize) {
        when (windowSize.widthSizeClass) {
            WindowWidthSizeClass.Compact -> PageSize.Fill               // one column, snapping
            WindowWidthSizeClass.Medium  -> fractionOfViewport(2)
            else                         -> fractionOfViewport(4)       // 4 columns, no paging feel
        }
    }

    Column {
        ColumnTabs(pagerState, columns)                                  // Inbox · Per fer · Fent · Fet
        HorizontalPager(
            state = pagerState,
            pageSize = pageSize,
            contentPadding = PaddingValues(horizontal = 12.dp),
            pageSpacing = 8.dp,
            beyondViewportPageCount = 1,                                 // keep neighbours composed for DnD
            key = { columns[it].id },
        ) { page ->
            KanbanColumn(columns[page])
        }
    }
}

private fun fractionOfViewport(n: Int) = object : PageSize {
    override fun Density.calculateMainAxisPageSize(availableSpace: Int, pageSpacing: Int): Int =
        (availableSpace - (n - 1) * pageSpacing) / n
}
```

Verified `PagerState` surface: `currentPage` (updates immediately, closest to snap), `settledPage` (only when
idle), `targetPage`, `currentPageOffsetFraction`; `scrollToPage(n)` / `animateScrollToPage(n)` are suspend;
`PagerDefaults.flingBehavior(state, pagerSnapDistance = PagerSnapDistance.atMost(n))` limits pages per fling.
Drive the column tab indicator from `snapshotFlow { pagerState.currentPage }`.

**`beyondViewportPageCount = 1` matters**: cross-column drag needs the neighbouring column composed so its drop
target exists.

### 10.3 Drag and drop — what actually works in 2026

There are **two different mechanisms** and Fem-ho needs both.

**(a) Reordering *within* a column → `sh.calvin.reorderable:reorderable:3.1.0`.**
Supports `LazyColumn`, `LazyRow`, all four Lazy grids, plus plain `Column`/`Row`. Auto-scrolls when you drag to
the edge with speed proportional to edge distance, and uses `Modifier.animateItem` for the shuffle animation.

```kotlin
val lazyListState = rememberLazyListState()
val reorderState = rememberReorderableLazyListState(lazyListState) { from, to ->
    // called continuously during the drag — update a LOCAL list for visual feedback only
    localOrder = localOrder.toMutableList().apply { add(to.index, removeAt(from.index)) }
}

LazyColumn(state = lazyListState) {
    items(localOrder, key = { it.id }) { task ->
        ReorderableItem(reorderState, key = task.id) { isDragging ->
            TaskCard(
                task = task,
                elevation = if (isDragging) 8.dp else 1.dp,
                modifier = Modifier.longPressDraggableHandle(
                    onDragStopped = { viewModel.commitMove(task.id, neighboursOf(task.id)) },
                ),
            )
        }
    }
}
```

**Critical pattern:** `onMove` fires many times per drag. Do **not** write to Room / enqueue an outbox op on each
call — you'd generate dozens of order keys and dozens of ops. Keep a local list for the animation and commit
**once** in `onDragStopped`, computing the fractional index from the final neighbours. Use
`longPressDraggableHandle` (not `draggableHandle`) on cards, so vertical scrolling still works with a normal
swipe.

**(b) Moving *between* columns → the platform `Modifier.dragAndDropSource` / `Modifier.dragAndDropTarget`.**
Reorderable explicitly does not support cross-collection drags. The Compose Foundation drag-and-drop API does:

```kotlin
// Source: a card
Modifier.dragAndDropSource { _ ->
    DragAndDropTransferData(
        ClipData.newPlainText("femho/task", task.id)
    )
}

// Target: each column body
val target = remember(column.id) {
    object : DragAndDropTarget {
        override fun onEntered(event: DragAndDropEvent) { highlighted = true }
        override fun onExited(event: DragAndDropEvent)  { highlighted = false }
        override fun onEnded(event: DragAndDropEvent)   { highlighted = false }
        override fun onDrop(event: DragAndDropEvent): Boolean {
            val id = event.toAndroidDragEvent().clipData.getItemAt(0).text.toString()
            viewModel.moveToColumn(id, column, dropIndexFromY(event))
            return true
        }
    }
}
Modifier.dragAndDropTarget(
    shouldStartDragAndDrop = { it.mimeTypes().contains(ClipDescription.MIMETYPE_TEXT_PLAIN) },
    target = target,
)
```

Verified details: callbacks are `onStarted`, `onEntered`, `onEnded`, `onExited`, `onDrop` (returns `Boolean` —
`true` = consumed); the `DragAndDropTarget` object **must be `remember`ed**; `DragAndDropTransferData(clipData,
flags)` with `View.DRAG_FLAG_GLOBAL` enables cross-app drags (worth adding — dragging a task out to a notes app
as text is a nice touch, and dragging text *in* from another app to create a task is even nicer, via
`activity.requestDragAndDropPermissions(event.toAndroidDragEvent())` then `permission?.release()`).

**Combining the two is the hard part.** Practical approach, in order of preference:
1. **Long-press → platform drag-and-drop for everything.** One mechanism, works within and across columns,
   works across apps. Downside: you implement your own insertion-index calculation and auto-scroll (compute the
   drop index from the pointer's Y against `lazyListState.layoutInfo.visibleItemsInfo`; auto-scroll by
   `lazyListState.scrollBy()` in a `LaunchedEffect` while the pointer is within N dp of an edge).
   Also: while a platform drag is in flight, drive `pagerState.animateScrollToPage()` when the pointer nears the
   screen edge so the user can page to the target column mid-drag.
2. **Reorderable within, platform DnD across.** Less code, but two gesture vocabularies that must not conflict;
   you'll fight `longPressDraggableHandle` vs `dragAndDropSource` both wanting the long press.
3. **No drag at all on phones**: long-press a card → a bottom sheet with "Mou a → Per fer / Fent / Fet" and
   "Mou amunt / avall". **Ship this regardless** — it's the accessibility path (TalkBack users cannot drag), it's
   faster than dragging for multi-column moves, and it's the fallback when drag inevitably misbehaves on some OEM.

**Accessibility is not optional here.** Add custom accessibility actions on every card:

```kotlin
Modifier.semantics {
    customActions = listOf(
        CustomAccessibilityAction("Mou a Fent") { viewModel.moveToColumn(task.id, DOING, null); true },
        CustomAccessibilityAction("Mou amunt")  { viewModel.moveUp(task.id); true },
        CustomAccessibilityAction("Mou avall")  { viewModel.moveDown(task.id); true },
    )
}
```

### 10.4 Calendar (month / week / day)

**Library: `com.kizitonwose.calendar:compose`** (Android artifact uses `java.time`; a Compose-Multiplatform
artifact also exists covering Android/iOS/JS/WasmJs/Desktop). Version ~2.10.1 — **UNVERIFIED** exact latest;
check Maven Central for `com.kizitonwose.calendar:compose` before pinning.

Composables it provides (verified from `docs/Compose.md`): `HorizontalCalendar`, `VerticalCalendar`,
`WeekCalendar`, `HeatMapCalendar`, `HorizontalYearCalendar`, `VerticalYearCalendar`.
State: `rememberCalendarState(startMonth, endMonth, firstVisibleMonth, firstDayOfWeek, outDateStyle)` and
`rememberWeekCalendarState(startDate, endDate, firstVisibleWeekDate, firstDayOfWeek)`.
Slots: `dayContent`, `monthHeader`, `monthFooter`, `monthBody`, `monthContainer`.
`CalendarState` exposes `firstVisibleMonth`, `lastVisibleMonth`, `layoutInfo`, `isScrollInProgress`,
`outDateStyle`.

```kotlin
val state = rememberCalendarState(
    startMonth = YearMonth.now().minusMonths(24),
    endMonth   = YearMonth.now().plusMonths(24),
    firstVisibleMonth = YearMonth.now(),
    firstDayOfWeek = DayOfWeek.MONDAY,             // Catalan/European week start
    outDateStyle = OutDateStyle.EndOfGrid,          // stable 6-row grid, no height jumps
)

HorizontalCalendar(
    state = state,
    dayContent = { day ->
        DayCell(
            day = day,
            tasks = tasksByDate[day.date].orEmpty(),
            isToday = day.date == today,
            inMonth = day.position == DayPosition.MonthDate,
            onClick = { onSelectDay(day.date) },
        )
    },
    monthHeader = { month -> WeekdayHeader(month, locale = catalanLocale) },
)
```

Key points:
- **`OutDateStyle.EndOfGrid`** keeps every month at 6 rows, so switching months doesn't resize the pane —
  important because the Inbox side column must stay aligned.
- **Day view is not provided by the library** — build it yourself: a vertical time grid
  (`LazyColumn` of 24 hour rows, or a `Layout` with absolute Y positioning for overlapping events). This is the
  right call anyway because Fem-ho's day view shows tasks with `startAt`/`dueAt`, not generic events, and
  overlap layout is app-specific. Reference algorithm for overlapping columns: group events into
  connected-overlap clusters, then within a cluster assign each event the lowest free column index and set
  width = 1/maxColumns.
- **Locale:** Catalan month/day names come from `java.time.format.TextStyle` + `Locale("ca")`. Verify the
  device has Catalan CLDR data (it does on all modern Android); provide `values-ca/` strings for everything else.
- Bind the whole calendar to a `Flow<Map<LocalDate, List<Task>>>` derived in the ViewModel from a Room query
  filtered to the visible month ± 1, driven by `snapshotFlow { state.firstVisibleMonth }`.

**Alternative if the library disappoints:** roll month view yourself with `HorizontalPager` (one page per month)
+ a `LazyVerticalGrid(GridCells.Fixed(7))`. It's ~150 lines and removes a dependency. Given Fem-ho's dense
custom day cells, this is a genuinely reasonable option — evaluate both in a spike.

### 10.5 Bottom sheets

Material 3 1.4.0 gives you `ModalBottomSheet` and `BottomSheetScaffold`:

```kotlin
val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = false)

ModalBottomSheet(
    onDismissRequest = { onDismiss() },
    sheetState = sheetState,
    shape = PlouShapes.sheet,                       // Plou: large top radius
    containerColor = MaterialTheme.colorScheme.surfaceContainerLow,
    dragHandle = { PlouDragHandle() },
    contentWindowInsets = { WindowInsets.navigationBars },
) {
    QuickAddContent(...)
}
```

Fem-ho's sheets: **quick-add** (with inline `@`/`#` parsing and an autocomplete row), **task detail**
(or a full screen — prefer full screen for anything with subtasks + checklist + audit trail), **move-to-column**,
**scope picker**, **share-link creation** (expiry / password / require-name).

Quick-add specifics:
- Use `TextFieldState` + `BasicTextField` (Compose 1.11's state-based text field) so you can run the parser on
  every change without recomposition storms, and render `@person` / `#Scope` as styled spans via
  `outputTransformation` / a custom `VisualTransformation`.
- Show the parse result as **chips above the field** (`Família`, `Compres`, `@marta`) rather than only colouring
  the text — much clearer, and tappable to correct.
- `imeAction = ImeAction.Done` + keep the sheet open on submit for rapid multi-add ("afegeix i continua").
- Request focus + show IME on open: `LaunchedEffect(Unit) { focusRequester.requestFocus() }`.

### 10.6 Mapping the Plou design system into a Compose theme

Plou = Roboto, one brand gradient per view, light/dark, 4 accent variants, pill shapes, soft shadows. The M3
theme has slots for colour/type/shape but **no slot** for gradients, accent variants, elevation-as-soft-shadow,
or spacing. Use `MaterialTheme` for what maps, and `CompositionLocal`s for what doesn't.

**(a) What maps onto M3 slots:**

```kotlin
// Colour — one ColorScheme per (accent variant × light/dark) = 8 schemes.
private fun plouColorScheme(accent: PlouAccent, dark: Boolean): ColorScheme =
    if (dark) darkColorScheme(
        primary = accent.dark.primary,
        onPrimary = accent.dark.onPrimary,
        primaryContainer = accent.dark.container,
        onPrimaryContainer = accent.dark.onContainer,
        secondary = …, tertiary = …,
        surface = PlouNeutral.dark.surface,
        surfaceContainerLow = PlouNeutral.dark.surface1,
        surfaceContainer = PlouNeutral.dark.surface2,
        surfaceContainerHigh = PlouNeutral.dark.surface3,
        outline = …, outlineVariant = …, error = …, scrim = …,
    ) else lightColorScheme(/* … */)

// Type — Roboto is the platform default; declare it explicitly anyway.
private val PlouTypography = Typography(
    displayLarge  = TextStyle(fontFamily = Roboto, fontWeight = W400, fontSize = 57.sp, lineHeight = 64.sp),
    headlineSmall = TextStyle(fontFamily = Roboto, fontWeight = W600, fontSize = 24.sp, lineHeight = 32.sp),
    titleLarge    = TextStyle(fontFamily = Roboto, fontWeight = W600, fontSize = 22.sp, lineHeight = 28.sp),
    titleMedium   = TextStyle(fontFamily = Roboto, fontWeight = W500, fontSize = 16.sp, lineHeight = 24.sp),
    bodyLarge     = TextStyle(fontFamily = Roboto, fontWeight = W400, fontSize = 16.sp, lineHeight = 24.sp,
                              letterSpacing = 0.15.sp),
    bodyMedium    = TextStyle(fontFamily = Roboto, fontWeight = W400, fontSize = 14.sp, lineHeight = 20.sp),
    labelLarge    = TextStyle(fontFamily = Roboto, fontWeight = W500, fontSize = 14.sp, lineHeight = 20.sp),
    labelSmall    = TextStyle(fontFamily = Roboto, fontWeight = W500, fontSize = 11.sp, lineHeight = 16.sp),
    // …all 15 roles: display/headline/title/body/label × Large/Medium/Small
)

// Shape — Plou is pill-heavy.
private val PlouShapes = Shapes(
    extraSmall = RoundedCornerShape(8.dp),
    small      = RoundedCornerShape(12.dp),
    medium     = RoundedCornerShape(16.dp),
    large      = RoundedCornerShape(24.dp),
    extraLarge = RoundedCornerShape(28.dp),
)
```

Full verified M3 role list to fill: `primary/onPrimary/primaryContainer/onPrimaryContainer`,
`secondary/…`, `tertiary/…`, `surface/onSurface`, `surfaceVariant/onSurfaceVariant`,
`surfaceContainerLow/surfaceContainer/surfaceContainerHigh`, `background/onBackground`,
`error/onError/errorContainer/onErrorContainer`, `outline/outlineVariant`, `scrim`.
Typography roles: `display|headline|title|body|label` × `Large|Medium|Small` (15 total).

**(b) What needs custom `CompositionLocal`s:**

```kotlin
@Immutable
data class PlouTokens(
    val gradient: PlouGradient,           // per-view brand gradient
    val accent: PlouAccent,               // which of the 4 variants is active
    val spacing: PlouSpacing,             // xs 4 / sm 8 / md 12 / lg 16 / xl 24 / xxl 32
    val softShadow: PlouShadow,           // colour + blur + offset (M3 elevation ≠ soft shadow)
    val pill: Dp,                         // pill corner radius (= 50% height in practice)
    val cardStroke: Color,
    val columnHeader: PlouColumnHeaderTokens,
    val syncBadge: PlouSyncBadgeTokens,
)

@Immutable
data class PlouGradient(val start: Color, val end: Color, val angleDeg: Float) {
    fun brush(size: Size): Brush = Brush.linearGradient(
        colors = listOf(start, end),
        start = Offset.Zero,
        end = angleDeg.let { a ->
            Offset(size.width * cos(a.toRadians()), size.height * sin(a.toRadians()))
        },
    )
}

val LocalPlouTokens = staticCompositionLocalOf<PlouTokens> { error("No PlouTokens provided") }

@Composable
fun PlouTheme(
    accent: PlouAccent = PlouAccent.Default,
    view: PlouView = PlouView.Tasks,         // selects the gradient
    dark: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val tokens = remember(accent, view, dark) { plouTokens(accent, view, dark) }
    CompositionLocalProvider(LocalPlouTokens provides tokens) {
        MaterialTheme(
            colorScheme = plouColorScheme(accent, dark),
            typography  = PlouTypography,
            shapes      = PlouShapes,
            content     = content,
        )
    }
}

// Accessor mirroring MaterialTheme's shape
object Plou {
    val tokens: PlouTokens @Composable @ReadOnlyComposable get() = LocalPlouTokens.current
}
```

Usage: `Plou.tokens.spacing.md`, `Plou.tokens.gradient.brush(size)`, alongside
`MaterialTheme.colorScheme.primary`. Use `staticCompositionLocalOf` (not `compositionLocalOf`) because the token
object changes rarely — it avoids tracking reads and is measurably cheaper.

**(c) CSS token → Compose mapping table.** Codify this so the web and Android stay in sync:

| Plou CSS token | Compose destination |
|---|---|
| `--plou-color-accent` | `ColorScheme.primary` |
| `--plou-color-accent-container` | `ColorScheme.primaryContainer` |
| `--plou-color-surface-1/2/3` | `surfaceContainerLow` / `surfaceContainer` / `surfaceContainerHigh` |
| `--plou-color-outline` | `ColorScheme.outline` |
| `--plou-radius-pill` | `PlouTokens.pill` (no M3 slot) |
| `--plou-radius-card` | `Shapes.medium` |
| `--plou-radius-sheet` | `Shapes.extraLarge` |
| `--plou-space-*` | `PlouTokens.spacing` (no M3 slot) |
| `--plou-shadow-soft` | `PlouTokens.softShadow` (M3 `tonalElevation` ≠ this) |
| `--plou-gradient-tasks/calendar/…` | `PlouTokens.gradient` (no M3 slot) |
| `--plou-font-*` | `Typography` roles |

**Best practice:** generate `PlouTokens.kt` and the `ColorScheme` factories **from the same source of truth**
as the CSS (a JSON token file), with a small Gradle task or a checked-in codegen script. Hand-maintaining two
copies of 8 colour schemes will drift within a month.

Soft shadows: M3's `Card(elevation = …)` gives you tonal + a hard-ish shadow. For Plou's soft shadow, draw it
yourself:

```kotlin
fun Modifier.plouSoftShadow(shadow: PlouShadow, shape: Shape) = this.drawBehind {
    val paint = Paint().apply {
        asFrameworkPaint().setShadowLayer(
            shadow.blur.toPx(), 0f, shadow.dy.toPx(), shadow.color.toArgb()
        )
        color = Color.Transparent
    }
    drawIntoCanvas { it.drawOutline(shape.createOutline(size, layoutDirection, this), paint) }
}
```

(`setShadowLayer` requires hardware-acceleration-compatible usage; verify on device — on some API levels it
needs a software layer. **UNVERIFIED** across all API levels; the safe alternative is a 9-patch/nine-slice
drawable or a blurred `RenderEffect` on API 31+.)

**(d) Material 3 Expressive — use it or not?**
Facts (verified): Expressive APIs live in `material3` **1.5.0-alphaNN**; `MaterialExpressiveTheme` +
`expressiveLightColorScheme` were promoted to non-experimental in **1.5.0-alpha18**; expressive buttons/FAB/FAB
menu in **alpha19**; expressive top app bars (`MediumFlexibleTopAppBar`, `LargeFlexibleTopAppBar`,
`TwoRowsTopAppBar`, `FlexibleBottomAppBar`) in **alpha23**; the `@Material3ExpressiveApi` annotation does not
require opt-in. The API shape is:

```kotlin
MaterialExpressiveTheme(
    colorScheme = expressiveLightColorScheme(),
    motionScheme = MotionScheme.expressive(),      // or MotionScheme.standard()
    shapes = PlouShapes,
    typography = PlouTypography,
) { content() }
```

**Recommendation: no, not for v1.** Plou already defines its own colour/motion/shape language, so Expressive's
main value (opinionated defaults) is exactly what you're overriding. Shipping the app's entire component library
on an alpha artifact that has churned through 25 alphas is an unforced risk. Revisit when `material3 1.5.0`
goes stable. If you want *one* thing from it, `MotionScheme` is genuinely nice — but you can hand-roll the two
or three spring specs Plou needs into `PlouTokens.motion` with zero dependency risk.

**What Fem-ho should do (§10):** Nav3 with app-state (not route-encoded) scope/project selection; `HorizontalPager`
with a responsive `PageSize` for the 4 kanban columns and `beyondViewportPageCount = 1`; platform
`dragAndDropSource`/`dragAndDropTarget` as the primary move mechanism with `sh.calvin.reorderable:3.1.0`
optional for intra-column, **plus** a non-drag "Mou a…" sheet and custom accessibility actions on every card;
commit exactly one fractional-index write per drag on drag-stop; Kizitonwose Calendar for month/week and a
hand-built day view; `PlouTheme` = `MaterialTheme` (colour/type/shape) + `staticCompositionLocalOf<PlouTokens>`
for gradients/spacing/soft shadows/pill radius, code-generated from the same JSON token file as the CSS;
stay on material3 1.4.0 stable.

---

## 11. Testing

### 11.1 Test pyramid for a sync app

| Layer | Tool | What it covers |
|---|---|---|
| Pure unit | JUnit4 + `kotlinx-coroutines-test` + Turbine `1.2.0` | `OrderKey`, quick-add parser, merge/coalesce logic, backoff, conflict classification |
| Property | `kotest-property` (or hand-rolled loops) | fractional indexing invariants (§5.6.4) |
| DAO | `androidx.room:room-testing` + instrumented (real SQLite) | queries, migrations, transaction atomicity |
| Repository / sync engine | JUnit + **Ktor `MockEngine`** + in-memory Room | the whole sync cycle against a scripted server |
| ViewModel | Turbine on `StateFlow` | LCE states, filter combinations |
| UI | `createAndroidComposeRule` + semantics | board rendering, drag alternatives, quick-add chips |
| Screenshot | **Roborazzi `1.56.0`** (JVM, via Robolectric `4.16`) | Plou theme in light/dark × 4 accents |
| Macro | `benchmark-macro-junit4 1.4.1` | startup, board scroll jank, baseline profile generation |

**Do not use `Thread.sleep` or real `WorkManager` in unit tests.** Use
`androidx.work:work-testing` with `WorkManagerTestInitHelper` + `TestDriver.setAllConstraintsMet(id)` for the
worker-scheduling tests, and test the *sync engine itself* as a plain class outside WorkManager.

### 11.2 The sync tests that actually matter

Write these explicitly; they are where the bugs will be:

1. **Offline create → online → single server row.** Create 3 tasks offline, go online, assert exactly 3
   mutations posted and 3 rows locally with `localDirty = false`.
2. **Idempotent replay.** Post a batch, simulate a timeout after the server applied it, retry the same batch
   → server returns the same results, no duplicates.
3. **Coalescing.** 20 rapid title edits → 1 outbox row, `baseVersion` equal to the *first* edit's base.
4. **Delete cancels pending create.** Create offline, delete offline → outbox empty, no network call.
5. **Drain-before-pull.** Local move + a conflicting server move; assert the UI never shows the pre-move state.
6. **422 is terminal.** Assert `attempts` does not increment past 1 and the op lands in `DEAD`.
7. **409 merge.** Server echoes a merged entity; assert local row equals the echo and the op is dropped.
8. **Stale token → snapshot.** Server returns `409 stale_token`; assert a snapshot fetch and a full replace.
9. **Fractional index convergence.** Two simulated clients each move cards offline; after both sync, assert both
   devices' `ORDER BY position, id` produce identical sequences.
10. **Token refresh storm.** 10 concurrent 401s → exactly 1 refresh call (the `Mutex`).

Ktor `MockEngine` makes 1–8 fast JVM tests:

```kotlin
val engine = MockEngine { request ->
    when (request.url.encodedPath) {
        "/api/v1/sync/changes" -> respond(
            content = json.encodeToString(changesResponse),
            headers = headersOf(HttpHeaders.ContentType, "application/json"),
        )
        "/api/v1/sync/mutations" -> { captured += request.readBody(); respond(mutationsResponse) }
        else -> respond("", HttpStatusCode.NotFound)
    }
}
```

### 11.3 Screenshot testing the Plou theme

Roborazzi runs Compose screenshots on the JVM (no emulator), which makes an 8-variant matrix
(4 accents × light/dark) cheap enough to run on every PR:

```kotlin
@RunWith(AndroidJUnit4::class)
@Config(qualifiers = RobolectricDeviceQualifiers.Pixel7)
class BoardScreenshotTest {
    @get:Rule val composeRule = createComposeRule()

    @Test fun board_allAccents() {
        PlouAccent.entries.forEach { accent ->
            listOf(false, true).forEach { dark ->
                composeRule.setContent {
                    PlouTheme(accent = accent, view = PlouView.Tasks, dark = dark) { BoardPreview() }
                }
                composeRule.onRoot().captureRoboImage("board_${accent.name}_${if (dark) "dark" else "light"}.png")
            }
        }
    }
}
```

### 11.4 Instrumented UI notes

- Tag every meaningful node with `Modifier.testTag("task_card_${task.id}")` and enable
  `testTagsAsResourceId = true` in the root semantics so UiAutomator/macrobenchmark can find them too.
- Test the **non-drag** move path in UI tests (drag gestures in Compose tests are flaky and low-value);
  test the drag logic at the ViewModel level instead by feeding it `from`/`to` indices.
- `composeRule.mainClock.autoAdvance = false` when asserting on the pending-sync badge, so you control the
  debounce/animation clock.

---

## 12. Release and distribution

### 12.1 R8

```kotlin
android {
    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.getByName("release")
        }
        create("benchmark") {          // for baseline profile generation & macrobenchmark
            initWith(buildTypes.getByName("release"))
            signingConfig = signingConfigs.getByName("debug")
            matchingFallbacks += listOf("release")
            isMinifyEnabled = false     // profiles must be generated against unobfuscated code
            isDebuggable = false
            proguardFiles("benchmark-rules.pro")
        }
    }
}
```

Rules you will need in `proguard-rules.pro`:

```proguard
# kotlinx.serialization — keep generated serializers
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keepclassmembers class **$$serializer { *; }
-keepclasseswithmembers class ** {
    public static ** Companion;
    kotlinx.serialization.KSerializer serializer(...);
}
# Your @Serializable model package (belt and braces)
-keep,includedescriptorclasses class cat.femho.core.network.model.** { *; }

# Room generated implementations are kept by the compiler, but keep entities' field names
-keep class cat.femho.core.database.model.** { *; }

# WorkManager workers instantiated reflectively when not using HiltWorkerFactory
-keep class * extends androidx.work.ListenableWorker { <init>(...); }

# Glance / RemoteViews
-keep class cat.femho.widget.** { *; }
```

Test the minified build. A `NoSuchMethodException` from a stripped serializer only shows up in release.

### 12.2 Baseline profiles (verified requirements)

Minimum stable versions: **AGP 8.0.0+**, `androidx.benchmark:benchmark-macro-junit4:1.4.1+`,
`androidx.profileinstaller:profileinstaller:1.4.1+`. NiA pins macrobenchmark `1.5.0-alpha01` and
profileinstaller `1.4.1`.

- `baseline-prof.txt` → ART pre-compilation at install; ~30 % faster code execution from first launch.
- `startup-prof.txt` → **D8/R8 DEX layout** optimisation for startup; ~15 % additional startup improvement.
  Google recommends shipping **both**.
- Compiled output is packaged at **`assets/dexopt/baseline.prof`**.
- **AGP 8.2+**: R8 rewrites human-readable profile rules to match obfuscated code, so you generate profiles from
  an **unminified** variant and apply them to the **minified** release (~30 % more method coverage,
  ~15 % more perf). This is why the `benchmark` build type above sets `isMinifyEnabled = false`.
- AGP 8.4: local installs of non-debuggable builds install baseline profiles (so you can measure locally).
- AGP 9.1: full source-set directory support for library modules.

Generator — cover Fem-ho's real journeys, not just startup:

```kotlin
@RunWith(AndroidJUnit4::class)
class BaselineProfileGenerator {
    @get:Rule val rule = BaselineProfileRule()

    @Test fun generate() = rule.collect(packageName = "cat.femho") {
        uiAutomator {
            startApp("cat.femho")
            onElement { viewIdResourceName == "board_pager" }.also {
                it.fling(Direction.RIGHT); it.fling(Direction.LEFT)
            }
            onElement { textAsString() == "Calendari" }.click()
            onElement { viewIdResourceName == "calendar_month" }.fling(Direction.DOWN)
            pressBack()
            onElement { viewIdResourceName == "quick_add_fab" }.click()
            pressBack()
        }
    }
}
```

**Critical for self-distribution:** baseline profiles are normally installed by Play. Outside Play, the
`ProfileInstaller` library installs them on first run instead — so **`androidx.profileinstaller` is not optional
for a sideloaded/F-Droid app**, it is the only delivery path. Include it explicitly.

### 12.3 Building for self-distribution vs Play

| | GitHub Releases / self-host | F-Droid | Google Play |
|---|---|---|---|
| Artifact | **universal signed APK** | APK built by F-Droid (or your signed APK, reproducibly verified) | **AAB** |
| Signing | your own keystore, kept forever | F-Droid's key, or yours via `AllowedAPKSigningKeys` | Play App Signing |
| Baseline profile delivery | `ProfileInstaller` | `ProfileInstaller` | Play install-time |
| targetSdk pressure | none | none | **36 by 2026-08-31** |
| Google deps allowed | yes | flagged as anti-features | yes |

**Gradle for a universal APK** (do not ship splits for sideloading — a user downloading from GitHub cannot pick
an ABI):

```kotlin
android {
    splits { abi { isEnable = false }; density { isEnable = false } }
    bundle { language { enableSplit = false } }   // keep all languages; Catalan must never be split away
}
```

**F-Droid submission** (verified facts):
- Metadata lives in the **`fdroiddata`** GitLab repo under `/metadata/<applicationId>.yml`; you open a merge
  request. F-Droid's servers read it and build from source on their infrastructure.
- **Reproducible builds** are best practice: the APK built from your source must be byte-identical every time.
- To ship **your own signature** (so users can update between GitHub and F-Droid builds without uninstalling),
  use the `Binaries` / `Builds.binary` directive to point at your published APKs plus
  **`AllowedAPKSigningKeys`** to pin your signing key; F-Droid then verifies its reproduced build against your
  binary and copies your signature onto it.
- Include `fastlane/metadata/android/ca/` and `.../en-US/` (title, short_description, full_description,
  changelogs/`<versionCode>.txt`, images) — F-Droid reads Fastlane metadata directly from the repo, which is the
  lowest-friction way to get a decent listing.

Reproducibility checklist: pin the AGP/Kotlin/NDK versions, avoid timestamps in generated code, avoid
`buildConfigField` values derived from the build machine (git dirty state, hostname, build time), and set
`android.buildTypes.release.isCrunchPngs = false` if PNG crunching differs across versions.

**Versioning:** `versionCode` = monotonically increasing integer (use `MAJOR*10000 + MINOR*100 + PATCH`);
`versionName` = semver. Add a `minClientVersion` handshake with the server (§7.4) so a stale APK is told to
update rather than silently failing on new API shapes.

**Update checking without Play:** for the GitHub-distributed build, poll
`https://api.github.com/repos/<owner>/fem-ho/releases/latest` (unauthenticated, 60 req/h/IP) at most once a day
via WorkManager, and show an in-app "hi ha una versió nova" card that links to the release page.
**Do not auto-download and install** — that requires `REQUEST_INSTALL_PACKAGES`, which is a red flag for
reviewers and for F-Droid.

**What Fem-ho should do (§12):** universal signed APK on GitHub Releases as the primary channel; F-Droid MR with
Fastlane metadata and `AllowedAPKSigningKeys` pointing at your own signature; `profileinstaller` mandatory;
generate baseline + startup profiles from a non-minified `benchmark` build type; R8 on with explicit
kotlinx.serialization/Room/Worker keep rules; Play only as an optional `gplay` flavour that must track
`targetSdk 36`.

---

## 13. Module / package structure

Gradle modules (mirrors Now in Android's proven layout, adapted):

```
fem-ho-android/
├── app/                                  # assembly only: Application, MainActivity, NavDisplay, DI wiring
│   └── src/{main,foss,gplay}/
├── build-logic/convention/               # AndroidApplicationConventionPlugin, AndroidLibraryConventionPlugin,
│                                         # AndroidComposeConventionPlugin, HiltConventionPlugin, RoomConventionPlugin
├── core/
│   ├── model/                            # pure Kotlin: Task, Scope, Project, Checklist, User, BoardColumn,
│   │                                     # AiMode, ShareLink, SyncState, AuditEntry — NO android deps
│   ├── common/                           # Result/Either, Dispatchers qualifiers, Clock, suspendRunCatching
│   ├── ordering/                         # OrderKey (fractional indexing) — pure Kotlin, property-tested
│   ├── parser/                           # quick-add parser: @person / #Scope / #Scope/Project / dates
│   ├── datastore/                        # ServerPrefs, BoardFilters, UiPrefs (Preferences DataStore)
│   ├── secure/                           # KeystoreCipher, TokenStore, ServerTrustStore
│   ├── database/                         # Room: FemhoDatabase, entities, DAOs, converters, migrations, schemas/
│   ├── network/                          # Ktor client factory, DTOs, endpoints, MockEngine test fixtures
│   ├── data/                             # repositories (offline-first), model mappers, SyncEngine, Outbox
│   ├── sync/                             # SyncWorker, SyncScheduler, ConnectivityMonitor, PushProvider iface
│   ├── notifications/                    # channels, reminder scheduling, notification actions
│   ├── designsystem/                     # PlouTheme, PlouTokens, Plou components (Chip, Card, Sheet, Badge)
│   ├── ui/                               # shared composables that know about model types (TaskCard, ScopeChip)
│   └── testing/                          # test doubles, rules, fake repositories, Roborazzi setup
├── feature/
│   ├── auth/                             # server URL + login + cert review sheet + QR pairing
│   ├── board/                            # kanban pager, columns, drag, move sheet
│   ├── calendar/                         # month/week/day + shared inbox column
│   ├── taskdetail/                       # task, subtasks, checklist, audit trail, AI mode
│   ├── checklist/                        # standalone checklist screens, pinning
│   ├── quickadd/                         # quick-add sheet + share-sheet activity
│   ├── scopes/                           # scope & project management, membership
│   ├── share/                            # public share links (expiry / password / require name)
│   └── settings/                         # account, servers, sync diagnostics, failures, push, about
├── widget/                               # Glance widgets (depends on core:data, core:designsystem)
├── benchmark/                            # macrobenchmark + BaselineProfileGenerator
└── lint/                                 # custom lint rules (e.g. "no direct Room access from feature modules")
```

Dependency rules to enforce (custom lint or `dependency-guard`):
- `feature:*` may depend on `core:data`, `core:model`, `core:designsystem`, `core:ui`, `core:common` — **never**
  on `core:database` or `core:network` directly.
- `core:model` and `core:ordering` have **zero** Android dependencies (pure Kotlin/JVM → fast unit tests).
- No `feature:*` → `feature:*` edges. Cross-feature navigation goes through route types owned by `app`.

Package naming inside a module: `cat.femho.<module>.<layer>`, e.g.
`cat.femho.core.data.repository`, `cat.femho.feature.board.ui`, `cat.femho.core.database.dao`.

Hilt component layout:
- `@Singleton` (`SingletonComponent`): `FemhoDatabase` holder, `HttpClientProvider`, `TokenStore`,
  `ServerTrustStore`, all repositories, `SyncEngine`, `SyncScheduler`, `ConnectivityMonitor`, `PushProvider`.
- `@ViewModelScoped`: per-screen use cases if any.
- `@HiltWorker` for `SyncWorker`, `PushRegistrationWorker`, `ReminderWorker`, `UpdateCheckWorker`.
- `@EntryPoint` for Glance widgets and `BroadcastReceiver`s (neither is a Hilt injection site by default —
  actually `@AndroidEntryPoint` works for receivers; Glance needs `EntryPointAccessors`).

---

## 14. Sync engine — pseudocode listing

```kotlin
// core/sync/src/main/kotlin/cat/femho/core/sync/SyncEngine.kt

class SyncEngine(
    private val db: FemhoDatabase,
    private val outbox: OutboxDao,
    private val syncState: SyncStateDao,
    private val api: FemhoApi,
    private val repos: List<Syncable>,     // task, scope, project, checklist, user, sharelink
    private val clock: Clock,
    private val widgets: WidgetRefresher,
    private val notifications: ReminderScheduler,
) {

    private val gate = Mutex()             // only one sync cycle at a time, process-wide

    suspend fun syncOnce(trigger: SyncTrigger): SyncOutcome = gate.withLock {
        suspendRunCatching {

            // ── PHASE 0: preconditions ────────────────────────────────────────────
            val server = syncState.activeServer() ?: return@suspendRunCatching SyncOutcome.NoAccount
            if (!tokens.isUsable(server)) {
                tokens.refresh(server)     // throws AuthRevoked -> Fatal
            }

            // ── PHASE 1: PUSH — drain the outbox before reading ───────────────────
            //   Rationale: a pull first would overwrite optimistic local state and
            //   the UI would visibly jump backwards.
            var pushed = 0
            while (true) {
                val batch = outbox.claimBatch(limit = 50, now = clock.nowMillis())
                if (batch.isEmpty()) break

                val batchId = uuid4()
                outbox.markInFlight(batch.map { it.opId }, batchId)

                val response = try {
                    api.postMutations(idempotencyKey = batchId, batch.map { it.toWire() })
                } catch (e: IOException) {
                    outbox.releaseWithBackoff(batch.map { it.opId }, e.message); 
                    return@suspendRunCatching SyncOutcome.Retryable
                } catch (e: HttpException) {
                    when (e.status) {
                        401 -> return@suspendRunCatching SyncOutcome.AuthFailed
                        429 -> { outbox.releaseAfter(batch.map { it.opId }, e.retryAfterMillis)
                                 return@suspendRunCatching SyncOutcome.Retryable }
                        in 500..599 -> { outbox.releaseWithBackoff(batch.map { it.opId }, e.message)
                                         return@suspendRunCatching SyncOutcome.Retryable }
                        else -> { outbox.releaseWithBackoff(batch.map { it.opId }, e.message)
                                  return@suspendRunCatching SyncOutcome.Retryable }
                    }
                }

                db.withTransaction {
                    for (r in response.results) when (r.status) {
                        APPLIED, MERGED -> {
                            repos.forEntity(r.entity).upsertFromServer(r.entity)
                            outbox.delete(r.opId)
                            if (r.status == MERGED) syncState.recordConflict(r.opId, r.entityId, r.rejectedFields)
                        }
                        CONFLICT -> {                         // 409: server state wins wholesale
                            if (r.entity != null) repos.forEntity(r.entity).upsertFromServer(r.entity)
                            else repos.forType(r.entityType).deleteLocal(r.entityId)
                            outbox.delete(r.opId)
                            syncState.recordConflict(r.opId, r.entityId, reason = r.reason)
                        }
                        REJECTED -> {                         // 422/403: permanent, never retry
                            outbox.markDead(r.opId, r.code, r.reason)
                        }
                    }
                    response.nextToken?.let { syncState.advanceCursorAtLeast(it) }
                }
                pushed += batch.size
            }

            // ── PHASE 2: PULL — change list since the stored token ────────────────
            var token = syncState.cursor(server.id)
            var pulled = 0

            if (token == null) {
                //  first sync (or after a wipe): full snapshot
                val snap = api.snapshot()
                db.withTransaction {
                    repos.forEach { it.replaceAllFromServer(snap) }
                    syncState.setCursor(server.id, snap.token)
                }
                token = snap.token
            }

            do {
                val page = try {
                    api.changes(since = token, limit = 500)
                } catch (e: HttpException) {
                    if (e.status == 409 && e.body?.error == "stale_token") {
                        //  server compacted its change log: fall back to a snapshot
                        val snap = api.snapshot()
                        db.withTransaction {
                            repos.forEach { it.replaceAllFromServer(snap) }
                            syncState.setCursor(server.id, snap.token)
                        }
                        return@suspendRunCatching finish(pushed, pulled, server)
                    }
                    throw e
                }

                //  group ids by entity type, hydrate in batches, apply atomically
                val byType = page.changes.groupBy { it.entity }
                db.withTransaction {
                    for ((type, changes) in byType) {
                        val repo = repos.forType(type)
                        val deletedIds = changes.filter { it.op == "delete" }.map { it.id }
                        val upsertIds  = changes.filter { it.op == "upsert" }.map { it.id }

                        if (deletedIds.isNotEmpty()) repo.deleteLocal(deletedIds)
                        if (upsertIds.isNotEmpty()) {
                            //  hydrate in chunks so one request never exceeds server limits
                            upsertIds.chunked(200).forEach { chunk ->
                                val entities = repo.batchGet(chunk)
                                //  IMPORTANT: never clobber a row that still has PENDING outbox ops
                                //  for the same fields — mark it dirty and let the next push reconcile.
                                repo.upsertFromServerPreservingLocal(entities, outbox.pendingIdsFor(type))
                            }
                        }
                    }
                    syncState.setCursor(server.id, page.nextToken)
                    syncState.setLastSuccess(clock.now())
                }
                token = page.nextToken
                pulled += page.changes.size
            } while (page.hasMore)

            finish(pushed, pulled, server)
        }.getOrElse { t ->
            when (t) {
                is CancellationException -> throw t          // never swallow cancellation
                is AuthRevokedException  -> SyncOutcome.Fatal
                is IOException           -> SyncOutcome.Retryable
                else                     -> { logger.e(t); SyncOutcome.Retryable }
            }
        }
    }

    private suspend fun finish(pushed: Int, pulled: Int, server: ServerConfig): SyncOutcome {
        if (pulled > 0) {
            notifications.rescheduleRemindersFromLocalState()   // due dates may have changed remotely
            widgets.refreshAll()
        }
        return SyncOutcome.Success(pushed = pushed, pulled = pulled)
    }
}

// The `suspendRunCatching` helper (Now in Android pattern): like runCatching but rethrows
// CancellationException so structured concurrency is not broken.
suspend fun <T> suspendRunCatching(block: suspend () -> T): Result<T> = try {
    Result.success(block())
} catch (c: CancellationException) {
    throw c
} catch (t: Throwable) {
    Result.success(/* unreachable */).let { Result.failure(t) }
}
```

Companion: `upsertFromServerPreservingLocal`, the one function that prevents the classic "my edit vanished for a
second" bug:

```kotlin
suspend fun upsertFromServerPreservingLocal(
    incoming: List<NetworkTask>,
    idsWithPendingOps: Set<String>,
) {
    val rows = incoming.map { net ->
        val local = taskDao.getById(net.id)
        val entity = net.asEntity()
        when {
            net.id !in idsWithPendingOps -> entity.copy(localDirty = false)
            local == null               -> entity.copy(localDirty = true)
            else -> {
                //  Re-apply the fields this device still has queued, on top of the server row,
                //  so the optimistic UI stays stable until the push lands.
                val pending = outbox.pendingFieldsFor(net.id)     // Map<String, JsonElement>
                entity.applyFields(pending).copy(localDirty = true)
            }
        }
    }
    taskDao.upsertAll(rows)
}
```

Trigger surface:

```kotlin
class SyncScheduler @Inject constructor(private val wm: WorkManager) {

    fun kickSync(reason: String) = wm.enqueueUniqueWork(
        SYNC_ONE_SHOT,
        if (reason == "push") ExistingWorkPolicy.REPLACE else ExistingWorkPolicy.KEEP,
        oneShotSyncWork(),
    )

    fun kickOutboxDrain() = wm.enqueueUniqueWork(
        OUTBOX_DRAIN, ExistingWorkPolicy.APPEND_OR_REPLACE, oneShotSyncWork(),
    )

    fun ensurePeriodic() = wm.enqueueUniquePeriodicWork(
        SYNC_PERIODIC, ExistingPeriodicWorkPolicy.KEEP, periodicSyncWork(),
    )

    fun cancelAll() = wm.cancelAllWorkByTag(TAG_SYNC)   // on logout
}
```

---

## 15. Sources (URLs actually fetched or searched)

**Official Android / Google**
- https://developer.android.com/topic/architecture/data-layer/offline-first — offline-first guidance (reads/writes, sync strategies, LWW, WorkManager)
- https://developer.android.com/topic/architecture/data-layer — data layer
- https://developer.android.com/develop/ui/compose/bom/bom-mapping — Compose BOM → library versions
- https://developer.android.com/jetpack/androidx/releases/compose-material3 — material3 1.4.0 / 1.5.0-alpha25, Expressive promotion history
- https://developer.android.com/develop/ui/compose/designsystems/material3 — MaterialTheme slots, colour roles, typography scale, shapes
- https://developer.android.com/jetpack/androidx/releases/room — Room 2.8.4, SQLiteDriver, Room Gradle plugin
- https://developer.android.com/jetpack/androidx/releases/work — WorkManager 2.11.2 / 2.12.0-beta01, expedited, NetworkRequest constraints, work-analytics
- https://developer.android.com/jetpack/androidx/releases/security — security-crypto 1.1.0, full API deprecation
- https://developer.android.com/jetpack/androidx/releases/datastore — DataStore 1.2.1, datastore-tink AeadSerializer
- https://developer.android.com/jetpack/androidx/releases/navigation3 — Navigation 3 1.1.5 stable
- https://developer.android.com/jetpack/androidx/releases/glance — Glance 1.1.1 / 1.2.0-rc01 / 1.3.0-alpha02
- https://developer.android.com/privacy-and-security/security-config — network security config reference, CT, ECH
- https://developer.android.com/develop/ui/views/notifications/notification-permission — POST_NOTIFICATIONS
- https://developer.android.com/develop/ui/views/launch/shortcuts/creating-shortcuts — static/dynamic/pinned shortcuts
- https://developer.android.com/develop/ui/compose/touch-input/user-interactions/drag-and-drop — Compose DnD API
- https://developer.android.com/develop/ui/compose/layouts/pager — HorizontalPager / PagerState
- https://developer.android.com/topic/performance/baselineprofiles/overview — baseline & startup profiles, AGP matrix
- https://developer.android.com/about/versions/16/behavior-changes-all — Android 16 job quotas, stop reasons
- https://developer.android.com/google/play/requirements/target-sdk + https://support.google.com/googleplay/android-developer/answer/11926878 — targetSdk 36 by 2026-08-31

**Samples / source**
- https://github.com/android/nowinandroid — modularization + sync reference
- https://raw.githubusercontent.com/android/nowinandroid/main/gradle/libs.versions.toml — verbatim version pins
- https://raw.githubusercontent.com/android/nowinandroid/main/docs/ArchitectureLearningJourney.md — data layer, SyncWorker/Synchronizer

**Libraries**
- https://ktor.io/docs/releases.html — Ktor 3.5.1 (2026-06-26)
- https://github.com/square/okhttp/blob/master/CHANGELOG.md — OkHttp 5.4.0
- https://github.com/square/retrofit/blob/trunk/CHANGELOG.md — Retrofit 3.0.0
- https://github.com/Kotlin/kotlinx.serialization/blob/master/CHANGELOG.md — 1.11.0
- https://dagger.dev/hilt/gradle-setup.html + https://github.com/google/dagger/releases — Hilt 2.59.x
- https://insert-koin.io/docs/support/releases/ — Koin BOM 4.1.1
- https://github.com/Calvin-LL/Reorderable/blob/main/README.md — reorderable 3.1.0 API
- https://github.com/kizitonwose/Calendar/blob/main/docs/Compose.md — calendar composables and state APIs
- https://github.com/rocicorp/fractional-indexing — order-key algorithm, BASE_62_DIGITS/BASE_52_DIGITS
- https://observablehq.com/@dgreensp/implementing-fractional-indexing — Greenspan's derivation (page body not retrievable)
- https://www.figma.com/blog/realtime-editing-of-ordered-sequences/ — Figma's arbitrary-precision, base-95 approach
- https://github.com/sqliteai/fractional-indexing — base62 + SQLite BINARY collation rationale

**Push / self-hosting**
- https://unifiedpush.org/developers/spec/android/ — spec AND_3.1.0, intents, extras, VAPID, RFC 8291
- https://unifiedpush.org/users/distributors/ntfy/ and https://docs.ntfy.sh/config/ — ntfy as distributor, `up*` topics, `upstream-base-url`
- https://f-droid.org/docs/Submitting_to_F-Droid_Quick_Start_Guide/ and https://f-droid.org/docs/Reproducible_Builds/ — fdroiddata MR, AllowedAPKSigningKeys

**Conflict resolution background**
- https://dzone.com/articles/conflict-resolution-using-last-write-wins-vs-crdts
- https://www.iankduncan.com/engineering/2025-11-27-crdt-dictionary/ — LWW-Register / OR-Set semantics
- https://confluence.atlassian.com/adminjiraserver/managing-lexorank-938847803.html and https://confluence.atlassian.com/jirakb/troubleshooting-new-ranking-system-issues-779159221.html — LexoRank buckets, 128/160-char rebalance thresholds

---

## 16. UNVERIFIED items — resolve before coding

1. **UnifiedPush `android-connector` Maven coordinates and current version.** The docs pages I fetched did not
   list them (the canonical repo is on Codeberg). Historically `org.unifiedpush.android:connector:*`. The
   `MessagingReceiver` method signatures I sketched in §8.2 are therefore approximate — read the real Dokka
   output before writing the receiver.
2. **`com.kizitonwose.calendar:compose` exact current version.** Only `:data 2.10.1` was visible on libraries.io.
3. **Retrofit 3.x group id** (`com.squareup.retrofit2` vs `com.squareup.retrofit3`). Conflicting sources.
   Moot if you take the Ktor recommendation.
4. **Now in Android `Synchronizer.kt` verbatim source.** Raw-file fetches 404'd; parameter names
   (`versionReader`, `changeListFetcher`, `versionUpdater`, `modelDeleter`, `modelUpdater`) come from Google's
   Horologist port and NiA docs, not from the file itself.
5. **The fractional-indexing pseudocode in §5.6.3.** The repo README and a source-file summary confirmed the
   function names, the alphabets, and the head/length encoding; the branch-level detail is reconstructed from
   the CC0 reference implementation. **Diff it against the real source and port with the upstream test vectors**
   before trusting it.
6. **Certificate Transparency vs custom `X509TrustManager` on API 37+.** Whether CT enforcement is bypassed when
   the app supplies its own trust manager is untested. Verify on an API 37 device.
7. **`Paint.setShadowLayer` in `drawBehind`** across all supported API levels with hardware acceleration.
8. **`actions.intent.CREATE_TASK`** as a currently supported App Actions built-in intent.
9. **Glance 1.2.0 stable status** at implementation time (it was `-rc01` as of 2025-12-03).
10. **ZXing coordinate** for QR pairing (`com.journeyapps:zxing-android-embedded` is the well-known one; I did
    not fetch its current version).
11. **Whether Fem-ho's server will implement RFC 8291/8292.** The whole UnifiedPush path depends on it. If the
    backend cannot, UnifiedPush degrades to unencrypted payloads (allowed by some distributors, discouraged) —
    in which case send an empty body and treat it purely as a wake-up.
