package ho.fem.widget

import android.os.Build
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.ColorFilter
import androidx.glance.GlanceModifier
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.appwidget.appWidgetBackground
import androidx.glance.appwidget.cornerRadius
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.padding
import androidx.glance.layout.size
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextAlign
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider

/**
 * El llenguatge visual comú dels quatre widgets.
 *
 * Les mides no són les de l'app i no per capritx: `FemhoSize.pagePadding` són 24dp, que
 * en una superfície de 250dp d'ample se'n menja una cinquena part. La tipografia puja un
 * pas per la raó contrària: un widget es llegeix damunt d'un fons de pantalla qualsevol i
 * a un braç de distància, no en una pantalla que estàs mirant de prop.
 *
 * La proporció de Plou es manté; el que es desplaça és l'escala sencera.
 */
object WidgetSize {
    val padding = 12.dp
    val surfaceRadius = 20.dp
    val tileRadius = 16.dp
    val gap = 8.dp
    val rowGap = 6.dp

    /** Res tocable per sota d'això. `FemhoSize.touch` són 44dp; en un widget, 40 és el sòl. */
    val touch = 40.dp
    val glyph = 20.dp
    val dot = 8.dp
    val bar = 3.dp
}

object WidgetText {
    val title = 15.sp
    val row = 14.sp
    val meta = 11.sp
    val kicker = 10.sp
    val figure = 28.sp
}

/**
 * L'arrel visual: la targeta amb cantonades i vora.
 *
 * `appWidgetBackground()` marca aquest node com **el fons del widget**, que és el que fa
 * que Android 12+ hi apliqui la seva màscara arrodonida i que el llançador el retalli
 * igual que la resta de widgets del telèfon. Sense això, el nostre radi i el del sistema
 * es veurien l'un damunt de l'altre.
 *
 * El radi es demana de dues maneres perquè `cornerRadius` és `@RequiresApi(31)`: per sota
 * el fa el `<shape>` del drawable, que és l'única via que hi ha. El drawable hi és
 * sempre —també dona la vora i el color— i a partir de 31 el sistema hi afegeix el seu.
 */
@Composable
fun WidgetSurface(
    modifier: GlanceModifier = GlanceModifier,
    content: @Composable () -> Unit,
) {
    var shell = GlanceModifier
        .fillMaxSize()
        .appWidgetBackground()
        .background(ImageProvider(R.drawable.femho_widget_surface))
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        shell = shell.cornerRadius(WidgetSize.surfaceRadius)
    }

    Box(modifier = shell.then(modifier).padding(WidgetSize.padding)) { content() }
}

/** Una icona monocroma tenyida amb un color del tema. Cap vector porta color propi. */
@Composable
fun Glyph(
    resId: Int,
    color: ColorProvider,
    size: androidx.compose.ui.unit.Dp = WidgetSize.glyph,
    description: String? = null,
    modifier: GlanceModifier = GlanceModifier,
) {
    Image(
        provider = ImageProvider(resId),
        contentDescription = description,
        modifier = modifier.size(size),
        colorFilter = ColorFilter.tint(color),
    )
}

/** Un punt de color: l'accent a les capçaleres, el color d'àmbit a les llistes. */
@Composable
fun Dot(color: ColorProvider, size: androidx.compose.ui.unit.Dp = WidgetSize.dot) {
    Glyph(R.drawable.femho_dot, color, size)
}

/**
 * El text d'un estat buit.
 *
 * **No és una paret grisa amb una icona trista.** Un tauler net és una bona notícia i
 * s'ha de llegir així: el punt de l'accent i una línia, centrats.
 */
@Composable
fun EmptyState(message: String) {
    val palette = FemhoWidget.palette
    Box(modifier = GlanceModifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Text(
            text = message,
            style = TextStyle(
                color = palette.color { inkSoft },
                fontSize = WidgetText.row,
                textAlign = TextAlign.Center,
            ),
        )
    }
}

/** El text petit en versaletes de dalt d'un grup, com els kickers de l'app. */
@Composable
fun Kicker(text: String, color: ColorProvider) {
    Text(
        text = text.uppercase(),
        style = TextStyle(color = color, fontSize = WidgetText.kicker, fontWeight = FontWeight.Medium),
    )
}
