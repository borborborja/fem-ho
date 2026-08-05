# CalDAV + iCalendar VTODO — Implementation-Grade Dossier for Fem-ho

> **DELIVERY NOTE (read first).** The orchestrator asked for this file at
> `/private/tmp/claude-501/-Users-borja-Codi-fem-ho/4ee9f810-66f8-4e6f-86dc-06e906a11d09/scratchpad/research/03-caldav-vtodo-spec.md`.
> The session is running in **plan mode**, which forbids writing any file except this plan file.
> The complete dossier is therefore stored here verbatim. Copy it to the intended path when plan mode is lifted:
> `cp "/Users/borja/.claude/plans/elabora-unes-instruccions-md-per-witty-snowflake-agent-a7ad8a297ddecf0f0.md" "/private/tmp/claude-501/-Users-borja-Codi-fem-ho/4ee9f810-66f8-4e6f-86dc-06e906a11d09/scratchpad/research/03-caldav-vtodo-spec.md"`

Research date: 2026-08-05. All versions below were read from live package registries or release feeds on that date.

---

## 0. Executive orientation for Fem-ho

Fem-ho needs **both sides**:

1. **A CalDAV server** so DAVx5 + Tasks.org/jtx Board, Apple Reminders, Thunderbird, Evolution and Nextcloud-adjacent tooling can read and write Fem-ho tasks. Per scope and per project.
2. **A CalDAV client** so Fem-ho can two-way mirror an external calendar/task collection (e.g. a work Nextcloud, an iCloud Reminders list) into a Fem-ho scope.

The three non-obvious structural decisions that follow from the RFCs and from real client behaviour:

- **VTODO collections must be separate from VEVENT collections.** DAVx5 classifies a collection as "calendar" or "tasks" purely from `CALDAV:supported-calendar-component-set`; Apple always creates separate collections; Zimbra refuses mixed. Fem-ho must expose two parallel collection trees (or one tree of VTODO-only collections plus an events tree), never one mixed collection.
- **Subtasks are `RELATED-TO;RELTYPE=PARENT:<parent-UID>` on the child.** Everything else (kanban column, scope, project, AI mode, checklist membership) has **no home in iCalendar** and needs `X-FEMHO-*` properties plus a fallback mapping onto standard properties so that dumb clients still show something sane.
- **The wire identity is the UID, not the URL.** Sabre's own client guide says it flatly: *"The url and the UID have no meaningful relationship."* Fem-ho must key its mirror table on `(collection, uid)` and carry `href` + `etag` as sync metadata.

---

## 1. The RFC map — precisely what each one contributes

| RFC | Title | What it actually gives you |
|---|---|---|
| **RFC 4918** | HTTP Extensions for WebDAV | `PROPFIND`, `PROPPATCH`, `MKCOL`, `COPY`, `MOVE`, `LOCK`/`UNLOCK`; `Depth` header; `207 Multi-Status` body shape (`DAV:multistatus`/`response`/`href`/`propstat`/`prop`/`status`); `DAV:` compliance classes 1/2/3; the `If` header; `DAV:error` condition bodies; `412 Precondition Failed`. |
| **RFC 4791** | CalDAV | `calendar-access` DAV token; calendar collections; `MKCALENDAR`; the properties `CALDAV:calendar-home-set`, `calendar-description`, `calendar-timezone`, `supported-calendar-component-set`, `supported-calendar-data`, `max-resource-size`, `min-date-time`, `max-date-time`, `max-instances`, `max-attendees-per-instance`, `supported-collation-set`; the REPORTs `calendar-query`, `calendar-multiget`, `free-busy-query`; `CALDAV:calendar-data` with `comp`/`expand`/`limit-recurrence-set`; the filter grammar `comp-filter`/`prop-filter`/`param-filter`/`time-range`/`text-match`/`is-not-defined`; the calendar-object preconditions. |
| **RFC 5545** | iCalendar | The `VTODO` component itself, all properties/parameters/value types, line folding, TEXT escaping, `X-` property ABNF, `VTIMEZONE`, `RRULE`, `VALARM`. |
| **RFC 5546** | iTIP | The `METHOD` semantics (`PUBLISH`, `REQUEST`, `REPLY`, `ADD`, `CANCEL`, `REFRESH`, `COUNTER`, `DECLINECOUNTER`) — **all eight apply to VTODO** — and the `SEQUENCE`/`DTSTAMP` bump rules used for assignment workflows. |
| **RFC 6638** | CalDAV Scheduling (auto-schedule) | `calendar-auto-schedule` DAV token; `CALDAV:schedule-inbox-URL`, `schedule-outbox-URL`, `calendar-user-address-set`, `schedule-default-calendar-URL`; `Schedule-Tag` response header + `If-Schedule-Tag-Match` request header; `SCHEDULE-AGENT`, `SCHEDULE-STATUS`, `SCHEDULE-FORCE-SEND` parameters. Explicitly states scheduling of to-dos is fully supported. |
| **RFC 6578** | WebDAV Collection Synchronization | `DAV:sync-collection` REPORT, `DAV:sync-token` (property + request/response element), `DAV:sync-level`, `DAV:limit`/`DAV:nresults`, deletions reported as bare `404` responses, `507` + `DAV:number-of-matches-within-limits` for truncation, `DAV:valid-sync-token` precondition. |
| **RFC 5397** | WebDAV Current Principal Extension | `DAV:current-user-principal` — a single `DAV:href` or `DAV:unauthenticated`. This is step 2 of every discovery chain. |
| **RFC 6764** | Locating CalDAV/CardDAV Services | `_caldavs._tcp` / `_caldav._tcp` SRV, TXT `path=` key, `/.well-known/caldav` and `/.well-known/carddav` well-known URIs, the ordered bootstrap algorithm. |
| **RFC 7986** | New Properties for iCalendar | `NAME`, `DESCRIPTION`, `UID`, `LAST-MODIFIED`, `URL`, `CATEGORIES`, `REFRESH-INTERVAL`, `SOURCE` on `VCALENDAR`; `COLOR` (CSS3 colour name) and `IMAGE` on `VCALENDAR`/`VEVENT`/`VTODO`/`VJOURNAL`; `CONFERENCE` on `VEVENT`/`VTODO`. |
| **RFC 9073** | Event Publishing Extensions | `PARTICIPANT`, `VLOCATION`, `VRESOURCE` components; `STRUCTURED-DATA`, `STYLED-DESCRIPTION`, `CALENDAR-ADDRESS`, `LOCATION-TYPE`, `PARTICIPANT-TYPE`, `RESOURCE-TYPE` properties; `ORDER`, `SCHEMA`, `DERIVED` parameters. |
| **RFC 9074** | VALARM Extensions | `UID` on VALARM, `ACKNOWLEDGED`, `PROXIMITY` (`ARRIVE`/`DEPART`/`CONNECT`/`DISCONNECT`), `VLOCATION` inside VALARM, and the snooze pattern `RELATED-TO;RELTYPE=SNOOZE:<original-alarm-uid>`. |
| *(non-RFC)* | CalendarServer ctag extension | `getctag` in namespace `http://calendarserver.org/ns/`. Pre-dates RFC 6578, still the fallback everywhere. |
| *(draft)* | WebDAV-Push (bitfire) | Namespace `https://bitfire.at/webdav-push`, `DAV: webdav-push` token, POST-based `push-register`. Optional but very relevant for the Fem-ho Android app. |

### What Fem-ho should do (RFC scope)

Implement, in this order of priority:

- **Must (server):** RFC 4918 class 1, RFC 4791 (`calendar-access`), RFC 5545 VTODO, RFC 5397, RFC 6578, RFC 6764 `.well-known`, `getctag`.
- **Must (client):** RFC 6764 discovery, RFC 5397, RFC 4791 `calendar-query` + `calendar-multiget`, RFC 6578 with `getctag` fallback, `If-Match`/`If-None-Match`.
- **Should:** RFC 7986 `COLOR` + `NAME` (maps directly to the Plou gradient/accent per scope), RFC 9074 `ACKNOWLEDGED` (dismissing a reminder on one device must not re-fire on another).
- **Defer:** RFC 6638 auto-scheduling and RFC 5546 iTIP email. Fem-ho is a household app with a closed user set; assignment is an internal concept (`@person` quick-add). Emit `ORGANIZER`/`ATTENDEE` for interop **display**, but set `SCHEDULE-AGENT=NONE` so no server tries to email anyone. Do not implement an inbox/outbox in v1.
- **Skip:** RFC 9073. `PARTICIPANT`/`VRESOURCE` buy nothing for a family task app; no relevant client reads them.

---

## 2. HTTP surface — methods, headers, status codes

### 2.1 OPTIONS (server must answer this correctly or nothing else works)

RFC 4791 §5.1, verbatim example:

```http
OPTIONS /home/bernard/calendars/ HTTP/1.1
Host: cal.example.com
```

```http
HTTP/1.1 200 OK
Allow: OPTIONS, GET, HEAD, POST, PUT, DELETE, TRACE, COPY, MOVE
Allow: PROPFIND, PROPPATCH, LOCK, UNLOCK, REPORT, ACL
DAV: 1, 2, access-control, calendar-access
Date: Sat, 11 Nov 2006 09:32:12 GMT
Content-Length: 0
```

**Compliance-class semantics, verbatim from RFC 4918 §18:**

- §18.1 Class 1: *"A class 1 compliant resource MUST meet all 'MUST' requirements in all sections of this document. Class 1 compliant resources MUST return, at minimum, the value '1' in the DAV header on all responses to the OPTIONS method."*
- §18.2 Class 2: *"A class 2 compliant resource MUST meet all class 1 requirements and support the LOCK method, the DAV:supportedlock property, the DAV:lockdiscovery property, the Time-Out response header and the Lock-Token request header."*
- §18.3 Class 3: *"A resource can explicitly advertise its support for the revisions to [RFC2518] made in this document. Class 1 MUST be supported as well. Class 2 MAY be supported. Advertising class 3 support in addition to class 1 and 2 means that the server supports all the requirements in this specification. Advertising class 3 and class 1 support, but not class 2, means that the server supports all the requirements in this specification except possibly those that involve locking support."*

> **Correction to a widespread myth:** class 3 is **not** versioning. Versioning is RFC 3253 (DeltaV) and advertises `version-control` etc. Class 3 simply means "full RFC 4918, not the old RFC 2518".

**Fem-ho's OPTIONS response should be:**

```http
HTTP/1.1 200 OK
Allow: OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, PROPPATCH, REPORT, MKCALENDAR, MKCOL
DAV: 1, 3, calendar-access, addressbook
Content-Length: 0
```

Emit `1, 3` and **omit `2`** — do not implement LOCK/UNLOCK. Nothing in the CalDAV client world requires WebDAV locking; ETag conditional requests are the real concurrency primitive. (Some clients probe for `2`; none refuse to work without it. Radicale, Xandikos and Baikal all work fine advertising `1, 3` or `1, 2, 3` depending on build.) Do **not** advertise `calendar-auto-schedule` unless you implement RFC 6638 — python-caldav and others detect scheduling support purely from that token's presence.

Also answer OPTIONS on `/` and on `/.well-known/caldav` (after redirect) — some clients probe the root.

### 2.2 PROPFIND

- `Depth: 0` — the collection/resource itself.
- `Depth: 1` — itself plus direct members. This is how you enumerate calendars in a home set, and how a client can enumerate object ETags (though REPORT is better).
- `Depth: infinity` — allowed to be refused with `403 Forbidden` + `DAV:propfind-finite-depth`. **Fem-ho should refuse it.**
- **A missing `Depth` header means `infinity`** per RFC 4918 §9.1. Treat missing `Depth` as `infinity` and then refuse it (or, pragmatically, treat missing as `0` for the principal URL — but be explicit in code; several clients omit `Depth` on the first probe).

Request body forms: `<D:prop>` (named), `<D:allprop/>`, `<D:propname/>`. An empty body is `allprop`.

Response is always `207 Multi-Status`, `Content-Type: application/xml; charset="utf-8"`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>/dav/calendars/borja/personal-tasks/</D:href>
    <D:propstat>
      <D:prop>
        <D:displayname>Personal</D:displayname>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
    <D:propstat>
      <D:prop>
        <D:getcontentlength/>
      </D:prop>
      <D:status>HTTP/1.1 404 Not Found</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>
```

Rule that clients enforce (sabre's client guide): *"Verify HTTP 200 OK status in response `<d:propstat>` before processing properties."* So group requested-but-absent properties into a `404` propstat rather than omitting them.

### 2.3 REPORT

Three reports matter. All are `POST`-like in that they carry an XML body; all return `207`.

- `CALDAV:calendar-query` — `Depth: 1` against a collection.
- `CALDAV:calendar-multiget` — `Depth: 1`, carries explicit `DAV:href` list.
- `DAV:sync-collection` — `Depth: 0` (the `sync-level` element carries the depth semantics, not the header).

### 2.4 PUT

Create:

```http
PUT /dav/calendars/borja/personal-tasks/9f2c1a7e-....ics HTTP/1.1
Content-Type: text/calendar; charset=utf-8
If-None-Match: *

BEGIN:VCALENDAR
...
END:VCALENDAR
```

- `201 Created` on success; `412 Precondition Failed` if the resource already exists.
- Client picks the URL segment. RFC 4791 §5.3.2: *"The UID property value of the calendar components contained in a calendar object resource MUST be unique in the scope of the calendar collection in which they are stored."*

Update:

```http
PUT /dav/calendars/borja/personal-tasks/9f2c1a7e-....ics HTTP/1.1
Content-Type: text/calendar; charset=utf-8
If-Match: "2134-314"

BEGIN:VCALENDAR
...
END:VCALENDAR
```

- `204 No Content` (or `200`) on success; **`412 Precondition Failed`** when the ETag no longer matches.
- The server **SHOULD** return the new `ETag` header. If it does not (because it normalised the data), the client **must** issue a `GET` immediately to re-read state. Sabre's guide states this explicitly.
- Constraint from sabre's guide: *"You must not change the UID"* and *"Every object should hold only 1 event or task."*

### 2.5 DELETE

```http
DELETE /dav/calendars/borja/personal-tasks/9f2c1a7e-....ics HTTP/1.1
If-Match: "2134-314"
```

`204 No Content`. `412` if the ETag drifted. DELETE on a collection removes everything under it.

### 2.6 MKCALENDAR

RFC 4791 §5.3.1 example (verbatim shape):

```http
MKCALENDAR /home/lisa/calendars/events/ HTTP/1.1
Host: cal.example.com
Content-Type: application/xml; charset="utf-8"

