package ho.fem.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import ho.fem.designsystem.Femho
import ho.fem.designsystem.FemhoText
import ho.fem.model.AiTaskConnections
import ho.fem.model.AiTaskMethod
import ho.fem.model.AiTaskSettings
import ho.fem.model.Scope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

data class AiTaskSettingsLabels(
    val title: String,
    val enabled: String,
    val method: String,
    val methods: Map<AiTaskMethod, String>,
    val subscription: String,
    val scopeId: String,
    val connection: String,
    val routineId: String,
    val routineToken: String,
    val tokenSaved: String,
    val removeToken: String,
    val noSelection: String,
    val notReady: String,
    val noDispatchPermission: String,
    val empty: String,
    val loading: String,
    val loadError: String,
    val saveError: String,
    val saved: String,
    val save: String,
    val retry: String,
    val help: Map<AiTaskMethod, String>,
)

@Composable
fun AiTaskSettingsPanel(
    scopes: List<Scope>,
    settings: List<AiTaskSettings>?,
    labels: AiTaskSettingsLabels,
    load: suspend () -> Unit,
    loadConnections: suspend (String) -> AiTaskConnections,
    save: suspend (AiTaskSettings, AiTaskSettings, String?, Boolean) -> Unit,
) {
    var attempt by remember { mutableIntStateOf(0) }
    var failed by remember { mutableStateOf(false) }
    LaunchedEffect(attempt) {
        failed = false
        failed = requestFailed { load() }
    }

    if (failed || settings == null || settings.isEmpty()) {
        Group(labels.title) {
            when {
                failed -> {
                    Text(labels.loadError, color = Femho.colors.dangerText)
                    TextButton(
                        onClick = { attempt++ },
                        colors = ButtonDefaults.textButtonColors(contentColor = Femho.colors.ink),
                    ) { Text(labels.retry) }
                }
                settings == null -> Text(labels.loading, color = Femho.colors.inkSoft)
                else -> Text(labels.empty, color = Femho.colors.inkSoft)
            }
        }
    }
    if (!failed) {
        settings.orEmpty().forEach { setting ->
            val scope = scopes.firstOrNull { it.id == setting.scopeId } ?: return@forEach
            key(scope.id) { ScopeAiTasks(scope, setting, labels, loadConnections, save) }
        }
    }
}

