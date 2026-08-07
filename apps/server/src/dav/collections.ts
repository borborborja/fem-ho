/**
 * Les col·leccions que publica Fem-ho.
 *
 * **Dues per contenidor, sempre** (D9 · docs/07 §2): una de `VEVENT` i una de `VTODO`.
 * RFC 4791 §5.2 prohibeix recursos de components mixtos, DAVx⁵ classifica una
 * col·lecció **només** per `supported-calendar-component-set`, Apple ho imposa a nivell
 * de sistema, i el CalDAV de Google no accepta VTODO.
 *
 * La de `todos` no té fila a `calendars`: les tasques viuen a `tasks` i el que hi ha
 * darrere és l'àmbit o el projecte. El `sync_seq` d'una col·lecció de tasques surt del
 * `change_log`, que és el mateix comptador que fa servir el sync de la web — o sigui que
 * un canvi fet des del kanban ja mou el ctag del CalDAV sense cap codi que ho enllaci.
 */

import { sql } from 'kysely';
import type { MigrationDb } from '../db/migration-db.js';
import { visibleScopesPredicate } from '../policy/scope-visibility.js';
import type { DavPrincipal } from './auth.js';
import { collectionName, slugify, type CollectionKind } from './paths.js';

export interface DavCollection {
  /** El nom que surt a la URL. */
  name: string;
  kind: CollectionKind;
  displayName: string;
  scopeId: string;
  projectId: string | null;
  color: string | null;
  /** La fila de `calendars`, si en té. Les de `todos` de l'espai general no en tenen. */
  calendarId: string | null;
  /** El comptador d'on surten ctag i sync-token. */
  syncSeq: number;
}

interface ScopeRow {
  id: string;
  name: string;
  color: string | null;
}

interface ProjectRow {
  id: string;
  scope_id: string;
  name: string;
}

interface CalendarRow {
  id: string;
  scope_id: string;
  project_id: string | null;
  sync_seq: number;
}

/**
 * Totes les col·leccions que un principal pot veure.
 *
 * Cada àmbit dona **l'espai general** (`project_id IS NULL`) i, a més, un contenidor per
 * projecte. Es fa amb tres consultes i es combina aquí: amb un `LEFT JOIN` a `projects`
 * l'espai general desapareixeria en el moment que l'àmbit tingués el primer projecte,
 * i les tasques sense projecte deixarien de ser visibles per CalDAV sense cap error.
 */
export async function listCollections(
  db: MigrationDb,
  principal: DavPrincipal,
): Promise<DavCollection[]> {
  const scopeFilter =
    principal.scopeIds === null
      ? sql`TRUE`
      : sql`s.id IN (${sql.join([...principal.scopeIds].map((id) => sql`${id}`))})`;

  const scopes = await sql<ScopeRow>`
    SELECT s.id, s.name, s.color
    FROM scopes s
    WHERE s.deleted_at IS NULL
      AND ${visibleScopesPredicate(principal.userId)}
      AND ${scopeFilter}
    ORDER BY s.name
  `.execute(db);

  if (scopes.rows.length === 0) return [];
  const scopeIds = sql.join(scopes.rows.map((scope) => sql`${scope.id}`));

  const projects = await sql<ProjectRow>`
    SELECT id, scope_id, name FROM projects
    WHERE scope_id IN (${scopeIds}) AND deleted_at IS NULL
    ORDER BY name
  `.execute(db);

  const calendars = await sql<CalendarRow>`
    SELECT id, scope_id, project_id, sync_seq FROM calendars
    WHERE scope_id IN (${scopeIds}) AND kind = 'events' AND deleted_at IS NULL
  `.execute(db);

  const taskSeqs = await taskSeqByContainer(db, scopeIds);
  const collections: DavCollection[] = [];
  const vistos = new Set<string>();

  for (const scope of scopes.rows) {
    const scopeSlug = slugify(scope.name);
    const contenidors: { project: ProjectRow | null }[] = [
      { project: null },
      ...projects.rows.filter((p) => p.scope_id === scope.id).map((project) => ({ project })),
    ];

    for (const { project } of contenidors) {
      const projectSlug = project === null ? null : slugify(project.name);
      const displayBase = project === null ? scope.name : `${scope.name} · ${project.name}`;
      const calendar = calendars.rows.find(
        (c) => c.scope_id === scope.id && (c.project_id ?? null) === (project?.id ?? null),
      );

      for (const kind of ['events', 'todos'] as const) {
        const base = collectionName(scopeSlug, projectSlug, kind);
        /**
         * Dos noms que es normalitzen igual donarien la mateixa URL. El primer es queda
         * el nom net i el segon hi afegeix un tros de l'identificador: ignorar-lo en
         * silenci amagaria un contenidor sencer, i publicar-lo repetit trencaria el client.
         */
        const name = vistos.has(base)
          ? `${base.slice(0, -kind.length - 1)}-${(project?.id ?? scope.id).slice(0, 8)}-${kind}`
          : base;
        vistos.add(name);

        collections.push({
          name,
          kind,
          displayName: kind === 'events' ? displayBase : `${displayBase} · tasks`,
          scopeId: scope.id,
          projectId: project?.id ?? null,
          color: scope.color,
          calendarId: kind === 'events' ? (calendar?.id ?? null) : null,
          syncSeq:
            kind === 'events'
              ? (calendar?.sync_seq ?? 0)
              : (taskSeqs.get(`${scope.id}:${project?.id ?? ''}`) ?? 0),
        });
      }
    }
  }

  return collections;
}

