/**
 * Els adjunts.
 *
 * La taula existia des de la migració inicial i **no tenia ni servei, ni ruta, ni
 * interfície**: `docs/ESTAT.md` ho deia obertament, perquè `docs/12` no diu on es guarden
 * els fitxers i inventar-ho voldria dir triar per l'operador coses que després no es
 * poden desfer sense migrar dades.
 *
 * El que es tria aquí, i per què:
 *
 * - **Al volum, a `<dataDir>/attachments/<aaaa>/<mm>/<uuid>`.** `docs/12` §3 ja diu que hi
 *   ha **un sol volum** i que una còpia del volum és una còpia de seguretat; posar-los en
 *   un servei d'objectes trencaria aquella promesa per a qui s'autoallotja a casa.
 * - **Sense extensió al disc.** Així una travessia de camí o un servidor estàtic mal
 *   configurat no el pot servir com a `.html`. El nom real viu a la base.
 * - **Repartits per any i mes**, per no acabar amb un directori de desenes de milers
 *   d'entrades, i sense esquemes de prefix de hash que després ningú sap depurar a mà.
 * - **`storage_path` és relatiu**: un remuntatge del contenidor canvia el punt de
 *   muntatge i no ha de deixar tots els adjunts perduts.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import type { AuditContext } from '../audit/audited-transaction.js';
import type { MigrationDb } from '../db/migration-db.js';
import { PolicyError, missingCapability, notFound } from '../policy/errors.js';
import { hasCapability, type Principal } from '../policy/principal.js';
import { visibleCalendarIds } from '../policy/calendar-visibility.js';
import { assertScopeAccess } from './scopes.js';

export interface AttachmentRow {
  id: string;
  task_id: string | null;
  event_id: string | null;
  scope_id: string | null;
  filename: string;
  mime_type: string;
  size_bytes: number;
  source: string;
  external_url: string | null;
  is_ai_context: boolean;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
  version: number;
}

/** `storage_path` no hi és: és una ruta interna i el client demana per identificador. */
const COLUMNS = sql`
  id, task_id, event_id, scope_id, filename, mime_type, size_bytes, source, external_url,
  is_ai_context, uploaded_by, created_at, updated_at, version
`;

/**
 * El tipus s'infereix **del contingut**, no de l'extensió ni del que digui el client
 * (`docs/10` §8).
 *
 * Una taula de dotze i no una dependència: `no-pinned-from-research` fa que cada
 * dependència nova costi paperassa, i quaranta línies cobreixen el que un adjunt de casa
 * sol ser. El que no es reconeix va a `application/octet-stream`, que és el segur: el
 * navegador el baixa en comptes d'interpretar-lo.
 */
const MAGIC: { bytes: number[]; offset?: number; mime: string }[] = [
  { bytes: [0x25, 0x50, 0x44, 0x46], mime: 'application/pdf' },
  { bytes: [0x89, 0x50, 0x4e, 0x47], mime: 'image/png' },
  { bytes: [0xff, 0xd8, 0xff], mime: 'image/jpeg' },
  { bytes: [0x47, 0x49, 0x46, 0x38], mime: 'image/gif' },
  { bytes: [0x52, 0x49, 0x46, 0x46], mime: 'image/webp' },
  { bytes: [0x1a, 0x45, 0xdf, 0xa3], mime: 'video/webm' },
  { bytes: [0x66, 0x74, 0x79, 0x70], offset: 4, mime: 'video/mp4' },
  { bytes: [0x49, 0x44, 0x33], mime: 'audio/mpeg' },
  { bytes: [0x4f, 0x67, 0x67, 0x53], mime: 'audio/ogg' },
  { bytes: [0x50, 0x4b, 0x03, 0x04], mime: 'application/zip' },
  { bytes: [0x1f, 0x8b], mime: 'application/gzip' },
];

export function sniffMime(data: Uint8Array): string {
  for (const entry of MAGIC) {
    const at = entry.offset ?? 0;
    if (data.length < at + entry.bytes.length) continue;
    if (entry.bytes.every((byte, index) => data[at + index] === byte)) return entry.mime;
  }

  /**
   * Text pla si els primers quatre mil bytes són imprimibles.
   *
   * **`text/plain` i mai `text/html`**, encara que ho sembli: servir HTML de l'usuari amb
   * el seu tipus és XSS emmagatzemat, i el handler ja hi posa `nosniff` i
   * `Content-Disposition: attachment`.
   */
  const head = data.subarray(0, 4096);
  const printable = head.every((byte) => byte === 9 || byte === 10 || byte === 13 || byte >= 32);
  return printable && head.length > 0 ? 'text/plain' : 'application/octet-stream';
}

