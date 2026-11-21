package ho.fem.app.widget

import android.content.Context
import ho.fem.data.ActiveAccount
import ho.fem.data.Container
import ho.fem.data.TaskBoardSnapshot
import ho.fem.designsystem.appearanceOf
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
    val display = container.settings.display.first()
    val account = container.account()
    WidgetContext(
        palette = WidgetPalette(display.theme, display.accent, appearanceOf(display.appearance)),
        account = account,
        activeScopes = account?.let { container.settings.activeScopes(it) }.orEmpty(),
    )
}
