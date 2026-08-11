/**
 * Llegir el correu, un cop cada tant.
 *
 * **LA LÍNIA QUE ÉS TOT EL DISSENY**
 * ----------------------------------
 * > La primera vegada que s'activa una regla, el cursor comença a `UIDNEXT - 1` i **no
 * > s'ingereix res**.
 *
 * Sense això, mapar una etiqueta de Gmail amb dotze anys de correu crea **quaranta mil
 * tasques** a un àmbit real, i no hi ha desfer massiu. La importació d'històric, si algun
 * dia es vol, és una acció explícita amb finestra de dates i un avís pel davant.
 *
 * **CADÈNCIA DE MINUTS, NO DE SEGONS**
 * ------------------------------------
 * El planificador fa un tic cada 30 segons; això no s'hi enganxa. Un `LOGIN` cada mig
 * minut contra un proveïdor gros és com es bloqueja un compte, i el correu no és més urgent
 * que cinc minuts. I quan falla, **retirada exponencial**: reintentar una contrasenya
 * errònia cada cinc minuts és exactament el que fa que et bloquegin.
 *
 * **LA XARXA NO ENTRA MAI DINS D'UNA TRANSACCIÓ**
 * -----------------------------------------------
 * SQLite té un sol escriptor. Mantenir una transacció oberta mentre baixen 20 MB congela
 * **cada escriptura del servidor** —el tauler, el CalDAV, els recordatoris—, i des de fora
 * sembla que l'app s'hagi penjat. Per això el cicle és: baixar fora, transacció curta,
 * repetir. El repositori ja s'hi ha cremat una vegada.
 *
 * **RES MARCA CAP CORREU COM A LLEGIT**
 * -------------------------------------
 * Tot amb `PEEK`, i el client obre les carpetes en només lectura. Modificar la bústia d'algú
 * és la manera més ràpida de fer que desconfiï de la funció, i que no ho fem ha de ser una
 * regla comprovable i no un costum. Ho vigila `mail-invariants`.
 */

import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import type { MigrationDb } from '../db/migration-db.js';
import { dbBool } from '../db/bool.js';
import { htmlToText } from '../text/html-to-text.js';
import { routeMail, type MailRule as RoutingRule } from '../policy/mail-routing.js';
import { messageKey, threadKey } from '../services/mail-identity.js';
import type { MailAttachmentMeta, MailClient, MailHeader } from '../net/mail-client.js';
import { safeFilename, sniffMime, storeAttachment } from '../services/attachments.js';
import { auditedTransaction } from '../audit/audited-transaction.js';
import { capabilitiesForRole } from '../policy/capabilities.js';
import type { Principal } from '../policy/principal.js';
import type { MailMessageRow } from '../services/mail-convert.js';
import { addComment } from '../services/comments.js';

/** Cada quant es llegeix un compte, per defecte. */
export const MAIL_POLL_SECONDS = 300;

/** Quants missatges com a molt per carpeta i passada. */
export const MAIL_BATCH = 50;

/** Un missatge més gros que això no es baixa. La porta es tanca **abans** de demanar-lo. */
export const MAIL_MAX_BYTES = 25 * 1024 * 1024;

/**
 * La retirada: 5 → 10 → 20 → 40 → 80 → 160 minuts, i para a 6 hores.
 *
 * Es calcula i no es desa perquè el que es desa és el comptador: així canviar la corba no
 * demana migrar res, i un compte que s'arregla torna a la cadència normal de seguida
 * —`updateMailAccount` posa el comptador a zero quan es toquen les credencials.
 */
export function backoffSeconds(consecutiveErrors: number, base = MAIL_POLL_SECONDS): number {
  if (consecutiveErrors <= 0) return base;
  return Math.min(base * 2 ** Math.min(consecutiveErrors, 8), 6 * 3600);
}

interface AccountRow {
  id: string;
  user_id: string;
  name: string;
  host: string;
  port: number;
  security: string;
  username: string;
  secret_enc: string | null;
  poll_interval: number | null;
  last_polled_at: string | null;
  consecutive_errors: number;
}

