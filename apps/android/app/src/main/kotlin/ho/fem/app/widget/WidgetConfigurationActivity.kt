package ho.fem.app.widget

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.ui.semantics.Role
import android.widget.Toast
import kotlinx.coroutines.CancellationException
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.appwidget.GlanceAppWidgetManager
import androidx.glance.appwidget.state.getAppWidgetState
import androidx.glance.appwidget.state.updateAppWidgetState
import androidx.lifecycle.lifecycleScope
import ho.fem.app.R
import ho.fem.data.Container
import ho.fem.designsystem.Femho
import ho.fem.designsystem.FemhoTheme
import ho.fem.model.TaskStatus
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

/** Cancel·lar no crea el widget; cada selecció actualitza només l’identificador rebut. */
class WidgetConfigurationActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setResult(Activity.RESULT_CANCELED)
        val widgetId = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
        val provider = AppWidgetManager.getInstance(this).getAppWidgetInfo(widgetId)?.provider
        if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID || provider?.className != BoardWidgetReceiver::class.java.name) { finish(); return }
        lifecycleScope.launch {
            val glanceId = GlanceAppWidgetManager(this@WidgetConfigurationActivity).getGlanceIdBy(widgetId)
            val prefs = getAppWidgetState(this@WidgetConfigurationActivity, androidx.glance.state.PreferencesGlanceStateDefinition, glanceId)
            val settings = Container.get(this@WidgetConfigurationActivity).settings
            val theme = settings.theme.first()
            val accent = settings.accent.first()
            setContent {
                var chosen by remember { mutableStateOf(widgetColumn(prefs[WIDGET_COLUMN])) }
                var saving by remember { mutableStateOf(false) }
                FemhoTheme(theme, accent) {
                    Column(Modifier.fillMaxSize().background(Femho.colors.panelBg).safeDrawingPadding().padding(24.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
                        Text(stringResource(R.string.widget_choosecolumn), color = Femho.colors.ink, fontSize = 22.sp)
                        Column(Modifier.selectableGroup()) {
                        for (column in COLUMNS.filter { it.status != TaskStatus.DONE }) {
                            Text((if (chosen == column.status) "● " else "○ ") + stringResource(column.label), color = Femho.colors.ink,
                                modifier = Modifier.fillMaxWidth().selectable(selected = chosen == column.status, enabled = !saving, role = Role.RadioButton, onClick = { chosen = column.status }).padding(16.dp))
                        }
                        }
                        Text(stringResource(R.string.nav_save), color = Femho.colors.ink,
                            modifier = Modifier.fillMaxWidth().clickable(enabled = !saving) {
                                saving = true
                                lifecycleScope.launch {
                                    try {
                                    updateAppWidgetState(this@WidgetConfigurationActivity, glanceId) { it[WIDGET_COLUMN] = chosen.name }
                                    FemhoWidgets.updateAll(this@WidgetConfigurationActivity)
                                    setResult(Activity.RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId))
                                    finish()
                                    } catch (cancelled: CancellationException) {
                                        throw cancelled
                                    } catch (error: Exception) {
                                        saving = false
                                        Toast.makeText(this@WidgetConfigurationActivity, R.string.error_generic, Toast.LENGTH_SHORT).show()
                                    }
                                }
                            }.padding(16.dp))
                        Text(stringResource(R.string.nav_cancel), color = Femho.colors.inkSoft,
                            modifier = Modifier.clickable(enabled = !saving) { finish() }.padding(16.dp))
                    }
                }
            }
        }
    }
}
