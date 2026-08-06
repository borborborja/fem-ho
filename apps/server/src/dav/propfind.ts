/**
 * `PROPFIND` (docs/07 §3).
 *
 * És la peça que decideix si un client veu res. **DAVx⁵ classifica una col·lecció només
 * per `supported-calendar-component-set`**: si no es respon bé, no ensenya cap
 * calendari i no diu per què.
 *
 * Les propietats que demana una petició es divideixen en dos `propstat`: les que s'han
 * pogut resoldre, amb `200 OK`, i les que no, amb `404 Not Found`. Respondre les
 * desconegudes amb `200` i el valor buit fa que els clients es pensin que existeixen i
 * les tornin a demanar per sempre.
 */

import type { MigrationDb } from '../db/migration-db.js';
import type { DavPrincipal } from './auth.js';
import { ctagOf, listCollections, syncTokenOf, type DavCollection } from './collections.js';
import { collectionPath, homePath, objectPath, principalPath, type DavResource } from './paths.js';
import {
  APPLE,
  CALDAV,
  CALENDARSERVER,
  DAV,
  caldav,
  child,
  dav,
  href as encodeHref,
  parseXml,
  qname,
  serialize,
  type XmlElement,
  type XmlNode,
} from './xml.js';

/** El que s'ha demanat: unes propietats concretes, els noms, o totes. */
export type PropRequest =
  | { type: 'prop'; names: { uri: string; local: string }[] }
  | { type: 'propname' }
  | { type: 'allprop' };

/**
 * Un cos buit o sense `prop` és `allprop` (RFC 4918 §9.1).
 *
 * Hi ha clients que envien `PROPFIND` sense cos, i tractar-ho com un error els deixa
 * fora del descobriment sencer.
 */
export function parsePropfind(body: string): PropRequest {
  const root = parseXml(body);
  if (root === undefined) return { type: 'allprop' };

  if (child(root, DAV, 'propname') !== undefined) return { type: 'propname' };

  const prop = child(root, DAV, 'prop');
  if (prop === undefined) return { type: 'allprop' };

  return {
    type: 'prop',
    names: prop.children.map((element: XmlElement) => ({ uri: element.uri, local: element.local })),
  };
}

/** Les propietats que es responen quan es demanen totes (docs/07 §3). */
const ALLPROP: { uri: string; local: string }[] = [
  { uri: DAV, local: 'resourcetype' },
  { uri: DAV, local: 'displayname' },
  { uri: DAV, local: 'current-user-principal' },
  { uri: DAV, local: 'owner' },
  { uri: DAV, local: 'supported-report-set' },
  { uri: DAV, local: 'current-user-privilege-set' },
  { uri: DAV, local: 'sync-token' },
  { uri: CALDAV, local: 'calendar-home-set' },
  { uri: CALDAV, local: 'supported-calendar-component-set' },
  { uri: CALDAV, local: 'calendar-description' },
  { uri: CALENDARSERVER, local: 'getctag' },
  { uri: APPLE, local: 'calendar-color' },
];

interface ResourceView {
  path: string;
  /** `undefined` per als recursos que no són una col·lecció de calendari. */
  collection?: DavCollection;
  isCollection: boolean;
  displayName: string;
}

/** Resol una propietat. `undefined` vol dir que aquest recurs no la té. */
function resolve(
  name: { uri: string; local: string },
  view: ResourceView,
  principal: DavPrincipal,
): XmlNode | undefined {
  const key = qname(name.uri, name.local);
  const { collection } = view;

  switch (key) {
    case qname(DAV, 'resourcetype'):
      if (collection !== undefined) {
        return dav('resourcetype', [dav('collection', null), caldav('calendar', null)]);
      }
      return dav('resourcetype', view.isCollection ? [dav('collection', null)] : []);

    case qname(DAV, 'displayname'):
      return dav('displayname', view.displayName);

    case qname(DAV, 'current-user-principal'):
      return dav('current-user-principal', [
        dav('href', encodeHref(principalPath(principal.davUser))),
      ]);

    case qname(DAV, 'principal-URL'):
      return dav('principal-URL', [dav('href', encodeHref(principalPath(principal.davUser)))]);

    case qname(DAV, 'owner'):
      return dav('owner', [dav('href', encodeHref(principalPath(principal.davUser)))]);

    case qname(DAV, 'supported-report-set'):
      // Els tres REPORT de docs/07 §4. Un client que no els vegi anunciats no els fa
      // servir, i cau a llegir la col·lecció sencera a cada sincronització.
      return dav(
        'supported-report-set',
        ['calendar-query', 'calendar-multiget']
          .map((report) => dav('supported-report', [dav('report', [caldav(report, null)])]))
          .concat(dav('supported-report', [dav('report', [dav('sync-collection', null)])])),
      );

    case qname(DAV, 'current-user-privilege-set'):
      return dav(
        'current-user-privilege-set',
        ['read', 'write', 'write-content', 'write-properties', 'bind', 'unbind'].map((privilege) =>
          dav('privilege', [dav(privilege, null)]),
        ),
      );

    case qname(CALDAV, 'calendar-home-set'):
      return caldav('calendar-home-set', [dav('href', encodeHref(homePath(principal.davUser)))]);

    case qname(CALDAV, 'calendar-user-address-set'):
      return caldav('calendar-user-address-set', [dav('href', `mailto:${principal.email}`)]);

    case qname(CALDAV, 'supported-calendar-component-set'):
      if (collection === undefined) return undefined;
      /**
       * **Protegida** (docs/07 §2): es fixa en crear la col·lecció i `PROPPATCH` no la
       * pot canviar. Aquesta és la propietat per la qual DAVx⁵ decideix si una col·lecció
       * és de tasques o d'esdeveniments.
       */
      return caldav('supported-calendar-component-set', [
        caldav('comp', null, { name: collection.kind === 'events' ? 'VEVENT' : 'VTODO' }),
      ]);

    case qname(CALDAV, 'calendar-description'):
      if (collection === undefined) return undefined;
      return caldav('calendar-description', view.displayName);

    case qname(CALENDARSERVER, 'getctag'):
      if (collection === undefined) return undefined;
      return { uri: CALENDARSERVER, local: 'getctag', body: ctagOf(collection) };

    case qname(DAV, 'sync-token'):
      if (collection === undefined) return undefined;
      return dav('sync-token', syncTokenOf(collection));

    case qname(APPLE, 'calendar-color'):
      if (collection === undefined || collection.color === null) return undefined;
      return { uri: APPLE, local: 'calendar-color', body: collection.color };

    case qname(DAV, 'getcontenttype'):
      if (collection === undefined) return undefined;
      return dav('getcontenttype', 'text/calendar; charset=utf-8');

    default:
      return undefined;
  }
}

