package ho.fem.app

import android.net.Uri
import android.os.SystemClock
import android.widget.Toast
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ho.fem.designsystem.Femho
import ho.fem.designsystem.FemhoText
import ho.fem.model.AiExecution
import ho.fem.model.AiTaskMethod
import ho.fem.model.Scope
import ho.fem.model.Task
import ho.fem.settings.AiTaskSettingsLabels
import ho.fem.settings.AiTaskSettingsPanel
import ho.fem.tasks.CardAiAction
import java.time.Duration
import java.time.Instant
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
internal fun AiTaskSettingsHost(model: AppViewModel, scopes: List<Scope>) {
    val settings by model.aiTaskSettings.collectAsStateWithLifecycle()
    AiTaskSettingsPanel(
        scopes = scopes,
        settings = settings,
        labels = AiTaskSettingsLabels(
            title = stringResource(R.string.settings_tab_aitasks),
            enabled = stringResource(R.string.ai_tasks_enabled),
            method = stringResource(R.string.ai_tasks_method),
            methods = mapOf(
                AiTaskMethod.COPY to stringResource(R.string.ai_tasks_method_copy),
                AiTaskMethod.MCP_EVENTS to stringResource(R.string.ai_tasks_method_mcpevents),
                AiTaskMethod.CLAUDE_ROUTINE to stringResource(R.string.ai_tasks_method_clauderoutine),
            ),
            subscription = stringResource(R.string.ai_tasks_subscription),
            scopeId = stringResource(R.string.ai_tasks_scopeid),
            connection = stringResource(R.string.ai_tasks_connection),
            routineId = stringResource(R.string.ai_tasks_routineid),
            routineToken = stringResource(R.string.ai_tasks_routinetoken),
            tokenSaved = stringResource(R.string.ai_tasks_routinetokensaved),
            removeToken = stringResource(R.string.ai_tasks_routinetokenremove),
            noSelection = stringResource(R.string.ai_tasks_noselection),
            notReady = stringResource(R.string.ai_tasks_notready),
            noDispatchPermission = stringResource(R.string.ai_tasks_nodispatchpermission),
            empty = stringResource(R.string.ai_tasks_empty),
            loading = stringResource(R.string.state_loading),
            loadError = stringResource(R.string.ai_tasks_loaderror),
            saveError = stringResource(R.string.ai_tasks_saveerror),
            saved = stringResource(R.string.ai_tasks_saved),
            save = stringResource(R.string.nav_save),
            retry = stringResource(R.string.nav_retry),
            help = mapOf(
                AiTaskMethod.MCP_EVENTS to stringResource(R.string.ai_tasks_help_mcpevents),
                AiTaskMethod.CLAUDE_ROUTINE to stringResource(R.string.ai_tasks_help_clauderoutine),
            ),
        ),
        load = model::loadAiTaskSettings,
        loadConnections = model::aiTaskConnections,
        save = model::saveAiTaskSettings,
    )
}

@Composable
internal fun rememberCopyTaskContext(model: AppViewModel): (String) -> Unit {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val copied = stringResource(R.string.ai_tasks_copydone)
    val failed = stringResource(R.string.ai_tasks_copyerror)
    var fallback by remember { mutableStateOf<String?>(null) }
    fallback?.let { text ->
        AlertDialog(
            onDismissRequest = { fallback = null },
            title = { Text(stringResource(R.string.ai_tasks_copyfallbacktitle)) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(stringResource(R.string.ai_tasks_copyfallback))
                    SelectionContainer {
                        Text(text, Modifier.heightIn(max = 320.dp).verticalScroll(rememberScrollState()))
                    }
                }
            },
            confirmButton = {
                TextButton(
                    onClick = { fallback = null },
                    colors = ButtonDefaults.textButtonColors(contentColor = Femho.colors.ink),
                ) { Text(stringResource(R.string.nav_close)) }
            },
        )
    }
    return { taskId ->
        scope.launch {
            val text = aiResponse { model.aiTaskContext(taskId) }
            if (text == null) {
                Toast.makeText(context, failed, Toast.LENGTH_SHORT).show()
            } else {
                runCatching { model.copyAiContextToClipboard(text) }
                    .onSuccess { Toast.makeText(context, copied, Toast.LENGTH_SHORT).show() }
                    .onFailure { fallback = text }
            }
        }
    }
}

