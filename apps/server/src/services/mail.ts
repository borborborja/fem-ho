/**
 * Comptes i regles de correu (fase C del pla del correu, P11 a `docs/14`).
 *
 * **UN COMPTE ÉS D'UNA PERSONA, I AIXÒ TRAVESSA TOT EL FITXER**
 * ------------------------------------------------------------
 * `calendars` penja d'un àmbit i el pot veure tot qui hi és a dins. Un compte de correu
 * no: hi ha la contrasenya del teu correu personal, i el correu que hi entra és teu abans
 * de ser de ningú. Per això aquí **no hi ha `assertScopeAccess` per llegir**: hi ha
 * `WHERE user_id = ?`, i un administrador no en veu cap que no sigui seu.
 *
 * On sí que hi ha àmbit és a la **regla**, perquè una regla escriu al tauler de la casa:
 * dir «el que arribi a aquesta carpeta va a l'àmbit Feina» és escriure a Feina, i això es
 * comprova amb el mateix predicat que qualsevol altra escriptura.
 *
 * La conseqüència pràctica: **la propietat del compte i l'accés a l'àmbit són dues
 * comprovacions diferents i totes dues hi són.** Quedar-se només amb la primera deixaria
 * que un membre encaminés correu cap a un àmbit on no hi és.
 *
 * LA CONTRASENYA NO ENTRA AQUÍ
 * ----------------------------
 * El servei rep `secret_enc` ja segellat, com els calendaris: el secret de la instància és
 * de l'app i el servei no ha de conèixer ni la configuració ni el disc. I **no surt mai**:
 * `MailAccountSummary` no en té camp, ni tan sols emmascarat —una màscara filtra la
 * longitud i el prefix—; només `has_secret`.
 */

import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import {
  DEFAULT_MAIL_TEMPLATE,
  MAIL_TEMPLATE_VARS,
  unknownMailVars,
} from '@fem-ho/contracts';
import type { AuditContext } from '../audit/audited-transaction.js';
import { dbBool } from '../db/bool.js';
import type { MigrationDb } from '../db/migration-db.js';
import { PolicyError, missingCapability } from '../policy/errors.js';
import { hasCapability, type Principal } from '../policy/principal.js';
import { normalizeFolder } from '../policy/mail-routing.js';
import { assertScopeAccess } from './scopes.js';

/** El que la interfície sap d'un compte. **Sense contrasenya, en cap forma.** */
export interface MailAccountSummary {
  id: string;
  name: string;
  host: string;
  port: number;
  security: 'tls' | 'starttls';
  username: string;
  has_secret: boolean;
  enabled: boolean;
  poll_interval: number | null;
  last_polled_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
  consecutive_errors: number;
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
  enabled: number;
  poll_interval: number | null;
  last_polled_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
  consecutive_errors: number;
}

const ACCOUNT_COLUMNS = sql`id, user_id, name, host, port, security, username, secret_enc,
  enabled, poll_interval, last_polled_at, last_error, last_error_at, consecutive_errors`;

function toAccount(row: AccountRow): MailAccountSummary {
  return {
    id: row.id,
    name: row.name,
    host: row.host,
    port: Number(row.port),
    security: row.security === 'starttls' ? 'starttls' : 'tls',
    username: row.username,
    // El booleà, i no el valor. És l'única cosa que se'n pot dir.
    has_secret: row.secret_enc !== null && row.secret_enc !== '',
    enabled: Boolean(row.enabled),
    poll_interval: row.poll_interval === null ? null : Number(row.poll_interval),
    last_polled_at: row.last_polled_at,
    last_error: row.last_error,
    last_error_at: row.last_error_at,
    consecutive_errors: Number(row.consecutive_errors),
  };
}

export interface MailRuleSummary {
  id: string;
  account_id: string;
  folder: string;
  scope_id: string;
  project_id: string | null;
  action: 'inbox' | 'task';
  inbox_visible: boolean;
  title_template: string;
  body_to_description: boolean;
  attachments_to_task: boolean;
  position: string;
  enabled: boolean;
  last_seen_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
}

interface RuleRow {
  id: string;
  account_id: string;
  folder: string;
  scope_id: string;
  project_id: string | null;
  action: string;
  inbox_visible: number;
  title_template: string;
  body_to_description: number;
  attachments_to_task: number;
  position: string;
  enabled: number;
  last_seen_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
}