<?xml version="1.0" encoding="utf-8" ?>
<C:mkcalendar xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:set>
    <D:prop>
      <D:displayname>Lisa's Events</D:displayname>
      <C:calendar-description xml:lang="en">Calendar restricted to events.</C:calendar-description>
      <C:supported-calendar-component-set>
        <C:comp name="VEVENT"/>
      </C:supported-calendar-component-set>
      <C:calendar-timezone><![CDATA[BEGIN:VCALENDAR
...VTIMEZONE...
END:VCALENDAR]]></C:calendar-timezone>
    </D:prop>
  </D:set>
</C:mkcalendar>
```

```http
HTTP/1.1 201 Created
Cache-Control: no-cache
```

Preconditions (RFC 4791 §5.3.1): resource MUST NOT already exist at the Request-URI; the URI must be a valid location for a calendar collection; `calendar-timezone` must be a valid iCalendar object with exactly one VTIMEZONE; the principal needs `DAV:bind` on the parent.

`MKCALENDAR` support is **RECOMMENDED, not REQUIRED** (§5.3.1 — *"because some calendar stores only support one calendar per user … and those are typically pre-created"*). RFC 5689 extended `MKCOL` is the alternative:

```xml
<D:mkcol xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:set><D:prop>
    <D:resourcetype><D:collection/><C:calendar/></D:resourcetype>
    <D:displayname>Feina — Migració ERP</D:displayname>
    <C:supported-calendar-component-set><C:comp name="VTODO"/></C:supported-calendar-component-set>
  </D:prop></D:set>
</D:mkcol>
```

### 2.7 Status codes Fem-ho's server must emit

| Code | When |
|---|---|
| `200 OK` | GET, OPTIONS, PUT-with-body-return |
| `201 Created` | PUT of a new object, MKCALENDAR/MKCOL |
| `204 No Content` | PUT update, DELETE |
| `207 Multi-Status` | PROPFIND, PROPPATCH, all REPORTs |
| `304 Not Modified` | conditional GET with `If-None-Match: "<etag>"` |
| `401` / `403` | auth failure / privilege failure (with `DAV:error` body) |
| `404 Not Found` | unknown resource; also used *inside* sync-collection multistatus for tombstones |
| `405 Method Not Allowed` | e.g. MKCALENDAR inside a calendar collection |
| `412 Precondition Failed` | `If-Match` mismatch, `If-None-Match: *` on existing resource |
| `415 Unsupported Media Type` | non-`text/calendar` PUT |
| `507 Insufficient Storage` | inside sync-collection multistatus when truncating |

### 2.8 Precondition error bodies

RFC 4918 `DAV:error` wrapper with a CalDAV condition element:

```xml
<?xml version="1.0" encoding="utf-8"?>
<D:error xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <C:supported-calendar-component/>
</D:error>
```

CalDAV preconditions Fem-ho must be able to emit on `PUT`:

- `CALDAV:supported-calendar-data` — body was not iCalendar.
- `CALDAV:valid-calendar-data` — body was not parseable iCalendar.
- `CALDAV:valid-calendar-object-resource` — more than one component type, or a `METHOD` property present.
- `CALDAV:supported-calendar-component` — component type not in `supported-calendar-component-set`. **This is the one you send when someone PUTs a VEVENT into a VTODO-only Fem-ho collection.**
- `CALDAV:no-uid-conflict` (with a `DAV:href` to the conflicting resource) — UID already used at a different href in the same collection.
- `CALDAV:max-resource-size`, `CALDAV:max-instances`, `CALDAV:max-attendees-per-instance`.

And RFC 6578: `DAV:valid-sync-token` inside a `403 Forbidden` when a client presents a token the server has forgotten.

### What Fem-ho should do (HTTP surface)

- Serve CalDAV under a dedicated prefix (`/dav/...`) behind the same Docker container as the REST API, sharing auth middleware but with its own token scope (`caldav:read`, `caldav:write`).
- Support **Basic auth over TLS only**, plus **app-specific tokens**. Do not accept the user's login password directly for CalDAV — issue per-device CalDAV tokens from the profile screen (this is exactly the Vikunja model: "account password / dedicated CalDAV token / API token with CalDAV permission"). DAVx5, Thunderbird and Apple all speak Basic.
- Reject `Depth: infinity` PROPFIND with `403` + `<D:propfind-finite-depth/>`.
- Always return a strong ETag on PUT unless you normalise the payload; if you normalise (you will — you re-serialise from the DB), return the new ETag anyway, computed over the exact bytes you would return on the next GET. A missing ETag forces every client into an extra GET round-trip.

---

## 3. Discovery chain, exactly

### 3.1 Bootstrap (RFC 6764)

Ordered client algorithm:

1. **SRV lookup.** `_caldavs._tcp.<domain>` first; fall back to `_caldav._tcp.<domain>`. Records look like:
   ```
   _caldav._tcp     SRV 0 1 80  calendar.example.com.
   _caldavs._tcp    SRV 0 1 443 calendar.example.com.
   ```
2. **TXT lookup** on the same name for a `path` key: `_caldavs._tcp TXT path=/caldav`. *"When present, clients MUST use the 'path' value as the 'context path' for the service in HTTP requests."*
3. If no TXT path, use `/.well-known/caldav`. If the path fails, retry with `/.well-known/caldav`.
4. The well-known URI redirects (RFC 6764 permits *"a 301, 303, or 307 response"*; in practice servers use `301` or `302`, and `308` works with modern clients).
5. `PROPFIND Depth: 0` on the context path requesting `DAV:current-user-principal`.

### 3.2 current-user-principal (RFC 5397)

```http
PROPFIND / HTTP/1.1
Depth: 0
Content-Type: application/xml; charset=utf-8

<d:propfind xmlns:d="DAV:">
  <d:prop><d:current-user-principal /></d:prop>
</d:propfind>
```

Schema: `<!ELEMENT current-user-principal (unauthenticated | href)>`. Value example from the RFC:

```xml
<D:current-user-principal xmlns:D="DAV:">
  <D:href>/principals/users/cdaboo</D:href>
</D:current-user-principal>
```

### 3.3 calendar-home-set (RFC 4791 §6.2.1)

```http
PROPFIND /principals/users/johndoe/ HTTP/1.1
Depth: 0
Content-Type: application/xml; charset=utf-8

<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><c:calendar-home-set /></d:prop>
</d:propfind>
```

```xml
<C:calendar-home-set xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:href>http://cal.example.com/home/user/calendars/</D:href>
</C:calendar-home-set>
```

### 3.4 Enumerate collections

```http
PROPFIND /calendars/johndoe/ HTTP/1.1
Depth: 1
Content-Type: application/xml; charset=utf-8

<d:propfind xmlns:d="DAV:"
            xmlns:cs="http://calendarserver.org/ns/"
            xmlns:c="urn:ietf:params:xml:ns:caldav"
            xmlns:ic="http://apple.com/ns/ical/">
  <d:prop>
     <d:resourcetype />
     <d:displayname />
     <d:sync-token />
     <cs:getctag />
     <c:supported-calendar-component-set />
     <c:calendar-description />
     <c:calendar-timezone />
     <ic:calendar-color />
     <ic:calendar-order />
     <d:current-user-privilege-set />
  </d:prop>
</d:propfind>
```

Response fragment a Fem-ho server should produce for a task collection:

```xml
<D:response>
  <D:href>/dav/calendars/borja/scope-personal/</D:href>
  <D:propstat>
    <D:prop>
      <D:resourcetype><D:collection/><C:calendar/></D:resourcetype>
      <D:displayname>Personal</D:displayname>
      <D:sync-token>https://femho.example/ns/sync/scope-personal/1487</D:sync-token>
      <CS:getctag>femho-scope-personal-1487</CS:getctag>
      <C:supported-calendar-component-set>
        <C:comp name="VTODO"/>
      </C:supported-calendar-component-set>
      <C:calendar-description>Àmbit Personal — totes les tasques</C:calendar-description>
      <IC:calendar-color>#7C5CFFFF</IC:calendar-color>
      <IC:calendar-order>1</IC:calendar-order>
      <D:current-user-privilege-set>
        <D:privilege><D:read/></D:privilege>
        <D:privilege><D:write/></D:privilege>
        <D:privilege><C:read-free-busy/></D:privilege>
      </D:current-user-privilege-set>
    </D:prop>
    <D:status>HTTP/1.1 200 OK</D:status>
  </D:propstat>
</D:response>
```

Notes on the non-RFC bits that everyone implements:

- `http://apple.com/ns/ical/` namespace: `calendar-color` (value `#RRGGBBAA`, 8 hex digits — Apple's form) and `calendar-order` (integer). Radicale lists `calendar_order` and `calendar_color` as its "extra features not specified in RFC4791". DAVx5, Thunderbird and Apple all read `calendar-color`.
- `CALDAV:supported-calendar-component-set` is a **protected** property — RFC 4791 says a client cannot PROPPATCH it; it can only be set at MKCALENDAR/MKCOL time. This is why DAVx5's collection-creation dialog asks up-front whether a collection holds events, tasks or journals.
- `supported-calendar-component-set` is **optional**. python-caldav's compatibility notes put it exactly: *"The property is optional: when absent the RFC mandates that all component types are accepted, so 'unsupported' here is not a protocol violation, but the client cannot determine the actual supported set without trying."* Fem-ho must always emit it.

### 3.5 Why VEVENT and VTODO must live in separate collections

