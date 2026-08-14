package ho.fem.tasks

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import ho.fem.designsystem.ChecklistRow
import ho.fem.designsystem.EmptyState
import ho.fem.designsystem.Femho
import ho.fem.designsystem.FemhoShape
import ho.fem.designsystem.FemhoSize
import ho.fem.designsystem.FemhoText
import ho.fem.model.AiMode
import ho.fem.model.Checklist
import ho.fem.model.Task
import ho.fem.model.TaskStatus

/**
 * El detall d'una tasca. docs/03 §6, docs/02 §7.
 *
 * **És un full, no una pàgina**: al mòbil, un modal centrat deixa el contingut en una
 * franja i el teclat el tapa. El full puja des de baix i deixa el títol a l'abast del
 * polze.
 *
 * Té menys camps que el modal de la web, i és deliberat: `docs/03` §6 diu que al mòbil
 * s'edita el que es toca sovint —títol, estat, data, mode d'IA, subtasques i llistes— i
 * la resta es fa des de la web. Un formulari de disset camps en una pantalla de 5,5
 * polzades no s'omple; s'abandona.
 */

data class TaskDetailLabels(
    val title: String,
    val description: String,
    val project: String,
    val noProject: String,
    val dueDate: String,
    val dueTime: String,
    val deadline: String,
    val recurrence: String,
    val recurrenceNone: String,
    val recurrenceDaily: String,
    val recurrenceWeekly: String,
    val recurrenceMonthly: String,
    val recurrenceYearly: String,
    val recurrenceFromCompletion: String,
    val status: Map<TaskStatus, String>,
    val aiMode: Map<AiMode, String>,
    val checklists: String,
    val toggle: String,
    val save: String,
    val close: String,
    val emptyChecklists: String,
)

