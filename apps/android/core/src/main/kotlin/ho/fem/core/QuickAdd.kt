package ho.fem.core

/**
 * Parser d'afegida ràpida, **port de `packages/contracts/src/quickadd.ts`**.
 *
 * No és una reimplementació: és el mateix algorisme, línia a línia, perquè els dos
 * costats han de donar exactament el mateix davant dels mateixos fixtures.
 *
 * `docs/03` §1 diu per què això importa: *"Sense això, les dues implementacions
 * divergeixen i ningú se n'adona fins que un usuari escriu `#Feina/Client Salt` amb un
 * espai."*
 *
 * Quan es toqui el de TypeScript, s'ha de tocar aquest. La comprovació permanent
 * `parser-parity` executa els mateixos casos contra tots dos i compara.
 */

data class QuickAddProject(val id: String, val name: String)

data class QuickAddScope(
    val id: String,
    val name: String,
    val projects: List<QuickAddProject> = emptyList(),
)

data class QuickAddPerson(val id: String, val name: String)

data class QuickAddContext(
    val scopes: List<QuickAddScope>,
    val people: List<QuickAddPerson>,
    /**
     * Els àmbits actius a la barra superior. Amb més d'un i sense `#`, no es crea res i
     * es demana l'àmbit; amb un de sol, s'agafa aquell (docs/02 §4).
     */
    val activeScopeIds: List<String> = emptyList(),
)

enum class TokenKind { SCOPE, PROJECT, PERSON, AI_MODE }

/** Un tros reconegut del text, que la interfície pinta com a xip reversible. */
data class QuickAddToken(
    val kind: TokenKind,
    /** El text literal que ocupava, sigil inclòs. Tornar-lo a posar desfà el xip. */
    val raw: String,
    val start: Int,
    val end: Int,
    val id: String,
    val label: String,
)

enum class AiMode(val wire: String) {
    MANUAL("manual"),
    ASSISTED("assisted"),
    DELEGATED("delegated"),
}

enum class QuickAddError(val wire: String) {
    SCOPE_REQUIRED("scope-required"),
    EMPTY_TITLE("empty-title"),
}

data class QuickAddResult(
    val title: String,
    val scopeId: String?,
    val projectId: String?,
    val assigneeIds: List<String>,
    val aiMode: AiMode,
    val tokens: List<QuickAddToken>,
    val error: QuickAddError?,
)

/**
 * Normalitza per comparar: sense accents, sense majúscules, sense ela geminada.
 *
 * **Ha de donar el mateix que `fold()` del TypeScript.** Allà es fa amb `normalize('NFD')`
 * i un rang de diacrítics; aquí amb `java.text.Normalizer`, que fa la mateixa
 * descomposició d'Unicode. L'ordre també és el mateix: la ela geminada es desfà
 * **abans** de treure els diacrítics, o el punt volat es quedaria sol.
 */
internal fun fold(value: String): String {
    val lower = value.lowercase()
    val withoutGeminate = lower.replace("l·l", "ll").replace("·", "")
    val decomposed = java.text.Normalizer.normalize(withoutGeminate, java.text.Normalizer.Form.NFD)
    val withoutMarks = decomposed.replace(Regex("[\\u0300-\\u036f]"), "")
    return withoutMarks.replace(Regex("[‘’']"), "'")
}

/** Els modes d'IA que s'accepten al sigil `!ia`, en català i en canònic. */
private val AI_MODE_WORDS =
    mapOf(
        "ajuda" to AiMode.ASSISTED,
        "assistida" to AiMode.ASSISTED,
        "assisted" to AiMode.ASSISTED,
        "delegada" to AiMode.DELEGATED,
        "delegated" to AiMode.DELEGATED,
    )

private data class Match(val id: String, val name: String, val length: Int)

/**
 * La coincidència **més llarga** d'una llista de noms a partir d'una posició.
 *
 * "Més llarga" i no "primera": si existeixen els projectes "Client" i "Client Salt",
 * escriure `#Feina/Client Salt` ha de triar el segon.
 */
private fun matchLongest(text: String, from: Int, candidates: List<Pair<String, String>>): Match? {
    if (from > text.length) return null
    val rest = fold(text.substring(from))
    var best: Match? = null

    for ((id, name) in candidates) {
        val folded = fold(name)
        if (folded.isEmpty()) continue
        if (!rest.startsWith(folded)) continue

        // El nom ha d'acabar en límit de paraula: `#Fein` no ha de coincidir amb
        // "Feina", i `#Feinal` tampoc.
        val after = if (folded.length < rest.length) rest[folded.length] else null
        if (after != null && after != ' ' && after != '/') continue

        if (best == null || folded.length > best.length) {
            best = Match(id, name, folded.length)
        }
    }
    return best
}

private val AI_SIGIL = Regex("^!ia(?::(\\p{L}+))?")

/**
 * Analitza una línia d'afegida ràpida.
 *
 * **No llança mai**: torna `error` i el que hagi pogut entendre, perquè la interfície
 * pugui ensenyar el missatge *i conservar el que l'usuari ha escrit*.
 */
