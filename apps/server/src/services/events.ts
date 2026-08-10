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
import { dbBool, isTrue, maybeBool } from '../db/bool.js';
import type { AuditContext } from '../audit/audited-transaction.js';
import type { MigrationDb } from '../db/migration-db.js';
import { expandOccurrences, splitSeries } from '../events/recurrence.js';
import { PolicyError, missingCapability, notFound } from '../policy/errors.js';
import { hasCapability, type Principal } from '../policy/principal.js';
import { visibleCalendarIds } from '../policy/calendar-visibility.js';
import { defaultInInbox, isInInbox } from '../policy/inbox-visibility.js';
import { assertScopeAccess, assertScopeRole, listScopes } from './scopes.js';

export interface CalendarRow {
  id: string;
  scope_id: string;
  project_id: string | null;
  name: string;
  color: string | null;
  kind: 'events' | 'todos';
  origin: 'local' | 'subscription';
  /** De quina mena és la font externa: `caldav`, `ical` o `rss`. `null` si és local. */
  source_kind: 'caldav' | 'ical' | 'rss' | null;
  source_url: string | null;
  source_username: string | null;
  /**
   * **Bidireccional.** Només un CalDAV pot ser-ho: un `.ics` publicat i un RSS són
   * documents, no col·leccions on es pugui escriure.
   */
  writable: boolean;
  refresh_interval: number | null;
  last_refreshed_at: string | null;
  /** Per què va fallar l'últim refresc. Una font caiguda es veu igual que una buida. */
  last_error: string | null;
  /** Si els membres de l'àmbit el veuen. Defecte `false`: el silenci no comparteix. */
  shared_with_scope: boolean;
  /** Que la font porta credencials guardades. **Quines, no surt mai del servei.** */
  has_credentials: boolean;
  last_error_at: string | null;
  /**
   * Si aquesta font entra a la bústia. **Tri-estat**, i els tres valors volen dir coses
   * diferents: `null` és "no s'hi ha dit res i val el defecte", i `false` és "aquesta no,
   * encara que el defecte digui que sí". Llegir-lo com un booleà trauria de la bústia
   * tots els calendaris on ningú ha tocat res.
   */
  inbox_visible: boolean | null;
  /**
   * Què li tocaria si ningú digués res. **El calcula el servidor i no el client**: la
   * regla ("els calendaris sí, els RSS no") viu en un sol lloc, i així l'interruptor
   * d'Ajustos pot ensenyar la posició correcta sense duplicar-la.
   */
  inbox_visible_default: boolean;
}

/**
 * Un calendari tal com surt del servei.
 *
 * La base dona `inbox_visible` com a 0/1/NULL; aquí es torna un tri-estat de veritat i
 * s'hi afegeix el defecte calculat.
 */
function toCalendarRow(row: CalendarRow): CalendarRow {
  return {
    ...row,
    inbox_visible: maybeBool(row.inbox_visible),
    inbox_visible_default: defaultInInbox(row.origin, row.source_kind),
  };
}

/**
 * Les columnes que descriuen una font. Es llegeixen a tot arreu igual.
 *
 * **El secret no hi és.** `source_secret_enc` no surt mai del servei: una contrasenya
 * de CalDAV que viatgi a la interfície és una contrasenya que acaba a un registre.
 */
/**
 * Es pot escriure en aquest calendari?
 *
 * Un calendari subscrit és de només lectura **a la capa de repositori**, no només a la
 * interfície (docs/01 §5): si la regla només fos a la pantalla, el CalDAV i el sync hi
 * podrien escriure igualment i l'origen es trobaria coses que ningú hi ha posat.
 *
 * **L'excepció és una font bidireccional.** Un CalDAV amb credencials d'escriptura és
 * una col·lecció on Fem-ho pot escriure de veritat, i llavors bloquejar-ho aquí seria
 * fer de menys una cosa que l'usuari ha configurat expressament. Un `.ics` publicat i
 * un RSS no ho poden ser mai: són documents, no col·leccions.
 */
export function assertWritable(calendar: CalendarRow): void {
  if (calendar.origin !== 'subscription') return;
  if (isTrue(calendar.writable) && calendar.source_kind === 'caldav') return;

  throw new PolicyError(
    'calendar-read-only',
    'Calendar is read-only',
    403,
    `The "${calendar.name}" calendar is a read-only source and cannot be written to.`,
    { name: calendar.name },
  );
}

