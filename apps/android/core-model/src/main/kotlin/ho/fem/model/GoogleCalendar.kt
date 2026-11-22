package ho.fem.model

import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatterBuilder
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class GoogleCalendarAvailability(val enabled: Boolean = false)

@Serializable
data class GoogleCalendarAttempt(
    val id: String,
    val status: String,
    val email: String? = null,
    @SerialName("error_code") val errorCode: String? = null,
    @SerialName("authorization_url") val authorizationUrl: String? = null,
)

@Serializable
data class GoogleCalendarAccount(
    val id: String,
    val email: String,
    @SerialName("oauth_status") val oauthStatus: String,
)

@Serializable
data class GoogleCalendarChoice(
    val id: String,
    val name: String,
    val primary: Boolean,
    val writable: Boolean,
)

@Serializable
data class GoogleCalendarDraft(
    val summary: String,
    val description: String,
    val location: String,
    @SerialName("starts_at") val startsAt: String,
    @SerialName("ends_at") val endsAt: String,
    @SerialName("all_day") val allDay: Boolean,
    val timezone: String,
) {
    fun changedFields(event: EventOccurrence): List<String> = buildList {
        if (summary != event.summary) add("summary")
        if (description != event.description.orEmpty()) add("description")
        if (location != event.location.orEmpty()) add("location")
        if (allDay != event.allDay || Instant.parse(startsAt) != Instant.parse(event.startsAt)) add("start")
        if (allDay != event.allDay || Instant.parse(endsAt) != Instant.parse(event.endsAt)) add("end")
    }
}

@Serializable
data class GoogleCalendarChange(
    val id: String,
    @SerialName("calendar_id") val calendarId: String,
    @SerialName("event_id") val eventId: String,
    val operation: String,
    val status: String,
    @SerialName("error_code") val errorCode: String? = null,
    val draft: GoogleCalendarDraft? = null,
)

object GoogleCalendarDates {
    private val milliseconds = DateTimeFormatterBuilder().appendInstant(3).toFormatter()

    fun allDay(date: LocalDate): String = milliseconds.format(date.atStartOfDay().toInstant(ZoneOffset.UTC))

    fun timed(date: LocalDate, time: LocalTime, zone: ZoneId, original: Instant?): Instant? {
        val local = LocalDateTime.of(date, time)
        // En un canvi de títol es conserva la mateixa ocurrència encara que l'hora es repeteixi amb l'horari d'hivern.
        if (original?.atZone(zone)?.toLocalDateTime() == local) return original
        return zone.rules.getValidOffsets(local).firstOrNull()?.let(local::toInstant)
    }
}
