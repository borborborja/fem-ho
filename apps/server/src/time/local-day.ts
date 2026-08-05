/**
 * Temps local. docs/01 §8: "la part que es trenca sola".
 *
 * Tota consulta de "avui" passa per aquí. És el punt on es decideix si "què he de fer
 * avui" és correcte, i és el punt on les implementacions ingènues fallen dos dies l'any
 * sense donar cap error visible.
 *
 * Cada usuari té el seu `timezone`. Les consultes es resolen en el fus de QUI MIRA, no
 * en el del servidor ni en el de qui va crear la tasca.
 */

/** Instant en ISO-8601 UTC amb Z, que és com es guarden a la base (docs/01). */
export type Instant = string;

/** Data sense fus, `YYYY-MM-DD`. Una data de tot el dia no té instant. */
export type PlainDate = string;

export interface DayBounds {
  /** Inici del dia local, en UTC. Inclusiu. */
  startUTC: Instant;
  /** Inici del dia local SEGÜENT, en UTC. Exclusiu. */
  endUTC: Instant;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Desplaçament d'un fus respecte a UTC, en minuts, per a un instant concret.
 *
 * Es calcula formatant l'instant en aquell fus i restant. Es fa així i no amb una taula
 * perquè el desplaçament depèn de l'instant: canvia amb l'horari d'estiu, i n'hi ha que
 * no són hores senceres (Pacific/Chatham és +12:45 i +13:45).
 */
function offsetMinutes(timezone: string, at: Date): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const parts: Record<string, number> = {};
  for (const { type, value } of fmt.formatToParts(at)) {
    if (type !== 'literal') parts[type] = Number(value);
  }

  // `hour` pot sortir 24 amb hour12:false a l'hora zero segons l'entorn.
  const hour = parts.hour === 24 ? 0 : (parts.hour ?? 0);

  const asUTC = Date.UTC(
    parts.year ?? 0,
    (parts.month ?? 1) - 1,
    parts.day ?? 1,
    hour,
    parts.minute ?? 0,
    parts.second ?? 0,
  );

  return (asUTC - at.getTime()) / 60_000;
}

/**
 * Converteix una hora de paret local (any, mes, dia, h, min) d'un fus a l'instant UTC.
 *
 * Cal iterar: per saber el desplaçament necessitem l'instant, i per saber l'instant
 * necessitem el desplaçament. Dues passades convergeixen sempre, perquè la segona ja
 * parteix d'un instant del costat correcte del salt.
 *
 * Als salts d'hora hi ha dos casos que no tenen resposta única, i els resolem com fa
 * tothom:
 *   - Hora inexistent (la matinada que se salta a la primavera): cau a l'instant
 *     immediatament posterior al salt.
 *   - Hora ambigua (la matinada repetida a la tardor): s'agafa la primera ocurrència.
 */
function wallClockToUTC(timezone: string, y: number, m: number, d: number, hh = 0, mm = 0): Date {
  const naive = Date.UTC(y, m - 1, d, hh, mm, 0);
  let guess = new Date(naive - offsetMinutes(timezone, new Date(naive)) * 60_000);
  guess = new Date(naive - offsetMinutes(timezone, guess) * 60_000);
  return guess;
}

/**
 * Límits UTC del dia local `date` al fus `timezone`.
 *
 * **No es fa `inici + 24 h`.** Els dies de canvi d'hora tenen 23 o 25 hores, i fer-ho
 * amb una suma dona resultats incorrectes dos dies l'any sense cap error visible
 * (docs/01 §8). Es construeix el començament del dia SEGÜENT i es converteix a UTC.
 */
export function localDayBounds(timezone: string, date: PlainDate): DayBounds {
  const m = DATE_RE.exec(date);
  if (m === null) {
    throw new Error(`localDayBounds espera una data YYYY-MM-DD, i ha rebut "${date}"`);
  }
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);

  const start = wallClockToUTC(timezone, year, month, day);

  // El dia següent es calcula sobre el calendari, no sumant mil·lisegons.
  const nextUTC = new Date(Date.UTC(year, month - 1, day + 1));
  const next = wallClockToUTC(
    timezone,
    nextUTC.getUTCFullYear(),
    nextUTC.getUTCMonth() + 1,
    nextUTC.getUTCDate(),
  );

  return { startUTC: start.toISOString(), endUTC: next.toISOString() };
}

/** La data local que correspon a un instant, al fus donat. */
export function localDateOf(timezone: string, at: Date): PlainDate {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  // `en-CA` formata com a YYYY-MM-DD, que és exactament el que guardem.
  return fmt.format(at);
}

/** Quantes hores té un dia local. 23 o 25 als diumenges de canvi d'hora. */
export function localDayLengthHours(timezone: string, date: PlainDate): number {
  const { startUTC, endUTC } = localDayBounds(timezone, date);
  return (Date.parse(endUTC) - Date.parse(startUTC)) / 3_600_000;
}