const CALENDAR_COLUMNS = sql`
  id, scope_id, project_id, name, color, kind, origin, source_kind, source_url,
  source_username, writable, refresh_interval, last_refreshed_at, last_error, last_error_at,
  shared_with_scope, inbox_visible,
  -- Que n'hi ha, no quin és. **El secret no surt mai del servei**, i la interfície
  -- necessita saber-ho per avisar abans de compartir el calendari.
  (source_secret_enc IS NOT NULL) AS has_credentials
`;

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
    SELECT ${CALENDAR_COLUMNS}
    FROM calendars
    WHERE deleted_at IS NULL AND scope_id IN (${sql.join(scopes.map((s) => s.id))})
    ORDER BY name
  `.execute(db);

  /**
   * **I es tallen els que no s'han compartit.** L'àmbit compartit arriba sencer, però un
   * calendari amb credencials d'un tercer no ha de sortir si el propietari no ho ha dit.
   */
  const visible = await visibleCalendarIds(db, principal.userId);
  return rows.rows.filter((row) => visible.has(row.id)).map(toCalendarRow);
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
      '`from` and `to` are needed: without a window, recurrences cannot be expanded.',
    );
  }
  if (Number.isNaN(Date.parse(options.from)) || Number.isNaN(Date.parse(options.to))) {
    throw new PolicyError(
      'window-invalid',
      'Invalid time window',
      422,
      '`from` and `to` have to be valid ISO-8601 instants.',
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

  // El mateix tall que a `listCalendars`: l'àmbit no basta, cal que el calendari s'hagi
  // compartit. Els esdeveniments no tenen `scope_id` propi i el treuen del calendari.
  const visible = await visibleCalendarIds(db, principal.userId);
  const rowsVisibles = rows.rows.filter((row) => visible.has(row.calendar_id));

  const masters = rowsVisibles.filter((row) => row.recurrence_id === null);
  const overrides = rowsVisibles.filter((row) => row.recurrence_id !== null);

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

/**
 * El que d'una font entra a la bústia d'un dia.
 *
 * **No és un `Task` i no ho ha de semblar mai.** No té `status`, no té `position`, i cap
 * identificador d'aquí pot arribar a `POST /tasks/{id}/move`. És la forma que pren la
 * regla 7 esmenada: un esdeveniment surt a la bústia com a font, mai com a targeta de
 * tasca.
 */
export interface InboxEvent {
  calendar_id: string;
  scope_id: string;
  uid: string;
  recurrence_id: string | null;
  summary: string;
  location: string | null;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  source_kind: 'caldav' | 'ical' | 'rss' | null;
  calendar_name: string;
  calendar_color: string | null;
}

export interface ListInboxEventsOptions {
  /** Els límits UTC del dia local de qui mira. Els dona `localDayBounds`. */
  from: string;
  to: string;
  scopeIds?: string[] | undefined;
}

/**
 * Els esdeveniments que li toquen a la bústia d'algú, un dia concret.
 *
 * **Es recolza sencera en `listEventOccurrences` i això no és mandra: és el punt.**
 * Aquella funció ja comprova la capacitat, ja resol els àmbits, ja expandeix les
 * recurrències amb les seves excepcions, i —el que més importa— **ja aplica
 * `visibleCalendarIds`**, que és el tall que impedeix que un calendari no compartit
 * s'escoli cap a algú altre de l'àmbit. Una segona consulta d'esdeveniments escrita a
 * part hauria pogut oblidar-se'l, i el capçal de `policy/calendar-visibility.ts` descriu
 * exactament aquell parany. Aquí no s'arriba a obrir.
 *
 * El que hi afegeix és només la decisió: quins d'aquells entren a la bústia, segons
 * `isInInbox`.
 */
export async function listInboxEvents(
  db: MigrationDb,
  principal: Principal,
  userId: string,
  options: ListInboxEventsOptions,
): Promise<InboxEvent[]> {
  /**
   * Sense `events:read` no hi ha esdeveniments, però **tampoc cap error**: la bústia és
   * de tasques i un token amb abast només de tasques l'ha de poder demanar igual. La
   * regla 9 diu que un abast més estret dona menys, no que peti.
   */
  if (!hasCapability(principal, 'events:read')) return [];

  const occurrences = await listEventOccurrences(db, principal, {
    from: options.from,
    to: options.to,
    scopeIds: options.scopeIds,
  });
  if (occurrences.length === 0) return [];

  const calendarIds = [...new Set(occurrences.map((o) => o.calendar_id))];

  const calendars = await sql<{
    id: string;
    name: string;
    color: string | null;
    origin: 'local' | 'subscription';
    source_kind: 'caldav' | 'ical' | 'rss' | null;
    inbox_visible: unknown;
  }>`
    SELECT id, name, color, origin, source_kind, inbox_visible
    FROM calendars WHERE id IN (${sql.join(calendarIds)})
  `.execute(db);
  const byCalendar = new Map(calendars.rows.map((row) => [row.id, row]));

  /**
   * Les marques d'aquest usuari. Es demanen només dels calendaris que han sortit, que a
   * la finestra d'un dia són pocs.
   */
  const marks = await sql<{
    calendar_id: string;
    uid: string;
    recurrence_id: string | null;
    visible: unknown;
  }>`
    SELECT calendar_id, uid, recurrence_id, visible
    FROM event_inbox_marks
    WHERE deleted_at IS NULL AND user_id = ${userId}
      AND calendar_id IN (${sql.join(calendarIds)})
  `.execute(db);
  const markAt = new Map(
    marks.rows.map((row) => [
      markKey(row.calendar_id, row.uid, row.recurrence_id),
      isTrue(row.visible),
    ]),
  );

  /**
   * De quins d'aquests esdeveniments ja se n'ha fet una tasca que segueix viva. És el
   * nivell 0 de la resolució, i el que evita veure la mateixa obligació dues vegades.
   */
  const derived = await sql<{ event_calendar_id: string; event_uid: string }>`
    SELECT DISTINCT event_calendar_id, event_uid FROM tasks
    WHERE deleted_at IS NULL AND event_uid IS NOT NULL
      AND event_calendar_id IN (${sql.join(calendarIds)})
  `.execute(db);
  const hasTask = new Set(
    derived.rows.map((row) => `${row.event_calendar_id}\u0000${row.event_uid}`),
  );

  const out: InboxEvent[] = [];
  for (const occurrence of occurrences) {
    const calendar = byCalendar.get(occurrence.calendar_id);
    if (calendar === undefined) continue;

    const visible = isInInbox({
      origin: calendar.origin,
      sourceKind: calendar.source_kind,
      calendarInboxVisible: maybeBool(calendar.inbox_visible),
      seriesMark: markAt.get(markKey(occurrence.calendar_id, occurrence.uid, null)) ?? null,
      occurrenceMark:
        occurrence.recurrence_id === null
          ? null
          : (markAt.get(
              markKey(occurrence.calendar_id, occurrence.uid, occurrence.recurrence_id),
            ) ?? null),
      hasLiveTask: hasTask.has(`${occurrence.calendar_id}\u0000${occurrence.uid}`),
    });
    if (!visible) continue;

    out.push({
      calendar_id: occurrence.calendar_id,
      scope_id: occurrence.scope_id,
      uid: occurrence.uid,
      recurrence_id: occurrence.recurrence_id,
      summary: occurrence.summary,
      location: occurrence.location,
      starts_at: occurrence.starts_at,
      ends_at: occurrence.ends_at,
      all_day: occurrence.all_day,
      source_kind: calendar.source_kind,
      calendar_name: calendar.name,
      calendar_color: calendar.color,
    });
  }
  return out;
}

/**
 * Posar, canviar o treure la marca d'un esdeveniment a la bústia d'algú.
 *
 * `visible: null` **treu la marca** i torna al defecte. No és el mateix que `false`: amb
 * `false` dius "aquest no, encara que el calendari digui que sí"; amb `null` dius "oblida
 * que en vaig dir res". Sense les dues coses no hi hauria manera de desdir-se'n.
 *
 * LA CAPACITAT ÉS `events:read`, I NO ÉS UN DESCUIT
 * ------------------------------------------------
 * Escriure aquí **no toca l'esdeveniment ni el calendari**: escriu una preferència teva
 * sobre una cosa que ja pots llegir. Exigir `events:write` voldria dir que un calendari
 * subscrit de només lectura no es pot silenciar mai — i és justament el cas que més ho
 * necessita, perquè un canal RSS que inunda no és teu i no el pots editar.
 *
 * I si el calendari no és visible per a aquesta persona, **403 i no 404**: el 404 diria
 * si aquell `uid` existeix o no, que és informació d'un calendari que no li han compartit.
 */
export async function setEventInboxVisibility(
  ctx: AuditContext,
  principal: Principal,
  userId: string,
  input: {
    calendarId: string;
    uid: string;
    recurrenceId?: string | null | undefined;
    visible: boolean | null;
  },
): Promise<{ visible: boolean | null; in_inbox: boolean }> {
  if (!hasCapability(principal, 'events:read')) throw missingCapability('events:read');

  const visibleCalendars = await visibleCalendarIds(ctx.tx, userId);
  if (!visibleCalendars.has(input.calendarId)) {
    throw new PolicyError(
      'calendar-not-visible',
      'Calendar not visible',
      403,
      'That calendar has not been shared with you.',
    );
  }

  const calendar = await loadCalendar(ctx.tx, input.calendarId);

  const recurrenceId = input.recurrenceId ?? null;
  const found = await sql<{ n: number }>`
    SELECT COUNT(*) AS n FROM events
    WHERE deleted_at IS NULL AND calendar_id = ${input.calendarId} AND uid = ${input.uid}
  `.execute(ctx.tx);
  if (Number(found.rows[0]?.n ?? 0) === 0) throw notFound('event', input.uid);

  const existing = await sql<{ id: string; visible: unknown }>`
    SELECT id, visible FROM event_inbox_marks
    WHERE deleted_at IS NULL AND user_id = ${userId} AND calendar_id = ${input.calendarId}
      AND uid = ${input.uid}
      AND ${recurrenceId === null ? sql`recurrence_id IS NULL` : sql`recurrence_id = ${recurrenceId}`}
  `.execute(ctx.tx);
  const row = existing.rows[0];
  const abans = row === undefined ? null : isTrue(row.visible);

  if (abans === input.visible) {
    // Reenviar el mateix no és un canvi d'estat (regla 6).
    ctx.noChange();
  } else if (input.visible === null) {
    await sql`
      UPDATE event_inbox_marks SET deleted_at = ${ctx.now}, updated_at = ${ctx.now},
                                   version = version + 1
      WHERE id = ${row!.id}
    `.execute(ctx.tx);
    ctx.record({
      entityType: 'event_inbox_mark',
      entityId: row!.id,
      // Sense àmbit **a posta**: el sync filtra per `change_log.scope_id`, i posar-hi
      // l'àmbit del calendari enviaria una preferència personal a tot l'àmbit.
      scopeId: null,
      verb: 'deleted',
    });
  } else if (row === undefined) {
    const id = uuidv7();
    await sql`
      INSERT INTO event_inbox_marks (id, user_id, calendar_id, uid, recurrence_id, visible,
                                     created_at, updated_at)
      VALUES (${id}, ${userId}, ${input.calendarId}, ${input.uid}, ${recurrenceId},
              ${dbBool(input.visible)}, ${ctx.now}, ${ctx.now})
    `.execute(ctx.tx);
    ctx.record({
      entityType: 'event_inbox_mark',
      entityId: id,
      scopeId: null,
      verb: 'created',
      changes: { visible: { from: null, to: input.visible } },
    });
  } else {
    await sql`
      UPDATE event_inbox_marks SET visible = ${dbBool(input.visible)}, updated_at = ${ctx.now},
                                   version = version + 1
      WHERE id = ${row.id}
    `.execute(ctx.tx);
    ctx.record({
      entityType: 'event_inbox_mark',
      entityId: row.id,
      scopeId: null,
      verb: 'updated',
      changes: { visible: { from: abans, to: input.visible } },
    });
  }

  /**
   * I es torna **el resultat de la resolució sencera**, no només el que s'ha desat: el
   * client no ha de recalcular mai si una cosa és a la bústia, perquè si ho fes hi
   * hauria dues implementacions de la mateixa regla i un dia divergirien.
   */
  const derived = await sql<{ n: number }>`
    SELECT COUNT(*) AS n FROM tasks
    WHERE deleted_at IS NULL AND event_calendar_id = ${input.calendarId}
      AND event_uid = ${input.uid}
  `.execute(ctx.tx);

  const seriesMark =
    recurrenceId === null
      ? input.visible
      : await markValue(ctx.tx, userId, input.calendarId, input.uid, null);

  return {
    visible: input.visible,
    in_inbox: isInInbox({
      origin: calendar.origin,
      sourceKind: calendar.source_kind,
      calendarInboxVisible: maybeBool(calendar.inbox_visible),
      seriesMark,
      occurrenceMark: recurrenceId === null ? null : input.visible,
      hasLiveTask: Number(derived.rows[0]?.n ?? 0) > 0,
    }),
  };
}

async function markValue(
  tx: MigrationDb,
  userId: string,
  calendarId: string,
  uid: string,
  recurrenceId: string | null,
): Promise<boolean | null> {
  const found = await sql<{ visible: unknown }>`
    SELECT visible FROM event_inbox_marks
    WHERE deleted_at IS NULL AND user_id = ${userId} AND calendar_id = ${calendarId}
      AND uid = ${uid}
      AND ${recurrenceId === null ? sql`recurrence_id IS NULL` : sql`recurrence_id = ${recurrenceId}`}
  `.execute(tx);
  const row = found.rows[0];
  return row === undefined ? null : isTrue(row.visible);
}

/**
 * La clau d'una marca.
 *
 * El separador és un `NUL` i no un guió perquè **l'uid d'un RSS ja porta un guió a dins**
 * (`"<calendarId>-<itemId>"`, veure `dav/rss.ts`) i l'itemId pot ser una URL sencera. Amb
 * un separador que pot sortir a les parts, dues identitats diferents poden donar la
 * mateixa clau, i la marca d'un titular acabaria amagant-ne un altre.
 */
function markKey(calendarId: string, uid: string, recurrenceId: string | null): string {
  return `${calendarId}\u0000${uid}\u0000${recurrenceId ?? ''}`;
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
      'An event needs a calendar, a title and a start instant.',
    );
  }

  const calendar = await loadCalendar(ctx.tx, input.calendar_id);
  await assertScopeAccess(ctx.tx, principal, calendar.scope_id);

  assertWritable(calendar);
  if (calendar.kind !== 'events') {
    // RFC 4791 §5.2 prohibeix recursos de components mixtos (D9).
    throw new PolicyError(
      'wrong-component',
      'Wrong component type',
      403,
      `The "${calendar.name}" calendar is for tasks and does not accept events.`,
      { name: calendar.name },
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
  if (row === undefined) throw notFound('event', id);
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
  if (master === undefined) throw notFound('event', id);

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
      `The "${mode}" mode needs to know which occurrence is being touched.`,
      { mode },
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
    SELECT ${CALENDAR_COLUMNS}
    FROM calendars WHERE id = ${id} AND deleted_at IS NULL
  `.execute(tx);
  const row = found.rows[0];
  if (row === undefined) throw notFound('calendar', id);
  return toCalendarRow(row);
}

