package ho.fem.model

import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.intOrNull

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

/**
 * Booleans que SQLite entrega com a 0/1.
 *
 * El servidor serialitza algunes columnes de booleans directament des de SQLite
 * (writable, shared_with_scope, has_credentials) i surten com a enters 0/1, mentre que
 * d'altres (inbox_visible) passen per `maybeBool` i surten com a booleans de veritat.
 * Un serialitzador estricte trencaria la deserialització dels calendaris sense que res
 * fallés: l'error cauria dins d'un `runCatching` i la llista semblaria buida.
 */
object BooleanCoerce : KSerializer<Boolean> {
    override val descriptor = PrimitiveSerialDescriptor("BooleanCoerce", PrimitiveKind.BOOLEAN)

    override fun serialize(encoder: Encoder, value: Boolean) {
        encoder.encodeBoolean(value)
    }

    override fun deserialize(decoder: Decoder): Boolean {
        val element = (decoder as? JsonDecoder)?.decodeJsonElement() as? JsonPrimitive ?: return decoder.decodeBoolean()
        // Parèntesi obligatoris: `?:` lliga més fort que `!=` i `false != 0` seria true.
        return element.booleanOrNull ?: ((element.intOrNull ?: 0) != 0)
    }
}

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
    val deadline: String? = null,
    val rrule: String? = null,
    @SerialName("recurrence_mode") val recurrenceMode: RecurrenceMode? = null,
    @SerialName("ai_instructions") val aiInstructions: String? = null,
    @SerialName("task_type_id") val taskTypeId: String? = null,
    @SerialName("label_ids") val labelIds: List<String> = emptyList(),
    @SerialName("locked_until") val lockedUntil: String? = null,
    @SerialName("needs_attention") val needsAttention: Boolean = false,
    @SerialName("ai_last_read_at") val aiLastReadAt: String? = null,
    @SerialName("source_event") val sourceEvent: SourceEvent? = null,
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
    /**
     * Si surt a l'inbox de Tasques.
     *
     * **Amb valor per defecte, com tota la resta**: una app vella contra un servidor nou és
     * el cas normal, i la bústia no pot quedar buida perquè hagi arribat un camp de més.
     * El servidor sempre l'envia; el defecte és per a l'app que encara no el llegeix.
     */
    @SerialName("in_inbox") val inInbox: Boolean = true,
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

/**
 * Una pàgina de resultats de la cerca (`GET /api/v1/search`).
 *
 * El mateix `TaskPage` de la web (openapi.yaml:5923): l'app només en fa servir la
 * primera pàgina, amb `limit=8`, i els altres camps no cal ni llegir-los.
 */
@Serializable
data class TaskPage(
    val data: List<Task> = emptyList(),
    @SerialName("next_cursor") val nextCursor: String? = null,
    @SerialName("has_more") val hasMore: Boolean = false,
)

/** Un àmbit amb el recompte de pendents i vençudes, per a la targeta del dashboard. */
@Serializable
data class DashboardScope(
    @SerialName("scope_id") val scopeId: String,
    val name: String,
    val color: String = "",
    val pending: Int = 0,
    val overdue: Int = 0,
)

/**
 * El dashboard global (`GET /api/v1/dashboard`). docs/02 §8.
 *
 * **Ignora la selecció d'àmbits i de projecte: ho ensenya tot.** És el que el distingeix
 * del tauler, i el servidor no accepta cap filtre d'àmbit per la mateixa raó.
 */
@Serializable
data class DashboardView(
    val date: String = "",
    val scopes: List<DashboardScope> = emptyList(),
    val today: List<Task> = emptyList(),
    val overdue: List<Task> = emptyList(),
    val doing: List<Task> = emptyList(),
)

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

/* ---------------------------------------------------------------------------
 * Models de paritat amb la web (onades 2-10 del pla). El nom de camp és el wire
 * del servidor via @SerialName; els enums nous segueixen el patró de TaskStatus.
 * ------------------------------------------------------------------------- */

@Serializable
enum class SharePermission {
    @SerialName("view") VIEW,
    @SerialName("check") CHECK,
    @SerialName("comment") COMMENT,
}

@Serializable
enum class CalendarOrigin {
    @SerialName("local") LOCAL,
    @SerialName("subscription") SUBSCRIPTION,
}

@Serializable
enum class SourceKind {
    @SerialName("caldav") CALDAV,
    @SerialName("ical") ICAL,
    @SerialName("rss") RSS,
}

