/**
 * Catàleg de traducció.
 *
 * Regla 3: la interfície mai porta literals al codi, sempre fitxers de traducció. **El
 * mateix catàleg alimenta la web i el `strings.xml` d'Android** (docs/03 §1): un literal
 * escrit a la web és una divergència garantida amb Android.
 *
 * El runtime és deliberadament mínim —tria d'idioma, cerca i substitució de `{clau}`— i
 * no una biblioteca d'i18n. El que Fem-ho necessita és que el catàleg sigui un fitxer de
 * dades exportable a `strings.xml`, i una biblioteca ho complicaria sense donar-ho.
 *
 * **Els plurals no existeixen a posta.** Cap de les tres llengües en necessita de
 * complicats, i les quatre claus amb `{count}` es resolen amb forma única. El dia que
 * entri una llengua amb dual o paucal caldrà ICU, i serà un canvi d'aquest fitxer i no
 * del model de dades. Anticipar-ho ara seria complicar tres idiomes per un quart que
 * potser no arriba mai.
 */

import ca from '../i18n/ca.json' with { type: 'json' };
import en from '../i18n/en.json' with { type: 'json' };
import es from '../i18n/es.json' with { type: 'json' };

type Catalog = Record<string, string>;

/** Els idiomes que hi ha. Afegir-ne un és un fitxer nou i una entrada aquí. */
export const LOCALES = ['ca', 'en', 'es'] as const;
export type Locale = (typeof LOCALES)[number];

/**
 * L'idioma de reserva.
 *
 * **El català és la font de veritat de les claus** (`ca.json`): és l'únic catàleg que en
 * pot tenir de noves, i `i18n-parity` comprova que els altres el segueixin exactament.
 * Per això també és el que es fa servir quan una traducció encara no hi és.
 */
export const FALLBACK: Locale = 'ca';

/** Les entrades de comentari del JSON no són traduccions. */
function clean(raw: unknown): Catalog {
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).filter(
      (entry): entry is [string, string] =>
        !entry[0].startsWith('$') && typeof entry[1] === 'string',
    ),
  );
}

const CATALOGS: Record<Locale, Catalog> = {
  ca: clean(ca),
  en: clean(en),
  es: clean(es),
};

/**
 * Els tres catàlegs viatgen empaquetats.
 *
 * Són uns 30 KB en cru per als tres. Carregar-los sota demanda faria `t()` asíncrona i
 * obligaria a tocar les més de dues-centes crides que hi ha, per estalviar-ne vint. El
 * dia que siguin quinze idiomes, això canvia; amb tres, no.
 */
let current: Locale = FALLBACK;

export function getLocale(): Locale {
  return current;
}

/** Posa l'idioma actiu. La web i Android el criden un cop en arrencar. */
export function setLocale(locale: Locale): void {
  current = locale;
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/**
 * Del que demana el navegador o el dispositiu, al que tenim.
 *
 * Es mira l'etiqueta sencera i després només la llengua, perquè `en-US` i `es-419` han
 * de trobar `en` i `es`. Si res encaixa, català: val més una llengua que la persona
 * potser no té que una pantalla a mitges.
 */
export function negotiate(preferred: readonly string[]): Locale {
  for (const tag of preferred) {
    const lower = tag.toLowerCase();
    if (isLocale(lower)) return lower;
    const base = lower.split('-')[0];
    if (isLocale(base)) return base;
  }
  return FALLBACK;
}

export type MessageKey = keyof (typeof CATALOGS)['ca'] & string;

export interface TranslateOptions {
  /** Valors per als marcadors `{clau}` del missatge. */
  [placeholder: string]: string | number;
}

/**
 * Tradueix una clau.
 *
 * **La cadena de reserva distingeix dos errors diferents.** Una clau que hi és en català
 * i no en anglès és una traducció que falta: s'ensenya el català, que es llegeix. Una
 * clau que no hi és enlloc és un error de programa: s'ensenya la clau mateixa, que es
 * veu de seguida i es corregeix. Amb un forat, cap dels dos es veuria.
 */
export function t(key: string, values: TranslateOptions = {}): string {
  const message = CATALOGS[current][key] ?? CATALOGS[FALLBACK][key];
  if (message === undefined) return key;

  return message.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = values[name];
    return value === undefined ? whole : String(value);
  });
}

/** Totes les claus del catàleg. L'exportador a `strings.xml` en fa servir. */
export function messageKeys(): string[] {
  return Object.keys(CATALOGS[FALLBACK]);
}

/** El catàleg d'un idioma. L'exportador a `strings.xml` i el servidor en fan servir. */
export function catalogOf(locale: Locale): Catalog {
  return CATALOGS[locale];
}

/** El catàleg actiu. Es manté pel nom que ja feia servir la resta del codi. */
export const MESSAGES: Catalog = CATALOGS[FALLBACK];
