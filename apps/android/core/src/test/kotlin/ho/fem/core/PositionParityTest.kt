package ho.fem.core

import java.io.File
import kotlin.random.Random
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * docs/13 M13 · paritat de l'índex fraccional (D3).
 *
 * Llegeix **els mateixos fixtures** que la prova de TypeScript:
 * `packages/contracts/fixtures/position.json`.
 *
 * Amb jitter, dues crides no donen el mateix ni al mateix costat —i això és volgut—, o
 * sigui que el que es compara no és la sortida de `generatePosition` sinó el punt mig
 * determinista, la comparació binària i l'alfabet.
 */
class PositionParityTest {

    private val fixtures by lazy {
        val root = generateSequence(File(".").absoluteFile) { it.parentFile }
            .firstOrNull { File(it, "packages/contracts/fixtures/position.json").exists() }
        assertNotNull(root, "No s'ha trobat l'arrel del repositori amb els fixtures compartits.")
        Json.parseToJsonElement(File(root, "packages/contracts/fixtures/position.json").readText())
            .jsonObject
    }

    @Test
    fun `l'alfabet és el mateix, dígit a dígit`() {
        // Si no ho fos, res de la resta tindria sentit.
        assertEquals(fixtures["alphabet"]!!.jsonPrimitive.content, ALPHABET)
    }

    @Test
    fun `els punts mitjans deterministes surten idèntics`() {
        val casos = fixtures["midpoints"]!!.jsonArray
        assertTrue(casos.size >= 8, "Hi ha d'haver casos de debò.")

        for (element in casos) {
            val case = element.jsonObject
            val before = case["before"]!!.let { if (it is JsonNull) null else it.jsonPrimitive.content }
            val after = case["after"]!!.let { if (it is JsonNull) null else it.jsonPrimitive.content }
            val expected = case["midpoint"]!!.jsonPrimitive.content

            assertEquals(
                expected,
                midpoint(before ?: "", after),
                "punt mig entre ${before ?: "res"} i ${after ?: "res"}",
            )
        }
    }

    @Test
    fun `la comparació és binària i coincideix`() {
        for (element in fixtures["comparisons"]!!.jsonArray) {
            val case = element.jsonObject
            val a = case["a"]!!.jsonPrimitive.content
            val b = case["b"]!!.jsonPrimitive.content
            val expected = case["result"]!!.jsonPrimitive.content.toInt()

            assertEquals(expected, comparePositions(a, b), "comparant \"$a\" amb \"$b\"")
        }
    }

    @Test
    fun `una clau generada cau SEMPRE entre les dues`() {
        // La propietat que de veritat importa, amb jitter i tot.
        val random = Random(20260806)
        var left = generatePosition(null, null, random)
        var right = generatePosition(left, null, random)

        repeat(500) {
            val middle = generatePosition(left, right, random)
            assertTrue(comparePositions(left, middle) < 0, "\"$middle\" no és més gran que \"$left\"")
            assertTrue(comparePositions(middle, right) < 0, "\"$middle\" no és més petit que \"$right\"")
            right = middle
        }

        // I no degeneren: 500 insercions al mateix buit no han de donar claus enormes.
        assertTrue(right.length < 400, "La clau ha degenerat: ${right.length} caràcters.")
        assertTrue(left.isNotEmpty())
    }

    @Test
    fun `mil moviments aleatoris mantenen l'ordre`() {
        val random = Random(42)
        val keys = mutableListOf(generatePosition(null, null, random))

        repeat(1000) {
            val at = random.nextInt(keys.size + 1)
            val before = if (at > 0) keys[at - 1] else null
            val after = if (at < keys.size) keys[at] else null
            keys.add(at, generatePosition(before, after, random))
        }

        for (i in 1 until keys.size) {
            assertTrue(
                comparePositions(keys[i - 1], keys[i]) < 0,
                "L'ordre s'ha trencat entre \"${keys[i - 1]}\" i \"${keys[i]}\"",
            )
        }
        assertEquals(1001, keys.size)
    }
}
