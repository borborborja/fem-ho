package ho.fem.model

import java.io.File
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull

class DoneDayParityTest {
    @Serializable
    private data class FixtureTask(val id: String, val status: String, val completedAt: String?)

    @Serializable
    private data class Fixture(
        val name: String,
        val timezone: String,
        val now: String,
        val selectedDay: String?,
        val clearedAt: String?,
        val tasks: List<FixtureTask>,
        val visibleIds: List<String>,
        val hasActiveClear: Boolean,
    )

    @Test
    fun sharedFixturesMatchTheWebBoard() {
        val path = "packages/contracts/fixtures/done-day.json"
        val fixtureFile = generateSequence(File(".").canonicalFile) { it.parentFile }
            .map { File(it, path) }
            .firstOrNull { it.isFile }
        assertNotNull(fixtureFile, "No s'han trobat els fixtures compartits de la columna Fet.")

        for (fixture in Json.decodeFromString<List<Fixture>>(fixtureFile.readText())) {
            val zone = ZoneId.of(fixture.timezone)
            val today = Instant.parse(fixture.now).atZone(zone).toLocalDate()
            val selectedDay = fixture.selectedDay?.let(LocalDate::parse) ?: today
            val filter = DoneDayFilter(zone, today, selectedDay, fixture.clearedAt)
            val visible = fixture.tasks.filter { it.status != "done" || filter.includes(it.completedAt) }

            assertEquals(fixture.visibleIds, visible.map { it.id }, fixture.name)
            assertEquals(fixture.hasActiveClear, filter.clearedToday, fixture.name)
        }
    }
}
