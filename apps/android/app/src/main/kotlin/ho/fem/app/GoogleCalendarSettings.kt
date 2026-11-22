package ho.fem.app

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ho.fem.designsystem.Femho
import ho.fem.designsystem.FemhoText
import ho.fem.model.Calendar
import ho.fem.model.GoogleCalendarAccount
import ho.fem.model.GoogleCalendarAttempt
import ho.fem.model.GoogleCalendarChoice
import ho.fem.model.Scope
import ho.fem.model.ScopeKind
import ho.fem.network.FemhoApi
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.UUID

@Composable
internal fun GoogleCalendarSettings(model: AppViewModel, scopes: List<Scope>) {
    val profile by model.profile.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val coroutine = rememberCoroutineScope()
    var enabled by remember { mutableStateOf(false) }
    var pending by remember(profile?.id) { mutableStateOf(model.pendingGoogleCalendar()) }
    var attempt by remember(pending) { mutableStateOf<GoogleCalendarAttempt?>(null) }
    var accounts by remember { mutableStateOf(emptyList<GoogleCalendarAccount>()) }
    var selectedAccount by remember { mutableStateOf<String?>(null) }
    var reload by remember { mutableIntStateOf(0) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<Int?>(null) }

    fun finishAttempt() {
        model.savePendingGoogleCalendar(null)
        pending = null
        reload += 1
        model.loadCalendars()
    }

    LaunchedEffect(profile?.id, reload) {
        if (profile == null) return@LaunchedEffect
        try {
            enabled = model.googleCalendarApi().googleCalendarAvailability().enabled
            accounts = model.googleCalendarApi().googleCalendarAccounts()
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (cause: Exception) {
            if ((cause as? FemhoApi.ApiException)?.status != 404) error = R.string.settings_googlecalendar_error
        }
    }

    LaunchedEffect(pending) {
        val id = pending ?: return@LaunchedEffect
        while (true) {
            try {
                val next = model.googleCalendarApi().googleCalendarAttempt(id)
                attempt = next
                error = null
                if (next.status == "completed") finishAttempt()
                if (next.status !in listOf("pending", "exchanging")) break
                delay(2000)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (cause: Exception) {
                if ((cause as? FemhoApi.ApiException)?.status == 404) {
                    error = R.string.settings_mail_oauth_error_expired
                    break
                }
                error = R.string.settings_googlecalendar_error
                delay(5000)
            }
        }
    }

    if (!enabled && pending == null && accounts.isEmpty()) return

    fun work(action: suspend () -> Unit) {
        if (busy) return
        busy = true
        error = null
        coroutine.launch {
            try {
                action()
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (cause: Exception) {
                error = R.string.settings_googlecalendar_error
            } finally {
                busy = false
            }
        }
    }

    fun start(accountId: String?) = work {
        val next = model.googleCalendarApi().startGoogleCalendar(accountId)
        val uri = Uri.parse(checkNotNull(next.authorizationUrl))
        check(uri.scheme == "https" && uri.host == "accounts.google.com")
        model.savePendingGoogleCalendar(next.id)
        pending = next.id
        context.startActivity(Intent(Intent.ACTION_VIEW, uri))
    }

    Column(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.testTag("google-calendar-settings")) {
        Text(stringResource(R.string.settings_googlecalendar_title), color = Femho.colors.ink, fontSize = FemhoText.columnTitle, fontWeight = FontWeight.ExtraBold)
        error?.let { Text(stringResource(it), color = Femho.colors.dangerText) }
        val pendingId = pending
        if (pendingId != null) {
            val next = attempt
            when (next?.status) {
                "ready" -> {
                    Text(stringResource(R.string.settings_googlecalendar_confirmaccount).replace("{email}", next.email.orEmpty()), color = Femho.colors.ink)
                    Button(enabled = !busy, onClick = {
                        work {
                            selectedAccount = model.googleCalendarApi().confirmGoogleCalendar(pendingId).id
                            finishAttempt()
                        }
                    }, modifier = Modifier.testTag("google-calendar-confirm")) {
                        Text(stringResource(R.string.settings_mail_oauth_confirm))
                    }
                }
                "cancelled" -> Text(stringResource(R.string.settings_mail_oauth_error_cancelled), color = Femho.colors.dangerText)
                "expired" -> Text(stringResource(R.string.settings_mail_oauth_error_expired), color = Femho.colors.dangerText)
                "failed" -> Text(stringResource(R.string.settings_googlecalendar_error), color = Femho.colors.dangerText)
                else -> Text(stringResource(R.string.settings_mail_oauth_pending), color = Femho.colors.inkSoft)
            }
            TextButton(enabled = !busy, onClick = {
                work {
                    try {
                        model.googleCalendarApi().cancelGoogleCalendar(pendingId)
                    } catch (cause: FemhoApi.ApiException) {
                        if (cause.status != 404) throw cause
                    } finally {
                        finishAttempt()
                    }
                }
            }) { Text(stringResource(R.string.nav_cancel)) }
            return@Column
        }

        if (enabled) {
            Button(enabled = !busy, onClick = { start(null) }, modifier = Modifier.testTag("google-calendar-connect")) {
                Text(stringResource(R.string.settings_mail_oauth_connect))
            }
        }
        accounts.forEach { account ->
            Text(account.email, color = Femho.colors.ink, fontWeight = FontWeight.SemiBold)
            Text(stringResource(when (account.oauthStatus) {
                "connected" -> R.string.settings_mail_oauth_connected
                "reconnect_required" -> R.string.settings_mail_oauth_reconnect_required
                else -> R.string.settings_mail_oauth_disconnected
            }), color = Femho.colors.inkSoft)
            if (enabled) {
                TextButton(enabled = !busy, onClick = { start(account.id) }) {
                    Text(stringResource(R.string.settings_mail_oauth_reconnect))
                }
            }
            if (account.oauthStatus != "disconnected") {
                TextButton(enabled = !busy, onClick = {
                    work {
                        model.googleCalendarApi().disconnectGoogleCalendar(account.id)
                        reload += 1
                        model.loadCalendars()
                    }
                }) { Text(stringResource(R.string.settings_mail_oauth_disconnect)) }
            }
        }
        val connected = accounts.filter { it.oauthStatus == "connected" }
        val account = connected.find { it.id == selectedAccount } ?: connected.firstOrNull()
        val ownerId = profile?.id
        val destinations = scopes.filter { it.ownerId == ownerId }
        if (enabled && account != null && destinations.isNotEmpty()) {
            GoogleCalendarPicker(R.string.settings_googlecalendar_account, account.email, connected, { it.email }) {
                selectedAccount = it.id
            }
            GoogleCalendarLinker(model, account.id, destinations)
        }
    }
}

@Composable
private fun GoogleCalendarLinker(model: AppViewModel, accountId: String, scopes: List<Scope>) {
    var calendars by remember(accountId) { mutableStateOf<List<GoogleCalendarChoice>?>(null) }
    var selected by remember(accountId) { mutableStateOf<GoogleCalendarChoice?>(null) }
    var selectedScopes by remember(accountId) { mutableStateOf(emptySet<String>()) }
    var writable by remember(accountId) { mutableStateOf(false) }
    var loading by remember(accountId) { mutableStateOf(true) }
    var reload by remember(accountId) { mutableIntStateOf(0) }
    var failed by remember(accountId) { mutableStateOf(false) }
    val coroutine = rememberCoroutineScope()

    LaunchedEffect(accountId, reload) {
        loading = true
        failed = false
        try {
            calendars = model.googleCalendarApi().googleCalendarChoices(accountId)
            selected = calendars.orEmpty().find { it.id == selected?.id }
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            failed = true
            calendars = null
            selected = null
        } finally {
            loading = false
        }
    }

    if (failed) Text(stringResource(R.string.settings_googlecalendar_error), color = Femho.colors.dangerText)
    TextButton(enabled = !loading, onClick = { reload += 1 }) {
        Text(stringResource(R.string.settings_googlecalendar_reload))
    }
    val choices = calendars ?: return
    if (choices.isEmpty()) {
        Text(stringResource(R.string.settings_googlecalendar_emptychoices), color = Femho.colors.inkSoft)
        return
    }
    GoogleCalendarPicker(
        R.string.settings_googlecalendar_calendar,
        selected?.name ?: stringResource(R.string.settings_googlecalendar_choose),
        choices,
        { it.name },
        enabled = !loading,
    ) {
        selected = it
        writable = it.writable
    }
    val calendar = selected ?: return
    if (calendar.writable) {
        GoogleCalendarCheckbox(stringResource(R.string.settings_googlecalendar_writable), writable, !loading) { writable = it }
    } else {
        Text(stringResource(R.string.settings_googlecalendar_readonly), color = Femho.colors.inkSoft)
    }
    Text(stringResource(R.string.settings_googlecalendar_scopes), color = Femho.colors.ink, fontWeight = FontWeight.SemiBold)
    scopes.forEach { scope ->
        GoogleCalendarCheckbox(scope.name, scope.id in selectedScopes, !loading) { checked ->
            selectedScopes = if (checked) selectedScopes + scope.id else selectedScopes - scope.id
        }
    }
    val destinations = scopes.map { it.id }.filter { it in selectedScopes }
    Button(
        enabled = !loading && destinations.isNotEmpty(),
        modifier = Modifier.testTag("google-calendar-link"),
        onClick = {
            loading = true
            failed = false
            coroutine.launch {
                try {
                    val api = model.googleCalendarApi()
                    for (id in destinations) {
                        api.linkGoogleCalendar(UUID.randomUUID().toString(), accountId, calendar.id, id, writable && calendar.writable)
                        selectedScopes = selectedScopes - id
                    }
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (_: Exception) {
                    failed = true
                } finally {
                    loading = false
                    model.loadCalendars()
                }
            }
        },
    ) { Text(stringResource(R.string.settings_googlecalendar_link)) }
}

@Composable
internal fun <T> GoogleCalendarPicker(label: Int, selected: String, items: List<T>, text: (T) -> String, enabled: Boolean = true, onChoose: (T) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Column {
        Text(stringResource(label), color = Femho.colors.inkSoft, fontSize = FemhoText.meta)
        OutlinedButton(enabled = enabled, onClick = { open = true }, modifier = Modifier.fillMaxWidth()) {
            Text(selected)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            items.forEach { item ->
                DropdownMenuItem(text = { Text(text(item)) }, onClick = { open = false; onChoose(item) })
            }
        }
    }
}

@Composable
internal fun GoogleCalendarCheckbox(label: String, checked: Boolean, enabled: Boolean = true, change: (Boolean) -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.fillMaxWidth().toggleable(checked, enabled = enabled, role = Role.Checkbox, onValueChange = change),
    ) {
        Checkbox(checked = checked, onCheckedChange = null, enabled = enabled)
        Text(label, color = Femho.colors.ink)
    }
}

@Composable
internal fun GoogleCalendarSharing(model: AppViewModel, calendar: Calendar, scope: Scope) {
    val profile by model.profile.collectAsStateWithLifecycle()
    if (scope.kind != ScopeKind.COLLECTIVE || scope.ownerId != profile?.id) return
    var confirm by remember(calendar.id) { mutableStateOf(false) }
    var busy by remember(calendar.id) { mutableStateOf(false) }
    var failed by remember(calendar.id) { mutableStateOf(false) }
    val coroutine = rememberCoroutineScope()

    fun share() {
        busy = true
        failed = false
        coroutine.launch {
            try {
                model.googleCalendarApi().shareGoogleCalendar(calendar.id, !calendar.sharedWithScope)
                model.loadCalendars()
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                failed = true
            } finally {
                busy = false
            }
        }
    }

    TextButton(enabled = !busy, onClick = { if (calendar.sharedWithScope) share() else confirm = true }) {
        Text(stringResource(if (calendar.sharedWithScope) R.string.settings_calendarshared else R.string.settings_calendarprivate))
    }
    if (failed) Text(stringResource(R.string.settings_googlecalendar_error), color = Femho.colors.dangerText)
    if (confirm) {
        AlertDialog(
            onDismissRequest = { confirm = false },
            text = { Text(stringResource(R.string.settings_googlecalendar_share)) },
            confirmButton = {
                TextButton(onClick = { confirm = false; share() }) { Text(stringResource(R.string.nav_save)) }
            },
            dismissButton = {
                TextButton(onClick = { confirm = false }) { Text(stringResource(R.string.nav_cancel)) }
            },
        )
    }
}