interface RuleRow {
  id: string;
  account_id: string;
  folder: string;
  scope_id: string;
  project_id: string | null;
  inbox_visible: number | null;
  title_template: string;
  body_to_description: number;
  attachments_to_task: number;
  position: string;
  uid_validity: string | null;
  last_uid: string | null;
}

export interface MailPollOptions {
  db: MigrationDb;
  /**
   * Com s'obre un client per a un compte. **Injectable, i és el que fa que tot això es
   * pugui provar sense xarxa** —i el que fa que `imapflow` només toqui un fitxer.
   */
  openClient: (account: AccountRow) => Promise<MailClient>;
  now?: (() => string) | undefined;
  log?: ((message: string, error?: unknown) => void) | undefined;
  batch?: number | undefined;
  maxBytes?: number | undefined;
  /** On van els bytes dels adjunts. Sense això, **no se'n baixa cap**. */
  dataDir?: string | undefined;
}

export interface MailPollResult {
  /** Comptes que s'han llegit en aquesta passada. */
  polled: number;
  /** Missatges nous desats. */
  ingested: number;
  /** Missatges que s'han vist i no s'han desat: massa grossos, o sense regla. */
  skipped: number;
  errors: number;
}

/** Quins comptes toca llegir ara, tenint en compte la retirada. */
function isDue(account: AccountRow, now: string): boolean {
  if (account.last_polled_at === null) return true;
  const base = account.poll_interval ?? MAIL_POLL_SECONDS;
  const espera = backoffSeconds(Number(account.consecutive_errors), base) * 1000;
  return Date.parse(now) - Date.parse(account.last_polled_at) >= espera;
}

export async function pollMail(options: MailPollOptions): Promise<MailPollResult> {
  const now = (options.now ?? (() => new Date().toISOString()))();
  const log = options.log ?? ((): void => undefined);
  const result: MailPollResult = { polled: 0, ingested: 0, skipped: 0, errors: 0 };

  const accounts = await sql<AccountRow>`
    SELECT id, user_id, name, host, port, security, username, secret_enc, poll_interval,
           last_polled_at, consecutive_errors
    FROM mail_accounts
    WHERE deleted_at IS NULL AND enabled = ${dbBool(true)} AND secret_enc IS NOT NULL
  `.execute(options.db);

  for (const account of accounts.rows) {
    if (!isDue(account, now)) continue;
    result.polled += 1;

    /**
     * **Un compte caigut no n'atura cap altre.** És la germana de la lliçó que va deixar
     * la penjada de DNS al refresc de calendaris: una font que no va no pot impedir que
     * la resta del servidor faci la seva feina.
     */
    try {
      await pollAccount(account, options, now, result);
      await applyThreadComments(account, options, now);
      await markOk(options.db, account.id, now);
    } catch (error) {
      result.errors += 1;
      log(`El correu de "${account.name}" ha fallat`, error);
      await markError(options.db, account.id, now, error);
    }
  }

  return result;
}

async function pollAccount(
  account: AccountRow,
  options: MailPollOptions,
  now: string,
  result: MailPollResult,
): Promise<void> {
  const rules = await sql<RuleRow>`
    SELECT id, account_id, folder, scope_id, project_id, inbox_visible,
           title_template, body_to_description, attachments_to_task, position,
           uid_validity, last_uid
    FROM mail_rules
    WHERE account_id = ${account.id} AND deleted_at IS NULL AND enabled = ${dbBool(true)}
    ORDER BY position, id
  `.execute(options.db);

  // **Cap regla, cap connexió.** Una carpeta sense regla no es llegeix, i un compte sense
  // cap regla no fa ni un `LOGIN`: el correu d'algú és seu, i «per si de cas» no és una raó.
  if (rules.rows.length === 0) return;

  const client = await options.openClient(account);
  try {
    for (const rule of rules.rows) {
      await pollFolder(client, account, rule, rules.rows, options, now, result);
    }
  } finally {
    await client.close();
  }
}

