package ho.fem.app

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationManager
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.SystemClock
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.repeatOnLifecycle
import ho.fem.designsystem.Femho
import ho.fem.designsystem.FemhoShape
import ho.fem.designsystem.FemhoSize
import ho.fem.designsystem.FemhoText
import ho.fem.model.PomodoroAction
import ho.fem.model.PomodoroMode
import ho.fem.model.PomodoroPhase
import ho.fem.model.PomodoroSettings
import ho.fem.model.PomodoroStatus
import ho.fem.model.PomodoroTimer
import ho.fem.model.Task
import ho.fem.model.TaskStatus
import ho.fem.model.pomodoroRemainingMs
import ho.fem.model.projectPomodoroTimer
import java.util.Locale
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.buildJsonObject

@Composable
internal fun PomodoroSyncEffect(model: AppViewModel, signedIn: Boolean, timerOpened: Boolean) {
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(model, lifecycle, signedIn, timerOpened) {
        if (!signedIn) return@LaunchedEffect
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            model.refreshPomodoro()
            // Mentre es mira el rellotge, cal recuperar aviat les ordres de l'altre aparell.
            while (isActive) {
                delay(if (timerOpened) 5_000 else 30_000)
                model.refreshPomodoro()
            }
        }
    }
}

@Composable
internal fun PomodoroToolbarAction(onClick: () -> Unit) {
    IconButton(onClick, Modifier.testTag("open-pomodoro")) {
        Image(painterResource(R.drawable.pomodoro), stringResource(R.string.pomodoro_title), Modifier.size(26.dp),
            colorFilter = ColorFilter.tint(Femho.colors.inkSoft))
    }
}

@Composable
internal fun PomodoroHeader(
    title: String,
    backLabel: String,
    settingsLabel: String?,
    onBack: () -> Unit,
    onSettings: () -> Unit,
) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        IconButton(
            onClick = onBack,
            modifier = Modifier.size(FemhoSize.touch).semantics { contentDescription = backLabel },
        ) {
            Text("‹", color = Femho.colors.ink, fontSize = FemhoText.wordmark)
        }
        Text(
            title,
            modifier = Modifier.weight(1f),
            fontSize = FemhoText.columnTitle,
            fontWeight = FontWeight.Bold,
            color = Femho.colors.ink,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        if (settingsLabel != null) {
            Box(
                modifier = Modifier.heightIn(min = FemhoSize.touch)
                    .testTag("pomodoro-settings")
                    .clickable(role = Role.Button, onClick = onSettings)
                    .padding(horizontal = 8.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(settingsLabel, color = Femho.colors.ink, fontSize = FemhoText.body)
            }
        }
    }
}

