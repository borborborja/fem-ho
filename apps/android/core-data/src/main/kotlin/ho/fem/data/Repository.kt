package ho.fem.data

import ho.fem.model.AiMode
import ho.fem.model.Agent
import ho.fem.model.AgentDetail
import ho.fem.model.AuthSettingsEnvelope
import ho.fem.model.Calendar
import ho.fem.model.CalendarOrigin
import ho.fem.model.CalendarTaskStart
import ho.fem.model.CalendarTaskSuggestion
import ho.fem.model.CalendarTaskSuggestions
import ho.fem.model.Comment
import ho.fem.model.Checklist
import ho.fem.model.ChecklistItem
import ho.fem.model.Label
import ho.fem.model.MailAccount
import ho.fem.model.MailRule
import ho.fem.model.MailSecurity
import ho.fem.model.MailTestResult
import ho.fem.model.MAX_DOING_AUTO_STOP_MINUTES
import ho.fem.model.Person
import ho.fem.model.PomodoroSnapshot
import ho.fem.model.Project
import ho.fem.model.Scope
import ho.fem.model.ScopeKind
import ho.fem.model.ScopeSettings
import ho.fem.model.Subtask
import ho.fem.model.Session
import ho.fem.model.ShareAccess
import ho.fem.model.ShareCreated
import ho.fem.model.ShareSummary
import ho.fem.model.Task
import ho.fem.model.DashboardView
import ho.fem.model.TaskPage
import ho.fem.model.TaskProgress
import ho.fem.model.TaskStatus
import ho.fem.model.TaskTimeSummary
import ho.fem.model.TaskType
import ho.fem.model.UserProfile
import ho.fem.model.applyPomodoroCommand
import ho.fem.model.emptyPomodoroSnapshot
import ho.fem.model.generatePosition
import ho.fem.network.FemhoApi
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flowOf
import java.time.Instant
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.IOException
import java.util.UUID

data class TaskLists(
    val subtasks: List<Subtask> = emptyList(),
    val checklists: List<Checklist> = emptyList(),
)

data class SyncIssue(
    val opId: String,
    val entity: String,
    val entityId: String,
    val title: String?,
    val kind: String,
    val detail: String?,
    val localPayload: String,
    val serverPayload: String?,
    val canKeepLocal: Boolean,
    val dependentCount: Int,
)

private val storedJson = Json { ignoreUnknownKeys = true; encodeDefaults = true }

data class LocalPomodoro(
    val snapshot: PomodoroSnapshot = emptyPomodoroSnapshot(),
    val clockOffsetMs: Long = 0,
    val issueId: String? = null,
)

data class LocalCalendarSuggestions(
    val snapshot: CalendarTaskSuggestions = CalendarTaskSuggestions(),
    val issueId: String? = null,
)

data class LocalDoingAutoStop(val minutes: Int? = null, val issueId: String? = null)

private const val CALENDAR_SUGGESTIONS = "calendar_suggestions"
private const val USER_SETTINGS = "user_settings"
private const val DOING_AUTO_STOP_MINUTES = "doing_auto_stop_minutes"

/**
 * El repositori. docs/03 §11.
 *
 * **Llegir és sempre local; escriure és local i encuar.** La pantalla veu el canvi de
 * seguida perquè la base ja el porta, i la cua l'envia quan es pugui. És el que fa que
 * el mode avió no sigui un mode: és el comportament normal amb la xarxa caiguda.
 *
 * Cap pantalla crida `FemhoApi` directament, i per això l'API és privada aquí dins.
 */
