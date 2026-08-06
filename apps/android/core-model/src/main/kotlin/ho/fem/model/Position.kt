package ho.fem.model

import kotlin.random.Random

/**
 * Índex fraccional amb jitter, **port de `packages/contracts/src/position.ts`** (D3).
 *
 * És un port línia a línia, no una reimplementació. El primer intent va ser una
 * paràfrasi —el punt mig calculat com `(low + high) / 2` en comptes de
 * `low + 1 + span / 2`— i els fixtures compartits el van enxampar de seguida: TypeScript
 * donava `a0G` i Kotlin `a0F` per al mateix cas. Aquesta és exactament la classe de
 * divergència que `docs/03` §1 diu que ningú detecta fins que passa a casa d'algú.
 *
 * L'ordre és **binari**, mai lingüístic: és el que fan `COLLATE BINARY` a SQLite i
 * `COLLATE "C"` a Postgres. Amb una collation lingüística les targetes es desordenen
 * sense cap error visible.
 */

/** Els dígits, en ordre. Han de ser **els mateixos** que a TypeScript. */
const val ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

private const val BASE = 62
private val MIN_DIGIT = ALPHABET[0]
private val MAX_DIGIT = ALPHABET[BASE - 1]

class InvalidPositionException(message: String) : IllegalArgumentException(message)

private fun digit(char: Char): Int {
    val index = ALPHABET.indexOf(char)
    if (index == -1) throw InvalidPositionException("\"$char\" no és un caràcter de l'alfabet.")
    return index
}

/**
 * Quants dígits té la part entera segons la seva capçalera.
 *
 * `'a'`..`'z'` són enters positius de 2 a 27 dígits; `'A'`..`'Z'`, negatius. La capçalera
 * va al davant perquè l'ordre binari de la cadena coincideixi amb l'ordre numèric: sense
 * ella, `"10"` aniria abans que `"9"`.
 */
private fun integerLength(head: Char): Int =
    when (head) {
        in 'a'..'z' -> head - 'a' + 2
        in 'A'..'Z' -> 'Z' - head + 2
        else -> throw InvalidPositionException("\"$head\" no és una capçalera vàlida.")
    }

private fun integerPart(key: String): String {
    if (key.isEmpty()) throw InvalidPositionException("La clau és buida.")
    val length = integerLength(key[0])
    if (length > key.length) {
        throw InvalidPositionException("La clau \"$key\" és més curta del que diu la capçalera.")
    }
    return key.substring(0, length)
}

private fun validateInteger(int: String) {
    if (int.length != integerLength(int[0])) {
        throw InvalidPositionException("La part entera \"$int\" no té la llargada que diu.")
    }
}

/** L'enter següent. Amb acarreig, i allargant la capçalera quan cal. */
private fun incrementInteger(int: String): String? {
    validateInteger(int)
    val head = int[0]
    val digits = int.substring(1).toCharArray()

    var carry = true
    var i = digits.size - 1
    while (carry && i >= 0) {
        val next = digit(digits[i]) + 1
        if (next == BASE) {
            digits[i] = MIN_DIGIT
        } else {
            digits[i] = ALPHABET[next]
            carry = false
        }
        i -= 1
    }

    if (carry) {
        // 'z' és l'última positiva: a partir d'aquí només queda refinar la fracció.
        if (head == 'z') return null
        // De l'última negativa es passa a la primera positiva.
        if (head == 'Z') return "a$MIN_DIGIT"
        val nextHead = head + 1
        return nextHead + MIN_DIGIT.toString().repeat(integerLength(nextHead) - 1)
    }

    return head + String(digits)
}

/** L'enter anterior. */
private fun decrementInteger(int: String): String? {
    validateInteger(int)
    val head = int[0]
    val digits = int.substring(1).toCharArray()

    var borrow = true
    var i = digits.size - 1
    while (borrow && i >= 0) {
        val next = digit(digits[i]) - 1
        if (next == -1) {
            digits[i] = MAX_DIGIT
        } else {
            digits[i] = ALPHABET[next]
            borrow = false
        }
        i -= 1
    }

    if (borrow) {
        if (head == 'A') return null
        if (head == 'a') return "Z$MAX_DIGIT"
        val prevHead = head - 1
        return prevHead + MAX_DIGIT.toString().repeat(integerLength(prevHead) - 1)
    }

    return head + String(digits)
}

/**
 * ON VA EL JITTER
 *
 * La manera òbvia és enganxar caràcters aleatoris al final de la clau. Funciona, però
 * surt car: cada clau nova ha de ser més gran que l'anterior, que ja porta aquells
 * caràcters de més.
 *
 * Aquí va **dins de la tria del dígit** de la part fraccionària. La tria es concentra al
 * terç central: triar de tot el rang faria sortir dígits enganxats als extrems i la
 * inserció següent per aquell costat s'hauria d'allargar de seguida.
 */
private const val JITTER_SPREAD = 3

private fun pickDigit(low: Int, high: Int, random: Random?): Int {
    val span = high - low - 1
    if (span <= 0) throw InvalidPositionException("No hi ha cap dígit entre els dos veïns.")
    if (random == null || span == 1) return low + 1 + span / 2

    // Amb intervals petits, el rang sencer i no el terç central: `span / 3` col·lapsa a
    // 1 quan `span` és 2, i llavors `nextInt(1)` és sempre 0 i el jitter desapareix
    // justament on més fa falta. Ha de coincidir amb el de TypeScript.
    val window = if (span <= JITTER_SPREAD) span else span / JITTER_SPREAD
    val start = low + 1 + (span - window) / 2
    return start + random.nextInt(window)
}

