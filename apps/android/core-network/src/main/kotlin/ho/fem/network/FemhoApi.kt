package ho.fem.network

import ho.fem.model.AuthTokens
import ho.fem.model.Board
import ho.fem.model.Checklist
import ho.fem.model.EventOccurrence
import ho.fem.model.Inbox
import ho.fem.model.InstanceInfo
import ho.fem.model.Person
import ho.fem.model.Project
import ho.fem.model.Scope
import ho.fem.model.Task
import ho.fem.model.UserProfile
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * El client de l'API. docs/05.
 *
 * **El refresc és rotatiu i només se'n fa un a la vegada.** Amb quatre peticions en
 * paral·lel que caduquen alhora, quatre refrescos gastarien el mateix token de refresc
 * quatre vegades, i el servidor revoca la família sencera quan detecta la reutilització
 * d'un de gastat (docs/05 §1). El `Mutex` és el que ho impedeix.
 *
 * **El servidor és una dada, no una constant.** A diferència de la web, l'APK no sap on
 * és la instància fins que l'hi diuen (docs/03 §2), i per això la base arriba per
 * paràmetre i es pot canviar sense reinstal·lar res.
 */
class FemhoApi(
    private val baseUrl: String,
    private val tokens: TokenStore,
    private val client: OkHttpClient = defaultClient(),
) {
    private val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        encodeDefaults = true
    }
    private val refreshLock = Mutex()

    companion object {
        private val JSON_TYPE = "application/json; charset=utf-8".toMediaType()

        fun defaultClient(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            // Sense reintents automàtics: la cua de sortida ja té la seva política, i
            // dos mecanismes de reintent es multipliquen (docs/06 §4).
            .retryOnConnectionFailure(false)
            .build()
    }

    /** Un error de l'API amb el `detail` que el servidor dona en català (RFC 9457). */
    class ApiException(val status: Int, val detail: String) : IOException(detail)

    private fun url(path: String): String = baseUrl.trimEnd('/') + path

    /**
     * El `detail` d'un error RFC 9457.
     *
     * El servidor l'escriu en català i **amb dades a dins** —quins àmbits veu el token,
     * on és la cosa demanada (docs/05 §2)—, o sigui que ensenyar-lo tal com ve és més
     * útil que qualsevol text que pugui posar l'app. Si el cos no és el que s'espera, es
     * torna buit i qui crida ensenya el seu missatge genèric.
     */
    private fun detailOf(text: String): String = runCatching {
        json.parseToJsonElement(text).jsonObject["detail"]?.jsonPrimitive?.content.orEmpty()
    }.getOrDefault("")

    private suspend fun raw(
        method: String,
        path: String,
        body: String?,
        authenticated: Boolean,
    ): String = withContext(Dispatchers.IO) {
        fun send(): okhttp3.Response {
            val builder = Request.Builder().url(url(path))
            when (method) {
                "GET" -> builder.get()
                "DELETE" -> builder.delete(body?.toRequestBody(JSON_TYPE))
                else -> builder.method(method, (body ?: "{}").toRequestBody(JSON_TYPE))
            }
            if (authenticated) {
                tokens.access()?.let { builder.header("Authorization", "Bearer $it") }
            }
            // docs/05 §1: el canal el declara el client i el servidor el propaga fins a
            // `activity_log` sense que cap servei l'hagi de passar a mà.
            builder.header("X-Femho-Source", "android")
            return client.newCall(builder.build()).execute()
        }

        var response = send()
        if (response.code == 401 && authenticated) {
            response.close()
            if (refresh()) response = send() else throw ApiException(401, "")
        }

        response.use {
            val text = it.body?.string().orEmpty()
            if (!it.isSuccessful) throw ApiException(it.code, detailOf(text))
            text
        }
    }

    /**
     * Refresca la sessió. Torna `false` si ja no és recuperable.
     *
     * Si un altre fil ja l'ha refrescat mentre aquest esperava el pany, no se'n fa un
     * altre: es mira si el testimoni d'accés ha canviat.
     */
    private suspend fun refresh(): Boolean = refreshLock.withLock {
        val before = tokens.access()
        val refreshToken = tokens.refresh() ?: return@withLock false
        if (before != tokens.access()) return@withLock true

        return@withLock runCatching {
            val text = raw(
                "POST",
                "/api/v1/auth/refresh",
                """{"refresh_token":"$refreshToken"}""",
                authenticated = false,
            )
            tokens.save(json.decodeFromString<AuthTokens>(text))
            true
        }.getOrElse {
            tokens.clear()
            false
        }
    }

    private suspend inline fun <reified T> get(path: String): T =
        json.decodeFromString(raw("GET", path, null, authenticated = true))

    private suspend inline fun <reified T> post(path: String, body: Any? = null): T =
        json.decodeFromString(raw("POST", path, body?.let { encode(it) }, authenticated = true))

    private fun encode(body: Any): String = when (body) {
        is String -> body
        is Map<*, *> -> body.entries.joinToString(",", "{", "}") { (key, value) ->
            "\"$key\":" + when (value) {
                null -> "null"
                is Number, is Boolean -> value.toString()
                is List<*> -> value.joinToString(",", "[", "]") { "\"$it\"" }
                else -> "\"${value.toString().replace("\\", "\\\\").replace("\"", "\\\"")}\""
            }
        }
        else -> error("cos no suportat: ${body::class}")
    }

    // ------------------------------------------------------------------ públic

    /** `GET /info` és **públic i sense autenticar**: valida la URL abans de demanar res. */
    suspend fun info(): InstanceInfo =
        json.decodeFromString(raw("GET", "/info", null, authenticated = false))

    suspend fun login(email: String, password: String): AuthTokens {
        val text = raw(
            "POST",
            "/api/v1/auth/login",
            encode(mapOf("email" to email, "password" to password)),
            authenticated = false,
        )
        return json.decodeFromString<AuthTokens>(text).also { tokens.save(it) }
    }

    suspend fun logout() {
        runCatching { raw("POST", "/api/v1/auth/logout", null, authenticated = true) }
        tokens.clear()
    }

    suspend fun profile(): UserProfile = get("/api/v1/auth/me")
    suspend fun scopes(): List<Scope> = get("/api/v1/scopes")
    suspend fun projects(): List<Project> = get("/api/v1/projects")
    suspend fun people(): List<Person> = runCatching { get<List<Person>>("/api/v1/admin/users") }
        .getOrElse { emptyList() }

    suspend fun board(scopeIds: List<String>, projectId: String?): Board {
        val query = buildList {
            if (scopeIds.isNotEmpty()) add("scope_ids=" + scopeIds.joinToString(","))
            if (projectId != null) add("project_id=$projectId")
        }.joinToString("&")
        return get("/api/v1/board" + if (query.isEmpty()) "" else "?$query")
    }

    suspend fun inbox(date: String, includeOverdue: Boolean, scopeIds: List<String>): Inbox {
        val query = buildList {
            add("date=$date")
            add("include_overdue=$includeOverdue")
            if (scopeIds.isNotEmpty()) add("scope_ids=" + scopeIds.joinToString(","))
        }.joinToString("&")
        return get("/api/v1/inbox?$query")
    }

    suspend fun events(from: String, to: String, scopeIds: List<String>): List<EventOccurrence> {
        val query = buildList {
            add("from=$from")
            add("to=$to")
            if (scopeIds.isNotEmpty()) add("scope_ids=" + scopeIds.joinToString(","))
        }.joinToString("&")
        return get("/api/v1/events?$query")
    }

    suspend fun createTask(
        id: String,
        scopeId: String,
        title: String,
        projectId: String?,
        assigneeIds: List<String>,
    ): Task = post(
        "/api/v1/tasks",
        buildMap {
            put("id", id)
            put("scope_id", scopeId)
            put("title", title)
            if (projectId != null) put("project_id", projectId)
            if (assigneeIds.isNotEmpty()) put("assignee_ids", assigneeIds)
        },
    )

    suspend fun moveTask(id: String, status: String, position: String): Task =
        post("/api/v1/tasks/$id/move", mapOf("status" to status, "position" to position))

    suspend fun completeTask(id: String): Task = post("/api/v1/tasks/$id/complete")

    /**
     * El mode d'IA té ruta pròpia i no és un `PATCH` de la tasca.
     *
     * És el mateix criteri que `/move`: canviar el mode d'IA és el gest que dispara la
     * delegació, i barrejar-lo amb l'edició de camps faria que desar un títol el pogués
     * canviar sense voler.
     */
    suspend fun setAiMode(id: String, mode: String): Task =
        post("/api/v1/tasks/$id/ai-mode", mapOf("ai_mode" to mode))

    suspend fun checklists(taskId: String): List<Checklist> =
        get("/api/v1/tasks/$taskId/checklists")

    suspend fun setChecklistItem(itemId: String, done: Boolean): String =
        raw("PATCH", "/api/v1/checklist-items/$itemId", """{"done":$done}""", authenticated = true)

    /** El buidat de la cua de sortida (docs/06 §4). El cos ja ve serialitzat. */
    suspend fun syncBatch(body: String): String =
        raw("POST", "/api/v1/sync/batch", body, authenticated = true)

    suspend fun sync(cursor: String?): String =
        raw("GET", "/api/v1/sync" + (cursor?.let { "?cursor=$it" } ?: ""), null, authenticated = true)
}
