/**
 * Índex fraccional amb jitter. D3 de docs/14-decisions.md.
 *
 * "`position TEXT`, índex fraccional, calculat al client, `COLLATE BINARY`."
 *
 * TRES COSES QUE NO SÓN NEGOCIABLES, i el motiu de cadascuna:
 *
 * 1. **Es calcula al client.** Un moviment offline a Android ha de produir la clau
 *    definitiva sense anar al servidor, o la targeta salta de lloc quan torna la
 *    connexió. El servidor també el sap calcular, per a clients simples que li passin
 *    `{before_id, after_id}`, però el camí normal és aquest.
 *
 * 2. **Ordenació binària.** Amb una collation lingüística l'ordre de les claus és
 *    incorrecte i les targetes es desordenen sense cap error visible. L'alfabet està
 *    triat perquè l'ordre dels seus caràcters coincideixi amb el dels seus bytes.
 *
 * 3. **Jitter.** Dos clients que insereixin simultàniament al mateix buit generarien la
 *    mateixa clau, i sense jitter l'empat es resol de manera arbitrària i diferent a
 *    cada client — els dos veurien ordres diferents i cap dels dos estaria "equivocat".
 *
 * ---
 *
 * COM ESTÀ FETA UNA CLAU
 *
 * Una clau és `<part entera><part fraccionària opcional>`, i la part entera porta una
 * **capçalera que en diu la llargada**:
 *
 *     a1   a2  …  az   b10  b11 …  bzz   c100 …
 *     └┬┘                └┬┘             └┬┘
 *      │                  │               └─ capçalera 'c': 3 dígits
 *      │                  └───────────────── capçalera 'b': 2 dígits
 *      └──────────────────────────────────── capçalera 'a': 1 dígit
 *
 * Això no és barroquisme: **és el que fa que afegir al final surti barat**. Sense
 * capçalera, quan la clau arriba a `zzz…` no hi ha res més gran a la mateixa llargada i
 * cal allargar-la; mesurat, mil tasques afegides al peu d'una columna donaven claus de
 * 197 caràcters. Amb capçalera, `az` passa a `b10` i la llargada creix una sola vegada
 * cada 62 elevat al nombre de dígits. Mil insercions caben en tres o quatre caràcters.
 *
 * Les capçaleres minúscules són per a enters positius i les MAJÚSCULES per a negatius,
 * en ordre invers, perquè inserir abans del primer element també sigui barat.
 *
 * LA INVARIANT QUE HO SOSTÉ TOT: cap clau acaba mai amb el dígit més baix.
 *
 * Si existís la clau `"a10"`, entre `"a1"` i `"a10"` no hi cabria res: tota cadena que
 * comenci per `"a10"` i sigui més llarga ja és **més gran**, i tota cadena més petita
 * hauria de continuar amb un dígit per sota del mínim, que no existeix. La targeta seria
 * ininserible i no hi hauria cap error enlloc: el client simplement no la podria deixar
 * on l'usuari l'ha deixat anar. Hi ha una prova que ho comprova sobre desenes de milers
 * de claus.
 *
 * AQUEST FITXER ES PORTA A KOTLIN a M13, i els fixtures es passen a les dues
 * implementacions. Si divergeixen, les targetes es desordenen només en un dels dos
 * clients, que és impossible de diagnosticar des de fora.
 */

/**
 * Base 62 en ordre ASCII estricte. L'ordre importa més que el conjunt: qualsevol
 * alfabet val mentre els seus caràcters estiguin ordenats com els seus bytes.
 */
export const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE = ALPHABET.length;

const MIN_DIGIT = ALPHABET[0]!;
const MAX_DIGIT = ALPHABET[BASE - 1]!;

export class InvalidPositionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidPositionError';
  }
}

function digit(char: string): number {
  const index = ALPHABET.indexOf(char);
  if (index === -1) {
    throw new InvalidPositionError(`"${char}" no és un caràcter de l'alfabet de posicions.`);
  }
  return index;
}

/**
 * Quants dígits té la part entera, segons la seva capçalera.
 * Minúscules: positius, d'1 a 26 dígits. Majúscules: negatius, en ordre invers.
 */
function integerLength(head: string): number {
  if (head >= 'a' && head <= 'z') return head.charCodeAt(0) - 'a'.charCodeAt(0) + 2;
  if (head >= 'A' && head <= 'Z') return 'Z'.charCodeAt(0) - head.charCodeAt(0) + 2;
  throw new InvalidPositionError(`"${head}" no és una capçalera de part entera vàlida.`);
}

