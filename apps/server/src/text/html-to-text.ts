/**
 * El cos d'un correu en HTML, convertit a text pla.
 *
 * PER QUÈ NO ES DESA CAP MARCATGE
 * -------------------------------
 * El cos va a `tasks.description`, que la interfície pinta. **L'HTML d'un desconegut allà
 * dins és XSS emmagatzemat servit des del teu propi domini**, i el correu és l'únic canal
 * del producte on qualsevol pot escriure't sense que li donis res.
 *
 * Es podria sanejar amb una llibreria i deixar-hi negretes. No es fa, i el motiu és que
 * **l'HTML més segur és cap HTML**: sense marcatge desat no hi ha res a sanejar bé, res a
 * mantenir al dia quan surti un bypass nou, i cap dependència més al camí més hostil.
 *
 * A més, el `.eml` cru es conserva: el que aquí es perd, es pot tornar a treure.
 *
 * S'ELIMINA EL CONTINGUT, NO NOMÉS LES ETIQUETES
 * ----------------------------------------------
 * Treure `<script>` i `</script>` i deixar el que hi ha al mig posaria codi JavaScript com
 * a text de la descripció. `<style>` i `<head>` igual: són blocs sencers que no són el
 * missatge.
 */

/** Les entitats que apareixen de debò en un correu. La resta es queden com estan. */
const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  eacute: 'é',
  egrave: 'è',
  agrave: 'à',
  ograve: 'ò',
  oacute: 'ó',
  iacute: 'í',
  uacute: 'ú',
  ccedil: 'ç',
  ntilde: 'ñ',
};

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/giu, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/gu, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&([a-z]+);/giu, (whole, name: string) => ENTITIES[name.toLowerCase()] ?? whole);
}

export interface HtmlToTextOptions {
  /** Fins on es talla. Una newsletter pot portar mig megabyte de marcatge. */
  maxLength?: number;
}

const DEFAULT_MAX = 8192;

export function htmlToText(html: string, options: HtmlToTextOptions = {}): string {
  const max = options.maxLength ?? DEFAULT_MAX;

  const text = html
    // El contingut, no només les etiquetes.
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/giu, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/giu, ' ')
    .replace(/<head\b[^>]*>[\s\S]*?<\/head\s*>/giu, ' ')
    // Un `<script>` sense tancar s'ho menja tot fins al final, que és el que volem.
    .replace(/<script\b[\s\S]*$/giu, ' ')
    .replace(/<!--[\s\S]*?-->/gu, ' ')
    // El que separa paràgrafs ha de deixar un salt, o el text queda enganxat.
    .replace(/<br\s*\/?>/giu, '\n')
    // `li` no hi és: l'obertura ja hi posa el salt i el pic, i afegir-ne un al tancament
    // deixava una línia buida entre cada ítem de la llista.
    .replace(/<\/(p|div|tr|h[1-6])\s*>/giu, '\n')
    .replace(/<li\b[^>]*>/giu, '\n· ')
    // I la resta d'etiquetes, fora.
    .replace(/<[^>]*>/gu, ' ');

  const net = decodeEntities(text)
    /**
     * Els mateixos tres grups que el títol: controls, marques bidireccionals i d'amplada
     * zero. Un `U+202E` dins d'una descripció reordena el que llegeixes igual de bé.
     * El salt de línia se salva abans perquè aquí sí que és contingut.
     */
    .replace(/\r\n?/gu, '\n')
    .replace(/[^\S\n]+/gu, ' ')
    /**
     * **El salt de línia s'exclou explícitament.** `\p{Cc}` inclou `\n`, i sense la
     * negació aquesta línia es menjava tots els salts que les dues de dalt acabaven de
     * posar: `<p>A</p><p>B</p>` sortia «A B». Va caure a la primera prova, i és el gènere
     * de detall que en producció s'hauria llegit com «els correus surten sense format».
     */
    .replace(/(?!\n)[\p{Cc}\p{Cf}]/gu, '')
    .replace(/[ \t]*\n[ \t]*/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();

  return net.length > max ? `${net.slice(0, max - 1).trimEnd()}…` : net;
}
