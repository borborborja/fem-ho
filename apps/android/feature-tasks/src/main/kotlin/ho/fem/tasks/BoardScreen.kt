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
import ho.fem.designsystem.CardAddForm
import ho.fem.designsystem.CardList
import ho.fem.designsystem.EmptyState
import ho.fem.designsystem.FemhoSize
import ho.fem.designsystem.KanbanColumn
import ho.fem.designsystem.TaskCard
import ho.fem.model.AiMode
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

/**
 * El que la targeta ensenya per sota del títol: els blocs desplegables i el formulari
 * d'afegir-n'hi.
 *
 * Va en un sol paràmetre i no en vuit: qui munta la pantalla ja té l'estat i les crides,
 * i escampar-los per la signatura faria que afegir-ne un de nou toqués tots els llocs
 * que la criden.
 */
data class CardExtras(
    /** El llapis de la cantonada: obre el detall sense haver de clicar la targeta. */
    val onEdit: () -> Unit,
    val editLabel: String,
    val lists: List<CardList>,
    val expanded: Boolean,
    val toggleLabel: String?,
    val onToggleLists: () -> Unit,
    val addForm: CardAddForm,
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
    /**
     * El peu de cada columna. El disseny validat hi posa l'afegida ràpida de la columna,
     * i abans n'hi havia una de sola sota el tauler que ho enviava tot a la bústia.
     */
    footer: @Composable (TaskStatus) -> Unit = {},
    /** Subtasques, llistes i el formulari d'afegir. `null` vol dir una targeta pelada. */
    extras: (Task) -> CardExtras? = { null },
    /**
     * El tauler de la IA. **No és una altra pantalla**: són les mateixes columnes amb
     * altres targetes —les que tenen mode d'IA— i la bústia sencera, que és on tot
     * arriba abans de decidir-ho.
     */
    aiBoard: Boolean = false,
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
        val ofColumn = tasks
            .filter { it.status == status }
            .filter {
                if (status == TaskStatus.INBOX) {
                    true
                } else {
                    val delegada = it.aiMode != AiMode.MANUAL
                    if (aiBoard) delegada else !delegada
                }
            }

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
                        val extra = extras(task)
                        TaskCard(
                            title = task.title,
                            time = task.dueTime,
                            done = task.status == TaskStatus.DONE,
                            toggleLabel = labels.toggle,
                            onToggle = { onToggle(task) },
                            onOpen = { onOpen(task) },
                            onEdit = extra?.onEdit,
                            editLabel = extra?.editLabel.orEmpty(),
                            lists = extra?.lists.orEmpty(),
                            listsExpanded = extra?.expanded == true,
                            listsToggleLabel = extra?.toggleLabel,
                            onToggleLists = { extra?.onToggleLists?.invoke() },
                            addForm = extra?.addForm,
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

            footer(status)
        }
    }
}
