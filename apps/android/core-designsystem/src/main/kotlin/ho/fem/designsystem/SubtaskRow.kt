package ho.fem.designsystem

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.onLongClick
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp

data class SubtaskRowLabels(
    val actions: String,
    val edit: String,
    val delete: String,
    val deleteConfirm: String,
    val title: String,
    val save: String,
    val cancel: String,
    val error: String,
)

data class SubtaskRowActions(
    val labels: SubtaskRowLabels,
    val onEdit: (String, (Boolean) -> Unit) -> Unit,
    val onDelete: () -> Unit,
)

@Composable
fun SubtaskRow(
    title: String,
    done: Boolean,
    toggleLabel: String,
    onToggle: () -> Unit,
    actions: SubtaskRowActions,
) {
    val labels = actions.labels
    var menu by remember { mutableStateOf(false) }
    var draft by rememberSaveable { mutableStateOf<String?>(null) }
    var confirmingDelete by rememberSaveable { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }
    var failed by remember { mutableStateOf(false) }
    val edit by rememberUpdatedState({
        failed = false
        draft = title
    })

    ChecklistRow(
        text = title,
        done = done,
        toggleLabel = toggleLabel,
        onToggle = onToggle,
        titleModifier = Modifier.testTag("subtask-title")
            .pointerInput(Unit) { detectTapGestures(onLongPress = { edit() }) }
            .semantics {
                onLongClick(labels.edit) {
                    edit()
                    true
                }
            },
        trailing = {
            Box {
                IconButton(
                    onClick = { menu = true },
                    modifier = Modifier.size(FemhoSize.touch).testTag("subtask-actions")
                        .semantics { contentDescription = labels.actions },
                ) {
                    val color = Femho.colors.inkSoft
                    Canvas(Modifier.size(16.dp)) {
                        for (x in listOf(0.22f, 0.5f, 0.78f)) {
                            drawCircle(color, radius = 1.4.dp.toPx(), center = Offset(size.width * x, size.height / 2))
                        }
                    }
                }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    DropdownMenuItem(text = { Text(labels.edit) }, onClick = {
                        menu = false
                        edit()
                    })
                    DropdownMenuItem(text = { Text(labels.delete) }, onClick = {
                        menu = false
                        confirmingDelete = true
                    })
                }
            }
        },
    )

    draft?.let { value ->
        val focusRequester = remember { FocusRequester() }
        fun submit() {
            if (value.isBlank() || saving) return
            saving = true
            actions.onEdit(value.trim()) { persisted ->
                saving = false
                if (persisted) draft = null else failed = true
            }
        }
        AlertDialog(
            onDismissRequest = { if (!saving) draft = null },
            title = { Text(labels.edit) },
            text = {
                OutlinedTextField(
                    value = value,
                    onValueChange = {
                        draft = it
                        failed = false
                    },
                    modifier = Modifier.fillMaxWidth().focusRequester(focusRequester).testTag("subtask-editor"),
                    label = { Text(labels.title) },
                    singleLine = true,
                    enabled = !saving,
                    isError = failed,
                    supportingText = if (failed) ({ Text(labels.error) }) else null,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = { submit() }),
                )
                LaunchedEffect(Unit) { focusRequester.requestFocus() }
            },
            confirmButton = {
                TextButton(enabled = value.isNotBlank() && !saving, onClick = ::submit) { Text(labels.save) }
            },
            dismissButton = {
                TextButton(enabled = !saving, onClick = { draft = null }) { Text(labels.cancel) }
            },
        )
    }

    if (confirmingDelete) {
        AlertDialog(
            onDismissRequest = { confirmingDelete = false },
            title = { Text(labels.delete) },
            text = { Text(labels.deleteConfirm.replace("{title}", title)) },
            confirmButton = {
                TextButton(onClick = {
                    confirmingDelete = false
                    actions.onDelete()
                }) { Text(labels.delete) }
            },
            dismissButton = {
                TextButton(onClick = { confirmingDelete = false }) { Text(labels.cancel) }
            },
        )
    }
}
