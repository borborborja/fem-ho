package ho.fem.data

import androidx.room.ColumnInfo
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Transaction
import androidx.room.Update
import androidx.room.RoomDatabase
import ho.fem.model.CalendarTaskSuggestions
import ho.fem.model.TaskStatus
import kotlinx.coroutines.flow.Flow
import java.time.Instant

private const val WIDGET_COLUMN_LIMIT = 25

private val UNSTARTED_TASK_STATUSES = setOf("inbox", "todo")

/**
 * La base local. docs/03 §11, docs/06 §1.
 *
 * **Els repositoris exposen fluxos des d'aquí i cap pantalla crida la xarxa
 * directament.** És el que fa que l'app funcioni igual amb connexió i sense: la pantalla
 * no sap si el que llegeix acaba d'arribar del servidor o fa tres dies que hi és.
 *
 * L'esquema és el mínim per pintar les pantalles, no una còpia del servidor. El que no
 * es pinta —l'historial sencer, els adjunts, els calendaris externs— es demana quan cal
 * i no es replica: replicar-ho tot faria la primera sincronització llarga i el guany
 * seria zero.
 *
 * **`position` porta el desempat per `id` a totes les consultes ordenades**, com al
 * servidor: amb el jitter (D3) dues claus poden coincidir, i sense desempat el mòbil i
 * la web ensenyarien ordres diferents.
 */

@Entity(tableName = "tasks")
data class TaskEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "scope_id") val scopeId: String,
    @ColumnInfo(name = "project_id") val projectId: String?,
    val title: String,
    val description: String?,
    val status: String,
    val position: String,
    @ColumnInfo(name = "due_date") val dueDate: String?,
    @ColumnInfo(name = "due_time") val dueTime: String?,
    @ColumnInfo(name = "completed_at") val completedAt: String?,
    @ColumnInfo(name = "ai_mode") val aiMode: String,
    @ColumnInfo(name = "assignee_ids") val assigneeIds: String,
    val version: Int,
    /** Esborrat suau: arriba pel sync i no es pot esborrar la fila (docs/06 §7). */
    @ColumnInfo(name = "deleted") val deleted: Boolean = false,
    /** La resta del contracte de Task, per conservar els detalls que el tauler no indexa. */
    @ColumnInfo(name = "task_json") val taskJson: String? = null,
)

@Entity(tableName = "task_lists")
data class TaskListsEntity(
    @PrimaryKey @ColumnInfo(name = "task_id") val taskId: String,
    val subtasks: String,
    val checklists: String,
)

@Entity(tableName = "scopes")
data class ScopeEntity(
    @PrimaryKey val id: String,
    val name: String,
    val kind: String,
    val color: String,
    val position: String,
)

@Entity(tableName = "projects")
data class ProjectEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "scope_id") val scopeId: String,
    val name: String,
    val position: String,
)

@Entity(tableName = "people")
data class PersonEntity(@PrimaryKey val id: String, val name: String)

/**
 * Etiquetes. docs/01, docs/05 §4.
 *
 * **Escriptura en línia**: no van a la cua de sortida. El servidor les gestiona directament
 * i el client les llegeix i les mostra. Només es desa localment per pintar la UI.
 */
@Entity(tableName = "labels")
data class LabelEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "scope_id") val scopeId: String,
    val name: String,
    val color: String?,
    @ColumnInfo(name = "created_at") val createdAt: String?,
)

/**
 * Tipologies de tasca. docs/01.
 *
 * **Escriptura en línia**: no van a la cua de sortida.
 */
@Entity(tableName = "task_types")
data class TaskTypeEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "scope_id") val scopeId: String,
    val name: String,
    val color: String?,
    val position: String?,
    val required: Boolean = false,
)

/**
 * Comentaris d'una tasca. docs/01.
 *
 * **Pot encuar-se**: `comment` és a la llista d'entitats de la cua (sync.ts:64-70).
 * Per simplificar en aquesta passada, es tracta com a escriptura en línia.
 */
@Entity(tableName = "comments")
data class CommentEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "task_id") val taskId: String,
    @ColumnInfo(name = "author_id") val authorId: String?,
    @ColumnInfo(name = "author_name") val authorName: String?,
    @ColumnInfo(name = "agent_id") val agentId: String?,
    val body: String,
    @ColumnInfo(name = "created_at") val createdAt: String,
)

/**
 * Sessions de dedicació (registre). docs/01.
 *
 * **Escriptura en línia**: no hi ha suport d'outbox per a sessions en aquesta passada.
 */
@Entity(tableName = "sessions")
data class SessionEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "task_id") val taskId: String,
    @ColumnInfo(name = "scope_id") val scopeId: String?,
    @ColumnInfo(name = "user_id") val userId: String,
    @ColumnInfo(name = "started_at") val startedAt: String,
    @ColumnInfo(name = "ended_at") val endedAt: String?,
    val source: String?,
    val note: String?,
)

/**
 * Calendaris i fonts externes. docs/01, docs/08.
 *
 * **Escriptura en línia**: no van a la cua. El servidor gestiona el refresc de fonts.
 */
