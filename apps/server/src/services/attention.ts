/**
 * «Aquesta tasca espera resposta».
 *
 * És l'única cosa que un agent que treballa sol no pot resoldre pel seu compte: quina de
 * les dues factures, si el text va bé, quina credencial. Ho podia dir en un comentari des
 * del primer dia —i ho segueix dient—, però un comentari **no arriba a ningú**: per veure'l
 * cal obrir la tasca, i el motiu per obrir-la és justament el que no se sap.
 *
 * Aquí hi ha les dues meitats del senyal i res més. La pregunta viu a `comments.ts`, que és
 * on viuen les preguntes; això és el que fa que es vegi sense entrar-hi.
 *
 * **QUI EL BAIXA, I PER QUÈ NO HI HA CAP BOTÓ DE «VIST»**
 * -------------------------------------------------------
 * El baixa **respondre**, i completar la tasca. Un botó de vist deixaria la marca neta amb
 * l'agent encara esperant, que és pitjor que no tenir-la: la pantalla diria que no hi ha
 * res pendent i el que hi hauria seria un agent aturat per sempre.
 */

import { sql } from 'kysely';
import type { AuditContext } from '../audit/audited-transaction.js';
import { dbBool } from '../db/bool.js';

/** Aixeca la marca. `now` hi va perquè «des de quan» és mitja resposta. */
export async function raiseAttention(ctx: AuditContext, taskId: string): Promise<void> {
  await sql`
    UPDATE tasks
    SET needs_attention = ${dbBool(true)}, attention_asked_at = ${ctx.now}, updated_at = ${ctx.now}
    WHERE id = ${taskId}
  `.execute(ctx.tx);
}

/**
 * Baixa la marca si hi era. Torna si hi era, perquè qui crida pugui decidir si val la pena
 * deixar-ne rastre: baixar una marca que no hi era no és cap gest.
 *
 * `attention_asked_at` **no s'esborra**: quan va preguntar segueix sent cert després de
 * respondre, i és el que permet dir demà quant s'hi va estar esperant.
 */
export async function clearAttention(ctx: AuditContext, taskId: string): Promise<boolean> {
  // Es compten les files tocades i no es fa `RETURNING`: la casa fa servir els dos motors
  // i el recompte és el camí que tots dos entenen igual.
  const result = await sql`
    UPDATE tasks SET needs_attention = ${dbBool(false)}, updated_at = ${ctx.now}
    WHERE id = ${taskId} AND needs_attention = ${dbBool(true)}
  `.execute(ctx.tx);
  return Number(result.numAffectedRows ?? 0n) > 0;
}
