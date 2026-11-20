package ho.fem.model

import java.io.File
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.encodeToJsonElement
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

class PomodoroParityTest {
    @Serializable
    private data class Scenario(val name: String, val steps: List<Step>)

    @Serializable
    private data class Step(
        val command: JsonObject? = null,
        @SerialName("now_ms") val nowMs: Long? = null,
        val expect: JsonObject? = null,
        val conflict: Boolean = false,
    )

    @Test
    fun matchesSharedTimerFixtures() {
        val path = "packages/contracts/fixtures/pomodoro.json"
        val file = generateSequence(File(".").canonicalFile) { it.parentFile }
            .map { File(it, path) }.first { it.isFile }
        val json = Json { encodeDefaults = true }

        for (scenario in json.decodeFromString<List<Scenario>>(file.readText())) {
            var snapshot = emptyPomodoroSnapshot()
            for ((index, step) in scenario.steps.withIndex()) {
                val where = "${scenario.name} · ${index + 1}"
                if (step.command != null) {
                    val result = applyPomodoroCommand(snapshot, step.command)
                    if (step.conflict) {
                        assertNull(result, where)
                        continue
                    }
                    snapshot = assertNotNull(result, where)
                }
                if (step.expect != null) {
                    val timer = if (step.nowMs == null) snapshot.timer else {
                        projectPomodoroTimer(snapshot.timer, step.nowMs)?.let {
                            it.copy(remainingMs = pomodoroRemainingMs(it, step.nowMs))
                        }
                    }
                    assertSubset(step.expect, json.encodeToJsonElement(snapshot.copy(timer = timer)), where)
                }
            }
        }
    }

    private fun assertSubset(expected: JsonElement, actual: JsonElement?, path: String) {
        if (expected is JsonObject && actual is JsonObject) {
            for ((key, value) in expected) assertSubset(value, actual[key], "$path · $key")
        } else {
            assertEquals(expected, actual, path)
        }
    }
}