@Composable
internal fun PomodoroHost(model: AppViewModel, onBack: () -> Unit) {
    val local by model.pomodoro.collectAsStateWithLifecycle()
    val tasks by model.tasks.collectAsStateWithLifecycle()
    val snapshot = local.snapshot
    val settings = snapshot.settings
    val now = rememberPomodoroNow(local.clockOffsetMs, snapshot.timer?.status == PomodoroStatus.RUNNING)
    val timer = projectPomodoroTimer(snapshot.timer, now)
    val phase = timer?.phase ?: PomodoroPhase.FOCUS
    val running = timer?.status == PomodoroStatus.RUNNING
    val ready = timer == null || timer.status == PomodoroStatus.READY
    val choosingTask = ready && phase == PomodoroPhase.FOCUS
    val remaining = timer?.let { pomodoroRemainingMs(it, now) } ?: settings.focusMinutes * 60_000L
    val available = tasks.filter { it.status == TaskStatus.TODO || it.status == TaskStatus.DOING }.associateBy { it.id }
    val queue = snapshot.queue.mapNotNull(available::get)
    val candidates = tasks.filter { it.status == TaskStatus.TODO && it.id !in snapshot.queue }
    val activeTask = timer?.taskId?.let(available::get)

    var showSettings by rememberSaveable { mutableStateOf(false) }
    var picking by rememberSaveable { mutableStateOf(false) }
    var adding by rememberSaveable { mutableStateOf(false) }
    var chosenTaskId by rememberSaveable(timer?.id) { mutableStateOf<String?>(null) }
    var taskChosen by rememberSaveable(timer?.id) { mutableStateOf(false) }
    val selected = if (taskChosen) chosenTaskId?.let(available::get) else activeTask
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp).testTag("pomodoro-screen"),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        PomodoroHeader(
            title = stringResource(R.string.pomodoro_title),
            backLabel = stringResource(R.string.nav_back),
            settingsLabel = if (settings.enabled) stringResource(R.string.nav_settings) else null,
            onBack = onBack,
            onSettings = { showSettings = true },
        )
        if (settings.enabled) {
            PomodoroClock(settings, phase, timer, remaining)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.Center) {
                Button(
                    onClick = {
                        if (running) model.controlPomodoro(PomodoroAction.PAUSE)
                        else model.startPomodoro(selected?.id)
                    },
                    modifier = Modifier.testTag("pomodoro-primary"),
                    colors = ButtonDefaults.buttonColors(containerColor = Femho.colors.plouBlue, contentColor = Femho.onBrand),
                ) {
                    Text(stringResource(when {
                        running -> R.string.pomodoro_pause
                        ready -> R.string.pomodoro_start
                        else -> R.string.pomodoro_resume
                    }))
                }
                if (timer != null) {
                    PomodoroControlButton(R.string.pomodoro_reset, "reset") { model.controlPomodoro(PomodoroAction.RESET) }
                    PomodoroControlButton(R.string.pomodoro_skip, "skip") { model.controlPomodoro(PomodoroAction.SKIP) }
                    PomodoroControlButton(R.string.pomodoro_stop, "stop") { model.controlPomodoro(PomodoroAction.STOP) }
                }
            }
            if (choosingTask) {
                TextButton({ picking = true }, Modifier.testTag("pomodoro-choose-task"), colors = pomodoroTextButtons()) {
                    Text(selected?.title ?: stringResource(R.string.pomodoro_choosetask))
                }
            } else if (activeTask != null) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(activeTask.title, Modifier.weight(1f), color = Femho.colors.ink, fontWeight = FontWeight.SemiBold)
                    TextButton({ model.move(activeTask, TaskStatus.DONE) }, Modifier.testTag("pomodoro-complete-task"), colors = pomodoroTextButtons()) {
                        Text(stringResource(R.string.pomodoro_done))
                    }
                }
            }

            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(R.string.pomodoro_queue), Modifier.weight(1f), color = Femho.colors.ink, fontWeight = FontWeight.Bold)
                TextButton({ adding = true }, Modifier.testTag("pomodoro-add-task"), colors = pomodoroTextButtons()) {
                    Text(stringResource(R.string.pomodoro_addtask))
                }
            }
            if (queue.isEmpty()) Text(stringResource(R.string.pomodoro_emptyqueue), color = Femho.colors.inkSoft)
            for ((index, task) in queue.withIndex()) {
                PomodoroQueueRow(
                    task = task,
                    selected = selected?.id == task.id && choosingTask,
                    onSelect = if (choosingTask) ({ chosenTaskId = task.id; taskChosen = true }) else null,
                    onUp = queue.getOrNull(index - 1)?.let { neighbour ->
                        { model.updatePomodoroQueue { it.swapPomodoroItems(task.id, neighbour.id) } }
                    },
                    onDown = queue.getOrNull(index + 1)?.let { neighbour ->
                        { model.updatePomodoroQueue { it.swapPomodoroItems(task.id, neighbour.id) } }
                    },
                    onRemove = {
                        if (chosenTaskId == task.id) chosenTaskId = null
                        model.updatePomodoroQueue { it - task.id }
                    },
                )
            }
        }
    }

    if (settings.enabled && showSettings) PomodoroSettingsDialog(settings, onDismiss = { showSettings = false }) {
        showSettings = false
        model.updatePomodoroSettings(it)
    }
    if (settings.enabled && picking) PomodoroTaskPicker(
        title = stringResource(R.string.pomodoro_choosetask), tasks = queue, allowNone = true,
        onDismiss = { picking = false },
    ) {
        chosenTaskId = it
        taskChosen = true
        picking = false
    }
    if (settings.enabled && adding) PomodoroTaskPicker(
        title = stringResource(R.string.pomodoro_addtask), tasks = candidates, allowNone = false,
        onDismiss = { adding = false },
    ) { id ->
        adding = false
        if (id != null) model.updatePomodoroQueue { it + id }
    }
}

