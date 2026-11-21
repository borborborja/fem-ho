package ho.fem.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import ho.fem.app.R
import ho.fem.app.widget.FemhoWidgets
import ho.fem.designsystem.Femho
import ho.fem.designsystem.FemhoSize
import ho.fem.designsystem.FemhoText
import ho.fem.designsystem.FemhoTheme
import ho.fem.designsystem.FemhoShape
import ho.fem.designsystem.ScopeChip
import ho.fem.designsystem.TaskCard
import ho.fem.designsystem.scopeColor
import ho.fem.model.Checklist
import ho.fem.model.CalendarDate
import ho.fem.model.CalendarTaskStart
import ho.fem.model.CalendarTaskSuggestion
import ho.fem.model.Project
import ho.fem.model.Scope
import ho.fem.model.Task
import ho.fem.model.TaskStatus
import ho.fem.model.UserProfile
import ho.fem.calendar.CalendarLabels
import ho.fem.calendar.AgendaEntry
import ho.fem.calendar.DayList
import ho.fem.calendar.InboxLabels
import ho.fem.calendar.InboxRail
import ho.fem.calendar.MonthView
import ho.fem.calendar.WeekList
import ho.fem.settings.SettingsEmptyStates
import ho.fem.settings.McpSettings
import ho.fem.settings.McpSettingsLabels
import ho.fem.settings.SettingsLabels
import ho.fem.settings.SettingsScreen
import ho.fem.settings.SettingsTabs
import ho.fem.tasks.BoardLabels
import ho.fem.designsystem.CardAddForm
import ho.fem.designsystem.CardList
import ho.fem.designsystem.CardListItem
import ho.fem.designsystem.SubtaskRowActions
import ho.fem.designsystem.SubtaskRowLabels
import ho.fem.tasks.BoardScreen
import ho.fem.tasks.CardExtras
import ho.fem.tasks.McpProvenanceBadge
import ho.fem.tasks.McpProvenanceLabels
import ho.fem.tasks.QuickAddField
import ho.fem.tasks.TaskDetail
import ho.fem.tasks.TaskDetailLabels
import ho.fem.tasks.TaskMenuLabels
import ho.fem.model.AiMode
import ho.fem.model.Dates
import ho.fem.model.DoneDayFilter
import ho.fem.model.QuickAddContext
import ho.fem.model.QuickAddPerson
import ho.fem.model.QuickAddProject
import ho.fem.model.QuickAddScope
import ho.fem.model.QuickAddTaskType
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * L'activitat única. docs/03.
 *
 * L'estat de sessió decideix si cal entrar. Un cop dins, la pila de pantalles es desa
 * perquè girar el dispositiu conservi també el camí per tornar enrere.
 */
class MainActivity : ComponentActivity() {
    /**
     * L'intent que encara no s'ha atès.
     *
     * És estat de Compose i no una lectura de `getIntent()` perquè `onNewIntent` arriba
     * amb l'activitat ja composta: sense això, tocar un widget amb l'app oberta no faria
     * res visible, que és el pitjor dels casos —sembla que el widget estigui trencat.
     */
    private val pending = mutableStateOf<Intent?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        val container = (application as FemhoApplication).container
        if (savedInstanceState == null) pending.value = intent

        setContent {
            val model: AppViewModel = viewModel(
                factory = object : ViewModelProvider.Factory {
                    @Suppress("UNCHECKED_CAST")
                    override fun <T : androidx.lifecycle.ViewModel> create(modelClass: Class<T>): T =
                        AppViewModel(container) as T
                },
            )

            val theme by model.theme.collectAsStateWithLifecycle()
            val accent by model.accent.collectAsStateWithLifecycle()

            FemhoTheme(theme = theme, accent = accent) {
                Box(
                    Modifier
                        .fillMaxSize()
                        .background(Femho.pageBackground)
                        .safeDrawingPadding(),
                ) {
                    Root(model, pending)
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        pending.value = intent
    }

    override fun onResume() {
        super.onResume()
        (application as FemhoApplication).pomodoroSignals.setForeground(true)
    }

    override fun onPause() {
        (application as FemhoApplication).pomodoroSignals.setForeground(false)
        super.onPause()
    }

    override fun onStart() {
        super.onStart()
        val container = (application as FemhoApplication).container
        lifecycleScope.launch {
            val account = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { container.account() }
            if (account != null && ActivityNotifications.needsSync(applicationContext, account)) {
                Notifications.requestSync(applicationContext, account)
            }
        }
    }

    /**
     * En sortir de l'app, els widgets es posen al dia.
     *
     * És el moment exacte en què la persona torna a mirar la pantalla d'inici, i el que
     * evita que hi vegi el que hi havia abans d'entrar. La resta del temps ja se n'ocupa
     * el `SyncWorker`; això només tapa el buit entre dues execucions seves.
     */
    override fun onStop() {
        super.onStop()
        lifecycleScope.launch { FemhoWidgets.updateAll(applicationContext) }
    }
}

@Composable
private fun Root(model: AppViewModel, pending: MutableState<Intent?>) {
    val session by model.session.collectAsStateWithLifecycle()
    val pomodoro by model.pomodoro.collectAsStateWithLifecycle()
    val openTask by model.openTask.collectAsStateWithLifecycle()
    val error by model.actionError.collectAsStateWithLifecycle()
    val snackbar = remember { androidx.compose.material3.SnackbarHostState() }
    val snackbarScope = androidx.compose.runtime.rememberCoroutineScope()
    val errorMessage = error?.let { stringResource(it) }
    LaunchedEffect(errorMessage) {
        if (errorMessage != null) {
            snackbarScope.launch { snackbar.showSnackbar(errorMessage) }
            model.consumeActionError()
        }
    }
    var route by rememberSaveable(stateSaver = Saver<String, String>(save = { it }, restore = Route::restoreStack)) {
        mutableStateOf(Screen.BOARD.name)
    }
    val screen = Route.currentScreen(route)
    PomodoroSyncEffect(model, session is AppViewModel.Session.Ready, screen == Screen.POMODORO)
    fun go(destination: Screen) {
        if (destination == screen) return
        route = if (destination == Screen.BOARD) Screen.BOARD.name else "$route/${destination.name}"
    }
    fun back() {
        route = route.substringBeforeLast('/', Screen.BOARD.name)
    }
    var requestedStatus by rememberSaveable { mutableStateOf<TaskStatus?>(null) }
    // El token d'un convit que arriba per deep link (femho://join|invite/{token}).
    var joinToken by rememberSaveable { mutableStateOf<String?>(null) }
    var inviteToken by rememberSaveable { mutableStateOf<String?>(null) }
    var wasSignedIn by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(session) {
        when {
            session is AppViewModel.Session.Ready -> wasSignedIn = true
            session is AppViewModel.Session.Checking -> Unit
            wasSignedIn -> {
                wasSignedIn = false
                route = Screen.BOARD.name
                requestedStatus = null
                joinToken = null
                inviteToken = null
            }
        }
    }
    BackHandler(enabled = session is AppViewModel.Session.Ready && openTask == null && screen != Screen.BOARD) {
        back()
    }

    /**
     * L'intent s'atén i **es consumeix**.
     *
     * Sense buidar-lo, una rotació de pantalla tornaria a obrir la tasca que el widget
     * va demanar fa mitja hora. La tasca es demana per identificador i no per objecte
     * perquè qui l'envia és un altre procés que no en té cap.
     */
    LaunchedEffect(pending.value, session) {
        val intent = pending.value ?: return@LaunchedEffect
        val notificationAccount = intent.getStringExtra(Route.EXTRA_NOTIFICATION_ACCOUNT)
        if (notificationAccount != null && session is AppViewModel.Session.Checking) return@LaunchedEffect
        val destination = Route.screenOf(intent)
        route = if (destination == Screen.BOARD) destination.name else "${Screen.BOARD.name}/${destination.name}"
        requestedStatus = Route.statusOf(intent)
        Route.taskOf(intent)?.let { id ->
            if (notificationAccount == null) model.openById(id)
            else if (session is AppViewModel.Session.Ready) model.openNotificationTask(id, notificationAccount)
        }
        if (Route.quickAddOf(intent)) {
            requestedStatus = TaskStatus.INBOX
            model.requestQuickAdd(Route.draftOf(intent) ?: "")
        }
        // El full de compartir: el text rebut es converteix en una tasca a la bústia.
        if (intent?.action == android.content.Intent.ACTION_SEND) {
            val text = intent.getStringExtra(android.content.Intent.EXTRA_TEXT).orEmpty()
            if (text.isNotBlank()) {
                requestedStatus = TaskStatus.INBOX
                model.requestQuickAdd(text)
            }
        }
        // Els deep links de convit: el token el guarda la pantalla d'acceptar.
        Route.joinTokenOf(intent)?.let { token ->
            route = "${Screen.BOARD.name}/${Screen.JOIN.name}"
            model.consumeJoin()
            joinToken = token
            model.loadJoinPreview(token)
        }
        Route.inviteTokenOf(intent)?.let { token ->
            route = "${Screen.BOARD.name}/${Screen.INVITE.name}"
            model.consumeJoin()
            inviteToken = token
        }
        pending.value = null
    }

    Box(Modifier.fillMaxSize()) {
        when (val state = session) {
            is AppViewModel.Session.Checking -> Loading()
            AppViewModel.Session.RestoreFailed -> SessionRecovery(onRetry = model::retrySessionRestore)
            is AppViewModel.Session.RecoverLegacy -> SessionRecovery(
                onRetry = { model.resolveLegacySession(recover = true) },
                serverUrl = state.serverUrl,
                failed = state.failed,
                onSignIn = { model.resolveLegacySession(recover = false) },
            )
            is AppViewModel.Session.NeedsServer -> ServerScreen(model, state.message)
            is AppViewModel.Session.NeedsLogin -> LoginScreen(
                model, state.instanceName, false, state.registration, state.expired,
            )
            is AppViewModel.Session.NeedsLoginNewer -> LoginScreen(
                model, state.instanceName, true, state.registration,
            )
            is AppViewModel.Session.NeedsCertConfirm -> CertConfirmScreen(model, state.fingerprint)
            is AppViewModel.Session.Ready -> {
                val needsWizard by model.needsScopeModeWizard.collectAsStateWithLifecycle()
                if (needsWizard) {
                    WelcomeScreen(model)
                } else {
                    when (screen) {
                        Screen.BOARD -> BoardHost(
                            model = model,
                            requestedStatus = requestedStatus,
                            onStatusOpened = { requestedStatus = null },
                            onSettings = { go(Screen.SETTINGS) },
                            onCalendar = { go(Screen.CALENDAR) },
                            onSearch = { go(Screen.SEARCH) },
                            onDashboard = { go(Screen.DASHBOARD) },
                            onPomodoro = if (pomodoro.snapshot.settings.enabled) ({ go(Screen.POMODORO) }) else null,
                        )
                        Screen.DASHBOARD -> DashboardHost(
                            model = model,
                            onBoard = { go(Screen.BOARD) },
                            onSettings = { go(Screen.SETTINGS) },
                        )
                        Screen.SEARCH -> SearchHost(model = model, onBoard = ::back)
                        Screen.CALENDAR -> CalendarHost(
                            model = model,
                            onSettings = { go(Screen.SETTINGS) },
                            onBoard = { go(Screen.BOARD) },
                            onDashboard = { go(Screen.DASHBOARD) },
                            onSearch = { go(Screen.SEARCH) },
                            onPomodoro = if (pomodoro.snapshot.settings.enabled) ({ go(Screen.POMODORO) }) else null,
                        )
                        Screen.POMODORO -> PomodoroHost(model, onBack = ::back)
                        Screen.SETTINGS -> SettingsHost(
                            model = model, serverUrl = state.serverUrl, onBack = ::back,
                        )
                        Screen.JOIN -> JoinScreen(
                            model = model,
                            token = joinToken.orEmpty(),
                            onDone = {
                                go(Screen.BOARD)
                                model.consumeJoin()
                                joinToken = null
                            },
                        )
                        Screen.INVITE -> InviteScreen(
                            model = model,
                            token = inviteToken.orEmpty(),
                            onDone = {
                                go(Screen.BOARD)
                                model.consumeJoin()
                                inviteToken = null
                            },
                        )
                    }
                }
                TaskDetailSheet(model)
            }
        }
        androidx.compose.material3.SnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter))
    }
}

@Composable
private fun Loading() {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Text(stringResource(R.string.state_loading), color = Femho.colors.inkFaint)
    }
}

@Composable
private fun SessionRecovery(
    onRetry: () -> Unit,
    serverUrl: String? = null,
    failed: Boolean = true,
    onSignIn: (() -> Unit)? = null,
) {
    Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (serverUrl != null) {
                Text(
                    stringResource(R.string.login_recoversessionprompt),
                    color = Femho.colors.ink,
                    textAlign = TextAlign.Center,
                )
                Text(serverUrl, color = Femho.colors.inkSoft, textAlign = TextAlign.Center)
            }
            if (failed) Text(
                stringResource(R.string.login_sessionrestorefailed),
                color = Femho.colors.ink,
                textAlign = TextAlign.Center,
            )
            androidx.compose.material3.Button(onClick = onRetry, modifier = Modifier.testTag("session-recover")) {
                Text(stringResource(if (failed) R.string.nav_retry else R.string.login_recoversession))
            }
            if (onSignIn != null) androidx.compose.material3.TextButton(onClick = onSignIn) {
                Text(stringResource(R.string.login_signinwithpassword))
            }
        }
    }
}

/**
 * La pantalla d'acceptar un convit d'àmbit (deep link femho://join/{token}).
 *
 * Es mira abans d'acceptar —qui convida i a què— perquè acceptar a cegues una cosa que
 * et dona accés a les dades d'una altra persona és exactament el gest que la gent es
 * penedeix d'haver fet (el mateix criteri que JoinScopeScreen a la web).
 */
@Composable
private fun JoinScreen(model: AppViewModel, token: String, onDone: () -> Unit) {
    val preview by model.joinPreview.collectAsStateWithLifecycle()
    val error by model.joinError.collectAsStateWithLifecycle()
    val done by model.joinDone.collectAsStateWithLifecycle()

    Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(FemhoShape.card))
                .background(Femho.colors.cardBg)
                .padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                text = stringResource(R.string.join_title),
                fontSize = FemhoText.columnTitle,
                fontWeight = FontWeight.Black,
                color = Femho.colors.ink,
            )
            when {
                done -> Text(
                    text = stringResource(R.string.join_done),
                    color = Femho.colors.ink,
                    fontSize = FemhoText.body,
                )
                error != null -> Text(
                    text = stringResource(R.string.join_invalid),
                    color = Femho.colors.dangerText,
                    fontSize = FemhoText.body,
                )
                preview != null -> {
                    Text(
                        text = stringResource(R.string.join_subtitle)
                            .replace("{who}", preview!!.invitedBy)
                            .replace("{scope}", preview!!.scopeName),
                        color = Femho.colors.inkSoft,
                        fontSize = FemhoText.body,
                    )
                    Text(
                        text = stringResource(R.string.join_accept),
                        color = Femho.onBrand,
                        fontSize = FemhoText.body,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(FemhoShape.pill))
                            .background(Femho.brandGradient2)
                            .clickable { model.acceptJoin(token) }
                            .padding(vertical = 12.dp),
                        textAlign = TextAlign.Center,
                    )
                }
                else -> Loading()
            }
            Text(
                text = stringResource(R.string.nav_close),
                color = Femho.colors.inkSoft,
                fontSize = FemhoText.body,
                modifier = Modifier
                    .clickable(onClick = onDone)
                    .padding(vertical = 6.dp),
            )
        }
    }
}

