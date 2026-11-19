package ho.fem.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import ho.fem.designsystem.Femho
import ho.fem.designsystem.FemhoSize
import ho.fem.designsystem.FemhoText
import ho.fem.model.ApiTokenSummary
import ho.fem.model.ExternalAccess
import ho.fem.model.Scope
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

data class McpSettingsLabels(
    val title: String,
    val instructions: String,
    val apiEnabled: String,
    val mcpEnabled: String,
    val url: String,
    val copy: String,
    val connections: String,
    val empty: String,
    val create: String,
    val edit: String,
    val restrict: String,
    val restrictHelp: String,
    val revoke: String,
    val name: String,
    val warning: String,
    val hideSecret: String,
    val scopes: String,
    val unavailableScope: String,
    val permissions: String,
    val channels: String,
    val channelLabels: Map<String, String>,
    val operationLabels: Map<String, String>,
    val save: String,
    val cancel: String,
    val loading: String,
    val error: String,
    val retry: String,
    val oauth: String,
    val manual: String,
    val agent: String,
    val lastUsed: String,
    val neverUsed: String,
    val expires: String,
    val noExpiry: String,
    val statusLabels: Map<String, String>,
)

@Composable
fun McpSettings(
    labels: McpSettingsLabels,
    access: ExternalAccess?,
    fallbackMcpUrl: String,
    scopeOptions: List<Scope>,
    tokens: List<ApiTokenSummary>,
    createdToken: String?,
    busy: Boolean,
    failed: Boolean,
    onLoad: () -> Unit,
    onChannel: (String, Boolean) -> Unit,
    onCreate: (String, List<String>, List<String>, List<String>, () -> Unit) -> Unit,
    onEdit: (String, String?, List<String>, List<String>, List<String>?, () -> Unit) -> Unit,
    onRevoke: (String, () -> Unit) -> Unit,
    onHideSecret: () -> Unit,
    onCopy: (String) -> Unit,
) {
    LaunchedEffect(Unit) { onLoad() }
    var creating by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf<ApiTokenSummary?>(null) }
    var revoking by remember { mutableStateOf<ApiTokenSummary?>(null) }
    val scopeNames = scopeOptions.associate { it.id to it.name }
    val mcpUrl = access?.mcpUrl?.ifBlank { fallbackMcpUrl } ?: fallbackMcpUrl

    Group(labels.title) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(labels.instructions, color = Femho.colors.inkSoft, fontSize = FemhoText.meta)
            if (access != null) {
                ChannelSwitch(labels.mcpEnabled, access.mcpEnabled, !busy, "mcp") { onChannel("mcp", it) }
                ChannelSwitch(labels.apiEnabled, access.apiEnabled, !busy, "api") { onChannel("api", it) }
            }
            OutlinedTextField(
                value = mcpUrl,
                onValueChange = {},
                label = { Text(labels.url) },
                readOnly = true,
                modifier = Modifier.fillMaxWidth(),
            )
            TextButton(onClick = { onCopy(mcpUrl) }) { Text(labels.copy) }
            if (busy) Text(labels.loading, color = Femho.colors.inkSoft)
            if (failed) {
                Text(labels.error, color = Femho.colors.dangerText)
                TextButton(onClick = onLoad, enabled = !busy) { Text(labels.retry) }
            }
        }
    }

    if (access == null) return

    Group(labels.connections) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            createdToken?.let { secret ->
                Text(labels.warning, color = Femho.colors.dangerText)
                OutlinedTextField(
                    value = secret,
                    label = { Text(labels.manual.replace("{prefix}", "").trimEnd(' ', '·')) },
                    onValueChange = {},
                    readOnly = true,
                    modifier = Modifier.fillMaxWidth().testTag("mcp-created-token"),
                )
                TextButton(onClick = { onCopy(secret) }) { Text(labels.copy) }
                TextButton(onClick = onHideSecret) { Text(labels.hideSecret) }
            }
            if (tokens.isEmpty() && !creating && !busy && !failed) {
                Text(labels.empty, color = Femho.colors.inkSoft)
            }
            tokens.forEach { token ->
                val oauth = token.credentialType == "oauth"
                val status = token.status(access)
                Text(token.name.ifBlank { token.prefix }, modifier = Modifier.testTag("mcp-token-${token.id}"), color = Femho.colors.ink, fontWeight = FontWeight.Bold)
                val kind = when {
                    oauth -> labels.oauth
                    token.aiAgentId != null -> labels.agent
                    else -> labels.manual.replace("{prefix}", token.prefix)
                }
                Text("$kind · ${labels.statusLabels[status] ?: status}", color = Femho.colors.inkSoft)
                if (token.scopeIds.isNotEmpty()) {
                    Text(token.scopeIds.joinToString(", ") { scopeNames[it] ?: labels.unavailableScope }, color = Femho.colors.ink)
                }
                if (token.capabilities.isNotEmpty()) {
                    Text(token.capabilities.joinToString(" · ") { labels.operationLabels[it] ?: it }, color = Femho.colors.inkSoft)
                }
                Text(token.channels.joinToString(" · ") { labels.channelLabels[it] ?: it }, color = Femho.colors.inkSoft)
                Text(labels.lastUsed.replace("{date}", token.lastUsedAt?.let(::formatCredentialDate) ?: labels.neverUsed), color = Femho.colors.inkSoft)
                Text(labels.expires.replace("{date}", (token.oauth?.expiresAt ?: token.expiresAt)?.let(::formatCredentialDate) ?: labels.noExpiry), color = Femho.colors.inkSoft)
                if (status != "revoked" && token.aiAgentId == null) {
                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        if (!oauth || status in setOf("active", "pending", "paused")) {
                            TextButton(onClick = { editing = token }, enabled = !busy && !creating, modifier = Modifier.testTag("mcp-edit-${token.id}")) { Text(if (oauth) labels.restrict else labels.edit) }
                        }
                        TextButton(onClick = { revoking = token }, enabled = !busy, modifier = Modifier.testTag("mcp-revoke-${token.id}")) { Text(labels.revoke, color = Femho.colors.dangerText) }
                    }
                }
                if (editing?.id == token.id) {
                    CredentialForm(labels, scopeNames, token, busy, failed, { editing = null }) { name, caps, scopeIds, channels ->
                        onEdit(token.id, name.takeUnless { oauth }, caps, scopeIds, channels.takeUnless { oauth }) { editing = null }
                    }
                }
                HorizontalDivider(color = Femho.colors.cardBorder)
            }
            if (creating) {
                CredentialForm(labels, scopeNames, null, busy, failed, { creating = false }) { name, caps, scopeIds, channels ->
                    onCreate(name, caps, scopeIds, channels) { creating = false }
                }
            } else if (editing == null && scopeNames.isNotEmpty()) {
                Button(onClick = { creating = true }, enabled = !busy && createdToken == null, modifier = Modifier.testTag("mcp-new-token")) {
                    Text(labels.create)
                }
            }
        }
    }

    revoking?.let { token ->
        AlertDialog(
            onDismissRequest = { if (!busy) revoking = null },
            title = { Text(labels.revoke) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(token.name.ifBlank { token.prefix })
                    if (failed) Text(labels.error, color = Femho.colors.dangerText)
                }
            },
            confirmButton = {
                TextButton(onClick = { onRevoke(token.id) { revoking = null } }, enabled = !busy, modifier = Modifier.testTag("mcp-confirm-revoke")) { Text(labels.revoke) }
            },
            dismissButton = { TextButton(onClick = { revoking = null }, enabled = !busy) { Text(labels.cancel) } },
        )
    }
}