@Composable
private fun rememberPomodoroNow(offsetMs: Long, running: Boolean): Long {
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val now by produceState(System.currentTimeMillis() + offsetMs, offsetMs, running, lifecycle) {
        val epoch = System.currentTimeMillis() + offsetMs
        val measured = SystemClock.elapsedRealtime()
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            do {
                value = epoch + (SystemClock.elapsedRealtime() - measured)
                if (running) delay(250)
            } while (running && isActive)
        }
    }
    return now
}

@Composable
private fun PomodoroClock(settings: PomodoroSettings, phase: PomodoroPhase, timer: PomodoroTimer?, remainingMs: Long) {
    val shape = RoundedCornerShape(FemhoShape.column)
    val seconds = (remainingMs + 999) / 1_000
    val timing = timer?.timing
    val durationMs = 60_000L * when (phase) {
        PomodoroPhase.FOCUS -> timing?.focusMinutes ?: settings.focusMinutes
        PomodoroPhase.SHORT_BREAK -> timing?.shortBreakMinutes ?: settings.shortBreakMinutes
        PomodoroPhase.LONG_BREAK -> timing?.longBreakMinutes ?: settings.longBreakMinutes
    }
    val progress = (1f - remainingMs.toFloat() / durationMs).coerceIn(0f, 1f)
    val track = Femho.colors.cardBorder
    val accent = Femho.colors.plouBlue
    Column(
        Modifier.fillMaxWidth().background(Femho.colors.cardBg, shape).border(1.dp, Femho.colors.cardBorder, shape)
            .padding(20.dp).testTag("pomodoro-clock"),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(stringResource(pomodoroPhaseName(phase)), color = Femho.colors.ink, fontWeight = FontWeight.Bold,
            modifier = Modifier.testTag("pomodoro-phase"))
        Box(Modifier.size(216.dp), contentAlignment = Alignment.Center) {
            Canvas(Modifier.matchParentSize()) {
                val stroke = 5.dp.toPx()
                drawCircle(track, radius = (size.minDimension - stroke) / 2, style = Stroke(stroke))
                drawArc(accent, startAngle = -90f, sweepAngle = 360f * progress, useCenter = false,
                    topLeft = Offset(stroke / 2, stroke / 2), size = Size(size.width - stroke, size.height - stroke),
                    style = Stroke(stroke, cap = StrokeCap.Round))
            }
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                if (settings.mode == PomodoroMode.PLAYFUL) {
                    Image(painterResource(R.drawable.pomodoro), null, Modifier.size(40.dp).testTag("pomodoro-tomato"),
                        colorFilter = ColorFilter.tint(Femho.colors.ink))
                }
                Text("%02d:%02d".format(Locale.ROOT, seconds / 60, seconds % 60), color = Femho.colors.ink,
                    fontSize = 42.sp, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.testTag("pomodoro-countdown"))
            }
        }
        val status = when (timer?.status) {
            null, PomodoroStatus.READY -> R.string.pomodoro_ready
            PomodoroStatus.PAUSED -> R.string.pomodoro_paused
            PomodoroStatus.RUNNING -> null
        }
        if (status != null) Text(stringResource(status), color = Femho.colors.inkSoft)
        Text(stringResource(R.string.pomodoro_completed).replace("{count}", (timer?.completedFocus ?: 0).toString()),
            color = Femho.colors.inkSoft, fontSize = FemhoText.meta)
    }
}