@Composable
internal fun rememberCardAiAction(model: AppViewModel, copy: (String) -> Unit): (Task) -> CardAiAction? {
    val settings by model.aiTaskSettings.collectAsStateWithLifecycle()
    val busy by model.aiExecutingTasks.collectAsStateWithLifecycle()
    val coroutine = rememberCoroutineScope()
    val context = LocalContext.current
    val label = stringResource(R.string.ai_tasks_button)
    val copyLabel = stringResource(R.string.ai_tasks_copy)
    val sendLabel = stringResource(R.string.ai_tasks_send)
    val failed = stringResource(R.string.ai_tasks_senderror)
    return { task ->
        settings?.firstOrNull { it.scopeId == task.scopeId && it.enabled }?.let { setting ->
            val copies = setting.method == AiTaskMethod.COPY
            CardAiAction(
                label = label,
                actionLabel = if (copies) copyLabel else sendLabel,
                copyLabel = copyLabel,
                enabled = task.id !in busy,
                onClick = {
                    when {
                        copies -> copy(task.id)
                        !setting.ready || !setting.canDispatch -> model.open(task)
                        else -> coroutine.launch {
                            if (aiResponse { model.requestAiExecution(task.id) } != null) {
                                model.open(task)
                            } else {
                                Toast.makeText(context, failed, Toast.LENGTH_SHORT).show()
                            }
                        }
                    }
                },
                onCopy = { copy(task.id) },
            )
        }
    }
}