const RULE_COLUMNS = sql`id, account_id, folder, scope_id, project_id, action, inbox_visible,
  title_template, body_to_description, attachments_to_task, position, enabled, last_seen_at,
  last_error, last_error_at`;

function toRule(row: RuleRow): MailRuleSummary {
  return {
    id: row.id,
    account_id: row.account_id,
    folder: row.folder,
    scope_id: row.scope_id,
    project_id: row.project_id,
    action: row.action === 'task' ? 'task' : 'inbox',
    inbox_visible: Boolean(row.inbox_visible),
    title_template: row.title_template,
    body_to_description: Boolean(row.body_to_description),
    attachments_to_task: Boolean(row.attachments_to_task),
    position: row.position,
    enabled: Boolean(row.enabled),
    last_seen_at: row.last_seen_at,
    last_error: row.last_error,
    last_error_at: row.last_error_at,
  };
}

const requerit = (camp: string, què: string): PolicyError =>
  new PolicyError(`${camp}-required`, 'Missing field', 422, què);

/**
 * Els ports que s'admeten, i **només aquests dos**.
 *
 * 993 (IMAPS) i 143 (IMAP amb STARTTLS). És la meitat de la defensa contra l'SSRF que el
 * pla demana: sense la llista, un «compte de correu» apuntant a `localhost:6379` és una
 * manera de fer que el servidor parli amb el Redis de la casa. L'altra meitat —les
 * adreces— viu a `net/imap-connect.ts`, perquè només es pot comprovar en resoldre.
 */
export const PORTS_IMAP = [993, 143];

/**
 * El compte, **si és teu**.
 *
 * Un identificador desconegut i un que és d'algú altre donen exactament la mateixa
 * resposta: si es distingissin, provar identificadors diria quins existeixen.
 */
async function assertOwnAccount(
  db: MigrationDb,
  principal: Principal,
  id: string,
): Promise<AccountRow> {
  const found = await sql<AccountRow>`
    SELECT ${ACCOUNT_COLUMNS} FROM mail_accounts
    WHERE id = ${id} AND user_id = ${principal.userId} AND deleted_at IS NULL
  `.execute(db);

  const account = found.rows[0];
  if (account === undefined) {
    throw new PolicyError(
      'mail-account-not-found',
      'Not found',
      404,
      'Aquest compte de correu no existeix.',
    );
  }
  return account;
}

export async function listMailAccounts(
  db: MigrationDb,
  principal: Principal,
): Promise<MailAccountSummary[]> {
  if (!hasCapability(principal, 'mail:read')) throw missingCapability('mail:read');

  const found = await sql<AccountRow>`
    SELECT ${ACCOUNT_COLUMNS} FROM mail_accounts
    WHERE user_id = ${principal.userId} AND deleted_at IS NULL
    ORDER BY name
  `.execute(db);
  return found.rows.map(toAccount);
}

export interface CreateMailAccountInput {
  id?: string | undefined;
  name?: string | undefined;
  host?: string | undefined;
  port?: number | undefined;
  security?: 'tls' | 'starttls' | undefined;
  username?: string | undefined;
  /** Ja segellat a la ruta. Aquí no s'hi xifra res. */
  secret_enc?: string | undefined;
  poll_interval?: number | null | undefined;
  enabled?: boolean | undefined;
}

function assertPort(port: number): void {
  if (!PORTS_IMAP.includes(port)) {
    throw new PolicyError(
      'mail-port-not-allowed',
      'Port not allowed',
      422,
      `Un compte IMAP fa servir el port 993 o el 143, i s'ha demanat el ${String(port)}.`,
    );
  }
}