function integerPart(key: string): string {
  const head = key[0];
  if (head === undefined) throw new InvalidPositionError('La clau és buida.');
  const length = integerLength(head);
  if (length > key.length) {
    throw new InvalidPositionError(`La clau "${key}" és més curta del que diu la capçalera.`);
  }
  return key.slice(0, length);
}

function validateInteger(int: string): void {
  if (int.length !== integerLength(int[0]!)) {
    throw new InvalidPositionError(`La part entera "${int}" no té la llargada que diu.`);
  }
}

/** L'enter següent. Amb acarreig, i allargant la capçalera quan cal. */
function incrementInteger(int: string): string | null {
  validateInteger(int);
  const head = int[0]!;
  const digits = int.slice(1).split('');

  let carry = true;
  for (let i = digits.length - 1; carry && i >= 0; i -= 1) {
    const next = digit(digits[i]!) + 1;
    if (next === BASE) {
      digits[i] = MIN_DIGIT;
    } else {
      digits[i] = ALPHABET[next]!;
      carry = false;
    }
  }

  if (carry) {
    // S'han esgotat tots els dígits d'aquesta capçalera i cal passar a la següent.
    // 'z' és l'última positiva: a partir d'aquí només queda refinar la fracció, que
    // és el que fa qui ens crida quan rebem null. Amb 26 dígits en base 62, arribar-hi
    // vol dir més posicions de les que caben a cap base de dades.
    if (head === 'z') return null;
    // De l'última negativa es passa a la primera positiva.
    if (head === 'Z') return `a${MIN_DIGIT}`;
    const nextHead = String.fromCharCode(head.charCodeAt(0) + 1);
    return nextHead + MIN_DIGIT.repeat(integerLength(nextHead) - 1);
  }

  return head + digits.join('');
}

/** L'enter anterior. */
function decrementInteger(int: string): string | null {
  validateInteger(int);
  const head = int[0]!;
  const digits = int.slice(1).split('');

  let borrow = true;
  for (let i = digits.length - 1; borrow && i >= 0; i -= 1) {
    const next = digit(digits[i]!) - 1;
    if (next === -1) {
      digits[i] = MAX_DIGIT;
    } else {
      digits[i] = ALPHABET[next]!;
      borrow = false;
    }
  }

  if (borrow) {
    if (head === 'A') return null;
    if (head === 'a') return `Z${MAX_DIGIT}`;
    const prevHead = String.fromCharCode(head.charCodeAt(0) - 1);
    return prevHead + MAX_DIGIT.repeat(integerLength(prevHead) - 1);
  }

  return head + digits.join('');
}

/** Font d'aleatorietat. S'injecta per poder provar amb valors fixos. */
export type RandomSource = () => number;

const defaultRandom: RandomSource = () => Math.random();

/**
 * ON VA EL JITTER
 *
 * La manera òbvia és enganxar caràcters aleatoris al final de la clau. Funciona, però
 * surt car: cada clau nova ha de ser més gran que l'anterior, que ja porta aquells
 * caràcters de més, o sigui que la següent ha de ser encara més llarga.
 *
 * Aquí va **dins de la tria del dígit** de la part fraccionària: quan entre dos dígits
 * veïns hi ha espai, en comptes del del mig se n'agafa un a l'atzar. Dos clients que
 * insereixin al mateix buit trien dígits diferents i les claus divergeixen sense créixer
 * gens. La tria es concentra al terç central: triar de tot el rang faria sortir dígits
 * enganxats als extrems i la inserció següent per aquell costat s'hauria d'allargar de
 * seguida.
 */
const JITTER_SPREAD = 3;

function pickDigit(low: number, high: number, random: RandomSource | null): number {
  const span = high - low - 1;
  if (span <= 0) throw new InvalidPositionError('No hi ha cap dígit entre els dos veïns.');
  if (random === null || span === 1) return low + 1 + Math.floor(span / 2);

  /**
   * **Amb intervals petits es fa servir el rang sencer, no el terç central.**
   *
   * `Math.floor(span / 3)` col·lapsa a 1 quan `span` és 2, i llavors
   * `Math.floor(random() * 1)` és sempre 0: el jitter desapareix del tot. I desapareix
   * justament on més fa falta — l'interval petit és el cas de dos clients inserint al
   * mateix buit estret, que és per a què el jitter existeix (D3).
   *
   * Concentrar-se al terç central és una optimització per a intervals amples, on triar
   * dels extrems faria créixer la clau següent. Amb tres dígits o menys no hi ha extrems
   * a evitar.
   */
  const window = span <= JITTER_SPREAD ? span : Math.floor(span / JITTER_SPREAD);
  const start = low + 1 + Math.floor((span - window) / 2);
  return start + Math.floor(random() * window);
}

