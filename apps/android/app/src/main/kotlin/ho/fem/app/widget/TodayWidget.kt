package ho.fem.app.widget

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.LocalContext
import androidx.glance.LocalSize
import androidx.glance.ImageProvider
import androidx.glance.action.clickable
import androidx.glance.background
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.lazy.LazyColumn
import androidx.glance.appwidget.lazy.items
import androidx.glance.appwidget.provideContent
import androidx.glance.action.actionStartActivity
import androidx.glance.appwidget.action.actionStartActivity as actionStartIntent
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.width
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import ho.fem.app.MainActivity
import ho.fem.app.R
import ho.fem.app.Route
import ho.fem.data.Container
import ho.fem.model.Dates
import ho.fem.model.Scope
import ho.fem.model.Task
import ho.fem.widget.Dot
import ho.fem.widget.EmptyState
import ho.fem.widget.FemhoGlance
import ho.fem.widget.FemhoWidget
import ho.fem.widget.Glyph
import ho.fem.widget.WidgetSize
import ho.fem.widget.WidgetShape
import ho.fem.widget.WidgetSurface
import ho.fem.widget.WidgetText
import ho.fem.widget.R as WidgetR
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.time.LocalDate
import java.time.ZoneId

/**
 * El que venç avui. `docs/03` §9, la línia que porta des del primer dia sense fer.
 *
 * **Inclou el que ja ha vençut**, marcat a part i no amagat: una tasca d'ahir sense fer
 * segueix sent d'avui per a qui la mira, i una llista que se les guarda per a ella és una
 * llista de la qual es deixa d'un fiar.
 *
 * Es llegeix de Room, o sigui que **funciona sencer en mode avió**.
 */
class TodayWidget : GlanceAppWidget() {

    override val sizeMode = SizeMode.Responsive(
        setOf(
            DpSize(250.dp, 48.dp),
            DpSize(250.dp, 110.dp),
            DpSize(250.dp, 180.dp),
            DpSize(250.dp, 250.dp),
        ),
    )

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        suspend fun read(): Pair<WidgetContext, TodayData?> {
            val widget = widgetContext(context)

            val data = widget.account?.let { account ->
                withContext(Dispatchers.IO) {
                    val container = Container.get(context)
                    val local = container.local(account)
                    val zone = container.settings.cachedTimezone(account)
                        ?.let { runCatching { ZoneId.of(it) }.getOrNull() }
                        ?: ZoneId.systemDefault()
                    val date = LocalDate.now(zone)
                    val today = date.toString()
                    val scopes = local.scopes().associateBy { it.id }
                    val locale = context.resources.configuration.locales[0]?.language ?: "ca"
                    TodayData(
                        tasks = local.due(today, widget.activeScopes),
                        overdue = local.overdue(today, widget.activeScopes),
                        scopes = scopes,
                        today = today,
                        weekday = Dates.dayName(locale, date),
                    )
                }
            }
            return widget to data
        }
        val initial = read()
        val frames = FemhoWidgets.snapshots.observe { read() }.flowOn(Dispatchers.IO)
        provideContent {
            val frame by frames.collectAsState(initial)
            val (widget, data) = frame
            FemhoGlance(widget.palette) {
                val padding = if (LocalSize.current.height < 80.dp) 4.dp else WidgetSize.padding
                WidgetSurface(contentPadding = padding) {
                    if (data == null) {
                        Box(
                            modifier = GlanceModifier
                                .fillMaxSize()
                                .clickable(actionStartActivity<MainActivity>()),
                        ) {
                            EmptyState(LocalContext.current.getString(R.string.widget_signedout))
                        }
                    } else {
                        TodayContent(data, widget.account?.identity?.key.orEmpty())
                    }
                }
            }
        }
    }
}

data class TodayData(
    val tasks: List<Task>,
    val overdue: Int,
    val scopes: Map<String, Scope>,
    val today: String,
    val weekday: String,
)

@Composable
private fun TodayContent(data: TodayData, account: String) {
    val size = LocalSize.current
    val context = LocalContext.current
    val palette = FemhoWidget.palette

    // 4×1 · la fila deixa espai per tocar les dues accions amb el giny a l'alçada mínima.
    if (size.height < 80.dp) {
        Row(
            modifier = GlanceModifier.fillMaxSize().padding(horizontal = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Row(
                GlanceModifier.defaultWeight().clickable(actionStartActivity<MainActivity>()),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = data.tasks.size.toString(),
                    style = TextStyle(
                        color = palette.color { plouOrange },
                        fontSize = WidgetText.figure,
                        fontWeight = FontWeight.Bold,
                    ),
                )
                Spacer(GlanceModifier.width(8.dp))
                Text(
                    text = context.getString(R.string.dashboard_today).lowercase(),
                    maxLines = 1,
                    style = TextStyle(color = palette.color { inkSoft }, fontSize = WidgetText.row),
                )
            }
            WidgetRefreshButton(account)
            QuickAddButton()
        }
        return
    }

    Column(modifier = GlanceModifier.fillMaxSize()) {
        Header(data, account)
        Spacer(GlanceModifier.height(WidgetSize.rowGap))

        if (data.tasks.isEmpty()) {
            EmptyState(context.getString(R.string.dashboard_empty_today))
        } else {
            LazyColumn(modifier = GlanceModifier.fillMaxSize()) {
                items(data.tasks, itemId = { it.id.hashCode().toLong() }) { task ->
                    TaskRow(task, data)
                }
            }
        }
    }
}

