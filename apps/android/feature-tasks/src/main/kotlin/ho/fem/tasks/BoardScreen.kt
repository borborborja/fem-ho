package ho.fem.tasks

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.onLongClick
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ho.fem.designsystem.CardAddForm
import ho.fem.designsystem.CalendarCardVariant
import ho.fem.designsystem.CardList
import ho.fem.designsystem.EmptyState
import ho.fem.designsystem.Femho
import ho.fem.designsystem.FemhoShape
import ho.fem.designsystem.FemhoSize
import ho.fem.designsystem.FemhoText
import ho.fem.designsystem.KanbanColumn
import ho.fem.designsystem.TaskCard
import ho.fem.model.AiMode
import ho.fem.model.CalendarTaskSuggestion
import ho.fem.model.DoneDayFilter
import ho.fem.model.Task
import ho.fem.model.TaskStatus
import java.time.Instant
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

data class TaskMenuLabels(
    val openActions: String,
    val edit: String,
    val move: String,
    val delete: String,
    val deleteConfirm: String,
    val cancel: String,
    val copyContext: String? = null,
)

data class CardAiAction(
    val label: String,
    val actionLabel: String,
    val copyLabel: String,
    val enabled: Boolean,
    val onClick: () -> Unit,
    val onCopy: () -> Unit,
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
    /** El llapis de la targeta: obre el detall sense haver de clicar el títol. */
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

private enum class TaskDialog { Move, Delete }

private fun Task.isLockedNow(): Boolean = lockedUntil?.let { until ->
    runCatching { Instant.parse(until) }.getOrNull()?.isAfter(Instant.now()) == true
} ?: false

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
    doneDay: DoneDayFilter,
    doneHeader: @Composable () -> Unit = {},
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
    taskMenuLabels: TaskMenuLabels? = null,
    onDelete: (Task) -> Unit = {},
    mcpLabels: McpProvenanceLabels? = null,
    canCopyContext: (Task) -> Boolean = { false },
    onCopyContext: (Task) -> Unit = {},
    aiAction: (Task) -> CardAiAction? = { null },
    calendarGroups: Map<TaskStatus, Map<String, List<CalendarTaskSuggestion>>> = emptyMap(),
    calendarScopeLabel: (String) -> String = { "" },
    calendarSuggestionCard: @Composable (CalendarTaskSuggestion, TaskStatus) -> Unit = { _, _ -> },
    onReturnCalendarSuggestion: ((CalendarTaskSuggestion) -> Unit)? = null,
    calendarTaskMetadata: (@Composable (Task) -> Unit)? = null,
) {
    val pager = rememberPagerState(pageCount = { ORDER.size })
    val scope = rememberCoroutineScope()
    val columns = remember(tasks, aiBoard, doneDay) {
        tasks.filter { task ->
            val belongsToBoard = task.status == TaskStatus.INBOX || (task.aiMode != AiMode.MANUAL) == aiBoard
            belongsToBoard && (task.status != TaskStatus.DONE || doneDay.includes(task.completedAt))
        }.groupBy { it.status }
    }
    var dialogTaskId by rememberSaveable(aiBoard) { mutableStateOf<String?>(null) }
    var dialog by rememberSaveable(aiBoard) { mutableStateOf(TaskDialog.Move) }
    val dialogTask = dialogTaskId?.let { id -> tasks.firstOrNull { it.id == id } }
    val dismissDialog = { dialogTaskId = null }
    LaunchedEffect(requestedStatus) {
        requestedStatus?.let {
            pager.scrollToPage(ORDER.indexOf(it))
            onStatusOpened()
        }
    }

    if (dialogTask != null && taskMenuLabels != null) {
        when (dialog) {
            TaskDialog.Move -> TaskMoveDialog(
                task = dialogTask,
                labels = taskMenuLabels,
                columns = labels.columns,
                onDismiss = dismissDialog,
                onMove = { destination ->
                    dismissDialog()
                    if (dialogTask.isLockedNow()) onLocked(dialogTask) else onMove(dialogTask, destination)
                },
            )
            TaskDialog.Delete -> TaskDeleteDialog(
                task = dialogTask,
                labels = taskMenuLabels,
                onDismiss = dismissDialog,
                onConfirm = {
                    dismissDialog()
                    onDelete(dialogTask)
                },
            )
        }
    }

    val eink = Femho.isEink
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
                            scope.launch {
                                if (eink) pager.scrollToPage(index) else pager.animateScrollToPage(index)
                            }
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
                    val calendarCount = calendarGroups[status].orEmpty().values.sumOf { it.size }
                    Text(
                        text = (columns[status].orEmpty().size + calendarCount).toString(),
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
            val fromCalendar = calendarGroups[status].orEmpty()

            KanbanColumn(
                inbox = status == TaskStatus.INBOX,
                modifier = Modifier.fillMaxSize().testTag("board-page-${status.name.lowercase()}"),
            ) {
                if (status == TaskStatus.DONE) doneHeader()
                LazyColumn(
                    // El camp de captura és un germà de la llista i queda accessible
                    // quan una columna és llarga o s'obre el teclat.
                    modifier = Modifier.weight(1f).fillMaxWidth()
                        .testTag("board-list-${status.name.lowercase()}"),
                    verticalArrangement = Arrangement.spacedBy(FemhoSize.cardGap),
                ) {
                    if (ofColumn.isEmpty() && fromCalendar.isEmpty()) {
                        item { EmptyState(labels.empty[status].orEmpty()) }
                    } else {
                        items(ofColumn, key = { it.id }) { task ->
                            val extra = extras(task)
                            val locked = task.isLockedNow()
                            val mcp = task.mcpActivity
                            Box(Modifier.testTag("board-task-${task.id}")) {
                                var actionsOpen by remember { mutableStateOf(false) }
                                val ai = aiAction(task)
                                TaskCard(
                                    title = task.title,
                                    time = task.dueTime,
                                    checklistProgress = task.progress?.takeIf { it.total > 0 }
                                        ?.let { "${it.done}/${it.total}" },
                                    done = task.status == TaskStatus.DONE,
                                    toggleLabel = labels.toggle,
                                    // Amb el pany, la casella mostra el motiu del bloqueig.
                                    onToggle = { if (locked) onLocked(task) else onToggle(task) },
                                    onOpen = { onOpen(task) },
                                    lockLabel = if (locked) labels.lock else null,
                                    attentionLabel = if (task.needsAttention) labels.attention else null,
                                    claimLabel = if (aiBoard) labels.claim else null,
                                    onClaim = if (aiBoard) ({ onClaim(task) }) else null,
                                    // A "Fent" i a "Fet" la barra és la casella d'estat.
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
                                    onLongPress = taskMenuLabels?.let { { actionsOpen = true } },
                                    longPressLabel = taskMenuLabels?.openActions,
                                    extraMetadata = if ((mcp != null && mcpLabels != null) ||
                                        (task.fromCalendar && calendarTaskMetadata != null)) {
                                        {
                                            if (task.fromCalendar) calendarTaskMetadata?.invoke(task)
                                            if (mcp != null && mcpLabels != null) McpProvenanceBadge(mcp, mcpLabels, compact = true)
                                        }
                                    } else null,
                                    railAction = ai?.let { action -> { CardAiButton(action) } },
                                    calendar = if (task.fromCalendar) CalendarCardVariant.TASK else null,
                                )
                                if (taskMenuLabels != null) {
                                    TaskActionsMenu(
                                        expanded = actionsOpen,
                                        labels = taskMenuLabels,
                                        onDismiss = { actionsOpen = false },
                                        onOpen = {
                                            actionsOpen = false
                                            onOpen(task)
                                        },
                                        onMove = {
                                            actionsOpen = false
                                            if (task.isLockedNow()) {
                                                onLocked(task)
                                            } else {
                                                dialogTaskId = task.id
                                                dialog = TaskDialog.Move
                                            }
                                        },
                                        onDelete = {
                                            actionsOpen = false
                                            dialogTaskId = task.id
                                            dialog = TaskDialog.Delete
                                        },
                                        onCopyContext = if (canCopyContext(task)) {
                                            {
                                                actionsOpen = false
                                                onCopyContext(task)
                                            }
                                        } else null,
                                    )
                                }
                            }
                        }
                    }
                    fromCalendar.forEach { (scopeId, suggestions) ->
                        item(key = "calendar-suggestions:$scopeId") {
                            Text(calendarScopeLabel(scopeId), color = Femho.colors.inkSoft,
                                fontSize = FemhoText.meta, fontWeight = FontWeight.SemiBold,
                                modifier = Modifier.padding(horizontal = 4.dp, vertical = 3.dp))
                        }
                        items(suggestions, key = { "${it.calendarId}\u0000${it.uid}\u0000${it.recurrenceId.orEmpty()}" }) {
                            if (status == TaskStatus.DOING && taskMenuLabels != null && onReturnCalendarSuggestion != null) {
                                var actionsOpen by remember { mutableStateOf(false) }
                                val openActions = { actionsOpen = true }
                                // La pulsació llarga funciona com en una tasca i deixa lliure el lliscament del pager.
                                Box(Modifier
                                    .pointerInput(Unit) { detectTapGestures(onLongPress = { openActions() }) }
                                    .semantics {
                                        onLongClick(taskMenuLabels.openActions) {
                                            openActions()
                                            true
                                        }
                                    }
                                    .testTag("board-calendar-actions"),
                                ) {
                                    calendarSuggestionCard(it, status)
                                    TaskActionsMenu(
                                        expanded = actionsOpen,
                                        labels = taskMenuLabels.copy(move = labels.advance[TaskStatus.DOING] ?: taskMenuLabels.move),
                                        onDismiss = { actionsOpen = false },
                                        onMove = {
                                            actionsOpen = false
                                            onReturnCalendarSuggestion(it)
                                        },
                                    )
                                }
                            } else {
                                calendarSuggestionCard(it, status)
                            }
                        }
                    }
                }

                footer(status)
            }
        }
    }
}

