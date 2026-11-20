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
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { sql } from 'kysely';
import { v7 as uuidv7, validate as validUuid } from 'uuid';
import { auditedTransaction, type AuditContext } from '../audit/audited-transaction.js';
import { ResponseTooLargeError, safeFetch } from '../dav/fetch-safe.js';
import { dbBool, isTrue } from '../db/bool.js';
import type { Connection } from '../db/connection.js';
import type { MigrationDb } from '../db/migration-db.js';
import { PolicyError, missingCapability, notFound, unauthenticated } from '../policy/errors.js';
import { hasCapability, type Principal } from '../policy/principal.js';
import { visibleCalendarIds } from '../policy/calendar-visibility.js';
import { assertScopeAccess, assertScopeRole } from './scopes.js';
import { assertWritable } from './tasks.js';

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

export type TaskAttachmentInput = {
  taskId: string;
  id?: string | undefined;
  filename: string;
  isAiContext?: boolean | undefined;
} & ({ data: Uint8Array } | { contentBase64: string } | { url: string });

interface TaskAttachmentOptions {
  dataDir: string;
  maxUploadBytes: number;
  mcpOrigin?: string | undefined;
  reauthorize?: () => Promise<Principal>;
}

export const MCP_ATTACHMENT_MAX_BYTES = 1_048_576;

function attachmentTooLarge(maxBytes: number): PolicyError {
  const limitMb = maxBytes / MCP_ATTACHMENT_MAX_BYTES;
  return new PolicyError(
    'attachment-too-big',
    'Attachment too large',
    413,
    `The file is larger than the ${String(limitMb)} MB limit.`,
    { limit_mb: limitMb },
  );
}

async function taskUploadScope(
  db: MigrationDb,
  principal: Principal,
  taskId: string,
  now: string,
): Promise<string> {
  if (!hasCapability(principal, 'tasks:attach') && !hasCapability(principal, 'attachments:write'))
    throw missingCapability('tasks:attach');

  const {
    rows: [task],
  } = await sql<{ id: string; scope_id: string; ai_mode: 'manual' | 'assisted' | 'delegated' }>`
    SELECT id, scope_id, ai_mode FROM tasks WHERE id = ${taskId} AND deleted_at IS NULL
  `.execute(db);
  if (task === undefined) throw notFound('task', taskId);

  await assertScopeRole(db, principal, task.scope_id, 'content');
  if (principal.kind === 'agent') await assertWritable({ tx: db, now }, principal, task, 'edit');
  return task.scope_id;
}

async function findTaskAttachmentReplay(
  db: MigrationDb,
  userId: string,
  scopeId: string,
  id: string,
  input: TaskAttachmentInput,
): Promise<AttachmentRow | undefined> {
  const result = await sql<
    AttachmentRow & { deleted_at: string | null; storage_path: string | null }
  >`
    SELECT ${COLUMNS}, deleted_at, storage_path FROM attachments WHERE id = ${id}
  `.execute(db);
  const row = result.rows[0];
  if (row === undefined) return undefined;
  if (
    row.deleted_at !== null ||
    row.storage_path === null ||
    row.source !== 'upload' ||
    row.uploaded_by !== userId ||
    row.task_id !== input.taskId ||
    row.scope_id !== scopeId ||
    row.filename !== safeFilename(input.filename) ||
    isTrue(row.is_ai_context) !== (input.isAiContext === true)
  ) {
    throw new PolicyError(
      'attachment-id-conflict',
      'Attachment identifier is already used',
      409,
      'Reuse an identifier only to retry the same file upload.',
    );
  }
  const { deleted_at: _deleted, storage_path: _path, ...attachment } = row;
  return attachment;
}

async function taskAttachmentData(
  input: TaskAttachmentInput,
  maxBytes: number,
): Promise<Uint8Array> {
  if ('data' in input) {
    if (input.data.byteLength > maxBytes) throw attachmentTooLarge(maxBytes);
    return input.data;
  }
  if ('contentBase64' in input) {
    const limit = Math.min(maxBytes, MCP_ATTACHMENT_MAX_BYTES);
    if (input.contentBase64.length > Math.ceil(limit / 3) * 4) throw attachmentTooLarge(limit);
    const bytes = Buffer.from(input.contentBase64, 'base64');
    if (bytes.toString('base64') !== input.contentBase64) {
      throw new PolicyError(
        'invalid-attachment-base64',
        'Invalid Base64',
        422,
        'Send standard Base64 file content.',
      );
    }
    if (bytes.byteLength > limit) throw attachmentTooLarge(limit);
    return bytes;
  }

  let url: URL | undefined;
  try {
    url = input.url.length <= 8192 ? new URL(input.url) : undefined;
  } catch {
    // La URL pot tenir una signatura i no ha de sortir a l’error.
  }
  if (url?.protocol !== 'https:' || url.username !== '' || url.password !== '') {
    throw new PolicyError(
      'invalid-attachment-url',
      'Invalid download URL',
      422,
      'Provide a public HTTPS download URL.',
    );
  }

  try {
    const response = await safeFetch(url.href, { maxBytes });
    const encoding = response.headers.get('content-encoding');
    if (response.status === 200 && (encoding === null || encoding === 'identity')) {
      return response.bytes;
    }
  } catch (error) {
    if (error instanceof ResponseTooLargeError) throw attachmentTooLarge(maxBytes);
    // Ni els errors del destí ni les capçaleres es reenvien al client.
  }
  throw new PolicyError(
    'attachment-download-failed',
    'Download failed',
    502,
    'The file could not be downloaded. Retry with a working public HTTPS link.',
  );
}