async function reload(tx: MigrationDb, id: string): Promise<EventRow> {
  const found = await sql<EventRow>`SELECT * FROM events WHERE id = ${id}`.execute(tx);
  const row = found.rows[0];
  if (row === undefined) throw notFound('event', id);
  return row;
}

export async function getEvent(
  db: MigrationDb,
  principal: Principal,
  id: string,
): Promise<EventRow> {
  if (!hasCapability(principal, 'events:read')) throw missingCapability('events:read');

  const found = await sql<EventRow>`
    SELECT * FROM events WHERE id = ${id} AND deleted_at IS NULL
  `.execute(db);
  const row = found.rows[0];
  if (row === undefined) throw notFound('event', id);

  const calendar = await loadCalendar(db, row.calendar_id);
  await assertScopeAccess(db, principal, calendar.scope_id, { type: "L'esdeveniment", id });
  return row;
}

/**
 * Esborra un esdeveniment, amb el mateix `series_mode` que l'edició.
 *
 *   - `single`  — només aquesta ocurrència: s'hi afegeix un EXDATE al mestre, o s'esborra
 *                 la germana si l'ocurrència ja estava modificada.
 *   - `future`  — parteix la sèrie posant `UNTIL` al mestre. **Mai `RANGE=THISANDFUTURE`**,
 *                 que s'analitza però no s'emet (D8).
 *   - `all`     — el mestre i totes les germanes.
 */
