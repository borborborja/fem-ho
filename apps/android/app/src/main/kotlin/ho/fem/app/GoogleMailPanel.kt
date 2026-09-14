package ho.fem.app

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ho.fem.designsystem.Femho
import ho.fem.model.MailAccount
import ho.fem.model.MailOAuthAttempt
import ho.fem.network.FemhoApi.ApiException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.UUID

/** L'intent es desa per instància/usuari; cap credencial Google arriba al dispositiu. */
@Composable
fun GoogleMailPanel(model: AppViewModel, accounts: List<MailAccount>) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val profile by model.profile.collectAsStateWithLifecycle()
    var enabled by remember { mutableStateOf(false) }
    var pending by remember(profile?.id) { mutableStateOf(model.pendingGoogleMail()) }
    var attempt by remember(pending) { mutableStateOf<MailOAuthAttempt?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    LaunchedEffect(profile?.id) {
        enabled = runCatching { model.googleMailApi().googleMailAvailability().enabled }.getOrDefault(false)
    }
    LaunchedEffect(pending) {
        val id = pending ?: return@LaunchedEffect
        while (true) {
            val result = runCatching { model.googleMailApi().mailOAuthAttempt(id) }
            result.onSuccess { attempt = it; error = null }.onFailure {
                error = if (it is ApiException && it.status == 404) "expired" else "generic"
            }
            if (result.isSuccess && result.getOrNull()?.status !in listOf("pending", "exchanging")) break
            if (error == "expired") break
            delay(2000)
        }
    }
    if (!enabled && pending == null && accounts.none { it.authMethod == "google" }) return

    fun clear() { model.savePendingGoogleMail(null); pending = null; attempt = null; model.loadMailData() }
    fun start(account: MailAccount?) {
        if (busy) return
        busy = true; error = null
        scope.launch {
            runCatching {
                val result = model.googleMailApi().startGoogleMail(account?.id ?: UUID.randomUUID().toString(), account != null)
                model.savePendingGoogleMail(result.id)
                pending = result.id
                val uri = Uri.parse(checkNotNull(result.authorizationUrl))
                check(uri.scheme == "https" && uri.host == "accounts.google.com")
                context.startActivity(Intent(Intent.ACTION_VIEW, uri))
            }.onFailure { error = "generic" }
            busy = false
        }
    }
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(stringResource(R.string.settings_mail_oauth_title), color = Femho.colors.ink)
        Text(stringResource(R.string.settings_mail_oauth_help), color = Femho.colors.inkFaint)
        if (pending != null) {
            val current = attempt
            when (current?.status) {
                "ready" -> {
                    Text(stringResource(R.string.settings_mail_oauth_confirmemail).replace("{email}", current.email.orEmpty()), color = Femho.colors.ink)
                    Button(enabled = !busy, onClick = {
                        busy = true
                        scope.launch {
                            runCatching { model.googleMailApi().confirmGoogleMail(current.id) }
                                .onSuccess { clear() }.onFailure { error = if (it is ApiException) it.message else "generic" }
                            busy = false
                        }
                    }) { Text(stringResource(R.string.settings_mail_oauth_confirm)) }
                }
                "failed", "expired", "cancelled" -> Text(oauthError(current.errorCode ?: current.status), color = Femho.colors.dangerText)
                "completed" -> Text(stringResource(R.string.settings_mail_oauth_connected), color = Femho.colors.ink)
                else -> Text(stringResource(R.string.settings_mail_oauth_pending), color = Femho.colors.inkFaint)
            }
            TextButton(enabled = !busy, onClick = {
                busy = true
                scope.launch {
                    runCatching { model.googleMailApi().cancelGoogleMail(checkNotNull(pending)) }
                    // Caduca al servidor encara que el dispositiu no tingui xarxa.
                    clear(); busy = false
                }
            }) { Text(stringResource(R.string.settings_mail_oauth_cancel)) }
        } else {
            Button(enabled = !busy && enabled, onClick = { start(null) }) {
                Text(stringResource(R.string.settings_mail_oauth_connect))
            }
            accounts.filter { it.host in listOf("imap.gmail.com", "imap.googlemail.com") }.forEach { account ->
                Text(account.username, color = Femho.colors.ink)
                if (account.authMethod == "google") {
                    Text(stringResource(when (account.oauthStatus) {
                        "connected" -> R.string.settings_mail_oauth_connected
                        "reconnect_required" -> R.string.settings_mail_oauth_reconnect_required
                        else -> R.string.settings_mail_oauth_disconnected
                    }), color = Femho.colors.inkFaint)
                }
                TextButton(enabled = !busy && enabled, onClick = { start(account) }) {
                    Text(stringResource(R.string.settings_mail_oauth_reconnect))
                }
                if (account.authMethod == "google" && account.oauthStatus != "disconnected") {
                    TextButton(enabled = !busy, onClick = {
                        busy = true
                        scope.launch {
                            runCatching { model.googleMailApi().disconnectGoogleMail(account.id) }
                                .onSuccess { model.loadMailData() }.onFailure { error = "generic" }
                            busy = false
                        }
                    }) { Text(stringResource(R.string.settings_mail_oauth_disconnect)) }
                }
            }
        }
        error?.let { Text(oauthError(it), color = Femho.colors.dangerText) }
    }
}

@Composable
private fun oauthError(code: String): String = stringResource(when (code) {
    "cancelled" -> R.string.settings_mail_oauth_error_cancelled
    "expired" -> R.string.settings_mail_oauth_error_expired
    "missing_scope" -> R.string.settings_mail_oauth_error_missing_scope
    "missing_refresh_token" -> R.string.settings_mail_oauth_error_missing_refresh_token
    "identity_mismatch" -> R.string.settings_mail_oauth_error_identity_mismatch
    "account_exists" -> R.string.settings_mail_oauth_error_account_exists
    "not_configured" -> R.string.settings_mail_oauth_error_not_configured
    "reconnect_required" -> R.string.settings_mail_oauth_error_reconnect_required
    "not_ready" -> R.string.settings_mail_oauth_error_not_ready
    else -> R.string.settings_mail_oauth_error_generic
})
