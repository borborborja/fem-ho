package ho.fem.app.widget

import android.content.Context
import ho.fem.data.Container
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
    val signedIn: Boolean,
    val activeScopes: List<String>,
)

/**
 * Hi ha sessió?
 *
 * El criteri és el que ja fa servir el codi en segon pla (`SyncWorker`): un testimoni de
 * refresc. **No n'hi ha prou amb tenir dades a Room**: si algú ha tancat la sessió, les
 * tasques de qui hi havia abans no es poden quedar pintades a la pantalla d'inici d'un
 * telèfon que potser ja no és seu. Fins ara les dades no sortien mai de l'app i això no
 * es plantejava; amb widgets, sí.
 */
suspend fun widgetContext(context: Context): WidgetContext = withContext(Dispatchers.IO) {
    val container = Container.get(context)
    val settings = container.settings

    val theme = settings.theme.first()
    val accent = settings.accent.first()

    /**
     * El testimoni es llegeix amb `runCatching`.
     *
     * `EncryptedSharedPreferences` obre el magatzem de claus del dispositiu, i el sistema
     * pot demanar-nos un widget **abans del primer desbloqueig** després d'arrencar el
     * telèfon. Allà això llança, i una excepció a `provideGlance` no és un widget lleig:
     * és el procés que cau en arrencar. Sense testimoni, el widget diu que cal entrar-hi.
     */
    val signedIn = runCatching { container.tokens.refresh() != null }.getOrDefault(false)

    WidgetContext(
        palette = WidgetPalette(theme = theme, accent = accent),
        signedIn = signedIn,
        activeScopes = if (signedIn) settings.activeScopes.first() else emptyList(),
    )
}