export async function deleteEvent(
  ctx: AuditContext,
  principal: Principal,
  id: string,
  mode: SeriesMode = 'single',
  occurrence?: string | undefined,
): Promise<void> {
  if (!hasCapability(principal, 'events:delete')) throw missingCapability('events:delete');

  const found = await sql<EventRow>`
    SELECT * FROM events WHERE id = ${id} AND deleted_at IS NULL
  `.execute(ctx.tx);
  const event = found.rows[0];
  if (event === undefined) throw notFound('event', id);

  const calendar = await loadCalendar(ctx.tx, event.calendar_id);
  await assertScopeAccess(ctx.tx, principal, calendar.scope_id, { type: "L'esdeveniment", id });

  assertWritable(calendar);

  const esBorrarTot = mode === 'all' || event.rrule === null;

  if (esBorrarTot) {
    await sql`
      UPDATE events SET deleted_at = ${ctx.now}, updated_at = ${ctx.now}, version = version + 1
      WHERE (id = ${id} OR (uid = ${event.uid} AND calendar_id = ${event.calendar_id}))
        AND deleted_at IS NULL
    `.execute(ctx.tx);
  } else if (mode === 'future' && occurrence !== undefined) {
    // Esborrar "aquesta i les següents" és tallar la sèrie, no crear-ne cap de nova: el
    // mestre es queda amb un `UNTIL` just abans del tall i prou.
    const { masterRrule } = splitSeries(event.rrule!, occurrence, event.starts_at);
    await sql`
      UPDATE events SET rrule = ${masterRrule}, updated_at = ${ctx.now}, version = version + 1
      WHERE id = ${id}
    `.execute(ctx.tx);
    // Les germanes que caiguin dins del tros esborrat se'n van amb ell.
    await sql`
      UPDATE events SET deleted_at = ${ctx.now}, updated_at = ${ctx.now}, version = version + 1
      WHERE uid = ${event.uid} AND calendar_id = ${event.calendar_id}
        AND recurrence_id IS NOT NULL AND recurrence_id >= ${occurrence}
        AND deleted_at IS NULL
    `.execute(ctx.tx);
  } else {
    // `single` sobre una sèrie: un EXDATE, que és la manera d'iCalendar de dir "aquest dia
    // no". Esborrar la fila no serviria: el mestre la tornaria a generar.
    const dia = occurrence ?? event.starts_at;
    const exdate = event.exdate === null || event.exdate === '' ? dia : `${event.exdate},${dia}`;
    await sql`
      UPDATE events SET exdate = ${exdate}, updated_at = ${ctx.now}, version = version + 1
      WHERE id = ${id}
    `.execute(ctx.tx);
    await sql`
      UPDATE events SET deleted_at = ${ctx.now}, updated_at = ${ctx.now}, version = version + 1
      WHERE uid = ${event.uid} AND calendar_id = ${event.calendar_id}
        AND recurrence_id = ${dia} AND deleted_at IS NULL
    `.execute(ctx.tx);
  }

  await sql`
    UPDATE calendars SET sync_seq = sync_seq + 1, updated_at = ${ctx.now}
    WHERE id = ${event.calendar_id}
  `.execute(ctx.tx);

  ctx.record({
    entityType: 'event',
    entityId: id,
    scopeId: calendar.scope_id,
    verb: 'deleted',
  });
}

