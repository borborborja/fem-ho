package ho.fem.calendar

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import ho.fem.designsystem.EmptyState
import ho.fem.designsystem.Femho
import ho.fem.designsystem.FemhoShape
import ho.fem.designsystem.FemhoText
import ho.fem.model.InboxEvent
import ho.fem.model.Task

/**
 * La bústia d'un dia a Android: **les tasques més el que arriba de les fonts**.
 *
 * Fins ara, aquesta pantalla demanava `/api/v1/inbox` i **llençava el resultat**: la
 * crida es feia a `loadCalendar` i no es pintava enlloc. O sigui que al costat del
 * calendari no hi havia el dipòsit del dia que la web sí que té, i les dues apps —que el
 * producte vol que se sentin la mateixa cosa— divergien en la pantalla principal.
 *
 * P4 val igual aquí que a la web: **el mateix component al calendari i sobre la columna
 * del tauler**, amb la mateixa font de dades. S'escriu així des del primer dia perquè
 * després no es fa.
 *
 * PER QUÈ UNA CITA NO ES DIBUIXA COM UNA TASCA
 * --------------------------------------------
 * La regla 7 esmenada diu que un esdeveniment **no té mai estat de kanban ni s'arrossega
 * entre columnes**: a la bústia hi pot sortir com a font, mai com a targeta de tasca. Si
 * es dibuixessin igual, la distinció seria una nota al peu d'un document.
 *
 * La diferència va a **la superfície i la forma** —vora discontínua, un altre fons— i no
 * al contrast: `docs/04` §8 reserva el to tènue per a text decoratiu i prohibeix
 * fer-lo servir per a res que calgui llegir. Una cita de la bústia s'ha de llegir.
 */
@Composable
fun InboxRail(
    tasks: List<Task>,
    events: List<InboxEvent>,
    colorOf: (String) -> Color,
    labels: InboxLabels,
    modifier: Modifier = Modifier,
    onOpenTask: (Task) -> Unit = {},
    onEventToTask: (InboxEvent) -> Unit = {},
    onEventRemove: (InboxEvent) -> Unit = {},
) {
    Column(
        modifier = modifier.fillMaxWidth().padding(12.dp).testTag("inbox-rail"),
        verticalArrangement = Arrangement.spacedBy(9.dp),
    ) {
        Text(
            text = labels.title,
            color = Femho.colors.ink,
            fontSize = FemhoText.cardTitle,
            fontWeight = FontWeight.Bold,
        )

        if (tasks.isEmpty() && events.isEmpty()) {
            EmptyState(labels.empty)
        }

        tasks.forEach { task ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(FemhoShape.card))
                    .background(Femho.colors.cardBg)
                    .clickable { onOpenTask(task) }
                    .padding(horizontal = 12.dp, vertical = 10.dp)
                    .testTag("inbox-task-${task.id}"),
                horizontalArrangement = Arrangement.spacedBy(9.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(Modifier.size(7.dp).clip(CircleShape).background(colorOf(task.scopeId)))
                Text(
                    text = task.title,
                    color = Femho.colors.ink,
                    fontSize = FemhoText.cardTitle,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.weight(1f),
                )
            }
        }

        if (events.isNotEmpty()) {
            Text(
                text = labels.fromCalendar,
                color = Femho.colors.inkSoft,
                fontSize = FemhoText.meta,
                fontWeight = FontWeight.Bold,
            )
        }

        events.forEach { event ->
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(FemhoShape.card))
                    .background(Femho.colors.tagBg)
                    // La vora és el senyal de "ve de fora i encara no és feina teva". No
                    // hi ha `dashed` a Compose sense dibuixar-la a mà; el que la
                    // distingeix aquí és que en té i una targeta de tasca no.
                    .border(1.dp, Femho.colors.cardBorder, RoundedCornerShape(FemhoShape.card))
                    .padding(horizontal = 12.dp, vertical = 10.dp)
                    .testTag("inbox-event-${event.key}"),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(9.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(Modifier.size(7.dp).clip(CircleShape).background(colorOf(event.scopeId)))
                    Text(
                        text = if (event.allDay) labels.allDay else event.startsAt.substring(11, 16),
                        color = Femho.colors.inkSoft,
                        fontSize = FemhoText.meta,
                        fontWeight = FontWeight.Bold,
                    )
                    Text(
                        text = event.summary,
                        color = Femho.colors.ink,
                        fontSize = FemhoText.cardTitle,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.weight(1f),
                    )
                }
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    // D'on ve. Sense això, una cita de l'escola i un titular d'RSS es
                    // veuen igual, i la primera pregunta de qualsevol és d'on ha sortit.
                    Text(
                        text = event.calendarName,
                        color = Femho.colors.inkSoft,
                        fontSize = FemhoText.meta,
                        modifier = Modifier.weight(1f),
                    )
                    Text(
                        text = labels.toTask,
                        color = Femho.colors.inkSoft,
                        fontSize = FemhoText.meta,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier
                            .clickable { onEventToTask(event) }
                            .testTag("inbox-event-totask-${event.key}"),
                    )
                    Text(
                        text = labels.remove,
                        color = Femho.colors.inkSoft,
                        fontSize = FemhoText.meta,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier
                            .clickable { onEventRemove(event) }
                            .testTag("inbox-event-remove-${event.key}"),
                    )
                }
            }
        }
    }
}

/**
 * Els textos, des de fora.
 *
 * Un component del design system no sap ni d'idiomes ni de catàlegs: els rep ja resolts,
 * igual que `CalendarLabels`.
 */
data class InboxLabels(
    val title: String,
    val empty: String,
    val fromCalendar: String,
    val allDay: String,
    val toTask: String,
    val remove: String,
)