class Repository(
    private val dao: FemhoDao,
    private val api: FemhoApi,
    private val flushLock: Mutex = Mutex(),
    private val moveLock: Mutex = Mutex(),
    private val ownerId: String? = null,
) {

    val tasks: Flow<List<Task>> = combine(dao.tasks(), dao.outboxFlow()) { _, _ ->
        moveLock.withLock {
            val edits = dao.outbox().filter { it.entity == "subtask" }.groupBy { it.rootTaskId() }
            dao.taskRows().filterNot { it.deleted }.sortedWith(compareBy({ it.position }, { it.id })).map { row ->
                val task = row.toDomain()
                val pending = edits[task.id] ?: return@map task
                val canonical = dao.taskListsOnce(task.id).toTaskLists()
                val projected = canonical.withQueue(task.id, pending)
                task.withSubtaskProgress(canonical, projected)
            }
        }
    }.distinctUntilChanged()
    val scopes: Flow<List<Scope>> = dao.scopes().map { rows -> rows.map { it.toDomain() } }
    val projects: Flow<List<Project>> = dao.projects().map { rows -> rows.map { it.toDomain() } }
    val people: Flow<List<Person>> = dao.people().map { rows -> rows.map { Person(it.id, it.name) } }
    val pending: Flow<Int> = dao.outboxFlow().map { it.size }
    val pomodoro: Flow<LocalPomodoro> = if (ownerId == null) flowOf(LocalPomodoro()) else
        combine(dao.pomodoroCache(), dao.outboxFlow()) { _, _ ->
            moveLock.withLock { localPomodoro() }
        }.distinctUntilChanged()
    val calendarSuggestions: Flow<LocalCalendarSuggestions> = if (ownerId == null) flowOf(LocalCalendarSuggestions()) else
        combine(dao.calendarSuggestionsCache(), dao.outboxFlow()) { _, _ ->
            moveLock.withLock { localCalendarSuggestions() }
        }.distinctUntilChanged()
    val doingAutoStop: Flow<LocalDoingAutoStop> = if (ownerId == null) flowOf(LocalDoingAutoStop()) else
        combine(dao.doingAutoStopCache(), dao.outboxFlow()) { _, _ ->
            moveLock.withLock { localDoingAutoStop() }
        }.distinctUntilChanged()
    val syncIssues: Flow<List<SyncIssue>> = combine(dao.outboxFlow(), dao.tasks()) { queue, local ->
        val titles = local.associate { it.id to it.title }
        queue.filter { it.state != "pending" }.map {
            SyncIssue(
                opId = it.opId, entity = it.entity, entityId = it.entityId, title = titles[it.rootTaskId()],
                kind = if (it.state == "conflict") "conflict" else "rejected",
                detail = it.detail, localPayload = it.payload, serverPayload = it.serverEntity,
                canKeepLocal = it.state != "revoked" &&
                    it.serverEntity?.let { value -> objectFrom(value)["deleted_at"] in listOf(null, JsonNull) } != false,
                dependentCount = dependenciesToDiscard(it, queue).size - 1,
            )
        }
    }

    fun observeTask(id: String): Flow<Task?> = dao.task(id).map { it?.toDomain() }

    suspend fun refreshTask(id: String) {
        val before = dao.taskRow(id)
        val task = api.getTask(id)
        moveLock.withLock {
            val local = dao.taskRow(id)
            val canSeed = before == null && dao.scopesOnce().any { it.id == task.scopeId }
            if ((local?.deleted == false || (local == null && canSeed)) &&
                dao.outbox().none { it.rootTaskId() == id } && (local?.version ?: 0) <= task.version
            ) {
                dao.putTasks(listOf(task.toEntity()))
            }
        }
    }

    suspend fun refreshPomodoro() = flushLock.withLock {
        flushPending()
        readPomodoro(refreshBoardOnChange = true)
    }

    private suspend fun readPomodoro(refreshBoardOnChange: Boolean = false) {
        if (ownerId == null) return
        val sentAt = System.currentTimeMillis()
        val snapshot = try {
            api.pomodoro()
        } catch (error: FemhoApi.ApiException) {
            if (error.status == 404) return
            throw error
        }
        val offset = snapshot.serverTimeMs - (sentAt + (System.currentTimeMillis() - sentAt) / 2)
        if (refreshBoardOnChange) {
            val previous = dao.pomodoroCacheOnce()?.let { storedJson.decodeFromString<PomodoroSnapshot>(it.snapshot) }
            val taskId = snapshot.timer?.taskId
            // Un inici en un altre aparell també pot haver mogut la targeta, i una tasca
            // afegida remotament a la cua encara pot faltar a la còpia del tauler.
            if ((taskId != null && taskId != previous?.timer?.taskId) ||
                snapshot.queue.toSet() != previous?.queue.orEmpty().toSet()) refreshBoard(emptyList(), null)
        }
        moveLock.withLock {
            dao.putPomodoroCache(snapshot.toCache(offset, dao.pomodoroCacheOnce()?.issueId))
        }
    }

    private suspend fun localPomodoro(): LocalPomodoro {
        val cache = dao.pomodoroCacheOnce()
        val initial = cache?.let { storedJson.decodeFromString<PomodoroSnapshot>(it.snapshot) }
            ?: emptyPomodoroSnapshot()
        val snapshot = dao.outbox().asSequence().filter { it.entity == "pomodoro" && it.state == "pending" }
            .fold(initial) { state, queued -> applyPomodoroCommand(state, objectFrom(queued.payload)) ?: state }
        return LocalPomodoro(snapshot, cache?.clockOffsetMs ?: 0, cache?.issueId)
    }

    suspend fun dismissPomodoroIssue(issueId: String) = moveLock.withLock { dao.clearPomodoroIssue(issueId) }

    suspend fun enqueuePomodoro(createCommand: (PomodoroSnapshot, Long) -> JsonObject?): Boolean = moveLock.withLock {
        val owner = checkNotNull(ownerId)
        val state = localPomodoro()
        val at = System.currentTimeMillis()
        val command = createCommand(state.snapshot, at + state.clockOffsetMs) ?: return@withLock false
        val taskId = command.string("task_id")
        val requestedTask = taskId?.let { dao.taskRow(it) }
        if (taskId != null && (requestedTask == null || requestedTask.deleted ||
                (requestedTask.status != "todo" && requestedTask.status != "doing"))) return@withLock false
        val position = requestedTask?.takeIf { it.status == "todo" }?.let {
            generatePosition(dao.lastPosition(it.scopeId, "doing"), null)
        }
        val data = if (position == null) command else JsonObject(command + ("position" to JsonPrimitive(position)))
        if (applyPomodoroCommand(state.snapshot, data) == null) return@withLock false
        val moved = requestedTask?.takeIf { position != null }
        val base = moved?.let { buildJsonObject { put("position", it.position) } }
        val pending = operation("pomodoro", "update", owner, 0, data, taskId = moved?.id, base = base, time = at)
        if (moved != null && position != null) {
            dao.putTaskAndEnqueue(moved.toDomain().copy(status = TaskStatus.DOING, position = position).toEntity(), pending)
        } else dao.enqueue(pending)
        true
    }

    suspend fun refreshCalendarSuggestions() = flushLock.withLock {
        if (ownerId == null) return@withLock
        flushPending()
        val snapshot = try {
            api.calendarTaskSuggestions()
        } catch (error: FemhoApi.ApiException) {
            if (error.status == 404) return@withLock
            throw error
        }
        val previous = dao.calendarSuggestionsCacheOnce()
        val oldSnapshot = previous?.let { storedJson.decodeFromString<CalendarTaskSuggestions>(it.snapshot) }
        moveLock.withLock {
            dao.putCalendarSuggestionsCache(snapshot.toCache(dao.calendarSuggestionsCacheOnce()?.issueId))
        }
        if (snapshot.enabled && oldSnapshot?.items?.any { old ->
                snapshot.items.none { it.occurrence == old.occurrence }
            } == true) {
            // Acceptar des d'un altre dispositiu pot haver substituït una proposta per una tasca.
            refreshBoard(emptyList(), null)
        }
    }

    private suspend fun localCalendarSuggestions(): LocalCalendarSuggestions {
        val cache = dao.calendarSuggestionsCacheOnce()
        return LocalCalendarSuggestions(projectCalendarSuggestions(cache, dao.outbox()), cache?.issueId)
    }

    suspend fun dismissCalendarSuggestionsIssue(issueId: String) = moveLock.withLock {
        dao.clearCalendarSuggestionsIssue(issueId)
    }

    suspend fun configureCalendarSuggestions(enabled: Boolean) = moveLock.withLock {
        if (localCalendarSuggestions().snapshot.enabled == enabled) return@withLock
        val data = buildJsonObject {
            put("type", "configure")
            put("enabled", enabled)
        }
        dao.enqueue(operation(CALENDAR_SUGGESTIONS, "update", checkNotNull(ownerId), 0, data, taskId = null))
    }

    internal suspend fun readUserSettings(): AuthSettingsEnvelope = flushLock.withLock {
        api.settings().also { envelope ->
            moveLock.withLock {
                val cache = dao.doingAutoStopCacheOnce()
                val minutes = envelope.settings.doingAutoStopMinutes
                if (cache?.minutes != minutes) {
                    dao.putDoingAutoStopCache(DoingAutoStopCacheEntity(minutes = minutes, issueId = cache?.issueId))
                }
            }
        }
    }

    private suspend fun localDoingAutoStop(): LocalDoingAutoStop {
        val cache = dao.doingAutoStopCacheOnce()
        return LocalDoingAutoStop(projectDoingAutoStop(cache?.minutes, dao.outbox()), cache?.issueId)
    }

    suspend fun setDoingAutoStop(minutes: Int?) = moveLock.withLock {
        require(minutes == null || minutes in 1..MAX_DOING_AUTO_STOP_MINUTES)
        if (minutes == localDoingAutoStop().minutes) return@withLock
        val data = buildJsonObject { put(DOING_AUTO_STOP_MINUTES, minutes) }
        dao.enqueue(operation(USER_SETTINGS, "update", checkNotNull(ownerId), 0, data, taskId = null))
    }

    suspend fun dismissDoingAutoStopIssue(issueId: String) = moveLock.withLock {
        dao.clearDoingAutoStopIssue(issueId)
    }

    suspend fun actOnCalendarSuggestion(
        suggestion: CalendarTaskSuggestion,
        actionAt: Instant,
        start: CalendarTaskStart?,
        confirmShare: Boolean,
        taskTypeId: String?,
    ): Boolean = moveLock.withLock {
        val snapshot = localCalendarSuggestions().snapshot
        val item = snapshot.visibleItems(actionAt).find { it.occurrence == suggestion.occurrence && it.startsAt == suggestion.startsAt }
            ?: return@withLock false
        if (start != null && (!item.canStart || (item.requiresShareConfirmation && !confirmShare) ||
                (item.requiresTaskType && taskTypeId == null) ||
                (start == CalendarTaskStart.PLANNED && !item.permitsPlannedStart(actionAt)))) return@withLock false
        if (start == null && item.column(actionAt) != TaskStatus.DOING) return@withLock false

        val row = if (start == null) null else item.taskId?.let { dao.taskRow(it) }
        if (row?.deleted == true) return@withLock false
        val task = row?.toDomain()
        if (task != null && task.status !in listOf(TaskStatus.INBOX, TaskStatus.TODO)) return@withLock false
        val taskId = if (start == null) null else item.taskId ?: calendarTaskId(actionAt)
        val position = if (start == null) null else generatePosition(dao.lastPosition(item.scopeId, "doing"), null)
        val data = buildJsonObject {
            put("type", if (start == null) "decline" else "start")
            put("occurrence", storedJson.encodeToJsonElement(item.occurrence))
            put("starts_at", item.startsAt)
            put("action_at", actionAt.toString())
            if (start != null) {
                put("start", start.name.lowercase())
                put("task_id", checkNotNull(taskId))
                put("position", checkNotNull(position))
                if (confirmShare) put("confirm_share", true)
                taskTypeId?.let { put("task_type_id", it) }
            }
        }
        val previous = task?.let { storedJson.encodeToJsonElement(it).jsonObject }
        val pending = operation(CALENDAR_SUGGESTIONS, "update", checkNotNull(ownerId), 0, data,
            taskId = taskId, base = previous, time = actionAt.toEpochMilli())
        if (taskId == null || position == null) {
            dao.enqueue(pending)
        } else {
            val startedAt = if (start == CalendarTaskStart.PLANNED) item.startsAt else actionAt.toString()
            val tracking = dao.scopeSettings(item.scopeId).first()?.timeTracking == true
            val time = if (tracking) (task?.timeSummary ?: TaskTimeSummary()).let {
                it.copy(segments = it.segments + 1, openStartedAt = it.openStartedAt + startedAt)
            } else null
            val optimistic = (task ?: Task(id = taskId, scopeId = item.scopeId, projectId = item.projectId,
                title = item.title, position = position, taskTypeId = taskTypeId)).copy(
                status = TaskStatus.DOING, position = position, fromCalendar = true, timeSummary = time,
            )
            dao.putTaskAndEnqueue(optimistic.toEntity(), pending)
        }
        true
    }

    /**
     * Refresca-ho tot des del servidor.
     *
     * **La cua es buida ABANS de llegir.** A l'inrevés, el que s'ha escrit offline es
     * perdria: el servidor encara no ho sap, tornaria l'estat antic i sobreescriuria el
     * local. És el mateix ordre que la web (docs/06 §4).
     */
    suspend fun refresh(scopeIds: List<String>, projectId: String?) = flushLock.withLock {
        flushPending()
        refreshBoard(scopeIds, projectId)
        readPomodoro()
    }

    suspend fun refreshTaskBoard() = flushLock.withLock {
        flushPending()
        refreshBoard(emptyList(), null)
    }

    private suspend fun refreshBoard(scopeIds: List<String>, projectId: String?) {
        val scopes = api.scopes()
        val projects = api.projects()
        val people = api.people()
        val fetchedScopes = scopeIds.ifEmpty { scopes.map { it.id } }
        val board = api.board(fetchedScopes, projectId)
        moveLock.withLock {
            dao.replaceBoard(
                scopes.map { it.toEntity() },
                projects.map { it.toEntity() },
                people.map { PersonEntity(it.id, it.name) },
                board.tasks.map { it.toEntity() },
                fetchedScopes,
                projectId,
            )
        }
    }

    /**
     * Només una confirmació de l'op_id retira una operació.
     *
     * Un rebuig o un conflicte conserva la intenció local i atura els canvis posteriors
     * de la mateixa entitat. El tauler preserva aquestes files amb operacions pendents
     * quan aplica la instantània, i la resta de tasques continua sincronitzant-se.
     * Un problema de transport o de protocol no permet confirmar cap ordre posterior.
     * El pany evita que el refresc de pantalla i el de fons enviïn la mateixa cua alhora.
     */
    suspend fun flush() = flushLock.withLock { flushPending() }

    private suspend fun flushPending() {
        val blocked = mutableSetOf<Pair<String, String>>()
        val blockedCreations = mutableSetOf<String>()
        val queued = dao.outbox()
        for (original in queued) {
            val operation = dao.operation(original.opId) ?: continue
            val entity = operation.entity to operation.entityId
            if (operation.entity == "pomodoro" && (operation.state != "pending" || operation.rootTaskId() in blockedCreations)) {
                moveLock.withLock { reconcilePomodoro(operation, null, rejected = true) }
                continue
            }
            if (entity in blocked || operation.parentId in blockedCreations ||
                (operation.entity != "task" && operation.rootTaskId() in blockedCreations)
            ) {
                if (operation.op == "create") blockedCreations += operation.entityId
                continue
            }
            if (operation.state != "pending") {
                blocked += entity
                if (operation.op == "create") blockedCreations += operation.entityId
                continue
            }
            val response = try {
                api.syncBatch(operation.requestBody())
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: FemhoApi.ApiException) {
                if (error.status == 401 || error.status == 429 || error.status >= 500) throw error
                if (operation.entity == "pomodoro") {
                    moveLock.withLock { reconcilePomodoro(operation, null, rejected = true) }
                    continue
                }
                if (operation.entity == CALENDAR_SUGGESTIONS) {
                    moveLock.withLock { reconcileCalendarSuggestion(operation, null, rejected = true) }
                    continue
                }
                if (operation.entity == USER_SETTINGS) {
                    moveLock.withLock { reconcileDoingAutoStop(operation, null, rejected = true) }
                    continue
                }
                dao.markIssue(operation.opId, if (error.status == 409) "conflict" else "rejected", error.detail, null)
                blocked += entity
                if (operation.op == "create") blockedCreations += operation.entityId
                continue
            } catch (error: IOException) {
                dao.failed(operation.opId)
                throw error
            }

            val receipt = batchReceipt(response, operation.opId)
            when (val status = receipt?.string("status")) {
                "ok" -> moveLock.withLock {
                    val confirmed = receipt?.get("entity") as? JsonObject
                    when (operation.entity) {
                        "pomodoro" -> reconcilePomodoro(operation, confirmed, rejected = false)
                        CALENDAR_SUGGESTIONS -> reconcileCalendarSuggestion(operation, confirmed, rejected = false)
                        USER_SETTINGS -> reconcileDoingAutoStop(operation, confirmed, rejected = false)
                        else -> acknowledge(operation, confirmed)
                    }
                }
                "conflict", "rejected" -> {
                    val error = receipt?.get("error") as? JsonObject
                    val reportedStatus = error?.primitive("status")?.intOrNull
                    if (reportedStatus == 429 || (reportedStatus != null && reportedStatus >= 500)) {
                        dao.failed(operation.opId)
                        throw IOException("Sync operation should be retried")
                    }
                    val server = receipt?.get("server_entity") as? JsonObject
                    if (operation.entity == "pomodoro") {
                        moveLock.withLock { reconcilePomodoro(operation, server, rejected = true) }
                        continue
                    }
                    if (operation.entity == CALENDAR_SUGGESTIONS) {
                        moveLock.withLock { reconcileCalendarSuggestion(operation, server, rejected = true) }
                        continue
                    }
                    if (operation.entity == USER_SETTINGS) {
                        moveLock.withLock { reconcileDoingAutoStop(operation, null, rejected = true) }
                        continue
                    }
                    if (operation.entity == "task" && server?.get("deleted_at")?.let { it != JsonNull } == true) {
                        moveLock.withLock { dao.markDeletedConflict(operation, server.toString()) }
                    } else {
                        dao.markIssue(operation.opId, if (reportedStatus == 409) "conflict" else status,
                            error?.string("detail"), server?.toString())
                    }
                    blocked += entity
                    if (operation.op == "create") blockedCreations += operation.entityId
                }
                else -> {
                    dao.failed(operation.opId)
                    throw IOException("Sync operation was not confirmed: ${operation.opId}")
                }
            }
        }
    }

    private suspend fun reconcileDoingAutoStop(operation: OutboxEntity, entity: JsonObject?, rejected: Boolean) {
        val cache = dao.doingAutoStopCacheOnce() ?: DoingAutoStopCacheEntity()
        val updated = if (rejected) cache.copy(issueId = operation.opId) else {
            val value = entity?.get(DOING_AUTO_STOP_MINUTES)
            val minutes = (value as? JsonPrimitive)?.takeUnless { it.isString }?.intOrNull
            if (value != JsonNull && (minutes == null || minutes !in 1..MAX_DOING_AUTO_STOP_MINUTES)) {
                throw IOException("The sync receipt did not include a valid auto-stop setting")
            }
            cache.copy(minutes = minutes)
        }
        dao.resolveDoingAutoStop(updated, operation.opId)
    }

    private suspend fun reconcilePomodoro(operation: OutboxEntity, entity: JsonObject?, rejected: Boolean) {
        val cache = dao.pomodoroCacheOnce()
        val initial = cache?.let { storedJson.decodeFromString<PomodoroSnapshot>(it.snapshot) }
            ?: emptyPomodoroSnapshot()
        val decoded = entity?.let { storedJson.decodeFromJsonElement<PomodoroSnapshot>(it) }
        if (!rejected && decoded == null) throw IOException("The sync receipt did not include Pomodoro state")
        val canonical = decoded ?: initial
        val following = dao.outbox().dropWhile { it.opId != operation.opId }.drop(1)
        var projected = canonical
        val discarded = following.filter { next ->
            if (next.entity != "pomodoro" || next.state != "pending") return@filter false
            val applied = applyPomodoroCommand(projected, objectFrom(next.payload)) ?: return@filter true
            projected = applied
            false
        }
        val restored = (if (rejected) listOf(operation) + discarded else discarded).mapNotNull { next ->
            val task = next.taskId?.let { dao.taskRow(it) } ?: return@mapNotNull null
            val base = next.baseFields?.let(::objectFrom) ?: return@mapNotNull null
            val before = base.string("position") ?: return@mapNotNull null
            val projectedPosition = objectFrom(next.payload).string("position")
            if (task.deleted || task.status != "doing" || task.position != projectedPosition) return@mapNotNull null
            task.toDomain().copy(status = TaskStatus.TODO, position = before).toEntity()
        }
        val confirmed = if (rejected) null else canonical.movedTask
        val (rebased, moved) = if (confirmed != null) {
            rebaseTaskOperations(confirmed, following.filter { it.isPendingTaskEdit(confirmed.id) })
        } else emptyList<OutboxEntity>() to null
        val issueId = if (rejected || discarded.isNotEmpty()) operation.opId else cache?.issueId
        dao.resolvePomodoroOperations(
            canonical.toCache(cache?.clockOffsetMs ?: 0, issueId),
            listOf(operation.opId) + discarded.map { it.opId },
            (listOfNotNull(moved) + restored).distinctBy { it.id },
            rebased,
        )
    }

    private suspend fun reconcileCalendarSuggestion(operation: OutboxEntity, entity: JsonObject?, rejected: Boolean) {
        val cache = dao.calendarSuggestionsCacheOnce()
        val canonical = (entity?.get("snapshot") as? JsonObject)?.let {
            storedJson.decodeFromJsonElement<CalendarTaskSuggestions>(it)
        }
        if (!rejected && canonical == null) throw IOException("The sync receipt did not include calendar suggestions")
        val snapshot = canonical ?: cache?.let { storedJson.decodeFromString<CalendarTaskSuggestions>(it.snapshot) }
            ?: CalendarTaskSuggestions()
        val taskId = operation.taskId
        val task = if (rejected) null else (entity?.get("task") as? JsonObject)?.toTaskOrNull()
        val lostStart = taskId != null && task?.id != taskId
        val following = if (taskId == null) emptyList() else dao.outbox()
            .dropWhile { it.opId != operation.opId }.drop(1).filter { it.rootTaskId() == taskId }
        val restored = if (lostStart) operation.baseFields?.let { objectFrom(it).toTaskOrNull() } else null
        val (rebased, tasks) = if (task != null && !lostStart) {
            val (edits, row) = rebaseTaskOperations(task, following.filter { it.isPendingTaskEdit(task.id) })
            edits to listOf(row)
        } else emptyList<OutboxEntity>() to listOfNotNull(restored?.toEntity(), task?.toEntity())
        // Les edicions a una tasca provisional no es poden atribuir a la tasca d'un altre dispositiu.
        val removed = listOf(operation.opId) + if (lostStart) following.map { it.opId } else emptyList()
        val issue = if (rejected || (lostStart && (task == null || following.isNotEmpty()))) operation.opId else cache?.issueId
        dao.resolveCalendarSuggestionOperations(snapshot.toCache(issue), removed, tasks, rebased,
            removeTaskId = taskId.takeIf { lostStart && restored == null })
    }

    private suspend fun acknowledge(operation: OutboxEntity, entity: JsonObject?) {
        if (operation.entity == "task") {
            val canonical = entity?.toTaskOrNull()
            if (entity != null && canonical?.id != operation.entityId) {
                throw IOException("The sync receipt does not identify the edited task")
            }
            if (canonical == null) {
                dao.dequeue(operation.opId)
                return
            }
            val following = dao.outbox().filter { it.opId != operation.opId && it.isPendingTaskEdit(canonical.id) }
            val (rebased, task) = rebaseTaskOperations(canonical, following)
            dao.acknowledgeTask(operation.opId, rebased, task)
            return
        }

        val taskId = operation.rootTaskId()
        if (taskId == null) {
            dao.dequeue(operation.opId)
            return
        }
        if (operation.entity == "comment") {
            val comment = entity?.let { runCatching { storedJson.decodeFromJsonElement<Comment>(it) }.getOrNull() }
                ?: operation.toComment()
            dao.acknowledgeChild(operation.opId, null, comment?.toEntity())
        } else {
            val canonical = dao.taskListsOnce(taskId).toTaskLists()
            val updated = canonical.applyOperation(operation, entity)
            val task = if (operation.entity == "subtask") {
                dao.taskRow(taskId)?.let { row ->
                    row.toDomain().withSubtaskProgress(canonical, updated).toEntity(deleted = row.deleted)
                }
            } else null
            val rebased = if (operation.entity == "subtask" && operation.op != "delete") {
                rebaseSubtaskEdits(operation, updated)
            } else emptyList()
            dao.acknowledgeChild(operation.opId, updated.toEntity(taskId), null, rebased, task)
        }
    }

    private fun rebaseTaskOperations(canonical: Task, following: List<OutboxEntity>): Pair<List<OutboxEntity>, TaskEntity> {
        var task = canonical
        val rebased = following.map { next ->
            if (next.entity == "pomodoro" || next.entity == CALENDAR_SUGGESTIONS) {
                // Una edició anterior pot confirmar-se mentre la tasca ja ha entrat a Fent
                // de manera optimista. La pantalla conserva el moviment fins al seu rebut.
                if (task.status == TaskStatus.TODO || (next.entity == CALENDAR_SUGGESTIONS && task.status == TaskStatus.INBOX)) {
                    objectFrom(next.payload).string("position")?.let {
                        task = task.copy(status = TaskStatus.DOING, position = it)
                    }
                }
                return@map next
            }
            val base = next.baseFields?.let(::objectFrom)
            val mayAdvance = next.state == "pending" && (
                next.op != "update" || (base != null && task.baseText(objectFrom(next.payload)) == base)
            )
            val current = if (mayAdvance) next.copy(baseVersion = canonical.version) else next
            task = task.applyOperation(current)
            current
        }
        return rebased to task.toEntity(deleted = following.any { it.op == "delete" })
    }

    private suspend fun rebaseSubtaskEdits(operation: OutboxEntity, updated: TaskLists): List<OutboxEntity> {
        val confirmed = updated.subtasks.find { it.id == operation.entityId } ?: return emptyList()
        var title = confirmed.title
        return dao.outbox().filter {
            it.opId != operation.opId && it.entity == "subtask" && it.entityId == confirmed.id && it.state == "pending"
        }.mapNotNull { next ->
            val newTitle = objectFrom(next.payload).string("title")
            // Un rebut pot portar un títol editat en un altre dispositiu. En aquest cas
            // conservem la versió antiga perquè el servidor pugui detectar el conflicte.
            if (newTitle != null && next.baseFields?.let(::objectFrom)?.string("title") != title) {
                return@mapNotNull null
            }
            if (newTitle != null) title = newTitle
            next.copy(baseVersion = confirmed.version)
        }
    }

    /**
     * Crea una tasca **a la columna on s'ha escrit**.
     *
     * El disseny validat posa una afegida ràpida al peu de cada columna, i abans totes
     * anaven a la bústia sense dir-ho: escriure a "Per fer" i veure la targeta aparèixer
     * a un altre lloc és el tipus de mentida petita que fa desconfiar de la resta.
     */
    suspend fun createTask(
        scopeId: String,
        title: String,
        projectId: String?,
        status: TaskStatus = TaskStatus.INBOX,
        assigneeIds: List<String> = emptyList(),
        aiMode: AiMode = AiMode.MANUAL,
        taskTypeId: String? = null,
        dueDate: String? = null,
        dueTime: String? = null,
    ): String = moveLock.withLock {
        require(title.isNotBlank())
        val id = UUID.randomUUID().toString()
        val now = System.currentTimeMillis()
        val task = Task(
            id = id, scopeId = scopeId, projectId = projectId, title = title.trim(),
            status = status, position = generatePosition(dao.lastPosition(scopeId, status.name.lowercase()), null),
            dueDate = dueDate, dueTime = dueTime,
            completedAt = if (status == TaskStatus.DONE) Instant.ofEpochMilli(now).toString() else null,
            aiMode = aiMode, assigneeIds = assigneeIds, taskTypeId = taskTypeId,
        )
        val payload = buildJsonObject {
            put("id", id)
            put("scope_id", scopeId)
            put("title", task.title)
            put("status", status.name.lowercase())
            put("position", task.position)
            put("ai_mode", aiMode.wire)
            put("assignee_ids", storedJson.encodeToJsonElement(assigneeIds))
            projectId?.let { put("project_id", it) }
            taskTypeId?.let { put("task_type_id", it) }
            dueDate?.let { put("due_date", it) }
            dueTime?.let { put("due_time", it) }
        }
        dao.putTaskAndEnqueue(
            task.toEntity(), operation("task", "create", id, 0, payload, taskId = id, time = now),
        )
        id
    }

    suspend fun editTask(id: String, fields: Map<String, String?>, mode: AiMode? = null): Task =
        moveLock.withLock {
            val current = checkNotNull(dao.task(id).first()?.toDomain())
            val allowed = setOf("title", "description", "project_id", "due_date", "due_time", "deadline", "rrule",
                "recurrence_mode", "ai_instructions", "task_type_id")
            require(fields.keys.all { it in allowed })
            if ("title" in fields) require(!fields["title"].isNullOrBlank())
            val changes = buildJsonObject {
                fields.forEach { (key, value) -> put(key, if (key == "title") value?.trim() else value) }
                mode?.let { put("ai_mode", it.wire) }
            }
            val updated = current.withPatch(changes)
            if (current == updated) return@withLock current
            dao.putTaskAndEnqueue(
                updated.toEntity(),
                operation("task", "update", id, current.version, changes, taskId = id, base = current.baseText(changes)),
            )
            updated
        }

    suspend fun moveTask(task: Task, status: TaskStatus, neighbours: Pair<String?, String?>) {
        val position = generatePosition(neighbours.first, neighbours.second)
        val wire = status.name.lowercase()

        moveLock.withLock {
            val current = dao.task(task.id).first()?.toDomain() ?: return@withLock
            // Un callback vell o dos clics seguits no avancen la mateixa targeta dues vegades.
            if (current.status != task.status) return@withLock
            val at = System.currentTimeMillis()
            val payload = buildJsonObject {
                put("status", wire)
                put("position", position)
                put("from_status", current.status.name.lowercase())
                put("occurred_at", Instant.ofEpochMilli(at).toString())
            }.toString()
            dao.putTaskAndEnqueue(
                current.copy(status = status, position = position,
                    completedAt = if (status == TaskStatus.DONE) Instant.ofEpochMilli(at).toString() else null).toEntity(),
                operation("task", "move", task.id, current.version, objectFrom(payload), taskId = task.id, time = at),
            )
        }
    }

    // ------------------------------------------------------------ etiquetes

    val labels: Flow<List<Label>> = dao.labels().map { rows -> rows.map { it.toDomain() } }

    suspend fun createLabel(scopeId: String, name: String, color: String?): Label {
        val label = api.createLabel(scopeId, name, color)
        dao.putLabels(listOf(label.toEntity()))
        return label
    }

    suspend fun deleteLabel(id: String) {
        api.deleteLabel(id)
        dao.deleteLabel(id)
    }

    // ---------------------------------------------------------- tipologies

    val taskTypes: Flow<List<TaskType>> = dao.taskTypes().map { rows -> rows.map { it.toDomain() } }

    suspend fun refreshTaskTypes() {
        dao.replaceTaskTypes(api.taskTypes().map { it.toEntity() })
    }

    suspend fun createTaskType(scopeId: String, name: String, color: String?, required: Boolean): TaskType {
        val type = api.createTaskType(scopeId, name, color, required)
        dao.putTaskTypes(listOf(type.toEntity()))
        return type
    }

    suspend fun updateTaskType(id: String, name: String? = null, color: String? = null, required: Boolean? = null): TaskType {
        val type = api.updateTaskType(id, name, color, required)
        dao.putTaskTypes(listOf(type.toEntity()))
        return type
    }

    suspend fun deleteTaskType(id: String) {
        api.deleteTaskType(id)
        dao.deleteTaskType(id)
    }

    // ----------------------------------------------------------- comentaris

    fun commentsByTask(taskId: String): Flow<List<Comment>> =
        combine(dao.commentsByTask(taskId), dao.outboxFlow()) { rows, queue ->
            val comments = (rows.map { it.toDomain() } + queue.filter { it.rootTaskId() == taskId }
                .mapNotNull { it.toComment() })
            comments.distinctBy { it.id }.sortedWith(compareBy({ it.createdAt }, { it.id }))
        }

    suspend fun refreshComments(taskId: String) = flushLock.withLock {
        val comments = api.taskComments(taskId)
        moveLock.withLock {
            if (dao.task(taskId).first() != null) dao.replaceComments(taskId, comments.map { it.toEntity() })
        }
    }

    suspend fun addComment(taskId: String, body: String): Comment = moveLock.withLock {
        require(body.isNotBlank())
        checkNotNull(dao.task(taskId).first())
        val id = UUID.randomUUID().toString()
        val op = operation("comment", "create", id, 0, buildJsonObject {
            put("id", id)
            put("task_id", taskId)
            put("body", body.trim())
        }, taskId = taskId, parentId = taskId)
        dao.enqueue(op)
        checkNotNull(op.toComment())
    }

    // ------------------------------------------------------- llistes locals

    fun taskLists(taskId: String): Flow<TaskLists> =
        combine(dao.taskLists(taskId), dao.outboxFlow()) { _, _ ->
            // El rebut toca les dues taules. Llegir-les juntes evita que una subtasca
            // esborrada reaparegui mentre encara no ha arribat la nova llista al Flow.
            moveLock.withLock { localLists(taskId) }
        }.distinctUntilChanged()

    suspend fun refreshTaskLists(taskId: String) = flushLock.withLock {
        val subtasks = api.subtasks(taskId)
        val checklists = api.checklists(taskId)
        moveLock.withLock {
            if (dao.task(taskId).first() != null) dao.putTaskLists(TaskLists(subtasks, checklists).toEntity(taskId))
        }
    }

    suspend fun addSubtask(taskId: String, title: String) = moveLock.withLock {
        require(title.isNotBlank())
        checkNotNull(dao.task(taskId).first())
        val lists = localLists(taskId)
        val id = UUID.randomUUID().toString()
        val position = generatePosition(lists.subtasks.maxOfOrNull { it.position }, null)
        dao.enqueue(operation("subtask", "create", id, 0, buildJsonObject {
            put("task_id", taskId)
            put("title", title.trim())
            put("position", position)
        }, taskId = taskId, parentId = taskId))
    }

    suspend fun addChecklistItem(taskId: String, listName: String, text: String) = moveLock.withLock {
        require(listName.isNotBlank() && text.isNotBlank())
        checkNotNull(dao.task(taskId).first())
        val lists = localLists(taskId)
        val existing = lists.checklists.firstOrNull { it.name.equals(listName.trim(), ignoreCase = true) }
        val listId = existing?.id ?: UUID.randomUUID().toString()
        val now = System.currentTimeMillis()
        val createList = if (existing == null) operation("checklist", "create", listId, 0, buildJsonObject {
            put("task_id", taskId)
            put("name", listName.trim())
            put("position", generatePosition(lists.checklists.maxOfOrNull { it.position }, null))
        }, taskId = taskId, parentId = taskId, time = now) else null
        val createItem = operation("checklist_item", "create", UUID.randomUUID().toString(), 0, buildJsonObject {
            put("checklist_id", listId)
            put("text", text.trim())
            put("position", generatePosition(existing?.items?.maxOfOrNull { it.position }, null))
        }, taskId = taskId, parentId = listId, time = now)
        dao.enqueueAll(listOfNotNull(createList, createItem))
    }

    suspend fun setSubtask(taskId: String, id: String, done: Boolean) = moveLock.withLock {
        checkNotNull(dao.taskRow(taskId)?.takeUnless { it.deleted })
        val item = checkNotNull(localLists(taskId).subtasks.find { it.id == id })
        if (item.done != done) dao.enqueue(operation("subtask", "update", id, item.version,
            buildJsonObject { put("done", done) }, taskId = taskId, parentId = taskId))
    }

    suspend fun renameSubtask(taskId: String, id: String, title: String) = moveLock.withLock {
        require(title.isNotBlank())
        checkNotNull(dao.taskRow(taskId)?.takeUnless { it.deleted })
        val item = checkNotNull(localLists(taskId).subtasks.find { it.id == id })
        val trimmed = title.trim()
        if (item.title != trimmed) dao.enqueue(operation("subtask", "update", id, item.version,
            buildJsonObject { put("title", trimmed) }, taskId = taskId, parentId = taskId,
            base = buildJsonObject { put("title", item.title) }))
    }

    suspend fun deleteSubtask(taskId: String, id: String) = moveLock.withLock {
        checkNotNull(dao.taskRow(taskId)?.takeUnless { it.deleted })
        val item = localLists(taskId).subtasks.find { it.id == id } ?: return@withLock
        dao.enqueue(operation("subtask", "delete", id, item.version, buildJsonObject {},
            taskId = taskId, parentId = taskId))
    }

    suspend fun setChecklistItem(taskId: String, id: String, done: Boolean) = moveLock.withLock {
        val checklist = checkNotNull(localLists(taskId).checklists.find { list -> list.items.any { it.id == id } })
        if (checklist.items.first { it.id == id }.done != done) {
            dao.enqueue(operation("checklist_item", "update", id, 0, buildJsonObject { put("done", done) },
                taskId = taskId, parentId = checklist.id))
        }
    }

    private suspend fun localLists(taskId: String): TaskLists =
        dao.taskListsOnce(taskId).toTaskLists().withQueue(taskId, dao.outbox())

    /**
     * El servidor recorda el resultat d'un op_id. Només la decisió explícita de
     * conservar un canvi rebutjat crea una operació nova.
     */
    suspend fun resolveSyncIssue(opId: String, keepLocal: Boolean) = flushLock.withLock {
        val issue = dao.operation(opId) ?: return@withLock
        if (issue.state == "pending") return@withLock
        require(!keepLocal || issue.state != "revoked")
        val taskId = issue.rootTaskId()
        val canonical =
            if (issue.entity == "task" && issue.op != "create" && taskId != null) {
                try {
                    api.getTask(taskId)
                } catch (error: FemhoApi.ApiException) {
                    if (error.status != 404 && error.status != 403) throw error
                    if (keepLocal) throw error
                    null
                }
            } else null

        moveLock.withLock {
            val queue = dao.outbox()
            val serverSubtask = issue.serverEntity?.let(::objectFrom)?.takeIf {
                issue.entity == "subtask" && it.string("id") == issue.entityId && it.string("task_id") == taskId
            }
            val replacement = if (keepLocal) issue.retryOn(canonical, serverSubtask) else null
            val discarded = if (keepLocal) emptyList() else dependenciesToDiscard(issue, queue)
            val projected = canonical?.let { server ->
                queue.filter { it.entity == "task" && it.entityId == server.id && it.opId !in discarded }
                    .map { if (it.opId == issue.opId && replacement != null) replacement else it }
                    .let { remaining ->
                        remaining.fold(server) { value, next -> value.applyOperation(next) }
                            .toEntity(deleted = remaining.any { it.op == "delete" })
                    }
            }
            val syncedSubtask = if (serverSubtask != null && taskId != null) {
                val known = dao.taskListsOnce(taskId).toTaskLists()
                val op = if (serverSubtask["deleted_at"].let { it == null || it == JsonNull }) "update" else "delete"
                val updated = known.applyOperation(issue.copy(op = op), serverSubtask)
                val parent = dao.taskRow(taskId)?.let { row ->
                    row.toDomain().withSubtaskProgress(known, updated).toEntity(deleted = row.deleted)
                }
                updated.toEntity(taskId) to parent
            } else null
            val replaceTask = issue.entity == "task" && (canonical != null || !keepLocal)
            dao.resolveIssue(
                discarded,
                issue.opId.takeIf { replacement != null },
                replacement,
                if (replaceTask) taskId else null,
                projected ?: syncedSubtask?.second,
                syncedSubtask?.first,
            )
        }
    }

    // ------------------------------------------------------------ sessions

    val sessions: Flow<List<Session>> = dao.sessions().map { rows -> rows.map { it.toDomain() } }

    suspend fun createSession(
        id: String,
        taskId: String,
        startedAt: String,
        endedAt: String? = null,
        note: String? = null,
    ): Session {
        val session = api.createSession(id, taskId, startedAt, endedAt, note)
        dao.putSessions(listOf(session.toEntity()))
        return session
    }

    suspend fun updateSession(id: String, startedAt: String? = null, endedAt: String? = null, taskId: String? = null, note: String? = null): Session {
        val session = api.updateSession(id, startedAt, endedAt, taskId, note)
        dao.putSessions(listOf(session.toEntity()))
        return session
    }

    suspend fun deleteSession(id: String) {
        api.deleteSession(id)
        dao.deleteSession(id)
    }

    // ----------------------------------------------------------- calendaris

    val calendars: Flow<List<Calendar>> = dao.calendars().map { rows -> rows.map { it.toDomain() } }

    suspend fun createCalendar(
        scopeId: String? = null,
        projectId: String? = null,
        name: String,
        color: String? = null,
        origin: String = "local",
        sourceKind: String? = null,
        sourceUrl: String? = null,
        sourceUsername: String? = null,
        sourceSecret: String? = null,
        refreshInterval: Int? = null,
        inboxVisible: Boolean? = null,
    ): Calendar {
        val calendar = api.createCalendar(scopeId, projectId, name, color, origin, sourceKind, sourceUrl, sourceUsername, sourceSecret, refreshInterval, inboxVisible)
        dao.putCalendars(listOf(calendar.toEntity()))
        return calendar
    }

    suspend fun updateCalendar(
        id: String,
        name: String? = null,
        color: String? = null,
        sourceUrl: String? = null,
        sourceUsername: String? = null,
        sourceSecret: String? = null,
        refreshInterval: Int? = null,
        inboxVisible: Boolean? = null,
    ): Calendar {
        val calendar = api.updateCalendar(id, name, color, sourceUrl, sourceUsername, sourceSecret, refreshInterval, inboxVisible)
        dao.putCalendars(listOf(calendar.toEntity()))
        return calendar
    }

    suspend fun deleteCalendar(id: String) {
        api.deleteCalendar(id)
        dao.deleteCalendar(id)
    }

    // ------------------------------------------------------ comptes correu

    val mailAccounts: Flow<List<MailAccount>> = dao.mailAccounts().map { rows -> rows.map { it.toDomain() } }

    suspend fun createMailAccount(name: String, host: String, username: String, password: String, security: String): MailAccount {
        val account = api.createMailAccount(name, host, username, password, security)
        dao.putMailAccounts(listOf(account.toEntity()))
        return account
    }

    suspend fun updateMailAccount(id: String, name: String? = null, host: String? = null, username: String? = null, password: String? = null, security: String? = null): MailAccount {
        val account = api.updateMailAccount(id, name, host, username, password, security)
        dao.putMailAccounts(listOf(account.toEntity()))
        return account
    }

    suspend fun deleteMailAccount(id: String) {
        api.deleteMailAccount(id)
        dao.deleteMailAccount(id)
    }

    suspend fun testMailAccount(id: String, password: String? = null): MailTestResult =
        api.testMailAccount(id, password)

    val mailFolders: suspend (String) -> List<Map<String, Any>> = api::mailFolders

    // -------------------------------------------------------- regles correu

    val mailRules: Flow<List<MailRule>> = dao.mailRules().map { rows -> rows.map { it.toDomain() } }

    suspend fun createMailRule(
        accountId: String,
        folder: String,
        scopeId: String? = null,
        projectId: String? = null,
        titleTemplate: String? = null,
        inboxVisible: Boolean? = null,
    ): MailRule {
        val rule = api.createMailRule(accountId, folder, scopeId, projectId, titleTemplate, inboxVisible)
        dao.putMailRules(listOf(rule.toEntity()))
        return rule
    }

    suspend fun updateMailRule(
        id: String,
        folder: String? = null,
        scopeId: String? = null,
        projectId: String? = null,
        titleTemplate: String? = null,
        inboxVisible: Boolean? = null,
    ): MailRule {
        val rule = api.updateMailRule(id, folder, scopeId, projectId, titleTemplate, inboxVisible)
        dao.putMailRules(listOf(rule.toEntity()))
        return rule
    }

    suspend fun deleteMailRule(id: String) {
        api.deleteMailRule(id)
        dao.deleteMailRule(id)
    }

    // -------------------------------------------------- configuració àmbit

    fun scopeSettings(scopeId: String): Flow<ScopeSettings> =
        dao.scopeSettings(scopeId).map { row -> row?.toDomain() ?: ScopeSettings() }

    suspend fun refreshScopeSettings(scopeId: String): ScopeSettings = api.scopeSettings(scopeId).also {
        dao.putScopeSettings(it.toEntity(scopeId))
    }

    suspend fun updateScopeSettings(
        scopeId: String,
        timeTracking: Boolean? = null,
        workStart: String? = null,
        workEnd: String? = null,
        workDays: List<Int>? = null,
        overtimeVisible: Boolean? = null,
        longSessionHours: Int? = null,
        projectNoun: String? = null,
        taskTypesEnabled: Boolean? = null,
    ): ScopeSettings {
        val settings = api.updateScopeSettings(scopeId, timeTracking, workStart, workEnd, workDays, overtimeVisible, longSessionHours, projectNoun, taskTypesEnabled)
        dao.putScopeSettings(settings.toEntity(scopeId))
        return settings
    }

    // ---------------------------------------------------------------- agents

    val agents: Flow<List<Agent>> = dao.agents().map { rows -> rows.map { it.toDomain() } }

    suspend fun refreshAgents() {
        val agents = api.agents()
        dao.putAgents(agents.map { it.toEntity() })
    }

    suspend fun updateAgentScopes(agentId: String, scopeIds: List<String>, allScopes: Boolean) {
        api.updateAgentScopes(agentId, scopeIds, allScopes)
        // Refrescar l'agent després de canviar els àmbits
        val agents = api.agents()
        dao.putAgents(agents.map { it.toEntity() })
    }

    suspend fun createAgentCredential(agentId: String): Map<String, Any> =
        api.createAgentCredential(agentId)

    // ----------------------------------------------------------- projectes

    /**
     * Crea un projecte. **Pot encuar-se** (project és a sync.ts:64-70), però en aquesta
     * passada es tracta com a escriptura en línia per simplicitat —el mateix patró que createTask.
     */
    suspend fun createProject(scopeId: String, name: String): Project {
        val project = api.createProject(scopeId, name)
        dao.putProjects(listOf(project.toEntity()))
        return project
    }

    suspend fun updateProject(id: String, name: String? = null, archived: Boolean? = null): Project {
        val project = api.updateProject(id, name, archived)
        dao.putProjects(listOf(project.toEntity()))
        return project
    }

    suspend fun deleteProject(id: String) {
        api.deleteProject(id)
        dao.deleteProject(id)
    }

    // ---------------------------------------------------------------- àmbits

    suspend fun createScope(name: String, color: String, kind: String = "individual", icon: String? = null): Scope {
        val scope = api.createScope(name, color, kind, icon)
        dao.putScopes(listOf(scope.toEntity()))
        return scope
    }

    suspend fun updateScope(id: String, name: String? = null, color: String? = null, icon: String? = null): Scope {
        val scope = api.updateScope(id, name, color, icon)
        dao.putScopes(listOf(scope.toEntity()))
        return scope
    }

    suspend fun deleteScope(id: String) {
        api.deleteScope(id)
        dao.deleteScope(id)
    }

    // ------------------------------------------------------------- tasques

    /** Actualitza camps nous d'una tasca (descripció, venciment, repetició, etc.). */
    suspend fun updateTask(id: String, fields: Map<String, Any?>): Task {
        val task = api.updateTask(id, fields)
        dao.putTasks(listOf(task.toEntity()))
        return task
    }

    suspend fun deleteTask(id: String) = moveLock.withLock {
        val current = checkNotNull(dao.task(id).first()?.toDomain())
        dao.putTaskAndEnqueue(current.toEntity(deleted = true),
            operation("task", "delete", id, current.version, buildJsonObject {}, taskId = id))
    }

    suspend fun addAssignee(taskId: String, userId: String) {
        api.addAssignee(taskId, userId)
        // Refrescar la tasca per actualitzar assigneeIds
        refresh(emptyList(), null)
    }

    suspend fun removeAssignee(taskId: String, userId: String) {
        api.removeAssignee(taskId, userId)
        refresh(emptyList(), null)
    }

    suspend fun takeOverTask(taskId: String, status: String): Task {
        val task = api.takeOverTask(taskId, status)
        dao.putTasks(listOf(task.toEntity()))
        return task
    }

    suspend fun undoActivity(id: String): Map<String, Any> =
        api.undoActivity(id)

    // ----------------------------------------------------------- compartits

    val shares: Flow<List<ShareSummary>> = kotlinx.coroutines.flow.flow {
        emit(api.shares())
    }

    suspend fun createShare(
        taskId: String? = null,
        checklistId: String? = null,
        permission: String,
        requireName: Boolean = false,
        password: String? = null,
        expiresAt: String? = null,
        maxViews: Int? = null,
    ): ShareCreated =
        api.createShare(taskId, checklistId, permission, requireName, password, expiresAt, maxViews)

    suspend fun revokeShare(id: String) {
        api.revokeShare(id)
    }

    suspend fun shareAccesses(id: String): List<ShareAccess> =
        api.shareAccesses(id)

    // ------------------------------------------------------------- convits

    suspend fun acceptJoin(token: String) {
        api.acceptJoin(token)
    }

    suspend fun inviteAccept(token: String, password: String) {
        api.inviteAccept(token, password)
    }

    // --------------------------------------------------------------- cerca

    suspend fun search(q: String, limit: Int? = null): TaskPage =
        api.search(q, limit)

    // ----------------------------------------------------------- dashboard

    suspend fun dashboard(): DashboardView =
        api.dashboard()

    // ---------------------------------------------------------------- admin

    suspend fun inviteAdminUser(email: String, name: String): Map<String, Any> =
        api.inviteAdminUser(email, name)

    suspend fun updateAdminUser(id: String, name: String? = null, role: String? = null): Map<String, Any> =
        api.updateAdminUser(id, name, role)

    suspend fun deleteAdminUser(id: String) {
        api.deleteAdminUser(id)
    }

    // ----------------------------------------------------------------- auth

    suspend fun changePassword(current: String, new: String): Map<String, Any> =
        api.changePassword(current, new)

    suspend fun updateProfile(name: String? = null, locale: String? = null, theme: String? = null, accent: String? = null): UserProfile {
        val profile = api.updateProfile(name, locale, theme, accent)
        return profile
    }

    suspend fun updateSettings(
        gravatar: Boolean? = null,
        weekStart: String? = null,
        eventTaskDeleted: String? = null,
        showCalendarWidget: Boolean? = null,
        showOverdueSection: Boolean? = null,
        inboxPosition: String? = null,
        inboxShowOverdue: Boolean? = null,
    ) =
        api.updateSettings(gravatar, weekStart, eventTaskDeleted, showCalendarWidget, showOverdueSection, inboxPosition, inboxShowOverdue)

}

