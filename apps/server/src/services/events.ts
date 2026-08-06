/**
 * Servei d'esdeveniments. D8, docs/01 §5.
 *
 * **Un esdeveniment no és una tasca amb hores.** Els seus `STATUS` són TENTATIVE /
 * CONFIRMED / CANCELLED, no els d'una tasca; té `TRANSP`, que una tasca no té; i un
 * calendari extern subscrit només en pot produir d'aquests.
 *
 * **Els esdeveniments no surten mai al kanban.** Apareixen al calendari i, el dia que
 * toca, a l'Inbox.
 */

import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { dbBool } from '../db/bool.js';
import type { AuditContext } from '../audit/audited-transaction.js';
import type { MigrationDb } from '../db/migration-db.js';
import { expandOccurrences, splitSeries } from '../events/recurrence.js';
import { PolicyError, missingCapability, notFound } from '../policy/errors.js';
import { hasCapability, type Principal } from '../policy/principal.js';
import { assertScopeAccess, listScopes } from './scopes.js';

export interface CalendarRow {
  id: string;
  scope_id: string;
  project_id: string | null;
  name: string;
  color: string | null;
  kind: 'events' | 'todos';
  origin: 'local' | 'subscription';
}

export interface EventRow {
  id: string;
  calendar_id: string;
  uid: string;
  recurrence_id: string | null;
  summary: string;
  description: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string | null;
  all_day: number;
  timezone: string | null;
  status: 'TENTATIVE' | 'CONFIRMED' | 'CANCELLED';
  transparency: 'OPAQUE' | 'TRANSPARENT';
  rrule: string | null;
  rdate: string | null;
  exdate: string | null;
  version: number;
}

export async function listCalendars(db: MigrationDb, principal: Principal): Promise<CalendarRow[]> {
  if (!hasCapability(principal, 'events:read')) throw missingCapability('events:read');

  const scopes = await listScopes(db, principal);
  if (scopes.length === 0) return [];

  const rows = await sql<CalendarRow>`
    SELECT id, scope_id, project_id, name, color, kind, origin
    FROM calendars
    WHERE deleted_at IS NULL AND scope_id IN (${sql.join(scopes.map((s) => s.id))})
    ORDER BY name
  `.execute(db);

  return rows.rows;
}

export interface ListEventsOptions {
  from: string;
  to: string;
  scopeIds?: string[] | undefined;
}

export interface EventOccurrenceView {
  event_id: string;
  uid: string;
  recurrence_id: string | null;
  summary: string;
  location: string | null;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  scope_id: string;
  calendar_id: string;
  status: 'TENTATIVE' | 'CONFIRMED' | 'CANCELLED';
  is_override: boolean;
}

/**
 * Les ocurrències dins d'una finestra.
 *
 * `from` i `to` són **obligatoris** (docs/05 §4): sense finestra no hi ha manera de
 * decidir quantes ocurrències generar d'una regla infinita.
 *
 * Les instàncies modificades **substitueixen** l'ocurrència que els tocaria. Un mestre
 * setmanal amb una setmana moguda ha de donar quatre ocurrències, no cinc.
 */
