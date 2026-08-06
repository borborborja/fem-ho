/**
 * Sincronització. docs/06.
 *
 * El contracte l'implementen **dos clients** —la web (PWA) i Android— i han de fer-ho
 * igual. Per això és un document a part i no un apartat d'Android, i per això el servei
 * no sap res de cap dels dos.
 *
 * Tres propietats que fan que funcioni, i que ja són al model de dades:
 *   - Els identificadors els genera el client (D4). Crear offline no necessita resposta.
 *   - Les posicions les calcula el client (D3). Moure offline dona la clau definitiva.
 *   - Res s'esborra de veritat. Un esborrat és una tombstone que es pot sincronitzar.
 */

import { sql } from 'kysely';
import type { AuditContext } from '../audit/audited-transaction.js';
import type { MigrationDb } from '../db/migration-db.js';
import { PolicyError, missingCapability } from '../policy/errors.js';
import { hasCapability, type Principal } from '../policy/principal.js';
import { listScopes } from './scopes.js';
import { clampInt } from '../util/clamp.js';

/** Les tombstones es conserven 90 dies (docs/01 §12). */
export const TOMBSTONE_RETENTION_DAYS = 90;

export interface SyncChange {
  entity: string;
  id: string;
  op: 'upsert' | 'delete';
  seq: number;
  data?: Record<string, unknown> | undefined;
}

export interface SyncResponse {
  changes: SyncChange[];
  next_cursor: string;
  has_more: boolean;
  server_time: string;
}

/**
 * El cursor és el `seq` de `change_log`, però **s'envia com a cadena opaca**.
 *
 * "El client no l'ha d'interpretar mai — així es pot canviar el format sense trencar
 * clients desplegats" (docs/06 §2). Es codifica perquè un client que intentés
 * interpretar-lo no en tregui res útil i el bug surti aviat, no d'aquí a dos anys.
 */
export function encodeCursor(seq: number): string {
  return Buffer.from(`v1:${seq}`, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): number | null {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const match = /^v1:(\d+)$/.exec(decoded);
    return match === null ? null : Number(match[1]);
  } catch {
    return null;
  }
}

export class ResyncRequired extends PolicyError {
  constructor() {
    super(
      'cursor-too-old',
      'Cursor too old',
      409,
      `El cursor és de fa més de ${TOMBSTONE_RETENTION_DAYS} dies i el delta seria ` +
        'incomplet. Cal una sincronització completa.',
    );
  }
}

export interface PullOptions {
  cursor?: string | undefined;
  limit?: number | undefined;
  now?: string | undefined;
}

/**
 * El delta des d'un cursor.
 *
 * **La comprovació de cursor caducat es fa ABANS de servir el delta**, no després
 * (docs/06 §3): servir un delta incomplet i avisar després deixa el client amb dades
 * que semblen bones.
 */
export async function pull(
  db: MigrationDb,
  principal: Principal,
  options: PullOptions = {},
): Promise<SyncResponse> {
  if (!hasCapability(principal, 'tasks:read')) throw missingCapability('tasks:read');

  const now = options.now ?? new Date().toISOString();
  const limit = clampInt(options.limit, { min: 1, max: 1000, fallback: 500 });

  let from = 0;
  if (options.cursor !== undefined && options.cursor !== '') {
    const decoded = decodeCursor(options.cursor);
    if (decoded === null) throw new ResyncRequired();
    from = decoded;

    await assertCursorFresh(db, from, now);
  }

  const scopes = await listScopes(db, principal);
  const allowed = scopes.map((s) => s.id);

  /**
   * El delta va **filtrat pel principal**: només arriba el dels àmbits que el token pot
   * veure. Les files sense àmbit —preferències, sessions— no viatgen pel sync.
   *
   * Si un token perd accés a un àmbit, el client rep tombstones d'aquelles entitats
   * (docs/06 §3). Això ho aconsegueix la consulta sola: les files d'aquell àmbit deixen
   * de sortir i el client, en resincronitzar, no les torna a veure.
   */
  const rows =
    allowed.length === 0
      ? { rows: [] as { seq: number; entity_type: string; entity_id: string; operation: string }[] }
      : await sql<{ seq: number; entity_type: string; entity_id: string; operation: string }>`
          SELECT seq, entity_type, entity_id, operation
          FROM change_log
          WHERE seq > ${from} AND scope_id IN (${sql.join(allowed)})
          ORDER BY seq ASC
          LIMIT ${limit + 1}
        `.execute(db);

  const hasMore = rows.rows.length > limit;
  const page = hasMore ? rows.rows.slice(0, limit) : rows.rows;

  const changes: SyncChange[] = [];
  for (const row of page) {
    if (row.operation === 'delete') {
      // Un `delete` només porta l'identificador (docs/06 §3).
      changes.push({ entity: row.entity_type, id: row.entity_id, op: 'delete', seq: row.seq });
      continue;
    }
    const data = await loadEntity(db, row.entity_type, row.entity_id);
    // Una fila del log que ja no té entitat és una tombstone implícita.
    changes.push({
      entity: row.entity_type,
      id: row.entity_id,
      op: data === null ? 'delete' : 'upsert',
      seq: row.seq,
      ...(data === null ? {} : { data }),
    });
  }

  const lastSeq = page[page.length - 1]?.seq ?? from;

  return {
    changes,
    next_cursor: encodeCursor(lastSeq),
    has_more: hasMore,
    // Cada resposta el porta perquè el client pugui detectar desviació de rellotge: un
    // rellotge mal posat trenca els recordatoris i les comparacions de "avui".
    server_time: now,
  };
}

