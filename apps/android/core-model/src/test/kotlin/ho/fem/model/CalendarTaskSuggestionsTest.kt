package ho.fem.model

import java.time.Instant
import java.io.File
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class CalendarTaskSuggestionsTest {
    private val start = Instant.parse("2026-11-21T09:00:00Z")
    private val end = start.plusSeconds(30 * 60)
    private val eventTitle = "Reunió"
    private val suggestion = CalendarTaskSuggestion(
        calendarId = "calendar", uid = "daily", recurrenceId = start.toString(),
        scopeId = "work", title = eventTitle, calendarName = "Feina",
        startsAt = start.toString(), endsAt = end.toString(), allDay = false,
        declined = false, canStart = true, requiresShareConfirmation = false, requiresTaskType = false,
    )

    @Serializable
    private data class Scenario(
        val name: String,
        @SerialName("now_seconds") val nowSeconds: Long,
        @SerialName("ends_seconds") val endsSeconds: Long,
        @SerialName("all_day") val allDay: Boolean = false,
        val declined: Boolean = false,
        val expected: TaskStatus,
    )

    @Test
    fun matchesSharedSuggestionFixtures() {
        val path = "packages/contracts/fixtures/calendar-suggestions.json"
        val file = generateSequence(File(".").canonicalFile) { it.parentFile }
            .map { File(it, path) }.first { it.isFile }
        for (scenario in Json.decodeFromString<List<Scenario>>(file.readText())) {
            val event = suggestion.copy(
                endsAt = start.plusSeconds(scenario.endsSeconds).toString(),
                allDay = scenario.allDay,
                declined = scenario.declined,
            )
            val now = start.plusSeconds(scenario.nowSeconds)
            assertEquals(scenario.expected, event.column(now), scenario.name)
            assertEquals(scenario.expected == TaskStatus.DOING, event.permitsPlannedStart(now), scenario.name)
        }
    }

    @Test
    fun `la memòria cau caduca a la mitjanit que ha calculat el servidor`() {
        val midnight = Instant.parse("2026-11-21T23:00:00Z")
        val snapshot = CalendarTaskSuggestions(true, "2026-11-21", "Europe/Madrid", midnight.toString(), listOf(suggestion))
        assertEquals(listOf(suggestion), snapshot.visibleItems(midnight.minusMillis(1)))
        assertTrue(snapshot.visibleItems(midnight).isEmpty())
        assertTrue(snapshot.visibleItems(start.minusSeconds(12 * 3600)).isEmpty())
        assertTrue(snapshot.copy(enabled = false).visibleItems(start).isEmpty())
    }
}