/**
 * L'acceptació d'un convit a la instància (deep link femho://invite/{token}).
 *
 * Crea el compte amb una contrasenya de 10+ caràcters, com la web (GateScreens).
 * L'enllaç serveix un sol cop.
 */
@Composable
private fun InviteScreen(model: AppViewModel, token: String, onDone: () -> Unit) {
    val error by model.joinError.collectAsStateWithLifecycle()
    val done by model.joinDone.collectAsStateWithLifecycle()
    var password by remember { mutableStateOf("") }
    var repeat by remember { mutableStateOf("") }
    var localError by remember { mutableStateOf<String?>(null) }

    Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(FemhoShape.card))
                .background(Femho.colors.cardBg)
                .padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                text = stringResource(R.string.invite_title),
                fontSize = FemhoText.columnTitle,
                fontWeight = FontWeight.Black,
                color = Femho.colors.ink,
            )
            Text(
                text = stringResource(R.string.invite_subtitle),
                color = Femho.colors.inkSoft,
                fontSize = FemhoText.body,
            )
            if (done) {
                Text(
                    text = stringResource(R.string.invite_done),
                    color = Femho.colors.ink,
                    fontSize = FemhoText.body,
                )
            } else {
                androidx.compose.material3.TextField(
                    value = password,
                    onValueChange = { password = it },
                    label = { Text(stringResource(R.string.invite_password)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth().testTag("invite-password"),
                )
                androidx.compose.material3.TextField(
                    value = repeat,
                    onValueChange = { repeat = it },
                    label = { Text(stringResource(R.string.invite_repeat)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth().testTag("invite-repeat"),
                )
                val tooShortText = stringResource(R.string.invite_tooshort)
                val mismatchText = stringResource(R.string.invite_mismatch)
                val visibleError = localError ?: error
                if (visibleError != null) {
                    Text(
                        text = visibleError,
                        color = Femho.colors.dangerText,
                        fontSize = FemhoText.meta,
                    )
                }
                Text(
                    text = stringResource(R.string.nav_save),
                    color = Femho.onBrand,
                    fontSize = FemhoText.body,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(FemhoShape.pill))
                        .background(Femho.brandGradient2)
                        .clickable {
                            localError = when {
                                password.length < 10 -> tooShortText
                                password != repeat -> mismatchText
                                else -> null
                            }
                            if (localError == null) model.acceptInvite(token, password)
                        }
                        .padding(vertical = 12.dp),
                    textAlign = TextAlign.Center,
                )
            }
            Text(
                text = stringResource(R.string.nav_close),
                color = Femho.colors.inkSoft,
                fontSize = FemhoText.body,
                modifier = Modifier
                    .clickable(onClick = onDone)
                    .padding(vertical = 6.dp),
            )
        }
    }
}

@Composable
private fun Wordmark(modifier: Modifier = Modifier) {
    Text(
        text = stringResource(R.string.app_name),
        fontSize = FemhoText.wordmark,
        fontWeight = FontWeight.Black,
        color = Femho.colors.plouOrange,
        modifier = modifier,
    )
}

/**
 * El camp de servidor. docs/03 §2.
 *
 * **És la diferència deliberada amb la web**, que no en té: allà el servidor és el que
 * serveix la pàgina; aquí l'APK no sap on és la instància fins que l'hi diuen. Es valida
 * amb `GET /info` **abans** de demanar credencials, perquè ningú escrigui la contrasenya
 * en un lloc que no és el seu servidor.
 */
@Composable
private fun ServerScreen(model: AppViewModel, message: String?) {
    var value by remember { mutableStateOf("") }
    var insecure by remember { mutableStateOf<String?>(null) }

    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp).testTag("server-screen"),
        verticalArrangement = Arrangement.spacedBy(14.dp, Alignment.CenterVertically),
    ) {
        Wordmark()
        Text(
            stringResource(R.string.login_serverhint),
            color = Femho.colors.inkSoft,
            fontSize = FemhoText.body,
        )

        androidx.compose.material3.OutlinedTextField(
            value = value,
            onValueChange = { value = it },
            singleLine = true,
            label = { Text(stringResource(R.string.login_server)) },
            modifier = Modifier.fillMaxWidth().testTag("server-input"),
        )

        if (message != null) {
            Text(
                stringResource(R.string.login_serverunreachable),
                color = Femho.colors.dangerText,
                fontSize = FemhoText.body,
                modifier = Modifier.testTag("server-error"),
            )
        }

        // L'avís d'`http://` no és decoratiu: `network_security_config.xml` només el
        // permet en xarxes privades, i aquí es diu abans d'escriure cap contrasenya.
        insecure?.let {
            Text(
                stringResource(R.string.login_insecure),
                color = Femho.colors.dangerText,
                fontSize = FemhoText.meta,
                modifier = Modifier.testTag("server-insecure"),
            )
        }

        androidx.compose.material3.Button(
            onClick = { model.checkServer(value) { insecure = it } },
            modifier = Modifier.fillMaxWidth().testTag("server-check"),
        ) {
            Text(stringResource(R.string.login_checkserver))
        }
    }
}

@Composable
private fun CertConfirmScreen(model: AppViewModel, fingerprint: String) {
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp).testTag("cert-screen"),
        verticalArrangement = Arrangement.spacedBy(14.dp, Alignment.CenterVertically),
    ) {
        Wordmark()
        Text(
            stringResource(R.string.login_certtitle),
            color = Femho.colors.ink,
            fontSize = FemhoText.columnTitle,
        )
        Text(
            stringResource(R.string.login_certbody),
            color = Femho.colors.inkSoft,
            fontSize = FemhoText.body,
        )
        Text(
            text = fingerprint,
            color = Femho.colors.ink,
            fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace,
            fontSize = FemhoText.meta,
            modifier = Modifier.testTag("cert-fingerprint"),
        )
        androidx.compose.material3.Button(
            onClick = { model.confirmTrustedCert() },
            modifier = Modifier.fillMaxWidth().testTag("cert-confirm"),
        ) {
            Text(stringResource(R.string.login_certconfirm))
        }
        androidx.compose.material3.TextButton(
            onClick = { model.rejectTrustedCert() },
            modifier = Modifier.fillMaxWidth().testTag("cert-reject"),
        ) {
            Text(stringResource(R.string.login_certreject))
        }
    }
}

@Composable
private fun LoginScreen(
    model: AppViewModel,
    instanceName: String,
    serverNewer: Boolean,
    registration: String = "disabled",
    expired: Boolean = false,
) {
    var email by rememberSaveable { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    // Si la instància té registre obert, es pot passar a crear un compte (docs/12 §3).
    var showRegister by remember { mutableStateOf(false) }

    if (showRegister) {
        RegisterScreen(model, instanceName) { showRegister = false }
        return
    }

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp).testTag("login-screen"),
        verticalArrangement = Arrangement.spacedBy(14.dp, Alignment.CenterVertically),
    ) {
        Wordmark()
        Text(
            text = instanceName.ifEmpty { stringResource(R.string.login_subtitle) },
            color = Femho.colors.inkSoft,
            fontSize = FemhoText.body,
        )
        if (serverNewer) {
            Text(
                text = stringResource(R.string.login_servernewer),
                color = Femho.colors.dangerText,
                fontSize = FemhoText.meta,
            )
        }
        if (expired) {
            Text(stringResource(R.string.login_sessionexpired), color = Femho.colors.inkSoft)
        }

        androidx.compose.material3.OutlinedTextField(
            value = email,
            onValueChange = { email = it },
            singleLine = true,
            label = { Text(stringResource(R.string.login_email)) },
            keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(
                keyboardType = androidx.compose.ui.text.input.KeyboardType.Email,
                imeAction = androidx.compose.ui.text.input.ImeAction.Next,
            ),
            modifier = Modifier.fillMaxWidth().testTag("login-email"),
        )
        androidx.compose.material3.OutlinedTextField(
            value = password,
            onValueChange = { password = it },
            singleLine = true,
            visualTransformation = androidx.compose.ui.text.input.PasswordVisualTransformation(),
            label = { Text(stringResource(R.string.login_password)) },
            keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(
                keyboardType = androidx.compose.ui.text.input.KeyboardType.Password,
            ),
            modifier = Modifier.fillMaxWidth().testTag("login-password"),
        )

        error?.let { message ->
            Text(
                message.ifBlank { stringResource(R.string.error_generic) },
                color = Femho.colors.dangerText,
                fontSize = FemhoText.body,
                modifier = Modifier.testTag("login-error"),
            )
        }

        androidx.compose.material3.Button(
            enabled = email.isNotBlank() && password.isNotEmpty(),
            onClick = {
                error = null
                model.login(email.trim(), password) { error = it }
            },
            modifier = Modifier.fillMaxWidth().testTag("login-submit"),
        ) {
            Text(stringResource(R.string.login_submit))
        }

        androidx.compose.material3.TextButton(
            onClick = model::chooseAnotherServer,
            modifier = Modifier.fillMaxWidth().testTag("login-change-server"),
        ) {
            Text(stringResource(R.string.login_changeserver))
        }

        if (registration == "open") {
            Text(
                text = stringResource(R.string.login_register),
                color = Femho.colors.inkSoft,
                fontSize = FemhoText.body,
                fontWeight = FontWeight.Medium,
                modifier = Modifier
                    .padding(top = 4.dp)
                    .testTag("login-register")
                    .androidClickable { showRegister = true },
            )
        }
    }
}

@Composable
private fun RegisterScreen(model: AppViewModel, instanceName: String, onBack: () -> Unit) {
    var name by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    // El text es resol aquí i no dins del callback: `stringResource` és @Composable.
    val tooShortError = stringResource(R.string.invite_tooshort)

    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp).testTag("register-screen"),
        verticalArrangement = Arrangement.spacedBy(14.dp, Alignment.CenterVertically),
    ) {
        Wordmark()
        Text(
            text = instanceName.ifEmpty { stringResource(R.string.login_subtitle) },
            color = Femho.colors.inkSoft,
            fontSize = FemhoText.body,
        )
        Text(
            stringResource(R.string.register_title),
            color = Femho.colors.ink,
            fontSize = FemhoText.columnTitle,
            fontWeight = FontWeight.Black,
        )
        Text(
            stringResource(R.string.register_subtitle),
            color = Femho.colors.inkSoft,
            fontSize = FemhoText.meta,
        )

        androidx.compose.material3.OutlinedTextField(
            value = name,
            onValueChange = { name = it },
            singleLine = true,
            label = { Text(stringResource(R.string.register_name)) },
            modifier = Modifier.fillMaxWidth().testTag("register-name"),
        )
        androidx.compose.material3.OutlinedTextField(
            value = email,
            onValueChange = { email = it },
            singleLine = true,
            label = { Text(stringResource(R.string.login_email)) },
            modifier = Modifier.fillMaxWidth().testTag("register-email"),
        )
        androidx.compose.material3.OutlinedTextField(
            value = password,
            onValueChange = { password = it },
            singleLine = true,
            visualTransformation = androidx.compose.ui.text.input.PasswordVisualTransformation(),
            label = { Text(stringResource(R.string.login_password)) },
            modifier = Modifier.fillMaxWidth().testTag("register-password"),
        )

        if (error != null) {
            Text(
                stringResource(R.string.register_error),
                color = Femho.colors.dangerText,
                fontSize = FemhoText.body,
                modifier = Modifier.testTag("register-error"),
            )
        }

        androidx.compose.material3.Button(
            onClick = {
                // El servidor demana contrasenyes de com a mínim 10 caràcters (invite.tooShort).
                if (password.length < 10) {
                    error = tooShortError
                } else {
                    model.register(name.trim(), email.trim(), password) { error = it }
                }
            },
            modifier = Modifier.fillMaxWidth().testTag("register-submit"),
        ) {
            Text(stringResource(R.string.register_submit))
        }

        Text(
            text = stringResource(R.string.register_haveaccount),
            color = Femho.colors.inkSoft,
            fontSize = FemhoText.body,
            fontWeight = FontWeight.Medium,
            modifier = Modifier
                .padding(top = 4.dp)
                .testTag("register-back")
                .androidClickable(onBack),
        )
    }
}

@Composable
private fun WelcomeScreen(model: AppViewModel) {
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp).testTag("welcome-screen"),
        verticalArrangement = Arrangement.spacedBy(14.dp, Alignment.CenterVertically),
    ) {
        Wordmark()
        Text(
            text = stringResource(R.string.welcome_title),
            color = Femho.colors.ink,
            fontSize = FemhoText.columnTitle,
            fontWeight = FontWeight.Black,
        )
        Text(
            text = stringResource(R.string.welcome_lead),
            color = Femho.colors.inkSoft,
            fontSize = FemhoText.body,
        )

        // Les dues targetes del wizard, igual que a la web (WelcomeScreen.tsx): triar
        // una desa el mode d'àmbits i tanca el wizard.
        WelcomeCard(
            title = stringResource(R.string.welcome_multi),
            body = stringResource(R.string.welcome_multi_body),
            testTag = "welcome-multi",
            onClick = { model.setScopeMode("multi") },
        )
        WelcomeCard(
            title = stringResource(R.string.welcome_single),
            body = stringResource(R.string.welcome_single_body),
            testTag = "welcome-single",
            onClick = { model.setScopeMode("single") },
        )

        Text(
            text = stringResource(R.string.welcome_changeable),
            color = Femho.colors.inkFaint,
            fontSize = FemhoText.meta,
            modifier = Modifier.padding(top = 4.dp),
        )
    }
}

@Composable
private fun WelcomeCard(title: String, body: String, testTag: String, onClick: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(FemhoShape.card))
            .background(Femho.colors.cardBg)
            .border(1.dp, Femho.colors.cardBorder, RoundedCornerShape(FemhoShape.card))
            .clickable(onClick = onClick)
            .padding(16.dp)
            .testTag(testTag),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(
            text = title,
            color = Femho.colors.ink,
            fontSize = FemhoText.body,
            fontWeight = FontWeight.Bold,
        )
        Text(
            text = body,
            color = Femho.colors.inkSoft,
            fontSize = FemhoText.meta,
        )
    }
}

