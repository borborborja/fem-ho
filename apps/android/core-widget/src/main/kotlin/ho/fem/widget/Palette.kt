package ho.fem.widget

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.glance.unit.ColorProvider
import ho.fem.designsystem.FemhoAppearance
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
    val appearance: FemhoAppearance = FemhoAppearance.STANDARD,
) {
    val light: FemhoColors = femhoColorsOf(dark = false, accent = accent, appearance = appearance)
    val dark: FemhoColors = femhoColorsOf(dark = true, accent = accent, appearance = appearance)
    val isEink: Boolean get() = appearance == FemhoAppearance.EINK

    fun color(pick: FemhoColors.() -> Color): ColorProvider = when {
        isEink || theme == "light" -> fixedProvider(light.pick())
        theme == "dark" -> fixedProvider(dark.pick())
        else -> dayNightProvider(day = light.pick(), night = dark.pick())
    }

    /** El color d'un àmbit, pel nom del token que desa el servidor. */
    fun scope(token: String): ColorProvider = color { scopeColor(token) }

    fun drawable(shape: WidgetShape): Int = when (appearance) {
        FemhoAppearance.STANDARD -> shape.standard
        FemhoAppearance.HIGH_CONTRAST -> when (theme) {
            "light" -> shape.contrastLight
            "dark" -> shape.contrastDark
            else -> shape.contrastSystem
        }
        FemhoAppearance.EINK -> shape.eink
    }
}

// El llançador resol els recursos de night. Les variants de tria explícita duen colors
// fixos perquè la superfície i el text canviïn junts, també abans d'Android 12.
enum class WidgetShape(
    internal val standard: Int,
    internal val contrastSystem: Int,
    internal val contrastLight: Int,
    internal val contrastDark: Int,
    internal val eink: Int,
) {
    SURFACE(
        R.drawable.femho_widget_surface,
        R.drawable.femho_widget_contrast_surface,
        R.drawable.femho_widget_contrast_light_surface,
        R.drawable.femho_widget_contrast_dark_surface,
        R.drawable.femho_widget_eink_surface,
    ),
    TILE(
        R.drawable.femho_widget_tile,
        R.drawable.femho_widget_contrast_tile,
        R.drawable.femho_widget_contrast_light_tile,
        R.drawable.femho_widget_contrast_dark_tile,
        R.drawable.femho_widget_eink_tile,
    ),
    CALENDAR_SUGGESTION(
        R.drawable.femho_widget_calendar_suggestion,
        R.drawable.femho_widget_contrast_calendar_suggestion,
        R.drawable.femho_widget_contrast_light_calendar_suggestion,
        R.drawable.femho_widget_contrast_dark_calendar_suggestion,
        R.drawable.femho_widget_eink_calendar_suggestion,
    ),
    DANGER_PILL(
        R.drawable.femho_widget_danger_pill,
        R.drawable.femho_widget_contrast_danger_pill,
        R.drawable.femho_widget_contrast_light_danger_pill,
        R.drawable.femho_widget_contrast_dark_danger_pill,
        R.drawable.femho_widget_eink_danger_pill,
    ),
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
