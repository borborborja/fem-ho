# Fem-ho — Gap Dossier 2: Calendar EVENTS as a first-class entity (VEVENT), distinct from tasks

**The question this dossier closes.** The Fem-ho brief says the calendar view "holds EVENTS as well as tasks" and that Fem-ho acts as a *client* of external source calendars — which serve VEVENTs, not VTODOs. None of the twelve existing dossiers models an event. Dossier 05 §1.1's entity inventory has no `event` row; §19's endpoint table has no `/events` resource (only `/events/stream`, which is SSE and will be misread as the events CRUD). Dossier 08's Part 5 schema has `tasks`, `checklists`, `comments`, `reminders`, `recurrences` — no `events` table; only `calendars.component_kinds` hints VEVENT may exist. Dossier 03 spends 1600 lines on VTODO and mentions VEVENT only to say it must live in a separate collection. Dossier 01 §10.8 defers VEVENT to "v2 scope". Yet dossier 07 §9 already puts `entity: 'task' | 'checklist' | 'event' | 'project' | 'scope'` on the SSE wire and wires up FullCalendar. Left as-is, an implementing AI will either invent an events table with no CalDAV round-trip, or fake events as "tasks with a start and an end date" — which silently breaks recurrence overrides, attendees, TRANSP/free-busy, and read-only external calendars, and is very expensive to undo after M5. This dossier specifies the VEVENT entity at implementation grade: RFC-level property rules, the recurrence master+override model and the three implementable expansion strategies, the read-only external-calendar ingest path, product precedent for the task/event boundary, and a concrete SQL schema, REST shape, CalDAV layout, MCP surface and Android delta-sync design, with an explicit v1 / deferred split.

---

## 0. Executive decision summary