async function pollFolder(
  client: MailClient,
  account: AccountRow,
  rule: RuleRow,
  allRules: RuleRow[],
  options: MailPollOptions,
  now: string,
  result: MailPollResult,
): Promise<void> {
  const status = await client.openFolder(rule.folder);
  const batch = options.batch ?? MAIL_BATCH;
  const maxBytes = options.maxBytes ?? MAIL_MAX_BYTES;

  /**
   * **La primera vegada no s'ingereix res.** El cursor salta al final de la carpeta.
   *
   * I si `UIDVALIDITY` ha canviat, el cursor **es reinicia a zero i es rescaneja**: els
   * UID vells no volen dir res. Que això no dupliqui res no depèn d'aquesta funció sinó
   * de la clau única del `Message-ID`, que és per on aquest disseny aguanta.
   */
  const primera = rule.uid_validity === null || rule.last_uid === null;
  const reindexat = !primera && rule.uid_validity !== status.uidValidity;

  if (primera) {
    const inici = String(Math.max(0, Number(status.uidNext) - 1));
    await sql`
      UPDATE mail_rules SET uid_validity = ${status.uidValidity}, last_uid = ${inici},
             last_seen_at = ${now}, updated_at = ${now}
      WHERE id = ${rule.id}
    `.execute(options.db);
    return;
  }

  const desde = reindexat ? '0' : rule.last_uid!;
  const headers = await client.fetchHeaders(rule.folder, desde, batch);

  let cursor = Number(desde);
  for (const header of headers) {
    cursor = Math.max(cursor, Number(header.uid));

    const desat = await ingestOne(client, account, rule, allRules, header, options, now, maxBytes);
    if (desat === 'ingested') result.ingested += 1;
    else result.skipped += 1;
  }

  await sql`
    UPDATE mail_rules SET uid_validity = ${status.uidValidity}, last_uid = ${String(cursor)},
           last_seen_at = ${now}, last_error = NULL, last_error_at = NULL, updated_at = ${now}
    WHERE id = ${rule.id}
  `.execute(options.db);
}

/** Les regles, tal com les vol `routeMail`. La conversió és aquí i no a la política. */
const toRouting = (rules: RuleRow[]): RoutingRule[] =>
  rules.map((rule) => ({
    id: rule.id,
    folder: rule.folder,
    position: rule.position,
    enabled: true,
  }));