@Serializable
enum class MailSecurity {
    @SerialName("tls") TLS,
    @SerialName("starttls") STARTTLS,
}

@Serializable
enum class RecurrenceMode {
    @SerialName("schedule") SCHEDULE,
    @SerialName("completion") COMPLETION,
}

/** L'origen d'una tasca creada a partir d'una cita (P6: neix independent). */
@Serializable
data class SourceEvent(
    @SerialName("calendar_id") val calendarId: String,
    val uid: String,
    @SerialName("recurrence_id") val recurrenceId: String? = null,
)

@Serializable
data class Label(
    val id: String,
    @SerialName("scope_id") val scopeId: String,
    val name: String,
    val color: String? = null,
    @SerialName("created_at") val createdAt: String? = null,
)

@Serializable
data class TaskType(
    val id: String,
    @SerialName("scope_id") val scopeId: String,
    val name: String,
    val color: String? = null,
    val position: String? = null,
    val required: Boolean = false,
)

@Serializable
data class Comment(
    val id: String,
    @SerialName("task_id") val taskId: String,
    @SerialName("author_id") val authorId: String? = null,
    @SerialName("author_name") val authorName: String? = null,
    @SerialName("agent_id") val agentId: String? = null,
    val body: String,
    @SerialName("created_at") val createdAt: String,
)

@Serializable
data class ActivityEntry(
    val id: String,
    @SerialName("entity_type") val entityType: String,
    @SerialName("entity_id") val entityId: String,
    val verb: String,
    @SerialName("actor_type") val actorType: String,
    @SerialName("actor_user_id") val actorUserId: String? = null,
    @SerialName("actor_agent_id") val actorAgentId: String? = null,
    @SerialName("actor_label") val actorLabel: String? = null,
    val source: String = "",
    val changes: Map<String, ActivityChange>? = null,
    @SerialName("created_at") val createdAt: String,
    val undoable: Boolean = false,
)

@Serializable
data class ActivityChange(
    @Serializable(with = ChangeValueCoerce::class) val from: String? = null,
    @Serializable(with = ChangeValueCoerce::class) val to: String? = null,
)

/**
 * Els valors de `changes` no són sempre text: `{labels: {from: false, to: true}}`
 * porta booleans quan la columna canvia d'estat. Un camp String estricte trencaria la
 * deserialització de tot l'historial dins d'un runCatching i la llista semblaria buida.
 */
object ChangeValueCoerce : KSerializer<String?> {
    override val descriptor = PrimitiveSerialDescriptor("ChangeValueCoerce", PrimitiveKind.STRING)

    override fun serialize(encoder: Encoder, value: String?) {
        if (value == null) encoder.encodeNull() else encoder.encodeString(value)
    }

    override fun deserialize(decoder: Decoder): String? {
        val element = (decoder as? JsonDecoder)?.decodeJsonElement()
        return when (element) {
            is JsonPrimitive -> element.booleanOrNull?.toString() ?: element.intOrNull?.toString() ?: element.content
            null -> null
            else -> null
        }
    }
}

/** La resposta de GET /tasks/{id}/activity ve embolicada en {data: [...]}. */
@Serializable
data class ActivityEnvelope(
    val data: List<ActivityEntry> = emptyList(),
)

@Serializable
data class Attachment(
    val id: String,
    @SerialName("task_id") val taskId: String? = null,
    @SerialName("event_id") val eventId: String? = null,
    @SerialName("scope_id") val scopeId: String? = null,
    val filename: String,
    @SerialName("mime_type") val mimeType: String,
    @SerialName("size_bytes") val sizeBytes: Long,
    @Serializable(with = BooleanCoerce::class) @SerialName("is_ai_context") val isAiContext: Boolean = false,
    @SerialName("created_at") val createdAt: String,
)

/** El bloc base que s'escriu sencer (no hi ha cronòmetre: P27). */
@Serializable
data class Session(
    val id: String,
    @SerialName("task_id") val taskId: String,
    @SerialName("scope_id") val scopeId: String? = null,
    @SerialName("user_id") val userId: String,
    @SerialName("started_at") val startedAt: String,
    @SerialName("ended_at") val endedAt: String? = null,
    val source: String? = null,
    val note: String? = null,
)

