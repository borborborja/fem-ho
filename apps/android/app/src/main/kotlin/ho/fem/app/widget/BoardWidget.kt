package ho.fem.app.widget

import android.content.Context
import android.content.Intent
import android.appwidget.AppWidgetManager
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.glance.*
import androidx.glance.action.*
import androidx.glance.appwidget.*
import androidx.glance.appwidget.action.ActionCallback
import androidx.glance.appwidget.action.actionRunCallback
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.lazy.LazyColumn
import androidx.glance.appwidget.lazy.items
import androidx.glance.appwidget.state.getAppWidgetState
import androidx.glance.layout.*
import androidx.glance.text.*
import ho.fem.app.MainActivity
import ho.fem.app.R
import ho.fem.app.Notifications
import ho.fem.data.Container
import ho.fem.model.Task
import ho.fem.model.TaskStatus
import ho.fem.widget.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext

val WIDGET_COLUMN = stringPreferencesKey("column")
private val TASK_ID = ActionParameters.Key<String>("task_id")
private val SOURCE_STATUS = ActionParameters.Key<String>("source_status")
private val ACCOUNT_KEY = ActionParameters.Key<String>("account")

fun widgetColumn(value: String?): TaskStatus =
    TaskStatus.entries.firstOrNull { it != TaskStatus.DONE && it.name.equals(value, true) } ?: TaskStatus.INBOX

/** Cada instància conserva la seva columna. La llista i les accions funcionen amb Room. */
class BoardWidget : GlanceAppWidget() {
    override val sizeMode = SizeMode.Responsive(setOf(DpSize(180.dp, 100.dp), DpSize(250.dp, 180.dp), DpSize(250.dp, 300.dp)))

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val widget = widgetContext(context)
        val prefs = getAppWidgetState<Preferences>(context, id)
        val column = widgetColumn(prefs[WIDGET_COLUMN])
        val container = Container.get(context)
        val data = withContext(Dispatchers.IO) {
            if (widget.signedIn) container.local.column(column, widget.activeScopes) else emptyList()
        }
        val pending = withContext(Dispatchers.IO) { if (widget.signedIn) (container.repositoryOrNull()?.pending?.first() ?: 0) > 0 else false }
        val account = withContext(Dispatchers.IO) { widgetAccount(container) }
        provideContent {
            FemhoGlance(widget.palette) {
                WidgetSurface {
                    if (!widget.signedIn) {
                        Box(GlanceModifier.fillMaxSize().clickable(actionStartActivity(Intent(context, MainActivity::class.java)))) {
                            EmptyState(context.getString(R.string.widget_signedout))
                        }
                    } else {
                        Column(GlanceModifier.fillMaxSize()) {
                            Row(GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                                Text(context.getString(COLUMNS.first { it.status == column }.label),
                                    style = TextStyle(color = FemhoWidget.palette.color { ink }, fontSize = WidgetText.title, fontWeight = FontWeight.Bold),
                                    modifier = GlanceModifier.defaultWeight())
                                Text(context.getString(R.string.widget_configure),
                                    style = TextStyle(color = FemhoWidget.palette.color { inkSoft }, fontSize = WidgetText.meta),
                                    modifier = GlanceModifier.padding(8.dp).clickable(actionStartActivity(
                                        Intent(context, WidgetConfigurationActivity::class.java)
                                            .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, GlanceAppWidgetManager(context).getAppWidgetId(id)))))
                            }
                            if (pending) {
                                Text(context.getString(R.string.widget_pendingsync), style = TextStyle(color = FemhoWidget.palette.color { inkSoft }, fontSize = WidgetText.meta))
                            }
                            if (data.isEmpty()) EmptyState(context.getString(R.string.widget_columnempty))
                            else LazyColumn(GlanceModifier.fillMaxSize()) {
                                items(data) { task -> TaskRow(task, column, account) }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun TaskRow(task: Task, column: TaskStatus, account: String) {
    val context = LocalContext.current
    val next = TaskStatus.entries[column.ordinal + 1]
    val nextLabel = context.getString(COLUMNS.first { it.status == next }.label)
    Row(GlanceModifier.fillMaxWidth().padding(vertical = 10.dp).clickable(actionRunCallback<AdvanceTaskAction>(
        actionParametersOf(TASK_ID to task.id, SOURCE_STATUS to column.name, ACCOUNT_KEY to account))), verticalAlignment = Alignment.CenterVertically) {
        Text(task.title, maxLines = 2, style = TextStyle(color = FemhoWidget.palette.color { ink }, fontSize = WidgetText.row), modifier = GlanceModifier.defaultWeight())
        Spacer(GlanceModifier.width(8.dp))
        Text(context.getString(R.string.widget_advance).replace("{column}", nextLabel), maxLines = 1,
            style = TextStyle(color = FemhoWidget.palette.color { inkSoft }, fontSize = WidgetText.meta))
    }
}

/** El callback contrasta l’estat local: un doble toc no completa dues columnes de cop. */
class AdvanceTaskAction : ActionCallback {
    override suspend fun onAction(context: Context, glanceId: GlanceId, parameters: ActionParameters) {
        val taskId = parameters[TASK_ID] ?: return
        val source = widgetColumn(parameters[SOURCE_STATUS])
        val widget = widgetContext(context)
        if (!widget.signedIn) { BoardWidget().update(context, glanceId); return }
        val container = Container.get(context)
        withContext(Dispatchers.IO) {
            val account = widgetAccount(container)
            if (account.isEmpty() || parameters[ACCOUNT_KEY] != account) return@withContext
            val repository = container.repositoryOrNull() ?: return@withContext
            val task = repository.tasks.first().find { it.id == taskId && it.status == source } ?: return@withContext
            if (widget.activeScopes.isNotEmpty() && task.scopeId !in widget.activeScopes) return@withContext
            val next = TaskStatus.entries[source.ordinal + 1]
            val last = repository.tasks.first().filter { it.scopeId == task.scopeId && it.status == next }.maxByOrNull { it.position }?.position
            repository.moveTask(task, next, last to null)
            // El worker conserva el reintent encara que el sistema mati el callback.
            Notifications.requestSync(context)
            FemhoWidgets.updateAll(context)
        }
    }
}

class BoardWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = BoardWidget()
}
