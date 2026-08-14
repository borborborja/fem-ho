package ho.fem.app

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ho.fem.data.Container
import ho.fem.model.Agent
import ho.fem.model.AiMode
import ho.fem.model.Checklist
import ho.fem.model.EventOccurrence
import ho.fem.model.Inbox
import ho.fem.model.InboxEvent
import ho.fem.model.Person
import ho.fem.model.Project
import ho.fem.model.Scope
import ho.fem.model.Subtask
import ho.fem.model.Task
import ho.fem.model.TaskStatus
import ho.fem.model.UserProfile
import ho.fem.model.serverCandidates
import ho.fem.network.FemhoApi
import java.util.UUID
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

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
        data class Ready(val serverUrl: String) : Session
    }

    private val _session = MutableStateFlow<Session>(Session.Checking)
    val session: StateFlow<Session> = _session.asStateFlow()

    private val _tasks = MutableStateFlow<List<Task>>(emptyList())
    val tasks: StateFlow<List<Task>> = _tasks.asStateFlow()

    private val _scopes = MutableStateFlow<List<Scope>>(emptyList())
    val scopes: StateFlow<List<Scope>> = _scopes.asStateFlow()

    private val _projects = MutableStateFlow<List<Project>>(emptyList())
    val projects: StateFlow<List<Project>> = _projects.asStateFlow()

    private val _people = MutableStateFlow<List<Person>>(emptyList())
    val people: StateFlow<List<Person>> = _people.asStateFlow()

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
                val info = runCatching { container.api(candidate).info() }.getOrNull() ?: continue

                if (candidate.startsWith("http://")) onInsecure(candidate)
                container.settings.setServerUrl(candidate)
                serverUrl = candidate
                _session.value = Session.NeedsLogin(candidate, info.name)
                return@launch
            }

            _session.value = Session.NeedsServer("unreachable")
        }
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

        val base = serverUrl ?: return
        viewModelScope.launch {
            runCatching { container.api(base).checklists(task.id) }
                .onSuccess { _openChecklists.value = it }
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
