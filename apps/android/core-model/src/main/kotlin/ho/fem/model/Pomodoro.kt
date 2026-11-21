package ho.fem.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.longOrNull

@Serializable
enum class PomodoroMode {
    @SerialName("playful") PLAYFUL,
    @SerialName("serious") SERIOUS,
}

@Serializable
enum class PomodoroPhase {
    @SerialName("focus") FOCUS,
    @SerialName("short_break") SHORT_BREAK,
    @SerialName("long_break") LONG_BREAK,
}

@Serializable
enum class PomodoroStatus {
    @SerialName("ready") READY,
    @SerialName("running") RUNNING,
    @SerialName("paused") PAUSED,
}

@Serializable
enum class PomodoroAction(val wire: String) {
    @SerialName("resume") RESUME("resume"),
    @SerialName("pause") PAUSE("pause"),
    @SerialName("reset") RESET("reset"),
    @SerialName("skip") SKIP("skip"),
    @SerialName("stop") STOP("stop"),
}

@Serializable
data class PomodoroTiming(
    @SerialName("focus_minutes") val focusMinutes: Int,
    @SerialName("short_break_minutes") val shortBreakMinutes: Int,
    @SerialName("long_break_minutes") val longBreakMinutes: Int,
    @SerialName("long_break_every") val longBreakEvery: Int,
    @SerialName("auto_start_focus") val autoStartFocus: Boolean,
    @SerialName("auto_start_break") val autoStartBreak: Boolean,
) {
    internal fun durationMs(phase: PomodoroPhase): Long = 60_000L * when (phase) {
        PomodoroPhase.FOCUS -> focusMinutes
        PomodoroPhase.SHORT_BREAK -> shortBreakMinutes
        PomodoroPhase.LONG_BREAK -> longBreakMinutes
    }
}

@Serializable
data class PomodoroSettings(
    val enabled: Boolean = false,
    val mode: PomodoroMode = PomodoroMode.PLAYFUL,
    @SerialName("focus_minutes") val focusMinutes: Int = 25,
    @SerialName("short_break_minutes") val shortBreakMinutes: Int = 5,
    @SerialName("long_break_minutes") val longBreakMinutes: Int = 15,
    @SerialName("long_break_every") val longBreakEvery: Int = 4,
    @SerialName("auto_start_focus") val autoStartFocus: Boolean = false,
    @SerialName("auto_start_break") val autoStartBreak: Boolean = false,
    val sound: Boolean = true,
) {
    internal fun timing(): PomodoroTiming =
        PomodoroTiming(focusMinutes, shortBreakMinutes, longBreakMinutes, longBreakEvery, autoStartFocus, autoStartBreak)
}

@Serializable
data class PomodoroTimer(
    val id: String,
    val version: Int,
    val phase: PomodoroPhase,
    @SerialName("phase_number") val phaseNumber: Long,
    val status: PomodoroStatus,
    @SerialName("end_at_ms") val endAtMs: Long?,
    @SerialName("remaining_ms") val remainingMs: Long,
    @SerialName("completed_focus") val completedFocus: Long,
    @SerialName("task_id") val taskId: String?,
    @SerialName("device_id") val deviceId: String,
    val timing: PomodoroTiming,
)

@Serializable
data class PomodoroSnapshot(
    val settings: PomodoroSettings = PomodoroSettings(),
    val queue: List<String> = emptyList(),
    @SerialName("queue_version") val queueVersion: Int = 0,
    val timer: PomodoroTimer? = null,
    @SerialName("server_time_ms") val serverTimeMs: Long = 0,
    @SerialName("moved_task") val movedTask: Task? = null,
)

fun emptyPomodoroSnapshot(nowMs: Long = 0): PomodoroSnapshot = PomodoroSnapshot(serverTimeMs = nowMs)

fun pomodoroRemainingMs(timer: PomodoroTimer, nowMs: Long): Long {
    val end = timer.endAtMs ?: return timer.remainingMs
    return (end - nowMs).coerceIn(0, timer.remainingMs)
}

/** Les fases es projecten des de terminis absoluts, igual que a `@fem-ho/contracts`. */
fun projectPomodoroTimer(timer: PomodoroTimer?, nowMs: Long): PomodoroTimer? {
    var current = timer ?: return null
    while (current.status == PomodoroStatus.RUNNING) {
        val end = current.endAtMs ?: break
        if (end > nowMs) break
        val timing = current.timing
        val focusMs = timing.durationMs(PomodoroPhase.FOCUS)
        val perCycle = timing.longBreakEvery
        if (timing.autoStartFocus && timing.autoStartBreak && current.phase == PomodoroPhase.FOCUS &&
            current.remainingMs == focusMs && current.completedFocus % perCycle == 0L
        ) {
            val cycleMs = perCycle * focusMs + (perCycle - 1) * timing.durationMs(PomodoroPhase.SHORT_BREAK) +
                timing.durationMs(PomodoroPhase.LONG_BREAK)
            val rounds = (nowMs - end + focusMs) / cycleMs
            if (rounds > 0) {
                current = current.copy(
                    endAtMs = end + rounds * cycleMs,
                    completedFocus = current.completedFocus + rounds * perCycle,
                    phaseNumber = current.phaseNumber + 2 * rounds * perCycle,
                )
                continue
            }
        }
        current = nextPhase(current, end, earned = true)
    }
    return current
}

