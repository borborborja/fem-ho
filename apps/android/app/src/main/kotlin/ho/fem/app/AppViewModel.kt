package ho.fem.app

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ho.fem.app.widget.FemhoWidgets
import ho.fem.data.ActiveAccount
import ho.fem.data.Container
import ho.fem.data.LocalCalendarSuggestions
import ho.fem.data.LocalPomodoro
import ho.fem.data.Repository
import ho.fem.data.TaskLists
import ho.fem.data.normalizeServerUrl
import ho.fem.model.ActivityNotificationDevice
import ho.fem.model.ActivityNotificationKind
import ho.fem.model.Agent
import ho.fem.model.AgentDetail
import ho.fem.model.AgentScopeAvailability
import ho.fem.model.AiExecution
import ho.fem.model.AiMode
import ho.fem.model.AiTaskConnections
import ho.fem.model.AiTaskSettings
import ho.fem.model.ApiTokenSummary
import ho.fem.model.CalendarTaskStart
import ho.fem.model.CalendarTaskSuggestion
import ho.fem.model.Checklist
import ho.fem.model.EventOccurrence
import ho.fem.model.ExternalAccess
import ho.fem.model.Inbox
import ho.fem.model.InboxEvent
import ho.fem.model.Label
import ho.fem.model.Person
import ho.fem.model.PomodoroAction
import ho.fem.model.PomodoroPhase
import ho.fem.model.PomodoroSnapshot
import ho.fem.model.PomodoroStatus
import ho.fem.model.PomodoroTimer
import ho.fem.model.Project
import ho.fem.model.QuickAddResult
import ho.fem.model.Scope
import ho.fem.model.ScopeSettings
import ho.fem.model.serverIsNewer
import ho.fem.model.Task
import ho.fem.model.TaskStatus
import ho.fem.model.TaskType
import ho.fem.model.UserProfile
import ho.fem.model.projectPomodoroTimer
import ho.fem.model.serverCandidates
import ho.fem.network.FemhoApi
import ho.fem.network.certificateFingerprint
import ho.fem.network.probeServerCertificate
import java.util.UUID
import java.io.IOException
import java.time.Instant
import java.time.ZoneId
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray

/**
 * L'estat de l'aplicació.
 *
 * Un de sol per a tota l'app i no un per pantalla: el tauler, el calendari i els ajustos
 * comparteixen els àmbits actius, el perfil i la cua de sortida, i tres models amb
 * còpies pròpies acabarien discrepant a la primera sincronització.
 *
 * **Llegir és sempre local.** El que arriba a les pantalles surt del repositori, que
 * llegeix de Room; la xarxa només omple la base. És el que fa que el mode avió no sigui
 * un mode (docs/03 §11).
 */
class AppViewModel(private val container: Container) : ViewModel() {

    sealed interface Session {
        data object Checking : Session
        data object RestoreFailed : Session
        data class RecoverLegacy(val serverUrl: String, val failed: Boolean = false) : Session
        data class NeedsServer(val message: String? = null) : Session
        data class NeedsLogin(
            val serverUrl: String,
            val instanceName: String,
            /** `open`, `invite` o `disabled`: si s'ofereix registrar-se (docs/12 §3). */
            val registration: String = "disabled",
            val expired: Boolean = false,
        ) : Session
        /** El servidor és més nou que l'app: convé actualitzar-la (docs/03 §11). */
        data class NeedsLoginNewer(
            val serverUrl: String,
            val instanceName: String,
            /** `open`, `invite` o `disabled`: si s'ofereix registrar-se (docs/12 §3). */
            val registration: String = "disabled",
        ) : Session
        /** Certificat autofirmat o de CA pròpia: cal confirmar l'empremta (docs/03 §2:38). */
        data class NeedsCertConfirm(val serverUrl: String, val fingerprint: String) : Session
        data class Ready(val serverUrl: String) : Session
    }

    private val _session = MutableStateFlow<Session>(Session.Checking)
    val session: StateFlow<Session> = _session.asStateFlow()

    private val _notificationSettings = MutableStateFlow(NotificationSettings())
    internal val notificationSettings = _notificationSettings.asStateFlow()

    /** Host i DER (base64) del certificat pendent de confirmar per empremta. */
    private var _pendingCertHost: String? = null
    private var _pendingCertDer: String? = null

    private val _tasks = MutableStateFlow<List<Task>>(emptyList())
    val tasks: StateFlow<List<Task>> = _tasks.asStateFlow()

    private val _scopes = MutableStateFlow<List<Scope>>(emptyList())
    val scopes: StateFlow<List<Scope>> = _scopes.asStateFlow()

    private val _projects = MutableStateFlow<List<Project>>(emptyList())
    val projects: StateFlow<List<Project>> = _projects.asStateFlow()

    private val _people = MutableStateFlow<List<Person>>(emptyList())
    val people: StateFlow<List<Person>> = _people.asStateFlow()

    private val _labels = MutableStateFlow<List<Label>>(emptyList())
    val labels: StateFlow<List<Label>> = _labels.asStateFlow()

    private val _taskTypes = MutableStateFlow<List<TaskType>>(emptyList())
    val taskTypes: StateFlow<List<TaskType>> = _taskTypes.asStateFlow()

    private val _scopeSettings = MutableStateFlow<Map<String, ScopeSettings>>(emptyMap())
    val scopeSettings: StateFlow<Map<String, ScopeSettings>> = _scopeSettings.asStateFlow()

    private val _aiTaskSettings = MutableStateFlow<List<AiTaskSettings>?>(null)
    val aiTaskSettings = _aiTaskSettings.asStateFlow()
    private val aiTaskSettingsMutex = Mutex()
    private val aiExecutionRequests = mutableMapOf<String, String>()
    private val _aiExecutingTasks = MutableStateFlow<Set<String>>(emptySet())
    val aiExecutingTasks = _aiExecutingTasks.asStateFlow()

    private val _pending = MutableStateFlow(0)
    val pending: StateFlow<Int> = _pending.asStateFlow()
    private val _syncIssues = MutableStateFlow<List<ho.fem.data.SyncIssue>>(emptyList())
    val syncIssues = _syncIssues.asStateFlow()

    private val _actionError = MutableStateFlow<Int?>(null)
    val actionError = _actionError.asStateFlow()
    fun consumeActionError() { _actionError.value = null }

    private val _theme = MutableStateFlow("system")
    val theme: StateFlow<String> = _theme.asStateFlow()

    private val _accent = MutableStateFlow("default")
    val accent: StateFlow<String> = _accent.asStateFlow()

    private val _profile = MutableStateFlow<UserProfile?>(null)
    val profile: StateFlow<UserProfile?> = _profile.asStateFlow()
    private val defaultTimezone = ZoneId.systemDefault().id
    private val _profileTimezone = MutableStateFlow(defaultTimezone)
    val profileTimezone = _profileTimezone.asStateFlow()
    private val _doneClearedAt = MutableStateFlow<String?>(null)
    val doneClearedAt = _doneClearedAt.asStateFlow()
    private val _doneSettingsSaving = MutableStateFlow(false)
    val doneSettingsSaving = _doneSettingsSaving.asStateFlow()
    private val _pomodoro = MutableStateFlow(LocalPomodoro())
    val pomodoro = _pomodoro.asStateFlow()
    private val _calendarSuggestions = MutableStateFlow(LocalCalendarSuggestions())
    val calendarSuggestions = _calendarSuggestions.asStateFlow()
    private val _doingAutoStopMinutes = MutableStateFlow<Int?>(null)
    val doingAutoStopMinutes = _doingAutoStopMinutes.asStateFlow()

    private val _activeScopes = MutableStateFlow<List<String>>(emptyList())
    val activeScopes = _activeScopes.asStateFlow()

    /**
     * Si cal mostrar el wizard de la primera entrada (mode d'àmbits multi/mono).
     *
     * La mateixa regla que la web (scope-mode.ts): `scope_mode` encara és `null` i la
     * instància deixa triar (`instance.scope_mode == 'both'`). Es recalcula al login i
     * al registre; `setScopeMode` el tanca.
     */
    private val _needsScopeModeWizard = MutableStateFlow(false)
    val needsScopeModeWizard: StateFlow<Boolean> = _needsScopeModeWizard.asStateFlow()

    /** El nom de la instància, per a la confirmació del wipe (s'hi ha d'escriure). */
    private val _instanceName = MutableStateFlow("")
    val instanceName: StateFlow<String> = _instanceName.asStateFlow()
    private val _instanceVersion = MutableStateFlow("")
    val instanceVersion: StateFlow<String> = _instanceVersion.asStateFlow()

    private val _gravatarEnabled = MutableStateFlow(true)
    val gravatarEnabled: StateFlow<Boolean> = _gravatarEnabled.asStateFlow()

    private val _tokens = MutableStateFlow<List<ApiTokenSummary>>(emptyList())
    val tokens: StateFlow<List<ApiTokenSummary>> = _tokens.asStateFlow()
    private val _externalAccess = MutableStateFlow<ExternalAccess?>(null)
    val externalAccess = _externalAccess.asStateFlow()
    private val _tokenBusy = MutableStateFlow(false)
    val tokenBusy = _tokenBusy.asStateFlow()
    private val _tokenError = MutableStateFlow(false)
    val tokenError = _tokenError.asStateFlow()

    private val _calendars = MutableStateFlow<List<ho.fem.model.Calendar>>(emptyList())
    val calendars: StateFlow<List<ho.fem.model.Calendar>> = _calendars.asStateFlow()

    private val _mailAccounts = MutableStateFlow<List<ho.fem.model.MailAccount>>(emptyList())
    val mailAccounts: StateFlow<List<ho.fem.model.MailAccount>> = _mailAccounts.asStateFlow()

    private val _mailRules = MutableStateFlow<List<ho.fem.model.MailRule>>(emptyList())
    val mailRules: StateFlow<List<ho.fem.model.MailRule>> = _mailRules.asStateFlow()

    private val _openComments = MutableStateFlow<List<ho.fem.model.Comment>>(emptyList())
    val openComments: StateFlow<List<ho.fem.model.Comment>> = _openComments.asStateFlow()

    private val _openActivity = MutableStateFlow<List<ho.fem.model.ActivityEntry>>(emptyList())
    val openActivity: StateFlow<List<ho.fem.model.ActivityEntry>> = _openActivity.asStateFlow()

    /** Els enllaços compartits de la tasca oberta, per revocar-los. */
    private val _openShares = MutableStateFlow<List<ho.fem.model.ShareSummary>>(emptyList())
    val openShares: StateFlow<List<ho.fem.model.ShareSummary>> = _openShares.asStateFlow()

    /** Els adjunts de la tasca oberta. */
    private val _openAttachments = MutableStateFlow<List<ho.fem.model.Attachment>>(emptyList())
    val openAttachments: StateFlow<List<ho.fem.model.Attachment>> = _openAttachments.asStateFlow()

    /** L'error d'una pujada (per exemple, el 413 de fitxer massa gran). */
    private val _attachmentError = MutableStateFlow<String?>(null)
    val attachmentError: StateFlow<String?> = _attachmentError.asStateFlow()

    fun consumeAttachmentError() {
        _attachmentError.value = null
    }

    /** Totes les shares, per a la pestanya Compartits. */
    private val _allShares = MutableStateFlow<List<ho.fem.model.ShareSummary>>(emptyList())
    val allShares: StateFlow<List<ho.fem.model.ShareSummary>> = _allShares.asStateFlow()

    /** Els accessos de cada share (pseudònim i última visita), per la pestanya. */
    private val _shareAccesses = MutableStateFlow<Map<String, List<ho.fem.model.ShareAccess>>>(emptyMap())
    val shareAccesses: StateFlow<Map<String, List<ho.fem.model.ShareAccess>>> =
        _shareAccesses.asStateFlow()

    /** El preview d'un convit d'àmbit que es mira (deep link femho://join/{token}). */
    private val _joinPreview = MutableStateFlow<ho.fem.model.JoinPreview?>(null)
    val joinPreview: StateFlow<ho.fem.model.JoinPreview?> = _joinPreview.asStateFlow()

    /** L'error d'un convit que no es pot mirar ni acceptar. */
    private val _joinError = MutableStateFlow<String?>(null)
    val joinError: StateFlow<String?> = _joinError.asStateFlow()

    /** True quan el convit s'ha acceptat (per passar de pantalla). */
    private val _joinDone = MutableStateFlow(false)
    val joinDone: StateFlow<Boolean> = _joinDone.asStateFlow()

