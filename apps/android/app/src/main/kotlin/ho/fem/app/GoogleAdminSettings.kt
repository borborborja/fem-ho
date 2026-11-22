package ho.fem.app

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import ho.fem.designsystem.Femho
import ho.fem.designsystem.FemhoText
import ho.fem.model.AdminGoogleConfig
import ho.fem.network.FemhoApi
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

private enum class GoogleConfigAction { Replace, Remove }

@Composable
internal fun GoogleAdminSettings(model: AppViewModel) {
    val scope = rememberCoroutineScope()
    var current by remember { mutableStateOf<AdminGoogleConfig?>(null) }
    var draftId by remember { mutableStateOf<String?>(null) }
    // El secret que s'està escrivint no ha de sobreviure a tancar la pantalla ni el procés.
    var clientSecret by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<Int?>(null) }
    var busy by remember { mutableStateOf(true) }
    var reload by remember { mutableIntStateOf(0) }
    var confirmation by remember { mutableStateOf<GoogleConfigAction?>(null) }
    val clientId = draftId ?: current?.clientId.orEmpty()

    suspend fun load(action: suspend () -> AdminGoogleConfig) {
        busy = true
        error = null
        try {
            current = action()
            draftId = null
            clientSecret = ""
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (cause: Exception) {
            error = googleAdminError(cause)
        } finally {
            busy = false
        }
    }

    LaunchedEffect(reload) { load { model.googleAdminApi().adminGoogleConfig() } }

    fun save() {
        scope.launch {
            load { model.googleAdminApi().saveAdminGoogleConfig(clientId.trim(), clientSecret.trim()) }
        }
    }

    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            text = stringResource(R.string.settings_googleadmin_title),
            color = Femho.colors.ink,
            fontSize = FemhoText.columnTitle,
            fontWeight = FontWeight.ExtraBold,
        )
        Text(stringResource(R.string.settings_googleadmin_help), color = Femho.colors.inkSoft)
        error?.let {
            Text(stringResource(it), color = Femho.colors.dangerText)
            if (it != R.string.error_google_config_invalid) {
                TextButton(enabled = !busy, onClick = { reload += 1 }) {
                    Text(stringResource(R.string.nav_retry))
                }
            }
        }

        val config = current ?: return@Column
        val fixed = config.source == "environment"
        Text(
            stringResource(if (config.enabled) R.string.settings_googleadmin_enabled else R.string.settings_googleadmin_disabled),
            color = Femho.colors.ink,
        )
        if (fixed) Text(stringResource(R.string.settings_googleadmin_fixed), color = Femho.colors.inkSoft)
        when (config.reason) {
            "missing_credentials" -> Text(stringResource(R.string.settings_googleadmin_missingcredentials), color = Femho.colors.dangerText)
            "unreadable_credentials" -> Text(stringResource(R.string.settings_googleadmin_unreadablecredentials), color = Femho.colors.dangerText)
        }
        val gmailCallback = config.gmailCallbackUrl
        val calendarCallback = config.calendarCallbackUrl
        if (gmailCallback == null || calendarCallback == null) {
            Text(stringResource(R.string.settings_googleadmin_invalidbaseurl), color = Femho.colors.inkSoft)
        } else {
            GoogleAdminRedirectUri(R.string.settings_googleadmin_gmailcallback, gmailCallback, model::copyToClipboard)
            GoogleAdminRedirectUri(R.string.settings_googleadmin_calendarcallback, calendarCallback, model::copyToClipboard)
        }
        OutlinedTextField(
            value = clientId,
            onValueChange = { draftId = it },
            enabled = !busy,
            readOnly = fixed,
            label = { Text(stringResource(R.string.settings_googleadmin_clientid)) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth().testTag("google-admin-client-id"),
        )
        if (fixed) return@Column

        OutlinedTextField(
            value = clientSecret,
            onValueChange = { clientSecret = it },
            enabled = !busy,
            label = { Text(stringResource(R.string.settings_googleadmin_clientsecret)) },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            visualTransformation = PasswordVisualTransformation(),
            modifier = Modifier.fillMaxWidth().testTag("google-admin-client-secret"),
        )
        val savedSecret = config.hasSecret && config.reason != "unreadable_credentials" && config.clientId == clientId.trim()
        if (savedSecret) Text(stringResource(R.string.settings_googleadmin_secretsaved), color = Femho.colors.inkSoft)
        Button(
            enabled = !busy && clientId.isNotBlank() && clientSecret.isNotBlank(),
            onClick = {
                if (config.clientId != null && config.clientId != clientId.trim()) {
                    confirmation = GoogleConfigAction.Replace
                } else {
                    save()
                }
            },
            modifier = Modifier.testTag("google-admin-save"),
        ) { Text(stringResource(R.string.nav_save)) }
        if (config.source == "settings") {
            TextButton(
                enabled = !busy,
                onClick = { confirmation = GoogleConfigAction.Remove },
                modifier = Modifier.testTag("google-admin-remove"),
            ) { Text(stringResource(R.string.settings_googleadmin_remove)) }
        }
    }

    confirmation?.let { action ->
        val removing = action == GoogleConfigAction.Remove
        AlertDialog(
            onDismissRequest = { confirmation = null },
            title = { Text(stringResource(R.string.settings_googleadmin_title)) },
            text = {
                Text(stringResource(if (removing) R.string.settings_googleadmin_confirmremove else R.string.settings_googleadmin_confirmreplace))
            },
            confirmButton = {
                TextButton(onClick = {
                    confirmation = null
                    if (removing) {
                        scope.launch { load { model.googleAdminApi().deleteAdminGoogleConfig() } }
                    } else {
                        save()
                    }
                }) {
                    Text(stringResource(if (removing) R.string.settings_googleadmin_remove else R.string.nav_save))
                }
            },
            dismissButton = {
                TextButton(onClick = { confirmation = null }) { Text(stringResource(R.string.nav_cancel)) }
            },
        )
    }
}

@Composable
private fun GoogleAdminRedirectUri(label: Int, uri: String, onCopy: (String) -> Unit) {
    OutlinedTextField(
        value = uri,
        onValueChange = {},
        label = { Text(stringResource(label)) },
        readOnly = true,
        modifier = Modifier.fillMaxWidth(),
    )
    TextButton(onClick = { onCopy(uri) }) { Text(stringResource(R.string.tokens_copy)) }
}

private fun googleAdminError(cause: Exception): Int = when ((cause as? FemhoApi.ApiException)?.problemType?.substringAfterLast('/')) {
    "google-config-invalid" -> R.string.error_google_config_invalid
    "google-config-fixed" -> R.string.error_google_config_fixed
    "google-config-changed" -> R.string.error_google_config_changed
    else -> R.string.error_generic
}