@Composable
private fun BoardHost(
    model: AppViewModel,
    requestedStatus: TaskStatus?,
    onStatusOpened: () -> Unit,
    onSettings: () -> Unit,
    onCalendar: () -> Unit,
    onSearch: () -> Unit,
    onDashboard: () -> Unit,
    onPomodoro: (() -> Unit)?,
) {
    val tasks by model.tasks.collectAsStateWithLifecycle()
    val scopes by model.scopes.collectAsStateWithLifecycle()
    val pending by model.pending.collectAsStateWithLifecycle()
    val syncIssues by model.syncIssues.collectAsStateWithLifecycle()
    var showSyncIssues by rememberSaveable { mutableStateOf(false) }
    val projects by model.projects.collectAsStateWithLifecycle()
    val people by model.people.collectAsStateWithLifecycle()
    val taskTypes by model.taskTypes.collectAsStateWithLifecycle()
    val labels by model.labels.collectAsStateWithLifecycle()

    // El detall de tasca llegeix etiquetes i tipologies; si no es carreguen aquí, la
    // secció del detall surt buida fins que s'obren els Ajustos.
    LaunchedEffect(Unit) { model.loadEntityData() }
    LaunchedEffect(Unit) { aiResponse { model.loadAiTaskSettings() } }
    val aiTaskSettings by model.aiTaskSettings.collectAsStateWithLifecycle()
    val copyTaskContext = rememberCopyTaskContext(model)
    val cardAiAction = rememberCardAiAction(model, copyTaskContext)
    val quickAddDraft by model.quickAddDraft.collectAsStateWithLifecycle()
    val quickAddTexts by model.quickAddTexts.collectAsStateWithLifecycle()
    val quickAddSaving by model.quickAddSaving.collectAsStateWithLifecycle()
    val pinned by model.pinned.collectAsStateWithLifecycle()
    val activeProjects by model.activeProjects.collectAsStateWithLifecycle()
    val expandedCards by model.expandedCards.collectAsStateWithLifecycle()
    val openCards by model.openCards.collectAsStateWithLifecycle()
    val cardLists by model.cardLists.collectAsStateWithLifecycle()
    val cardDrafts by model.cardDrafts.collectAsStateWithLifecycle()
    val aiEnabled by model.aiEnabled.collectAsStateWithLifecycle()
    val aiBoard by model.aiBoard.collectAsStateWithLifecycle()
    val aiBoardLabel = stringResource(R.string.board_ia_toggle)
    val activeScopeIds by model.activeScopes.collectAsStateWithLifecycle()
    val active = activeScopeIds.toSet()
    val timezone by model.profileTimezone.collectAsStateWithLifecycle()
    val zone = remember(timezone) { runCatching { ZoneId.of(timezone) }.getOrElse { ZoneId.systemDefault() } }
    val today = rememberProfileToday(zone)
    var selectedDoneDay by rememberSaveable { mutableStateOf<String?>(null) }
    val doneDay = selectedDoneDay?.let(LocalDate::parse)?.coerceAtMost(today) ?: today
    val doneDayLabel = doneDateLabel(doneDay)
    val doneEmptyLabel = if (doneDay == today) stringResource(R.string.board_empty_done)
    else stringResource(R.string.board_done_emptyday).replace("{day}", doneDayLabel)
    val doneClearedAt by model.doneClearedAt.collectAsStateWithLifecycle()
    val doneSettingsSaving by model.doneSettingsSaving.collectAsStateWithLifecycle()
    val weekStartChoice by model.preferenceWeekStart.collectAsStateWithLifecycle(initialValue = "auto")
    val doneFilter = remember(zone, today, doneDay, doneClearedAt) {
        DoneDayFilter(zone, today, doneDay, doneClearedAt)
    }
    LifecycleResumeEffect(model) {
        model.loadProfile()
        onPauseOrDispose { }
    }

    // Els textos es resolen aquí i no dins dels callbacks: `stringResource` és
    // `@Composable` i no es pot cridar des d'una lambda que no ho és.
    val quickAddError = stringResource(R.string.board_quickadd_scoperequiredprefix)
    /**
     * El camp anuncia **només el sigil que serveix per a alguna cosa**, amb la mateixa
     * regla que la web: amb un sol àmbit actiu `#` no cal —s'agafa l'únic— i sense ningú
     * més `@` no té a qui assignar. Tres claus i no una perquè el text canvia sencer.
     */
    val quickAddPlain = stringResource(R.string.board_quickadd_placeholder_plain)
    val quickAddScope = stringResource(R.string.board_quickadd_placeholder_scope)
    val quickAddPerson = stringResource(R.string.board_quickadd_placeholder_person)
    val listsCollapsed = stringResource(R.string.card_lists_collapsed)
    val listsExpandedLabel = stringResource(R.string.card_lists_expanded)
    val addToggleLabel = stringResource(R.string.card_add)
    val addPlaceholder = stringResource(R.string.card_addplaceholder)
    val editLabel = stringResource(R.string.task_edit)
    val advanceTemplate = stringResource(R.string.board_card_advance)
    val pinLabel = stringResource(R.string.checklist_pin)
    val unpinLabel = stringResource(R.string.checklist_unpinaction)
    val toggleItemTemplate = stringResource(R.string.checklist_toggleitem)
    val subtaskActionsLabels = subtaskRowLabels()
    // "+ Afegir a {columna}…" per a cada columna: el text porta el nom de la columna i
    // `stringResource` no es pot cridar des del `footer`, que no és `@Composable` allà.
    val columnAddLabels = mapOf(
        TaskStatus.INBOX to stringResource(R.string.board_column_inbox),
        TaskStatus.TODO to stringResource(R.string.board_column_todo),
        TaskStatus.DOING to stringResource(R.string.board_column_doing),
        TaskStatus.DONE to stringResource(R.string.board_column_done),
    ).mapValues { (_, name) ->
        // El catàleg porta `{column}` literal: la substitució és aquí, com a la web, i
        // no amb `%1$s`, que faria divergir el text de les dues apps.
        val actius = if (active.isEmpty()) scopes.map { it.id } else active.toList()
        val plantilla =
            when {
                actius.size > 1 -> quickAddScope
                people.size > 1 -> quickAddPerson
                else -> quickAddPlain
            }
        plantilla.replace("{column}", name)
    }
    val manualLabel = stringResource(R.string.ai_mode_manual)
    val assistedLabel = stringResource(R.string.ai_mode_assisted)
    val delegatedLabel = stringResource(R.string.ai_mode_delegated)

    val perAmbit = if (active.isEmpty()) tasks else tasks.filter { it.scopeId in active }

    /**
     * El filtre de projectes (`docs/14` P7).
     *
     * **Un àmbit sense res triat vol dir "tots els seus"**, o sigui que no n'hi ha prou
     * de mirar si el projecte de la tasca és a la llista: una tasca d'un àmbit sense tria
     * hi ha de ser igualment, i una **sense projecte** d'un àmbit amb tria, no.
     */
    val visible = if (activeProjects.isEmpty()) {
        perAmbit
    } else {
        perAmbit.filter { task ->
            val teTria = projects.any { it.scopeId == task.scopeId && it.id in activeProjects }
            if (!teTria) true else task.projectId != null && task.projectId in activeProjects
        }
    }

    CalendarSuggestionsSyncEffect(model)
    LaunchedEffect(today) { model.refreshCalendarSuggestions() }
    val calendarSuggestions by model.calendarSuggestions.collectAsStateWithLifecycle()
    val calendarSnapshot = calendarSuggestions.snapshot
    val suggestionTime = rememberCalendarSuggestionTime(calendarSnapshot)
    val availableScopes = scopes.map { it.id }.toSet()
    val visibleTasks = visible.associateBy { it.id }
    val scheduled = if (aiBoard) emptyList() else calendarSnapshot.visibleItems(suggestionTime).filter { item ->
        val task = visibleTasks[item.taskId]
        item.scopeId in availableScopes && (active.isEmpty() || item.scopeId in active) &&
            (projects.none { it.scopeId == item.scopeId && it.id in activeProjects } || item.projectId in activeProjects) &&
            (task == null || task.status in listOf(TaskStatus.TODO, TaskStatus.INBOX))
    }
    val calendarGroups = scheduled.groupBy { it.column(suggestionTime) }
        .mapValues { (_, items) -> items.groupBy { it.scopeId } }
    val projectedTaskIds = scheduled.mapNotNull { it.taskId }.toSet()
    var startConfirmation by remember { mutableStateOf<Pair<CalendarTaskSuggestion, CalendarTaskStart>?>(null) }
    startConfirmation?.let { (item, start) ->
        val current = scheduled.find { it.occurrence == item.occurrence && it.startsAt == item.startsAt && it.canStart }
        if (current == null || (start == CalendarTaskStart.PLANNED && !current.permitsPlannedStart(suggestionTime))) {
            LaunchedEffect(item) { startConfirmation = null }
        } else {
            CalendarSuggestionStartDialog(current, start, zone, taskTypes.filter { it.scopeId == current.scopeId },
                onConfirm = { type ->
                    startConfirmation = null
                    model.actOnCalendarSuggestion(current, start, current.requiresShareConfirmation, type)
                }, onDismiss = { startConfirmation = null })
        }
    }

    Column(Modifier.fillMaxSize()) {
        TopBar(
            pinned = pinned,
            /**
             * **S'obre la tasca que la conté**, no una pantalla de llista.
             *
             * A Android les llistes viuen dins de la tasca —no hi ha `Screen.LIST`, i
             * `docs/03` no en descriu cap—, o sigui que la drecera porta on la llista es
             * pot llegir i marcar. A la web sí que hi ha pantalla pròpia i el menú hi va.
             */
            onOpenList = { id -> pinned.find { it.id == id }?.let { model.openById(it.taskId) } },
            projects = projects,
            activeProjects = activeProjects,
            onToggleProject = { model.toggleProject(it) },
            onAllProjects = { model.clearProjectsOfScope(it) },
            scopes = scopes,
            active = active,
            pending = pending,
            view = Screen.BOARD,
            onPomodoro = onPomodoro,
            onToggle = model::toggleScope,
            onSettings = onSettings,
            onDashboard = onDashboard,
            onView = {
                when (it) {
                    Screen.CALENDAR -> onCalendar()
                    Screen.SEARCH -> onSearch()
                    else -> Unit
                }
            },
            aiEnabled = aiEnabled,
            aiBoardActive = aiBoard,
            onToggleAiBoard = model::toggleAiBoard,
            aiBoardLabel = aiBoardLabel,
            attentionCount = visible.count { it.needsAttention },
        )
        if (syncIssues.isNotEmpty()) {
            androidx.compose.material3.TextButton(
                onClick = { showSyncIssues = true },
                modifier = Modifier.testTag("sync-issues"),
            ) {
                Text(stringResource(R.string.sync_reviewchanges).replace("{count}", syncIssues.size.toString()))
            }
        }
        if (showSyncIssues && syncIssues.isNotEmpty()) {
            SyncIssuesDialog(syncIssues, model::resolveSyncIssue) { showSyncIssues = false }
        }

        val lockNoticeContext = androidx.compose.ui.platform.LocalContext.current
        val lockNoticeText = stringResource(R.string.ai_lock_card)

        BoardScreen(
            requestedStatus = requestedStatus,
            onStatusOpened = onStatusOpened,
            tasks = visible.filterNot { it.id in projectedTaskIds },
            calendarGroups = calendarGroups,
            calendarScopeLabel = { id -> scopes.firstOrNull { it.id == id }?.name.orEmpty() },
            calendarSuggestionCard = { item, column ->
                CalendarSuggestionCard(item, column, suggestionTime, zone,
                    onStart = { start ->
                        if (item.requiresShareConfirmation || item.requiresTaskType) startConfirmation = item to start
                        else model.actOnCalendarSuggestion(item, start)
                    }, onDecline = { model.actOnCalendarSuggestion(item, null) })
            },
            calendarTaskMetadata = { CalendarTaskMetadata(it) },
            doneDay = doneFilter,
            doneHeader = {
                DoneColumnHeader(
                    day = doneDay,
                    today = today,
                    dayLabel = doneDayLabel,
                    clearedToday = doneFilter.clearedToday,
                    saving = doneSettingsSaving,
                    weekStartChoice = weekStartChoice,
                    onSelectDay = { date -> selectedDoneDay = date.takeUnless { it == today }?.toString() },
                    onSetClearedAt = model::setDoneClearedAt,
                )
            },
            labels = BoardLabels(
                columns = mapOf(
                    TaskStatus.INBOX to stringResource(R.string.board_column_inbox),
                    TaskStatus.TODO to stringResource(R.string.board_column_todo),
                    TaskStatus.DOING to stringResource(R.string.board_column_doing),
                    TaskStatus.DONE to stringResource(R.string.board_column_done),
                ),
                empty = mapOf(
                    TaskStatus.INBOX to stringResource(R.string.board_empty_inbox),
                    TaskStatus.TODO to stringResource(R.string.board_empty_todo),
                    TaskStatus.DOING to stringResource(R.string.board_empty_doing),
                    TaskStatus.DONE to doneEmptyLabel,
                ),
                advance = mapOf(
                    TaskStatus.INBOX to advanceTemplate.replace(
                        "{column}",
                        stringResource(R.string.board_column_todo),
                    ),
                    TaskStatus.TODO to advanceTemplate.replace(
                        "{column}",
                        stringResource(R.string.board_column_doing),
                    ),
                ),
                toggle = stringResource(R.string.sync_complete),
                lock = stringResource(R.string.ai_lock_card),
                attention = stringResource(R.string.ai_attention_card),
                claim = stringResource(R.string.ai_takeover_action),
            ),
            onOpen = model::open,
            taskMenuLabels = TaskMenuLabels(
                openActions = stringResource(R.string.task_actions),
                edit = editLabel,
                move = stringResource(R.string.task_move),
                delete = stringResource(R.string.nav_delete),
                deleteConfirm = stringResource(R.string.task_deleteconfirm),
                cancel = stringResource(R.string.nav_cancel),
                copyContext = stringResource(R.string.ai_tasks_copy),
            ),
            onDelete = model::deleteTask,
            canCopyContext = { task -> aiTaskSettings.orEmpty().any { it.scopeId == task.scopeId && it.enabled } },
            onCopyContext = { task -> copyTaskContext(task.id) },
            aiAction = cardAiAction,
            mcpLabels = mcpProvenanceLabels(),
            onMove = { task, status -> model.move(task, status) },
            onToggle = { task ->
                model.move(task, if (task.status == TaskStatus.DONE) TaskStatus.TODO else TaskStatus.DONE)
            },
            onClaim = { task -> model.claim(task) },
            onLocked = { _ ->
                android.widget.Toast.makeText(
                    lockNoticeContext,
                    lockNoticeText,
                    android.widget.Toast.LENGTH_SHORT,
                ).show()
            },
            modifier = Modifier.weight(1f),
            /**
             * L'afegida ràpida, **al peu de cada columna i amb el mateix parser que la
             * web**. El disseny validat la posa aquí i no sota el tauler; abans, escriure
             * mirant "Per fer" deixava la targeta a la bústia sense dir-ho.
             *
             * `parseQuickAdd` viu a `:core-model` i `parser-parity` el compara amb el de
             * TypeScript amb els mateixos fixtures. Una versió pròpia aquí divergiria al
             * primer cas rar.
             */
            footer = { status ->
                QuickAddField(
                    context = QuickAddContext(
                        scopes = scopes.map { scope ->
                            QuickAddScope(
                                id = scope.id,
                                name = scope.name,
                                projects = projects
                                    .filter { it.scopeId == scope.id }
                                    .map { QuickAddProject(it.id, it.name) },
                            )
                        },
                        people = people.map { QuickAddPerson(it.id, it.name) },
                        activeScopeIds =
                            if (active.isEmpty()) scopes.map { it.id } else active.toList(),
                        taskTypes = taskTypes.map { QuickAddTaskType(it.id, it.name, it.scopeId) },
                    ),
                    placeholder = columnAddLabels[status].orEmpty(),
                    scopeRequiredLabel = { names -> quickAddError + names },
                    aiModeLabel = { mode ->
                        when (mode) {
                            "assisted" -> assistedLabel
                            "delegated" -> delegatedLabel
                            else -> manualLabel
                        }
                    },
                    initialText = if (status == TaskStatus.INBOX) quickAddDraft.orEmpty() else "",
                    addLabel = stringResource(R.string.task_new),
                    creationError = stringResource(R.string.board_quickadd_failed),
                    draftText = quickAddTexts[status].orEmpty(),
                    onDraftChange = { model.setQuickAddText(status, it) },
                    savingExternally = status in quickAddSaving,
                    focusRequested = status == TaskStatus.INBOX && requestedStatus == null && quickAddDraft != null,
                    onFocusHandled = model::quickAddConsumed,
                    onCreate = { result, finished -> model.create(result, status, finished) },
                    modifier = Modifier.padding(top = 8.dp).testTag("quick-add-${status.name.lowercase()}"),
                )
            },
            /**
             * Les subtasques i les llistes, a la mateixa targeta.
             *
             * **Un sol commutador per a totes dues**, i el número que hi surt compta
             * blocs i no ítems: les subtasques, totes juntes, en són un.
             */
            aiBoard = aiBoard,
            extras = { task ->
                val blocs = task.progress?.lists ?: 0
                val expanded = task.id in expandedCards
                val carregat = cardLists[task.id]
                val draft = cardDrafts[task.id].orEmpty()

                CardExtras(
                    onEdit = { model.open(task) },
                    editLabel = editLabel,
                    lists = buildList {
                        val subtasks = carregat?.subtasks.orEmpty()
                        if (subtasks.isNotEmpty()) {
                            add(
                                CardList(
                                    id = "subtasks-${task.id}",
                                    name = null,
                                    items = subtasks.map { sub ->
                                        CardListItem(
                                            id = sub.id,
                                            text = sub.title,
                                            done = sub.done,
                                            toggleLabel = toggleItemTemplate.replace("{text}", sub.title),
                                            onToggle = {
                                                model.toggleSubtask(task.id, sub.id, !sub.done)
                                            },
                                            subtaskActions = subtaskActionsLabels.actions(model, task.id, sub.id),
                                        )
                                    },
                                ),
                            )
                        }
                        carregat?.checklists.orEmpty().forEach { llista ->
                            add(
                                CardList(
                                    id = llista.id,
                                    name = llista.name,
                                    pinned = llista.pinned,
                                    pinLabel = if (llista.pinned) unpinLabel else pinLabel,
                                    onPinToggle = { model.togglePinList(task.id, llista) },
                                    items = llista.items.map { item ->
                                        CardListItem(
                                            id = item.id,
                                            text = item.text,
                                            done = item.done,
                                            toggleLabel = toggleItemTemplate.replace("{text}", item.text),
                                            onToggle = {
                                                model.toggleCardItem(task.id, item.id, !item.done)
                                            },
                                        )
                                    },
                                ),
                            )
                        }
                    },
                    expanded = expanded,
                    // Sense cap bloc no hi ha res a desplegar, i el commutador no surt.
                    toggleLabel = if (blocs == 0) {
                        null
                    } else {
                        (if (expanded) listsExpandedLabel else listsCollapsed)
                            .replace("{count}", blocs.toString())
                    },
                    onToggleLists = { model.toggleCard(task) },
                    addForm = CardAddForm(
                        open = task.id in openCards,
                        onToggle = { model.toggleCardForm(task) },
                        toggleLabel = addToggleLabel,
                        placeholder = addPlaceholder,
                        text = draft,
                        onText = { model.setCardDraft(task.id, it) },
                        onSubmit = { model.submitCardAdd(task) },
                    ),
                )
            },
        )
    }

    // El full de detall es crida des de `Session.Ready`, per sobre de totes les
    // pantalles: si visqués aquí dins, la cerca no el podria obrir (tasca 31).
}