@Composable
private fun CardAiButton(action: CardAiAction) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = FemhoSize.touch)
            .combinedClickable(
                enabled = action.enabled,
                role = Role.Button,
                onClickLabel = action.actionLabel,
                onLongClickLabel = action.copyLabel,
                onClick = action.onClick,
                onLongClick = action.onCopy,
            )
            .testTag("board-task-ai"),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            action.label,
            color = if (action.enabled) Femho.colors.inkSoft else Femho.colors.inkFaint,
            fontSize = FemhoText.meta,
            fontWeight = FontWeight.SemiBold,
        )
    }
}

@Composable
private fun TaskActionsMenu(
    expanded: Boolean,
    labels: TaskMenuLabels,
    onDismiss: () -> Unit,
    onOpen: (() -> Unit)? = null,
    onMove: () -> Unit,
    onDelete: (() -> Unit)? = null,
    onCopyContext: (() -> Unit)? = null,
) {
    DropdownMenu(
        expanded = expanded,
        onDismissRequest = onDismiss,
        modifier = Modifier.testTag("board-task-actions"),
        containerColor = Femho.colors.panelBg,
        tonalElevation = 0.dp,
        shadowElevation = if (Femho.isEink) 0.dp else 8.dp,
        shape = RoundedCornerShape(FemhoShape.card),
        border = BorderStroke(1.dp, Femho.colors.cardBorder),
    ) {
        if (onOpen != null) DropdownMenuItem(
            text = { Text(labels.edit, color = Femho.colors.ink) },
            onClick = onOpen,
            modifier = Modifier.testTag("board-task-edit"),
        )
        DropdownMenuItem(
            text = { Text(labels.move, color = Femho.colors.ink) },
            onClick = onMove,
            modifier = Modifier.testTag("board-task-move"),
        )
        if (onCopyContext != null && labels.copyContext != null) {
            DropdownMenuItem(
                text = { Text(labels.copyContext, color = Femho.colors.ink) },
                onClick = onCopyContext,
                modifier = Modifier.testTag("board-task-copy-context"),
            )
        }
        if (onDelete != null) DropdownMenuItem(
            text = { Text(labels.delete, color = Femho.colors.dangerText) },
            onClick = onDelete,
            modifier = Modifier.testTag("board-task-delete"),
        )
    }
}