export async function createMailAccount(
  ctx: AuditContext,
  principal: Principal,
  input: CreateMailAccountInput,
): Promise<{ account: MailAccountSummary; created: boolean }> {
  if (!hasCapability(principal, 'mail:write')) throw missingCapability('mail:write');

  const name = (input.name ?? '').trim();
  const host = (input.host ?? '').trim().toLowerCase();
  const username = (input.username ?? '').trim();
  if (name === '') throw requerit('name', 'El compte necessita un nom.');
  if (host === '') throw requerit('host', "El compte necessita l'amfitrió del servidor IMAP.");
  if (username === '') throw requerit('username', "El compte necessita el nom d'usuari.");

  const security = input.security === 'starttls' ? 'starttls' : 'tls';
  // El defecte va lligat a la seguretat: 993 és IMAPS i 143 és el d'STARTTLS. Posar 993
  // per defecte amb STARTTLS seria una combinació que no connecta i que ningú ha triat.
  const port = input.port ?? (security === 'starttls' ? 143 : 993);
  assertPort(port);

  const id = input.id ?? uuidv7();
  const existing = await sql<AccountRow>`
    SELECT ${ACCOUNT_COLUMNS} FROM mail_accounts WHERE id = ${id}
  `.execute(ctx.tx);
  if (existing.rows[0] !== undefined) {
    ctx.noChange();
    return { account: toAccount(existing.rows[0]), created: false };
  }

  await sql`
    INSERT INTO mail_accounts (id, user_id, name, host, port, security, username, secret_enc,
                               poll_interval, enabled, created_at, updated_at)
    VALUES (${id}, ${principal.userId}, ${name}, ${host}, ${port}, ${security}, ${username},
            ${input.secret_enc ?? null}, ${input.poll_interval ?? null},
            ${dbBool(input.enabled !== false)}, ${ctx.now}, ${ctx.now})
  `.execute(ctx.tx);

  ctx.record({ entityType: 'mail_account', entityId: id, verb: 'created' });

  const account = await assertOwnAccount(ctx.tx, principal, id);
  return { account: toAccount(account), created: true };
}

export interface UpdateMailAccountInput {
  name?: string | undefined;
  host?: string | undefined;
  port?: number | undefined;
  security?: 'tls' | 'starttls' | undefined;
  username?: string | undefined;
  /** Absent vol dir «no la toquis». Mai «esborra-la». */
  secret_enc?: string | undefined;
  poll_interval?: number | null | undefined;
  enabled?: boolean | undefined;
}

export async function updateMailAccount(
  ctx: AuditContext,
  principal: Principal,
  id: string,
  input: UpdateMailAccountInput,
): Promise<MailAccountSummary> {
  if (!hasCapability(principal, 'mail:write')) throw missingCapability('mail:write');
  const before = await assertOwnAccount(ctx.tx, principal, id);

  const security = input.security ?? (before.security === 'starttls' ? 'starttls' : 'tls');
  const port = input.port ?? Number(before.port);
  assertPort(port);

  const name = input.name === undefined ? before.name : input.name.trim();
  if (name === '') throw requerit('name', 'El compte necessita un nom.');
  const host = input.host === undefined ? before.host : input.host.trim().toLowerCase();
  const username = input.username === undefined ? before.username : input.username.trim();

  /**
   * **Canviar d'amfitrió o d'usuari reinicia el comptador d'errors.**
   *
   * Si no, un compte que ha anat a la retirada de sis hores per una contrasenya dolenta es
   * quedaria callat sis hores més després que l'hagis arreglat, i el que veuries és que
   * corregir-ho no serveix de res.
   */
  const credencialsTocades =
    input.secret_enc !== undefined || host !== before.host || username !== before.username;

  await sql`
    UPDATE mail_accounts SET
      name = ${name}, host = ${host}, port = ${port}, security = ${security},
      username = ${username},
      secret_enc = ${input.secret_enc ?? before.secret_enc},
      poll_interval = ${input.poll_interval === undefined ? before.poll_interval : input.poll_interval},
      enabled = ${dbBool(input.enabled === undefined ? Boolean(before.enabled) : input.enabled)},
      consecutive_errors = ${credencialsTocades ? 0 : Number(before.consecutive_errors)},
      last_error = ${credencialsTocades ? null : before.last_error},
      last_error_at = ${credencialsTocades ? null : before.last_error_at},
      updated_at = ${ctx.now}
    WHERE id = ${id}
  `.execute(ctx.tx);

  ctx.record({ entityType: 'mail_account', entityId: id, verb: 'updated' });
  return toAccount(await assertOwnAccount(ctx.tx, principal, id));
}

export async function deleteMailAccount(
  ctx: AuditContext,
  principal: Principal,
  id: string,
): Promise<void> {
  if (!hasCapability(principal, 'mail:write')) throw missingCapability('mail:write');
  await assertOwnAccount(ctx.tx, principal, id);

  /**
   * Se n'endú les regles —sense compte no volen dir res— i **no toca cap tasca**.
   *
   * Una tasca feta a partir d'un correu és teva. Que esborrar el compte et buidés el
   * tauler seria la mena de neteja que ningú demana i que no es pot desfer. Per això
   * `tasks.mail_*` són referències mortes: es queden dient d'on venia allò encara que el
   * compte ja no hi sigui.
   */
  await sql`
    UPDATE mail_rules SET deleted_at = ${ctx.now}, updated_at = ${ctx.now}
    WHERE account_id = ${id} AND deleted_at IS NULL
  `.execute(ctx.tx);
  await sql`
    UPDATE mail_accounts SET deleted_at = ${ctx.now}, updated_at = ${ctx.now} WHERE id = ${id}
  `.execute(ctx.tx);

  ctx.record({ entityType: 'mail_account', entityId: id, verb: 'deleted' });
}

