/**
 * `PUT` i `DELETE` al camí DAV (docs/07 §5).
 *
 * L'ordre és el de l'RFC i importa:
 *
 * 1. Es parseja l'iCalendar. Si no és vàlid, `400`.
 * 2. Es comprova que el component encaixi amb el `kind` de la col·lecció. Si no, `403`
 *    amb `supported-calendar-component`.
 * 3. Es guarda el component **cru** a `raw_ical` i se'n desen els camps modelats.
 * 4. S'incrementa `sync_seq` i es calcula el nou etag, **en la mateixa transacció**.
 * 5. Es retorna `201` o `204` amb la capçalera `ETag`.
 *
 * Tota escriptura que entra per aquí queda etiquetada `source='caldav'`, que és el que
 * evita que reboti cap a l'origen extern (docs/07 §9).
 */

import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { generatePosition } from '@fem-ho/contracts';
import { dbBool } from '../db/bool.js';
import { auditedTransaction, type AuditContext } from '../audit/audited-transaction.js';
import { assertScopeAccess } from '../services/scopes.js';
import { findCollection, type DavCollection } from './collections.js';
import { etagOf, getObject } from './objects.js';
import { IcalError, parseResource, type ParsedEvent, type ParsedTodo } from './parse-ical.js';
import { plain, type DavContext, type DavHandler } from './server.js';
import { CALDAV, caldav, dav, serialize } from './xml.js';
import type { DavPrincipal } from './auth.js';

/**
 * Les precondicions d'`If-Match` i `If-None-Match`.
 *
 * `If-None-Match: *` crea; `If-Match: <etag>` actualitza. Sense coincidència, **`412`**.
 * Sense cap de les dues, s'accepta: hi ha clients que no en posen i rebutjar-los faria
 * que no poguessin escriure mai.
 */
export type Precondition =
  { type: 'must-not-exist' } | { type: 'must-match'; etags: string[] } | { type: 'any' };