/**
 * Un cursor és massa vell si apunta abans de la retenció de tombstones.
 *
 * Es mira la data de la fila del cursor, no la seva posició: amb poques escriptures, un
 * `seq` baix pot ser d'ahir, i obligar a resincronitzar seria gratuït.
 */
async function assertCursorFresh(db: MigrationDb, seq: number, now: string): Promise<void> {
  if (seq === 0) return;

  const found = await sql<{ created_at: string }>`
    SELECT created_at FROM change_log WHERE seq = ${seq}
  `.execute(db);

  const createdAt = found.rows[0]?.created_at;
  if (createdAt === undefined) {
    // El cursor apunta a una fila que ja no hi és: o és inventat, o s'ha podat.
    const oldest = await sql<{ seq: number }>`
      SELECT MIN(seq) AS seq FROM change_log
    `.execute(db);
    const minSeq = oldest.rows[0]?.seq;
    // Si el cursor és ANTERIOR al més antic que queda, s'ha podat i falta informació.
    if (minSeq != null && seq < minSeq) throw new ResyncRequired();
    return;
  }

  const age = Date.parse(now) - Date.parse(createdAt);
  if (age > TOMBSTONE_RETENTION_DAYS * 86_400_000) throw new ResyncRequired();
}

/** Un `upsert` porta l'entitat SENCERA, no un diff (docs/06 §3). */
async function loadEntity(
  db: MigrationDb,
  entityType: string,
  id: string,
): Promise<Record<string, unknown> | null> {
  const table = TABLE_BY_ENTITY[entityType];
  if (table === undefined) return null;

  const found = await sql`SELECT * FROM ${sql.raw(table)} WHERE id = ${id}`.execute(db);
  const row = found.rows[0] as Record<string, unknown> | undefined;
  if (row === undefined) return null;
  // Una fila amb `deleted_at` és una tombstone: no viatja com a dada.
  if (row.deleted_at != null) return null;
  return row;
}

/**
 * Les entitats que viatgen pel sync i la seva taula.
 *
 * NO hi són `activity_log` —es consulta a demanda quan s'obre l'historial— ni els
 * adjunts, dels quals només viatgen les metadades (docs/06 §9).
 */
const TABLE_BY_ENTITY: Record<string, string> = {
  task: 'tasks',
  subtask: 'subtasks',
  checklist: 'checklists',
  checklist_item: 'checklist_items',
  scope: 'scopes',
  project: 'projects',
  event: 'events',
  comment: 'comments',
};

export type BatchOperation = {
  op_id: string;
  entity: string;
  op: 'create' | 'update' | 'delete' | 'move';
  id: string;
  base_version?: number | undefined;
  data?: Record<string, unknown> | undefined;
};

export type BatchResult =
  | { op_id: string; status: 'ok'; entity?: Record<string, unknown> | undefined }
  | { op_id: string; status: 'conflict'; server_entity: Record<string, unknown> }
  | { op_id: string; status: 'rejected'; error: Record<string, unknown> };

