package ho.fem.data

import ho.fem.network.FemhoApi
import ho.fem.network.InMemoryTokenStore
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
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

    private fun repository(queue: MutableList<OutboxEntity>, body: String, requests: MutableList<String>): Repository {
        val dao = Proxy.newProxyInstance(
            FemhoDao::class.java.classLoader, arrayOf(FemhoDao::class.java),
        ) { _, method, args ->
            when (method.name) {
                "outbox" -> queue.toList()
                "dequeue" -> { queue.removeAll { it.opId == args!![0] }; Unit }
                "failed", "putTasks" -> Unit
                "lastPosition" -> null
                "enqueue" -> { queue += args!![0] as OutboxEntity; Unit }
                "tasks", "scopes", "projects", "people", "outboxFlow", "labels", "taskTypes", "sessions", "calendars", "mailAccounts", "mailRules", "agents" -> flowOf(emptyList<Any>())
                else -> error("Crida inesperada: ${method.name}")
            }
        } as FemhoDao
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            requests += chain.request().url.encodedPath
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
            """{"results":[{"op_id":"a","status":"conflict"}]}""",
            """{"results":[{"op_id":"a","status":"rejected"}]}""",
        )) {
            val queue = mutableListOf(operation, operation.copy(opId = "b", op = "update"))
            val requests = mutableListOf<String>()
            assertFailsWith<IOException> { repository(queue, body, requests).flush() }
            assertEquals(2, queue.size, body)
            assertEquals(1, requests.size, body)
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

}