/** Un nom que no pot escapar del directori ni portar separadors. */
export function safeFilename(raw: string): string {
  // Sense separadors de camí i sense caràcters de control: el nom viatja a una capçalera
  // i a un `Content-Disposition`, i un salt de línia al mig és una injecció de capçalera.
  const base = raw.split(/[/\\]/u).pop() ?? '';
  const clean = [...base]
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code >= 32 && code !== 127;
    })
    .join('')
    .trim();
  return clean === '' ? 'fitxer' : clean.slice(0, 200);
}

/**
 * Escriu els bytes al volum i torna la ruta **relativa** que va a la fila.
 *
 * Surt a part de `uploadAttachment` perquè el refresc d'un origen també en desa —els
 * `ATTACH` en base64 d'un `.ics`— i les dues vies han d'escriure igual: mateix repartiment
 * per any i mes, mateixos permisos, i cap extensió al disc.
 */
export async function storeAttachment(
  id: string,
  data: Uint8Array,
  now: string,
  dataDir: string,
): Promise<{ path: string }> {
  const relative = pathFor(id, now);
  const absolute = join(dataDir, relative);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, data, { mode: 0o600 });
  return { path: relative };
}

function pathFor(id: string, now: string): string {
  const date = new Date(now);
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return join('attachments', year, month, id);
}

export interface UploadInput {
  taskId?: string | undefined;
  eventId?: string | undefined;
  filename: string;
  data: Uint8Array;
  isAiContext?: boolean | undefined;
}

/**
 * De quin àmbit és l'adjunt.
 *
 * Es desa **denormalitzat** a la fila i no es dedueix per JOIN cada vegada: per a un
 * adjunt d'esdeveniment la cadena és `attachment → event → calendar → scope`, tres salts
 * a cada fila del sync, i `change_log.scope_id` el necessita en el moment d'escriure
 * igualment.
 */
async function scopeOfParent(
  db: MigrationDb,
  taskId: string | undefined,
  eventId: string | undefined,
): Promise<{ scopeId: string; calendarId: string | null }> {
  if (taskId !== undefined) {
    const found = await sql<{ scope_id: string }>`
      SELECT scope_id FROM tasks WHERE id = ${taskId} AND deleted_at IS NULL
    `.execute(db);
    const row = found.rows[0];
    if (row === undefined) throw notFound('task', taskId);
    return { scopeId: row.scope_id, calendarId: null };
  }

  const found = await sql<{ scope_id: string; calendar_id: string }>`
    SELECT c.scope_id, e.calendar_id FROM events e
    JOIN calendars c ON c.id = e.calendar_id
    WHERE e.id = ${eventId ?? ''} AND e.deleted_at IS NULL
  `.execute(db);
  const row = found.rows[0];
  if (row === undefined) throw notFound('event', eventId ?? '');
  return { scopeId: row.scope_id, calendarId: row.calendar_id };
}

export async function uploadAttachment(
  ctx: AuditContext,
  principal: Principal,
  input: UploadInput,
  dataDir: string,
  maxBytes: number,
): Promise<AttachmentRow> {
  if (!hasCapability(principal, 'attachments:write')) throw missingCapability('attachments:write');

  if ((input.taskId === undefined) === (input.eventId === undefined)) {
    throw new PolicyError(
      'attachment-parent',
      'One parent',
      422,
      'An attachment belongs to a task or to an event, never to both and never to neither.',
    );
  }

  /**
   * El límit es comprova **sobre els bytes ja rebuts**, i el servidor també el posa a la
   * capa d'HTTP. Aquí perquè el sync i el MCP no hi passen.
   */
  if (input.data.length > maxBytes) {
    throw new PolicyError(
      'attachment-too-big',
      'Attachment too large',
      413,
      `The file is larger than the ${String(Math.round(maxBytes / 1_048_576))} MB limit.`,
      { limit_mb: Math.round(maxBytes / 1_048_576) },
    );
  }

  const { scopeId, calendarId } = await scopeOfParent(ctx.tx, input.taskId, input.eventId);
  await assertScopeAccess(ctx.tx, principal, scopeId);
  await assertCalendarVisible(ctx.tx, principal, calendarId, input.eventId ?? '');

  const id = uuidv7();
  const { path: relative } = await storeAttachment(id, input.data, ctx.now, dataDir);

  await sql`
    INSERT INTO attachments (id, task_id, event_id, scope_id, filename, mime_type, size_bytes,
                             storage_path, source, is_ai_context, uploaded_by,
                             created_at, updated_at, version)
    VALUES (${id}, ${input.taskId ?? null}, ${input.eventId ?? null}, ${scopeId},
            ${safeFilename(input.filename)}, ${sniffMime(input.data)}, ${input.data.length},
            ${relative}, 'upload', ${input.isAiContext === true ? 1 : 0}, ${principal.userId},
            ${ctx.now}, ${ctx.now}, 1)
  `.execute(ctx.tx);

  ctx.record({
    entityType: 'attachment',
    entityId: id,
    scopeId,
    verb: 'created',
    changes: { filename: { from: null, to: safeFilename(input.filename) } },
  });

  const found = await sql<AttachmentRow>`
    SELECT ${COLUMNS} FROM attachments WHERE id = ${id}
  `.execute(ctx.tx);
  return found.rows[0]!;
}

