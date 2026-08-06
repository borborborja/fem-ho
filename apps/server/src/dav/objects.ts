/**
 * Els recursos d'una col·lecció: `{col·lecció}/{uid}.ics`.
 *
 * Una col·lecció de `todos` va contra `tasks` i una d'`events` contra `events`. El que
 * les iguala és aquesta capa, que en treu sempre la mateixa forma: `uid`, `etag`, `seq`
 * i els bytes.
 *
 * **L'etag es calcula un sol cop en escriure, sobre els bytes emmagatzemats** (docs/07
 * §4). Calcular-lo a cada lectura és l'error clàssic: si el serialitzador canvia l'ordre
 * de les propietats, l'etag canvia sense que hagi canviat res i tots els clients es
 * rebaixen la col·lecció sencera.
 */

import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import type { MigrationDb } from '../db/migration-db.js';
import type { DavPrincipal } from './auth.js';
import type { DavCollection } from './collections.js';

export interface DavObject {
  /** El nom del recurs sense `.ics`. */
  uid: string;
  etag: string;
  /** El `seq` del `change_log` on va canviar per última vegada. Mou el sync-token. */
  seq: number;
  /** L'identificador de la fila a la seva taula. */
  entityId: string;
  deleted: boolean;
}

export interface DavObjectBody extends DavObject {
  ical: string;
}

/**
 * L'etag d'uns bytes.
 *
 * Va entre cometes perquè RFC 9110 §8.8.3 ho exigeix, i els clients que comparen la
 * capçalera literalment fallen si no hi són.
 */
export function etagOf(bytes: string): string {
  return `"${createHash('sha256').update(bytes, 'utf8').digest('hex').slice(0, 32)}"`;
}

interface ObjectRow {
  entity_id: string;
  uid: string;
  etag: string | null;
  raw_ical: string | null;
  seq: number | null;
  deleted_at: string | null;
}

/**
 * Els recursos vius d'una col·lecció.
 *
 * `sinceSeq` els limita als que han canviat després d'aquell `seq`, que és el que
 * `sync-collection` necessita; sense ell, tots.
 */
export async function listObjects(
  db: MigrationDb,
  principal: DavPrincipal,
  collection: DavCollection,
  {
    sinceSeq,
    includeDeleted = false,
  }: { sinceSeq?: number | undefined; includeDeleted?: boolean } = {},
): Promise<DavObject[]> {
  const rows = await queryObjects(db, principal, collection, { sinceSeq, includeDeleted });
  return rows.map(toObject);
}

/** Un recurs concret amb els seus bytes, o `undefined`. */
export async function getObject(
  db: MigrationDb,
  principal: DavPrincipal,
  collection: DavCollection,
  uid: string,
): Promise<DavObjectBody | undefined> {
  const rows = await queryObjects(db, principal, collection, { uid, includeDeleted: false });
  const row = rows[0];
  if (row === undefined) return undefined;

  const { renderEvent, renderTodo } = await import('./ical.js');
  const ical =
    row.raw_ical ??
    (collection.kind === 'events'
      ? await renderEvent(db, row.entity_id)
      : await renderTodo(db, row.entity_id));

  return { ...toObject(row), ical };
}

function toObject(row: ObjectRow): DavObject {
  return {
    uid: row.uid,
    // Una fila sense etag guardat és una que encara no ha passat per cap escriptura
    // DAV. Se'n calcula un des dels bytes que hi ha, i la primera escriptura el fixa.
    etag: row.etag ?? etagOf(row.raw_ical ?? `${row.entity_id}:${String(row.seq ?? 0)}`),
    seq: Number(row.seq ?? 0),
    entityId: row.entity_id,
    deleted: row.deleted_at !== null,
  };
}

async function queryObjects(
  db: MigrationDb,
  principal: DavPrincipal,
  collection: DavCollection,
  options: { uid?: string | undefined; sinceSeq?: number | undefined; includeDeleted?: boolean },
): Promise<ObjectRow[]> {
  const table = collection.kind === 'events' ? 'events' : 'tasks';
  const entityType = collection.kind === 'events' ? 'event' : 'task';

  /**
   * El `seq` per recurs surt del `change_log` amb un `MAX`, no d'una columna a la fila.
   * Guardar-lo a la fila voldria dir escriure-la dues vegades per canvi, i el
   * `change_log` ja el té.
   */
  const seqJoin = sql`
    LEFT JOIN (
      SELECT entity_id, MAX(seq) AS seq FROM change_log
      WHERE entity_type = ${entityType} GROUP BY entity_id
    ) cl ON cl.entity_id = e.id
  `;

  const scopeFilter =
    collection.kind === 'events'
      ? sql`e.calendar_id = ${collection.calendarId}`
      : sql`e.scope_id = ${collection.scopeId} AND ${
          collection.projectId === null
            ? sql`e.project_id IS NULL`
            : sql`e.project_id = ${collection.projectId}`
        }`;

  const uidColumn = collection.kind === 'events' ? sql`e.uid` : sql`COALESCE(e.caldav_uid, e.id)`;

  const found = await sql<ObjectRow>`
    SELECT e.id AS entity_id,
           ${uidColumn} AS uid,
           ${collection.kind === 'events' ? sql`e.etag` : sql`e.caldav_etag`} AS etag,
           ${collection.kind === 'events' ? sql`e.raw_ical` : sql`NULL`} AS raw_ical,
           cl.seq AS seq,
           e.deleted_at AS deleted_at
    FROM ${sql.raw(table)} e
    ${seqJoin}
    WHERE ${scopeFilter}
      ${options.includeDeleted ? sql`` : sql`AND e.deleted_at IS NULL`}
      ${options.uid === undefined ? sql`` : sql`AND ${uidColumn} = ${options.uid}`}
      ${options.sinceSeq === undefined ? sql`` : sql`AND cl.seq > ${options.sinceSeq}`}
    ORDER BY cl.seq
  `.execute(db);

  // Una col·lecció d'esdeveniments sense fila a `calendars` no té recursos: la primera
  // escriptura la crearà.
  if (collection.kind === 'events' && collection.calendarId === null) return [];
  void principal;
  return found.rows;
}
