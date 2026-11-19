package ho.fem.tasks

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.PageSize
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ho.fem.designsystem.CardAddForm
import ho.fem.designsystem.CardList
import ho.fem.designsystem.EmptyState
import ho.fem.designsystem.Femho
import ho.fem.designsystem.FemhoShape
import ho.fem.designsystem.FemhoSize
import ho.fem.designsystem.FemhoText
import ho.fem.designsystem.KanbanColumn
import ho.fem.designsystem.TaskCard
import ho.fem.model.AiMode
import ho.fem.model.Task
import ho.fem.model.TaskStatus
import kotlinx.coroutines.launch

/**
 * El tauler a Android. docs/03 §4.
 *
 * El pager horitzontal deixa entreveure la columna següent. Els botons de la
 * targeta permeten moure-la sense competir amb el gest del pager.
 *
 * Les columnes són les mateixes quatre i en el mateix ordre que a la web: `inbox`,
 * `todo`, `doing`, `done`. L'ordre és del producte i no es reordena.
 */

data class BoardLabels(
    val columns: Map<TaskStatus, String>,
    val empty: Map<TaskStatus, String>,
    /** "Moure a {columna}", per a la fletxa de la barra dreta. Ja resolt per columna. */
    val advance: Map<TaskStatus, String>,
    val toggle: String,
    /** El pany de l'agent: "L'agent hi treballa". */
    val lock: String,
    /** La marca d'atenció: "Espera resposta". */
    val attention: String,
    /** Reclamar des del kanban de la IA: "Ho agafo jo". */
    val claim: String,
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
private val BoardMargin = 8.dp
private val NextColumnPreview = 32.dp

private object BoardPageSize : PageSize {
    override fun Density.calculateMainAxisPageSize(
        availableSpace: Int,
        pageSpacing: Int,
    ): Int {
        // El pager ja ha tret els marges d'availableSpace. El marge final i l'espai
        // entre columnes són iguals, de manera que els 32dp que traiem queden a la vista.
        return (availableSpace - NextColumnPreview.roundToPx()).coerceAtLeast(1)
    }
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
    /** Reclamar des del kanban de la IA: torna la tasca al tauler humà. */
    onClaim: (Task) -> Unit = {},
    /** Un moviment sobre una targeta bloquejada: es mostra el motiu del pany. */
    onLocked: (Task) -> Unit = {},
    /**
     * El tauler de la IA. **No és una altra pantalla**: són les mateixes columnes amb
     * altres targetes —les que tenen mode d'IA— i la bústia sencera, que és on tot
     * arriba abans de decidir-ho.
     */
    aiBoard: Boolean = false,
    requestedStatus: TaskStatus? = null,
    onStatusOpened: () -> Unit = {},
) {
    val pager = rememberPagerState(pageCount = { ORDER.size })
    val scope = rememberCoroutineScope()
    val columns = remember(tasks, aiBoard) {
        tasks.filter { task ->
            task.status == TaskStatus.INBOX || (task.aiMode != AiMode.MANUAL) == aiBoard
        }.groupBy { it.status }
    }
    LaunchedEffect(requestedStatus) {
        requestedStatus?.let {
            pager.scrollToPage(ORDER.indexOf(it))
            onStatusOpened()
        }
    }

    Column(
        modifier = modifier.fillMaxSize(),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = BoardMargin, end = BoardMargin, bottom = 4.dp)
                .selectableGroup()
                .testTag("board-column-tabs"),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            ORDER.forEachIndexed { index, status ->
                val selected = pager.currentPage == index
                Column(
                    modifier = Modifier
                        .weight(1f)
                        .heightIn(min = FemhoSize.touch)
                        .clip(RoundedCornerShape(FemhoShape.pill))
                        .background(if (selected) Femho.colors.ghostBg else Color.Transparent)
                        .selectable(selected = selected, role = Role.Tab) {
                            scope.launch { pager.animateScrollToPage(index) }
                        }
                        .padding(horizontal = 2.dp, vertical = 3.dp)
                        .testTag("board-column-${status.name.lowercase()}"),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    Text(
                        text = labels.columns[status].orEmpty(),
                        modifier = Modifier.fillMaxWidth(),
                        color = if (selected) Femho.colors.ink else Femho.colors.inkSoft,
                        fontSize = FemhoText.meta,
                        lineHeight = 14.sp,
                        fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
                        textAlign = TextAlign.Center,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        text = columns[status].orEmpty().size.toString(),
                        color = Femho.colors.inkSoft,
                        fontSize = FemhoText.meta,
                        lineHeight = 13.sp,
                        maxLines = 1,
                    )
                }
            }
        }

        HorizontalPager(
            state = pager,
            modifier = Modifier.weight(1f).fillMaxWidth().testTag("board-pager"),
            pageSize = BoardPageSize,
            contentPadding = PaddingValues(horizontal = BoardMargin),
            pageSpacing = BoardMargin,
            verticalAlignment = Alignment.Top,
            key = { ORDER[it] },
        ) { page ->
            val status = ORDER[page]
            val ofColumn = columns[status].orEmpty()

            KanbanColumn(
                inbox = status == TaskStatus.INBOX,
                modifier = Modifier.fillMaxSize().testTag("board-page-${status.name.lowercase()}"),
            ) {
                LazyColumn(
                    // El camp de captura és un germà de la llista i queda accessible
                    // quan una columna és llarga o s'obre el teclat.
                    modifier = Modifier.weight(1f).fillMaxWidth()
                        .testTag("board-list-${status.name.lowercase()}"),
                    verticalArrangement = Arrangement.spacedBy(FemhoSize.cardGap),
                ) {
                    if (ofColumn.isEmpty()) {
                        item { EmptyState(labels.empty[status].orEmpty()) }
                    } else {
                        items(ofColumn, key = { it.id }) { task ->
                            val extra = extras(task)
                            // El pany de l'agent: locked_until al futur bloqueja la targeta
                            val locked = task.lockedUntil?.let { until ->
                                runCatching { java.time.Instant.parse(until) }
                                    .getOrNull()?.isAfter(java.time.Instant.now()) ?: false
                            } ?: false
                            TaskCard(
                                title = task.title,
                                time = task.dueTime,
                                checklistProgress = task.progress?.takeIf { it.total > 0 }
                                    ?.let { "${it.done}/${it.total}" },
                                done = task.status == TaskStatus.DONE,
                                toggleLabel = labels.toggle,
                                // Amb el pany, la casella no mou: mostra el motiu (el 409
                                // que retornaria el servidor si ho intentéssim).
                                onToggle = { if (locked) onLocked(task) else onToggle(task) },
                                onOpen = { onOpen(task) },
                                lockLabel = if (locked) labels.lock else null,
                                attentionLabel = if (task.needsAttention) labels.attention else null,
                                claimLabel = if (aiBoard) labels.claim else null,
                                onClaim = if (aiBoard) ({ onClaim(task) }) else null,
                                /**
                                 * La fletxa **només fins a "Fent"**: a "Fent" i a "Fet" la
                                 * barra és la casella d'estat, que és on acaba el recorregut.
                                 * Amb el pany de l'agent, el moviment queda desactivat.
                                 */
                                onAdvance = if (locked) null else when (status) {
                                    TaskStatus.INBOX -> ({ onMove(task, TaskStatus.TODO) })
                                    TaskStatus.TODO -> ({ onMove(task, TaskStatus.DOING) })
                                    else -> null
                                },
                                advanceLabel = labels.advance[status].orEmpty(),
                                onEdit = extra?.onEdit,
                                editLabel = extra?.editLabel.orEmpty(),
                                lists = extra?.lists.orEmpty(),
                                listsExpanded = extra?.expanded == true,
                                listsToggleLabel = extra?.toggleLabel,
                                onToggleLists = { extra?.onToggleLists?.invoke() },
                                addForm = extra?.addForm,
                                modifier = Modifier.testTag("board-task-${task.id}"),
                            )
                        }
                    }
                }

                footer(status)
            }
        }
    }
}