@Entity(tableName = "calendars")
data class CalendarEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "scope_id") val scopeId: String?,
    @ColumnInfo(name = "project_id") val projectId: String?,
    val name: String,
    val color: String?,
    val origin: String = "local",
    @ColumnInfo(name = "source_kind") val sourceKind: String?,
    @ColumnInfo(name = "source_url") val sourceUrl: String?,
    @ColumnInfo(name = "refresh_interval") val refreshInterval: Int?,
    @ColumnInfo(name = "inbox_visible") val inboxVisible: Boolean? = null,
    @ColumnInfo(name = "last_refreshed_at") val lastRefreshedAt: String?,
    @ColumnInfo(name = "last_error") val lastError: String?,
    @ColumnInfo(name = "shared_with_scope") val sharedWithScope: Boolean = false,
)

/**
 * Comptes de correu IMAP. docs/07.
 *
 * **Escriptura en línia**: no van a la cua. Les credencials es guarden al servidor.
 */
@Entity(tableName = "mail_accounts")
data class MailAccountEntity(
    @PrimaryKey val id: String,
    val name: String,
    val host: String,
    val username: String,
    @ColumnInfo(name = "has_secret") val hasSecret: Boolean = false,
    @ColumnInfo(name = "auth_method", defaultValue = "'password'") val authMethod: String = "password",
    @ColumnInfo(name = "oauth_status") val oauthStatus: String? = null,
    val security: String = "tls",
    @ColumnInfo(name = "created_at") val createdAt: String?,
)

/**
 * Regles de correu. docs/07.
 *
 * **Escriptura en línia**: no van a la cua.
 */
@Entity(tableName = "mail_rules")
data class MailRuleEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "account_id") val accountId: String?,
    val folder: String,
    @ColumnInfo(name = "scope_id") val scopeId: String?,
    @ColumnInfo(name = "project_id") val projectId: String?,
    @ColumnInfo(name = "title_template") val titleTemplate: String?,
    @ColumnInfo(name = "inbox_visible") val inboxVisible: Boolean? = null,
)

/**
 * Configuració d'àmbit (time tracking, noun, etc.). docs/01.
 *
 * **Escriptura en línia**: no va a la cua.
 */
@Entity(tableName = "scope_settings")
data class ScopeSettingsEntity(
    @PrimaryKey @ColumnInfo(name = "scope_id") val scopeId: String,
    @ColumnInfo(name = "time_tracking") val timeTracking: Boolean = false,
    @ColumnInfo(name = "work_start") val workStart: String?,
    @ColumnInfo(name = "work_end") val workEnd: String?,
    @ColumnInfo(name = "work_days") val workDays: String, // "1,2,3,4,5" serialitzat
    @ColumnInfo(name = "overtime_visible") val overtimeVisible: Boolean = false,
    @ColumnInfo(name = "long_session_hours") val longSessionHours: Int = 8,
    @ColumnInfo(name = "project_noun") val projectNoun: String = "projecte",
    @ColumnInfo(name = "task_types_enabled") val taskTypesEnabled: Boolean = false,
)

/**
 * Agents d'IA. docs/01.
 *
 * **Escriptura en línia**: no va a la cua.
 */
@Entity(tableName = "agents")
data class AgentEntity(
    @PrimaryKey val id: String,
    val name: String = "",
    val enabled: Boolean = false,
    @ColumnInfo(name = "can_create_tasks") val canCreateTasks: Boolean = false,
    @ColumnInfo(name = "scope_ids") val scopeIds: String = "", // "id1,id2" serialitzat
    @ColumnInfo(name = "all_scopes") val allScopes: Boolean = false,
    @ColumnInfo(name = "created_at") val createdAt: String?,
)

/**
 * La cua de sortida. docs/06 §4.
 *
 * `op_id` és la clau d'idempotència i el genera el client: si la petició es perd i es
 * reintenta, el servidor reconeix que és la mateixa i no la duplica.
 */
@Entity(tableName = "outbox")
data class OutboxEntity(
    @PrimaryKey @ColumnInfo(name = "op_id") val opId: String,
    val entity: String,
    val op: String,
    @ColumnInfo(name = "entity_id") val entityId: String,
    @ColumnInfo(name = "base_version") val baseVersion: Int,
    /** El cos, ja serialitzat. La cua no ha d'entendre què transporta. */
    val payload: String,
    @ColumnInfo(name = "queued_at") val queuedAt: Long,
    val attempts: Int = 0,
    @ColumnInfo(defaultValue = "'pending'") val state: String = "pending",
    @ColumnInfo(name = "task_id") val taskId: String? = null,
    @ColumnInfo(name = "parent_id") val parentId: String? = null,
    @ColumnInfo(name = "base_fields") val baseFields: String? = null,
    @ColumnInfo(name = "server_entity") val serverEntity: String? = null,
    val detail: String? = null,
)

@Entity(tableName = "pomodoro_cache")
data class PomodoroCacheEntity(
    @PrimaryKey val id: Int = 0,
    val snapshot: String,
    @ColumnInfo(name = "clock_offset_ms") val clockOffsetMs: Long,
    @ColumnInfo(name = "issue_id") val issueId: String? = null,
)

@Entity(tableName = "calendar_suggestions_cache")
data class CalendarSuggestionsCacheEntity(
    @PrimaryKey val id: Int = 0,
    val snapshot: String,
    @ColumnInfo(name = "issue_id") val issueId: String? = null,
)

