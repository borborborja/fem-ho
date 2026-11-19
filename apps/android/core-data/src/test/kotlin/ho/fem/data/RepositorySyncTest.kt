package ho.fem.data

import ho.fem.model.AiMode
import ho.fem.model.RecurrenceMode
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
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

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
                "outboxFlow" -> flowOf(queue.toList())
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
        return Repository(dao, FemhoApi("http://localhost", InMemoryTokenStore(), client))
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
}
