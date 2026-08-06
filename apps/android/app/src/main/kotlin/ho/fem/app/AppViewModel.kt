package ho.fem.app

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ho.fem.data.Container
import ho.fem.model.AiMode
import ho.fem.model.Checklist
import ho.fem.model.EventOccurrence
import ho.fem.model.Inbox
import ho.fem.model.Person
import ho.fem.model.Project
import ho.fem.model.Scope
import ho.fem.model.Task
import ho.fem.model.TaskStatus
import ho.fem.model.serverCandidates
import ho.fem.network.FemhoApi
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

    private val _events = MutableStateFlow<List<EventOccurrence>>(emptyList())
    val events: StateFlow<List<EventOccurrence>> = _events.asStateFlow()

    private val _inbox = MutableStateFlow<Inbox?>(null)
    val inbox: StateFlow<Inbox?> = _inbox.asStateFlow()

    private val _openTask = MutableStateFlow<Task?>(null)
    val openTask: StateFlow<Task?> = _openTask.asStateFlow()

    private val _openChecklists = MutableStateFlow<List<Checklist>>(emptyList())
    val openChecklists: StateFlow<List<Checklist>> = _openChecklists.asStateFlow()

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
                if (container.tokens.refresh() != null) observe(saved)
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

    fun refresh() {
        val base = serverUrl ?: return
        viewModelScope.launch {
            val active = container.settings.activeScopes.first()
            runCatching { container.repository(base).refresh(active, null) }
        }
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
    fun open(task: Task) {
        _openTask.value = task
        _openChecklists.value = emptyList()

        val base = serverUrl ?: return
        viewModelScope.launch {
            runCatching { container.api(base).checklists(task.id) }
                .onSuccess { _openChecklists.value = it }
        }
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

    fun setTheme(value: String) {
        _theme.value = value
        viewModelScope.launch { container.settings.setTheme(value) }
    }

    fun setAccent(value: String) {
        _accent.value = value
        viewModelScope.launch { container.settings.setAccent(value) }
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

    fun create(scopeId: String, title: String) {
        val base = serverUrl ?: return
        viewModelScope.launch {
            val repository = container.repository(base)
            repository.createTask(scopeId, title, null)
            repository.flush()
        }
    }

    private fun observe(base: String) {
        val repository = container.repository(base)
        viewModelScope.launch { repository.tasks.collect { _tasks.value = it } }
        viewModelScope.launch { repository.scopes.collect { _scopes.value = it } }
        viewModelScope.launch { repository.projects.collect { _projects.value = it } }
        viewModelScope.launch { repository.people.collect { _people.value = it } }
        viewModelScope.launch { repository.pending.collect { _pending.value = it } }
    }
}
