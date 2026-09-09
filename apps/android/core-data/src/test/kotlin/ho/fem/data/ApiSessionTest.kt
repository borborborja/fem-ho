package ho.fem.data

import ho.fem.model.AuthTokens
import ho.fem.network.FemhoApi
import ho.fem.network.InMemoryTokenStore
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

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
}
