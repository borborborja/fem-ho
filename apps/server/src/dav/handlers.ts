/**
 * Els gestors de verbs del camí DAV.
 *
 * Cada verb és una funció i prou: la taula de despatx és a `server.ts`, i afegir-ne un
 * de nou no vol dir tocar el servidor.
 */

import { findCollection } from './collections.js';
import { getObject } from './objects.js';
import { buildPropfind, parsePropfind } from './propfind.js';
import { multiStatus, plain, type DavContext, type DavHandler } from './server.js';
import { report } from './report.js';

/**
 * `PROPFIND`.
 *
 * `Depth` per defecte és **infinit** segons RFC 4918, però un `Depth: infinity` sobre el
 * home recorreria totes les col·leccions i tots els seus recursos. Aquí es tracta com a
 * `1`, que és el que fan tots els servidors de producció i el que cap client necessita
 * que sigui d'una altra manera.
 */
export const propfind: DavHandler = async (context) => {
  const depth = depthOf(context);
  const request = parsePropfind(context.body);

  const result = await buildPropfind(
    context.connection.db,
    context.principal,
    context.resource,
    request,
    depth,
  );

  if (result.status === 404) {
    plain(context.response, 404, 'This resource does not exist.');
    return;
  }

  multiStatus(context.response, result.xml);
};

/** `REPORT`: `calendar-query`, `calendar-multiget` i `sync-collection` (docs/07 §4). */
export const reportHandler: DavHandler = async (context) => {
  await report(context);
};

/** `GET` d'un recurs: els bytes de l'iCalendar amb el seu etag. */
export const get: DavHandler = async (context) => {
  if (context.resource.type !== 'object') {
    plain(context.response, 405, 'This is not a calendar resource.');
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

  const object = await getObject(
    context.connection.db,
    context.principal,
    collection,
    context.resource.uid,
  );
  if (object === undefined) {
    plain(context.response, 404, 'This resource does not exist.');
    return;
  }

  const body = Buffer.from(object.ical, 'utf8');
  context.response.writeHead(200, {
    'Content-Type': 'text/calendar; charset=utf-8',
    'Content-Length': String(body.length),
    ETag: object.etag,
  });
  // `HEAD` passa per aquí amb el mateix codi: el que canvia és que no s'escriu el cos.
  context.response.end(context.request.method === 'HEAD' ? undefined : body);
};

/**
 * `PROPPATCH`.
 *
 * Es respon `207` amb `403` per propietat en comptes d'un `403` sencer: així el client
 * sap **quina** propietat no ha pogut canviar. `supported-calendar-component-set` és
 * protegida (docs/07 §2) i mai es pot canviar.
 */
export const proppatch: DavHandler = async (context) => {
  const { parseXml, child, DAV, dav, serialize, href } = await import('./xml.js');
  const root = parseXml(context.body);

  const names =
    root === undefined
      ? []
      : ['set', 'remove'].flatMap((verb) => {
          const section = child(root, DAV, verb);
          const prop = section === undefined ? undefined : child(section, DAV, 'prop');
          return prop?.children ?? [];
        });

  multiStatus(
    context.response,
    serialize(
      dav('multistatus', [
        dav('response', [
          dav('href', href(context.path)),
          dav('propstat', [
            dav(
              'prop',
              names.map((name) => ({ uri: name.uri, local: name.local, body: null })),
            ),
            dav('status', 'HTTP/1.1 403 Forbidden'),
          ]),
        ]),
      ]),
    ),
  );
};

function depthOf(context: DavContext): string {
  const header = context.request.headers.depth;
  const value = (Array.isArray(header) ? header[0] : header)?.trim() ?? 'infinity';
  return value === 'infinity' ? '1' : value;
}