@Composable
private fun SyncIssuesDialog(
    issues: List<ho.fem.data.SyncIssue>,
    onResolve: (String, Boolean) -> Unit,
    onClose: () -> Unit,
) {
    androidx.compose.material3.AlertDialog(
        onDismissRequest = onClose,
        title = { Text(stringResource(R.string.sync_issuestitle)) },
        text = {
            Column(
                Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                issues.forEach { issue ->
                    androidx.compose.runtime.key(issue.opId) {
                        Column {
                            Text(
                                issue.title ?: stringResource(R.string.sync_unknownoperation),
                                fontWeight = FontWeight.Bold,
                            )
                            Text(
                                issue.detail ?: stringResource(
                                    if (issue.kind == "conflict") R.string.sync_conflict else R.string.sync_rejected,
                                ),
                            )
                            if (issue.canKeepLocal) {
                                androidx.compose.material3.TextButton(
                                    onClick = { onResolve(issue.opId, true) },
                                    modifier = Modifier.testTag("sync-keep-local"),
                                ) { Text(stringResource(R.string.sync_applymychange)) }
                            }
                            androidx.compose.material3.TextButton(
                                onClick = { onResolve(issue.opId, false) },
                                modifier = Modifier.testTag("sync-keep-server"),
                            ) {
                                Text(
                                    stringResource(
                                        if (issue.canKeepLocal) R.string.sync_keepserver else R.string.sync_discardchange,
                                    ),
                                )
                            }
                        }
                    }
                }
            }
        },
        confirmButton = {
            androidx.compose.material3.TextButton(onClick = onClose) {
                Text(stringResource(R.string.nav_close))
            }
        },
    )
}

@Composable
private fun mcpProvenanceLabels() = McpProvenanceLabels(
    badge = stringResource(R.string.source_mcp),
    details = stringResource(R.string.source_mcpdetails),
    creation = stringResource(R.string.source_mcpcreation),
    lastChange = stringResource(R.string.source_mcplastchange),
    unspecified = stringResource(R.string.source_mcpunspecified),
)

private fun taskOriginMetadata(task: Task): (@Composable () -> Unit)? {
    val activity = task.mcpActivity
    if (!task.fromCalendar && activity == null) return null
    return {
        if (task.fromCalendar) CalendarOriginBadge()
        if (activity != null) McpProvenanceBadge(activity, mcpProvenanceLabels(), compact = true)
    }
}

@Composable
private fun subtaskRowLabels() = SubtaskRowLabels(
    actions = stringResource(R.string.subtask_actions),
    edit = stringResource(R.string.subtask_edit),
    delete = stringResource(R.string.subtask_delete),
    deleteConfirm = stringResource(R.string.subtask_deleteconfirm),
    title = stringResource(R.string.task_title),
    save = stringResource(R.string.nav_save),
    cancel = stringResource(R.string.nav_cancel),
    error = stringResource(R.string.error_generic),
)

private fun SubtaskRowLabels.actions(model: AppViewModel, taskId: String, subtaskId: String) = SubtaskRowActions(
    labels = this,
    onEdit = { title, finished -> model.renameSubtask(taskId, subtaskId, title, finished) },
    onDelete = { model.deleteSubtask(taskId, subtaskId) },
)

@Composable
private fun TaskDetailSheet(model: AppViewModel) {
    val openTask by model.openTask.collectAsStateWithLifecycle()
    val taskLists by model.openTaskLists.collectAsStateWithLifecycle()
    val openComments by model.openComments.collectAsStateWithLifecycle()
    val openActivity by model.openActivity.collectAsStateWithLifecycle()
    val timezone by model.profileTimezone.collectAsStateWithLifecycle()
    val openShares by model.openShares.collectAsStateWithLifecycle()
    val createdShareUrl by model.createdShareUrl.collectAsStateWithLifecycle()
    val openAttachments by model.openAttachments.collectAsStateWithLifecycle()
    val attachmentError by model.attachmentError.collectAsStateWithLifecycle()
    val taskSaveError by model.taskSaveError.collectAsStateWithLifecycle()
    val taskSaving by model.taskSaving.collectAsStateWithLifecycle()
    val scopes by model.scopes.collectAsStateWithLifecycle()
    val projects by model.projects.collectAsStateWithLifecycle()
    val people by model.people.collectAsStateWithLifecycle()
    val taskTypes by model.taskTypes.collectAsStateWithLifecycle()
    val labels by model.labels.collectAsStateWithLifecycle()
    val manualLabel = stringResource(R.string.ai_mode_manual)
    val assistedLabel = stringResource(R.string.ai_mode_assisted)
    val delegatedLabel = stringResource(R.string.ai_mode_delegated)
    val subtaskActionsLabels = subtaskRowLabels()

    openTask?.let { task ->
        val context = androidx.compose.ui.platform.LocalContext.current
        val locale = androidx.compose.ui.platform.LocalConfiguration.current.locales[0] ?: Locale.getDefault()
        val activityTime = remember(locale, timezone) {
            val zone = runCatching { ZoneId.of(timezone) }.getOrElse { ZoneId.systemDefault() }
            DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT).withLocale(locale).withZone(zone)
        }
        val picker = androidx.activity.compose.rememberLauncherForActivityResult(
            androidx.activity.result.contract.ActivityResultContracts.GetContent(),
        ) { uri ->
            if (uri != null) {
                val name = runCatching {
                    context.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
                        val idx = cursor.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
                        if (idx >= 0) cursor.getString(idx) else null
                    }
                }.getOrNull() ?: "adjunt"
                val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                if (bytes != null) model.uploadTaskAttachment(task, name, bytes)
            }
        }
        val openAttachment = { attachment: ho.fem.model.Attachment, bytes: ByteArray ->
            runCatching {
                val dir = java.io.File(context.cacheDir, "adjunts").apply { mkdirs() }
                val file = java.io.File(dir, attachment.filename)
                file.writeBytes(bytes)
                val uri = androidx.core.content.FileProvider.getUriForFile(
                    context,
                    "${context.packageName}.fileprovider",
                    file,
                )
                val intent = android.content.Intent(android.content.Intent.ACTION_VIEW)
                    .setDataAndType(uri, attachment.mimeType)
                    .addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
                context.startActivity(intent)
            }
        }
        TaskDetail(
            task = task,
            subtasks = taskLists.subtasks,
            checklists = taskLists.checklists,
            projects = projects,
            people = people,
            taskTypes = taskTypes,
            labelsList = labels,
            isCollectiveScope = scopes.any { it.id == task.scopeId && it.kind == ho.fem.model.ScopeKind.COLLECTIVE },
            comments = openComments,
            activity = openActivity,
            labels = TaskDetailLabels(
                title = stringResource(R.string.task_title),
                description = stringResource(R.string.task_description),
                project = stringResource(R.string.task_project),
                noProject = stringResource(R.string.task_noproject),
                dueDate = stringResource(R.string.task_duedate),
                dueTime = stringResource(R.string.task_duetime),
                deadline = stringResource(R.string.task_deadline),
                recurrence = stringResource(R.string.task_recurrence),
                recurrenceNone = stringResource(R.string.task_recurrence_none),
                recurrenceDaily = stringResource(R.string.task_recurrence_daily),
                recurrenceWeekly = stringResource(R.string.task_recurrence_weekly),
                recurrenceMonthly = stringResource(R.string.task_recurrence_monthly),
                recurrenceYearly = stringResource(R.string.task_recurrence_yearly),
                recurrenceFromCompletion = stringResource(R.string.task_recurrence_fromcompletion),
                assignees = stringResource(R.string.task_assignees),
                taskType = stringResource(R.string.task_tasktype),
                noType = stringResource(R.string.stats_notype),
                labels = stringResource(R.string.task_labels),
                newLabel = stringResource(R.string.task_newlabel),
                newLabelPlaceholder = stringResource(R.string.task_newlabel_placeholder),
                emptyLabels = stringResource(R.string.task_empty_labels),
                labelAdd = stringResource(R.string.task_label_add),
                labelRemove = stringResource(R.string.task_label_remove),
                comments = stringResource(R.string.task_comments),
                commentPlaceholder = stringResource(R.string.task_newcomment),
                emptyComments = stringResource(R.string.task_empty_comments),
                activity = stringResource(R.string.task_activity),
                undo = stringResource(R.string.activity_undo),
                activitySources = mapOf(
                    "api" to stringResource(R.string.activity_source_api),
                    "android" to stringResource(R.string.activity_source_android),
                    "caldav" to stringResource(R.string.activity_source_caldav),
                    "federation" to stringResource(R.string.activity_source_federation),
                    "mcp" to stringResource(R.string.activity_source_mcp),
                    "share" to stringResource(R.string.activity_source_share),
                    "system" to stringResource(R.string.activity_source_system),
                    "web" to stringResource(R.string.activity_source_web),
                ),
                unknownActivitySource = stringResource(R.string.activity_source_unknown),
                mcp = mcpProvenanceLabels(),
                delete = stringResource(R.string.nav_delete),
                cancel = stringResource(R.string.nav_cancel),
                deleteConfirm = stringResource(R.string.task_deleteconfirm),
                lockWorking = stringResource(R.string.ai_lock_working),
                takeOverAction = stringResource(R.string.ai_takeover_action),
                takeOverWhere = stringResource(R.string.ai_takeover_where),
                share = stringResource(R.string.share_title),
                sharePermission = stringResource(R.string.share_permission),
                sharePermissionOptions = listOf(
                    "view" to stringResource(R.string.share_permission_view),
                    "check" to stringResource(R.string.share_permission_check),
                    "comment" to stringResource(R.string.share_permission_comment),
                ),
                shareRequireName = stringResource(R.string.share_requirename),
                sharePassword = stringResource(R.string.share_password),
                sharePasswordPlaceholder = stringResource(R.string.share_passwordplaceholder),
                shareExpiresAt = stringResource(R.string.share_expiresat),
                shareMaxViews = stringResource(R.string.share_maxviews),
                shareCreate = stringResource(R.string.nav_create),
                shareCopy = stringResource(R.string.tokens_copy),
                shareRevoke = stringResource(R.string.share_revoke),
                shareRevoked = stringResource(R.string.share_revoked),
                shareOnceWarning = stringResource(R.string.tokens_oncewarning),
                shareClose = stringResource(R.string.nav_close),
                attachments = stringResource(R.string.task_attachments),
                addAttachment = stringResource(R.string.task_addattachment),
                emptyAttachments = stringResource(R.string.task_empty_attachments),
                removeAttachment = stringResource(R.string.task_removeattachment),
                attachmentTooBig = stringResource(R.string.task_attachmenttoobig),
                activityVerbs = mapOf(
                    "ai_execution_requested" to stringResource(R.string.activity_verb_ai_execution_requested),
                    "ai_execution_updated" to stringResource(R.string.activity_verb_ai_execution_updated),
                    "ai_execution_result" to stringResource(R.string.activity_verb_ai_execution_result),
                    "answered" to stringResource(R.string.activity_verb_answered),
                    "asked" to stringResource(R.string.activity_verb_asked),
                    "attachment.created" to stringResource(R.string.activity_verb_attachment_created),
                    "cascade_complete" to stringResource(R.string.activity_verb_cascade_complete),
                    "checklist.created" to stringResource(R.string.activity_verb_checklist_created),
                    "checklist_item.completed" to stringResource(R.string.activity_verb_checklist_item_completed),
                    "checklist_item.created" to stringResource(R.string.activity_verb_checklist_item_created),
                    "checklist_item.reopened" to stringResource(R.string.activity_verb_checklist_item_reopened),
                    "checklist_item.updated" to stringResource(R.string.activity_verb_checklist_item_updated),
                    "claimed" to stringResource(R.string.activity_verb_claimed),
                    "commented" to stringResource(R.string.activity_verb_commented),
                    "completed" to stringResource(R.string.activity_verb_completed),
                    "created" to stringResource(R.string.activity_verb_created),
                    "deleted" to stringResource(R.string.activity_verb_deleted),
                    "moved" to stringResource(R.string.activity_verb_moved),
                    "refreshed" to stringResource(R.string.activity_verb_refreshed),
                    "released" to stringResource(R.string.activity_verb_released),
                    "reopened" to stringResource(R.string.activity_verb_reopened),
                    "subtask.created" to stringResource(R.string.activity_verb_subtask_created),
                    "subtask.updated" to stringResource(R.string.activity_verb_subtask_updated),
                    "subtask.completed" to stringResource(R.string.activity_verb_subtask_completed),
                    "subtask.reopened" to stringResource(R.string.activity_verb_subtask_reopened),
                    "token_created" to stringResource(R.string.activity_verb_token_created),
                    "token_revoked" to stringResource(R.string.activity_verb_token_revoked),
                    "updated" to stringResource(R.string.activity_verb_updated),
                ),
                status = mapOf(
                    TaskStatus.INBOX to stringResource(R.string.board_column_inbox),
                    TaskStatus.TODO to stringResource(R.string.board_column_todo),
                    TaskStatus.DOING to stringResource(R.string.board_column_doing),
                    TaskStatus.DONE to stringResource(R.string.board_column_done),
                ),
                aiMode = mapOf(
                    AiMode.MANUAL to manualLabel,
                    AiMode.ASSISTED to assistedLabel,
                    AiMode.DELEGATED to delegatedLabel,
                ),
                subtasks = stringResource(R.string.task_subtasks),
                subtaskToggle = stringResource(R.string.checklist_toggleitem),
                checklists = stringResource(R.string.task_checklists),
                toggle = stringResource(R.string.sync_complete),
                save = stringResource(R.string.nav_save),
                close = stringResource(R.string.nav_close),
                emptyChecklists = stringResource(R.string.checklist_empty),
                discardDraftTitle = stringResource(R.string.task_discarddrafttitle),
                discardDraftMessage = stringResource(R.string.task_discarddraftmessage),
                discardDraft = stringResource(R.string.task_discarddraft),
                commentError = stringResource(R.string.error_generic),
            ),
            onSave = { fields, mode -> model.saveTaskDetails(task, fields, mode) },
            saveError = if (taskSaveError) stringResource(R.string.error_generic) else null,
            saving = taskSaving,
            onStatus = { model.move(task, it) },
            subtaskActions = { subtaskActionsLabels.actions(model, task.id, it.id) },
            onToggleSubtask = { id, done -> model.toggleSubtask(task.id, id, done) },
            onToggleItem = model::toggleItem,
            onAddAssignee = { model.addAssignee(task, it) },
            onRemoveAssignee = { model.removeAssignee(task, it) },
            onSetTaskType = { model.setTaskType(task, it) },
            onAddLabel = { model.addTaskLabel(task, it) },
            onRemoveLabel = { model.removeTaskLabel(task, it) },
            onCreateLabel = { model.createTaskLabel(task, it) },
            onAddComment = { body, finished -> model.addComment(task.id, body, finished) },
            onUndoActivity = { model.undoActivity(it) },
            formatActivityTime = { value -> runCatching { activityTime.format(Instant.parse(value)) }.getOrNull() },
            calendarOrigin = { CalendarOriginBadge() },
            aiTaskContent = {
                TaskAiActions(model, task) { value ->
                    runCatching { activityTime.format(Instant.parse(value)) }.getOrNull()
                }
            },
            onDelete = { model.deleteTask(task) },
            onTakeOver = { model.takeOver(task, it) },
            onClose = model::closeTask,
            shares = openShares,
            createdShareUrl = createdShareUrl,
            onCreateShare = { permission, requireName, password, expiresAt, maxViews ->
                model.createTaskShare(task, permission, requireName, password, expiresAt, maxViews)
            },
            onRevokeShare = model::revokeTaskShare,
            onCopyToClipboard = model::copyToClipboard,
            attachments = openAttachments,
            attachmentError = attachmentError,
            onPickAttachment = { picker.launch("*/*") },
            onDownloadAttachment = { attachment ->
                model.downloadAttachment(attachment.id) { bytes ->
                    openAttachment(attachment, bytes)
                }
            },
            onDeleteAttachment = { attachment ->
                model.deleteTaskAttachment(task, attachment.id)
            },
        )
    }
}

