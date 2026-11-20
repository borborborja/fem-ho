package ho.fem.app

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
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
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import ho.fem.calendar.CalendarLabels
import ho.fem.calendar.MonthView
import ho.fem.designsystem.Femho
import ho.fem.model.Dates
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.YearMonth
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive

@Composable
internal fun rememberProfileToday(zone: ZoneId): LocalDate {
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    var today by remember(zone) { mutableStateOf(LocalDate.now(zone)) }
    LaunchedEffect(lifecycle, zone) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            while (isActive) {
                val now = Instant.now()
                today = now.atZone(zone).toLocalDate()
                // La mitjanit del perfil pot arribar al cap de 23 o 25 hores.
                val midnight = today.plusDays(1).atStartOfDay(zone).toInstant()
                delay(Duration.between(now, midnight).toMillis().coerceAtLeast(1))
            }
        }
    }
    return today
}

@Composable
internal fun doneDateLabel(day: LocalDate): String {
    val locale = LocalConfiguration.current.locales[0] ?: Locale.getDefault()
    return remember(day, locale) {
        day.format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale))
    }
}

@Composable
internal fun DoneColumnHeader(
    day: LocalDate,
    today: LocalDate,
    dayLabel: String,
    clearedToday: Boolean,
    saving: Boolean,
    weekStartChoice: String,
    onSelectDay: (LocalDate) -> Unit,
    onSetClearedAt: (String?) -> Unit,
) {
    var calendarOpen by rememberSaveable { mutableStateOf(false) }
    val colors = ButtonDefaults.textButtonColors(
        contentColor = Femho.colors.ink,
        disabledContentColor = Femho.colors.inkFaint,
    )
    Column(Modifier.fillMaxWidth()) {
        if (day != today) {
            Text(
                dayLabel,
                modifier = Modifier.padding(horizontal = 8.dp).testTag("board-done-day"),
                color = Femho.colors.ink,
                fontWeight = FontWeight.SemiBold,
            )
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            TextButton(
                onClick = { calendarOpen = true },
                modifier = Modifier.testTag("board-done-calendar"),
                colors = colors,
            ) { Text(stringResource(R.string.nav_calendar)) }
            if (day != today) {
                TextButton(
                    onClick = { onSelectDay(today) },
                    modifier = Modifier.testTag("board-done-back-today"),
                    colors = colors,
                ) { Text(stringResource(R.string.board_done_backtotoday)) }
            } else {
                TextButton(
                    onClick = { onSetClearedAt(Instant.ofEpochMilli(System.currentTimeMillis()).toString()) },
                    modifier = Modifier.testTag("board-done-clear"),
                    enabled = !saving,
                    colors = colors,
                ) { Text(stringResource(R.string.board_done_clear)) }
                if (clearedToday) {
                    TextButton(
                        onClick = { onSetClearedAt(null) },
                        modifier = Modifier.testTag("board-done-show-all"),
                        enabled = !saving,
                        colors = colors,
                    ) { Text(stringResource(R.string.board_done_showalltoday)) }
                }
            }
        }
    }
    if (calendarOpen) {
        DoneCalendarDialog(
            day = day,
            today = today,
            weekStartChoice = weekStartChoice,
            onDismiss = { calendarOpen = false },
            onSelect = {
                calendarOpen = false
                onSelectDay(it)
            },
        )
    }
}

@Composable
private fun DoneCalendarDialog(
    day: LocalDate,
    today: LocalDate,
    weekStartChoice: String,
    onDismiss: () -> Unit,
    onSelect: (LocalDate) -> Unit,
) {
    var displayedMonth by rememberSaveable { mutableStateOf(YearMonth.from(day).toString()) }
    val currentMonth = YearMonth.from(today)
    val month = minOf(YearMonth.parse(displayedMonth), currentMonth)
    val locale = LocalConfiguration.current.locales[0]?.language ?: "ca"
    val weekStart = Dates.resolveWeekStart(weekStartChoice, locale)
    val labels = remember(locale, weekStart) {
        CalendarLabels(
            weekdays = Dates.weekdayNames(locale, weekStart),
            months = (1..12).map { Dates.monthName(locale, it) },
            emptyDay = "",
            emptyWeek = "",
        )
    }
    val colors = ButtonDefaults.textButtonColors(
        contentColor = Femho.colors.ink,
        disabledContentColor = Femho.colors.inkFaint,
    )

    AlertDialog(
        onDismissRequest = onDismiss,
        modifier = Modifier.testTag("board-done-calendar-dialog"),
        containerColor = Femho.colors.panelBg,
        titleContentColor = Femho.colors.ink,
        title = { Text(stringResource(R.string.nav_calendar)) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    val previous = stringResource(R.string.calendar_prevmonth)
                    val next = stringResource(R.string.calendar_nextmonth)
                    TextButton(
                        onClick = { displayedMonth = month.minusMonths(1).toString() },
                        modifier = Modifier.testTag("board-done-calendar-previous")
                            .semantics { contentDescription = previous },
                        colors = colors,
                    ) { Text("‹") }
                    TextButton(
                        onClick = { displayedMonth = month.plusMonths(1).toString() },
                        modifier = Modifier.testTag("board-done-calendar-next")
                            .semantics { contentDescription = next },
                        enabled = month < currentMonth,
                        colors = colors,
                    ) { Text("›") }
                }
                MonthView(
                    year = month.year,
                    month = month.monthValue,
                    selected = day,
                    today = today,
                    dots = emptyMap(),
                    labels = labels,
                    onSelect = onSelect,
                    weekStart = weekStart,
                    maxDate = today,
                )
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss, colors = colors) { Text(stringResource(R.string.nav_close)) }
        },
    )
}
