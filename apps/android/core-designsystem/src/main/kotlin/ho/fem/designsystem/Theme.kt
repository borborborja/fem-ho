package ho.fem.designsystem

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * El tema. docs/03 §1, D7.
 *
 * Els colors surten de `Tokens.kt`, que **es genera des del CSS de Plou** i no s'edita.
 * Aquí només hi ha el que Compose necessita i el CSS no pot donar: els gradients, que a
 * Compose són `Brush` i no `Color`, i les mides, que a Plou són literals repetits.
 *
 * No es fa servir Material 3 com a sistema de color: Plou té el seu, i barrejar-los
 * donaria dos jocs de superfícies competint. Material 3 hi és pels components de base
 * —camps de text, indicadors— i se'ls hi passa el color de Plou.
 */

val LocalFemhoColors = staticCompositionLocalOf { lightColors }
val LocalFemhoAccent = staticCompositionLocalOf { FemhoAccent.DEFAULT }
val LocalFemhoGradients = staticCompositionLocalOf { lightGradients }

object Femho {
    val colors: FemhoColors
        @Composable @ReadOnlyComposable get() = LocalFemhoColors.current

    val gradients: FemhoGradientStops
        @Composable @ReadOnlyComposable get() = LocalFemhoGradients.current

    /**
     * El gradient de marca.
     *
     * Es munta amb els tres tons de **l'accent viu** i no amb les parades exportades:
     * `plouBlue`, `plouOrange` i `plouPink` canvien amb l'accent, i les parades del CSS
     * són les del tema per defecte. Amb elles, canviar d'accent deixaria el gradient
     * igual mentre la resta de la pantalla canvia de color.
     */
    val brandGradient: Brush
        @Composable @ReadOnlyComposable get() = Brush.linearGradient(
            listOf(colors.plouBlue, colors.plouOrange, colors.plouPink),
        )

    /** Les dues parades, per als elements petits: cercles d'estat, indicadors. */
    val brandGradient2: Brush
        @Composable @ReadOnlyComposable get() = Brush.linearGradient(
            listOf(colors.plouBlue, colors.plouOrange),
        )

    /**
     * El fons de la pàgina.
     *
     * **És un gradient, no un color**, i per això no surt de `FemhoColors`: a CSS és
     * `linear-gradient` en tema clar i `radial-gradient` en fosc. Aquí es munta lineal
     * als dos: un radial de Compose necessita centre i radi en píxels, i posar-los a ull
     * donaria un fons que no s'assembla al de la web en cap mida de pantalla.
     */
    val pageBackground: Brush
        @Composable @ReadOnlyComposable get() = Brush.linearGradient(gradients.pageBg)

    /** El color del text damunt del gradient. Canvia amb l'accent (`soft` el passa a tinta). */
    val onBrand: Color
        @Composable @ReadOnlyComposable get() = colors.onBrand
}

/** Radis i espais de Plou, un sol cop. */
object FemhoShape {
    val card = 16.dp
    val column = 20.dp
    val pill = 100.dp
    val input = 12.dp
}

object FemhoSize {
    val cardGap = 9.dp
    val columnGap = 16.dp
    /** L'Inbox se separa de les altres tres amb 24 en comptes de 16 (docs/02 §4). */
    val inboxGap = 24.dp
    val touch = 44.dp
    val statusCircle = 22.dp
}

object FemhoText {
    val cardTitle = 13.5.sp
    val columnTitle = 14.5.sp
    val meta = 10.5.sp
    val body = 13.sp
    val wordmark = 24.sp
}

/**
 * Sense `MaterialTheme`, els components M3 (camps de text, botons) usen l'esquema clar
 * estàtic — `lightColorScheme()` — i en mode fosc el text del camp (onSurface fosc)
 * s'invisibilitza sobre el fons fosc de Plou (confirmat mostrejant píxels).
 *
 * Aquesta funció mapeja els colors de Plou a l'esquema de Material 3.
 * Tots els colors surten de `Femho.colors` i no de literals, per complir amb
 * la comprovació `no-hardcoded-colors`.
 */
private fun femhoColorScheme(colors: FemhoColors, dark: Boolean): ColorScheme {
    // La base tria el tema: els components de Material 3 que no es toquen aquí
    // (superfícies de diàlegs, menús) han de seguir el tema del sistema.
    val base = if (dark) darkColorScheme() else lightColorScheme()
    return base.copy(
        primary = colors.plouBlueInk,
        onPrimary = colors.onBrand,
        primaryContainer = colors.plouBlue,
        onPrimaryContainer = colors.onBrand,
        surface = colors.panelBg,
        onSurface = colors.ink,
        onSurfaceVariant = colors.inkSoft,
        outline = colors.inputBorder,
        outlineVariant = colors.inputBorder,
        error = colors.dangerText,
    )
}

/**
 * `system` no és un tercer tema, és "el que digui el sistema": es resol al moment i
 * torna a resoldre's si l'usuari canvia la preferència del sistema sense tocar l'app.
 */
@Composable
fun FemhoTheme(
    theme: String = "system",
    accent: String = "default",
    content: @Composable () -> Unit,
) {
    val dark = when (theme) {
        "dark" -> true
        "light" -> false
        else -> isSystemInDarkTheme()
    }

    // La resolució viu a `Palette.kt` i no aquí: els widgets de la pantalla d'inici van
    // amb Glance, sense runtime de Compose, i han de donar exactament els mateixos
    // colors. Dos camins de resolució divergirien sense que cap prova ho digués.
    val chosen = accentOf(accent)
    val colors = femhoColorsOf(dark, accent)

    CompositionLocalProvider(
        LocalFemhoColors provides colors,
        LocalFemhoAccent provides chosen,
        LocalFemhoGradients provides femhoGradientsOf(dark),
    ) {
        MaterialTheme(colorScheme = femhoColorScheme(colors, dark), content = content)
    }
}
