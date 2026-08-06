/**
 * Les URL del camí DAV (docs/07 §2).
 *
 * ```
 * /dav/
 *   principals/{user}/
 *   calendars/{user}/
 *     {scope-slug}-events/          VEVENT de l'espai general
 *     {scope-slug}-todos/           VTODO de l'espai general
 *     {scope-slug}-{project-slug}-events/
 *     {scope-slug}-{project-slug}-todos/
 *       {uid}.ics
 * ```
 *
 * **Dues col·leccions per contenidor, sempre** (D9).
 */

export const DAV_ROOT = '/dav';

export type CollectionKind = 'events' | 'todos';

export type DavResource =
  | { type: 'root' }
  | { type: 'well-known' }
  | { type: 'principals' }
  | { type: 'principal'; user: string }
  | { type: 'home'; user: string }
  | { type: 'collection'; user: string; collection: string; kind: CollectionKind }
  | { type: 'object'; user: string; collection: string; kind: CollectionKind; uid: string }
  | { type: 'unknown' };

/**
 * Un identificador llegible per a una URL, a partir d'un nom en català.
 *
 * `l·l` es desfà a `ll` **abans** de treure els accents: si es fes al revés, el punt
 * volat es quedaria sol i sortiria un `l-l` que no s'assembla a res. El resultat només
 * s'ha de veure a la barra d'adreces d'un client CalDAV, però hi apareix.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replaceAll('l·l', 'll')
    .replaceAll('·', '')
    .replaceAll("'", '')
    .replaceAll('’', '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 60);
}

/**
 * El nom d'una col·lecció. **Sempre acaba en `-events` o `-todos`**.
 *
 * El sufix no és decoratiu: DAVx⁵ classifica una col·lecció només per
 * `supported-calendar-component-set`, i tenir-ho també al nom fa que un humà que miri
 * la llista entengui per què n'hi ha dues.
 */
export function collectionName(
  scopeSlug: string,
  projectSlug: string | null,
  kind: CollectionKind,
): string {
  return projectSlug === null ? `${scopeSlug}-${kind}` : `${scopeSlug}-${projectSlug}-${kind}`;
}

/** El tipus de component d'una col·lecció pel seu nom, o `undefined` si no en té. */
export function kindOf(collection: string): CollectionKind | undefined {
  if (collection.endsWith('-events')) return 'events';
  if (collection.endsWith('-todos')) return 'todos';
  return undefined;
}

/**
 * Interpreta una ruta.
 *
 * Es descodifica **un sol cop**. Express 5 fa doble descodificació dels `href` i això
 * trenca els UID amb caràcters escapats (docs/07 §1); aquí es fa a mà per no heretar
 * aquell error.
 */
export function parsePath(rawPath: string): DavResource {
  const path = rawPath.split('?')[0] ?? '';

  if (path === '/.well-known/caldav' || path === '/.well-known/caldav/') {
    return { type: 'well-known' };
  }

  const segments = path
    .split('/')
    .filter((segment) => segment !== '')
    .map(decodeSegment);

  if (segments[0] !== 'dav') return { type: 'unknown' };
  if (segments.length === 1) return { type: 'root' };

  const [, area, user, collection, object, ...rest] = segments;
  if (rest.length > 0) return { type: 'unknown' };

  if (area === '.well-known') return { type: 'well-known' };

  if (area === 'principals') {
    if (user === undefined) return { type: 'principals' };
    if (collection !== undefined) return { type: 'unknown' };
    return { type: 'principal', user };
  }

  if (area !== 'calendars' || user === undefined) return { type: 'unknown' };
  if (collection === undefined) return { type: 'home', user };

  const kind = kindOf(collection);
  if (kind === undefined) return { type: 'unknown' };
  if (object === undefined) return { type: 'collection', user, collection, kind };

  // Només `.ics`: qualsevol altra extensió dins d'una col·lecció no és un recurs de
  // calendari, i respondre-hi com si ho fos confon el client més que un 404.
  if (!object.endsWith('.ics')) return { type: 'unknown' };
  return { type: 'object', user, collection, kind, uid: object.slice(0, -'.ics'.length) };
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    // Un `%` solt no és un error del servidor: és un segment que val literalment això.
    return segment;
  }
}

export function principalPath(user: string): string {
  return `${DAV_ROOT}/principals/${user}/`;
}

export function homePath(user: string): string {
  return `${DAV_ROOT}/calendars/${user}/`;
}

export function collectionPath(user: string, collection: string): string {
  return `${DAV_ROOT}/calendars/${user}/${collection}/`;
}

export function objectPath(user: string, collection: string, uid: string): string {
  return `${DAV_ROOT}/calendars/${user}/${collection}/${uid}.ics`;
}
