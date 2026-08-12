/**
 * Reconstruir la dedicació del passat des de l'historial.
 *
 * **PER QUÈ ES POT FER SENSE INVENTAR RES.** `activity_log` guarda cada canvi de columna amb
 * `changes.status = {from, to}` i el seu instant, des del primer dia i sense purga. O sigui
 * que «quan va entrar a Fent i quan en va sortir» és una dada que ja hi és: activar el
 * Registre a un àmbit que fa mesos que funciona no comença de zero, comença amb el que va
 * passar de debò.
 *
 * **LES DUES REGLES QUE EVITEN INVENTAR-SE'N**
 * --------------------------------------------
 * 1. **Sense sortida, no hi ha bloc.** Si l'historial diu que una tasca va entrar a Fent i no
 *    diu mai que en va sortir —un forat del registre, una migració antiga—, no se'n treu cap
 *    durada. L'alternativa seria tancar-lo amb el següent rastre que hi hagi, i llavors el
 *    número seria una suposició amb pinta de mesura.
 * 2. **L'excepció és la tasca que hi és ara.** Si l'última cosa que va passar és que va
 *    entrar a Fent, el bloc es queda **obert**: no és cap forat, és una tasca que s'està fent.
 *
 * **DE QUI ÉS EL TEMPS.** De qui va moure la targeta cap a Fent. És l'única atribució que
 * l'historial permet i, de fet, la correcta: qui la va posar en marxa és qui hi va treballar.
 * Un agent d'IA també hi surt, a nom de la persona en nom de qui actua, com a tot arreu.
 *
 * Fitxer **pur**: rep files ordenades i torna trams.
 */

/** Un canvi de columna, tal com surt de l'historial. */
export interface StatusChange {
  taskId: string;
  at: string;
  from: string | null;
  to: string | null;
  /** Qui el va fer. Pot faltar (un convidat, el sistema): llavors el tram no té amo. */
  userId: string | null;
}

export interface RebuiltSession {
  taskId: string;
  userId: string;
  startedAt: string;
  /** `null` només per a la que encara s'està fent. */
  endedAt: string | null;
}

/**
 * Els trams a Fent que es poden deduir de l'historial.
 *
 * `changes` ha d'arribar **ordenat per instant**. Es fa així i no ordenant aquí perquè qui
 * el crida el llegeix amb `ORDER BY created_at, id`, que és el mateix ordre que fa servir
 * l'historial per pintar-se: si algun dia divergeixen, val més que divergeixin en un sol lloc.
 */
export function rebuildSessions(changes: StatusChange[]): RebuiltSession[] {
  const sessions: RebuiltSession[] = [];
  const obertes = new Map<string, RebuiltSession>();

  for (const change of changes) {
    const oberta = obertes.get(change.taskId);

    if (change.from === 'doing' && oberta !== undefined) {
      oberta.endedAt = change.at;
      obertes.delete(change.taskId);
    }

    if (change.to === 'doing') {
      /**
       * Dues entrades seguides sense sortida volen dir que hi falta una fila. La primera es
       * descarta —no en sabem el final— i mana l'última, que és la que explica on és la
       * tasca ara.
       */
      const nova: RebuiltSession = {
        taskId: change.taskId,
        userId: change.userId ?? '',
        startedAt: change.at,
        endedAt: null,
      };
      obertes.set(change.taskId, nova);
      sessions.push(nova);
    }
  }

  /**
   * Les que s'han quedat obertes: només val la que és **l'últim que va passar** a la seva
   * tasca, perquè és la que vol dir «s'està fent». Si després hi ha hagut més canvis de
   * columna, el tram té un forat i no se'n treu res.
   */
  const ultimCanvi = new Map<string, string>();
  for (const change of changes) ultimCanvi.set(change.taskId, change.at);

  return sessions.filter((session) => {
    if (session.userId === '') return false;
    if (session.endedAt !== null) return session.endedAt > session.startedAt;
    return ultimCanvi.get(session.taskId) === session.startedAt;
  });
}
