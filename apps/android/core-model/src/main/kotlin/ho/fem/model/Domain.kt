package ho.fem.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Els models de domini. docs/01, docs/05 §4.
 *
 * **El vocabulari és el canònic** (regla 3, D2): `status` amb valors anglesos
 * `inbox·todo·doing·done`, `ai_mode` amb `manual·assisted·delegated`. Cap `column`, cap
 * valor d'enum en català. El que es tradueix és el que es veu, i això surt de
 * `strings.xml`.
 *
 * Els noms de camp són **els del JSON de l'API**, amb guió baix, i no els de Kotlin:
 * `@SerialName` a cada camp seria una llista d'oportunitats d'equivocar-se, i el dia que
 * una es perdi el camp arribarà nul sense que res falli.
 *
 * `AiMode` i `InstanceInfo` **no són aquí**: ja existien a `QuickAdd.kt` i a
 * `ServerUrl.kt`, que són anteriors i els fan servir. Declarar-los una segona vegada
 * hauria donat dos tipus amb el mateix nom i una conversió pel mig.
 */

@Serializable
enum class TaskStatus {
    @SerialName("inbox") INBOX,
    @SerialName("todo") TODO,
    @SerialName("doing") DOING,
    @SerialName("done") DONE,
}

@Serializable
enum class ScopeKind {
    @SerialName("individual") INDIVIDUAL,
    @SerialName("collective") COLLECTIVE,
}

@Serializable
data class Scope(
    val id: String,
    val name: String,
    val kind: ScopeKind = ScopeKind.INDIVIDUAL,
    /** Nom de token (`--plou-blue`), mai un literal de color (regla 5). */
    val color: String,
    val icon: String? = null,
    val position: String,
    @SerialName("owner_id") val ownerId: String,
    val version: Int = 1,
)

@Serializable
data class Project(
    val id: String,
    @SerialName("scope_id") val scopeId: String,
    val name: String,
    val position: String,
    @SerialName("archived_at") val archivedAt: String? = null,
    val version: Int = 1,
)

@Serializable
data class Task(
    val id: String,
    @SerialName("scope_id") val scopeId: String,
    @SerialName("project_id") val projectId: String? = null,
    val title: String,
    val description: String? = null,
    val status: TaskStatus = TaskStatus.INBOX,
    /** Índex fraccional calculat al client (D3). Veure `Position.kt`. */
    val position: String,
    @SerialName("due_date") val dueDate: String? = null,
    @SerialName("due_time") val dueTime: String? = null,
    @SerialName("completed_at") val completedAt: String? = null,
    @SerialName("ai_mode") val aiMode: AiMode = AiMode.MANUAL,
    @SerialName("delegate_agent_id") val delegateAgentId: String? = null,
    @SerialName("assignee_ids") val assigneeIds: List<String> = emptyList(),
    /**
     * L'agregat que la targeta plegada necessita: ítems fets, ítems totals, i quants
     * **blocs** desplegables hi ha. Ve del tauler; no hi és a les respostes velles i per
     * això és nul·lable.
     */
    val progress: TaskProgress? = null,
    val version: Int = 1,
)

/** Veure `Task.progress`. `lists` compta blocs —les subtasques en són un— i no ítems. */
@Serializable
data class TaskProgress(val done: Int = 0, val total: Int = 0, val lists: Int = 0)

/**
 * Un agent d'IA. **Només se'n mira si n'hi ha cap d'actiu**: és el que decideix si el
 * commutador del tauler de la IA surt.
 *
 * No és una preferència a part: un commutador que es pogués encendre sense cap agent
 * giraria el tauler cap a un tauler que no pot rebre res.
 */
@Serializable
data class Agent(
    val id: String,
    val name: String = "",
    val enabled: Boolean = false,
)

@Serializable
data class Subtask(
    val id: String,
    @SerialName("task_id") val taskId: String,
    val title: String,
    val done: Boolean = false,
    val position: String,
    val version: Int = 1,
)

@Serializable
data class ChecklistItem(
    val id: String,
    @SerialName("checklist_id") val checklistId: String,
    val text: String,
    val done: Boolean = false,
    val position: String,
)

@Serializable
data class Checklist(
    val id: String,
    @SerialName("task_id") val taskId: String,
    @SerialName("subtask_id") val subtaskId: String? = null,
    val name: String,
    val pinned: Boolean = false,
    @SerialName("show_completed_inline") val showCompletedInline: Boolean = true,
    val position: String,
    val items: List<ChecklistItem> = emptyList(),
    val version: Int = 1,
    /**
     * El títol de la tasca que la conté.
     *
     * Només ve a `/pinned-checklists`, on el menú ensenya "Tasca · Llista": dues llistes
     * que es diguin igual en tasques diferents són indistingibles pel nom.
     */
    @SerialName("task_title") val taskTitle: String? = null,
)