/**
 * La clau entre dues parts fraccionàries. `a` buida vol dir el mínim i `b` nul·la el
 * màxim d'aquest nivell.
 */
function fractionBetween(a: string, b: string | null, random: RandomSource | null): string {
  if (b !== null && a >= b) {
    throw new InvalidPositionError(`"${a}" no és anterior a "${b}".`);
  }

  // Els caràcters que li falten a `a` compten com el dígit MÉS BAIX, no com absents.
  // Sense això, fractionBetween('', '0a') no veuria cap prefix comú, aniria a la
  // branca dels dígits i tornaria una clau MÉS GRAN que '0a' — l'ordre trencat en
  // silenci. És el detall que costa més de trobar de tot aquest fitxer.
  let common = 0;
  if (b !== null) {
    while (common < b.length && (a[common] ?? MIN_DIGIT) === b[common]) common += 1;
  }
  if (common > 0) {
    const restB = b === null ? null : b.slice(common);
    return (
      b!.slice(0, common) + fractionBetween(a.slice(common), restB === '' ? null : restB, random)
    );
  }

  const digitA = a.length === 0 ? 0 : digit(a[0]!);
  const digitB = b === null || b.length === 0 ? BASE : digit(b[0]!);
  const span = digitB - digitA - 1;

  /**
   * **Un interval estret no dona prou entropia, i cal baixar un nivell.**
   *
   * Amb `span` d'un o dos dígits, triar-ne un dona una o dues possibilitats: dos clients
   * que insereixin al mateix buit xoquen sempre o la meitat de les vegades, que és
   * justament el que D3 vol evitar. S'agafa el primer dígit disponible i s'hi penja un
   * d'aleatori a sota: seixanta-una possibilitats a canvi d'un caràcter.
   *
   * El llindar és `JITTER_SPREAD` perquè és el mateix que decideix si el jitter cap dins
   * de l'interval: per sota, no hi cap.
   */
  if (span >= JITTER_SPREAD || (span >= 1 && random === null)) {
    return ALPHABET[pickDigit(digitA, digitB, random)]!;
  }

  if (span >= 1) {
    const first = ALPHABET[digitA + 1]!;
    // Mai el dígit més baix a sota: cap fracció pot acabar-hi, o no s'hi podria inserir
    // res just abans.
    return first + ALPHABET[1 + Math.floor(random!() * (BASE - 1))]!;
  }

  if (b !== null && b.length > 1 && random === null) {
    return b.slice(0, 1);
  }

  return ALPHABET[digitA]! + fractionBetween(a.slice(1), null, random);
}

/**
 * Genera una posició entre `before` i `after`.
 *
 * `before` nul vol dir "al principi" i `after` nul vol dir "al final". Tots dos nuls
 * vol dir que és la primera targeta de la columna.
 *
 * La invariant `before < resultat < after` es comprova abans de tornar. És barata i
 * massa cara de perdre: si es trenqués, la targeta apareixeria en un lloc diferent a
 * cada client i no hi hauria cap error enlloc.
 */
export function generatePosition(
  before: string | null,
  after: string | null,
  random: RandomSource = defaultRandom,
): string {
  const key = between(before, after, random);

  if (before !== null && !(before < key)) {
    throw new InvalidPositionError(`La clau generada "${key}" no és posterior a "${before}".`);
  }
  if (after !== null && !(key < after)) {
    throw new InvalidPositionError(`La clau generada "${key}" no és anterior a "${after}".`);
  }
  // La invariant val per a la part FRACCIONÀRIA, no per als enters. Un enter com "b00"
  // acaba amb el dígit més baix i no passa res: just abans hi cap "az" seguit de
  // fracció, que és lexicogràficament menor. En canvi una FRACCIÓ acabada en el dígit
  // més baix sí que és ininserible per l'esquerra.
  const fraction = key.slice(integerPart(key).length);
  if (fraction !== '' && fraction.endsWith(MIN_DIGIT)) {
    throw new InvalidPositionError(
      `La clau generada "${key}" té una fracció acabada amb el dígit més baix i seria ` +
        "ininserible per l'esquerra.",
    );
  }

  return key;
}