async function ingestOne(
  client: MailClient,
  account: AccountRow,
  rule: RuleRow,
  allRules: RuleRow[],
  header: MailHeader,
  options: MailPollOptions,
  now: string,
  maxBytes: number,
): Promise<'ingested' | 'skipped'> {
  const key = messageKey({
    messageId: header.messageId,
    sentAt: header.sentAt,
    fromAddress: header.fromAddress,
    subject: header.subject,
  });

  const jaHiEs = await sql<{ n: number }>`
    SELECT COUNT(*) AS n FROM mail_messages
    WHERE account_id = ${account.id} AND message_key = ${key}
  `.execute(options.db);
  if (Number(jaHiEs.rows[0]?.n ?? 0) > 0) {
    /**
     * **Ja el tenim.** Aquesta línia és l'única que salva un `UIDVALIDITY` rotat: quan el
     * servidor reindexa i tornem a veure la bústia sencera, és el que evita duplicar cada
     * tasca creada des del primer dia.
     */
    return 'skipped';
  }

  const fil = threadKey({
    own: key,
    references: header.references,
    inReplyTo: header.inReplyTo,
  });

  const routing = routeMail({
    folders: [rule.folder],
    delimiter: '/',
    rules: toRouting(allRules),
    alreadyIngested: false,
    // La conversa ja té tasca? La resposta comenta i no obre una segona tasca. La
    // conversió és de la fase següent; el que aquí importa és **no crear-ne dues**.
    threadTaskId: await taskOfThread(options.db, account.id, fil),
  });
  if (routing.kind === 'skip') return 'skipped';

  /**
   * **La porta de mida, abans de baixar.** El que tothom escriu primer és
   * `simpleParser(await download())`, i amb 20 MB d'adjunts són tres còpies a memòria: en
   * un ordinador de casa l'OOM s'endú l'API, el CalDAV i el planificador amb ell.
   *
   * I quan se salta, es desa la fila igualment amb `disposition = 'skipped'`: **un correu
   * que no ha entrat s'ha de poder veure**, o l'usuari només sap que «no ha arribat».
   */
  const massaGros = header.size > maxBytes;
  const body = massaGros ? null : await client.fetchBody(rule.folder, header.uid);

  const text =
    body === null ? null : (body.text ?? (body.html === null ? null : htmlToText(body.html)));

  /**
   * **Tot el que entra va a la bústia, i prou.**
   *
   * Ja no hi ha `pending`: cap regla converteix res sola. L'única excepció és el correu que
   * respon un fil que **ja té una tasca viva**, que hi deixa un comentari —si obrís una
   * segona tasca del mateix assumpte, respondre un correu et partiria la feina en dues.
   */
  const disposition = massaGros ? 'skipped' : routing.kind === 'comment' ? 'pending' : 'inbox';

  /**
   * **Els adjunts es baixen aquí, fora de qualsevol transacció, i amb dues portes.**
   *
   * La primera és la mida de cada part, que ja ve al `bodyStructure`; la segona, el nombre
   * de parts. Sense la segona, un correu amb dos-cents adjunts petits passa totes les
   * comprovacions de mida i igualment es menja el tic i el disc.
   *
   * Les imatges en línia ja les ha tret el client: si no, cada signatura corporativa
   * deixaria un logotip adjunt a cada tasca.
   */
  const volAdjunts = !massaGros && rule.attachments_to_task !== 0 && options.dataDir !== undefined;
  const adjunts: StoredAttachment[] = [];
  if (volAdjunts && body !== null) {
    for (const meta of body.attachments.slice(0, MAIL_MAX_ATTACHMENTS)) {
      const data = await client.fetchAttachment(rule.folder, header.uid, meta.part, maxBytes);
      if (data === null) continue;
      adjunts.push(await storeOne(meta, data, now, options.dataDir!));
    }
  }

  const filId = await ensureThread(options.db, account.id, fil, header, now);

  await sql`
    INSERT INTO mail_messages (id, account_id, thread_id, message_key, message_id, folder,
                               uid_validity, uid, internal_date, sent_at, from_name,
                               from_address, to_addresses, subject, body_text, has_html,
                               raw_bytes, in_reply_to, reference_ids, disposition, rule_id,
                               attachments, error, created_at, updated_at)
    VALUES (${uuidv7()}, ${account.id}, ${filId}, ${key}, ${header.messageId},
            ${rule.folder}, ${rule.uid_validity ?? '0'}, ${header.uid},
            ${header.internalDate}, ${header.sentAt}, ${header.fromName},
            ${header.fromAddress}, ${JSON.stringify(header.toAddresses)}, ${header.subject},
            ${text}, ${dbBool(header.hasHtml)}, ${header.size}, ${header.inReplyTo},
            ${JSON.stringify(header.references)}, ${disposition}, ${rule.id},
            ${adjunts.length === 0 ? null : JSON.stringify(adjunts)},
            ${massaGros ? 'massa gros' : null}, ${now}, ${now})
  `.execute(options.db);

  return massaGros ? 'skipped' : 'ingested';
}

/** Quants adjunts com a molt d'un sol correu. */
export const MAIL_MAX_ATTACHMENTS = 10;

/**
 * Un adjunt ja baixat, tal com queda desat a la fila del missatge.
 *
 * **El nom i el tipus ja vénen nets d'aquí**: `safeFilename` sobre el que deia el correu i
 * `sniffMime` **sobre els bytes**, amb el `Content-Type` declarat llençat. Un `factura.pdf`
 * que en realitat és un executable rep el que diuen els bytes, i això es decideix un sol cop
 * —quan els tenim a la mà— i no cada vegada que algú els mira.
 */