/**
 * L'estat de la primera —i única— operació del lot.
 *
 * Es llegeix amb el JSON de `kotlinx` i no amb un regex: `"status"` també és un camp de
 * les tasques, i l'entitat que el servidor torna dins del resultat en porta un.
 */
internal fun batchStatus(response: String, opId: String): String? = batchReceipt(response, opId)?.string("status")

private fun batchReceipt(response: String, opId: String): JsonObject? = runCatching {
    storedJson.parseToJsonElement(response)
        .jsonObject["results"]
        ?.jsonArray
        ?.firstOrNull { it.jsonObject["op_id"]?.jsonPrimitive?.content == opId }
        ?.jsonObject
}.getOrNull()

// ------------------------------------------------------------------ conversions

internal fun TaskEntity.toDomain(): Task = (taskJson?.let {
    runCatching { storedJson.decodeFromString<Task>(it) }.getOrNull()
} ?: Task(id = id, scopeId = scopeId, title = title, position = position)).copy(
    id = id,
    scopeId = scopeId,
    projectId = projectId,
    title = title,
    description = description,
    status = TaskStatus.entries.firstOrNull { it.name.equals(status, true) } ?: TaskStatus.INBOX,
    position = position,
    dueDate = dueDate,
    dueTime = dueTime,
    completedAt = completedAt,
    aiMode = AiMode.entries.firstOrNull { it.wire == aiMode } ?: AiMode.MANUAL,
    assigneeIds = if (assigneeIds.isEmpty()) emptyList() else assigneeIds.split(","),
    version = version,
)

