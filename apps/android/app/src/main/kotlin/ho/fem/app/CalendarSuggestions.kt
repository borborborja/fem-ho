package ho.fem.app

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import ho.fem.designsystem.CalendarCardVariant
import ho.fem.designsystem.Femho
import ho.fem.designsystem.FemhoText
import ho.fem.designsystem.Pill
import ho.fem.designsystem.TaskCard
import ho.fem.designsystem.taskCardSurface
import ho.fem.model.CalendarTaskStart
import ho.fem.model.CalendarTaskSuggestion
import ho.fem.model.CalendarTaskSuggestions
import ho.fem.model.Task
import ho.fem.model.TaskStatus
import ho.fem.model.TaskType
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive

private val calendarTime = DateTimeFormatter.ofPattern("HH:mm")

@Composable
internal fun CalendarSuggestionsSyncEffect(model: AppViewModel) {
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(lifecycle, model) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            while (isActive) {
                model.refreshCalendarSuggestions()
                delay(30_000)
            }
        }
    }
}

@Composable
internal fun rememberCalendarSuggestionTime(snapshot: CalendarTaskSuggestions): Instant {
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    var time by remember(snapshot) { mutableStateOf(Instant.now()) }
    LaunchedEffect(lifecycle, snapshot) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            while (isActive) {
                time = Instant.now()
                val next = snapshot.nextBoundary(time) ?: break
                delay(Duration.between(time, next).toMillis().coerceAtLeast(1))
            }
        }
    }
    return time
}

@Composable
internal fun CalendarSuggestionCard(
    item: CalendarTaskSuggestion,
    status: TaskStatus,
    now: Instant,
    zone: ZoneId,
    advanceLabel: String,
    onStart: (CalendarTaskStart) -> Unit,
    onOpenTask: (() -> Unit)? = null,
) {
    val from = Instant.parse(item.startsAt).atZone(zone).format(calendarTime)
    val to = Instant.parse(item.endsAt).atZone(zone).format(calendarTime)
    val range = if (item.allDay) stringResource(R.string.calendarsuggestions_allday) else "$from–$to"
    val modifier = Modifier.fillMaxWidth().testTag("calendar-suggestion")
    if (status == TaskStatus.TODO) {
        TaskCard(
            title = item.title,
            modifier = modifier,
            time = range,
            onToggle = null,
            onOpen = onOpenTask,
            onAdvance = if (item.canStart) ({ onStart(CalendarTaskStart.NOW) }) else null,
            advanceLabel = advanceLabel,
            extraMetadata = {
                CalendarOriginBadge()
                Pill(item.calendarName)
            },
            calendar = CalendarCardVariant.TODO,
        )
        return
    }

    val startNow = stringResource(R.string.calendarsuggestions_startnow)
    val startPlanned = stringResource(R.string.calendarsuggestions_startplanned).replace("{time}", from)
    val buttonColors = ButtonDefaults.textButtonColors(contentColor = Femho.colors.ink)
    Column(
        modifier.taskCardSurface(CalendarCardVariant.DOING).padding(horizontal = 12.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(7.dp), verticalAlignment = Alignment.CenterVertically) {
            CalendarOriginBadge()
            Text(item.title, color = Femho.colors.ink, fontSize = FemhoText.body, fontWeight = FontWeight.SemiBold)
        }
        Text("$range · ${item.calendarName}", color = Femho.colors.inkSoft, fontSize = FemhoText.meta)
        Text(stringResource(R.string.calendarsuggestions_suggested), color = Femho.colors.inkSoft, fontSize = FemhoText.meta)
        if (item.canStart) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                TextButton(onClick = { onStart(CalendarTaskStart.NOW) }, colors = buttonColors,
                    modifier = Modifier.testTag("calendar-suggestion-start-now")) { Text(startNow) }
                if (item.permitsPlannedStart(now)) {
                    TextButton(onClick = { onStart(CalendarTaskStart.PLANNED) }, colors = buttonColors,
                        modifier = Modifier.testTag("calendar-suggestion-start-planned")) { Text(startPlanned) }
                }
            }
        }
    }
}

@Composable
internal fun CalendarSuggestionWidgetDialog(
    item: CalendarTaskSuggestion,
    now: Instant,
    zone: ZoneId,
    advanceLabel: String,
    onStart: (CalendarTaskStart) -> Unit,
    onOpenTask: (() -> Unit)?,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Femho.colors.dialogBg,
        text = {
            CalendarSuggestionCard(item, item.column(now), now, zone, advanceLabel, onStart, onOpenTask)
        },
        confirmButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.nav_close)) }
        },
        modifier = Modifier.testTag("widget-calendar-suggestion"),
    )
}

