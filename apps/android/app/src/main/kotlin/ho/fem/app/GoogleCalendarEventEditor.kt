package ho.fem.app

import android.app.DatePickerDialog
import android.app.TimePickerDialog
import android.text.format.DateFormat
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ho.fem.designsystem.Femho
import ho.fem.designsystem.FemhoText
import ho.fem.model.Calendar
import ho.fem.model.EventOccurrence
import ho.fem.model.GoogleCalendarChange
import ho.fem.model.GoogleCalendarDates
import ho.fem.model.GoogleCalendarDraft
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.UUID

@Composable
internal fun GoogleCalendarEventEditor(
    model: AppViewModel,
    date: LocalDate,
    zone: ZoneId,
    calendars: List<Calendar>,
    scopeNames: Map<String, String>,
    event: EventOccurrence?,
    onClose: () -> Unit,
    onQueued: () -> Unit,
) {
    val eventZone = remember(event?.timezone, zone) { runCatching { ZoneId.of(event?.timezone ?: zone.id) }.getOrDefault(zone) }
    val originalStart = event?.startsAt?.let(::parseGoogleInstant)
    val originalEnd = event?.endsAt?.let(::parseGoogleInstant)
    val initialZone = if (event?.allDay == true) ZoneOffset.UTC else eventZone
    val draftId = remember(event?.eventId) { event?.eventId ?: UUID.randomUUID().toString() }
    var calendarId by remember { mutableStateOf(event?.calendarId ?: calendars.firstOrNull()?.id.orEmpty()) }
    var summary by remember { mutableStateOf(event?.summary.orEmpty()) }
    var description by remember { mutableStateOf(event?.description.orEmpty()) }
    var location by remember { mutableStateOf(event?.location.orEmpty()) }
    var allDay by remember { mutableStateOf(event?.allDay == true) }
    var from by remember { mutableStateOf(originalStart?.atZone(initialZone)?.toLocalDate() ?: date) }
    var to by remember {
        mutableStateOf(originalEnd?.atZone(initialZone)?.toLocalDate()?.minusDays(if (allDay) 1 else 0) ?: date)
    }
    var fromTime by remember { mutableStateOf(originalStart?.takeUnless { allDay }?.atZone(eventZone)?.toLocalTime() ?: LocalTime.of(9, 0)) }
    var toTime by remember { mutableStateOf(originalEnd?.takeUnless { allDay }?.atZone(eventZone)?.toLocalTime() ?: LocalTime.of(10, 0)) }
    var saving by remember { mutableStateOf(false) }
    var validationError by remember { mutableStateOf(false) }
    var saveFailed by remember { mutableStateOf(false) }
    var confirm by remember { mutableStateOf<GoogleCalendarDraft?>(null) }

    fun calendarName(calendar: Calendar): String = scopeNames[calendar.scopeId]?.let { scope ->
        "${calendar.name} · $scope"
    } ?: calendar.name

    fun save(draft: GoogleCalendarDraft) {
        saving = true
        saveFailed = false
        model.queueGoogleCalendarChange(
            calendarId = calendarId,
            eventId = draftId,
            baseVersion = event?.version ?: 0,
            action = if (event == null) "create" else "update",
            draft = draft,
            notifyGuests = event?.googleHasGuests == true,
            fields = event?.let(draft::changedFields),
            onQueued = onQueued,
            onFailed = { saving = false; saveFailed = true },
        )
    }

    fun submit() {
        val start = if (allDay) GoogleCalendarDates.allDay(from) else GoogleCalendarDates.timed(from, fromTime, eventZone, originalStart)?.toString()
        val end = if (allDay) GoogleCalendarDates.allDay(to.plusDays(1)) else GoogleCalendarDates.timed(to, toTime, eventZone, originalEnd)?.toString()
        val startsAt = start?.let(::parseGoogleInstant)
        val endsAt = end?.let(::parseGoogleInstant)
        validationError = summary.isBlank() || calendarId.isEmpty() || startsAt == null || endsAt == null || !endsAt.isAfter(startsAt)
        if (validationError || start == null || end == null) return
        val draft = GoogleCalendarDraft(summary.trim(), description, location, start, end, allDay, eventZone.id)
        if (event != null && draft.changedFields(event).isEmpty()) return onClose()
        if (event?.googleHasGuests == true) confirm = draft else save(draft)
    }

    AlertDialog(
        onDismissRequest = { if (!saving) onClose() },
        modifier = Modifier.testTag("google-calendar-editor"),
        title = { Text(stringResource(if (event == null) R.string.calendar_google_create else R.string.calendar_google_edit)) },
        text = {
            Column(
                verticalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.verticalScroll(rememberScrollState()),
            ) {
                if (event == null && calendars.isNotEmpty()) {
                    val chosen = calendars.find { it.id == calendarId }
                    GoogleCalendarPicker(
                        R.string.settings_googlecalendar_calendar,
                        chosen?.let(::calendarName) ?: stringResource(R.string.settings_googlecalendar_choose),
                        calendars,
                        ::calendarName,
                        enabled = !saving,
                    ) { calendarId = it.id }
                }
                GoogleEventField(summary, R.string.calendar_google_summary, !saving) { summary = it }
                GoogleEventField(description, R.string.calendar_google_description, !saving, singleLine = false) { description = it }
                GoogleEventField(location, R.string.calendar_google_location, !saving) { location = it }
                GoogleCalendarCheckbox(stringResource(R.string.calendar_google_allday), allDay, !saving) { allDay = it }
                GoogleDateTimePicker(R.string.calendar_google_start, from, fromTime, allDay, !saving, {
                    from = it
                    if (to < from) to = from
                }) { fromTime = it }
                GoogleDateTimePicker(R.string.calendar_google_end, to, toTime, allDay, !saving, { to = it }) { toTime = it }
                if (validationError) Text(stringResource(R.string.calendar_google_invalid), color = Femho.colors.dangerText)
                if (saveFailed) Text(stringResource(R.string.calendar_google_failed), color = Femho.colors.dangerText)
            }
        },
        confirmButton = {
            Button(enabled = !saving, onClick = ::submit, modifier = Modifier.testTag("google-calendar-save-event")) {
                Text(stringResource(R.string.nav_save))
            }
        },
        dismissButton = { TextButton(enabled = !saving, onClick = onClose) { Text(stringResource(R.string.nav_cancel)) } },
    )
    confirm?.let { draft ->
        GoogleCalendarConfirm(R.string.calendar_google_guestnotice, R.string.nav_save, { confirm = null }) {
            confirm = null
            save(draft)
        }
    }
}

