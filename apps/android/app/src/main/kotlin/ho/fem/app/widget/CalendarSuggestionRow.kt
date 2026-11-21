package ho.fem.app.widget

import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.dp
import androidx.glance.GlanceModifier
import androidx.glance.ImageProvider
import androidx.glance.LocalContext
import androidx.glance.action.clickable
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.width
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import ho.fem.app.MainActivity
import ho.fem.app.R
import ho.fem.app.Route
import ho.fem.model.CalendarTaskSuggestion
import ho.fem.model.TaskStatus
import ho.fem.widget.Dot
import ho.fem.widget.FemhoWidget
import ho.fem.widget.Glyph
import ho.fem.widget.WidgetSize
import ho.fem.widget.WidgetText
import ho.fem.widget.R as WidgetR
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private val calendarTime = DateTimeFormatter.ofPattern("HH:mm")

@Composable
internal fun CalendarOriginGlyph(suggested: Boolean = false) {
    val context = LocalContext.current
    Glyph(
        WidgetR.drawable.femho_calendar_origin,
        FemhoWidget.palette.color { inkSoft },
        size = 15.dp,
        description = context.getString(
            if (suggested) R.string.calendarsuggestions_suggested else R.string.calendarsuggestions_origin,
        ),
    )
}

@Composable
internal fun CalendarSuggestionRow(
    suggestion: CalendarTaskSuggestion,
    status: TaskStatus,
    scopeColor: String,
    timezone: String,
    account: String,
) {
    val context = LocalContext.current
    val palette = FemhoWidget.palette
    val isSuggested = status == TaskStatus.DOING
    val time = if (suggestion.allDay) {
        context.getString(R.string.calendarsuggestions_allday)
    } else {
        suggestion.start.atZone(ZoneId.of(timezone)).format(calendarTime)
    }
    val tile = if (isSuggested) WidgetR.drawable.femho_widget_calendar_suggestion else WidgetR.drawable.femho_widget_tile
    val cardHeight = 64.dp * context.resources.configuration.fontScale.coerceAtLeast(1f)
    Box(GlanceModifier.fillMaxWidth().padding(bottom = WidgetSize.rowGap)) {
        Column(
            GlanceModifier.fillMaxWidth().height(cardHeight)
                .background(ImageProvider(tile))
                .clickable(actionStartActivity(
                    Route.intentToCalendarSuggestion(suggestion, status, account).setClass(context, MainActivity::class.java),
                ))
                .padding(horizontal = 8.dp, vertical = 6.dp),
        ) {
            Text(
                suggestion.title,
                maxLines = 2,
                modifier = GlanceModifier.defaultWeight(),
                style = TextStyle(color = palette.color { ink }, fontSize = WidgetText.row),
            )
            Row(GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Dot(palette.scope(scopeColor), size = 6.dp)
                Spacer(GlanceModifier.width(4.dp))
                Text(
                    time,
                    maxLines = 1,
                    modifier = GlanceModifier.defaultWeight(),
                    style = TextStyle(color = palette.color { inkSoft }, fontSize = WidgetText.meta),
                )
                CalendarOriginGlyph(suggested = isSuggested)
            }
        }
    }
}