// ------------------------------------------------------------------- les regles

export async function listMailRules(
  db: MigrationDb,
  principal: Principal,
): Promise<MailRuleSummary[]> {
  if (!hasCapability(principal, 'mail:read')) throw missingCapability('mail:read');

  const found = await sql<RuleRow>`
    SELECT ${RULE_COLUMNS} FROM mail_rules r
    WHERE r.deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM mail_accounts a
                  WHERE a.id = r.account_id AND a.user_id = ${principal.userId}
                    AND a.deleted_at IS NULL)
    ORDER BY r.position, r.id
  `.execute(db);
  return found.rows.map(toRule);
}

/**
 * La plantilla del títol, validada.
 *
 * **Avisa i no rebutja les variables desconegudes**: qui vulgui unes claus literals al
 * títol està en el seu dret, i `renderMailTitle` les deixa escrites precisament perquè
 * l'errata es vegi. El que sí que es rebutja és una plantilla que **no pot donar res**:
 * buida, o tan llarga que ja no és una plantilla.
 */
function assertTemplate(template: string): string {
  const net = template.trim();
  if (net === '') {
    return DEFAULT_MAIL_TEMPLATE;
  }
  if (net.length > 500) {
    throw new PolicyError(
      'mail-template-too-long',
      'Template too long',
      422,
      'La plantilla del títol no pot passar de 500 caràcters.',
    );
  }
  return net;
}

export interface CreateMailRuleInput {
  id?: string | undefined;
  account_id?: string | undefined;
  folder?: string | undefined;
  scope_id?: string | undefined;
  project_id?: string | null | undefined;
  action?: 'inbox' | 'task' | undefined;
  inbox_visible?: boolean | undefined;
  title_template?: string | undefined;
  body_to_description?: boolean | undefined;
  attachments_to_task?: boolean | undefined;
  position?: string | undefined;
  enabled?: boolean | undefined;
}

export async function createMailRule(
  ctx: AuditContext,
  principal: Principal,
  input: CreateMailRuleInput,
): Promise<{ rule: MailRuleSummary; created: boolean }> {
  if (!hasCapability(principal, 'mail:write')) throw missingCapability('mail:write');

  const accountId = input.account_id ?? '';
  const folder = normalizeFolder((input.folder ?? '').trim());
  const scopeId = input.scope_id ?? '';
  if (accountId === '') throw requerit('account_id', 'La regla necessita un compte.');
  if (folder === '') throw requerit('folder', 'La regla necessita una carpeta.');
  if (scopeId === '') throw requerit('scope_id', "La regla necessita un àmbit de destinació.");

  // Les dues comprovacions, i totes dues calen: el compte és teu **i** hi pots escriure.
  await assertOwnAccount(ctx.tx, principal, accountId);
  await assertScopeAccess(ctx.tx, principal, scopeId);

  const id = input.id ?? uuidv7();
  const existing = await sql<RuleRow>`
    SELECT ${RULE_COLUMNS} FROM mail_rules WHERE id = ${id}
  `.execute(ctx.tx);
  if (existing.rows[0] !== undefined) {
    ctx.noChange();
    return { rule: toRule(existing.rows[0]), created: false };
  }

  /**
   * Una carpeta, una regla. **Es comprova aquí i també hi ha l'índex únic**: l'índex és el
   * que ho fa cert, i això és el que fa que l'usuari llegeixi una frase en comptes d'un
   * error de restricció.
   */
  const ocupada = await sql<{ n: number }>`
    SELECT COUNT(*) AS n FROM mail_rules
    WHERE account_id = ${accountId} AND folder = ${folder} AND deleted_at IS NULL
  `.execute(ctx.tx);
  if (Number(ocupada.rows[0]?.n ?? 0) > 0) {
    throw new PolicyError(
      'mail-folder-mapped',
      'Folder already mapped',
      409,
      `La carpeta "${folder}" ja té una regla en aquest compte.`,
    );
  }

  await sql`
    INSERT INTO mail_rules (id, account_id, folder, scope_id, project_id, action,
                            inbox_visible, title_template, body_to_description,
                            attachments_to_task, position, enabled, created_at, updated_at)
    VALUES (${id}, ${accountId}, ${folder}, ${scopeId}, ${input.project_id ?? null},
            ${input.action === 'task' ? 'task' : 'inbox'},
            ${dbBool(input.inbox_visible !== false)},
            ${assertTemplate(input.title_template ?? DEFAULT_MAIL_TEMPLATE)},
            ${dbBool(input.body_to_description !== false)},
            ${dbBool(input.attachments_to_task !== false)},
            ${input.position ?? 'a0'}, ${dbBool(input.enabled !== false)},
            ${ctx.now}, ${ctx.now})
  `.execute(ctx.tx);

  ctx.record({ entityType: 'mail_rule', entityId: id, scopeId, verb: 'created' });

  const created = await sql<RuleRow>`
    SELECT ${RULE_COLUMNS} FROM mail_rules WHERE id = ${id}
  `.execute(ctx.tx);
  return { rule: toRule(created.rows[0]!), created: true };
}

