package ho.fem.model

import java.time.Instant
import java.time.ZoneId
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class CalendarTaskSuggestions(
    val enabled: Boolean = false,
    val date: String = "",
    val timezone: String = "UTC",
    @SerialName("day_ends_at") val dayEndsAt: String = "",
    val items: List<CalendarTaskSuggestion> = emptyList(),
) {
    fun visibleItems(now: Instant): List<CalendarTaskSuggestion> =
        if (validUntil(now) != null) items else emptyList()

    fun nextBoundary(now: Instant, visible: List<CalendarTaskSuggestion> = visibleItems(now)): Instant? {
        val endOfDay = validUntil(now) ?: return null
        val eventBoundary = visible.asSequence().filterNot { it.allDay || it.declined }
            .flatMap { sequenceOf(it.start, it.end) }.filter { it > now }.minOrNull()
        return minOf(endOfDay, eventBoundary ?: endOfDay)
    }

    private fun validUntil(now: Instant): Instant? = dayEndsAt.takeIf { enabled && it.isNotEmpty() }
        ?.let(Instant::parse)?.takeIf { now < it && now.atZone(ZoneId.of(timezone)).toLocalDate().toString() == date }
}

@Serializable
data class CalendarTaskSuggestion(
    @SerialName("calendar_id") val calendarId: String,
    val uid: String,
    @SerialName("recurrence_id") val recurrenceId: String? = null,
    @SerialName("scope_id") val scopeId: String,
    @SerialName("project_id") val projectId: String? = null,
    val title: String,
    @SerialName("calendar_name") val calendarName: String,
    @SerialName("starts_at") val startsAt: String,
    @SerialName("ends_at") val endsAt: String,
    @SerialName("all_day") val allDay: Boolean,
    val declined: Boolean,
    @SerialName("can_start") val canStart: Boolean,
    @SerialName("requires_share_confirmation") val requiresShareConfirmation: Boolean,
    @SerialName("requires_task_type") val requiresTaskType: Boolean,
    @SerialName("task_id") val taskId: String? = null,
) {
    val occurrence: SourceEvent get() = SourceEvent(calendarId, uid, recurrenceId)
    val start: Instant get() = Instant.parse(startsAt)
    val end: Instant get() = Instant.parse(endsAt).takeIf { it > start } ?: start.plusSeconds(60)

    fun column(now: Instant): TaskStatus {
        if (allDay || declined) return TaskStatus.TODO
        return if (now >= start && now < end) TaskStatus.DOING else TaskStatus.TODO
    }

    fun permitsPlannedStart(now: Instant): Boolean = column(now) == TaskStatus.DOING
}

enum class CalendarTaskStart { NOW, PLANNED }

@Serializable
data class TaskTimeSummary(
    val seconds: Double = 0.0,
    val segments: Int = 0,
    @SerialName("open_started_at") val openStartedAt: List<String> = emptyList(),
)