| # | Decision | Short rationale |
|---|---|---|
| D1 | `event` is a **separate entity** from `task`. Never a task with `start`+`end`. | RFC 5545 gives VEVENT and VTODO different required properties, different STATUS enums, different PARTSTAT enums, different time-range overlap algebra (RFC 4791 §9.9), and CalDAV forbids mixing them in one collection (RFC 4791 §5.2). Apple EventKit enforces the same split at the OS level (`EKEvent` vs `EKReminder`, `EKCalendar.allowedEntityTypes`). |
| D2 | One DB row per **VEVENT component**, not per calendar object resource. Master row has `recurrence_id IS NULL`; each override is its own row with the same `uid`. | Matches Google Calendar (`recurringEventId` + `originalStartTime`), Android `CalendarContract` (`ORIGINAL_ID` + `ORIGINAL_INSTANCE_TIME`) and Morgen (`masterEventId` + `recurrenceId`). Lets the REST/Kanban/UI layers address an override directly. |
| D3 | Keep a **lossless `ical_raw`** blob per calendar object resource alongside the normalised columns. | Without it, CalDAV round-tripping destroys X-props, ATTACH, CONFERENCE, unknown params. sabre/dav stores only the blob (`calendarobjects.calendardata`) plus index columns; we invert that but keep the blob. |
| D4 | **Hybrid expansion**: materialise a rolling window of occurrences into `event_occurrences`, expand on demand outside the window. | Radicale/Xandikos expand on read (simple, slow); Android's `Instances` table materialises (fast, needs invalidation); sabre/Nextcloud index only `firstoccurence`/`lastoccurence` and expand the shortlist. Hybrid gives O(index) month queries and correct answers for 2087. |
| D5 | Separate CalDAV collections for events and todos, always. | RFC 4791 §5.2: a calendar object resource "MUST NOT contain more than one type of calendar component"; `CALDAV:supported-calendar-component-set` advertises which. Apple/Google clients break otherwise (Google's CalDAV "Doesn't support VTODO or VJOURNAL data" at all). |
| D6 | External calendars are **subscriptions**, a different row type from owned calendars, with `writable=false` enforced at the repository layer. | Nextcloud models this as a separate `oc_calendarsubscriptions` table + `calendartype = 1` discriminator on objects; sabre ships `calendarsubscriptions` with `source`, `refreshrate`, `striptodos`, `stripalarms`, `stripattachments`. |
| D7 | Server-side time-range overlap must implement the RFC 4791 §9.9 VEVENT table exactly, and recurring components **MUST** be expanded to answer it. | The RFC is explicit: "the server MUST expand recurring components to determine whether any recurrence instances overlap the specified time range". |
| D8 | Emit a VTIMEZONE for **every distinct TZID referenced** in an exported object. | RFC 5545 §3.6.5: "An individual VTIMEZONE calendar component MUST be specified for each unique TZID parameter value specified in the iCalendar object." Missing VTIMEZONEs are the #1 interop failure with Apple Calendar and Thunderbird. |
| D9 | v1 ships events without iTIP/iMIP scheduling (RFC 6638). ATTENDEE is stored and displayed, not *delivered by e-mail*. | Implicit scheduling is a large subsystem (schedule inbox/outbox, `Schedule-Tag`, `If-Schedule-Tag-Match`, SCHEDULE-AGENT/SCHEDULE-STATUS). Household scope does not need it in v1; storing ATTENDEE preserves round-trip fidelity. |
| D10 | `RANGE=THISANDFUTURE` is **parsed and honoured on import**, but Fem-ho's own edits use the split-the-series algorithm instead. | RFC 5545 itself warns RANGE cannot express many patterns; sabre/vobject documents no THISANDFUTURE support; Google Calendar implements "this and following" by splitting the series (UNTIL on the old master + new master). |

---

## 1. RFC 5545 VEVENT at implementation grade

### 1.1 Component grammar and cardinality

RFC 5545 §3.6.1 defines the VEVENT calendar component. The normative constraints an implementation must enforce:

```
BEGIN:VEVENT
  ; --- REQUIRED, exactly once ---
  DTSTAMP
  UID
  ; DTSTART is REQUIRED if the enclosing VCALENDAR has no METHOD property,
  ; and OPTIONAL otherwise.
  DTSTART

  ; --- OPTIONAL, at most once ---
  CLASS / CREATED / DESCRIPTION / GEO / LAST-MODIFIED / LOCATION /
  ORGANIZER / PRIORITY / SEQUENCE / STATUS / SUMMARY / TRANSP /
  URL / RECURRENCE-ID

  ; --- OPTIONAL, at most once, MUTUALLY EXCLUSIVE ---
  DTEND  |  DURATION      ; "MUST NOT occur in the same 'vevent'"

  ; --- OPTIONAL, may appear more than once ---
  RRULE      ; SHOULD NOT occur more than once (see §1.1.1)
  ATTACH / ATTENDEE / CATEGORIES / COMMENT / CONTACT / EXDATE /
  REQUEST-STATUS / RELATED-TO / RESOURCES / RDATE / X-prop / IANA-prop

  ; --- OPTIONAL sub-components ---
  BEGIN:VALARM ... END:VALARM     ; zero or more
END:VEVENT
```

Additional normative rules that bite in practice:

- **RRULE cardinality.** RFC 5545 permits `RRULE` more than once in the ABNF but states it SHOULD NOT occur more than once. Every mainstream implementation (Google `recurrence[]` notwithstanding, sabre/vobject, dateutil, rrule.js) handles exactly one. **Fem-ho: accept one RRULE; on import, keep the first and preserve the rest in `ical_raw` only.**
- **`RECURRENCE-ID` presence is the master/override discriminator.** RFC 5545 §3.8.4.4: when absent, the component is the master of the recurrence set; when present, it identifies one instance and the value is *"the original value of the DTSTART property of the recurrence instance"* — it does **not** change when the instance is moved.
- **`RECURRENCE-ID` value type MUST match the master's `DTSTART` value type** (DATE vs DATE-TIME). Violating this is the classic all-day-recurring-event corruption bug.

### 1.2 DTSTART / DTEND / DURATION — the three legal shapes

There are exactly three legal time shapes for a VEVENT, and one degenerate fourth:

| Shape | Properties present | Effective end | Notes |
|---|---|---|---|
| A. Explicit end | `DTSTART` + `DTEND` | `DTEND` (exclusive) | `DTEND` value type MUST match `DTSTART`. `DTEND` MUST be > `DTSTART` (equal is only meaningful for zero-length; see D below). |
| B. Duration | `DTSTART` + `DURATION` | `DTSTART + DURATION` | Preferred for recurring events across DST boundaries: a `PT1H` meeting stays 1 hour, whereas an absolute DTEND would drift. |
| C. Point / all-day-implicit | `DTSTART` only | If `DTSTART` is DATE-TIME → zero-length "point" event. If `DTSTART` is DATE → the whole day (`DTSTART + P1D`). | The two sub-cases behave differently in the RFC 4791 §9.9 overlap table (below). |
| D. Degenerate | `DTSTART` + `DURATION` where duration ≤ 0 | treated as a point | RFC 4791 §9.9 gives this its own row. |

**Normalisation rule for Fem-ho.** Store both a canonical UTC `starts_at`/`ends_at` pair (for indexing) *and* the authoring form (`end_kind = 'dtend' | 'duration' | 'implicit'`, plus `duration_iso`). Re-emit in the authoring form on export; never silently rewrite DURATION into DTEND, because that changes DST semantics for recurring events.

### 1.3 The four time-value kinds — get this wrong once and everything is wrong

RFC 5545 §3.3.5 gives DATE-TIME three forms; combined with DATE that is four kinds a VEVENT time can take:

| Kind | Wire form | Meaning | Fem-ho storage |
|---|---|---|---|
| **1. DATE (all-day)** | `DTSTART;VALUE=DATE:20260814` | A calendar day with no clock time. If DTSTART is a DATE, **all** other date/time properties in that component MUST be DATE too. | `all_day = true`, `start_date DATE`, `end_date DATE` (exclusive). Do **not** store as midnight UTC. |
| **2. Floating (local, no TZID)** | `DTSTART:20260814T190000` | "7pm wherever the viewer is". Survives relocation. Rare but legal; birthdays, "wake up at 7". | `tzid IS NULL AND all_day = false` → floating. Resolve to UTC *at query time* using the querying calendar's timezone. |
| **3. Zoned** | `DTSTART;TZID=Europe/Madrid:20260814T190000` | 7pm Madrid, absolute point in time, DST-aware. **This is the normal case.** | `tzid = 'Europe/Madrid'` + `local_start TIMESTAMP` + derived `starts_at TIMESTAMPTZ`. |
| **4. UTC** | `DTSTART:20260814T170000Z` | Absolute, no display zone. | `tzid = 'UTC'`. |

Three traps:

1. **The exclusive-end trap for all-day.** An all-day event on 14 August 2026 is `DTSTART;VALUE=DATE:20260814` / `DTEND;VALUE=DATE:20260815`. FullCalendar has exactly the same convention — its docs state an event with `end` of `2018-09-03` "will appear to span through 2018-09-02 but end before the start of 2018-09-03". So the web layer is consistent with iCalendar *if* you never convert. Humans, however, say "14–15 August" meaning inclusive, so the **UI must display `DTEND − 1 day`** for multi-day all-day events. Get this wrong and every imported all-day event grows a phantom day.
2. **Storing zoned times as UTC only.** If you keep only `starts_at TIMESTAMPTZ` and lose the TZID, then when tzdata changes (or the user edits a future recurring instance), the wall-clock time silently shifts. Always keep `tzid` + the local wall-clock value; derive UTC.
3. **DST-crossing recurrences.** With `RRULE:FREQ=WEEKLY` and `DTSTART;TZID=Europe/Madrid:...T190000`, every occurrence is 19:00 *Madrid* — the UTC instant changes twice a year. Expansion must happen in the TZID's local calendar, then be converted, never the reverse.

### 1.4 STATUS — and why VEVENT's enum is not VTODO's

This is the single most commonly-faked field when someone models events as tasks:

| Component | Allowed STATUS values (RFC 5545 §3.8.1.11) |
|---|---|
| **VEVENT** | `TENTATIVE`, `CONFIRMED`, `CANCELLED` |
| **VTODO** | `NEEDS-ACTION`, `COMPLETED`, `IN-PROCESS`, `CANCELLED` |
| **VJOURNAL** | `DRAFT`, `FINAL`, `CANCELLED` |

Only `CANCELLED` is shared. A "task with a start and end" therefore cannot express `TENTATIVE`, and an event cannot express `IN-PROCESS` — meaning the Fem-ho kanban's `Inbox / Per fer / Fent / Fet` columns are **structurally inapplicable to events**. Do not put events on the kanban board. (Google Calendar mirrors the VEVENT enum exactly: `status` ∈ `"confirmed" | "tentative" | "cancelled"`.)

`STATUS:CANCELLED` on an *override* is also the wire representation of a **deleted single occurrence** in iTIP flows; see §2.4.

### 1.5 TRANSP, CLASS, PRIORITY, SEQUENCE

- **`TRANSP`** ∈ `OPAQUE` (default; consumes busy time) | `TRANSPARENT` (does not). This is the free/busy switch and has no VTODO analogue. Google calls it `transparency: "opaque" | "transparent"`; JSCalendar (RFC 8984) calls it `freeBusyStatus: "free" | "busy"` with default `"busy"`; EventKit calls it `EKEvent.availability`. Needed for "find a free slot" and for a household "who's actually free on Saturday" view.
- **`CLASS`** ∈ `PUBLIC` (default) | `PRIVATE` | `CONFIDENTIAL`. Maps to Google `visibility: "default" | "public" | "private" | "confidential"` and JSCalendar `privacy: "public" | "private" | "secret"`. For Fem-ho this is the per-event privacy control inside a **collective àmbit**: a `PRIVATE` event in `#Família` shows as a busy block without title to other members. This is a genuinely useful household feature and cheap to implement (filter SUMMARY/DESCRIPTION/LOCATION/ATTENDEE at serialisation).
- **`PRIORITY`** 0–9 (0 = undefined, 1 = highest). Legal on VEVENT but almost never used by event UIs. Store, don't surface.
- **`SEQUENCE`** integer, default 0. Bumped by the *organiser* on each significant change (time, location, cancellation). Required for iTIP conflict resolution. Bump it on time/location/status changes even in v1, because external clients use it.

### 1.6 ORGANIZER / ATTENDEE / PARTSTAT, and where RFC 6638 begins

`ORGANIZER` is a `CAL-ADDRESS` (a `mailto:` URI in practice) with optional `CN`, `DIR`, `SENT-BY` params. `ATTENDEE` is a `CAL-ADDRESS` with these parameters:

- `CUTYPE` ∈ `INDIVIDUAL` (default) | `GROUP` | `RESOURCE` | `ROOM` | `UNKNOWN`
- `ROLE` ∈ `CHAIR` | `REQ-PARTICIPANT` (default) | `OPT-PARTICIPANT` | `NON-PARTICIPANT`
- `RSVP` ∈ `TRUE` | `FALSE` (default)
- `PARTSTAT` — **enum differs per component**:
  - VEVENT: `NEEDS-ACTION` (default), `ACCEPTED`, `DECLINED`, `TENTATIVE`, `DELEGATED`
  - VTODO: the above **plus** `COMPLETED`, `IN-PROCESS`
  - VJOURNAL: `NEEDS-ACTION`, `ACCEPTED`, `DECLINED`
- `DELEGATED-TO`, `DELEGATED-FROM`, `MEMBER`, `CN`, `DIR`, `SENT-BY`, `LANGUAGE`

Google's mapping: `attendees[].responseStatus` ∈ `"needsAction" | "declined" | "tentative" | "accepted"` — note Google has **no** `delegated`, which is why delegation round-trips badly through Google.

**RFC 6638 (CalDAV Scheduling) is the layer above this** and Fem-ho should *not* implement it in v1. What it adds: `CALDAV:schedule-inbox-URL` / `CALDAV:schedule-outbox-URL` / `CALDAV:calendar-user-address-set` principal properties; the `Schedule-Tag` response header and `If-Schedule-Tag-Match` request header (so a client's PUT is not clobbered by an incoming attendee REPLY); `CALDAV:schedule-calendar-transp`; **implicit scheduling** (the server automatically generates and delivers iTIP `REQUEST` / `CANCEL` / `REPLY` messages when an ORGANIZER saves an event with ATTENDEEs); and the parameters `SCHEDULE-AGENT` ∈ `SERVER` (default) | `CLIENT` | `NONE` and `SCHEDULE-STATUS` (codes `1.0` pending, `1.1` sent, `1.2` delivered, `3.7` unrecognised user, `3.8` insufficient privileges, `5.1` temporary failure, `5.2` permanent failure, `5.3` not allowed).

**v1 posture for Fem-ho:** store ORGANIZER/ATTENDEE faithfully, render the attendee chips and PARTSTAT in the UI, let *internal* users set their own PARTSTAT through the REST API (an in-app RSVP), and set `SCHEDULE-AGENT=CLIENT` on ATTENDEEs Fem-ho writes so that a CalDAV client which *does* implement scheduling knows the server will not send invites. Do not send e-mail. Advertising `calendar-auto-schedule` in the DAV header while not implementing it is worse than not advertising it.

### 1.7 VALARM on events

VALARM is a sub-component, identical in grammar between VEVENT and VTODO, but the anchor differs.

```
BEGIN:VALARM
 ACTION:DISPLAY            ; AUDIO | DISPLAY | EMAIL
 TRIGGER;RELATED=START:-PT15M
 DESCRIPTION:Recollir els nens
END:VALARM
```

Required properties per ACTION:

| ACTION | REQUIRED | OPTIONAL |
|---|---|---|
| `AUDIO` | `ACTION`, `TRIGGER` | `ATTACH` (the sound, at most one), `DURATION`+`REPEAT` |
| `DISPLAY` | `ACTION`, `DESCRIPTION`, `TRIGGER` | `DURATION`+`REPEAT` |
| `EMAIL` | `ACTION`, `DESCRIPTION`, `TRIGGER`, `SUMMARY`, one or more `ATTENDEE` | `ATTACH` (one or more), `DURATION`+`REPEAT` |

TRIGGER rules:
- Relative (default value type DURATION): `TRIGGER:-PT15M` = 15 minutes before. `RELATED=START` (implicit default) or `RELATED=END` (must be written explicitly).
- Absolute: `TRIGGER;VALUE=DATE-TIME:20260814T170000Z` — **MUST be UTC**.
- `RELATED=END` on a VEVENT requires the event to have `DTEND`, or `DTSTART`+`DURATION`. On a VTODO it requires `DUE`, or `DTSTART`+`DURATION`. Enforce on write; reject otherwise.
- `DURATION` and `REPEAT` must both be present or both absent: "If one of these two properties is absent, then the alarm will not repeat beyond the initial trigger."

**Alarms on recurring events fire per occurrence.** sabre/dav's `CalendarQueryValidator` handles this by expanding the recurrence with `VObject\Recur\EventIterator` and evaluating each expanded occurrence's `getEffectiveTriggerTime()` — i.e. a VALARM time-range filter cannot be answered without recurrence expansion. Fem-ho's notification scheduler needs the same: materialised occurrences (D4) make this trivial, since the next-alarm query becomes an index scan over `event_occurrences JOIN event_alarms`.

Google's model is intentionally simpler: `reminders: { useDefault: bool, overrides: [{ method: "email"|"popup", minutes: 0..40320 }] }` — relative-minutes only, max 4 weeks. Fem-ho should store the full VALARM for round-trip but expose only the relative-minutes form in the REST/MCP surface (v1), with an escape hatch field for the raw component.

### 1.8 VTIMEZONE — the exact emission rules

RFC 5545 §3.6.5. Structure:

```
BEGIN:VTIMEZONE
 TZID:Europe/Madrid            ; REQUIRED, exactly once
 LAST-MODIFIED:20250101T000000Z ; OPTIONAL
 TZURL:http://tzurl.org/zoneinfo/Europe/Madrid  ; OPTIONAL
 BEGIN:STANDARD                ; at least one STANDARD or DAYLIGHT required
  DTSTART:19701025T030000      ; MUST be local time, NO TZID, NO "Z"
  TZOFFSETFROM:+0200           ; REQUIRED
  TZOFFSETTO:+0100             ; REQUIRED
  TZNAME:CET                   ; OPTIONAL
  RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU   ; OPTIONAL
 END:STANDARD
 BEGIN:DAYLIGHT
  DTSTART:19700329T020000
  TZOFFSETFROM:+0100
  TZOFFSETTO:+0200
  TZNAME:CEST
  RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU
 END:DAYLIGHT
END:VTIMEZONE
```

Hard rules:

1. **"An individual VTIMEZONE calendar component MUST be specified for each unique TZID parameter value specified in the iCalendar object."** Scan every `DTSTART`, `DTEND`, `RECURRENCE-ID`, `EXDATE`, `RDATE`, `DUE` (and absolute `TRIGGER` is UTC so exempt) in every component you are about to serialise; emit exactly one VTIMEZONE per distinct TZID; do not emit unreferenced ones.
2. **`DTSTART` inside STANDARD/DAYLIGHT MUST be a local time value** — no `TZID` param, no trailing `Z`. Emitting `Z` here is a classic bug that makes Apple Calendar silently drop the zone.
3. `RRULE` inside an observance, if it has an end, must use `UNTIL` in **UTC**.
4. `TZOFFSETFROM` is the offset in effect *immediately before* the onset; `TZOFFSETTO` the offset *after*.
5. CalDAV adds `CALDAV:calendar-timezone`, a WebDAV property on a calendar collection holding "an iCalendar object with exactly one VTIMEZONE component" — the zone the server uses to resolve DATE values and floating times when evaluating `CALDAV:time-range`. **Fem-ho must set this per calendar collection** (default: the àmbit owner's timezone, fallback `Europe/Madrid`).
6. RFC 4791 §5.2: "Support for VTIMEZONE components in calendar object resources that contain VEVENT or VTODO components is always assumed" — i.e. you never need to advertise it, you just have to be correct.

**Implementation note.** Do not hand-write VTIMEZONE. Generate from the IANA tz database. DAVx⁵'s documentation is explicit that its generated VTIMEZONE components come from the **ical4j** library and its bundled definitions, and that events in zones Android does not know can fail to expand. Node side: generate from a tzdata-backed generator and cache one blob per TZID; regenerate on tzdata upgrade. Truncate observances to a sane window (e.g. from 1970, RRULE-based for the future) — full historical VTIMEZONE bodies are enormous and no client needs them.

### 1.9 RFC 7986 properties you actually need

RFC 7986 extends iCalendar with properties usable at VCALENDAR level and (for some) at component level:

| Property | Value type | Cardinality | Where | Fem-ho use |
|---|---|---|---|---|
| `NAME` | TEXT | multiple (per LANGUAGE) | VCALENDAR | Collection display name on export |
| `DESCRIPTION` | TEXT | multiple | VCALENDAR | Collection description |
| `UID` | TEXT | once | VCALENDAR | Stable id of a published feed |
| `LAST-MODIFIED` | DATE-TIME | once | VCALENDAR | Feed freshness |
| `URL` | URI | once | VCALENDAR | Canonical location |
| `CATEGORIES` | TEXT | multiple | VCALENDAR (extension of §3.8.1.2) | — |
| `REFRESH-INTERVAL` | DURATION | once | VCALENDAR | **Read on ingest**: suggested minimum polling interval. Example line: `REFRESH-INTERVAL;VALUE=DURATION:P1W` |
| `SOURCE` | URI | once | VCALENDAR | **Read and write**: "a location where a client can retrieve updated data for the calendar". Example: `SOURCE;VALUE=URI:https://example.com/holidays.ics` |
| `COLOR` | TEXT (CSS3 name) | once | VCALENDAR, VEVENT, VTODO, VJOURNAL | Maps to Plou's 4 accents at calendar level |
| `IMAGE` | URI or BINARY | multiple | VCALENDAR + components | Defer |
| `CONFERENCE` | URI | multiple | VEVENT, VTODO | v1.5: the "join the call" link, with `FEATURE=` and `LABEL=` params |

ABNF as published:

```
source      = "SOURCE" sourceparam ":" uri CRLF
sourceparam = *(";" other-param)

refresh      = "REFRESH-INTERVAL" refreshparam ":" dur-value CRLF
refreshparam = *((";" "VALUE" "=" "DURATION") / (";" other-param))
```

`X-PUBLISHED-TTL` is the pre-RFC-7986 de-facto equivalent of `REFRESH-INTERVAL` (Microsoft-originated). Nextcloud reads **both** — see §3.3. Fem-ho must too.

### 1.10 VEVENT vs VTODO — the difference table to paste into dossier 03

| Aspect | VEVENT | VTODO |
|---|---|---|
| Time anchor | `DTSTART` (REQUIRED absent METHOD) | `DTSTART` optional; `DUE` optional; *both* may be absent |
| End | `DTEND` xor `DURATION` | `DUE` xor `DURATION` |
| Duration semantics | Occupies a span on the grid | A deadline, not a span |
| STATUS enum | `TENTATIVE`/`CONFIRMED`/`CANCELLED` | `NEEDS-ACTION`/`COMPLETED`/`IN-PROCESS`/`CANCELLED` |
| Completion | none | `COMPLETED` (DATE-TIME, UTC), `PERCENT-COMPLETE` (0–100) |
| Free/busy | `TRANSP` | none |
| PARTSTAT extra values | — | `COMPLETED`, `IN-PROCESS` |
| Priority | 0–9 (rarely used) | 0–9 (central) |
| Time-range algebra (RFC 4791 §9.9) | 5 cases | 8+ cases incl. `COMPLETED`/`CREATED` fallbacks; a VTODO with no dates matches **TRUE** always |
| VALARM `RELATED=END` anchor | `DTEND` or `DTSTART+DURATION` | `DUE` or `DTSTART+DURATION` |
| Collection | must be its own collection | must be its own collection |
| Google CalDAV support | yes | **no** — "Doesn't support VTODO or VJOURNAL data" |
| Android system provider | `CalendarContract` (built-in) | none; third-party providers (OpenTasks, tasks.org, jtx) |
| Apple EventKit class | `EKEvent` | `EKReminder` |

---

## 2. Recurrence, done properly

### 2.1 RRULE

RFC 5545 §3.3.10. Rule parts: `FREQ` (required, non-repeating) ∈ `SECONDLY|MINUTELY|HOURLY|DAILY|WEEKLY|MONTHLY|YEARLY`; `UNTIL`; `COUNT`; `INTERVAL` (default 1); the BY-parts `BYSECOND`, `BYMINUTE`, `BYHOUR`, `BYDAY`, `BYMONTHDAY`, `BYYEARDAY`, `BYWEEKNO`, `BYMONTH`; `BYSETPOS`; `WKST` (default `MO`).

Normative constraints to enforce on write:

1. **`UNTIL` and `COUNT` MUST NOT occur in the same recur value.**
2. **`UNTIL` value type must match `DTSTART`.** If `DTSTART` is a local (floating) time, `UNTIL` must be local. If `DTSTART` is UTC **or has a TZID**, "then the UNTIL rule part MUST be specified as a date with UTC time". This is the rule everyone breaks: `DTSTART;TZID=Europe/Madrid:20260101T090000` + `RRULE:...;UNTIL=20261231T090000` (no `Z`) is invalid and different libraries disagree about it.
3. **`DTSTART` always counts as the first occurrence** — even if it does not match the BY-parts. (Google normalises this; strict RFC readers do not. Accept both on import, always emit a DTSTART-conformant rule.)
4. **Invalid generated dates MUST be ignored and MUST NOT be counted** (e.g. `BYMONTHDAY=31` in February).
5. `BYSETPOS` may only appear with another BY-part.
6. Guard against unbounded rules. Radicale detects "infinite" recurrence by the absence of both `UNTIL` and `COUNT` and short-circuits via an `infinity_fn` callback rather than iterating. sabre/vobject documents the hazard bluntly: a 50-year range on a daily rule "would result in over 18K objects". **Fem-ho: hard cap expansion at `MAX_INSTANCES = 2000` per request and `MAX_HORIZON = 5 years` beyond the requested window.**

Libraries seen in the wild: Python `dateutil.rrule`/`rruleset` (Radicale, via vobject); PHP `Sabre\VObject\Recur\RRuleIterator` + `EventIterator` (sabre/dav, Nextcloud); Java/Kotlin `ical4j` (DAVx⁵/ical4android); JS `rrule.js` and `ical.js` (Mozilla).

### 2.2 RDATE and EXDATE

- **`RDATE`** adds explicit dates to the recurrence set. Value type may be `DATE-TIME` (default), `DATE`, or `PERIOD` (`19970308T160000Z/PT3H` or `.../19970308T180000Z`). The PERIOD form gives an occurrence a *different duration* from the master — most implementations ignore it. **Fem-ho: parse PERIOD on import, convert to an override row (see 2.3), never emit it.**
- **`EXDATE`** removes dates from the set. Its values must match the *recurrence-set* values — that is, the value the instance's `DTSTART` **would** have had, in the master's value type and zone. An `EXDATE` that does not exactly match a generated instance is a no-op, which is why sloppy EXDATE handling produces "the deleted occurrence came back".
- `EXRULE` was **removed in RFC 5545** (it existed in RFC 2445). Android's provider still exposes an `EXRULE` column for legacy reasons. Parse it if seen; never emit it.
- Both may appear multiple times and each may carry multiple comma-separated values, each with its own `TZID` param. Normalise on import to a single canonical list.

DAVx⁵ publishes an FAQ page specifically about recurring events and exception dates because this is where client interop most often fails.

### 2.3 The master-plus-override model

The wire model: **one calendar object resource (one `.ics` file, one URL, one UID) contains the master VEVENT plus zero or more override VEVENTs**, all sharing the same `UID`, distinguished by `RECURRENCE-ID`.

```ics
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Fem-ho//ca//EN
BEGIN:VTIMEZONE
TZID:Europe/Madrid
...
END:VTIMEZONE

BEGIN:VEVENT                       ; ---- MASTER ----
UID:9f1c...@fem-ho
DTSTAMP:20260805T101500Z
DTSTART;TZID=Europe/Madrid:20260907T170000
DTEND;TZID=Europe/Madrid:20260907T180000
RRULE:FREQ=WEEKLY;BYDAY=MO
EXDATE;TZID=Europe/Madrid:20261012T170000
SUMMARY:Extraescolar de natació
SEQUENCE:0
END:VEVENT

BEGIN:VEVENT                       ; ---- OVERRIDE: moved instance ----
UID:9f1c...@fem-ho                 ; SAME UID
RECURRENCE-ID;TZID=Europe/Madrid:20260921T170000   ; ORIGINAL start
DTSTAMP:20260805T101500Z
DTSTART;TZID=Europe/Madrid:20260921T190000         ; NEW start
DTEND;TZID=Europe/Madrid:20260921T200000
SUMMARY:Extraescolar de natació (canvi d'hora)
SEQUENCE:1
END:VEVENT

BEGIN:VEVENT                       ; ---- OVERRIDE: cancelled instance ----
UID:9f1c...@fem-ho
RECURRENCE-ID;TZID=Europe/Madrid:20260928T170000
DTSTAMP:20260805T101500Z
DTSTART;TZID=Europe/Madrid:20260928T170000
STATUS:CANCELLED
SEQUENCE:1
END:VEVENT
END:VCALENDAR
```

Rules:

- The override's `RECURRENCE-ID` = the **original** DTSTART of that instance, unchanged even after the instance moves.
- An override **replaces** the computed instance entirely (it is a full component, not a patch — unlike JSCalendar, see below).
- `EXDATE` and a `STATUS:CANCELLED` override are two different ways to delete an occurrence. `EXDATE` is cleaner (the instance simply does not exist); `STATUS:CANCELLED` is what iTIP uses so attendees learn about the cancellation. **Fem-ho: use EXDATE for user deletions in owned calendars; honour both on import.**
- **Orphan overrides.** An override can legally exist with no master in the same resource (e.g. after a client fetched a time-range slice). sabre/vobject has a long-standing issue where "expanding calendars removes events that have no master event". Fem-ho must tolerate orphan overrides on import: create a standalone non-recurring event row.

**`RANGE=THISANDFUTURE`.** RFC 5545 §3.8.4.4 defines exactly one legal value for the `RANGE` parameter: `THISANDFUTURE`, meaning the override applies to "the given recurrence instance and all subsequent instances". Semantics: if the instance is rescheduled, all subsequent instances shift by the same delta; a duration change propagates forward; subsequent instances are identified by their RECURRENCE-ID value, not their current scheduled time. The RFC itself warns that RANGE cannot express e.g. "reschedule only future Mondays in a Mon/Wed series". sabre/vobject's documented feature set does **not** include THISANDFUTURE.

**Fem-ho decision (D10):** parse `RANGE=THISANDFUTURE` on import and materialise it eagerly (apply the delta to every subsequent computed instance at import time, producing concrete override rows), but implement Fem-ho's own "aquest i els següents" edit by **splitting the series**:

```
1. old master: append/replace RRULE ...;UNTIL=<recurrence_id − 1s (UTC)>
   drop RRULE COUNT if present, recompute
2. new master: new UID, DTSTART = the edited instance's new start,
   RRULE = old rule minus UNTIL/COUNT adjustments, carrying forward
   EXDATE/RDATE that fall after the split point
3. move any existing overrides with recurrence_id >= split point to the new UID
4. link them with RELATED-TO;RELTYPE=SIBLING (optional, for UI grouping)
```

This is what Google Calendar does ("this and following events" produces a second recurring event), and it is unambiguous across every client.

### 2.4 Deleting: the four cases

| User action | Owned calendar wire result | Notes |
|---|---|---|
| Delete a non-recurring event | `DELETE` the resource | Emit a tombstone into the change log for sync |
| Delete **this occurrence** | add `EXDATE` to master (drop any override row for that recurrence-id) | If the event has ATTENDEEs and you later add iTIP, switch to `STATUS:CANCELLED` override |
| Delete **this and following** | set `RRULE;UNTIL` on the master to just before this occurrence; delete overrides ≥ that point | |
| Delete **the whole series** | `DELETE` the resource (master + all overrides go together) | |

Google's `events.list` with `showDeleted=true` surfaces deleted instances as separate items with `status: "cancelled"` and a `recurringEventId` — the same shape Fem-ho should return from its delta-sync endpoint.

### 2.5 The three implementable strategies

#### Strategy A — Expand on read (no instance storage)

Store only the master component (+ overrides). Every query expands.

```sql
-- storage: only these
CREATE TABLE events (
  id            uuid PRIMARY KEY,
  calendar_id   uuid NOT NULL,
  uid           text NOT NULL,
  recurrence_id timestamptz NULL,     -- NULL = master
  dtstart_utc   timestamptz NOT NULL,
  rrule         text NULL,
  rdate         text[] NULL,
  exdate        text[] NULL,
  ical_raw      text NOT NULL
);
```

- **Who does this:** **Radicale** (files on disk, `radicale/item/filter.py`); **Xandikos** (each object is a blob in a Git repo).
  - Radicale's implementation: `time_range_match(vobject_item, filter_, child_name, trigger)` delegates to `visit_time_ranges(vobject_item, child_name, range_fn, infinity_fn)`, which walks all temporal occurrences and applies callbacks. Recurrence comes from vobject's `child.getrruleset(addRDate=True)`; instances whose `RECURRENCE-ID` appears in a collected `recurrences` list are filtered out so overrides replace computed instances; `date_to_datetime` normalises everything to tz-aware UTC and patches a missing tzinfo on `dtend` from `dtstart`. Bounds come from `DATETIME_MIN`/`DATETIME_MAX` when the filter omits `start`/`end`. There is **no hard instance cap** in the filter code — expansion stops when `infinity_fn` or `range_fn` returns True. Operators have had to mitigate `FREQ=DAILY;COUNT=3650` blow-ups with a `max_instances` storage setting.
- **Pros:** trivially correct, no invalidation, no migration, storage = source of truth.
- **Cons:** O(all objects in collection) per month view. Radicale users report exactly this pain.
- **Verdict for Fem-ho:** correct, too slow for a month grid across N àmbits + M subscriptions.

#### Strategy B — Materialise instances (expanded table)

Every occurrence gets a row.

```sql
CREATE TABLE event_occurrences (
  event_id      uuid NOT NULL,        -- FK to the master row
  occurrence_id timestamptz NOT NULL, -- == RECURRENCE-ID value in UTC
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz NOT NULL,
  is_override   boolean NOT NULL,
  override_id   uuid NULL,
  PRIMARY KEY (event_id, occurrence_id)
);
```

- **Who does this:** **Android's Calendar Provider.** `CalendarContract.Instances` is a read-only table whose rows are generated from `CalendarContract.Events`: "An instance is a single occurrence of an event including time zone specific start and end days and minutes"; "For one-time events there will be a 1:1 mapping of instances to events. For recurring events, multiple rows will automatically be generated." Key columns: `EVENT_ID` (FK to `Events._ID`), `BEGIN` and `END` (UTC milliseconds), `START_DAY`/`END_DAY` (Julian day, local tz), `START_MINUTE`/`END_MINUTE` (minutes from local midnight). Crucially: "Unlike most ContentProvider queries, the Instances table requires a time range" — the provider will not expand infinite recurrences without bounds. Query URIs: `CONTENT_URI` (append begin/end ms), `CONTENT_BY_DAY_URI` (Julian days), `CONTENT_SEARCH_URI`.
- **Pros:** month/week/day queries are a single indexed range scan; alarm scheduling is a join; conflict/free-busy detection is a range overlap query.
- **Cons:** must be invalidated and regenerated on every master edit, tzdata change, or horizon roll-forward. Infinite rules force a horizon.
- **Verdict for Fem-ho:** the right *query* structure, wrong as the sole storage.

#### Strategy C — Hybrid: index bounds + materialised window (**recommended**)

Three layers:

1. **Component rows** (`events`) are the source of truth, plus per-resource `ical_raw`.
2. **Bound columns** on each master: `first_occurrence_utc`, `last_occurrence_utc` (NULL = infinite). This is exactly what sabre/dav does: `calendarobjects.firstoccurence` and `calendarobjects.lastoccurence`, with `INDEX calendarid_time (calendarid, firstoccurence)`. A time-range query first prunes with `first_occurrence <= :end AND (last_occurrence IS NULL OR last_occurrence >= :start)`, then expands only the survivors.
3. **Materialised occurrences** (`event_occurrences`) covering a rolling window `[today − 1 year, today + 2 years]`, refreshed by a nightly job and on every write. Queries inside the window hit the table; queries outside fall back to on-the-fly expansion of the pruned shortlist (layer 2).

This is the combination that makes both the month grid and the CalDAV `time-range` filter fast while keeping correctness for a 2099 query.

### 2.6 What CalDAV forces you to do server-side

**`CALDAV:time-range` (RFC 4791 §9.9).** Attributes `start` and `end`, both "date with UTC time"; at least one required; missing `start` = −∞, missing `end` = +∞. The normative sentence: *"the server MUST expand recurring components to determine whether any recurrence instances overlap the specified time range. If one or more recurrence instances overlap the time range, then the calendar object resource matches the filter element."*

The VEVENT overlap table (reproduce this verbatim in code, with tests):

| DTEND | DURATION | DUR > 0 | DTSTART is DATE-TIME | Condition |
|---|---|---|---|---|
| Y | N | — | * | `(start < DTEND) AND (end > DTSTART)` |
| N | Y | Y | * | `(start < DTSTART + DURATION) AND (end > DTSTART)` |
| N | Y | N | * | `(start <= DTSTART) AND (end > DTSTART)` |
| N | N | — | Y | `(start <= DTSTART) AND (end > DTSTART)` |
| N | N | — | N (i.e. VALUE=DATE) | `(start < DTSTART + P1D) AND (end > DTSTART)` |

Note `start` is **inclusive**, `end` **non-inclusive**, and the point/all-day rows use `<=` on the left. Radicale's `visit_time_ranges` implements exactly these five rules.

For contrast, the **VTODO** table in the same section is materially different: e.g. `DTSTART`+`DURATION` → `(start <= DTSTART+DURATION) AND ((end > DTSTART) OR (end >= DTSTART+DURATION))`; `DTSTART`+`DUE` → `((start < DUE) OR (start <= DTSTART)) AND ((end > DTSTART) OR (end >= DUE))`; and a VTODO with none of `DTSTART`/`DUE`/`DURATION`/`COMPLETED`/`CREATED` matches **TRUE** — it always overlaps. You cannot share one function between the two component types.

**`CALDAV:expand` (RFC 4791 §9.6.5).** Element `expand` in namespace `urn:ietf:params:xml:ns:caldav`, a child of `CALDAV:calendar-data`, with `start` and `end` attributes (UTC date-times, `end` MUST be greater than `start`). When present the server MUST return "only the recurrence instances that overlap a specified time range as separate calendar components that each define exactly one recurrence instance" — i.e. the master's `RRULE`/`RDATE`/`EXDATE` are stripped, each returned component carries a `RECURRENCE-ID`, and floating times are converted to UTC using the calendar's timezone context.

Example request:

```xml
<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <D:getetag/>
    <C:calendar-data>
      <C:expand start="20260901T000000Z" end="20261001T000000Z"/>
    </C:calendar-data>
  </D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VEVENT">
        <C:time-range start="20260901T000000Z" end="20261001T000000Z"/>
      </C:comp-filter>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>
```

Also in §9.6: `CALDAV:limit-recurrence-set` (return the master plus only overrides in range, *without* expanding), and `CALDAV:limit-freebusy-set`. `CALDAV:expand` and `limit-recurrence-set` MUST NOT both appear.

**Interop reality:** many servers implement `time-range` but not `expand`. The python-caldav library carries long-running issues about servers that "may not expand recurring events into multiple objects during date searches" and about doing client-side rrule parsing as a fallback for broken servers. Radicale gained expand support relatively late (a v3.5 changelog entry records "report with enabled expand honors now provided filter proper"), and had a bug where expanded single-occurrence VEVENTs retained recurrence properties such as `RDATE` because a chain of `delattr()` calls aborted on the first missing property (e.g. `EXDATE`). **Lesson for Fem-ho: when expanding, strip `RRULE`, `RDATE`, `EXDATE`, `EXRULE` individually and defensively, and add `RECURRENCE-ID` to every emitted component including the first.**

### 2.7 How each implementation actually does it — reference table

| Implementation | Storage unit | Recurrence at rest | Query strategy | Subscriptions |
|---|---|---|---|---|
| **Radicale 3** | one `.ics` file per object on disk; collection props in `.Radicale.props` | master + overrides in the file, untouched | Expand on read via vobject `getrruleset(addRDate=True)`; `visit_time_ranges` + `infinity_fn` guard; no built-in instance cap in filter code | none built in |
| **Xandikos** | one blob per object in a **Git** repository (Dulwich); history = free versioning | as stored | expand on read via the Python `icalendar` library | none built in |
| **sabre/dav** | `calendarobjects.calendardata` MEDIUMBLOB = the whole VCALENDAR | as stored | index columns `firstoccurence`/`lastoccurence` + `componenttype` prune, then `Sabre\VObject\Recur\EventIterator` / `RRuleIterator`; `VCalendar::expand($start,$end)` returns a **new** calendar (v4+ breaking change; pre-v4 mutated in place) with RRULE stripped from the first event and `RECURRENCE-ID` on the rest | first-class `calendarsubscriptions` table |
| **Nextcloud** (on sabre) | `oc_calendarobjects` + `oc_calendarobjects_props` (indexed searchable props) | as stored | sabre's; plus a props table for property search | `oc_calendarsubscriptions` + `calendartype = 1` discriminator on `oc_calendarobjects` (native = 0) |
| **Android Calendar Provider** | `Events` rows; exceptions are **separate Event rows** | `RRULE`/`RDATE`/`EXRULE`/`EXDATE` columns on the master; exception rows carry `ORIGINAL_ID`/`ORIGINAL_SYNC_ID` + `ORIGINAL_INSTANCE_TIME` (+ `ORIGINAL_ALL_DAY`) | **materialised** read-only `Instances` table; queries require a time range | `CalendarContract` has no ICS subscription concept; DAVx⁵ / ICSx⁵ fill it |
| **DAVx⁵ / ical4android** | maps CalDAV objects into `CalendarContract` | inserts exceptions as separate event records with `ORIGINAL_SYNC_ID` = the recurring event's `SYNC_ID` and original time = `RECURRENCE-ID`; explicitly **does not** compute instances itself — "It only provides RRULE, RDATE, EXRULE, EXDATE and a list of exceptions to the Android calendar provider" | delegated to the provider | ICSx⁵ (separate app) for webcal |
| **Google Calendar API v3** | `Event` resource | `recurrence[]` (array of RRULE/EXRULE/RDATE/EXDATE strings) on the master; instances addressed via `recurringEventId` + `originalStartTime` | `events.list?singleEvents=true` expands: "only single one-time events and instances of recurring events, but not the underlying recurring events themselves, are returned"; `orderBy=startTime` **requires** `singleEvents=true` | separate; CalDAV endpoint `.../caldav/v2/{CALENDAR_ID}/events`, supports RFC 6578 sync-collection, "All reports except free-busy-query are implemented", **no VTODO/VJOURNAL** |
| **Morgen API** | unified layer over Google/Microsoft/Apple/CalDAV | `recurrenceRules`; instances have `masterEventId`, `masterBaseEventId`, `recurrenceId` | `GET /v3/events/list` requires `accountId`, `calendarIds`, `start`, `end`; "recurring events are automatically expanded"; interval capped at **6 months** | provider-native |
| **JSCalendar (RFC 8984)** | JSON `Event`/`Task`/`Group` | `recurrenceRules[]`, `excludedRecurrenceRules[]`, and `recurrenceOverrides` = a **map of LocalDateTime → PatchObject** | n/a (data format) | n/a |

**JSCalendar's override model deserves a callout**, because it is the cleanest and Fem-ho's REST API should imitate it even while the CalDAV layer stays RFC 5545-shaped. Instead of a full replacement component, an override is a *patch*: `recurrenceOverrides: { "2026-09-21T17:00:00": { "start": "2026-09-21T19:00:00", "title": "..." } }`, and a deletion is `{ "2026-09-28T17:00:00": { "excluded": true } }`. `recurrenceId` + `recurrenceIdTimeZone` identify an instance when it is serialised standalone.

### 2.8 Edit semantics the UI must offer

Every mature calendar offers three modes. Morgen exposes them literally as a query parameter: `seriesUpdateMode` ∈ `single` | `future` | `all`, on both `POST /v3/events/update` and `POST /v3/events/delete`, and requires either `id` or the pair `masterEventId` + `recurrenceId`.

**Fem-ho REST mirror:** `?series_mode=single|future|all` (NOT `scope=` — "scope" is taken by àmbits in Fem-ho's vocabulary; Catalan UI labels: *Només aquest* / *Aquest i els següents* / *Tota la sèrie*).

| Mode | Implementation |
|---|---|
| `single` | upsert an override row with `recurrence_id = <original start>`; regenerate that occurrence |
| `future` | split the series (§2.3) |
| `all` | edit the master; **preserve** existing overrides unless the edit changes DTSTART, in which case shift every override's `recurrence_id` by the same delta (this is what Google does) |

---

## 3. Read-only external calendars (Fem-ho as a client)

### 3.1 Two very different ingest paths

| | **A. CalDAV collection** | **B. Plain ICS / webcal URL** |
|---|---|---|
| Transport | HTTP + `PROPFIND`/`REPORT` (`calendar-query`, `calendar-multiget`, `sync-collection`) | a single `GET` of one `.ics` file |
| Auth | Basic/Digest/Bearer, per-principal | usually a secret URL, sometimes Basic |
| Incrementality | **yes** — RFC 6578 `sync-collection` + `sync-token`, or `getctag` polling + `getetag` diffing | **no** — you re-download the entire file every time |
| Deletions | explicit: a `DAV:response` with `DAV:status` `404 Not Found` and no `DAV:propstat` | implicit: whatever is missing from the new file is gone |
| Write-back | possible (if ACL allows) | impossible |
| Typical source | family member's Nextcloud, a work Radicale, iCloud | school calendar, football fixtures, `.ics` from a municipality, Google "secret address" |
| Fem-ho v1 | **defer to v1.5** | **v1** |

**Recommendation: ship B in v1, A in v1.5.** Reason: the vast majority of household "source calendars" (escola, esplai, ajuntament, la lliga del petit) are published as a static ICS/webcal URL. CalDAV client mode requires credential storage, principal discovery (`/.well-known/caldav` → `current-user-principal` → `calendar-home-set`), and a full sync-token state machine — real work with limited household payoff.

`webcal://` is not a registered scheme with any transport semantics; it is a click-to-subscribe hint. **Normalise `webcal://` → `https://` on ingest** (and only fall back to `http://` if the user explicitly opts in).

### 3.2 Refresh cadence

Precedence for choosing the poll interval:

1. User-set override on the subscription row.
2. `REFRESH-INTERVAL;VALUE=DURATION:` from the feed (RFC 7986).
3. `X-PUBLISHED-TTL:` from the feed (pre-standard equivalent).
4. Server default.

Also honour transport-level caching: send `If-None-Match` with the stored `ETag` and `If-Modified-Since` with the stored `Last-Modified`; a `304 Not Modified` is a free refresh. Store both headers on the subscription row.

Clamp the effective interval: `MIN = PT15M`, `MAX = P1W`, default `PT6H` (a compromise between Nextcloud's documented behaviours — see UNVERIFIED note). Jitter the schedule so N subscriptions do not stampede.

### 3.3 Nextcloud's `RefreshWebcalService` — the reference implementation

Worth copying almost verbatim. What the PHP service does:

- Fetches via `queryWebcalFeed($subscription)`.
- **Refresh decision is three-tier:** (a) if `REFRESH_RATE` is set on the subscription, compute `$refreshInterval` and compare against now to decide whether to refresh at all; (b) after a successful fetch, `updateRefreshRate()` reads `$vCalendar->{'REFRESH-INTERVAL'}` else `$vCalendar->{'X-PUBLISHED-TTL'}`, validates with `DateTimeParser::parseDuration()`, and stores it **only if no rate is already configured**; (c) the service itself has no hardcoded fallback — the default lives in config (`calendarSubscriptionRefreshRate`, a `DateInterval` string such as `PT6H`).
- Stores each component with `CalDavBackend::createCalendarObject()` / `updateCalendarObject()` using `CalDavBackend::CALENDAR_TYPE_SUBSCRIPTION`. Nextcloud thus reuses `oc_calendarobjects` for both owned and subscribed data, discriminated by `calendartype` (native `0`, subscription `1`). *(That reuse has caused a reported bug: `oc_calendars` and `oc_calendarsubscriptions` both allocate serial integer IDs that collide in `oc_calendarobjects` — see issue nextcloud/server#49635. **Fem-ho: do NOT reuse one id space; use UUIDs, or separate tables.**)*
- **Deletion detection is UID diffing, not tombstones:** it loads existing objects with `getLimitedCalendarObjects(['id','uid','etag','uri'])`, unsets each UID as it is seen in the fresh feed, and then calls `purgeCachedEventsForSubscription($subscriptionId, $ids, $uris)` for whatever remains.
- **Stripping** is per-subscription and configurable: `$stripTodos` skips components whose `name === 'VTODO'`; `$stripAlarms` calls `$component->remove('VALARM')`; `$stripAttachments` calls `$component->remove('ATTACH')`. These are the sabre `calendarsubscriptions` columns `striptodos`, `stripalarms`, `stripattachments`.
- **Limits:** UIDs longer than 512 characters are logged and skipped. No file-size cap and no URL denylist in that file.

**sabre/dav's `calendarsubscriptions` DDL** (the schema Nextcloud inherits) — copy the column set:

```sql
CREATE TABLE calendarsubscriptions (
    id INT(11) UNSIGNED NOT NULL PRIMARY KEY AUTO_INCREMENT,
    uri VARBINARY(200) NOT NULL,
    principaluri VARBINARY(100) NOT NULL,
    source TEXT,
    displayname VARCHAR(100),
    refreshrate VARCHAR(10),
    calendarorder INT(11) UNSIGNED NOT NULL DEFAULT '0',
    calendarcolor VARBINARY(10),
    striptodos TINYINT(1) NULL,
    stripalarms TINYINT(1) NULL,
    stripattachments TINYINT(1) NULL,
    lastmodified INT(11) UNSIGNED,
    UNIQUE(principaluri, uri)
);
```

And the object table whose index columns justify D4/Strategy C:

```sql
CREATE TABLE calendarobjects (
    id INT(11) UNSIGNED NOT NULL PRIMARY KEY AUTO_INCREMENT,
    calendardata MEDIUMBLOB,
    uri VARBINARY(200),
    calendarid INTEGER UNSIGNED NOT NULL,
    lastmodified INT(11) UNSIGNED,
    etag VARBINARY(32),
    size INT(11) UNSIGNED NOT NULL,
    componenttype VARBINARY(8),
    firstoccurence INT(11) UNSIGNED,
    lastoccurence INT(11) UNSIGNED,
    uid VARBINARY(200),
    UNIQUE(calendarid, uri),
    INDEX calendarid_time (calendarid, firstoccurence)
);
```

Note `componenttype` — sabre stores the component kind *per object*, precisely because a collection is single-kind but the code path is shared. And `calendarchanges (uri, synctoken, calendarid, operation)` is the change log that powers RFC 6578 `sync-collection`; `operation` encodes added/modified/deleted.

### 3.4 What to store vs re-fetch

**Store, always.** Do not proxy at render time. Reasons: (1) offline-first Android needs the data locally; (2) the month grid must not depend on a third-party server's latency; (3) conflict detection and free-busy need the data in SQL; (4) Nextcloud's own issue tracker has a request to include subscribed calendars in appointment conflict detection precisely because they were not first-class.

Store: the parsed, normalised event rows (same `events` table, `calendar_id` pointing at a subscription-backed calendar) **plus** the raw component. Do **not** store the whole feed file beyond one refresh cycle; do store its `ETag`, `Last-Modified`, and a `content_hash` so an unchanged feed short-circuits parsing entirely.

**Deletion / tombstone algorithm** (improving on Nextcloud's UID-only diff):

```
key(component) = (UID, RECURRENCE-ID or '')     -- component identity
1. hash the fetched body; if == stored content_hash and ETag unchanged -> done
2. parse; build fresh_keys
3. UPSERT each component (compare a per-component hash to skip no-op writes)
4. DELETE FROM events WHERE calendar_id = :id AND key NOT IN fresh_keys
   -> for each deleted row, append a tombstone to the change log
5. update subscription: last_fetched_at, etag, last_modified, content_hash,
   last_error = NULL, consecutive_failures = 0
```

Failure policy: on fetch error, **do not delete anything**; increment `consecutive_failures`, apply exponential backoff, and surface a stale badge in the UI after 3 failures. The catastrophic bug in this area is "feed returned a 500 with an HTML body → parsed as empty calendar → everything deleted".

### 3.5 Safety: this is an SSRF sink

Fem-ho is self-hosted on a home LAN. A user (or an AI agent with an events:write token) supplying a subscription URL can make the server fetch arbitrary internal addresses. Nextcloud's `RefreshWebcalService` shows no denylist in that file; Fem-ho must add one:

- Allowed schemes after normalisation: `https` (and `http` only with an explicit per-subscription opt-in flag).
- Resolve the hostname and **reject RFC 1918 / loopback / link-local / ULA / metadata (169.254.169.254) addresses** unless an admin setting `ALLOW_PRIVATE_CALENDAR_SOURCES=true` is set (legitimate for a LAN Nextcloud).
- Re-validate after each redirect (max 3 redirects, no cross-scheme downgrade).
- Cap the response body (e.g. 10 MiB) and the parse time; cap components per feed (e.g. 20 000).
- Never echo the fetched body into an error message.
- Store the URL encrypted at rest if it embeds a secret token (Google/iCloud "secret address" feeds do).

### 3.6 Rendering as non-editable

Enforcement must be at three layers, not one:

1. **Repository layer:** `calendars.writable = false` → any write to an event whose `calendar_id` is a subscription raises `CalendarReadOnlyError` → HTTP `403` with `{"code":"calendar_read_only"}`. This is the only layer that actually protects you.
2. **API layer:** the calendar resource carries `"writable": false` and `"kind": "subscription"`; the event resource carries `"editable": false`. MCP tools reject writes with a machine-readable error.
3. **UI layer:** FullCalendar per-event `editable: false` / `startEditable: false` / `durationEditable: false` (all documented Event Object properties); render with a dashed left border and a small "font extern" chip; the detail sheet shows *Obre a l'origen* (the `SOURCE` URL) instead of *Edita*; drag/resize/delete affordances hidden, not just disabled.

Nextcloud's user manual is the precedent for the wording: subscriptions are added via "+ New subscription from link (read-only)", are read-only, and "will be updated regularly".

**One exception worth allowing in v1.5:** let a household member attach a *local overlay* — a Fem-ho task or note linked to an external event by `(uid, recurrence_id)` — so "Reunió de pares (escola)" can carry "@Borja porta el formulari" without mutating the read-only source. Store in a small `event_annotations` table keyed by `(calendar_id, uid, recurrence_id)`, deliberately **not** by `event_id`, so the annotation survives a feed refresh that recreates the row.

---

## 4. Product precedent: how eight products draw the task/event line

### 4.1 The table

| Product | Are events and tasks the same object? | Storage / API shape | Drag a task onto the calendar → |
|---|---|---|---|
| **Vikunja** | **No events at all.** Vikunja is tasks-only. Its CalDAV support is "managing tasks via the caldav VTODO extension"; supported properties are UID, SUMMARY, DESCRIPTION, PRIORITY, CATEGORIES, COMPLETED, DUE, DURATION, DTSTAMP, DTSTART, RELATED-TO, STATUS, VALARM (bidirectional) and CREATED, LAST-MODIFIED, RRULE (server→client). Explicitly unsupported: ATTACH, CLASS, COMMENT, CONTACT, GEO, LOCATION, ORGANIZER, PERCENT-COMPLETE, **RECURRENCE-ID**, RESOURCES, SEQUENCE, URL. URLs: `/dav/principals/<user>/`, `/dav/projects/`, `/dav/projects/<id>/`, `/dav/projects/<id>/<task-uid>`. Auth: password, CalDAV token, or API token with CalDAV permission (v2.3.0+). Documented as "early alpha". | Tasks with `start_date`/`end_date`/`due_date`; the "Gantt" view draws tasks on a time axis. | Sets `start_date`/`end_date` on the **task**. No VEVENT is created. **This is exactly the anti-pattern Fem-ho must avoid** — note that Vikunja's unsupported list includes `RECURRENCE-ID`, i.e. it structurally cannot represent an overridden occurrence. |
| **Nextcloud Calendar + Tasks** | **No — two apps, two component types, two collections.** Calendar handles VEVENT; Tasks handles VTODO; both sit on the same sabre/dav CalDAV stack and the same `oc_calendarobjects` table discriminated by component type. Subscriptions are "+ New subscription from link (read-only)". | sabre schema (§3.3). | Tasks with due dates can be *shown* in the calendar (Tasks app integration), but dropping does not convert a task into an event. |
| **Tasks.org (Android)** | **Tasks only.** Syncs to CalDAV VTODO, Google Tasks, EteSync. | — | n/a — no calendar grid. |
| **jtx Board (Android)** | **Explicitly multi-component**: VJOURNAL + VTODO today, and the project states the intent to add VEVENT — "empower it with the possibilities to link and combine VTodos with VJournals - and in the future also VEvents". A VJOURNAL with a start date is a *journal entry*; without one it is a *note*. Syncs via DAVx⁵ as a sync adapter. | One `ICalObject` table with a `component` discriminator + per-component nullable columns — a hybrid single-table model. | n/a |
| **Google** | **Two products, two APIs.** Calendar API `Event` resource vs Tasks API. Google's own CalDAV endpoint **"Doesn't support VTODO or VJOURNAL data."** Google Tasks items surface *on* the Calendar grid but are not Events. | `Event` fields: `id`, `iCalUID`, `etag`, `status` (`confirmed`/`tentative`/`cancelled`), `start`/`end` as `{date}` xor `{dateTime, timeZone}`, `endTimeUnspecified`, `recurrence[]`, `recurringEventId`, `originalStartTime`, `transparency` (`opaque`/`transparent`), `visibility` (`default`/`public`/`private`/`confidential`), `sequence`, `organizer`, `creator`, `attendees[]` (`email`, `displayName`, `responseStatus` ∈ needsAction/declined/tentative/accepted, `optional`, `resource`, `comment`, `additionalGuests`), `reminders {useDefault, overrides[{method, minutes}]}`, `eventType` ∈ `default`/`birthday`/`focusTime`/`fromGmail`/`outOfOffice`/`workingLocation`, `conferenceData`, `attachments[]` (max 25), `extendedProperties {private, shared}`, `colorId`, `guestsCanModify`/`guestsCanInviteOthers`/`guestsCanSeeOtherGuests`, `htmlLink`, `hangoutLink`, `locked`, `privateCopy`. | Dragging a Google **Task** onto the grid sets the task's due date/time; it stays a Task (rendered with the task icon and a checkbox), never becomes an Event. `eventType: "focusTime"` / `"outOfOffice"` show that Google's answer to "block time" is a *special kind of Event*, not a task. |
| **Apple** | **Enforced at the framework level.** `EKCalendarItem` is the abstract base; `EKEvent` and `EKReminder` are the two concrete subclasses. `EKEvent`-only: `startDate`, `endDate`, `isAllDay`, `availability`, `status`. `EKReminder`-only: `startDateComponents`, `dueDateComponents`, `isCompleted`, `priority`. `EKCalendar.allowedEntityTypes` / `EKEntityType` ∈ `.event`, `.reminder` — **a single calendar cannot hold both**. | — | Apple Calendar has no task drag; Reminders with times appear in Calendar as a distinct "Reminders" row, visually separate from events. |
| **Morgen** | **Both, unified but distinct.** The API has separate `Events` and `Tasks` sections; events live on calendars, tasks come from connected task providers (Todoist etc.). Instances carry `masterEventId`/`recurrenceId`. | `GET /v3/events/list` (`accountId`, `calendarIds`, `start`, `end`; max 6-month window); `POST /v3/events/create` (requires `accountId`, `calendarId`, `title`, `start`, `duration`, `timeZone`, `showWithoutTime`); `POST /v3/events/update` and `/delete` with `seriesUpdateMode` ∈ `single`/`future`/`all`. Event fields include `id`, `uid`, `calendarId`, `accountId`, `integrationId`, `title`, `description`, `descriptionContentType`, `start`, `duration`, `timeZone`, `showWithoutTime`, `privacy`, `freeBusyStatus`, `locations`, `participants`, `alerts`, `recurrenceRules`, `masterEventId`, `masterBaseEventId`, `recurrenceId`. Note the near-identity with JSCalendar (`showWithoutTime`, `freeBusyStatus`, `privacy`, `duration` not `end`). | Dragging a task onto the calendar creates a **time block** — a real calendar event on a chosen calendar — that stays linked back to the source task. |
| **Sunsama / Akiflow / Amie** | Both keep tasks and events as distinct objects on one grid. Marketing material for all three describes drag-and-drop of *tasks* onto the calendar producing calendar **blocks/events**; Sunsama's is described as creating events with recurring/location/calendar-blocking options. | Not publicly documented. | Task → creates a linked event (time block) on a backing Google/Microsoft calendar; the task remains the task. |

### 4.2 The pattern, stated plainly

Every product that has both — Google, Apple, Morgen, Sunsama, Akiflow, Amie, Nextcloud — keeps **two objects** and draws them on **one grid**. Nobody who has both merges them. The products that merged (Vikunja's Gantt, any "task with start+end") simply do not have events at all, and consequently cannot represent overridden occurrences, attendees, free/busy, or read-only external calendars.

The "drag a task onto the calendar" gesture resolves the same way everywhere: it creates or updates a **link** between a task and a time block. Two sub-variants:

- **Weak link (Google Tasks, Nextcloud Tasks-in-Calendar):** the task's own due/start datetime is set and the task is *rendered* on the grid with task chrome (checkbox, different shape). No event object is created.
- **Strong link (Morgen, Sunsama, Akiflow):** a real event is created on a backing calendar and holds a back-reference to the task; completing the task does not delete the event, and moving the event moves the plan not the deadline.

**Fem-ho recommendation:** ship the **weak link in v1** and the **strong link in v1.5**, and make the difference visible in the UI. Concretely:

- v1: a task with `due_at` (or `starts_at`) appears on the calendar grid as a *task chip* — different shape (pill with a checkbox, not a block), rendered through FullCalendar with `display: 'list-item'` for all-day/due-date-only tasks and `display: 'block'` with a distinct class for tasks that have a real start+end. Dragging it changes the **task's** dates. It is never a VEVENT and never appears in the VEVENT CalDAV collection.
- v1.5: "Bloqueja temps" on a task creates a real event with `related_task_id` and `RELATED-TO` in iCalendar, on the àmbit's default calendar. The task keeps its due date; the event carries the plan.

This also settles the kanban question: **events never appear on the Inbox/Per fer/Fent/Fet board**, because VEVENT's STATUS enum has no such states (§1.4). The calendar's "shared Inbox rail" holds *tasks* awaiting scheduling, which is exactly the Sunsama/Akiflow pattern.

---

## 5. Concrete recommendation for Fem-ho

### 5.1 Entity model

```
scope (àmbit)  1 ──── n  calendar
                          ├─ kind: 'events' | 'todos'          (single-component, RFC 4791 §5.2)
                          ├─ origin: 'local' | 'subscription'
                          └─ 1 ── n  event   (only when kind='events')
                                       ├─ recurrence_id NULL  → master
                                       └─ recurrence_id NOT NULL → override (same uid)
                          
event 1 ── n event_attendee
event 1 ── n event_alarm
event 1 ── n event_occurrence   (materialised window)
```

Key invariants:

- `UNIQUE (calendar_id, uid, coalesce(recurrence_id, 'epoch'))` — one master and at most one override per instant per uid per calendar.
- An override row always has a master row with the same `(calendar_id, uid)` **or** is flagged `is_orphan_override = true` (tolerated on import).
- All rows in a calendar with `origin='subscription'` are read-only at the repository layer.
- A project's calendar and an àmbit's general calendar are both just `calendar` rows with a `scope_id` and an optional `project_id`.

### 5.2 Full SQL schema (PostgreSQL)

```sql
-- ============================================================
-- CALENDAR COLLECTIONS
-- ============================================================
CREATE TYPE calendar_kind   AS ENUM ('events', 'todos');
CREATE TYPE calendar_origin AS ENUM ('local', 'subscription');

CREATE TABLE calendars (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_id          uuid NOT NULL REFERENCES scopes(id) ON DELETE CASCADE,
  project_id        uuid NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind              calendar_kind   NOT NULL,
  origin            calendar_origin NOT NULL DEFAULT 'local',

  -- CalDAV collection identity
  caldav_uri        text NOT NULL,          -- last path segment, URL-safe, immutable
  display_name      text NOT NULL,
  description       text NULL,
  color             text NULL,              -- CSS3 name or #rrggbb (RFC 7986 COLOR)
  sort_order        integer NOT NULL DEFAULT 0,

  -- RFC 4791 §5.2
  supported_components text[] NOT NULL,     -- ['VEVENT'] or ['VTODO']
  calendar_timezone    text NOT NULL DEFAULT 'Europe/Madrid',  -- CALDAV:calendar-timezone TZID
  transparent          boolean NOT NULL DEFAULT false,         -- schedule-calendar-transp

  -- sync bookkeeping (RFC 6578 + caldav-ctag)
  sync_token        bigint  NOT NULL DEFAULT 1,
  ctag              text    NOT NULL DEFAULT '1',

  writable          boolean NOT NULL DEFAULT true,
  is_default        boolean NOT NULL DEFAULT false,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz NULL,

  CONSTRAINT calendars_uri_unique UNIQUE (scope_id, caldav_uri),
  CONSTRAINT calendars_subscription_readonly
    CHECK (origin = 'local' OR writable = false),
  CONSTRAINT calendars_components_match_kind CHECK (
    (kind = 'events' AND supported_components = ARRAY['VEVENT']) OR
    (kind = 'todos'  AND supported_components = ARRAY['VTODO'])
  )
);
CREATE INDEX ON calendars (scope_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX calendars_one_default_per_scope_kind
  ON calendars (scope_id, kind) WHERE is_default AND deleted_at IS NULL;

-- ============================================================
-- EXTERNAL SUBSCRIPTIONS (Fem-ho as a CalDAV/ICS CLIENT)
-- ============================================================
CREATE TYPE subscription_transport AS ENUM ('ics', 'caldav');   -- 'caldav' = v1.5

CREATE TABLE calendar_subscriptions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_id           uuid NOT NULL UNIQUE
                          REFERENCES calendars(id) ON DELETE CASCADE,
  transport             subscription_transport NOT NULL DEFAULT 'ics',

  source_url            text NOT NULL,            -- RFC 7986 SOURCE, webcal:// normalised
  source_url_encrypted  bytea NULL,               -- when the URL embeds a secret
  auth_kind             text NOT NULL DEFAULT 'none',   -- none | basic | bearer
  auth_secret_encrypted bytea NULL,
  allow_private_network boolean NOT NULL DEFAULT false, -- SSRF opt-in (LAN Nextcloud)

  -- refresh policy
  refresh_interval      interval NOT NULL DEFAULT '6 hours',  -- effective, clamped
  feed_refresh_interval interval NULL,   -- REFRESH-INTERVAL or X-PUBLISHED-TTL as read
  user_refresh_interval interval NULL,   -- explicit user override (wins)
  next_refresh_at       timestamptz NOT NULL DEFAULT now(),
  last_fetched_at       timestamptz NULL,
  last_success_at       timestamptz NULL,

  -- conditional GET
  http_etag             text NULL,
  http_last_modified    text NULL,
  content_hash          text NULL,        -- sha256 of the normalised body

  -- import filters (sabre parity)
  strip_todos           boolean NOT NULL DEFAULT true,
  strip_alarms          boolean NOT NULL DEFAULT true,
  strip_attachments     boolean NOT NULL DEFAULT true,

  consecutive_failures  integer NOT NULL DEFAULT 0,
  last_error            text NULL,
  last_error_at         timestamptz NULL,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON calendar_subscriptions (next_refresh_at)
  WHERE consecutive_failures < 10;

-- ============================================================
-- EVENTS  (one row per VEVENT COMPONENT)
-- ============================================================
CREATE TYPE event_status  AS ENUM ('TENTATIVE', 'CONFIRMED', 'CANCELLED');
CREATE TYPE event_transp  AS ENUM ('OPAQUE', 'TRANSPARENT');
CREATE TYPE event_class   AS ENUM ('PUBLIC', 'PRIVATE', 'CONFIDENTIAL');
CREATE TYPE event_end_kind AS ENUM ('dtend', 'duration', 'implicit');

CREATE TABLE events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_id       uuid NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  scope_id          uuid NOT NULL,   -- denormalised from calendars, for fast auth filters
  project_id        uuid NULL,

  -- iCalendar identity
  uid               text NOT NULL,                 -- VEVENT UID
  caldav_uri        text NOT NULL,                 -- resource filename, e.g. '<uid>.ics'
  recurrence_id     timestamptz NULL,              -- NULL = master; else the ORIGINAL start
  recurrence_id_tz  text NULL,                     -- TZID the RECURRENCE-ID was written in
  recurrence_id_is_date boolean NOT NULL DEFAULT false,  -- VALUE=DATE form
  is_orphan_override boolean NOT NULL DEFAULT false,

  sequence          integer NOT NULL DEFAULT 0,
  dtstamp           timestamptz NOT NULL DEFAULT now(),

  -- time
  all_day           boolean NOT NULL DEFAULT false,
  tzid              text NULL,             -- NULL + !all_day => FLOATING
  local_start       timestamp NOT NULL,    -- wall clock as authored
  local_end         timestamp NULL,        -- wall clock, exclusive; NULL if duration/implicit
  duration_iso      text NULL,             -- e.g. 'PT1H30M' when end_kind='duration'
  end_kind          event_end_kind NOT NULL DEFAULT 'dtend',
  starts_at         timestamptz NOT NULL,  -- derived UTC (floating resolved w/ calendar tz)
  ends_at           timestamptz NOT NULL,  -- derived UTC, exclusive

  -- recurrence (master rows only)
  rrule             text NULL,                     -- single RRULE value, canonicalised
  rdate             jsonb NOT NULL DEFAULT '[]',   -- [{v, tzid, value_type}]
  exdate            jsonb NOT NULL DEFAULT '[]',
  first_occurrence_utc timestamptz NULL,           -- sabre 'firstoccurence'
  last_occurrence_utc  timestamptz NULL,           -- NULL == infinite ('lastoccurence')

  -- descriptive
  summary           text NOT NULL DEFAULT '',
  description       text NULL,
  location          text NULL,
  geo_lat           double precision NULL,
  geo_lon           double precision NULL,
  url               text NULL,
  categories        text[] NOT NULL DEFAULT '{}',
  color             text NULL,
  conference_url    text NULL,                      -- RFC 7986 CONFERENCE (v1.5)

  status            event_status NOT NULL DEFAULT 'CONFIRMED',
  transp            event_transp NOT NULL DEFAULT 'OPAQUE',
  classification    event_class  NOT NULL DEFAULT 'PUBLIC',
  priority          smallint NULL CHECK (priority BETWEEN 0 AND 9),

  organizer_email   text NULL,
  organizer_cn      text NULL,
  organizer_user_id uuid NULL REFERENCES users(id),

  -- Fem-ho extensions
  created_by        uuid NULL REFERENCES users(id),
  related_task_id   uuid NULL REFERENCES tasks(id) ON DELETE SET NULL,  -- strong link, v1.5
  ai_involvement    text NULL,     -- 'none'|'assisted'|'delegated' (parity with tasks)

  -- lossless round-trip
  ical_raw          text NOT NULL,       -- the VEVENT component verbatim as received/last written
  etag              text NOT NULL,
  external_href     text NULL,           -- for caldav-client mode
  external_etag     text NULL,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz NULL,

  CONSTRAINT events_component_identity
    UNIQUE (calendar_id, uid, recurrence_id),
  CONSTRAINT events_recurrence_only_on_master
    CHECK (recurrence_id IS NULL OR (rrule IS NULL AND rdate = '[]'::jsonb AND exdate = '[]'::jsonb)),
  CONSTRAINT events_end_after_start CHECK (ends_at >= starts_at)
);

CREATE INDEX events_cal_range ON events (calendar_id, first_occurrence_utc)
  WHERE deleted_at IS NULL;
CREATE INDEX events_scope_time ON events (scope_id, starts_at)
  WHERE deleted_at IS NULL AND recurrence_id IS NULL;
CREATE INDEX events_uid ON events (calendar_id, uid);
CREATE INDEX events_updated ON events (updated_at);
CREATE INDEX events_related_task ON events (related_task_id) WHERE related_task_id IS NOT NULL;
-- full-text for quick-add / search
CREATE INDEX events_fts ON events
  USING gin (to_tsvector('simple', coalesce(summary,'') || ' ' || coalesce(location,'')));

-- ============================================================
-- MATERIALISED OCCURRENCE WINDOW  (Android Instances analogue)
-- ============================================================
CREATE TABLE event_occurrences (
  event_id       uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE, -- the MASTER row
  occurrence_id  timestamptz NOT NULL,      -- == the RECURRENCE-ID value in UTC
  calendar_id    uuid NOT NULL,
  scope_id       uuid NOT NULL,
  starts_at      timestamptz NOT NULL,      -- effective, after override
  ends_at        timestamptz NOT NULL,      -- effective, exclusive
  all_day        boolean NOT NULL,
  is_override    boolean NOT NULL DEFAULT false,
  override_event_id uuid NULL REFERENCES events(id) ON DELETE CASCADE,
  status         event_status NOT NULL DEFAULT 'CONFIRMED',
  transp         event_transp NOT NULL DEFAULT 'OPAQUE',
  PRIMARY KEY (event_id, occurrence_id)
);
CREATE INDEX event_occ_range ON event_occurrences (calendar_id, starts_at, ends_at);
CREATE INDEX event_occ_scope_range ON event_occurrences (scope_id, starts_at);
-- Postgres-specific: a range index makes overlap queries exact and fast
CREATE INDEX event_occ_gist ON event_occurrences
  USING gist (calendar_id, tstzrange(starts_at, ends_at, '[)'));

-- horizon bookkeeping so the roll-forward job knows what is materialised
CREATE TABLE event_occurrence_horizon (
  singleton     boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  window_start  timestamptz NOT NULL,
  window_end    timestamptz NOT NULL,
  rebuilt_at    timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- ATTENDEES
-- ============================================================
CREATE TYPE partstat_event AS ENUM
  ('NEEDS-ACTION','ACCEPTED','DECLINED','TENTATIVE','DELEGATED');
CREATE TYPE attendee_role AS ENUM
  ('CHAIR','REQ-PARTICIPANT','OPT-PARTICIPANT','NON-PARTICIPANT');
CREATE TYPE attendee_cutype AS ENUM
  ('INDIVIDUAL','GROUP','RESOURCE','ROOM','UNKNOWN');

CREATE TABLE event_attendees (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id       uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  cal_address    text NOT NULL,             -- 'mailto:...' verbatim
  user_id        uuid NULL REFERENCES users(id),   -- resolved internal member
  external_member_id uuid NULL,             -- Fem-ho external member of a collective scope
  common_name    text NULL,                 -- CN
  role           attendee_role   NOT NULL DEFAULT 'REQ-PARTICIPANT',
  cutype         attendee_cutype NOT NULL DEFAULT 'INDIVIDUAL',
  partstat       partstat_event  NOT NULL DEFAULT 'NEEDS-ACTION',
  rsvp           boolean NOT NULL DEFAULT false,
  delegated_to   text NULL,
  delegated_from text NULL,
  member_of      text NULL,
  schedule_agent text NOT NULL DEFAULT 'CLIENT',   -- v1: we do not send iTIP
  schedule_status text NULL,
  UNIQUE (event_id, cal_address)
);
CREATE INDEX ON event_attendees (user_id);

-- ============================================================
-- ALARMS
-- ============================================================
CREATE TYPE alarm_action  AS ENUM ('AUDIO','DISPLAY','EMAIL');
CREATE TYPE alarm_related AS ENUM ('START','END');

CREATE TABLE event_alarms (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  action        alarm_action NOT NULL DEFAULT 'DISPLAY',
  trigger_kind  text NOT NULL CHECK (trigger_kind IN ('relative','absolute')),
  trigger_offset_seconds integer NULL,        -- negative = before
  trigger_related alarm_related NULL,         -- only for relative
  trigger_at_utc timestamptz NULL,            -- only for absolute (MUST be UTC)
  description   text NULL,
  summary       text NULL,
  repeat_count  integer NULL,
  repeat_duration_iso text NULL,
  ical_raw      text NOT NULL,                -- verbatim VALARM
  CONSTRAINT alarm_trigger_shape CHECK (
    (trigger_kind='relative' AND trigger_offset_seconds IS NOT NULL
                             AND trigger_related IS NOT NULL AND trigger_at_utc IS NULL)
 OR (trigger_kind='absolute' AND trigger_at_utc IS NOT NULL
                             AND trigger_offset_seconds IS NULL)
  ),
  CONSTRAINT alarm_repeat_pairing CHECK (
    (repeat_count IS NULL) = (repeat_duration_iso IS NULL)
  ),
  CONSTRAINT alarm_email_needs_fields CHECK (
    action <> 'EMAIL' OR (description IS NOT NULL AND summary IS NOT NULL)
  )
);

-- resolved firing schedule, driven by event_occurrences
CREATE TABLE alarm_queue (
  alarm_id      uuid NOT NULL REFERENCES event_alarms(id) ON DELETE CASCADE,
  event_id      uuid NOT NULL,
  occurrence_id timestamptz NOT NULL,
  user_id       uuid NOT NULL,
  fire_at       timestamptz NOT NULL,
  fired_at      timestamptz NULL,
  PRIMARY KEY (alarm_id, occurrence_id, user_id)
);
CREATE INDEX alarm_queue_due ON alarm_queue (fire_at) WHERE fired_at IS NULL;

-- ============================================================
-- LOCAL ANNOTATIONS ON READ-ONLY EXTERNAL EVENTS
-- ============================================================
CREATE TABLE event_annotations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_id   uuid NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  uid           text NOT NULL,
  recurrence_id timestamptz NULL,
  note          text NULL,
  linked_task_id uuid NULL REFERENCES tasks(id) ON DELETE CASCADE,
  created_by    uuid NOT NULL REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (calendar_id, uid, recurrence_id, created_by)
);

-- ============================================================
-- CHANGE LOG  (drives CalDAV sync-collection AND app delta sync)
-- ============================================================
CREATE TYPE change_op AS ENUM ('created','updated','deleted');

CREATE TABLE calendar_changes (
  id           bigserial PRIMARY KEY,
  calendar_id  uuid NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  caldav_uri   text NOT NULL,          -- the RESOURCE uri (master + overrides share one)
  sync_token   bigint NOT NULL,
  operation    change_op NOT NULL,
  changed_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX calendar_changes_token ON calendar_changes (calendar_id, sync_token);

-- app-level (cross-entity) change feed for the Android client
CREATE TABLE entity_changes (
  seq         bigserial PRIMARY KEY,
  entity      text NOT NULL,           -- 'task'|'checklist'|'event'|'project'|'scope'|'calendar'
  entity_id   uuid NOT NULL,
  scope_id    uuid NULL,
  operation   change_op NOT NULL,
  changed_at  timestamptz NOT NULL DEFAULT now(),
  actor_id    uuid NULL,
  actor_kind  text NOT NULL DEFAULT 'human'   -- 'human'|'ai'|'system'|'caldav'
);
CREATE INDEX entity_changes_scope_seq ON entity_changes (scope_id, seq);
```

Notes on the schema:

- `events.recurrence_id` is `timestamptz`, storing the RECURRENCE-ID **converted to UTC**, with `recurrence_id_tz` retained so the property can be re-emitted in its original form. For all-day recurring events, `recurrence_id_is_date = true` and the timestamp is midnight in `recurrence_id_tz`.
- `ical_raw` per component + a computed per-resource serialisation avoids the sabre "blob only" opacity while keeping round-trip fidelity for X-props.
- `first_occurrence_utc` / `last_occurrence_utc` are the direct analogue of sabre's `firstoccurence` / `lastoccurence` and give O(index) pruning even for events outside the materialised window.
- `calendar_changes.caldav_uri` (not `event_id`) is the sync unit, because CalDAV syncs **resources**, and a master + its overrides are one resource.
- Do **not** copy Nextcloud's shared-id-space mistake (issue #49635): calendars and subscriptions here are one table with a discriminator plus UUID keys.

### 5.3 REST resource shape

New resources for dossier 05 §19's endpoint table (note: `/api/v1/events/stream` already exists for SSE; the CRUD resource is `/api/v1/events` — **the collision must be resolved by moving SSE to `/api/v1/stream`**):

```
GET    /api/v1/calendars                       ?scope_id=&kind=events|todos&include_subscriptions=true
POST   /api/v1/calendars
GET    /api/v1/calendars/{calendarId}
PATCH  /api/v1/calendars/{calendarId}
DELETE /api/v1/calendars/{calendarId}

POST   /api/v1/calendars/{calendarId}/refresh          # force a subscription poll
GET    /api/v1/calendar-subscriptions
POST   /api/v1/calendar-subscriptions                  # {source_url, scope_id, display_name, color}
PATCH  /api/v1/calendar-subscriptions/{id}
DELETE /api/v1/calendar-subscriptions/{id}

GET    /api/v1/events                 # masters + standalone; NOT expanded
GET    /api/v1/events/{eventId}
POST   /api/v1/events
PATCH  /api/v1/events/{eventId}        ?series_mode=single|future|all
DELETE /api/v1/events/{eventId}        ?series_mode=single|future|all
POST   /api/v1/events/{eventId}/rsvp   # {partstat}
GET    /api/v1/occurrences            # THE calendar-grid endpoint (expanded)
GET    /api/v1/agenda                 # unified events + dated tasks, one sorted feed
GET    /api/v1/freebusy               ?from=&to=&scope_id=&user_ids=
GET    /api/v1/sync                   ?cursor=&entities=event,task,...
GET    /api/v1/stream                 # SSE (renamed from /events/stream)
```

**`GET /api/v1/occurrences` is the workhorse.** It is the only endpoint the month/week/day grid calls.

```
GET /api/v1/occurrences
    ?from=2026-09-01T00:00:00Z          (required, inclusive)
    &to=2026-10-01T00:00:00Z            (required, exclusive)
    &scope_id=<uuid>[,<uuid>...]        (optional)
    &calendar_id=<uuid>[,...]           (optional)
    &include=events,tasks               (default: events,tasks)
    &tz=Europe/Madrid                   (resolves floating times & all-day boundaries)
    &limit=2000
```

Guardrails, following Morgen's precedent: **reject a window longer than 400 days** with `400 window_too_large`; cap results at `limit` and return `has_more`.

Response (discriminated union — the same shape the Android client and the AI see):

```jsonc
{
  "window": { "from": "2026-09-01T00:00:00Z", "to": "2026-10-01T00:00:00Z", "tz": "Europe/Madrid" },
  "items": [
    {
      "type": "event",
      "id": "ev_0e2f…",                      // the MASTER event id
      "occurrenceId": "2026-09-21T15:00:00Z",// == RECURRENCE-ID in UTC; null if non-recurring
      "instanceKey": "ev_0e2f…@2026-09-21T15:00:00Z",   // stable client-side key
      "overrideEventId": "ev_77aa…",         // present when this occurrence is an override
      "uid": "9f1c…@fem-ho",
      "calendarId": "cal_…",
      "scopeId": "sc_…",
      "projectId": null,
      "title": "Extraescolar de natació",
      "description": null,
      "location": "Piscina municipal",
      "allDay": false,
      "start": "2026-09-21T19:00:00",        // LOCAL wall clock (JSCalendar style)
      "end":   "2026-09-21T20:00:00",
      "timeZone": "Europe/Madrid",
      "startUtc": "2026-09-21T17:00:00Z",    // convenience, always present
      "endUtc":   "2026-09-21T18:00:00Z",
      "status": "CONFIRMED",
      "freeBusy": "busy",                    // from TRANSP
      "privacy": "public",                   // from CLASS
      "color": null,
      "isRecurring": true,
      "isOverride": true,
      "recurrenceRule": "FREQ=WEEKLY;BYDAY=MO",
      "organizer": { "email": "borja@…", "name": "Borja", "userId": "u_…" },
      "attendees": [
        { "email": "mar@…", "name": "Mar", "userId": "u_…",
          "role": "REQ-PARTICIPANT", "partstat": "ACCEPTED", "rsvp": true }
      ],
      "alerts": [ { "id": "al_…", "minutesBefore": 15, "action": "DISPLAY" } ],
      "editable": true,
      "source": null,
      "relatedTaskId": null,
      "etag": "\"W/3f9a…\"",
      "updatedAt": "2026-08-05T10:15:00Z"
    },
    {
      "type": "task",
      "id": "tk_91bb…",
      "title": "Pagar la quota de l'escola",
      "allDay": true,
      "start": "2026-09-22",
      "end":   "2026-09-23",                 // exclusive, iCalendar/FullCalendar convention
      "timeZone": "Europe/Madrid",
      "kanbanColumn": "per_fer",
      "dueAt": "2026-09-22T21:59:59Z",
      "assigneeIds": ["u_…"],
      "scopeId": "sc_…",
      "editable": true,
      "renderAs": "chip"                     // UI hint: never a block
    }
  ],
  "hasMore": false
}
```

Design points:

- The union is discriminated by `"type"`, matching the SSE `entity` field dossier 07 already emits. **Do not** flatten tasks into event shape.
- Local wall clock + `timeZone` + a UTC convenience pair follows JSCalendar/Morgen (`start` + `duration` + `timeZone` + `showWithoutTime`) rather than Google's `{date} xor {dateTime,timeZone}` — one shape is easier to type-generate from OpenAPI than a union.
- `instanceKey` gives React/Compose a stable list key for an occurrence that has no database id of its own.
- `editable` is computed server-side (calendar writable ∧ user has write ACL on the àmbit ∧ token has `events:write`). Never make the client infer it.

**Create body** (`POST /api/v1/events`):

```jsonc
{
  "calendarId": "cal_…",                // or {"scopeId": …, "projectId": …} to pick the default
  "title": "Sopar amb els avis",
  "description": null,
  "location": "Can Marc",
  "allDay": false,
  "start": "2026-09-19T21:00:00",
  "end":   "2026-09-19T23:30:00",       // xor "duration": "PT2H30M"
  "timeZone": "Europe/Madrid",
  "status": "CONFIRMED",
  "freeBusy": "busy",
  "privacy": "public",
  "recurrenceRule": "FREQ=MONTHLY;BYDAY=3SA",   // RRULE value WITHOUT the "RRULE:" prefix
  "recurrenceDates": [],
  "excludedDates": [],
  "attendees": [ { "email": "avia@…", "role": "REQ-PARTICIPANT" } ],
  "alerts": [ { "minutesBefore": 60 } ]
}
```

Validation the API must perform (return `422` with a field-level error array):
`end` xor `duration`; `end > start`; if `allDay` then `start`/`end` are dates and `timeZone` is ignored; `recurrenceRule` parses and does not contain both `UNTIL` and `COUNT`; `UNTIL` is UTC when `timeZone` is set; `alerts[].minutesBefore` within ±40320 for parity with Google; attendee e-mails syntactically valid; calendar is `kind='events'` and `writable`.

**Errors** (stable machine codes for the AI): `calendar_read_only`, `window_too_large`, `invalid_rrule`, `until_count_conflict`, `dtend_before_dtstart`, `end_and_duration_conflict`, `recurrence_id_not_found`, `not_a_recurring_event`, `series_mode_required`, `subscription_fetch_failed`, `source_url_not_allowed`.

**Concurrency:** every event response carries an `ETag`; `PATCH`/`DELETE` accept `If-Match`; mismatch → `412 Precondition Failed`. This is the same primitive CalDAV uses and lets the Android client reuse one conflict path.

### 5.4 CalDAV collection layout

Fem-ho as a **server**. Given RFC 4791 §5.2 forbids mixed-component resources and `CALDAV:supported-calendar-component-set` advertises the kind, every logical container gets **two** collections:

```
/dav/
├── .well-known/caldav                          → 301 → /dav/
├── principals/
│   └── {username}/                             DAV:current-user-principal target
│        ├── CALDAV:calendar-home-set   → /dav/calendars/{username}/
│        └── CALDAV:calendar-user-address-set → mailto:{email}
└── calendars/
    └── {username}/
        ├── inbox/                              (v1.5, RFC 6638 schedule-inbox)
        ├── outbox/                             (v1.5, RFC 6638 schedule-outbox)
        │
        ├── personal-events/          VEVENT     ← àmbit "Personal", general space
        ├── personal-todos/           VTODO
        ├── feina-events/             VEVENT
        ├── feina-todos/              VTODO
        ├── familia-events/           VEVENT     ← collective àmbit, shared with members
        ├── familia-todos/            VTODO
        ├── familia-p-{projectId}-events/   VEVENT   ← per-project collections
        ├── familia-p-{projectId}-todos/    VTODO
        │
        └── sub-{subscriptionId}/     VEVENT, read-only mirror of an external feed
```

Per-collection WebDAV properties to implement:

| Property | Namespace | Value |
|---|---|---|
| `DAV:resourcetype` | DAV: | `<collection/><C:calendar/>` (+ `<CS:subscribed/>` for mirrors, see below) |
| `DAV:displayname` | DAV: | Catalan display name |
| `CALDAV:calendar-description` | caldav | |
| `CALDAV:supported-calendar-component-set` | caldav | `<C:comp name="VEVENT"/>` **or** `<C:comp name="VTODO"/>`, never both |
| `CALDAV:supported-calendar-data` | caldav | `text/calendar; charset=utf-8; version=2.0` |
| `CALDAV:calendar-timezone` | caldav | one VCALENDAR containing exactly one VTIMEZONE |
| `CALDAV:max-resource-size` | caldav | e.g. 10485760 |
| `CALDAV:min-date-time` / `max-date-time` | caldav | e.g. 19000101T000000Z / 20500101T000000Z |
| `DAV:sync-token` | DAV: | `https://fem-ho/ns/sync/{calendarId}/{n}` |
| `CS:getctag` | `http://calendarserver.org/ns/` | cheap change detector for old clients |
| `ICAL:calendar-color` | `http://apple.com/ns/ical/` | `#RRGGBBFF` |
| `ICAL:calendar-order` | `http://apple.com/ns/ical/` | integer |
| `CALDAV:schedule-calendar-transp` | caldav | `<C:opaque/>` / `<C:transparent/>` (v1.5) |

Resource naming: **one `.ics` per UID**, containing the master and all its overrides, at `<collection>/<uid>.ics` (percent-encode; if the UID is unsafe or > 200 bytes, mint a UUID filename and keep the mapping in `events.caldav_uri`). Never write one file per occurrence.

Reports to implement, in priority order:

1. `PROPFIND` Depth 0/1 with the properties above — **required**, this is discovery.
2. `REPORT` `CALDAV:calendar-query` with `comp-filter` + `time-range` (+ `prop-filter`, `text-match`, `param-filter`) — **required**. Implement the §9.9 VEVENT table exactly (§2.6).
3. `REPORT` `CALDAV:calendar-multiget` — **required**, this is how clients fetch after a query.
4. `REPORT` `DAV:sync-collection` (RFC 6578) — **strongly recommended**: `DAV:sync-token`, `DAV:sync-level` ∈ `1` | `infinite`, optional `DAV:limit`/`DAV:nresults`. Deleted members are reported as a `DAV:response` with `DAV:status` `404 Not Found` and **no** `DAV:propstat`. If a client presents a token you no longer have, return `403` with the `DAV:valid-sync-token` precondition so it falls back to a full sync with an empty `DAV:sync-token`. Truncated results return `507 Insufficient Storage` on the collection's response with `DAV:number-of-matches-within-limits`. Google supports this and tells clients they "must switch to this mode of operation after the initial sync".
5. `CALDAV:expand` inside `calendar-data` — **v1.5**. Many clients never ask for it, but python-caldav and some agents do. When you do implement it, strip `RRULE`, `RDATE`, `EXDATE`, `EXRULE` *individually* (Radicale's bug), and put `RECURRENCE-ID` on **every** emitted component including the first.
6. `CALDAV:free-busy-query` — **defer**. Google itself does not implement it ("All reports except free-busy-query are implemented").
7. `MKCALENDAR` — optional; Fem-ho creates collections from the app, so return `403` and let the UI own creation. (Google likewise does not support `MKCALENDAR`/`MKCOL`.)

**Subscribed-mirror collections.** Apple's CalendarServer defines a `subscribed` resourcetype in the `http://calendarserver.org/ns/` namespace, with a `source` property, used by iOS/macOS to represent an ICS subscription server-side. Fem-ho should expose external mirrors as **ordinary read-only calendar collections** in v1 (`DAV:resourcetype` = collection + calendar, all write methods → `403`), plus the RFC 7986 `SOURCE` property in the exported VCALENDAR so a client that re-exports it knows the origin. Advertising the Apple `subscribed` type is a v2 nicety. *(See UNVERIFIED: the exact `caldav-subscribed.txt` element names could not be fetched.)*

Advertise in the `DAV:` response header: `DAV: 1, 3, calendar-access` (v1). Add `calendar-auto-schedule` only when RFC 6638 is genuinely implemented.

### 5.5 MCP tool surface for events

Design constraints from the brief: separately scoped tokens for humans vs AI, every AI change audited, "AI user" involvement levels. Concretely:

**Scopes:** `events:read`, `events:write`, `calendars:read`, `calendars:write`, `subscriptions:manage`. **Default AI token grants `events:read` only.** `subscriptions:manage` should be **human-only, always** — it is the SSRF sink (§3.5); an AI must never be able to point the server at an arbitrary URL.

**Tools:**

| Tool | Scope | Arguments | Returns |
|---|---|---|---|
| `fem_ho_calendars_list` | `calendars:read` | `scope_id?`, `kind?` | id, name, kind, origin, writable, color, timezone |
| `fem_ho_occurrences_list` | `events:read` | `from`, `to` (ISO, ≤ 400 d), `scope_id?`, `calendar_id?`, `include` (`events`,`tasks`), `tz?` | the same discriminated union as `GET /api/v1/occurrences` |
| `fem_ho_event_get` | `events:read` | `event_id` **or** (`uid` + `calendar_id`), `occurrence_id?` | full event |
| `fem_ho_event_create` | `events:write` | title, calendar_id or scope hint, start, end/duration, time_zone, all_day, recurrence_rule?, attendees?, alerts?, location?, description?, free_busy?, privacy? | created event + `audit_id` |
| `fem_ho_event_update` | `events:write` | `event_id`, `series_mode` (**required** if the event is recurring), patch fields, `if_match?` | updated event + `audit_id` |
| `fem_ho_event_delete` | `events:write` | `event_id`, `series_mode` (required if recurring), `occurrence_id?` | `{deleted: true, audit_id}` |
| `fem_ho_event_rsvp` | `events:write` | `event_id`, `occurrence_id?`, `partstat` | updated attendee |
| `fem_ho_freebusy` | `events:read` | `from`, `to`, `user_ids[]`, `scope_id?` | merged busy intervals per user (honours `TRANSP` and `CLASS`) |
| `fem_ho_find_slot` | `events:read` | `duration_minutes`, `window_from`, `window_to`, `user_ids[]`, `working_hours?`, `granularity_minutes?` | ranked candidate slots — the single most useful AI-facing tool for a household |
| `fem_ho_task_block_time` | `events:write` + `tasks:write` | `task_id`, `start`, `duration_minutes`, `calendar_id?` | created event linked via `related_task_id` (v1.5) |

Tool-design rules that matter for a model:

- **`series_mode` must be a required enum whenever the target is recurring**, with the tool description spelling out the three behaviours. Otherwise a model will "just edit" and silently mutate a whole series. Return a `400 series_mode_required` with the three options enumerated if omitted.
- **Every mutating tool returns an `audit_id`** and writes an `entity_changes` row with `actor_kind='ai'` plus a full before/after diff into the audit table, satisfying "audits every change".
- Never expose a raw-iCalendar write tool to an AI in v1. A model that can PUT arbitrary `.ics` can corrupt recurrence sets in ways no validator will catch.
- Read tools must **redact** `CLASS:PRIVATE` events the calling principal does not own: return `{title: "Ocupat", privacy: "private", …}` with `description`/`location`/`attendees` omitted.
- Subscription-backed events come back with `"editable": false` and `"source"` set; the write tools reject them with `calendar_read_only` *before* any partial work.

### 5.6 Delta sync consequences for the offline-first Android client

The single most important architectural statement: **occurrences are not synced.** The client syncs *components* (masters + overrides) and expands them locally. This is exactly DAVx⁵'s posture — it "is not responsible for calculating the instances of a recurring event. It only provides RRULE, RDATE, EXRULE, EXDATE and a list of exceptions to the Android calendar provider" — and Android's own provider then materialises `Instances`. Syncing occurrences would multiply payload size by 50–500× and make every timezone-rule change a full resync.

**Room schema (mirrors §5.2, trimmed):**

```kotlin
@Entity(
  tableName = "events",
  indices = [
    Index(value = ["calendarId", "uid", "recurrenceId"], unique = true),
    Index(value = ["calendarId", "firstOccurrenceUtc"]),
    Index(value = ["syncState"])
  ]
)
data class EventEntity(
  @PrimaryKey val id: String,
  val calendarId: String,
  val scopeId: String,
  val uid: String,
  val recurrenceId: Long?,          // epoch millis, null = master
  val recurrenceIdTz: String?,
  val allDay: Boolean,
  val tzid: String?,                // null && !allDay => floating
  val localStart: String,           // "2026-09-21T19:00:00"
  val localEnd: String?,
  val durationIso: String?,
  val endKind: String,              // dtend | duration | implicit
  val startsAtUtc: Long,
  val endsAtUtc: Long,
  val rrule: String?,
  val rdateJson: String,
  val exdateJson: String,
  val firstOccurrenceUtc: Long?,
  val lastOccurrenceUtc: Long?,     // null = infinite
  val summary: String,
  val description: String?,
  val location: String?,
  val status: String,
  val transp: String,
  val classification: String,
  val color: String?,
  val organizerEmail: String?,
  val relatedTaskId: String?,
  val editable: Boolean,
  val etag: String,
  val updatedAt: Long,
  // offline-first bookkeeping
  val syncState: String,            // SYNCED | PENDING_CREATE | PENDING_UPDATE | PENDING_DELETE
  val localRevision: Long,
  val baseEtag: String?,            // etag the pending edit was based on
  val conflict: Boolean
)

@Entity(tableName = "event_occurrences", primaryKeys = ["eventId","occurrenceId"])
data class OccurrenceEntity(          // LOCAL ONLY — never synced, rebuildable
  val eventId: String,
  val occurrenceId: Long,
  val calendarId: String,
  val scopeId: String,
  val startsAtUtc: Long,
  val endsAtUtc: Long,
  val allDay: Boolean,
  val isOverride: Boolean,
  val overrideEventId: String?,
  val status: String,
  val startDay: Int,                 // Julian-style local day index, à la CalendarContract
  val endDay: Int
)
```

`startDay`/`endDay` are lifted straight from `CalendarContract.Instances` (`START_DAY`/`END_DAY`, Julian days relative to the local zone) because a month grid query is then `WHERE startDay <= :lastDay AND endDay >= :firstDay` — an integer index scan, no timezone maths in SQL.

**Sync protocol** (`GET /api/v1/sync?cursor=&entities=event,task,checklist,project,scope,calendar`):

```jsonc
{
  "cursor": "eyJzZXEiOjkwMjEzfQ",
  "hasMore": false,
  "reset": false,                    // true => client must wipe and full-sync
  "changes": [
    { "entity": "event", "op": "upsert", "id": "ev_…", "data": { … } },
    { "entity": "event", "op": "delete", "id": "ev_…",
      "uid": "9f1c…", "calendarId": "cal_…", "recurrenceId": "2026-09-28T15:00:00Z" },
    { "entity": "calendar", "op": "upsert", "id": "cal_…", "data": { … } }
  ]
}
```

Rules:

- Deletes carry `uid` + `recurrenceId` as well as `id`, so a client that missed the create can still purge by identity.
- **Deleting a master must cascade**: the server emits deletes for every override with the same `(calendarId, uid)`, or a single `op: "delete_series"` with `uid`. Prefer the explicit per-row deletes; simpler client logic.
- Server retains the change log for `SYNC_RETENTION = 30 days`. A cursor older than that gets `{"reset": true}` — the same contract as RFC 6578's `DAV:valid-sync-token` precondition failure.
- Subscription refreshes generate ordinary `event` upsert/delete changes; the client cannot tell the difference and does not need to.

**Local recurrence expansion on Android:** use **ical4j** (already the library behind ical4android/DAVx⁵) or **dmfs `lib-recur`** for RRULE iteration, with `java.time` + a bundled tzdata. Rebuild `event_occurrences` (a) on any `events` upsert/delete for that uid, (b) when the visible window moves outside the materialised horizon, (c) on tzdata update, (d) on device timezone change (broadcast `ACTION_TIMEZONE_CHANGED`). Keep the horizon at `[now − 3 months, now + 12 months]` on mobile — narrower than the server's, because rebuild cost matters on battery.

**Offline writes and conflicts:**

- Optimistic local mutation → `syncState = PENDING_*`, immediate UI update, `localRevision++`.
- Upload with `If-Match: baseEtag`. `412` → mark `conflict = true`, keep both versions, surface a Catalan conflict sheet ("Aquest esdeveniment s'ha modificat en un altre dispositiu"). Field-level auto-merge is a trap for events (moving the time and moving the location are not commutative when a series is involved) — prefer last-writer-wins-with-explicit-prompt.
- **Never** allow an offline edit of a subscription-backed event: block it in the repository, not just the UI, or the pending queue will fill with permanently-failing operations.
- A pending `series_mode: future` split is a multi-row transaction; queue it as a single opaque operation with its own idempotency key so a retry does not split twice.

### 5.7 Web UI notes (FullCalendar)

Dossier 07 already wires FullCalendar. The Event Object properties available: `id`, `groupId`, `allDay`, `start`, `end`, `startStr`, `endStr`, `title`, `url`, `className`, `editable`, `startEditable`, `durationEditable`, `resourceEditable`, `display`, `overlap`, `constraint`, `color`, `extendedProps`, `source`.

Mapping:

| Fem-ho | FullCalendar |
|---|---|
| occurrence `instanceKey` | `id` |
| all occurrences of one series | `groupId` = the master event id (so drag moves the whole series when the user chooses "tota la sèrie") |
| `editable` false (subscription / no ACL) | `editable: false`, `startEditable: false`, `durationEditable: false` |
| event | `display: 'block'` |
| dated task (weak link) | `display: 'list-item'` + `classNames: ['fh-task-chip']` |
| all-day tasks/events | `allDay: true`, `end` exclusive — FullCalendar's convention matches iCalendar exactly ("an event with the `end` of `2018-09-03` will appear to span through `2018-09-02`") |
| busy shading from an external calendar the user chose to "show as background" | `display: 'background'` |
| everything Fem-ho-specific (`scopeId`, `uid`, `occurrenceId`, `privacy`, `source`) | `extendedProps` |

`eventDrop` / `eventResize`: when `event.extendedProps.isRecurring`, open the *Només aquest / Aquest i els següents / Tota la sèrie* sheet **before** issuing the PATCH, and call `info.revert()` if the user cancels.

### 5.8 Quick-add grammar extension for events

The brief's quick-add already handles `@person` and `#Scope` / `#Scope/Project`. Events need a time grammar. Minimum viable Catalan set (all case-insensitive, parsed left-to-right, first match wins, everything unmatched stays in the title):

```
dilluns | dimarts | … | demà | avui | passat demà | el 14 | 14/9 | 14 de setembre
a les 19  |  a les 19:30  |  de 19 a 20:30  |  19-20:30  |  de 19h a 20h
durant 1h | 90min | 2 hores
tot el dia
cada dilluns | cada setmana | cada dia | cada mes | cada any | cada 2 setmanes
a <lloc>        → LOCATION  (only when preceded by "a " and followed by a capitalised token)
```

**Disambiguation rule (important):** a bare date (`demà`, `14/9`) with **no time and no duration** creates a **task** with a due date. A time range, an explicit duration, or `tot el dia` creates an **event**. An explicit prefix always wins: `!ev` / `!esdeveniment` forces an event, `!t` forces a task. Show the resolved interpretation as a chip preview before submit so the rule is learnable rather than surprising.

### 5.9 v1 vs deferred — the explicit split

**v1 (must ship with the calendar view):**

- `events` / `event_occurrences` / `event_attendees` / `event_alarms` / `calendars` / `calendar_subscriptions` tables.
- Non-recurring and recurring events with a single RRULE, RDATE, EXDATE, and full master+override support (create/read/update/delete overrides).
- `series_mode` = `single` | `future` | `all` on update and delete.
- All-day (VALUE=DATE), zoned (TZID) and UTC times. **Floating parsed and preserved but not creatable from the UI.**
- STATUS / TRANSP / CLASS, SUMMARY / DESCRIPTION / LOCATION / URL / CATEGORIES / COLOR / GEO.
- DISPLAY alarms with relative triggers; the `alarm_queue` + push notification path.
- ATTENDEE/ORGANIZER **stored and displayed**, with in-app RSVP (`PARTSTAT`), `SCHEDULE-AGENT=CLIENT`. No e-mail.
- ICS/webcal subscriptions: fetch, conditional GET, REFRESH-INTERVAL/X-PUBLISHED-TTL, strip todos/alarms/attachments, UID+RECURRENCE-ID diff deletion, SSRF guard, read-only enforcement at the repository.
- CalDAV **server**: per-àmbit and per-project `-events` and `-todos` collections; `PROPFIND`, `calendar-query` with the exact §9.9 VEVENT table, `calendar-multiget`, `sync-collection`, `getctag`, `PUT`/`GET`/`DELETE` with ETags, correct VTIMEZONE emission.
- REST `/calendars`, `/events`, `/occurrences`, `/agenda`, `/calendar-subscriptions`, `/sync`; rename SSE to `/stream`.
- MCP: `calendars_list`, `occurrences_list`, `event_get`, `event_create`, `event_update`, `event_delete`, `freebusy`. AI tokens read-only by default.
- Android: component sync + local expansion + offline optimistic writes with `If-Match`.
- Weak task↔calendar link (dated tasks render as chips).

**v1.5:**

- CalDAV **client** mode (subscribe to a real CalDAV collection with credentials, `sync-collection`-based incrementality, optional write-back).
- `CALDAV:expand` in `calendar-data`.
- `CONFERENCE` property and a "join" button.
- Strong task↔event link (`fem_ho_task_block_time`, `related_task_id`, `RELATED-TO`).
- `fem_ho_find_slot` and a real free/busy view across household members.
- Public share link for a single event or a day agenda (reusing the existing expiry/password/guest-name machinery).
- Local annotations on read-only external events.

**v2 / deferred:**

- RFC 6638 implicit scheduling: schedule inbox/outbox, `Schedule-Tag` / `If-Schedule-Tag-Match`, `SCHEDULE-AGENT=SERVER`, iMIP e-mail delivery, `calendar-auto-schedule` in the DAV header.
- `free-busy-query` REPORT (Google does not implement it either).
- `VAVAILABILITY`, `VPOLL`, resource/room booking (`CUTYPE=ROOM`).
- Apple `CS:subscribed` resourcetype for mirrors.
- `IMAGE`, `ATTACH` on events, structured `LOCATION` (RFC 9073).
- Non-Gregorian `RSCALE` (RFC 7529).
- `EXRULE` emission (never — parse only).
- Floating-time authoring UI.
- Multi-RRULE.

### 5.10 Patches required to the existing twelve dossiers

| Dossier | Change |
|---|---|
| 05 §1.1 | Add entity rows: `event`, `event_occurrence`, `event_attendee`, `event_alarm`, `calendar`, `calendar_subscription`. |
| 05 §19 | Add the endpoint table from §5.3. **Rename `/events/stream` → `/stream`** to free the `/events` namespace; note the rename as a breaking change before M5. |
| 07 §9 | Confirm `entity: 'event'` on the SSE wire and add `entity: 'calendar'`; document that SSE carries **component** changes, never occurrence changes. |
| 08 Part 5 | Insert the DDL of §5.2; add the `calendar_changes` and `entity_changes` tables; reconcile `reminders` (task-side) with `event_alarms` (event-side) — they are different tables, not one. |
| 03 | Add a VEVENT part mirroring the VTODO part: §1 and §2 of this dossier. Correct the current "VEVENT is v2" framing. |
| 01 §10.8 | Reverse the deferral: VEVENT is v1, VEVENT scheduling (RFC 6638) is v2. |
| 06 (Android) | Add: occurrences are computed client-side; Room `event_occurrences` is local-only and rebuildable; ical4j / lib-recur dependency; timezone-change rebuild triggers. |
| 09 (sharing/security) | Add the SSRF rules of §3.5 and the `CLASS:PRIVATE` redaction rule. |
| 10 (AI) | Add the MCP tool table of §5.5 and the "AI tokens are `events:read` by default; `subscriptions:manage` is human-only" rule. |
| 11 (Docker ops) | Add the subscription-refresh worker and the nightly occurrence-horizon roll-forward job; add a tzdata-upgrade hook that rebuilds `event_occurrences`. |

---

## 6. Acceptance corpus — the test fixtures to build first

Build these as `.ics` fixtures with expected expansions checked into the repo. Every one of them has broken a real product.

1. **All-day single day.** `DTSTART;VALUE=DATE:20260814` / `DTEND;VALUE=DATE:20260815`. Expect: one occurrence, UI label "14 d'agost", not "14–15".
2. **All-day multi-day.** `20260814`→`20260817`. Expect UI "14–16 d'agost".
3. **All-day with no DTEND.** Expect `DTSTART + P1D`.
4. **Zero-length point event.** `DTSTART:20260814T090000Z` only. Expect the §9.9 rule `start <= DTSTART AND end > DTSTART`.
5. **Negative/zero DURATION.** Expect point semantics, no crash.
6. **DST spring-forward.** Weekly `DTSTART;TZID=Europe/Madrid:20260322T023000` — 02:30 does not exist on 29 March 2026 in Madrid. Expect a documented, stable resolution (skip or shift) and the same answer on server and Android.
7. **DST fall-back.** Weekly 02:30 on the ambiguous night. Expect the earlier offset, consistently.
8. **DTSTART not matching the rule.** `DTSTART:20260901T090000` (Tuesday) + `RRULE:FREQ=WEEKLY;BYDAY=MO`. Expect DTSTART counted as the first occurrence.
9. **UNTIL type mismatch.** `DTSTART;TZID=Europe/Madrid:...` + `UNTIL=20261231T235959` (no Z). Expect: accepted on import with a warning, re-emitted as UTC.
10. **UNTIL + COUNT together.** Expect `422 until_count_conflict`.
11. **BYMONTHDAY=31 monthly.** Expect Feb/Apr/Jun/Sep/Nov skipped, not counted.
12. **EXDATE with the wrong zone.** Expect the mismatch to be detected and logged, not silently ignored.
13. **Override that moves an instance to a different day.** Expect `RECURRENCE-ID` unchanged, `event_occurrences.occurrence_id` unchanged, `starts_at` moved.
14. **Override before the master's DTSTART.** Legal. Expect the occurrence to render before the series starts.
15. **Orphan override** (override with no master in the resource). Expect a standalone event row, no crash — the sabre/vobject failure mode.
16. **`RANGE=THISANDFUTURE`.** Expect eager materialisation into concrete overrides.
17. **`STATUS:CANCELLED` override.** Expect the occurrence hidden by default, visible with `showCancelled=true`.
18. **`RDATE;VALUE=PERIOD`.** Expect conversion to an override with its own duration.
19. **Infinite rule + a 2099 query.** Expect the shortlist path, `MAX_INSTANCES` cap, no OOM.
20. **`FREQ=DAILY;COUNT=3650`.** The Radicale blow-up case. Expect a bounded response.
21. **Feed returns 500 with an HTML body.** Expect: nothing deleted, `consecutive_failures = 1`.
22. **Feed returns 304.** Expect no parsing, `last_fetched_at` updated only.
23. **Feed drops one event.** Expect exactly one tombstone, exactly one `entity_changes` delete.
24. **Subscription URL resolves to 192.168.x.x** with `allow_private_network=false`. Expect `source_url_not_allowed`.
25. **Round-trip fidelity.** Import an Apple-generated `.ics` with X-props and `ATTACH`; export; byte-compare the preserved properties.
26. **Two TZIDs in one resource** (event in Madrid, override in London). Expect two VTIMEZONE components on export.
27. **Time-range boundary.** Event `10:00–11:00`; query `[11:00, 12:00)` → **no match** (`end > DTSTART` fails at equality is not the issue; `start < DTEND` fails: `11:00 < 11:00` is false). Query `[09:00, 10:00)` → no match (`end > DTSTART`: `10:00 > 10:00` false). Both must be exercised.
28. **Concurrent edit.** Two clients PATCH with the same `If-Match`; the second gets `412`.

---

## What Fem-ho should do

1. **Create a real `event` entity now, before M5.** One row per VEVENT *component*; master = `recurrence_id IS NULL`; overrides are sibling rows sharing `(calendar_id, uid)`. Never model an event as a task with a start and an end — the STATUS enums, PARTSTAT enums, TRANSP, and the RFC 4791 §9.9 overlap algebra are all different, and Vikunja's own CalDAV property list (no `RECURRENCE-ID`) shows exactly what that shortcut costs.
2. **Adopt the hybrid recurrence strategy.** Component rows + sabre-style `first_occurrence_utc`/`last_occurrence_utc` pruning + a materialised `event_occurrences` window (Android `Instances` analogue) covering `[−1 y, +2 y]`, with on-the-fly expansion outside it. Cap at `MAX_INSTANCES = 2000` per request.
3. **Never sync occurrences to Android.** Sync components; expand locally with ical4j or lib-recur; rebuild the local occurrence table on component change, horizon move, timezone change and tzdata upgrade. This is precisely DAVx⁵'s division of labour.
4. **Split every container into two CalDAV collections** (`…-events` VEVENT, `…-todos` VTODO) and advertise `CALDAV:supported-calendar-component-set` correctly. RFC 4791 §5.2 requires it and every real client assumes it.
5. **Implement the RFC 4791 §9.9 VEVENT overlap table literally**, as its own function separate from the VTODO one, with test 27 above. And expand recurrences server-side when answering it — the RFC says MUST.
6. **Emit one VTIMEZONE per distinct TZID referenced**, generated from tzdata, with `DTSTART` inside observances as bare local time. Set `CALDAV:calendar-timezone` on every collection.
7. **Ship ICS/webcal subscriptions in v1, CalDAV-client mode in v1.5.** Copy Nextcloud's `RefreshWebcalService` shape (REFRESH-INTERVAL → X-PUBLISHED-TTL → configured default; strip todos/alarms/attachments; UID diffing for deletions) but improve on it: key the diff on `(UID, RECURRENCE-ID)`, never delete on a failed fetch, and add the SSRF denylist Nextcloud lacks. Use UUID keys so you do not repeat Nextcloud's colliding-id bug.
8. **Enforce read-only at the repository layer**, not the UI. `calendars.writable = false` → `403 calendar_read_only` from REST, MCP and the Android sync queue alike.
9. **Make `series_mode` (`single`/`future`/`all`) a required parameter** on any update or delete targeting a recurring event, in REST and MCP alike — Morgen's `seriesUpdateMode` is the precedent. Implement "aquest i els següents" by splitting the series (UNTIL + new master), not with `RANGE=THISANDFUTURE`.
10. **Rename `/api/v1/events/stream` to `/api/v1/stream`** immediately, before `/api/v1/events` is needed for CRUD. Keep `entity: 'event'` on the SSE wire but document that it carries component changes only.
11. **Keep events off the kanban board.** VEVENT has no `IN-PROCESS`. The Inbox/Per fer/Fent/Fet columns are tasks-only; the calendar's Inbox rail holds *undated tasks* awaiting scheduling — the Sunsama/Akiflow pattern.
12. **Weak task↔calendar link in v1, strong in v1.5.** Dragging a dated task on the grid moves the task's dates and renders a chip; "Bloqueja temps" later creates a real linked event. Never auto-convert a task into an event.
13. **Store ATTENDEE/ORGANIZER but do not send invitations in v1.** Set `SCHEDULE-AGENT=CLIENT`, offer in-app RSVP, and do not advertise `calendar-auto-schedule`. Defer RFC 6638 wholesale.
14. **Use `CLASS` as the household privacy control** in collective àmbits: `PRIVATE` events render as opaque busy blocks with no title to non-owners, enforced at serialisation in REST, MCP and CalDAV.
15. **Default AI tokens to `events:read`.** `events:write` is opt-in per token, every mutation returns an `audit_id` and writes an `entity_changes` row with `actor_kind='ai'`, and `subscriptions:manage` is never grantable to a non-human token.
16. **Build the 28-fixture acceptance corpus in §6 before writing the UI.** Every one of those cases has broken a shipping calendar product, and they are all cheap to test and expensive to discover in production.

---

## Sources

Primary specifications:

- RFC 5545 (iCalendar) — https://www.rfc-editor.org/rfc/rfc5545.html
- RFC 5545 §3.3.10 RRULE — https://icalendar.org/iCalendar-RFC-5545/3-3-10-recurrence-rule.html
- RFC 5545 §3.6.5 VTIMEZONE — https://icalendar.org/iCalendar-RFC-5545/3-6-5-time-zone-component.html
- RFC 5545 §3.6.6 VALARM — https://icalendar.org/iCalendar-RFC-5545/3-6-6-alarm-component.html
- RFC 5545 §3.8.4.4 RECURRENCE-ID — https://icalendar.org/iCalendar-RFC-5545/3-8-4-4-recurrence-id.html
- RFC 5545 §3.2.12 PARTSTAT — https://icalendar.org/iCalendar-RFC-5545/3-2-12-participation-status.html
- RFC 4791 (CalDAV) — https://www.rfc-editor.org/rfc/rfc4791.html
- RFC 4791 §9.9 CALDAV:time-range — https://icalendar.org/CalDAV-Access-RFC-4791/9-9-caldav-time-range-xml-element.html
- RFC 4791 §7.8.3 expanded retrieval example — https://icalendar.org/CalDAV-Access-RFC-4791/7-8-3-example-expanded-retrieval-of-recurring-events.html
- RFC 6578 (WebDAV Collection Synchronization) — https://www.rfc-editor.org/rfc/rfc6578.html
- RFC 6638 (CalDAV Scheduling) — https://www.rfc-editor.org/rfc/rfc6638.html
- RFC 7986 (New iCalendar Properties) — https://www.rfc-editor.org/rfc/rfc7986.html
- RFC 8984 (JSCalendar) — https://www.rfc-editor.org/rfc/rfc8984.html

Implementations:

- sabre/dav MySQL calendar schema — https://raw.githubusercontent.com/sabre-io/dav/master/examples/sql/mysql.calendars.sql
- sabre/vobject recurrence docs — https://sabre.io/vobject/recurrence/
- sabre/dav `CalendarQueryValidator` — https://github.com/QuingKhaos/sabre-dav/blob/master/lib/CalDAV/CalendarQueryValidator.php
- sabre/vobject issue #76 (orphan overrides on expand) — https://github.com/sabre-io/vobject/issues/76
- Radicale `radicale/item/filter.py` — https://raw.githubusercontent.com/Kozea/Radicale/master/radicale/item/filter.py
- Radicale CHANGELOG — https://github.com/Kozea/Radicale/blob/v3/CHANGELOG.md
- Nextcloud `RefreshWebcalService.php` — https://raw.githubusercontent.com/nextcloud/server/master/apps/dav/lib/CalDAV/WebcalCaching/RefreshWebcalService.php
- Nextcloud issue #49635 (calendar/subscription id collision) — https://github.com/nextcloud/server/issues/49635
- Nextcloud Calendar user manual — https://docs.nextcloud.com/server/latest/user_manual/en/groupware/calendar.html
- Xandikos — https://github.com/jelmer/xandikos and https://www.xandikos.org/
- DAVx⁵ technical information — https://manual.davx5.com/technical_information.html
- DAVx⁵ FAQ on recurring events — https://www.davx5.com/faq/recurring-events
- python-caldav issue #44 (expandable calendar search) — https://github.com/python-caldav/caldav/issues/44
- python-caldav issue #157 (client-side rrule parsing for broken servers) — https://github.com/python-caldav/caldav/issues/157

Products:

- Vikunja CalDAV docs — https://vikunja.io/docs/caldav/
- Google Calendar API Events resource — https://developers.google.com/workspace/calendar/api/v3/reference/events
- Google CalDAV API developer's guide — https://developers.google.com/workspace/calendar/caldav/v2/guide
- Apple EventKit — https://developer.apple.com/documentation/eventkit
- Android `CalendarContract.Instances` — https://developer.android.com/reference/android/provider/CalendarContract.Instances (and mirror https://stuff.mit.edu/afs/sipb/project/android/docs/reference/android/provider/CalendarContract.Instances.html)
- Morgen developer docs — https://docs.morgen.so/events , https://docs.morgen.so/introduction , https://docs.morgen.so/calendars
- jtx Board — https://jtx.techbee.at/ and https://jtx.techbee.at/sync-with-davx5
- Tasks.org CalDAV docs — https://tasks.org/docs/caldav_intro.html
- FullCalendar Event Object — https://fullcalendar.io/docs/event-object
- Apple ccs-calendarserver extensions directory — https://github.com/apple/ccs-calendarserver/tree/master/doc/Extensions

---

## UNVERIFIED

Items below were **not** confirmed against a primary source in this research pass. Treat as hypotheses; verify before implementing.

1. **`caldav-subscribed.txt` element names.** The Apple CalendarServer subscription extension (`CS:subscribed` resourcetype, `CS:source`, `CS:subscribed-strip-todos`/`-alarms`/`-attachments`, `CS:refreshrate`) — the raw file at `doc/Extensions/caldav-subscribed.txt` returned **404**. The sabre `calendarsubscriptions` column names (`striptodos`, `stripalarms`, `stripattachments`, `refreshrate`, `source`) **are** verified; the corresponding XML element names and namespace URI are **not**.
2. **Nextcloud's default subscription refresh interval.** The Nextcloud user manual states subscriptions refresh with "a default refresh interval of one week"; a community/config source indicates the `calendarSubscriptionRefreshRate` occ setting defaults to one day. `RefreshWebcalService.php` itself contains no hardcoded fallback. The true default is unresolved.
3. **Radicale's `CALDAV:expand` support level and version.** A changelog line ("report with enabled expand honors now provided filter proper") was seen in a search snippet, attributed to v3.5; the CHANGELOG was not fetched directly. The `delattr()`/`EXDATE` expansion bug was likewise reported via snippet, not read in source.
4. **Xandikos recurrence internals.** Confirmed only that it is Git/Dulwich-backed, uses the `icalendar` Python library, and stores VEVENT/VTODO/VJOURNAL. Its time-range/expand implementation details were not read.
5. **Radicale `max_instances` storage setting.** Referenced in a search snippet as a mitigation; not confirmed against Radicale's documented configuration options.
6. **Android `CalendarContract` full column list.** `BEGIN`, `END`, `EVENT_ID`, `START_DAY`, `END_DAY`, `START_MINUTE`, `END_MINUTE` and the "requires a time range" / "not writable" statements are confirmed via the MIT mirror and secondary sources. The exact set of `Events` columns cited (`EVENT_END_TIMEZONE`, `ORIGINAL_ID`, `ORIGINAL_ALL_DAY`, `MUTATORS`, `DIRTY`, `DELETED`) was **not** read from the current official reference — the developer.android.com page returned only navigation chrome on two attempts.
7. **FullCalendar `backgroundColor` / `borderColor` / `textColor`.** The fetched Event Object page listed `color` and `contrastColor` but not the three separate colour properties. Older FullCalendar versions definitely had them; the v6 surface should be re-checked before relying on either name.
8. **Amie, Sunsama, Akiflow internal data models.** Only marketing/comparison-blog level evidence was found for all three. The claim that they create a real backing calendar event when a task is dragged is **inferred from behaviour descriptions**, not from documentation. Morgen's `seriesUpdateMode`/`masterEventId`/`recurrenceId` shape **is** verified from its developer docs, but the Morgen API is described as closed beta and may change.
9. **jtx Board's internal table layout.** That it uses a single `ICalObject` entity with a component discriminator is **inferred** from its multi-component design and public description; the schema was not read from source. The VEVENT support is stated as a future intention, not shipped.
10. **`dmfs lib-recur` as the Tasks.org recurrence engine.** Suggested as a Kotlin option; not confirmed. `ical4j` **is** confirmed as ical4android/DAVx⁵'s library (from DAVx⁵'s own technical documentation).
11. **Node/TypeScript library choices.** `ical.js`, `rrule.js`, `luxon` are widely used but were not evaluated in this pass, and no specific VTIMEZONE-generation package was verified. Do a spike before committing; in particular verify RFC-correct `UNTIL`-vs-`DTSTART` type handling and RECURRENCE-ID override merging, which is where JS rrule libraries most often diverge from the RFC.
12. **The exact RFC 4791 §9.9 VTODO table.** Three representative rows were captured; the complete 8+-row table was not reproduced in full and must be read from the RFC before implementing VTODO time-range filtering.
13. **RFC 4791 §9.6.5 floating-time conversion wording.** The summary ("handling floating times by converting to UTC according to the specified timezone context") is a paraphrase from the fetch, not a verbatim quote. Re-read §9.6.5 before implementing `expand`.
14. **Google `eventType` and `eventLabelId`.** Captured from the current reference page; `eventLabelId` and `attendees[].asyncOperation` are recent additions whose stability was not assessed.
