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
import { visibleCalendarIds } from '../policy/calendar-visibility.js';
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
  /**
   * Àmbits que aquest usuari ha deixat de veure des del seu cursor.
   *
   * El client hi ha d'esborrar **tot el que en porti l'identificador**. No arriba per
   * `changes`: perdre accés no genera cap fila de canvi, i sense això les tasques d'un
   * àmbit del qual has sortit et queden al dispositiu per sempre.
   */
  dropped_scopes: string[];
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
  /**
   * La data del cursor, per a les revocacions.
   *
   * Una revocació **no escriu cap fila a `change_log`** —treure un membre no canvia cap
   * entitat sincronitzable—, o sigui que no té `seq` i no es pot comparar amb el cursor.
   * El que sí que es pot comparar és el moment: la fila del cursor en porta un.
   */
  let cursorTime: string | undefined;
  if (options.cursor !== undefined && options.cursor !== '') {
    const decoded = decodeCursor(options.cursor);
    if (decoded === null) throw new ResyncRequired();
    from = decoded;

    await assertCursorFresh(db, from, now);
    const at = await sql<{ created_at: string }>`
      SELECT created_at FROM change_log WHERE seq = ${from}
    `.execute(db);
    cursorTime = at.rows[0]?.created_at;
  }

  const scopes = await listScopes(db, principal);
  const allowed = scopes.map((s) => s.id);

  /**
   * El delta va **filtrat pel principal**: només arriba el dels àmbits que el token pot
   * veure. Les files sense àmbit —preferències, sessions— no viatgen pel sync.
   *
   * **Perdre accés a un àmbit NO arriba per aquesta consulta.** Aquí hi deia el
   * contrari —"les files d'aquell àmbit deixen de sortir i el client no les torna a
   * veure"— i és fals: deixar de sortir no és el mateix que arribar com a esborrat. El
   * client no rep res, i es queda les tasques al seu SQLite per sempre.
   *
   * El que ho resol és `dropped_scopes`, aquí sota: els àmbits dels quals aquest usuari
   * ha perdut l'accés des del seu cursor. Els dos clients hi esborren tot el que en
   * porti l'identificador.
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

  /**
   * **El `seq` de l'última fila es pren de la pàgina SENSE filtrar.**
   *
   * Si es prengués del que queda després del post-filtre i una pàgina sencera quedés
   * buida, `next_cursor` no avançaria i el client entraria en un bucle infinit demanant
   * el mateix tros. Es calcula abans i no es toca.
   */
  const lastSeqOfPage = page[page.length - 1]?.seq ?? from;

  /**
   * Un esdeveniment d'un calendari NO compartit porta l'`scope_id` de l'àmbit, o sigui
   * que el filtre per àmbit sol el deixaria passar. El tall va aquí.
   */
  const visibleCalendars = await visibleCalendarIds(db, principal.userId);

  const changes: SyncChange[] = [];
  for (const row of page) {
    if (
      row.entity_type === 'event' ||
      row.entity_type === 'calendar' ||
      row.entity_type === 'attachment'
    ) {
      const belongs = await calendarOf(db, row.entity_type, row.entity_id);
      if (belongs !== null && !visibleCalendars.has(belongs)) continue;
    }
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

  const lastSeq = lastSeqOfPage;

  /**
   * Els àmbits que aquest usuari ha deixat de veure.
   *
   * Es filtra per data i no per cursor perquè el cursor és un `seq` de `change_log` i una
   * revocació no hi escriu cap fila: treure un membre no canvia cap entitat sincronitzable.
   * Amb `cursor` buit —una sincronització completa— no cal enviar-ne cap: el client no té
   * res per esborrar.
   */
  const dropped =
    cursorTime === undefined
      ? { rows: [] as { scope_id: string }[] }
      : await sql<{ scope_id: string }>`
          SELECT DISTINCT scope_id FROM scope_access_revocations
          WHERE user_id = ${principal.userId} AND revoked_at > ${cursorTime}
        `.execute(db);

  return {
    changes,
    dropped_scopes: dropped.rows.map((r) => r.scope_id),
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
/**
 * A quin calendari pertany una fila del registre de canvis.
 *
 * `null` vol dir que ja no hi és: llavors mana el filtre d'àmbit i la fila viatja com a
 * tombstone, que és el que ha de passar quan una cosa s'esborra.
 */
async function calendarOf(
  db: MigrationDb,
  entityType: string,
  entityId: string,
): Promise<string | null> {
  if (entityType === 'calendar') return entityId;

  /**
   * Un adjunt de tasca no penja de cap calendari i no s'ha de tallar; un d'esdeveniment
   * hereta el calendari del seu, i el `LEFT JOIN` deixa el primer cas en `null`.
   */
  if (entityType === 'attachment') {
    const seu = await sql<{ calendar_id: string | null }>`
      SELECT e.calendar_id FROM attachments a
      LEFT JOIN events e ON e.id = a.event_id
      WHERE a.id = ${entityId}
    `.execute(db);
    return seu.rows[0]?.calendar_id ?? null;
  }

  const found = await sql<{ calendar_id: string }>`
    SELECT calendar_id FROM events WHERE id = ${entityId}
  `.execute(db);
  return found.rows[0]?.calendar_id ?? null;
}

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

  const columns = COLUMNS_BY_ENTITY[entityType] ?? '*';
  const found = await sql`
    SELECT ${sql.raw(columns)} FROM ${sql.raw(table)} WHERE id = ${id}
  `.execute(db);
  const row = found.rows[0] as Record<string, unknown> | undefined;
  if (row === undefined) return null;
  // Una fila amb `deleted_at` és una tombstone: no viatja com a dada.
  if (row.deleted_at != null) return null;
  return row;
}

/**
 * Les entitats que viatgen pel sync i la seva taula.
 *
 * NO hi és `activity_log`: es consulta a demanda quan s'obre l'historial. Dels adjunts
 * **només hi viatgen les metadades** (`docs/06` §9); els bytes es demanen a
 * `/attachments/{id}/content` quan calen, que és el que fa que un àlbum de fotos adjuntes
 * no s'hagi de baixar sencer al mòbil.
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
  attachment: 'attachments',
};

/**
 * Quines columnes en surten, quan no hi han de sortir totes.
 *
 * **Això no és neteja: és una fuita esperant.** `loadEntity` feia `SELECT *`, o sigui que
 * qualsevol taula que entri al sync hi envia les seves columnes senceres, secrets inclosos
 * —el dia que hi entrin els calendaris, `source_secret_enc` aniria a tots els membres de
 * l'àmbit—. Als adjunts el que no ha de sortir és `storage_path`: és una ruta interna, i
 * el client demana el contingut per identificador i no per camí.
 */
const COLUMNS_BY_ENTITY: Record<string, string> = {
  attachment: `id, task_id, event_id, scope_id, filename, mime_type, size_bytes, source,
               external_url, is_ai_context, uploaded_by, created_at, updated_at, deleted_at,
               version`,
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
 * **Va a taula i no a un Map en memòria.** Ho era, amb un sostre de deu mil i el
 * raonament que "per a una casa és suficient: el que ha d'evitar és el reenviament
 * immediat". Amb la federació deixa de ser cert: la rèplica torna a intentar el que no ha
 * confirmat, i un reinici del servidor entremig —una actualització, un tall de llum— li
 * esborrava la memòria i li feia aplicar dues vegades el mateix lot. La taula
 * `sync_op_ids` hi era des de la 008 esperant precisament això.
 *
 * Es conserven **set dies**: prou per cobrir un dispositiu que ha estat una setmana
 * apagat, i el que arribi més tard el resol igualment la comprovació de `version`.
 */
export const OP_RETENTION_DAYS = 7;

/**
 * La clau porta **qui pregunta**, no només l'`op_id`.
 *
 * Amb l'`op_id` sol, un client que n'encertés un d'un altre rebia el seu `BatchResult`
 * —que porta l'entitat sencera— sense passar per cap comprovació d'àmbit. L'`op_id` el
 * genera el client i no és cap secret: viatja al cos de cada lot.
 */
function opKey(principal: Principal): string {
  return `${principal.kind}:${principal.userId}`;
}

export async function rememberOp(
  db: MigrationDb,
  principal: Principal,
  opId: string,
  result: BatchResult,
  now: string,
): Promise<void> {
  const key = opKey(principal);
  // Reenviar el mateix lot no ha de petar amb una violació de clau primària: el que hi
  // havia ja era la resposta bona.
  const existing = await sql<{ op_id: string }>`
    SELECT op_id FROM sync_op_ids WHERE op_id = ${opId} AND principal_key = ${key}
  `.execute(db);
  if (existing.rows.length > 0) return;

  await sql`
    INSERT INTO sync_op_ids (op_id, principal_key, result, created_at)
    VALUES (${opId}, ${key}, ${JSON.stringify(result)}, ${now})
  `.execute(db);
}

export async function recallOp(
  db: MigrationDb,
  principal: Principal,
  opId: string,
): Promise<BatchResult | undefined> {
  const found = await sql<{ result: string }>`
    SELECT result FROM sync_op_ids WHERE op_id = ${opId} AND principal_key = ${opKey(principal)}
  `.execute(db);
  const row = found.rows[0];
  if (row === undefined) return undefined;
  try {
    return JSON.parse(row.result) as BatchResult;
  } catch {
    // Una fila malmesa no ha de tombar el lot: es tracta com si no hi fos i s'aplica.
    return undefined;
  }
}

/** Poda les operacions velles. La crida el planificador amb la resta de neteges. */
export async function pruneOps(db: MigrationDb, now: string): Promise<void> {
  const limit = new Date(Date.parse(now) - OP_RETENTION_DAYS * 86_400_000).toISOString();
  await sql`DELETE FROM sync_op_ids WHERE created_at < ${limit}`.execute(db);
}

/** Buida la memòria d'operacions. Només les proves, que comparteixen base entre casos. */
export async function forgetAllOps(db: MigrationDb): Promise<void> {
  await sql`DELETE FROM sync_op_ids`.execute(db);
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
      `"${entityType}" is not an entity that syncs.`,
      { entity: entityType },
    );
  }

  await sql`
    UPDATE ${sql.raw(table)} SET deleted_at = ${ctx.now} WHERE id = ${id}
  `.execute(ctx.tx);

  ctx.record({ entityType, entityId: id, scopeId, verb: 'deleted' });
}