async function assertOwnRule(
  db: MigrationDb,
  principal: Principal,
  id: string,
): Promise<RuleRow> {
  const found = await sql<RuleRow>`
    SELECT ${RULE_COLUMNS} FROM mail_rules r
    WHERE r.id = ${id} AND r.deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM mail_accounts a
                  WHERE a.id = r.account_id AND a.user_id = ${principal.userId}
                    AND a.deleted_at IS NULL)
  `.execute(db);

  const rule = found.rows[0];
  if (rule === undefined) {
    throw new PolicyError('mail-rule-not-found', 'Not found', 404, 'Aquesta regla no existeix.');
  }
  return rule;
}

export type UpdateMailRuleInput = Omit<CreateMailRuleInput, 'id' | 'account_id'>;

export async function updateMailRule(
  ctx: AuditContext,
  principal: Principal,
  id: string,
  input: UpdateMailRuleInput,
): Promise<MailRuleSummary> {
  if (!hasCapability(principal, 'mail:write')) throw missingCapability('mail:write');
  const before = await assertOwnRule(ctx.tx, principal, id);

  const scopeId = input.scope_id ?? before.scope_id;
  // Es comprova el destí NOU: moure una regla cap a un àmbit on no hi ets seria escriure-hi.
  if (scopeId !== before.scope_id) await assertScopeAccess(ctx.tx, principal, scopeId);

  const folder = input.folder === undefined ? before.folder : normalizeFolder(input.folder.trim());
  if (folder === '') throw requerit('folder', 'La regla necessita una carpeta.');
  if (folder !== before.folder) {
    const ocupada = await sql<{ n: number }>`
      SELECT COUNT(*) AS n FROM mail_rules
      WHERE account_id = ${before.account_id} AND folder = ${folder} AND deleted_at IS NULL
    `.execute(ctx.tx);
    if (Number(ocupada.rows[0]?.n ?? 0) > 0) {
      throw new PolicyError(
        'mail-folder-mapped',
        'Folder already mapped',
        409,
        `La carpeta "${folder}" ja té una regla en aquest compte.`,
      );
    }
  }

  /**
   * **Canviar de carpeta reinicia el cursor.**
   *
   * El cursor és «per on anava aquesta carpeta», i l'UID 4.000 d'una carpeta no vol dir
   * res a l'altra. Arrossegar-lo faria que la carpeta nova s'ingerís a partir d'un punt
   * arbitrari: o se salta correus, o els reingereix tots. Es torna a començar, que amb la
   * regla del cursor inicial vol dir «des d'ara».
   */
  const canviaCarpeta = folder !== before.folder;

  await sql`
    UPDATE mail_rules SET
      folder = ${folder}, scope_id = ${scopeId},
      project_id = ${input.project_id === undefined ? before.project_id : input.project_id},
      action = ${input.action ?? (before.action === 'task' ? 'task' : 'inbox')},
      inbox_visible = ${dbBool(input.inbox_visible ?? Boolean(before.inbox_visible))},
      title_template = ${assertTemplate(input.title_template ?? before.title_template)},
      body_to_description = ${dbBool(input.body_to_description ?? Boolean(before.body_to_description))},
      attachments_to_task = ${dbBool(input.attachments_to_task ?? Boolean(before.attachments_to_task))},
      position = ${input.position ?? before.position},
      enabled = ${dbBool(input.enabled ?? Boolean(before.enabled))},
      uid_validity = ${canviaCarpeta ? null : sql`uid_validity`},
      last_uid = ${canviaCarpeta ? null : sql`last_uid`},
      updated_at = ${ctx.now}
    WHERE id = ${id}
  `.execute(ctx.tx);

  ctx.record({ entityType: 'mail_rule', entityId: id, scopeId, verb: 'updated' });
  return toRule(await assertOwnRule(ctx.tx, principal, id));
}