@Composable
internal fun CalendarSuggestionStartDialog(
    item: CalendarTaskSuggestion,
    start: CalendarTaskStart,
    zone: ZoneId,
    taskTypes: List<TaskType>,
    onConfirm: (String?) -> Unit,
    onDismiss: () -> Unit,
) {
    val from = Instant.parse(item.startsAt).atZone(zone).format(calendarTime)
    val action = if (start == CalendarTaskStart.NOW) stringResource(R.string.calendarsuggestions_startnow)
    else stringResource(R.string.calendarsuggestions_startplanned).replace("{time}", from)
    var selected by rememberSaveable(item.calendarId, item.uid, item.recurrenceId) { mutableStateOf<String?>(null) }
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Femho.colors.dialogBg,
        title = { Text(stringResource(if (item.requiresShareConfirmation) R.string.calendarsuggestions_sharetitle else R.string.calendarsuggestions_tasktype)) },
        text = {
            Column(Modifier.heightIn(max = 300.dp).verticalScroll(rememberScrollState()).selectableGroup(),
                verticalArrangement = Arrangement.spacedBy(4.dp)) {
                if (item.requiresShareConfirmation) Text(stringResource(R.string.calendarsuggestions_sharehint))
                if (item.requiresTaskType) {
                    if (item.requiresShareConfirmation) Text(stringResource(R.string.calendarsuggestions_tasktype))
                    taskTypes.forEach { type ->
                        Row(Modifier.fillMaxWidth().selectable(selected == type.id, role = Role.RadioButton) { selected = type.id }
                            .padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            RadioButton(selected == type.id, onClick = null)
                            Text(type.name)
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = { onConfirm(selected) }, enabled = !item.requiresTaskType || selected != null,
                modifier = Modifier.testTag("calendar-suggestion-confirm")) { Text(action) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.nav_cancel)) } },
    )
}

@Composable
internal fun CalendarOriginBadge() {
    val label = stringResource(R.string.calendarsuggestions_origin)
    val tint = Femho.colors.inkSoft
    Canvas(Modifier.size(16.dp).semantics { contentDescription = label }.testTag("calendar-task-origin")) {
        val unit = size.width / 16f
        val border = Stroke(1.4f * unit)
        drawRoundRect(tint, topLeft = Offset(2f * unit, 3f * unit), size = Size(12f * unit, 11f * unit),
            cornerRadius = CornerRadius(1.5f * unit), style = border)
        drawLine(tint, Offset(2f * unit, 6f * unit), Offset(14f * unit, 6f * unit), border.width)
        for (x in listOf(5f, 11f)) drawLine(tint, Offset(x * unit, unit), Offset(x * unit, 4f * unit), border.width)
        drawLine(tint, Offset(5.5f * unit, 10f * unit), Offset(7.5f * unit, 12f * unit), border.width)
        drawLine(tint, Offset(7.5f * unit, 12f * unit), Offset(11f * unit, 8.5f * unit), border.width)
    }
}

@Composable
internal fun CalendarTaskMetadata(task: Task) {
    CalendarOriginBadge()
    val starts = task.timeSummary?.openStartedAt.orEmpty().map(Instant::parse)
    if (task.status != TaskStatus.DOING || starts.isEmpty()) return
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val eink = Femho.isEink
    val logged = task.timeSummary?.seconds?.toLong() ?: 0L
    fun elapsedAt(instant: Instant) = logged + starts.sumOf { Duration.between(it, instant).seconds.coerceAtLeast(0) }
    var now by remember(starts) { mutableStateOf(Instant.now()) }
    LaunchedEffect(lifecycle, starts, logged, eink) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            while (isActive) {
                now = Instant.now()
                val millis = (60 - elapsedAt(now) % 60) * 1000 / starts.size
                delay(if (eink) millis.coerceAtLeast(1000) else 1000)
            }
        }
    }
    val seconds = elapsedAt(now)
    val minutes = seconds / 60
    val digits = "${(minutes % 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}"
    val elapsed = when {
        !eink -> if (minutes >= 60) "${minutes / 60}:$digits" else digits
        minutes >= 60 -> stringResource(R.string.duration_hoursminutes)
            .replace("{hours}", (minutes / 60).toString()).replace("{minutes}", (minutes % 60).toString())
        else -> stringResource(R.string.duration_minutes).replace("{minutes}", minutes.toString())
    }
    Text(elapsed, color = Femho.colors.inkSoft, fontSize = FemhoText.meta, modifier = Modifier.testTag("calendar-task-elapsed"))
}