internal fun Task.toEntity(deleted: Boolean = false): TaskEntity = TaskEntity(
    id = id,
    scopeId = scopeId,
    projectId = projectId,
    title = title,
    description = description,
    status = status.name.lowercase(),
    position = position,
    dueDate = dueDate,
    dueTime = dueTime,
    completedAt = completedAt,
    aiMode = aiMode.wire,
    assigneeIds = assigneeIds.joinToString(","),
    version = version,
    deleted = deleted,
    taskJson = storedJson.encodeToString(this),
)

private fun objectFrom(value: String): JsonObject =
    runCatching { storedJson.parseToJsonElement(value) as JsonObject }.getOrDefault(JsonObject(emptyMap()))

private fun JsonObject.primitive(key: String): JsonPrimitive? = this[key] as? JsonPrimitive
private fun JsonObject.string(key: String): String? = primitive(key)?.contentOrNull
private fun JsonObject.bool(key: String): Boolean? =
    primitive(key)?.let { it.booleanOrNull ?: it.intOrNull?.let { number -> number != 0 } }

private fun JsonObject.toTaskOrNull(): Task? = runCatching {
    val normalized = bool("needs_attention")?.let {
        JsonObject(this + ("needs_attention" to JsonPrimitive(it)))
    } ?: this
    storedJson.decodeFromJsonElement<Task>(normalized)
}.getOrNull()

