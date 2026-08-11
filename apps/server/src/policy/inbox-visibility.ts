/**
 * Què d'una font entra a la bústia d'algú.
 *
 * La bústia d'un dia són les tasques **més el que arriba de fora**: calendaris CalDAV,
 * `.ics` publicats i canals RSS. Però "tot el que arriba" no serveix, i per dos motius
 * ben diferents: un RSS pot escopir desenes de titulars al dia, i una cita concreta pot
 * no ser feina meva encara que el calendari sí que ho sigui.
 *
 * Aquest fitxer és **la resposta sencera a aquella pregunta, i és pur**: sense base de
 * dades, sense principal, sense `async`. Qui el crida ja ha carregat les dades; aquí
 * només es decideix. Això el fa provable de veritat, que és el que volem d'una regla que
 * governa la pantalla principal.
 *
 * ELS CINC NIVELLS, I PER QUÈ AQUEST ORDRE
 * ----------------------------------------
 * Del més fort al més feble. Cadascun només mana si el de sobre no diu res:
 *
 *   0. **Ja n'hi ha una tasca viva.** Guanya a tot. És el que evita el problema que va
 *      obrir aquesta funció: veure la mateixa obligació dues vegades, una com a cita i
 *      una com a feina. Si ja n'has fet una tasca, la feina viu a la targeta.
 *   1. **La marca d'aquesta ocurrència.** "Aquesta reunió del dimarts, no."
 *   2. **La marca de la sèrie.** "Cap reunió d'aquestes."
 *   3. **L'ajust del calendari.** "Aquest RSS inunda."
 *   4. **El defecte del seu `source_kind`.**
 *
 * L'ordre 1-2 és el que fa que es puguin combinar: amagues la sèrie sencera i en
 * recuperes una. Al revés seria una marca de sèrie que no es pot excepcionar mai.
 *
 * QUÈ ÉS DE CADASCÚ I QUÈ ÉS DE LA CASA
 * -------------------------------------
 * Els nivells 1 i 2 són **per usuari**; el 0 i el 3, de l'àmbit. No és una incoherència,
 * és la distinció que hi ha:
 *
 *   - "Aquest RSS inunda" és un judici sobre **la font**, igual per a tothom, i viu al
 *     costat de les altres propietats de la font.
 *   - "Aquesta cita no és feina meva" és **personal**: si em faig la tasca del dentista,
 *     la cita se m'ha de difuminar a mi i no a qui visqui amb mi.
 *   - El nivell 0 ha de ser de l'àmbit, encara que sembli personal: si converteixo la
 *     cita en tasca de la família, ha de marxar de la bústia de tothom, perquè la feina
 *     ja és a la columna del costat i seguir veient la cita seria veure-la dues vegades.
 *
 * PER QUÈ EL DEFECTE DELS RSS I DEL CORREU ÉS "NO"
 * ------------------------------------------------
 * Un ítem d'RSS és un instant, no una durada (`dav/rss.ts`), i un canal actiu en pot
 * publicar desenes al dia. Amb el defecte a "sí", el primer matí després de subscriure'n
 * un, la bústia —que és l'entrada de tot— queda enterrada, i la reacció raonable de
 * qualsevol és deixar de mirar-la.
 *
 * Trenca a mitges el principi de la migració 006 ("una font nova ha de sortir sola"), i
 * es fa a posta: allà es parlava del calendari, on una font de més és una capa més; aquí
 * es parla de la llista del que has de fer avui.
 *
 * **El correu segueix el mateix criteri, i encara més clar.** Una carpeta de correu en pot
 * portar desenes al dia i la immensa majoria no són feina: mapar-la és dir "vull veure això
 * en algun lloc", no "posa-m'ho tot a la llista de coses per fer". Amb el calendari fent
 * d'organitzador, el que arriba hi és sempre i tu decideixes què puja.
 *
 * QUATRE MENES, UNA SOLA CASCADA
 * ------------------------------
 * Els cinc nivells valen igual per a una cita i per a un correu; el que canvia és **d'on
 * surt cada nivell**, i prou:
 *
 *   | Nivell | Cita                      | Correu                          |
 *   | ------ | ------------------------- | ------------------------------- |
 *   | 0      | `tasks.event_uid`         | `tasks.mail_message_key`        |
 *   | 1      | marca de l'ocurrència     | `mail_messages.inbox_visible`   |
 *   | 2      | marca de la sèrie         | *(el fil: buit a posta)*        |
 *   | 3      | `calendars.inbox_visible` | `mail_rules.inbox_visible`      |
 *   | 4      | `defaultInInbox`          | `defaultInInbox`                |
 *
 * El nivell 2 del correu seria "tot aquest fil, no". No es fa ara —ningú ho ha demanat i
 * demana decidir on viu—, i el forat es deixa obert a posta: `seriesMark` accepta `null` i
 * el dia que es vulgui, hi entra sense tocar res més.
 */

export type CalendarOrigin = 'local' | 'subscription';
export type SourceKind = 'caldav' | 'ical' | 'rss' | 'mail' | null;

export interface InboxVisibilityInput {
  origin: CalendarOrigin;
  sourceKind: SourceKind;
  /** L'ajust del calendari. `null` vol dir que no s'hi ha dit res. */
  calendarInboxVisible: boolean | null;
  /** Marca de `(user, calendar, uid, NULL)`: tota la sèrie. `null` si no n'hi ha. */
  seriesMark: boolean | null;
  /** Marca de `(user, calendar, uid, recurrence_id)`: una ocurrència. */
  occurrenceMark: boolean | null;
  /** Ja hi ha una tasca viva feta a partir d'aquesta identitat. */
  hasLiveTask: boolean;
}

/**
 * El defecte per mena de font, quan ningú ha dit res.
 *
 * S'exporta a part perquè el servidor l'envia als clients com a
 * `Calendar.inbox_visible_default`: així l'interruptor d'Ajustos pot ensenyar la posició
 * correcta d'un calendari sense excepció, i **cap client ha de duplicar aquesta regla**.
 * El dia que canviï, canvia en un lloc.
 */
export function defaultInInbox(origin: CalendarOrigin, sourceKind: SourceKind): boolean {
  // Un calendari d'aquesta casa: hi és. No hi ha cap raó per amagar el que has escrit tu.
  if (origin === 'local') return true;
  return sourceKind !== 'rss' && sourceKind !== 'mail';
}

export function isInInbox(input: InboxVisibilityInput): boolean {
  if (input.hasLiveTask) return false;
  if (input.occurrenceMark !== null) return input.occurrenceMark;
  if (input.seriesMark !== null) return input.seriesMark;
  if (input.calendarInboxVisible !== null) return input.calendarInboxVisible;
  return defaultInInbox(input.origin, input.sourceKind);
}
