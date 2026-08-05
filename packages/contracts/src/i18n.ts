/**
 * Catàleg de traducció.
 *
 * Regla 3: la interfície és en català, sempre via fitxers de traducció, mai literals
 * al codi. **El mateix catàleg alimenta la web i el `strings.xml` d'Android**
 * (docs/03 §1): un literal escrit a la web és una divergència garantida amb Android.
 *
 * El runtime és deliberadament mínim —cerca i substitució de `{clau}`— i no una
 * biblioteca d'i18n. Fem-ho té un sol idioma i cap plural complicat; el que necessita
 * és que el catàleg sigui un fitxer de dades exportable a `strings.xml`, i una
 * biblioteca ho complicaria sense donar res a canvi.
 */

import catalog from '../i18n/ca.json' with { type: 'json' };

type Catalog = Record<string, string>;

/** Les entrades de comentari del JSON no són traduccions. */
const MESSAGES: Catalog = Object.fromEntries(
  Object.entries(catalog as Record<string, unknown>).filter(
    (entry): entry is [string, string] => !entry[0].startsWith('$') && typeof entry[1] === 'string',
  ),
);

export type MessageKey = keyof typeof MESSAGES & string;

export interface TranslateOptions {
  /** Valors per als marcadors `{clau}` del missatge. */
  [placeholder: string]: string | number;
}

/**
 * Tradueix una clau.
 *
 * Si la clau no hi és **torna la clau mateixa**, i no una cadena buida ni un error: una
 * pantalla amb `board.column.inbox` escrit a la cara es veu de seguida i es corregeix;
 * una amb un forat, no.
 */
export function t(key: string, values: TranslateOptions = {}): string {
  const message = MESSAGES[key];
  if (message === undefined) return key;

  return message.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = values[name];
    return value === undefined ? whole : String(value);
  });
}

/** Totes les claus del catàleg. L'exportador a `strings.xml` en fa servir. */
export function messageKeys(): string[] {
  return Object.keys(MESSAGES);
}

export { MESSAGES };
