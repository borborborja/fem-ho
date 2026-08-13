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
    labels: TaskDetailLabels,
    onSave: (title: String, aiMode: AiMode) -> Unit,
    onStatus: (TaskStatus) -> Unit,
    onToggleItem: (itemId: String, done: Boolean) -> Unit,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var title by remember(task.id) { mutableStateOf(task.title) }
    var aiMode by remember(task.id) { mutableStateOf(task.aiMode) }

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
                .clickable { onSave(title, aiMode) }
                .heightIn(min = FemhoSize.touch)
                .padding(vertical = 14.dp)
                .testTag("task-save"),
        )
    }
}
