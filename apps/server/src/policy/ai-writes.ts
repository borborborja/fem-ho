/**
 * Qui pot tocar una tasca mentre hi ha un agent pel mig.
 *
 * **EL PANY JA EXISTIA I NO MANAVA RES**
 * --------------------------------------
 * `task_leases` reserva una tasca 30 minuts perquè dos agents no facin la mateixa feina
 * dues vegades. El que no feia era protegir res: cap escriptura la consultava, o sigui que
 * una persona es podia endur una tasca **mentre l'agent hi treballava** —i deixar-lo
 * escrivint contra una cosa que ja no existeix com ell la va llegir— i un agent podia seguir
 * movent una tasca que li havien reclamat.
 *
 * Aquí hi ha les tres frases que ho ordenen, i cap necessita una taula nova:
 *
 *   1. **Un agent no escriu en una tasca `manual`.** És el que li fa d'avís quan li han
 *      reclamat la feina: la següent cosa que provi li dirà per què ja no és seva.
 *   2. **Un agent només mou i completa el que té reservat.** Sense reserva, la resposta diu
 *      què ha de fer —`next_task` o `claim`— i no només que no.
 *   3. **Una persona no mou ni reclama una tasca bloquejada.** L'agent hi és a dins; el pany
 *      caduca sol als 30 minuts i llavors ja és teva.
 *
 * **EL QUE NO ES BLOQUEJA, I PER QUÈ**
 * ------------------------------------
 * - **Comentar, sempre.** Reportar no s'ha de poder bloquejar mai: un agent que no pot dir
 *   què li passa és un agent que s'atura en silenci, i una persona que no pot respondre
 *   deixaria l'agent esperant per sempre.
 * - **Editar el text, també.** Afegir instruccions a una tasca bloquejada no la treu de sota
 *   l'agent; endur-se-la sí. El que es protegeix és **on és la tasca i de qui és**, no cada
 *   caràcter del títol.
 *
 * Fitxer **pur**: sense base de dades i sense `async`. Qui el crida ja ha carregat la tasca i
 * la seva reserva; aquí només es decideix.
 */

import { PolicyError } from './errors.js';

/** La reserva viva d'una tasca. `null` vol dir desbloquejada. */
export interface ActiveLease {
  /** Quin agent la té, o `null` si qui la va reservar era una persona. */
  agentId: string | null;
  userId: string;
  expiresAt: string;
}

/** L'estat de la tasca que decideix, i res més. */
export interface TaskWriteState {
  aiMode: 'manual' | 'assisted' | 'delegated';
  lease: ActiveLease | null;
}

/** Qui vol escriure. */
export interface Writer {
  kind: 'user' | 'agent' | 'guest';
  agentId?: string | undefined;
}

/**
 * Què vol fer.
 *
 * - `move` — canviar de columna o completar-la. Canvia on és.
 * - `take-over` — endur-se-la cap al tauler humà. Canvia de qui és.
 * - `edit` — el text, les dates, les etiquetes.
 */
export type WriteIntent = 'move' | 'take-over' | 'edit';

/** Per què no. `null` vol dir que sí. */
export type WriteRefusal =
  | { reason: 'human-took-over' }
  | { reason: 'not-claimed' }
  | { reason: 'claimed-by-other'; agentId: string | null; until: string }
  | { reason: 'locked'; agentId: string; until: string };

export function refuseTaskWrite(
  writer: Writer,
  task: TaskWriteState,
  intent: WriteIntent,
): WriteRefusal | null {
  if (writer.kind === 'agent') {
    // Reclamada per una persona: la feina ja no és seva, i això és l'avís.
    if (task.aiMode === 'manual') return { reason: 'human-took-over' };

    // Editar-la sense tenir-la reservada seria escriure a cegues sobre el que un altre
    // pugui estar fent; el remei és una crida, no una excepció.
    if (task.lease === null) return { reason: 'not-claimed' };
    if (task.lease.agentId !== writer.agentId) {
      return {
        reason: 'claimed-by-other',
        agentId: task.lease.agentId,
        until: task.lease.expiresAt,
      };
    }
    return null;
  }

  /**
   * Una persona. Només la frenen els dos gestos que li treuen la tasca de sota a l'agent, i
   * només si qui la té és **un agent**: una reserva d'una persona no bloqueja ningú, que és
   * el que era abans que això existís.
   */
  if (intent === 'edit') return null;
  if (task.lease === null || task.lease.agentId === null) return null;
  return { reason: 'locked', agentId: task.lease.agentId, until: task.lease.expiresAt };
}

/**
 * El refús, en el format que entenen els tres públics (docs/05 §3).
 *
 * El `detail` va en anglès perquè el llegeix el model per MCP i ha de ser **accionable**
 * —quina crida li falta—, i els `params` porten les dades perquè la pantalla el pugui dir
 * en l'idioma de qui mira. Els minuts i no l'instant: un ISO cru dins d'una frase no és
 * res que ningú vulgui llegir, i el que es vol saber és **quant falta**.
 */
export function refusalError(
  refusal: WriteRefusal,
  context: { agentName?: string | undefined; now?: string | undefined } = {},
): PolicyError {
  const nom = context.agentName ?? 'the agent';

  if (refusal.reason === 'human-took-over') {
    return new PolicyError(
      'human-took-over',
      'Taken over by a person',
      403,
      'A person has taken this task over: it is no longer yours. Do not keep working on it.',
    );
  }

  if (refusal.reason === 'not-claimed') {
    return new PolicyError(
      'not-claimed',
      'Task not claimed',
      403,
      'You have not claimed this task. Call `next_task`, or `claim` it, before writing to it.',
    );
  }

  const minuts = minutesLeft(refusal.until, context.now);

  if (refusal.reason === 'claimed-by-other') {
    return new PolicyError(
      'claimed-by-other',
      'Claimed by someone else',
      409,
      `Another agent has this task claimed for the next ${String(minuts)} minutes.`,
      { minutes: minuts, until: refusal.until },
    );
  }

  return new PolicyError(
    'task-locked',
    'Task locked',
    409,
    `${nom} is working on this task right now. The claim expires in ${String(minuts)} minutes.`,
    { agent: nom, minutes: minuts, until: refusal.until },
  );
}

/** Quants minuts falten, mai negatius i mai zero: «d'aquí a 0 minuts» no diu res. */
function minutesLeft(until: string, now: string | undefined): number {
  const restants = Math.ceil(
    (Date.parse(until) - Date.parse(now ?? new Date().toISOString())) / 60_000,
  );
  return restants < 1 ? 1 : restants;
}