@Composable
private fun Header(data: TodayData, account: String) {
    val palette = FemhoWidget.palette
    val context = LocalContext.current

    Row(
        modifier = GlanceModifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Dot(palette.color { plouOrange })
        Spacer(GlanceModifier.width(6.dp))
        Text(
            text = context.getString(R.string.dashboard_today),
            style = TextStyle(
                color = palette.color { ink },
                fontSize = WidgetText.title,
                fontWeight = FontWeight.Bold,
            ),
        )
        Spacer(GlanceModifier.width(8.dp))
        Text(
            // El nom del dia surt de `Dates`, el mateix codi que el calendari i la web:
            // ve del CLDR i no s'escriu a cap catàleg.
            text = data.weekday,
            style = TextStyle(color = palette.color { inkFaint }, fontSize = WidgetText.meta),
        )
        Spacer(GlanceModifier.defaultWeight())

        if (data.overdue > 0) {
            OverdueBadge(data.overdue)
            Spacer(GlanceModifier.width(6.dp))
        }
        WidgetRefreshButton(account)
        QuickAddButton()
    }
}

/**
 * El distintiu d'endarrerides.
 *
 * Només surt si n'hi ha. Un comptador que diu «0 endarrerides» ocupa el mateix espai que
 * un que diu alguna cosa i entrena la vista a ignorar-lo.
 */
@Composable
private fun OverdueBadge(count: Int) {
    val palette = FemhoWidget.palette
    Box(
        modifier = GlanceModifier
            .background(ImageProvider(palette.drawable(WidgetShape.DANGER_PILL)))
            .padding(horizontal = 7.dp, vertical = 2.dp),
    ) {
        Text(
            text = count.toString(),
            style = TextStyle(
                color = palette.color { dangerText },
                fontSize = WidgetText.kicker,
                fontWeight = FontWeight.Bold,
            ),
        )
    }
}

/** L'accés a afegida ràpida que `docs/03` §9 demana dins d'aquest mateix widget. */
@Composable
private fun QuickAddButton() {
    val palette = FemhoWidget.palette
    val context = LocalContext.current
    Glyph(
        resId = WidgetR.drawable.femho_plus,
        color = palette.color { plouOrange },
        size = 22.dp,
        description = context.getString(R.string.dashboard_quickadd),
        modifier = GlanceModifier.clickable(
            actionStartIntent(
                Route.intentTo(quickAdd = true).setClass(context, MainActivity::class.java),
            ),
        ),
    )
}

/**
 * Una fila.
 *
 * **La barra de l'esquerra porta el color de l'àmbit**, i és el que fa que això no sigui
 * una llista grisa: amb tres àmbits actius es veu d'un cop d'ull quantes coses són de
 * feina i quantes de casa sense llegir res. Si la tasca ja ha vençut, la barra passa a
 * vermell: l'endarreriment mana sobre l'àmbit.
 */
@Composable
private fun TaskRow(task: Task, data: TodayData) {
    val palette = FemhoWidget.palette
    val context = LocalContext.current
    val due = task.dueDate
    val late = due != null && due < data.today
    val scope = data.scopes[task.scopeId]

    Row(
        modifier = GlanceModifier
            .fillMaxWidth()
            .padding(vertical = 5.dp)
            .clickable(
                actionStartIntent(
                    Route.intentTo(taskId = task.id)
                        .setClass(context, MainActivity::class.java),
                ),
            ),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Glyph(
            resId = WidgetR.drawable.femho_bar,
            color = if (late) palette.color { dangerText } else palette.scope(scope?.color.orEmpty()),
            size = 18.dp,
            modifier = GlanceModifier.width(WidgetSize.bar),
        )
        Spacer(GlanceModifier.width(9.dp))
        if (task.fromCalendar) {
            CalendarOriginGlyph()
            Spacer(GlanceModifier.width(4.dp))
        }
        Column(GlanceModifier.defaultWeight()) {
            Text(task.title, maxLines = 2, style = TextStyle(color = palette.color { ink }, fontSize = WidgetText.row))
            if (palette.isEink) {
                val subtitle = listOfNotNull(scope?.name, context.getString(R.string.widget_taskoverdue).takeIf { late })
                    .joinToString(" · ")
                if (subtitle.isNotEmpty()) {
                    Text(subtitle, maxLines = 2, style = TextStyle(color = palette.color { inkSoft }, fontSize = WidgetText.meta))
                }
            }
        }
        val time = task.dueTime
        if (time != null) {
            Spacer(GlanceModifier.width(6.dp))
            Text(
                text = time.take(5),
                style = TextStyle(
                    color = if (late) palette.color { dangerText } else palette.color { inkFaint },
                    fontSize = WidgetText.meta,
                ),
            )
        }
    }
}

class TodayWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = TodayWidget()
}