export async function listEventOccurrences(
  db: MigrationDb,
  principal: Principal,
  options: ListEventsOptions,
): Promise<EventOccurrenceView[]> {
  if (!hasCapability(principal, 'events:read')) throw missingCapability('events:read');

  if (options.from === '' || options.to === '') {
    throw new PolicyError(
      'window-required',
      'Time window required',
      422,
      'Cal `from` i `to`: sense finestra no es poden expandir les repeticions.',
    );
  }
  if (Number.isNaN(Date.parse(options.from)) || Number.isNaN(Date.parse(options.to))) {
    throw new PolicyError(
      'window-invalid',
      'Invalid time window',
      422,
      '`from` i `to` han de ser instants ISO-8601 vàlids.',
    );
  }

  const scopes = await listScopes(db, principal);
  const allowed = scopes
    .map((s) => s.id)
    .filter((id) => options.scopeIds === undefined || options.scopeIds.includes(id));
  if (allowed.length === 0) return [];

  const rows = await sql<EventRow & { scope_id: string }>`
    SELECT e.id, e.calendar_id, e.uid, e.recurrence_id, e.summary, e.description,
           e.location, e.starts_at, e.ends_at, e.all_day, e.timezone, e.status,
           e.transparency, e.rrule, e.rdate, e.exdate, e.version, c.scope_id
    FROM events e
    JOIN calendars c ON c.id = e.calendar_id
    WHERE e.deleted_at IS NULL
      AND c.deleted_at IS NULL
      AND c.kind = 'events'
      AND c.scope_id IN (${sql.join(allowed)})
  `.execute(db);

  const masters = rows.rows.filter((row) => row.recurrence_id === null);
  const overrides = rows.rows.filter((row) => row.recurrence_id !== null);

  // Les excepcions s'indexen per (uid, recurrence_id): és el que les lliga a
  // l'ocurrència que substitueixen (D8).
  const overrideByKey = new Map(
    overrides.map((row) => [`${row.uid}|${new Date(row.recurrence_id!).toISOString()}`, row]),
  );

  const out: EventOccurrenceView[] = [];

  for (const master of masters) {
    const occurrences = expandOccurrences({
      startsAt: master.starts_at,
      endsAt: master.ends_at,
      rrule: master.rrule,
      rdate: parseJsonArray(master.rdate),
      exdate: parseJsonArray(master.exdate),
      from: options.from,
      to: options.to,
    });

    for (const occurrence of occurrences) {
      const override = overrideByKey.get(`${master.uid}|${occurrence.recurrenceId}`);
      if (override !== undefined) {
        // La instància modificada guanya i l'ocurrència del mestre desapareix: si
        // sortissin totes dues, una reunió moguda es veuria dues vegades.
        out.push(toView(override, master.scope_id, true));
        continue;
      }
      out.push({
        event_id: master.id,
        uid: master.uid,
        recurrence_id: master.rrule == null ? null : occurrence.recurrenceId,
        summary: master.summary,
        location: master.location,
        starts_at: occurrence.startsAt,
        ends_at: occurrence.endsAt,
        all_day: master.all_day === 1,
        scope_id: master.scope_id,
        calendar_id: master.calendar_id,
        status: master.status,
        is_override: false,
      });
    }
  }

  /**
   * Una excepció òrfena —importada sense el seu mestre— també ha de sortir.
   * `is_orphan_override` tolera aquest cas, que passa de veritat en importar
   * calendaris de tercers (docs/01 §5).
   */
  for (const override of overrides) {
    const hasMaster = masters.some((master) => master.uid === override.uid);
    if (hasMaster) continue;
    const start = new Date(override.starts_at).getTime();
    if (start >= Date.parse(options.from) && start < Date.parse(options.to)) {
      out.push(toView(override, override.scope_id, true));
    }
  }

  out.sort((a, b) => (a.starts_at < b.starts_at ? -1 : a.starts_at > b.starts_at ? 1 : 0));
  return out;
}

function toView(
  row: EventRow & { scope_id: string },
  scopeId: string,
  isOverride: boolean,
): EventOccurrenceView {
  return {
    event_id: row.id,
    uid: row.uid,
    recurrence_id: row.recurrence_id,
    summary: row.summary,
    location: row.location,
    starts_at: row.starts_at,
    ends_at: row.ends_at ?? row.starts_at,
    all_day: row.all_day === 1,
    scope_id: scopeId,
    calendar_id: row.calendar_id,
    status: row.status,
    is_override: isOverride,
  };
}

function parseJsonArray(raw: string | null): string[] | undefined {
  if (raw == null || raw === '') return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === 'string')
      : undefined;
  } catch {
    return undefined;
  }
}

export interface CreateEventInput {
  id?: string | undefined;
  calendar_id?: string | undefined;
  summary?: string | undefined;
  description?: string | undefined;
  location?: string | undefined;
  starts_at?: string | undefined;
  ends_at?: string | undefined;
  all_day?: boolean | undefined;
  timezone?: string | undefined;
  status?: 'TENTATIVE' | 'CONFIRMED' | 'CANCELLED' | undefined;
  transparency?: 'OPAQUE' | 'TRANSPARENT' | undefined;
  rrule?: string | undefined;
}