@Composable
private fun CalendarHost(
    model: AppViewModel,
    onSettings: () -> Unit,
    onBoard: () -> Unit,
    onDashboard: () -> Unit,
    onSearch: () -> Unit = {},
    onPomodoro: (() -> Unit)? = null,
) {
    val scopes by model.scopes.collectAsStateWithLifecycle()
    val scopeIds by model.activeScopes.collectAsStateWithLifecycle()
    val pending by model.pending.collectAsStateWithLifecycle()
    val tasks by model.tasks.collectAsStateWithLifecycle()
    val calendar by model.calendar.collectAsStateWithLifecycle()
    val timezone by model.profileTimezone.collectAsStateWithLifecycle()
    val zone = remember(timezone) {
        runCatching { java.time.ZoneId.of(timezone) }.getOrElse { java.time.ZoneId.systemDefault() }
    }
    val today = java.time.LocalDate.now(zone)
    var selectedDay by androidx.compose.runtime.saveable.rememberSaveable { mutableStateOf<String?>(null) }
    val selected = selectedDay?.let(java.time.LocalDate::parse) ?: today
    var mode by androidx.compose.runtime.saveable.rememberSaveable { mutableStateOf(CalendarMode.MONTH) }
    val appLocale = androidx.compose.ui.platform.LocalConfiguration.current.locales[0]
        ?.language ?: "ca"
    val weekStartChoice by model.preferenceWeekStart.collectAsStateWithLifecycle(initialValue = "auto")
    val weekStart = Dates.resolveWeekStart(weekStartChoice, appLocale)
    val first = selected.withDayOfMonth(1)
    val firstWeekDay = selected.minusDays(Dates.weekIndex(selected, weekStart).toLong())
    val request = AppViewModel.CalendarRequest(
        from = first.minusDays(7).toString(),
        to = first.plusMonths(1).plusDays(7).toString(),
        day = selected.toString(),
        scopeIds = scopeIds.sorted(),
        timezone = timezone,
    )
    LaunchedEffect(request) { model.loadCalendar(request) }
    val response = calendar.takeIf { it.request == request }

    val labels = CalendarLabels(
        // Els noms surten del CLDR i no del catàleg: `java.time` i `Intl` porten la
        // mateixa base, o sigui que les dues apps diuen el mateix sense escriure-ho dues
        // vegades. Abans eren dues claus amb els dotze mesos separats per comes.
        weekdays = Dates.weekdayNames(appLocale, weekStart),
        months = (1..12).map { Dates.monthName(appLocale, it) },
        emptyDay = stringResource(R.string.calendar_empty_day),
        emptyWeek = stringResource(R.string.calendar_empty_week),
    )

    val palette = Femho.colors
    val colors = scopes.associate { it.id to palette.scopeColor(it.color) }
    val fallback = palette.inkFaint
    val scopedTasks = if (scopeIds.isEmpty()) tasks else tasks.filter { it.scopeId in scopeIds }
    val agenda = buildList {
        response?.events.orEmpty().forEach { occurrence ->
            val date = CalendarDate.event(occurrence.startsAt, occurrence.allDay, zone) ?: return@forEach
            add(date.day to AgendaEntry(occurrence.summary, colors[occurrence.scopeId] ?: fallback, date.timeLabel))
        }
        scopedTasks.forEach { task ->
            if (task.status == TaskStatus.DONE) return@forEach
            val due = task.dueDate?.let { runCatching { java.time.LocalDate.parse(it) }.getOrNull() }
                ?: return@forEach
            if (due < first.minusDays(7) || due > first.plusMonths(1).plusDays(7)) return@forEach
            add(due to AgendaEntry(task.title, colors[task.scopeId] ?: fallback, task.dueTime?.take(5)) { model.open(task) })
        }
    }.groupBy({ it.first }, { it.second }).mapValues { (_, entries) -> entries.sortedBy { it.time.orEmpty() } }
    val inboxTasks = scopedTasks.filter { it.status == TaskStatus.INBOX && it.dueDate?.let { date -> date <= request.day } != false }
        .sortedWith(compareBy({ it.dueDate == null }, { it.dueDate != request.day }, { it.position }))
    fun shift(direction: Long) {
        selectedDay = when (mode) {
            CalendarMode.MONTH -> selected.plusMonths(direction)
            CalendarMode.WEEK -> selected.plusWeeks(direction)
            CalendarMode.DAY -> selected.plusDays(direction)
        }.toString()
    }

    Column(Modifier.fillMaxSize()) {
        TopBar(
            scopes = scopes,
            active = scopeIds.toSet(),
            pending = pending,
            view = Screen.CALENDAR,
            onPomodoro = onPomodoro,
            onToggle = model::toggleScope,
            onSettings = onSettings,
            onDashboard = onDashboard,
            onView = {
                when (it) {
                    Screen.BOARD -> onBoard()
                    Screen.SEARCH -> onSearch()
                    else -> Unit
                }
            },
        )

        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            listOf(
                CalendarMode.MONTH to stringResource(R.string.calendar_month),
                CalendarMode.WEEK to stringResource(R.string.calendar_week),
                CalendarMode.DAY to stringResource(R.string.calendar_day),
            ).forEach { (target, label) ->
                Text(
                    text = label,
                    color = if (mode == target) Femho.colors.ink else Femho.colors.inkFaint,
                    fontSize = FemhoText.body,
                    fontWeight = if (mode == target) FontWeight.Bold else FontWeight.Medium,
                    modifier = Modifier
                        .testTag("calendar-mode-${target.name.lowercase()}")
                        .androidClickable { mode = target }
                        .heightIn(min = FemhoSize.touch)
                        .padding(horizontal = 8.dp, vertical = 12.dp),
                )
            }
        }

        Row(
            Modifier.fillMaxWidth().padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            val previous = stringResource(R.string.calendar_previous)
            val next = stringResource(R.string.calendar_next)
            androidx.compose.material3.TextButton(onClick = { shift(-1) }, modifier = Modifier.testTag("calendar-previous")) {
                Text("‹", modifier = Modifier.semantics { contentDescription = previous })
            }
            androidx.compose.material3.TextButton(onClick = { selectedDay = today.toString() }, modifier = Modifier.testTag("calendar-today")) {
                Text(stringResource(R.string.dashboard_today))
            }
            androidx.compose.material3.TextButton(onClick = { shift(1) }, modifier = Modifier.testTag("calendar-next")) {
                Text("›", modifier = Modifier.semantics { contentDescription = next })
            }
        }

        Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
            if (response?.failed == true) {
                Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(stringResource(R.string.calendar_loaderror), modifier = Modifier.weight(1f), color = Femho.colors.ink)
                    androidx.compose.material3.TextButton(onClick = { model.loadCalendar(request) }) { Text(stringResource(R.string.nav_retry)) }
                }
            }
            if (response == null || response.loading) {
                Text(stringResource(R.string.state_loading), Modifier.padding(horizontal = 12.dp), color = Femho.colors.inkSoft)
            }
            if (mode == CalendarMode.MONTH) {
                MonthView(
                    year = selected.year,
                    month = selected.monthValue,
                    selected = selected,
                    today = today,
                    dots = agenda.mapValues { (_, entries) -> entries.map { it.color }.distinct().take(3) },
                    labels = labels,
                    weekStart = weekStart,
                    onSelect = { selectedDay = it.toString() },
                )
            }
            val dateLabel = java.time.format.DateTimeFormatter.ofLocalizedDate(java.time.format.FormatStyle.MEDIUM)
                .withLocale(java.util.Locale.forLanguageTag(appLocale))
            val showEmpty = response?.let { !it.loading && !it.failed } == true
            if (mode == CalendarMode.WEEK) {
                Text(
                    "${firstWeekDay.format(dateLabel)} – ${firstWeekDay.plusDays(6).format(dateLabel)}",
                    Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                    color = Femho.colors.ink,
                    fontWeight = FontWeight.Bold,
                )
                WeekList(
                    days = (0L..6L).map { offset ->
                        val day = firstWeekDay.plusDays(offset)
                        day to agenda[day].orEmpty()
                    },
                    labels = labels,
                    onSelect = { selectedDay = it.toString(); mode = CalendarMode.DAY },
                    modifier = Modifier.padding(horizontal = 12.dp),
                    weekStart = weekStart,
                    showEmpty = showEmpty,
                )
            } else {
                Text(selected.format(dateLabel), Modifier.padding(horizontal = 12.dp), color = Femho.colors.ink, fontWeight = FontWeight.Bold)
                DayList(agenda[selected].orEmpty(), labels, showEmpty = showEmpty)
            }
            InboxRail(
                tasks = inboxTasks,
                events = response?.inbox?.events.orEmpty(),
                colorOf = { colors[it] ?: fallback },
                labels = InboxLabels(
                    title = stringResource(R.string.board_column_inbox),
                    empty = stringResource(R.string.board_empty_inbox),
                    fromCalendar = stringResource(R.string.inbox_section_events),
                    allDay = stringResource(R.string.inbox_event_allday),
                    toTask = stringResource(R.string.inbox_event_totask),
                    hide = stringResource(R.string.inbox_eye_hide),
                    show = stringResource(R.string.inbox_eye_show),
                ),
                onOpenTask = model::open,
                onEventToTask = { model.eventToTask(it, request) },
                onEventToggle = { model.setEventInInbox(it, visible = !it.inInbox, request = request) },
                eventTime = { CalendarDate.event(it.startsAt, it.allDay, zone)?.timeLabel.orEmpty() },
                taskMetadata = { taskOriginMetadata(it)?.invoke() },
            )
        }
    }
}