/**
 * El tall dels calendaris, que val tant per a la llista com per al contingut.
 *
 * Un esdeveniment no té `scope_id` propi: el treu del calendari. Compartir l'àmbit no
 * comparteix els calendaris —es trien un per un— i **el nom d'un fitxer ja diu massa**,
 * o sigui que la llista de metadades s'ha de tallar igual que els bytes.
 */
async function assertCalendarVisible(
  db: MigrationDb,
  principal: Principal,
  calendarId: string | null,
  id: string,
): Promise<void> {
  if (calendarId === null) return;
  const visible = await visibleCalendarIds(db, principal.userId);
  if (!visible.has(calendarId)) throw notFound('attachment', id);
}

export async function listAttachments(
  db: MigrationDb,
  principal: Principal,
  parent: { taskId?: string | undefined; eventId?: string | undefined },
): Promise<AttachmentRow[]> {
  if (!hasCapability(principal, 'attachments:read')) throw missingCapability('attachments:read');

  const { scopeId, calendarId } = await scopeOfParent(db, parent.taskId, parent.eventId);
  await assertScopeAccess(db, principal, scopeId);
  await assertCalendarVisible(db, principal, calendarId, parent.eventId ?? '');

  const rows = await sql<AttachmentRow>`
    SELECT ${COLUMNS} FROM attachments
    WHERE deleted_at IS NULL
      AND ${parent.taskId === undefined ? sql`event_id = ${parent.eventId ?? ''}` : sql`task_id = ${parent.taskId}`}
    ORDER BY created_at, id
  `.execute(db);
  return rows.rows;
}

export interface AttachmentContent {
  row: AttachmentRow;
  data: Buffer;
}

/**
 * El fitxer, amb els permisos comprovats.
 *
 * `docs/10` §8: fora de l'arrel web i servit per un handler que comprova permisos, mai
 * per una ruta endevinable. **I un adjunt d'un esdeveniment d'un calendari que no s'ha
 * compartit no surt**, encara que l'àmbit sí que ho estigui: és el mateix tall que al
 * sync i a la llista d'ocurrències.
 */
export async function readAttachment(
  db: MigrationDb,
  principal: Principal,
  id: string,
  dataDir: string,
): Promise<AttachmentContent> {
  if (!hasCapability(principal, 'attachments:read')) throw missingCapability('attachments:read');

  const found = await sql<AttachmentRow & { storage_path: string | null; event_id: string | null }>`
    SELECT ${COLUMNS}, storage_path FROM attachments WHERE id = ${id} AND deleted_at IS NULL
  `.execute(db);
  const row = found.rows[0];
  if (row === undefined || row.scope_id === null) throw notFound('attachment', id);

  await assertScopeAccess(db, principal, row.scope_id);

  if (row.event_id !== null) {
    const { calendarId } = await scopeOfParent(db, undefined, row.event_id);
    await assertCalendarVisible(db, principal, calendarId, id);
  }

  if (row.storage_path === null) throw notFound('attachment', id);
  const data = await readFile(join(dataDir, row.storage_path));
  return { row, data };
}

export async function deleteAttachment(
  ctx: AuditContext,
  principal: Principal,
  id: string,
): Promise<void> {
  if (!hasCapability(principal, 'attachments:write')) throw missingCapability('attachments:write');

  const found = await sql<AttachmentRow>`
    SELECT ${COLUMNS} FROM attachments WHERE id = ${id} AND deleted_at IS NULL
  `.execute(ctx.tx);
  const row = found.rows[0];
  if (row === undefined || row.scope_id === null) throw notFound('attachment', id);

  await assertScopeAccess(ctx.tx, principal, row.scope_id);

  /**
   * Esborrat suau, com tota entitat sincronitzable (`docs/01` §12). **El fitxer del disc
   * es queda**: el sync ha de poder enviar la tombstone, i esborrar el contingut abans
   * que tothom l'hagi vist convertiria un esborrat en una pèrdua per a qui encara no
   * havia sincronitzat. La neteja del disc és una feina del planificador, no d'aquí.
   */
  await sql`
    UPDATE attachments SET deleted_at = ${ctx.now}, updated_at = ${ctx.now},
                           version = version + 1
    WHERE id = ${id}
  `.execute(ctx.tx);

  ctx.record({ entityType: 'attachment', entityId: id, scopeId: row.scope_id, verb: 'deleted' });
}

/** Per a les proves i per al diagnòstic: la suma del contingut, sense treure'l del volum. */
export function digestOf(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex').slice(0, 16);
}
