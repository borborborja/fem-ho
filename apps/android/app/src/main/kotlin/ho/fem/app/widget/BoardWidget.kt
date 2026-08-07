package ho.fem.app.widget

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.ImageProvider
import androidx.glance.LocalContext
import androidx.glance.LocalSize
import androidx.glance.action.clickable
import androidx.glance.action.actionStartActivity
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxHeight
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.width
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextAlign
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import ho.fem.app.MainActivity
import ho.fem.app.R
import ho.fem.widget.R as WidgetR
import ho.fem.data.Container
import ho.fem.model.TaskStatus
import ho.fem.widget.Dot
import ho.fem.widget.EmptyState
import ho.fem.widget.FemhoGlance
import ho.fem.widget.FemhoWidget
import ho.fem.widget.WidgetSize
import ho.fem.widget.WidgetSurface
import ho.fem.widget.WidgetText
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * El tauler, reduït a quatre xifres.
 *
 * És el widget que menys demana i el que més sovint es mira: quantes coses hi ha a cada
 * columna, sense obrir res. **Funciona sencer sense connexió**, perquè els comptadors
 * surten de Room i no del servidor.
 *
 * La bústia va a part i a dalt, a tota amplada, i les altres tres sota. No és decoració:
 * `docs/02` §4 separa l'Inbox de les tres columnes amb més aire que les tres entre elles
 * (`FemhoSize.inboxGap`), i el widget respecta la mateixa jerarquia que el tauler.
 */
class BoardWidget : GlanceAppWidget() {

    /**
     * Tres talles, no una.
     *
     * A 4×1 les xifres soles ja diuen el que cal; a 2×1 només hi cap la que importa. Un
     * widget que es deixa redimensionar i ensenya el mateix retallat és pitjor que un que
     * no es deixa redimensionar.
     */
    override val sizeMode = SizeMode.Responsive(
        setOf(
            DpSize(110.dp, 48.dp),
            DpSize(250.dp, 48.dp),
            DpSize(250.dp, 110.dp),
        ),
    )

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val widget = widgetContext(context)
        val counts = if (!widget.signedIn) {
            emptyMap()
        } else {
            withContext(Dispatchers.IO) {
                Container.get(context).local.counts(widget.activeScopes)
            }
        }

        provideContent {
            FemhoGlance(widget.palette) {
                WidgetSurface(modifier = GlanceModifier.clickable(actionStartActivity<MainActivity>())) {
                    if (!widget.signedIn) {
                        EmptyState(LocalContext.current.getString(R.string.widget_signedout))
                    } else {
                        BoardContent(counts)
                    }
                }
            }
        }
    }
}

@Composable
private fun BoardContent(counts: Map<TaskStatus, Int>) {
    val size = LocalSize.current
    val narrow = size.width < 180.dp
    val short = size.height < 90.dp

    when {
        // 2×1 · una xifra i prou: tot el que queda per fer.
        narrow -> {
            val pending = counts.entries
                .filter { it.key != TaskStatus.DONE }
                .sumOf { it.value }
            Figure(
                value = pending,
                label = LocalContext.current.getString(R.string.widget_pending),
                emphasis = true,
            )
        }

        // 4×1 · les quatre xifres en fila, sense tessel·les: no hi cabrien.
        short -> Row(modifier = GlanceModifier.fillMaxWidth()) {
            for (column in COLUMNS) {
                Column(modifier = GlanceModifier.defaultWeight()) {
                    Figure(counts[column.status] ?: 0, label(column), emphasis = false)
                }
            }
        }

        // 4×2 · la bústia a dalt, les tres columnes sota.
        else -> Column(modifier = GlanceModifier.fillMaxSize()) {
            Tile(
                column = COLUMNS.first(),
                total = counts[TaskStatus.INBOX] ?: 0,
                modifier = GlanceModifier.fillMaxWidth().defaultWeight(),
            )
            Spacer(GlanceModifier.height(WidgetSize.gap))
            Row(modifier = GlanceModifier.fillMaxWidth().defaultWeight()) {
                COLUMNS.drop(1).forEachIndexed { index, column ->
                    if (index > 0) Spacer(GlanceModifier.width(WidgetSize.rowGap))
                    Tile(
                        column = column,
                        total = counts[column.status] ?: 0,
                        modifier = GlanceModifier.fillMaxHeight().defaultWeight(),
                    )
                }
            }
        }
    }
}

/**
 * Una cel·la: la xifra gran i el nom a sota.
 *
 * **La regla de color de dalt és el que la fa reconeixible.** Cada columna porta el seu
 * to de la tríada de l'accent —el mateix que a l'app— i per tant canviar l'accent a
 * Ajustos repinta el widget. Si el color fos inventat aquí, seria l'única superfície del
 * producte que no obeeix la preferència de la persona.
 */
@Composable
private fun Tile(column: BoardColumn, total: Int, modifier: GlanceModifier) {
    val palette = FemhoWidget.palette
    Column(
        modifier = modifier
            .background(ImageProvider(WidgetR.drawable.femho_widget_tile))
            .padding(horizontal = 10.dp, vertical = 8.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Dot(palette.color(column.tint), size = 6.dp)
            Spacer(GlanceModifier.width(5.dp))
            Text(
                text = label(column),
                style = TextStyle(
                    color = palette.color { inkSoft },
                    fontSize = WidgetText.kicker,
                    fontWeight = FontWeight.Medium,
                ),
            )
        }
        Text(
            text = total.toString(),
            style = TextStyle(
                color = palette.color { ink },
                fontSize = WidgetText.figure,
                fontWeight = FontWeight.Bold,
            ),
        )
    }
}

@Composable
private fun Figure(value: Int, label: String, emphasis: Boolean) {
    val palette = FemhoWidget.palette
    Column(
        modifier = GlanceModifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = value.toString(),
            style = TextStyle(
                color = if (emphasis) palette.color { plouOrange } else palette.color { ink },
                fontSize = WidgetText.figure,
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center,
            ),
        )
        Text(
            text = label,
            style = TextStyle(
                color = palette.color { inkSoft },
                fontSize = WidgetText.kicker,
                textAlign = TextAlign.Center,
            ),
        )
    }
}

@Composable
private fun label(column: BoardColumn): String = LocalContext.current.getString(column.label)

/** El receptor que el sistema instancia. Ha de ser públic i tenir constructor buit. */
class BoardWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = BoardWidget()
}
