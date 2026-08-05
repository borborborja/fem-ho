/**
 * Recurrència d'esdeveniments. D8, docs/01 §5, docs/07 §4.
 *
 * UNA FILA PER COMPONENT, NO PER RECURS
 * --------------------------------------
 * El mestre té `recurrence_id IS NULL`; cada instància modificada és una fila germana
 * amb el mateix `uid` i el seu propi `RECURRENCE-ID`. És el model de Google
 * (`recurringEventId` + `originalStartTime`), d'Android (`ORIGINAL_ID` +
 * `ORIGINAL_INSTANCE_TIME`) i de Morgen.
 *
 * `RANGE=THISANDFUTURE` **es parseja però no s'emet mai** (docs/01 §5). "Aquest i els
 * següents" s'implementa **partint la sèrie**: es posa `UNTIL` al mestre i se'n crea un
 * de nou. És el que fa Google, i és el que evita que cada client hagi d'interpretar un
 * rang que la meitat implementen malament.
 */

import ICAL from 'ical.js';

export interface Occurrence {
  /** Inici de l'ocurrència, en ISO-8601 UTC. */
  startsAt: string;
  endsAt: string;
  /**
   * El `RECURRENCE-ID` que identificaria aquesta ocurrència: l'inici que li tocaria
   * segons la regla, encara que després s'hagi mogut.
   */
  recurrenceId: string;
}

export interface ExpandOptions {
  /** L'inici del mestre. */
  startsAt: string;
  /** El final del mestre, per calcular la durada de cada ocurrència. */
  endsAt?: string | null | undefined;
  /** RRULE d'RFC 5545, sense el prefix `RRULE:`. */
  rrule?: string | null | undefined;
  /** Dates addicionals, en ISO. */
  rdate?: string[] | undefined;
  /** Dates excloses, en ISO. Es comparen contra el RECURRENCE-ID. */
  exdate?: string[] | undefined;
  /** La finestra que es demana. Sense finestra no es poden expandir repeticions. */
  from: string;
  to: string;
  /**
   * Sostre dur d'ocurrències. Una `RRULE` sense `COUNT` ni `UNTIL` és infinita, i una
   * finestra prou gran la faria expandir fins a esgotar la memòria.
   */
  limit?: number | undefined;
}

const DEFAULT_LIMIT = 1000;

function toICALTime(iso: string): ICAL.Time {
  return ICAL.Time.fromJSDate(new Date(iso), true);
}

/**
 * Expandeix una sèrie dins d'una finestra.
 *
 * La finestra és obligatòria a propòsit: `GET /events` **requereix `from` i `to`**
 * (docs/05 §4) perquè sense ella no hi ha manera de decidir quantes ocurrències generar
 * d'una regla infinita.
 */
export function expandOccurrences(options: ExpandOptions): Occurrence[] {
  const from = new Date(options.from).getTime();
  const to = new Date(options.to).getTime();
  if (Number.isNaN(from) || Number.isNaN(to)) {
    throw new Error('La finestra ha de portar dues dates vàlides.');
  }

  const start = new Date(options.startsAt);
  const durationMs =
    options.endsAt == null ? 0 : new Date(options.endsAt).getTime() - start.getTime();

  const excluded = new Set((options.exdate ?? []).map((iso) => new Date(iso).getTime()));
  const limit = options.limit ?? DEFAULT_LIMIT;

  const out: Occurrence[] = [];

  const push = (occurrenceStart: Date): void => {
    const time = occurrenceStart.getTime();
    if (excluded.has(time)) return;
    const end = new Date(time + durationMs);
    // Una ocurrència compta si SOLAPA la finestra, no si hi comença: un esdeveniment
    // de tot el dia que va començar ahir també surt avui.
    if (end.getTime() <= from || time >= to) return;
    out.push({
      startsAt: occurrenceStart.toISOString(),
      endsAt: end.toISOString(),
      recurrenceId: occurrenceStart.toISOString(),
    });
  };

  if (options.rrule == null || options.rrule === '') {
    // Sense regla, l'única ocurrència és el propi esdeveniment.
    push(start);
  } else {
    const rule = ICAL.Recur.fromString(options.rrule);
    const iterator = rule.iterator(toICALTime(options.startsAt));

    let count = 0;
    let next = iterator.next();
    while (next !== null && count < limit) {
      const occurrenceStart = next.toJSDate();
      if (occurrenceStart.getTime() >= to) break;
      push(occurrenceStart);
      count += 1;
      next = iterator.next();
    }
  }

  for (const iso of options.rdate ?? []) push(new Date(iso));

  out.sort((a, b) => (a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : 0));
  return out;
}

export interface SplitSeriesResult {
  /** La RRULE que li queda al mestre, amb `UNTIL` just abans del tall. */
  masterRrule: string;
  /** La RRULE de la sèrie nova, que arrenca al tall. */
  newRrule: string;
  /** L'inici de la sèrie nova. */
  newStartsAt: string;
}

/**
 * Parteix una sèrie a partir d'una ocurrència: el mode `future` de `series_mode`.
 *
 * **No s'emet `RANGE=THISANDFUTURE`.** Es posa `UNTIL` al mestre —just abans de
 * l'ocurrència del tall— i es crea una sèrie nova que hi arrenca. És el que fa Google,
 * i el motiu és pràctic: `RANGE=THISANDFUTURE` el suporten pocs clients i el
 * malinterpreten uns quants més, o sigui que una sèrie partida amb aquell rang es veu
 * diferent a cada calendari.
 */
export function splitSeries(
  masterRrule: string,
  splitAt: string,
  masterStartsAt: string,
): SplitSeriesResult {
  const rule = ICAL.Recur.fromString(masterRrule);
  const split = new Date(splitAt);

  if (split.getTime() <= new Date(masterStartsAt).getTime()) {
    throw new Error("El tall ha de ser posterior a l'inici de la sèrie.");
  }

  // `UNTIL` és inclusiu, o sigui que es posa un segon abans del tall perquè
  // l'ocurrència del tall pertanyi a la sèrie NOVA i no a les dues.
  const until = ICAL.Time.fromJSDate(new Date(split.getTime() - 1000), true);

  const masterRule = ICAL.Recur.fromString(masterRrule);
  masterRule.until = until;
  // Un `COUNT` i un `UNTIL` alhora són invàlids segons RFC 5545: en posar `UNTIL`,
  // el `COUNT` ha de desaparèixer.
  masterRule.count = null;

  const newRule = ICAL.Recur.fromString(masterRrule);
  if (rule.count != null && rule.count > 0) {
    // Si la sèrie original tenia un nombre d'ocurrències, la nova en rep les que
    // quedaven. Calcular-ho exactament necessita expandir, i qui crida ho fa.
    newRule.count = rule.count;
  }

  return {
    masterRrule: masterRule.toString(),
    newRrule: newRule.toString(),
    newStartsAt: split.toISOString(),
  };
}

/**
 * Comprova si una RRULE porta `RANGE=THISANDFUTURE`.
 *
 * S'ha de saber PARSEJAR perquè arriba de calendaris de tercers, però Fem-ho no l'emet
 * mai (docs/01 §5). Aquesta funció existeix per poder-ho comprovar a les proves i per
 * refusar-lo si algun dia s'escapés.
 */
export function hasThisAndFuture(value: string): boolean {
  return /RANGE=THISANDFUTURE/i.test(value);
}