private fun Task.withPatch(changes: JsonObject): Task =
    storedJson.decodeFromJsonElement(JsonObject(storedJson.encodeToJsonElement(this).jsonObject + changes))

private fun Task.baseText(changes: JsonObject): JsonObject = JsonObject(
    buildMap {
        if ("title" in changes) put("title", JsonPrimitive(title))
        if ("description" in changes) put("description", description?.let(::JsonPrimitive) ?: JsonNull)
        if ("ai_instructions" in changes) put("ai_instructions", aiInstructions?.let(::JsonPrimitive) ?: JsonNull)
    },
)

private fun Task.applyOperation(operation: OutboxEntity): Task {
    val payload = objectFrom(operation.payload)
    return when (operation.op) {
        "update" -> withPatch(payload)
        "move" -> withPatch(JsonObject(payload + ("completed_at" to
            if (payload.string("status") == "done") JsonPrimitive(Instant.ofEpochMilli(operation.queuedAt).toString())
            else JsonNull)))
        else -> this
    }
}

private fun operation(
    entity: String, op: String, id: String, baseVersion: Int, payload: JsonObject,
    taskId: String?, parentId: String? = null, base: JsonObject? = null, time: Long = System.currentTimeMillis(),
): OutboxEntity = OutboxEntity(
    UUID.randomUUID().toString(), entity, op, id, baseVersion, payload.toString(), time,
    taskId = taskId, parentId = parentId, baseFields = base?.toString(),
)

