package ho.fem.app.widget

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.dp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.LocalContext
import androidx.glance.action.ActionParameters
import androidx.glance.action.actionParametersOf
import androidx.glance.action.clickable
import androidx.glance.appwidget.action.ActionCallback
import androidx.glance.appwidget.action.actionRunCallback
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.size
import androidx.glance.semantics.contentDescription
import androidx.glance.semantics.semantics
import ho.fem.app.Notifications
import ho.fem.app.R
import ho.fem.data.Container
import ho.fem.widget.FemhoWidget
import ho.fem.widget.Glyph
import ho.fem.widget.WidgetSize
import ho.fem.widget.R as WidgetR
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private val REFRESH_ACCOUNT = ActionParameters.Key<String>("refresh_account")

@Composable
internal fun WidgetRefreshButton(account: String) {
    val description = LocalContext.current.getString(R.string.widget_refresh)
    Box(
        GlanceModifier.size(WidgetSize.touch)
            .clickable(actionRunCallback<RefreshWidgetAction>(actionParametersOf(REFRESH_ACCOUNT to account)))
            .semantics { contentDescription = description },
        contentAlignment = Alignment.Center,
    ) {
        Glyph(WidgetR.drawable.femho_refresh, FemhoWidget.palette.color { inkSoft }, size = 18.dp)
    }
}

class RefreshWidgetAction : ActionCallback {
    override suspend fun onAction(context: Context, glanceId: GlanceId, parameters: ActionParameters) {
        val expected = parameters[REFRESH_ACCOUNT] ?: return
        val account = withContext(Dispatchers.IO) { Container.get(context).account() }
        if (account != null && account.identity.key == expected) Notifications.requestSync(context, account)
        // El rellotge pot haver fet canviar una proposta encara que la xarxa no estigui disponible.
        FemhoWidgets.updateAll(context)
    }
}
