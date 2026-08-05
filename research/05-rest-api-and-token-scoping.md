# Fem-ho — Dossier 05: REST API design, scoped API keys, and auth

> **DELIVERY NOTE.** The orchestrator asked for this file at
> `/private/tmp/claude-501/-Users-borja-Codi-fem-ho/4ee9f810-66f8-4e6f-86dc-06e906a11d09/scratchpad/research/05-rest-api-and-token-scoping.md`.
> This session is running in **plan mode**, which permits writing only to this plan file.
> The dossier content is complete and correct; copy it to the intended path when writes are allowed.

Research date: 2026-08-05. Every version number, header name, RFC number and field name below
was read from a primary source fetched during this session unless explicitly tagged **UNVERIFIED**.

---

## 0. Executive decisions (read this if you read nothing else)

| Question | Decision for Fem-ho | Why |
|---|---|---|
| Pagination | **Cursor (keyset)**, opaque base64url token, `?limit=&cursor=` → `{"items":[...],"next_cursor":"..."}` | Kanban columns are append-heavy; offset pages skip/duplicate rows under concurrent inserts. |
| PATCH format | **JSON Merge Patch (RFC 7386)**, `application/merge-patch+json` | `null` = clear field is exactly the semantic Fem-ho needs (clear due date, unassign). Array reordering handled by dedicated action endpoints instead. |
| Concurrency | **ETag + `If-Match`** on every task/checklist mutation; `412` on mismatch | Offline-first Android needs deterministic conflict detection. |
| Idempotency | **`Idempotency-Key`** header on all `POST` that create | Android replays queued creates after reconnect. |
| Errors | **RFC 9457 `application/problem+json`** with a stable `type` URI registry | Machine-readable; Catalan `title` via `Accept-Language`. |
| Sessions | **Opaque server-side sessions**, not stateless JWT | Single self-hosted backend; instant revocation beats statelessness. Cookie for web, bearer for Android. |
| Password hashing | **Argon2id, m=19456 KiB, t=2, p=1** (OWASP min) — raise to m=65536, t=3, p=1 if the box has RAM | OWASP Password Storage Cheat Sheet, RFC 9106 second-recommended option. |
| Token format | `femho_pat_<base62>` / `femho_ai_<base62>` / `femho_cal_<base62>` with CRC32 checksum suffix | GitHub's prefix+checksum design lets you reject fakes without a DB hit and lets secret scanners find leaks. |
| Token scopes | **`resource:action@scope/project` grant strings**, stored as JSON, capabilities can only *narrow* the owning user's rights | Combines GitHub fine-grained PAT (resource+level+target) with Stripe RAK (write implies read). |
| Human vs AI token | **Same codebase, same policy engine.** Token type only builds a different `Principal`. | Zero duplicated authorization logic; audit trail gets `actor_type` for free. |
| Realtime | **SSE** (`text/event-stream`), resumable via `Last-Event-ID` = activity-log sequence | Server→client only; auto-reconnect built in; no sticky sessions; works behind any reverse proxy. |
| Webhooks out | **Standard Webhooks** spec: `webhook-id`, `webhook-timestamp`, `webhook-signature: v1,<b64 hmac>` | n8n and most consumers already understand it; unambiguous replay protection. |
| Rate limits | `RateLimit` + `RateLimit-Policy` per draft-ietf-httpapi-ratelimit-headers-11 | Standards-track, structured fields, expresses multiple windows. |
| Audit | Append-only `activity_event` table; every write tagged with acting principal | Doubles as the SSE event source *and* the Android delta-sync cursor. |

---

## 1. Resource model and URL design

### 1.1 Entity inventory

The Fem-ho domain, with the API resource name each maps to:

| Domain concept (Catalan) | Entity | REST collection | Notes |
|---|---|---|---|
| Usuari | `user` | `/users` | includes the AI user(s) |
| Àmbit | `scope` | `/scopes` | Personal / Feina / Família + user-created; individual or collective |
| Membre d'àmbit | `scope_member` | `/scopes/{id}/members` | role: owner/admin/member/viewer |
| Projecte | `project` | `/projects` | belongs to exactly one scope |
| Tasca | `task` | `/tasks` | has `column` ∈ inbox/todo/doing/done |
| Subtasca | `subtask` | `/tasks/{id}/subtasks` | a `task` with `parent_task_id`; see §1.3 |
| Llista simple / checklist | `checklist` | `/checklists` | attachable to a task or subtask, pinnable |
| Element de checklist | `checklist_item` | `/checklists/{id}/items` | |
| Comentari | `comment` | `/tasks/{id}/comments` | |
| Adjunt | `attachment` | `/tasks/{id}/attachments` | |
| Activitat | `activity_event` | `/activity` | append-only; read-only over HTTP |
| Enllaç compartit | `share` | `/shares` | task-with-subtasks or checklist |
| Calendari CalDAV | `calendar` | `/calendars` | one per scope and/or per project |
| Token / clau API | `token` | `/tokens` | PAT, AI token, CalDAV app-password |
| Webhook sortint | `webhook` | `/webhooks` | |
| Sessió | `session` | `/sessions` | device list, revocable |

### 1.2 Nesting depth rule

**Maximum one level of nesting, and only when the child cannot exist without the parent.**

Good:
```
GET  /api/v1/scopes/{scope_id}/members
GET  /api/v1/checklists/{checklist_id}/items
POST /api/v1/tasks/{task_id}/comments
```

Bad (do not do this):
```
GET /api/v1/scopes/{s}/projects/{p}/tasks/{t}/subtasks/{st}/comments/{c}
```

Rationale: deep nesting forces the client to know the whole ancestry to build a URL, breaks when
a task moves between projects (quick-add `#Feina/Web` re-routing does exactly that), and makes
caching/ETag invalidation ugly. Instead:

- Every entity is addressable **flat** by its own id: `/api/v1/tasks/{task_id}`.
- Parent/child relationships are expressed as **filters**: `/api/v1/tasks?project_id=pr_123`.
- Nested collections exist **only** as a convenience for creation and listing of owned children.

### 1.3 Subtasks: one table, one resource

Model subtasks as tasks with `parent_task_id`. This buys you, for free:
- subtasks can have their own assignee (`@person`), due date, and AI-delegation mode;
- the same policy check applies at every level;
- `GET /tasks/{id}?expand=subtasks` returns the tree the share link needs.

Constrain depth to **2 levels** (task → subtask) in the API layer. Deeper trees make the kanban
board and the CalDAV `RELATED-TO` mapping ambiguous. Return `422` with
`type: /errors/subtask-depth-exceeded` if a client tries to nest a subtask under a subtask.

`GET /api/v1/tasks/{id}/subtasks` is the convenience alias for
`GET /api/v1/tasks?parent_task_id={id}&sort=position`.

### 1.4 Identifiers

Use **prefixed, sortable, opaque string ids** — not bare integers, not bare UUIDs:

```
usr_01JQ8F3K2M7X…     user
scp_01JQ8F3K2M7X…     scope
prj_01JQ8F3K2M7X…     project
tsk_01JQ8F3K2M7X…     task
chk_01JQ8F3K2M7X…     checklist
cki_01JQ8F3K2M7X…     checklist item
cmt_…, att_…, shr_…, cal_…, tok_…, whk_…, evt_…
```

Body = **ULID** or UUIDv7 (both are lexicographically sortable by creation time, which makes
keyset pagination trivial and makes B-tree index locality good). Prefixes make logs readable,
make it impossible to pass a project id where a task id is expected, and let the router reject
malformed ids before touching the database.

**What Fem-ho should do:** store the ULID/UUIDv7 as the native DB type (`uuid` in Postgres) and
render the prefix at the serialization boundary only. Never store the prefixed string.

### 1.5 Base path and versioning

```
/api/v1/...
```

Version in the path, not in a header. Reasons specific to Fem-ho: the Android login screen asks
for a **server URL**, and the app must be able to probe compatibility before authenticating.
Expose an unauthenticated discovery document:

```http
GET /.well-known/femho HTTP/1.1

200 OK
Content-Type: application/json

{
  "product": "femho",
  "server_version": "1.4.2",
  "api_versions": ["v1"],
  "api_base": "/api/v1",
  "caldav_base": "/dav",
  "mcp_base": "/mcp",
  "sse_endpoint": "/api/v1/events/stream",
  "auth": { "password": true, "totp": true, "oidc": false },
  "limits": { "max_attachment_bytes": 26214400, "max_page_size": 200 },
  "instance_name": "Casa Balsera"
}
```

This is how the Android app validates "is this really a Fem-ho server, and can I talk to it?"
before the user types a password. It must not require auth and must not leak user data.

### 1.6 Naming conventions

- Collections plural, lowercase, `snake_case` if multi-word: `/checklist_items` — but prefer
  single-word resources so this never comes up.
- JSON field names: **`snake_case`**. Consistent with CalDAV/iCal tooling being generated
  server-side and with most Python/Go/Rust ecosystems. Pick one and never mix.
- Booleans: `is_`/`has_` prefix is optional but be consistent — `is_pinned`, `is_archived`.
- Timestamps: RFC 3339 UTC with `Z`, field names ending `_at`: `created_at`, `updated_at`,
  `completed_at`, `due_at`. Date-only fields end `_on`: `due_on` for all-day tasks.
- Enum values: lowercase snake, and **never renumber**. `column`: `inbox|todo|doing|done`.
  Keep the API enum in English even though the UI is Catalan — the UI layer translates
  (`inbox`→"Safata d'entrada", `todo`→"Per fer", `doing`→"Fent", `done`→"Fet").

**What Fem-ho should do:** the wire protocol is English/stable; Catalan lives in the UI and in
`Accept-Language`-negotiated `title`/`detail` of problem documents. Never put Catalan strings in
enum values — a future language switch would break every stored token scope and webhook filter.

### 1.7 Canonical task representation

```json
{
  "id": "tsk_01JQ8F3K2M7XA4B9CDEF",
  "object": "task",
  "title": "Portar el cotxe a l'ITV",
  "description": "Cita a les 9:00, portar la fitxa tècnica",
  "description_format": "markdown",
  "scope_id": "scp_01JQ8F3K2M7XFEINA00",
  "project_id": null,
  "parent_task_id": null,
  "column": "todo",
  "position": "0|hzzzzz:",
  "priority": 2,
  "assignee_ids": ["usr_01JQ8F3K2M7XBORJA0"],
  "labels": ["cotxe", "urgent"],
  "due_at": "2026-09-14T07:00:00Z",
  "due_on": null,
  "start_at": null,
  "all_day": false,
  "rrule": null,
  "reminders": [{ "trigger": "-PT1H", "method": "push" }],
  "execution_mode": "self",
  "ai_delegation": null,
  "checklist_ids": ["chk_01JQ8F3K2M7XLLIST0"],
  "subtask_count": 3,
  "subtask_done_count": 1,
  "comment_count": 0,
  "attachment_count": 1,
  "caldav_uid": "tsk_01JQ8F3K2M7XA4B9CDEF@femho",
  "caldav_etag": "\"7f3a9c\"",
  "completed_at": null,
  "created_at": "2026-08-01T10:14:22Z",
  "updated_at": "2026-08-04T18:02:11Z",
  "created_by": { "type": "user", "id": "usr_01JQ8F3K2M7XBORJA0" },
  "updated_by": { "type": "ai", "id": "usr_01JQ8F3K2M7XAIUSER" },
  "sequence": 918273
}
```

Field notes that matter for implementation:

- **`object`** — a discriminator string on every entity. Makes polymorphic responses (search,
  activity feed, MCP tool results) self-describing and makes generated TS unions trivial.
- **`position`** — a **fractional/lexicographic rank string** (LexoRank-style), not an integer.
  Dragging a card between two cards computes a key strictly between its neighbours and issues a
  single-row `PATCH`. Integer `position` forces renumbering every card in the column, which is
  catastrophic for offline-first sync (every reorder becomes N conflicting writes).
  **UNVERIFIED:** specific LexoRank library recommendations — pick per language, the algorithm is
  trivial to implement (base-62 midpoint string).
- **`execution_mode`** — `self` | `ai_assisted` | `ai_delegated`. This is the do-it-myself /
  AI-assisted / AI-delegated switch. `ai_delegation` carries `{ "agent_user_id", "status",
  "requested_at", "brief" }` when non-null.
- **`sequence`** — a monotonically increasing per-instance integer bumped on every write, taken
  from the same sequence as `activity_event.id`. This single field powers ETags, delta sync and
  SSE resumption. See §5, §12, §16.
- **`caldav_etag`** — exposed so the API client and the CalDAV client can reason about the same
  version. See dossier on CalDAV.
- **`created_by` / `updated_by`** — always an object with `type` ∈ `user|ai|share_guest|system`,
  never a bare id. This is what makes the UI able to render "modificat per la IA".

### 1.8 Expansion instead of N+1

```
GET /api/v1/tasks/tsk_123?expand=subtasks,checklists,comments,assignees
GET /api/v1/tasks?scope_id=scp_feina&expand=assignees
```

Rules:
- `expand` accepts a comma-separated allow-list per endpoint; unknown values → `400` with
  `type: /errors/invalid-expand`.
- Expansion is at most one level deep. `expand=subtasks.comments` is rejected.
- Expanded relations replace the `*_ids` array with a `*` array of full objects; the `_ids`
  array is still present so clients that ignore `expand` do not break.

**What Fem-ho should do:** the kanban board issues exactly **one** request per view:
`GET /api/v1/tasks?scope_id[]=…&scope_id[]=…&project_id=…&expand=assignees&limit=200`.
The calendar view issues one more for the date window. Do not build a board that needs a request
per column — the four columns are a client-side grouping of one result set.

---

## 2. Filtering, sorting, pagination

### 2.1 Filtering grammar

Keep it flat and boring. Query parameters, `AND` semantics between different params, `OR`
semantics within a repeated param:

```
GET /api/v1/tasks
    ?scope_id=scp_feina&scope_id=scp_personal      # OR within, this is the scope-chip multi-select
    &project_id=prj_web
    &column=todo&column=doing                      # OR within
    &assignee_id=usr_borja
    &label=urgent
    &execution_mode=ai_delegated
    &q=ITV                                         # free-text
    &due_before=2026-09-01T00:00:00Z
    &due_after=2026-08-01T00:00:00Z
    &completed=false
    &parent_task_id=null                           # literal "null" = top-level only
    &updated_since=2026-08-04T00:00:00Z
    &sort=-due_at,position
    &limit=100
    &cursor=eyJzIjo5MTgyNzMsImkiOiJ0c2tfMDFK…
```

Conventions:
- Repeat the parameter for OR (`scope_id=a&scope_id=b`). Do **not** invent `scope_id=a,b` —
  it breaks the moment an id can contain a comma, and it makes the OpenAPI schema lie.
  (If your framework needs it, `style: form, explode: true` in OpenAPI describes the repeated form.)
- Range filters use `_before` / `_after` suffixes (exclusive/inclusive documented per field).
  Avoid `filter[due_at][gte]=` bracket syntax — it is unpleasant to type, hostile to
  OpenAPI codegen, and nothing in Fem-ho needs its expressiveness.
- `null` as a literal string value means "IS NULL". Document it. Reject it where meaningless.
- Unknown query parameters → **ignore silently is wrong**; return `400` with a problem document
  listing the offending params. Silent ignoring is how "why is my filter not working" bugs are born.

### 2.2 Sorting

```
&sort=-due_at,position
```
Comma-separated field list, `-` prefix = descending. Allow-list the sortable fields per resource
and return `400 /errors/invalid-sort` otherwise. Always append a **tiebreaker** (`id`) internally
so ordering is total — otherwise cursor pagination is unstable.

Default sorts:
- `/tasks` → `position` ascending (kanban order) with `id` tiebreaker.
- `/tasks` when `q` is present → relevance, then `-updated_at`.
- `/activity` → `-id` (newest first).
- `/comments` → `created_at` ascending.

### 2.3 Cursor vs offset — recommendation and reasoning

**Use cursor (keyset) pagination. Do not offer `offset`/`page` at all.**

Verified conventions worth copying (Google AIP-158, fetched):

> "Page tokens provided by APIs **must** be opaque (but URL-safe) strings, and **must not** be
> user-parseable." — AIP-158
>
> "Base-64 encoding an otherwise-transparent page token is **not** a sufficient obfuscation
> mechanism." — AIP-158
>
> "The `page_size` field **must not** be required." / "If the user specifies `page_size` greater
> than the maximum permitted by the API, the API **should** coerce down to the maximum permitted
> page size." / "If the user specifies a negative value for `page_size`, the API **must** send an
> `INVALID_ARGUMENT` error." — AIP-158
>
> "The user is expected to keep all other arguments to the RPC the same; if any arguments are
> different, the API **should** send an `INVALID_ARGUMENT` error." — AIP-158
>
> "If the end of the collection has been reached, the `next_page_token` field **must** be empty."
> — AIP-158

Why cursor for Fem-ho specifically:

1. **Correctness under concurrent writes.** A family board gets new tasks while someone is
   scrolling. `OFFSET 100` after two inserts silently re-shows two rows and skips none — or the
   reverse on delete. Keyset pagination anchored on `(sort_key, id)` is immune.
2. **Performance.** `OFFSET 10000` makes Postgres scan and discard 10 000 rows. Keyset is a
   single index seek: `WHERE (position, id) > ($1, $2) ORDER BY position, id LIMIT $3`.
3. **The Android delta sync already needs a cursor.** `sequence`-based cursors for `/sync` and
   keyset cursors for list endpoints are the same mental model; introducing offset as a second
   model doubles the surface area for bugs.
4. **Deep pagination is not a product requirement.** Nobody jumps to page 47 of a task list.
   Where a total is genuinely wanted (a "1 248 tasques" badge), expose a separate cheap
   `GET /api/v1/tasks/count?…` returning `{"count": 1248, "is_estimate": false}` rather than
   paying for `COUNT(*)` on every page.

Cursor encoding (opaque to clients, versioned internally):

```jsonc
// before encoding — never exposed
{ "v": 1, "k": ["0|hzzzzz:", "tsk_01JQ8F3K2M7XA4B9CDEF"], "h": "e3b0c442" }
```
`k` = the tuple of sort-key values of the last row returned; `h` = a short hash of the *filter and
sort parameters*. On the next request, recompute `h` from the incoming params; if it differs,
return `400 /errors/cursor-parameter-mismatch`. Then `base64url(json)`. Encrypt or HMAC it if you
want to guarantee opacity — AIP-158's warning about base64 not being obfuscation applies, but for
a self-hosted personal app an HMAC tag is sufficient and cheap.

Response envelope for collections:

```json
{
  "object": "list",
  "items": [ /* … */ ],
  "next_cursor": "eyJ2IjoxLCJrIjpb…",
  "has_more": true
}
```

- `next_cursor` is `null` and `has_more` is `false` at the end of the collection.
- `limit` default 50, maximum 200, coerced down (not rejected) when exceeded, per AIP-158.
- Negative or non-integer `limit` → `400 /errors/invalid-limit`.

