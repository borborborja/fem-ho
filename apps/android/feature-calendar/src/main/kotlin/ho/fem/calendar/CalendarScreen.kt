package ho.fem.calendar

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import ho.fem.designsystem.EmptyState
import ho.fem.designsystem.Femho
import ho.fem.designsystem.FemhoShape
import ho.fem.designsystem.FemhoText
import ho.fem.model.Dates
import ho.fem.model.EventOccurrence
import java.time.LocalDate

/**
 * El calendari a Android. docs/03 §5.
 *
 * **Setmanal com a llista vertical de dies**, no com una graella de set columnes: en un
 * telèfon, set columnes donen columnes de 50px on no hi cap cap títol, i el que la gent
 * fa al mòbil és recórrer, no comparar.
 *
 * La graella mensual sí que és graella, i **amb quin dia comença ho decideix l'idioma i
 * la preferència de la persona**, no una constant. El valor arriba per `weekStart`
 * (0 diumenge, 1 dilluns) i el resol `resolveWeekStart` de `:core-model`, que és el
 * mateix codi que fa servir la web: si cadascú el calculés pel seu compte, el calendari
 * es desplaçaria un dia i **no donaria cap error**.
 */

data class CalendarLabels(
    val weekdays: List<String>,
    val months: List<String>,
    val emptyDay: String,
    val emptyWeek: String,
)

/**
 * L'índex d'un dia dins de la setmana, comptant des del primer dia que toqui.
 *
 * `DayOfWeek.MONDAY.value` és 1 i `Date#getDay()` de la web posa diumenge a 0: aquesta
 * conversió és la que fa que les dues apps comptin igual.
 */
fun weekIndex(date: LocalDate, weekStart: Int): Int = (date.dayOfWeek.value % 7 - weekStart + 7) % 7

/** Les cel·les d'un mes, sempre en setmanes senceres. */
fun monthCells(year: Int, month: Int, weekStart: Int = 1): List<LocalDate?> {
    val first = LocalDate.of(year, month, 1)
    val lead = weekIndex(first, weekStart)
    val days = first.lengthOfMonth()
    val total = ((lead + days + 6) / 7) * 7

    return (0 until total).map { index ->
        val day = index - lead + 1
        if (day in 1..days) first.withDayOfMonth(day) else null
    }
}

@Composable
fun MonthView(
    year: Int,
    month: Int,
    selected: LocalDate,
    today: LocalDate,
    dots: Map<LocalDate, List<Color>>,
    labels: CalendarLabels,
    onSelect: (LocalDate) -> Unit,
    modifier: Modifier = Modifier,
    /** 0 diumenge, 1 dilluns. El resol `Dates.resolveWeekStart`. */
    weekStart: Int = 1,
) {
    Column(
        modifier = modifier.fillMaxWidth().padding(12.dp).testTag("calendar-month"),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(
            text = "${labels.months.getOrElse(month - 1) { "" }} $year",
            color = Femho.colors.ink,
            fontWeight = FontWeight.ExtraBold,
        )

        Row(modifier = Modifier.fillMaxWidth()) {
            labels.weekdays.forEach { day ->
                Text(
                    text = day,
                    color = Femho.colors.inkFaint,
                    fontSize = FemhoText.meta,
                    modifier = Modifier.weight(1f),
                )
            }
        }

        monthCells(year, month, weekStart).chunked(7).forEach { week ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                week.forEach { date ->
                    DayCell(
                        date = date,
                        selected = date == selected,
                        today = date == today,
                        dots = date?.let { dots[it] }.orEmpty(),
                        onSelect = onSelect,
                        modifier = Modifier.weight(1f),
                    )
                }
            }
        }
    }
}

@Composable
private fun DayCell(
    date: LocalDate?,
    selected: Boolean,
    today: Boolean,
    dots: List<Color>,
    onSelect: (LocalDate) -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier
            .aspectRatio(1f)
            .clip(RoundedCornerShape(14.dp))
            .then(
                when {
                    // Els dies d'altres mesos no es pinten: la cel·la hi és per no
                    // desquadrar la setmana, però no és clicable ni es veu.
                    date == null -> Modifier
                    selected -> Modifier.background(Femho.brandGradient2)
                    today -> Modifier.background(Femho.colors.ghostBg)
                    else -> Modifier
                },
            )
            .then(if (date == null) Modifier else Modifier.clickable { onSelect(date) }),
        contentAlignment = Alignment.Center,
    ) {
        if (date != null) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                    text = date.dayOfMonth.toString(),
                    color = if (selected) Femho.onBrand else Femho.colors.ink,
                    fontSize = FemhoText.body,
                    fontWeight = if (selected) FontWeight.ExtraBold else FontWeight.Normal,
                )
                if (dots.isNotEmpty()) {
                    Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                        // Fins a 3 punts amb els colors dels àmbits que hi tenen res.
                        dots.take(3).forEach { color ->
                            Box(Modifier.size(5.dp).clip(CircleShape).background(color))
                        }
                    }
                }
            }
        }
    }
}

/** La setmana, com a llista vertical de dies (docs/03 §5). */
@Composable
fun WeekList(
    days: List<Pair<LocalDate, List<EventOccurrence>>>,
    labels: CalendarLabels,
    onSelect: (LocalDate) -> Unit,
    modifier: Modifier = Modifier,
    weekStart: Int = 1,
) {
    LazyColumn(
        modifier = modifier.fillMaxWidth().testTag("calendar-week"),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        items(days, key = { it.first.toString() }) { (date, occurrences) ->
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(FemhoShape.card))
                    .background(Femho.colors.cardBg)
                    .clickable { onSelect(date) }
                    .padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Text(
                    text = "${labels.weekdays.getOrElse(weekIndex(date, weekStart)) { "" }} ${date.dayOfMonth}",
                    color = Femho.colors.ink,
                    fontWeight = FontWeight.Bold,
                )
                if (occurrences.isEmpty()) {
                    EmptyState(labels.emptyWeek)
                } else {
                    occurrences.forEach {
                        Text(it.summary, color = Femho.colors.inkSoft, fontSize = FemhoText.body)
                    }
                }
            }
        }
    }
}

@Composable
fun DayList(
    occurrences: List<EventOccurrence>,
    colorOf: (String) -> Color,
    labels: CalendarLabels,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth().padding(12.dp).testTag("calendar-day"),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (occurrences.isEmpty()) {
            EmptyState(labels.emptyDay)
        } else {
            occurrences.forEach { occurrence ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(9.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(
                        Modifier.size(7.dp).clip(CircleShape)
                            .background(colorOf(occurrence.scopeId)),
                    )
                    Text(
                        text = occurrence.summary,
                        color = Femho.colors.ink,
                        fontSize = FemhoText.cardTitle,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.weight(1f),
                    )
                    if (!occurrence.allDay) {
                        Text(
                            text = occurrence.startsAt.substring(11, 16),
                            color = Femho.colors.inkFaint,
                            fontSize = FemhoText.meta,
                        )
                    }
                }
            }
        }
    }
}