export interface StoredAttachment {
  filename: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
}

/** Desa un adjunt a disc i en torna la fitxa. Cap escriptura a la base. */
async function storeOne(
  meta: MailAttachmentMeta,
  data: Uint8Array,
  now: string,
  dataDir: string,
): Promise<StoredAttachment> {
  const { path } = await storeAttachment(uuidv7(), data, now, dataDir);
  return {
    filename: safeFilename(meta.filename ?? 'adjunt'),
    mime_type: sniffMime(data),
    size_bytes: data.length,
    storage_path: path,
  };
}

/** La tasca viva d'un fil, si en té. */
async function taskOfThread(
  db: MigrationDb,
  accountId: string,
  key: string,
): Promise<string | null> {
  const found = await sql<{ id: string }>`
    SELECT t.id FROM tasks t
    WHERE t.mail_account_id = ${accountId} AND t.mail_thread_key = ${key}
      AND t.deleted_at IS NULL
    LIMIT 1
  `.execute(db);
  return found.rows[0]?.id ?? null;
}

async function ensureThread(
  db: MigrationDb,
  accountId: string,
  key: string,
  header: MailHeader,
  now: string,
): Promise<string> {
  const found = await sql<{ id: string }>`
    SELECT id FROM mail_threads WHERE account_id = ${accountId} AND thread_key = ${key}
  `.execute(db);

  const quan = header.internalDate ?? now;
  if (found.rows[0] !== undefined) {
    await sql`
      UPDATE mail_threads SET message_count = message_count + 1, last_at = ${quan},
             updated_at = ${now}
      WHERE id = ${found.rows[0].id}
    `.execute(db);
    return found.rows[0].id;
  }

  const id = uuidv7();
  await sql`
    INSERT INTO mail_threads (id, account_id, thread_key, subject, message_count, first_at,
                              last_at, created_at, updated_at)
    VALUES (${id}, ${accountId}, ${key}, ${header.subject}, 1, ${quan}, ${quan},
            ${now}, ${now})
  `.execute(db);
  return id;
}

async function markOk(db: MigrationDb, id: string, now: string): Promise<void> {
  await sql`
    UPDATE mail_accounts SET last_polled_at = ${now}, consecutive_errors = 0,
           last_error = NULL, last_error_at = NULL, updated_at = ${now}
    WHERE id = ${id}
  `.execute(db);
}

async function markError(db: MigrationDb, id: string, now: string, error: unknown): Promise<void> {
  /**
   * L'error va **a la fila** i no només al registre, com als calendaris: sense això, un
   * compte caigut es veu exactament igual que un que no rep correu.
   */
  const message = error instanceof Error ? error.message : String(error);
  await sql`
    UPDATE mail_accounts SET last_polled_at = ${now},
           consecutive_errors = consecutive_errors + 1,
           last_error = ${message.slice(0, 500)}, last_error_at = ${now}, updated_at = ${now}
    WHERE id = ${id}
  `.execute(db);
}

/**
 * El principal amb què s'escriu una tasca nascuda d'un correu.
 *
 * **És la persona de qui és el compte, i no `system`.** El correu és seu, la regla la va
 * escriure ella, i a l'historial ha de constar com una cosa seva: si constés com a sistema,
 * la tasca no es podria desfer amb el botó de «Desfés» i ningú sabria d'on ha sortit.
 */
function ownerPrincipal(userId: string): Principal {
  return {
    kind: 'user',
    userId,
    capabilities: new Set(capabilitiesForRole('member')),
    scopeIds: null,
    source: 'system',
  };
}

/**
 * Els correus que responen un fil que **ja té una tasca viva**: hi deixen un comentari.
 *
 * **Aquesta funció no pot crear cap tasca, i és tot el que la fa correcta.** Cap font posa
 * res al kanban sola; l'únic automatisme que queda és el que evita partir la feina en dues
 * —si una resposta obrís una segona tasca del mateix assumpte, respondre un correu et
 * duplicaria la feina cada vegada.
 *
 * Si entremig la tasca ha desaparegut —l'han esborrada abans que passés el tic—, el correu
 * **cau a la bústia com qualsevol altre** en comptes de crear-ne una de nova.
 *
 * Va fora del bucle de xarxa i en **transaccions curtes**, una per correu: vint dins d'una
 * sola faria que un error al vintè desfés els dinou primers, i amb SQLite mantindria
 * l'únic escriptor ocupat tota l'estona.
 */
