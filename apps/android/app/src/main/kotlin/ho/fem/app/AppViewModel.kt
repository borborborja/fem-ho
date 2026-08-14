package ho.fem.app

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ho.fem.data.Container
import ho.fem.model.Agent
import ho.fem.model.AgentDetail
import ho.fem.model.AgentScopeAvailability
import ho.fem.model.AiMode
import ho.fem.model.ApiTokenSummary
import ho.fem.model.Checklist
import ho.fem.model.EventOccurrence
import ho.fem.model.Inbox
import ho.fem.model.InboxEvent
import ho.fem.model.Label
import ho.fem.model.Person
import ho.fem.model.Project
import ho.fem.model.Scope
import ho.fem.model.ScopeSettings
import ho.fem.model.serverIsNewer
import ho.fem.model.Subtask
import ho.fem.model.Task
import ho.fem.model.TaskStatus
import ho.fem.model.TaskType
import ho.fem.model.UserProfile
import ho.fem.model.serverCandidates
import ho.fem.network.FemhoApi
import ho.fem.network.certificateFingerprint
import ho.fem.network.probeServerCertificate
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

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
        data class NeedsServer(val message: String? = null) : Session
        data class NeedsLogin(val serverUrl: String, val instanceName: String) : Session
        /** El servidor és més nou que l'app: convé actualitzar-la (docs/03 §11). */
        data class NeedsLoginNewer(val serverUrl: String, val instanceName: String) : Session
        /** Certificat autofirmat o de CA pròpia: cal confirmar l'empremta (docs/03 §2:38). */
        data class NeedsCertConfirm(val serverUrl: String, val fingerprint: String) : Session
        data class Ready(val serverUrl: String) : Session
    }

    private val _session = MutableStateFlow<Session>(Session.Checking)
    val session: StateFlow<Session> = _session.asStateFlow()

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

    private val _pending = MutableStateFlow(0)
    val pending: StateFlow<Int> = _pending.asStateFlow()

    private val _theme = MutableStateFlow("system")
    val theme: StateFlow<String> = _theme.asStateFlow()

    private val _accent = MutableStateFlow("default")
    val accent: StateFlow<String> = _accent.asStateFlow()

    private val _profile = MutableStateFlow<UserProfile?>(null)
    val profile: StateFlow<UserProfile?> = _profile.asStateFlow()

    private val _gravatarEnabled = MutableStateFlow(true)
    val gravatarEnabled: StateFlow<Boolean> = _gravatarEnabled.asStateFlow()

    private val _tokens = MutableStateFlow<List<ho.fem.model.ApiTokenSummary>>(emptyList())
    val tokens: StateFlow<List<ho.fem.model.ApiTokenSummary>> = _tokens.asStateFlow()

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
        val base = serverUrl ?: return
        viewModelScope.launch {
            runCatching { container.api(base).shares() }
                .onSuccess { shares ->
                    _allShares.value = shares
                    shares.forEach { share ->
                        runCatching { container.api(base).shareAccesses(share.id) }
                            .onSuccess { _shareAccesses.value = _shareAccesses.value + (share.id to it) }
                    }
                }
        }
    }

    /** Revoca una share des de la pestanya Compartits. DELETE /shares/{id}. */
    fun revokeShare(shareId: String) {
        val base = serverUrl ?: return
        viewModelScope.launch {
            runCatching { container.api(base).revokeShare(shareId) }
                .onSuccess { loadAllShares() }
        }
    }

    /** El preview d'un convit d'àmbit, per mirar-lo abans d'acceptar. */
    fun loadJoinPreview(token: String) {
        val base = serverUrl ?: return
        viewModelScope.launch {
            runCatching { container.api(base).joinPreview(token) }
                .onSuccess { _joinPreview.value = it }
                .onFailure { _joinError.value = it.message }
        }
    }

    /** Accepta un convit d'àmbit. POST /join/{token}. */
    fun acceptJoin(token: String) {
        val base = serverUrl ?: return
        viewModelScope.launch {
            runCatching { container.api(base).acceptJoin(token) }
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

    private val _sessions = MutableStateFlow<ho.fem.model.SessionReport>(ho.fem.model.SessionReport())
    val sessions: StateFlow<ho.fem.model.SessionReport> = _sessions.asStateFlow()

    private val _stats = MutableStateFlow<ho.fem.model.SessionStats>(ho.fem.model.SessionStats())
    val stats: StateFlow<ho.fem.model.SessionStats> = _stats.asStateFlow()

    /** Carrega les Estadístiques de dedicació. GET /api/v1/sessions/stats. */
    fun loadStats(from: String?, to: String?, userId: String?) {
        val base = serverUrl ?: return
        viewModelScope.launch {
            val active = container.settings.activeScopes.first()
            runCatching {
                container.api(base).sessionStats(
                    from = from,
                    to = to,
                    scopeIds = active,
                    userId = userId,
                )
            }.onSuccess { _stats.value = it }
        }
    }

    /** Carrega el Registre de dedicació. GET /api/v1/sessions amb els filtres. */
    fun loadSessions(from: String?, to: String?, projectId: String?, userId: String?, search: String?) {
        val base = serverUrl ?: return
        viewModelScope.launch {
            val active = container.settings.activeScopes.first()
            runCatching {
                container.api(base).sessions(
                    from = from,
                    to = to,
                    scopeIds = active,
                    projectId = projectId,
                    userId = userId,
                    search = search,
                )
            }.onSuccess { _sessions.value = it }
        }
    }

    /** Mou o allarga un bloc del cronograma. PATCH /api/v1/sessions/{id}. */
    fun updateSession(id: String, startedAt: String?, endedAt: String?) {
        val base = serverUrl ?: return
        viewModelScope.launch {
            runCatching { container.api(base).updateSession(id, startedAt = startedAt, endedAt = endedAt) }
        }
    }

    /** Exporta el Registre en CSV. GET /api/v1/sessions/export.csv amb els filtres. */
    fun exportSessionsCsv(
        from: String?,
        to: String?,
        projectId: String?,
        userId: String?,
        search: String?,
        onResult: (String) -> Unit,
    ) {
        val base = serverUrl ?: return
        viewModelScope.launch {
            val active = container.settings.activeScopes.first()
            runCatching {
                container.api(base).exportSessionsCsv(
                    from = from,
                    to = to,
                    scopeIds = active,
                    projectId = projectId,
                    userId = userId,
                    search = search,
                )
            }.onSuccess { onResult(it) }
        }
    }

    private val _createdToken = MutableStateFlow<String?>(null)
    val createdToken: StateFlow<String?> = _createdToken.asStateFlow()

    private val _events = MutableStateFlow<List<EventOccurrence>>(emptyList())
    val events: StateFlow<List<EventOccurrence>> = _events.asStateFlow()

    private val _inbox = MutableStateFlow<Inbox?>(null)
    val inbox: StateFlow<Inbox?> = _inbox.asStateFlow()

    private val _openTask = MutableStateFlow<Task?>(null)
    val openTask: StateFlow<Task?> = _openTask.asStateFlow()

    private val _openChecklists = MutableStateFlow<List<Checklist>>(emptyList())
    val openChecklists: StateFlow<List<Checklist>> = _openChecklists.asStateFlow()

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

    init {
        viewModelScope.launch {
            _theme.value = container.settings.theme.first()
            _accent.value = container.settings.accent.first()

            val saved = container.settings.serverUrl.first()
            if (saved == null) {
                _session.value = Session.NeedsServer()
            } else {
                serverUrl = saved
                // Amb testimoni desat s'entra directament; si ha caducat de debò, la
                // primera petició ho dirà i es tornarà al login.
                _session.value =
                    if (container.tokens.refresh() != null) Session.Ready(saved)
                    else Session.NeedsLogin(saved, "")
                if (container.tokens.refresh() != null) {
                    observe(saved)
                    /**
                     * **I es demana al servidor.**
                     *
                     * Abans només s'observava la base local: obrir l'app amb una sessió
                     * desada ensenyava el que hi havia l'últim cop i no preguntava res.
                     * El que ho tapava era la consulta periòdica de quinze minuts, que
                     * acaba arribant — o sigui que el defecte es veia com "l'app va
                     * endarrerida una estona" i no com "l'app no sincronitza en obrir-se".
                     *
                     * `docs/03` §7 ho demana explícitament: la sincronització es dispara
                     * quan l'app passa a primer pla.
                     */
                    refresh()
                }
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
            for (candidate in resolved.candidates) {
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
                container.settings.setServerUrl(candidate)
                serverUrl = candidate
                // La versió de l'app (BuildConfig.VERSION_NAME) es compara amb la del
                // servidor: si aquest és més nou, s'avisa a la pantalla d'entrada.
                val appVersion = ho.fem.app.BuildConfig.VERSION_NAME
                _session.value = if (serverIsNewer(appVersion, info.version)) {
                    Session.NeedsLoginNewer(candidate, info.name)
                } else {
                    Session.NeedsLogin(candidate, info.name)
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
        val base = serverUrl ?: return
        viewModelScope.launch {
            runCatching { container.api(base).login(email, password) }
                .onSuccess {
                    _session.value = Session.Ready(base)
                    observe(base)
                    refresh()
                }
                .onFailure { error ->
                    onError((error as? FemhoApi.ApiException)?.detail.orEmpty())
                }
        }
    }

    fun logout() {
        val base = serverUrl ?: return
        viewModelScope.launch {
            container.api(base).logout()
            _session.value = Session.NeedsLogin(base, "")
        }
    }

    /**
     * Marca o desmarca un projecte del filtre.
     *
     * No demana res al servidor: el tauler ja té les tasques dels àmbits actius i el
     * filtre s'aplica sobre el que hi ha, com a la web.
     */
    fun toggleProject(id: String) {
        viewModelScope.launch {
            val ara = container.settings.activeProjects.first()
            container.settings.setActiveProjects(if (id in ara) ara - id else ara + id)
        }
    }

    /** Torna un àmbit a "tots els seus": treu del filtre els projectes que en són. */
    fun clearProjectsOfScope(scopeId: String) {
        viewModelScope.launch {
            val seus = _projects.value.filter { it.scopeId == scopeId }.map { it.id }.toSet()
            container.settings.setActiveProjects(
                container.settings.activeProjects.first().filterNot { it in seus },
            )
        }
    }

    fun refresh() {
        val base = serverUrl ?: return
        loadAgents()
        // L'idioma del perfil, cada cop que es refresca: si algú l'ha canviat des de la
        // web, el telèfon se n'assabenta al primer refresc i no al proper reinstal·lat.
        viewModelScope.launch {
            runCatching { container.api(base).profile() }
                .onSuccess { applyProfileLocale(it.locale) }
        }
        viewModelScope.launch {
            val active = container.settings.activeScopes.first()
            runCatching { container.repository(base).refresh(active, null) }
        }
        viewModelScope.launch { _pinned.value = container.api(base).pinnedChecklists() }
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
    fun loadCalendar(from: String, to: String, day: String) {
        val base = serverUrl ?: return
        viewModelScope.launch {
            val active = container.settings.activeScopes.first()
            val api = container.api(base)
            runCatching { api.events(from, to, active) }.onSuccess { _events.value = it }
            runCatching { api.inbox(day, true, active) }.onSuccess { _inbox.value = it }
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
    fun setEventInInbox(event: InboxEvent, visible: Boolean?, day: String) {
        val base = serverUrl ?: return
        viewModelScope.launch {
            val active = container.settings.activeScopes.first()
            val api = container.api(base)
            runCatching {
                api.setEventInInbox(event.calendarId, event.uid, event.recurrenceId, visible)
            }.onSuccess {
                runCatching { api.inbox(day, true, active) }.onSuccess { _inbox.value = it }
            }
        }
    }

    /**
     * Fer una tasca a partir d'una cita.
     *
     * Neix amb el títol i la data de la cita: qui ho demana ja sap què és, i fer-l'hi
     * reescriure seria demanar-li que copiés una cosa que té al davant. La cita marxa de
     * la bústia sola, perquè ara hi ha una tasca viva que hi apunta.
     */
    fun eventToTask(event: InboxEvent, day: String) {
        val base = serverUrl ?: return
        viewModelScope.launch {
            val active = container.settings.activeScopes.first()
            val api = container.api(base)
            runCatching {
                api.createTask(
                    id = java.util.UUID.randomUUID().toString(),
                    scopeId = event.scopeId,
                    title = event.summary,
                    projectId = null,
                    assigneeIds = emptyList(),
                    sourceEvent = Triple(event.calendarId, event.uid, event.recurrenceId),
                )
            }.onSuccess {
                runCatching { api.inbox(day, true, active) }.onSuccess { _inbox.value = it }
                refresh()
            }
        }
    }

    fun open(task: Task) {
        _openTask.value = task
        _openChecklists.value = emptyList()
        _openComments.value = emptyList()
        _openActivity.value = emptyList()

        val base = serverUrl ?: return
        viewModelScope.launch {
            runCatching { container.api(base).checklists(task.id) }
                .onSuccess { _openChecklists.value = it }
            runCatching { container.api(base).taskComments(task.id) }
                .onSuccess { _openComments.value = it }
            runCatching { container.api(base).taskActivity(task.id) }
                .onSuccess { _openActivity.value = it }
            runCatching { container.api(base).shares() }
                .onSuccess { all -> _openShares.value = all.filter { it.taskId == task.id } }
            runCatching { container.api(base).listTaskAttachments(task.id) }
                .onSuccess { _openAttachments.value = it }
        }
    }

    /** Puja un adjunt a la tasca oberta. POST /tasks/{id}/attachments (octet-stream). */
    fun uploadTaskAttachment(task: Task, filename: String, bytes: ByteArray) {
        val base = serverUrl ?: return
        viewModelScope.launch {
            runCatching {
                container.api(base).uploadTaskAttachment(task.id, filename, bytes)
            }
                .onSuccess {
                    _attachmentError.value = null
                    open(task)
                }
                .onFailure { e ->
                    val detail = (e as? ho.fem.network.FemhoApi.ApiException)?.detail
                    _attachmentError.value = detail ?: e.message
                }
        }
    }

    /** El contingut d'un adjunt, per desar-lo i obrir-lo. GET /attachments/{id}/content. */
    fun downloadAttachment(attachmentId: String, onBytes: (ByteArray) -> Unit) {
        val base = serverUrl ?: return
        viewModelScope.launch {
            runCatching { container.api(base).attachmentContent(attachmentId) }
                .onSuccess(onBytes)
                .onFailure { e ->
                    _attachmentError.value = (e as? ho.fem.network.FemhoApi.ApiException)?.detail ?: e.message
                }
        }
    }

    /** Esborra un adjunt. DELETE /attachments/{id}. */
    fun deleteTaskAttachment(task: Task, attachmentId: String) {
        val base = serverUrl ?: return
        viewModelScope.launch {
            runCatching { container.api(base).deleteAttachment(attachmentId) }
                .onSuccess { open(task) }
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
        val base = serverUrl ?: return
        viewModelScope.launch {
            runCatching {
                container.api(base).createShare(
                    taskId = task.id,
                    permission = permission,
                    requireName = requireName,
                    password = password,
                    expiresAt = expiresAt,
                    maxViews = maxViews?.toIntOrNull(),
                )
            }.onSuccess { result ->
                _createdShareUrl.value = result.url
                open(task)
            }
        }
    }

    /** Revoca un enllaç compartit. DELETE /shares/{id}. */
    fun revokeTaskShare(shareId: String) {
        val base = serverUrl ?: return
        val task = _openTask.value ?: return
        viewModelScope.launch {
            runCatching { container.api(base).revokeShare(shareId) }
                .onSuccess { open(task) }
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

    fun requestQuickAdd(draft: String) {
        _quickAddDraft.value = draft
    }

    fun quickAddConsumed() {
        _quickAddDraft.value = null
    }

    fun closeTask() {
        _openTask.value = null
        _openChecklists.value = emptyList()
    }

    fun rename(task: Task, title: String) {
        val base = serverUrl ?: return
        viewModelScope.launch {
            val repository = container.repository(base)
            repository.renameTask(task, title)
            repository.flush()
            _openTask.value = task.copy(title = title)
        }
    }

    fun toggleItem(itemId: String, done: Boolean) {
        val base = serverUrl ?: return
        val task = _openTask.value ?: return
        viewModelScope.launch {
            runCatching { container.api(base).setChecklistItem(itemId, done) }
            // Es rellegeix: la cascada amunt pot haver completat la subtasca i la tasca
            // (P1), i sense rellegir la pantalla ensenyaria l'ítem marcat i la resta no.
            runCatching { container.api(base).checklists(task.id) }
                .onSuccess { _openChecklists.value = it }
            refresh()
        }
    }

    fun setAiMode(task: Task, mode: AiMode) {
        val base = serverUrl ?: return
        viewModelScope.launch {
            runCatching { container.api(base).setAiMode(task.id, mode.wire) }
                .onSuccess { _openTask.value = it }
            refresh()
        }
    }

    /**
     * Desa els camps bàsics del detall (descripció, projecte, venciment, hora i deadline).
     *
     * PATCH /api/v1/tasks/{id}. Patró web: es desa amb «Desa», no a cada tecla.
     * Els camps que arriben com a null no s'envien; per esborrar-ne un (projecte o
     * venciment) cal passar-hi el valor buit que el servidor interpreta com a nul.
     */
    fun updateTaskDetails(
        task: Task,
        description: String?,
        projectId: String?,
        dueDate: String?,
        dueTime: String?,
        deadline: String?,
        rrule: String?,
        recurrenceMode: String?,
    ) {
        val base = serverUrl ?: return
        viewModelScope.launch {
            runCatching {
                container.api(base).updateTask(
                    task.id,
                    buildMap {
                        if (description != null) put("description", description)
                        if (projectId != null) put("project_id", projectId)
                        if (dueDate != null) put("due_date", dueDate)
                        if (dueTime != null) put("due_time", dueTime)
                        if (deadline != null) put("deadline", deadline)
                        if (rrule != null) put("rrule", rrule)
                        if (recurrenceMode != null) put("recurrence_mode", recurrenceMode)
                    },
                )
            }.onSuccess { updated ->
                _openTask.value = updated
                refresh()
            }
        }
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
        viewModelScope.launch { container.settings.setTheme(value) }
    }

    fun setAccent(value: String) {
        _accent.value = value
        viewModelScope.launch { container.settings.setAccent(value) }
    }

    fun setLocale(value: String) {
        viewModelScope.launch {
            container.settings.setLocale(value)
            applyProfileLocale(value)
            // Persistir al servidor si hi ha sessió
            if (_session.value is Session.Ready) {
                val base = (_session.value as Session.Ready).serverUrl
                container.api(base).updateProfile(locale = value)
            }
        }
    }

    fun setWeekStart(value: String) {
        viewModelScope.launch {
            container.settings.setWeekStart(value)
            if (_session.value is Session.Ready) {
                val base = (_session.value as Session.Ready).serverUrl
                container.api(base).updateSettings(weekStart = value)
            }
        }
    }

    fun setEventTaskDeleted(value: String) {
        viewModelScope.launch {
            container.settings.setEventTaskDeleted(value)
            if (_session.value is Session.Ready) {
                val base = (_session.value as Session.Ready).serverUrl
                container.api(base).updateSettings(eventTaskDeleted = value)
            }
        }
    }

    fun setShowCalendarWidget(value: Boolean) {
        viewModelScope.launch {
            container.settings.setShowCalendarWidget(value)
            if (_session.value is Session.Ready) {
                val base = (_session.value as Session.Ready).serverUrl
                container.api(base).updateSettings(showCalendarWidget = value)
            }
        }
    }

    fun setShowOverdueSection(value: Boolean) {
        viewModelScope.launch {
            container.settings.setShowOverdueSection(value)
            if (_session.value is Session.Ready) {
                val base = (_session.value as Session.Ready).serverUrl
                container.api(base).updateSettings(showOverdueSection = value)
            }
        }
    }

    fun setInboxPosition(value: String) {
        viewModelScope.launch {
            container.settings.setInboxPosition(value)
            if (_session.value is Session.Ready) {
                val base = (_session.value as Session.Ready).serverUrl
                container.api(base).updateSettings(inboxPosition = value)
            }
        }
    }

    fun setInboxShowOverdue(value: Boolean) {
        viewModelScope.launch {
            container.settings.setInboxShowOverdue(value)
            if (_session.value is Session.Ready) {
                val base = (_session.value as Session.Ready).serverUrl
                container.api(base).updateSettings(inboxShowOverdue = value)
            }
        }
    }

    /**
     * Carrega el perfil de l'usuari.
     *
     * Es crida en iniciar sessió per tenir el nom, correu i timezone a mà.
     */
    fun loadProfile() {
        val base = serverUrl ?: return
        viewModelScope.launch {
            runCatching { container.api(base).profile() }
                .onSuccess { _profile.value = it }
        }
    }

    /**
     * Actualitza el nom de l'usuari.
     *
     * **Es desa en perdre el focus** (onBlur), no a cada tecla: el mateix criteri que
     * la web, que fa el PATCH quan surt del camp.
     */
    fun setName(name: String) {
        val base = serverUrl ?: return
        viewModelScope.launch {
            runCatching { container.api(base).updateProfile(name = name) }
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
        val base = serverUrl ?: return
        viewModelScope.launch {
            runCatching { container.api(base).updateSettings(gravatar = enabled) }
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
        val base = serverUrl ?: return
        viewModelScope.launch {
            runCatching { container.api(base).changePassword(current, new) }
                .onSuccess { onSuccess() }
                .onFailure { error ->
                    onError((error as? FemhoApi.ApiException)?.detail.orEmpty())
                }
        }
    }

    /**
     * Carrega la llista de tokens d'API.
     *
     * GET /api/v1/tokens. Es crida en obrir la pestanya MCP i API d'Ajustos.
     */
    fun loadTokens() {
        val base = serverUrl ?: return
        viewModelScope.launch {
            runCatching { container.api(base).apiTokens() }
                .onSuccess { _tokens.value = it }
        }
    }

    /**
     * Crea un token d'API nou.
     *
     * POST /api/v1/tokens {name, capabilities}. El token complet es retorna i es mostra
     * UN SOL COP (P17: mai més es podrà veure). Les capacitats per defecte són les de
     * la web: tasks:read, tasks:write, checklists:read, checklists:write.
     *
     * @param name el nom del token
     * @param capabilities les capacitats del token
     */
    fun createToken(name: String, capabilities: List<String>) {
        val base = serverUrl ?: return
        viewModelScope.launch {
            runCatching { container.api(base).createApiToken(name, capabilities) }
                .onSuccess { result ->
                    // El token es mostra un sol cop
                    _createdToken.value = result["token"] as? String
                    // Recarrega la llista
                    loadTokens()
                }
        }
    }

    /**
     * Revoca un token d'API.
     *
     * DELETE /api/v1/tokens/{id}. El token desapareix de la llista immediatament.
     *
     * @param id l'identificador del token a revocar
     */
    fun revokeToken(id: String) {
        val base = serverUrl ?: return
        viewModelScope.launch {
            runCatching { container.api(base).revokeApiToken(id) }
                .onSuccess { loadTokens() }
        }
    }

    /** Carrega els calendaris per a Ajustos ▸ Calendaris. GET /api/v1/calendars. */
    fun loadCalendars() {
        val base = serverUrl ?: return
        viewModelScope.launch {
            runCatching { container.api(base).calendars() }
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
        val base = serverUrl ?: return
        viewModelScope.launch {
            runCatching {
                container.api(base).createCalendar(
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
        val base = serverUrl ?: return
        viewModelScope.launch {
            runCatching {
                container.api(base).updateCalendar(
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
        val base = serverUrl ?: return
        viewModelScope.launch {
            runCatching { container.api(base).deleteCalendar(id) }
                .onSuccess { loadCalendars() }
        }
    }

    /** Carrega comptes i regles de correu per a Ajustos ▸ Correu. */
    fun loadMailData() {
        val base = serverUrl ?: return
        viewModelScope.launch {
            runCatching { container.api(base).mailAccounts() }
                .onSuccess { _mailAccounts.value = it }
            runCatching { container.api(base).mailRules() }
                .onSuccess { _mailRules.value = it }
        }
    }

    /** Crea un compte IMAP. POST /api/v1/mail/accounts. */
    fun createMailAccount(name: String, host: String, username: String, password: String, security: String) {
        val base = serverUrl ?: return
        viewModelScope.launch {
            runCatching { container.api(base).createMailAccount(name, host, username, password, security) }
                .onSuccess { loadMailData() }
        }
    }

    /** Actualitza un compte IMAP. PATCH /api/v1/mail/accounts/{id}. */
    fun updateMailAccount(id: String, name: String? = null, host: String? = null, username: String? = null, password: String? = null, security: String? = null) {
        val base = serverUrl ?: return
        viewModelScope.launch {
            runCatching { container.api(base).updateMailAccount(id, name, host, username, password, security) }
                .onSuccess { loadMailData() }
        }
    }

    /** Esborra un compte IMAP. DELETE /api/v1/mail/accounts/{id}. */
    fun deleteMailAccount(id: String) {
        val base = serverUrl ?: return
        viewModelScope.launch {
            runCatching { container.api(base).deleteMailAccount(id) }
                .onSuccess { loadMailData() }
        }
    }

    /** Prova la connexió d'un compte. POST /api/v1/mail/accounts/{id}/test — no desa res. */
    fun testMailAccount(id: String, onResult: (ho.fem.model.MailTestResult) -> Unit) {
        val base = serverUrl ?: return
        viewModelScope.launch {
            runCatching { container.api(base).testMailAccount(id) }
                .onSuccess { onResult(it) }
                .onFailure { onResult(ho.fem.model.MailTestResult(ok = false, error = it.message)) }
        }
    }

    /** Crea una regla (mapa de carpeta). POST /api/v1/mail/rules. */
    fun createMailRule(accountId: String, folder: String, scopeId: String? = null, titleTemplate: String? = null) {
        val base = serverUrl ?: return
        viewModelScope.launch {
            runCatching { container.api(base).createMailRule(accountId, folder, scopeId = scopeId, titleTemplate = titleTemplate) }
                .onSuccess { loadMailData() }
        }
    }

    /** Esborra una regla. DELETE /api/v1/mail/rules/{id}. */
    fun deleteMailRule(id: String) {
        val base = serverUrl ?: return
        viewModelScope.launch {
            runCatching { container.api(base).deleteMailRule(id) }
                .onSuccess { loadMailData() }
        }
    }

    /**
     * Copia un text al porta-retalls.
     *
     * @param text el text a copiar
     */
    fun copyToClipboard(text: String) {
        val clipboard = container.appContext.getSystemService(android.content.ClipboardManager::class.java)
        val clip = android.content.ClipData.newPlainText("Fem-ho", text)
        clipboard.setPrimaryClip(clip)
    }

    /**
     * Crea un àmbit nou.
     *
     * POST /api/v1/scopes {id, name, color, kind}. L'identificador el genera el client
     * (D4), igual que a la creació de tasques: així un reintent no duplica res.
     */
    fun createScope(name: String, color: String, kind: String) {
        val base = serverUrl ?: return
        viewModelScope.launch {
            runCatching { container.api(base).createScope(name, color, kind) }
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
        val base = serverUrl ?: return
        viewModelScope.launch {
            runCatching { container.api(base).updateScope(id, name, color) }
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
        val base = serverUrl ?: return
        viewModelScope.launch {
            runCatching { container.api(base).deleteScope(id) }
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
        val base = serverUrl ?: return
        viewModelScope.launch {
            runCatching { container.api(base).labels() }
                .onSuccess { _labels.value = it }
            runCatching { container.api(base).taskTypes() }
                .onSuccess { _taskTypes.value = it }
            scopes.value.forEach { scope ->
                runCatching { container.api(base).scopeSettings(scope.id) }
                    .onSuccess { settings ->
                        _scopeSettings.value = _scopeSettings.value + (scope.id to settings)
                    }
            }
        }
    }

    /** Crea un projecte dins d'un àmbit. POST /api/v1/projects. */
    fun createProject(scopeId: String, name: String) {
        val base = serverUrl ?: return
        viewModelScope.launch {
            runCatching { container.api(base).createProject(scopeId, name) }
                .onSuccess { loadEntityData() }
        }
    }

    /** Esborra un projecte. DELETE /api/v1/projects/{id}. */
    fun deleteProject(id: String) {
        val base = serverUrl ?: return
        viewModelScope.launch {
            runCatching { container.api(base).deleteProject(id) }
                .onSuccess { loadEntityData() }
        }
    }

    /** Crea una etiqueta dins d'un àmbit. POST /api/v1/labels. */
    fun createLabel(scopeId: String, name: String) {
        val base = serverUrl ?: return
        viewModelScope.launch {
            runCatching { container.api(base).createLabel(scopeId, name) }
                .onSuccess { loadEntityData() }
        }
    }

    /** Esborra una etiqueta. DELETE /api/v1/labels/{id}. */
    fun deleteLabel(id: String) {
        val base = serverUrl ?: return
        viewModelScope.launch {
            runCatching { container.api(base).deleteLabel(id) }
                .onSuccess { loadEntityData() }
        }
    }

    /** Assigna una persona a una tasca. POST /api/v1/tasks/{id}/assignees/{userId}. */
    fun addAssignee(task: Task, userId: String) {
        val base = serverUrl ?: return
        viewModelScope.launch {
            runCatching { container.api(base).addAssignee(task.id, userId) }
                .onSuccess { refreshTask(task) }
        }
    }

    /** Treu una persona d'una tasca. DELETE /api/v1/tasks/{id}/assignees/{userId}. */
    fun removeAssignee(task: Task, userId: String) {
        val base = serverUrl ?: return
        viewModelScope.launch {
            runCatching { container.api(base).removeAssignee(task.id, userId) }
                .onSuccess { refreshTask(task) }
        }
    }

    /** Posa la tipologia d'una tasca (null per desassignar-la). PATCH /api/v1/tasks/{id}. */
    fun setTaskType(task: Task, taskTypeId: String?) {
        val base = serverUrl ?: return
        viewModelScope.launch {
            runCatching {
                container.api(base).updateTask(
                    task.id,
                    mapOf("task_type_id" to (taskTypeId ?: "")),
                )
            }.onSuccess { updated ->
                _openTask.value = updated
                refresh()
            }
        }
    }

    /** Posa una etiqueta a una tasca. POST /api/v1/tasks/{id}/labels/{labelId}. */
    fun addTaskLabel(task: Task, labelId: String) {
        val base = serverUrl ?: return
        viewModelScope.launch {
            runCatching { container.api(base).addTaskLabel(task.id, labelId) }
                .onSuccess { refreshTask(task) }
        }
    }

    /** Treu una etiqueta d'una tasca. DELETE /api/v1/tasks/{id}/labels/{labelId}. */
    fun removeTaskLabel(task: Task, labelId: String) {
        val base = serverUrl ?: return
        viewModelScope.launch {
            runCatching { container.api(base).removeTaskLabel(task.id, labelId) }
                .onSuccess { refreshTask(task) }
        }
    }

    /** Crea una etiqueta nova i la posa a la tasca que la demana. POST /api/v1/labels. */
    fun createTaskLabel(task: Task, name: String) {
        val base = serverUrl ?: return
        viewModelScope.launch {
            runCatching { container.api(base).createLabel(task.scopeId, name) }
                .onSuccess { label ->
                    loadEntityData()
                    runCatching { container.api(base).addTaskLabel(task.id, label.id) }
                        .onSuccess { refreshTask(task) }
                }
        }
    }

    private fun refreshTask(task: Task) {
        val base = serverUrl ?: return
        viewModelScope.launch {
            runCatching { container.api(base).getTask(task.id) }
                .onSuccess { updated ->
                    _openTask.value = updated
                    refresh()
                }
        }
    }

    /** Carrega els comentaris (i la conversa amb la IA) de la tasca oberta. */
    fun loadComments(taskId: String) {
        val base = serverUrl ?: return
        viewModelScope.launch {
            runCatching { container.api(base).taskComments(taskId) }
                .onSuccess { _openComments.value = it }
        }
    }

    /** Afegeix un comentari a la tasca oberta. POST /api/v1/tasks/{id}/comments. */
    fun addComment(taskId: String, body: String) {
        val base = serverUrl ?: return
        viewModelScope.launch {
            runCatching { container.api(base).addComment(taskId, body) }
                .onSuccess { loadComments(taskId) }
        }
    }

    /** Carrega l'historial d'activitat de la tasca oberta. */
    fun loadActivity(taskId: String) {
        val base = serverUrl ?: return
        viewModelScope.launch {
            runCatching { container.api(base).taskActivity(taskId) }
                .onSuccess { _openActivity.value = it }
        }
    }

    /** Desfà un canvi autònom de la IA. POST /api/v1/activity/{id}/undo. */
    fun undoActivity(entryId: String) {
        val base = serverUrl ?: return
        viewModelScope.launch {
            runCatching { container.api(base).undoActivity(entryId) }
                .onSuccess {
                    _openTask.value?.let { task ->
                        loadActivity(task.id)
                        refreshTask(task)
                    }
                }
        }
    }

    fun createTaskType(scopeId: String, name: String) {
        val base = serverUrl ?: return
        viewModelScope.launch {
            runCatching { container.api(base).createTaskType(scopeId, name) }
                .onSuccess { loadEntityData() }
        }
    }

    /** Actualitza una tipologia. PATCH /api/v1/task-types/{id}. */
    fun updateTaskType(id: String, name: String? = null, required: Boolean? = null) {
        val base = serverUrl ?: return
        viewModelScope.launch {
            runCatching { container.api(base).updateTaskType(id, name = name, required = required) }
                .onSuccess { loadEntityData() }
        }
    }

    /** Esborra una tipologia. DELETE /api/v1/task-types/{id}. */
    fun deleteTaskType(id: String) {
        val base = serverUrl ?: return
        viewModelScope.launch {
            runCatching { container.api(base).deleteTaskType(id) }
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
        val base = serverUrl ?: return
        viewModelScope.launch {
            runCatching {
                container.api(base).updateScopeSettings(
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
        val base = serverUrl ?: return
        viewModelScope.launch {
            val repository = container.repository(base)
            // El veí és l'última targeta de la columna de destí: la posició es calcula
            // al client (D3) i el servidor l'accepta tal com ve.
            val last = _tasks.value.filter { it.status == status && it.id != task.id }
                .maxByOrNull { it.position }?.position
            repository.moveTask(task, status, last to null)
            repository.flush()
        }
    }

    /** El pany d'agent: l'usuari se l'emporta al seu tauler. POST /tasks/{id}/take-over. */
    fun takeOver(task: Task, status: String) {
        val base = serverUrl ?: return
        viewModelScope.launch {
            runCatching { container.api(base).takeOverTask(task.id, status) }
                .onSuccess { updated ->
                    _openTask.value = updated
                    refresh()
                    refreshTask(task)
                }
        }
    }

    /**
     * Reclamar des del kanban de la IA. **És el mateix gest que arrossegar la targeta de
     * tornada a la web**: `ai-mode` a `manual`, no la reserva `claim` de l'agent, que la
     * bloquejaria per a l'usuari en comptes de tornar-li-la.
     */
    fun claim(task: Task) {
        val base = serverUrl ?: return
        viewModelScope.launch {
            runCatching { container.api(base).setAiMode(task.id, "manual") }
                .onSuccess {
                    refresh()
                    refreshTask(task)
                }
        }
    }

    /** Esborra una tasca. DELETE /api/v1/tasks/{id}. */
    fun deleteTask(task: Task) {
        val base = serverUrl ?: return
        viewModelScope.launch {
            runCatching { container.api(base).deleteTask(task.id) }
                .onSuccess {
                    _openTask.value = null
                    refresh()
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
        val base = serverUrl ?: return
        viewModelScope.launch {
            val agents: List<Agent> = runCatching { container.api(base).agents() }
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
        val base = serverUrl ?: return
        viewModelScope.launch {
            runCatching { container.api(base).agentDetails() }
                .onSuccess { agents ->
                    _agentsDetail.value = agents
                    agents.forEach { agent ->
                        runCatching { container.api(base).agentScopeAvailability(agent.id) }
                            .onSuccess { _agentScopeAvailability.value = _agentScopeAvailability.value + (agent.id to it) }
                        runCatching { container.api(base).agentCredentials(agent.id) }
                            .onSuccess { _agentCredentials.value = _agentCredentials.value + (agent.id to it) }
                    }
                }
        }
    }

    /** Crea un agent. POST /api/v1/ai/agents. El servidor genera l'id. */
    fun createAgent(name: String) {
        val base = serverUrl ?: return
        viewModelScope.launch {
            runCatching { container.api(base).createAgent(name) }
                .onSuccess { loadAgentManagement() }
        }
    }

    fun setAgentEnabled(agent: AgentDetail, enabled: Boolean) {
        val base = serverUrl ?: return
        viewModelScope.launch {
            runCatching { container.api(base).updateAgent(agent.id, enabled = enabled) }
                .onSuccess {
                    loadAgentManagement()
                    loadAgents()
                }
        }
    }

    fun setAgentCanCreate(agent: AgentDetail, canCreate: Boolean) {
        val base = serverUrl ?: return
        viewModelScope.launch {
            runCatching { container.api(base).updateAgent(agent.id, canCreateTasks = canCreate) }
                .onSuccess { loadAgentManagement() }
        }
    }

    /** Desa el conjunt sencer d'àmbits, com la web: les caselles tal com han quedat. */
    fun setAgentScopes(agent: AgentDetail, scopeIds: List<String>, allScopes: Boolean) {
        val base = serverUrl ?: return
        viewModelScope.launch {
            runCatching { container.api(base).updateAgentScopes(agent.id, scopeIds, allScopes) }
                .onSuccess {
                    loadAgentManagement()
                    loadAgents()
                }
        }
    }

    /** Crea una credencial: el token surt una sola vegada (del hash no se'n pot treure). */
    fun createAgentCredential(agent: AgentDetail) {
        val base = serverUrl ?: return
        viewModelScope.launch {
            runCatching { container.api(base).createAgentCredential(agent.id) }
                .onSuccess { result ->
                    _createdAgentToken.value = result["token"] as? String
                    loadAgentManagement()
                }
        }
    }

    fun revokeAgentCredential(tokenId: String) {
        val base = serverUrl ?: return
        viewModelScope.launch {
            runCatching { container.api(base).revokeApiToken(tokenId) }
                .onSuccess { loadAgentManagement() }
        }
    }

    fun deleteAgent(agent: AgentDetail) {
        val base = serverUrl ?: return
        viewModelScope.launch {
            runCatching { container.api(base).deleteAgent(agent.id) }
                .onSuccess {
                    loadAgentManagement()
                    loadAgents()
                }
        }
    }

    /** El full d'instruccions, en el teu idioma. text/markdown. */
    fun loadAgentSkill() {
        val base = serverUrl ?: return
        viewModelScope.launch {
            runCatching { container.api(base).agentSkill() }
                .onSuccess { _agentSkill.value = it }
        }
    }

    // ------------------------------------------------- les llistes de la targeta

    /** El que s'ha demanat d'una targeta desplegada. Buit mentre no arriba. */
    data class CardLists(
        val subtasks: List<Subtask> = emptyList(),
        val checklists: List<Checklist> = emptyList(),
    )


    private val _expandedCards = MutableStateFlow<Set<String>>(emptySet())
    val expandedCards: StateFlow<Set<String>> = _expandedCards.asStateFlow()

    private val _openCards = MutableStateFlow<Set<String>>(emptySet())
    val openCards: StateFlow<Set<String>> = _openCards.asStateFlow()

    private val _cardLists = MutableStateFlow<Map<String, CardLists>>(emptyMap())
    val cardLists: StateFlow<Map<String, CardLists>> = _cardLists.asStateFlow()

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
        if (open) loadCard(task.id)
    }

    fun toggleCardForm(task: Task) {
        val open = task.id !in _openCards.value
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

    fun toggleCardSubtask(taskId: String, subtaskId: String, done: Boolean) {
        val base = serverUrl ?: return
        viewModelScope.launch {
            runCatching { container.api(base).setSubtask(subtaskId, done) }
            loadCard(taskId)
            refresh()
        }
    }

    /** Pineja o despineja una llista des de la targeta (P1: el pinejat és per usuari). */
    fun togglePinList(taskId: String, checklist: Checklist) {
        val base = serverUrl ?: return
        viewModelScope.launch {
            runCatching { container.api(base).setChecklistPin(checklist.id, !checklist.pinned) }
            // El menú de la xinxeta ha de dir la veritat de seguida, no al proper refresc.
            _pinned.value = container.api(base).pinnedChecklists()
            loadCard(taskId)
        }
    }

    fun toggleCardItem(taskId: String, itemId: String, done: Boolean) {
        val base = serverUrl ?: return
        viewModelScope.launch {
            runCatching { container.api(base).setChecklistItem(itemId, done) }
            loadCard(taskId)
            refresh()
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
        val base = serverUrl ?: return
        val raw = (_cardDrafts.value[task.id] ?: "").trim()
        if (raw.isEmpty()) return
        val sigil = Regex("^#(\\S+)\\s+(.+)$").find(raw)
        val name = sigil?.groupValues?.get(1).orEmpty()
        val text = (sigil?.groupValues?.get(2) ?: raw).trim()
        if (text.isEmpty()) return

        viewModelScope.launch {
            val api = container.api(base)
            runCatching {
                if (name.isEmpty()) {
                    api.createSubtask(task.id, UUID.randomUUID().toString(), text)
                } else {
                    val existing = _cardLists.value[task.id]?.checklists
                        ?.firstOrNull { it.name.equals(name, ignoreCase = true) }
                    val listId = existing?.id ?: api.createChecklist(
                        task.id,
                        UUID.randomUUID().toString(),
                        name,
                    ).id
                    api.createChecklistItem(listId, UUID.randomUUID().toString(), text)
                }
            }
            // El camp es buida sencer: el sigil es torna a escriure, com a l'afegida ràpida.
            setCardDraft(task.id, "")
            loadCard(task.id)
            refresh()
        }
    }

    private fun loadCard(taskId: String) {
        val base = serverUrl ?: return
        viewModelScope.launch {
            val api = container.api(base)
            val subtasks = runCatching { api.subtasks(taskId) }.getOrDefault(emptyList())
            val checklists = runCatching { api.checklists(taskId) }.getOrDefault(emptyList())
            _cardLists.value = _cardLists.value + (taskId to CardLists(subtasks, checklists))
        }
    }

    fun create(scopeId: String, title: String, status: TaskStatus = TaskStatus.INBOX) {
        val base = serverUrl ?: return
        viewModelScope.launch {
            val repository = container.repository(base)
            repository.createTask(scopeId, title, null, status)
            repository.flush()
        }
    }

    private fun observe(base: String) {
        val repository = container.repository(base)
        viewModelScope.launch {
            repository.tasks.collect {
                _tasks.value = it
                // Si algú ha demanat una tasca abans que la base respongués, ara ja hi és.
                resolvePendingOpen()
            }
        }
        viewModelScope.launch { repository.scopes.collect { _scopes.value = it } }
        viewModelScope.launch {
            container.settings.activeProjects.collect { _activeProjects.value = it }
        }
        viewModelScope.launch { repository.projects.collect { _projects.value = it } }
        viewModelScope.launch { repository.people.collect { _people.value = it } }
        viewModelScope.launch { repository.pending.collect { _pending.value = it } }
        // Carrega el perfil per a la pestanya Perfil d'Ajustos
        loadProfile()
    }
}