@Composable
fun TaskDetail(
    task: Task,
    checklists: List<Checklist>,
    projects: List<ho.fem.model.Project>,
    labels: TaskDetailLabels,
    onSave: (title: String, aiMode: AiMode) -> Unit,
    onUpdateDetails: (description: String?, projectId: String?, dueDate: String?, dueTime: String?, deadline: String?, rrule: String?, recurrenceMode: String?) -> Unit,
    onStatus: (TaskStatus) -> Unit,
    onToggleItem: (itemId: String, done: Boolean) -> Unit,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var title by remember(task.id) { mutableStateOf(task.title) }
    var aiMode by remember(task.id) { mutableStateOf(task.aiMode) }
    var description by remember(task.id) { mutableStateOf(task.description.orEmpty()) }
    var projectId by remember(task.id) { mutableStateOf(task.projectId) }
    var dueDate by remember(task.id) { mutableStateOf(task.dueDate.orEmpty()) }
    var dueTime by remember(task.id) { mutableStateOf(task.dueTime.orEmpty()) }
    var deadline by remember(task.id) { mutableStateOf(task.deadline.orEmpty()) }
    var rrule by remember(task.id) { mutableStateOf(task.rrule.orEmpty()) }
    var recurrenceMode by remember(task.id) { mutableStateOf(task.recurrenceMode?.name?.lowercase() ?: "schedule") }

    Column(
        modifier = modifier
            .fillMaxSize()
            // El full d'edició és una superfície a pantalla completa. `cardBg` és semi-transparent
            // en mode fosc (blanc al 6%) i deixaria veure el tauler de fons, barrejant els textos.
            // `dialogBg` és el token opac per a superfícies de diàleg i fulls.
            .background(Femho.colors.dialogBg)
            .verticalScroll(rememberScrollState())
            .padding(16.dp)
            .testTag("task-detail"),
        verticalArrangement = Arrangement.spacedBy(FemhoSize.columnGap),
    ) {
        Text(
            text = labels.close,
            color = Femho.colors.inkSoft,
            fontSize = FemhoText.body,
            modifier = Modifier
                .clickable(onClick = onClose)
                .heightIn(min = FemhoSize.touch)
                .padding(vertical = 12.dp)
                .testTag("task-close"),
        )

        OutlinedTextField(
            value = title,
            onValueChange = { title = it },
            singleLine = false,
            label = { Text(labels.title) },
            modifier = Modifier.fillMaxWidth().testTag("task-title"),
        )

        OutlinedTextField(
            value = description,
            onValueChange = { description = it },
            minLines = 2,
            label = { Text(labels.description) },
            modifier = Modifier.fillMaxWidth().testTag("task-description"),
        )

        Text(labels.project, color = Femho.colors.inkSoft, fontSize = FemhoText.meta)
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            val scopeProjects = projects.filter { it.scopeId == task.scopeId }
            val options = listOf<Triple<String?, String, String>>(Triple(null, labels.noProject, "task-project-none")) +
                scopeProjects.map { Triple(it.id, it.name, "task-project-${it.id}") }
            options.forEach { (optionId, optionLabel, tag) ->
                Text(
                    text = optionLabel,
                    color = if (projectId == optionId) Femho.onBrand else Femho.colors.inkSoft,
                    fontSize = FemhoText.meta,
                    fontWeight = if (projectId == optionId) FontWeight.Bold else FontWeight.Medium,
                    modifier = Modifier
                        .clip(RoundedCornerShape(FemhoShape.pill))
                        .background(if (projectId == optionId) Femho.colors.plouBlue else Femho.colors.ghostBg)
                        .clickable { projectId = optionId }
                        .heightIn(min = FemhoSize.touch)
                        .padding(horizontal = 12.dp, vertical = 12.dp)
                        .testTag(tag),
                )
            }
        }

        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            OutlinedTextField(
                value = dueDate,
                onValueChange = { dueDate = it },
                singleLine = true,
                label = { Text(labels.dueDate) },
                modifier = Modifier.weight(1f).testTag("task-due-date"),
            )
            OutlinedTextField(
                value = dueTime,
                onValueChange = { dueTime = it },
                singleLine = true,
                label = { Text(labels.dueTime) },
                modifier = Modifier.weight(1f).testTag("task-due-time"),
            )
        }

        OutlinedTextField(
            value = deadline,
            onValueChange = { deadline = it },
            singleLine = true,
            label = { Text(labels.deadline) },
            modifier = Modifier.fillMaxWidth().testTag("task-deadline"),
        )

        Text(labels.recurrence, color = Femho.colors.inkSoft, fontSize = FemhoText.meta)
        val recurrences = listOf(
            "" to labels.recurrenceNone,
            "FREQ=DAILY" to labels.recurrenceDaily,
            "FREQ=WEEKLY" to labels.recurrenceWeekly,
            "FREQ=MONTHLY" to labels.recurrenceMonthly,
            "FREQ=YEARLY" to labels.recurrenceYearly,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            recurrences.forEach { (rule, ruleLabel) ->
                Text(
                    text = ruleLabel,
                    color = if (rrule == rule) Femho.onBrand else Femho.colors.inkSoft,
                    fontSize = FemhoText.meta,
                    fontWeight = if (rrule == rule) FontWeight.Bold else FontWeight.Medium,
                    modifier = Modifier
                        .clip(RoundedCornerShape(FemhoShape.pill))
                        .background(if (rrule == rule) Femho.colors.plouBlue else Femho.colors.ghostBg)
                        .clickable { rrule = rule }
                        .heightIn(min = FemhoSize.touch)
                        .padding(horizontal = 12.dp, vertical = 12.dp)
                        .testTag("task-recurrence-${rule.ifEmpty { "none" }.substringAfter("FREQ=").lowercase()}"),
                )
            }
        }
        // Una regla que no és cap de les quatre (normalment vinguda per CalDAV) es conserva
        // tal com és: sobreescriure-la seria perdre el que algú va escriure en una altra app.
        if (rrule.isNotEmpty() && recurrences.none { it.first == rrule }) {
            Text(
                text = rrule,
                color = Femho.colors.inkSoft,
                fontSize = FemhoText.meta,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier
                    .clip(RoundedCornerShape(FemhoShape.pill))
                    .background(Femho.colors.ghostBg)
                    .padding(horizontal = 12.dp, vertical = 8.dp)
                    .testTag("task-recurrence-custom"),
            )
        }
        if (rrule.isNotEmpty()) {
            Row(
                verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(
                    text = labels.recurrenceFromCompletion,
                    color = Femho.colors.ink,
                    fontSize = FemhoText.body,
                    modifier = Modifier.weight(1f),
                )
                androidx.compose.material3.Switch(
                    checked = recurrenceMode == "completion",
                    onCheckedChange = { on ->
                        recurrenceMode = if (on) "completion" else "schedule"
                    },
                )
            }
        }

        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            TaskStatus.entries.forEach { status ->
                Text(
                    text = labels.status[status].orEmpty(),
                    color = if (task.status == status) Femho.onBrand else Femho.colors.inkSoft,
                    fontSize = FemhoText.meta,
                    fontWeight = if (task.status == status) FontWeight.Bold else FontWeight.Medium,
                    modifier = Modifier
                        .clip(RoundedCornerShape(FemhoShape.pill))
                        .background(
                            if (task.status == status) Femho.colors.plouBlue else Femho.colors.ghostBg,
                        )
                        .clickable { onStatus(status) }
                        .heightIn(min = FemhoSize.touch)
                        .padding(horizontal = 12.dp, vertical = 12.dp)
                        .testTag("status-${status.name.lowercase()}"),
                )
            }
        }

        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            AiMode.entries.forEach { mode ->
                Text(
                    text = labels.aiMode[mode].orEmpty(),
                    color = if (aiMode == mode) Femho.onBrand else Femho.colors.inkSoft,
                    fontSize = FemhoText.meta,
                    fontWeight = if (aiMode == mode) FontWeight.Bold else FontWeight.Medium,
                    modifier = Modifier
                        .clip(RoundedCornerShape(FemhoShape.pill))
                        .background(if (aiMode == mode) Femho.colors.plouPink else Femho.colors.ghostBg)
                        .clickable { aiMode = mode }
                        .heightIn(min = FemhoSize.touch)
                        .padding(horizontal = 12.dp, vertical = 12.dp)
                        .testTag("ai-${mode.wire}"),
                )
            }
        }

        Text(labels.checklists, color = Femho.colors.ink, fontWeight = FontWeight.ExtraBold)
        if (checklists.isEmpty()) {
            EmptyState(labels.emptyChecklists)
        } else {
            checklists.forEach { checklist ->
                Text(
                    text = checklist.name,
                    color = Femho.colors.inkSoft,
                    fontSize = FemhoText.body,
                    fontWeight = FontWeight.SemiBold,
                )
                checklist.items.forEach { item ->
                    ChecklistRow(
                        text = item.text,
                        done = item.done,
                        toggleLabel = labels.toggle,
                        onToggle = { onToggleItem(item.id, !item.done) },
                    )
                }
            }
        }

        Text(
            text = labels.save,
            color = Femho.onBrand,
            fontSize = FemhoText.body,
            fontWeight = FontWeight.Bold,
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(FemhoShape.pill))
                .background(Femho.brandGradient2)
                .clickable {
                    onSave(title, aiMode)
                    onUpdateDetails(
                        description.ifBlank { null },
                        projectId,
                        dueDate.ifBlank { null },
                        dueTime.ifBlank { null },
                        deadline.ifBlank { null },
                        rrule.ifBlank { null },
                        recurrenceMode,
                    )
                }
                .heightIn(min = FemhoSize.touch)
                .padding(vertical = 14.dp)
                .testTag("task-save"),
        )
    }
}