export async function deliverTaskAttachment(
  connection: Connection,
  principal: Principal,
  input: TaskAttachmentInput,
  options: TaskAttachmentOptions,
): Promise<{ attachment: AttachmentRow; created: boolean }> {
  const { db, engine } = connection;
  const id = input.id ?? uuidv7();
  if (!validUuid(id)) {
    throw new PolicyError(
      'invalid-attachment-id',
      'Invalid attachment identifier',
      422,
      'Use a UUID for the attachment identifier.',
    );
  }
  const scopeId = await taskUploadScope(db, principal, input.taskId, new Date().toISOString());
  if (input.id !== undefined) {
    const existing = await findTaskAttachmentReplay(db, principal.userId, scopeId, id, input);
    if (existing !== undefined) return { attachment: existing, created: false };
  }
  const data = await taskAttachmentData(input, options.maxUploadBytes);
  const writer = 'url' in input && options.reauthorize ? await options.reauthorize() : principal;
  if (writer.userId !== principal.userId || writer.credentialId !== principal.credentialId)
    throw unauthenticated('The upload credential changed.');

  let storedPath: string | undefined;
  try {
    return await auditedTransaction(
      db,
      writer,
      async (ctx) => {
        const currentScope = await taskUploadScope(ctx.tx, writer, input.taskId, ctx.now);
        // Nom al disc independent de l’identificador de reintent. Un intent perdedor
        // o avortat mai sobreescriu els bytes que ja ha confirmat un altre procés.
        const storageId = uuidv7();
        const relative = pathFor(storageId, ctx.now);
        const row = await insertAttachment(
          ctx,
          writer,
          { ...input, data },
          currentScope,
          id,
          relative,
        );
        if (row === undefined) {
          const existing = await findTaskAttachmentReplay(
            ctx.tx,
            writer.userId,
            currentScope,
            id,
            input,
          );
          if (existing === undefined) throw new Error('Attachment insert lost its existing row.');
          ctx.noChange();
          return { attachment: existing, created: false };
        }
        storedPath = relative;
        await storeAttachment(storageId, data, ctx.now, options.dataDir);
        return { attachment: row, created: true };
      },
      { engine, mcpOrigin: options.mcpOrigin },
    );
  } catch (error) {
    if (storedPath !== undefined) {
      try {
        await rm(join(options.dataDir, storedPath), { force: true });
      } catch (cleanupError) {
        if ((cleanupError as NodeJS.ErrnoException).code !== 'ENOTDIR') {
          throw new AggregateError(
            [error, cleanupError],
            'Attachment storage and cleanup failed.',
            {
              cause: cleanupError,
            },
          );
        }
      }
    }
    throw error;
  }
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
    throw attachmentTooLarge(maxBytes);
  }

  const { scopeId, calendarId } = await scopeOfParent(ctx.tx, input.taskId, input.eventId);
  await assertScopeAccess(ctx.tx, principal, scopeId);
  await assertCalendarVisible(ctx.tx, principal, calendarId, input.eventId ?? '');

  const id = uuidv7();
  const { path: relative } = await storeAttachment(id, input.data, ctx.now, dataDir);
  const row = await insertAttachment(ctx, principal, input, scopeId, id, relative);
  if (row === undefined) throw new Error('A generated attachment identifier already exists.');
  return row;
}

async function insertAttachment(
  ctx: AuditContext,
  principal: Principal,
  input: UploadInput,
  scopeId: string,
  id: string,
  relative: string,
): Promise<AttachmentRow | undefined> {
  const filename = safeFilename(input.filename);
  const found = await sql<AttachmentRow>`
    INSERT INTO attachments (id, task_id, event_id, scope_id, filename, mime_type, size_bytes,
                             storage_path, source, is_ai_context, uploaded_by,
                             created_at, updated_at, version)
    VALUES (${id}, ${input.taskId ?? null}, ${input.eventId ?? null}, ${scopeId},
            ${filename}, ${sniffMime(input.data)}, ${input.data.length},
            ${relative}, 'upload', ${dbBool(input.isAiContext === true)}, ${principal.userId},
            ${ctx.now}, ${ctx.now}, 1)
    ON CONFLICT (id) DO NOTHING RETURNING ${COLUMNS}
  `.execute(ctx.tx);
  const row = found.rows[0];
  if (row === undefined) return undefined;

  ctx.record({
    entityType: 'attachment',
    entityId: id,
    scopeId,
    taskId: input.taskId,
    verb: 'created',
    changes: { filename: { from: null, to: filename } },
  });
  return row;
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

  ctx.record({
    entityType: 'attachment',
    entityId: id,
    scopeId: row.scope_id,
    taskId: row.task_id ?? undefined,
    verb: 'deleted',
  });
}

/** Per a les proves i per al diagnòstic: la suma del contingut, sense treure'l del volum. */
export function digestOf(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex').slice(0, 16);
}
