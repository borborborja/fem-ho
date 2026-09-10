package ho.fem.data

import ho.fem.model.TaskStatus
import ho.fem.network.FemhoApi
import ho.fem.network.InMemoryTokenStore
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.runBlocking
import org.junit.Assume.assumeTrue
import java.lang.reflect.Proxy
import java.time.Instant
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Servidor de proves buit, mai un compte personal. FEMHO_ANDROID_TEST_URL activa la integració. */
class TimeReportsIntegrationTest {
    @Test
    fun `la cua real d’Android registra dos trams i el model natiu llegeix l’informe`() = runBlocking {
        val base = System.getenv("FEMHO_ANDROID_TEST_URL")
        assumeTrue("Requires an isolated test server", !base.isNullOrBlank())
        val api = FemhoApi(base!!, InMemoryTokenStore())
        api.register("Android audit", "android-${UUID.randomUUID()}@example.com", "test-password-android-audit")
        val scope = api.scopes().first().id
        api.updateScopeSettings(scope, timeTracking = true)
        val queue = mutableListOf<OutboxEntity>()
        var current: TaskEntity? = null
        val dao = Proxy.newProxyInstance(FemhoDao::class.java.classLoader, arrayOf(FemhoDao::class.java)) { _, method, args ->
            when (method.name) {
                "outbox" -> queue.toList()
                "dequeue" -> { queue.removeAll { it.opId == args!![0] }; Unit }
                "failed" -> Unit
                "lastPosition" -> null
                "task" -> flowOf(current)
                "putTaskAndEnqueue" -> { current = args!![0] as TaskEntity; queue += args[1] as OutboxEntity; Unit }
                "tasks", "scopes", "projects", "people", "outboxFlow", "labels", "taskTypes", "sessions", "calendars", "mailAccounts", "mailRules", "agents" -> flowOf(emptyList<Any>())
                else -> error("Unexpected ${method.name}")
            }
        } as FemhoDao
        val repository = Repository(dao, api)
        val id = repository.createTask(scope, "Native Android time audit", null, TaskStatus.TODO)
        repeat(2) {
            repository.moveTask(current!!.toDomain(), TaskStatus.DOING, null to null)
            delay(1100)
            repository.moveTask(current!!.toDomain(), TaskStatus.DONE, null to null)
        }
        assertEquals(5, queue.size)
        repository.flush()
        assertTrue(queue.isEmpty())
        repository.flush()
        val report = api.sessions(scopeIds = listOf(scope))
        val sessions = report.data.filter { it.taskId == id }
        assertEquals(2, sessions.size)
        sessions.forEach { assertTrue(Instant.parse(it.endedAt).isAfter(Instant.parse(it.startedAt))) }
        assertEquals(1L, report.totals.tasks)
        assertEquals(report.totals.minutes, api.sessionStats(scopeIds = listOf(scope)).minutes)
    }
}