- RFC 4791 §4.1: a single calendar **object resource** must contain only one component type (VTIMEZONE excepted) and must not carry `METHOD`. That is a per-`.ics` rule, not a per-collection rule.
- The per-collection rule is de facto: **DAVx5 decides what a collection *is* from `supported-calendar-component-set`** — VEVENT means "calendar, sync to the Android calendar provider"; VTODO means "tasks, sync to the tasks provider". A collection cannot be both in DAVx5's UI model.
- Apple clients always create separate collections for events and reminders. DAViCal's own Apple setup guide tells admins to set `supported-component-set` to VEVENT on existing collections and move todos to fresh VTODO collections.
- Zimbra flatly cannot mix (`save-load.todo.mixed-calendar: unsupported` in python-caldav's matrix).

**Fem-ho rule: every CalDAV collection is single-purpose.** A scope/project produces a VTODO collection; if Fem-ho later exposes date-anchored items as events, that is a *second, sibling* collection.

### What Fem-ho should do (discovery)

- Serve `/.well-known/caldav` → `302` (or `301`) → `/dav/`. Serve it at the **root of the host**, since clients hit `https://<host>/.well-known/caldav` before anything else. In Docker/Traefik/nginx this is a one-line rewrite; document it, because self-hosters will get it wrong and DAVx5 will then need the full home-set URL typed manually (exactly the failure Tasks.org documents: *"For servers that do not provide a redirect you will need to enter the home set URL yourself."*).
- Principal URL: `/dav/principals/<user-slug>/`. Home set: `/dav/calendars/<user-slug>/`.
- Publish `CALDAV:calendar-user-address-set` on the principal containing `mailto:<user email>` even without RFC 6638 — it makes `@person` assignment round-trip as `ATTENDEE` correctly and costs nothing.
- Emit `IC:calendar-color` from the scope's Plou accent so DAVx5/Apple/Thunderbird show the same colours as the Fem-ho UI.

---

## 4. ctag vs sync-token vs etag

Three different scopes. Get this wrong and you either miss changes or re-download everything constantly.

| Token | Scope | Namespace / source | Changes when | Used for |
|---|---|---|---|---|
| **`DAV:getetag`** | one calendar object resource | RFC 4918 / RFC 4791 §5.3.4 (must be a **strong** ETag) | that one `.ics` changes | optimistic concurrency on PUT/DELETE; per-item change detection |
| **`CS:getctag`** | one collection | `http://calendarserver.org/ns/` | *"MUST change each time the contents of the calendar … change, and each change MUST result in a value that is different from any other used with that collection URI"* | cheap "did anything change?" poll |
| **`DAV:sync-token`** | one collection, **with history** | RFC 6578 | same trigger as ctag, but the value is an opaque URI you can hand back to get a delta | incremental sync incl. tombstones |

`getctag` gives you a boolean ("something changed") — you then have to list all ETags to find out what. `sync-token` gives you the actual delta, including deletions. Servers should offer both; clients should prefer sync-token and fall back to ctag.

### 4.1 Algorithm A — ctag poll (universal fallback)

```
1. PROPFIND Depth:0  {DAV:displayname, CS:getctag, DAV:sync-token}
2. if ctag == stored_ctag: STOP.
3. REPORT calendar-query Depth:1 asking ONLY for {DAV:getetag}
      filter: VCALENDAR / VTODO
4. diff against local (href -> etag) map:
      href present, etag differs  -> MODIFIED
      href absent locally         -> ADDED
      local href not in response  -> DELETED
5. REPORT calendar-multiget Depth:1 with the ADDED+MODIFIED hrefs,
      asking {DAV:getetag, CALDAV:calendar-data}
6. apply; store new ctag.
```

The step-3 ETag-only calendar-query is the trick that makes this cheap: you transfer ~100 bytes per object instead of ~1 KB.

### 4.2 Algorithm B — sync-collection (RFC 6578)

Initial sync, empty token:

```http
REPORT /dav/calendars/borja/scope-personal/ HTTP/1.1
Depth: 0
Content-Type: application/xml; charset="utf-8"

<?xml version="1.0" encoding="utf-8" ?>
<D:sync-collection xmlns:D="DAV:">
  <D:sync-token/>
  <D:sync-level>1</D:sync-level>
  <D:prop>
    <D:getetag/>
  </D:prop>
</D:sync-collection>
```

*"When the DAV:sync-collection request contains an empty DAV:sync-token element, the server MUST return all member URLs of the collection"* — and MUST NOT report deletions.

Incremental:

```xml
<?xml version="1.0" encoding="utf-8" ?>
<D:sync-collection xmlns:D="DAV:">
  <D:sync-token>https://femho.example/ns/sync/scope-personal/1487</D:sync-token>
  <D:sync-level>1</D:sync-level>
  <D:prop>
    <D:getetag/>
  </D:prop>
</D:sync-collection>
```

Response with a change and a tombstone (verbatim RFC 6578 shape):

```xml
HTTP/1.1 207 Multi-Status
Content-Type: text/xml; charset="utf-8"

<?xml version="1.0" encoding="utf-8" ?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>/dav/calendars/borja/scope-personal/file.ics</D:href>
    <D:propstat>
      <D:prop><D:getetag>"00004-abcd1"</D:getetag></D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
  <D:response>
    <D:href>/dav/calendars/borja/scope-personal/test.ics</D:href>
    <D:status>HTTP/1.1 404 Not Found</D:status>
  </D:response>
  <D:sync-token>https://femho.example/ns/sync/scope-personal/1512</D:sync-token>
</D:multistatus>
```

**A deletion is a `D:response` with only an `href` and a `404` status — no `propstat`.** That is the tombstone wire format.

Truncation:

```xml
  <D:response>
    <D:href>/dav/calendars/borja/scope-personal/</D:href>
    <D:status>HTTP/1.1 507 Insufficient Storage</D:status>
    <D:error><D:number-of-matches-within-limits/></D:error>
  </D:response>
  <D:sync-token>https://femho.example/ns/sync/scope-personal/1233</D:sync-token>
```

The client requests a cap with:

```xml
  <D:limit><D:nresults>100</D:nresults></D:limit>
```

Forgotten token → `403 Forbidden` with `<D:error><D:valid-sync-token/></D:error>`; the client must restart with an empty token.

`sync-level` values: `"1"` (immediate members) and `"infinite"`. Calendar collections are flat, so `1` is all you need — but accept `infinite` and treat it identically for a flat collection.

`DAV:sync-token` is also exposed as a **protected property** on the collection (so a client can grab it from the same PROPFIND that reads `getctag`).

### 4.3 Server-side design for tokens

The clean implementation is a monotonic **change sequence per collection**:

```sql
CREATE TABLE dav_change (
  id           BIGSERIAL PRIMARY KEY,      -- global monotonic
  collection_id BIGINT NOT NULL,
  object_uid   TEXT   NOT NULL,
  href         TEXT   NOT NULL,
  op           SMALLINT NOT NULL,          -- 1 = upsert, 2 = delete
  seq          BIGINT NOT NULL,            -- per-collection counter
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON dav_change (collection_id, seq);
```

- `sync-token` = `https://<host>/ns/sync/<collection_id>/<max seq>`.
- `getctag` = the same `<max seq>` (or a hash of it). One counter serves both.
- A sync-collection request with token `seq=N` returns every `dav_change` row for the collection with `seq > N`, collapsed to the latest op per `object_uid`.
- **Prune** rows older than e.g. 30 days; when a client presents a token older than the oldest retained row, answer `403 DAV:valid-sync-token`. Radicale does exactly this with `max_sync_token_age`, default **2,592,000 seconds (30 days)**.

**Tombstone retention is the whole game.** If you delete the change rows too eagerly, clients silently miss deletions and resurrect tasks. 30 days is the industry default; make it configurable via env var in the Docker image.

> Known real-world bug class, worth a regression test: Nextcloud had `sync-token.delete` broken until [nextcloud/server#44130](https://github.com/nextcloud/server/pull/44130) — sync-collection after deletions misbehaved. Zimbra's sync-token is classified `fragile` by python-caldav. Some servers use second-precision time-based tokens, which python-caldav documents as *"time-based indicates second-precision tokens requiring sleep(1) between operations"* — **do not use a timestamp as your sync token**; use the sequence counter.

### What Fem-ho should do (change detection)

- Implement **both** `CS:getctag` and `DAV:sync-token`, both derived from one per-collection sequence counter.
- Advertise `DAV:sync-token` in PROPFIND so DAVx5 uses the efficient path.
- Retain tombstones 30 days (env `FEMHO_DAV_TOMBSTONE_DAYS=30`).
- For the **Fem-ho Android client mirroring an external server**, implement both algorithms with automatic fallback: try sync-collection; on `403 valid-sync-token` or on the absence of `DAV:sync-token` in PROPFIND, fall back to the ctag+ETag-diff loop.
- Never reuse a sync-token value; never make it a timestamp.

---

## 5. `calendar-query` and `calendar-multiget` in full

### 5.1 calendar-query — fetch all VTODOs with data

```http
REPORT /dav/calendars/borja/scope-personal/ HTTP/1.1
Depth: 1
Content-Type: application/xml; charset=utf-8

<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:getetag />
    <c:calendar-data />
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VTODO" />
    </c:comp-filter>
  </c:filter>
</c:calendar-query>
```

### 5.2 calendar-query — ETags only (the cheap change probe)

```xml
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:getetag /></d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VTODO" />
    </c:comp-filter>
  </c:filter>
</c:calendar-query>
```

### 5.3 calendar-query — only incomplete tasks (what task clients actually send)

```xml
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:getetag />
    <c:calendar-data />
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VTODO">
        <c:prop-filter name="COMPLETED">
          <c:is-not-defined/>
        </c:prop-filter>
        <c:prop-filter name="STATUS">
          <c:text-match negate-condition="yes">CANCELLED</c:text-match>
        </c:prop-filter>
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>
```

`text-match` attributes: `collation` (default `i;ascii-casemap`; `i;octet` also required by RFC 4791) and `negate-condition` (`yes`/`no`). Advertise both via `CALDAV:supported-collation-set`.

### 5.4 calendar-query — partial retrieval

```xml
<c:calendar-data>
  <c:comp name="VCALENDAR">
    <c:prop name="VERSION"/>
    <c:comp name="VTODO">
      <c:prop name="UID"/>
      <c:prop name="SUMMARY"/>
      <c:prop name="DUE"/>
      <c:prop name="STATUS"/>
    </c:comp>
  </c:comp>
</c:calendar-data>
```

Plus `<c:expand start="..." end="..."/>` and `<c:limit-recurrence-set start="..." end="..."/>` for recurrence handling.

### 5.5 calendar-multiget

```http
REPORT /dav/calendars/borja/scope-personal/ HTTP/1.1
Depth: 1
Content-Type: application/xml; charset=utf-8

<c:calendar-multiget xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:getetag />
    <c:calendar-data />
  </d:prop>
  <d:href>/dav/calendars/borja/scope-personal/132456762153245.ics</d:href>
  <d:href>/dav/calendars/borja/scope-personal/fancy-client-1234253678.ics</d:href>
</c:calendar-multiget>
```

### 5.6 `time-range` semantics for VTODO (RFC 4791 §9.9) — copy this table into your code

`start`/`end` are DATE-TIME **in UTC** ("Z" form). At least one must be present; missing means -infinity / +infinity.

A VTODO overlaps `[start, end)` iff:

| DTSTART | DURATION | DUE | COMPLETED | CREATED | Condition |
|---|---|---|---|---|---|
| Y | Y | N | * | * | `(start <= DTSTART+DURATION) AND ((end > DTSTART) OR (end >= DTSTART+DURATION))` |
| Y | N | Y | * | * | `((start < DUE) OR (start <= DTSTART)) AND ((end > DTSTART) OR (end >= DUE))` |
| Y | N | N | * | * | `(start <= DTSTART) AND (end > DTSTART)` |
| N | N | Y | * | * | `(start < DUE) AND (end >= DUE)` |
| N | N | N | Y | Y | `((start <= CREATED) OR (start <= COMPLETED)) AND ((end >= CREATED) OR (end >= COMPLETED))` |
| N | N | N | Y | N | `(start <= COMPLETED) AND (end >= COMPLETED)` |
| N | N | N | N | Y | `(end > CREATED)` |
| N | N | N | N | N | `TRUE` |

The last row is the one that matters for Fem-ho: **a VTODO with no dates at all matches every time-range query.** This is why an Inbox full of undated tasks shows up in every client's date-filtered view. It is correct per spec. Do not "optimise" it away.

RFC 4791 §7.4 also requires the server to **expand recurring components** to decide overlap. python-caldav notes many servers get this wrong; its own client does client-side expansion regardless.

### 5.7 Known server bugs to test against

From python-caldav's compatibility database:

- `search.comp-type.optional` — omitting the `VTODO`/`VEVENT` comp-filter should return everything; **Nextcloud is `ungraceful`** here (errors out), Zimbra `fragile`. **Fem-ho must handle an absent inner comp-filter gracefully and return everything.**
- `search.combined-is-logical-and` — multiple filters must AND. Nextcloud is flagged `False` on this.
- `search.recurrences.expanded.todo` — server-side expand of recurring todos: `unsupported` on Nextcloud, Radicale and Zimbra. **Fem-ho's client must expand client-side.**
- `search.text.case-sensitive` — Radicale flagged `unsupported`.
- `search.time-range.open.start.duration` — Nextcloud flagged `broken`.

---

## 6. VTODO, in full

### 6.1 The component grammar (RFC 5545)

```
vtodo      = "BEGIN" ":" "VTODO" CRLF
             todoprop *alarmc
             "END" ":" "VTODO" CRLF

todoprop   = *(
           ; REQUIRED, MUST NOT occur more than once
           dtstamp / uid /
           ; OPTIONAL, MUST NOT occur more than once
           class / completed / created / description /
           dtstart / due / duration / geo / last-mod / location /
           organizer / percent / priority / recurid / seq /
           status / summary / url /
           ; OPTIONAL, MAY occur more than once
           attach / attendee / categories / comment / contact /
           exdate / rstatus / related / resources / rdate /
           rrule / x-prop / iana-prop
           )
```

### 6.2 Property reference (task-manager relevant subset)

| Property | Value type | Card. | Notes for Fem-ho |
|---|---|---|---|
| `UID` | TEXT | **1** | Globally unique. RFC 7986 recommends *"hex-encoded random Universally Unique Identifier (UUID) values"* rather than host/domain forms. Use UUIDv4 or v7. |
| `DTSTAMP` | DATE-TIME (UTC) | **1** | "when this iCalendar representation was created". In a CalDAV store (no METHOD) it is equivalent to LAST-MODIFIED. Always emit; always `Z`. |
| `CREATED` | DATE-TIME (**UTC only**) | 0..1 | Row creation time. |
| `LAST-MODIFIED` | DATE-TIME (**UTC only**) | 0..1 | Server-side mtime. Drives naive last-write-wins in clients that ignore ETags. |
| `SEQUENCE` | INTEGER | 0..1 | Defaults to 0 when absent (RFC 5546). Only meaningful with iTIP. python-caldav notes it *"assumes SEQUENCE defaults to 0 when absent, inserting SEQUENCE:1 on saves."* ical4android **omits SEQUENCE entirely when it is 0**. |
| `SUMMARY` | TEXT | 0..1 | Task title. |
| `DESCRIPTION` | TEXT | 0..1 | Notes. Escape `\n`, `\,`, `\;`, `\\`. |
| `DTSTART` | DATE or DATE-TIME | 0..1 | Start / "do date". |
| `DUE` | DATE or DATE-TIME | 0..1 | Due date. |
| `DURATION` | DURATION | 0..1 | **MUST NOT appear together with DUE.** RFC 5545: *"'due' and 'duration' MUST NOT occur in the same 'VTODO'."* Also requires DTSTART to be meaningful. |
| `COMPLETED` | DATE-TIME | 0..1 | **MUST be UTC.** |
| `STATUS` | TEXT | 0..1 | `NEEDS-ACTION` (default) / `IN-PROCESS` / `COMPLETED` / `CANCELLED`. |
| `PERCENT-COMPLETE` | INTEGER 0-100 | 0..1 | |
| `PRIORITY` | INTEGER 0-9 | 0..1 | RFC 5545 §3.8.1.9: `0` = undefined, `1-4` = HIGH, `5` = NORMAL, `6-9` = LOW. `1` is the highest. |
| `CATEGORIES` | TEXT list | 0..n | Comma-separated within one property; may repeat. This is where tags/labels go (Vikunja maps CATEGORIES → Labels; Nextcloud Tasks maps it to `_tags`; DAVx5 maps CardDAV groups to CATEGORIES). |
| `RELATED-TO` | TEXT (a UID) | 0..n | With `RELTYPE` param. **The subtask mechanism.** |
| `ORGANIZER` | CAL-ADDRESS | 0..1 | `mailto:` URI. Creator/owner. |
| `ATTENDEE` | CAL-ADDRESS | 0..n | With `PARTSTAT`, `CN`, `ROLE`, `CUTYPE`, `RSVP`, `DELEGATED-TO/FROM`. **Assignee.** |
| `RRULE` | RECUR | 0..1 | Recurring tasks. (RFC 5545 formally allows only one; ical4android stores one and warns on multiples; Nextcloud Tasks tracks `_hasMultipleRRules`.) |
| `RDATE` / `EXDATE` | DATE/DATE-TIME | 0..n | |
| `RECURRENCE-ID` | DATE/DATE-TIME | 0..1 | Overridden instance. Master + overrides must live in **the same** `.ics` (RFC 4791 §4.1). |
| `CLASS` | TEXT | 0..1 | `PUBLIC` / `PRIVATE` / `CONFIDENTIAL`. |
| `LOCATION` | TEXT | 0..1 | |
| `GEO` | FLOAT;FLOAT | 0..1 | |
| `URL` | URI | 0..1 | |
| `COMMENT` | TEXT | 0..n | |
| `CONTACT` | TEXT | 0..n | |
| `RESOURCES` | TEXT list | 0..n | |
| `ATTACH` | URI or BINARY | 0..n | |
| `COLOR` | TEXT (CSS3 name) | 0..1 | RFC 7986. ical4android parses it via a `Css3Color` enum → ARGB. |
| `IMAGE` | URI/BINARY | 0..n | RFC 7986, `DISPLAY=BADGE\|GRAPHIC\|FULLSIZE\|THUMBNAIL`. |
| `CONFERENCE` | URI | 0..n | RFC 7986, `FEATURE=AUDIO\|CHAT\|FEED\|MODERATOR\|PHONE\|SCREEN\|VIDEO`, `LABEL=`. |
| `X-*` | any | 0..n | ABNF: `x-name = "X-" [vendorid "-"] 1*(ALPHA / DIGIT / "-")`. |

`PARTSTAT` values valid on a VTODO `ATTENDEE`: `NEEDS-ACTION` (default), `ACCEPTED`, `DECLINED`, `TENTATIVE`, `DELEGATED`, `COMPLETED`, `IN-PROCESS`. Note the last two are **VTODO-only** — VEVENT does not have them.

### 6.3 A complete, realistic Fem-ho VTODO on the wire

```
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Fem-ho//Fem-ho Server 1.0//CA
BEGIN:VTODO
UID:018f6a71-3c2e-7a4e-9f10-2b7c4e5a9d31
DTSTAMP:20260805T101500Z
CREATED:20260801T083000Z
LAST-MODIFIED:20260805T101500Z
SUMMARY:Renovar el DNI de la Marta
DESCRIPTION:Cita prèvia a la comissaria de Figueres.\nPortar foto i llibre 
 de família.
DTSTART;TZID=Europe/Madrid:20260810T090000
DUE;TZID=Europe/Madrid:20260815T180000
STATUS:IN-PROCESS
PERCENT-COMPLETE:40
PRIORITY:2
CATEGORIES:tramits,familia
ORGANIZER;CN=Borja:mailto:borja@example.net
ATTENDEE;CN=Marta;ROLE=REQ-PARTICIPANT;CUTYPE=INDIVIDUAL;PARTSTAT=IN-PROCESS
 ;SCHEDULE-AGENT=NONE:mailto:marta@example.net
RELATED-TO;RELTYPE=PARENT:018f6a71-0000-7a4e-9f10-2b7c4e5a9d00
COLOR:mediumpurple
X-APPLE-SORT-ORDER:512
X-FEMHO-SCOPE:familia
X-FEMHO-PROJECT:tramits-2026
X-FEMHO-COLUMN:DOING
X-FEMHO-AI-MODE:ASSISTED
X-FEMHO-ASSIGNEE:marta
BEGIN:VALARM
UID:018f6a71-aaaa-7a4e-9f10-2b7c4e5a9d99
ACTION:DISPLAY
TRIGGER;RELATED=END:-PT24H
DESCRIPTION:Renovar el DNI de la Marta
END:VALARM
END:VTODO
END:VCALENDAR
```

Note the line fold in `DESCRIPTION` and `ATTENDEE`: RFC 5545 says lines **SHOULD NOT** exceed 75 octets; continuation lines start with a single space or HTAB, which is stripped on unfolding. Fold on **octet** boundaries, never mid-UTF-8-sequence.

### 6.4 STATUS ↔ COMPLETED ↔ PERCENT-COMPLETE consistency

There is no RFC-level constraint tying them, but every real client assumes:

- `STATUS:COMPLETED` ⟺ `COMPLETED` present ⟺ `PERCENT-COMPLETE:100`.
- `STATUS:NEEDS-ACTION` ⟺ no `COMPLETED` ⟺ `PERCENT-COMPLETE` 0 or absent.
- `STATUS:IN-PROCESS` ⟺ no `COMPLETED` ⟺ `PERCENT-COMPLETE` 1..99.

python-caldav records a real server bug class: `'vtodo-cannot-be-uncompleted'` — *"If a VTODO object has been set with STATUS:COMPLETE, it's not possible to delete the COMPLETED attribute and change back to STATUS:IN-ACTION."* Fem-ho's server must allow un-completing: when `STATUS` moves away from `COMPLETED`, actively drop `COMPLETED` and reset `PERCENT-COMPLETE`.

### 6.5 DATE vs DATE-TIME, TZID, VTIMEZONE

- **All-day** = `VALUE=DATE`, e.g. `DUE;VALUE=DATE:20260815`. No time, no timezone, no `Z`.
- **Local time with zone** = `DUE;TZID=Europe/Madrid:20260815T180000`, and the VCALENDAR **must** carry a matching `VTIMEZONE` component: *"An individual 'VTIMEZONE' calendar component MUST be specified for each unique 'TZID' parameter value specified in the iCalendar object."*
- **UTC** = `20260815T160000Z`. `COMPLETED`, `CREATED`, `LAST-MODIFIED`, `DTSTAMP`, `ACKNOWLEDGED` are **UTC-only** by spec.
- **Floating** = no TZID, no Z. Resolved against `CALDAV:calendar-timezone` on the collection. Avoid emitting floating times; some servers reject them.

**Real-world timezone traps** (from ical4android's `ICalPreprocessor`, which exists purely to survive them):

- Outlook emits Windows TZIDs like `"W. Europe Standard Time"` instead of IANA `Europe/Vienna`. ical4android runs `DatePropertyRule` / `DateListPropertyRule` to rewrite them and **replaces the incoming VTIMEZONE with ical4j's own VTIMEZONE of the same TZID**.
- Invalid `TZOFFSETFROM/TO` values like `+5730` (a `FixInvalidUtcOffsetPreprocessor` exists for this).
- Invalid durations like `DURATION:PT2D` (should be `P2D`) — `FixInvalidDayOffsetPreprocessor`.
- `CREATED` not in UTC — `CreatedPropertyRule` forces it.

**ical4android's VTODO sanity checks** (verbatim behaviour, from `Task.kt`) — replicate these on ingest:

```
if (DTSTART is DATE && DUE is DATE-TIME)  -> rewrite DTSTART to DATE-TIME in DUE's timezone
if (DTSTART is DATE-TIME && DUE is DATE)  -> rewrite DUE to DATE-TIME in DTSTART's timezone
if (DUE <= DTSTART)                       -> drop DTSTART  ("Found invalid DUE <= DTSTART; dropping DTSTART")
if (DURATION present && DTSTART absent)   -> drop DURATION ("Found DURATION without DTSTART; ignoring")
if (no UID)                               -> generate one  ("Received VTODO without UID, generating new one")
```

### What Fem-ho should do (VTODO emission)

- Emit `VERSION:2.0` + a stable `PRODID:-//Fem-ho//Fem-ho <ver>//CA`.
- Always emit `UID`, `DTSTAMP`, `CREATED`, `LAST-MODIFIED`, `SUMMARY`, `STATUS`.
- Only emit `SEQUENCE` when non-zero (matches ical4android and reduces spurious diffs).
- Store times as UTC instants + an IANA zone id in the DB; serialise all-day fields as `VALUE=DATE`, timed fields as `TZID=<IANA>` with a generated VTIMEZONE.
- Ship a VTIMEZONE generator (or embed a tzdb-derived table) — do **not** just emit `TZID=` without the component; Apple and Thunderbird will misplace the task.
- Run the ical4android sanity checks on every inbound PUT and on every mirrored object.

---

## 7. Subtasks: `RELATED-TO` exactly

RFC 5545 §3.8.4.5: *"This property is used to represent a relationship or reference between one calendar component and another."* The **value is the UID** of the other component. RFC 5545 §3.2.15 defines `RELTYPE` with values `PARENT`, `CHILD`, `SIBLING`, and **`PARENT` is the default when the parameter is absent**.

The convention every real task app follows:

```
# On the CHILD task:
RELATED-TO;RELTYPE=PARENT:<uid-of-parent>
# equivalently (default RELTYPE):
RELATED-TO:<uid-of-parent>
```

Confirmed in DAVx5's `ical4android/DmfsTask.kt`:

```kotlin
// reading: RELTYPE absent == PARENT
val relatedType = relatedTo.getParameter<RelType>(Parameter.RELTYPE)
relatedType == RelType.PARENT || relatedType == null /* RelType.PARENT is the default value */

// writing: map provider relation type to RELTYPE
val relType = when (relatedTo.getParameter(Parameter.RELTYPE) as RelType?) {
    RelType.CHILD   -> Relation.RELTYPE_CHILD
    RelType.SIBLING -> Relation.RELTYPE_SIBLING
    else            -> Relation.RELTYPE_PARENT   // default
}
```

and `Relation.RELATED_UID` holds the **UID**, not a URL or a row id.

### 7.1 Hard rules

1. **Point upward from the child.** Writing `RELTYPE=CHILD` on the parent is legal but poorly supported; Nextcloud Tasks reads `RELATED-TO` on a task as "my parent". Fem-ho should **write PARENT-on-child** and **read both** (treat `RELTYPE=CHILD:X` on task T as "X's parent is T").
2. **Parent and child are separate calendar object resources** (separate `.ics` files, separate UIDs, separate ETags). They are *not* bundled. A subtask move therefore touches two objects.
3. **Cross-collection relations do not survive.** ical4android logs *"Task relation doesn't refer to same task list; can't be synchronized"* and drops it. So: **a parent and its subtasks must live in the same CalDAV collection.** This is a hard constraint on Fem-ho's collection design (see §13).
4. **Deleting a parent does not cascade** at the protocol level. Orphaned children keep a dangling `RELATED-TO`. Fem-ho must decide (recommend: promote orphans to top level, keep the property until the next write).
5. **Cycles are possible on the wire.** Guard against A→B→A when ingesting.

### 7.2 Client support reality

| Client | Reads RELATED-TO subtasks | Writes them | Notes |
|---|---|---|---|
| **Nextcloud Tasks** (web) | Yes | Yes | The de facto reference implementation. `_related` field; also writes `X-OC-HIDESUBTASKS` / `X-OC-HIDECOMPLETEDSUBTASKS`. |
| **Tasks.org** (Android) | Yes | Yes | Full subtask UI; drag-to-indent. |
| **jtx Board** (Android) | Yes | Yes | Built alongside DAVx5; also does VJOURNAL. |
| **OpenTasks** (Android) | Provider supports it; UI does not | via other apps | DAVx5 docs: *"doesn't seem to be developed anymore"*. Deprioritise. |
| **Apple Reminders / iCloud** | Preserves | Limited | X-APPLE-* and RELATED-TO are round-tripped; editing subtask structure over CalDAV is not supported by the modern app. Reminders on iOS 13+/macOS 10.15+ moved to a proprietary format for iCloud accounts, but **iCloud's CalDAV endpoint still serves VTODOs to third-party clients**. |
| **Thunderbird** | **No** | **No** | Does not use the `RELATED-TO` field at all; no subtask UI. Mozilla bug 194863 is still open. Thunderbird will show your subtasks as a **flat list**. |
| **Evolution** | Flattens hierarchy | No | Same practical outcome as Thunderbird. |
| **Vikunja** | Yes | Yes | Maps `RELATED-TO` ⇄ parent/child task relations. |
| **KOrganizer** | Yes | Yes | UNVERIFIED in detail; listed as working by Vikunja. |

Server-side hazard: python-caldav tracks `save-load.icalendar.related-to` — *"the server preserves RELATED-TO properties … When 'unsupported', the server may typically silently strip all RELATED-TO lines."* **Zimbra is flagged `unsupported`.** If Fem-ho mirrors an external Zimbra collection, subtask structure will be lost on the remote side; detect and warn.

### What Fem-ho should do (subtasks)

- Model: `task.parent_id` in the DB; serialise as `RELATED-TO;RELTYPE=PARENT:<parent uid>` on the child.
- Constrain the schema so parent and child always share a scope+project → same CalDAV collection. If a user moves a subtask to another project in the Fem-ho UI, either move the whole subtree or detach it. Show this in the UI; do not silently break the relation.
- On ingest, accept `RELTYPE` absent (= PARENT), `PARENT`, and `CHILD` (inverted). Ignore `SIBLING` for hierarchy, but **preserve it** in the round-trip blob.
- Depth: allow at least 2 levels (task → subtask) to match the product spec; store arbitrary depth but render 2.
- Test matrix must include Thunderbird flattening — verify Fem-ho does not lose the relation when Thunderbird PUTs back an edited task. **Thunderbird preserves unknown properties on write, but you must verify it preserves `RELATED-TO`** — flagged **UNVERIFIED**; test it explicitly.

---

## 8. X- properties in the wild

| Property | Origin | Value | Who reads/writes it |
|---|---|---|---|
| `X-APPLE-SORT-ORDER` | Apple Reminders | integer | **Apple Reminders, Nextcloud Tasks (`_sortOrder`, derived from creation date when absent), Tasks.org ("My order" manual sort), elementary Tasks.** This is the de facto manual-ordering field. There is no RFC equivalent. |
| `X-OC-HIDESUBTASKS` | ownCloud/Nextcloud | `0`/`1` | Nextcloud Tasks (`_hideSubtaks`) |
| `X-OC-HIDECOMPLETEDSUBTASKS` | Nextcloud | `0`/`1` | Nextcloud Tasks (`_hideCompletedSubtaks`) |
| `X-PINNED` | Nextcloud Tasks | `true`/`false` | Nextcloud Tasks (`_pinned`) |
| `X-MOZ-LASTACK` | Mozilla | UTC DATE-TIME | Thunderbird/Lightning alarm acknowledgement (pre-RFC-9074 equivalent of `ACKNOWLEDGED`) |
| `X-MOZ-SNOOZE-TIME` | Mozilla | UTC DATE-TIME | Thunderbird snooze (pre-RFC-9074 equivalent of `RELTYPE=SNOOZE`) |
| `X-MOZ-GENERATION` | Mozilla | integer | Thunderbird internal revision counter |
| `X-APPLE-STRUCTURED-LOCATION` | Apple | URI + params | geo-fenced reminders (superseded by RFC 9074 `PROXIMITY` + `VLOCATION`) |
| `X-APPLE-CALENDAR-COLOR` | Apple | `#RRGGBBAA` | VCALENDAR-level colour (property form of the `IC:calendar-color` WebDAV property) |

**Golden rule, from sabre's client guide:** *"Always retain the iCalendar the server sent"* including non-standard properties. ical4android implements exactly this — everything it does not recognise goes into `unknownProperties` and is written back verbatim:

```kotlin
is Uid, is ProdId, is DtStamp -> { /* don't save these as unknown properties */ }
else -> t.unknownProperties += prop
```

### What Fem-ho should do (X- properties)

1. **Preserve, always.** Store the full original `.ics` bytes (or at least the unrecognised property list) per task in a `raw_ical_extra` column. On every write, re-emit them. Failing to do this makes Fem-ho a data-destroying middlebox for anyone who also uses Apple Reminders or Nextcloud Tasks.
2. **Interoperate on the ones that map:**
   - `X-APPLE-SORT-ORDER` ⇄ Fem-ho's manual order within a kanban column. Read it on ingest; write it on egress. This gives you free ordering compatibility with Apple Reminders, Nextcloud Tasks and Tasks.org.
   - `X-OC-HIDESUBTASKS` ⇄ the "collapsed" state of a task card. Harmless, read/write it.
   - `X-PINNED` ⇄ Fem-ho's pinnable checklists/tasks. Direct match — use it.
   - `X-MOZ-LASTACK` — treat as an alias for RFC 9074 `ACKNOWLEDGED` on ingest.
3. **Define the Fem-ho vendor namespace** as `X-FEMHO-*` (RFC 5545 `x-name = "X-" [vendorid "-"] 1*(ALPHA / DIGIT / "-")` — `FEMHO` is the vendorid). See §12 for the full list.

---

## 9. Client quirks that MUST be handled

### 9.1 DAVx5 (+ Tasks.org / jtx Board / OpenTasks)

- Version at time of writing: **DAVx5 4.5.19-ose** (2026-08-03).
- **Classifies collections by `supported-calendar-component-set`.** VEVENT → calendar provider; VTODO → tasks provider. A collection with neither is invisible.
- Requires either `.well-known/caldav` or a manually typed home-set URL.
- Sanitises inbound iCalendar aggressively (see §6.5). It **will silently rewrite** DTSTART/DUE type mismatches and drop DTSTART when `DUE <= DTSTART`. If Fem-ho emits such data, it will come back changed.
- Round-trips unknown properties (good).
- Maps `COLOR` (RFC 7986) through a CSS3 colour-name enum; when writing it emits `Css3Color.nearestMatch(argb).name` — i.e. **it snaps arbitrary ARGB to the nearest CSS3 named colour**. Do not expect exact hex round-trip through `COLOR`.
- Omits `SEQUENCE` when 0.
- Supports **WebDAV-Push** since 4.4.10 (needs UnifiedPush or FCM on device).
- Known ops issue documented by bitfire: reverse proxies without request buffering cause 0-byte uploads. **Document nginx `proxy_request_buffering on;` in the Fem-ho Docker docs.**
- Supports at most **one** tasks app at a time (user picks OpenTasks / Tasks.org / jtx Board in settings).

### 9.2 Apple Reminders / Calendar / iCloud

- iOS 13 / macOS 10.15 moved the *Reminders app's own iCloud account* to a proprietary format; **third-party CalDAV clients still get VTODOs from iCloud's CalDAV endpoint**, and Reminders still speaks CalDAV to *non-iCloud* accounts.
- **Always creates separate collections** for events and reminders.
- Uses `X-APPLE-SORT-ORDER` for manual order and `#RRGGBBAA` (8 hex digits, alpha last) for `calendar-color`.
- Preserves `RRULE`, `VALARM`, `RELATED-TO` and `X-APPLE-*` on update, but **does not let you edit** recurrence or subtask structure over CalDAV.
- macOS Calendar **silently refuses** plain HTTP — HTTPS is mandatory (Radicale documents this).
- Documented flakiness: PROPFIND hanging on dual-stack (IPv4+IPv6) hosts. **UNVERIFIED** as to root cause; mitigate by making sure the Docker deployment answers on both stacks identically.

### 9.3 Thunderbird

- **No `RELATED-TO` support at all** — no subtask reading, no subtask writing, no subtask UI. Mozilla bug 194863 open since 2003; Thunderbird has publicly said subtasks are wanted but not scheduled.
- Vikunja's docs list **Thunderbird 68 as "not working"** with their CalDAV implementation. Newer Thunderbird (115/128/140 ESR line) works with most servers; the 68-era failure was Vikunja-specific. Treat "Thunderbird works" as **UNVERIFIED** until tested against Fem-ho specifically.
- Uses `X-MOZ-LASTACK`, `X-MOZ-SNOOZE-TIME`, `X-MOZ-GENERATION`.
- Historically strict about `VTIMEZONE` presence.

### 9.4 Evolution

- Reads VTODOs fine; **flattens subtask hierarchy** (no `RELATED-TO` UI).
- Listed by Vikunja as a **working** client.
- Supports `MKCALENDAR` for creating collections.

### 9.5 Nextcloud Tasks (web) + Nextcloud CalDAV server

- Server DAV base path: **`/remote.php/dav`**; principals at `/remote.php/dav/principals/users/<user>/`; calendars at `/remote.php/dav/calendars/<user>/<calendar>/`. Built on sabre/dav.
- Property set it reads/writes on a VTODO (from `src/models/task.js`): `UID`, `SUMMARY`, `PRIORITY`, `PERCENT-COMPLETE`, `COMPLETED`, `STATUS`, `DESCRIPTION`, `DTSTART`, `DUE`, `LAST-MODIFIED`, `CREATED`, `CLASS`, `LOCATION`, `URL`, `RELATED-TO`, `RRULE`, `RECURRENCE-ID` (read-only), `CATEGORIES`, `DTSTAMP`, plus `X-OC-HIDESUBTASKS`, `X-OC-HIDECOMPLETEDSUBTASKS`, `X-PINNED`, `X-APPLE-SORT-ORDER`.
- Server-side quirks (python-caldav's database):
  - `search.comp-type.optional`: **ungraceful** — a calendar-query without an inner comp-filter errors.
  - `search.recurrences.expanded.todo`: **unsupported**.
  - `search.combined-is-logical-and`: **False**.
  - `search.time-range.open.start.duration`: **broken**.
  - `delete-calendar.free-namespace`: **fragile** — *"deleting a calendar moves it to a trashbin; the trashbin has to be manually 'emptied' from the web-ui before the namespace is freed up"*.
  - `save-load.reuse-deleted-uid`: **broken** on Nextcloud — soft-delete trashbin causes unique-constraint violations when a UID is reused (nextcloud/server#30096). **Do not reuse UIDs after delete when mirroring into Nextcloud.**
  - Rate limits by default, including on calendar creation.
  - `sync-token.delete` was broken until nextcloud/server#44130.

### 9.6 Other servers worth knowing (python-caldav compatibility DB)

| Server | Notable |
|---|---|
| **Radicale** | `search.text.case-sensitive` unsupported; `search.recurrences.expanded.todo` unsupported; `principal-search` unsupported; **no RFC 6638 scheduling**; supports the `calendar_order`/`calendar_color` extras. |
| **Xandikos** | `principal-search` returns 403; **no scheduling**; VTODO RRULE expansion fixed in 0.3.7 (PR #627). |
| **Baikal / Davis (sabre/dav)** | HTTP/2 multiplexing problems behind nginx (python-caldav#564) — default is *not* to multiplex. Some builds claim not to support DAV at all on OPTIONS. |
| **Zimbra** | Cannot mix events and tasks in one calendar; **strips `RELATED-TO`**; `sync-token` fragile; `search.text` unsupported; treats same-UID objects across calendars as aliases and **moves instead of copying**; `create-calendar.set-displayname` unsupported; VJOURNAL ungraceful. |
| **Google** | Rejects VTODO entirely (vdirsyncer: *"Google rejects VTODO files in calendar sync"*); legacy CalDAV treats objects as effectively immutable (`save-load.mutable` unsupported). |
| **DAViCal** | HTTP/2 multiplexing disabled; delivers iTIP to inbox and auto-schedules. |
| **Fastmail** | Buggy no-expand date search returns unrelated recurrences. |
| **Stalwart** | Splits master + RECURRENCE-ID exceptions into separate resources (RFC violation); does not return VTODOs without DTSTART in date searches. |
| **Robur** | Raises an authorization error instead of 404 for non-existent resources; expands yearly RRULE as monthly. |

### What Fem-ho should do (client quirks)

- **Server side:** be maximally forgiving on input (accept comp-filter-less queries, accept missing `Depth`, accept both `RELTYPE=PARENT` and bare `RELATED-TO`) and maximally conservative on output (always VTIMEZONE, always UID/DTSTAMP, never `METHOD`, one component per resource, strong ETags, `SEQUENCE` only when non-zero).
- **Client side (mirroring):** feature-detect per remote server and store a per-account quirk profile — `has_sync_token`, `has_ctag`, `expand_todo_serverside`, `preserves_related_to`, `reuses_deleted_uid`, `needs_comp_filter`, `rate_limit`. Copy python-caldav's taxonomy (`full` / `unsupported` / `fragile` / `quirk` / `broken` / `ungraceful` / `unknown`) — it is the right vocabulary.
- **Never reuse a UID after deletion** when writing to a remote server.
- **Document the reverse-proxy requirements** (request buffering, HTTPS-only, `.well-known` rewrite) in the Fem-ho Docker README. These cause more support tickets than protocol bugs.

---

## 10. Bidirectional sync

### 10.1 Conflict detection via ETag — the 412 flow

```
client                                          server
  |  PUT /…/x.ics   If-Match: "v7"                |
  |---------------------------------------------->|
  |                                               |  stored etag == "v9"  ->  mismatch
  |  412 Precondition Failed                      |
  |<----------------------------------------------|
  |  GET /…/x.ics                                 |
  |---------------------------------------------->|
  |  200 OK  ETag: "v9"  + body                   |
  |<----------------------------------------------|
  |  [merge / resolve]                            |
  |  PUT /…/x.ics   If-Match: "v9"                |
  |---------------------------------------------->|
  |  204 No Content  ETag: "v10"                  |
  |<----------------------------------------------|
```

Analogously, creation uses `If-None-Match: *` and a `412` means "someone already created this href".

**Never PUT without a conditional header.** An unconditional PUT is a silent overwrite and is how mirrors lose data.

### 10.2 The two-way sync state machine (vdirsyncer's algorithm, generalised)

Keep a **status table** per (local collection ↔ remote collection) pair. Minimum columns:

```sql
CREATE TABLE dav_mirror_item (
  account_id     BIGINT NOT NULL,
  collection_id  BIGINT NOT NULL,
  uid            TEXT   NOT NULL,        -- the join key; NOT the href
  local_task_id  BIGINT,                 -- Fem-ho task
  remote_href    TEXT,                   -- may change; not identity
  remote_etag    TEXT,                   -- etag at last successful sync
  local_hash     TEXT,                   -- content hash of local canonical form at last sync
  remote_hash    TEXT,                   -- content hash of remote payload at last sync
  deleted_at     TIMESTAMPTZ,            -- tombstone
  PRIMARY KEY (account_id, collection_id, uid)
);
```

vdirsyncer's status is exactly `(item id, etag_a, etag_b)`. The decision matrix, verbatim in structure:

| In A | In B | In status | ETag A changed | ETag B changed | Action |
|---|---|---|---|---|---|
| yes | no | no | – | – | created on A → copy to B |
| no | yes | no | – | – | created on B → copy to A |
| yes | no | yes | – | – | deleted on B → delete from A |
| no | yes | yes | – | – | deleted on A → delete from B |
| yes | yes | no | – | – | **conflict** (both created independently) |
| yes | yes | yes | yes | no | copy A → B |
| yes | yes | yes | no | yes | copy B → A |
| yes | yes | yes | yes | yes | **conflict** |
| no | no | yes | – | – | deleted on both → drop status row |

**Loop prevention** is structural: after every action you write the *resulting* etags/hashes back into the status row. The next pass compares against those, so an echo of your own write is a no-op. Explicitly:

- After you PUT to the remote, take the ETag from the PUT response (or a follow-up GET) and store it as `remote_etag` **before** the next sync pass runs.
- After you write to the local DB, recompute `local_hash` and store it.
- If either write fails, do **not** update the status row — the next pass re-detects and retries.

Secondary loop guard, needed because your own server bumps `LAST-MODIFIED`/`DTSTAMP`/ETag on every write even when nothing semantically changed: **compare canonical content hashes, not raw bytes.** Canonicalisation for the hash must strip `DTSTAMP`, `LAST-MODIFIED`, `SEQUENCE`, `PRODID`, and normalise property order and line folding. Otherwise every mirror pass sees a "change" and ping-pongs forever.

vdirsyncer's own note on this failure mode: for HTTP/webcal sources that regenerate UIDs, it *"completely ignores UIDs coming from http and will replace them with a hash of the normalized item content"* — i.e. when identity is unstable, derive it from normalised content.

### 10.3 Conflict resolution policy

vdirsyncer offers exactly three and refuses to merge: *"Vdirsyncer never attempts to 'automatically merge' the two items."* Options are error-out (default), `a wins`, `b wins`, or an external `command`.

For Fem-ho, plain last-write-wins on the whole object is too lossy for a shared family board (two people editing different fields of the same task is the common case). Recommended: **field-level merge with a per-field LWW clock.**

```
For each field f in {summary, description, due, dtstart, status, percent,
                    priority, categories, parent, column, assignee, ai_mode}:
    if local.f_changed_since_sync and not remote.f_changed_since_sync: take local
    elif remote.f_changed_since_sync and not local.f_changed_since_sync: take remote
    elif both changed:
        if f is a set (categories):  union, minus items deleted on both sides
        elif f is monotone (status, percent): take the "more advanced" value
             (NEEDS-ACTION < IN-PROCESS < COMPLETED; max(percent))
        else: take the side with the later field-level timestamp;
              record the loser in the audit trail
```

This requires storing a per-field `updated_at` locally. Fem-ho already needs an **audit trail of every change** (product requirement for the AI user), so per-field timestamps are nearly free — reuse the audit log as the clock source.

For fields that only exist locally (`X-FEMHO-*`), the remote can never legitimately change them **unless** it round-tripped them. So: on ingest, if an `X-FEMHO-*` property comes back unchanged, ignore it; if it comes back *changed*, that means a client edited it deliberately (rare) or the remote server mangled it — prefer local and log.

### 10.4 Deletion tombstones

Three separate tombstone concerns:

1. **Server-side (Fem-ho as CalDAV server):** the `dav_change` rows with `op = delete`, retained 30 days, feeding sync-collection `404` responses. Without these, clients never learn about deletions.
2. **Mirror-side:** `dav_mirror_item.deleted_at`. Needed to distinguish "new on the other side" from "deleted on this side". This is the entire reason vdirsyncer needs a status file.
3. **Soft-delete interaction:** Fem-ho likely soft-deletes tasks (trash). A soft-deleted task must appear as a **DELETE** to CalDAV clients (bare `404` in sync-collection). When it is restored, it must appear as a **create** — and it must get a **new href** but ideally the **same UID**. Beware: Nextcloud can't handle UID reuse after delete. If Fem-ho ever mirrors *into* Nextcloud, generate a fresh UID on restore.

### 10.5 Mapping an external CalDAV source into Fem-ho and back

Design the mirror as a **first-class scope-level integration**:

```
FemHoScope/Project  <->  RemoteCalDAVCollection
  direction: pull | push | two-way
  quirk profile (see §9)
  status table rows keyed by UID
```

Rules that keep it sane:

- **One remote collection maps to exactly one Fem-ho project (or a scope's general space).** Do not fan one remote collection into several Fem-ho containers; you lose the ability to write back deterministically.
- **The remote's UID is authoritative for identity.** Store it as `task.external_uid`. Fem-ho's own UID (used when *Fem-ho* is the origin) lives in `task.uid`. A mirrored task has both; a native task has only `uid`.
- **Never write `X-FEMHO-*` to a remote you do not own**, except `X-FEMHO-ID` (harmless, and it makes re-identification robust if the remote regenerates hrefs). Everything else (`X-FEMHO-COLUMN` etc.) should be **local-only** for mirrored tasks — otherwise you pollute the user's work Nextcloud with Fem-ho kanban state.
  - Corollary: for a mirrored task, the kanban column must be **derived** from `STATUS`/`PERCENT-COMPLETE` (see §12), not stored in an X- property on the remote.
- **Rate-limit and back off.** Honour `429`/`503` + `Retry-After` (RFC 6585 / RFC 9110) — python-caldav added exactly this. Nextcloud rate-limits calendar creation by default.
- **Never delete on the remote from an inference.** Only propagate a delete when you have a positive tombstone (status row exists, item absent from a *complete* listing). A truncated or errored listing must never be interpreted as "everything was deleted". This is the classic sync data-loss bug.

### 10.6 How the reference implementations do it

- **Nextcloud (sabre/dav):** server-side sync-token from a `calendarchanges` table with an incrementing `synctoken` column per calendar; ETags are MD5 of the calendar data; ctag == synctoken. Deletion goes to a trashbin, which is why UID reuse breaks.
- **Radicale:** filesystem storage — one directory per collection, one file per item, `.Radicale.props` (JSON) holds WebDAV properties including `C:supported-calendar-component-set`; ETags are SHA-256 of the item (or mtime+size with `use_mtime_and_size_for_item_cache`); sync-tokens cached in `.Radicale.cache/`, expired after `max_sync_token_age` (default 2,592,000 s). Locking via `.Radicale.lock`. Radicale's stated philosophy: *"Radicale does not and will not blindly implement the CalDAV and CardDAV standards. It is mainly designed to support the CalDAV and CardDAV implementations of different clients."*
- **Baikal:** thin admin UI over sabre/dav with SQLite or MySQL. Latest **0.12.0** (2026-08-03). Same semantics as Nextcloud's DAV core.
- **Xandikos:** git-backed — every change is a commit, so history/tombstones are free. Latest **0.4.5** (2026-07-21). No scheduling.
- **Vikunja:** projects ⇄ calendars, tasks ⇄ VTODOs, at `/dav/principals/<username>/`, `/dav/projects/`, `/dav/projects/<id>/`, `/dav/projects/<id>/<task-uid>`. Explicitly does **not** support `ATTACH`, `LOCATION`, `ORGANIZER`, `PERCENT-COMPLETE`, `SEQUENCE`. Auth by account password, dedicated CalDAV token, or API token with CalDAV permission (v2.3.0+). Self-described as *"early alpha"* — a cautionary tale about shipping a partial mapping.

### What Fem-ho should do (bidirectional sync)

- Status table keyed on `(account, collection, uid)` with `remote_etag`, `local_hash`, `remote_hash`, `deleted_at`.
- Canonical-hash comparison with `DTSTAMP`/`LAST-MODIFIED`/`SEQUENCE`/`PRODID` stripped — this is the anti-loop mechanism.
- Field-level merge driven by the audit log's per-field timestamps; whole-object LWW only as a configurable fallback.
- Conflict UI: when both sides changed the same field, keep local, apply remote to a "conflict" note on the task, and surface it as a badge. Never silently discard.
- 30-day tombstone retention on the server; positive-evidence-only deletion on the mirror.
- Backoff on 429/503 with `Retry-After`.

---

## 11. Libraries and reference implementations (verified versions, 2026-08-05)

### 11.1 Go

| Package | Latest | Date | Verdict |
|---|---|---|---|
| `github.com/emersion/go-webdav` (incl. `/caldav`) | **v0.7.0** | 2025-10-18 | **The only serious Go option.** Provides both a client and a server (`caldav.Handler` + `caldav.Backend` interface). v0.7.0 added CalDAV `expand`, better PROPPATCH errors, and If-Match/If-None-Match conditional-request support. Sync-collection exists on the client side (added v0.3.1). |
| `github.com/emersion/go-ical` | **v0.0.0-20250609112844** (pseudo-version, no tags) | 2025-06-09 | iCalendar parse/serialise. **Untagged** — pin the pseudo-version. Used by go-webdav. |
| `github.com/arran4/golang-ical` | **v0.3.5** | 2026-04-01 | Alternative iCalendar lib, tagged releases, more actively released. Good if you want stable tags. |
| `github.com/teambition/rrule-go` | **v1.8.2** | 2023-01-13 | RRULE expansion. Stale but functional and widely used. |

`go-webdav/caldav` server contract (v0.7.0) — implement this interface and you have a CalDAV server:

```go
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
    SupportedComponentSet []string   // <- put "VTODO" here
}

type CalendarObject struct {
    Path          string
    ModTime       time.Time
    ContentLength int64
    ETag          string
    Data          *ical.Calendar
}
```

Client side:

```go
func NewClient(c webdav.HTTPClient, endpoint string) (*Client, error)
func (c *Client) FindCalendarHomeSet(ctx, principal string) (string, error)
func (c *Client) FindCalendars(ctx, calendarHomeSet string) ([]Calendar, error)
func (c *Client) GetCalendarObject(ctx, path string) (*CalendarObject, error)
func (c *Client) MultiGetCalendar(ctx, path string, multiGet *CalendarMultiGet) ([]CalendarObject, error)
func (c *Client) PutCalendarObject(ctx, path string, cal *ical.Calendar) (*CalendarObject, error)
func (c *Client) QueryCalendar(ctx, calendar string, query *CalendarQuery) ([]CalendarObject, error)
func DiscoverContextURL(ctx context.Context, domain string) (string, error)
```

Also useful: `caldav.Handler{Backend, Prefix}`, `caldav.NewPreconditionError(...)`, `caldav.ValidateCalendarObject(cal) (eventType, uid string, err error)`, `caldav.NewCalendarHomeSet(path)`.

**Gap to be aware of:** go-webdav's `Handler` does **not** implement RFC 6578 sync-collection on the server side as of v0.7.0 (client-side only). **UNVERIFIED** whether v0.7.0 closed this; assume you must add the `sync-collection` REPORT yourself. Budget for it.

### 11.2 Node / TypeScript

| Package | Latest | Published | Verdict |
|---|---|---|---|
| `tsdav` | **2.3.1** | 2026-07-10 | **The CalDAV/CardDAV client to use.** Actively maintained. Node + browser. Has `createAccount`, `fetchCalendars`, `fetchCalendarObjects`, `createCalendarObject`, `updateCalendarObject`, `deleteCalendarObject`, `syncCollection`, `smartCollectionSync`. |
| `ical.js` (kewisch) | **2.2.1** | 2025-08-08 | **The iCalendar parser to use.** Powers Thunderbird. jCal, `ICAL.Component`, `ICAL.Time`, `ICAL.Timezone`, `ICAL.Event`, recurrence iteration. Handles VTODO as a generic component (no `ICAL.Todo` helper — you drive `ICAL.Component` directly). |
| `ical-generator` | **11.1.0** | 2026-07-24 | Generation only. Fine for one-way export. |
| `node-ical` | **0.27.1** | 2026-07-21 | Parser, looser API than ical.js. |
| `rrule` | **2.8.1** | 2023-11-10 | RRULE expansion. Stale but the de facto JS choice. |
| `dav` (gaye) | 1.8.0, last real publish **2018-08-11** | — | **Dead. Do not use.** |

**There is no production-grade CalDAV *server* library for Node.** You will hand-roll the XML. That is a real cost: PROPFIND/REPORT XML with correct namespaces is a few thousand lines. Budget accordingly, or put the DAV layer in Go/Python.

### 11.3 Python

| Package | Latest | Uploaded | Verdict |
|---|---|---|---|
| `caldav` | **3.2.1** | 2026-05-28 | **Best-in-class CalDAV client, any language.** Requires Python ≥ 3.10. 3.x has a sync **and** async API over a "Sans-I/O" core, uses `niquests` (HTTP/2, HTTP/3) with `httpx` fallback, has `get_objects_by_sync_token()`, RFC 6638 scheduling (3.2.0), rate-limit handling for 429/503 with `Retry-After`, and — uniquely — a **machine-readable server compatibility database** (`caldav/compatibility_hints.py`). |
| `icalendar` | **7.2.2** | 2026-07-20 | RFC 5545 parse/generate. Python ≥ 3.10. |
| `recurring-ical-events` | **3.8.2** | 2026-04-30 | Recurrence expansion for events **and todos**. |
| `vobject` | 0.9.9 | 2024-12-16 | Older; still used by Radicale. Prefer `icalendar` for new code. |
| `radicale` | **3.7.7** | 2026-07-19 | Full CalDAV/CardDAV **server**, embeddable as a WSGI app. |
| `xandikos` | **0.4.5** | 2026-07-21 | Git-backed CalDAV/CardDAV **server**. |
| `vdirsyncer` | 0.20.0 | 2025-08-28 | Two-way sync tool; the algorithm reference. |

### 11.4 PHP

| Package | Latest | Date | Verdict |
|---|---|---|---|
| `sabre/dav` | **4.7.1** | 2026-07-07 | Requires PHP ^7.1 \|\| ^8.0. The engine behind Nextcloud, ownCloud, Baikal, Davis, Davical-adjacent stacks. **The single best reference implementation to read.** |
| `sabre/vobject` | **5.0.0** (PHP ^8.2) / 4.6.1 | 2026-07-07 | iCalendar/vCard parsing for sabre. |

sabre's `PDO` calendar backend schema is the canonical relational model. Per calendar object it stores: `id`, `calendarid`, `uri`, `calendardata`, `lastmodified`, `etag`, `size`, `componenttype`, `firstoccurence`, `lastoccurence`, `uid`. Per calendar: `id`, `principaluri`, `displayname`, `uri`, `synctoken`, `description`, `calendarorder`, `calendarcolor`, `timezone`, `components`. Plus a `calendarchanges` table (`uri`, `synctoken`, `calendarid`, `operation`) — **that is the tombstone table**, exactly the `dav_change` design in §4.3.

### 11.5 Reference implementations to read, ranked

1. **sabre/dav** (PHP) — the most complete open CalDAV server; read `CalDAV/Plugin.php`, `CalDAV/Backend/PDO.php`, `DAV/Sync/Plugin.php`.
2. **Xandikos** (Python) — smallest complete implementation; best for understanding the protocol end to end without framework noise.
3. **Radicale** (Python) — pragmatic, client-compatibility-driven; read its storage layer for the ETag/sync-token design.
4. **Baikal** (PHP) — packaging/deployment reference for a self-hosted Docker product; also the closest analogue to what Fem-ho ships.
5. **python-caldav** (`compatibility_hints.py`) — read this file cover to cover before writing a single line of client code. It is the accumulated bug knowledge of the whole ecosystem.
6. **ical4android** (Kotlin) — read `Task.kt`, `DmfsTask.kt`, `validation/ICalPreprocessor.kt` for exactly what an Android CalDAV client will do to your data.

### What Fem-ho should do (stack)

- If the Fem-ho backend is **Go**: use `emersion/go-webdav` + `emersion/go-ical`, and plan to write the sync-collection REPORT handler yourself.
- If **Node/TypeScript**: use `tsdav` + `ical.js` for the *client* side; strongly consider **not** hand-rolling the server and instead running the DAV layer as a separate Go or Python service against the same database. A Node CalDAV server is a multi-week detour.
- If **Python**: `caldav` 3.2.1 client + either embed Radicale with a custom storage backend or hand-roll on top of `icalendar` 7.2.2.
- Whatever the language: **write conformance tests against Radicale, Xandikos and Baikal in Docker Compose** during CI. All three are small, containerised and free. Add a DAVx5 manual test pass per release.

---

## 12. VTODO ⇄ Fem-ho field mapping

### 12.1 Standard properties

| Fem-ho concept | iCalendar | Direction | Notes |
|---|---|---|---|
| task id (internal) | — | — | never on the wire |
| task uid | `UID` | ⇄ | UUIDv7. Also mirrored to `X-FEMHO-ID` for robustness. |
| title | `SUMMARY` | ⇄ | |
| description / notes | `DESCRIPTION` | ⇄ | escape `\n \, \; \\` |
| created | `CREATED` | → | UTC |
| updated | `LAST-MODIFIED` + `DTSTAMP` | → | UTC; excluded from the sync hash |
| start date | `DTSTART` | ⇄ | `VALUE=DATE` for all-day |
| due date | `DUE` | ⇄ | `VALUE=DATE` for all-day; never together with `DURATION` |
| estimated effort | `DURATION` | ⇄ | only when `DTSTART` present **and** `DUE` absent. Given the DUE/DURATION exclusivity, Fem-ho should prefer `DUE` and put effort in `X-FEMHO-ESTIMATE` instead. |
| completed at | `COMPLETED` | ⇄ | UTC only |
| done flag | `STATUS` | ⇄ | see column mapping below |
| progress | `PERCENT-COMPLETE` | ⇄ | 0-100 |
| priority (alta/mitjana/baixa) | `PRIORITY` | ⇄ | alta→`1`, mitjana→`5`, baixa→`9`; on read: 1-4 alta, 5 mitjana, 6-9 baixa, 0/absent → cap |
| tags | `CATEGORIES` | ⇄ | |
| parent task (subtask) | `RELATED-TO;RELTYPE=PARENT` | ⇄ | value = parent UID; same collection only |
| assignee (`@person`) | `ATTENDEE;CN=..;PARTSTAT=..:mailto:..` | ⇄ | plus `SCHEDULE-AGENT=NONE`; also `X-FEMHO-ASSIGNEE` with the Fem-ho username |
| creator / owner | `ORGANIZER;CN=..:mailto:..` | ⇄ | |
| recurrence | `RRULE` (+`RDATE`/`EXDATE`) | ⇄ | |
| reminder | `VALARM` (`ACTION:DISPLAY`, `TRIGGER`) | ⇄ | `ACKNOWLEDGED` (RFC 9074) on dismiss |
| scope colour (Plou accent) | `COLOR` (RFC 7986) + `IC:calendar-color` prop | → | `COLOR` is snapped to CSS3 names by DAVx5; the WebDAV `calendar-color` prop carries exact `#RRGGBBAA` |
| visibility | `CLASS` | ⇄ | `PUBLIC` default; a private task → `PRIVATE` |
| link | `URL` | ⇄ | |
| manual order in column | `X-APPLE-SORT-ORDER` | ⇄ | integer; interoperates with Apple/Nextcloud/Tasks.org |

### 12.2 The kanban column — the hard one

iCalendar has **no** concept of a board column. Four Fem-ho columns (Inbox / Per fer / Fent / Fet) must map onto three usable `STATUS` values plus something extra.

**Recommended dual encoding — authoritative X- property, derived standard property:**

| Fem-ho column | `STATUS` | `PERCENT-COMPLETE` | `X-FEMHO-COLUMN` |
|---|---|---|---|
| **Inbox** | `NEEDS-ACTION` | absent | `INBOX` |
| **Per fer** | `NEEDS-ACTION` | `0` | `TODO` |
| **Fent** | `IN-PROCESS` | 1..99 (default 50) | `DOING` |
| **Fet** | `COMPLETED` | `100` (+`COMPLETED` timestamp) | `DONE` |
| *(cancelled/archived)* | `CANCELLED` | — | `CANCELLED` |

Read algorithm (order matters):

```
1. if X-FEMHO-COLUMN present and valid -> use it.
2. else if STATUS == COMPLETED  -> DONE
3. else if STATUS == CANCELLED  -> CANCELLED
4. else if STATUS == IN-PROCESS -> DOING
5. else if PERCENT-COMPLETE is present (even 0) -> TODO
6. else -> INBOX
```

Step 5 is the trick that lets Inbox and "Per fer" be distinguishable to a dumb client without extra properties: presence of `PERCENT-COMPLETE:0` means "triaged". A third-party client that ticks a task to done sets `STATUS:COMPLETED`, which step 2 catches even though `X-FEMHO-COLUMN` still says `DOING` — so **on ingest, if `STATUS` disagrees with `X-FEMHO-COLUMN`, `STATUS` wins and `X-FEMHO-COLUMN` is rewritten.** Otherwise external completions would be ignored. Encode that as an explicit rule.

### 12.3 Everything else needs `X-FEMHO-*`

| Fem-ho concept | Property | Value | Why no standard home |
|---|---|---|---|
| scope (àmbit) | `X-FEMHO-SCOPE` | scope slug | encoded in the collection URL too, but needed for cross-collection moves and for flat exports |
| project | `X-FEMHO-PROJECT` | project slug | same |
| kanban column | `X-FEMHO-COLUMN` | `INBOX\|TODO\|DOING\|DONE\|CANCELLED` | no board concept in iCal |
| AI mode | `X-FEMHO-AI-MODE` | `SELF\|ASSISTED\|DELEGATED` | no equivalent |
| AI agent identity | `X-FEMHO-AI-AGENT` | agent id | — |
| assignee (internal id) | `X-FEMHO-ASSIGNEE` | username | `ATTENDEE` requires an email; internal usernames are more stable |
| Fem-ho task id | `X-FEMHO-ID` | UUID | re-identification if a remote regenerates UIDs |
| checklist membership | `X-FEMHO-CHECKLIST` | checklist UID | see §13.3 |
| checklist item order | `X-APPLE-SORT-ORDER` | integer | reuse the standard-ish one |
| checklist pinned | `X-PINNED` | `true`/`false` | reuse Nextcloud's |
| estimate | `X-FEMHO-ESTIMATE` | ISO-8601 duration | `DURATION` is blocked by `DUE` |
| share link token | *(none — never emit)* | — | security: public share tokens must not leak into synced iCalendar |
| audit revision | `X-FEMHO-REV` | integer | helps field-level merge; excluded from the sync hash |

**Do not** emit `X-FEMHO-*` (other than `X-FEMHO-ID`) onto remote collections Fem-ho does not own (§10.5).

### 12.4 Assignment (`@person`) round-trip

```
ATTENDEE;CN=Marta;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION
 ;SCHEDULE-AGENT=NONE;X-FEMHO-USER=marta:mailto:marta@example.net
```

- `PARTSTAT` maps to the assignee's own acknowledgement: `NEEDS-ACTION` → not yet accepted; `ACCEPTED` → accepted; `IN-PROCESS` → working on it; `COMPLETED` → done; `DECLINED` → refused.
- `SCHEDULE-AGENT=NONE` prevents any RFC 6638 server in the chain from emailing invitations. This matters if a Fem-ho task ever gets mirrored into Nextcloud/Baikal, both of which auto-schedule.
- The `X-FEMHO-USER` **parameter** (parameters may also be `X-`-prefixed) survives round-trips through ical4j-based clients and lets you re-resolve the Fem-ho user without email matching.

The AI user is just another attendee:

```
ATTENDEE;CN=Fem-ho AI;CUTYPE=UNKNOWN;ROLE=NON-PARTICIPANT;PARTSTAT=IN-PROCESS
 ;SCHEDULE-AGENT=NONE;X-FEMHO-USER=ai:mailto:ai@femho.local
```

`CUTYPE` values in RFC 5545 are `INDIVIDUAL`, `GROUP`, `RESOURCE`, `ROOM`, `UNKNOWN`, plus x-name/iana-token. Using `CUTYPE=UNKNOWN` (or an x-token) for the AI user is safest — `RESOURCE` would make some clients treat it as a bookable room.

---

## 13. Fem-ho's CalDAV implementation plan

### 13.1 URL layout

```
https://femho.example/
  /.well-known/caldav                                  -> 302 -> /dav/
  /.well-known/carddav                                 -> 404 (not offered)

  /dav/                                                 (service root; PROPFIND -> current-user-principal)
  /dav/principals/                                      (principal collection)
  /dav/principals/<user>/                               (DAV:principal; calendar-home-set, calendar-user-address-set)
  /dav/calendars/<user>/                                (calendar home set, Depth:1 lists everything below)

  # one collection per scope's general space:
  /dav/calendars/<user>/s-<scope-slug>/                 supported-calendar-component-set = VTODO
  # one collection per project:
  /dav/calendars/<user>/p-<scope-slug>-<project-slug>/  supported-calendar-component-set = VTODO
  # optional aggregate, read-mostly:
  /dav/calendars/<user>/all-tasks/                      VTODO, union of everything the user can see
  # events mirror (phase 2):
  /dav/calendars/<user>/cal-<scope-slug>/               supported-calendar-component-set = VEVENT

  # objects:
  /dav/calendars/<user>/<collection>/<uid>.ics
```

Design notes:

- **Prefix the collection segment** (`s-`, `p-`, `cal-`) so the router can dispatch without a DB lookup, and so a scope and a project can never collide in the namespace.
- **`<uid>.ics`** as the href. The spec says href and UID are unrelated, and you must not *require* that shape from clients — but when *you* create objects, deriving the href from the UID makes multiget and mirroring trivial. Accept **any** href a client PUTs; store it.
- **Collective vs individual scopes:** the home set is per user. A collective scope appears in every member's home set at the same slug. The underlying objects are the same rows; ETags and sync-tokens are per (collection, user) — actually simpler: make the sync-token per *collection* (shared) since all members see the same content. If per-user filtering differs (e.g. private tasks with `CLASS:PRIVATE`), you must make the token per (collection, user); prefer to avoid per-user filtering inside a collection.
- **Aggregate collection caveat:** an `all-tasks` collection breaks the "parent and child in the same collection" rule in a *useful* way (everything is in it), but it also duplicates UIDs across collections, which Zimbra-style servers hate and which confuses clients that sync both. Ship it **off by default**, behind a per-user toggle, and mark it read-only if you cannot resolve writes to the right project.

### 13.2 Collection property values Fem-ho emits

| Property | Value |
|---|---|
| `DAV:resourcetype` | `<D:collection/><C:calendar/>` |
| `DAV:displayname` | scope name, or `"<Scope> / <Project>"` |
| `CALDAV:calendar-description` | scope/project description |
| `CALDAV:supported-calendar-component-set` | `<C:comp name="VTODO"/>` |
| `CALDAV:supported-calendar-data` | `<C:calendar-data content-type="text/calendar" version="2.0"/>` |
| `CALDAV:supported-collation-set` | `i;ascii-casemap`, `i;octet` |
| `CALDAV:calendar-timezone` | a VCALENDAR containing the household's default VTIMEZONE (e.g. `Europe/Madrid`) |
| `CALDAV:max-resource-size` | `1048576` (1 MiB) |
| `CS:getctag` | `femho-<collection-id>-<seq>` |
| `DAV:sync-token` | `https://<host>/ns/sync/<collection-id>/<seq>` |
| `IC:calendar-color` | `#RRGGBBAA` from the Plou accent |
| `IC:calendar-order` | scope order index |
| `DAV:current-user-privilege-set` | `read`, `write`, `write-content`, `bind`, `unbind`, `C:read-free-busy` as appropriate |
| `DAV:owner` | the principal href of the scope owner |

### 13.3 How a "simple list" (checklist) maps

Fem-ho checklists are lightweight, attach to a task or subtask, and are pinnable. Three candidate encodings:

| Option | Encoding | Verdict |
|---|---|---|
| **A. One VTODO per checklist item, `RELATED-TO;RELTYPE=PARENT` to the owning task** | items appear as subtasks in Nextcloud Tasks / Tasks.org / jtx | **Recommended when the checklist hangs off a task.** Full interop; ticking an item in Tasks.org works. Mark them with `X-FEMHO-CHECKLIST:<checklist-uid>` and `X-FEMHO-KIND:CHECKITEM` so Fem-ho renders them as a checklist rather than as nested cards. |
| **B. Items encoded in `DESCRIPTION` as `- [ ] text`** | one VTODO total | Zero interop (no client can tick an item), but survives any server. Use as the export format for **share links** only. |
| **C. A dedicated CalDAV collection per standalone checklist** | `/dav/calendars/<user>/l-<list-slug>/` | **Recommended for standalone/pinned lists** ("Compra", "Maleta"). Shows up in DAVx5 as its own task list, which is exactly what a user wants for a shopping list. |

Recommended combination: **A for task-attached checklists, C for standalone pinned lists.** In both cases:

- checklist item = VTODO with `SUMMARY` = item text, `STATUS` = `NEEDS-ACTION`/`COMPLETED`, `X-APPLE-SORT-ORDER` = position.
- `X-FEMHO-KIND:CHECKITEM` distinguishes it from a real task, so Fem-ho does not show checklist items on the kanban board.
- Because option A requires parent and child in the same collection, a checklist always lives in the same collection as its owning task. Fine by construction.

### 13.4 Auth and tokens

Product requirement: "separately scoped tokens/API keys for humans vs AI". For CalDAV specifically:

- **HTTP Basic over TLS**, username = Fem-ho username or email, password = a **CalDAV app token** (not the login password). Every real client supports Basic; almost none support OAuth for CalDAV without vendor-specific glue.
- Token scopes: `caldav:read`, `caldav:write`, optionally restricted to a set of collections. The AI user's token should **never** carry `caldav:*` — the AI talks REST/MCP, not CalDAV. That keeps the audit trail clean (CalDAV writes are attributed to a device; MCP writes to an agent).
- Rate-limit per token; return `429` with `Retry-After` (good clients honour it; python-caldav explicitly does).
- Log every CalDAV write into the same audit trail as REST/MCP writes, tagged with the token id and the client's `User-Agent`.

### 13.5 The exact sync loop

#### A. Fem-ho server → clients (nothing to implement beyond correctness)

Clients drive it. Your obligations:
1. Bump the per-collection sequence on **every** content change (create, update, delete, and on a task moving between collections — that is a delete in one and a create in the other).
2. Write a `dav_change` row for each.
3. Serve `getctag`, `sync-token`, `calendar-query`, `calendar-multiget`, `sync-collection`.
4. Strong, stable ETags: `etag = "W/" is forbidden` — use a strong tag, e.g. `"<sha256 of the serialised .ics, first 16 hex chars>"`. It must be identical for two consecutive GETs with no intervening change, which means your serialisation must be **deterministic**: fixed property order, fixed folding, no timestamp of "now" anywhere except `DTSTAMP` (which comes from the DB, not the clock).

#### B. Fem-ho client → remote CalDAV (the mirror)

```
FOR each linked account:
  0. ensure discovery cached: principal, home-set, collection list, quirk profile
  1. PROPFIND Depth:0 on the collection  { DAV:sync-token, CS:getctag, DAV:displayname }
  2. IF server has sync-token AND we have a stored token:
        REPORT sync-collection { stored token, sync-level 1, prop: getetag, limit: 100 }
        on 403 valid-sync-token -> clear token, goto 3
        collect: changed[href->etag], deleted[href]
     ELSE IF ctag unchanged: goto 7
     ELSE (step 3):
        REPORT calendar-query Depth:1 { prop: getetag; filter VCALENDAR/VTODO }
        diff against status table -> changed[], deleted[]
  3. IF changed is non-empty:
        REPORT calendar-multiget Depth:1 { prop: getetag, calendar-data; hrefs: changed }
        (chunk to <= 100 hrefs per request)
  4. FOR each fetched object:
        parse; run the ical4android sanity checks;
        canonical_hash = hash(strip DTSTAMP/LAST-MODIFIED/SEQUENCE/PRODID)
        IF canonical_hash == status.remote_hash: skip (this is our own echo)
        ELSE apply the merge matrix (§10.2/§10.3) and write locally
        update status row {remote_etag, remote_hash}
  5. FOR each deleted href:
        IF status row exists and local not modified since -> delete locally (soft)
        ELSE -> conflict: local edit vs remote delete -> keep local, mark "recreate"
        update/clear status row
  6. store the new sync-token / ctag
  7. PUSH phase — for each locally changed task in this collection:
        IF no status row:            PUT with If-None-Match: *
           on 412 -> the href exists; GET, merge, retry with If-Match
        ELSE IF local deleted:       DELETE with If-Match: status.remote_etag
           on 412 -> GET; if remote changed, resolve (default: keep remote, undelete locally)
        ELSE:                        PUT with If-Match: status.remote_etag
           on 412 -> GET (fresh etag+data), merge, PUT again with the fresh If-Match
                     (max 3 attempts, then surface a conflict badge)
        take the ETag from the response; if absent, GET to read it
        update status row {remote_etag, remote_hash, local_hash}
  8. sleep per the quirk profile's rate limit; honour 429/503 Retry-After
```

Ordering rule inside step 7: **push parents before children.** A `RELATED-TO;RELTYPE=PARENT` pointing at a UID the remote has never seen is legal but leaves the remote in a broken-looking state until the parent lands. Topologically sort by parent depth.

Batching rule: chunk `calendar-multiget` to ~100 hrefs. Some servers cap request body size; `CALDAV:max-resource-size` does not cover REPORT bodies.

#### C. Android offline-first specifics

The Fem-ho Android app is offline-first and always paired to a server. It talks to Fem-ho's **own REST API**, not CalDAV — CalDAV is for third-party clients. But the same sync-token discipline applies: expose a `GET /api/v1/sync?token=...` that mirrors RFC 6578 semantics (changes + tombstones + a new token). Reusing the same per-collection sequence counter for both CalDAV `sync-token` and the REST sync endpoint means one implementation, two protocols.

For push, implement **WebDAV-Push** (bitfire draft) on the CalDAV side so DAVx5 users get near-instant sync, and the equivalent (FCM/UnifiedPush) for the Fem-ho app:

- Namespace `https://bitfire.at/webdav-push`; `DAV: webdav-push` token in OPTIONS.
- Registration is a **POST** to the collection with `Content-Type: application/xml`:

```xml
<?xml version="1.0" encoding="utf-8" ?>
<push-register xmlns="https://bitfire.at/webdav-push" xmlns:D="DAV:">
  <subscription>
    <web-push-subscription>
      <push-resource>https://up.example.net/yohd4yai5Phiz1wi</push-resource>
      <content-encoding>aes128gcm</content-encoding>
      <subscription-public-key type="p256dh">BCVxsr7N_…</subscription-public-key>
      <auth-secret>BTBZMqHH6r4Tts7J_aSIgg</auth-secret>
    </web-push-subscription>
  </subscription>
  <trigger>
    <content-update><D:depth>infinity</D:depth></content-update>
  </trigger>
  <expires>Wed, 20 Dec 2023 10:03:31 GMT</expires>
</push-register>
```

- Response: `204` (or `201`) with `Location: <subscription management URL>` and `Expires:` in IMF-fixdate.
- The push message the server later POSTs to the push resource:

```xml
<?xml version="1.0" encoding="utf-8" ?>
<push-message xmlns="https://bitfire.at/webdav-push" xmlns:D="DAV:">
  <topic>O7M1nQ7cKkKTKsoS_j6Z3w</topic>
  <content-update>
    <D:sync-token>https://femho.example/ns/sync/scope-personal/1512</D:sync-token>
  </content-update>
</push-message>
```

- `topic` is a server-wide unique, opaque id for the collection. Messages are end-to-end encrypted (Web Push, RFC 8030 + aes128gcm) so the push transport cannot read them.
- Client requirement: DAVx5 **4.4.10+** and a UnifiedPush distributor or FCM on the device.
- Server support today: only Nextcloud (`nc_ext_dav_push`). **Fem-ho would be the second implementation** — cheap differentiator, and bitfire actively wants more servers to implement it.

This is a **draft, not an RFC** — flag it as such and keep polling as the fallback.

### 13.6 Build order

1. **Read-only CalDAV server, VTODO only.** OPTIONS, PROPFIND (Depth 0/1), current-user-principal, calendar-home-set, collection enumeration, `calendar-query`, `calendar-multiget`, GET, ETags, `getctag`. Test with DAVx5 + Tasks.org and Thunderbird.
2. **Writes.** PUT with `If-Match`/`If-None-Match`, DELETE, the precondition error bodies, `X-` preservation, the `dav_change` tombstone table.
3. **sync-collection** REPORT + `DAV:sync-token` property + `valid-sync-token` 403.
4. **MKCALENDAR / extended MKCOL / PROPPATCH displayname+color**, so DAVx5 can create a project collection from the phone.
5. **The client/mirror**, with the quirk profile and the status table.
6. **WebDAV-Push.**
7. *(optional, probably never)* RFC 6638 scheduling.

### 13.7 Conformance test checklist

- [ ] `curl -X OPTIONS` shows `DAV: 1, 3, calendar-access`.
- [ ] `PROPFIND` with **no** `Depth` header does not 500.
- [ ] `PROPFIND Depth: infinity` returns `403` + `<D:propfind-finite-depth/>`.
- [ ] `calendar-query` with **no inner comp-filter** returns all objects (Nextcloud fails this; do not copy Nextcloud).
- [ ] A VTODO with no dates matches any `time-range` (RFC 4791 §9.9 last row).
- [ ] Two consecutive GETs of an unmodified object return **byte-identical** bodies and the same ETag.
- [ ] PUT of a VEVENT into a VTODO collection returns `403` + `<C:supported-calendar-component/>`.
- [ ] PUT of a body with `METHOD:REQUEST` returns `403` + `<C:valid-calendar-object-resource/>`.
- [ ] PUT of two VTODOs with different UIDs in one body is rejected.
- [ ] `If-Match` with a stale ETag returns `412` and does not modify anything.
- [ ] After DELETE, `sync-collection` with the pre-delete token yields a bare `404` response for that href.
- [ ] A sync-token older than the retention window yields `403` + `<D:valid-sync-token/>`.
- [ ] `X-APPLE-SORT-ORDER`, `X-OC-HIDESUBTASKS`, `X-MOZ-LASTACK` written by a client survive a Fem-ho-side edit.
- [ ] `RELATED-TO` with no `RELTYPE` is read as PARENT.
- [ ] `DTSTART` DATE + `DUE` DATE-TIME is normalised, not rejected.
- [ ] A task moved between projects appears as delete-in-A + create-in-B to sync-collection.
- [ ] DAVx5 + Tasks.org: create, edit, complete, subtask, delete, all round-trip.
- [ ] Thunderbird: a task edited in Thunderbird does not lose its `RELATED-TO` or `X-FEMHO-*`.

---

## 14. Things flagged UNVERIFIED

- Whether `emersion/go-webdav` **v0.7.0** implements the `sync-collection` REPORT on the **server** side (only client-side support was explicitly documented, added v0.3.1). Verify before relying on it.
- Whether current Thunderbird (128/140 ESR) **preserves** unknown `X-` properties and `RELATED-TO` on write. Behaviour was verified for ical4android, not for Thunderbird. Test explicitly.
- The exact current state of Apple Reminders' CalDAV write behaviour on macOS 15/26 — sources agree it *preserves* `RELATED-TO`/`X-APPLE-*` but disagree on whether subtask structure can be *created* over CalDAV.
- The claimed iCloud dual-stack PROPFIND hang: reported in the wild, no primary source located.
- KOrganizer's exact VTODO/`RELATED-TO` field coverage (listed as "working" by Vikunja, not independently verified).
- Vikunja's "Thunderbird (v68) not working" is a Vikunja-specific, dated data point — not a general statement about Thunderbird.
- Exact sabre/dav `calendarchanges` column names quoted from memory of the schema; verify against `sabre-io/dav` `examples/sql/*.sql` before copying.
- `ical-generator` 11.1.0 and `node-ical` 0.27.1 VTODO coverage was not inspected; versions/dates are from the npm registry and are accurate, feature claims are not made.

---

## 15. Sources (fetched 2026-08-05)

RFCs and specs
- https://www.rfc-editor.org/rfc/rfc4791.txt — CalDAV
- https://datatracker.ietf.org/doc/html/rfc4791#section-5.1 — CalDAV server requirements, OPTIONS example
- https://datatracker.ietf.org/doc/html/rfc4791#section-5.3.1 — MKCALENDAR
- https://www.rfc-editor.org/rfc/rfc5545.txt — iCalendar
- https://datatracker.ietf.org/doc/html/rfc5545#section-3.8.4.5 — RELATED-TO / RELTYPE / PRIORITY
- https://www.rfc-editor.org/rfc/rfc5546.txt — iTIP
- https://www.rfc-editor.org/rfc/rfc6638.txt — CalDAV Scheduling
- https://www.rfc-editor.org/rfc/rfc6578.txt — WebDAV Collection Synchronization
- https://www.rfc-editor.org/rfc/rfc4918.txt — WebDAV (compliance classes verified verbatim from §18)
- https://datatracker.ietf.org/doc/html/rfc4918#section-18 — DAV compliance classes
- https://www.rfc-editor.org/rfc/rfc5397.txt — current-user-principal
- https://www.rfc-editor.org/rfc/rfc6764.txt — service discovery
- https://www.rfc-editor.org/rfc/rfc7986.txt — new iCalendar properties (COLOR, NAME, IMAGE, CONFERENCE…)
- https://www.rfc-editor.org/rfc/rfc9073.txt — event publishing extensions
- https://www.rfc-editor.org/rfc/rfc9074.txt — VALARM extensions
- https://icalendar.org/CalDAV-Access-RFC-4791/9-9-caldav-time-range-xml-element.html — the VTODO time-range overlap table
- https://icalendar.org/CalDAV-Access-RFC-4791/5-3-1-mkcalendar-request.html
- https://github.com/apple/ccs-calendarserver/blob/master/doc/Extensions/caldav-ctag.txt — CS:getctag
- https://bitfireat.github.io/webdav-push/draft-bitfire-webdav-push-00.html — WebDAV-Push draft

Implementation guides
- https://sabre.io/dav/building-a-caldav-client/ — the canonical client algorithm
- https://sabre.io/dav/caldav/
- https://radicale.org/v3.html — Radicale storage/ETag/sync-token design
- https://manual.davx5.com/webdav_push.html
- https://manual.davx5.com/tasks_notes.html
- https://www.davx5.com/faq/tasks/advanced-task-features
- https://www.davx5.com/tested-with/nextcloud
- https://vikunja.io/docs/caldav/ — a full VTODO↔product field mapping in production
- https://vdirsyncer.pimutils.org/en/stable/config.html — conflict_resolution, item_types, status_path
- https://unterwaditzer.net/2016/sync-algorithm.html — the two-way sync decision matrix
- https://tasks.org/docs/caldav_intro.html
- https://tasks.org/docs/manual_sort_mode/ — x-apple-sort-order
- https://docs.nextcloud.com/server/latest/user_manual/en/groupware/sync_ios.html — /remote.php/dav paths

Source code read directly
- https://raw.githubusercontent.com/bitfireAT/ical4android/main/lib/src/main/kotlin/at/bitfire/ical4android/Task.kt
- https://raw.githubusercontent.com/bitfireAT/ical4android/main/lib/src/main/kotlin/at/bitfire/ical4android/DmfsTask.kt
- https://raw.githubusercontent.com/bitfireAT/ical4android/main/lib/src/main/kotlin/at/bitfire/ical4android/validation/ICalPreprocessor.kt
- https://raw.githubusercontent.com/nextcloud/tasks/main/src/models/task.js
- https://raw.githubusercontent.com/python-caldav/caldav/master/caldav/compatibility_hints.py — the server quirk database
- https://raw.githubusercontent.com/python-caldav/caldav/master/CHANGELOG.md

Registries / release feeds (versions verified 2026-08-05)
- https://pkg.go.dev/github.com/emersion/go-webdav/caldav ; https://proxy.golang.org/github.com/emersion/go-webdav/@latest
- https://proxy.golang.org/github.com/emersion/go-ical/@latest ; .../arran4/golang-ical/@latest ; .../teambition/rrule-go/@latest
- https://registry.npmjs.org/tsdav ; /ical.js ; /ical-generator ; /node-ical ; /rrule ; /dav
- https://pypi.org/pypi/caldav/json ; /icalendar ; /vobject ; /recurring-ical-events ; /radicale ; /xandikos ; /vdirsyncer
- https://repo.packagist.org/p2/sabre/dav.json ; /sabre/vobject.json
- https://api.github.com/repos/sabre-io/Baikal/releases ; /Kozea/Radicale ; /jelmer/xandikos ; /bitfireAT/davx5-ose

Secondary (used for orientation, claims cross-checked against primaries)
- https://bugzilla.mozilla.org/show_bug.cgi?id=194863 — Thunderbird subtasks
- https://github.com/dmfs/opentasks/issues/341 — subtask via RELATED-TO
- https://wiki.davical.org/index.php/Setup_for_Apple_Users — Apple wants separate VEVENT/VTODO collections
- https://github.com/nextcloud/server/issues/30096 — UID reuse after delete
- https://github.com/nextcloud/server/pull/44130 — sync-collection after deletion
- https://powerusers.codidact.com/posts/292445 — client feature comparison
