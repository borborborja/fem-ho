/**
 * Convertir un correu **des de la bústia**, quan ho demana una persona.
 *
 * Va a part de `mail-convert.ts` perquè aquella funció és la que fa la feina i aquesta és
 * la que decideix **si aquest correu és teu**. Separar-les vol dir que el camí del
 * planificador i el de la interfície comparteixen la conversió i no la comprovació: el
 * planificador ja sap de qui és el compte perquè hi ha entrat per allà, i aquí s'ha de
 * demanar.
 */

import { sql } from 'kysely';
import { catalogOf, isLocale, FALLBACK, type Locale } from '@fem-ho/contracts';
import type { AuditContext } from '../audit/audited-transaction.js';
import { PolicyError, missingCapability } from '../policy/errors.js';
import { hasCapability, type Principal } from '../policy/principal.js';
import { convertMailToTask, type ConvertRule, type MailMessageRow } from './mail-convert.js';
import { getTask } from './tasks.js';
import type { Task } from './tasks.js';

interface Context extends MailMessageRow {
  account_name: string;
  scope_id: string;
  project_id: string | null;
  title_template: string;
  body_to_description: number;
  locale: string | null;
}

export async function convertOwnMail(
  ctx: AuditContext,
  principal: Principal,
  messageId: string,
): Promise<Task> {
  if (!hasCapability(principal, 'mail:write')) throw missingCapability('mail:write');

  /**
   * **El correu, la regla i el compte d'una sola vegada, i amb `a.user_id` a la consulta.**
   *
   * Si el propietari es comprovés a part, hi hauria un camí en què la conversió s'executa
   * amb la regla d'un altre. Aquí no existeix: o la fila és teva, o no hi ha fila.
   */
  const found = await sql<Context>`
    SELECT m.id, m.account_id, m.thread_id, m.message_key, m.folder, m.subject, m.from_name,
           m.from_address, m.body_text, m.internal_date, m.disposition, m.rule_id,
           a.name AS account_name, r.scope_id, r.project_id, r.title_template,
           r.body_to_description, u.locale
    FROM mail_messages m
    JOIN mail_accounts a ON a.id = m.account_id
    JOIN mail_rules r ON r.id = m.rule_id
    JOIN users u ON u.id = a.user_id
    WHERE m.id = ${messageId} AND a.user_id = ${principal.userId}
      AND m.deleted_at IS NULL AND a.deleted_at IS NULL
  `.execute(ctx.tx);

  const row = found.rows[0];
  if (row === undefined) {
    throw new PolicyError('mail-message-not-found', 'Not found', 404, 'Aquest correu no existeix.');
  }

  const locale: Locale = isLocale(row.locale ?? '') ? (row.locale as Locale) : FALLBACK;
  const rule: ConvertRule = {
    scope_id: row.scope_id,
    project_id: row.project_id,
    title_template: row.title_template,
    body_to_description: row.body_to_description !== 0,
  };

  const { taskId } = await convertMailToTask(ctx, principal, row, rule, {
    accountName: row.account_name,
    locale,
    fallbackTitle: catalogOf(locale)['inbox.mail.noSubject'] ?? '(sense assumpte)',
  });

  const task = await getTask(ctx.tx, principal, taskId);
  if (task === null) {
    throw new PolicyError('task-missing', 'Not found', 404, "La tasca no s'ha pogut llegir.");
  }
  return task;
}