export async function createEvent(
  ctx: AuditContext,
  principal: Principal,
  input: CreateEventInput,
): Promise<{ event: EventRow; created: boolean }> {
  if (!hasCapability(principal, 'events:write')) throw missingCapability('events:write');

  if (
    input.calendar_id === undefined ||
    input.summary === undefined ||
    input.starts_at === undefined
  ) {
    throw new PolicyError(
      'event-incomplete',
      'Event incomplete',
      422,
      "Un esdeveniment necessita calendari, títol i instant d'inici.",
    );
  }

  const calendar = await loadCalendar(ctx.tx, input.calendar_id);
  await assertScopeAccess(ctx.tx, principal, calendar.scope_id);

  // Un calendari subscrit és de només lectura A LA CAPA DE REPOSITORI, no només a la
  // interfície (docs/01 §5): si no, el CalDAV i el sync hi podrien escriure igualment.
  if (calendar.origin === 'subscription') {
    throw new PolicyError(
      'calendar-read-only',
      'Calendar is read-only',
      403,
      `El calendari "${calendar.name}" és una subscripció i no s'hi pot escriure.`,
    );
  }
  if (calendar.kind !== 'events') {
    // RFC 4791 §5.2 prohibeix recursos de components mixtos (D9).
    throw new PolicyError(
      'wrong-component',
      'Wrong component type',
      403,
      `El calendari "${calendar.name}" és de tasques i no accepta esdeveniments.`,
    );
  }

  const id = input.id ?? uuidv7();
  const existing = await sql<EventRow>`SELECT * FROM events WHERE id = ${id}`.execute(ctx.tx);
  const already = existing.rows[0];
  if (already !== undefined) {
    ctx.noChange();
    return { event: already, created: false };
  }

  await sql`
    INSERT INTO events (id, calendar_id, uid, summary, description, location, starts_at,
                        ends_at, all_day, timezone, status, transparency, rrule,
                        sequence, created_at, updated_at, version)
    VALUES (${id}, ${input.calendar_id}, ${id}, ${input.summary}, ${input.description ?? null},
            ${input.location ?? null}, ${input.starts_at}, ${input.ends_at ?? null},
            ${dbBool(input.all_day === true)}, ${input.timezone ?? null},
            ${input.status ?? 'CONFIRMED'}, ${input.transparency ?? 'OPAQUE'},
            ${input.rrule ?? null}, 0, ${ctx.now}, ${ctx.now}, 1)
  `.execute(ctx.tx);

  // La col·lecció s'incrementa dins de la MATEIXA transacció: d'aquí surten el ctag i
  // el sync-token de CalDAV (docs/07 §4).
  await bumpSyncSeq(ctx.tx, input.calendar_id);

  ctx.record({
    entityType: 'event',
    entityId: id,
    scopeId: calendar.scope_id,
    verb: 'created',
  });

  const created = await sql<EventRow>`SELECT * FROM events WHERE id = ${id}`.execute(ctx.tx);
  const row = created.rows[0];
  if (row === undefined) throw notFound('esdeveniment', id);
  return { event: row, created: true };
}

export type SeriesMode = 'single' | 'future' | 'all';

/**
 * Modifica un esdeveniment segons `series_mode`.
 *
 * - `single` crea una **fila germana** amb el seu `RECURRENCE-ID` (D8).
 * - `future` **parteix la sèrie** i no emet mai `RANGE=THISANDFUTURE`.
 * - `all` toca el mestre.
 */
