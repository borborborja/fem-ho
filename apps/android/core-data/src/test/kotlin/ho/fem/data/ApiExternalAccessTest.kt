package ho.fem.data

import ho.fem.model.AuthTokens
import ho.fem.network.FemhoApi
import ho.fem.network.InMemoryTokenStore
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ApiExternalAccessTest {
    @Test
    fun `la llista i la creació de tokens segueixen el contracte del servidor`() = runBlocking {
        val summary = """{"id":"token-1","name":"Client","token_prefix":"femho_pat_","created_at":"2026-11-19T10:00:00Z","capabilities":["tasks:read"],"scope_ids":["scope-1"],"channels":["mcp"]}"""
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            val request = chain.request()
            assertEquals("Bearer access", request.header("Authorization"))
            val (code, body) = when (request.method to request.url.encodedPath) {
                "GET" to "/api/v1/external-access" -> 200 to """{"api_enabled":false,"mcp_enabled":true,"mcp_url":"https://femho.example/mcp"}"""
                "GET" to "/api/v1/tokens" -> 200 to """{"data":[$summary]}"""
                "POST" to "/api/v1/tokens" -> {
                    val buffer = Buffer()
                    requireNotNull(request.body).writeTo(buffer)
                    val input = Json.parseToJsonElement(buffer.readUtf8()).jsonObject
                    assertEquals("Client", input.getValue("name").jsonPrimitive.content)
                    assertEquals("scope-1", input.getValue("scope_ids").jsonArray.single().jsonPrimitive.content)
                    assertEquals("mcp", input.getValue("channels").jsonArray.single().jsonPrimitive.content)
                    201 to """{"token":"once","summary":$summary}"""
                }
                "PATCH" to "/api/v1/tokens/token-1" -> {
                    val buffer = Buffer()
                    requireNotNull(request.body).writeTo(buffer)
                    val input = Json.parseToJsonElement(buffer.readUtf8()).jsonObject
                    assertEquals(setOf("capabilities", "scope_ids"), input.keys)
                    200 to summary.dropLast(1) + """, "credential_type":"oauth","oauth":{"status":"active","expires_at":"2026-11-20T10:00:00Z"}}"""
                }
                else -> error("Unexpected request ${request.method} ${request.url}")
            }
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1)
                .code(code).message("OK").body(body.toResponseBody()).build()
        }.build()
        val api = FemhoApi("https://femho.example", InMemoryTokenStore(AuthTokens("access", "refresh")), client)
        val access = api.externalAccess()
        assertTrue(access.mcpEnabled)
        assertFalse(access.apiEnabled)
        assertEquals("https://femho.example/mcp", access.mcpUrl)
        assertEquals("femho_pat_", api.apiTokens().single().prefix)
        val created = api.createApiToken("Client", listOf("tasks:read"), listOf("scope-1"), listOf("mcp"))
        assertEquals("once", created.token)
        assertEquals(listOf("scope-1"), created.summary.scopeIds)
        val narrowed = api.updateApiToken("token-1", null, listOf("tasks:read"), listOf("scope-1"), null)
        assertEquals("oauth", narrowed.credentialType)
        assertEquals("active", narrowed.oauth?.status)
    }

    @Test
    fun `les respostes heterogènies i les respostes sense cos no fallen després de la mutació`() = runBlocking {
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            val request = chain.request()
            val (code, body) = when (request.url.encodedPath) {
                "/api/v1/auth/password" -> 200 to """{"revoked_sessions":2}"""
                "/api/v1/activity/entry-1/undo" -> 204 to ""
                else -> error("Unexpected request ${request.url}")
            }
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1)
                .code(code).message("OK").body(body.toResponseBody()).build()
        }.build()
        val api = FemhoApi("https://femho.example", InMemoryTokenStore(), client)
        assertEquals(2, api.changePassword("old", "new")["revoked_sessions"])
        assertTrue(api.undoActivity("entry-1").isEmpty())
    }
}
