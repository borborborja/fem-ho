package ho.fem.app.widget

import android.content.Context
import androidx.compose.runtime.Composable
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
import ho.fem.model.Task
import ho.fem.widget.Dot
import ho.fem.widget.EmptyState
import ho.fem.widget.FemhoGlance
import ho.fem.widget.FemhoWidget
import ho.fem.widget.Glyph
import ho.fem.widget.WidgetSize
import ho.fem.widget.WidgetSurface
import ho.fem.widget.WidgetText
import ho.fem.widget.R as WidgetR
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.time.LocalDate

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
        val widget = widgetContext(context)

        val data = if (!widget.signedIn) {
            null
        } else {
            withContext(Dispatchers.IO) {
                val local = Container.get(context).local
                val today = LocalDate.now().toString()
                val scopes = local.scopes().associate { it.id to it.color }
                val locale = context.resources.configuration.locales[0]?.language ?: "ca"
                val date = LocalDate.parse(today)
                TodayData(
                    tasks = local.due(today, widget.activeScopes),
                    overdue = local.overdue(today, widget.activeScopes),
                    scopeColors = scopes,
                    today = today,
                    weekday = Dates.dayName(locale, date),
                )
            }
        }

        provideContent {
            FemhoGlance(widget.palette) {
                WidgetSurface {
                    if (data == null) {
                        Box(
                            modifier = GlanceModifier
                                .fillMaxSize()
                                .clickable(actionStartActivity<MainActivity>()),
                        ) {
                            EmptyState(LocalContext.current.getString(R.string.widget_signedout))
                        }
                    } else {
                        TodayContent(data)
                    }
                }
            }
        }
    }
}

data class TodayData(
    val tasks: List<Task>,
    val overdue: Int,
    val scopeColors: Map<String, String>,
    val today: String,
    val weekday: String,
)

@Composable
private fun TodayContent(data: TodayData) {
    val size = LocalSize.current
    val context = LocalContext.current
    val palette = FemhoWidget.palette

    // 4×1 · no hi cap cap llista: la xifra i el distintiu d'endarrerides.
    if (size.height < 80.dp) {
        Row(
            modifier = GlanceModifier
                .fillMaxSize()
                .clickable(actionStartActivity<MainActivity>()),
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
                style = TextStyle(color = palette.color { inkSoft }, fontSize = WidgetText.row),
            )
            Spacer(GlanceModifier.defaultWeight())
            QuickAddButton()
        }
        return
    }

    Column(modifier = GlanceModifier.fillMaxSize()) {
        Header(data)
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
private fun Header(data: TodayData) {
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
            .background(ImageProvider(WidgetR.drawable.femho_widget_danger_pill))
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
    val token = data.scopeColors[task.scopeId] ?: ""

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
            color = if (late) palette.color { dangerText } else palette.scope(token),
            size = 18.dp,
            modifier = GlanceModifier.width(WidgetSize.bar),
        )
        Spacer(GlanceModifier.width(9.dp))
        Text(
            text = task.title,
            maxLines = 2,
            style = TextStyle(color = palette.color { ink }, fontSize = WidgetText.row),
            modifier = GlanceModifier.defaultWeight(),
        )
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