/**
 * La clau entre dues parts fraccionàries. `a` buida vol dir el mínim i `b` nul·la el
 * màxim d'aquest nivell.
 */
private fun fractionBetween(a: String, b: String?, random: Random?): String {
    if (b != null && a >= b) {
        throw InvalidPositionException("\"$a\" no és anterior a \"$b\".")
    }

    /**
     * Els caràcters que li falten a `a` compten com el dígit **més baix**, no com
     * absents. Sense això, `fractionBetween("", "0a")` no veuria cap prefix comú, aniria
     * a la branca dels dígits i tornaria una clau MÉS GRAN que `"0a"` — l'ordre trencat
     * en silenci.
     */
    var common = 0
    if (b != null) {
        while (common < b.length && (if (common < a.length) a[common] else MIN_DIGIT) == b[common]) {
            common += 1
        }
    }
    if (common > 0) {
        // `common > 0` només pot passar si `b` no és nul: el bucle de sobre no s'executa
        // altrament. Es captura en una variable no nul·la perquè es llegeixi sense `!!`.
        val prefixed = requireNotNull(b)
        val restB = prefixed.substring(common)
        return prefixed.substring(0, common) +
            fractionBetween(a.drop(common), if (restB.isEmpty()) null else restB, random)
    }

    val digitA = if (a.isEmpty()) 0 else digit(a[0])
    val digitB = if (b == null || b.isEmpty()) BASE else digit(b[0])
    val span = digitB - digitA - 1

    /**
     * Un interval estret no dona prou entropia i cal baixar un nivell: amb un o dos
     * dígits disponibles, dos clients que insereixin al mateix buit xoquen sempre o la
     * meitat de les vegades. Ha de coincidir amb el de TypeScript.
     */
    if (span >= JITTER_SPREAD || (span >= 1 && random == null)) {
        return ALPHABET[pickDigit(digitA, digitB, random)].toString()
    }

    if (span >= 1) {
        val first = ALPHABET[digitA + 1]
        // Mai el dígit més baix a sota: cap fracció pot acabar-hi.
        return first.toString() + ALPHABET[1 + random!!.nextInt(BASE - 1)]
    }

    if (b != null && b.length > 1 && random == null) {
        return b.substring(0, 1)
    }

    return ALPHABET[digitA] + fractionBetween(a.drop(1), null, random)
}

private fun between(a: String?, b: String?, random: Random?): String {
    if (a == null && b == null) return "a" + ALPHABET[pickDigit(0, BASE, random)]

    if (a == null) {
        // Abans del primer: es decrementa l'enter de `b`. Comptar, no partir per la meitat.
        val intB = integerPart(b!!)
        val fracB = b.substring(intB.length)
        if (fracB.isNotEmpty()) return intB + fractionBetween("", fracB, random)

        val smaller = decrementInteger(intB) ?: return intB + fractionBetween("", null, random)
        return smaller
    }

    if (b == null) {
        // Després de l'últim: s'incrementa l'enter. AQUEST és el camí car si es fa
        // malament, perquè afegir al peu d'una columna és el gest més freqüent.
        val intA = integerPart(a)
        val fracA = a.substring(intA.length)
        val bigger = incrementInteger(intA) ?: return intA + fractionBetween(fracA, null, random)
        return bigger
    }

    val intA = integerPart(a)
    val intB = integerPart(b)
    val fracA = a.substring(intA.length)
    val fracB = b.substring(intB.length)

    if (intA == intB) {
        return intA + fractionBetween(fracA, if (fracB.isEmpty()) null else fracB, random)
    }

    val next = incrementInteger(intA)
    if (next != null && next < b) return next

    // Els enters són consecutius: cal refinar la part fraccionària del petit.
    return intA + fractionBetween(fracA, null, random)
}

/**
 * Genera una posició entre `before` i `after`.
 *
 * La invariant `before < resultat < after` es comprova abans de tornar. És barata i
 * massa cara de perdre: si es trenqués, la targeta apareixeria en un lloc diferent a
 * cada client i no hi hauria cap error enlloc.
 */
fun generatePosition(before: String?, after: String?, random: Random? = Random.Default): String {
    val key = between(before, after, random)

    if (before != null && key <= before) {
        throw InvalidPositionException("\"$key\" no ha quedat després de \"$before\".")
    }
    if (after != null && key >= after) {
        throw InvalidPositionException("\"$key\" no ha quedat abans de \"$after\".")
    }
    return key
}

/**
 * Compara dues claus.
 *
 * **Byte a byte**, com `COLLATE BINARY`. No es fa servir cap comparació lingüística:
 * donaria un altre ordre i les proves passarien mentre la base es desordena.
 */
fun comparePositions(a: String, b: String): Int = if (a < b) -1 else if (a > b) 1 else 0

/** El punt mig determinista. Sense jitter. Existeix per a les proves i els fixtures. */
fun midpoint(a: String, b: String?): String = between(a.ifEmpty { null }, b, null)