@Composable
private fun ScopeAiTasks(
    scope: Scope,
    settings: AiTaskSettings,
    labels: AiTaskSettingsLabels,
    loadConnections: suspend (String) -> AiTaskConnections,
    save: suspend (AiTaskSettings, AiTaskSettings, String?, Boolean) -> Unit,
) {
    var draft by remember(settings) { mutableStateOf(settings) }
    // Una credencial nova no es pot quedar al Bundle de l'Activity.
    var token by remember { mutableStateOf("") }
    var removeToken by remember { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }
    var saved by remember { mutableStateOf<Boolean?>(null) }
    var connections by remember { mutableStateOf<AiTaskConnections?>(null) }
    var connectionsFailed by remember { mutableStateOf(false) }
    var attempt by remember { mutableIntStateOf(0) }
    val composableScope = rememberCoroutineScope()
    val needsConnection = draft.method != AiTaskMethod.COPY
    val textButtonColors = ButtonDefaults.textButtonColors(contentColor = Femho.colors.ink)
    val changeDraft: (AiTaskSettings) -> Unit = { draft = it; saved = null }
    LaunchedEffect(needsConnection, attempt) {
        if (needsConnection) {
            connectionsFailed = false
            connectionsFailed = requestFailed { connections = loadConnections(scope.id) }
        }
    }

    Group(scope.name) {
        Row(
            modifier = Modifier.fillMaxWidth().toggleable(
                value = draft.enabled,
                enabled = !saving,
                role = Role.Switch,
                onValueChange = { changeDraft(draft.copy(enabled = it)) },
            ).testTag("ai-tasks-enabled"),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(labels.enabled, modifier = Modifier.weight(1f), color = Femho.colors.ink)
            Switch(
                checked = draft.enabled,
                onCheckedChange = null,
                enabled = !saving,
                colors = SwitchDefaults.colors(checkedThumbColor = Femho.onBrand, checkedTrackColor = Femho.colors.plouBlue),
            )
        }
        OptionMenu(labels.method, labels.methods.getValue(draft.method), labels.methods.toList(), !saving) {
            changeDraft(draft.copy(method = it))
        }
        labels.help[draft.method]?.let { Text(it, color = Femho.colors.inkSoft, fontSize = FemhoText.meta) }
        if (needsConnection && connectionsFailed) {
            Text(labels.loadError, color = Femho.colors.dangerText)
            TextButton(onClick = { attempt++ }, colors = textButtonColors) { Text(labels.retry) }
        }
        if (draft.method == AiTaskMethod.MCP_EVENTS) {
            Text(labels.scopeId, color = Femho.colors.ink, fontSize = FemhoText.meta)
            SelectionContainer {
                Text(scope.id, color = Femho.colors.inkSoft, fontSize = FemhoText.meta)
            }
            val options = connections?.subscriptions.orEmpty().map { it.id to it.label }
            OptionMenu(labels.subscription, selectedLabel(options, draft.subscriptionId, labels),
                listOf(null to labels.noSelection) + options, !saving && connections != null) {
                changeDraft(draft.copy(subscriptionId = it))
            }
        }
        if (draft.method == AiTaskMethod.CLAUDE_ROUTINE) {
            val options = connections?.connections.orEmpty().map { it.id to it.label }
            OptionMenu(labels.connection, selectedLabel(options, draft.connectionId, labels),
                listOf(null to labels.noSelection) + options, !saving && connections != null) {
                changeDraft(draft.copy(connectionId = it))
            }
            OutlinedTextField(
                value = draft.routineId.orEmpty(),
                onValueChange = { changeDraft(draft.copy(routineId = it.ifEmpty { null })) },
                modifier = Modifier.fillMaxWidth().testTag("ai-tasks-routine-id"),
                label = { Text(labels.routineId) },
                singleLine = true,
                enabled = !saving,
            )
            OutlinedTextField(
                value = token,
                onValueChange = { token = it; removeToken = false; saved = null },
                modifier = Modifier.fillMaxWidth().testTag("ai-tasks-routine-token"),
                label = { Text(labels.routineToken) },
                placeholder = if (settings.hasRoutineToken && !removeToken) {
                    { Text(labels.tokenSaved) }
                } else null,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                singleLine = true,
                enabled = !saving,
            )
            if (settings.hasRoutineToken && !removeToken) {
                TextButton(enabled = !saving, colors = textButtonColors, onClick = { token = ""; removeToken = true; saved = null }) {
                    Text(labels.removeToken)
                }
            }
        }
        if (settings.enabled && settings.method != AiTaskMethod.COPY && draft == settings) {
            if (!settings.ready) Text(labels.notReady, color = Femho.colors.inkSoft)
            else if (!settings.canDispatch) Text(labels.noDispatchPermission, color = Femho.colors.inkSoft)
        }
        saved?.let { ok ->
            Text(if (ok) labels.saved else labels.saveError, color = if (ok) Femho.colors.inkSoft else Femho.colors.dangerText)
        }
        val hasChanges = draft != settings || token.isNotBlank() || removeToken
        Button(
            enabled = !saving && hasChanges,
            colors = ButtonDefaults.buttonColors(containerColor = Femho.colors.plouBlue, contentColor = Femho.onBrand),
            onClick = {
                saving = true
                composableScope.launch {
                    val routineId = draft.routineId?.trim()?.ifEmpty { null }
                    val failed = requestFailed {
                        save(draft.copy(routineId = routineId), settings, token.trim().ifEmpty { null }, removeToken)
                    }
                    if (!failed) {
                        token = ""
                        removeToken = false
                    }
                    saved = !failed
                    saving = false
                }
            },
            modifier = Modifier.testTag("ai-tasks-save"),
        ) { Text(labels.save) }
    }
}

private fun selectedLabel(options: List<Pair<String, String>>, id: String?, labels: AiTaskSettingsLabels): String =
    options.firstOrNull { it.first == id }?.second ?: labels.noSelection

@Composable
private fun <T> OptionMenu(label: String, selection: String, options: List<Pair<T, String>>, enabled: Boolean, onSelect: (T) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    Text(label, color = Femho.colors.ink, fontSize = FemhoText.meta)
    Box {
        OutlinedButton(
            enabled = enabled,
            onClick = { expanded = true },
            colors = ButtonDefaults.outlinedButtonColors(contentColor = Femho.colors.ink),
        ) { Text(selection) }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }, containerColor = Femho.colors.cardBg) {
            options.forEach { (value, title) ->
                DropdownMenuItem(text = { Text(title, color = Femho.colors.ink) }, onClick = {
                    expanded = false
                    onSelect(value)
                })
            }
        }
    }
}

private suspend inline fun requestFailed(action: () -> Unit): Boolean = try {
    action()
    false
} catch (error: CancellationException) {
    throw error
} catch (_: Exception) {
    true
}