private enum class CalendarMode { MONTH, WEEK, DAY }

@Composable
private fun TopBar(
    scopes: List<Scope>,
    active: Set<String>,
    pending: Int,
    view: Screen,
    onToggle: (String) -> Unit,
    onSettings: () -> Unit,
    /** El wordmark obre el dashboard global (docs/03 §3:50). */
    onDashboard: () -> Unit,
    onView: (Screen) -> Unit,
    onPomodoro: (() -> Unit)? = null,
    /** El commutador del tauler de la IA. Només surt si hi ha algun agent actiu. */
    aiEnabled: Boolean = false,
    aiBoardActive: Boolean = false,
    onToggleAiBoard: () -> Unit = {},
    aiBoardLabel: String = "",
    /** Tasques que esperen resposta teva: punt amb recompte sobre el commutador. */
    attentionCount: Int = 0,
    /**
     * Les llistes pinejades i com s'obren.
     *
     * `docs/03` §3 les demana a la capçalera —"el de llistes pinejades quan n'hi ha"— i
     * aquí no hi eren: a la web sí, i les dues superfícies s'han de sentir la mateixa
     * cosa. Si la llista és buida, el botó no surt (`docs/02` §3).
     */
    pinned: List<Checklist> = emptyList(),
    onOpenList: (String) -> Unit = {},
    projects: List<Project> = emptyList(),
    activeProjects: List<String> = emptyList(),
    onToggleProject: (String) -> Unit = {},
    onAllProjects: (String) -> Unit = {},
) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 2.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth().heightIn(min = 44.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            val dashboardLabel = stringResource(R.string.nav_opendashboard)
            Wordmark(
                modifier = Modifier.clickable(role = Role.Button, onClick = onDashboard)
                    .semantics { contentDescription = dashboardLabel }
                    .padding(horizontal = 4.dp, vertical = 4.dp),
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (onPomodoro != null) PomodoroToolbarAction(onPomodoro)
                val searchLabel = stringResource(R.string.nav_search)
                Box(
                    modifier = Modifier
                        .size(44.dp)
                        .testTag("open-search")
                        .clickable(role = Role.Button) { onView(Screen.SEARCH) }
                        .semantics { contentDescription = searchLabel },
                    contentAlignment = Alignment.Center,
                ) {
                    Text("⌕", color = Femho.colors.inkSoft, fontSize = 22.sp)
                }

                if (aiEnabled && view == Screen.BOARD) {
                    Box(
                        modifier = Modifier.size(44.dp)
                            .testTag("ai-board-toggle")
                            .clickable(role = Role.Button, onClick = onToggleAiBoard)
                            .semantics { contentDescription = aiBoardLabel },
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            // El robot del disseny validat, en text: Compose no porta el joc
                            // d'icones de Plou i un SVG a mà aquí seria un dibuix repetit.
                            text = "◍",
                            color = if (aiBoardActive) Femho.onBrand else Femho.colors.inkSoft,
                            fontSize = FemhoText.body,
                            fontWeight = FontWeight.Bold,
                            textAlign = TextAlign.Center,
                            modifier = Modifier
                                .size(30.dp)
                                .clip(CircleShape)
                                // Un `if` amb una banda `Brush` i l'altra `Color` no resol cap
                                // sobrecàrrega de `background`: es tria el modificador sencer.
                                .then(
                                    if (aiBoardActive) {
                                        Modifier.background(Femho.brandGradient2)
                                    } else {
                                        Modifier.background(Femho.colors.tagBg)
                                    },
                                )
                                .padding(top = 5.dp),
                        )
                        if (attentionCount > 0) {
                            Text(
                                // La marca d'atenció del disseny: un punt amb el recompte de
                                // tasques que esperen resposta, sobre el commutador.
                                text = attentionCount.toString(),
                                color = Femho.onBrand,
                                fontSize = FemhoText.meta,
                                fontWeight = FontWeight.Bold,
                                textAlign = TextAlign.Center,
                                modifier = Modifier
                                    .align(Alignment.TopEnd)
                                    .size(16.dp)
                                    .clip(CircleShape)
                                    .background(Femho.brandGradient2)
                                    .testTag("ai-attention-count"),
                            )
                        }
                    }
                }

                if (pending > 0) {
                    // La pastilla de canvis pendents: el que importa no és la xarxa
                    // sinó si el que has fet ja és a l'altre costat (docs/02 §12).
                    Text(
                        text = "$pending",
                        color = Femho.colors.inkSoft,
                        fontSize = FemhoText.meta,
                        modifier = Modifier.padding(horizontal = 4.dp).testTag("pending-count"),
                    )
                }
                Box(
                    modifier = Modifier
                        .heightIn(min = 44.dp)
                        .testTag("open-settings")
                        .clickable(role = Role.Button, onClick = onSettings)
                        .padding(horizontal = 8.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        text = stringResource(R.string.nav_settings),
                        color = Femho.colors.inkSoft,
                        fontSize = FemhoText.body,
                        maxLines = 1,
                    )
                }
            }
        }

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 2.dp)
                .clip(RoundedCornerShape(FemhoShape.pill))
                .background(Femho.colors.switcherBg)
                .border(1.dp, Femho.colors.switcherBorder, RoundedCornerShape(FemhoShape.pill))
                .selectableGroup()
                .testTag("primary-view-tabs"),
        ) {
            listOf(Screen.CALENDAR to R.string.nav_calendar, Screen.BOARD to R.string.nav_tasks).forEach { (target, label) ->
                val isActive = view == target
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .heightIn(min = 44.dp)
                        .clip(RoundedCornerShape(FemhoShape.pill))
                        .background(if (isActive) Femho.colors.tagBg else androidx.compose.ui.graphics.Color.Transparent)
                        .selectable(selected = isActive, role = Role.Tab) { onView(target) }
                        .testTag("view-${target.name.lowercase()}")
                        .padding(horizontal = 6.dp, vertical = 4.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        text = stringResource(label),
                        color = if (isActive) Femho.colors.ink else Femho.colors.inkSoft,
                        fontSize = FemhoText.body,
                        fontWeight = if (isActive) FontWeight.Bold else FontWeight.Medium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }

        if (scopes.isNotEmpty()) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(
                    modifier = Modifier.weight(1f).horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    scopes.forEach { scope ->
                        ScopeChip(
                            label = scope.name,
                            color = Femho.colors.scopeColor(scope.color),
                            active = active.isEmpty() || scope.id in active,
                            onClick = { onToggle(scope.id) },
                            modifier = Modifier.testTag("scope-chip-${scope.id}"),
                        )
                    }
                }
                ProjectFilter(scopes, active, projects, activeProjects, onToggleProject, onAllProjects)
            }
        }

        if (pinned.isNotEmpty()) PinnedRow(pinned = pinned, onOpenList = onOpenList)
    }
}

/**
 * El contingut d'un desplegable és text que ha de ser llegible com a panell;
 * sobre el fons de la pàgina (transparent) el text competeix amb el que hi ha al darrere —
 * i lletres sobre fons 100% transparent no es llegeixen.
 */
@Composable
private fun MenuPanel(content: @Composable () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(FemhoShape.card))
            .background(Femho.colors.cardBg)
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        content()
    }
}

/**
 * Les llistes pinejades, desplegables des de la capçalera.
 *
 * **Cada llista diu com va**, no només com es diu: amb quatre pinejades, els noms sols
 * obliguen a entrar a cadascuna per saber quina té feina pendent. És el mateix que fa la
 * web i el que ensenya el prototip.
 */
@Composable
private fun PinnedRow(pinned: List<Checklist>, onOpenList: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }

    Column(Modifier.fillMaxWidth().padding(top = 8.dp)) {
        Text(
            text = stringResource(R.string.nav_pinned) + "  (${pinned.size})",
            color = Femho.colors.inkSoft,
            fontSize = FemhoText.meta,
            fontWeight = FontWeight.Bold,
            modifier = Modifier
                .testTag("pinned-toggle")
                .then(Modifier.androidClickable { open = !open })
                .padding(vertical = 6.dp),
        )

        if (open) {
            MenuPanel {
                if (pinned.isEmpty()) {
                    /**
                     * **El buit diu on es pinegen** (`docs/14` P8).
                     *
                     * Sense això, pinejar una llista no es descobreix enlloc: el control que ho
                     * ensenyaria només apareixia quan ja sabies que existia.
                     */
                    Text(
                        text = stringResource(R.string.nav_nopinned),
                        color = Femho.colors.inkFaint,
                        fontSize = FemhoText.meta,
                        modifier = Modifier.testTag("pinned-empty").padding(vertical = 6.dp),
                    )
                } else {
                    pinned.forEach { checklist ->
                        val done = checklist.items.count { it.done }
                        Column(
                            Modifier
                                .fillMaxWidth()
                                .testTag("pinned-${checklist.id}")
                                .then(Modifier.androidClickable { onOpenList(checklist.id) })
                                .padding(vertical = 6.dp),
                        ) {
                            Text(
                                // "Tasca · Llista", com als prototips: el nom sol no distingeix
                                // dues llistes que es diguin igual en tasques diferents.
                                text = checklist.taskTitle
                                    ?.takeIf { it.isNotEmpty() }
                                    ?.let { "${'$'}it · ${'$'}{checklist.name}" }
                                    ?: checklist.name,
                                color = Femho.colors.ink,
                                fontSize = FemhoText.body,
                                fontWeight = FontWeight.SemiBold,
                            )
                            Text(
                                // Els marcadors del catàleg són `{done}` i `{total}`: es
                                // substitueixen a mà, com la resta de plantilles d'aquesta app.
                                text = stringResource(R.string.nav_pinnedprogress)
                                    .replace("{done}", done.toString())
                                    .replace("{total}", checklist.items.size.toString()),
                                color = Femho.colors.inkFaint,
                                fontSize = FemhoText.meta,
                            )
                    }
                }
            }
        }
    }
}
}

// `scopeColor` viu ara a `:core-designsystem` (`Palette.kt`), com a funció pura: els
// widgets de la pantalla d'inici la necessiten i allà no hi ha composició.

private fun Modifier.androidClickable(onClick: () -> Unit): Modifier = this.clickable(onClick = onClick)

