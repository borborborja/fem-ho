package ho.fem.model

import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException

data class CalendarDate(val day: LocalDate, val time: LocalTime? = null) {
    val timeLabel: String? get() = time?.format(TimeFormat)

    companion object {
        private val TimeFormat = DateTimeFormatter.ofPattern("HH:mm")

        /** Una data de dia sencer representa el dia escrit pel calendari. */
        fun event(start: String, allDay: Boolean, zone: ZoneId): CalendarDate? = try {
            if (allDay) CalendarDate(LocalDate.parse(start.take(10)))
            else Instant.parse(start).atZone(zone).let { CalendarDate(it.toLocalDate(), it.toLocalTime()) }
        } catch (_: DateTimeParseException) {
            null
        }
    }
}