    fun consumeJoin() {
        _joinPreview.value = null
        _joinError.value = null
        _joinDone.value = false
    }

    /** Carrega totes les shares i els seus accessos, per a la pestanya Compartits. */
    fun loadAllShares() {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            runCatching { container.api(sessionAccount).shares() }
                .onSuccess { shares ->
                    _allShares.value = shares
                    shares.forEach { share ->
                        runCatching { container.api(sessionAccount).shareAccesses(share.id) }
                            .onSuccess { _shareAccesses.value = _shareAccesses.value + (share.id to it) }
                    }
                }
        }
    }

    /** Revoca una share des de la pestanya Compartits. DELETE /shares/{id}. */
    fun revokeShare(shareId: String) {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            runCatching { container.api(sessionAccount).revokeShare(shareId) }
                .onSuccess { loadAllShares() }
        }
    }

    /** El preview d'un convit d'àmbit, per mirar-lo abans d'acceptar. */
    fun loadJoinPreview(token: String) {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            runCatching { container.api(sessionAccount).joinPreview(token) }
                .onSuccess { _joinPreview.value = it }
                .onFailure { _joinError.value = it.message }
        }
    }

    /** Accepta un convit d'àmbit. POST /join/{token}. */
    fun acceptJoin(token: String) {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            runCatching { container.api(sessionAccount).acceptJoin(token) }
                .onSuccess {
                    _joinDone.value = true
                    loadEntityData()
                    refresh()
                }
                .onFailure { _joinError.value = it.message }
        }
    }

    /**
     * Accepta un convit a la instància (crea el compte). POST /invite/{token}.
     * No requereix sessió: és com s'entra per primera vegada.
     */
    fun acceptInvite(token: String, password: String) {
        viewModelScope.launch {
            runCatching { container.api(serverUrl ?: return@launch).inviteAccept(token, password) }
                .onSuccess { _joinDone.value = true }
                .onFailure { _joinError.value = it.message }
        }
    }

    /** L'URL acabat de crear: es mostra una sola vegada, i després es descarta. */
    private val _createdShareUrl = MutableStateFlow<String?>(null)
    val createdShareUrl: StateFlow<String?> = _createdShareUrl.asStateFlow()

    fun consumeCreatedShareUrl() {
        _createdShareUrl.value = null
    }

    // ------------------------------------------------------------------ Dashboard

    private val _dashboard = MutableStateFlow<ho.fem.model.DashboardView>(ho.fem.model.DashboardView())
    val dashboard: StateFlow<ho.fem.model.DashboardView> = _dashboard.asStateFlow()

    private val _showOverdueSection = MutableStateFlow(true)
    val showOverdueSection: StateFlow<Boolean> = _showOverdueSection.asStateFlow()

    private val _showCalendarWidget = MutableStateFlow(true)
    val showCalendarWidget: StateFlow<Boolean> = _showCalendarWidget.asStateFlow()

    /** Carrega el dashboard global. El wordmark l'obre (docs/03 §3:50). */
    fun loadDashboard() {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            // Les seccions que s'amaguen a Ajustos no es pinten (docs/02 §8).
            _showOverdueSection.value = container.settings.showOverdueSection.first()
            _showCalendarWidget.value = container.settings.showCalendarWidget.first()
            runCatching { container.api(sessionAccount).dashboard() }
                .onSuccess { _dashboard.value = it }
        }
    }

    private val _createdToken = MutableStateFlow<String?>(null)
    val createdToken: StateFlow<String?> = _createdToken.asStateFlow()

    data class CalendarRequest(
        val from: String,
        val to: String,
        val day: String,
        val scopeIds: List<String>,
        val timezone: String,
    )

    data class CalendarState(
        val request: CalendarRequest? = null,
        val events: List<EventOccurrence> = emptyList(),
        val inbox: Inbox? = null,
        val loading: Boolean = false,
        val failed: Boolean = false,
    )

    private val _calendar = MutableStateFlow(CalendarState())
    val calendar: StateFlow<CalendarState> = _calendar.asStateFlow()
    private var calendarLoad: Job? = null

    private val _openTask = MutableStateFlow<Task?>(null)
    val openTask: StateFlow<Task?> = _openTask.asStateFlow()

    // ------------------------------------------------------------------ Cerca

    private val _searchResults = MutableStateFlow<List<Task>>(emptyList())
    val searchResults: StateFlow<List<Task>> = _searchResults.asStateFlow()

    private val _searchLoading = MutableStateFlow(false)
    val searchLoading: StateFlow<Boolean> = _searchLoading.asStateFlow()

    /**
     * Cerca de tasques, amb el mateix límit que la web (8).
     *
     * El debounce viu a la pantalla (250ms), com a la web: aquí només es demana quan la
     * pantalla ja ha decidit que toca. `q` ja arriba retallada i amb mínim 2 caràcters.
     */
    fun search(q: String) {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            _searchLoading.value = true
            runCatching { container.api(sessionAccount).search(q, 8) }
                .onSuccess { _searchResults.value = it.data }
                .onFailure { _searchResults.value = emptyList() }
            _searchLoading.value = false
        }
    }

    fun clearSearch() {
        _searchResults.value = emptyList()
    }

    // ------------------------------------------------------------------ Admin

    private val _adminUsers = MutableStateFlow<List<ho.fem.model.AdminUser>>(emptyList())
    val adminUsers: StateFlow<List<ho.fem.model.AdminUser>> = _adminUsers.asStateFlow()

    private val _adminInviteUrl = MutableStateFlow<String?>(null)
    val adminInviteUrl: StateFlow<String?> = _adminInviteUrl.asStateFlow()

    private val _adminError = MutableStateFlow<String?>(null)
    val adminError: StateFlow<String?> = _adminError.asStateFlow()

    /** Carrega la llista d'usuaris de la pestanya Admin. */
    fun loadAdminUsers() {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            runCatching { container.api(sessionAccount).adminUsers() }
                .onSuccess { _adminUsers.value = it }
                .onFailure { _adminError.value = it.message }
        }
    }

    /** Convida un membre. L'enllaç només es veu un cop (server: InviteResult). */
    fun inviteAdminUser(email: String, name: String, role: String, onDone: () -> Unit) {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            runCatching { container.api(sessionAccount).adminInvite(email, name, role) }
                .onSuccess {
                    _adminInviteUrl.value = it.inviteUrl
                    loadAdminUsers()
                    onDone()
                }
                .onFailure { _adminError.value = it.message }
        }
    }

    fun consumeAdminInviteUrl() {
        _adminInviteUrl.value = null
    }

    fun setAdminRole(id: String, role: String) {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            runCatching { container.api(sessionAccount).adminUpdateRole(id, role) }
                .onSuccess { loadAdminUsers() }
                .onFailure { _adminError.value = it.message }
        }
    }

    fun deleteAdminUser(id: String) {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            runCatching { container.api(sessionAccount).adminDeleteUser(id) }
                .onSuccess { loadAdminUsers() }
                .onFailure { _adminError.value = it.message }
        }
    }

    /** Neteja la instància; el servidor també exigeix el nom exacte de confirmació. */
    fun wipeInstance(confirmation: String, onDone: () -> Unit) {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            runCatching { container.api(sessionAccount).adminWipe(confirmation) }
                .onSuccess {
                    _adminError.value = null
                    onDone()
                }
                .onFailure { _adminError.value = it.message }
        }
    }

    private val _openTaskLists = MutableStateFlow(TaskLists())
    val openTaskLists: StateFlow<TaskLists> = _openTaskLists.asStateFlow()

    /**
     * Les llistes pinejades, per al menú de la xinxeta (`docs/03` §3).
     *
     * **No es repliquen a Room.** Pinejar és per usuari i el menú és una drecera a una
     * pantalla que ja se sap obrir; guardar-les obligaria a decidir quan invalidar-les i
     * el guany offline seria veure la llista de pinejades d'ahir.
     */
    /**
     * Els projectes que es veuen al tauler. **Buit vol dir tots** (`docs/14` P7).
     *
     * La tria és per projecte i no per àmbit: un àmbit sense res triat vol dir "tots els
     * seus", i la llista buida ja ho diu sense haver de desar cap "tots" a part.
     */
    private val _activeProjects = MutableStateFlow<List<String>>(emptyList())
    val activeProjects: StateFlow<List<String>> = _activeProjects.asStateFlow()

    private val _pinned = MutableStateFlow<List<Checklist>>(emptyList())
    val pinned: StateFlow<List<Checklist>> = _pinned.asStateFlow()

    private var serverUrl: String? = null
    private var activeAccount: ActiveAccount? = null
    private var authentication: Job? = null
    private var openTaskJob: Job? = null
    private var openNotificationJob: Job? = null
    private var scopeModeJob: Job? = null
    private var profileLoadJob: Job? = null
    private var pomodoroLoadJob: Job? = null
    private var calendarSuggestionsLoadJob: Job? = null
    private var sessionScope = CoroutineScope(viewModelScope.coroutineContext + Job().also { it.cancel() })

    private fun startSession(account: ActiveAccount) {
        val base = account.identity.serverUrl
        sessionScope.cancel()
        sessionScope = CoroutineScope(viewModelScope.coroutineContext + SupervisorJob(viewModelScope.coroutineContext[Job]))
        activeAccount = account
        serverUrl = base
        _session.value = Session.Ready(base)
        observe(account)
        refresh()
        refreshScopeModeWizard(account)
        Notifications.requestSync(container.appContext, account)
        sessionScope.launch {
            runCatching { container.api(account).info() }
                .onSuccess {
                    _instanceName.value = it.name
                    _instanceVersion.value = it.version
                }
        }
    }

    private fun clearSessionData() {
        openTaskJob = null
        openNotificationJob = null
        cardJobs.clear()
        savingCards.clear()
        _tasks.value = emptyList()
        _scopes.value = emptyList()
        _projects.value = emptyList()
        _people.value = emptyList()
        _labels.value = emptyList()
        _taskTypes.value = emptyList()
        _scopeSettings.value = emptyMap()
        _aiTaskSettings.value = null
        _notificationSettings.value = NotificationSettings()
        aiExecutionRequests.clear()
        _aiExecutingTasks.value = emptySet()
        _pending.value = 0
        _syncIssues.value = emptyList()
        _actionError.value = null
        _profile.value = null
        _profileTimezone.value = defaultTimezone
        profileLoadJob = null
        pomodoroLoadJob = null
        calendarSuggestionsLoadJob = null
        _doneClearedAt.value = null
        _doneSettingsSaving.value = false
        _pomodoro.value = LocalPomodoro()
        _calendarSuggestions.value = LocalCalendarSuggestions()
        _doingAutoStopMinutes.value = null
        _activeScopes.value = emptyList()
        _instanceVersion.value = ""
        _needsScopeModeWizard.value = false
        _gravatarEnabled.value = true
        _tokens.value = emptyList()
        _externalAccess.value = null
        _tokenBusy.value = false
        _tokenError.value = false
        _calendars.value = emptyList()
        _mailAccounts.value = emptyList()
        _mailRules.value = emptyList()
        _openComments.value = emptyList()
        _openActivity.value = emptyList()
        _openShares.value = emptyList()
        _openAttachments.value = emptyList()
        _attachmentError.value = null
        _allShares.value = emptyList()
        _shareAccesses.value = emptyMap()
        _joinPreview.value = null
        _joinError.value = null
        _joinDone.value = false
        _createdShareUrl.value = null
        _dashboard.value = ho.fem.model.DashboardView()
        _createdToken.value = null
        calendarLoad?.cancel()
        _calendar.value = CalendarState()
        _openTask.value = null
        _taskSaveError.value = false
        _taskSaving.value = false
        _searchResults.value = emptyList()
        _searchLoading.value = false
        _adminUsers.value = emptyList()
        _adminInviteUrl.value = null
        _adminError.value = null
        _openTaskLists.value = TaskLists()
        _activeProjects.value = emptyList()
        _pinned.value = emptyList()
        _quickAddDraft.value = null
        _quickAddTexts.value = emptyMap()
        _quickAddSaving.value = emptySet()
        _aiEnabled.value = false
        _aiBoard.value = false
        _agentsDetail.value = emptyList()
        _agentScopeAvailability.value = emptyMap()
        _agentCredentials.value = emptyMap()
        _createdAgentToken.value = null
        _agentSkill.value = null
        _expandedCards.value = emptySet()
        _openCards.value = emptySet()
        _cardLists.value = emptyMap()
        _cardDrafts.value = emptyMap()
        pendingOpen = null
    }

    init {
        viewModelScope.launch {
            container.expiredAccounts.collect { account ->
                if (activeAccount == account) endSession(expired = true)
            }
        }
        restoreSession()
    }

    fun retrySessionRestore() {
        if (_session.value == Session.RestoreFailed) restoreSession()
    }

    fun resolveLegacySession(recover: Boolean) {
        val saved = _session.value as? Session.RecoverLegacy ?: return
        _session.value = Session.Checking
        viewModelScope.launch {
            val account = try {
                if (recover) container.recoverLegacySession(saved.serverUrl)
                else {
                    container.discardLegacySession()
                    null
                }
            } catch (failure: Exception) {
                if (failure is CancellationException) throw failure
                _session.value = saved.copy(failed = true)
                return@launch
            }
            if (account == null) {
                _session.value = Session.NeedsLogin(saved.serverUrl, "", expired = recover)
            } else {
                startSession(account)
            }
        }
    }

    private fun restoreSession() {
        _session.value = Session.Checking
        viewModelScope.launch {
            val (account, base, legacy) = try {
                _theme.value = container.settings.theme.first()
                _accent.value = container.settings.accent.first()
                val saved = container.settings.serverUrl.first()
                val account = container.restoreAccount()
                // La sessió xifrada vincula el servidor al compte. La preferència només
                // suggereix on entrar quan no hi ha sessió i es pot reparar des d'aquesta.
                val base = account?.identity?.serverUrl ?: saved
                base?.let { url -> java.net.URI(url).host?.let { container.settings.trustedCert(it) } }
                if (account != null && saved != account.identity.serverUrl) {
                    container.settings.setServerUrl(account.identity.serverUrl)
                }
                Triple(account, base, account == null && base != null && container.hasLegacySession())
            } catch (failure: Exception) {
                if (failure is CancellationException) throw failure
                _session.value = Session.RestoreFailed
                return@launch
            }

            serverUrl = base
            when {
                account != null -> startSession(account)
                base != null && legacy -> _session.value = Session.RecoverLegacy(base)
                base != null -> _session.value = Session.NeedsLogin(base, "")
                else -> _session.value = Session.NeedsServer()
            }
        }
    }

    /**
     * Valida la URL abans de demanar credencials (docs/03 §2).
     *
     * `GET /info` és públic i sense autenticar, i és el que permet dir "aquí no hi ha
     * cap Fem-ho" abans que ningú hagi escrit la contrasenya en un lloc que no toca.
     */
    fun checkServer(raw: String, onInsecure: (String) -> Unit) {
        viewModelScope.launch {
            val resolved = serverCandidates(raw)
            if (resolved.error != null || resolved.candidates.isEmpty()) {
                _session.value = Session.NeedsServer(resolved.error ?: "invalid")
                return@launch
            }

            /**
             * **`https://` primer, sempre.** Els candidats venen en ordre i el primer
             * que respongui guanya; `http://` només hi és si l'amfitrió és d'una xarxa
             * privada, i quan s'hi cau **s'avisa**. Provar-los alhora faria que de
             * vegades guanyés el clar per ser més ràpid, que és justament el que no ha
             * de passar mai.
             */
            for (rawCandidate in resolved.candidates) {
                val candidate = runCatching { normalizeServerUrl(rawCandidate) }.getOrNull() ?: continue
                java.net.URI(candidate).host?.let { container.settings.trustedCert(it) }
                val attempt = runCatching { container.api(candidate).info() }
                val info = attempt.getOrNull()
                if (info == null) {
                    // Si és https i el servidor presenta un certificat que no es
                    // reconeix, s'ofereix confirmar-lo per empremta abans de seguir.
                    val exc = attempt.exceptionOrNull()
                    if (candidate.startsWith("https://") && exc is javax.net.ssl.SSLException) {
                        val uri = java.net.URI(candidate)
                        val host = uri.host ?: continue
                        val port = if (uri.port > 0) uri.port else 443
                        // La sonda fa xarxa bloquejant: fora del fil principal.
                        val cert = withContext(Dispatchers.IO) { probeServerCertificate(host, port) }
                        if (cert != null) {
                            _pendingCertHost = host
                            _pendingCertDer = android.util.Base64.encodeToString(
                                cert.encoded, android.util.Base64.NO_WRAP
                            )
                            _session.value = Session.NeedsCertConfirm(candidate, certificateFingerprint(cert))
                            return@launch
                        }
                    }
                    continue
                }

                if (candidate.startsWith("http://")) onInsecure(candidate)
                container.discardLegacySession()
                container.settings.setServerUrl(candidate)
                serverUrl = candidate
                // La versió de l'app (BuildConfig.VERSION_NAME) es compara amb la del
                // servidor: si aquest és més nou, s'avisa a la pantalla d'entrada.
                val appVersion = ho.fem.app.BuildConfig.VERSION_NAME
                _session.value = if (serverIsNewer(appVersion, info.version)) {
                    Session.NeedsLoginNewer(candidate, info.name, info.registration)
                } else {
                    Session.NeedsLogin(candidate, info.name, info.registration)
                }
                return@launch
            }

            _session.value = Session.NeedsServer("unreachable")
        }
    }

    /** L'usuari ha confirmat l'empremta: es desa el certificat i es torna a provar. */
    fun confirmTrustedCert() {
        val host = _pendingCertHost ?: return
        val der = _pendingCertDer ?: return
        viewModelScope.launch {
            container.settings.setTrustedCert(host, der)
            val current = _session.value as? Session.NeedsCertConfirm ?: return@launch
            val info = runCatching { container.api(current.serverUrl).info() }.getOrNull()
            _session.value = if (info != null) {
                container.discardLegacySession()
                container.settings.setServerUrl(current.serverUrl)
                serverUrl = current.serverUrl
                val appVersion = ho.fem.app.BuildConfig.VERSION_NAME
                if (serverIsNewer(appVersion, info.version)) {
                    Session.NeedsLoginNewer(current.serverUrl, info.name)
                } else {
                    Session.NeedsLogin(current.serverUrl, info.name)
                }
            } else {
                Session.NeedsServer("unreachable")
            }
        }
    }

    fun rejectTrustedCert() {
        _pendingCertHost = null
        _pendingCertDer = null
        _session.value = Session.NeedsServer()
    }

    fun login(email: String, password: String, onError: (String) -> Unit) {
        authenticate(onError) { it.login(email, password) }
    }

    /** Registra un compte nou a una instància amb registre obert (docs/12 §3). */
    fun register(name: String, email: String, password: String, onError: (String) -> Unit) {
        authenticate(onError) { it.register(name, email, password) }
    }

    private fun authenticate(
        onError: (String) -> Unit,
        login: suspend (FemhoApi) -> ho.fem.model.AuthTokens,
    ) {
        val base = serverUrl ?: return
        if (authentication?.isActive == true) return
        authentication = viewModelScope.launch {
            runCatching { container.authenticate(base, login) }
                .onSuccess { account ->
                    startSession(account)
                    ho.fem.app.widget.FemhoWidgets.updateAll(container.appContext)
                }
                .onFailure { error ->
                    if (error is CancellationException) throw error
                    val label = when (error) {
                        is FemhoApi.ApiException -> if (error.status == 401) R.string.login_error else null
                        is IOException -> R.string.login_serverunreachable
                        else -> R.string.error_generic
                    }
                    onError(label?.let(container.appContext::getString)
                        ?: (error as? FemhoApi.ApiException)?.detail.orEmpty())
                }
        }
    }

    /**
     * Decideix si cal mostrar el wizard de la primera entrada.
     *
     * La mateixa regla que la web (scope-mode.ts): `scope_mode` encara és `null` i la
     * instància deixa triar (`instance.scope_mode == 'both'`).
     */
    private fun refreshScopeModeWizard(sessionAccount: ActiveAccount) {
        sessionScope.launch {
            val cachedTimezone = container.settings.cachedTimezone(sessionAccount)
            val cachedLocale = container.settings.cachedLocale(sessionAccount)
            _profileTimezone.value = cachedTimezone ?: defaultTimezone
            cachedLocale?.let { applyProfileLocale(it) }
            val api = container.api(sessionAccount)
            val settings = runCatching { api.settings() }.getOrNull() ?: return@launch
            settings.profile?.let { showAccountProfile(sessionAccount, it) }
            val mode = settings.settings.scopeMode
            if (mode != null) {
                container.settings.setScopeMode(mode)
                return@launch
            }
            val instance = runCatching { api.info() }.getOrNull()
            _needsScopeModeWizard.value = instance?.scopeMode == "both"
        }
    }

    /** El wizard ha triat mode d'àmbits: es desa al servidor i es tanca el wizard. */
    val preferenceLocale = container.settings.locale
    val preferenceScopeMode = container.settings.scopeMode
    val preferenceWeekStart = container.settings.weekStart
    val preferenceEventTaskDeleted = container.settings.eventTaskDeleted
    val preferenceShowCalendarWidget = container.settings.showCalendarWidget
    val preferenceShowOverdueSection = container.settings.showOverdueSection
    val preferenceInboxPosition = container.settings.inboxPosition
    val preferenceInboxShowOverdue = container.settings.inboxShowOverdue

    fun setScopeMode(mode: String) {
        val sessionAccount = activeAccount ?: return
        if (scopeModeJob?.isActive == true) return
        scopeModeJob = sessionScope.launch {
            runCatching { container.api(sessionAccount).updateSettings(scopeMode = mode) }
                .onSuccess {
                    container.settings.setScopeMode(mode)
                    _needsScopeModeWizard.value = false
                    refresh()
                }
                .onFailure {
                    if (it is CancellationException) throw it
                    actionFailed()
                }
        }
    }

    internal data class NotificationSettings(
        val device: ActivityNotificationDevice? = null,
        val busy: Boolean = false,
        val error: Int? = null,
    )

    internal fun loadNotificationSettings() {
        val account = activeAccount ?: return
        val current = _notificationSettings.value
        if (current.busy) return
        _notificationSettings.value = current.copy(busy = true, error = null)
        sessionScope.launch {
            try {
                _notificationSettings.value = NotificationSettings(device = ActivityNotifications.settings(container, account))
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                _notificationSettings.value = current.copy(error = R.string.notify_activity_needsconnection)
            }
        }
    }

    internal fun enableNotifications(enabled: Boolean) {
        updateNotificationSettings { account, device ->
            try {
                ActivityNotifications.setEnabled(container, account, enabled)
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                if (enabled) throw error
                Notifications.requestSync(container.appContext, account)
                _notificationSettings.value = NotificationSettings(
                    device = device.copy(enabled = false, subscribed = false),
                    error = R.string.notify_activity_needsconnection,
                )
                null
            }
        }
    }

    internal fun setScopeNotification(scopeId: String, kind: ActivityNotificationKind, enabled: Boolean) {
        updateNotificationSettings { account, device ->
            val id = ActivityNotifications.deviceId(container.appContext, account)
            val updated = container.api(account).setActivityNotificationScope(id, scopeId, kind, enabled)
            device.copy(scopes = device.scopes.map { if (it.scopeId == scopeId) updated else it })
        }
    }

    internal fun chooseNotificationDistributor(distributor: String) {
        updateNotificationSettings { account, _ ->
            ActivityNotifications.selectDistributor(container.appContext, account, distributor)
            ActivityNotifications.settings(container, account)
        }
    }

    private fun updateNotificationSettings(
        action: suspend (ActiveAccount, ActivityNotificationDevice) -> ActivityNotificationDevice?,
    ) {
        val account = activeAccount ?: return
        val current = _notificationSettings.value
        val device = current.device ?: return
        if (current.busy) return
        _notificationSettings.value = current.copy(busy = true, error = null)
        sessionScope.launch {
            try {
                action(account, device)?.let { _notificationSettings.value = NotificationSettings(device = it) }
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                _notificationSettings.value = current.copy(error = R.string.notify_activity_savefailed)
            }
        }
    }

    fun logout() = endSession(expired = false)

    private fun endSession(expired: Boolean) {
        val base = serverUrl ?: return
        val account = activeAccount
        if (account != null) (container.appContext as FemhoApplication).pomodoroSignals.cancel(account)
        sessionScope.cancel()
        activeAccount = null
        clearSessionData()
        _session.value = Session.Checking
        viewModelScope.launch {
            val signedOut: suspend () -> Unit = {
                _session.value = Session.NeedsLogin(base, _instanceName.value, expired = expired)
                container.appContext.getSystemService(android.app.NotificationManager::class.java).cancelAll()
                ho.fem.app.widget.FemhoWidgets.updateAll(container.appContext)
            }
            if (account == null) signedOut()
            else {
                withContext(Dispatchers.IO) { ActivityNotifications.deactivate(container.appContext, account) }
                container.logout(account, signedOut)
            }
        }
    }

    fun chooseAnotherServer() {
        if (authentication?.isActive == true) return
        _session.value = Session.NeedsServer()
    }

    fun toggleScope(id: String) {
        val account = activeAccount ?: return
        if (_scopes.value.none { it.id == id }) return
        sessionScope.launch { container.settings.toggleActiveScope(account, id) }
    }

    /**
     * Marca o desmarca un projecte del filtre.
     *
     * No demana res al servidor: el tauler ja té les tasques dels àmbits actius i el
     * filtre s'aplica sobre el que hi ha, com a la web.
     */
    fun toggleProject(id: String) {
        val account = activeAccount ?: return
        sessionScope.launch { container.settings.toggleActiveProject(account, id) }
    }

    /** Torna un àmbit a "tots els seus": treu del filtre els projectes que en són. */
    fun clearProjectsOfScope(scopeId: String) {
        val account = activeAccount ?: return
        sessionScope.launch {
            val ids = _projects.value.filter { it.scopeId == scopeId }.map { it.id }.toSet()
            container.settings.clearActiveProjects(account, ids)
        }
    }

    fun refresh() {
        val sessionAccount = activeAccount ?: return
        loadAgents()
        loadProfile()
        sessionScope.launch {
            runCatching { container.repository(sessionAccount).refresh(emptyList(), null) }
            runCatching { ActivityNotifications.sync(container, sessionAccount) }
        }
        sessionScope.launch { runCatching { container.api(sessionAccount).pinnedChecklists() }.onSuccess { _pinned.value = it } }
    }

    suspend fun refreshForegroundTaskBoard() {
        val account = activeAccount ?: return
        runCatching { container.repository(account).refreshTaskBoard() }
            .onFailure { if (it is CancellationException) throw it }
    }

    /**
     * Els esdeveniments d'una finestra.
     *
     * **No es guarden a Room.** Un calendari és una consulta amb rang, no una llista que
     * es replica: guardar-lo obligaria a decidir quina finestra es manté i a invalidar-la
     * quan l'usuari en demana una altra, i el guany offline seria veure el mes que vas
     * mirar per última vegada. El tauler sí que es replica perquè és el que es fa servir
     * sense connexió.
     */
    fun loadCalendar(request: CalendarRequest) {
        val sessionAccount = activeAccount ?: return
        calendarLoad?.cancel()
        val previous = _calendar.value
        val sameRange = previous.request?.copy(day = request.day) == request
        val cached = CalendarState(
            request = request,
            events = if (sameRange) previous.events else emptyList(),
            inbox = previous.inbox.takeIf { previous.request == request },
            loading = true,
        )
        _calendar.value = cached
        calendarLoad = sessionScope.launch {
            val api = container.api(sessionAccount)
            val events = async { runCatching { api.events(request.from, request.to, request.scopeIds) } }
            val inbox = async { runCatching { api.inbox(request.day, true, request.scopeIds) } }
            val loadedEvents = events.await()
            val loadedInbox = inbox.await()
            ensureActive()
            _calendar.value = cached.copy(
                events = loadedEvents.getOrElse { cached.events },
                inbox = loadedInbox.getOrElse { cached.inbox },
                loading = false,
                failed = loadedEvents.isFailure || loadedInbox.isFailure,
            )
        }
    }

    /**
     * Obre una tasca.
     *
     * La tasca surt de la base local —ja la tenim— i les llistes es demanen: no es
     * repliquen perquè només es miren en obrir la tasca, i replicar-les faria la primera
     * sincronització llarga per a un contingut que la majoria de tasques no tenen.
     */
    /**
     * Treure o tornar a posar una cita a la bústia.
     *
     * Torna a demanar el dia en comptes de tocar l'estat local: **la decisió té cinc
     * nivells i la pren el servidor**, i endevinar-la aquí voldria dir una segona
     * implementació de la mateixa regla.
     */
    fun setEventInInbox(event: InboxEvent, visible: Boolean?, request: CalendarRequest) {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            val api = container.api(sessionAccount)
            val result = runCatching {
                api.setEventInInbox(event.calendarId, event.uid, event.recurrenceId, visible)
            }
            ensureActive()
            if (_calendar.value.request != request) return@launch
            if (result.isSuccess) loadCalendar(request)
            else _calendar.value = _calendar.value.copy(failed = true)
        }
    }

    /**
     * Fer una tasca a partir d'una cita.
     *
     * Neix amb el títol i la data de la cita: qui ho demana ja sap què és, i fer-l'hi
     * reescriure seria demanar-li que copiés una cosa que té al davant. La cita marxa de
     * la bústia sola, perquè ara hi ha una tasca viva que hi apunta.
     */
    fun eventToTask(event: InboxEvent, request: CalendarRequest) {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            val api = container.api(sessionAccount)
            val result = runCatching {
                api.createTask(
                    id = java.util.UUID.randomUUID().toString(),
                    scopeId = event.scopeId,
                    title = event.summary,
                    projectId = null,
                    assigneeIds = emptyList(),
                    sourceEvent = Triple(event.calendarId, event.uid, event.recurrenceId),
                )
            }
            ensureActive()
            if (result.isSuccess) refresh()
            if (_calendar.value.request != request) return@launch
            if (result.isSuccess) loadCalendar(request)
            else _calendar.value = _calendar.value.copy(failed = true)
        }
    }

    fun open(task: Task) {
        val sessionAccount = activeAccount ?: return
        openNotificationJob?.cancel()
        openNotificationJob = null
        openTaskJob?.cancel()
        clearTaskDetail()
        _openTask.value = task
        val repository = container.repository(sessionAccount)
        openTaskJob = sessionScope.launch {
            launch {
                var hasLocalTask = false
                repository.observeTask(task.id).collect { local ->
                    if (!isOpen(sessionAccount, task.id)) return@collect
                    if (local != null) {
                        hasLocalTask = true
                        _openTask.value = local
                    } else if (hasLocalTask) closeTask()
                }
            }
            launch {
                repository.taskLists(task.id).collect { lists ->
                    if (isOpen(sessionAccount, task.id)) _openTaskLists.value = lists
                }
            }
            launch {
                repository.commentsByTask(task.id).collect { comments ->
                    if (isOpen(sessionAccount, task.id)) _openComments.value = comments
                }
            }
            launch { runCatching { repository.refreshTask(task.id) } }
            launch { runCatching { repository.refreshTaskLists(task.id) } }
            launch { runCatching { repository.refreshComments(task.id) } }
            launch { reloadActivity(sessionAccount, task.id) }
            launch { reloadShares(sessionAccount, task.id) }
            launch { reloadAttachments(sessionAccount, task.id) }
        }
    }

    private fun isOpen(account: ActiveAccount, taskId: String): Boolean =
        activeAccount == account && _openTask.value?.id == taskId

    private suspend fun reloadShares(account: ActiveAccount, taskId: String) {
        runCatching { container.api(account).shares() }
            .onSuccess { all ->
                if (isOpen(account, taskId)) _openShares.value = all.filter { it.taskId == taskId }
            }
    }

    private suspend fun reloadAttachments(account: ActiveAccount, taskId: String) {
        runCatching { container.api(account).listTaskAttachments(taskId) }
            .onSuccess { if (isOpen(account, taskId)) _openAttachments.value = it }
    }

    private suspend fun reloadActivity(account: ActiveAccount, taskId: String) {
        runCatching { container.api(account).taskActivity(taskId) }
            .onSuccess { if (isOpen(account, taskId)) _openActivity.value = it }
    }

    private fun clearTaskDetail() {
        _taskSaveError.value = false
        _taskSaving.value = false
        _openTaskLists.value = TaskLists()
        _openComments.value = emptyList()
        _openActivity.value = emptyList()
        _openShares.value = emptyList()
        _openAttachments.value = emptyList()
        _createdShareUrl.value = null
        _attachmentError.value = null
    }

    /** Puja un adjunt a la tasca oberta. POST /tasks/{id}/attachments (octet-stream). */
    fun uploadTaskAttachment(task: Task, filename: String, bytes: ByteArray) {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            runCatching {
                container.api(sessionAccount).uploadTaskAttachment(task.id, filename, bytes)
            }
                .onSuccess {
                    if (isOpen(sessionAccount, task.id)) {
                        _attachmentError.value = null
                        reloadAttachments(sessionAccount, task.id)
                    }
                }
                .onFailure { e ->
                    if (e is CancellationException) throw e
                    if (isOpen(sessionAccount, task.id)) {
                        _attachmentError.value = (e as? FemhoApi.ApiException)?.detail
                            ?: container.appContext.getString(R.string.error_generic)
                    }
                }
        }
    }

    /** El contingut d'un adjunt, per desar-lo i obrir-lo. GET /attachments/{id}/content. */
    fun downloadAttachment(attachmentId: String, onBytes: (ByteArray) -> Unit) {
        val sessionAccount = activeAccount ?: return
        val task = _openTask.value ?: return
        sessionScope.launch {
            runCatching { container.api(sessionAccount).attachmentContent(attachmentId) }
                .onSuccess { if (isOpen(sessionAccount, task.id)) onBytes(it) }
                .onFailure { e ->
                    if (e is CancellationException) throw e
                    if (isOpen(sessionAccount, task.id)) {
                        _attachmentError.value = (e as? FemhoApi.ApiException)?.detail
                            ?: container.appContext.getString(R.string.error_generic)
                    }
                }
        }
    }

    /** Esborra un adjunt. DELETE /attachments/{id}. */
    fun deleteTaskAttachment(task: Task, attachmentId: String) {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            runCatching { container.api(sessionAccount).deleteAttachment(attachmentId) }
                .onSuccess { reloadAttachments(sessionAccount, task.id) }
                .onFailure { if (isOpen(sessionAccount, task.id)) actionFailed(it) }
        }
    }

    /** Crea un enllaç compartit. POST /shares. L'URL surt una sola vegada. */
    fun createTaskShare(
        task: Task,
        permission: String,
        requireName: Boolean,
        password: String?,
        expiresAt: String?,
        maxViews: String?,
    ) {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            runCatching {
                container.api(sessionAccount).createShare(
                    taskId = task.id,
                    permission = permission,
                    requireName = requireName,
                    password = password,
                    expiresAt = expiresAt,
                    maxViews = maxViews?.toIntOrNull(),
                )
            }.onSuccess { result ->
                if (isOpen(sessionAccount, task.id)) {
                    _createdShareUrl.value = result.url
                    reloadShares(sessionAccount, task.id)
                }
            }.onFailure { if (isOpen(sessionAccount, task.id)) actionFailed(it) }
        }
    }

    /** Revoca un enllaç compartit. DELETE /shares/{id}. */
    fun revokeTaskShare(shareId: String) {
        val sessionAccount = activeAccount ?: return
        val task = _openTask.value ?: return
        sessionScope.launch {
            runCatching { container.api(sessionAccount).revokeShare(shareId) }
                .onSuccess { reloadShares(sessionAccount, task.id) }
                .onFailure { if (isOpen(sessionAccount, task.id)) actionFailed(it) }
        }
    }

    /**
     * Obre una tasca per identificador, que és tot el que un widget en sap.
     *
     * **Pot arribar abans que les tasques.** El sistema obre l'activitat de seguida i la
     * base local es llegeix en un flux; si en aquest moment `_tasks` encara és buida,
     * l'identificador es guarda i s'obre quan arribi. Sense això, tocar una tasca al
     * widget amb l'app tancada obriria el tauler i prou, i semblaria que el widget no
     * funciona quan el que passa és que ha anat massa de pressa.
     */
    fun openById(id: String) {
        pendingOpen = id
        resolvePendingOpen()
    }

    /** Una notificació pot obrir una tasca fora del filtre actiu i ha de revalidar-ne l'accés. */
    fun openNotificationTask(id: String, accountKey: String) {
        val account = activeAccount?.takeIf { it.identity.key == accountKey } ?: return
        openNotificationJob?.cancel()
        openNotificationJob = sessionScope.launch {
            try {
                val task = container.api(account).getTask(id)
                ensureActive()
                openNotificationJob = null
                open(task)
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                _actionError.value = R.string.notify_activity_taskunavailable
            }
        }
    }

    private var pendingOpen: String? = null

    private fun resolvePendingOpen() {
        val id = pendingOpen ?: return
        val task = _tasks.value.firstOrNull { it.id == id } ?: return
        pendingOpen = null
        open(task)
    }

    /** L'afegida ràpida demanada des de fora, amb el text que hi hagi de sortir escrit. */
    private val _quickAddDraft = MutableStateFlow<String?>(null)
    val quickAddDraft: StateFlow<String?> = _quickAddDraft.asStateFlow()
    private val _quickAddTexts = MutableStateFlow<Map<TaskStatus, String>>(emptyMap())
    val quickAddTexts = _quickAddTexts.asStateFlow()
    private val _quickAddSaving = MutableStateFlow<Set<TaskStatus>>(emptySet())
    val quickAddSaving = _quickAddSaving.asStateFlow()

    fun requestQuickAdd(draft: String) {
        _quickAddDraft.value = draft
        if (draft.isNotBlank()) setQuickAddText(TaskStatus.INBOX, draft)
    }

    fun setQuickAddText(status: TaskStatus, value: String) {
        _quickAddTexts.value = _quickAddTexts.value + (status to value)
    }

    fun quickAddConsumed() {
        _quickAddDraft.value = null
    }

    fun closeTask() {
        openTaskJob?.cancel()
        openTaskJob = null
        _openTask.value = null
        clearTaskDetail()
    }

    fun rename(task: Task, title: String) {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            localChange(sessionAccount) { editTask(task.id, mapOf("title" to title)) }
        }
    }

    fun toggleItem(itemId: String, done: Boolean) {
        val sessionAccount = activeAccount ?: return
        val task = _openTask.value ?: return
        sessionScope.launch {
            localChange(sessionAccount) { setChecklistItem(task.id, itemId, done) }
        }
    }

    fun setAiMode(task: Task, mode: AiMode) {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            localChange(sessionAccount) { editTask(task.id, emptyMap(), mode) }
        }
    }

    private val _taskSaveError = MutableStateFlow(false)
    val taskSaveError: StateFlow<Boolean> = _taskSaveError.asStateFlow()
    private val _taskSaving = MutableStateFlow(false)
    val taskSaving: StateFlow<Boolean> = _taskSaving.asStateFlow()

    fun saveTaskDetails(task: Task, fields: Map<String, String?>, mode: AiMode?) {
        val sessionAccount = activeAccount ?: return
        if (_taskSaving.value) return
        _taskSaving.value = true
        _taskSaveError.value = false
        sessionScope.launch {
            try {
                val saved = localChange(sessionAccount, showError = false) {
                    editTask(task.id, fields, mode)
                }
                if (isOpen(sessionAccount, task.id)) {
                    if (saved) closeTask() else _taskSaveError.value = true
                }
            } finally {
                if (isOpen(sessionAccount, task.id)) _taskSaving.value = false
            }
        }
    }

    private fun actionFailed(error: Throwable? = null) {
        if (error is CancellationException) throw error
        _actionError.value = R.string.error_generic
    }

    private suspend fun localChange(
        account: ActiveAccount,
        showError: Boolean = true,
        change: suspend Repository.() -> Unit,
    ): Boolean {
        try {
            container.repository(account).change()
        } catch (error: Exception) {
            if (error is CancellationException) throw error
            if (showError && activeAccount == account) actionFailed(error)
            return false
        }
        Notifications.requestSync(container.appContext, account)
        sessionScope.launch { ho.fem.app.widget.FemhoWidgets.updateAll(container.appContext) }
        return true
    }

    /**
     * L'idioma del perfil mana per damunt del dispositiu.
     *
     * Android ja tria `values-en` o `values-es` sol segons la configuració del telèfon, i
     * això és el "automàtic" que es vol. Però si algú ha triat l'idioma a la web, ha de
     * valer també aquí: és el que fa que canviar-lo al portàtil el canviï al telèfon.
     *
     * **Només a partir d'Android 13.** L'API per idioma d'app no existeix abans, i
     * inventar-se un embolcall de context per a un cas de vuit anys enrere seria molt
     * codi per molt poca gent. Per sota, mana el dispositiu i prou.
     */
    fun applyProfileLocale(locale: String) {
        if (android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.TIRAMISU) return
        val manager = container.appContext.getSystemService(android.app.LocaleManager::class.java)
            ?: return
        val current = manager.applicationLocales
        if (!current.isEmpty && current[0]?.language == locale) return
        manager.applicationLocales = android.os.LocaleList.forLanguageTags(locale)
    }

    fun setTheme(value: String) {
        _theme.value = value
        sessionScope.launch { container.settings.setTheme(value) }
    }

    fun setAccent(value: String) {
        _accent.value = value
        sessionScope.launch { container.settings.setAccent(value) }
    }

    fun setLocale(value: String) {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            runCatching { container.api(sessionAccount).updateProfile(locale = value) }
                .onSuccess { showAccountProfile(sessionAccount, it) }
                .onFailure(::actionFailed)
        }
    }

    fun setWeekStart(value: String) {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            container.settings.setWeekStart(value)
            runCatching { container.api(sessionAccount).updateSettings(weekStart = value) }
        }
    }

    fun setEventTaskDeleted(value: String) {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            container.settings.setEventTaskDeleted(value)
            runCatching { container.api(sessionAccount).updateSettings(eventTaskDeleted = value) }
        }
    }

    fun setShowCalendarWidget(value: Boolean) {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            container.settings.setShowCalendarWidget(value)
            runCatching { container.api(sessionAccount).updateSettings(showCalendarWidget = value) }
        }
    }

    fun setShowOverdueSection(value: Boolean) {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            container.settings.setShowOverdueSection(value)
            runCatching { container.api(sessionAccount).updateSettings(showOverdueSection = value) }
        }
    }

    fun setInboxPosition(value: String) {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            container.settings.setInboxPosition(value)
            runCatching { container.api(sessionAccount).updateSettings(inboxPosition = value) }
        }
    }

    fun setInboxShowOverdue(value: Boolean) {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            container.settings.setInboxShowOverdue(value)
            runCatching { container.api(sessionAccount).updateSettings(inboxShowOverdue = value) }
        }
    }

    /** El perfil i les preferències de «Fet» es refresquen amb la mateixa lectura. */
    fun loadProfile() {
        val sessionAccount = activeAccount ?: return
        if (profileLoadJob?.isActive == true) return
        profileLoadJob = sessionScope.launch {
            runCatching { container.refreshUserSettings(sessionAccount).profile }
                .onSuccess { if (it != null) showAccountProfile(sessionAccount, it) }
                .onFailure { if (it is CancellationException) throw it }
        }
    }

    fun setDoneClearedAt(value: String?) {
        val sessionAccount = activeAccount ?: return
        if (_doneSettingsSaving.value) return
        _doneSettingsSaving.value = true
        sessionScope.launch {
            try {
                container.setDoneClearedAt(sessionAccount, value)
            } catch (error: Exception) {
                actionFailed(error)
            } finally {
                if (activeAccount == sessionAccount) _doneSettingsSaving.value = false
            }
        }
    }

    fun refreshPomodoro() {
        val account = activeAccount ?: return
        if (pomodoroLoadJob?.isActive == true) return
        pomodoroLoadJob = sessionScope.launch {
            try {
                container.repository(account).refreshPomodoro()
            } catch (error: Exception) {
                if (error is CancellationException) throw error
            }
        }
    }

    fun refreshCalendarSuggestions() {
        val account = activeAccount ?: return
        if (calendarSuggestionsLoadJob?.isActive == true) return
        calendarSuggestionsLoadJob = sessionScope.launch {
            try {
                container.repository(account).refreshCalendarSuggestions()
            } catch (error: Exception) {
                if (error is CancellationException) throw error
            }
        }
    }

    fun setCalendarSuggestionsEnabled(enabled: Boolean) = submitCalendarSuggestion {
        configureCalendarSuggestions(enabled)
        true
    }

    fun setDoingAutoStop(minutes: Int?) {
        val account = activeAccount ?: return
        sessionScope.launch { localChange(account) { this.setDoingAutoStop(minutes) } }
    }

    /** A l'arrencada, l'intent del widget pot arribar abans del primer valor del flux. */
    suspend fun resolveWidgetCalendarSuggestion(target: CalendarSuggestionTarget): CalendarTaskSuggestion? {
        val account = activeAccount?.takeIf { it.identity.key == target.accountKey } ?: return null
        val repository = container.repository(account)
        val suggestion = repository.calendarSuggestions.first().snapshot.visibleItems(Instant.now()).find(target::matches)
            ?: return null
        val selected = container.settings.activeScopes(account)
        if (selected.isNotEmpty() && suggestion.scopeId !in selected) return null
        if (repository.scopes.first().none { it.id == suggestion.scopeId }) return null
        if (suggestion.taskId != null && repository.tasks.first().any {
                it.id == suggestion.taskId && it.status != TaskStatus.INBOX && it.status != TaskStatus.TODO
            }) return null
        return suggestion.takeIf { activeAccount == account }
    }

    fun actOnCalendarSuggestion(
        suggestion: CalendarTaskSuggestion,
        start: CalendarTaskStart?,
        confirmShare: Boolean = false,
        taskTypeId: String? = null,
    ) {
        val actionAt = Instant.now()
        submitCalendarSuggestion { actOnCalendarSuggestion(suggestion, actionAt, start, confirmShare, taskTypeId) }
    }

    private fun submitCalendarSuggestion(command: suspend Repository.() -> Boolean) {
        val account = activeAccount ?: return
        sessionScope.launch {
            try {
                if (container.repository(account).command()) {
                    Notifications.requestSync(container.appContext, account)
                    refreshCalendarSuggestions()
                } else if (activeAccount == account) _actionError.value = R.string.calendarsuggestions_saveerror
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                if (activeAccount == account) _actionError.value = R.string.calendarsuggestions_saveerror
            }
        }
    }

    fun updatePomodoroSettings(patch: JsonObject) = submitPomodoro { _, _, _ ->
        buildJsonObject {
            put("kind", "settings")
            put("patch", patch)
        }
    }

    fun setPomodoroEnabled(enabled: Boolean) = updatePomodoroSettings(buildJsonObject { put("enabled", enabled) })

    fun updatePomodoroQueue(update: (List<String>) -> List<String>) = submitPomodoro { state, _, _ ->
        buildJsonObject {
            put("kind", "queue")
            put("expected_version", state.queueVersion)
            putJsonArray("task_ids") { update(state.queue).distinct().forEach { add(it) } }
        }
    }

    fun startPomodoro(taskId: String?) = submitPomodoro { state, now, device ->
        val timer = state.timer?.let { projectPomodoroTimer(it, now) }
        if (timer == null) buildJsonObject {
            put("kind", "start")
            put("timer_id", UUID.randomUUID().toString())
            put("at_ms", now)
            put("device_id", device)
            put("task_id", taskId)
        } else if (timer.status != PomodoroStatus.RUNNING) {
            val chooseTask = timer.phase == PomodoroPhase.FOCUS && timer.status == PomodoroStatus.READY
            pomodoroControl(timer, PomodoroAction.RESUME, now, device, chooseTask, taskId)
        } else null
    }

    fun controlPomodoro(action: PomodoroAction) = submitPomodoro { state, now, device ->
        projectPomodoroTimer(state.timer, now)?.let { pomodoroControl(it, action, now, device) }
    }

    private fun pomodoroControl(
        timer: PomodoroTimer, action: PomodoroAction, now: Long, device: String,
        chooseTask: Boolean = false, taskId: String? = null,
    ): JsonObject = buildJsonObject {
        put("kind", "control")
        put("action", action.wire)
        put("timer_id", timer.id)
        put("expected_version", timer.version)
        put("phase_number", timer.phaseNumber)
        put("at_ms", now)
        put("device_id", device)
        if (chooseTask) put("task_id", taskId)
    }

    private fun submitPomodoro(command: (PomodoroSnapshot, Long, String) -> JsonObject?) {
        val account = activeAccount ?: return
        sessionScope.launch {
            try {
                val device = container.settings.pomodoroDeviceId(account)
                val saved = container.repository(account).enqueuePomodoro { state, at -> command(state, at, device) }
                if (saved) {
                    Notifications.requestSync(container.appContext, account)
                    refreshPomodoro()
                } else if (activeAccount == account) _actionError.value = R.string.pomodoro_taskunavailable
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                if (activeAccount == account) _actionError.value = R.string.pomodoro_saveerror
            }
        }
    }

    private suspend fun showAccountProfile(account: ActiveAccount, profile: UserProfile) {
        if (activeAccount != account) return
        _profile.value = profile
        _profileTimezone.value = profile.timezone
        container.settings.cacheProfilePresentation(account, profile.locale, profile.timezone)
        container.settings.setLocale(profile.locale)
        applyProfileLocale(profile.locale)
    }

    /**
     * Actualitza el nom de l'usuari.
     *
     * **Es desa en perdre el focus** (onBlur), no a cada tecla: el mateix criteri que
     * la web, que fa el PATCH quan surt del camp.
     */
    fun setName(name: String) {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            runCatching { container.api(sessionAccount).updateProfile(name = name) }
                .onSuccess { _profile.value = it }
        }
    }

    /**
     * Activa o desactiva Gravatar per a la foto de perfil.
     *
     * PATCH /api/v1/auth/settings {gravatar}. El valor es guarda localment i es
     * sincronitza amb el servidor.
     */
    fun setGravatar(enabled: Boolean) {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            runCatching { container.api(sessionAccount).updateSettings(gravatar = enabled) }
                .onSuccess { _gravatarEnabled.value = enabled }
        }
    }

    /**
     * Canvia la contrasenya de l'usuari.
     *
     * POST /api/v1/auth/password {current_password, new_password}. La validació
     * de longitud mínima (10 caràcters) la fa la UI abans de cridar aquest mètode.
     *
     * @param current la contrasenya actual
     * @param new la contrasenya nova
     * @param onError callback amb el missatge d'error si falla
     * @param onSuccess callback si ha anat bé
     */
    fun changePassword(current: String, new: String, onError: (String) -> Unit, onSuccess: () -> Unit) {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            runCatching { container.api(sessionAccount).changePassword(current, new) }
                .onSuccess { onSuccess() }
                .onFailure { error ->
                    onError((error as? FemhoApi.ApiException)?.detail.orEmpty())
                }
        }
    }

    private fun tokenAction(action: suspend (FemhoApi) -> Unit) {
        val sessionAccount = activeAccount ?: return
        if (_tokenBusy.value) return
        _tokenBusy.value = true
        _tokenError.value = false
        sessionScope.launch {
            try {
                action(container.api(sessionAccount))
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                if (activeAccount == sessionAccount) _tokenError.value = true
            } finally {
                if (activeAccount == sessionAccount) _tokenBusy.value = false
            }
        }
    }

    fun loadTokens() = tokenAction { api ->
        val tokens = api.apiTokens()
        val access = api.externalAccess()
        kotlinx.coroutines.currentCoroutineContext().ensureActive()
        _tokens.value = tokens
        _externalAccess.value = access
    }

    fun setExternalAccess(channel: String, enabled: Boolean) = tokenAction { api ->
        val access = api.setExternalAccess(channel, enabled)
        kotlinx.coroutines.currentCoroutineContext().ensureActive()
        _externalAccess.value = access.copy(mcpUrl = _externalAccess.value?.mcpUrl.orEmpty())
    }

    fun createToken(name: String, capabilities: List<String>, scopeIds: List<String>, channels: List<String>, onDone: () -> Unit) = tokenAction { api ->
        val created = api.createApiToken(name, capabilities, scopeIds, channels)
        kotlinx.coroutines.currentCoroutineContext().ensureActive()
        _createdToken.value = created.token
        _tokens.value = listOf(created.summary) + _tokens.value
        onDone()
    }

    fun editToken(id: String, name: String?, capabilities: List<String>, scopeIds: List<String>, channels: List<String>?, onDone: () -> Unit) = tokenAction { api ->
        val updated = api.updateApiToken(id, name, capabilities, scopeIds, channels)
        kotlinx.coroutines.currentCoroutineContext().ensureActive()
        _tokens.value = _tokens.value.map { if (it.id == updated.id) updated else it }
        onDone()
    }

    fun revokeToken(id: String, onDone: () -> Unit) = tokenAction { api ->
        api.revokeApiToken(id)
        kotlinx.coroutines.currentCoroutineContext().ensureActive()
        val now = java.time.Instant.now().toString()
        _tokens.value = _tokens.value.map { if (it.id == id) it.copy(revokedAt = now) else it }
        onDone()
    }

    fun hideCreatedToken() { _createdToken.value = null }

    /** Carrega els calendaris per a Ajustos ▸ Calendaris. GET /api/v1/calendars. */
    fun loadCalendars() {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            runCatching { container.api(sessionAccount).calendars() }
                .onSuccess { _calendars.value = it }
        }
    }

    /** Crea una font de calendari (CalDAV, iCal o RSS). POST /api/v1/calendars. */
    fun createCalendar(
        scopeId: String,
        name: String,
        origin: String,
        sourceKind: String? = null,
        sourceUrl: String? = null,
        sourceUsername: String? = null,
        sourceSecret: String? = null,
        inboxVisible: Boolean? = null,
    ) {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            runCatching {
                container.api(sessionAccount).createCalendar(
                    scopeId = scopeId,
                    name = name,
                    origin = origin,
                    sourceKind = sourceKind,
                    sourceUrl = sourceUrl,
                    sourceUsername = sourceUsername,
                    sourceSecret = sourceSecret,
                    inboxVisible = inboxVisible,
                )
            }.onSuccess { loadCalendars() }
        }
    }

    /** Actualitza un calendari. PATCH /api/v1/calendars/{id}. */
    fun updateCalendar(
        id: String,
        name: String? = null,
        sourceUrl: String? = null,
        sourceUsername: String? = null,
        sourceSecret: String? = null,
        refreshInterval: Int? = null,
        inboxVisible: Boolean? = null,
    ) {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            runCatching {
                container.api(sessionAccount).updateCalendar(
                    id,
                    name = name,
                    sourceUrl = sourceUrl,
                    sourceUsername = sourceUsername,
                    sourceSecret = sourceSecret,
                    refreshInterval = refreshInterval,
                    inboxVisible = inboxVisible,
                )
            }.onSuccess { loadCalendars() }
        }
    }

    /** Esborra un calendari. DELETE /api/v1/calendars/{id}. */
    fun deleteCalendar(id: String) {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            runCatching { container.api(sessionAccount).deleteCalendar(id) }
                .onSuccess { loadCalendars() }
        }
    }

    /** Carrega comptes i regles de correu per a Ajustos ▸ Correu. */
    fun googleMailApi(): FemhoApi = container.api(checkNotNull(activeAccount))

    private fun googleMailKey(): String? {
        val account = activeAccount ?: return null
        return "${account.identity.serverUrl}|${account.identity.userId}"
    }
    fun pendingGoogleMail(): String? = googleMailKey()?.let {
        container.appContext.getSharedPreferences("mail_oauth", android.content.Context.MODE_PRIVATE).getString(it, null)
    }
    fun savePendingGoogleMail(id: String?) {
        val key = googleMailKey() ?: return
        val editor = container.appContext.getSharedPreferences("mail_oauth", android.content.Context.MODE_PRIVATE).edit()
        if (id == null) editor.remove(key) else editor.putString(key, id)
        editor.apply()
    }

    fun loadMailData() {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            runCatching { container.api(sessionAccount).mailAccounts() }
                .onSuccess { _mailAccounts.value = it }
            runCatching { container.api(sessionAccount).mailRules() }
                .onSuccess { _mailRules.value = it }
        }
    }

    /** Crea un compte IMAP. POST /api/v1/mail/accounts. */
    fun createMailAccount(name: String, host: String, username: String, password: String, security: String) {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            runCatching { container.api(sessionAccount).createMailAccount(name, host, username, password, security) }
                .onSuccess { loadMailData() }
        }
    }

    /** Actualitza un compte IMAP. PATCH /api/v1/mail/accounts/{id}. */
    fun updateMailAccount(id: String, name: String? = null, host: String? = null, username: String? = null, password: String? = null, security: String? = null) {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            runCatching { container.api(sessionAccount).updateMailAccount(id, name, host, username, password, security) }
                .onSuccess { loadMailData() }
        }
    }

    /** Esborra un compte IMAP. DELETE /api/v1/mail/accounts/{id}. */
    fun deleteMailAccount(id: String) {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            runCatching { container.api(sessionAccount).deleteMailAccount(id) }
                .onSuccess { loadMailData() }
        }
    }

    /** Prova la connexió d'un compte. POST /api/v1/mail/accounts/{id}/test — no desa res. */
    fun testMailAccount(id: String, onResult: (ho.fem.model.MailTestResult) -> Unit) {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            runCatching { container.api(sessionAccount).testMailAccount(id) }
                .onSuccess { onResult(it) }
                .onFailure { onResult(ho.fem.model.MailTestResult(ok = false, error = it.message)) }
        }
    }

    /** Crea una regla (mapa de carpeta). POST /api/v1/mail/rules. */
    fun createMailRule(accountId: String, folder: String, scopeId: String? = null, titleTemplate: String? = null) {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            runCatching { container.api(sessionAccount).createMailRule(accountId, folder, scopeId = scopeId, titleTemplate = titleTemplate) }
                .onSuccess { loadMailData() }
        }
    }

    /** Esborra una regla. DELETE /api/v1/mail/rules/{id}. */
    fun deleteMailRule(id: String) {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            runCatching { container.api(sessionAccount).deleteMailRule(id) }
                .onSuccess { loadMailData() }
        }
    }

    /**
     * Copia un text al porta-retalls.
     *
     * @param text el text a copiar
     */
    fun copyToClipboard(text: String) = copyToClipboard(text, sensitive = false)

    private fun copyToClipboard(text: String, sensitive: Boolean) {
        val clipboard = container.appContext.getSystemService(android.content.ClipboardManager::class.java)
        val clip = android.content.ClipData.newPlainText("Fem-ho", text)
        if (sensitive) {
            clip.description.extras = android.os.PersistableBundle().apply {
                putBoolean("android.content.extra.IS_SENSITIVE", true)
            }
        }
        clipboard.setPrimaryClip(clip)
    }

    /** La resposta d'un compte anterior no pot modificar la pantalla ni el porta-retalls. */
    private suspend fun <T> withAiAccount(block: suspend (ActiveAccount) -> T): T {
        val account = activeAccount ?: throw CancellationException()
        val result = block(account)
        currentCoroutineContext().ensureActive()
        if (activeAccount != account) throw CancellationException()
        return result
    }

    suspend fun loadAiTaskSettings() = aiTaskSettingsMutex.withLock {
        _aiTaskSettings.value = withAiAccount { container.api(it).aiTaskSettings() }
    }

    suspend fun aiTaskConnections(scopeId: String): AiTaskConnections = withAiAccount {
        container.api(it).aiTaskConnections(scopeId)
    }

    suspend fun saveAiTaskSettings(
        settings: AiTaskSettings,
        previous: AiTaskSettings,
        routineToken: String?,
        removeRoutineToken: Boolean,
    ) {
        aiTaskSettingsMutex.withLock {
            _aiTaskSettings.value = withAiAccount { account ->
                val api = container.api(account)
                api.saveAiTaskSettings(settings, previous, routineToken, removeRoutineToken)
                api.aiTaskSettings()
            }
        }
    }

    suspend fun aiTaskContext(taskId: String): String = withAiAccount {
        container.api(it).aiTaskContext(taskId)
    }

    fun copyAiContextToClipboard(text: String) = copyToClipboard(text, sensitive = true)

    suspend fun aiExecutions(taskId: String): List<AiExecution> {
        val executions = withAiAccount { container.api(it).aiExecutions(taskId) }
        val requestId = aiExecutionRequests[taskId]
        if (executions.any { it.id == requestId }) aiExecutionRequests.remove(taskId)
        return executions
    }

    suspend fun requestAiExecution(taskId: String): AiExecution? {
        val account = activeAccount ?: return null
        if (taskId in _aiExecutingTasks.value) return null
        _aiExecutingTasks.value += taskId
        try {
            // Si s'ha perdut la resposta, el tauler i la fitxa reintenten la mateixa petició.
            val id = aiExecutionRequests.getOrPut(taskId, ::newExecutionId)
            val execution = withAiAccount { container.api(it).sendTaskToAi(taskId, id) }
            aiExecutionRequests.remove(taskId)
            return execution
        } finally {
            if (activeAccount == account) _aiExecutingTasks.value -= taskId
        }
    }

    fun refreshAiExecutionResult(taskId: String) {
        val account = activeAccount ?: return
        if (!isOpen(account, taskId)) return
        sessionScope.launch {
            launch { reloadActivity(account, taskId) }
            launch { runCatching { container.repository(account).refreshComments(taskId) } }
        }
    }

    /**
     * Crea un àmbit nou.
     *
     * POST /api/v1/scopes {id, name, color, kind}. L'identificador el genera el client
     * (D4), igual que a la creació de tasques: així un reintent no duplica res.
     */
    fun createScope(name: String, color: String, kind: String) {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            runCatching { container.api(sessionAccount).createScope(name, color, kind) }
                .onSuccess { refresh() }
        }
    }

    /**
     * Actualitza un àmbit.
     *
     * PATCH /api/v1/scopes/{id} {name, color, kind}. El canvi de tipus només es permet
     * si l'àmbit és buit (el servidor ho valida).
     */
    fun updateScope(id: String, name: String, color: String, kind: String) {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            runCatching { container.api(sessionAccount).updateScope(id, name, color) }
                .onSuccess { refresh() }
        }
    }

    /**
     * Esborra un àmbit.
     *
     * DELETE /api/v1/scopes/{id}. Només funciona si l'àmbit és buit (el servidor ho
     * valida i retorna un error si té tasques, projectes o membres).
     */
    fun deleteScope(id: String) {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            runCatching { container.api(sessionAccount).deleteScope(id) }
                .onSuccess { refresh() }
        }
    }

    /**
     * Carrega etiquetes, tipologies i configuracions d'àmbit per a Ajustos ▸ Àmbits.
     *
     * GET /api/v1/labels, /api/v1/task-types i /api/v1/scopes/{id}/settings per àmbit.
     * Es crida en obrir la pestanya Àmbits.
     */
    fun loadEntityData() {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            val repository = container.repository(sessionAccount)
            runCatching { container.api(sessionAccount).labels() }
                .onSuccess { _labels.value = it }
            runCatching { repository.refreshTaskTypes() }
            val available = runCatching { container.api(sessionAccount).scopes() }.getOrDefault(scopes.value)
            _scopeSettings.value = _scopeSettings.value.filterKeys { id -> available.any { it.id == id } }
            available.forEach { scope ->
                runCatching { repository.refreshScopeSettings(scope.id) }
                    .onSuccess { settings ->
                        _scopeSettings.value = _scopeSettings.value + (scope.id to settings)
                    }
            }
        }
    }

    /** Crea un projecte dins d'un àmbit. POST /api/v1/projects. */
    fun createProject(scopeId: String, name: String) {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            runCatching { container.api(sessionAccount).createProject(scopeId, name) }
                .onSuccess { loadEntityData() }
        }
    }

    /** Esborra un projecte. DELETE /api/v1/projects/{id}. */
    fun deleteProject(id: String) {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            runCatching { container.api(sessionAccount).deleteProject(id) }
                .onSuccess { loadEntityData() }
        }
    }

    /** Crea una etiqueta dins d'un àmbit. POST /api/v1/labels. */
    fun createLabel(scopeId: String, name: String) {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            runCatching { container.api(sessionAccount).createLabel(scopeId, name) }
                .onSuccess { loadEntityData() }
        }
    }

    /** Esborra una etiqueta. DELETE /api/v1/labels/{id}. */
    fun deleteLabel(id: String) {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            runCatching { container.api(sessionAccount).deleteLabel(id) }
                .onSuccess { loadEntityData() }
        }
    }

    /** Assigna una persona a una tasca. POST /api/v1/tasks/{id}/assignees/{userId}. */
    fun addAssignee(task: Task, userId: String) {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            runCatching { container.api(sessionAccount).addAssignee(task.id, userId) }
                .onSuccess { refreshTask(task) }
                .onFailure(::actionFailed)
        }
    }

    /** Treu una persona d'una tasca. DELETE /api/v1/tasks/{id}/assignees/{userId}. */
    fun removeAssignee(task: Task, userId: String) {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            runCatching { container.api(sessionAccount).removeAssignee(task.id, userId) }
                .onSuccess { refreshTask(task) }
                .onFailure(::actionFailed)
        }
    }

    /** La tipologia es desa amb la resta de camps editables. */
    fun setTaskType(task: Task, taskTypeId: String?) {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            localChange(sessionAccount) { editTask(task.id, mapOf("task_type_id" to taskTypeId)) }
        }
    }

    /** Posa una etiqueta a una tasca. POST /api/v1/tasks/{id}/labels/{labelId}. */
    fun addTaskLabel(task: Task, labelId: String) {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            runCatching { container.api(sessionAccount).addTaskLabel(task.id, labelId) }
                .onSuccess { refreshTask(task) }
                .onFailure(::actionFailed)
        }
    }

    /** Treu una etiqueta d'una tasca. DELETE /api/v1/tasks/{id}/labels/{labelId}. */
    fun removeTaskLabel(task: Task, labelId: String) {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            runCatching { container.api(sessionAccount).removeTaskLabel(task.id, labelId) }
                .onSuccess { refreshTask(task) }
                .onFailure(::actionFailed)
        }
    }

    /** Crea una etiqueta nova i la posa a la tasca que la demana. POST /api/v1/labels. */
    fun createTaskLabel(task: Task, name: String) {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            runCatching { container.api(sessionAccount).createLabel(task.scopeId, name) }
                .onSuccess { label ->
                    loadEntityData()
                    runCatching { container.api(sessionAccount).addTaskLabel(task.id, label.id) }
                        .onSuccess { refreshTask(task) }
                        .onFailure(::actionFailed)
                }
                .onFailure(::actionFailed)
        }
    }

    private fun refreshTask(task: Task) {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            runCatching { container.repository(sessionAccount).refreshTask(task.id) }
                .onFailure(::actionFailed)
        }
    }

    fun addComment(taskId: String, body: String, onPersisted: (Boolean) -> Unit) {
        val sessionAccount = activeAccount ?: return onPersisted(false)
        sessionScope.launch {
            val saved = localChange(sessionAccount, showError = false) { addComment(taskId, body) }
            if (isOpen(sessionAccount, taskId)) onPersisted(saved)
        }
    }

    /** Carrega l'historial d'activitat de la tasca oberta. */
    fun loadActivity(taskId: String) {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch { reloadActivity(sessionAccount, taskId) }
    }

    /** Desfà un canvi autònom de la IA. POST /api/v1/activity/{id}/undo. */
    fun undoActivity(entryId: String) {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            runCatching { container.api(sessionAccount).undoActivity(entryId) }
                .onSuccess {
                    _openTask.value?.let { task ->
                        loadActivity(task.id)
                        refreshTask(task)
                    }
                }
        }
    }

    fun createTaskType(scopeId: String, name: String) {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            runCatching { container.api(sessionAccount).createTaskType(scopeId, name) }
                .onSuccess { loadEntityData() }
        }
    }

    /** Actualitza una tipologia. PATCH /api/v1/task-types/{id}. */
    fun updateTaskType(id: String, name: String? = null, required: Boolean? = null) {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            runCatching { container.api(sessionAccount).updateTaskType(id, name = name, required = required) }
                .onSuccess { loadEntityData() }
        }
    }

    /** Esborra una tipologia. DELETE /api/v1/task-types/{id}. */
    fun deleteTaskType(id: String) {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            runCatching { container.api(sessionAccount).deleteTaskType(id) }
                .onSuccess { loadEntityData() }
        }
    }

    /** Desa la configuració de dedicació d'un àmbit. PATCH /api/v1/scopes/{id}/settings. */
    fun updateScopeSettings(
        scopeId: String,
        timeTracking: Boolean? = null,
        workStart: String? = null,
        workEnd: String? = null,
        overtimeVisible: Boolean? = null,
        longSessionHours: Int? = null,
        projectNoun: String? = null,
        taskTypesEnabled: Boolean? = null,
    ) {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            runCatching {
                container.api(sessionAccount).updateScopeSettings(
                    scopeId,
                    timeTracking = timeTracking,
                    workStart = workStart,
                    workEnd = workEnd,
                    overtimeVisible = overtimeVisible,
                    longSessionHours = longSessionHours,
                    projectNoun = projectNoun,
                    taskTypesEnabled = taskTypesEnabled,
                )
            }.onSuccess { settings ->
                _scopeSettings.value = _scopeSettings.value + (scopeId to settings)
            }
        }
    }

    fun move(task: Task, status: TaskStatus) {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            // El veí és l'última targeta de la columna de destí: la posició es calcula
            // al client (D3) i el servidor l'accepta tal com ve.
            val last = _tasks.value.filter { it.scopeId == task.scopeId && it.status == status && it.id != task.id }
                .maxByOrNull { it.position }?.position
            localChange(sessionAccount) { moveTask(task, status, last to null) }
        }
    }

    /** El pany d'agent: l'usuari se l'emporta al seu tauler. POST /tasks/{id}/take-over. */
    fun takeOver(task: Task, status: String) {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            runCatching { container.api(sessionAccount).takeOverTask(task.id, status) }
                .onSuccess { updated ->
                    if (isOpen(sessionAccount, task.id)) _openTask.value = updated
                    refresh()
                    refreshTask(task)
                }
                .onFailure(::actionFailed)
        }
    }

    /**
     * Reclamar des del kanban de la IA. **És el mateix gest que arrossegar la targeta de
     * tornada a la web**: `ai-mode` a `manual`, no la reserva `claim` de l'agent, que la
     * bloquejaria per a l'usuari en comptes de tornar-li-la.
     */
    fun claim(task: Task) {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            localChange(sessionAccount) { editTask(task.id, emptyMap(), AiMode.MANUAL) }
        }
    }

    fun deleteTask(task: Task) {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            if (localChange(sessionAccount) { deleteTask(task.id) } && isOpen(sessionAccount, task.id)) {
                closeTask()
            }
        }
    }

    // -------------------------------------------------------- el tauler de la IA

    private val _aiEnabled = MutableStateFlow(false)
    val aiEnabled: StateFlow<Boolean> = _aiEnabled.asStateFlow()

    private val _aiBoard = MutableStateFlow(false)
    val aiBoard: StateFlow<Boolean> = _aiBoard.asStateFlow()

    /**
     * **No és una altra pantalla: és el mateix tauler girat.**
     *
     * Les columnes són les mateixes i el que canvia és quines targetes hi surten. La
     * bústia és l'excepció i surt sencera als dos, perquè és on tot arriba abans de
     * decidir-ho.
     */
    fun toggleAiBoard() {
        _aiBoard.value = !_aiBoard.value
    }

    private fun loadAgents() {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            val agents: List<Agent> = runCatching { container.api(sessionAccount).agents() }
                .getOrDefault(emptyList())
            _aiEnabled.value = agents.any { it.enabled }
            // Sense cap agent actiu no hi ha tauler de la IA on ser.
            if (!_aiEnabled.value) _aiBoard.value = false
        }
    }

    // ------------------------------------------------ la gestió d'agents (Ajustos)

    /** Els agents estesos, per a la pestanya Usuari IA. */
    private val _agentsDetail = MutableStateFlow<List<AgentDetail>>(emptyList())
    val agentsDetail: StateFlow<List<AgentDetail>> = _agentsDetail.asStateFlow()

    /** Qui porta cada àmbit, per desactivar els que ja té un altre agent. */
    private val _agentScopeAvailability = MutableStateFlow<Map<String, List<AgentScopeAvailability>>>(emptyMap())
    val agentScopeAvailability: StateFlow<Map<String, List<AgentScopeAvailability>>> =
        _agentScopeAvailability.asStateFlow()

    /** Les credencials de cada agent, per llistar-les i revocar-les. */
    private val _agentCredentials = MutableStateFlow<Map<String, List<ApiTokenSummary>>>(emptyMap())
    val agentCredentials: StateFlow<Map<String, List<ApiTokenSummary>>> =
        _agentCredentials.asStateFlow()

    /** El token acabat de crear: es mostra una sola vegada, i després es descarta. */
    private val _createdAgentToken = MutableStateFlow<String?>(null)
    val createdAgentToken: StateFlow<String?> = _createdAgentToken.asStateFlow()

    fun consumeCreatedAgentToken() {
        _createdAgentToken.value = null
    }

    /** El full d'instruccions de l'agent, per baixar-lo. */
    private val _agentSkill = MutableStateFlow<String?>(null)
    val agentSkill: StateFlow<String?> = _agentSkill.asStateFlow()

    fun loadAgentManagement() {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            runCatching { container.api(sessionAccount).agentDetails() }
                .onSuccess { agents ->
                    _agentsDetail.value = agents
                    agents.forEach { agent ->
                        runCatching { container.api(sessionAccount).agentScopeAvailability(agent.id) }
                            .onSuccess { _agentScopeAvailability.value = _agentScopeAvailability.value + (agent.id to it) }
                        runCatching { container.api(sessionAccount).agentCredentials(agent.id) }
                            .onSuccess { _agentCredentials.value = _agentCredentials.value + (agent.id to it) }
                    }
                }
        }
    }

    /** Crea un agent. POST /api/v1/ai/agents. El servidor genera l'id. */
    fun createAgent(name: String) {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            runCatching { container.api(sessionAccount).createAgent(name) }
                .onSuccess { loadAgentManagement() }
        }
    }

    fun setAgentEnabled(agent: AgentDetail, enabled: Boolean) {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            runCatching { container.api(sessionAccount).updateAgent(agent.id, enabled = enabled) }
                .onSuccess {
                    loadAgentManagement()
                    loadAgents()
                }
        }
    }

    fun setAgentCanCreate(agent: AgentDetail, canCreate: Boolean) {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            runCatching { container.api(sessionAccount).updateAgent(agent.id, canCreateTasks = canCreate) }
                .onSuccess { loadAgentManagement() }
        }
    }

    /** Desa el conjunt sencer d'àmbits, com la web: les caselles tal com han quedat. */
    fun setAgentScopes(agent: AgentDetail, scopeIds: List<String>, allScopes: Boolean) {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            runCatching { container.api(sessionAccount).updateAgentScopes(agent.id, scopeIds, allScopes) }
                .onSuccess {
                    loadAgentManagement()
                    loadAgents()
                }
        }
    }

    /** Crea una credencial: el token surt una sola vegada (del hash no se'n pot treure). */
    fun createAgentCredential(agent: AgentDetail) {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            runCatching { container.api(sessionAccount).createAgentCredential(agent.id) }
                .onSuccess { result ->
                    _createdAgentToken.value = result["token"] as? String
                    loadAgentManagement()
                }
        }
    }

    fun revokeAgentCredential(tokenId: String) {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            runCatching { container.api(sessionAccount).revokeApiToken(tokenId) }
                .onSuccess { loadAgentManagement() }
        }
    }

    fun deleteAgent(agent: AgentDetail) {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            runCatching { container.api(sessionAccount).deleteAgent(agent.id) }
                .onSuccess {
                    loadAgentManagement()
                    loadAgents()
                }
        }
    }

    /** El full d'instruccions, en el teu idioma. text/markdown. */
    fun loadAgentSkill() {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            runCatching { container.api(sessionAccount).agentSkill() }
                .onSuccess { _agentSkill.value = it }
        }
    }

    // ------------------------------------------------- les llistes de la targeta

    private val _expandedCards = MutableStateFlow<Set<String>>(emptySet())
    val expandedCards: StateFlow<Set<String>> = _expandedCards.asStateFlow()

    private val _openCards = MutableStateFlow<Set<String>>(emptySet())
    val openCards: StateFlow<Set<String>> = _openCards.asStateFlow()

    private val _cardLists = MutableStateFlow<Map<String, TaskLists>>(emptyMap())
    val cardLists: StateFlow<Map<String, TaskLists>> = _cardLists.asStateFlow()
    private val cardJobs = mutableMapOf<String, Job>()
    private val savingCards = mutableSetOf<String>()

    /** El que s'està escrivint al formulari d'una targeta. Un sol camp. */
    private val _cardDrafts = MutableStateFlow<Map<String, String>>(emptyMap())
    val cardDrafts: StateFlow<Map<String, String>> = _cardDrafts.asStateFlow()

    /**
     * Desplega —o plega— una targeta.
     *
     * **Els ítems només es demanen en desplegar.** El tauler ja porta el recompte com a
     * agregat, que és tot el que la targeta plegada necessita; baixar les llistes de
     * totes les targetes faria la primera pantalla llarga per a un contingut que la
     * majoria de tasques no tenen.
     */
    fun toggleCard(task: Task) {
        val open = task.id !in _expandedCards.value
        _expandedCards.value = if (open) _expandedCards.value + task.id else _expandedCards.value - task.id
        if (open) loadCard(task.id) else cardJobs.remove(task.id)?.cancel()
    }

    fun toggleCardForm(task: Task) {
        val open = task.id !in _expandedCards.value || task.id !in _openCards.value
        _openCards.value = if (open) _openCards.value + task.id else _openCards.value - task.id
        // Obrir el formulari desplega la targeta: afegir-hi una cosa i no veure-la
        // aparèixer sembla que no hagi passat res.
        if (open && task.id !in _expandedCards.value) {
            _expandedCards.value = _expandedCards.value + task.id
        }
        if (open) loadCard(task.id)
    }

    fun setCardDraft(taskId: String, text: String) {
        _cardDrafts.value = _cardDrafts.value + (taskId to text)
    }

    fun toggleSubtask(taskId: String, subtaskId: String, done: Boolean) {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            localChange(sessionAccount) { setSubtask(taskId, subtaskId, done) }
        }
    }

    fun renameSubtask(taskId: String, subtaskId: String, title: String, onPersisted: (Boolean) -> Unit) {
        val sessionAccount = activeAccount ?: return onPersisted(false)
        sessionScope.launch {
            val saved = localChange(sessionAccount, showError = false) { renameSubtask(taskId, subtaskId, title) }
            if (activeAccount == sessionAccount) onPersisted(saved)
        }
    }

    fun deleteSubtask(taskId: String, subtaskId: String) {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            localChange(sessionAccount) { deleteSubtask(taskId, subtaskId) }
        }
    }

    /** Pineja o despineja una llista des de la targeta (P1: el pinejat és per usuari). */
    fun togglePinList(taskId: String, checklist: Checklist) {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            runCatching {
                val api = container.api(sessionAccount)
                api.setChecklistPin(checklist.id, !checklist.pinned)
                _pinned.value = api.pinnedChecklists()
                container.repository(sessionAccount).refreshTaskLists(taskId)
            }.onFailure(::actionFailed)
        }
    }

    fun toggleCardItem(taskId: String, itemId: String, done: Boolean) {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            localChange(sessionAccount) { setChecklistItem(taskId, itemId, done) }
        }
    }

    /**
     * Afegeix des de la targeta, amb **un sol camp**.
     *
     * `#Llista element` hi posa l'ítem; sense sigil, és una subtasca. És el mateix gest
     * i el mateix sigil que l'afegida ràpida, i per això el disseny validat va deixar un
     * camp en comptes de dos i un botó.
     *
     * Amb nom, es busca la llista que ja el porti i s'hi afegeix l'ítem; només se'n crea
     * una de nova si no n'hi ha cap, perquè escriure dues vegades el mateix nom hauria de
     * donar una llista, no dues de bessones.
     */
    fun submitCardAdd(task: Task) {
        val sessionAccount = activeAccount ?: return
        val raw = (_cardDrafts.value[task.id] ?: "").trim()
        if (raw.isEmpty()) return
        val sigil = Regex("^#(\\S+)\\s+(.+)$").find(raw)
        val name = sigil?.groupValues?.get(1).orEmpty()
        val text = (sigil?.groupValues?.get(2) ?: raw).trim()
        if (text.isEmpty() || !savingCards.add(task.id)) return

        sessionScope.launch {
            try {
                val saved = localChange(sessionAccount) {
                    if (name.isEmpty()) addSubtask(task.id, text)
                    else addChecklistItem(task.id, name, text)
                }
                if (saved && activeAccount == sessionAccount && _cardDrafts.value[task.id]?.trim() == raw) {
                    setCardDraft(task.id, "")
                }
            } finally {
                if (activeAccount == sessionAccount) savingCards.remove(task.id)
            }
        }
    }

    private fun loadCard(taskId: String) {
        val sessionAccount = activeAccount ?: return
        if (cardJobs[taskId]?.isActive == true) return
        val repository = container.repository(sessionAccount)
        cardJobs[taskId] = sessionScope.launch {
            launch { runCatching { repository.refreshTaskLists(taskId) } }
            repository.taskLists(taskId).collect { lists ->
                if (activeAccount == sessionAccount) {
                    _cardLists.value = _cardLists.value + (taskId to lists)
                }
            }
        }
    }

    fun create(scopeId: String, title: String, status: TaskStatus = TaskStatus.INBOX) {
        val sessionAccount = activeAccount ?: return
        sessionScope.launch {
            localChange(sessionAccount) { createTask(scopeId, title, null, status) }
        }
    }

    fun create(result: QuickAddResult, status: TaskStatus, onPersisted: (Boolean) -> Unit) {
        val sessionAccount = activeAccount ?: return onPersisted(false)
        val scopeId = result.scopeId ?: return onPersisted(false)
        if (status in _quickAddSaving.value) return onPersisted(false)
        val submitted = _quickAddTexts.value[status].orEmpty()
        _quickAddSaving.value += status
        sessionScope.launch {
            try {
                val saved = localChange(sessionAccount, showError = false) {
                    createTask(
                        scopeId,
                        result.title,
                        result.projectId,
                        status,
                        assigneeIds = result.assigneeIds,
                        aiMode = result.aiMode,
                        taskTypeId = result.taskTypeId,
                    )
                }
                if (activeAccount == sessionAccount) {
                    if (saved && _quickAddTexts.value[status].orEmpty() == submitted) {
                        setQuickAddText(status, "")
                        if (status == TaskStatus.INBOX) quickAddConsumed()
                    }
                    onPersisted(saved)
                }
            } finally {
                if (activeAccount == sessionAccount) _quickAddSaving.value -= status
            }
        }
    }

    fun resolveSyncIssue(opId: String, keepLocal: Boolean) {
        val account = activeAccount ?: return
        sessionScope.launch {
            localChange(account) { resolveSyncIssue(opId, keepLocal) }
        }
    }

    private fun observe(account: ActiveAccount) {
        val repository = container.repository(account)
        fun refreshWidgets() {
            if (FemhoWidgets.arePlaced(container.appContext)) {
                sessionScope.launch { FemhoWidgets.updateAll(container.appContext) }
            }
        }
        sessionScope.launch {
            repository.doingAutoStop.collect { setting ->
                _doingAutoStopMinutes.value = setting.minutes
                setting.issueId?.let {
                    actionFailed()
                    repository.dismissDoingAutoStopIssue(it)
                }
            }
        }
        sessionScope.launch {
            repository.calendarSuggestions.collect { state ->
                val changed = state.snapshot != _calendarSuggestions.value.snapshot
                _calendarSuggestions.value = state
                if (changed) refreshWidgets()
                state.issueId?.let {
                    _actionError.value = R.string.calendarsuggestions_saveerror
                    repository.dismissCalendarSuggestionsIssue(it)
                }
            }
        }
        sessionScope.launch {
            repository.pomodoro.collect { state ->
                _pomodoro.value = state
                val app = container.appContext as FemhoApplication
                app.pomodoroSignals.update(account, state)
                state.issueId?.let {
                    _actionError.value = R.string.pomodoro_conflict
                    repository.dismissPomodoroIssue(it)
                }
            }
        }
        sessionScope.launch {
            container.settings.doneClearedAt(account).collect { _doneClearedAt.value = it }
        }
        sessionScope.launch {
            repository.tasks.collect {
                _tasks.value = it
                // Si algú ha demanat una tasca abans que la base respongués, ara ja hi és.
                resolvePendingOpen()
            }
        }
        sessionScope.launch { repository.scopes.collect { _scopes.value = it } }
        sessionScope.launch {
            container.settings.activeScopeSelection(account).collect { selected ->
                if (_activeScopes.value != selected) {
                    _activeScopes.value = selected
                    refreshWidgets()
                }
            }
        }
        sessionScope.launch {
            container.settings.activeProjects(account).collect { selected ->
                if (_activeProjects.value != selected) {
                    _activeProjects.value = selected
                    refreshWidgets()
                }
            }
        }
        sessionScope.launch { repository.projects.collect { _projects.value = it } }
        sessionScope.launch { repository.people.collect { _people.value = it } }
        sessionScope.launch { repository.taskTypes.collect { _taskTypes.value = it } }
        sessionScope.launch { repository.pending.collect { _pending.value = it } }
        sessionScope.launch { repository.syncIssues.collect { _syncIssues.value = it } }
    }
}