@Composable
private fun SettingsHost(model: AppViewModel, serverUrl: String, onBack: () -> Unit) {
    val locale by model.preferenceLocale.collectAsStateWithLifecycle(initialValue = "ca")
    val pomodoro by model.pomodoro.collectAsStateWithLifecycle()
    val calendarSuggestions by model.calendarSuggestions.collectAsStateWithLifecycle()
    CalendarSuggestionsSyncEffect(model)
    val appLocale = androidx.compose.ui.platform.LocalConfiguration.current.locales[0]?.language ?: "ca"
    val firstDayLabel = stringResource(
        if (Dates.weekStart(appLocale) == Dates.SUNDAY) R.string.settings_day_sun else R.string.settings_day_mon,
    )
    val scopeMode by model.preferenceScopeMode.collectAsStateWithLifecycle(initialValue = "multi")
    val weekStart by model.preferenceWeekStart.collectAsStateWithLifecycle(initialValue = "auto")
    val eventTaskDeleted by model.preferenceEventTaskDeleted.collectAsStateWithLifecycle(initialValue = "return_to_inbox")
    val showCalendarWidget by model.preferenceShowCalendarWidget.collectAsStateWithLifecycle(initialValue = true)
    val showOverdueSection by model.preferenceShowOverdueSection.collectAsStateWithLifecycle(initialValue = true)
    val inboxPosition by model.preferenceInboxPosition.collectAsStateWithLifecycle(initialValue = "right")
    val inboxShowOverdue by model.preferenceInboxShowOverdue.collectAsStateWithLifecycle(initialValue = true)

    val theme by model.theme.collectAsStateWithLifecycle()
    val accent by model.accent.collectAsStateWithLifecycle()
    val profile by model.profile.collectAsStateWithLifecycle()
    val gravatarEnabled by model.gravatarEnabled.collectAsStateWithLifecycle()
    val scopes by model.scopes.collectAsStateWithLifecycle()
    val projects by model.projects.collectAsStateWithLifecycle()
    val labels by model.labels.collectAsStateWithLifecycle()
    val taskTypes by model.taskTypes.collectAsStateWithLifecycle()
    val scopeSettings by model.scopeSettings.collectAsStateWithLifecycle()
    val calendars by model.calendars.collectAsStateWithLifecycle()
    val mailAccounts by model.mailAccounts.collectAsStateWithLifecycle()
    val mailRules by model.mailRules.collectAsStateWithLifecycle()
    val agentsDetail by model.agentsDetail.collectAsStateWithLifecycle()
    val agentScopeAvailability by model.agentScopeAvailability.collectAsStateWithLifecycle()
    val agentCredentials by model.agentCredentials.collectAsStateWithLifecycle()
    val createdAgentToken by model.createdAgentToken.collectAsStateWithLifecycle()
    val agentSkill by model.agentSkill.collectAsStateWithLifecycle()
    val allShares by model.allShares.collectAsStateWithLifecycle()
    val allShareAccesses by model.shareAccesses.collectAsStateWithLifecycle()
    val adminUsers by model.adminUsers.collectAsStateWithLifecycle()
    val adminInviteUrl by model.adminInviteUrl.collectAsStateWithLifecycle()
    val adminError by model.adminError.collectAsStateWithLifecycle()
    val instanceName by model.instanceName.collectAsStateWithLifecycle()
    val instanceVersion by model.instanceVersion.collectAsStateWithLifecycle()

    LaunchedEffect(Unit) {
        model.loadEntityData()
        model.loadCalendars()
        model.loadMailData()
        model.loadAgentManagement()
        model.loadAllShares()
    }

    SettingsScreen(
        locale = locale,
        scopeMode = scopeMode,
        weekStart = weekStart,
        eventTaskDeleted = eventTaskDeleted,
        showCalendarWidget = showCalendarWidget,
        showOverdueSection = showOverdueSection,
        inboxPosition = inboxPosition,
        inboxShowOverdue = inboxShowOverdue,
        pomodoroEnabled = pomodoro.snapshot.settings.enabled,
        onPomodoroEnabled = model::setPomodoroEnabled,
        calendarSuggestionsEnabled = calendarSuggestions.snapshot.enabled,
        onCalendarSuggestionsEnabled = model::setCalendarSuggestionsEnabled,
        labels = SettingsLabels(
            title = stringResource(R.string.settings_title),
            back = stringResource(R.string.nav_backtoboard),
            theme = stringResource(R.string.settings_theme),
            themeOptions = listOf(
                "system" to stringResource(R.string.settings_theme_system),
                "light" to stringResource(R.string.settings_theme_light),
                "dark" to stringResource(R.string.settings_theme_dark),
            ),
            accent = stringResource(R.string.settings_accent),
            accentOptions = listOf(
                "default" to stringResource(R.string.settings_accent_default),
                "soft" to stringResource(R.string.settings_accent_soft),
                "mono-warm" to stringResource(R.string.settings_accent_mono_warm),
                "mono-cool" to stringResource(R.string.settings_accent_mono_cool),
            ),
            server = stringResource(R.string.login_server),
            logout = stringResource(R.string.nav_logout),
            tabs = SettingsTabs(
                general = stringResource(R.string.settings_tab_general),
                scopes = stringResource(R.string.settings_tab_scopes),
                calendars = stringResource(R.string.settings_tab_calendars),
                mail = stringResource(R.string.settings_tab_mail),
                mcp = stringResource(R.string.settings_tab_mcp),
                ai = stringResource(R.string.settings_tab_ai),
                aiTasks = stringResource(R.string.settings_tab_aitasks),
                notifications = stringResource(R.string.notify_activity_heading),
                shares = stringResource(R.string.settings_tab_shares),
                profile = stringResource(R.string.settings_tab_profile),
                admin = stringResource(R.string.settings_tab_admin),
            ),
            emptyStates = SettingsEmptyStates(
                scopes = stringResource(R.string.settings_empty_scopes),
                calendars = stringResource(R.string.settings_empty_calendars),
                mail = stringResource(R.string.settings_empty_mail),
                mcp = stringResource(R.string.settings_empty_mcp),
                ai = stringResource(R.string.settings_empty_ai),
                shares = stringResource(R.string.settings_empty_shares),
                profile = stringResource(R.string.settings_empty_profile),
                admin = stringResource(R.string.settings_empty_admin),
            ),
            // General tab
            pomodoro = stringResource(R.string.pomodoro_enabled),
            calendarSuggestions = stringResource(R.string.calendarsuggestions_setting),
            calendarSuggestionsHint = stringResource(R.string.calendarsuggestions_settinghint),
            language = stringResource(R.string.settings_language),
            languageOptions = listOf(
                "ca" to "Català",
                "en" to "English",
                "es" to "Español",
            ),
            scopeMode = stringResource(R.string.settings_scopemode),
            scopeModeMulti = stringResource(R.string.settings_scopemode_multi),
            scopeModeMultiHint = stringResource(R.string.settings_scopemode_multi_hint),
            scopeModeSingle = stringResource(R.string.settings_scopemode_single),
            scopeModeSingleHint = stringResource(R.string.settings_scopemode_single_hint),
            scopeModeHelp = stringResource(R.string.settings_scopemode_help),
            weekStart = stringResource(R.string.settings_weekstart),
            weekStartAuto = stringResource(R.string.settings_weekstart_auto).replace("{day}", firstDayLabel),
            weekStartMonday = stringResource(R.string.settings_day_mon),
            weekStartSunday = stringResource(R.string.settings_day_sun),
            eventTaskDeleted = stringResource(R.string.settings_events_ondelete),
            eventTaskDeletedReturn = stringResource(R.string.settings_events_ondelete_return),
            eventTaskDeletedReturnHint = stringResource(R.string.settings_events_ondelete_returnhint),
            eventTaskDeletedHide = stringResource(R.string.settings_events_ondelete_hide),
            eventTaskDeletedHideHint = stringResource(R.string.settings_events_ondelete_hidehint),
            dashboardItems = stringResource(R.string.settings_dashboarditems),
            showCalendarWidget = stringResource(R.string.settings_showcalendarwidget),
            showOverdueSection = stringResource(R.string.settings_showoverduesection),
            inboxPosition = stringResource(R.string.settings_inboxposition),
            inboxLeft = stringResource(R.string.settings_inbox_left),
            inboxRight = stringResource(R.string.settings_inbox_right),
            inboxBelow = stringResource(R.string.settings_inbox_below),
            inboxShowOverdue = stringResource(R.string.settings_inboxshowoverdue),
            about = stringResource(R.string.settings_about),
            aboutSource = stringResource(R.string.settings_source)
                .replace("{version}", instanceVersion.ifEmpty { "—" })
                .replace("{license}", "AGPL-3.0-or-later"),
            aboutCredits = stringResource(R.string.settings_credits),
            // Perfil
            profileName = stringResource(R.string.settings_profilename),
            profileEmail = stringResource(R.string.settings_profileemail),
            timezone = stringResource(R.string.settings_timezone),
            gravatar = stringResource(R.string.settings_gravatar),
            gravatarHelp = stringResource(R.string.settings_gravatarhelp),
            changePassword = stringResource(R.string.settings_changepassword),
            currentPassword = stringResource(R.string.settings_currentpassword),
            newPassword = stringResource(R.string.settings_newpassword),
            passwordChanged = stringResource(R.string.settings_passwordchanged),
            navSave = stringResource(R.string.nav_save),
            // MCP i API
            tokensOnceWarning = stringResource(R.string.tokens_oncewarning),
            tokensRevoke = stringResource(R.string.tokens_revoke),
            tokensCopy = stringResource(R.string.tokens_copy),
            // Agents (Usuari IA)
            agents = stringResource(R.string.settings_agents),
            newAgent = stringResource(R.string.settings_newagent),
            emptyAgents = stringResource(R.string.settings_empty_agents),
            agentEnabled = stringResource(R.string.settings_agentenabled),
            agentCanCreate = stringResource(R.string.settings_agentcancreate),
            agentScopes = stringResource(R.string.settings_agentscopes),
            agentAllScopes = stringResource(R.string.settings_agentallscopes),
            agentScopeTaken = stringResource(R.string.settings_agentscopetaken),
            agentCredentials = stringResource(R.string.settings_agentcredentials),
            agentNewCredential = stringResource(R.string.settings_agentnewcredential),
            agentConnect = stringResource(R.string.settings_agentconnect),
            agentDownloadMcp = stringResource(R.string.settings_agentdownloadmcp),
            agentDownloadSkill = stringResource(R.string.settings_agentdownloadskill),
            agentMcpNoToken = stringResource(R.string.settings_agentmcpnotoken),
            agentMcpHasToken = stringResource(R.string.settings_agentmcphastoken),
            agentSkillNoToken = stringResource(R.string.settings_agentskillnotoken),
            create = stringResource(R.string.nav_create),
            shareAccesses = stringResource(R.string.share_accesses),
            shareLastAccess = stringResource(R.string.share_lastaccess),
            shareRevoke = stringResource(R.string.share_revoke),
            shareRevoked = stringResource(R.string.share_revoked),
            scopeSection = stringResource(R.string.settings_scopesection),
            entityProjects = stringResource(R.string.settings_entityprojects),
            entityLabels = stringResource(R.string.settings_entitylabels),
            entityTypes = stringResource(R.string.settings_entitytypes),
            entityDedication = stringResource(R.string.settings_entitydedication),
            projectName = stringResource(R.string.settings_projectname),
            projectDelete = stringResource(R.string.settings_projectdelete),
            labelNew = stringResource(R.string.settings_labelnew),
            labelDelete = stringResource(R.string.settings_labeldelete),
            typeNew = stringResource(R.string.settings_typenew),
            typeDelete = stringResource(R.string.settings_typedelete),
            typesOn = stringResource(R.string.settings_typeson),
            typesRequired = stringResource(R.string.settings_typesrequired),
            tracking = stringResource(R.string.settings_tracking),
            trackingOn = stringResource(R.string.settings_trackingon),
            trackingHelp = stringResource(R.string.settings_trackinghelp),
            overtimeVisible = stringResource(R.string.settings_overtimevisible),
            workStart = stringResource(R.string.settings_workstart),
            workEnd = stringResource(R.string.settings_workend),
            workDays = stringResource(R.string.settings_workdays),
            longSessionHours = stringResource(R.string.settings_longsessionhours),
            nounProject = stringResource(R.string.settings_noun_project),
            nounClient = stringResource(R.string.settings_noun_client),
            caldavUrls = stringResource(R.string.settings_caldavurls),
            caldavEvents = stringResource(R.string.settings_caldavevents),
            caldavTodos = stringResource(R.string.settings_caldavtodos),
            sourcesTitle = stringResource(R.string.settings_sources),
            sourcesAdd = stringResource(R.string.settings_sources_add),
            sourcesEmpty = stringResource(R.string.settings_sources_empty),
            sourcesFailed = stringResource(R.string.settings_sources_failed),
            sourcesInbox = stringResource(R.string.settings_sources_inbox),
            sourcesKindCaldav = stringResource(R.string.settings_sources_kind_caldav),
            sourcesKindIcal = stringResource(R.string.settings_sources_kind_ical),
            sourcesKindRss = stringResource(R.string.settings_sources_kind_rss),
            sourcesName = stringResource(R.string.settings_sources_name),
            sourcesNever = stringResource(R.string.settings_sources_never),
            sourcesPassword = stringResource(R.string.settings_sources_password),
            sourcesReadOnly = stringResource(R.string.settings_sources_readonly),
            sourcesRefreshed = stringResource(R.string.settings_sources_refreshed),
            sourcesRemove = stringResource(R.string.settings_sources_remove),
            sourcesUrl = stringResource(R.string.settings_sources_url),
            sourcesUrlRequired = stringResource(R.string.settings_sources_urlrequired),
            sourcesUsername = stringResource(R.string.settings_sources_username),
            calendarShared = stringResource(R.string.settings_calendarshared),
            sharedCalendars = stringResource(R.string.settings_sharedcalendars),
            calendarPrivate = stringResource(R.string.settings_calendarprivate),
            calendarCredWarning = stringResource(R.string.settings_calendarcredwarning),
            mailIntro = stringResource(R.string.settings_mail_intro),
            mailAccounts = stringResource(R.string.settings_mail_accounts),
            mailAdd = stringResource(R.string.settings_mail_add),
            mailName = stringResource(R.string.settings_mail_name),
            mailHost = stringResource(R.string.settings_mail_host),
            mailUsername = stringResource(R.string.settings_mail_username),
            mailPassword = stringResource(R.string.settings_mail_password),
            mailPasswordKept = stringResource(R.string.settings_mail_passwordkept),
            mailSecurity = stringResource(R.string.settings_mail_security),
            mailSecurityTls = stringResource(R.string.settings_mail_security_tls),
            mailSecurityStarttls = stringResource(R.string.settings_mail_security_starttls),
            mailTest = stringResource(R.string.settings_mail_test),
            mailTestOk = stringResource(R.string.settings_mail_testok),
            mailTestFail = stringResource(R.string.settings_mail_testfail),
            mailAppPassword = stringResource(R.string.settings_mail_apppassword),
            mailEmpty = stringResource(R.string.settings_mail_empty),
            mailRules = stringResource(R.string.settings_mail_rules),
            mailRulesEmpty = stringResource(R.string.settings_mail_rules_empty),
            mailAddRule = stringResource(R.string.settings_mail_addrule),
            mailFolder = stringResource(R.string.settings_mail_folder),
            mailFolderPlaceholder = stringResource(R.string.settings_mail_folderplaceholder),
            mailPickFolder = stringResource(R.string.settings_mail_pickfolder),
            mailLoadingFolders = stringResource(R.string.settings_mail_loadingfolders),
            mailFoldersFailed = stringResource(R.string.settings_mail_foldersfailed),
            mailScope = stringResource(R.string.settings_mail_scope),
            mailProject = stringResource(R.string.settings_mail_project),
            mailProjectNone = stringResource(R.string.settings_mail_projectnone),
            mailTemplate = stringResource(R.string.settings_mail_template),
            mailTemplatePreset = stringResource(R.string.settings_mail_templatepreset),
            mailTemplatePreview = stringResource(R.string.settings_mail_templatepreview),
            mailTemplateUnknown = stringResource(R.string.settings_mail_templateunknown),
            mailFirstRun = stringResource(R.string.settings_mail_firstrun),
            mailNotTouched = stringResource(R.string.settings_mail_nottouched),
            mailRemove = stringResource(R.string.settings_mail_remove),
            mailSave = stringResource(R.string.settings_mail_save),
            scopeType = stringResource(R.string.settings_scopetype),
            scopeTypeIndividual = stringResource(R.string.settings_scopetype_individual),
            scopeTypeCollective = stringResource(R.string.settings_scopetype_collective),
            scopeColor = stringResource(R.string.settings_scopecolor),
            members = stringResource(R.string.settings_members),
            memberRemove = stringResource(R.string.settings_memberremove),
            roleAdmin = stringResource(R.string.settings_role_admin),
            roleCollaborator = stringResource(R.string.settings_role_collaborator),
            roleViewer = stringResource(R.string.settings_role_viewer),
            roleOwner = stringResource(R.string.settings_role_owner),
            roleMember = stringResource(R.string.settings_role_member),
            inviteCreate = stringResource(R.string.settings_invitecreate),
            inviteRevoke = stringResource(R.string.settings_inviterevoke),
            inviteOnce = stringResource(R.string.settings_inviteonce),
            inviteUrl = stringResource(R.string.settings_inviteurl),
            invites = stringResource(R.string.settings_invites),
            noInvites = stringResource(R.string.settings_invitenone),
            noMembers = stringResource(R.string.settings_nomembers),
            users = stringResource(R.string.settings_users),
            inviteEmail = stringResource(R.string.settings_inviteemail),
            inviteName = stringResource(R.string.settings_invitename),
            invitePending = stringResource(R.string.settings_invitepending),
            wipe = stringResource(R.string.settings_wipe),
            wipeWarning = stringResource(R.string.settings_wipewarning),
            wipeConfirm = stringResource(R.string.settings_wipeconfirm),
            errorLastAdmin = stringResource(R.string.error_last_admin),
            delete = stringResource(R.string.nav_delete),
            scopeEdit = stringResource(R.string.settings_scopeedit),
            scopeSave = stringResource(R.string.settings_scopesave),
            scopeCancel = stringResource(R.string.settings_scopecancel),
            scopeDelete = stringResource(R.string.settings_scopedelete),
            scopeDeleteConfirm = stringResource(R.string.settings_scopedeleteconfirm),
            scopeName = stringResource(R.string.settings_scopename),
            navCreate = stringResource(R.string.nav_create),
            newScope = stringResource(R.string.settings_newscope),
        ),
        profileName = profile?.name.orEmpty(),
        profileEmail = profile?.email.orEmpty(),
        profileTimezone = profile?.timezone.orEmpty(),
        gravatarEnabled = gravatarEnabled,
        scopes = scopes,
        projects = projects,
        labelsList = labels,
        taskTypes = taskTypes,
        scopeSettings = scopeSettings,
        calendars = calendars,
        mailAccounts = mailAccounts,
        googleMailContent = { GoogleMailPanel(model, mailAccounts) },
        mailPollingContent = { MailPollingControl(model, it) },
        mailRules = mailRules,
        theme = theme,
        accent = accent,
        serverUrl = serverUrl,
        mcpContent = { McpSettingsHost(model, scopes, "$serverUrl/mcp") },
        aiTasksContent = { AiTaskSettingsHost(model, scopes) },
        notificationsContent = { NotificationSettingsHost(model) },
        agents = agentsDetail,
        agentScopeAvailability = agentScopeAvailability,
        agentCredentials = agentCredentials,
        createdAgentToken = createdAgentToken,
        agentSkill = agentSkill,
        onTheme = model::setTheme,
        onAccent = model::setAccent,
        onLocale = model::setLocale,
        onScopeMode = model::setScopeMode,
        onWeekStart = model::setWeekStart,
        onEventTaskDeleted = model::setEventTaskDeleted,
        onShowCalendarWidget = model::setShowCalendarWidget,
        onShowOverdueSection = model::setShowOverdueSection,
        onInboxPosition = model::setInboxPosition,
        onInboxShowOverdue = model::setInboxShowOverdue,
        onBack = onBack,
        onLogout = model::logout,
        onSetName = model::setName,
        onSetGravatar = model::setGravatar,
        onChangePassword = model::changePassword,
        onCopyToClipboard = model::copyToClipboard,
        onCreateAgent = model::createAgent,
        onAgentEnabled = model::setAgentEnabled,
        onAgentCanCreate = model::setAgentCanCreate,
        onAgentScopes = model::setAgentScopes,
        onAgentNewCredential = model::createAgentCredential,
        onRevokeAgentCredential = model::revokeAgentCredential,
        onAgentSkill = model::loadAgentSkill,
        shares = allShares,
        shareAccesses = allShareAccesses,
        onRevokeShare = model::revokeShare,
        onCreateScope = model::createScope,
        onUpdateScope = model::updateScope,
        onDeleteScope = model::deleteScope,
        onCreateProject = model::createProject,
        onDeleteProject = model::deleteProject,
        onCreateLabel = model::createLabel,
        onDeleteLabel = model::deleteLabel,
        onCreateTaskType = model::createTaskType,
        onUpdateTaskType = model::updateTaskType,
        onDeleteTaskType = model::deleteTaskType,
        onUpdateScopeSettings = model::updateScopeSettings,
        onCreateCalendar = model::createCalendar,
        onUpdateCalendar = model::updateCalendar,
        onDeleteCalendar = model::deleteCalendar,
        onCreateMailAccount = model::createMailAccount,
        onUpdateMailAccount = model::updateMailAccount,
        onDeleteMailAccount = model::deleteMailAccount,
        onTestMailAccount = model::testMailAccount,
         onCreateMailRule = model::createMailRule,
         onDeleteMailRule = model::deleteMailRule,
        isAdmin = profile?.role == "admin",
        adminUsers = adminUsers,
        adminInviteUrl = adminInviteUrl,
        adminError = adminError,
        instanceName = instanceName,
        onLoadAdminUsers = model::loadAdminUsers,
        onInviteAdminUser = model::inviteAdminUser,
        onConsumeAdminInviteUrl = model::consumeAdminInviteUrl,
        onSetAdminRole = model::setAdminRole,
        onDeleteAdminUser = model::deleteAdminUser,
        onWipeInstance = model::wipeInstance,
     )
 }