private fun OutboxEntity.rootTaskId(): String? = taskId ?: entityId.takeIf { entity == "task" }

private fun OutboxEntity.isPendingTaskEdit(task: String): Boolean =
    (entity == "task" && entityId == task) ||
        (entity in listOf("pomodoro", CALENDAR_SUGGESTIONS) && state == "pending" && taskId == task)

private fun PomodoroSnapshot.toCache(offsetMs: Long, issueId: String?): PomodoroCacheEntity = PomodoroCacheEntity(
    snapshot = storedJson.encodeToString(copy(movedTask = null)), clockOffsetMs = offsetMs, issueId = issueId,
)

private fun CalendarTaskSuggestions.toCache(issueId: String?) = CalendarSuggestionsCacheEntity(
    snapshot = storedJson.encodeToString(this), issueId = issueId,
)

private fun projectDoingAutoStop(cachedMinutes: Int?, outbox: List<OutboxEntity>): Int? {
    val latest = outbox.lastOrNull { it.entity == USER_SETTINGS && it.state == "pending" }
        ?: return cachedMinutes
    return objectFrom(latest.payload).primitive(DOING_AUTO_STOP_MINUTES)?.intOrNull
}

internal fun projectCalendarSuggestions(cache: CalendarSuggestionsCacheEntity?, outbox: List<OutboxEntity>): CalendarTaskSuggestions {
    val initial = cache?.let { storedJson.decodeFromString<CalendarTaskSuggestions>(it.snapshot) }
        ?: CalendarTaskSuggestions()
    return outbox.asSequence().filter { it.entity == CALENDAR_SUGGESTIONS && it.state == "pending" }
        .fold(initial) { state, queued -> state.withCalendarCommand(objectFrom(queued.payload)) }
}