// ------------------------------------------------------------------ calendaris

export interface CreateCalendarInput {
  id?: string | undefined;
  scope_id?: string | undefined;
  project_id?: string | null | undefined;
  name?: string | undefined;
  color?: string | undefined;
  kind?: 'events' | 'todos' | undefined;
  origin?: 'local' | 'subscription' | undefined;
  /** `caldav`, `ical` o `rss`. Obligatori si `origin='subscription'`. */
  source_kind?: 'caldav' | 'ical' | 'rss' | undefined;
  source_url?: string | undefined;
  source_username?: string | undefined;
  /** Ja xifrat per qui crida: el servei no toca el secret de la instància. */
  source_secret_enc?: string | undefined;
  /** Bidireccional. Només un CalDAV pot ser-ho. */
  writable?: boolean | undefined;
  refresh_interval?: number | undefined;
  strip_alarms?: boolean | undefined;
}

export async function createCalendar(
  ctx: AuditContext,
  principal: Principal,
  input: CreateCalendarInput,
): Promise<{ calendar: CalendarRow; created: boolean }> {
  if (!hasCapability(principal, 'events:write')) throw missingCapability('events:write');

  if (input.scope_id === undefined || input.scope_id === '') {
    throw new PolicyError(
      'scope-required',
      'Scope required',
      422,
      'A calendar always belongs to a scope.',
    );
  }
  if (input.name === undefined || input.name.trim() === '') {
    throw new PolicyError('name-required', 'Name required', 422, 'El calendari necessita un nom.');
  }
  await assertScopeAccess(ctx.tx, principal, input.scope_id);

  const origin = input.origin ?? 'local';
  if (origin === 'subscription' && (input.source_url === undefined || input.source_url === '')) {
    throw new PolicyError(
      'source-url-required',
      'Source URL required',
      422,
      'A subscription needs the source URL.',
    );
  }

  const sourceKind = origin === 'subscription' ? (input.source_kind ?? 'ical') : null;
  /**
   * **Bidireccional només amb CalDAV.**
   *
   * Un `.ics` publicat i un canal RSS són documents: es baixen i prou. Acceptar-hi
   * `writable` faria que la interfície deixés editar una cosa que no arribarà mai a
   * l'origen, que és pitjor que no deixar-ho.
   */
  const writable = sourceKind === 'caldav' && input.writable === true;

  const id = input.id ?? uuidv7();
  const existing = await sql<CalendarRow>`
    SELECT ${CALENDAR_COLUMNS} FROM calendars WHERE id = ${id}
  `.execute(ctx.tx);
  if (existing.rows[0] !== undefined) {
    ctx.noChange();
    return { calendar: existing.rows[0], created: false };
  }

  await sql`
    INSERT INTO calendars (id, scope_id, project_id, name, color, kind, origin, source_kind,
                           source_url, source_username, source_secret_enc, writable,
                           refresh_interval, strip_alarms, sync_seq, created_at, updated_at)
    VALUES (${id}, ${input.scope_id}, ${input.project_id ?? null}, ${input.name.trim()},
            ${input.color ?? null}, ${input.kind ?? 'events'}, ${origin}, ${sourceKind},
            ${input.source_url ?? null}, ${input.source_username ?? null},
            ${input.source_secret_enc ?? null}, ${dbBool(writable)},
            ${input.refresh_interval ?? null},
            ${dbBool(input.strip_alarms !== false)}, 0, ${ctx.now}, ${ctx.now})
  `.execute(ctx.tx);

  ctx.record({
    entityType: 'calendar',
    entityId: id,
    scopeId: input.scope_id,
    verb: 'created',
  });

  const created = await sql<CalendarRow>`
    SELECT ${CALENDAR_COLUMNS} FROM calendars WHERE id = ${id}
  `.execute(ctx.tx);
  return { calendar: created.rows[0]!, created: true };
}