/** Una col·lecció pel seu nom, o `undefined` si el principal no la pot veure. */
export async function findCollection(
  db: MigrationDb,
  principal: DavPrincipal,
  name: string,
): Promise<DavCollection | undefined> {
  return (await listCollections(db, principal)).find((collection) => collection.name === name);
}

/**
 * L'últim `seq` de cada contenidor de tasques.
 *
 * **Per contenidor i no global.** Amb un comptador global, un canvi a qualsevol àmbit
 * mouria el ctag de totes les col·leccions i cada client se les tornaria a baixar
 * senceres: correcte, però una tempesta de trànsit a cada tecla.
 *
 * Surt del `change_log`, que és el mateix comptador que fa servir el sync de la web
 * (docs/06 §2): un canvi fet al kanban ja mou el ctag del CalDAV sense que ningú hagi
 * d'enllaçar les dues coses.
 */
async function taskSeqByContainer(
  db: MigrationDb,
  scopeIds: ReturnType<typeof sql.join>,
): Promise<Map<string, number>> {
  const found = await sql<{ scope_id: string; project_id: string | null; seq: number }>`
    SELECT t.scope_id, t.project_id, MAX(c.seq) AS seq
    FROM change_log c
    JOIN tasks t ON t.id = c.entity_id
    WHERE c.entity_type = 'task' AND t.scope_id IN (${scopeIds})
    GROUP BY t.scope_id, t.project_id
  `.execute(db);

  return new Map(
    found.rows.map((row) => [`${row.scope_id}:${row.project_id ?? ''}`, Number(row.seq)]),
  );
}

/**
 * L'últim `seq` del `change_log`.
 *
 * És el mateix comptador que fa servir el sync de la web (docs/06 §2), i fer-lo servir
 * també aquí és el que garanteix que un canvi fet al kanban mogui el ctag del CalDAV
 * sense que ningú s'hagi de recordar d'enllaçar-ho.
 */
export async function currentChangeSeq(db: MigrationDb): Promise<number> {
  const found = await sql<{ seq: number | null }>`SELECT MAX(seq) AS seq FROM change_log`.execute(
    db,
  );
  return Number(found.rows[0]?.seq ?? 0);
}

/**
 * El ctag d'una col·lecció.
 *
 * És una cadena **opaca**: el client només l'ha de comparar amb l'anterior. Es fa servir
 * el mateix format que el sync-token perquè un canvi es vegi als dos alhora.
 */
export function ctagOf(collection: DavCollection): string {
  return `${collection.kind}-${String(collection.syncSeq)}`;
}

/** El sync-token. Va com a URI perquè és el que RFC 6578 espera. */
export function syncTokenOf(collection: DavCollection): string {
  return `${SYNC_TOKEN_PREFIX}${String(collection.syncSeq)}`;
}

export const SYNC_TOKEN_PREFIX = 'https://fem-ho.local/ns/sync/';

/** El `seq` d'un sync-token, o `undefined` si no és nostre. */
export function parseSyncToken(token: string): number | undefined {
  if (!token.startsWith(SYNC_TOKEN_PREFIX)) return undefined;
  const seq = Number(token.slice(SYNC_TOKEN_PREFIX.length));
  return Number.isInteger(seq) && seq >= 0 ? seq : undefined;
}
