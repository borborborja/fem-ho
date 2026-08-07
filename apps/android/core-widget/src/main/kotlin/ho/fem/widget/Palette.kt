package ho.fem.widget

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.glance.unit.ColorProvider
import ho.fem.designsystem.FemhoColors
import ho.fem.designsystem.femhoColorsOf
import ho.fem.designsystem.scopeColor
import androidx.glance.color.ColorProvider as dayNightProvider
import androidx.glance.unit.ColorProvider as fixedProvider

/**
 * Els colors de Plou, dins d'un widget.
 *
 * **No es fa servir `GlanceTheme`.** El seu `ColorProviders` és un esquema de Material 3
 * de vint-i-set ranures (`primary`, `onPrimaryContainer`, `surfaceTint`…) i el seu valor
 * per defecte és el color dinàmic del fons de pantalla. Fem-ho té el seu sistema de
 * color —`Theme.kt` ja diu que barrejar-los no— i, sobretot, `contrast-check` garanteix
 * el contrast dels **vuit temes de Plou**, no de la combinació que surti del fons de
 * pantalla de cadascú. Un widget amb Material You seria l'única superfície del producte
 * amb un contrast que ningú ha comprovat.
 *
 * El que sí que es fa servir del runtime de Compose és el `CompositionLocal`: Glance
 * compon amb el mateix runtime, encara que després pinti `RemoteViews`.
 */

/**
 * Clar i fosc **alhora**, quan l'usuari no ha triat.
 *
 * `ColorProvider(day, night)` deixa les dues variants dins del `RemoteViews`, i el
 * llançador canvia de mode **sense despertar el nostre procés**. Resoldre-ho nosaltres a
 * `provideGlance` faria que el widget es quedés amb els colors vells fins al proper
 * refresc, que pot ser d'aquí a quinze minuts.
 *
 * Quan la preferència és `light` o `dark` explícits, el color és fix: la persona ha
 * triat i el sistema no hi té res a dir.
 */
class WidgetPalette(
    val theme: String,
    val accent: String,
) {
    val light: FemhoColors = femhoColorsOf(dark = false, accent = accent)
    val dark: FemhoColors = femhoColorsOf(dark = true, accent = accent)

    fun color(pick: FemhoColors.() -> Color): ColorProvider = when (theme) {
        "light" -> fixedProvider(light.pick())
        "dark" -> fixedProvider(dark.pick())
        else -> dayNightProvider(day = light.pick(), night = dark.pick())
    }

    /** El color d'un àmbit, pel nom del token que desa el servidor. */
    fun scope(token: String): ColorProvider = color { scopeColor(token) }
}

private val LocalPalette = staticCompositionLocalOf<WidgetPalette> {
    error("Falta FemhoGlance: cap widget pot pintar sense paleta.")
}

/** L'arrel de tot widget. Res es pinta fora d'aquí. */
@Composable
fun FemhoGlance(palette: WidgetPalette, content: @Composable () -> Unit) {
    CompositionLocalProvider(LocalPalette provides palette, content = content)
}

/** La paleta viva. `Femho.colors` del costat de Compose, però per a Glance. */
object FemhoWidget {
    val palette: WidgetPalette
        @Composable @ReadOnlyComposable get() = LocalPalette.current
}
