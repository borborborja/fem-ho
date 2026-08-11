/**
 * D'un correu en surt una tasca.
 *
 * **EL TÍTOL EL FA LA MATEIXA FUNCIÓ QUE LA PREVISUALITZACIÓ**
 * -----------------------------------------------------------
 * `renderMailTitle`, dels contractes. Si el servidor en tingués una còpia, un dia
 * divergirien i el que veus escrivint la plantilla no seria el que et surt al tauler. I ve
 * de regal la propietat que importa: **una sola passada**, o sigui que un assumpte que
 * sigui literalment `{{from_email}}` no s'expandeix.
 *
 * **EL QUE MAI DECIDEIX EL CORREU**
 * ---------------------------------
 * L'àmbit i el projecte els posa **la regla**, i la regla la va escriure una persona. Un
 * remitent pot escriure el que vulgui a l'assumpte i al cos; el que no pot és triar a quin
 * àmbit va a parar. És l'única barrera estructural entre un text hostil i el sistema, i per
 * això no hi ha cap camí en què una dada del correu canviï la destinació.
 *
 * **LA PROVINENÇA SOBREVIU A LA CONVERSIÓ**
 * ------------------------------------------
 * `source_kind = 'mail'` més `mail_account_id`, `mail_thread_key` i `mail_message_key`. Les
 * dues últimes són **claus i no claus foranes**: la fila del fil es pot purgar per retenció
 * i la tasca ha de sobreviure a la purga amb la provinença intacta. Amb una clau forana,
 * purgar obligaria a triar entre trencar-la i esborrar tasques d'algú.
 */

import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { renderMailTitle, type MailTemplateVars } from '@fem-ho/contracts';
import type { AuditContext } from '../audit/audited-transaction.js';
import { PolicyError } from '../policy/errors.js';
import type { Principal } from '../policy/principal.js';
import { addComment } from './comments.js';

export interface MailMessageRow {
  id: string;
  account_id: string;
  thread_id: string;
  message_key: string;
  folder: string;
  subject: string | null;
  from_name: string | null;
  from_address: string | null;
  body_text: string | null;
  internal_date: string | null;
  disposition: string;
  rule_id: string | null;
}

export interface ConvertRule {
  scope_id: string;
  project_id: string | null;
  title_template: string;
  body_to_description: boolean;
}

/**
 * El cos, retallat.
 *
 * Ja arriba convertit a text (`htmlToText`) o és text pla d'entrada: **cap marcatge d'un
 * desconegut es desa mai**, que és el que impedeix que això sigui XSS emmagatzemat servit
 * des del teu propi domini.
 */
export const DESCRIPTION_MAX = 8192;

/** Les variables de la plantilla, tal com surten d'un correu. */
export function varsOf(
  message: MailMessageRow,
  accountName: string,
  locale: string,
): MailTemplateVars {
  const name = message.from_name ?? '';
  const email = message.from_address ?? '';
  const quan = message.internal_date;
  return {
    subject: message.subject ?? '',
    from_name: name,
    from_email: email,
    // La variable que estalvia el condicional que ningú vol escriure a una plantilla.
    from: name !== '' ? name : email,
    date:
      quan === null
        ? ''
        : new Intl.DateTimeFormat(locale, { dateStyle: 'short' }).format(new Date(quan)),
    folder: message.folder,
    account: accountName,
  };
}

export interface ConvertResult {
  taskId: string;
  created: boolean;
}

/**
 * Converteix un correu en una tasca, o el penja com a comentari si el fil ja en té una.
 *
 * **Idempotent per `message_key`.** El mateix correu convertit dues vegades —dos clics, un
 * reintent, un rescaneig— dona la mateixa tasca i no dues: la clau és la del `Message-ID`,
 * i qui la té ja té la tasca.
 */
