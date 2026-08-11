/**
 * El títol d'una tasca feta a partir d'un correu.
 *
 * PER QUÈ VIU AQUÍ I NO AL SERVIDOR
 * ---------------------------------
 * La pantalla de configuració n'ha d'ensenyar una **previsualització en viu** mentre
 * s'escriu la plantilla, i el servidor l'ha d'aplicar en ingerir. Si es fes dues vegades,
 * un dia divergirien i el que veus escrivint no seria el que et surt al tauler. És el
 * mateix motiu pel qual `quickadd`, `position` i `dates` són aquí, i de propina entra sola
 * a `parser-parity`.
 *
 * UNA SOLA PASSADA, I NO ÉS UNA PRECAUCIÓ
 * ---------------------------------------
 * Això renderitza **text que controla un desconegut**: l'assumpte i el nom del remitent els
 * escriu qui t'envia el correu. Amb un motor que reescanegi el resultat, un `Subject:` que
 * digués `{{from_address}}` s'expandiria. Amb una passada sobre la **plantilla** i una
 * funció de reemplaçament, el valor substituït **no es torna a mirar mai**: no és que
 * s'eviti, és que no hi ha manera d'expressar-ho.
 *
 * Per això no hi ha niuament, ni condicionals, ni bucles, ni expressions. Vindrà la petició
 * («si no hi ha nom, posa l'adreça») i la resposta és **una variable més** —`{{from}}` ja
 * col·lapsa nom-o-adreça— i mai un llenguatge.
 */

/** Els camps d'un correu que una plantilla pot fer servir. */
export interface MailTemplateVars {
  subject: string;
  /** El nom del remitent, o buit si el correu no en porta. */
  from_name: string;
  from_email: string;
  /** El nom si n'hi ha, si no l'adreça. La variable que estalvia un condicional. */
  from: string;
  date: string;
  folder: string;
  account: string;
}

export const MAIL_TEMPLATE_VARS = [
  'subject',
  'from_name',
  'from_email',
  'from',
  'date',
  'folder',
  'account',
] as const;

export const DEFAULT_MAIL_TEMPLATE = '{{subject}}';

/** El que un títol pot arribar a mesurar. Un reenviament encadenat en porta dos-cents. */
export const MAIL_TITLE_MAX = 500;

const PLACEHOLDER = /\{\{\s*([a-z_]+)\s*\}\}/gu;

/**
 * Treu del text tot el que no s'ha de veure en un títol.
 *
 * Els tres primers grups no són manies:
 *
 * - Els **controls** i el `NUL` trenquen la interfície i les consultes.
 * - Les **marques bidireccionals** (`U+202E` i companyia) reordenen el que es llegeix
 *   sense canviar el que hi ha: és com `factura.txt.exe` es fa veure `factura.exe.txt`.
 * - Les **d'amplada zero** deixen dos títols que es veuen iguals i no ho són.
 *
 * I el **plegat de capçalera** es desplega: un assumpte llarg arriba partit en línies amb
 * `CRLF` + espai, i sense això el títol porta salts de línia enmig.
 */
function clean(text: string): string {
  return text
    .replace(/\r\n[ \t]/gu, ' ')
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

/**
 * Renderitza el títol.
 *
 * `fallback` és el que es fa servir si el resultat queda buit —un assumpte buit amb la
 * plantilla per defecte—, i el crida qui sap l'idioma de qui té el compte. **Mai es torna
 * una cadena buida**: `createTask` rebutja un títol buit amb un 422, i que la ingesta hi
 * arribés seria un correu perdut sense explicació.
 */
export function renderMailTitle(
  template: string,
  vars: MailTemplateVars,
  fallback: string,
): string {
  const rendered = template.replace(PLACEHOLDER, (whole, name: string) => {
    const value = (vars as unknown as Record<string, unknown>)[name];
    /**
     * **Una variable desconeguda es queda literal.**
     *
     * `{{remitent}}` surt escrit al títol. Buidar-la en silenci faria que una errata
     * sembli un camp buit per sempre i ningú la trobaria; escrita, és un informe d'error
     * que es redacta sol el primer cop que es fa servir la regla.
     */
    return typeof value === 'string' ? value : whole;
  });

  const net = clean(rendered);
  if (net === '') return clean(fallback) || 'Correu';
  return net.length > MAIL_TITLE_MAX ? `${net.slice(0, MAIL_TITLE_MAX - 1).trimEnd()}…` : net;
}

/**
 * Els noms de variable que una plantilla fa servir i no existeixen.
 *
 * Serveix perquè la pantalla els pugui **marcar mentre s'escriu**. Avisa i no rebutja:
 * rebutjar bloquejaria qui vulgui unes claus literals al títol, que és lícit.
 */
export function unknownMailVars(template: string): string[] {
  const found = new Set<string>();
  for (const match of template.matchAll(PLACEHOLDER)) {
    const name = match[1]!;
    if (!(MAIL_TEMPLATE_VARS as readonly string[]).includes(name)) found.add(name);
  }
  return [...found].sort();
}
