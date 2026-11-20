package ho.fem.model

import java.time.Instant
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeParseException

/** Mateixa regla que el tauler web, fixada a les fixtures de `packages/contracts`. */
class DoneDayFilter(
    private val zone: ZoneId,
    today: LocalDate,
    private val day: LocalDate,
    clearedAt: String?,
) {
    private val cutoff = clearedAt.toInstantOrNull()?.takeIf {
        day.isEqual(today) && it.atZone(zone).toLocalDate().isEqual(today)
    }

    val clearedToday: Boolean get() = cutoff != null

    fun includes(completedAt: String?): Boolean {
        val completed = completedAt.toInstantOrNull() ?: return false
        return completed.atZone(zone).toLocalDate().isEqual(day) &&
            (cutoff == null || completed.isAfter(cutoff))
    }

    private fun String?.toInstantOrNull(): Instant? = try {
        // Als Android antics, Instant.parse només admet el sufix Z.
        this?.let { OffsetDateTime.parse(it).toInstant() }
    } catch (_: DateTimeParseException) {
        null
    }
}