export async function updateCalendar(
  ctx: AuditContext,
  principal: Principal,
  id: string,
  input: {
    name?: string | undefined;
    color?: string | null | undefined;
    source_url?: string | undefined;
    source_username?: string | undefined;
    /** Ja xifrat. Absent vol dir "no la toquis", no "esborra-la". */
    source_secret_enc?: string | undefined;
    writable?: boolean | undefined;
    refresh_interval?: number | null | undefined;
    strip_alarms?: boolean | undefined;
    /** Si els membres de l'àmbit el veuen. **Només el propietari ho decideix.** */
    shared_with_scope?: boolean | undefined;
    /**
     * Si la font entra a la bústia.
     *
     * Tres valors i tots tres volen dir coses diferents: `undefined` és "no ho toquis",
     * `null` és **"treu l'excepció i torna al defecte"**, i un booleà és una excepció
     * explícita. Sense el `null` no hi hauria manera de desdir-se'n, i el calendari es
     * quedaria clavat al valor que se li va posar encara que el defecte canviés.
     */
    inbox_visible?: boolean | null | undefined;
  },
): Promise<CalendarRow> {
  if (!hasCapability(principal, 'events:write')) throw missingCapability('events:write');

  const calendar = await loadCalendar(ctx.tx, id);
  await assertScopeAccess(ctx.tx, principal, calendar.scope_id);

  /**
   * Compartir un calendari és una decisió de l'àmbit, no del contingut.
   *
   * Un col·laborador pot escriure esdeveniments; el que no pot és decidir què veuen els
   * altres. Es demana per separat i només quan es toca, perquè la resta del `PATCH`
   * —nom, color, interval— sí que és contingut.
   */
  if (input.shared_with_scope !== undefined) {
    await assertScopeRole(ctx.tx, principal, calendar.scope_id, 'settings');
  }

  /**
   * I treure una font de la bústia també, pel mateix motiu.
   *
   * L'interruptor és **del calendari i no de cada persona**: "aquest RSS inunda" és un
   * judici sobre la font. Però això vol dir que qui l'apaga l'apaga per a tothom de
   * l'àmbit, i per tant demana el mateix rol que compartir-lo.
   */
  if (input.inbox_visible !== undefined) {
    await assertScopeRole(ctx.tx, principal, calendar.scope_id, 'settings');
  }

  if (input.name !== undefined && input.name.trim() === '') {
    throw new PolicyError('name-required', 'Name required', 422, 'El calendari necessita un nom.');
  }

  const name = input.name?.trim() ?? calendar.name;
  const color = input.color === undefined ? calendar.color : input.color;

  /**
   * `writable` només es concedeix a un CalDAV.
   *
   * La ruta ja no ho hauria de deixar passar, però la regla viu **aquí**: el servei és
   * l'únic camí que tot travessa —REST, sync i MCP— i una invariant que només es
   * comprova a la porta no és una invariant.
   */
  const writable =
    input.writable === undefined ? undefined : input.writable && calendar.source_kind === 'caldav';

  await sql`
    UPDATE calendars SET name = ${name}, color = ${color},
      ${input.source_url === undefined ? sql`source_url = source_url` : sql`source_url = ${input.source_url}`},
      ${input.source_username === undefined ? sql`source_username = source_username` : sql`source_username = ${input.source_username}`},
      ${input.source_secret_enc === undefined ? sql`source_secret_enc = source_secret_enc` : sql`source_secret_enc = ${input.source_secret_enc}`},
      ${input.shared_with_scope === undefined ? sql`shared_with_scope = shared_with_scope` : sql`shared_with_scope = ${dbBool(input.shared_with_scope)}`},
      ${
        input.inbox_visible === undefined
          ? sql`inbox_visible = inbox_visible`
          : input.inbox_visible === null
            ? // Treure l'excepció: torna a valer el defecte de la seva mena de font.
              sql`inbox_visible = NULL`
            : sql`inbox_visible = ${dbBool(input.inbox_visible)}`
      },
      ${writable === undefined ? sql`writable = writable` : sql`writable = ${dbBool(writable)}`},
      ${input.refresh_interval === undefined ? sql`refresh_interval = refresh_interval` : sql`refresh_interval = ${input.refresh_interval}`},
      ${input.strip_alarms === undefined ? sql`strip_alarms = strip_alarms` : sql`strip_alarms = ${dbBool(input.strip_alarms)}`},
      updated_at = ${ctx.now}
    WHERE id = ${id}
  `.execute(ctx.tx);

  ctx.record({
    entityType: 'calendar',
    entityId: id,
    scopeId: calendar.scope_id,
    verb: 'updated',
    changes: { name: { from: calendar.name, to: name } },
  });

  return loadCalendar(ctx.tx, id);
}

