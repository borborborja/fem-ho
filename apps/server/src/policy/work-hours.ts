/**
 * Què és horari i què és hora extra.
 *
 * Un bloc de temps treballat és un interval; l'horari laboral és una franja de **paret** que
 * es repeteix cada dia laborable. Creuar-los és la feina d'aquest fitxer, i té tres paranys
 * que no es veuen fins que passen:
 *
 *   1. **Un bloc pot travessar la mitjanit.** El que comença a les 23:30 i acaba a la 1:00 no
 *      és «un dia»: són dos trossos amb dos horaris i potser dos criteris de si és laborable.
 *   2. **Un dia local no dura sempre 24 h.** Als canvis d'hora en dura 23 o 25, i qualsevol
 *      aritmètica de «inici + 24 h» dona un resultat incorrecte dos dies l'any sense donar
 *      cap error (docs/01 §8). Per això aquí es demanen els límits del dia i no se sumen.
 *   3. **L'horari es diu en hores de paret i els blocs es guarden en UTC.** Comparar-los
 *      directament funciona nou mesos l'any i es trenca al març.
 *
 * **QUÈ NO ES DESA**
 * ------------------
 * Les hores extres **no s'escriuen enlloc**. Són una lectura del bloc contra l'horari
 * d'aquell moment, i desar-les voldria dir que canviar l'horari deixaria el passat dient una
 * cosa que ja no és certa —o obligaria a recalcular-ho tot, que és el mateix amb més passos.
 *
 * Fitxer **pur**: rep instants i configuració, i torna minuts.
 */

import {
  localDateOf,
  localDayBounds,
  localTimeToInstant,
  localWeekdayOf,
} from '../time/local-day.js';

/** L'horari d'un àmbit, ja resolt. */
export interface WorkHours {
  /** `HH:MM` de paret local. */
  start: string;
  end: string;
  /** Set caràcters començant en dilluns: `'1111100'` és de dilluns a divendres. */
  days: string;
}

export interface Split {
  /** Minuts totals del bloc. */
  total: number;
  /** Dels totals, quants cauen fora de l'horari o en dia no laborable. */
  overtime: number;
}

const MIN = 60_000;

/**
 * Parteix un bloc en minuts d'horari i minuts extres.
 *
 * Es recorre **dia local a dia local**, que és l'única manera que un bloc de matinada i un
 * canvi d'hora donin el mateix resultat que a mà.
 */
export function splitWorkTime(
  block: { startedAt: string; endedAt: string },
  hours: WorkHours,
  timezone: string,
): Split {
  const from = Date.parse(block.startedAt);
  const to = Date.parse(block.endedAt);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
    return { total: 0, overtime: 0 };
  }

  let total = 0;
  let overtime = 0;

  let day = localDateOf(timezone, new Date(from));
  const lastDay = localDateOf(timezone, new Date(to - 1));

  // Un sostre de seguretat: un bloc de més d'un any és una dada corrupta, no una jornada, i
  // no ha de fer donar voltes al servidor.
  for (let guard = 0; guard < 400; guard++) {
    const bounds = localDayBounds(timezone, day);
    const dayStart = Math.max(from, Date.parse(bounds.startUTC));
    const dayEnd = Math.min(to, Date.parse(bounds.endUTC));

    if (dayEnd > dayStart) {
      const portion = (dayEnd - dayStart) / MIN;
      total += portion;

      const laborable = hours.days[localWeekdayOf(timezone, new Date(dayStart))] === '1';
      if (!laborable) {
        overtime += portion;
      } else {
        const openAt = Date.parse(localTimeToInstant(timezone, day, hours.start));
        const closeAt = Date.parse(localTimeToInstant(timezone, day, hours.end));
        const dins = Math.max(0, Math.min(dayEnd, closeAt) - Math.max(dayStart, openAt)) / MIN;
        overtime += portion - dins;
      }
    }

    if (day === lastDay) break;
    day = nextDay(day);
  }

  // Es torna en minuts sencers: la interfície els ensenya així i mig minut no és informació.
  return { total: Math.round(total), overtime: Math.round(overtime) };
}

/** El dia següent al calendari, sense passar per cap fus. */
function nextDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const next = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + 1));
  return next.toISOString().slice(0, 10);
}

/**
 * Si un bloc és massa llarg per ser de fiar.
 *
 * No el retalla ningú: una targeta que es queda a Fent tota la nit **hi ha estat tota la
 * nit**, i escurçar-la seria escriure una cosa que no va passar sense dir quina part. El que
 * es fa és marcar-lo perquè qui el miri decideixi, que és el que el cronograma permet fer
 * arrossegant-ne les vores.
 */
export function needsReview(minutes: number, longSessionHours: number): boolean {
  return minutes > longSessionHours * 60;
}
