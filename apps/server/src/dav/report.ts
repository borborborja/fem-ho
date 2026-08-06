/**
 * Els tres `REPORT` (docs/07 §4).
 *
 * - **`calendar-query`** — filtre per component i rang de temps. RFC 4791 §9.9 defineix
 *   el solapament, i **les regles de VEVENT i VTODO són diferents**: dues funcions, no
 *   una amb un `if`.
 * - **`calendar-multiget`** — llista d'`href` i retorna aquests recursos.
 * - **`sync-collection`** — el delta.
 */

import { findCollection, parseSyncToken, syncTokenOf, type DavCollection } from './collections.js';
import { getObject, listObjects } from './objects.js';
import { objectPath, parsePath } from './paths.js';
import { multiStatus, plain, type DavContext } from './server.js';
import {
  CALDAV,
  DAV,
  attribute,
  caldav,
  child,
  children,
  dav,
  href as encodeHref,
  parseXml,
  serialize,
  type XmlElement,
  type XmlNode,
} from './xml.js';

export async function report(context: DavContext): Promise<void> {
  const root = parseXml(context.body);
  if (root === undefined) {
    plain(context.response, 400, 'A REPORT needs a body.');
    return;
  }

  if (context.resource.type !== 'collection') {
    plain(context.response, 403, 'This REPORT only applies to a collection.');
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

  const wantsData = wantsCalendarData(root);

  switch (`${root.uri} ${root.local}`) {
    case `${CALDAV} calendar-query`:
      await calendarQuery(context, collection, root, wantsData);
      return;
    case `${CALDAV} calendar-multiget`:
      await calendarMultiget(context, collection, root, wantsData);
      return;
    case `${DAV} sync-collection`:
      await syncCollection(context, collection, root, wantsData);
      return;
    default:
      plain(context.response, 400, `The "${root.local}" REPORT does not exist here.`);
  }
}

function wantsCalendarData(root: XmlElement): boolean {
  const prop = child(root, DAV, 'prop');
  return prop !== undefined && child(prop, CALDAV, 'calendar-data') !== undefined;
}

/** Un rang `<C:time-range start="…" end="…"/>`, en mil·lisegons. */
interface TimeRange {
  start?: number;
  end?: number;
}

function parseTimeRange(element: XmlElement | undefined): TimeRange | undefined {
  if (element === undefined) return undefined;
  const start = attribute(element, 'start');
  const end = attribute(element, 'end');
  return {
    ...(start === undefined ? {} : { start: parseIcalDate(start) }),
    ...(end === undefined ? {} : { end: parseIcalDate(end) }),
  };
}

/** `20260801T000000Z` → mil·lisegons. */
export function parseIcalDate(value: string): number {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/u.exec(value.trim());
  if (match === null) return Number.NaN;
  const [, y, mo, d, h = '00', mi = '00', s = '00'] = match;
  return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
}

/**
 * Solapament d'un **VEVENT** amb un rang (RFC 4791 §9.9).
 *
 * Un esdeveniment solapa si comença abans que s'acabi el rang i s'acaba després que el
 * rang comenci. Un esdeveniment sense final dura zero i es tracta com un instant.
 */
export function eventOverlaps(range: TimeRange, startsAt: number, endsAt: number | null): boolean {
  const end = endsAt ?? startsAt;
  if (range.end !== undefined && startsAt >= range.end) return false;
  if (range.start !== undefined && end < range.start) return false;
  // Un esdeveniment de durada zero just al límit inferior del rang hi entra; just al
  // superior, no. Aquesta asimetria és la de l'RFC, no una tria nostra.
  return true;
}

/**
 * Solapament d'un **VTODO**, que NO és el mateix (RFC 4791 §9.9).
 *
 * **Una tasca sense cap data hi encaixa sempre.** És la diferència que fa que barrejar
 * les dues regles en una funció amb un `if` acabi amagant tasques sense venciment a
 * qualsevol client que filtri per rang.
 */
export function todoOverlaps(
  range: TimeRange,
  { due, completed }: { due: number | null; completed: number | null },
): boolean {
  if (due === null && completed === null) return true;

  const instant = due ?? completed;
  if (instant === null) return true;
  if (range.start !== undefined && instant < range.start) return false;
  if (range.end !== undefined && instant >= range.end) return false;
  return true;
}

async function calendarQuery(
  context: DavContext,
  collection: DavCollection,
  root: XmlElement,
  wantsData: boolean,
): Promise<void> {
  const filter = child(root, CALDAV, 'filter');
  const vcalendar = filter === undefined ? undefined : child(filter, CALDAV, 'comp-filter');
  const component = vcalendar === undefined ? undefined : child(vcalendar, CALDAV, 'comp-filter');
  const wanted = component === undefined ? undefined : attribute(component, 'name')?.toUpperCase();

  // Un filtre per un component que aquesta col·lecció no serveix torna zero recursos,
  // no un error: és una pregunta legítima amb una resposta buida.
  const serves = collection.kind === 'events' ? 'VEVENT' : 'VTODO';
  if (wanted !== undefined && wanted !== serves) {
    multiStatus(context.response, serialize(dav('multistatus', [])));
    return;
  }

  const range = parseTimeRange(
    component === undefined ? undefined : child(component, CALDAV, 'time-range'),
  );

  const objects = await listObjects(context.connection.db, context.principal, collection);
  const responses: XmlNode[] = [];

  for (const object of objects) {
    const body =
      wantsData || range !== undefined
        ? await getObject(context.connection.db, context.principal, collection, object.uid)
        : undefined;

    if (range !== undefined && body !== undefined && !matchesRange(collection, body.ical, range)) {
      continue;
    }

    responses.push(
      responseFor(context, collection, object.uid, object.etag, wantsData ? body?.ical : undefined),
    );
  }

  multiStatus(context.response, serialize(dav('multistatus', responses)));
}

/** Aplica el rang a uns bytes, amb la funció que toca segons el tipus de col·lecció. */
function matchesRange(collection: DavCollection, ical: string, range: TimeRange): boolean {
  if (collection.kind === 'events') {
    const start = firstDate(ical, 'DTSTART');
    const end = firstDate(ical, 'DTEND');
    if (start === null) return true;
    return eventOverlaps(range, start, end);
  }

  return todoOverlaps(range, {
    due: firstDate(ical, 'DUE'),
    completed: firstDate(ical, 'COMPLETED'),
  });
}

/**
 * La primera data d'una propietat, llegida dels bytes.
 *
 * Es llegeix del text i no es reparseja el component sencer: per filtrar un rang només
 * calen dues línies, i muntar l'arbre de cada recurs per descartar-lo és el que fa que
 * un `calendar-query` sobre una col·lecció gran trigui segons.
 */
function firstDate(ical: string, property: string): number | null {
  const match = new RegExp(`^${property}[^:\\r\\n]*:(.+)$`, 'mu').exec(ical);
  if (match?.[1] === undefined) return null;
  const value = parseIcalDate(match[1]);
  return Number.isNaN(value) ? null : value;
}

async function calendarMultiget(
  context: DavContext,
  collection: DavCollection,
  root: XmlElement,
  wantsData: boolean,
): Promise<void> {
  const responses: XmlNode[] = [];

  for (const element of children(root, DAV, 'href')) {
    const resource = parsePath(element.text.trim());
    if (resource.type !== 'object' || resource.collection !== collection.name) {
      // Un href que no és d'aquesta col·lecció es respon amb un 404 propi, no
      // s'ignora: el client espera una resposta per cada href que ha demanat.
      responses.push(
        dav('response', [
          dav('href', encodeHref(element.text.trim())),
          dav('status', 'HTTP/1.1 404 Not Found'),
        ]),
      );
      continue;
    }

    const object = await getObject(
      context.connection.db,
      context.principal,
      collection,
      resource.uid,
    );

    if (object === undefined) {
      responses.push(
        dav('response', [
          dav('href', encodeHref(element.text.trim())),
          dav('status', 'HTTP/1.1 404 Not Found'),
        ]),
      );
      continue;
    }

    responses.push(
      responseFor(
        context,
        collection,
        object.uid,
        object.etag,
        wantsData ? object.ical : undefined,
      ),
    );
  }

  multiStatus(context.response, serialize(dav('multistatus', responses)));
}

/**
 * `sync-collection`: el delta des d'un token.
 *
 * Un token massa vell es respon amb **`507`** i el client fa una sincronització completa
 * (docs/07 §4). La retenció és la del `change_log`, la mateixa que fa servir el sync de
 * la web: una sola política i no dues que es puguin desincronitzar.
 */
async function syncCollection(
  context: DavContext,
  collection: DavCollection,
  root: XmlElement,
  wantsData: boolean,
): Promise<void> {
  const tokenElement = child(root, DAV, 'sync-token');
  const raw = tokenElement?.text.trim() ?? '';

  let since: number | undefined;
  if (raw !== '') {
    const parsed = parseSyncToken(raw);
    if (parsed === undefined) {
      // 507 i no 400: el client sap què fer amb un 507 —tornar a baixar-ho tot— i amb
      // un 400 només sap que alguna cosa ha anat malament.
      plain(context.response, 507, 'This sync-token is no longer valid. A full sync is needed.');
      return;
    }
    since = parsed;
  }

  const objects = await listObjects(context.connection.db, context.principal, collection, {
    ...(since === undefined ? {} : { sinceSeq: since }),
    includeDeleted: true,
  });

  const responses: XmlNode[] = [];
  for (const object of objects) {
    if (object.deleted) {
      // Una tombstone: `404` dins del multistatus. Sense això el client es queda la
      // fila per sempre i l'esborrat no arriba mai.
      responses.push(
        dav('response', [
          dav(
            'href',
            encodeHref(objectPath(context.principal.davUser, collection.name, object.uid)),
          ),
          dav('status', 'HTTP/1.1 404 Not Found'),
        ]),
      );
      continue;
    }

    const body = wantsData
      ? await getObject(context.connection.db, context.principal, collection, object.uid)
      : undefined;

    responses.push(
      responseFor(context, collection, object.uid, object.etag, wantsData ? body?.ical : undefined),
    );
  }

  multiStatus(
    context.response,
    serialize(dav('multistatus', [...responses, dav('sync-token', syncTokenOf(collection))])),
  );
}

function responseFor(
  context: DavContext,
  collection: DavCollection,
  uid: string,
  etag: string,
  ical: string | undefined,
): XmlNode {
  const props: XmlNode[] = [dav('getetag', etag)];
  if (ical !== undefined) props.push(caldav('calendar-data', ical));

  return dav('response', [
    dav('href', encodeHref(objectPath(context.principal.davUser, collection.name, uid))),
    dav('propstat', [dav('prop', props), dav('status', 'HTTP/1.1 200 OK')]),
  ]);
}
