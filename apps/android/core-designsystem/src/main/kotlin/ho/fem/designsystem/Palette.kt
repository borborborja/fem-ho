package ho.fem.designsystem

import androidx.compose.ui.graphics.Color

/**
 * La resolució tema + accent → colors, **fora de Compose**.
 *
 * `FemhoTheme` no és l'únic que pinta Fem-ho: els widgets de la pantalla d'inici van amb
 * Glance, que no té el runtime de Compose ni, per tant, `CompositionLocal` ni
 * `isSystemInDarkTheme()`. Necessiten els mateixos colors resolts com a dades.
 *
 * **Per això aquesta funció existeix i `FemhoTheme` la crida.** Si cadascú resolgués el
 * seu, l'app i el widget divergirien el dia que algú afegís un accent, i no ho diria
 * ningú: les dues pantalles es veurien bé per separat. És el mateix argument que
 * justifica `tokens-parity` i la paritat del parser.
 *
 * Aquest fitxer **no és generat**: `Tokens.kt` sí que ho és i no s'hi pot escriure res.
 */

/** El nom que es desa a les preferències → l'accent. Desconegut, el de per defecte. */
fun accentOf(accent: String): FemhoAccent = when (accent) {
    "soft" -> FemhoAccent.SOFT
    "mono-warm" -> FemhoAccent.MONOWARM
    "mono-cool" -> FemhoAccent.MONOCOOL
    else -> FemhoAccent.DEFAULT
}

/**
 * Els colors vius. `dark` ja ve resolt: qui crida sap si mira el sistema
 * (`isSystemInDarkTheme()` a l'app, la configuració del context al widget) o si l'usuari
 * ha triat clar o fosc explícitament.
 */
fun femhoColorsOf(dark: Boolean, accent: String): FemhoColors =
    applyAccent(if (dark) darkColors else lightColors, accentOf(accent))

/** Les parades dels gradients. Mateix criteri que `femhoColorsOf`. */
fun femhoGradientsOf(dark: Boolean): FemhoGradientStops =
    if (dark) darkGradients else lightGradients

/**
 * `--plou-blue` → el color viu del tema. El nom del token no es guarda com a valor: el
 * servidor desa el nom, i què vol dir depèn del tema i de l'accent de qui mira.
 *
 * Un token desconegut torna `inkFaint` i no peta: un àmbit creat des d'una versió més
 * nova del servidor ha de sortir gris, no fer caure la pantalla.
 */
fun FemhoColors.scopeColor(token: String): Color = when (token) {
    "--plou-blue" -> plouBlue
    "--plou-orange" -> plouOrange
    "--plou-pink" -> plouPink
    "--femho-scope-1" -> femhoScope1
    "--femho-scope-2" -> femhoScope2
    "--femho-scope-3" -> femhoScope3
    "--femho-scope-4" -> femhoScope4
    "--femho-scope-5" -> femhoScope5
    "--femho-scope-6" -> femhoScope6
    "--femho-scope-7" -> femhoScope7
    "--femho-scope-8" -> femhoScope8
    else -> inkFaint
}