/** Una `response` amb els dos `propstat`: el que s'ha trobat i el que no. */
export function responseFor(
  view: ResourceView,
  request: PropRequest,
  principal: DavPrincipal,
): XmlNode {
  const names = request.type === 'prop' ? request.names : ALLPROP;

  const found: XmlNode[] = [];
  const missing: XmlNode[] = [];

  for (const name of names) {
    if (request.type === 'propname') {
      // `propname` demana els NOMS, no els valors: es responen buits, i només els que
      // aquest recurs té de debò.
      if (resolve(name, view, principal) !== undefined) {
        found.push({ uri: name.uri, local: name.local, body: null });
      }
      continue;
    }

    const value = resolve(name, view, principal);
    if (value === undefined) missing.push({ uri: name.uri, local: name.local, body: null });
    else found.push(value);
  }

  const propstats: XmlNode[] = [];
  if (found.length > 0 || missing.length === 0) {
    propstats.push(dav('propstat', [dav('prop', found), dav('status', 'HTTP/1.1 200 OK')]));
  }
  if (missing.length > 0 && request.type !== 'propname') {
    propstats.push(
      dav('propstat', [dav('prop', missing), dav('status', 'HTTP/1.1 404 Not Found')]),
    );
  }

  return dav('response', [dav('href', encodeHref(view.path)), ...propstats]);
}

/** Construeix el `multistatus` sencer d'un `PROPFIND`. */
export async function buildPropfind(
  db: MigrationDb,
  principal: DavPrincipal,
  resource: DavResource,
  request: PropRequest,
  depth: string,
): Promise<{ xml: string; status: 207 } | { status: 404 }> {
  const views: ResourceView[] = [];

  switch (resource.type) {
    case 'root':
      views.push({ path: '/dav/', isCollection: true, displayName: 'Fem-ho' });
      break;

    case 'principal':
      views.push({
        path: principalPath(resource.user),
        isCollection: true,
        displayName: principal.email,
      });
      break;

    case 'home': {
      views.push({ path: homePath(resource.user), isCollection: true, displayName: 'Fem-ho' });
      if (depth !== '0') {
        for (const collection of await listCollections(db, principal)) {
          views.push({
            path: collectionPath(resource.user, collection.name),
            collection,
            isCollection: true,
            displayName: collection.displayName,
          });
        }
      }
      break;
    }

    case 'collection': {
      const collection = (await listCollections(db, principal)).find(
        (candidate) => candidate.name === resource.collection,
      );
      if (collection === undefined) return { status: 404 };

      views.push({
        path: collectionPath(resource.user, collection.name),
        collection,
        isCollection: true,
        displayName: collection.displayName,
      });

      if (depth !== '0') {
        for (const uid of await listObjectUids(db, principal, collection)) {
          views.push({
            path: objectPath(resource.user, collection.name, uid),
            isCollection: false,
            displayName: `${uid}.ics`,
          });
        }
      }
      break;
    }

    default:
      return { status: 404 };
  }

  return {
    status: 207,
    xml: serialize(
      dav(
        'multistatus',
        views.map((view) => responseFor(view, request, principal)),
      ),
    ),
  };
}

/**
 * Els UID d'una col·lecció.
 *
 * Els `getetag` per recurs els omple `objects.ts` a M10 (2/3); aquí només cal la llista
 * per poder respondre `Depth: 1` sobre la col·lecció.
 */
async function listObjectUids(
  db: MigrationDb,
  principal: DavPrincipal,
  collection: DavCollection,
): Promise<string[]> {
  const { listObjects } = await import('./objects.js');
  return (await listObjects(db, principal, collection)).map((object) => object.uid);
}
