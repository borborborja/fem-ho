package ho.fem.tasks

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.PageSize
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import ho.fem.designsystem.EmptyState
import ho.fem.designsystem.FemhoSize
import ho.fem.designsystem.KanbanColumn
import ho.fem.designsystem.TaskCard
import ho.fem.model.Task
import ho.fem.model.TaskStatus

/**
 * El tauler a Android. docs/03 §4.
 *
 * **Pager horitzontal al 80% d'amplada, i moviment per botons, pulsació llarga i
 * lliscament — no arrossegament lliure.** El document ho diu i la raó és física: un
 * arrossegament lliure competeix amb el gest del pager, i el resultat és que ni
 * s'arrossega ni es canvia de columna. Els botons "→ Per fer" i "→ Fent" de les
 * targetes de l'Inbox fan la feina sense gest ambigu.
 *
 * Les columnes són les mateixes quatre i en el mateix ordre que a la web: `inbox`,
 * `todo`, `doing`, `done`. L'ordre és del producte i no es reordena.
 */

data class BoardLabels(
    val columns: Map<TaskStatus, String>,
    val empty: Map<TaskStatus, String>,
    val toTodo: String,
    val toDoing: String,
    val toggle: String,
)

private val ORDER = listOf(TaskStatus.INBOX, TaskStatus.TODO, TaskStatus.DOING, TaskStatus.DONE)

/**
 * Una pàgina que ocupa una fracció de l'amplada.
 *
 * `PageSize.Fill` la faria sencera i no es veuria la columna següent, que és el que
 * convida a lliscar-hi. Compose no en porta cap de fraccionària, i són quatre línies.
 */
private class FractionPageSize(private val fraction: Float) : PageSize {
    override fun androidx.compose.ui.unit.Density.calculateMainAxisPageSize(
        availableSpace: Int,
        pageSpacing: Int,
    ): Int = ((availableSpace - pageSpacing) * fraction).toInt()
}

@Composable
fun BoardScreen(
    tasks: List<Task>,
    labels: BoardLabels,
    onOpen: (Task) -> Unit,
    onMove: (Task, TaskStatus) -> Unit,
    onToggle: (Task) -> Unit,
    modifier: Modifier = Modifier,
) {
    val pager = rememberPagerState(pageCount = { ORDER.size })

    HorizontalPager(
        state = pager,
        modifier = modifier.fillMaxSize().testTag("board-pager"),
        // 80% d'amplada: la columna següent s'endevina i convida a lliscar-hi.
        pageSize = FractionPageSize(0.8f),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 12.dp),
        pageSpacing = FemhoSize.columnGap,
    ) { page ->
        val status = ORDER[page]
        val ofColumn = tasks.filter { it.status == status }

        KanbanColumn(
            label = labels.columns[status].orEmpty(),
            count = ofColumn.size,
            inbox = status == TaskStatus.INBOX,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(
                modifier = Modifier.verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(FemhoSize.cardGap),
            ) {
                if (ofColumn.isEmpty()) {
                    EmptyState(labels.empty[status].orEmpty())
                } else {
                    ofColumn.forEach { task ->
                        TaskCard(
                            title = task.title,
                            time = task.dueTime,
                            done = task.status == TaskStatus.DONE,
                            toggleLabel = labels.toggle,
                            onToggle = { onToggle(task) },
                            onOpen = { onOpen(task) },
                            // Accions ràpides NOMÉS a l'Inbox, com a la web.
                            quickActions = if (status == TaskStatus.INBOX) {
                                listOf(
                                    labels.toTodo to { onMove(task, TaskStatus.TODO) },
                                    labels.toDoing to { onMove(task, TaskStatus.DOING) },
                                )
                            } else {
                                emptyList()
                            },
                            modifier = Modifier.padding(bottom = 0.dp),
                        )
                    }
                }
            }
        }
    }
}
