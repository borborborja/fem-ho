package ho.fem.data

import ho.fem.model.AuthTokens
import ho.fem.network.FemhoApi
import ho.fem.network.InMemoryTokenStore
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class ApiSessionTest {
    @Test
    fun `un error temporal de refresc no esborra les credencials`() = runBlocking {
        for (status in listOf(429, 500, 502, 503, 504)) {
            val tokens = InMemoryTokenStore(AuthTokens("old", "refresh"))
            val client = OkHttpClient.Builder().addInterceptor { chain ->
                val code = if (chain.request().url.encodedPath.endsWith("/refresh")) status else 401
                Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1)
                    .code(code).message("Failure").body("{}".toResponseBody()).build()
            }.build()
            val api = FemhoApi("http://localhost", tokens, client)
            val error = assertFailsWith<FemhoApi.ApiException> { api.syncBatch("{}") }
            assertEquals(status, error.status)
            assertEquals("old", tokens.access())
            assertEquals("refresh", tokens.refresh())
        }
    }

    @Test
    fun `dos clients esperen el mateix refresc d'una credencial`() = runBlocking {
        val tokens = InMemoryTokenStore(AuthTokens("old", "refresh"))
        val expired = CountDownLatch(2)
        val refreshes = AtomicInteger()
        val transport = OkHttpClient.Builder().addInterceptor { chain ->
            val request = chain.request()
            val (code, body) = when {
                request.url.encodedPath.endsWith("/refresh") -> {
                    refreshes.incrementAndGet()
                    200 to """{"access_token":"new","refresh_token":"rotated"}"""
                }
                request.header("Authorization") == "Bearer old" -> {
                    expired.countDown()
                    assertTrue(expired.await(5, TimeUnit.SECONDS))
                    401 to "{}"
                }
                else -> {
                    assertEquals("Bearer new", request.header("Authorization"))
                    200 to "{}"
                }
            }
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1)
                .code(code).message("Response").body(body.toResponseBody()).build()
        }.build()
        val api = FemhoApi("http://localhost", tokens, transport)
        val other = FemhoApi("http://localhost", tokens, transport)
        val first = async { api.syncBatch("{}") }
        val second = async { other.syncBatch("{}") }
        assertEquals("{}", first.await())
        assertEquals("{}", second.await())
        assertEquals(1, refreshes.get())
    }

    @Test
    fun `editar una tasca conserva els salts i els nuls explícits`() = runBlocking {
        val description = "Una línia\nUna altra\tamb \"cometes\""
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            val request = chain.request()
            val buffer = Buffer()
            request.body!!.writeTo(buffer)
            val patch = Json.parseToJsonElement(buffer.readUtf8()).jsonObject
            assertEquals(description, patch["description"]?.jsonPrimitive?.content)
            assertEquals(JsonNull, patch["project_id"])
            assertEquals(JsonNull, patch["due_date"])
            assertEquals(setOf("description", "project_id", "due_date"), patch.keys)
            val body = """{"id":"task","scope_id":"scope","title":"Test","position":"a0"}"""
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1)
                .code(200).message("OK").body(body.toResponseBody()).build()
        }.build()
        val api = FemhoApi("http://localhost", InMemoryTokenStore(), client)
        val result = api.updateTask("task", mapOf("description" to description, "project_id" to null, "due_date" to null))
        assertEquals("task", result.id)
    }
}
