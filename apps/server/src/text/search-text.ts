/**
 * Normalització catalana per a la cerca (docs/01 §11).
 *
 * Es fa **a l'aplicació i no al motor**: SQLite amb FTS5 i Postgres amb `unaccent` no
 * normalitzen igual, i la ela geminada no la sap desfer cap dels dos. Amb la
 * normalització a la capa d'aplicació, els dos motors busquen sobre el mateix text.
 *
 * Quatre coses, i cap és opcional per a un producte en català:
 *
 * - **Accents.** "Bàrbara" i "barbara" han de trobar-se.
 * - **`ç` → `c`.** "Barça" i "barca".
 * - **Ela geminada.** `l·l` → `ll`: "col·legi" i "collegi".
 * - **Apòstrofs.** "l'aigua" i "aigua" — l'article elidit no és part de la paraula.
 */

/**
 * El text normalitzat que es guarda a `tasks.search_text`.
 *
 * S'hi posa el títol i la descripció junts: el que un usuari busca no distingeix on ho
 * va escriure.
 */
export function normalizeForSearch(...parts: (string | null | undefined)[]): string {
  return parts
    .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
    .map(normalizeOne)
    .join(' ')
    .trim();
}

function normalizeOne(text: string): string {
  return (
    text
      .toLowerCase()
      // L'ela geminada PRIMER: si es tragués el punt volat després dels accents, la
      // combinació quedaria partida i "col·legi" es buscaria com a "col legi".
      .replaceAll('l·l', 'll')
      .replaceAll('l•l', 'll')
      .replaceAll('·', ' ')
      // L'apòstrof recte i el tipogràfic: els teclats catalans posen el segon i els
      // programadors el primer, i han de valer igual.
      .replaceAll("'", ' ')
      .replaceAll('’', ' ')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/gu, '')
      // La ç ja s'ha desfet a `c` amb la descomposició; la ñ i la ü també.
      .replace(/[^a-z0-9\s]/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim()
  );
}

/**
 * Prepara el que ha escrit l'usuari per comparar-ho amb `search_text`.
 *
 * És **la mateixa funció**: si la consulta es normalitzés diferent del text guardat, la
 * cerca fallaria justament en les paraules que aquesta normalització existeix per
 * arreglar.
 */
export function normalizeQuery(query: string): string {
  return normalizeOne(query);
}