@Composable
private fun McpSettingsHost(model: AppViewModel, scopes: List<Scope>, fallbackMcpUrl: String) {
    val access by model.externalAccess.collectAsStateWithLifecycle()
    val tokens by model.tokens.collectAsStateWithLifecycle()
    val createdToken by model.createdToken.collectAsStateWithLifecycle()
    val busy by model.tokenBusy.collectAsStateWithLifecycle()
    val failed by model.tokenError.collectAsStateWithLifecycle()
    McpSettings(
        labels = McpSettingsLabels(
            title = stringResource(R.string.external_connect),
            instructions = stringResource(R.string.external_oauthpermissions),
            apiEnabled = stringResource(R.string.external_apienabled),
            mcpEnabled = stringResource(R.string.external_mcpenabled),
            url = stringResource(R.string.settings_mcpurl),
            copy = stringResource(R.string.tokens_copy),
            connections = stringResource(R.string.external_credentials),
            empty = stringResource(R.string.external_nocredentials),
            create = stringResource(R.string.tokens_create),
            edit = stringResource(R.string.external_edit),
            restrict = stringResource(R.string.external_restrict),
            restrictHelp = stringResource(R.string.external_restricthelp),
            revoke = stringResource(R.string.tokens_revoke),
            name = stringResource(R.string.tokens_name),
            warning = stringResource(R.string.tokens_oncewarning),
            hideSecret = stringResource(R.string.external_closesecret),
            scopes = stringResource(R.string.external_scopes),
            unavailableScope = stringResource(R.string.external_unavailablescope),
            permissions = stringResource(R.string.external_permission),
            channels = stringResource(R.string.external_channels),
            channelLabels = mapOf(
                "mcp" to stringResource(R.string.external_mcp),
                "api" to stringResource(R.string.external_api),
            ),
            operationLabels = mapOf(
                "tasks:read" to stringResource(R.string.external_operation_read),
                "tasks:create" to stringResource(R.string.external_operation_create),
                "tasks:move" to stringResource(R.string.external_operation_move),
                "tasks:update" to stringResource(R.string.external_operation_update),
                "tasks:attach" to stringResource(R.string.external_operation_attach),
                "tasks:write" to stringResource(R.string.external_capability_taskswrite),
                "events:read" to stringResource(R.string.external_capability_eventsread),
                "events:write" to stringResource(R.string.external_capability_eventswrite),
                "projects:read" to stringResource(R.string.external_capability_projectsread),
                "projects:write" to stringResource(R.string.external_capability_projectswrite),
                "scopes:read" to stringResource(R.string.external_capability_scopesread),
                "checklists:read" to stringResource(R.string.external_capability_checklistsread),
                "checklists:write" to stringResource(R.string.external_capability_checklistswrite),
                "comments:read" to stringResource(R.string.external_capability_commentsread),
                "comments:write" to stringResource(R.string.external_capability_commentswrite),
                "attachments:read" to stringResource(R.string.external_capability_attachmentsread),
                "attachments:write" to stringResource(R.string.external_capability_attachmentswrite),
            ),
            save = stringResource(R.string.nav_save),
            cancel = stringResource(R.string.nav_cancel),
            loading = stringResource(R.string.state_loading),
            error = stringResource(R.string.error_generic),
            retry = stringResource(R.string.nav_retry),
            oauth = stringResource(R.string.external_oauthcredential),
            manual = stringResource(R.string.external_manualcredential),
            agent = stringResource(R.string.external_agentcredential),
            lastUsed = stringResource(R.string.external_lastused),
            neverUsed = stringResource(R.string.tokens_never),
            expires = stringResource(R.string.external_expires),
            noExpiry = stringResource(R.string.external_never),
            statusLabels = mapOf(
                "active" to stringResource(R.string.external_active),
                "pending" to stringResource(R.string.external_pending),
                "paused" to stringResource(R.string.external_paused),
                "expired" to stringResource(R.string.external_expired),
                "revoked" to stringResource(R.string.external_revoked),
            ),
        ),
        access = access,
        fallbackMcpUrl = fallbackMcpUrl,
        scopeOptions = scopes,
        tokens = tokens,
        createdToken = createdToken,
        busy = busy,
        failed = failed,
        onLoad = model::loadTokens,
        onChannel = model::setExternalAccess,
        onCreate = model::createToken,
        onEdit = model::editToken,
        onRevoke = model::revokeToken,
        onHideSecret = model::hideCreatedToken,
        onCopy = model::copyToClipboard,
    )
}

@Composable
private fun DashboardHost(model: AppViewModel, onBoard: () -> Unit, onSettings: () -> Unit) {
    val dashboard by model.dashboard.collectAsStateWithLifecycle()
    val scopes by model.scopes.collectAsStateWithLifecycle()
    val showOverdueSection by model.showOverdueSection.collectAsStateWithLifecycle()
    val showCalendarWidget by model.showCalendarWidget.collectAsStateWithLifecycle()

    LaunchedEffect(Unit) { model.loadDashboard() }

    val appLocale = androidx.compose.ui.platform.LocalConfiguration.current.locales[0]
        ?.language ?: "ca"
    val weekStartChoice by model.preferenceWeekStart.collectAsStateWithLifecycle(initialValue = "auto")
    val weekStart = Dates.resolveWeekStart(weekStartChoice, appLocale)
    val calendarLabels = CalendarLabels(
        weekdays = Dates.weekdayNames(appLocale, weekStart),
        months = (1..12).map { Dates.monthName(appLocale, it) },
        emptyDay = stringResource(R.string.calendar_empty_day),
        emptyWeek = stringResource(R.string.calendar_empty_week),
    )

    // Els punts del calendari: fins a tres colors per dia, els dels àmbits de les
    // tasques que el tenen (docs/02 §5). El dashboard ignora la selecció d'àmbits.
    val palette = Femho.colors
    val colors = scopes.associate { it.id to palette.scopeColor(it.color) }
    val dots: Map<java.time.LocalDate, List<androidx.compose.ui.graphics.Color>> =
        remember(dashboard, colors) {
            val result = mutableMapOf<java.time.LocalDate, MutableList<androidx.compose.ui.graphics.Color>>()
            (dashboard.today + dashboard.overdue + dashboard.doing).forEach { task ->
                val day = task.dueDate ?: return@forEach
                val color = colors[task.scopeId] ?: palette.inkFaint
                val list = result.getOrPut(java.time.LocalDate.parse(day)) { mutableListOf() }
                if (list.size < 3 && color !in list) list.add(color)
            }
            result
        }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Femho.pageBackground)
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            text = stringResource(R.string.dashboard_title),
            color = Femho.colors.ink,
            fontSize = FemhoText.columnTitle,
            fontWeight = FontWeight.ExtraBold,
            modifier = Modifier.testTag("dashboard-screen"),
        )

        // Les targetes per àmbit: pendents i vençudes, amb la vora del color (la web).
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            dashboard.scopes.forEach { scope ->
                val pendingLabel = stringResource(R.string.dashboard_pending)
                    .replace("{count}", scope.pending.toString())
                val overdueLabel = stringResource(R.string.dashboard_overduecount)
                    .replace("{count}", scope.overdue.toString())
                Text(
                    text = "${scope.name}\n$pendingLabel" +
                        if (scope.overdue > 0) " · $overdueLabel" else "",
                    color = Femho.colors.ink,
                    fontSize = FemhoText.meta,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier
                        .weight(1f)
                        .clip(RoundedCornerShape(FemhoShape.card))
                        .background(Femho.colors.cardBg)
                        .border(1.dp, Femho.colors.cardBorder, RoundedCornerShape(FemhoShape.card))
                        .padding(12.dp)
                        .testTag("dashboard-scope-${scope.scopeId}"),
                )
            }
        }

        Section(
            title = stringResource(R.string.dashboard_today),
            tasks = dashboard.today,
            empty = stringResource(R.string.dashboard_empty_today),
            scopes = scopes,
            onOpen = { model.open(it) },
            testTag = "dashboard-today",
        )

        if (showOverdueSection) {
            Section(
                title = stringResource(R.string.dashboard_overdue),
                tasks = dashboard.overdue,
                empty = stringResource(R.string.dashboard_empty_overdue),
                scopes = scopes,
                onOpen = { model.open(it) },
                testTag = "dashboard-overdue",
            )
        }

        if (showCalendarWidget) {
            val avui = java.time.LocalDate.now()
            MonthView(
                year = avui.year,
                month = avui.monthValue,
                selected = avui,
                today = avui,
                dots = dots,
                labels = calendarLabels,
                onSelect = { },
                weekStart = weekStart,
                modifier = Modifier.testTag("dashboard-calendar"),
            )
        }

        Section(
            title = stringResource(R.string.dashboard_doing),
            tasks = dashboard.doing,
            empty = stringResource(R.string.dashboard_empty_doing),
            scopes = scopes,
            onOpen = { model.open(it) },
            testTag = "dashboard-doing",
        )
    }
}

/** Una secció del dashboard: títol, i les tasques com a targetes amb l'àmbit. */
@Composable
private fun Section(
    title: String,
    tasks: List<ho.fem.model.Task>,
    empty: String,
    scopes: List<Scope>,
    onOpen: (ho.fem.model.Task) -> Unit,
    testTag: String,
) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(
            text = title,
            color = Femho.colors.ink,
            fontSize = FemhoText.columnTitle,
            fontWeight = FontWeight.ExtraBold,
        )
        if (tasks.isEmpty()) {
            Text(
                text = empty,
                color = Femho.colors.inkSoft,
                fontSize = FemhoText.body,
            )
        } else {
            tasks.forEach { task ->
                TaskCard(
                    title = task.title,
                    project = scopes.firstOrNull { it.id == task.scopeId }?.name,
                    time = task.dueTime,
                    done = task.status == TaskStatus.DONE,
                    onOpen = { onOpen(task) },
                    modifier = Modifier.testTag("$testTag-task"),
                    extraMetadata = taskOriginMetadata(task),
                )
            }
        }
    }
}

@Composable
private fun SearchHost(model: AppViewModel, onBoard: () -> Unit) {
    val results by model.searchResults.collectAsStateWithLifecycle()
    val loading by model.searchLoading.collectAsStateWithLifecycle()
    val scopes by model.scopes.collectAsStateWithLifecycle()
    var query by remember { mutableStateOf("") }

    // El debounce de 250ms de la web (SearchScreen.tsx:39): no es demana a cada tecla.
    androidx.compose.runtime.LaunchedEffect(query) {
        delay(250)
        val q = query.trim()
        if (q.length >= 2) model.search(q) else model.clearSearch()
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Femho.pageBackground)
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            text = stringResource(R.string.nav_backtoboard),
            color = Femho.colors.inkSoft,
            fontSize = FemhoText.body,
            modifier = Modifier
                .clickable(onClick = onBoard)
                .heightIn(min = FemhoSize.touch)
                .padding(vertical = 12.dp)
                .testTag("search-back"),
        )
        Text(
            text = stringResource(R.string.nav_search),
            color = Femho.colors.ink,
            fontSize = FemhoText.columnTitle,
            fontWeight = FontWeight.ExtraBold,
        )

        androidx.compose.material3.OutlinedTextField(
            value = query,
            onValueChange = { query = it },
            singleLine = true,
            placeholder = { Text(stringResource(R.string.nav_search)) },
            modifier = Modifier.fillMaxWidth().testTag("search-input"),
        )

        when {
            query.trim().length < 2 -> Unit
            loading -> Loading()
            results.isEmpty() -> Text(
                text = stringResource(R.string.state_empty_search),
                color = Femho.colors.inkSoft,
                fontSize = FemhoText.body,
                modifier = Modifier.testTag("search-empty"),
            )
            else -> results.forEach { task ->
                TaskCard(
                    title = task.title,
                    // La pastilla d'àmbit a cada resultat: aquí es barregen tots (la web).
                    project = scopes.firstOrNull { it.id == task.scopeId }?.name,
                    time = task.dueTime,
                    done = task.status == TaskStatus.DONE,
                    onOpen = { model.open(task) },
                    modifier = Modifier.testTag("search-result-${'$'}{task.id}"),
                    extraMetadata = taskOriginMetadata(task),
                )
            }
        }
    }
}