private fun parseGoogleInstant(value: String): Instant? = runCatching { Instant.parse(value) }.getOrNull()

@Composable
private fun GoogleEventField(value: String, label: Int, enabled: Boolean, singleLine: Boolean = true, onChange: (String) -> Unit) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        singleLine = singleLine,
        label = { Text(stringResource(label)) },
        enabled = enabled,
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun GoogleDateTimePicker(label: Int, date: LocalDate, time: LocalTime, allDay: Boolean, enabled: Boolean, onDate: (LocalDate) -> Unit, onTime: (LocalTime) -> Unit) {
    val context = LocalContext.current
    val locale = androidx.compose.ui.platform.LocalConfiguration.current.locales[0]
    val dateFormat = DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale)
    val timeFormat = DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).withLocale(locale)
    Column {
        Text(stringResource(label), color = Femho.colors.inkSoft, fontSize = FemhoText.meta)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(enabled = enabled, onClick = {
                DatePickerDialog(context, { _, year, month, day -> onDate(LocalDate.of(year, month + 1, day)) }, date.year, date.monthValue - 1, date.dayOfMonth).show()
            }) { Text(date.format(dateFormat)) }
            if (!allDay) {
                OutlinedButton(enabled = enabled, onClick = {
                    TimePickerDialog(context, { _, hour, minute -> onTime(LocalTime.of(hour, minute)) }, time.hour, time.minute, DateFormat.is24HourFormat(context)).show()
                }) { Text(time.format(timeFormat)) }
            }
        }
    }
}

@Composable
internal fun GoogleCalendarConfirm(message: Int, action: Int, onDismiss: () -> Unit, onConfirm: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        text = { Text(stringResource(message)) },
        confirmButton = { TextButton(onClick = onConfirm) { Text(stringResource(action)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.nav_cancel)) } },
    )
}