private fun CalendarTaskSuggestions.withCalendarCommand(command: JsonObject): CalendarTaskSuggestions {
    if (command.string("type") == "configure") return copy(enabled = command.bool("enabled") ?: enabled)
    val occurrence = command["occurrence"] as? JsonObject ?: return this
    val key = storedJson.decodeFromJsonElement<ho.fem.model.SourceEvent>(occurrence)
    val started = command.string("type") == "start"
    return copy(items = items.mapNotNull { item ->
        if (item.occurrence != key || item.startsAt != command.string("starts_at")) item
        else if (started) null
        else item.copy(declined = true)
    })
}

private fun calendarTaskId(at: Instant): String {
    val random = UUID.randomUUID()
    // L'hora que tria el timer és independent de la que ordena la creació de l'identificador.
    val timestampAndVersion = (at.toEpochMilli() shl 16) or 0x7000L or (random.mostSignificantBits and 0xfffL)
    return UUID(timestampAndVersion, random.leastSignificantBits).toString()
}

private fun OutboxEntity.requestBody(): String = buildJsonObject {
    put("operations", kotlinx.serialization.json.JsonArray(listOf(buildJsonObject {
        put("op_id", opId)
        put("entity", entity)
        put("op", op)
        put("id", entityId)
        put("base_version", baseVersion)
        put("occurred_at", Instant.ofEpochMilli(queuedAt).toString())
        put("data", storedJson.parseToJsonElement(payload))
    })))
}.toString()

private fun OutboxEntity.retryOn(task: Task?, subtask: JsonObject?): OutboxEntity {
    val changes = objectFrom(payload).toMutableMap()
    if (entity == "task" && op == "move" && task != null) {
        changes["from_status"] = JsonPrimitive(task.status.name.lowercase())
        changes["occurred_at"] = JsonPrimitive(Instant.now().toString())
    }
    val updated = JsonObject(changes)
    val childTitle = subtask?.string("title")?.takeIf { "title" in updated }
    return copy(
        opId = UUID.randomUUID().toString(),
        baseVersion = task?.version ?: subtask?.primitive("version")?.intOrNull ?: baseVersion,
        payload = updated.toString(),
        baseFields = task?.baseText(updated)?.toString()
            ?: childTitle?.let { buildJsonObject { put("title", it) }.toString() } ?: baseFields,
        state = "pending", attempts = 0, detail = null, serverEntity = null,
    )
}

private fun dependenciesToDiscard(issue: OutboxEntity, queue: List<OutboxEntity>): List<String> {
    if (issue.op != "create") return listOf(issue.opId)
    val roots = mutableSetOf(issue.entityId)
    return queue.filter {
        val affected = it.entityId in roots || it.parentId in roots || it.rootTaskId() in roots
        if (affected && it.op == "create") roots += it.entityId
        affected
    }.map { it.opId }
}

private fun OutboxEntity.toComment(): Comment? {
    if (entity != "comment" || op != "create") return null
    val parent = rootTaskId() ?: return null
    return Comment(
        id = entityId, taskId = parent,
        body = objectFrom(payload).string("body").orEmpty(),
        createdAt = Instant.ofEpochMilli(queuedAt).toString(),
    )
}

private fun TaskListsEntity?.toTaskLists(): TaskLists = this?.let {
    TaskLists(storedJson.decodeFromString(it.subtasks), storedJson.decodeFromString(it.checklists))
} ?: TaskLists()

private fun TaskLists.toEntity(taskId: String): TaskListsEntity = TaskListsEntity(
    taskId, storedJson.encodeToString(subtasks), storedJson.encodeToString(checklists),
)

private fun TaskLists.withQueue(taskId: String, queue: List<OutboxEntity>): TaskLists =
    queue.filter { it.rootTaskId() == taskId && it.entity in setOf("subtask", "checklist", "checklist_item") }
        .fold(this) { value, next -> value.applyOperation(next) }