export async function updateEvent(
  ctx: AuditContext,
  principal: Principal,
  id: string,
  mode: SeriesMode,
  occurrence: string | undefined,
  input: CreateEventInput,
): Promise<EventRow> {
  if (!hasCapability(principal, 'events:write')) throw missingCapability('events:write');

  const found = await sql<EventRow>`
    SELECT * FROM events WHERE id = ${id} AND deleted_at IS NULL
  `.execute(ctx.tx);
  const master = found.rows[0];
  if (master === undefined) throw notFound('esdeveniment', id);

  const calendar = await loadCalendar(ctx.tx, master.calendar_id);
  await assertScopeAccess(ctx.tx, principal, calendar.scope_id, {
    type: "L'esdeveniment",
    id,
  });

  if ((mode === 'single' || mode === 'future') && occurrence === undefined) {
    throw new PolicyError(
      'occurrence-required',
      'Occurrence required',
      422,
      `El mode "${mode}" necessita saber quina ocurrència es toca.`,
    );
  }

  if (mode === 'all' || master.rrule == null) {
    await applyFields(ctx.tx, id, input, ctx.now);
    await bumpSyncSeq(ctx.tx, master.calendar_id);
    ctx.record({
      entityType: 'event',
      entityId: id,
      scopeId: calendar.scope_id,
      verb: 'updated',
    });
    return reload(ctx.tx, id);
  }

  if (mode === 'single') {
    // Una fila germana amb el mateix uid i el seu RECURRENCE-ID.
    const overrideId = uuidv7();
    await sql`
      INSERT INTO events (id, calendar_id, uid, recurrence_id, summary, description,
                          location, starts_at, ends_at, all_day, timezone, status,
                          transparency, sequence, created_at, updated_at, version)
      VALUES (${overrideId}, ${master.calendar_id}, ${master.uid}, ${occurrence!},
              ${input.summary ?? master.summary}, ${input.description ?? master.description},
              ${input.location ?? master.location}, ${input.starts_at ?? occurrence!},
              ${input.ends_at ?? master.ends_at}, ${master.all_day},
              ${input.timezone ?? master.timezone}, ${input.status ?? master.status},
              ${input.transparency ?? master.transparency}, 0, ${ctx.now}, ${ctx.now}, 1)
    `.execute(ctx.tx);

    await bumpSyncSeq(ctx.tx, master.calendar_id);
    ctx.record({
      entityType: 'event',
      entityId: overrideId,
      scopeId: calendar.scope_id,
      verb: 'created',
      changes: { recurrence_id: { from: null, to: occurrence } },
    });
    return reload(ctx.tx, overrideId);
  }

  // `future`: partir la sèrie.
  const split = splitSeries(master.rrule, occurrence!, master.starts_at);

  await sql`
    UPDATE events SET rrule = ${split.masterRrule}, updated_at = ${ctx.now},
                      version = version + 1
    WHERE id = ${id}
  `.execute(ctx.tx);

  const newId = uuidv7();
  await sql`
    INSERT INTO events (id, calendar_id, uid, summary, description, location, starts_at,
                        ends_at, all_day, timezone, status, transparency, rrule,
                        sequence, created_at, updated_at, version)
    VALUES (${newId}, ${master.calendar_id}, ${newId},
            ${input.summary ?? master.summary}, ${input.description ?? master.description},
            ${input.location ?? master.location}, ${input.starts_at ?? split.newStartsAt},
            ${input.ends_at ?? master.ends_at}, ${master.all_day},
            ${input.timezone ?? master.timezone}, ${input.status ?? master.status},
            ${input.transparency ?? master.transparency}, ${split.newRrule},
            0, ${ctx.now}, ${ctx.now}, 1)
  `.execute(ctx.tx);

  await bumpSyncSeq(ctx.tx, master.calendar_id);

  ctx.record({
    entityType: 'event',
    entityId: id,
    scopeId: calendar.scope_id,
    verb: 'updated',
    changes: { rrule: { from: master.rrule, to: split.masterRrule } },
  });
  ctx.record({
    entityType: 'event',
    entityId: newId,
    scopeId: calendar.scope_id,
    verb: 'created',
  });

  return reload(ctx.tx, newId);
}

async function applyFields(
  tx: MigrationDb,
  id: string,
  input: CreateEventInput,
  now: string,
): Promise<void> {
  await sql`
    UPDATE events SET
      summary = COALESCE(${input.summary ?? null}, summary),
      description = COALESCE(${input.description ?? null}, description),
      location = COALESCE(${input.location ?? null}, location),
      starts_at = COALESCE(${input.starts_at ?? null}, starts_at),
      ends_at = COALESCE(${input.ends_at ?? null}, ends_at),
      status = COALESCE(${input.status ?? null}, status),
      transparency = COALESCE(${input.transparency ?? null}, transparency),
      rrule = COALESCE(${input.rrule ?? null}, rrule),
      updated_at = ${now},
      sequence = sequence + 1,
      version = version + 1
    WHERE id = ${id}
  `.execute(tx);
}

/**
 * `sync_seq` és un comptador monòton que s'incrementa **dins de la transacció**
 * d'escriptura. D'aquí surten alhora el `ctag` i el `sync-token` de CalDAV, i és la raó
 * tècnica per la qual la superfície CalDAV no pot ser un procés a part (docs/01 §5).
 */
async function bumpSyncSeq(tx: MigrationDb, calendarId: string): Promise<void> {
  await sql`UPDATE calendars SET sync_seq = sync_seq + 1 WHERE id = ${calendarId}`.execute(tx);
}

async function loadCalendar(tx: MigrationDb, id: string): Promise<CalendarRow & { name: string }> {
  const found = await sql<CalendarRow>`
    SELECT id, scope_id, project_id, name, color, kind, origin
    FROM calendars WHERE id = ${id} AND deleted_at IS NULL
  `.execute(tx);
  const row = found.rows[0];
  if (row === undefined) throw notFound('calendari', id);
  return row;
}

async function reload(tx: MigrationDb, id: string): Promise<EventRow> {
  const found = await sql<EventRow>`SELECT * FROM events WHERE id = ${id}`.execute(tx);
  const row = found.rows[0];
  if (row === undefined) throw notFound('esdeveniment', id);
  return row;
}
