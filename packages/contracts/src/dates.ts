/**
 * El que del calendari depèn de l'idioma, i el que no.
 *
 * Els noms dels mesos i dels dies **no viuen al catàleg**: els dona `Intl`, que porta
 * CLDR igual que `java.time` d'Android, i per tant les dues apps diuen el mateix sense
 * haver-ho d'escriure dues vegades. Abans eren dues claus amb els dotze mesos separats
 * per comes i indexats per posició: es trencaven amb qualsevol llengua que porti una
 * coma dins d'un nom de mes, i la llargada no la validava ningú.
 *
 * **El primer dia de la setmana sí que viu aquí, i no a `Intl`.** `Intl.Locale#weekInfo`
 * existeix a Chrome i no a Firefox, i el resultat ha de ser **idèntic** a la web i a
 * Android: si cadascú el calcula pel seu compte, divergiran un dia i no ho dirà ningú
 * —el calendari es desplaça i no dona cap error—. És el mateix motiu pel qual l'índex
 * fraccional viu aquí i es compara amb fixtures.
 */

import { FALLBACK, type Locale } from './i18n.js';

/** Diumenge és 0, com `Date#getDay()`. */
export type WeekStart = 0 | 1;

/**
 * Amb quin dia comença la setmana a cada idioma.
 *
 * Taula explícita i no derivada: són tres entrades i el valor és una decisió de
 * producte que s'ha de poder llegir. Un `en-GB` futur seria dilluns; el genèric `en`
 * és diumenge perquè és el que CLDR diu i el que espera qui té l'app en anglès.
 */
const WEEK_STARTS: Record<Locale, WeekStart> = { ca: 1, en: 0, es: 1 };

export function weekStart(locale: Locale): WeekStart {
  return WEEK_STARTS[locale] ?? WEEK_STARTS[FALLBACK];
}

/**
 * La preferència de qui mira.
 *
 * `auto` segueix l'idioma; les altres dues manen per damunt. Existeix perquè el primer
 * dia de la setmana no és només una convenció lingüística: qui treballa el cap de
 * setmana el vol d'una manera i qui no, d'una altra, i tots dos poden tenir la mateixa
 * llengua.
 */
export const WEEK_START_CHOICES = ['auto', 'monday', 'sunday'] as const;
export type WeekStartChoice = (typeof WEEK_START_CHOICES)[number];

export function resolveWeekStart(choice: WeekStartChoice | undefined, locale: Locale): WeekStart {
  if (choice === 'monday') return 1;
  if (choice === 'sunday') return 0;
  return weekStart(locale);
}

/** L'índex d'un dia dins de la setmana, comptant des del primer dia que toqui. */
export function weekIndex(date: Date, start: WeekStart): number {
  return (date.getDay() - start + 7) % 7;
}

/** El primer dia de la setmana que conté aquesta data. */
export function startOfWeek(date: Date, start: WeekStart): Date {
  const out = new Date(date);
  out.setDate(out.getDate() - weekIndex(date, start));
  return out;
}

/**
 * Els noms curts dels dies, començant pel primer que toqui.
 *
 * En minúscula perquè docs/00 ho demana i perquè `Intl` els dona amb la majúscula de
 * cada llengua —"Mo" en anglès, "dl." en català— i barrejats quedarien desiguals. El
 * punt final que hi posa el CLDR català també fora: la capçalera d'una columna de dues
 * lletres no porta puntuació.
 */
export function weekdayNames(locale: Locale, start: WeekStart): string[] {
  const format = new Intl.DateTimeFormat(locale, { weekday: 'short' });
  // El 4 de gener de 1970 va ser diumenge: serveix de base per recórrer els set dies.
  return Array.from({ length: 7 }, (_, index) =>
    format
      .format(new Date(Date.UTC(1970, 0, 4 + ((start + index) % 7))))
      .replace(/\.$/u, '')
      .toLowerCase(),
  );
}

/** El nom d'un mes, per a la capçalera del calendari. */
export function monthName(locale: Locale, month: number): string {
  return new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(2026, month, 1)),
  );
}

/**
 * Un dia escrit sencer: "6 d'agost", "6 de agosto", "6 August".
 *
 * Ho fa `Intl` i no una plantilla del catàleg perquè `"{day} de {month}"` no pot
 * expressar ni l'elisió catalana —"1 d'agost" i no "1 de agost"— ni l'ordre anglès.
 */
export function longDay(locale: Locale, date: Date): string {
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long' }).format(date);
}

/** Una hora, en el format de l'idioma: 24 h en català i castellà, 12 h en anglès. */
export function shortTime(locale: Locale, date: Date): string {
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(date);
}

/** Una data i una hora juntes. L'historial i l'estat de les fonts en fan servir. */
export function dateTime(locale: Locale, date: Date): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

/**
 * «fa 5 min», «fa 3 h», i a partir d'un dia, la data i l'hora.
 *
 * **El llindar és un dia, i no és una preferència estètica.** Dins del dia el que es vol
 * saber és *quanta estona fa* —si l'agent hi era fa cinc minuts o fa vuit hores canvia què
 * en penses—; passat el dia, això deixa de dir res i el que informa és **quan**: «fa 37 h»
 * obliga a fer un càlcul que «10/08 18:20» ja porta fet.
 *
 * `Intl.RelativeTimeFormat` i no una taula de sufixos: els tres idiomes de la casa —i el
 * quart que vingui— surten de CLDR, com els noms dels mesos, i el plural el fa ell.
 *
 * `now` s'injecta perquè això es pugui provar sense fer dependre el resultat del rellotge
 * de qui corre les proves, que és el que fa que aquesta mena de funció es trenqui en silenci
 * un dimarts.
 */
export function relativeTime(locale: Locale, date: Date, now: Date): string {
  const segons = Math.round((date.getTime() - now.getTime()) / 1000);
  const passats = Math.abs(segons);

  if (passats >= 24 * 3600) return dateTime(locale, date);

  const relatiu = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' });
  // Menys d'un minut és «ara»: dir «fa 12 segons» d'una tasca és una precisió que no ajuda.
  // En segons i no en minuts perquè `0 minute` en català es diu «aquest minut», que no és
  // el que ningú diria mirant una targeta.
  if (passats < 60) return relatiu.format(0, 'second');
  if (passats < 3600) return relatiu.format(Math.round(segons / 60), 'minute');
  return relatiu.format(Math.round(segons / 3600), 'hour');
}