fun parseQuickAdd(text: String, context: QuickAddContext): QuickAddResult {
    val tokens = mutableListOf<QuickAddToken>()
    val titleParts = mutableListOf<String>()

    var scopeId: String? = null
    var projectId: String? = null
    val assigneeIds = mutableListOf<String>()
    var aiMode = AiMode.MANUAL

    var i = 0
    var plainFrom = 0

    fun flushPlain(until: Int) {
        val chunk = text.substring(plainFrom, until)
        if (chunk.isNotBlank()) titleParts.add(chunk.trim())
    }

    val scopePairs = context.scopes.map { it.id to it.name }
    val peoplePairs = context.people.map { it.id to it.name }

    while (i < text.length) {
        val char = text[i]

        if (char == '#') {
            val scope = matchLongest(text, i + 1, scopePairs)
            if (scope != null) {
                flushPlain(i)
                var end = i + 1 + scope.length

                tokens.add(
                    QuickAddToken(
                        kind = TokenKind.SCOPE,
                        raw = text.substring(i, end),
                        start = i,
                        end = end,
                        id = scope.id,
                        label = scope.name,
                    ),
                )
                scopeId = scope.id

                // `#Àmbit/Projecte` encamina també al projecte.
                if (end < text.length && text[end] == '/') {
                    val owner = context.scopes.firstOrNull { it.id == scope.id }
                    val project =
                        matchLongest(text, end + 1, owner?.projects?.map { it.id to it.name } ?: emptyList())
                    if (project != null) {
                        val projectStart = end
                        end += 1 + project.length
                        tokens.add(
                            QuickAddToken(
                                kind = TokenKind.PROJECT,
                                raw = text.substring(projectStart, end),
                                start = projectStart,
                                end = end,
                                id = project.id,
                                label = project.name,
                            ),
                        )
                        projectId = project.id
                    }
                }

                i = end
                plainFrom = i
                continue
            }
        }

        if (char == '@') {
            val person = matchLongest(text, i + 1, peoplePairs)
            if (person != null) {
                flushPlain(i)
                val end = i + 1 + person.length
                tokens.add(
                    QuickAddToken(
                        kind = TokenKind.PERSON,
                        raw = text.substring(i, end),
                        start = i,
                        end = end,
                        id = person.id,
                        label = person.name,
                    ),
                )
                if (!assigneeIds.contains(person.id)) assigneeIds.add(person.id)
                i = end
                plainFrom = i
                continue
            }
        }

        if (char == '!') {
            // `!ia` i `!ia:delegada` (docs/09 §2). Sense el sigil, tota tasca neix manual.
            val match = AI_SIGIL.find(text.substring(i))
            if (match != null) {
                flushPlain(i)
                val end = i + match.value.length
                val word = match.groupValues[1].takeIf { it.isNotEmpty() }?.let { fold(it) }
                val mode = if (word == null) AiMode.DELEGATED else AI_MODE_WORDS[word] ?: AiMode.DELEGATED
                tokens.add(
                    QuickAddToken(
                        kind = TokenKind.AI_MODE,
                        raw = text.substring(i, end),
                        start = i,
                        end = end,
                        id = mode.wire,
                        label = mode.wire,
                    ),
                )
                aiMode = mode
                i = end
                plainFrom = i
                continue
            }
        }

        i += 1
    }

    flushPlain(text.length)

    // "La resta és el títol, amb els espais sobrants col·lapsats" (docs/02 §4).
    val title = titleParts.joinToString(" ").replace(Regex("\\s+"), " ").trim()

    // Amb un sol àmbit actiu s'agafa aquell; amb més d'un, cal el `#` (docs/02 §4).
    if (scopeId == null && context.activeScopeIds.size == 1) {
        scopeId = context.activeScopeIds.firstOrNull()
    }

    val error =
        when {
            scopeId == null -> QuickAddError.SCOPE_REQUIRED
            title.isEmpty() -> QuickAddError.EMPTY_TITLE
            else -> null
        }

    return QuickAddResult(title, scopeId, projectId, assigneeIds.toList(), aiMode, tokens.toList(), error)
}

/**
 * Desfà un xip: torna el text amb el tros reconegut convertit en text pla.
 *
 * "Clicar-la la torna a text pla. Sense això, un parser agressiu és una trampa"
 * (docs/02 §4, D12). Es treu el sigil i es deixa el nom: així l'usuari veu què hi havia
 * i pot corregir-ho, en comptes de quedar-se amb un forat.
 */
fun revertToken(text: String, token: QuickAddToken): String {
    val plain =
        when (token.kind) {
            TokenKind.SCOPE, TokenKind.PERSON -> token.raw.removePrefix("#").removePrefix("@")
            TokenKind.PROJECT -> token.raw.removePrefix("/")
            TokenKind.AI_MODE -> ""
        }
    return (text.substring(0, token.start) + plain + text.substring(token.end))
        .replace(Regex("\\s+"), " ")
        .trim()
}
