package ho.fem.model

import java.time.LocalDate
import java.time.ZoneId
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class CalendarDatesTest {
    @Test
    fun `una cita amb hora canvia de dia amb el fus del perfil`() {
        val startsAt = "2026-11-19T23:30:00Z"
        val date = CalendarDate.event(startsAt, false, ZoneId.of("Europe/Madrid"))
        assertEquals(LocalDate.of(2026, 11, 20), date?.day)
        assertEquals("00:30", date?.timeLabel)
    }

    @Test
    fun `un esdeveniment de dia sencer conserva la data escrita`() {
        val date = CalendarDate.event("2026-11-19T00:00:00Z", true, ZoneId.of("America/Los_Angeles"))
        assertEquals(LocalDate.of(2026, 11, 19), date?.day)
        assertNull(date?.timeLabel)
        assertNull(CalendarDate.event("", false, ZoneId.of("UTC")))
    }
}