private fun nextPhase(timer: PomodoroTimer, boundary: Long, earned: Boolean): PomodoroTimer {
    val focused = timer.phase == PomodoroPhase.FOCUS && earned
    val completed = timer.completedFocus + if (focused) 1 else 0
    val timing = timer.timing
    val phase = when {
        timer.phase != PomodoroPhase.FOCUS -> PomodoroPhase.FOCUS
        focused && completed % timing.longBreakEvery == 0L -> PomodoroPhase.LONG_BREAK
        else -> PomodoroPhase.SHORT_BREAK
    }
    val remaining = timing.durationMs(phase)
    val autoStart = if (phase == PomodoroPhase.FOCUS) timing.autoStartFocus else timing.autoStartBreak
    return timer.copy(
        phase = phase,
        phaseNumber = timer.phaseNumber + 1,
        completedFocus = completed,
        status = if (autoStart) PomodoroStatus.RUNNING else PomodoroStatus.READY,
        remainingMs = remaining,
        endAtMs = (boundary + remaining).takeIf { autoStart },
    )
}

private val pomodoroJson = Json { encodeDefaults = true }

fun applyPomodoroCommand(snapshot: PomodoroSnapshot, command: JsonObject): PomodoroSnapshot? {
    return when (command.string("kind")) {
        "settings" -> {
            val patch = command["patch"] as? JsonObject ?: return null
            val previous = pomodoroJson.encodeToJsonElement(snapshot.settings).jsonObject
            val settings = try {
                pomodoroJson.decodeFromJsonElement<PomodoroSettings>(JsonObject(previous + patch))
            } catch (_: SerializationException) {
                return null
            }
            snapshot.copy(settings = settings, timer = snapshot.timer.takeIf { settings.enabled })
        }
        "queue" -> {
            if (command.primitive("expected_version")?.intOrNull != snapshot.queueVersion) return null
            val ids = command["task_ids"] as? JsonArray ?: return null
            val queue = ids.map { (it as? JsonPrimitive)?.contentOrNull ?: return null }
            snapshot.copy(queue = queue, queueVersion = snapshot.queueVersion + 1)
        }
        "start" -> {
            if (!snapshot.settings.enabled || snapshot.timer != null) return null
            val id = command.string("timer_id") ?: return null
            val at = command.primitive("at_ms")?.longOrNull ?: return null
            val device = command.string("device_id") ?: return null
            val timing = snapshot.settings.timing()
            val duration = timing.durationMs(PomodoroPhase.FOCUS)
            snapshot.copy(timer = PomodoroTimer(
                id = id, version = 1, phase = PomodoroPhase.FOCUS, phaseNumber = 1,
                status = PomodoroStatus.RUNNING, endAtMs = at + duration, remainingMs = duration,
                completedFocus = 0, taskId = command.string("task_id"), deviceId = device, timing = timing,
            ))
        }
        "control" -> controlPomodoroTimer(snapshot, command)
        else -> null
    }
}

private fun controlPomodoroTimer(snapshot: PomodoroSnapshot, command: JsonObject): PomodoroSnapshot? {
    val at = command.primitive("at_ms")?.longOrNull ?: return null
    val timer = projectPomodoroTimer(snapshot.timer, at) ?: return null
    if (timer.id != command.string("timer_id") ||
        timer.version != command.primitive("expected_version")?.intOrNull ||
        timer.phaseNumber != command.primitive("phase_number")?.longOrNull
    ) return null

    val action = command.string("action") ?: return null
    val canChooseTask = action == "resume" && timer.status == PomodoroStatus.READY && timer.phase == PomodoroPhase.FOCUS
    if ("task_id" in command && !canChooseTask) return null

    val updated = when (action) {
        "resume" -> {
            if (timer.status == PomodoroStatus.RUNNING) return null
            timer.copy(
                status = PomodoroStatus.RUNNING,
                endAtMs = at + timer.remainingMs,
                deviceId = command.string("device_id") ?: return null,
                taskId = if ("task_id" in command) command.string("task_id") else timer.taskId,
            )
        }
        "pause" -> {
            if (timer.status != PomodoroStatus.RUNNING) return null
            timer.copy(status = PomodoroStatus.PAUSED, endAtMs = null, remainingMs = pomodoroRemainingMs(timer, at))
        }
        "reset" -> timer.copy(
            status = PomodoroStatus.READY,
            endAtMs = null,
            remainingMs = timer.timing.durationMs(timer.phase),
        )
        "skip" -> nextPhase(timer, at, earned = false)
        "stop" -> return snapshot.copy(timer = null)
        else -> return null
    }
    return snapshot.copy(timer = updated.copy(version = timer.version + 1))
}

private fun JsonObject.primitive(key: String): JsonPrimitive? = this[key] as? JsonPrimitive
private fun JsonObject.string(key: String): String? = primitive(key)?.contentOrNull