/**
 * Esborrat suau d'un calendari.
 *
 * **Es nega si encara té esdeveniments**, per la mateixa raó que un àmbit amb tasques:
 * la cascada aquí seria irreversible des de la interfície. Una subscripció sí que se'n
 * va amb el que hagi portat, perquè el que hi ha a dins no l'ha escrit ningú d'aquí i es
 * pot tornar a baixar.
 */
export async function deleteCalendar(
  ctx: AuditContext,
  principal: Principal,
  id: string,
): Promise<void> {
  if (!hasCapability(principal, 'events:delete')) throw missingCapability('events:delete');

  const calendar = await loadCalendar(ctx.tx, id);
  await assertScopeAccess(ctx.tx, principal, calendar.scope_id);

  if (calendar.origin === 'subscription') {
    await sql`
      UPDATE events SET deleted_at = ${ctx.now}, updated_at = ${ctx.now}, version = version + 1
      WHERE calendar_id = ${id} AND deleted_at IS NULL
    `.execute(ctx.tx);
  } else {
    const pendents = await sql<{ n: number }>`
      SELECT COUNT(*) AS n FROM events WHERE calendar_id = ${id} AND deleted_at IS NULL
    `.execute(ctx.tx);
    const n = Number(pendents.rows[0]?.n ?? 0);
    if (n > 0) {
      throw new PolicyError(
        'calendar-not-empty',
        'Calendar not empty',
        409,
        `The "${calendar.name}" calendar still has ${String(n)} event(s). Move or delete them first.`,
        { name: calendar.name, count: n },
      );
    }
  }

  await sql`
    UPDATE calendars SET deleted_at = ${ctx.now}, updated_at = ${ctx.now} WHERE id = ${id}
  `.execute(ctx.tx);

  ctx.record({
    entityType: 'calendar',
    entityId: id,
    scopeId: calendar.scope_id,
    verb: 'deleted',
  });
}