@Composable
internal fun TaskAiActions(model: AppViewModel, task: Task, formatTime: (String) -> String?) {
    val settings by model.aiTaskSettings.collectAsStateWithLifecycle()
    val busy by model.aiExecutingTasks.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) {
        if (settings == null) aiResponse { model.loadAiTaskSettings() }
    }
    val setting = settings?.firstOrNull { it.scopeId == task.scopeId } ?: return
    val copy = rememberCopyTaskContext(model)
    val scope = rememberCoroutineScope()
    var latest by remember(task.id) { mutableStateOf<AiExecution?>(null) }
    var loadFailed by remember(task.id) { mutableStateOf(false) }
    var revision by remember(task.id) { mutableIntStateOf(0) }
    var sendFailed by remember(task.id) { mutableStateOf(false) }

    LaunchedEffect(task.id, revision) {
        val started = SystemClock.elapsedRealtime()
        do {
            val executions = aiResponse { model.aiExecutions(task.id) }
            loadFailed = executions == null
            if (executions == null) break
            val execution = executions.firstOrNull()
            if (latest != execution) {
                model.refreshAiExecutionResult(task.id)
                if (execution != null) sendFailed = false
            }
            latest = execution
            when {
                execution?.pending == true -> delay(3_000)
                execution?.status == "delivered" && execution.resultCommentId == null &&
                    SystemClock.elapsedRealtime() - started < 600_000 -> delay(10_000)
                else -> break
            }
        } while (true)
    }

    val retryAt = latest?.retryAt
    var awaitingRetry by remember(retryAt) {
        mutableStateOf(retryAt?.let { runCatching { Instant.parse(it).isAfter(Instant.now()) }.getOrDefault(false) } == true)
    }
    LaunchedEffect(retryAt) {
        if (retryAt != null && awaitingRetry) {
            delay(Duration.between(Instant.now(), Instant.parse(retryAt)).toMillis())
            awaitingRetry = false
        }
    }
    if (!setting.enabled && latest == null) return
    val canSend = setting.enabled && setting.method != AiTaskMethod.COPY && setting.ready && setting.canDispatch &&
        task.id !in busy && latest?.pending != true && !awaitingRetry
    val actionColors = ButtonDefaults.buttonColors(containerColor = Femho.colors.plouBlue, contentColor = Femho.onBrand)
    val textActionColors = ButtonDefaults.textButtonColors(contentColor = Femho.colors.ink)
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        if (setting.enabled) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (setting.method == AiTaskMethod.COPY) {
                    Button(onClick = { copy(task.id) }, colors = actionColors, modifier = Modifier.testTag("task-ai-copy")) {
                        Text(stringResource(R.string.ai_tasks_copy))
                    }
                } else {
                    Button(
                        enabled = canSend,
                        colors = actionColors,
                        onClick = {
                            sendFailed = false
                            scope.launch {
                                val response = aiResponse { model.requestAiExecution(task.id) }
                                if (response != null) {
                                    latest = response
                                    model.refreshAiExecutionResult(task.id)
                                }
                                sendFailed = response == null
                                revision++
                            }
                        },
                        modifier = Modifier.testTag("task-ai-send"),
                    ) { Text(stringResource(R.string.ai_tasks_send)) }
                    TextButton(onClick = { copy(task.id) }, colors = textActionColors, modifier = Modifier.testTag("task-ai-copy")) {
                        Text(stringResource(R.string.ai_tasks_copy))
                    }
                }
            }
            if (setting.method != AiTaskMethod.COPY) {
                if (!setting.ready) {
                    TaskAiNotice(stringResource(R.string.ai_tasks_notready))
                } else if (!setting.canDispatch) {
                    TaskAiNotice(stringResource(R.string.ai_tasks_nodispatchpermission))
                }
            }
        }
        latest?.let { execution ->
            val status = when (execution.status) {
                "queued" -> R.string.ai_tasks_status_queued
                "sending" -> R.string.ai_tasks_status_sending
                "delivered" -> if (execution.method == AiTaskMethod.MCP_EVENTS) {
                    R.string.ai_tasks_status_mcpdelivered
                } else R.string.ai_tasks_status_claudedelivered
                "failed" -> R.string.ai_tasks_status_failed
                "cancelled" -> R.string.ai_tasks_status_cancelled
                "uncertain" -> R.string.ai_tasks_status_uncertain
                else -> null
            }
            status?.let {
                Text(
                    stringResource(it),
                    color = Femho.colors.inkSoft,
                    fontSize = FemhoText.meta,
                    modifier = Modifier.testTag("task-ai-execution-status"),
                )
            }
            if (awaitingRetry) execution.retryAt?.let(formatTime)?.let { time ->
                TaskAiNotice(stringResource(R.string.ai_tasks_retryat).replace("{when}", time))
            }
            if (execution.method == AiTaskMethod.CLAUDE_ROUTINE) {
                execution.sessionUrl?.takeIf(::isClaudeSession)?.let { url ->
                    val uriHandler = LocalUriHandler.current
                    val context = LocalContext.current
                    val error = stringResource(R.string.error_generic)
                    TextButton(
                        colors = textActionColors,
                        onClick = {
                            runCatching { uriHandler.openUri(url) }.onFailure {
                                Toast.makeText(context, error, Toast.LENGTH_SHORT).show()
                            }
                        },
                    ) { Text(stringResource(R.string.ai_tasks_opensession)) }
                }
            }
        }
        if (sendFailed) TaskAiNotice(stringResource(R.string.ai_tasks_senderror), error = true)
        if (loadFailed && setting.enabled) {
            TaskAiNotice(stringResource(R.string.ai_tasks_loaderror), error = true)
            TextButton(onClick = { revision++ }, colors = textActionColors) { Text(stringResource(R.string.nav_retry)) }
        }
    }
}

@Composable
private fun TaskAiNotice(text: String, error: Boolean = false) {
    Text(text, color = if (error) Femho.colors.dangerText else Femho.colors.inkSoft, fontSize = FemhoText.meta)
}

private fun isClaudeSession(url: String): Boolean {
    val uri = Uri.parse(url)
    return uri.scheme == "https" && uri.userInfo == null && uri.host in setOf("claude.ai", "claude.com")
}

internal fun newExecutionId(): String {
    val random = UUID.randomUUID()
    val timestamp = (System.currentTimeMillis() and 0xffffffffffffL) shl 16
    val versionAndRandom = 0x7000L or (random.mostSignificantBits and 0xfffL)
    return UUID(timestamp or versionAndRandom, random.leastSignificantBits).toString()
}

internal suspend inline fun <T> aiResponse(action: () -> T): T? = try {
    action()
} catch (error: CancellationException) {
    throw error
} catch (_: Exception) {
    null
}