function between(a: string | null, b: string | null, random: RandomSource | null): string {
  if (a === null && b === null) return `a${ALPHABET[pickDigit(0, BASE, random)]!}`;

  if (a === null) {
    // Abans del primer: es decrementa l'enter de `b`. Comptar, no partir per la meitat.
    const intB = integerPart(b!);
    const fracB = b!.slice(intB.length);
    if (fracB !== '') {
      // Hi ha part fraccionària: se'n pot trobar una de menor amb el mateix enter.
      return intB + fractionBetween('', fracB, random);
    }
    const smaller = decrementInteger(intB);
    if (smaller === null) {
      // Ja no queden enters per sota: es refina cap avall dins del mateix.
      return intB + fractionBetween('', null, random);
    }
    return smaller;
  }

  if (b === null) {
    // Després de l'últim: s'incrementa l'enter. AQUEST és el camí car si es fa
    // malament, perquè afegir al peu d'una columna és el gest més freqüent.
    const intA = integerPart(a);
    const fracA = a.slice(intA.length);
    const bigger = incrementInteger(intA);
    if (bigger === null) {
      // Capçalera esgotada: es refina cap amunt dins del mateix enter.
      return intA + fractionBetween(fracA, null, random);
    }

    /**
     * **L'enter incrementat, i prou, era determinista.** Dos clients que afegissin al
     * peu de la mateixa columna alhora produïen EXACTAMENT la mateixa clau, que és
     * justament el que el jitter existeix per evitar (D3): cada client resolia l'empat
     * a la seva manera i acabaven veient ordres diferents, sense cap error enlloc.
     *
     * Amb SQLite no es veia mai perquè les transaccions es serialitzen i cada lectura
     * ja veia la inserció anterior. A Postgres, vint creacions simultànies donaven sis
     * posicions repetides.
     *
     * S'hi penja un dígit aleatori. **La clau no creix**: el proper que afegeixi
     * incrementarà l'enter i tornarà a tenir tres caràcters.
     */
    if (random === null) return bigger;
    return bigger + ALPHABET[1 + Math.floor(random() * (BASE - 1))]!;
  }

  // Entremig.
  const intA = integerPart(a);
  const intB = integerPart(b);
  const fracA = a.slice(intA.length);
  const fracB = b.slice(intB.length);

  if (intA === intB) {
    return intA + fractionBetween(fracA, fracB === '' ? null : fracB, random);
  }

  const next = incrementInteger(intA);
  if (next !== null && next < b) {
    /**
     * **La segona via determinista.** Amb els enters consecutius, tornar l'enter
     * incrementat i prou fa que dos clients que insereixin aquí coincideixin, igual que
     * passava al camí d'afegir al peu.
     *
     * La va destapar la prova de jitter que ja hi havia: en arreglar l'altre camí,
     * aquest va quedar al descobert. N'hi havia dues, no una.
     */
    if (random === null) return next;

    if (next === intB) {
      // `next < b` amb el mateix enter vol dir que `b` té fracció: hi ha lloc a dins.
      return intB + fractionBetween('', fracB, random);
    }

    // L'enter de `b` és estrictament més gran: hi cap un dígit a sota de `next` sense
    // arribar-hi. Si el dígit triat el passés —cas estret—, es torna l'enter pelat, que
    // segueix sent correcte encara que sigui determinista.
    const jittered = next + ALPHABET[1 + Math.floor(random() * (BASE - 1))]!;
    return jittered < b ? jittered : next;
  }

  // Els enters són consecutius: cal refinar la part fraccionària del petit.
  return intA + fractionBetween(fracA, null, random);
}

/**
 * N posicions consecutives, per sembrar una llista d'un cop.
 * Es fa encadenant, no repartint: així el resultat és el mateix que s'hauria obtingut
 * inserint-les una a una.
 */
export function generatePositions(
  count: number,
  before: string | null,
  after: string | null,
  random: RandomSource = defaultRandom,
): string[] {
  const out: string[] = [];
  let cursor = before;
  for (let i = 0; i < count; i += 1) {
    const next = generatePosition(cursor, after, random);
    out.push(next);
    cursor = next;
  }
  return out;
}

/**
 * Compara dues posicions **com ho farà la base de dades**.
 *
 * És una comparació de cadenes byte a byte, que és exactament el que fa
 * `COLLATE BINARY` a SQLite i `COLLATE "C"` a Postgres. No es fa servir
 * `localeCompare`: donaria un altre ordre i les proves passarien mentre la base es
 * desordena.
 */
export function comparePositions(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** El punt mig determinista entre dues claus. Sense jitter. Existeix per a les proves. */
export function midpoint(a: string, b: string | null): string {
  return between(a === '' ? null : a, b, null);
}