/** El bloc enriquit que torna GET /sessions, amb la tasca i el projecte resolts. */
@Serializable
data class SessionEntry(
    val id: String,
    @SerialName("task_id") val taskId: String,
    @SerialName("task_title") val taskTitle: String? = null,
    @SerialName("project_id") val projectId: String? = null,
    @SerialName("project_name") val projectName: String? = null,
    @SerialName("scope_id") val scopeId: String? = null,
    @SerialName("user_id") val userId: String,
    @SerialName("user_name") val userName: String? = null,
    @SerialName("task_type_id") val taskTypeId: String? = null,
    @SerialName("task_type_name") val taskTypeName: String? = null,
    @SerialName("task_type_color") val taskTypeColor: String? = null,
    @SerialName("started_at") val startedAt: String,
    @SerialName("ended_at") val endedAt: String? = null,
    val minutes: Long = 0,
    @SerialName("overtime_minutes") val overtimeMinutes: Long = 0,
    @SerialName("needs_review") val needsReview: Boolean = false,
    val open: Boolean = false,
    val source: String? = null,
    val note: String? = null,
)

@Serializable
data class SessionBucket(
    val key: String,
    val label: String? = null,
    val minutes: Long = 0,
    @SerialName("overtime_minutes") val overtimeMinutes: Long = 0,
)

@Serializable
data class SessionTotals(
    val minutes: Long = 0,
    @SerialName("overtime_minutes") val overtimeMinutes: Long = 0,
    val tasks: Long = 0,
    @SerialName("by_user") val byUser: List<SessionBucket> = emptyList(),
    @SerialName("by_project") val byProject: List<SessionBucket> = emptyList(),
    @SerialName("by_day") val byDay: List<SessionBucket> = emptyList(),
)

@Serializable
data class SessionReport(
    val data: List<SessionEntry> = emptyList(),
    val totals: SessionTotals = SessionTotals(),
)

@Serializable
data class SessionStats(
    val tasks: Long = 0,
    val minutes: Long = 0,
    @SerialName("overtime_minutes") val overtimeMinutes: Long = 0,
    val projects: Long = 0,
    @SerialName("average_minutes") val averageMinutes: Double = 0.0,
    val evolution: List<SessionEvolutionPoint> = emptyList(),
    val weekly: Boolean = false,
    @SerialName("by_type") val byType: List<SessionBucket> = emptyList(),
    @SerialName("by_project") val byProject: List<SessionBucket> = emptyList(),
    @SerialName("by_user") val byUser: List<SessionBucket> = emptyList(),
    @SerialName("overtime_by_project") val overtimeByProject: List<SessionBucket> = emptyList(),
)

@Serializable
data class SessionEvolutionPoint(
    val key: String,
    val minutes: Long = 0,
)

@Serializable
data class MailAccount(
    val id: String,
    val name: String,
    val host: String,
    val username: String,
    /** El servidor mai retorna la contrasenya; només diu si n'hi ha una de desada. */
    @SerialName("has_secret") val hasSecret: Boolean = false,
    val security: MailSecurity = MailSecurity.TLS,
    @SerialName("created_at") val createdAt: String? = null,
)

@Serializable
data class MailRule(
    val id: String,
    @SerialName("account_id") val accountId: String? = null,
    @SerialName("account_name") val accountName: String? = null,
    val folder: String,
    @SerialName("scope_id") val scopeId: String? = null,
    @SerialName("project_id") val projectId: String? = null,
    @SerialName("title_template") val titleTemplate: String? = null,
    @SerialName("inbox_visible") val inboxVisible: Boolean? = null,
)

@Serializable
data class MailTestResult(
    val ok: Boolean = false,
    val error: String? = null,
)

@Serializable
data class Calendar(
    val id: String,
    @SerialName("scope_id") val scopeId: String? = null,
    @SerialName("project_id") val projectId: String? = null,
    val name: String,
    val color: String? = null,
    val origin: CalendarOrigin = CalendarOrigin.LOCAL,
    @SerialName("source_kind") val sourceKind: SourceKind? = null,
    @SerialName("source_url") val sourceUrl: String? = null,
    @SerialName("source_username") val sourceUsername: String? = null,
    @Serializable(with = BooleanCoerce::class) val writable: Boolean = false,
    @SerialName("refresh_interval") val refreshInterval: Int? = null,
    @SerialName("inbox_visible") val inboxVisible: Boolean? = null,
    @SerialName("inbox_visible_default") val inboxVisibleDefault: Boolean = true,
    @SerialName("last_refreshed_at") val lastRefreshedAt: String? = null,
    @SerialName("last_error") val lastError: String? = null,
    @SerialName("last_error_at") val lastErrorAt: String? = null,
    @SerialName("shared_with_scope") @Serializable(with = BooleanCoerce::class) val sharedWithScope: Boolean = false,
    @SerialName("has_credentials") @Serializable(with = BooleanCoerce::class) val hasCredentials: Boolean = false,
)