@Composable
private fun PomodoroQueueRow(task: Task, selected: Boolean, onSelect: (() -> Unit)?, onUp: (() -> Unit)?, onDown: (() -> Unit)?, onRemove: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().background(if (selected) Femho.colors.tagBg else Femho.colors.cardBg,
            RoundedCornerShape(FemhoShape.card)).padding(start = 12.dp).testTag("pomodoro-queue-${task.id}"),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        val select = Modifier.weight(1f).heightIn(min = FemhoSize.touch).testTag("pomodoro-select-${task.id}")
        Box(if (onSelect == null) select else select.clickable(role = Role.Button, onClick = onSelect),
            contentAlignment = Alignment.CenterStart) {
            Text(task.title, color = Femho.colors.ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        PomodoroQueueAction("↑", R.string.pomodoro_moveup, "pomodoro-up-${task.id}", onUp)
        PomodoroQueueAction("↓", R.string.pomodoro_movedown, "pomodoro-down-${task.id}", onDown)
        PomodoroQueueAction("×", R.string.pomodoro_removetask, "pomodoro-remove-${task.id}", onRemove)
    }
}

@Composable
private fun PomodoroQueueAction(glyph: String, label: Int, tag: String, action: (() -> Unit)?) {
    val name = stringResource(label)
    IconButton(onClick = { action?.invoke() }, enabled = action != null,
        modifier = Modifier.testTag(tag).semantics { contentDescription = name }) {
        Text(glyph, color = if (action == null) Femho.colors.inkFaint else Femho.colors.ink, fontSize = 20.sp)
    }
}

@Composable
private fun PomodoroControlButton(label: Int, tag: String, action: () -> Unit) {
    TextButton(action, Modifier.testTag("pomodoro-$tag"), colors = pomodoroTextButtons()) { Text(stringResource(label)) }
}

@Composable
private fun pomodoroTextButtons() = ButtonDefaults.textButtonColors(contentColor = Femho.colors.ink)

private fun List<String>.swapPomodoroItems(first: String, second: String): List<String> {
    val from = indexOf(first)
    val to = indexOf(second)
    if (from < 0 || to < 0) return this
    return toMutableList().apply { this[from] = second; this[to] = first }
}

@Composable
private fun PomodoroTaskPicker(title: String, tasks: List<Task>, allowNone: Boolean, onDismiss: () -> Unit, onPick: (String?) -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Femho.colors.panelBg,
        titleContentColor = Femho.colors.ink,
        title = { Text(title) },
        text = {
            LazyColumn(Modifier.heightIn(max = 320.dp)) {
                if (allowNone) item {
                    TextButton({ onPick(null) }, Modifier.testTag("pomodoro-pick-none"), colors = pomodoroTextButtons()) {
                        Text(stringResource(R.string.pomodoro_notask))
                    }
                }
                if (!allowNone && tasks.isEmpty()) item { Text(stringResource(R.string.pomodoro_nocandidates), color = Femho.colors.inkSoft) }
                items(tasks, key = { it.id }) { task ->
                    TextButton({ onPick(task.id) }, Modifier.fillMaxWidth().testTag("pomodoro-pick-${task.id}"), colors = pomodoroTextButtons()) {
                        Text(task.title)
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onDismiss, colors = pomodoroTextButtons()) { Text(stringResource(R.string.pomodoro_close)) }
        },
    )
}

@Composable
private fun PomodoroSettingsDialog(settings: PomodoroSettings, onDismiss: () -> Unit, onSave: (JsonObject) -> Unit) {
    var focus by rememberSaveable { mutableStateOf(settings.focusMinutes.toString()) }
    var shortBreak by rememberSaveable { mutableStateOf(settings.shortBreakMinutes.toString()) }
    var longBreak by rememberSaveable { mutableStateOf(settings.longBreakMinutes.toString()) }
    var cycle by rememberSaveable { mutableStateOf(settings.longBreakEvery.toString()) }
    var mode by rememberSaveable { mutableStateOf(settings.mode.name) }
    var autoFocus by rememberSaveable { mutableStateOf(settings.autoStartFocus) }
    var autoBreak by rememberSaveable { mutableStateOf(settings.autoStartBreak) }
    var sound by rememberSaveable { mutableStateOf(settings.sound) }
    val minutes = listOf(focus.toIntOrNull(), shortBreak.toIntOrNull(), longBreak.toIntOrNull(), cycle.toIntOrNull())
    val valid = minutes.take(3).all { it != null && it in 1..180 } && minutes.last()?.let { it in 1..20 } == true
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Femho.colors.panelBg,
        titleContentColor = Femho.colors.ink,
        title = { Text(stringResource(R.string.nav_settings)) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(stringResource(R.string.pomodoro_mode), color = Femho.colors.ink, fontWeight = FontWeight.Bold)
                FlowRow {
                    for ((option, label) in listOf(PomodoroMode.PLAYFUL to R.string.pomodoro_playful, PomodoroMode.SERIOUS to R.string.pomodoro_serious)) {
                        TextButton({ mode = option.name }, Modifier.testTag("pomodoro-mode-${option.name.lowercase()}"), colors = pomodoroTextButtons()) {
                            Text(stringResource(label), fontWeight = if (mode == option.name) FontWeight.Bold else FontWeight.Normal)
                        }
                    }
                }
                PomodoroNumber(focus, { focus = it }, R.string.pomodoro_focusminutes, "focus")
                PomodoroNumber(shortBreak, { shortBreak = it }, R.string.pomodoro_shortbreakminutes, "short")
                PomodoroNumber(longBreak, { longBreak = it }, R.string.pomodoro_longbreakminutes, "long")
                PomodoroNumber(cycle, { cycle = it }, R.string.pomodoro_longbreakevery, "cycle")
                PomodoroSwitch(R.string.pomodoro_autostartfocus, autoFocus, "auto-focus") { autoFocus = it }
                PomodoroSwitch(R.string.pomodoro_autostartbreak, autoBreak, "auto-break") { autoBreak = it }
                PomodoroSwitch(R.string.pomodoro_sound, sound, "sound") { sound = it }
                if (sound) PomodoroPermissions()
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    val patch = buildJsonObject {
                        if (minutes[0] != settings.focusMinutes) put("focus_minutes", minutes[0])
                        if (minutes[1] != settings.shortBreakMinutes) put("short_break_minutes", minutes[1])
                        if (minutes[2] != settings.longBreakMinutes) put("long_break_minutes", minutes[2])
                        if (minutes[3] != settings.longBreakEvery) put("long_break_every", minutes[3])
                        if (mode != settings.mode.name) put("mode", mode.lowercase(Locale.ROOT))
                        if (autoFocus != settings.autoStartFocus) put("auto_start_focus", autoFocus)
                        if (autoBreak != settings.autoStartBreak) put("auto_start_break", autoBreak)
                        if (sound != settings.sound) put("sound", sound)
                    }
                    if (patch.isEmpty()) onDismiss() else onSave(patch)
                },
                enabled = valid,
                modifier = Modifier.testTag("pomodoro-settings-save"),
                colors = pomodoroTextButtons(),
            ) { Text(stringResource(R.string.nav_save)) }
        },
        dismissButton = { TextButton(onDismiss, colors = pomodoroTextButtons()) { Text(stringResource(R.string.nav_cancel)) } },
    )
}

