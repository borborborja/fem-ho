package ho.fem.data

import ho.fem.model.Task
import ho.fem.model.TaskStatus
import ho.fem.network.FemhoApi
import ho.fem.network.InMemoryTokenStore
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.lang.reflect.Proxy
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull

class TaskMovesTest {
    @Test
    fun `els moviments offline són separats i un doble toc no avança dues vegades`() = runBlocking {
        var current = Task("task", "scope", title = "Work", position = "a1").toEntity()
        val queue = mutableListOf<OutboxEntity>()
        val dao = Proxy.newProxyInstance(FemhoDao::class.java.classLoader, arrayOf(FemhoDao::class.java)) { _, method, args ->
            when (method.name) {
                "task" -> flowOf(current)
                "putTaskAndEnqueue" -> { current = args!![0] as TaskEntity; queue += args[1] as OutboxEntity; Unit }
                "tasks", "scopes", "projects", "people", "outboxFlow", "labels", "taskTypes", "sessions", "calendars", "mailAccounts", "mailRules", "agents" -> flowOf(emptyList<Any>())
                else -> error("Unexpected ${method.name}")
            }
        } as FemhoDao
        val repository = Repository(dao, FemhoApi("http://localhost", InMemoryTokenStore()))
        val stale = current.toDomain()
        repository.moveTask(stale, TaskStatus.TODO, null to null)
        repository.moveTask(stale, TaskStatus.TODO, null to null)
        repository.moveTask(current.toDomain(), TaskStatus.DOING, null to null)
        repository.moveTask(current.toDomain(), TaskStatus.DONE, null to null)
        repository.moveTask(current.toDomain(), TaskStatus.DOING, null to null)
        assertEquals(4, queue.size)
        assertEquals(listOf("todo", "doing", "done", "doing"), queue.map { Json.parseToJsonElement(it.payload).jsonObject["status"]!!.jsonPrimitive.content })
        assertEquals(listOf("inbox", "todo", "doing", "done"), queue.map { Json.parseToJsonElement(it.payload).jsonObject["from_status"]!!.jsonPrimitive.content })
        queue.forEach { assertNotNull(Json.parseToJsonElement(it.payload).jsonObject["occurred_at"]) }
        assertEquals(null, current.completedAt)
    }
}