private fun Task.withSubtaskProgress(before: TaskLists, after: TaskLists): Task {
    val previous = progress ?: TaskProgress()
    val done = after.subtasks.count { it.done } - before.subtasks.count { it.done }
    val total = after.subtasks.size - before.subtasks.size
    val lists = when {
        before.subtasks.isNotEmpty() && after.subtasks.isEmpty() -> -1
        // El recompte del tauler pot incloure subtasques que encara no hem baixat.
        before.subtasks.isEmpty() && after.subtasks.isNotEmpty() && previous.lists <= before.checklists.size -> 1
        else -> 0
    }
    return if (done == 0 && total == 0 && lists == 0) this else copy(progress = TaskProgress(
        done = (previous.done + done).coerceAtLeast(0),
        total = (previous.total + total).coerceAtLeast(0),
        lists = (previous.lists + lists).coerceAtLeast(0),
    ))
}

private fun TaskLists.applyOperation(operation: OutboxEntity, entity: JsonObject? = null): TaskLists {
    val data = entity ?: objectFrom(operation.payload)
    val id = operation.entityId
    val done = data.bool("done")
    return when (operation.entity) {
        "subtask" -> {
            if (operation.op == "delete") return copy(
                subtasks = subtasks.filterNot { it.id == id },
                checklists = checklists.map { if (it.subtaskId == id) it.copy(subtaskId = null) else it },
            )
            val updated = if (operation.op == "create") {
                val item = Subtask(id, requireNotNull(operation.rootTaskId()), data.string("title").orEmpty(), done ?: false,
                    data.string("position").orEmpty(), data.primitive("version")?.intOrNull ?: 1)
                subtasks.filterNot { it.id == id } + item
            } else {
                subtasks.map { if (it.id != id) it else it.copy(
                    title = data.string("title") ?: it.title,
                    done = done ?: it.done,
                    position = data.string("position") ?: it.position,
                    version = data.primitive("version")?.intOrNull ?: it.version) }
            }
            copy(subtasks = updated.sortedWith(compareBy({ it.position }, { it.id })))
        }
        "checklist" -> {
            val existing = checklists.find { it.id == id }
            val list = existing ?: Checklist(id, requireNotNull(operation.rootTaskId()),
                name = data.string("name").orEmpty(), position = data.string("position").orEmpty())
            copy(checklists = (checklists.filterNot { it.id == id } + list).sortedWith(compareBy({ it.position }, { it.id })))
        }
        "checklist_item" -> copy(checklists = checklists.map { list ->
            if (list.id != operation.parentId) return@map list
            val updated = if (operation.op == "create") {
                list.items.filterNot { it.id == id } + ChecklistItem(
                    id, list.id, data.string("text").orEmpty(), done ?: false, data.string("position").orEmpty(),
                )
            } else list.items.map { if (it.id == id) it.copy(done = done ?: it.done) else it }
            list.copy(items = updated.sortedWith(compareBy({ it.position }, { it.id })))
        })
        else -> this
    }
}

internal fun ScopeEntity.toDomain(): Scope = Scope(
    id = id,
    name = name,
    kind = ScopeKind.entries.firstOrNull { it.name.equals(kind, true) } ?: ScopeKind.INDIVIDUAL,
    color = color,
    position = position,
    ownerId = "",
)

internal fun Scope.toEntity(): ScopeEntity =
    ScopeEntity(id = id, name = name, kind = kind.name.lowercase(), color = color, position = position)

internal fun ProjectEntity.toDomain(): Project =
    Project(id = id, scopeId = scopeId, name = name, position = position)

internal fun Project.toEntity(): ProjectEntity =
    ProjectEntity(id = id, scopeId = scopeId, name = name, position = position)

internal fun LabelEntity.toDomain(): Label =
    Label(id = id, scopeId = scopeId, name = name, color = color, createdAt = createdAt)

internal fun Label.toEntity(): LabelEntity =
    LabelEntity(id = id, scopeId = scopeId, name = name, color = color, createdAt = createdAt)

internal fun TaskTypeEntity.toDomain(): TaskType =
    TaskType(id = id, scopeId = scopeId, name = name, color = color, position = position, required = required)

internal fun TaskType.toEntity(): TaskTypeEntity =
    TaskTypeEntity(id = id, scopeId = scopeId, name = name, color = color, position = position, required = required)

internal fun CommentEntity.toDomain(): Comment =
    Comment(
        id = id,
        taskId = taskId,
        authorId = authorId,
        authorName = authorName,
        agentId = agentId,
        body = body,
        createdAt = createdAt,
    )

internal fun Comment.toEntity(): CommentEntity =
    CommentEntity(
        id = id,
        taskId = taskId,
        authorId = authorId,
        authorName = authorName,
        agentId = agentId,
        body = body,
        createdAt = createdAt,
    )

internal fun SessionEntity.toDomain(): Session =
    Session(
        id = id,
        taskId = taskId,
        scopeId = scopeId,
        userId = userId,
        startedAt = startedAt,
        endedAt = endedAt,
        source = source,
        note = note,
    )

internal fun Session.toEntity(): SessionEntity =
    SessionEntity(
        id = id,
        taskId = taskId,
        scopeId = scopeId,
        userId = userId,
        startedAt = startedAt,
        endedAt = endedAt,
        source = source,
        note = note,
    )

internal fun CalendarEntity.toDomain(): Calendar =
    Calendar(
        id = id,
        scopeId = scopeId,
        projectId = projectId,
        name = name,
        color = color,
        origin = CalendarOrigin.entries.firstOrNull { it.name.equals(origin, true) } ?: CalendarOrigin.LOCAL,
        sourceKind = sourceKind?.let { ho.fem.model.SourceKind.entries.firstOrNull { k -> k.name.equals(it, true) } },
        sourceUrl = sourceUrl,
        refreshInterval = refreshInterval,
        inboxVisible = inboxVisible,
        lastRefreshedAt = lastRefreshedAt,
        lastError = lastError,
        sharedWithScope = sharedWithScope,
    )

internal fun Calendar.toEntity(): CalendarEntity =
    CalendarEntity(
        id = id,
        scopeId = scopeId,
        projectId = projectId,
        name = name,
        color = color,
        origin = origin.name.lowercase(),
        sourceKind = sourceKind?.name?.lowercase(),
        sourceUrl = sourceUrl,
        refreshInterval = refreshInterval,
        inboxVisible = inboxVisible,
        lastRefreshedAt = lastRefreshedAt,
        lastError = lastError,
        sharedWithScope = sharedWithScope,
    )

internal fun MailAccountEntity.toDomain(): MailAccount =
    MailAccount(
        id = id,
        name = name,
        host = host,
        username = username,
        hasSecret = hasSecret,
        authMethod = authMethod,
        oauthStatus = oauthStatus,
        security = MailSecurity.entries.firstOrNull { it.name.equals(security, true) } ?: MailSecurity.TLS,
        createdAt = createdAt,
    )

internal fun MailAccount.toEntity(): MailAccountEntity =
    MailAccountEntity(
        id = id,
        name = name,
        host = host,
        username = username,
        hasSecret = hasSecret,
        authMethod = authMethod,
        oauthStatus = oauthStatus,
        security = security.name.lowercase(),
        createdAt = createdAt,
    )

internal fun MailRuleEntity.toDomain(): MailRule =
    MailRule(
        id = id,
        accountId = accountId,
        folder = folder,
        scopeId = scopeId,
        projectId = projectId,
        titleTemplate = titleTemplate,
        inboxVisible = inboxVisible,
    )

internal fun MailRule.toEntity(): MailRuleEntity =
    MailRuleEntity(
        id = id,
        accountId = accountId,
        folder = folder,
        scopeId = scopeId,
        projectId = projectId,
        titleTemplate = titleTemplate,
        inboxVisible = inboxVisible,
    )

internal fun ScopeSettingsEntity.toDomain(): ScopeSettings =
    ScopeSettings(
        timeTracking = timeTracking,
        workStart = workStart,
        workEnd = workEnd,
        workDays = workDays,
        overtimeVisible = overtimeVisible,
        longSessionHours = longSessionHours,
        projectNoun = projectNoun,
        taskTypesEnabled = taskTypesEnabled,
    )

internal fun ScopeSettings.toEntity(scopeId: String): ScopeSettingsEntity =
    ScopeSettingsEntity(
        scopeId = scopeId,
        timeTracking = timeTracking,
        workStart = workStart,
        workEnd = workEnd,
        workDays = workDays,
        overtimeVisible = overtimeVisible,
        longSessionHours = longSessionHours,
        projectNoun = projectNoun,
        taskTypesEnabled = taskTypesEnabled,
    )

internal fun AgentEntity.toDomain(): Agent =
    Agent(
        id = id,
        name = name,
        enabled = enabled,
    )

internal fun Agent.toEntity(): AgentEntity =
    AgentEntity(
        id = id,
        name = name,
        enabled = enabled,
        canCreateTasks = false,
        scopeIds = "",
        allScopes = false,
        createdAt = null,
    )

internal fun AgentDetail.toEntity(): AgentEntity =
    AgentEntity(
        id = id,
        name = name,
        enabled = enabled,
        canCreateTasks = canCreateTasks,
        scopeIds = scopeIds.joinToString(","),
        allScopes = allScopes,
        createdAt = createdAt,
    )