@Serializable
data class ShareSummary(
    val id: String,
    @SerialName("task_id") val taskId: String? = null,
    @SerialName("checklist_id") val checklistId: String? = null,
    val permission: SharePermission = SharePermission.VIEW,
    @SerialName("require_name") val requireName: Boolean = false,
    @SerialName("has_password") val hasPassword: Boolean = false,
    @SerialName("expires_at") val expiresAt: String? = null,
    @SerialName("max_views") val maxViews: Int? = null,
    val views: Int = 0,
    @SerialName("revoked_at") val revokedAt: String? = null,
)

@Serializable
data class ShareAccess(
    val id: String,
    val label: String? = null,
    @SerialName("first_seen") val firstSeen: String? = null,
    @SerialName("last_seen") val lastSeen: String? = null,
)

/**
 * La resposta de crear un enllaç compartit.
 *
 * L'URL sencer va aquí i enlloc més: del `token_hmac` no se'n pot treure (docs/10 §6).
 * Els camps extra (el `share` complet) s'ignoren gràcies a `ignoreUnknownKeys`.
 */
@Serializable
data class ShareCreated(
    val url: String,
    val token: String = "",
)

/** El preview d'un convit d'àmbit, per mirar-lo abans d'acceptar (docs/10). */
@Serializable
data class JoinPreview(
    val kind: String = "scope_invite",
    @SerialName("scope_name") val scopeName: String = "",
    val role: String = "collaborator",
    @SerialName("invited_by") val invitedBy: String = "",
)

@Serializable
data class ScopeSettings(
    @SerialName("time_tracking") val timeTracking: Boolean = false,
    @SerialName("work_start") val workStart: String? = null,
    @SerialName("work_end") val workEnd: String? = null,
    // El servidor el serialitza com a string de set dígits ("1111100" = dll..dg).
    @SerialName("work_days") val workDays: String = "",
    @SerialName("overtime_visible") val overtimeVisible: Boolean = false,
    @SerialName("long_session_hours") val longSessionHours: Int = 8,
    @SerialName("project_noun") val projectNoun: String = "project",
    @SerialName("task_types_enabled") val taskTypesEnabled: Boolean = false,
)

@Serializable
data class AdminUser(
    val id: String,
    val name: String,
    val email: String,
    val role: String = "member",
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("invite_pending") val invitePending: Boolean = false,
)

@Serializable
data class ApiTokenSummary(
    val id: String,
    val name: String = "",
    val prefix: String,
    @SerialName("created_at") val createdAt: String,
    @SerialName("last_used_at") val lastUsedAt: String? = null,
    @SerialName("revoked_at") val revokedAt: String? = null,
    @SerialName("ai_agent_id") val aiAgentId: String? = null,
    val capabilities: List<String> = emptyList(),
)

/** L'agent estès que Ajustos ▸ Usuari IA necessita (el simple ja viu a dalt). */
@Serializable
data class AgentDetail(
    val id: String,
    val name: String = "",
    val enabled: Boolean = false,
    @SerialName("can_create_tasks") val canCreateTasks: Boolean = false,
    @SerialName("scope_ids") val scopeIds: List<String> = emptyList(),
    @SerialName("all_scopes") val allScopes: Boolean = false,
    @SerialName("created_at") val createdAt: String? = null,
)

/**
 * Un àmbit i qui el porta, per a la pestanya Usuari IA.
 *
 * `taken_by` només hi és quan un altre agent ja el té: la casella surt desactivada amb
 * el seu nom, perquè saber a qui anar és el següent pas i deixar marcar per respondre
 * amb un error després no ho és (el mateix criteri que la web).
 */
@Serializable
data class AgentScopeAvailability(
    @SerialName("scope_id") val scopeId: String,
    @SerialName("taken_by") val takenBy: AgentTakenBy? = null,
)

@Serializable
data class AgentTakenBy(
    val name: String = "",
)

/** El servidor embolica les llistes de disponibilitat d'àmbits en `{data: [...]}`. */
@Serializable
data class AgentScopeEnvelope(
    val data: List<AgentScopeAvailability> = emptyList(),
)

/** El servidor embolica les llistes de credencials en `{data: [...]}`. */
@Serializable
data class CredentialEnvelope(
    val data: List<ApiTokenSummary> = emptyList(),
)