export async function deleteMailRule(
  ctx: AuditContext,
  principal: Principal,
  id: string,
): Promise<void> {
  if (!hasCapability(principal, 'mail:write')) throw missingCapability('mail:write');
  const rule = await assertOwnRule(ctx.tx, principal, id);

  await sql`
    UPDATE mail_rules SET deleted_at = ${ctx.now}, updated_at = ${ctx.now} WHERE id = ${id}
  `.execute(ctx.tx);
  ctx.record({
    entityType: 'mail_rule',
    entityId: id,
    scopeId: rule.scope_id,
    verb: 'deleted',
  });
}

/** Les variables que la pantalla pot oferir, i les que una plantilla té mal escrites. */
export const MAIL_VARS = MAIL_TEMPLATE_VARS;
export { unknownMailVars };

// ------------------------------------------------------ el correu a la bústia

/**
 * Un correu que ha entrat i **encara no és una tasca**.
 *
 * Tipus propi i array propi, com `InboxEvent`. Si compartís llista amb les tasques, un dia
 * algú passaria un correu per on passa una tasca i la distinció s'evaporaria sense que res
 * fallés.
 */
export interface InboxMail {
  id: string;
  account_id: string;
  message_key: string;
  subject: string | null;
  from_name: string | null;
  from_address: string | null;
  received_at: string | null;
  scope_id: string;
  project_id: string | null;
  account_name: string | null;
  folder: string | null;
  has_attachments: boolean;
  source_kind: 'mail';
}

interface InboxMailRow {
  id: string;
  account_id: string;
  message_key: string;
  subject: string | null;
  from_name: string | null;
  from_address: string | null;
  internal_date: string | null;
  sent_at: string | null;
  scope_id: string;
  project_id: string | null;
  account_name: string | null;
  folder: string | null;
}

/**
 * Els correus a la bústia de qui pregunta.
 *
 * **No filtra per dia, i és deliberat.** Un esdeveniment té data pròpia i per això la
 * bústia d'un dia el porta o no; un correu que ha arribat és una cosa pendent fins que en
 * facis alguna cosa, i amagar-lo demà seria perdre'l. Surt fins que es converteix o es
 * descarta.
 *
 * I **només els comptes de qui pregunta**: un compte de correu és d'una persona, i la
 * bústia d'un àmbit compartit no ha de portar el correu personal de ningú.
 */
export async function listInboxMail(
  db: MigrationDb,
  principal: Principal,
  scopeIds?: string[] | undefined,
): Promise<InboxMail[]> {
  if (!hasCapability(principal, 'mail:read')) return [];

  const found = await sql<InboxMailRow>`
    SELECT m.id, m.account_id, m.message_key, m.subject, m.from_name, m.from_address,
           m.internal_date, m.sent_at, r.scope_id, r.project_id, a.name AS account_name,
           m.folder
    FROM mail_messages m
    JOIN mail_rules r ON r.id = m.rule_id
    JOIN mail_accounts a ON a.id = m.account_id
    WHERE m.deleted_at IS NULL AND m.disposition = 'inbox'
      AND a.user_id = ${principal.userId} AND a.deleted_at IS NULL
      AND r.inbox_visible = ${dbBool(true)}
    ORDER BY m.internal_date DESC, m.id DESC
    LIMIT 200
  `.execute(db);

  return found.rows
    .filter((row) => scopeIds === undefined || scopeIds.includes(row.scope_id))
    .map((row) => ({
      id: row.id,
      account_id: row.account_id,
      message_key: row.message_key,
      subject: row.subject,
      from_name: row.from_name,
      from_address: row.from_address,
      // La del servidor que el va rebre, i la del remitent només com a recanvi.
      received_at: row.internal_date ?? row.sent_at,
      scope_id: row.scope_id,
      project_id: row.project_id,
      account_name: row.account_name,
      folder: row.folder,
      has_attachments: false,
      source_kind: 'mail' as const,
    }));
}
