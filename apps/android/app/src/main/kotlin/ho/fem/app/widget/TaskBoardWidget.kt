package ho.fem.app.widget

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.unit.dp
import androidx.glance.*
import androidx.glance.action.clickable
import androidx.glance.appwidget.*
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.lazy.LazyColumn
import androidx.glance.appwidget.lazy.items
import androidx.glance.layout.*
import androidx.glance.semantics.contentDescription
import androidx.glance.semantics.semantics
import androidx.glance.text.*
import ho.fem.app.MainActivity
import ho.fem.app.R
import ho.fem.app.Route
import ho.fem.data.Container
import ho.fem.data.TaskBoardSnapshot
import ho.fem.model.Task
import ho.fem.model.TaskStatus
import ho.fem.widget.*
import ho.fem.widget.R as WidgetR
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Les tres llistes comparteixen instantània, però cada columna es desplaça sola. */
class TaskBoardWidget : GlanceAppWidget() {
    override val sizeMode = SizeMode.Exact

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        suspend fun read(): TaskBoardFrame {
            val widget = widgetContext(context)
            return withContext(Dispatchers.IO) {
                val container = Container.get(context)
                TaskBoardFrame(widget,
                    if (widget.signedIn) container.local.taskBoard(widget.activeScopes) else null,
                    if (widget.signedIn) widgetAccount(container) else "")
            }
        }
        val initial = read()
        val frames = FemhoWidgets.snapshots.observe { read() }.flowOn(Dispatchers.IO)
        provideContent {
            val frame by frames.collectAsState(initial)
            val (widget, snapshot, account) = frame
            FemhoGlance(widget.palette) {
                WidgetSurface(modifier = GlanceModifier.background(
                    ImageProvider(WidgetR.drawable.femho_widget_surface),
                    colorFilter = ColorFilter.tint(FemhoWidget.palette.color { dialogBg }),
                )) {
                    if (snapshot == null) {
                        Box(GlanceModifier.fillMaxSize().clickable(openBoard(context))) {
                            EmptyState(context.getString(R.string.widget_signedout))
                        }
                    } else {
                        TaskBoardContent(snapshot, account)
                    }
                }
            }
        }
    }
}

private data class TaskBoardFrame(val widget: WidgetContext, val snapshot: TaskBoardSnapshot?, val account: String)

private fun openBoard(context: Context, status: TaskStatus? = null) = actionStartActivity(
    Route.intentTo(status = status).setClass(context, MainActivity::class.java),
)

@Composable
private fun TaskBoardContent(snapshot: TaskBoardSnapshot, account: String) {
    val context = LocalContext.current
    val palette = FemhoWidget.palette
    Column(GlanceModifier.fillMaxSize()) {
        Row(GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(context.getString(R.string.widget_taskboard_title),
                style = TextStyle(color = palette.color { ink }, fontSize = WidgetText.title, fontWeight = FontWeight.Bold),
                modifier = GlanceModifier.defaultWeight())
            Box(GlanceModifier.width(64.dp).height(48.dp).clickable(openBoard(context)), contentAlignment = Alignment.Center) {
                Text(context.getString(R.string.widget_taskboard_open),
                    style = TextStyle(color = palette.color { inkSoft }, fontSize = WidgetText.row))
            }
        }
        Row(GlanceModifier.fillMaxWidth().defaultWeight()) {
            COLUMNS.filter { it.status != TaskStatus.DONE }.forEachIndexed { index, column ->
                if (index > 0) Spacer(GlanceModifier.width(WidgetSize.gap))
                BoardLane(column, snapshot, account, GlanceModifier.defaultWeight().fillMaxHeight())
            }
        }
    }
}

@Composable
private fun BoardLane(column: BoardColumn, snapshot: TaskBoardSnapshot, account: String, modifier: GlanceModifier) {
    val context = LocalContext.current
    val palette = FemhoWidget.palette
    val tasks = snapshot.columns[column.status].orEmpty()
    val count = snapshot.counts[column.status] ?: 0
    Column(modifier) {
        Row(GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Dot(palette.color(column.tint), size = 6.dp)
            Spacer(GlanceModifier.width(4.dp))
            Text(context.getString(column.label), maxLines = 2,
                style = TextStyle(color = palette.color { ink }, fontSize = WidgetText.meta, fontWeight = FontWeight.Bold),
                modifier = GlanceModifier.defaultWeight())
        }
        Text(count.toString(), style = TextStyle(color = palette.color { inkSoft }, fontSize = WidgetText.meta))
        Spacer(GlanceModifier.height(WidgetSize.rowGap))
        if (tasks.isEmpty()) {
            Text(context.getString(R.string.widget_taskboard_empty),
                style = TextStyle(color = palette.color { inkSoft }, fontSize = WidgetText.meta))
        } else {
            LazyColumn(GlanceModifier.fillMaxWidth().defaultWeight()) {
                items(tasks) { task -> BoardTask(task, snapshot.scopeColors[task.scopeId].orEmpty(), account) }
                if (count > tasks.size) {
                    item {
                        Box(GlanceModifier.fillMaxWidth().height(48.dp).clickable(openBoard(context, column.status)), contentAlignment = Alignment.Center) {
                            Text(context.getString(R.string.widget_taskboard_viewall), maxLines = 2,
                                style = TextStyle(color = palette.color { inkSoft }, fontSize = WidgetText.meta))
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun BoardTask(task: Task, scopeColor: String, account: String) {
    val context = LocalContext.current
    val palette = FemhoWidget.palette
    val next = COLUMNS.first { it.status.ordinal == task.status.ordinal + 1 }
    val description = context.getString(R.string.widget_taskboard_advance)
        .replace("{task}", task.title).replace("{column}", context.getString(next.label))
    // El text ampliat necessita més alçada; la zona tàctil mai baixa de 48 dp.
    val cardHeight = 72.dp * context.resources.configuration.fontScale.coerceAtLeast(1f)
    Box(GlanceModifier.fillMaxWidth().padding(bottom = WidgetSize.rowGap)) {
        Box(GlanceModifier.fillMaxWidth()
            .background(ImageProvider(WidgetR.drawable.femho_widget_card_mask), colorFilter = ColorFilter.tint(palette.color { cardBg }))) {
            Column(GlanceModifier.fillMaxWidth().height(cardHeight)
                .background(ImageProvider(WidgetR.drawable.femho_widget_outline), colorFilter = ColorFilter.tint(palette.color { cardBorder }))
                .clickable(advanceTaskAction(task, account))
                .semantics { contentDescription = description }
                .padding(8.dp)) {
                Text(task.title, maxLines = 2, modifier = GlanceModifier.defaultWeight(),
                    style = TextStyle(color = palette.color { ink }, fontSize = WidgetText.row))
                Row(GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Dot(palette.scope(scopeColor), size = 6.dp)
                    Spacer(GlanceModifier.defaultWeight())
                    Glyph(if (next.status == TaskStatus.DONE) WidgetR.drawable.femho_ring_done else WidgetR.drawable.femho_arrow,
                        palette.color { inkSoft }, size = 16.dp)
                }
            }
        }
    }
}

class TaskBoardWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = TaskBoardWidget()
}
