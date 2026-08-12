package ho.fem.model

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * docs/13 M13 · `test: android-parser-parity`.
 *
 * **Llegeix els MATEIXOS fixtures que la prova de TypeScript.** Cap cas escrit aquí a
 * dins: un cas que només visqui en un dels dos costats és exactament com comença la
 * divergència que `docs/03` §1 descriu.
 *
 * Si aquest fitxer deixés d'importar `packages/contracts/fixtures/quickadd.json`, la
 * comprovació permanent `parser-parity` ho diria.
 */
class QuickAddParityTest {

    private val fixtures: JsonObject by lazy {
        // Es puja des del mòdul fins a l'arrel del repositori: els fixtures són
        // compartits i no es dupliquen dins d'`apps/android`. Duplicar-los seria tornar
        // a tenir dues fonts de veritat, que és el problema que això resol.
        val root = generateSequence(File(".").absoluteFile) { it.parentFile }
            .firstOrNull { File(it, "packages/contracts/fixtures/quickadd.json").exists() }
        assertNotNull(root, "No s'ha trobat l'arrel del repositori amb els fixtures compartits.")

        val file = File(root, "packages/contracts/fixtures/quickadd.json")
        Json.parseToJsonElement(file.readText()).jsonObject
    }

    private fun contextFrom(node: JsonObject, activeScopeIds: List<String>): QuickAddContext {
        val scopes =
            node["scopes"]!!.jsonArray.map { element ->
                val scope = element.jsonObject
                QuickAddScope(
                    id = scope["id"]!!.jsonPrimitive.content,
                    name = scope["name"]!!.jsonPrimitive.content,
                    projects =
                        (scope["projects"] as? JsonArray ?: JsonArray(emptyList())).map {
                            val project = it.jsonObject
                            QuickAddProject(
                                id = project["id"]!!.jsonPrimitive.content,
                                name = project["name"]!!.jsonPrimitive.content,
                            )
                        },
                )
            }

        val people =
            node["people"]!!.jsonArray.map {
                val person = it.jsonObject
                QuickAddPerson(
                    id = person["id"]!!.jsonPrimitive.content,
                    name = person["name"]!!.jsonPrimitive.content,
                )
            }

        val taskTypes =
            (node["taskTypes"] as? JsonArray ?: JsonArray(emptyList())).map {
                val type = it.jsonObject
                QuickAddTaskType(
                    id = type["id"]!!.jsonPrimitive.content,
                    name = type["name"]!!.jsonPrimitive.content,
                    scopeId = type["scopeId"]!!.jsonPrimitive.content,
                )
            }

        return QuickAddContext(scopes, people, activeScopeIds, taskTypes)
    }

    /** Compara el resultat amb el que diu el fixture, camp a camp i només els que hi són. */
    private fun check(name: String, result: QuickAddResult, expect: JsonObject) {
        expect["title"]?.let { assertEquals(it.jsonPrimitive.content, result.title, "$name · títol") }

        expect["scopeId"]?.let {
            val esperat = (it as? JsonPrimitive)?.takeIf { p -> !p.isString || p.content != "null" }
            assertEquals(nullable(it), result.scopeId, "$name · àmbit")
            assertNotNull(esperat ?: it)
        }

        expect["projectId"]?.let { assertEquals(nullable(it), result.projectId, "$name · projecte") }

        expect["assigneeIds"]?.let {
            assertEquals(
                it.jsonArray.map { id -> id.jsonPrimitive.content },
                result.assigneeIds,
                "$name · assignats",
            )
        }

        expect["aiMode"]?.let { assertEquals(it.jsonPrimitive.content, result.aiMode.wire, "$name · mode d'IA") }

        expect["taskTypeId"]?.let {
            assertEquals(nullable(it), result.taskTypeId, "$name · tipologia")
        }

        expect["error"]?.let { assertEquals(nullable(it), result.error?.wire, "$name · error") }
    }

    private fun nullable(element: kotlinx.serialization.json.JsonElement): String? {
        val primitive = element as? JsonPrimitive ?: return null
        return if (primitive.content == "null" && !primitive.isString) null else primitive.contentOrNullSafe()
    }

    private fun JsonPrimitive.contentOrNullSafe(): String? =
        if (this.toString() == "null") null else this.content

    @Test
    fun `els fixtures compartits passen tots`() {
        val context = contextFrom(fixtures["context"]!!.jsonObject, emptyList())
        val cases = fixtures["cases"]!!.jsonArray

        assertTrue(cases.size >= 20, "Hi ha d'haver casos de debò, i n'hi ha ${cases.size}.")

        for (element in cases) {
            val case = element.jsonObject
            val name = case["name"]!!.jsonPrimitive.content
            val input = case["input"]!!.jsonPrimitive.content
            check(name, parseQuickAdd(input, context), case["expect"]!!.jsonObject)
        }
    }

    @Test
    fun `amb un sol àmbit actiu, els seus casos també`() {
        val block = fixtures["singleActiveScope"]?.jsonObject ?: return
        val activeScopeIds =
            block["activeScopeIds"]!!.jsonArray.map { it.jsonPrimitive.content }
        val context = contextFrom(fixtures["context"]!!.jsonObject, activeScopeIds)

        for (element in block["cases"]!!.jsonArray) {
            val case = element.jsonObject
            val name = case["name"]!!.jsonPrimitive.content
            val input = case["input"]!!.jsonPrimitive.content
            check(name, parseQuickAdd(input, context), case["expect"]!!.jsonObject)
        }
    }

    @Test
    fun `AQUEST és el cas de docs 03 §1 que ningú detecta`() {
        // "Ningú se n'adona fins que un usuari escriu `#Feina/Client Salt` amb un espai."
        val context = contextFrom(fixtures["context"]!!.jsonObject, emptyList())
        val result = parseQuickAdd("#Feina/Client Salt Enviar proposta @Alba", context)

        assertEquals("Enviar proposta", result.title)
        assertEquals("scope-feina", result.scopeId)
        // "Client" també existeix: si s'agafés la PRIMERA coincidència en comptes de la
        // més llarga, aquí sortiria "proj-client" i el títol seria "Salt Enviar proposta".
        assertEquals("proj-client-salt", result.projectId)
        assertEquals(listOf("user-alba"), result.assigneeIds)
    }

    @Test
    fun `la normalització catalana dona el mateix que la de TypeScript`() {
        // Els dos costats han de plegar igual: accents, ela geminada i apòstrofs.
        assertEquals("familia", fold("Família"))
        assertEquals("collegi", fold("Col·legi"))
        assertEquals("barca", fold("Barça"))
        assertEquals("l'aigua", fold("L'aigua"))
    }
}
