package ho.fem.model

import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class GoogleCalendarDatesTest {
    @Test
    fun `un dia sencer viatja com a mitjanit UTC amb mil·lisegons`() {
        assertEquals("2026-03-29T00:00:00.000Z", GoogleCalendarDates.allDay(LocalDate.parse("2026-03-29")))
    }

    @Test
    fun `una edició conserva l'instant original quan l'hora es repeteix`() {
        val start = Instant.parse("2026-10-25T01:30:19Z")
        val zone = ZoneId.of("Europe/Madrid")
        assertEquals(start, GoogleCalendarDates.timed(LocalDate.parse("2026-10-25"), LocalTime.parse("02:30:19"), zone, start))
        assertNull(GoogleCalendarDates.timed(LocalDate.parse("2026-03-29"), LocalTime.parse("02:30"), zone, null))
    }
}