@Composable
private fun PomodoroNumber(value: String, onChange: (String) -> Unit, label: Int, tag: String) {
    OutlinedTextField(value, { if (it.all(Char::isDigit) && it.length <= 3) onChange(it) },
        modifier = Modifier.fillMaxWidth().testTag("pomodoro-minutes-$tag"), singleLine = true,
        label = { Text(stringResource(label)) }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
}

@Composable
private fun PomodoroSwitch(label: Int, checked: Boolean, tag: String, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        val title = stringResource(label)
        Text(title, Modifier.weight(1f), color = Femho.colors.ink)
        Switch(checked, onChange, Modifier.testTag("pomodoro-$tag").semantics { contentDescription = title })
    }
}

@Composable
private fun PomodoroPermissions() {
    val context = LocalContext.current
    var notified by rememberSaveable { mutableStateOf(false) }
    var exact by rememberSaveable { mutableStateOf(false) }
    fun read() {
        notified = context.getSystemService(NotificationManager::class.java).areNotificationsEnabled()
        exact = context.getSystemService(AlarmManager::class.java).canUseExactPomodoroAlarm()
    }
    LifecycleResumeEffect(context) {
        read()
        onPauseOrDispose { }
    }
    val request = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { read() }
    Text(stringResource(R.string.pomodoro_backgroundsoundhint), color = Femho.colors.inkSoft, fontSize = FemhoText.meta)
    if (!notified && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        TextButton({ request.launch(Manifest.permission.POST_NOTIFICATIONS) }, colors = pomodoroTextButtons()) {
            Text(stringResource(R.string.pomodoro_allownotifications))
        }
    }
    if (!exact && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        TextButton({
            context.startActivity(Intent(android.provider.Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:${context.packageName}")))
        }, colors = pomodoroTextButtons()) { Text(stringResource(R.string.pomodoro_allowexactalarms)) }
    }
}