async function applyThreadComments(
  account: AccountRow,
  options: MailPollOptions,
  ara: string,
): Promise<void> {
  const pendents = await sql<MailMessageRow>`
    SELECT id, account_id, thread_id, message_key, folder, subject, from_name, from_address,
           body_text, internal_date, disposition, rule_id
    FROM mail_messages
    WHERE account_id = ${account.id} AND disposition = 'pending' AND deleted_at IS NULL
    ORDER BY internal_date, id
  `.execute(options.db);
  if (pendents.rows.length === 0) return;

  const principal = ownerPrincipal(account.user_id);

  for (const message of pendents.rows) {
    const tasca = await sql<{ id: string }>`
      SELECT t.id FROM tasks t
      JOIN mail_threads th ON th.thread_key = t.mail_thread_key
      WHERE th.id = ${message.thread_id} AND t.mail_account_id = ${account.id}
        AND t.deleted_at IS NULL
      LIMIT 1
    `.execute(options.db);

    const taskId = tasca.rows[0]?.id;
    if (taskId === undefined) {
      // La tasca ja no hi és: això no és un comentari, és un correu més a la bústia.
      await sql`
        UPDATE mail_messages SET disposition = 'inbox', updated_at = ${ara}
        WHERE id = ${message.id}
      `.execute(options.db);
      continue;
    }

    await auditedTransaction(options.db, principal, async (ctx) => {
      await addComment(ctx, principal, taskId, commentOf(message));
      await sql`
        UPDATE mail_messages SET disposition = 'comment', task_id = ${taskId},
               updated_at = ${ctx.now}
        WHERE id = ${message.id}
      `.execute(ctx.tx);
    });
  }
}

/**
 * El text del comentari que deixa una resposta.
 *
 * Porta **el remitent de debò** —el del correu, no el que hagi sortit de cap plantilla— i
 * per això no es pot falsejar escrivint-lo a l'assumpte.
 */
function commentOf(message: MailMessageRow): string {
  const qui = message.from_name ?? message.from_address ?? '';
  const cap = qui === '' ? '' : `${qui}: `;
  const cos = (message.body_text ?? message.subject ?? '').slice(0, 2000).trim();
  return `${cap}${cos === '' ? (message.subject ?? '') : cos}`.trim() || 'Un correu del fil.';
}

/**
 * La purga per retenció.
 *
 * **Purga el correu, mai la tasca.** Es buida el cos i les metadades del missatge; la
 * tasca que en va sortir es queda sencera i amb la provinença intacta —és per això que
 * `tasks.mail_thread_key` i `mail_message_key` són claus i no claus foranes: amb una clau
 * forana, purgar obligaria a triar entre trencar-la i esborrar tasques d'algú.
 *
 * I **no s'esborra la fila**: es buida. La fila és el que fa que el pròxim rescaneig no
 * torni a ingerir el mateix correu, i esborrar-la el faria tornar la primera vegada que el
 * servidor reindexés —que és exactament el dia que menys ho vols.
 */
export async function pruneMail(
  db: MigrationDb,
  now: string,
  retentionDays: number,
): Promise<number> {
  if (retentionDays <= 0) return 0;

  const limit = new Date(Date.parse(now) - retentionDays * 86_400_000).toISOString();
  const result = await sql`
    UPDATE mail_messages
    SET body_text = NULL, subject = NULL, from_name = NULL, to_addresses = NULL,
        raw_path = NULL, updated_at = ${now}
    WHERE created_at < ${limit} AND body_text IS NOT NULL
  `.execute(db);
  return Number(result.numAffectedRows ?? 0);
}