@Composable
internal fun GoogleCalendarChangesPanel(model: AppViewModel, enabled: Boolean, onSynced: () -> Unit) {
    val device by model.deviceGoogleCalendarChanges.collectAsStateWithLifecycle()
    var remote by remember { mutableStateOf(emptyList<GoogleCalendarChange>()) }
    var lastDevice by remember { mutableStateOf(emptySet<String>()) }
    var reload by remember { mutableIntStateOf(0) }
    var expanded by remember { mutableStateOf(false) }
    var failed by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var retry by remember { mutableStateOf<GoogleCalendarChange?>(null) }
    val synced by rememberUpdatedState(onSynced)
    val coroutine = rememberCoroutineScope()
    val awaitingProjection = setOf("pending", "sending", "sent")

    LaunchedEffect(enabled, device, reload) {
        if (!enabled && device.isEmpty() && lastDevice.isEmpty()) return@LaunchedEffect
        val devicePending = device.filter { it.status == "device_pending" }.mapTo(mutableSetOf()) { it.id }
        var delivered = (lastDevice - devicePending).isNotEmpty()
        lastDevice = devicePending
        while (true) {
            try {
                val next = model.googleCalendarApi().googleCalendarChanges()
                val finished = remote.any { row -> row.status in awaitingProjection && next.none { it.id == row.id } }
                remote = next
                failed = false
                if (finished || delivered) synced()
                delivered = false
                if (next.none { it.status in awaitingProjection }) break
                delay(3500)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                if (expanded) failed = true
                if (devicePending.isEmpty() && remote.none { it.status in awaitingProjection }) break
                delay(6000)
            }
        }
    }

    fun resolve(change: GoogleCalendarChange, reapply: Boolean) {
        busy = true
        failed = false
        coroutine.launch {
            try {
                if (change.status == "device_failed") {
                    model.discardDeviceGoogleCalendarChange(change.id)
                } else if (reapply) {
                    model.googleCalendarApi().retryGoogleCalendarChange(change.id, change.errorCode == "guests_confirmation_required")
                } else {
                    model.googleCalendarApi().discardGoogleCalendarChange(change.id)
                }
                reload += 1
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                failed = true
            } finally {
                busy = false
            }
        }
    }

    val changes = (remote + device).distinctBy { it.id }
    if (changes.isEmpty() && !expanded) return
    Column(modifier = Modifier.testTag("google-calendar-changes")) {
        TextButton(onClick = { expanded = !expanded; if (expanded) reload += 1 }) {
            Text("${stringResource(R.string.calendar_google_changes)} · ${changes.size}")
        }
        if (expanded) {
            changes.forEach { change ->
                change.draft?.summary?.let { Text(it, fontWeight = FontWeight.SemiBold, color = Femho.colors.ink) }
                if (change.operation == "delete") Text(stringResource(R.string.nav_delete), color = Femho.colors.ink)
                val status = when (change.status) {
                    "device_pending" -> R.string.calendar_google_queued
                    "device_failed", "failed" -> R.string.calendar_google_failed
                    "conflict" -> R.string.calendar_google_conflict
                    "sending" -> R.string.calendar_google_sending
                    "sent" -> R.string.calendar_google_sent
                    else -> R.string.calendar_google_pending
                }
                Text(stringResource(status), color = Femho.colors.inkSoft, fontSize = FemhoText.meta)
                if (change.status == "failed" || change.status == "conflict") {
                    TextButton(enabled = !busy, onClick = { retry = change }) { Text(stringResource(R.string.calendar_google_retry)) }
                }
                if (change.status in listOf("pending", "failed", "conflict", "device_failed")) {
                    TextButton(enabled = !busy, onClick = { resolve(change, false) }) { Text(stringResource(R.string.calendar_google_discard)) }
                }
            }
            if (failed) Text(stringResource(R.string.settings_googlecalendar_error), color = Femho.colors.dangerText)
        }
    }
    retry?.let { change ->
        val message = if (change.errorCode == "guests_confirmation_required") R.string.calendar_google_guestnotice else R.string.calendar_google_reapplyconfirm
        GoogleCalendarConfirm(message, R.string.calendar_google_retry, { retry = null }) {
            retry = null
            resolve(change, true)
        }
    }
}