@Entity(tableName = "doing_auto_stop_cache")
data class DoingAutoStopCacheEntity(
    @PrimaryKey val id: Int = 0,
    val minutes: Int? = null,
    @ColumnInfo(name = "issue_id") val issueId: String? = null,
)

/** El resultat de `countByStatus`. No és una taula: és la projecció d'un `GROUP BY`. */
data class StatusCount(val status: String, val total: Int)

@Dao
interface FemhoDao {
    @Query("SELECT * FROM tasks WHERE deleted = 0 ORDER BY position, id")
    fun tasks(): Flow<List<TaskEntity>>

    @Query("SELECT * FROM tasks WHERE id = :id AND deleted = 0")
    fun task(id: String): Flow<TaskEntity?>

    @Query("SELECT * FROM tasks WHERE id = :id")
    suspend fun taskRow(id: String): TaskEntity?

    @Query("SELECT * FROM tasks WHERE id IN (:ids)")
    suspend fun taskRowsByIds(ids: List<String>): List<TaskEntity>

    @Query("SELECT * FROM tasks")
    suspend fun taskRows(): List<TaskEntity>

    @Query("DELETE FROM tasks WHERE id = :id")
    suspend fun removeTask(id: String)

    /**
     * L'última posició d'una columna, per posar-hi una targeta nova al final.
     *
     * Amb desempat per `id`, com al servidor: amb el jitter (D3) dues claus poden
     * coincidir, i sense desempat "l'última" seria una o l'altra segons el dia.
     */
    @Query(
        "SELECT position FROM tasks WHERE scope_id = :scopeId AND status = :status " +
            "AND deleted = 0 ORDER BY position DESC, id DESC LIMIT 1",
    )
    suspend fun lastPosition(scopeId: String, status: String): String?

    // -------------------------------------------------- lectures per als widgets

    /**
     * El que venç avui o abans, dels àmbits demanats.
     *
     * **`due_date <= :today`, no `= :today`.** Una tasca d'ahir sense fer segueix sent
     * d'avui per a qui la mira; amagar-la seria el tipus de mentida que fa que la gent
     * deixi de fiar-se de la llista. Separar-la visualment ja és feina de qui pinta.
     *
     * `due_time IS NULL` a l'ordre posa les que tenen hora abans que les que no: SQLite
     * ordena 0 (fals) abans que 1. Desempat per `id`, com totes les ordenades (D3).
     */
    @Query(
        "SELECT * FROM tasks WHERE deleted = 0 AND status != 'done' AND completed_at IS NULL " +
            "AND due_date IS NOT NULL AND due_date <= :today AND scope_id IN (:scopeIds) " +
            "ORDER BY due_date, due_time IS NULL, due_time, position, id LIMIT :limit",
    )
    suspend fun dueBy(today: String, scopeIds: List<String>, limit: Int): List<TaskEntity>

    /** Les que ja han vençut, per al distintiu. Estrictament abans d'avui. */
    @Query(
        "SELECT COUNT(*) FROM tasks WHERE deleted = 0 AND status != 'done' " +
            "AND due_date IS NOT NULL AND due_date < :today AND scope_id IN (:scopeIds)",
    )
    suspend fun overdueCount(today: String, scopeIds: List<String>): Int

    /**
     * Els comptadors de les quatre columnes, en una consulta.
     *
     * Les columnes buides **no surten**: `GROUP BY` no inventa files. Qui ho pinti hi ha
     * de posar el zero, i per això `LocalReads` torna un mapa amb les quatre sempre.
     */
    @Query(
        "SELECT status, COUNT(*) AS total FROM tasks WHERE deleted = 0 " +
            "AND scope_id IN (:scopeIds) GROUP BY status",
    )
    suspend fun countByStatus(scopeIds: List<String>): List<StatusCount>

    /**
     * Les mateixes taules que els fluxos, però d'una sola lectura.
     *
     * Un widget pinta un cop i mor: subscriure's a un `Flow` per llegir-lo una vegada
     * deixa una col·lecció oberta en un procés que el sistema matarà de seguida.
     */
    @Query("SELECT * FROM scopes ORDER BY position, id")
    suspend fun scopesOnce(): List<ScopeEntity>

    @Query("SELECT * FROM projects ORDER BY position, id")
    suspend fun projectsOnce(): List<ProjectEntity>

    @Query("SELECT * FROM people ORDER BY name, id")
    suspend fun peopleOnce(): List<PersonEntity>

    // ---------------------------------------------------------------------------

    @Query("SELECT * FROM scopes ORDER BY position, id")
    fun scopes(): Flow<List<ScopeEntity>>

    @Query("SELECT * FROM projects ORDER BY position, id")
    fun projects(): Flow<List<ProjectEntity>>

