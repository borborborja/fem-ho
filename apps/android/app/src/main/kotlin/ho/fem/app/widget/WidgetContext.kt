package ho.fem.app.widget

import android.content.Context
import ho.fem.data.ActiveAccount
import ho.fem.data.Container
import ho.fem.data.TaskBoardSnapshot
import ho.fem.widget.WidgetPalette
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext

/**
 * El que tot widget necessita saber abans de pintar res.
 *
 * **`provideGlance` corre al fil principal.** Llegir Room o el DataStore allà directament
 * és un ANR esperant el dia que el disc vagi lent, i el sistema desperta el procés per
 * pintar widgets en moments en què el disc va lent. Tot el que toca disc passa per
 * `withContext(Dispatchers.IO)`, i per això aquesta funció és suspesa.
 */
data class WidgetContext(
    val palette: WidgetPalette,
    val account: ActiveAccount?,
    val activeScopes: List<String>,
) {
    val signedIn: Boolean get() = account != null
}

internal suspend fun WidgetContext.taskBoard(container: Container): TaskBoardSnapshot? =
    account?.let { container.local(it).taskBoard(activeScopes, container.settings.activeProjects(it).first()) }

suspend fun widgetContext(context: Context): WidgetContext = withContext(Dispatchers.IO) {
    val container = Container.get(context)
    val settings = container.settings
    val account = container.account()
    WidgetContext(
        palette = WidgetPalette(theme = settings.theme.first(), accent = settings.accent.first()),
        account = account,
        activeScopes = account?.let { settings.activeScopes(it) }.orEmpty(),
    )
}