@Composable
private fun ChannelSwitch(label: String, checked: Boolean, enabled: Boolean, key: String, onChange: (Boolean) -> Unit) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = FemhoSize.touch).testTag("mcp-channel-$key")
            .toggleable(checked, enabled = enabled, role = Role.Switch, onValueChange = onChange),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, Modifier.weight(1f), color = Femho.colors.ink)
        Switch(checked, null, enabled = enabled)
    }
}

@Composable
private fun CredentialForm(
    labels: McpSettingsLabels,
    availableScopes: Map<String, String>,
    token: ApiTokenSummary?,
    busy: Boolean,
    failed: Boolean,
    onCancel: () -> Unit,
    onSave: (String, List<String>, List<String>, List<String>) -> Unit,
) {
    val oauth = token?.credentialType == "oauth"
    val scopeOptions = if (oauth) token!!.scopeIds.associateWith { availableScopes[it] ?: labels.unavailableScope } else availableScopes
    val knownOperations = listOf("tasks:read", "tasks:create", "tasks:move", "tasks:update", "tasks:attach")
    val operationOptions = if (oauth) token!!.capabilities else (knownOperations + token?.capabilities.orEmpty()).distinct()
    var name by remember(token?.id) { mutableStateOf(token?.name.orEmpty()) }
    var scopes by remember(token?.id) { mutableStateOf(token?.scopeIds.orEmpty().toSet()) }
    var capabilities by remember(token?.id) { mutableStateOf(token?.capabilities?.toSet() ?: setOf("tasks:read")) }
    var channels by remember(token?.id) { mutableStateOf(token?.channels?.toSet() ?: setOf("mcp")) }
    val selectedScopes = scopeOptions.keys.filter { it in scopes }
    val selectedCapabilities = operationOptions.filter { it in capabilities }

    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (oauth) {
            Text(labels.restrictHelp, color = Femho.colors.inkSoft)
        } else {
            OutlinedTextField(name, { name = it }, label = { Text(labels.name) }, singleLine = true, enabled = !busy, modifier = Modifier.fillMaxWidth().testTag("mcp-token-name"))
            Choices(labels.channels, labels.channelLabels, channels, !busy, "channel") { channels = it }
        }
        Choices(labels.scopes, scopeOptions, scopes, !busy, "scope") { scopes = it }
        Choices(labels.permissions, operationOptions.associateWith { labels.operationLabels[it] ?: it }, capabilities, !busy, "operation") { capabilities = it }
        if (failed) Text(labels.error, color = Femho.colors.dangerText)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(
                onClick = { onSave(name.trim(), selectedCapabilities, selectedScopes, channels.toList()) },
                enabled = !busy && (oauth || name.isNotBlank()) && selectedScopes.isNotEmpty() && selectedCapabilities.isNotEmpty() && channels.isNotEmpty(),
                modifier = Modifier.testTag("mcp-save-token"),
            ) { Text(labels.save) }
            TextButton(onClick = onCancel, enabled = !busy) { Text(labels.cancel) }
        }
    }
}