Also return the `Link` header for `rel="next"` so generic HTTP tooling (and n8n's HTTP node) can
follow pages without understanding the body:

```
Link: </api/v1/tasks?scope_id=scp_feina&limit=50&cursor=eyJ2IjoxLCJrIjpb…>; rel="next"
```

**What Fem-ho should do:** single pagination model, cursor only, `limit`+`cursor` in, `items`+
`next_cursor`+`has_more`+`Link: rel=next` out, and a separate `/count` endpoint for badges.

---

## 3. PATCH semantics

### 3.1 The two candidates, verified

**JSON Merge Patch — RFC 7386**, media type **`application/merge-patch+json`**.

Algorithm (from the RFC): `MergePatch(Target, Patch)` — if `Patch` is an object, for each
name/value pair: if the value is `null`, remove that member from `Target`; otherwise recursively
`MergePatch(Target[Name], Value)`. If `Patch` is not an object, the entire `Target` is replaced.

> "Null values in the merge patch are given special meaning to indicate the removal of existing
> values in the target." — RFC 7386
>
> "It is not possible to patch part of a target that is not an object, such as to replace just
> some of the values in an array." — RFC 7386

Verified example rows from the RFC's appendix:
```
{"a":"b"}      + {"a":"c"}     →  {"a":"c"}
{"a":"b"}      + {"a":null}    →  {}
{"a":["b"]}    + {"a":"c"}     →  {"a":"c"}
["a","b"]      + ["c","d"]     →  ["c","d"]
```

**JSON Patch — RFC 6902**, media type **`application/json-patch+json`**. Six operations with
their required members:

| op | required members |
|---|---|
| `add` | `op`, `path`, `value` |
| `remove` | `op`, `path` |
| `replace` | `op`, `path`, `value` |
| `move` | `op`, `path`, `from` |
| `copy` | `op`, `path`, `from` |
| `test` | `op`, `path`, `value` |

Error semantics (from the RFC): a failed `test` terminates evaluation and **no changes are
applied**; a missing target path for `remove`/`replace`/`move` fails the whole patch; `add`
tolerates a missing target but requires the parent object or array to exist.

Literal example from RFC 6902:
```json
[
  { "op": "test",    "path": "/a/b/c", "value": "foo" },
  { "op": "remove",  "path": "/a/b/c" },
  { "op": "add",     "path": "/a/b/c", "value": [ "foo", "bar" ] },
  { "op": "replace", "path": "/a/b/c", "value": 42 },
  { "op": "move",    "from": "/a/b/c", "path": "/a/b/d" },
  { "op": "copy",    "from": "/a/b/d", "path": "/a/b/e" }
]
```

### 3.2 Recommendation for Fem-ho

**Primary: JSON Merge Patch.** Accept `Content-Type: application/merge-patch+json` and also
accept plain `application/json` on `PATCH` treating it as merge-patch (with a documented note),
because half the HTTP clients in the world — including n8n's default HTTP node and most Kotlin
clients — will send `application/json` regardless.

Why merge-patch wins here:
- The dominant Fem-ho mutation is "set/clear a handful of scalar fields on one task". Merge patch
  expresses that in the most obvious possible JSON: `{"due_at": null, "column": "doing"}`.
- `null` = clear is precisely the product semantic: unassign, clear due date, detach from project.
  There is no field in the task model where "explicitly set to JSON null" and "remove" differ.
- It round-trips naturally with a form-diff on the client: take the original object, take the
  edited object, emit only changed keys with `null` for cleared ones.
- JSON Patch's `test` op is genuinely useful for optimistic concurrency — but `If-Match` with
  ETags (§5) does the same job at the HTTP layer, uniformly, for every resource, and is
  understood by caches and proxies.

**The trap and how to avoid it.** Merge patch cannot express "append one label" or "move this
subtask to position 3". Do **not** solve this by bolting JSON Patch on. Solve it with
**explicit action sub-resources**, which are also what the MCP server and quick-add want:

```http
POST /api/v1/tasks/{id}/move            {"column":"doing","before_task_id":"tsk_…"}
POST /api/v1/tasks/{id}/complete        {}                      # sets column=done, completed_at
POST /api/v1/tasks/{id}/reopen          {}
POST /api/v1/tasks/{id}/assign          {"user_ids":["usr_…"], "mode":"add"}    # add|remove|set
POST /api/v1/tasks/{id}/labels          {"add":["urgent"],"remove":["baixa"]}
POST /api/v1/tasks/{id}/delegate        {"agent_user_id":"usr_ai","brief":"…"}
POST /api/v1/checklists/{id}/items/{iid}/toggle   {}
POST /api/v1/checklists/{id}/reorder    {"item_ids":["cki_…","cki_…"]}
```

These are idempotent-friendly, individually authorizable (a scope grammar can allow `tasks:write`
but deny `tasks:delegate`), individually rate-limitable, and they produce clean, readable verbs in
the activity log (`moved`, `completed`, `delegated`) instead of a diff the UI must interpret.

**Rules to enforce:**
- `PATCH` never changes `id`, `object`, `created_at`, `created_by`, `sequence`, `caldav_uid`.
  Sending them → `422 /errors/immutable-field` listing the offending pointers. (Silently ignoring
  them is OWASP API3:2023 territory — Broken Object Property Level Authorization.)
- `PATCH` on a field the principal's capabilities do not cover → `403`, and the response must
  name the missing capability (see §11.6).
- `PUT` is not offered on tasks. Full-replacement PUT plus offline clients is a data-loss machine.
  `PUT` exists only on genuinely idempotent whole-value resources: `PUT /api/v1/users/me/avatar`,
  `PUT /api/v1/scopes/{id}/members/{user_id}` (set role).

**What Fem-ho should do:** merge-patch for field edits, action endpoints for everything
structural, `If-Match` mandatory on both, and a documented immutable-field list.

---

## 4. Bulk endpoints

Multi-select on a kanban board (select 8 cards, drag to "Fet") and the AI agent ("close all
overdue tasks in Feina") both need batching. Two patterns; use both, for different jobs.

### 4.1 Homogeneous bulk actions — preferred

```http
POST /api/v1/tasks/bulk/complete
Content-Type: application/json
Idempotency-Key: "9d3c1e5a-…"

{ "task_ids": ["tsk_a","tsk_b","tsk_c"], "atomic": false }
```

Response `207`-style envelope (use HTTP `200` with a per-item result array — do **not** use
`207 Multi-Status`, it is WebDAV-shaped and confuses generated clients):

```json
{
  "object": "bulk_result",
  "succeeded": 2,
  "failed": 1,
  "results": [
    { "id": "tsk_a", "status": 200, "task": { /* … */ } },
    { "id": "tsk_b", "status": 200, "task": { /* … */ } },
    { "id": "tsk_c", "status": 403,
      "problem": {
        "type": "https://femho.app/errors/insufficient-scope",
        "title": "El testimoni no té permís sobre aquest àmbit",
        "status": 403,
        "required_capability": "tasks:write@familia"
      } }
  ]
}
```

- `atomic: true` → all-or-nothing in one transaction; any failure rolls back and the top-level
  response is `409`/`403`/`422` describing the first failure.
- `atomic: false` (default) → best-effort, per-item results as above, top-level `200`.
- Cap `task_ids` at **100** per call; over the cap → `422 /errors/bulk-too-large` with `max: 100`.
- The bulk endpoint writes **one activity event per affected entity** plus one
  `batch_id` correlating them, so the UI can render "8 tasques mogudes a Fet" as a single line
  and still have per-task history.

Provide bulk variants only for the operations that actually get multi-selected:
`bulk/complete`, `bulk/reopen`, `bulk/move`, `bulk/assign`, `bulk/delete`, `bulk/labels`.

### 4.2 Heterogeneous batch — for MCP and offline flush

The Android app comes back online with a queue of 40 mixed operations. Give it one endpoint:

```http
POST /api/v1/batch
Content-Type: application/json
Idempotency-Key: "…"

{
  "atomic": false,
  "operations": [
    { "op_id": "1", "method": "POST",  "path": "/tasks",
      "body": { "title": "Comprar pa", "scope_id": "scp_familia", "column": "inbox" },
      "idempotency_key": "c1f2…" },
    { "op_id": "2", "method": "PATCH", "path": "/tasks/tsk_a",
      "if_match": "\"918200\"", "body": { "column": "doing" } },
    { "op_id": "3", "method": "POST",  "path": "/tasks/tsk_b/complete" }
  ]
}
```

```json
{
  "object": "batch_result",
  "results": [
    { "op_id": "1", "status": 201, "body": { "id": "tsk_new", "…": "…" } },
    { "op_id": "2", "status": 412,
      "problem": { "type": "https://femho.app/errors/version-conflict", "status": 412,
                   "current_sequence": 918273, "server_state": { /* full current task */ } } },
    { "op_id": "3", "status": 200, "body": { "…": "…" } }
  ]
}
```

Critical detail: on `412` **return the current server state inline** in the problem document.
That saves the offline client a second round trip per conflict and lets it run its merge
immediately. This is the single highest-leverage design choice for the Android sync loop.

Constraints: max 100 operations; only whitelisted `(method, path-pattern)` pairs; every operation
goes through the *same* service layer and the *same* policy check as its individual endpoint —
never a fast path that bypasses authorization (that is exactly OWASP API5:2023).

**What Fem-ho should do:** `POST /api/v1/batch` is the Android reconnect endpoint and the MCP
"apply plan" endpoint. `POST /api/v1/tasks/bulk/*` is the web multi-select endpoint. Both share
the batch executor; only the request parsing differs.

---

## 5. Concurrency control: ETag and If-Match

### 5.1 Verified semantics

From RFC 9110 (HTTP Semantics):
- `If-Match = "*" / 1#entity-tag`.
- Weak validators are marked with the **`W/`** prefix and represent semantic equivalence;
  "weak validators cannot be used for byte range requests and … should only be used when strong
  validators are unavailable."
- "when the evaluation of `If-Match` fails … the server **MUST** respond with the
  **412 (Precondition Failed)** status code."
- **412 Precondition Failed** (§15.5.13): server rejected the request because a precondition
  evaluated to false.
- **428 Precondition Required** — an HTTP status defined outside RFC 9110 (RFC 6585) used to tell
  a client "you must send `If-Match`". **UNVERIFIED** in this session: I did not fetch RFC 6585;
  the 428 semantics quoted here are from general knowledge and should be re-checked against
  RFC 6585 before relying on the exact wording.

### 5.2 Design for Fem-ho

Every single-entity `GET` returns a **strong** ETag derived from the entity's `sequence`:

```
ETag: "918273"
```

Not a hash of the body — a hash changes when you add a field to the serializer, invalidating every
client cache on deploy. The `sequence` is a per-entity version counter bumped in the same
transaction as the write. For expanded representations, use `"918273-e:subtasks,assignees"` so
different expansions do not collide.

Write requests:

```http
PATCH /api/v1/tasks/tsk_01JQ8F3K2M7XA4B9CDEF HTTP/1.1
Content-Type: application/merge-patch+json
If-Match: "918273"

{ "column": "doing" }
```

| Situation | Response |
|---|---|
| ETag matches | `200` + updated entity + new `ETag` |
| ETag stale | `412` + `application/problem+json` incl. `current_sequence` and full `server_state` |
| `If-Match` absent, principal is **web or android** | `428 Precondition Required` |
| `If-Match` absent, principal is **api / mcp / caldav** | allow (last-write-wins) but record `"unconditional": true` in the activity event |
| `If-Match: *` | means "the resource must exist"; allow |

The split matters: forcing every curl/n8n user to fetch-then-patch would make the API miserable to
use, while the first-party clients — which absolutely can track ETags — should be held to the
strict contract. Make the strictness configurable per token:
`constraints.require_if_match: true` on AI tokens is a good default, because an agent writing
blind over a human's edit is the exact failure mode the audit trail exists to prevent.

Conditional GET for cheap polling (CalDAV clients and n8n love this):

```http
GET /api/v1/tasks/tsk_… HTTP/1.1
If-None-Match: "918273"

304 Not Modified
ETag: "918273"
```

Collection-level ETags: for `GET /api/v1/tasks?…` emit
`ETag: W/"<max_sequence_in_result>-<count>"` (weak — it is semantic, not byte-exact) and honour
`If-None-Match` with `304`. This makes the Android app's periodic full-refresh nearly free.

**What Fem-ho should do:** `sequence`-based strong ETags on entities, weak collection ETags,
`412` with inline `server_state`, `428` for first-party clients that forgot `If-Match`, and a
per-token `require_if_match` constraint that defaults to `true` for AI tokens.

---

## 6. Idempotency keys

### 6.1 Verified spec

From **draft-ietf-httpapi-idempotency-key-header** (IETF HTTPAPI WG):

- Header field name: **`Idempotency-Key`**.
- "An Item Structured Header. Its value MUST be a String" (RFC 8941 structured fields).
  Example values: `"8e03978e-40d5-43e8-bc93-6894a57f9324"`,
  `"clkyoesmbgybucifusbbtdsbohtyuuwz"`.
- Servers MAY compute an **idempotency fingerprint** from the request payload (checksum, field
  matching, or request digest) to validate that a reused key carries the same request.
- Concurrent retry while the original is still in flight: the server "SHOULD respond with a
  resource conflict error".
- Duplicate after completion: "The resource SHOULD respond with the result of the previously
  completed operation, success or an error."

Status codes defined by the draft:

| Scenario | Status | Problem title |
|---|---|---|
| Required header missing | `400 Bad Request` | "Idempotency-Key is missing" |
| Key reused with a different payload | `422 Unprocessable Content` | "Idempotency-Key is already used" |
| Concurrent request with the same key | `409 Conflict` | "A request is outstanding for this Idempotency-Key" |

Literal example from the draft:
```http
Idempotency-Key: "8e03978e-40d5-43e8-bc93-6894a57f9324"
```
```http
HTTP/1.1 409 Conflict
Content-Type: application/problem+json

{
  "type": "https://developer.example.com/idempotency",
  "title": "A request is outstanding for this Idempotency-Key"
}
```

Note the quoting: as a structured-field String the value **is quoted on the wire**. Accept
unquoted values too — many clients get this wrong — but emit quoted in examples and docs.

### 6.2 Design for Fem-ho

Storage:

```sql
CREATE TABLE idempotency_record (
  key             TEXT        NOT NULL,
  principal_id    TEXT        NOT NULL,   -- user id or token id: keys are scoped per principal
  method          TEXT        NOT NULL,
  path            TEXT        NOT NULL,
  request_hash    BYTEA       NOT NULL,   -- sha256 of canonical(method, path, body)
  state           TEXT        NOT NULL,   -- 'in_flight' | 'completed'
  response_status INT         NULL,
  response_body   JSONB       NULL,
  response_etag   TEXT        NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (principal_id, key)
);
CREATE INDEX ON idempotency_record (expires_at);
```

Algorithm:
1. `INSERT … ON CONFLICT DO NOTHING` with `state='in_flight'`. If the insert wrote a row, proceed.
2. If it did not, read the existing row.
   - `state='in_flight'` → `409` with `type: /errors/idempotency-in-flight`.
   - `state='completed'` and `request_hash` matches → replay `response_status` + `response_body`
     + `response_etag`, and add `Idempotency-Replayed: ?1`.
   - `state='completed'` and `request_hash` differs → `422` with
     `type: /errors/idempotency-key-reused`.
3. On completion, update the row to `completed` **inside the same transaction as the business
   write**. If they are not in the same transaction you have re-created the problem you are solving.
4. TTL 24 h is plenty for an offline mobile client; make it configurable
   (`FEMHO_IDEMPOTENCY_TTL=24h`). Purge with a periodic job on `expires_at`.

Where to require / accept it:

| Endpoint class | Idempotency-Key |
|---|---|
| `POST /tasks`, `/checklists`, `/comments`, `/projects`, `/scopes`, `/shares` | **required** for `source=android`; accepted from everyone |
| `POST /batch`, `POST /*/bulk/*` | **required** for all principals |
| `POST /tasks/{id}/complete`, `/reopen`, `/move` | accepted (they are naturally idempotent, but the key prevents double activity-log rows) |
| `PATCH`, `PUT`, `DELETE` | not needed — use `If-Match` |
| `GET` | ignored |

**What Fem-ho should do:** the Android outbox generates a UUIDv4 per queued operation at enqueue
time and reuses it across every retry, forever. Combined with `If-Match`, this makes the offline
flush exactly-once in practice. The MCP server does the same per tool invocation, so an agent
retrying a timed-out `create_task` never produces a duplicate.

---

## 7. Errors: RFC 9457 problem+json

### 7.1 Verified spec

RFC 9457 "Problem Details for HTTP APIs" (obsoletes RFC 7807). Media types:
**`application/problem+json`** and **`application/problem+xml`**.

The five standard members:

| member | semantics (quoted/paraphrased from the RFC) |
|---|---|
| `type` | URI reference identifying the problem category. Absent → `about:blank`. "Consumers MUST use the 'type' URI (after resolution, if necessary) as the problem type's primary identifier." |
| `status` | HTTP status code. "The 'status' member, if present, is only advisory; it conveys the HTTP status code used for the convenience of the consumer." |
| `title` | Human-readable summary. "It SHOULD NOT change from occurrence to occurrence of the problem, **except for localization**." |
| `detail` | Occurrence-specific explanation. "The 'detail' string, if present, ought to focus on helping the client correct the problem, rather than giving debugging information." |
| `instance` | URI identifying this specific occurrence; may be dereferenceable for more info. |

Extension members are allowed; "Clients consuming problem details MUST ignore any such extensions
that they don't recognize." Absolute `type` URIs are recommended over relative ones, since
"using relative URIs can cause confusion, and they might not be handled correctly by all
implementations."

The RFC's own multiple-errors example, verbatim:
```json
{
 "type": "https://example.net/validation-error",
 "title": "Your request is not valid.",
 "errors": [
   {
     "detail": "must be a positive integer",
     "pointer": "#/age"
   },
   {
     "detail": "must be 'green', 'red' or 'blue'",
     "pointer": "#/profile/color"
   }
 ]
}
```

### 7.2 Fem-ho problem catalogue

`title` is **localized** — this is explicitly sanctioned by the RFC ("except for localization") and
Fem-ho's UI is Catalan. Negotiate on `Accept-Language`, default `ca`. `type` is **never**
localized and never changes.

Base URI: `https://femho.app/errors/` — a real, resolvable docs page per type is ideal but the URI
only needs to be a stable identifier. Serve them from the instance too
(`{server}/docs/errors/{slug}`) so an air-gapped self-hosted install can still resolve them.

```json
{
  "type": "https://femho.app/errors/insufficient-scope",
  "title": "El testimoni no té permisos suficients",
  "status": 403,
  "detail": "Aquest testimoni pot llegir tasques de l'àmbit «Feina» però no modificar-les.",
  "instance": "/api/v1/tasks/tsk_01JQ8F3K2M7XA4B9CDEF",
  "request_id": "req_01JQ8F9ZZZ",
  "required_capability": "tasks:write@feina",
  "granted_capabilities": ["tasks:read@feina", "checklists:read@feina"],
  "docs": "https://femho.app/docs/tokens#scopes"
}
```

Full catalogue for v1:

| `type` slug | HTTP | When |
|---|---|---|
| `validation-failed` | 422 | body failed schema validation; carries `errors[]` with `pointer` + `detail` |
| `invalid-parameter` | 400 | bad query param (unknown filter, bad `sort`, bad `limit`) |
| `invalid-expand` | 400 | unknown `expand` value |
| `cursor-parameter-mismatch` | 400 | cursor replayed with different filters |
| `malformed-json` | 400 | body is not parseable JSON |
| `unauthenticated` | 401 | missing/invalid credential; include `WWW-Authenticate: Bearer` |
| `session-expired` | 401 | valid but expired session/refresh token |
| `totp-required` | 401 | password ok, second factor needed; extension `totp_challenge_id` |
| `insufficient-scope` | 403 | token lacks the capability; extensions as above |
| `forbidden` | 403 | user is not a member of the scope, or role too low; extension `required_role` |
| `not-found` | 404 | entity missing **or** invisible to this principal (never distinguish — API1:2023) |
| `method-not-allowed` | 405 | |
| `conflict` | 409 | e.g. duplicate scope slug, duplicate email |
| `idempotency-in-flight` | 409 | per the Idempotency-Key draft |
| `version-conflict` | 412 | `If-Match` failed; extensions `current_sequence`, `server_state` |
| `precondition-required` | 428 | first-party client omitted `If-Match` |
| `idempotency-key-reused` | 422 | key reused with different payload |
| `immutable-field` | 422 | patch touched `id`/`created_at`/… ; `errors[].pointer` names them |
| `subtask-depth-exceeded` | 422 | nesting beyond 2 levels |
| `bulk-too-large` | 422 | over the 100-item cap; extension `max` |
| `attachment-too-large` | 413 | extension `max_bytes` |
| `unsupported-media-type` | 415 | wrong `Content-Type` on PATCH |
| `rate-limited` | 429 | with `RateLimit`, `RateLimit-Policy`, `Retry-After` |
| `share-expired` | 410 | public share link past `expires_at` |
| `share-password-required` | 401 | share needs a password; extension `share_id` |
| `internal-error` | 500 | never leak stack traces; always carry `request_id` |
| `service-unavailable` | 503 | with `Retry-After` |

Cross-cutting rules:
- **Every** error response carries `request_id`, which is also emitted in the access log and in
  the `X-Request-Id` response header. Support requests become greppable.
- `404` vs `403`: if the principal cannot see the scope at all, return **`404 not-found`**, not
  `403`. Distinguishing them is an object-existence oracle (OWASP API1:2023 Broken Object Level
  Authorization). Return `403 forbidden` only when the principal *can* see the entity but lacks
  the action.
- Set `Content-Type: application/problem+json` — not `application/json`. Generated clients and
  Spring/FastAPI middlewares branch on it.
- `WWW-Authenticate` on 401: `Bearer realm="femho", error="invalid_token"`.

**What Fem-ho should do:** define the catalogue as a single source-of-truth enum in the backend
(slug → HTTP status → Catalan/English/Spanish title), generate both the OpenAPI `components.responses`
entries and the docs page from it, and make it impossible to return an ad-hoc error string.
Add a test that asserts every 4xx/5xx response in the integration suite has a `type` from the enum.

---

## 8. OpenAPI 3.1 / 3.2

### 8.1 Version facts (verified)

| Version | Released |
|---|---|
| OAS 3.1.0 | 16 February 2021 (blog announcement 18 Feb 2021) |
| OAS 3.0.4 | 24 October 2023 |
| OAS 3.1.1 | 24 October 2023 |
| OAS 3.1.2 | 19 September 2025 |
| **OAS 3.2.0** | **19 September 2025** — current |

(The 3.1.0 date is from the OpenAPI Initiative announcement post; the rest from the spec index and
release list. The 3.2.0 date "19 September 2025" is stated in the header of
`https://spec.openapis.org/oas/latest.html`.)

Top-level fields of the OpenAPI Object in 3.2.0, with required-ness:

| field | required |
|---|---|
| `openapi` | **yes** |
| `info` | **yes** |
| `jsonSchemaDialect` | no |
| `servers` | no |
| `paths` | no\* |
| `webhooks` | no\* |
| `components` | no\* |
| `security` | no |
| `tags` | no |
| `externalDocs` | no |

\* "at least one of the `components`, `paths`, or `webhooks` fields MUST be present."

What 3.1 changed vs 3.0 that matters for Fem-ho:
- Schema Object is a **superset of JSON Schema Draft 2020-12** — full `$ref` siblings,
  `unevaluatedProperties`, `if/then/else`, `const`.
- **`nullable` is gone.** Use `type: ["string","null"]`. This matters a lot for merge-patch
  schemas where `null` is meaningful.
- `exclusiveMaximum`/`exclusiveMinimum` are numbers, not booleans.
- `jsonSchemaDialect` sets the default `$schema` for Schema Objects.
- **`webhooks`** is a top-level element alongside `paths` — this is exactly where Fem-ho's
  outbound webhook payloads (§17) belong, documented as first-class API surface.

What 3.2.0 adds that Fem-ho can use:
- **Server-Sent Events / sequential media types via `itemSchema`** — you can finally describe the
  `text/event-stream` endpoint (§16) properly instead of hand-waving it.
- `QUERY` and other HTTP methods via `additionalOperations`.
- Tag `summary`, `parent`, `kind` for nested/organized tag trees — useful when you have `tasks`,
  `checklists`, `tokens`, `caldav`, `mcp` groupings.
- OAuth2 Device Authorization flow and `deprecated` on security schemes.

**Recommendation:** target **3.1.1** for the emitted document (maximum tool compatibility today —
most generators still choke on 3.2 constructs) and keep an eye on 3.2 for the SSE `itemSchema`
support. Set `jsonSchemaDialect: https://spec.openapis.org/oas/3.1/dialect/base`.
**UNVERIFIED:** which specific generators currently support 3.2.0 — check before switching.

### 8.2 Generating it, and keeping it honest

Two approaches. Pick **code-first with contract enforcement**, not hand-written YAML.

Hand-written spec: rots within two sprints; nobody remembers to add the new field.
Code-first generation: matches reality by construction — *if* the framework's introspection is
faithful.

Concretely, whichever backend you pick:
- **Python/FastAPI** — `app.openapi()` emits 3.1 natively in recent versions; annotate response
  models exhaustively, including every error response, or the spec will claim endpoints only ever
  return 200.
- **Go** — `huma` (spec-first-from-code, emits 3.1) or generate from struct tags; avoid
  swaggo-style comment annotations, they drift.
- **Node/TS** — define schemas once in **Zod** or **TypeBox** and emit both the runtime validator
  and the OpenAPI schema from the same object. This is the strongest guarantee: the thing that
  validates the request *is* the thing that documents it.
- **Rust** — `utoipa` / `aide`.

**UNVERIFIED:** exact current versions of huma, utoipa, aide, zod-to-openapi. Do not pin versions
from this dossier; check the registry at implementation time.

**Keeping it honest — three mechanical gates in CI:**

1. **Spec diff gate.** Regenerate `openapi.json` on every build and fail the build if it differs
   from the committed copy without an accompanying changelog entry. This turns every accidental
   API change into a visible, reviewed diff.
2. **Response validation in tests.** Run the integration suite with a middleware that validates
   every outgoing response against the spec and fails the test on mismatch. A response the spec
   does not describe is a bug in one of the two.
3. **Property-based conformance fuzzing.** Point a schema-driven fuzzer at the spec against a
   seeded instance; it will find the endpoints that 500 on `limit=-1` and the ones that return
   `200` where the spec says `404`. **UNVERIFIED:** tool names/versions — Schemathesis and
   Dredd are the usual candidates; verify before adopting.

Additional gates worth having:
- Lint the spec (operationId uniqueness, every operation has a `tag`, every 4xx documented,
  no inline schemas over N lines). **UNVERIFIED:** Spectral/Vacuum versions.
- Assert `operationId` stability: renaming one silently renames a generated client method and
  breaks downstream consumers. Add a test that compares `operationId` sets across versions.

### 8.3 Generating typed clients

**Web front-end (verified versions):**

- `openapi-typescript` — **v7.13.0**, "Convert OpenAPI 3.0 & 3.1 schemas to TypeScript".
- `openapi-fetch` — **v0.17.0**, "Fast, type-safe fetch client for your OpenAPI schema.
  Only 6 kb (min). Works with React, Vue, Svelte, or vanilla JS."

```bash
npx openapi-typescript ./openapi.json -o ./src/api/schema.d.ts
```

```ts
import createClient from "openapi-fetch";
import type { paths } from "./api/schema";

export const api = createClient<paths>({
  baseUrl: "/api/v1",
  credentials: "include",            // session cookie for the web app
  headers: { "Accept-Language": "ca" },
});

const { data, error } = await api.GET("/tasks", {
  params: { query: { scope_id: ["scp_feina"], column: ["todo", "doing"], limit: 100 } },
});
if (error) {
  // error is typed as the problem+json union for this operation
}
```

The value here is that `openapi-typescript` emits **types only** — no runtime, no generated class
hierarchy to review, and the diff on a spec change is a readable type diff. This is much better
suited to a small self-hosted project than a full codegen that produces 200 files.

**Android/Kotlin:** OpenAPI Generator with the `kotlin` generator and `library=jvm-retrofit2` or
`jvm-ktor` produces usable models + API interfaces. **UNVERIFIED:** current OpenAPI Generator
version. Two caveats for Fem-ho:
- Generated models are a poor fit for an offline-first Room database. Generate **DTOs only**, keep
  hand-written Room entities, and map between them. Never let a generated class be your DB entity.
- Configure the generator to emit `kotlinx.serialization` and non-nullable types where the schema
  says so, otherwise everything becomes `String?` and the null-handling rots the whole app.

**MCP server:** generate the tool list from the OpenAPI document rather than hand-maintaining it.
Each safe, well-shaped operation becomes a tool; `operationId` becomes the tool name;
the request-body schema becomes the tool input schema (JSON Schema 2020-12 is already the format
MCP tools use, so 3.1's alignment with 2020-12 makes this a near-identity transform). Filter by an
explicit allow-list — you do not want `DELETE /users/{id}` exposed as an agent tool.

**n8n:** ships a generic HTTP node; the practical deliverable is a documented set of example
requests plus the webhook payloads. Publishing `openapi.json` at
`GET /api/v1/openapi.json` (unauthenticated or session-authenticated) lets users import it.

**What Fem-ho should do:** commit `openapi.json` to the repo, serve it at
`/api/v1/openapi.json`, serve a rendered doc UI at `/api/docs`, regenerate `schema.d.ts` in a
pre-commit hook, and gate merges on the three CI checks above.

---

## 9. Authentication

### 9.1 Password hashing — verified parameters

**OWASP Password Storage Cheat Sheet** — Argon2id, five equivalent configurations:

| memory `m` | iterations `t` | parallelism `p` |
|---|---|---|
| 47104 KiB (46 MiB) | 1 | 1 |
| **19456 KiB (19 MiB)** | **2** | **1** |
| 12288 KiB (12 MiB) | 3 | 1 |
| 9216 KiB (9 MiB) | 4 | 1 |
| 7168 KiB (7 MiB) | 5 | 1 |

**RFC 9106 (Argon2)** parameter choice:
- **First recommended option:** "Argon2id with t=1 iteration, p=4 lanes, m=2^(21) (2 GiB of RAM),
  128-bit salt, and 256-bit tag size".
- **Second recommended option:** "Argon2id with t=3 iterations, p=4 lanes, m=2^(16) (64 MiB of
  RAM), 128-bit salt, and 256-bit tag size".
- On variant choice: "If you do not know the difference between the types or you consider
  side-channel attacks to be a viable threat, choose Argon2id."
- On salt: "A length of 128 bits is sufficient for all applications but can be reduced to 64 bits
  in the case of space constraints."

Other verified OWASP numbers, for context and for migration paths:
- **bcrypt** — work factor minimum **10**; input limited to **72 bytes**. If pre-hashing:
  `bcrypt(base64(hmac-sha384(data:$password, key:$pepper)), $salt, $cost)`.
- **scrypt** — `N=2^17, r=8, p=1` (128 MiB) … down to `N=2^13, r=8, p=10` (8 MiB).
- **PBKDF2-HMAC-SHA256** — 600 000 iterations; **PBKDF2-HMAC-SHA512** — 220 000;
  PBKDF2-HMAC-SHA1 — 1 400 000 (legacy only). *(The SHA-1 figure as read from the cheat sheet on
  2026-08-05; other published figures cite 1 300 000. Do not use SHA-1 anyway.)*

**Recommendation for Fem-ho:**

```
Algorithm: Argon2id
Default:   m = 65536 KiB (64 MiB), t = 3, p = 1, salt = 16 bytes, tag = 32 bytes
Floor:     m = 19456 KiB (19 MiB), t = 2, p = 1     # OWASP minimum, for tiny NAS boxes
```

Reasoning: RFC 9106's *second recommended option* is `t=3, p=4, m=64 MiB`. Reduce `p` to **1**
because a self-hosted family server has few cores and a login burst of 4 threads per attempt is
worse than useless; `p=1` also makes the cost model predictable. 64 MiB × a handful of concurrent
logins is trivial for any machine that can run Docker, and it is meaningfully stronger than the
19 MiB OWASP floor. Make all three tunable via env
(`FEMHO_ARGON2_MEMORY_KIB`, `FEMHO_ARGON2_ITERATIONS`, `FEMHO_ARGON2_PARALLELISM`) and **auto-tune
on first boot**: run a calibration that targets ~150–250 ms per hash on the host and write the
chosen parameters to the config, clamped to the OWASP floor.

Storage: **PHC string format**, which embeds the parameters so you can raise them later:

```
$argon2id$v=19$m=65536,t=3,p=1$c29tZXNhbHQ$RdescudvJCsgt3ub+b+dWRWJTmaaJObG
```

Rehash-on-login: on a successful verify, if the stored parameters are below the current target,
recompute the hash with the new parameters inside the same request. This is how you migrate the
whole household to stronger parameters without a password reset.

Peppering: OWASP describes it (a secret stored outside the DB, used as an HMAC key before hashing).
For a self-hosted single-container app the pepper almost always ends up in the same `.env` next to
the DB credentials, which provides little. **Recommendation:** support an optional
`FEMHO_PASSWORD_PEPPER` applied as `argon2id(hmac_sha256(pepper, password))`, document that it only
helps if the DB and the secret live in different trust domains, and store a `pepper_version`
column so it can be rotated. Do not enable it by default.

Other password rules:
- Minimum length 8 (NIST-style), no composition rules, no forced rotation, allow all Unicode,
  normalize to NFKC before hashing. Cap at 128 characters to bound the hashing cost (Argon2 has no
  72-byte problem, but an unbounded input is a DoS vector).
- Check new passwords against a breached-password list if one is bundled. **UNVERIFIED:** whether
  to ship a k-anonymity HIBP lookup — that requires outbound network access, which a self-hosted
  privacy-minded install may not want. Make it opt-in and off by default.
- Constant-time compare, and **always** run a dummy Argon2 hash when the email does not exist, so
  response timing does not enumerate users.

**Login rate limiting** (see §15): per-account exponential backoff *and* per-IP limiting. Lock to
a CAPTCHA-free model — this is a family server, not a public SaaS; a 5-attempts-then-30-second
lockout with doubling, capped at 15 minutes, plus an emailed alert, is right.

### 9.2 Sessions vs JWT — the decision

The choice is between:

**(A) Stateless JWT access tokens + rotating refresh tokens.**
**(B) Opaque tokens with server-side session records.**

Verified constraint from **RFC 9700 (OAuth 2.0 Security Best Current Practice)**:

> "Refresh tokens for public clients MUST be sender-constrained or use refresh token rotation as
> described in Section 4.14."

(The Android app is a public client. So if you go the refresh-token route, rotation is mandatory,
not optional.) RFC 9700 also notes that RFC 6749 already mandates refresh tokens for *confidential*
clients can only be used by the client they were issued to. I did **not** find explicit normative
MUST language in RFC 9700 about detecting reuse of an already-consumed refresh token — the
replay-detection-and-revoke-family behaviour is widely implemented and strongly advisable, but
**UNVERIFIED** as a normative requirement of that document.

**Recommendation for Fem-ho: (B), opaque server-side sessions.**

Why, concretely:

1. **There is exactly one backend.** The entire argument for stateless JWTs — avoiding a shared
   session store across horizontally scaled, independently deployed services — does not apply.
   Fem-ho is one Docker container (plus Postgres) serving a family. You already hit the database
   on every request.
2. **Revocation must be instantaneous.** "Log out all my devices", "my phone was stolen",
   "revoke the AI's access right now" are core product features, and the AI-delegation model makes
   immediate revocation a safety property, not a nicety. With stateless JWTs you either accept a
   revocation window equal to the access-token lifetime or you build a denylist — at which point
   you have a stateful session store with extra steps and a worse failure mode.
3. **The session record is a product feature.** `GET /api/v1/sessions` listing
   "Pixel 8 · Android · última activitat fa 3 minuts · Sabadell" with a revoke button is exactly
   the kind of thing self-hosters expect, and it falls out of (B) for free.
4. **JWT implementation risk is real and asymmetric.** `alg: none`, HS/RS confusion, missing
   `aud`/`iss` checks, clock-skew handling, key rotation — every one of these is a CVE class you
   simply do not have with a 256-bit random opaque string looked up in a table.
5. **Token size.** An opaque token is ~43 characters. A JWT with scopes for a multi-scope grant is
   several hundred bytes on every request, including every CalDAV `PROPFIND`.

Concrete design:

```
Session {
  id              sess_<ulid>
  user_id         usr_…
  token_hash      bytea         -- sha256 of the presented secret; never store the secret
  family_id       uuid          -- for rotation lineage
  device_name     text          -- "Pixel 8", "Firefox · macOS"
  client          text          -- 'web' | 'android'
  user_agent      text
  ip_created      inet
  ip_last_seen    inet
  created_at      timestamptz
  last_seen_at    timestamptz   -- updated at most once per 60 s
  absolute_expiry timestamptz   -- created_at + 90 days (web) / 365 days (android)
  idle_expiry     timestamptz   -- last_seen_at + 30 days (web) / 90 days (android)
  revoked_at      timestamptz
  totp_satisfied  bool
}
```

- Session secret: 32 bytes from a CSPRNG, base64url → 43 chars. Store **sha256** of it (not
  Argon2 — this is a high-entropy secret, not a password; a fast hash is correct and the lookup
  must be O(1)).
- Sliding expiry with an absolute cap. Both configurable.
- One `sessions` table serves both the cookie flow and the bearer flow. The *only* difference is
  transport.

**If you nonetheless want JWTs** (say, to let a reverse proxy or an edge cache authorize without
calling the app), the honest compromise is: short-lived (5–10 min) JWT access tokens signed with
EdDSA, plus opaque rotating refresh tokens with a `family_id`; on presentation of an already-used
refresh token, revoke the entire family and force re-login. Publish a JWKS at
`/.well-known/jwks.json` with two keys during rotation. This is strictly more machinery than (B)
for a self-hosted app, and I would not build it for v1.

### 9.3 Transport: cookies for web, bearer for Android

**Web app — cookie.**

```
Set-Cookie: __Host-femho_session=<43-char-secret>; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=2592000
```

Verified facts: the `__Host-` prefix requires that the cookie was set with the `Secure` attribute,
a `Path` of `/`, and **no `Domain` attribute** — this is defined in the cookie specification work
(`draft-ietf-httpbis-rfc6265bis-14`, "Cookies"). It prevents a compromised or attacker-controlled
subdomain from planting a cookie that shadows the real session cookie.

Attribute choices:
- `HttpOnly` — mandatory. Removes the session from the XSS blast radius.
- `Secure` — mandatory (implied by `__Host-`). This means **HTTPS is required**. A self-hosted
  install behind a reverse proxy will have TLS; document that plain-HTTP LAN installs must either
  terminate TLS or run with `FEMHO_INSECURE_COOKIES=1`, which drops `__Host-`/`Secure` and prints
  a loud warning at boot.
- `SameSite=Lax` — not `Strict`. `Strict` breaks the public-share-link flow and breaks a user
  clicking a Fem-ho link from an email/chat into a logged-in session, which is a real daily
  annoyance. `Lax` still withholds the cookie on cross-site `POST`, embedded content and
  cross-origin `fetch`.
- Because `SameSite=Lax` is not complete CSRF protection for same-site sub-resources, **also**
  implement a double-submit CSRF token for cookie-authenticated state-changing requests:
  `__Host-femho_csrf` (readable by JS, `HttpOnly` absent) echoed in `X-CSRF-Token`, compared with
  a constant-time equality check. Skip the check entirely when the request authenticated via
  `Authorization: Bearer` — bearer requests are not cookie-driven and cannot be forged cross-site.
- Rotate the session secret on privilege change (password change, TOTP enrolment) — session
  fixation defence.

**Android — bearer.**

```
Authorization: Bearer femho_sess_<secret>
```

Store it in **`EncryptedSharedPreferences`** or the Android Keystore-backed equivalent; never in
plain `SharedPreferences` and never in the Room DB. Because the login screen accepts an arbitrary
server URL, bind the stored credential to the exact origin and refuse to send it anywhere else —
a user who types a hostile URL must not have their existing token leaked, and a redirect must
never carry the `Authorization` header cross-origin.

Login response shape:

```http
POST /api/v1/auth/login
Content-Type: application/json

{ "email": "borja@example.com", "password": "…", "client": "android",
  "device_name": "Pixel 8", "totp_code": "123456" }
```
```json
{
  "session": {
    "id": "sess_01JQ8…",
    "token": "femho_sess_9f2b…",      // ONLY returned for client=android; web gets a cookie
    "expires_at": "2027-08-05T00:00:00Z"
  },
  "user": { "id": "usr_…", "email": "…", "display_name": "Borja", "locale": "ca" },
  "server": { "version": "1.4.2", "instance_name": "Casa Balsera" }
}
```

For `client=web`, `session.token` is **absent** and the cookie is set instead. Same endpoint, same
service code, one branch at the serialization boundary. Do not build two login endpoints.

`POST /api/v1/auth/logout` revokes the current session; `DELETE /api/v1/sessions/{id}` revokes a
named one; `POST /api/v1/auth/logout_all` revokes every session for the user (and, optionally,
every non-CalDAV token — make that an explicit checkbox).

### 9.4 TOTP second factor (optional)

Verified from **RFC 6238**:
- `TOTP = HOTP(K, T)`, "where T is an integer and represents the number of time steps between the
  initial counter time T0 and the current Unix time."
- `T = (Current Unix time - T0) / X`, "where the default floor function is used in the computation."
- "X represents the time step in seconds (**default value X = 30 seconds**) and is a system
  parameter."
- Validators should set "a specific limit to the number of time steps a prover can be 'out of
  synch'", accepting steps "both forward and backward from the calculated time step".
- "TOTP implementations MAY use HMAC-SHA-256 or HMAC-SHA-512 functions … instead of the HMAC-SHA-1
  function."

Practical settings for Fem-ho: **SHA-1, 6 digits, X = 30 s, ±1 step window**. Yes, SHA-1 — every
authenticator app supports it and almost none support SHA-256 reliably; the security of TOTP does
not rest on the hash's collision resistance here. Deviating will produce support tickets.

Enrolment URI (`otpauth://`) — issuer must be the instance, not the product, so a user with two
Fem-ho servers can tell them apart:

```
otpauth://totp/Casa%20Balsera:borja%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Casa%20Balsera&algorithm=SHA1&digits=6&period=30
```

Implementation notes:
- Secret: 20 bytes, base32 (no padding).
- **Store used `(user_id, time_step)` pairs** for the acceptance window and reject replays —
  otherwise a shoulder-surfed code is valid for up to 90 seconds.
- Generate **10 single-use recovery codes** at enrolment, show once, store Argon2id hashes.
  A self-hosted family app has no support desk; recovery codes are the only account-recovery path.
- 2FA applies to **interactive login only**. API tokens and CalDAV app-passwords bypass it by
  construction — that is correct and must be documented, because it means a leaked PAT defeats the
  second factor. That is precisely why PAT scopes (§11) matter so much.
- Flow: `POST /auth/login` with correct password but TOTP enabled → `401` with
  `type: /errors/totp-required` and extension `totp_challenge_id`; client re-posts with
  `totp_code` + `totp_challenge_id`. Rate-limit the challenge (5 attempts, then invalidate).
- Endpoints: `POST /api/v1/auth/totp/setup` (returns secret + otpauth URI, does not enable),
  `POST /api/v1/auth/totp/activate` (verifies a code, enables, returns recovery codes),
  `DELETE /api/v1/auth/totp` (requires password re-entry).

**What Fem-ho should do:** ship TOTP in v1 as opt-in per user, off by default; make it mandatory
for any user with the `owner` role on a collective scope only if the admin turns on a
`require_2fa_for_admins` instance setting.

---

## 10. Security headers and transport hygiene

Not glamorous, but a self-hosted app is judged on this and it is cheap:

```
Strict-Transport-Security: max-age=63072000; includeSubDomains
X-Content-Type-Options: nosniff
X-Frame-Options: DENY                       # except the share-link pages, which may allow embedding
Referrer-Policy: strict-origin-when-cross-origin
Content-Security-Policy: default-src 'self'; img-src 'self' data: blob:; frame-ancestors 'none'
Permissions-Policy: geolocation=(), camera=(), microphone=()
Cache-Control: no-store          # on every authenticated API response
Vary: Accept-Language, Authorization, Cookie
X-Request-Id: req_01JQ8F9ZZZ
```

CORS: the web app is same-origin, so CORS is **not** needed for it. Do not open `*`. Provide an
explicit allow-list env var (`FEMHO_CORS_ORIGINS`) for people who host the front-end separately,
and never combine `Access-Control-Allow-Origin: *` with `Access-Control-Allow-Credentials: true`
(browsers reject it, but people try).

Attachments: serve from a distinct path with `Content-Disposition: attachment`, a fixed
`Content-Type` (never echo the uploaded one), and `X-Content-Type-Options: nosniff`. Ideally serve
user content from a separate hostname or at least a separate path with a restrictive CSP — an
uploaded HTML file served same-origin is stored XSS.

---

## 11. API keys / personal access tokens

### 11.1 What the field does — verified survey

**GitHub token formats** (from GitHub's engineering blog on new authentication token formats):
- Prefixes: `ghp_` personal access token, `gho_` OAuth access token, `ghu_` user-to-server,
  `ghs_` server-to-server, `ghr_` refresh token. (Fine-grained PATs use `github_pat_`.)
- Rationale: "identifiable prefixes are a clear way to make tokens identifiable", enabling secret
  scanning, and letting GitHub "check the token input matches the checksum and eliminate fake
  tokens without having to hit our database."
- Encoding: **Base62**, "using leading zeros for padding as needed".
- Checksum: a **32-bit CRC32**, appearing "in the last 6 digits of each token", Base62-encoded.
- Separator: `_`, chosen because "an underscore is not a Base64 character which helps ensure that
  our tokens cannot be accidentally duplicated by randomly generated strings."

**GitHub fine-grained PATs** — permission model is **resource + access level**, with levels
`read`, `write`, `admin` (admin is rare). Permissions are grouped into **repository**,
**organization** and **account/user** tiers, and a token additionally selects *which* repositories
or organization it applies to — "Fine-grained tokens only have access to the repositories or
organizations that they explicitly are granted access to, and can even be targeted at a single
repository in an organization." Endpoints advertise their requirement via the
**`X-Accepted-GitHub-Permissions`** response header. Repository permission names include:
`Actions`, `Administration`, `Attestations`, `Code scanning alerts`, `Commit statuses`,
`Contents`, `Dependabot alerts`, `Dependabot secrets`, `Deployments`, `Environments`, `Issues`,
`Metadata` (read-only), `Pages`, `Pull requests`, `Repository security advisories`,
`Secret scanning alerts`, `Secrets`, `Variables`, `Webhooks`, `Workflows` (write only).

The two structural lessons: **(1) resource × level, not a flat scope list; (2) permissions and
targets are orthogonal axes.**

**Stripe restricted API keys**:
- Prefixes `rk_live_` / `rk_test_` (vs unrestricted `sk_`, publishable `pk_`).
- Per-resource permission of **None / Read / Write**, defaulting to **None** for everything.
- "**Write permissions include Read permissions**: if a key can write an API resource, it can also
  read that resource."
- Method→permission mapping is explicit: `GET` → read; `POST` and `DELETE` → write.
- Errors: a request lacking the permission returns an invalid-request error whose body "includes
  an error message explaining what permissions to add."
- Operational guidance worth copying: one restricted key **per service or use case**; audit the
  key's own request logs to prune unused permissions; deferred expiry of up to **7 days** when
  rotating a key so you have a rollback window.
- And directly relevant to Fem-ho's AI user: Stripe explicitly recommends restricted keys
  "especially when giving a key to an AI agent … Use RAK permissions to limit what an agent can do."

**GitLab access token scopes** (exact names): `api`, `read_api`, `read_repository`,
`write_repository`, `read_registry`, `write_registry`, `read_virtual_registry`,
`write_virtual_registry`, `create_runner`, `manage_runner`, `ai_features`, `k8s_proxy`,
`self_rotate`, plus personal-only `admin_mode`, `read_service_ping`, `sudo`, `read_user`.
Note `write_repository` **includes** `read_repository`, and that `self_rotate` exists as a
separate capability so a token can renew itself without being able to mint new ones. `ai_features`
being its own scope is the precedent for Fem-ho carving out AI-specific capabilities.

**Vikunja API tokens** (from `pkg/models/api_tokens.go`) — the closest analogue, same problem
domain:

```go
const APITokenPrefix = `tk_`

type APIToken struct {
	ID              int64          `xorm:"bigint autoincr not null unique pk"`
	Title           string         `xorm:"not null"`
	Token           string         `xorm:"-"`          // never persisted
	TokenSalt       string         `xorm:"not null"`
	TokenHash       string         `xorm:"not null unique"`
	TokenLastEight  string         `xorm:"not null index varchar(8)"`
	APIPermissions  APIPermissions `xorm:"json not null permissions"`
	ExpiresAt       time.Time      `xorm:"not null"`
	Created         time.Time      `xorm:"created not null"`
	OwnerID         int64          `xorm:"bigint not null"`
	web.Permissions `xorm:"-"`
	web.CRUDable    `xorm:"-"`
}

type APIPermissions map[string][]string

func HashToken(token, salt string) string {
	tempHash := pbkdf2.Key([]byte(token), []byte(salt), 10000, 50, sha256.New)
	return hex.EncodeToString(tempHash)
}
```

Token = `tk_` + 40 hex characters (20 random bytes). Only the hash and the **last eight
characters** are stored — the last eight give a cheap indexed lookup so verification is
`SELECT … WHERE token_last_eight = ?` then hash-compare, instead of hashing against every row.
`APIPermissions` is `map[group][]actions`, and `GET /api/v1/routes` enumerates every route with the
permission it requires, so the token-creation UI can be generated from the router. Auth header is
`Authorization: Bearer <token>`.

The `TokenLastEight` trick and the `/routes` self-describing endpoint are both directly worth
stealing. The PBKDF2-10000 hashing is defensible but unnecessary for a 160-bit random secret —
see §11.3.

### 11.2 Fem-ho token format

```
femho_pat_<40 chars base62><6 chars base62 CRC32>      human personal access token
femho_ai_<40 chars base62><6 chars base62 CRC32>       agent / AI token
femho_cal_<40 chars base62><6 chars base62 CRC32>      CalDAV app password
femho_sess_<43 chars base64url>                        session bearer (Android)
femho_shr_<22 chars base62>                            public share link secret (in URL)
femho_whsec_<32 chars base64>                          outbound webhook signing secret
```

Design decisions and their reasons:

- **Distinct prefix per token *kind*, not per environment.** There is no live/test split in a
  self-hosted family app. The kind is what matters: it is visible in logs, it drives the default
  scope template, and it lets the audit log say "AI token" without a join.
- **`femho_` product prefix** so a leaked token is greppable and so secret-scanning rules can be
  written (`femho_(pat|ai|cal)_[0-9A-Za-z]{46}`). Publish that regex in the docs — it is what lets
  users add it to their own pre-commit hooks and to GitHub's custom secret scanning patterns.
- **Underscore separators**, per GitHub's reasoning: `_` is not a Base62/Base64 character, so a
  random string can never accidentally look like a valid token.
- **Base62** (`[0-9A-Za-z]`) for the body: no `+`, `/`, `=` to be mangled by URL encoding, shell
  quoting, or a user double-clicking to select (double-click selects across `-` and `_`
  inconsistently across platforms; base62 avoids the whole class of problem).
- **40 characters base62 ≈ 238 bits** of entropy from 30 random bytes. Vastly more than needed;
  the cost is zero.
- **6-character base62 CRC32 checksum suffix.** Validate the checksum *before* touching the
  database. This kills typo'd tokens, truncated copy-pastes and enumeration probes with no I/O,
  and it is what lets `/.well-known` health tooling reject junk instantly. CRC32 is not a security
  control — it is a typo/junk filter, and that is all it needs to be.

### 11.3 Storage

```sql
CREATE TABLE api_token (
  id             UUID PRIMARY KEY,
  owner_user_id  UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL CHECK (kind IN ('pat','ai','caldav')),
  name           TEXT NOT NULL,                   -- "n8n — automatitzacions Feina"
  token_prefix   TEXT NOT NULL,                   -- 'femho_ai_'
  token_last4    TEXT NOT NULL,                   -- shown in the UI: femho_ai_…•••…3f7a
  lookup_key     BYTEA NOT NULL,                  -- sha256(secret)[0:8], indexed
  token_hash     BYTEA NOT NULL,                  -- sha256(secret), full
  grants         JSONB NOT NULL,                  -- see §12
  constraints    JSONB NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_ip  INET,
  expires_at     TIMESTAMPTZ NULL,
  last_used_at   TIMESTAMPTZ NULL,
  last_used_ip   INET NULL,
  last_used_ua   TEXT NULL,
  use_count      BIGINT NOT NULL DEFAULT 0,
  revoked_at     TIMESTAMPTZ NULL,
  revoked_reason TEXT NULL
);
CREATE INDEX ON api_token (lookup_key);
CREATE INDEX ON api_token (owner_user_id, revoked_at);
```

**Hashing: plain SHA-256, not Argon2/PBKDF2.** This is the correct and slightly counter-intuitive
choice. The token is a 238-bit uniformly random secret; there is no dictionary to attack and no
"weak token" to protect. A slow KDF here buys nothing against offline attack (238 bits is
unbrute-forceable regardless of the KDF) and costs you a slow KDF on **every single API request**,
including every CalDAV `PROPFIND` — which for a syncing calendar client is a lot. Use SHA-256 with
a constant-time comparison. (Vikunja's PBKDF2-10000 works but is paying that cost needlessly.)

If you want defence against a DB-read attacker replaying tokens before you notice, add an
instance-wide HMAC key held outside the DB: `token_hash = hmac_sha256(server_key, secret)`. Cheap,
and it means a stolen database dump alone is not enough. This is the right place for a pepper —
much more so than for passwords.

**`lookup_key`** = the first 8 bytes of the hash, indexed. Verification:
1. Parse prefix; reject unknown → `401`.
2. Verify CRC32 suffix; reject → `401` (no DB hit).
3. `SELECT * FROM api_token WHERE lookup_key = $1` (usually 1 row).
4. Constant-time compare full `token_hash`.
5. Check `revoked_at IS NULL` and `expires_at`.
6. Build the `Principal`.

Steps 1–2 mean junk traffic never touches Postgres. Step 3 is a single index probe. This is the
same shape as Vikunja's `TokenLastEight` but hashed, so the DB does not contain a searchable
fragment of the real secret.

### 11.4 Lifecycle

**Creation** — `POST /api/v1/tokens`:

```json
{
  "kind": "ai",
  "name": "Claude — Feina",
  "grants": ["tasks:write@feina/*", "checklists:write@feina/*", "comments:write@feina/*", "activity:read@feina/*"],
  "constraints": { "require_if_match": true, "deny_hard_delete": true },
  "expires_in_days": 90
}
```

Response — the **only** time the secret is ever transmitted:

```json
{
  "id": "tok_01JQ8…",
  "object": "token",
  "kind": "ai",
  "name": "Claude — Feina",
  "token": "femho_ai_7Kx9…3f7aQ2",
  "token_prefix": "femho_ai_",
  "token_last4": "3f7a",
  "grants": ["tasks:write@feina/*", "…"],
  "expires_at": "2026-11-03T12:00:00Z",
  "created_at": "2026-08-05T12:00:00Z"
}
```

Every subsequent `GET /api/v1/tokens` returns the same object **without** `token`. The UI shows
`femho_ai_••••••••3f7a`. Copy-to-clipboard once, with a Catalan warning that it cannot be shown
again.

**Expiry.** Default **90 days**, offer 7/30/60/90/180/365/no-expiry, and make "no expiry" require
an explicit confirmation. Warn by in-app notification (and email if SMTP is configured) at 7 days
and 1 day before expiry. A token that expires silently in the middle of a family's grocery
automation is a bad experience; a token that never expires is a bad security posture. Notify.

**Last-used tracking.** Update `last_used_at`, `last_used_ip`, `last_used_ua`, `use_count`
**asynchronously and coalesced** — at most once per 60 seconds per token, via a background flush.
Doing it synchronously turns every read request into a write and will be the first thing that
hurts under CalDAV polling. Surface it in the UI ("última utilització: fa 3 minuts des de
192.168.1.40"), and flag tokens unused for 90 days as candidates for revocation.

**Revocation** — `DELETE /api/v1/tokens/{id}` sets `revoked_at` (soft delete: keep the row so the
activity log's foreign keys and the "which token did this?" question stay answerable forever).
Also: revoke all tokens on password change? **No** — that breaks every integration whenever
someone rotates a password, and password change does not imply token compromise. Offer it as a
checkbox on the change-password form instead, defaulted off, plus an explicit
`POST /api/v1/tokens/revoke_all`.

**Rotation.** `POST /api/v1/tokens/{id}/rotate` mints a new secret for the same token record and
returns it once, with an optional `old_secret_valid_for` grace window (cap at **7 days**, matching
Stripe's deferred-expiry model). During the grace window both secrets validate and the activity
log records which one was used, so you can confirm the migration is complete before the old one
dies. This is dramatically better than "delete and create", which guarantees downtime.

Also copy GitLab's `self_rotate`: a token may rotate **itself** only if its grants include
`tokens:rotate_self`. Never let a token mint *new* tokens unless it holds `tokens:write`, and make
that grant unavailable to `kind='ai'` tokens entirely (see §12.6) — privilege escalation via
token minting is the single worst thing an over-permissive agent token can do.

### 11.5 CalDAV app passwords

CalDAV clients speak HTTP Basic. Give them `femho_cal_…` tokens used as the **password** with the
user's email as the username. Basic auth over TLS, checked by the same verifier, producing a
Principal whose grants are fixed to the calendar surface:

```
calendars:write@<scope>/<project>
tasks:write@<scope>/<project>
```

These tokens must be rejected on `/api/v1/*` and accepted only on `/dav/*` — enforce it in the
middleware, keyed off `kind='caldav'`. That containment is the whole reason for a separate kind:
a `.ics` sync credential sitting in a phone's calendar settings should not be able to mint tokens
or read the activity log.

### 11.6 Telling the client what it is missing

Copy Stripe and GitHub. When a request fails on capabilities, say exactly what would fix it:

```json
{
  "type": "https://femho.app/errors/insufficient-scope",
  "title": "Permisos insuficients",
  "status": 403,
  "detail": "Aquesta operació requereix «tasks:write» sobre l'àmbit «Família».",
  "required_capability": "tasks:write@familia",
  "granted_capabilities": ["tasks:read@familia", "tasks:write@feina/*"],
  "docs": "https://femho.app/docs/tokens#scopes"
}
```

And advertise requirements proactively, GitHub-style, on **every** response:

```
X-Femho-Accepted-Capabilities: tasks:write@{scope}
```

This lets an agent discover what it needs without trial and error, and it makes the MCP tool
descriptions generatable from the router.

---

## 12. The scope grammar

This is the centre of the design. It has to express, in a way that is both human-editable and
machine-checkable: *"read+write tasks in scope Feina only"*.

### 12.1 Shape: two orthogonal axes

From GitHub fine-grained PATs: **permissions** (what kind of thing, at what level) and
**targets** (which instances) are separate axes. From Stripe: **write implies read**, default None.
From GitLab: a small, closed, stable vocabulary of names.

Fem-ho combines them into a single readable grant string:

```
grant       := permission "@" target
permission  := resource ":" action
target      := scope-selector [ "/" project-selector ]

resource         := "tasks" | "checklists" | "comments" | "attachments"
                  | "projects" | "scopes" | "members" | "calendars"
                  | "shares" | "activity" | "webhooks" | "tokens"
                  | "users" | "search"
action           := "read" | "write" | "admin"
scope-selector   := "*" | scope-slug          ; e.g. "feina", "familia", "personal"
project-selector := "*" | project-slug        ; omitted ⇒ the scope's general space + all projects
```

Examples that read the way a person would say them:

```
tasks:write@feina/*                 read+write tasks anywhere in Feina
tasks:read@*                        read tasks in every scope the owner can see
checklists:write@familia/compres    read+write checklists in Família ▸ Compres
activity:read@feina                 read the audit log for Feina
calendars:admin@feina               manage CalDAV collections for Feina
shares:write@familia/*              create/revoke public links in Família
tokens:read@*                       list the owner's tokens (never their secrets)
```

### 12.2 Semantics — the eight rules

1. **Deny by default.** A resource with no grant is `None`. There is no implicit grant.
2. **Action lattice: `read < write < admin`.** `write` implies `read`; `admin` implies `write`.
   Method mapping, following Stripe exactly: `GET`/`HEAD` → `read`; `POST`/`PATCH`/`PUT`/`DELETE`
   → `write`; configuration-changing operations (add a member, change a role, rotate a CalDAV
   collection URL, delete a scope) → `admin`.
3. **No separate `delete` action.** Stripe folds `DELETE` into write and it is the right call:
   a separate delete axis doubles the grammar and users get it wrong. Destructiveness is handled
   by a **constraint** (`deny_hard_delete`), not by the action lattice.
4. **Target omission widens leftward, never rightward.** `tasks:write@feina` covers the scope's
   general space *and* all its projects. `tasks:write@feina/web` covers only that project (and
   not the scope's general space). If you need "general space only", write `tasks:write@feina/-`
   where `-` is the reserved slug for the general space.
5. **Grants union.** The effective capability set is the union of all grant strings on the token.
   There are **no deny rules** in the grammar. Deny rules make the evaluator non-monotonic, make
   the UI impossible to explain, and are the source of every "why can't I do this" support thread.
   Restrictions live in `constraints`, which are a small closed set of booleans.
6. **Capabilities can only narrow, never widen.** This is the invariant that makes the whole
   design safe:

   ```
   effective_permission = user_membership_permission  ∩  token_capabilities
   ```

   A token granting `tasks:write@familia` held by a user who is only a `viewer` in Família grants
   **nothing**. It is not possible to construct a token that exceeds its owner. Enforce this in the
   policy engine, not in the token-creation UI — the UI should also refuse to create such a grant,
   but the engine must never trust that it did.
7. **Slugs, not ids, in the grant string; ids in storage.** Humans write `@feina`; the stored JSON
   resolves it to `scp_…` at creation time. If a scope is renamed, the token keeps working (it
   holds the id) and the display re-renders from the current slug. If a scope is deleted, the grant
   is inert. Store both:

   ```json
   {
     "version": 1,
     "grants": [
       { "resource": "tasks", "action": "write",
         "scope_id": "scp_01JQ…FEINA", "scope_slug": "feina",
         "project_id": null, "project_slug": "*" }
     ]
   }
   ```
8. **Wildcards are evaluated at request time, not expanded at creation time.** `@*` means "every
   scope the owner is currently a member of", so adding the user to a new scope tomorrow does
   extend an existing `@*` token. Document this loudly — it is the one genuinely surprising
   behaviour. Offer a checkbox in the UI: "Limita aquest testimoni als àmbits actuals", which
   expands the wildcard into explicit ids at creation.

### 12.3 Presets

Nobody hand-writes grant strings for the common cases. Ship presets, and let the UI show the
resulting grants:

| Preset | Grants |
|---|---|
| **Només lectura** | `tasks:read@*`, `checklists:read@*`, `comments:read@*`, `projects:read@*`, `scopes:read@*` |
| **Tasques (lectura i escriptura)** | `tasks:write@*`, `checklists:write@*`, `comments:write@*`, `projects:read@*`, `scopes:read@*` |
| **Un sol àmbit** | the above, with `@<scope>` instead of `@*` |
| **Agent IA (delegació)** | `tasks:write@<scope>/*`, `checklists:write@<scope>/*`, `comments:write@<scope>/*`, `activity:read@<scope>`, `projects:read@<scope>`, `scopes:read@<scope>` + constraints `{ "ai_delegated_only": true, "deny_hard_delete": true, "require_if_match": true }` |
| **Calendari (CalDAV)** | `calendars:write@<scope>`, `tasks:write@<scope>` — only on `kind='caldav'` |
| **Automatització (n8n)** | `tasks:write@*`, `webhooks:read@*`, `activity:read@*` |

### 12.4 Constraints

A closed set. Do not let this grow into a policy language.

```json
{
  "require_if_match": true,          // reject writes without If-Match (default true for kind=ai)
  "deny_hard_delete": true,          // DELETE archives instead of destroying
  "ai_delegated_only": true,         // may only write tasks whose execution_mode is ai_assisted/ai_delegated
  "read_only_outside_hours": null,   // UNVERIFIED as a real need; omit from v1
  "ip_allowlist": ["192.168.1.0/24"],
  "max_writes_per_hour": 500,
  "not_after": "2026-11-03T12:00:00Z"
}
```

`ai_delegated_only` deserves emphasis: it is the mechanism that lets a household give an agent a
broad-looking `tasks:write@familia/*` grant while guaranteeing the agent can only touch tasks a
human has explicitly marked as delegated. That is the product promise ("the app has no AI engine
of its own; it exposes work to external AI") expressed as an enforceable constraint. Implement it
as a predicate in the policy engine, evaluated against the *target entity*, not the request body —
otherwise an agent flips `execution_mode` to `ai_delegated` and then edits freely. Specifically:
**a principal with `ai_delegated_only` may not change `execution_mode` at all.**

### 12.5 Evaluation

```
Authorize(principal, action, resource_type, entity) -> allow | deny(reason)

 1. if principal.kind == "share"  -> ShareAuthorize(...)     # separate, tiny path (§18.4)
 2. scope_id, project_id := locate(entity)                    # every entity resolves to a scope
 3. role := membership(principal.user_id, scope_id)           # owner|admin|member|viewer|none
    if role == none                    -> deny(NOT_FOUND)     # 404, not 403 (API1:2023)
 4. if !role_allows(role, action, resource_type)
                                       -> deny(FORBIDDEN, required_role)
 5. if principal.capabilities == ALL   -> allow               # interactive session
 6. if !capabilities_allow(principal.capabilities, resource_type, action, scope_id, project_id)
                                       -> deny(INSUFFICIENT_SCOPE, required_capability)
 7. for c in principal.constraints:
        if !c.permits(principal, action, entity)
                                       -> deny(CONSTRAINT_VIOLATED, c.name)
 8. allow
```

Step 5 is what makes a browser session and a full-access PAT behave identically: an interactive
session carries the sentinel `ALL` capability set, and the entire token path is skipped. One
function, one set of tests, no duplication.

`capabilities_allow` is a small pure function — implement and unit-test it in isolation, because
it is where the bugs will be:

```
capabilities_allow(caps, resource, action, scope_id, project_id):
    for g in caps.grants:
        if g.resource != resource: continue
        if rank(g.action) < rank(action): continue
        if g.scope_id != scope_id and g.scope_id != WILDCARD: continue
        if g.project_id is None: return True                 # scope-wide grant
        if g.project_id == WILDCARD: return True
        if g.project_id == project_id: return True
    return False
```

Test matrix to write on day one: {14 resources} × {3 actions} × {scope match, scope wildcard,
scope mismatch} × {project null, project wildcard, project match, project mismatch, general space}
× {role ≥ required, role < required}. That is a few hundred table-driven cases and it is the
cheapest security assurance you will ever buy.

### 12.6 Hard prohibitions

Encode these as invariants, not as UI affordances:

- `kind='ai'` tokens may **never** hold `tokens:write`, `members:admin`, `users:write`, or
  `scopes:admin`. Reject at creation with `422 /errors/forbidden-grant-for-kind`.
- `kind='caldav'` tokens may hold only `calendars:*` and `tasks:*`, and only on `/dav/*`.
- No token of any kind may change its owner's password, email, or 2FA settings. Those require an
  interactive session with a recent re-authentication.
- No token may read another token's secret (there is nothing to read — only hashes exist).
- `activity:read` never returns other users' IP addresses or user agents unless the caller is an
  `owner`/`admin` of the scope.

---

## 13. One codebase, two principals: the layering

### 13.1 The core idea

The instinct — "AI tokens need different rules, so add `if isAI` checks" — produces a codebase
where the AI path and the human path drift, and the drift is where the security bugs live.

The correct layering is three strictly separated stages:

```
  HTTP layer          →   Authentication middleware   →   Principal
  Principal           →   Capability resolution       →   CapabilitySet
  Service layer       →   Policy engine               →   allow / deny
  Repository layer    →   no authorization at all
```

**Authorization decisions happen in the service layer, never in the handler.** The handler's job
is HTTP: parse, deserialize, call the service, serialize, set headers. The moment authorization
lives in handlers, every new entry point (MCP tool, CalDAV, batch executor, webhook replay,
background job) is a fresh opportunity to forget the check. And Fem-ho has *six* entry points.

### 13.2 The Principal

```go
type PrincipalKind string
const (
    KindUser       PrincipalKind = "user"        // interactive session (web/android)
    KindAgent      PrincipalKind = "ai"          // femho_ai_ token
    KindIntegration PrincipalKind = "integration" // femho_pat_ token
    KindCalDAV     PrincipalKind = "caldav"
    KindShareGuest PrincipalKind = "share_guest"
    KindSystem     PrincipalKind = "system"      // migrations, cron, webhook retries
)

type Source string
const (
    SourceWeb    Source = "web"
    SourceAndroid Source = "android"
    SourceAPI    Source = "api"
    SourceMCP    Source = "mcp"
    SourceCalDAV Source = "caldav"
    SourceShare  Source = "share"
    SourceSystem Source = "system"
)

type Principal struct {
    Kind         PrincipalKind
    Source       Source

    // Whose authority is being exercised. ALWAYS set except for system/share.
    UserID       UserID

    // Who to display as the actor. For an AI token this is the AI user record,
    // so the activity log can say "modificat per la IA" while authority still
    // derives from UserID.
    ActorUserID  UserID
    ActorLabel   string        // guest name from a share link, or the token name

    TokenID      *TokenID
    SessionID    *SessionID
    ShareID      *ShareID

    Capabilities CapabilitySet // ALL for interactive sessions
    Constraints  Constraints

    RequestID    string
    IP           netip.Addr
    UserAgent    string
}
```

The critical modelling decision: **`UserID` and `ActorUserID` are separate fields.** An AI token
created by Borja carries `UserID = usr_borja` (authority, membership, visibility) and
`ActorUserID = usr_ai` (attribution). Every permission check uses `UserID`. Every audit row uses
`ActorUserID` and `Kind`. This is what makes "changed by AI" truthful *and* keeps the AI from ever
seeing more than Borja can.

### 13.3 Middleware: build the Principal, decide nothing

```go
func Authenticate(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        var p *Principal
        var err error

        switch {
        case hasBearer(r):
            tok := bearerToken(r)
            switch {
            case strings.HasPrefix(tok, "femho_sess_"):
                p, err = principalFromSession(r.Context(), tok, sourceFromUA(r))
            case strings.HasPrefix(tok, "femho_ai_"),
                 strings.HasPrefix(tok, "femho_pat_"):
                p, err = principalFromAPIToken(r.Context(), tok, sourceFromPath(r))
            default:
                err = ErrUnknownTokenKind
            }
        case hasSessionCookie(r):
            p, err = principalFromCookie(r.Context(), r)      // + CSRF check
        case isDAVPath(r) && hasBasicAuth(r):
            p, err = principalFromCalDAVPassword(r.Context(), r)
        case isSharePath(r):
            p, err = principalFromShare(r.Context(), r)
        default:
            err = ErrNoCredentials
        }

        if err != nil { writeProblem(w, r, problemFor(err)); return }
        next.ServeHTTP(w, r.WithContext(principal.Into(r.Context(), p)))
    })
}
```

Note what this function does **not** do: it never decides whether the request is allowed. It only
answers "who is this, and what could they possibly be allowed to do". That separation is the whole
trick.

`sourceFromPath` is how `source` gets set correctly: the MCP server mounts at `/mcp`, so an AI
token used through MCP yields `source=mcp` while the same token used with curl yields `source=api`.
Both are truthfully recorded.

### 13.4 Service layer: the only place `Authorize` is called

```go
func (s *TaskService) Update(ctx context.Context, id TaskID, patch TaskPatch, ifMatch *string) (*Task, error) {
    p := principal.From(ctx)

    before, err := s.repo.GetTask(ctx, id)
    if err != nil { return nil, err }                    // repo returns ErrNotFound

    if err := s.policy.Authorize(ctx, p, ActionWrite, ResourceTasks, before); err != nil {
        return nil, err                                  // 403 or 404, decided by the policy engine
    }
    if err := s.checkPrecondition(p, before, ifMatch); err != nil {
        return nil, err                                  // 412 or 428
    }
    if err := s.policy.AuthorizeFields(ctx, p, before, patch); err != nil {
        return nil, err                                  // e.g. ai_delegated_only blocks execution_mode
    }

    after, err := s.repo.ApplyPatch(ctx, id, patch, before.Sequence)
    if err != nil { return nil, err }

    s.events.Record(ctx, Event{
        ActorType: p.Kind,  ActorUserID: p.ActorUserID,  ActorLabel: p.ActorLabel,
        TokenID:   p.TokenID, Source: p.Source,
        Entity:    "task",  EntityID: id, Verb: verbFor(before, after),
        ScopeID:   after.ScopeID, ProjectID: after.ProjectID,
        Before:    diffable(before), After: diffable(after),
        RequestID: p.RequestID,
    })
    return after, nil
}
```

Every entry point — REST handler, MCP tool, batch executor, CalDAV `PUT`, quick-add parser —
calls `TaskService.Update`. None of them re-implements authorization. The MCP tool for
`update_task` is fifteen lines: unmarshal arguments, call the service, marshal the result.

`AuthorizeFields` is the property-level check that OWASP API3:2023 is about: not just "may you
write this task" but "may you write *this field* of this task". It is where `ai_delegated_only`,
the immutable-field list, and role-gated fields (only an `admin` may change `scope_id`) live.

### 13.5 The policy engine

Build it yourself. Fem-ho's model is small and closed: 14 resources, 3 actions, 5 roles, one
membership edge, one parent-child edge. That is a couple of hundred lines of pure, testable code
with zero dependencies and zero operational surface.

Do **not** reach for OpenFGA/Zanzibar for v1. OpenFGA is CNCF-hosted, Apache 2.0, implements
Google's Zanzibar relationship model with `(user, relation, object)` tuples and a readable DSL with
union/intersection/exclusion operators, and has SDKs for Go, Node.js, Python, Java and .NET — it is
genuinely good. But self-hosting it means "managing another stateful service (PostgreSQL or MySQL
backend)" alongside your app, which for a family task manager distributed as a single
`docker compose up` is a serious tax on the thing that makes the product adoptable.

Revisit ReBAC only if the model grows nested scopes, per-task ACLs, or cross-household sharing.
Structure the code so that swap is possible: keep `policy.Authorize` as the sole interface, and
keep membership lookups behind a `MembershipStore` port.

Interface:

```go
type PolicyEngine interface {
    Authorize(ctx context.Context, p *Principal, a Action, r Resource, entity Entity) error
    AuthorizeFields(ctx context.Context, p *Principal, before Entity, patch Patch) error
    VisibleScopeIDs(ctx context.Context, p *Principal) ([]ScopeID, error)
}
```

`VisibleScopeIDs` is the third method and it is essential: list endpoints must be filtered by
*constructing a query the principal can see*, not by fetching everything and filtering in memory.
Every repository list method takes `[]ScopeID` as a mandatory first argument. Make it impossible to
call the repo without it — in Go, a distinct type; in TS, a branded type; in Python, a required
keyword-only parameter. This is the single most effective structural defence against
Broken Object Level Authorization.

### 13.6 Testing the layering

- A test that walks every registered route and asserts each one's handler calls a service method
  that calls `Authorize`. (Reflection, or a lint rule, or simply: repositories panic if the context
  has no principal.)
- A "principal matrix" integration test: for each of the 6 principal kinds × each endpoint, assert
  the expected status. Run it in CI. When someone adds an endpoint without a policy check, this is
  what catches it.
- A negative test that a `kind='ai'` principal cannot reach `POST /api/v1/tokens` by any route,
  including through `/batch`.

---

## 14. Audit trail / activity log

### 14.1 Schema

```sql
CREATE TABLE activity_event (
  seq             BIGSERIAL PRIMARY KEY,      -- the global monotonic cursor
  id              UUID        NOT NULL UNIQUE,-- evt_… stable public id
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- WHO
  actor_type      TEXT        NOT NULL,       -- user | ai | integration | caldav | share_guest | system
  actor_user_id   UUID        NULL REFERENCES app_user(id),
  actor_label     TEXT        NULL,           -- guest name from a share link, or token name
  on_behalf_of    UUID        NULL REFERENCES app_user(id),  -- Principal.UserID when != actor
  token_id        UUID        NULL REFERENCES api_token(id),
  session_id      UUID        NULL,
  share_id        UUID        NULL,

  -- WHERE FROM
  source          TEXT        NOT NULL,       -- web | android | caldav | api | mcp | share | system
  ip              INET        NULL,
  user_agent      TEXT        NULL,
  request_id      TEXT        NULL,
  idempotency_key TEXT        NULL,
  batch_id        UUID        NULL,

  -- WHAT
  scope_id        UUID        NULL,
  project_id      UUID        NULL,
  entity_type     TEXT        NOT NULL,       -- task | subtask | checklist | checklist_item | comment | attachment | project | scope | member | share | token | webhook | calendar | user
  entity_id       UUID        NOT NULL,
  parent_entity_id UUID       NULL,           -- e.g. the task a comment belongs to
  verb            TEXT        NOT NULL,       -- created | updated | moved | completed | reopened | deleted | restored | commented | assigned | unassigned | delegated | shared | unshared | pinned | logged_in | token_created | token_revoked | member_added | role_changed
  before          JSONB       NULL,
  after           JSONB       NULL,
  changed_fields  TEXT[]      NULL,           -- denormalized for cheap filtering
  summary         TEXT        NULL            -- optional pre-rendered Catalan line
);

CREATE INDEX ON activity_event (scope_id, seq DESC);
CREATE INDEX ON activity_event (entity_type, entity_id, seq DESC);
CREATE INDEX ON activity_event (actor_user_id, seq DESC);
CREATE INDEX ON activity_event (occurred_at);
CREATE INDEX ON activity_event USING GIN (changed_fields);
```

### 14.2 Append-only, enforced

Not by convention — by the database:

```sql
REVOKE UPDATE, DELETE ON activity_event FROM femho_app;

CREATE OR REPLACE FUNCTION activity_event_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'activity_event is append-only';
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER activity_event_no_update BEFORE UPDATE OR DELETE ON activity_event
  FOR EACH ROW EXECUTE FUNCTION activity_event_immutable();
```

Retention: a nightly job may `DELETE` rows older than `FEMHO_ACTIVITY_RETENTION_DAYS` (default:
unlimited) — running as a **different DB role** that holds the DELETE grant. That way the
application can never delete history, but the operator can configure pruning. Before pruning,
optionally roll old events into a monthly summary row.

### 14.3 Diff strategy

Store `before`/`after` as **field-level projections**, not whole entities:

```json
{
  "before": { "column": "todo",  "assignee_ids": [] },
  "after":  { "column": "doing", "assignee_ids": ["usr_marta"] },
  "changed_fields": ["column", "assignee_ids"]
}
```

Rules:
- Never store `description` in full on both sides for a large description — store a truncated
  version plus a length, or store the full text only if under 2 KiB. History tables that store
  whole documents on every keystroke-save become the largest table in the database.
- **Never** store secrets, password hashes, token secrets, or share passwords. Redact by
  allow-list, not by deny-list: enumerate the fields that may be logged per entity type.
- Attachments log metadata only (filename, size, content type), never content.

### 14.4 "Changed by AI"

Because `actor_type` and `source` are recorded on every row, the UI can render exactly the right
Catalan sentence with no inference:

| actor_type | source | rendering |
|---|---|---|
| `user` | `web` | "Borja ha mogut la tasca a Fent" |
| `user` | `android` | "Borja ha mogut la tasca a Fent · des del mòbil" |
| `ai` | `mcp` | "La IA ha completat la tasca · delegada per Borja" |
| `ai` | `api` | "La IA ha afegit un comentari · via API" |
| `integration` | `api` | "n8n ha creat 3 tasques" |
| `caldav` | `caldav` | "Actualitzat des del calendari (Thunderbird)" |
| `share_guest` | `share` | "Marta (convidada) ha marcat 2 elements" |

Expose a filter: `GET /api/v1/activity?actor_type=ai&scope_id=scp_feina` — "show me everything the
AI did in Feina". That view is the trust mechanism that makes AI delegation acceptable to a family,
and it should be one tap from the profile menu.

Also expose per-entity history: `GET /api/v1/tasks/{id}/activity`.

### 14.5 Writing events

- Write the event **in the same transaction** as the mutation. An audit log that can diverge from
  the data is worse than none, because it is trusted.
- The event is written by the **service layer**, from the `Principal` in the context — never by the
  handler, never by the repository. One `events.Record` call per business operation.
- `batch_id` correlates the N events produced by one bulk call, so the UI can collapse them.
- Login/logout/token/2FA/member-role events are recorded too, with `entity_type` in
  (`user`, `token`, `session`, `member`). Failed logins get their own rows with
  `verb='login_failed'` — rate-limit the *writing* of those rows or a brute-force attempt becomes
  a disk-fill attack (cap at N per IP per minute).

---

## 15. Rate limiting

### 15.1 Headers — verified

`draft-ietf-httpapi-ratelimit-headers-11` (23 May 2026, Standards Track, IETF HTTPAPI WG). Both
fields are **Structured Fields Lists** (RFC 9651).

**`RateLimit-Policy`** — "a non-empty List of Quota Policy Items"; the Item value MUST be a String.

| param | type | required | meaning |
|---|---|---|---|
| `q` | Non-negative Integer | **yes** | quota allocation in quota units |
| `qu` | String | no | quota unit (default `"requests"`) |
| `w` | Non-negative Integer | no | time window in seconds |
| `pk` | Byte Sequence | no | partition key |

**`RateLimit`** — "a List of Service Limit Items".

| param | type | required | meaning |
|---|---|---|---|
| `r` | Non-negative Integer | **yes** | remaining quota |
| `t` | Non-negative Integer | no | seconds until the quota resets |
| `pk` | Byte Sequence | no | partition key |

Literal examples from the draft:
```
RateLimit-Policy: "burst";q=100;w=60,"daily";q=1000;w=86400
RateLimit-Policy: "default";q=100;w=10
RateLimit-Policy: "permin";q=50;w=60,"perhr";q=1000;w=3600
RateLimit-Policy: "peruser";q=100;w=60;pk=:cHsdsRa894==:

RateLimit: "default";r=50;t=30
RateLimit: "default";r=999;pk=:dHJpYWwxMjEzMjM=:
RateLimit: "default";r=300000000;t=60;pk=:QXBwLTk5OQ==:
```

The fields may appear on successful responses too, so a well-behaved client can slow down before
being throttled. On `429`, include them plus `Retry-After`.

Note this supersedes the older `X-RateLimit-Limit` / `X-RateLimit-Remaining` / `X-RateLimit-Reset`
convention. Emit **both** for a release or two — n8n, scripts and most HTTP libraries still look
for the `X-` forms.

### 15.2 Buckets for Fem-ho

A family server needs rate limiting for abuse containment and runaway-agent containment, not for
monetization. Keep it simple, and make the limits generous enough that a normal human never sees
one.

| Bucket key | Policy |
|---|---|
| Unauthenticated, per IP | `"anon";q=60;w=60` |
| `POST /auth/login`, per **email** | 5 per 15 min, exponential backoff, then 15-min lockout |
| `POST /auth/login`, per IP | `"login";q=20;w=300` |
| Interactive session (web/android), per user | `"user";q=600;w=60` |
| `femho_pat_` integration token | `"pat";q=300;w=60,"pathr";q=5000;w=3600` |
| `femho_ai_` agent token | `"ai";q=120;w=60,"aihr";q=1000;w=3600` + `max_writes_per_hour` constraint |
| `femho_cal_` CalDAV | `"caldav";q=120;w=60` (clients poll; be lenient on `PROPFIND`) |
| Share link, per share id | `"share";q=60;w=60` |
| Write operations, per user, all sources | `"writes";q=1000;w=3600` |
| Attachment upload bytes, per user | 500 MiB/day |
| Outbound webhook deliveries, per webhook | 100/min, then queue |

Implementation: **GCRA / leaky bucket**, not fixed windows. Fixed windows allow a 2× burst at the
boundary and produce confusing `t` values. In-process is fine for a single-container deployment;
if you ever run multiple replicas, move the counters to Postgres (an `UPSERT … RETURNING` on a
small table is more than fast enough at family scale) or Redis if one is already present. Do not
add a Redis dependency solely for rate limiting.

Response on throttle:

```http
HTTP/1.1 429 Too Many Requests
Content-Type: application/problem+json
RateLimit-Policy: "ai";q=120;w=60
RateLimit: "ai";r=0;t=37
Retry-After: 37
X-RateLimit-Limit: 120
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 37

{
  "type": "https://femho.app/errors/rate-limited",
  "title": "Massa peticions",
  "status": 429,
  "detail": "Aquest testimoni ha superat el límit de 120 peticions per minut.",
  "retry_after_seconds": 37,
  "policy": "ai"
}
```

**Exemptions:** `GET /.well-known/femho`, `GET /healthz`, `GET /api/v1/events/stream` (an SSE
connection is one request that lasts an hour — counting it against a per-minute bucket is wrong;
limit *concurrent streams per user* instead, e.g. 5).

### 15.3 Request logging

Structured JSON lines, one per request:

```json
{"ts":"2026-08-05T12:00:01.234Z","level":"info","request_id":"req_01JQ8F9ZZZ",
 "method":"PATCH","path":"/api/v1/tasks/:id","route":"tasks.update","status":200,
 "duration_ms":14,"bytes_out":842,
 "principal":{"kind":"ai","user_id":"usr_borja","actor_user_id":"usr_ai","token_id":"tok_01J…","source":"mcp"},
 "scope_id":"scp_feina","entity_id":"tsk_01J…",
 "ip":"192.168.1.40","ua":"claude-mcp/1.2","if_match":true,"idempotency_key_present":true,
 "ratelimit":{"policy":"ai","remaining":118}}
```

Rules:
- Log the **route template** (`/api/v1/tasks/:id`), not the concrete path, as a separate field —
  otherwise cardinality explodes and you cannot aggregate.
- **Never** log: `Authorization` headers, cookies, token secrets, share passwords, request bodies
  containing passwords, attachment contents. Redact by allow-list.
- Log the `request_id` that also appears in every problem document and in `X-Request-Id`.
- Two log streams: access log (above) and the audit log (§14, in the DB). They answer different
  questions and have different retention. Do not conflate them.
- Default log level `info`; `FEMHO_LOG_LEVEL=debug` may log bodies, and must print a warning at
  boot that it does.

---

## 16. Realtime: SSE vs WebSocket

### 16.1 The facts

**Server-Sent Events**, defined in the WHATWG HTML Standard:
- Media type **`text/event-stream`**, always UTF-8.
- Four fields: **`event`** (sets the event type buffer; default `"message"`), **`data`** (appended
  to the data buffer, followed by a newline), **`id`** (sets the last event ID; rejected if it
  contains NULs), **`retry`** (reconnection time in ms, if the value is only ASCII digits).
- Lines beginning with `:` are comments and are ignored (use them as keep-alives).
- Lines end with CRLF, LF or CR; a **blank line dispatches the event**.
- On reconnection the user agent sends the **`Last-Event-ID`** request header with the last id
  received. This is the resumption mechanism, and it is built into the browser.
- Reconnection is **automatic**. HTTP **204** disables reconnection; 301/307 redirects are followed.
- `new EventSource(url, { withCredentials: true })` sets CORS credentials mode to "include".
- The spec explicitly warns that multiple EventSource objects to one domain may hit the
  per-server connection limit, suggesting unique domains, user controls, or shared workers.

Verified example stream from the spec:
```
: test stream

data: first event
id: 1

data:second event
id

data:  third event
```

Connection-limit reality: under HTTP/1.1 browsers cap at ~6 connections per origin, so 6
EventSource streams starve the rest of the page. Under **HTTP/2 this disappears** — streams are
multiplexed over one TCP connection, with a negotiated maximum concurrent stream count that
commonly defaults to ~100.

**WebSocket** is full-duplex over one TCP connection and has no browser-imposed per-origin
connection limit.

### 16.2 Recommendation: SSE

Use **SSE**. The reasons, in order of weight for Fem-ho:

1. **The traffic is one-directional.** Clients write via the REST API (which already handles
   auth, validation, idempotency, ETags, audit) and only need to *hear about* changes. Adding a
   WebSocket means either duplicating write paths over the socket or having a socket that is
   write-idle — the first is a security and maintenance disaster, the second wastes the socket's
   only advantage.
2. **Resumption is free and maps perfectly onto the audit log.** Set the SSE `id` to
   `activity_event.seq`. On reconnect the browser sends `Last-Event-ID: 918273` and the server
   replays `SELECT … WHERE seq > 918273 AND scope_id = ANY($visible) ORDER BY seq`. You get
   exactly-once-after-reconnect semantics with no extra machinery, and you get it from a table you
   already had to build. With WebSocket you must design, implement and test this yourself.
3. **It survives reverse proxies.** Self-hosters put Fem-ho behind Nginx, Caddy, Traefik,
   Cloudflare Tunnel, nginx-proxy-manager. SSE is plain HTTP: no `Upgrade` handshake to
   misconfigure, no timeout tuning, no "it works on my VPS but not behind my tunnel" support
   threads. (One caveat: tell users to set `proxy_buffering off;` in Nginx — that is the entire
   configuration burden.)
4. **Automatic reconnection with backoff is in the browser.** The `retry:` field lets the server
   tune it. WebSocket reconnection is application code you have to write, get wrong, and fix.
5. **No sticky sessions.** Any replica can serve any stream because the resumption state is a
   database cursor, not connection state.
6. **HTTP/2 removes the historical objection.** Fem-ho needs *one* stream per tab, so even
   HTTP/1.1's 6-connection limit is not binding.

**When you would be wrong:** if Fem-ho later adds live collaborative text editing of task
descriptions with per-keystroke presence, that is bidirectional high-frequency traffic and
WebSocket becomes correct. Keep the option open by putting the client-side stream behind an
abstraction, but do not pre-build it.

### 16.3 Concrete design

```http
GET /api/v1/events/stream?scope_id=scp_feina&scope_id=scp_familia HTTP/1.1
Accept: text/event-stream
Last-Event-ID: 918273
Cookie: __Host-femho_session=…
```
```http
HTTP/1.1 200 OK
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-store
X-Accel-Buffering: no
Connection: keep-alive
```
```
retry: 5000

: connected

event: task.updated
id: 918274
data: {"object":"task","id":"tsk_01JQ8…","column":"doing","sequence":918274,"updated_by":{"type":"ai","id":"usr_ai"}}

event: task.created
id: 918275
data: {"object":"task","id":"tsk_01JQ9…","title":"Comprar pa","column":"inbox","scope_id":"scp_familia","sequence":918275}

: keepalive

event: checklist.item.toggled
id: 918276
data: {"object":"checklist_item","id":"cki_01JQ…","checklist_id":"chk_01JQ…","is_done":true,"sequence":918276}
```

Implementation notes:

- **`retry: 5000`** as the first line sets the client's reconnection delay to 5 s.
- **Keep-alive comment (`: keepalive`) every 20–25 seconds.** Without it, proxies and load
  balancers close idle connections at 30–60 s and users see a reconnect storm.
- **`X-Accel-Buffering: no`** disables Nginx response buffering for this response without requiring
  the user to edit their Nginx config. Ship this header.
- Filter server-side by the principal's `VisibleScopeIDs` **intersected** with the requested
  `scope_id` params. Never send an event for a scope the principal cannot see — the SSE stream is
  as much an authorization surface as any endpoint, and it is the one people forget.
- Event names mirror the webhook event names (§17) exactly. One vocabulary for both.
- The payload is the **changed entity**, not a diff — the client replaces its local copy. Include
  `sequence` so the client can ignore an event it has already applied (which happens after a
  local write completes before the stream event arrives).
- Cap concurrent streams per user (5) and per instance; on exceed return `429`.
- Cap the replay window: if `Last-Event-ID` is older than, say, 24 hours or 10 000 events behind,
  send `event: resync` with `data: {"reason":"gap_too_large"}` and let the client do a full refetch
  rather than streaming 50 000 rows.
- **Auth for SSE:** the browser's `EventSource` cannot set an `Authorization` header. The web app
  uses the cookie (`withCredentials: true`). The Android app does not use `EventSource` — it should
  use its normal HTTP client with the bearer header, or simply not use SSE at all and rely on the
  delta-sync endpoint plus FCM push. Do **not** solve this by accepting a token in the query
  string; that leaks credentials into access logs and referrers.

### 16.4 Android: delta sync, not SSE

The Android app is offline-first with a local database, so a push stream is the wrong primary
mechanism. Give it:

```http
GET /api/v1/sync?since=918200&scope_id=scp_feina&limit=500
```
```json
{
  "object": "sync_result",
  "changes": {
    "tasks":           [ /* full objects, created or updated */ ],
    "checklists":      [ /* … */ ],
    "checklist_items": [ /* … */ ],
    "comments":        [ /* … */ ],
    "projects":        [ /* … */ ],
    "scopes":          [ /* … */ ]
  },
  "deletions": [
    { "entity_type": "task", "id": "tsk_01JQ…", "deleted_at": "2026-08-05T09:00:00Z" }
  ],
  "cursor": 918700,
  "has_more": true,
  "full_resync_required": false
}
```

- `since` is the `sequence` cursor, same numbers as SSE ids and `activity_event.seq`.
- `has_more: true` means call again immediately with the new `cursor` — the client loops until
  `has_more` is false, then persists the cursor.
- `full_resync_required: true` when `since` predates the retention window or when the server cannot
  produce a correct delta (schema migration, scope membership change that changed visibility).
  The client then wipes and refetches.
- **Deletions need tombstones.** Keep a `deleted_entity` table (or a `deleted_at` column plus a
  retention policy) — a delta sync that cannot report deletions will resurrect deleted tasks on
  every device forever. This is the classic sync bug.
- Membership changes must invalidate: if a user is removed from a scope, the next `/sync` must
  return that scope's entities as deletions, otherwise the phone keeps a local copy of data the
  user no longer has access to.
- Combine with **FCM data messages** as a wake-up hint ("something changed in scope X, call
  /sync") rather than carrying payloads in the push. Payload-carrying pushes leak task titles
  through Google's infrastructure — for a self-hosted privacy-motivated product that is the wrong
  trade, and it makes the push path a second, untested write path.

---

## 17. Outbound webhooks

### 17.1 The standard to follow — verified

**Standard Webhooks** (standard-webhooks/standard-webhooks):

- Headers: **`webhook-id`**, **`webhook-timestamp`**, **`webhook-signature`**.
- Payload has three core fields: **`type`** (hierarchical, full-stop delimited event identifier),
  **`timestamp`** (ISO 8601), **`data`** (the event information).
- The content that is signed is the concatenation `msg_id.timestamp.payload`, e.g.
  `"msg_2KWPBgLlAfxdpx2AI54pPJ85f4W.1674087231.{"type":"contact.created"...}"`.
- Symmetric scheme: **HMAC-SHA256**, signature identifier **`v1`**, secret prefixed **`whsec_`**.
  Example header value: `"v1,K5oZfzN95Z9UVu1EsfQmfVNQhnkZ2pj9o9NDN/H/pI4="`.
- Asymmetric scheme: **ed25519**, identifier **`v1a`**, keys prefixed `whsk_` (secret) and
  `whpk_` (public).
- Multiple signatures may appear **space-delimited** in `webhook-signature` for zero-downtime
  secret rotation.
- Event type convention: "hierarchical, and full-stop delimited, list of identifiers, and that the
  identifiers would be limited to a limited set of characters `[a-zA-Z0-9_]`".
- Recommended retry schedule: **ten attempts over 75+ hours** — immediately, then after 5 seconds,
  5 minutes, 30 minutes, 2 hours, 5 hours, 10 hours, 14 hours, 20 hours, 24 hours.
- Receivers must verify the timestamp is "within some allowable tolerance of the current timestamp
  to prevent replay attacks" (the spec does not fix the number; **300 seconds** is the widely used
  value and what Fem-ho should document).

### 17.2 Fem-ho event catalogue

Names are shared with SSE (§16). `[a-z0-9_]` segments, full-stop delimited.

```
task.created
task.updated
task.moved                 # column changed; data includes from_column / to_column
task.completed
task.reopened
task.deleted
task.restored
task.assigned
task.unassigned
task.delegated             # execution_mode set to ai_delegated
task.due_soon              # emitted by a scheduler, not by a user action
task.overdue

subtask.created
subtask.completed

checklist.created
checklist.updated
checklist.deleted
checklist.pinned
checklist.unpinned
checklist.item.created
checklist.item.toggled
checklist.item.deleted
checklist.completed        # all items done

comment.created
comment.deleted

attachment.created
attachment.deleted

project.created
project.updated
project.archived
project.deleted

scope.created
scope.updated
scope.member_added
scope.member_removed
scope.member_role_changed

share.created
share.viewed               # a guest opened the link; data includes guest_name if required
share.revoked
share.expired

token.created
token.revoked
token.expiring_soon        # 7 days out

calendar.synced            # a CalDAV client wrote through
```

Subscription model:

```json
POST /api/v1/webhooks
{
  "url": "https://n8n.casa.local/webhook/femho",
  "events": ["task.created", "task.completed", "task.delegated"],
  "scope_ids": ["scp_familia"],
  "active": true
}
```
Response includes the signing secret **once**:
```json
{
  "id": "whk_01JQ8…",
  "object": "webhook",
  "url": "https://n8n.casa.local/webhook/femho",
  "events": ["task.created","task.completed","task.delegated"],
  "scope_ids": ["scp_familia"],
  "secret": "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw",
  "active": true,
  "created_at": "2026-08-05T12:00:00Z"
}
```

Wildcards in `events` (`task.*`, `*`) are convenient; expand them at match time, not at
subscription time, so new event types are picked up.

### 17.3 Delivery

```http
POST /webhook/femho HTTP/1.1
Host: n8n.casa.local
Content-Type: application/json
User-Agent: Femho-Webhooks/1.4.2
webhook-id: msg_01JQ8F9ZZZ7X
webhook-timestamp: 1785931201
webhook-signature: v1,K5oZfzN95Z9UVu1EsfQmfVNQhnkZ2pj9o9NDN/H/pI4=

{
  "type": "task.completed",
  "timestamp": "2026-08-05T12:00:01Z",
  "data": {
    "task": {
      "id": "tsk_01JQ8F3K2M7XA4B9CDEF",
      "object": "task",
      "title": "Portar el cotxe a l'ITV",
      "column": "done",
      "scope_id": "scp_01JQ8…FEINA",
      "scope_slug": "feina",
      "project_id": null,
      "completed_at": "2026-08-05T12:00:01Z",
      "sequence": 918274
    },
    "actor": { "type": "ai", "id": "usr_01JQ8…AIUSER", "display_name": "Assistent" },
    "on_behalf_of": { "type": "user", "id": "usr_01JQ8…BORJA", "display_name": "Borja" },
    "source": "mcp",
    "previous": { "column": "doing", "completed_at": null }
  },
  "instance": { "id": "inst_01JQ8…", "name": "Casa Balsera", "version": "1.4.2" },
  "event_id": "evt_01JQ8F9ZZZ7X",
  "sequence": 918274
}
```

Signing, exactly:

```
signed_content = webhook_id + "." + webhook_timestamp + "." + raw_body
signature      = "v1," + base64(hmac_sha256(base64decode(secret_without_prefix), signed_content))
```

During rotation emit both:
```
webhook-signature: v1,<sig_with_new_secret> v1,<sig_with_old_secret>
```

Verification snippet to publish in the docs (Node, because n8n users will paste it):

```js
const crypto = require("crypto");

function verify(rawBody, headers, secret, toleranceSec = 300) {
  const id = headers["webhook-id"];
  const ts = headers["webhook-timestamp"];
  const sigHeader = headers["webhook-signature"];
  if (!id || !ts || !sigHeader) return false;

  if (Math.abs(Math.floor(Date.now() / 1000) - Number(ts)) > toleranceSec) return false;

  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = crypto.createHmac("sha256", key)
                         .update(`${id}.${ts}.${rawBody}`)
                         .digest("base64");

  return sigHeader.split(" ").some((part) => {
    const [ver, sig] = part.split(",");
    if (ver !== "v1" || !sig) return false;
    const a = Buffer.from(sig), b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
}
```

Note `rawBody` — verification must run on the exact bytes received, before any JSON parse/reserialize.
Say so loudly in the docs; it is the number one integration failure.

### 17.4 Retries and failure handling

- Consider `2xx` a success; anything else, plus timeouts, is a failure.
- **Timeout: 10 seconds** connect+read. A webhook consumer that takes longer should return 202
  and work asynchronously.
- Retry schedule: exactly the Standard Webhooks one — immediate, 5 s, 5 min, 30 min, 2 h, 5 h,
  10 h, 14 h, 20 h, 24 h (10 attempts, >75 hours of coverage). Add ±10% jitter.
- **Auto-disable** after all attempts fail for N consecutive deliveries (N=20) or after 5
  consecutive days of total failure. Set `active=false`, record `disabled_reason`, and notify the
  owner in-app. A dead n8n instance should not generate retry traffic forever.
- **Ordering is not guaranteed.** Say so. Consumers must use `sequence` to order and `webhook-id`
  to deduplicate. Do not build a strict-ordering guarantee — it costs a per-endpoint serial queue
  and head-of-line blocking on one slow consumer.
- Delivery log: `webhook_delivery(id, webhook_id, event_id, attempt, status_code, response_ms,
  error, delivered_at)`, retained 7 days, exposed at
  `GET /api/v1/webhooks/{id}/deliveries` and replayable via
  `POST /api/v1/webhooks/{id}/deliveries/{delivery_id}/retry`. This is what turns "my automation
  didn't fire" from a mystery into a two-click diagnosis.
- Send a `webhook.test` event on demand: `POST /api/v1/webhooks/{id}/test`.

### 17.5 SSRF — do not skip this

The user supplies the URL, and the server fetches it. That is OWASP **API7:2023 Server Side
Request Forgery** by construction. In a self-hosted context the target is usually *deliberately*
on the LAN (`https://n8n.casa.local`), so you cannot simply block private ranges. Mitigate instead:

- Require `https://` by default; allow `http://` only when
  `FEMHO_WEBHOOKS_ALLOW_INSECURE=1`.
- Block `localhost`, `127.0.0.0/8`, `::1`, `169.254.169.254` (cloud metadata) and the link-local
  range **always**, with no override. Metadata endpoints are the actual attack.
- Resolve DNS once and connect to the resolved IP, re-checking the denylist after resolution
  (defeats DNS rebinding).
- Do not follow redirects.
- Cap the response body read at 64 KiB and discard it — you only need the status code.
- Only scope `owner`/`admin` may create webhooks; `member` and `viewer` may not.
- Never let a `kind='ai'` token create a webhook (`webhooks:write` unavailable to AI tokens) — an
  agent that can create a webhook can exfiltrate every future change to an arbitrary URL.

---

## 18. Multi-tenancy and the permission model

### 18.1 Scopes are the tenancy boundary

There is no "organization" above scopes. A Fem-ho instance is one household; a **scope (àmbit)** is
the unit of membership and the unit of authorization. Every entity in the system resolves to
exactly one scope, and that resolution is the first step of every policy check.

```
scope ──< project ──< task ──< subtask
  │                    │└──< comment
  │                    │└──< attachment
  │                    └──< checklist ──< checklist_item
  └──< scope_member >── user
```

- A scope is `personal` (exactly one member, the owner, and cannot gain members) or `collective`.
  Enforce the distinction — a "Personal" scope that can silently acquire members is a privacy
  incident waiting to happen. Converting personal → collective is allowed with an explicit
  confirmation; collective → personal is allowed only when there is one member left.
- The three seeded scopes (Personal / Feina / Família) are ordinary rows, not special cases.
  Seed them per user at signup with `is_system_seeded=true` purely so the UI can offer nicer
  defaults. Everything else about them is user-editable.
- Projects belong to exactly one scope. Moving a project between scopes is an `admin` operation on
  both scopes and must cascade the effective permissions of every task in it — do it in one
  transaction and emit one activity event per affected task with `verb='rescoped'`.
- The scope's **general space** is `project_id IS NULL`. It is not a special project row; do not
  create a phantom "General" project, because CalDAV collection mapping and the project dropdown
  both get confusing.

### 18.2 Roles

Four roles, plus the implicit non-member. Keep it at four.

| Role | Tasks/checklists/comments | Projects | Scope settings | Members | Shares | CalDAV | Webhooks |
|---|---|---|---|---|---|---|---|
| **owner** | full | full | full, incl. delete scope | add/remove/change roles, incl. admins | full | full | full |
| **admin** | full | full | rename, colour, settings | add/remove members and viewers; not other admins/owner | full | full | full |
| **member** | full (create/edit/complete/delete own and others') | create/rename; not delete non-empty | read | read | create/revoke own | read own credentials | none |
| **viewer** | read only; may comment (configurable per scope) | read | read | read | none | read-only calendar | none |

Rules:
- Exactly **one owner** per scope, always. Deleting/leaving requires transferring ownership first.
  Reject the last-owner-leaves case with `409 /errors/last-owner`.
- `viewer` + `allow_viewer_comments` (per-scope boolean, default `true`) — a grandparent who can
  see the family list and say "I'll do that one" without being able to restructure it is a real use
  case.
- Role changes are `admin` operations and always produce an activity event
  (`verb='role_changed'`, before/after).
- Roles are per-scope. A user is `owner` of Personal, `member` of Família, `viewer` of a
  neighbour's shared scope. There is no instance-wide "admin" **for data** — only an instance
  operator flag (`is_instance_admin`) for server administration (user creation, instance settings,
  backups), which grants **no** access to other users' task data. Make that explicit in the docs;
  it is a meaningful selling point for a family server, and it means an instance admin who wants
  data access must be added as a scope member, leaving an audit trail.

Membership table:

```sql
CREATE TABLE scope_member (
  scope_id    UUID NOT NULL REFERENCES scope(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('owner','admin','member','viewer')),
  added_by    UUID NULL REFERENCES app_user(id),
  added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (scope_id, user_id)
);
CREATE UNIQUE INDEX one_owner_per_scope ON scope_member (scope_id) WHERE role = 'owner';
```

That partial unique index enforces the single-owner invariant in the database, which is where
invariants belong.

### 18.3 Collective scopes with external CalDAV members

The scenario: a collective scope "Família" where one participant does not have (or want) a Fem-ho
account and only consumes the tasks through their phone's calendar app.

Three mechanisms, in increasing order of integration:

**(a) Read-only subscription URL (no account).** A signed, revocable URL serving `text/calendar`:

```
GET /dav/public/{share_secret}/calendar.ics
```
Subscribe-only (`webcal://`), works in every calendar client, no credentials to manage. Implement
as a share (§18.4) whose `kind='calendar_subscription'`. Give it an expiry and a revoke button.
Downside: read-only, and the URL is a bearer credential — never put a task's full description in
it if the scope holds sensitive content, and rotate it easily.

**(b) A real user account whose only credential is a CalDAV app password.** Create the user, add
them to the scope as `member` or `viewer`, and issue them a `femho_cal_` token. They never log in
to the web UI; their phone's CalDAV client authenticates with Basic auth. Writes flow back through
the same service layer with `source=caldav`, so the activity log correctly attributes their
changes. **This is the right answer for a family member who should be able to tick things off.**
It costs one user row and gives you correct attribution, correct permissions, and instant
revocation.

**(c) Federated/external identity.** Out of scope for v1. **UNVERIFIED** whether any
meaningful CalDAV-level federation standard applies here beyond plain sharing; do not design for it.

**What Fem-ho should do:** ship (a) and (b). Present them in the UI as two clearly different
things: "Comparteix un calendari (només lectura)" and "Afegeix un membre que només fa servir el
calendari". Make (b) the recommended path and make the account-creation flow for it not require an
email round-trip (the scope admin sets the app password and hands it over).

CalDAV collection mapping (detail belongs to the CalDAV dossier, but the permission consequence
belongs here): each CalDAV collection maps to a `(scope, project|general)` pair, and the principal's
`calendars:*` grant plus their scope role determines which collections appear in
`PROPFIND /dav/principals/{user}/`. A `viewer` gets collections advertised as read-only
(`DAV:current-user-privilege-set` without `DAV:write`), and a `PUT` from them returns `403`.

### 18.4 Public share links

A share link is a **principal**, not a bypass. This is the discipline that keeps it safe.

```sql
CREATE TABLE share (
  id                UUID PRIMARY KEY,
  kind              TEXT NOT NULL CHECK (kind IN ('task','checklist','calendar_subscription')),
  entity_id         UUID NOT NULL,
  scope_id          UUID NOT NULL,
  secret_hash       BYTEA NOT NULL,          -- sha256 of the URL secret
  secret_lookup     BYTEA NOT NULL,          -- indexed prefix
  created_by        UUID NOT NULL REFERENCES app_user(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ NULL,
  password_hash     TEXT NULL,               -- argon2id, if a password is required
  require_name      BOOLEAN NOT NULL DEFAULT false,
  allow_check       BOOLEAN NOT NULL DEFAULT false,  -- guests may tick items
  allow_comment     BOOLEAN NOT NULL DEFAULT false,
  view_count        BIGINT NOT NULL DEFAULT 0,
  last_viewed_at    TIMESTAMPTZ NULL,
  revoked_at        TIMESTAMPTZ NULL
);
```

URL: `https://femho.casa.local/s/{secret}` where secret is `femho_shr_` + 22 base62 chars (~131
bits). Put the secret in the **path**, not a query parameter — query strings end up in access logs
and `Referer` headers more readily. Also send `Referrer-Policy: no-referrer` on share pages so an
outbound link from a task description cannot leak the share URL.

Guest flow:
1. `GET /s/{secret}` → if `password_hash` is set and no valid guest cookie,
   `401 /errors/share-password-required`; render a password form.
2. `POST /s/{secret}/unlock` with the password → sets a short-lived, share-scoped cookie
   (`__Host-femho_share_{share_id}`, 12 h, `HttpOnly`, `SameSite=Lax`).
3. If `require_name`, prompt for a display name before showing content; store it in the guest
   cookie and stamp it into `activity_event.actor_label` for every guest action. That is how the
   family sees "Marta (convidada) ha marcat 2 elements".
4. The guest Principal is `Kind=share_guest`, `UserID` unset, capabilities limited to the exact
   entity subtree, actions limited by `allow_check`/`allow_comment`.

Hard rules:
- A share grants access to **one entity and its declared subtree** (a task + its subtasks +
  its checklists; or one checklist + its items). Never a project, never a scope.
- Guest writes go through the same service layer and produce activity events with
  `actor_type='share_guest'` and `source='share'`.
- `noindex` meta tag and `X-Robots-Tag: noindex, nofollow` on every share page.
- Rate-limit per share id, and rate-limit password attempts hard (5 per 15 min per IP per share).
- `expires_at` default: offer 24 h / 7 d / 30 d / never, default **7 days**. Nothing rots faster
  than a forgotten public link.
- Revoking is instant (`revoked_at`), and revoked links return `410 /errors/share-expired` — not
  `404`, so the recipient understands the link was withdrawn rather than mistyped.
- `share.viewed` events are recorded but **coalesced** (one per share per guest per hour) so a
  guest refreshing does not flood the activity feed.

---

## 19. Concrete endpoint table — Fem-ho API v1

Base: `/api/v1`. All responses `application/json`; errors `application/problem+json`.
`Auth` column: **S**=interactive session, **P**=PAT, **A**=AI token, **C**=CalDAV token,
**G**=share guest, **—**=none.

### Discovery and health

| Method | Path | Auth | Capability | Notes |
|---|---|---|---|---|
| GET | `/.well-known/femho` | — | — | server discovery for the Android login screen |
| GET | `/healthz` | — | — | liveness |
| GET | `/readyz` | — | — | readiness (DB reachable) |
| GET | `/api/v1/openapi.json` | — | — | the spec |
| GET | `/api/v1/routes` | S,P,A | — | every route + required capability (Vikunja-style; powers the token UI and MCP tool generation) |

### Auth and sessions

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/api/v1/auth/login` | — | email+password (+`totp_code`); cookie for web, `token` for android |
| POST | `/api/v1/auth/logout` | S | revokes current session |
| POST | `/api/v1/auth/logout_all` | S | revokes all sessions for the user |
| GET | `/api/v1/auth/me` | S,P,A | current principal, capabilities, user |
| POST | `/api/v1/auth/password` | S | change password; requires current password |
| POST | `/api/v1/auth/totp/setup` | S | returns secret + otpauth URI |
| POST | `/api/v1/auth/totp/activate` | S | verify code → enable, returns recovery codes |
| DELETE | `/api/v1/auth/totp` | S | disable; requires password |
| POST | `/api/v1/auth/totp/recovery_codes` | S | regenerate |
| GET | `/api/v1/sessions` | S | device list |
| DELETE | `/api/v1/sessions/{id}` | S | revoke one |

### Users

| Method | Path | Auth | Capability |
|---|---|---|---|
| GET | `/api/v1/users` | S,P,A | `users:read@*` — only users sharing a scope with the caller |
| GET | `/api/v1/users/{id}` | S,P,A | `users:read@*` |
| PATCH | `/api/v1/users/me` | S | — (display name, locale, timezone, avatar) |
| POST | `/api/v1/users` | S (instance admin) | — |
| DELETE | `/api/v1/users/{id}` | S (instance admin) | — |

### Scopes (àmbits)

| Method | Path | Auth | Capability |
|---|---|---|---|
| GET | `/api/v1/scopes` | S,P,A | `scopes:read@*` |
| POST | `/api/v1/scopes` | S,P | `scopes:write@*` |
| GET | `/api/v1/scopes/{id}` | S,P,A | `scopes:read@{id}` |
| PATCH | `/api/v1/scopes/{id}` | S,P | `scopes:write@{id}` + role ≥ admin |
| DELETE | `/api/v1/scopes/{id}` | S | `scopes:admin@{id}` + role = owner |
| GET | `/api/v1/scopes/{id}/members` | S,P,A | `members:read@{id}` |
| POST | `/api/v1/scopes/{id}/members` | S,P | `members:admin@{id}` |
| PUT | `/api/v1/scopes/{id}/members/{user_id}` | S,P | `members:admin@{id}` — set role |
| DELETE | `/api/v1/scopes/{id}/members/{user_id}` | S,P | `members:admin@{id}` |
| POST | `/api/v1/scopes/{id}/transfer_ownership` | S | role = owner |

### Projects

| Method | Path | Auth | Capability |
|---|---|---|---|
| GET | `/api/v1/projects?scope_id=` | S,P,A | `projects:read@{scope}` |
| POST | `/api/v1/projects` | S,P,A | `projects:write@{scope}` |
| GET | `/api/v1/projects/{id}` | S,P,A | `projects:read@{scope}/{id}` |
| PATCH | `/api/v1/projects/{id}` | S,P,A | `projects:write@{scope}/{id}` |
| POST | `/api/v1/projects/{id}/archive` | S,P | `projects:write@…` |
| DELETE | `/api/v1/projects/{id}` | S,P | `projects:admin@…` |

### Tasks

| Method | Path | Auth | Capability |
|---|---|---|---|
| GET | `/api/v1/tasks` | S,P,A,G* | `tasks:read@…` — the board and calendar query |
| GET | `/api/v1/tasks/count` | S,P,A | `tasks:read@…` |
| POST | `/api/v1/tasks` | S,P,A | `tasks:write@…` — `Idempotency-Key` |
| POST | `/api/v1/tasks/quick_add` | S,P,A | `tasks:write@…` — inline `@person` `#Scope/Project` parsing |
| GET | `/api/v1/tasks/{id}` | S,P,A,G | `tasks:read@…` — returns `ETag` |
| PATCH | `/api/v1/tasks/{id}` | S,P,A | `tasks:write@…` — merge-patch, `If-Match` |
| DELETE | `/api/v1/tasks/{id}` | S,P,A | `tasks:write@…` — soft unless `deny_hard_delete` is off |
| POST | `/api/v1/tasks/{id}/restore` | S,P | `tasks:write@…` |
| POST | `/api/v1/tasks/{id}/move` | S,P,A,G | `tasks:write@…` — `{column, before_task_id, after_task_id}` |
| POST | `/api/v1/tasks/{id}/complete` | S,P,A,G | `tasks:write@…` |
| POST | `/api/v1/tasks/{id}/reopen` | S,P,A | `tasks:write@…` |
| POST | `/api/v1/tasks/{id}/assign` | S,P,A | `tasks:write@…` — `{user_ids, mode: add\|remove\|set}` |
| POST | `/api/v1/tasks/{id}/labels` | S,P,A | `tasks:write@…` |
| POST | `/api/v1/tasks/{id}/delegate` | S,P | `tasks:write@…` — sets `execution_mode` (never available to A) |
| GET | `/api/v1/tasks/{id}/subtasks` | S,P,A,G | `tasks:read@…` |
| POST | `/api/v1/tasks/{id}/subtasks` | S,P,A | `tasks:write@…` |
| GET | `/api/v1/tasks/{id}/activity` | S,P,A | `activity:read@…` |
| POST | `/api/v1/tasks/bulk/{action}` | S,P,A | `tasks:write@…` — `Idempotency-Key` required |

\* Guests only reach tasks inside their share's subtree.

### Checklists

| Method | Path | Auth | Capability |
|---|---|---|---|
| GET | `/api/v1/checklists?task_id=&scope_id=&pinned=` | S,P,A,G | `checklists:read@…` |
| POST | `/api/v1/checklists` | S,P,A | `checklists:write@…` |
| GET | `/api/v1/checklists/{id}` | S,P,A,G | `checklists:read@…` |
| PATCH | `/api/v1/checklists/{id}` | S,P,A | `checklists:write@…` |
| DELETE | `/api/v1/checklists/{id}` | S,P,A | `checklists:write@…` |
| POST | `/api/v1/checklists/{id}/pin` | S,P,A | `checklists:write@…` |
| DELETE | `/api/v1/checklists/{id}/pin` | S,P,A | `checklists:write@…` |
| GET | `/api/v1/checklists/{id}/items` | S,P,A,G | `checklists:read@…` |
| POST | `/api/v1/checklists/{id}/items` | S,P,A,G* | `checklists:write@…` |
| PATCH | `/api/v1/checklists/{id}/items/{item_id}` | S,P,A,G* | `checklists:write@…` |
| POST | `/api/v1/checklists/{id}/items/{item_id}/toggle` | S,P,A,G* | `checklists:write@…` |
| DELETE | `/api/v1/checklists/{id}/items/{item_id}` | S,P,A | `checklists:write@…` |
| POST | `/api/v1/checklists/{id}/reorder` | S,P,A | `checklists:write@…` |

\* Guest only when the share has `allow_check`.

### Comments and attachments

| Method | Path | Auth | Capability |
|---|---|---|---|
| GET | `/api/v1/tasks/{id}/comments` | S,P,A,G | `comments:read@…` |
| POST | `/api/v1/tasks/{id}/comments` | S,P,A,G* | `comments:write@…` |
| PATCH | `/api/v1/comments/{id}` | S,P,A | `comments:write@…` — author only, or role ≥ admin |
| DELETE | `/api/v1/comments/{id}` | S,P,A | `comments:write@…` |
| GET | `/api/v1/tasks/{id}/attachments` | S,P,A,G | `attachments:read@…` |
| POST | `/api/v1/tasks/{id}/attachments` | S,P | `attachments:write@…` — multipart |
| GET | `/api/v1/attachments/{id}` | S,P,A,G | `attachments:read@…` — metadata |
| GET | `/api/v1/attachments/{id}/content` | S,P,A,G | `attachments:read@…` — `Content-Disposition: attachment` |
| DELETE | `/api/v1/attachments/{id}` | S,P | `attachments:write@…` |

\* Guest only when the share has `allow_comment`.

### Activity, search, sync, events

| Method | Path | Auth | Capability |
|---|---|---|---|
| GET | `/api/v1/activity?scope_id=&actor_type=&entity_type=&since=` | S,P,A | `activity:read@…` |
| GET | `/api/v1/search?q=&scope_id=&type=` | S,P,A | per-resource read |
| GET | `/api/v1/sync?since=&scope_id=` | S,P | `tasks:read@…` etc. — Android delta sync |
| GET | `/api/v1/events/stream?scope_id=` | S | `text/event-stream`, `Last-Event-ID` |
| POST | `/api/v1/batch` | S,P,A | per-operation — `Idempotency-Key` required |

### Shares

| Method | Path | Auth | Capability |
|---|---|---|---|
| GET | `/api/v1/shares?scope_id=` | S,P | `shares:read@…` |
| POST | `/api/v1/shares` | S,P | `shares:write@…` — returns the URL once |
| GET | `/api/v1/shares/{id}` | S,P | `shares:read@…` |
| PATCH | `/api/v1/shares/{id}` | S,P | `shares:write@…` |
| DELETE | `/api/v1/shares/{id}` | S,P | `shares:write@…` — revoke |
| GET | `/s/{secret}` | G | — public HTML page |
| POST | `/s/{secret}/unlock` | — | password + optional guest name |
| GET | `/api/v1/public/shares/{secret}` | G | JSON for the share page |

### Tokens, webhooks, calendars

| Method | Path | Auth | Capability |
|---|---|---|---|
| GET | `/api/v1/tokens` | S | — (own tokens; secrets never returned) |
| POST | `/api/v1/tokens` | S | — secret returned once |
| GET | `/api/v1/tokens/{id}` | S | — |
| PATCH | `/api/v1/tokens/{id}` | S | — rename, narrow grants (never widen without re-auth) |
| POST | `/api/v1/tokens/{id}/rotate` | S, or self with `tokens:rotate_self` | — |
| DELETE | `/api/v1/tokens/{id}` | S | — revoke |
| GET | `/api/v1/webhooks` | S,P | `webhooks:read@…` |
| POST | `/api/v1/webhooks` | S,P | `webhooks:write@…` — role ≥ admin, never A |
| PATCH | `/api/v1/webhooks/{id}` | S,P | `webhooks:write@…` |
| DELETE | `/api/v1/webhooks/{id}` | S,P | `webhooks:write@…` |
| POST | `/api/v1/webhooks/{id}/test` | S,P | `webhooks:write@…` |
| GET | `/api/v1/webhooks/{id}/deliveries` | S,P | `webhooks:read@…` |
| POST | `/api/v1/webhooks/{id}/deliveries/{did}/retry` | S,P | `webhooks:write@…` |
| GET | `/api/v1/calendars` | S,P,A | `calendars:read@…` — lists CalDAV collections + URLs |
| POST | `/api/v1/calendars` | S,P | `calendars:admin@…` |
| DELETE | `/api/v1/calendars/{id}` | S,P | `calendars:admin@…` |
| — | `/dav/*` | C,S | CalDAV surface — see the CalDAV dossier |
| — | `/mcp` | A,P | MCP server — see the MCP dossier |

---

## 20. The token-scope grammar, restated concretely

### 20.1 Grammar (ABNF-ish)

```abnf
grant            = permission "@" target
permission       = resource ":" action
resource         = "tasks" / "checklists" / "comments" / "attachments" /
                   "projects" / "scopes" / "members" / "calendars" /
                   "shares" / "activity" / "webhooks" / "tokens" /
                   "users" / "search"
action           = "read" / "write" / "admin"
target           = scope-selector [ "/" project-selector ]
scope-selector   = "*" / slug
project-selector = "*" / "-" / slug        ; "-" = the scope's general space only
slug             = 1*63(ALPHA / DIGIT / "-" / "_")
```

Action lattice: `read` ⊂ `write` ⊂ `admin`.
HTTP mapping: `GET`/`HEAD` → `read`; `POST`/`PATCH`/`PUT`/`DELETE` → `write`;
membership, role, scope-deletion and calendar-collection operations → `admin`.

### 20.2 Stored form

```json
{
  "version": 1,
  "grants": [
    {
      "resource": "tasks",
      "action": "write",
      "scope_id": "scp_01JQ8F3K2M7XFEINA00",
      "scope_slug": "feina",
      "project_id": null,
      "project_slug": "*"
    },
    {
      "resource": "checklists",
      "action": "write",
      "scope_id": "scp_01JQ8F3K2M7XFEINA00",
      "scope_slug": "feina",
      "project_id": null,
      "project_slug": "*"
    },
    {
      "resource": "activity",
      "action": "read",
      "scope_id": "scp_01JQ8F3K2M7XFEINA00",
      "scope_slug": "feina",
      "project_id": null,
      "project_slug": "*"
    }
  ],
  "constraints": {
    "require_if_match": true,
    "deny_hard_delete": true,
    "ai_delegated_only": true,
    "ip_allowlist": [],
    "max_writes_per_hour": 500
  }
}
```

`scope_id: null` + `scope_slug: "*"` encodes the wildcard.

### 20.3 The canonical answer to "read+write tasks in scope Feina only"

Display form:
```
tasks:write@feina
```
Complete token creation request:
```json
POST /api/v1/tokens
{
  "kind": "pat",
  "name": "Script de sincronització — Feina",
  "grants": ["tasks:write@feina"],
  "expires_in_days": 90
}
```
This grants: read and write tasks (and only tasks) in the general space of Feina and in every
project of Feina; and **nothing else** — no checklists, no comments, no project management, no
member list, no activity log, no other scope. And it grants that only to the extent that the
owning user's role in Feina already allows it.

### 20.4 Invariants a reviewer should be able to check in five minutes

1. `effective = membership ∩ capabilities`. Grep for any code path computing permissions without
   both terms.
2. No grant string can be constructed that references a scope the owner is not a member of at
   creation time (UI check) — and even if one were, rule 1 makes it inert (engine check).
3. `kind='ai'` cannot hold `tokens:*`, `members:admin`, `users:write`, `webhooks:write`,
   `scopes:admin`.
4. `kind='caldav'` is rejected on every path except `/dav/*`.
5. `PATCH /tokens/{id}` can only narrow. Widening requires the interactive session + password
   re-entry, or creating a new token.
6. Every repository list method takes a `[]ScopeID` visibility argument and cannot be called
   without it.
7. Every mutation writes exactly one `activity_event` in the same transaction, carrying
   `actor_type`, `actor_user_id`, `token_id`, `source`.

---

## 21. Implementation order (suggested)

1. `Principal` + authentication middleware + the policy engine with its table-driven test matrix.
   Nothing else until the matrix is green.
2. Scopes, membership, roles, users. `VisibleScopeIDs` and the repository visibility argument.
3. Tasks CRUD + action endpoints + `activity_event` writing + ETag/`If-Match`.
4. Cursor pagination + filtering + the problem catalogue + OpenAPI emission + CI gates.
5. Sessions (cookie + bearer), Argon2id, TOTP.
6. API tokens, the grant grammar, the token UI, `/api/v1/routes`.
7. `/sync` + tombstones (unblocks Android).
8. Checklists, comments, attachments.
9. SSE stream (reuses `activity_event.seq`).
10. Shares.
11. Webhooks out.
12. CalDAV, then MCP — both consume the service layer that already exists, so they are thin.

The ordering matters: 1 and 2 are the load-bearing walls. Everything after is decoration that
becomes unsafe if built before them.

---

## 22. Open questions and things flagged UNVERIFIED

- **RFC 6585 (428 Precondition Required)** — not fetched this session. Confirm the exact semantics
  and whether `428` is appropriate for "you must send `If-Match`" before relying on it.
- **RFC 9700 refresh-token replay detection** — I confirmed the MUST about rotation/sender-
  constraining for public clients but did **not** find normative language mandating
  revoke-the-family-on-reuse. Treat that behaviour as best practice, not as a cited requirement.
- **Library versions** — only `openapi-typescript@7.13.0` and `openapi-fetch@0.17.0` were read from
  the registry. Versions for huma, utoipa, aide, zod-to-openapi, Spectral, Schemathesis, Dredd,
  OpenAPI Generator, and any Argon2/TOTP binding were **not** verified. Check before pinning.
- **OpenAPI 3.2.0 tooling support** — 3.2.0 is published (19 Sept 2025) but which generators handle
  it is unverified. The recommendation to emit 3.1.1 is based on that uncertainty, not on measurement.
- **LexoRank-style ordering libraries** — the algorithm is described from general knowledge; no
  specific implementation was verified this session.
- **PBKDF2-HMAC-SHA1 iteration count** — read as 1 400 000 on the OWASP page on 2026-08-05; other
  published figures say 1 300 000. Irrelevant in practice (do not use SHA-1) but noted.
- **Standard Webhooks timestamp tolerance** — the spec requires "some allowable tolerance" without
  fixing a number; 300 s is the community convention, not a spec value.
- **Vikunja's `/api/v1/routes` response shape** — the existence and purpose of the endpoint is
  confirmed from the docs/wiki, but I did not read its literal JSON shape from source.
- **CalDAV federation for external members** — no standard mechanism verified; recommendation (c)
  in §18.3 is explicitly deferred.
- **Product decisions for the owner to make:** whether `viewer` may comment by default; whether
  attachments are stored on disk or in Postgres large objects; whether the instance ships an SMTP
  dependency (which affects token-expiry notifications and account recovery); default activity
  retention.

---

## 23. Sources

Fetched and read during this session, 2026-08-05:

- RFC 9457, Problem Details for HTTP APIs — https://www.rfc-editor.org/rfc/rfc9457.html
- RFC 7386, JSON Merge Patch — https://www.rfc-editor.org/rfc/rfc7386.html
- RFC 6902, JavaScript Object Notation (JSON) Patch — https://www.rfc-editor.org/rfc/rfc6902.html
- RFC 9110, HTTP Semantics (If-Match / ETag / 412) — https://www.rfc-editor.org/rfc/rfc9110.html#name-if-match
- RFC 9106, Argon2 Memory-Hard Function — https://www.rfc-editor.org/rfc/rfc9106.html
- RFC 6238, TOTP: Time-Based One-Time Password Algorithm — https://www.rfc-editor.org/rfc/rfc6238.html
- RFC 9700, OAuth 2.0 Security Best Current Practice — https://www.rfc-editor.org/rfc/rfc9700.html
- draft-ietf-httpapi-ratelimit-headers (v11, 23 May 2026) — https://www.ietf.org/archive/id/draft-ietf-httpapi-ratelimit-headers-11.html
- draft-ietf-httpapi-idempotency-key-header — https://datatracker.ietf.org/doc/html/draft-ietf-httpapi-idempotency-key-header
- OWASP Password Storage Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- OWASP API Security Top 10 – 2023 — https://owasp.org/API-Security/editions/2023/en/0x11-t10/
- OpenAPI Specification v3.2.0 — https://spec.openapis.org/oas/latest.html
- OpenAPI Specification releases — https://github.com/OAI/OpenAPI-Specification/releases
- GitHub Docs, Permissions required for fine-grained personal access tokens — https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens
- GitHub Blog, Behind GitHub's new authentication token formats — https://github.blog/engineering/platform-security/behind-githubs-new-authentication-token-formats/
- Stripe Docs, Restricted API keys — https://docs.stripe.com/keys/restricted-api-keys
- GitLab Docs, Access token scopes — https://docs.gitlab.com/security/tokens/access_token_scopes/
- Vikunja source, `pkg/models/api_tokens.go` — https://raw.githubusercontent.com/go-vikunja/vikunja/main/pkg/models/api_tokens.go
- Vikunja Docs, API documentation — https://vikunja.io/docs/api-documentation/
- Vikunja API reference (DeepWiki) — https://deepwiki.com/go-vikunja/vikunja/8-api-reference
- Standard Webhooks specification — https://raw.githubusercontent.com/standard-webhooks/standard-webhooks/main/spec/standard-webhooks.md
- WHATWG HTML Standard, Server-sent events — https://html.spec.whatwg.org/multipage/server-sent-events.html
- Google AIP-158, Pagination — https://google.aip.dev/158
- npm registry, openapi-typescript — https://registry.npmjs.org/openapi-typescript/latest
- npm registry, openapi-fetch — https://registry.npmjs.org/openapi-fetch/latest
- OpenFGA documentation (concepts, configuration language) — https://openfga.dev/docs/concepts
- draft-ietf-httpbis-rfc6265bis-14, Cookies — https://datatracker.ietf.org/doc/html/draft-ietf-httpbis-rfc6265bis-14