    @Query("SELECT * FROM people ORDER BY name, id")
    fun people(): Flow<List<PersonEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putTasks(rows: List<TaskEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putScopes(rows: List<ScopeEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putProjects(rows: List<ProjectEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putPeople(rows: List<PersonEntity>)

    @Query("DELETE FROM tasks")
    suspend fun clearTasks()

    /**
     * Buidar i tornar a omplir, **en una sola transacció**.
     *
     * Fer-ho en dos passos deixa una finestra en què la taula és buida, i qualsevol que
     * llegeixi just allà veu zero tasques. A la pantalla és un parpelleig; a un widget de
     * la pantalla d'inici és un "Res per avui" que es queda fins al proper refresc.
     * Es va veure exactament així a l'emulador.
     */
    @Query("SELECT * FROM tasks WHERE id IN (SELECT COALESCE(task_id, entity_id) FROM outbox WHERE task_id IS NOT NULL OR entity = 'task')")
    suspend fun pendingTasks(): List<TaskEntity>

    @Transaction
    suspend fun replaceBoard(
        scopes: List<ScopeEntity>,
        projects: List<ProjectEntity>,
        people: List<PersonEntity>,
        rows: List<TaskEntity>,
        fetchedScopes: List<String>,
        projectId: String?,
    ) {
        val visible = scopes.map { it.id }.toSet()
        val fetched = fetchedScopes.toSet()
        val preserved = (taskRows().filter {
            it.scopeId in visible && (it.scopeId !in fetched || (projectId != null && it.projectId != projectId))
        } + pendingTasks().filter { it.scopeId in visible }).associateBy { it.id }
        clearRevokedScopeIssues(scopes.map { it.id })
        clearScopes()
        clearProjects()
        putScopes(scopes)
        putProjects(projects)
        if (people.isNotEmpty()) {
            clearPeople()
            putPeople(people)
        }
        clearTasks()
        putTasks(rows.filter { it.id !in preserved && it.scopeId in visible } + preserved.values)
        purgeOrphanTaskLists()
        purgeOrphanComments()
    }

    @Query("DELETE FROM scopes")
    suspend fun clearScopes()

    @Query("DELETE FROM projects")
    suspend fun clearProjects()

    @Query("DELETE FROM people")
    suspend fun clearPeople()

    @Transaction
    suspend fun putTaskAndEnqueue(task: TaskEntity, operation: OutboxEntity) {
        putTasks(listOf(task))
        enqueue(operation)
    }

    @Query("SELECT * FROM pomodoro_cache WHERE id = 0")
    fun pomodoroCache(): Flow<PomodoroCacheEntity?>

    @Query("SELECT * FROM pomodoro_cache WHERE id = 0")
    suspend fun pomodoroCacheOnce(): PomodoroCacheEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putPomodoroCache(cache: PomodoroCacheEntity)

    @Query("UPDATE pomodoro_cache SET issue_id = NULL WHERE id = 0 AND issue_id = :issueId")
    suspend fun clearPomodoroIssue(issueId: String)

    @Transaction
    suspend fun resolvePomodoroOperations(
        cache: PomodoroCacheEntity,
        removed: List<String>,
        tasks: List<TaskEntity>,
        rebased: List<OutboxEntity>,
    ) {
        putPomodoroCache(cache)
        putTasks(tasks)
        rebased.forEach { updateOperation(it) }
        removed.forEach { dequeue(it) }
    }

    @Query("SELECT * FROM calendar_suggestions_cache WHERE id = 0")
    fun calendarSuggestionsCache(): Flow<CalendarSuggestionsCacheEntity?>

    @Query("SELECT * FROM calendar_suggestions_cache WHERE id = 0")
    suspend fun calendarSuggestionsCacheOnce(): CalendarSuggestionsCacheEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putCalendarSuggestionsCache(cache: CalendarSuggestionsCacheEntity)

    @Query("UPDATE calendar_suggestions_cache SET issue_id = NULL WHERE id = 0 AND issue_id = :issueId")
    suspend fun clearCalendarSuggestionsIssue(issueId: String)

    @Query("SELECT * FROM doing_auto_stop_cache WHERE id = 0")
    fun doingAutoStopCache(): Flow<DoingAutoStopCacheEntity?>

    @Query("SELECT * FROM doing_auto_stop_cache WHERE id = 0")
    suspend fun doingAutoStopCacheOnce(): DoingAutoStopCacheEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putDoingAutoStopCache(cache: DoingAutoStopCacheEntity)

    @Query("UPDATE doing_auto_stop_cache SET issue_id = NULL WHERE id = 0 AND issue_id = :issueId")
    suspend fun clearDoingAutoStopIssue(issueId: String)

    @Transaction
    suspend fun resolveDoingAutoStop(cache: DoingAutoStopCacheEntity, opId: String) {
        putDoingAutoStopCache(cache)
        dequeue(opId)
    }

    @Query("DELETE FROM tasks WHERE id = :id")
    suspend fun removeUnconfirmedCalendarTask(id: String)

    @Transaction
    suspend fun resolveCalendarSuggestionOperations(
        cache: CalendarSuggestionsCacheEntity,
        removed: List<String>,
        tasks: List<TaskEntity>,
        rebased: List<OutboxEntity>,
        removeTaskId: String?,
    ) {
        putCalendarSuggestionsCache(cache)
        if (removeTaskId != null) removeUnconfirmedCalendarTask(removeTaskId)
        putTasks(tasks)
        rebased.forEach { updateOperation(it) }
        removed.forEach { dequeue(it) }
    }

    @Query("SELECT * FROM tasks WHERE deleted=0 AND status=:status AND scope_id IN (:scopeIds) ORDER BY position, id LIMIT :limit")
    suspend fun columnTasks(status: String, scopeIds: List<String>, limit: Int): List<TaskEntity>

    @Transaction
    suspend fun taskBoardSnapshot(activeScopeIds: List<String>, activeProjectIds: List<String>, now: Instant): TaskBoardSnapshot {
        val scopes = scopesOnce().filter { activeScopeIds.isEmpty() || it.id in activeScopeIds }
        val ids = scopes.map { it.id }
        val statuses = listOf(TaskStatus.INBOX, TaskStatus.TODO, TaskStatus.DOING)
        val counts = countByStatus(ids).associate { it.status to it.total }
        val calendar = calendarSuggestionsCacheOnce()?.let { projectCalendarSuggestions(it, outbox()) }
            ?: CalendarTaskSuggestions()
        val visible = calendar.visibleItems(now)
        val filteredScopes = if (visible.isEmpty() || activeProjectIds.isEmpty()) emptySet() else
            projectsOnce().filter { it.id in activeProjectIds }.map { it.scopeId }.toSet()
        val candidates = visible.filter {
            it.scopeId in ids && (it.scopeId !in filteredScopes || it.projectId in activeProjectIds)
        }
        val linked = candidates.mapNotNull { it.taskId }.distinct().chunked(500)
            .flatMap { taskRowsByIds(it) }.associateBy { it.id }
        val scheduled = candidates.filter { suggestion ->
            val task = linked[suggestion.taskId]
            task == null || (!task.deleted && task.status in UNSTARTED_TASK_STATUSES)
        }.distinctBy { it.taskId ?: it.occurrence }
        val suggestions = scheduled.groupBy { it.column(now) }
        // Una proposta substitueix la targeta vinculada encara que la tasca quedi
        // fora de les primeres 25. Cal conservar el recompte i omplir el seu lloc.
        val replacedIds = scheduled.mapNotNull { it.taskId }.toSet()
        val replacedCounts = linked.values.filter { it.id in replacedIds && it.scopeId in ids }
            .groupingBy { it.status }.eachCount()
        return TaskBoardSnapshot(
            columns = statuses.associateWith { status ->
                val key = status.name.lowercase()
                val remaining = (WIDGET_COLUMN_LIMIT - suggestions[status].orEmpty().size).coerceAtLeast(0)
                if (remaining == 0) emptyList() else {
                    val limit = remaining + (replacedCounts[key] ?: 0)
                    columnTasks(key, ids, limit).asSequence().filterNot { it.id in replacedIds }
                        .take(remaining).map { it.toDomain() }.toList()
                }
            },
            counts = statuses.associateWith { status ->
                val key = status.name.lowercase()
                (counts[key] ?: 0) - (replacedCounts[key] ?: 0) + suggestions[status].orEmpty().size
            },
            scopeColors = scopes.associate { it.id to it.color },
            suggestions = suggestions.mapValues { (_, items) -> items.take(WIDGET_COLUMN_LIMIT) },
            suggestionTimezone = calendar.timezone,
            nextSuggestionAt = calendar.nextBoundary(now, scheduled),
        )
    }

    // ------------------------------------------------------------------- cua

    @Query("SELECT * FROM outbox ORDER BY queued_at, rowid")
    fun outboxFlow(): Flow<List<OutboxEntity>>

    @Query("SELECT * FROM outbox ORDER BY queued_at, rowid")
    suspend fun outbox(): List<OutboxEntity>

    @Query("SELECT * FROM outbox WHERE op_id = :opId")
    suspend fun operation(opId: String): OutboxEntity?

    @Query("UPDATE outbox SET state = :state, detail = :detail, server_entity = :serverEntity WHERE op_id = :opId")
    suspend fun markIssue(opId: String, state: String, detail: String?, serverEntity: String?)

    @Query("UPDATE outbox SET state = 'revoked', server_entity = NULL, base_fields = NULL, detail = NULL WHERE COALESCE(task_id, entity_id) IN (SELECT id FROM tasks WHERE scope_id NOT IN (:visibleScopes))")
    suspend fun clearRevokedScopeIssues(visibleScopes: List<String>)

    @Query("UPDATE tasks SET deleted = 1 WHERE id = :id")
    suspend fun markRemoteTaskDeleted(id: String)

    @Transaction
    suspend fun markDeletedConflict(issue: OutboxEntity, serverEntity: String) {
        markIssue(issue.opId, "conflict", null, serverEntity)
        markRemoteTaskDeleted(issue.entityId)
    }

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun enqueue(operation: OutboxEntity)

    @Update
    suspend fun updateOperation(operation: OutboxEntity)

    @Query("DELETE FROM outbox WHERE op_id = :opId")
    suspend fun dequeue(opId: String)

    @Query("UPDATE outbox SET attempts = attempts + 1 WHERE op_id = :opId")
    suspend fun failed(opId: String)

    @Transaction
    suspend fun enqueueAll(operations: List<OutboxEntity>) {
        operations.forEach { enqueue(it) }
    }

    @Transaction
    suspend fun acknowledgeTask(opId: String, rebased: List<OutboxEntity>, task: TaskEntity) {
        dequeue(opId)
        rebased.forEach { updateOperation(it) }
        putTasks(listOf(task))
    }

    @Query("UPDATE outbox SET op_id = :newId, base_version = :baseVersion, payload = :payload, base_fields = :baseFields, state = 'pending', attempts = 0, detail = NULL, server_entity = NULL WHERE op_id = :oldId")
    suspend fun replaceIssue(oldId: String, newId: String, baseVersion: Int, payload: String, baseFields: String?)

    @Transaction
    suspend fun resolveIssue(
        remove: List<String>,
        previousId: String?,
        replacement: OutboxEntity?,
        taskId: String?,
        task: TaskEntity?,
        lists: TaskListsEntity? = null,
    ) {
        remove.forEach { dequeue(it) }
        if (previousId != null && replacement != null) {
            replaceIssue(previousId, replacement.opId, replacement.baseVersion, replacement.payload, replacement.baseFields)
        }
        if (task != null) putTasks(listOf(task))
        else if (taskId != null) {
            removeTask(taskId)
            purgeOrphanTaskLists()
            purgeOrphanComments()
        }
        if (lists != null) putTaskLists(lists)
    }

    @Transaction
    suspend fun acknowledgeChild(
        opId: String,
        lists: TaskListsEntity?,
        comment: CommentEntity?,
        rebased: List<OutboxEntity> = emptyList(),
        task: TaskEntity? = null,
    ) {
        if (lists != null) putTaskLists(lists)
        if (comment != null) putComments(listOf(comment))
        rebased.forEach { updateOperation(it) }
        if (task != null) putTasks(listOf(task))
        dequeue(opId)
    }

    // -------------------------------------------------------------- etiquetes

    @Query("SELECT * FROM labels ORDER BY name, id")
    fun labels(): Flow<List<LabelEntity>>

    @Query("SELECT * FROM labels WHERE scope_id = :scopeId ORDER BY name, id")
    suspend fun labelsByScope(scopeId: String): List<LabelEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putLabels(rows: List<LabelEntity>)

    @Query("DELETE FROM labels WHERE id = :id")
    suspend fun deleteLabel(id: String)

    @Query("DELETE FROM labels")
    suspend fun clearLabels()

    // ------------------------------------------------------------ tipologies

    @Query("SELECT * FROM task_types ORDER BY position, name")
    fun taskTypes(): Flow<List<TaskTypeEntity>>

    @Query("SELECT * FROM task_types WHERE scope_id = :scopeId ORDER BY position, name")
    suspend fun taskTypesByScope(scopeId: String): List<TaskTypeEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putTaskTypes(rows: List<TaskTypeEntity>)

    @Query("DELETE FROM task_types WHERE id = :id")
    suspend fun deleteTaskType(id: String)

    @Query("DELETE FROM task_types")
    suspend fun clearTaskTypes()

    @Transaction
    suspend fun replaceTaskTypes(rows: List<TaskTypeEntity>) {
        clearTaskTypes()
        putTaskTypes(rows)
    }

    // ------------------------------------------------------------- comentaris

    @Query("SELECT * FROM comments WHERE task_id = :taskId ORDER BY created_at, id")
    fun commentsByTask(taskId: String): Flow<List<CommentEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putComments(rows: List<CommentEntity>)

    @Query("DELETE FROM comments WHERE task_id = :taskId")
    suspend fun clearComments(taskId: String)

    @Query("DELETE FROM comments WHERE task_id NOT IN (SELECT id FROM tasks)")
    suspend fun purgeOrphanComments()

    @Transaction
    suspend fun replaceComments(taskId: String, rows: List<CommentEntity>) {
        clearComments(taskId)
        putComments(rows)
    }

    @Query("SELECT * FROM task_lists WHERE task_id = :taskId")
    fun taskLists(taskId: String): Flow<TaskListsEntity?>

    @Query("SELECT * FROM task_lists WHERE task_id = :taskId")
    suspend fun taskListsOnce(taskId: String): TaskListsEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putTaskLists(lists: TaskListsEntity)

    @Query("DELETE FROM task_lists WHERE task_id NOT IN (SELECT id FROM tasks)")
    suspend fun purgeOrphanTaskLists()

    // ------------------------------------------------------------- sessions

    @Query("SELECT * FROM sessions ORDER BY started_at DESC, id")
    fun sessions(): Flow<List<SessionEntity>>

    @Query("SELECT * FROM sessions WHERE task_id = :taskId ORDER BY started_at DESC")
    suspend fun sessionsByTask(taskId: String): List<SessionEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putSessions(rows: List<SessionEntity>)

    @Query("DELETE FROM sessions WHERE id = :id")
    suspend fun deleteSession(id: String)

    @Query("DELETE FROM sessions")
    suspend fun clearSessions()

    // ------------------------------------------------------------- calendaris

    @Query("SELECT * FROM calendars ORDER BY name, id")
    fun calendars(): Flow<List<CalendarEntity>>

    @Query("SELECT * FROM calendars WHERE scope_id = :scopeId ORDER BY name, id")
    suspend fun calendarsByScope(scopeId: String): List<CalendarEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putCalendars(rows: List<CalendarEntity>)

    @Query("DELETE FROM calendars WHERE id = :id")
    suspend fun deleteCalendar(id: String)

    @Query("DELETE FROM calendars")
    suspend fun clearCalendars()

    // -------------------------------------------------------- comptes correu

    @Query("SELECT * FROM mail_accounts ORDER BY name, id")
    fun mailAccounts(): Flow<List<MailAccountEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putMailAccounts(rows: List<MailAccountEntity>)

    @Query("DELETE FROM mail_accounts WHERE id = :id")
    suspend fun deleteMailAccount(id: String)

    @Query("DELETE FROM mail_accounts")
    suspend fun clearMailAccounts()

    // ---------------------------------------------------------- regles correu

    @Query("SELECT * FROM mail_rules ORDER BY id")
    fun mailRules(): Flow<List<MailRuleEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putMailRules(rows: List<MailRuleEntity>)

    @Query("DELETE FROM mail_rules WHERE id = :id")
    suspend fun deleteMailRule(id: String)

    @Query("DELETE FROM mail_rules")
    suspend fun clearMailRules()

    // ---------------------------------------------------- configuració àmbit

    @Query("SELECT * FROM scope_settings WHERE scope_id = :scopeId")
    fun scopeSettings(scopeId: String): Flow<ScopeSettingsEntity?>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putScopeSettings(row: ScopeSettingsEntity)

    @Query("DELETE FROM scope_settings WHERE scope_id = :scopeId")
    suspend fun clearScopeSettings(scopeId: String)

    // ---------------------------------------------------------------- agents

    @Query("SELECT * FROM agents ORDER BY name, id")
    fun agents(): Flow<List<AgentEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putAgents(rows: List<AgentEntity>)

    @Query("DELETE FROM agents WHERE id = :id")
    suspend fun deleteAgent(id: String)

    @Query("DELETE FROM agents")
    suspend fun clearAgents()

    // ------------------------------------------------------------- projectes

    @Query("DELETE FROM projects WHERE id = :id")
    suspend fun deleteProject(id: String)

    // --------------------------------------------------------------- àmbits

    @Query("DELETE FROM scopes WHERE id = :id")
    suspend fun deleteScope(id: String)
}

@Database(
    entities = [
        TaskEntity::class,
        TaskListsEntity::class,
        ScopeEntity::class,
        ProjectEntity::class,
        PersonEntity::class,
        OutboxEntity::class,
        // Entitats noves per a la paritat (onada 1):
        LabelEntity::class,
        TaskTypeEntity::class,
        CommentEntity::class,
        SessionEntity::class,
        CalendarEntity::class,
        MailAccountEntity::class,
        MailRuleEntity::class,
        ScopeSettingsEntity::class,
        AgentEntity::class,
        PomodoroCacheEntity::class,
        CalendarSuggestionsCacheEntity::class,
        DoingAutoStopCacheEntity::class,
    ],
    version = 7,
    exportSchema = false,
)
abstract class FemhoDatabase : RoomDatabase() {
    abstract fun dao(): FemhoDao

    /**
     * Migració de v1 a v2: afegeix les taules noves de les àrees de paritat.
     *
     * **Decisió**: com que és una app de desenvolupament (versió 1, `exportSchema = false`),
     * s'incrementa la versió a 2 i es crea una migració que afegeix les taules noves.
     * Les entitats existents no es toquen.
     *
     * Les taules noves es creen amb `IF NOT EXISTS` per permetre instal·lacions netes
     * directament a v2 sense passar per la migració.
     */
    companion object {
        val MIGRATION_6_7 = object : androidx.room.migration.Migration(6, 7) {
            override fun migrate(db: androidx.sqlite.db.SupportSQLiteDatabase) {
                db.execSQL("CREATE TABLE IF NOT EXISTS doing_auto_stop_cache (id INTEGER NOT NULL PRIMARY KEY, minutes INTEGER, issue_id TEXT)")
            }
        }

        val MIGRATION_5_6 = object : androidx.room.migration.Migration(5, 6) {
            override fun migrate(db: androidx.sqlite.db.SupportSQLiteDatabase) {
                db.execSQL("CREATE TABLE IF NOT EXISTS calendar_suggestions_cache (id INTEGER NOT NULL PRIMARY KEY, snapshot TEXT NOT NULL, issue_id TEXT)")
            }
        }

        val MIGRATION_4_5 = object : androidx.room.migration.Migration(4, 5) {
            override fun migrate(db: androidx.sqlite.db.SupportSQLiteDatabase) {
                db.execSQL("CREATE TABLE IF NOT EXISTS pomodoro_cache (id INTEGER NOT NULL PRIMARY KEY, snapshot TEXT NOT NULL, clock_offset_ms INTEGER NOT NULL, issue_id TEXT)")
            }
        }

        val MIGRATION_3_4 = object : androidx.room.migration.Migration(3, 4) {
            override fun migrate(db: androidx.sqlite.db.SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE tasks ADD COLUMN task_json TEXT")
                db.execSQL("ALTER TABLE outbox ADD COLUMN state TEXT NOT NULL DEFAULT 'pending'")
                db.execSQL("ALTER TABLE outbox ADD COLUMN task_id TEXT")
                db.execSQL("ALTER TABLE outbox ADD COLUMN parent_id TEXT")
                db.execSQL("ALTER TABLE outbox ADD COLUMN base_fields TEXT")
                db.execSQL("ALTER TABLE outbox ADD COLUMN server_entity TEXT")
                db.execSQL("ALTER TABLE outbox ADD COLUMN detail TEXT")
                db.execSQL("UPDATE outbox SET task_id = entity_id WHERE entity = 'task'")
                db.execSQL("CREATE TABLE IF NOT EXISTS task_lists (task_id TEXT NOT NULL PRIMARY KEY, subtasks TEXT NOT NULL, checklists TEXT NOT NULL)")
            }
        }

        val MIGRATION_2_3 = object : androidx.room.migration.Migration(2, 3) {
            override fun migrate(db: androidx.sqlite.db.SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE mail_accounts ADD COLUMN auth_method TEXT NOT NULL DEFAULT 'password'")
                db.execSQL("ALTER TABLE mail_accounts ADD COLUMN oauth_status TEXT")
            }
        }
        val MIGRATION_1_2 = object : androidx.room.migration.Migration(1, 2) {
            override fun migrate(database: androidx.sqlite.db.SupportSQLiteDatabase) {
                // Etiquetes
                database.execSQL(
                    "CREATE TABLE IF NOT EXISTS labels (" +
                        "`id` TEXT PRIMARY KEY NOT NULL, " +
                        "`scope_id` TEXT NOT NULL, " +
                        "name TEXT NOT NULL, " +
                        "color TEXT, " +
                        "`created_at` TEXT)",
                )
                // Tipologies
                database.execSQL(
                    "CREATE TABLE IF NOT EXISTS task_types (" +
                        "`id` TEXT PRIMARY KEY NOT NULL, " +
                        "`scope_id` TEXT NOT NULL, " +
                        "name TEXT NOT NULL, " +
                        "color TEXT, " +
                        "position TEXT, " +
                        "required INTEGER NOT NULL DEFAULT 0)",
                )
                // Comentaris
                database.execSQL(
                    "CREATE TABLE IF NOT EXISTS comments (" +
                        "`id` TEXT PRIMARY KEY NOT NULL, " +
                        "`task_id` TEXT NOT NULL, " +
                        "`author_id` TEXT, " +
                        "`author_name` TEXT, " +
                        "`agent_id` TEXT, " +
                        "body TEXT NOT NULL, " +
                        "`created_at` TEXT NOT NULL)",
                )
                // Sessions
                database.execSQL(
                    "CREATE TABLE IF NOT EXISTS sessions (" +
                        "`id` TEXT PRIMARY KEY NOT NULL, " +
                        "`task_id` TEXT NOT NULL, " +
                        "`scope_id` TEXT, " +
                        "`user_id` TEXT NOT NULL, " +
                        "`started_at` TEXT NOT NULL, " +
                        "`ended_at` TEXT, " +
                        "source TEXT, " +
                        "note TEXT)",
                )
                // Calendaris
                database.execSQL(
                    "CREATE TABLE IF NOT EXISTS calendars (" +
                        "`id` TEXT PRIMARY KEY NOT NULL, " +
                        "`scope_id` TEXT, " +
                        "`project_id` TEXT, " +
                        "name TEXT NOT NULL, " +
                        "color TEXT, " +
                        "origin TEXT NOT NULL DEFAULT 'local', " +
                        "`source_kind` TEXT, " +
                        "`source_url` TEXT, " +
                        "`refresh_interval` INTEGER, " +
                        "`inbox_visible` INTEGER, " +
                        "`last_refreshed_at` TEXT, " +
                        "`last_error` TEXT, " +
                        "`shared_with_scope` INTEGER NOT NULL DEFAULT 0)",
                )
                // Comptes de correu
                database.execSQL(
                    "CREATE TABLE IF NOT EXISTS mail_accounts (" +
                        "`id` TEXT PRIMARY KEY NOT NULL, " +
                        "name TEXT NOT NULL, " +
                        "host TEXT NOT NULL, " +
                        "username TEXT NOT NULL, " +
                        "`has_secret` INTEGER NOT NULL DEFAULT 0, " +
                        "security TEXT NOT NULL DEFAULT 'tls', " +
                        "`created_at` TEXT)",
                )
                // Regles de correu
                database.execSQL(
                    "CREATE TABLE IF NOT EXISTS mail_rules (" +
                        "`id` TEXT PRIMARY KEY NOT NULL, " +
                        "`account_id` TEXT, " +
                        "folder TEXT NOT NULL, " +
                        "`scope_id` TEXT, " +
                        "`project_id` TEXT, " +
                        "`title_template` TEXT, " +
                        "`inbox_visible` INTEGER)",
                )
                // Configuració d'àmbit
                database.execSQL(
                    "CREATE TABLE IF NOT EXISTS scope_settings (" +
                        "`scope_id` TEXT PRIMARY KEY NOT NULL, " +
                        "`time_tracking` INTEGER NOT NULL DEFAULT 0, " +
                        "`work_start` TEXT, " +
                        "`work_end` TEXT, " +
                        "`work_days` TEXT NOT NULL DEFAULT '', " +
                        "`overtime_visible` INTEGER NOT NULL DEFAULT 0, " +
                        "`long_session_hours` INTEGER NOT NULL DEFAULT 8, " +
                        "`project_noun` TEXT NOT NULL DEFAULT 'projecte', " +
                        "`task_types_enabled` INTEGER NOT NULL DEFAULT 0)",
                )
                // Agents
                database.execSQL(
                    "CREATE TABLE IF NOT EXISTS agents (" +
                        "`id` TEXT PRIMARY KEY NOT NULL, " +
                        "name TEXT NOT NULL DEFAULT '', " +
                        "enabled INTEGER NOT NULL DEFAULT 0, " +
                        "`can_create_tasks` INTEGER NOT NULL DEFAULT 0, " +
                        "`scope_ids` TEXT NOT NULL DEFAULT '', " +
                        "`all_scopes` INTEGER NOT NULL DEFAULT 0, " +
                        "`created_at` TEXT)",
                )
            }
        }
    }
}