@Composable
private fun TaskMoveDialog(
    task: Task,
    labels: TaskMenuLabels,
    columns: Map<TaskStatus, String>,
    onDismiss: () -> Unit,
    onMove: (TaskStatus) -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        modifier = Modifier.testTag("board-task-move-dialog"),
        containerColor = Femho.colors.panelBg,
        titleContentColor = Femho.colors.ink,
        title = { Text(labels.move) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                for (status in ORDER) {
                    val current = status == task.status
                    DropdownMenuItem(
                        text = {
                            Text(
                                columns[status].orEmpty(),
                                color = if (current) Femho.colors.inkSoft else Femho.colors.ink,
                            )
                        },
                        onClick = { onMove(status) },
                        enabled = !current,
                        modifier = Modifier.testTag("board-task-move-${status.name.lowercase()}")
                            .semantics { selected = current },
                    )
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss, modifier = Modifier.testTag("board-task-move-cancel")) {
                Text(labels.cancel, color = Femho.colors.ink)
            }
        },
    )
}

@Composable
private fun TaskDeleteDialog(task: Task, labels: TaskMenuLabels, onDismiss: () -> Unit, onConfirm: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        modifier = Modifier.testTag("board-task-delete-dialog"),
        containerColor = Femho.colors.panelBg,
        titleContentColor = Femho.colors.ink,
        textContentColor = Femho.colors.inkSoft,
        title = { Text(labels.delete) },
        text = {
            Text(
                labels.deleteConfirm.replace("{title}", task.title),
                modifier = Modifier.verticalScroll(rememberScrollState()),
            )
        },
        confirmButton = {
            TextButton(onClick = onConfirm, modifier = Modifier.testTag("board-task-delete-confirm")) {
                Text(labels.delete, color = Femho.colors.dangerText)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, modifier = Modifier.testTag("board-task-delete-cancel")) {
                Text(labels.cancel, color = Femho.colors.ink)
            }
        },
    )
}