@Serializable
data class EventOccurrence(
    @SerialName("event_id") val eventId: String,
    val uid: String,
    val summary: String,
    val location: String? = null,
    @SerialName("starts_at") val startsAt: String,
    @SerialName("ends_at") val endsAt: String,
    @SerialName("all_day") val allDay: Boolean = false,
    @SerialName("scope_id") val scopeId: String,
    @SerialName("calendar_id") val calendarId: String = "",
    @SerialName("recurrence_id") val recurrenceId: String? = null,
    /**
     * Si aquesta cita és a la bústia de qui pregunta.
     *
     * **El calcula el servidor i aquí no es recalcula mai.** És el que fa que "difuminat
     * al calendari" i "no és a la meva bústia" siguin la mateixa cosa a les dues apps en
     * comptes de dues que un dia divergeixen.
     *
     * El defecte és `true` perquè un servidor antic no envia el camp: davant d'un
     * servidor que no en sap res, val més ensenyar-ho tot que amagar-ho tot.
     */
    @SerialName("in_inbox") val inInbox: Boolean = true,
) {
    /**
     * Una ocurrència **no té identitat pròpia**: dues del mateix mestre comparteixen
     * `event_id` (D8). La clau és l'esdeveniment més l'instant.
     */
    val key: String get() = "$eventId@$startsAt"
}

/**
 * El que arriba d'una font a la bústia d'un dia.
 *
 * **No és una `Task` i no ho ha de semblar mai**: no té estat de kanban ni posició, i cap
 * identificador d'aquí pot arribar a moure's entre columnes. És la forma que pren la
 * regla 7 esmenada, i per això té tipus propi en comptes de ser una `Task` amb camps
 * buits.
 */
/**
 * El resultat de marcar una cita.
 *
 * `inInbox` és **la resolució sencera** i no només el que s'ha desat: hi entren l'ajust
 * del calendari, el defecte de la mena de font i si ja n'hi ha una tasca viva. El client
 * no ho recalcula.
 */
@Serializable
data class InboxMark(
    val visible: Boolean? = null,
    @SerialName("in_inbox") val inInbox: Boolean = true,
)

@Serializable
data class InboxEvent(
    @SerialName("calendar_id") val calendarId: String,
    @SerialName("scope_id") val scopeId: String,
    val uid: String,
    @SerialName("recurrence_id") val recurrenceId: String? = null,
    val summary: String,
    val location: String? = null,
    @SerialName("starts_at") val startsAt: String,
    @SerialName("ends_at") val endsAt: String,
    @SerialName("all_day") val allDay: Boolean = false,
    @SerialName("source_kind") val sourceKind: String? = null,
    @SerialName("calendar_name") val calendarName: String = "",
    @SerialName("calendar_color") val calendarColor: String? = null,
) {
    /** La identitat externa, que és estable entre refrescos de la font. */
    val key: String get() = "$calendarId|$uid|${recurrenceId ?: ""}"
}

@Serializable
data class UserProfile(
    val id: String,
    val email: String? = null,
    val name: String,
    val role: String = "member",
    val timezone: String = "Europe/Madrid",
    /** L'idioma triat. Mana per damunt del que digui el dispositiu. */
    val locale: String = "ca",
    val theme: String = "system",
    val accent: String = "default",
)

@Serializable
data class Person(val id: String, val name: String)

@Serializable
data class BoardGroup(
    @SerialName("scope_id") val scopeId: String,
    val tasks: List<Task> = emptyList(),
)

@Serializable
data class BoardColumn(val status: TaskStatus, val groups: List<BoardGroup> = emptyList())

@Serializable
data class Board(val columns: List<BoardColumn> = emptyList()) {
    /** Totes les tasques, planes. La pantalla les torna a agrupar com li convingui. */
    val tasks: List<Task> get() = columns.flatMap { column -> column.groups.flatMap { it.tasks } }
}

@Serializable
data class Inbox(
    val date: String,
    val dated: List<Task> = emptyList(),
    val overdue: List<Task> = emptyList(),
    val undated: List<Task> = emptyList(),
    /**
     * El que arriba de les fonts aquell dia, ja filtrat pel servidor.
     *
     * **Amb valor per defecte**, com tota la resta: un servidor antic no l'envia i una app
     * nova no ha de petar per això.
     */
    val events: List<InboxEvent> = emptyList(),
)

@Serializable
data class AuthTokens(
    @SerialName("access_token") val accessToken: String,
    @SerialName("refresh_token") val refreshToken: String,
)