/**
 * Camps on l'última escriptura guanya sense preguntar (docs/06 §5).
 *
 * `position` **no hi és perquè no és mai un conflicte**: els índexs fraccionals
 * convergeixen. Dos clients que moguin targetes diferents generen claus diferents que
 * ordenen bé les dues; dos que moguin la mateixa al mateix buit generen claus properes
 * però diferents gràcies al jitter, i el desempat és determinista perquè és una
 * comparació de cadenes binàries.
 */
const LAST_WRITE_WINS = new Set([
  'status',
  'due_date',
  'due_time',
  'deadline',
  'project_id',
  'view_mode',
  'ai_mode',
]);

/** Camps de text on una divergència real es pregunta a l'usuari (docs/06 §5). */
const ASK_USER = new Set(['title', 'description', 'ai_instructions']);

export interface ResolveOptions {
  /** Els camps que el client vol escriure. */
  incoming: Record<string, unknown>;
  /** L'estat actual al servidor. */
  server: Record<string, unknown>;
  baseVersion: number | undefined;
}

export interface Resolution {
  /** Els camps que s'han d'aplicar de veritat. */
  apply: Record<string, unknown>;
  /** Cert si cal preguntar a l'usuari: els dos costats han canviat text de debò. */
  needsUser: boolean;
}

/**
 * Resol un conflicte camp a camp.
 *
 * **Gairebé mai es pregunta a l'usuari.** Només quan els dos costats han canviat el
 * títol o la descripció a coses realment diferents. Tota la resta es resol sol i queda
 * a `activity_log`.
 */
export function resolveConflict(options: ResolveOptions): Resolution {
  const { incoming, server, baseVersion } = options;
  const serverVersion = Number(server.version ?? 0);

  // Sense conflicte de versió, s'aplica tot.
  if (baseVersion === undefined || baseVersion >= serverVersion) {
    return { apply: incoming, needsUser: false };
  }

  const apply: Record<string, unknown> = {};
  let needsUser = false;

  for (const [field, value] of Object.entries(incoming)) {
    if (field === 'position') {
      // Mai és conflicte: les claus convergeixen (D3).
      apply[field] = value;
      continue;
    }
    if (field === 'completed_at') {
      // Guanya el PRIMER que completa: qui ho va fer abans té raó sobre quan es va fer.
      if (server.completed_at == null) apply[field] = value;
      continue;
    }
    if (ASK_USER.has(field)) {
      const serverValue = server[field];
      if (serverValue !== value && serverValue != null && value != null) {
        // Els dos costats han tocat el text i no coincideixen. No es fusiona text
        // automàticament: es pregunta.
        needsUser = true;
        continue;
      }
      apply[field] = value;
      continue;
    }
    if (LAST_WRITE_WINS.has(field)) {
      apply[field] = value;
      continue;
    }
    apply[field] = value;
  }

  return { apply, needsUser };
}

/**
 * `op_id` és la clau d'idempotència: reenviar un lot després d'una caiguda no duplica
 * res (docs/06 §4).
 *
 * Es guarda en memòria per procés i amb un sostre. Per a una casa és suficient: el que
 * ha d'evitar és el reenviament immediat d'un lot que ja s'havia aplicat, no un
 * reenviament d'una setmana després — aquell el resol la comprovació de `version`.
 */
const appliedOps = new Map<string, BatchResult>();
const MAX_REMEMBERED_OPS = 10_000;

export function rememberOp(opId: string, result: BatchResult): void {
  if (appliedOps.size >= MAX_REMEMBERED_OPS) {
    const oldest = appliedOps.keys().next().value;
    if (oldest !== undefined) appliedOps.delete(oldest);
  }
  appliedOps.set(opId, result);
}

export function recallOp(opId: string): BatchResult | undefined {
  return appliedOps.get(opId);
}

export function forgetAllOps(): void {
  appliedOps.clear();
}

/** Escriu una tombstone. Cap `DELETE` real en entitats sincronitzables (docs/01 §12). */
export async function softDelete(
  ctx: AuditContext,
  entityType: string,
  id: string,
  scopeId: string | null,
): Promise<void> {
  const table = TABLE_BY_ENTITY[entityType];
  if (table === undefined) {
    throw new PolicyError(
      'unknown-entity',
      'Unknown entity',
      422,
      `"${entityType}" no és una entitat que se sincronitzi.`,
    );
  }

  await sql`
    UPDATE ${sql.raw(table)} SET deleted_at = ${ctx.now} WHERE id = ${id}
  `.execute(ctx.tx);

  ctx.record({ entityType, entityId: id, scopeId, verb: 'deleted' });
}
