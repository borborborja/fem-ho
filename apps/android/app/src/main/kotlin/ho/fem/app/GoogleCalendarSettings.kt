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
import androidx.compose.runtime.saveable.rememberSaveable
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
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import java.util.UUID

internal data class GoogleCalendarAuthorization(val id: String, val scopeId: String?)

internal data class GoogleCalendarConnection(
    val enabled: Boolean,
    val accounts: List<GoogleCalendarAccount>,
    val accountsLoaded: Boolean,
    val accountsFailed: Boolean,
    val pending: GoogleCalendarAuthorization?,
    val attempt: GoogleCalendarAttempt?,
    val confirmedScopeId: String?,
    val confirmedAccountId: String?,
    val busy: Boolean,
    val error: Int?,
    val reloadAccounts: () -> Unit,
    val start: (accountId: String?, scopeId: String?) -> Unit,
    val confirm: () -> Unit,
    val cancel: () -> Unit,
    val disconnect: (GoogleCalendarAccount) -> Unit,
)

@Composable
internal fun rememberGoogleCalendarConnection(model: AppViewModel, userId: String?): GoogleCalendarConnection {
    val context = LocalContext.current
    val coroutine = rememberCoroutineScope()
    var enabled by remember(userId) { mutableStateOf(false) }
    var pending by remember(userId) { mutableStateOf(model.pendingGoogleCalendar()) }
    var attempt by remember(pending) { mutableStateOf<GoogleCalendarAttempt?>(null) }
    var accounts by remember(userId) { mutableStateOf(emptyList<GoogleCalendarAccount>()) }
    var accountsLoaded by remember(userId) { mutableStateOf(false) }
    var accountsFailed by remember(userId) { mutableStateOf(false) }
    var confirmedScopeId by rememberSaveable(userId) { mutableStateOf<String?>(null) }
    var confirmedAccountId by rememberSaveable(userId) { mutableStateOf<String?>(null) }
    var reload by remember(userId) { mutableIntStateOf(0) }
    var busy by remember(userId) { mutableStateOf(false) }
    var error by remember(userId) { mutableStateOf<Int?>(null) }

    fun finish(authorization: GoogleCalendarAuthorization, accountId: String? = null) {
        if (accountId != null) {
            confirmedScopeId = authorization.scopeId
            confirmedAccountId = accountId
        }
        model.savePendingGoogleCalendar(null)
        pending = null
        reload += 1
        model.loadCalendars()
    }

    LaunchedEffect(userId, reload) {
        if (userId == null || reload == 0) return@LaunchedEffect
        accountsFailed = false
        try {
            val api = model.googleCalendarApi()
            enabled = api.googleCalendarAvailability().enabled
            accounts = api.googleCalendarAccounts()
            accountsLoaded = true
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (cause: Exception) {
            accountsFailed = enabled || (cause as? FemhoApi.ApiException)?.status != 404
        }
    }

    LaunchedEffect(pending) {
        val authorization = pending ?: return@LaunchedEffect
        while (true) {
            try {
                val next = model.googleCalendarApi().googleCalendarAttempt(authorization.id)
                attempt = next
                error = null
                if (next.status == "completed") finish(authorization, next.accountId)
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

    fun work(action: suspend () -> Unit) {
        if (busy) return
        busy = true
        error = null
        coroutine.launch {
            try {
                action()
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                error = R.string.settings_googlecalendar_error
            } finally {
                busy = false
            }
        }
    }

    fun start(accountId: String?, scopeId: String?) = work {
        val next = model.googleCalendarApi().startGoogleCalendar(accountId)
        val uri = Uri.parse(checkNotNull(next.authorizationUrl))
        check(uri.scheme == "https" && uri.host == "accounts.google.com")
        val authorization = GoogleCalendarAuthorization(next.id, scopeId)
        model.savePendingGoogleCalendar(authorization)
        pending = authorization
        context.startActivity(Intent(Intent.ACTION_VIEW, uri))
    }

    return GoogleCalendarConnection(
        enabled = enabled,
        accounts = accounts,
        accountsLoaded = accountsLoaded,
        accountsFailed = accountsFailed,
        pending = pending,
        attempt = attempt,
        confirmedScopeId = confirmedScopeId,
        confirmedAccountId = confirmedAccountId,
        busy = busy,
        error = error,
        reloadAccounts = { reload += 1 },
        start = ::start,
        confirm = {
            pending?.let { authorization ->
                work {
                    val account = model.googleCalendarApi().confirmGoogleCalendar(authorization.id)
                    accounts = accounts.filterNot { it.id == account.id } + account
                    finish(authorization, account.id)
                }
            }
        },
        cancel = {
            pending?.let { authorization ->
                work {
                    try {
                        model.googleCalendarApi().cancelGoogleCalendar(authorization.id)
                    } catch (cause: FemhoApi.ApiException) {
                        if (cause.status != 404) throw cause
                    } finally {
                        currentCoroutineContext().ensureActive()
                        finish(authorization)
                    }
                }
            }
        },
        disconnect = { account ->
            work {
                model.googleCalendarApi().disconnectGoogleCalendar(account.id)
                reload += 1
                model.loadCalendars()
            }
        },
    )
}

@Composable
internal fun GoogleCalendarAccounts(connection: GoogleCalendarConnection, showAuthorization: Boolean) {
    // La configuració d'OAuth pot haver canviat a Admin des de l'última visita a la pestanya.
    LaunchedEffect(Unit) { connection.reloadAccounts() }
    if (!connection.enabled && connection.pending == null && connection.accounts.isEmpty() &&
        !connection.accountsFailed && connection.error == null
    ) return

    Column(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.testTag("google-calendar-settings")) {
        Text(
            stringResource(R.string.settings_googlecalendar_title),
            color = Femho.colors.ink,
            fontSize = FemhoText.columnTitle,
            fontWeight = FontWeight.ExtraBold,
        )
        if (showAuthorization && connection.pending != null) {
            GoogleCalendarAuthorize(connection)
            return@Column
        }
        if (connection.accountsFailed) GoogleCalendarAccountsError(connection)
        if (showAuthorization) connection.error?.let { Text(stringResource(it), color = Femho.colors.dangerText) }
        val canStart = !connection.busy && connection.pending == null
        if (connection.enabled) {
            Button(
                enabled = canStart,
                onClick = { connection.start(null, null) },
                modifier = Modifier.testTag("google-calendar-connect"),
            ) { Text(stringResource(R.string.settings_mail_oauth_connect)) }
        }
        connection.accounts.forEach { account ->
            Text(account.email, color = Femho.colors.ink, fontWeight = FontWeight.SemiBold)
            Text(stringResource(when (account.oauthStatus) {
                "connected" -> R.string.settings_mail_oauth_connected
                "reconnect_required" -> R.string.settings_mail_oauth_reconnect_required
                else -> R.string.settings_mail_oauth_disconnected
            }), color = Femho.colors.inkSoft)
            if (connection.enabled) {
                TextButton(enabled = canStart, onClick = { connection.start(account.id, null) }) {
                    Text(stringResource(R.string.settings_mail_oauth_reconnect))
                }
            }
            if (account.oauthStatus != "disconnected") {
                TextButton(enabled = canStart, onClick = { connection.disconnect(account) }) {
                    Text(stringResource(R.string.settings_mail_oauth_disconnect))
                }
            }
        }
    }
}

@Composable
private fun GoogleCalendarAccountsError(connection: GoogleCalendarConnection) {
    Text(stringResource(R.string.settings_googlecalendar_error), color = Femho.colors.dangerText)
    TextButton(onClick = connection.reloadAccounts) { Text(stringResource(R.string.nav_retry)) }
}

@Composable
private fun GoogleCalendarAuthorize(connection: GoogleCalendarConnection) {
    connection.error?.let { Text(stringResource(it), color = Femho.colors.dangerText) }
    val attempt = connection.attempt
    when (attempt?.status) {
        "ready" -> {
            Text(
                stringResource(R.string.settings_googlecalendar_confirmaccount).replace("{email}", attempt.email.orEmpty()),
                color = Femho.colors.ink,
            )
            Button(
                enabled = !connection.busy,
                onClick = connection.confirm,
                modifier = Modifier.testTag("google-calendar-confirm"),
            ) { Text(stringResource(R.string.settings_mail_oauth_confirm)) }
        }
        "cancelled" -> Text(stringResource(R.string.settings_mail_oauth_error_cancelled), color = Femho.colors.dangerText)
        "expired" -> Text(stringResource(R.string.settings_mail_oauth_error_expired), color = Femho.colors.dangerText)
        "failed" -> Text(stringResource(R.string.settings_googlecalendar_error), color = Femho.colors.dangerText)
        else -> if (connection.error == null) {
            Text(stringResource(R.string.settings_mail_oauth_pending), color = Femho.colors.inkSoft)
        }
    }
    TextButton(enabled = !connection.busy, onClick = connection.cancel) {
        Text(stringResource(R.string.nav_cancel))
    }
}

@Composable
internal fun GoogleCalendarSourceForm(
    model: AppViewModel,
    connection: GoogleCalendarConnection,
    scope: Scope,
    ownedScopes: List<Scope>,
) {
    if (connection.pending?.scopeId == scope.id) {
        GoogleCalendarAuthorize(connection)
        return
    }
    if (connection.accountsFailed) GoogleCalendarAccountsError(connection)
    if (!connection.accountsLoaded && connection.accounts.isEmpty()) {
        if (!connection.accountsFailed) Text(stringResource(R.string.state_loading), color = Femho.colors.inkSoft)
        return
    }
    val preferredAccount = connection.confirmedAccountId.takeIf { connection.confirmedScopeId == scope.id }
    var selectedAccount by rememberSaveable(scope.id, preferredAccount) { mutableStateOf(preferredAccount) }
    val connected = connection.accounts.filter { it.oauthStatus == "connected" }
    val account = connected.find { it.id == selectedAccount } ?: connected.firstOrNull()
    if (account != null) {
        GoogleCalendarPicker(R.string.settings_googlecalendar_account, account.email, connected, { it.email }) {
            selectedAccount = it.id
        }
        GoogleCalendarLinker(model, account.id, scope, ownedScopes.filter { it.id != scope.id })
    }
    if (connection.enabled) {
        val canStart = !connection.busy && connection.pending == null
        val oldAccount = connection.accounts.singleOrNull()?.takeIf { account == null }
        if (oldAccount != null) {
            TextButton(enabled = canStart, onClick = { connection.start(oldAccount.id, scope.id) }) {
                Text(stringResource(R.string.settings_mail_oauth_reconnect))
            }
        }
        TextButton(
            enabled = canStart,
            onClick = { connection.start(null, scope.id) },
            modifier = Modifier.testTag("google-calendar-connect-${scope.id}"),
        ) {
            Text(stringResource(if (account == null) R.string.settings_mail_oauth_connect else R.string.settings_mail_oauth_new))
        }
    }
}

@Composable
private fun GoogleCalendarLinker(model: AppViewModel, accountId: String, scope: Scope, extraScopes: List<Scope>) {
    var calendars by remember(accountId) { mutableStateOf<List<GoogleCalendarChoice>?>(null) }
    var selected by remember(accountId) { mutableStateOf<GoogleCalendarChoice?>(null) }
    var selectedScopes by remember(accountId) { mutableStateOf(setOf(scope.id)) }
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

    if (failed && calendars == null) {
        Text(stringResource(R.string.settings_googlecalendar_error), color = Femho.colors.dangerText)
    }
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
        if (selected?.id != it.id) {
            selectedScopes = setOf(scope.id)
            failed = false
        }
        selected = it
        writable = it.writable
    }
    val calendar = selected ?: return
    if (calendar.writable) {
        GoogleCalendarCheckbox(stringResource(R.string.settings_googlecalendar_writable), writable, !loading) { writable = it }
    } else {
        Text(stringResource(R.string.settings_googlecalendar_readonly), color = Femho.colors.inkSoft)
    }
    if (extraScopes.isNotEmpty()) {
        Text(stringResource(R.string.settings_googlecalendar_scopes), color = Femho.colors.ink, fontWeight = FontWeight.SemiBold)
        GoogleCalendarCheckbox(scope.name, checked = scope.id in selectedScopes, enabled = false) {}
        extraScopes.forEach { destination ->
            GoogleCalendarCheckbox(destination.name, destination.id in selectedScopes, !loading) { checked ->
                selectedScopes = if (checked) selectedScopes + destination.id else selectedScopes - destination.id
            }
        }
    }
    val destinations = (listOf(scope.id) + extraScopes.map { it.id }).filter { it in selectedScopes }
    if (failed) Text(stringResource(R.string.settings_googlecalendar_error), color = Femho.colors.dangerText)
    Button(
        enabled = !loading && destinations.isNotEmpty(),
        modifier = Modifier.testTag("google-calendar-link-${scope.id}"),
        onClick = {
            loading = true
            failed = false
            coroutine.launch {
                try {
                    val api = model.googleCalendarApi()
                    for (id in destinations) {
                        try {
                            api.linkGoogleCalendar(UUID.randomUUID().toString(), accountId, calendar.id, id, writable && calendar.writable)
                            selectedScopes = selectedScopes - id
                        } catch (cancelled: CancellationException) {
                            throw cancelled
                        } catch (_: Exception) {
                            // Un error en un àmbit no ha d'impedir que els altres quedin vinculats.
                            failed = true
                        }
                    }
                    if (!failed) {
                        selected = null
                        selectedScopes = setOf(scope.id)
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