export async function convertMailToTask(
  ctx: AuditContext,
  principal: Principal,
  message: MailMessageRow,
  rule: ConvertRule,
  options: { accountName: string; locale: string; fallbackTitle: string },
): Promise<ConvertResult> {
  const ja = await sql<{ id: string }>`
    SELECT id FROM tasks
    WHERE mail_account_id = ${message.account_id} AND mail_message_key = ${message.message_key}
      AND deleted_at IS NULL
    LIMIT 1
  `.execute(ctx.tx);
  if (ja.rows[0] !== undefined) {
    ctx.noChange();
    return { taskId: ja.rows[0].id, created: false };
  }

  /**
   * **Si el fil ja té tasca viva, això és un comentari i no una tasca nova.**
   *
   * Guanya fins i tot sobre una regla que digui «fes-ne una tasca»: si no, respondre un
   * correu obriria una segona tasca del mateix assumpte i acabaries amb el fil partit en
   * dues coses a fer.
   */
  const delFil = await sql<{ id: string }>`
    SELECT id FROM tasks
    WHERE mail_account_id = ${message.account_id}
      AND mail_thread_key = (SELECT thread_key FROM mail_threads WHERE id = ${message.thread_id})
      AND deleted_at IS NULL
    LIMIT 1
  `.execute(ctx.tx);

  if (delFil.rows[0] !== undefined) {
    const taskId = delFil.rows[0].id;
    await addComment(ctx, principal, taskId, comentariDe(message));
    await sql`
      UPDATE mail_messages SET disposition = 'comment', task_id = ${taskId},
             updated_at = ${ctx.now}
      WHERE id = ${message.id}
    `.execute(ctx.tx);
    return { taskId, created: false };
  }

  const vars = varsOf(message, options.accountName, options.locale);
  const title = renderMailTitle(rule.title_template, vars, options.fallbackTitle);

  const threadKey = await sql<{ thread_key: string }>`
    SELECT thread_key FROM mail_threads WHERE id = ${message.thread_id}
  `.execute(ctx.tx);

  const taskId = uuidv7();
  const description =
    rule.body_to_description && message.body_text !== null
      ? message.body_text.slice(0, DESCRIPTION_MAX)
      : null;

  await sql`
    INSERT INTO tasks (id, scope_id, project_id, title, description, status, position,
                       origin, source_kind, mail_account_id, mail_thread_key,
                       mail_message_key, created_by, created_at, updated_at)
    VALUES (${taskId}, ${rule.scope_id}, ${rule.project_id}, ${title}, ${description},
            'inbox', ${posicioDe(message)}, 'native', 'mail', ${message.account_id},
            ${threadKey.rows[0]?.thread_key ?? message.message_key}, ${message.message_key},
            ${principal.userId === '' ? null : principal.userId}, ${ctx.now}, ${ctx.now})
  `.execute(ctx.tx);

  await sql`
    UPDATE mail_messages SET disposition = 'task', task_id = ${taskId}, updated_at = ${ctx.now}
    WHERE id = ${message.id}
  `.execute(ctx.tx);
  await sql`
    UPDATE mail_threads SET task_id = ${taskId}, updated_at = ${ctx.now}
    WHERE id = ${message.thread_id}
  `.execute(ctx.tx);

  ctx.record({
    entityType: 'task',
    entityId: taskId,
    scopeId: rule.scope_id,
    verb: 'created',
    changes: { title: { from: null, to: title } },
  });

  return { taskId, created: true };
}

/**
 * El text del comentari que deixa una resposta.
 *
 * Porta **el remitent de debò** —el del correu, no el que hagi sortit de cap plantilla— i
 * per això no es pot falsejar escrivint-lo a l'assumpte.
 */
function comentariDe(message: MailMessageRow): string {
  const qui = message.from_name ?? message.from_address ?? '';
  const cap = qui === '' ? '' : `${qui}: `;
  const cos = (message.body_text ?? message.subject ?? '').slice(0, 2000).trim();
  return `${cap}${cos === '' ? (message.subject ?? '') : cos}`.trim() || 'Un correu del fil.';
}

/**
 * La posició de la targeta nova.
 *
 * Deriva de l'instant en què el servidor va rebre el correu, o sigui que **l'ordre de la
 * bústia és l'ordre en què van arribar**. Amb una constant, tots els correus del dia
 * caurien al mateix lloc i l'ordre el decidiria l'identificador.
 */
function posicioDe(message: MailMessageRow): string {
  const quan = message.internal_date ?? '';
  return `m${quan.replace(/[^0-9]/gu, '').slice(0, 14)}`;
}

/** Descartar un correu de la bústia. No l'esborra: deixa de sortir. */
export async function dismissMail(
  ctx: AuditContext,
  messageId: string,
  userId: string,
): Promise<void> {
  /**
   * **`ctx.tx` i no la connexió principal.** Amb SQLite, consultar la connexió mentre la
   * transacció la té agafada penja el procés fins que salta el temps d'espera: és un
   * bloqueig, no una lentitud, i des de fora sembla que la petició no acabi mai. La
   * mateixa lliçó que ja porta escrita el planificador.
   */
  const found = await sql<{ id: string }>`
    SELECT m.id FROM mail_messages m
    JOIN mail_accounts a ON a.id = m.account_id
    WHERE m.id = ${messageId} AND a.user_id = ${userId} AND m.deleted_at IS NULL
  `.execute(ctx.tx);
  if (found.rows[0] === undefined) {
    throw new PolicyError('mail-message-not-found', 'Not found', 404, 'Aquest correu no existeix.');
  }

  /**
   * `dismissed` i no `deleted_at`: el correu segueix al llibre de comptes i **no es torna a
   * ingerir** el pròxim rescaneig. Esborrar-lo el faria tornar la primera vegada que el
   * servidor reindexés.
   */
  await sql`
    UPDATE mail_messages SET disposition = 'dismissed', updated_at = ${ctx.now}
    WHERE id = ${messageId}
  `.execute(ctx.tx);
}