@Composable
private fun Choices(title: String, options: Map<String, String>, selected: Set<String>, enabled: Boolean, testId: String, onChange: (Set<String>) -> Unit) {
    Text(title, color = Femho.colors.ink, fontWeight = FontWeight.SemiBold)
    options.forEach { (key, label) ->
        val checked = key in selected
        Row(
            Modifier.fillMaxWidth().heightIn(min = FemhoSize.touch).testTag("mcp-choose-$testId-$key")
                .toggleable(checked, enabled = enabled, role = Role.Checkbox, onValueChange = { onChange(if (it) selected + key else selected - key) }),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Checkbox(checked, null, enabled = enabled)
            Text(label, color = Femho.colors.ink)
        }
    }
}

private fun ApiTokenSummary.status(access: ExternalAccess): String {
    val authorization = oauth
    return when {
        revokedAt != null -> "revoked"
        authorization?.status == "active" && !access.mcpEnabled -> "paused"
        authorization != null -> authorization.status
        expiresAt?.let { runCatching { Instant.parse(it).isBefore(Instant.now()) }.getOrDefault(false) } == true -> "expired"
        ("api" in channels && access.apiEnabled) || ("mcp" in channels && access.mcpEnabled) -> "active"
        else -> "paused"
    }
}

private fun formatCredentialDate(value: String): String = runCatching {
    DateTimeFormatter.ofLocalizedDateTime(FormatStyle.SHORT).withLocale(Locale.getDefault())
        .withZone(ZoneId.systemDefault()).format(Instant.parse(value))
}.getOrDefault(value)
