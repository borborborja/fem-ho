package ho.fem.data

import ho.fem.model.AiMode
import ho.fem.model.CalendarTaskStart
import ho.fem.model.CalendarTaskSuggestion
import ho.fem.model.CalendarTaskSuggestions
import ho.fem.model.Checklist
import ho.fem.model.RecurrenceMode
import ho.fem.model.Subtask
import ho.fem.model.Task
import ho.fem.model.TaskProgress
import ho.fem.model.TaskStatus
import ho.fem.network.FemhoApi
import ho.fem.network.InMemoryTokenStore
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okio.Buffer
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import java.io.IOException
import java.lang.reflect.Proxy
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

/** Prova la cua real amb un transport controlat, sense base ni servidor personals. */
class RepositorySyncTest {
    private val operation = OutboxEntity("a", "task", "create", "task-a", 0, "{}", 1L)

    private fun repository(queue: MutableList<OutboxEntity>, body: String, requests: MutableList<String>): Repository =
        repository(queue, { body }, requests)

    private fun repository(
        queue: MutableList<OutboxEntity>,
        response: (Int) -> String,
        requests: MutableList<String>,
        requestBodies: MutableList<String> = mutableListOf(),
        tasks: MutableMap<String, TaskEntity> = mutableMapOf(),
        lists: MutableMap<String, TaskListsEntity> = mutableMapOf(),
        calendarCache: MutableList<CalendarSuggestionsCacheEntity>? = null,
        cachedScopeSettings: MutableMap<String, ScopeSettingsEntity> = mutableMapOf(),
    ): Repository {
        val dao = Proxy.newProxyInstance(
            FemhoDao::class.java.classLoader, arrayOf(FemhoDao::class.java),
        ) { _, method, args ->
            when (method.name) {
                "outbox" -> queue.toList()
                "operation" -> queue.find { it.opId == args!![0] }
                "dequeue" -> { queue.removeAll { it.opId == args!![0] }; Unit }
                "markIssue" -> {
                    val index = queue.indexOfFirst { it.opId == args!![0] }
                    queue[index] = queue[index].copy(state = args!![1] as String,
                        detail = args[2] as String?, serverEntity = args[3] as String?)
                    Unit
                }
                "failed", "putTasks" -> Unit
                "lastPosition" -> null
                "task" -> flowOf(tasks[args!![0]])
                "taskRow" -> tasks[args!![0]]
                "taskRows" -> tasks.values.toList()
                "taskLists" -> flowOf(lists[args!![0]])
                "taskListsOnce" -> lists[args!![0]]
                "enqueue" -> { queue += args!![0] as OutboxEntity; Unit }
                "enqueueAll" -> { queue += (args!![0] as List<*>).filterIsInstance<OutboxEntity>(); Unit }
                "putTaskAndEnqueue" -> {
                    val task = args!![0] as TaskEntity
                    tasks[task.id] = task
                    queue += args[1] as OutboxEntity
                    Unit
                }
                "acknowledgeTask" -> {
                    queue.removeAll { it.opId == args!![0] }
                    (args!![1] as List<*>).filterIsInstance<OutboxEntity>().forEach { updated ->
                        queue[queue.indexOfFirst { it.opId == updated.opId }] = updated
                    }
                    val task = args[2] as TaskEntity
                    tasks[task.id] = task
                    Unit
                }
                "acknowledgeChild" -> {
                    (args!![1] as TaskListsEntity?)?.let { lists[it.taskId] = it }
                    (args[3] as List<*>).filterIsInstance<OutboxEntity>().forEach { updated ->
                        queue[queue.indexOfFirst { it.opId == updated.opId }] = updated
                    }
                    (args[4] as TaskEntity?)?.let { tasks[it.id] = it }
                    queue.removeAll { it.opId == args[0] }
                    Unit
                }
                "resolveIssue" -> {
                    val discarded = args!![0] as List<*>
                    queue.removeAll { it.opId in discarded }
                    (args[2] as OutboxEntity?)?.let { replacement ->
                        queue[queue.indexOfFirst { it.opId == args[1] }] = replacement
                    }
                    (args[4] as TaskEntity?)?.let { tasks[it.id] = it }
                    (args[5] as TaskListsEntity?)?.let { lists[it.taskId] = it }
                    Unit
                }
                "outboxFlow" -> flowOf(queue.toList())
                "pomodoroCache" -> flowOf(null)
                "calendarSuggestionsCache" -> flowOf(calendarCache?.firstOrNull())
                "calendarSuggestionsCacheOnce" -> calendarCache?.firstOrNull()
                "scopeSettings" -> flowOf(cachedScopeSettings[args!![0]])
                "putScopeSettings" -> {
                    val row = args!![0] as ScopeSettingsEntity
                    cachedScopeSettings[row.scopeId] = row
                    Unit
                }
                "resolveCalendarSuggestionOperations" -> {
                    checkNotNull(calendarCache).clear()
                    calendarCache.add(args!![0] as CalendarSuggestionsCacheEntity)
                    queue.removeAll { it.opId in args[1] as List<*> }
                    (args[4] as String?)?.let { tasks.remove(it) }
                    (args[2] as List<*>).filterIsInstance<TaskEntity>().forEach { tasks[it.id] = it }
                    (args[3] as List<*>).filterIsInstance<OutboxEntity>().forEach { edit ->
                        queue[queue.indexOfFirst { it.opId == edit.opId }] = edit
                    }
                    Unit
                }
                "tasks" -> flowOf(tasks.values.toList())
                "scopes", "projects", "people", "labels", "taskTypes", "sessions", "calendars", "mailAccounts", "mailRules", "agents" -> flowOf(emptyList<Any>())
                else -> error("Crida inesperada: ${method.name}")
            }
        } as FemhoDao
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            val body = response(requests.size)
            requests += chain.request().url.encodedPath
            requestBodies += Buffer().apply { chain.request().body?.writeTo(this) }.readUtf8()
            Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1)
                .code(200).message("OK").body(body.toResponseBody()).build()
        }.build()
        return Repository(dao, FemhoApi("http://localhost", InMemoryTokenStore(), client),
            ownerId = if (calendarCache == null) null else "account")
    }

    @Test
    fun `l'inici del calendari i el moviment posterior sobreviuen a tornar a obrir la cua`() = runBlocking {
        val planned = Instant.parse("2026-11-21T09:00:00Z")
        val action = planned.plusSeconds(600)
        val eventTitle = "Calendar fixture"
        val item = CalendarTaskSuggestion(
            calendarId = "calendar", uid = "event", scopeId = "work", title = eventTitle,
            calendarName = "Work", startsAt = planned.toString(), endsAt = planned.plusSeconds(1800).toString(),
            allDay = false, declined = false, canStart = true, requiresShareConfirmation = false,
            requiresTaskType = false,
        )
        val snapshot = CalendarTaskSuggestions(true, "2026-11-21", "UTC", "2026-11-22T00:00:00Z", listOf(item))
        val cache = mutableListOf(CalendarSuggestionsCacheEntity(snapshot = Json.encodeToString(snapshot)))
        val queue = mutableListOf<OutboxEntity>()
        val tasks = mutableMapOf<String, TaskEntity>()
        val bodies = mutableListOf<String>()
        val requests = mutableListOf<String>()
        val scopeSettings = mutableMapOf<String, ScopeSettingsEntity>()
        fun open() = repository(queue, { index ->
            if (index == 0) {
                """{"time_tracking":true}"""
            } else {
                val operation = queue.first()
                val task = tasks.values.single().toDomain()
                val acknowledged = if (index == 1) {
                    val doing = task.copy(status = TaskStatus.DOING, version = 2)
                    """{"snapshot":${Json.encodeToString(snapshot.copy(items = emptyList()))},"task":${Json.encodeToString(doing)}}"""
                } else Json.encodeToString(task.copy(status = TaskStatus.DONE, version = 3))
                """{"results":[{"op_id":"${operation.opId}","status":"ok","entity":$acknowledged}]}"""
            }
        }, requests, bodies, tasks, calendarCache = cache, cachedScopeSettings = scopeSettings)

        open().refreshScopeSettings(item.scopeId)
        val stale = open()
        assertTrue(stale.actOnCalendarSuggestion(item, action, CalendarTaskStart.PLANNED, false, null))
        val provisional = tasks.values.single().toDomain()
        assertEquals(TaskStatus.DOING, provisional.status)
        assertTrue(provisional.fromCalendar)
        assertEquals(listOf(planned.toString()), provisional.timeSummary?.openStartedAt)
        assertTrue(stale.calendarSuggestions.first().snapshot.items.isEmpty())
        stale.moveTask(provisional, TaskStatus.DONE, null to null)

        open().flush()
        assertTrue(queue.isEmpty())
        assertEquals(TaskStatus.DONE, tasks.values.single().toDomain().status)
        val startOp = Json.parseToJsonElement(bodies[1]).jsonObject.getValue("operations").jsonArray.single().jsonObject
        assertEquals("calendar_suggestions", startOp.getValue("entity").jsonPrimitive.content)
        val startData = startOp.getValue("data").jsonObject
        assertEquals(action.toString(), startData.getValue("action_at").jsonPrimitive.content)
        assertEquals(planned.toString(), startData.getValue("starts_at").jsonPrimitive.content)
        assertEquals("planned", startData.getValue("start").jsonPrimitive.content)
        val move = Json.parseToJsonElement(bodies[2]).jsonObject.getValue("operations").jsonArray.single().jsonObject
        assertEquals("2", move.getValue("base_version").jsonPrimitive.content)
    }

    @Test
    fun `només la confirmació de la mateixa operació la retira`() = runBlocking {
        val queue = mutableListOf(operation)
        repository(queue, """{"results":[{"op_id":"a","status":"ok"}]}""", mutableListOf()).flush()
        assertEquals(emptyList(), queue)
    }

    @Test
    fun `les operacions sense confirmació no es perden ni deixen passar les dependents`() = runBlocking {
        for (body in listOf(
            "no és JSON", """{"results":[]}""",
            """{"results":[{"op_id":"other","status":"ok"}]}""",
        )) {
            val queue = mutableListOf(operation, operation.copy(opId = "b", op = "update"))
            val requests = mutableListOf<String>()
            assertFailsWith<IOException> { repository(queue, body, requests).flush() }
            assertEquals(2, queue.size, body)
            assertEquals(1, requests.size, body)
        }
    }

    @Test
    fun `els conflictes conserven una tasca i deixen sincronitzar les altres`() = runBlocking {
        for (status in listOf("conflict", "rejected")) {
            val dependent = operation.copy(opId = "b", op = "update")
            val independent = operation.copy(opId = "c", entityId = "task-c")
            val queue = mutableListOf(operation, dependent, independent)
            val requests = mutableListOf<String>()
            val responses = listOf(
                """{"results":[{"op_id":"a","status":"$status"}]}""",
                """{"results":[{"op_id":"c","status":"ok"}]}""",
            )
            val repository = repository(queue, responses::get, requests)
            repository.flush()
            assertEquals(listOf(operation.copy(state = status), dependent), queue)
            repository.flush()
            assertEquals(2, requests.size)
        }
    }

    @Test
    fun `un refresc no reemplaça les tasques locals quan la cua no s’ha acceptat`() = runBlocking {
        val queue = mutableListOf(operation)
        val requests = mutableListOf<String>()
        assertFailsWith<IOException> {
            repository(queue, """{"results":[]}""", requests).refresh(emptyList(), null)
        }
        assertEquals(listOf("/api/v1/sync/batch"), requests)
        assertEquals(listOf(operation), queue)
    }

    @Test
    fun `un títol amb tabuladors i retorns es desa com a JSON vàlid`() = runBlocking {
        val queue = mutableListOf<OutboxEntity>()
        // check-ignore: entrada de la prova de serialització, no un text d'interfície.
        val title = "Línia\tamb\rretorn\n\"cometes\" i \\"
        repository(queue, "{}", mutableListOf()).createTask("scope", title, null)
        assertEquals(title, Json.parseToJsonElement(queue.single().payload).jsonObject["title"]?.jsonPrimitive?.content)
    }

    @Test
    fun `la còpia local conserva les dades del servidor i un camp es pot buidar sense tocar la resta`() = runBlocking {
        val original = Task("task", "scope", title = "Work", description = "Detail", position = "a1",
            deadline = "2026-11-20T09:15:00Z", rrule = "FREQ=WEEKLY", recurrenceMode = RecurrenceMode.COMPLETION,
            labelIds = listOf("label"), taskTypeId = "type", progress = TaskProgress(2, 3, 2),
            lockedUntil = "2026-11-20T09:15:00Z", needsAttention = true)
        val queue = mutableListOf<OutboxEntity>()
        val local = mutableMapOf(original.id to original.toEntity())
        val repository = repository(queue, { error("No network") }, mutableListOf(), tasks = local)
        assertEquals(original, repository.observeTask(original.id).first())
        val updated = repository.editTask(original.id, mapOf("description" to null), AiMode.ASSISTED)
        assertEquals(original.copy(description = null, aiMode = AiMode.ASSISTED), updated)
        assertEquals(updated, local.getValue(original.id).toDomain())
        val payload = Json.parseToJsonElement(queue.single().payload).jsonObject
        assertEquals(JsonNull, payload["description"])
        assertEquals(setOf("description", "ai_mode"), payload.keys)
    }

    @Test
    fun `la versió confirmada permet editar després de moure sense amagar un text concurrent`() = runBlocking {
        for (concurrent in listOf(false, true)) {
            val original = Task("task-a", "scope", title = "Work", position = "a1", version = 3)
            val queue = mutableListOf<OutboxEntity>()
            val local = mutableMapOf(original.id to original.toEntity())
            val bodies = mutableListOf<String>()
            val canonical = original.copy(title = if (concurrent) "Remote" else original.title,
                status = TaskStatus.TODO, version = 4)
            val repo = repository(queue, { index ->
                val op = queue.first()
                val payload = if (index == 0) {
                    ""","entity":${Json.encodeToString(canonical)}"""
                } else if (!concurrent) {
                    ""","entity":${Json.encodeToString(canonical.copy(title = "Local", version = 5))}"""
                } else {
                    ""","server_entity":${Json.encodeToString(canonical)}"""
                }
                val status = if (index == 1 && concurrent) "conflict" else "ok"
                """{"results":[{"op_id":"${op.opId}","status":"$status"$payload}]}"""
            }, mutableListOf(), bodies, local)
            repo.moveTask(original, TaskStatus.TODO, null to null)
            repo.editTask(original.id, mapOf("title" to "Local"))
            repo.flush()
            val edit = Json.parseToJsonElement(bodies.last()).jsonObject.getValue("operations").jsonArray.single().jsonObject
            assertEquals(if (concurrent) "3" else "4", edit.getValue("base_version").jsonPrimitive.content)
            assertEquals("Local", local.getValue(original.id).title)
            assertEquals(if (concurrent) listOf("conflict") else emptyList(), queue.map { it.state })
        }
    }

    @Test
    fun `la llista i el seu ítem es desen junts i el rebuig del pare no envia el fill`() = runBlocking {
        val original = Task("task", "scope", title = "Work", position = "a1")
        val local = mutableMapOf(original.id to original.toEntity())
        val queue = mutableListOf<OutboxEntity>()
        val requests = mutableListOf<String>()
        val repo = repository(queue, {
            """{"results":[{"op_id":"${queue.first().opId}","status":"rejected","error":{"detail":"Forbidden"}}]}"""
        }, requests, tasks = local)
        repo.addChecklistItem(original.id, "List", "An item")
        val list = repo.taskLists(original.id).first().checklists.single()
        assertEquals("An item", list.items.single().text)
        assertEquals(list.id, queue.last().parentId)
        repo.flush()
        repo.flush()
        assertEquals(1, requests.size)
        assertEquals(listOf("rejected", "pending"), queue.map { it.state })
    }

    @Test
    fun `crear editar completar i esborrar subtasques sobreviu a un reinici de la cua`() = runBlocking {
        val task = Task("task", "scope", title = "Work", position = "a1", progress = TaskProgress(0, 1, 2))
        val old = Subtask("previous", task.id, "Previous", false, "a1")
        val pinned = Checklist("list", task.id, old.id, name = "Keep", pinned = true, position = "a1")
        val tasks = mutableMapOf(task.id to task.toEntity())
        val lists = mutableMapOf(task.id to TaskListsEntity(task.id, Json.encodeToString(listOf(old)), Json.encodeToString(listOf(pinned))))
        val queue = mutableListOf<OutboxEntity>()
        val offline = repository(queue, { error("No network") }, mutableListOf(), tasks = tasks, lists = lists)
        offline.addSubtask(task.id, "New")
        val created = offline.taskLists(task.id).first().subtasks.last()
        offline.renameSubtask(task.id, created.id, "  Renamed  ")
        offline.setSubtask(task.id, created.id, true)
        offline.deleteSubtask(task.id, old.id)

        val expected = created.copy(title = "Renamed", done = true)
        val bodies = mutableListOf<String>()
        val resumed = repository(queue, { index ->
            val entity = when (index) {
                0 -> created
                1 -> expected.copy(done = false, version = 2)
                2 -> expected.copy(version = 3)
                else -> null
            }
            val result = entity?.let { ""","entity":${Json.encodeToString(it)}""" }.orEmpty()
            """{"results":[{"op_id":"${queue.first().opId}","status":"ok"$result}]}"""
        }, mutableListOf(), bodies, tasks, lists)
        val pending = resumed.taskLists(task.id).first()
        assertEquals(listOf(expected), pending.subtasks)
        assertEquals(listOf(pinned.copy(subtaskId = null)), pending.checklists)
        assertEquals(TaskProgress(1, 1, 2), resumed.tasks.first().single().progress)

        resumed.flush()
        assertEquals(emptyList(), queue)
        assertEquals(listOf("0", "1", "2", "1"), bodies.map { body ->
            Json.parseToJsonElement(body).jsonObject.getValue("operations").jsonArray.single()
                .jsonObject.getValue("base_version").jsonPrimitive.content
        })
        assertEquals(pending.copy(subtasks = listOf(expected.copy(version = 3))), resumed.taskLists(task.id).first())
        assertEquals(TaskProgress(1, 1, 2), resumed.tasks.first().single().progress)
    }

    @Test
    fun `un conflicte de títol de subtasca permet triar el remot o reenviar sobre la seva versió`() = runBlocking {
        for (keepLocal in listOf(false, true)) {
            val task = Task("task", "scope", title = "Work", position = "a1", progress = TaskProgress(0, 1, 1))
            val original = Subtask("item", task.id, "Before", false, "a1", version = 2)
            val remote = original.copy(title = "Remote", version = 3)
            val committed = remote.copy(title = "Local", version = 4)
            val tasks = mutableMapOf(task.id to task.toEntity())
            val lists = mutableMapOf(task.id to TaskListsEntity(task.id, Json.encodeToString(listOf(original)), "[]"))
            val queue = mutableListOf<OutboxEntity>()
            val bodies = mutableListOf<String>()
            val repo = repository(queue, { index ->
                val entry = if (index == 0) """"status":"conflict","server_entity":${Json.encodeToString(remote)}"""
                    else """"status":"ok","entity":${Json.encodeToString(committed)}"""
                """{"results":[{"op_id":"${queue.first().opId}",$entry}]}"""
            }, mutableListOf(), bodies, tasks, lists)
            repo.renameSubtask(task.id, original.id, "Local")
            repo.flush()
            assertEquals("conflict", queue.single().state)
            repo.resolveSyncIssue(queue.single().opId, keepLocal)
            repo.flush()
            assertEquals(emptyList(), queue)
            assertEquals(if (keepLocal) committed else remote, repo.taskLists(task.id).first().subtasks.single())
            if (keepLocal) {
                val retry = Json.parseToJsonElement(bodies.last()).jsonObject.getValue("operations").jsonArray.single().jsonObject
                assertEquals("3", retry.getValue("base_version").jsonPrimitive.content)
            }
        }
    }
}