export function parsePrecondition(
  headers: Record<string, string | string[] | undefined>,
): Precondition {
  const ifNoneMatch = header(headers['if-none-match']);
  if (ifNoneMatch === '*') return { type: 'must-not-exist' };

  const ifMatch = header(headers['if-match']);
  if (ifMatch !== undefined && ifMatch !== '*') {
    return {
      type: 'must-match',
      // Un `If-Match` pot portar-ne diversos separats per comes, i els clients hi posen
      // el `W/` de l'etag feble encara que el nostre sigui fort.
      etags: ifMatch.split(',').map((etag) => etag.trim().replace(/^W\//u, '')),
    };
  }

  return { type: 'any' };
}

function header(value: string | string[] | undefined): string | undefined {
  return (Array.isArray(value) ? value[0] : value)?.trim();
}

export const put: DavHandler = async (context) => {
  if (context.resource.type !== 'object') {
    plain(context.response, 405, 'A PUT only applies to a calendar resource.');
    return;
  }

  const collection = await findCollection(
    context.connection.db,
    context.principal,
    context.resource.collection,
  );
  if (collection === undefined) {
    plain(context.response, 404, 'This collection does not exist.');
    return;
  }

  // Pas 1: parsejar. Un iCalendar il·legible és 400 i prou.
  let parsed;
  try {
    parsed = parseResource(context.body);
  } catch (error) {
    plain(context.response, 400, error instanceof IcalError ? error.message : 'Invalid iCalendar.');
    return;
  }

  // Pas 2: el component ha d'encaixar amb el tipus de la col·lecció.
  const expected = collection.kind === 'events' ? 'VEVENT' : 'VTODO';
  if (parsed.componentName !== expected) {
    /**
     * `403` amb `supported-calendar-component`, **no** `400`: el client ha d'entendre
     * que el recurs és vàlid però que aquesta col·lecció no el vol, i llavors el posa a
     * l'altra. Amb un 400 es pensa que el seu iCalendar està mal fet i el deixa córrer.
     */
    const body = serialize(dav('error', [caldav('supported-calendar-component', null)]));
    const bytes = Buffer.from(body, 'utf8');
    context.response.writeHead(403, {
      'Content-Type': 'application/xml; charset=utf-8',
      'Content-Length': String(bytes.length),
    });
    context.response.end(bytes);
    return;
  }

  const precondition = parsePrecondition(context.request.headers);
  const uid = context.resource.uid;

  const existing = await getObject(context.connection.db, context.principal, collection, uid);

  if (precondition.type === 'must-not-exist' && existing !== undefined) {
    plain(context.response, 412, 'This resource already exists.');
    return;
  }
  if (precondition.type === 'must-match') {
    if (existing === undefined) {
      plain(context.response, 412, 'This resource does not exist.');
      return;
    }
    if (!precondition.etags.includes(existing.etag)) {
      // Algú altre l'ha canviat des que el client se'l va emportar.
      plain(context.response, 412, 'The etag does not match: someone changed it in the meantime.');
      return;
    }
  }

  /**
   * Pas 4: **tot dins de la mateixa transacció.** L'etag es calcula sobre els bytes que
   * es guarden i es desa amb ells; calcular-lo després, en llegir, faria que un canvi
   * d'ordre del serialitzador rebaixés la col·lecció sencera a tots els clients.
   */
  const etag = etagOf(context.body);

  try {
    await auditedTransaction(
      context.connection.db,
      context.principal,
      async (ctx) => {
        if (collection.kind === 'todos') {
          await writeTodo(ctx, context.principal, collection, parsed.todos, uid, etag);
        } else {
          await writeEvent(ctx, collection, parsed.events, uid, etag, context.body);
        }
      },
      { engine: context.connection.engine },
    );
  } catch (error) {
    plain(context.response, 409, `Could not save: ${String(error)}`);
    return;
  }

  context.response.writeHead(existing === undefined ? 201 : 204, {
    ETag: etag,
    'Content-Length': '0',
  });
  context.response.end();
};

/**
 * Guarda un VTODO i les seves subtasques.
 *
 * L'ordre de components dins del recurs **no importa aquí**: primer es tria la mare
 * (la que no té `RELATED-TO;RELTYPE=PARENT`) i després les filles. Un client que les
 * escrigui al revés produeix exactament el mateix resultat.
 */
async function writeTodo(
  ctx: AuditContext,
  principal: DavPrincipal,
  collection: DavCollection,
  todos: ParsedTodo[],
  uid: string,
  etag: string,
): Promise<void> {
  await assertScopeAccess(ctx.tx, principal, collection.scopeId);

  const mare = todos.find((todo) => todo.parentUid === null) ?? todos[0];
  if (mare === undefined) throw new IcalError('El recurs no porta cap VTODO.');
  const filles = todos.filter((todo) => todo !== mare);

  const found = await sql<{ id: string; status: string; title: string }>`
    SELECT id, status, title FROM tasks
    WHERE scope_id = ${collection.scopeId}
      AND ${collection.projectId === null ? sql`project_id IS NULL` : sql`project_id = ${collection.projectId}`}
      AND COALESCE(caldav_uid, id) = ${uid}
  `.execute(ctx.tx);

  const row = found.rows[0];
  const taskId = row?.id ?? uuidv7();

  // La posició la porta la propietat pròpia si hi és; si no, al final de la columna.
  const position =
    mare.femho.position ??
    (row === undefined
      ? generatePosition(
          (
            await sql<{ position: string }>`
              SELECT position FROM tasks
              WHERE scope_id = ${collection.scopeId} AND status = ${mare.status}
                AND deleted_at IS NULL
              ORDER BY position DESC, id DESC LIMIT 1
            `.execute(ctx.tx)
          ).rows[0]?.position ?? null,
          null,
        )
      : null);

  if (row === undefined) {
    await sql`
      INSERT INTO tasks (id, scope_id, project_id, title, description, status, position,
                         due_date, due_time, completed_at, rrule, recurrence_mode,
                         origin, caldav_uid, caldav_etag, created_by, created_at, updated_at)
      VALUES (${taskId}, ${collection.scopeId}, ${collection.projectId}, ${mare.summary},
              ${mare.description}, ${mare.status}, ${position}, ${mare.dueDate}, ${mare.dueTime},
              ${mare.completedAt}, ${mare.rrule},
              ${mare.femho.recurrenceMode ?? 'schedule'},
              'caldav', ${uid}, ${etag}, ${principal.userId}, ${ctx.now}, ${ctx.now})
    `.execute(ctx.tx);

    ctx.record({
      entityType: 'task',
      entityId: taskId,
      scopeId: collection.scopeId,
      verb: 'created',
      changes: { title: { from: null, to: mare.summary } },
    });
  } else {
    await sql`
      UPDATE tasks SET title = ${mare.summary}, description = ${mare.description},
                       status = ${mare.status}, due_date = ${mare.dueDate},
                       due_time = ${mare.dueTime}, completed_at = ${mare.completedAt},
                       rrule = ${mare.rrule}, caldav_etag = ${etag},
                       ${position === null ? sql`` : sql`position = ${position},`}
                       updated_at = ${ctx.now}, version = version + 1
      WHERE id = ${taskId}
    `.execute(ctx.tx);

    ctx.record({
      entityType: 'task',
      entityId: taskId,
      scopeId: collection.scopeId,
      verb: 'updated',
      changes: {
        title: { from: row.title, to: mare.summary },
        status: { from: row.status, to: mare.status },
      },
    });
  }

  await syncSubtasks(ctx, taskId, filles);
}

/**
 * Posa les subtasques exactament com diu el recurs.
 *
 * Les que ja no hi surten s'esborren suaument: un `PUT` és l'estat **sencer** del
 * recurs, no un pedaç, i deixar-hi filles que el client ja no envia les faria
 * reaparèixer a cada sincronització.
 */
async function syncSubtasks(
  ctx: AuditContext,
  taskId: string,
  filles: ParsedTodo[],
): Promise<void> {
  const existents = await sql<{ id: string }>`
    SELECT id FROM subtasks WHERE task_id = ${taskId} AND deleted_at IS NULL
  `.execute(ctx.tx);
  const vius = new Set<string>();

  let anterior: string | null = null;
  for (const filla of filles) {
    const position: string = filla.femho.position ?? generatePosition(anterior, null);
    anterior = position;
    vius.add(filla.uid);

    // `subtasks` només guarda si està feta, no quan: el `COMPLETED` del component es
    // llegeix com un booleà.
    const fet = dbBool(filla.status === 'done' || filla.completedAt !== null);
    const ja = existents.rows.some((existent) => existent.id === filla.uid);
    if (ja) {
      await sql`
        UPDATE subtasks SET title = ${filla.summary}, done = ${fet},
                            position = ${position}, updated_at = ${ctx.now}
        WHERE id = ${filla.uid}
      `.execute(ctx.tx);
    } else {
      await sql`
        INSERT INTO subtasks (id, task_id, title, done, position, created_at, updated_at)
        VALUES (${filla.uid}, ${taskId}, ${filla.summary}, ${fet}, ${position},
                ${ctx.now}, ${ctx.now})
      `.execute(ctx.tx);
    }
  }

  for (const existent of existents.rows) {
    if (vius.has(existent.id)) continue;
    await sql`
      UPDATE subtasks SET deleted_at = ${ctx.now}, updated_at = ${ctx.now} WHERE id = ${existent.id}
    `.execute(ctx.tx);
  }
}

/** Guarda un VEVENT, amb els bytes originals sencers. */
async function writeEvent(
  ctx: AuditContext,
  collection: DavCollection,
  events: ParsedEvent[],
  uid: string,
  etag: string,
  raw: string,
): Promise<void> {
  if (collection.calendarId === null) {
    throw new IcalError('Aquesta col·lecció encara no té calendari.');
  }

  const mestre = events.find((event) => event.recurrenceId === null) ?? events[0];
  if (mestre === undefined) throw new IcalError('El recurs no porta cap VEVENT.');

  const found = await sql<{ id: string; summary: string }>`
    SELECT id, summary FROM events
    WHERE calendar_id = ${collection.calendarId} AND uid = ${uid} AND recurrence_id IS NULL
  `.execute(ctx.tx);

  const row = found.rows[0];
  const eventId = row?.id ?? uuidv7();

  if (row === undefined) {
    await sql`
      INSERT INTO events (id, calendar_id, uid, summary, description, location, starts_at,
                          ends_at, all_day, timezone, status, rrule, sequence, etag, raw_ical,
                          created_at, updated_at)
      VALUES (${eventId}, ${collection.calendarId}, ${uid}, ${mestre.summary}, ${mestre.description},
              ${mestre.location}, ${mestre.startsAt}, ${mestre.endsAt}, ${dbBool(mestre.allDay)},
              ${mestre.timezone}, ${mestre.status ?? 'CONFIRMED'}, ${mestre.rrule},
              ${mestre.sequence}, ${etag}, ${raw}, ${ctx.now}, ${ctx.now})
    `.execute(ctx.tx);

    ctx.record({
      entityType: 'event',
      entityId: eventId,
      scopeId: collection.scopeId,
      verb: 'created',
      changes: { summary: { from: null, to: mestre.summary } },
    });
    return;
  }

  await sql`
    UPDATE events SET summary = ${mestre.summary}, description = ${mestre.description},
                      location = ${mestre.location}, starts_at = ${mestre.startsAt},
                      ends_at = ${mestre.endsAt}, all_day = ${dbBool(mestre.allDay)},
                      timezone = ${mestre.timezone}, status = ${mestre.status ?? 'CONFIRMED'},
                      rrule = ${mestre.rrule}, sequence = ${mestre.sequence},
                      etag = ${etag}, raw_ical = ${raw},
                      updated_at = ${ctx.now}, version = version + 1
    WHERE id = ${eventId}
  `.execute(ctx.tx);

  ctx.record({
    entityType: 'event',
    entityId: eventId,
    scopeId: collection.scopeId,
    verb: 'updated',
    changes: { summary: { from: row.summary, to: mestre.summary } },
  });

  await bumpCalendar(ctx, collection.calendarId);
}

/**
 * Incrementa `sync_seq` **dins de la transacció d'escriptura**.
 *
 * És el motiu pel qual el camí DAV va al mateix procés que l'API (docs/07 §1): d'aquest
 * comptador surten el ctag i el sync-token, i un segon escriptor hauria de compartir
 * aquesta transacció.
 */
async function bumpCalendar(ctx: AuditContext, calendarId: string): Promise<void> {
  await sql`
    UPDATE calendars SET sync_seq = sync_seq + 1, updated_at = ${ctx.now} WHERE id = ${calendarId}
  `.execute(ctx.tx);
}

export const del: DavHandler = async (context: DavContext) => {
  if (context.resource.type !== 'object') {
    plain(context.response, 405, 'A DELETE only applies to a calendar resource.');
    return;
  }

  const collection = await findCollection(
    context.connection.db,
    context.principal,
    context.resource.collection,
  );
  if (collection === undefined) {
    plain(context.response, 404, 'This collection does not exist.');
    return;
  }

  const existing = await getObject(
    context.connection.db,
    context.principal,
    collection,
    context.resource.uid,
  );
  if (existing === undefined) {
    plain(context.response, 404, 'This resource does not exist.');
    return;
  }

  const precondition = parsePrecondition(context.request.headers);
  if (precondition.type === 'must-match' && !precondition.etags.includes(existing.etag)) {
    plain(context.response, 412, 'The etag does not match: someone changed it in the meantime.');
    return;
  }

  await auditedTransaction(
    context.connection.db,
    context.principal,
    async (ctx) => {
      const table = collection.kind === 'events' ? 'events' : 'tasks';
      await sql`
        UPDATE ${sql.raw(table)} SET deleted_at = ${ctx.now}, updated_at = ${ctx.now}
        WHERE id = ${existing.entityId}
      `.execute(ctx.tx);

      ctx.record({
        entityType: collection.kind === 'events' ? 'event' : 'task',
        entityId: existing.entityId,
        scopeId: collection.scopeId,
        verb: 'deleted',
        changes: {},
      });

      if (collection.calendarId !== null) await bumpCalendar(ctx, collection.calendarId);
    },
    { engine: context.connection.engine },
  );

  context.response.writeHead(204, { 'Content-Length': '0' });
  context.response.end();
};

/** L'espai de noms que fa servir l'error de component no suportat. */
export const SUPPORTED_COMPONENT_NS = CALDAV;
