package ho.fem.network

import ho.fem.model.Agent
import ho.fem.model.AgentDetail
import ho.fem.model.AgentScopeAvailability
import ho.fem.model.AgentScopeEnvelope
import ho.fem.model.ActivityEnvelope
import ho.fem.model.ApiTokenSummary
import ho.fem.model.Attachment
import ho.fem.model.AuthTokens
import ho.fem.model.Board
import ho.fem.model.Calendar
import ho.fem.model.Checklist
import ho.fem.model.Comment
import ho.fem.model.CredentialEnvelope
import ho.fem.model.EventOccurrence
import ho.fem.model.Inbox
import ho.fem.model.InboxMark
import ho.fem.model.InstanceInfo
import ho.fem.model.Label
import ho.fem.model.MailAccount
import ho.fem.model.MailRule
import ho.fem.model.MailTestResult
import ho.fem.model.Person
import ho.fem.model.Project
import ho.fem.model.Scope
import ho.fem.model.ScopeSettings
import ho.fem.model.Session
import ho.fem.model.SessionEntry
import ho.fem.model.SessionReport
import ho.fem.model.SessionStats
import ho.fem.model.ShareAccess
import ho.fem.model.ShareSummary
import ho.fem.model.Subtask
import ho.fem.model.Task
import ho.fem.model.TaskType
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

    private suspend inline fun <reified T> patch(path: String, body: Any? = null): T =
        json.decodeFromString(raw("PATCH", path, body?.let { encode(it) }, authenticated = true))

    private suspend inline fun <reified T> put(path: String, body: Any? = null): T =
        json.decodeFromString(raw("PUT", path, body?.let { encode(it) }, authenticated = true))

    private fun encode(body: Any): String = when (body) {
        is String -> body
        is Map<*, *> -> body.entries.joinToString(",", "{", "}") { (key, value) ->
            "\"$key\":" + encodeValue(value)
        }
        else -> error("cos no suportat: ${body::class}")
    }

    /**
     * Un valor dins d'un cos.
     *
     * **Els mapes es codifiquen recursivament**, que abans no passava: un objecte
     * imbricat queia al `else` i sortia com una cadena amb el `toString()` de Kotlin a
     * dins —`"{calendar_id=abc, uid=xyz}"`—, que el servidor no pot llegir i que no dona
     * cap error aquí. Va caldre en afegir `source_event`, que és el primer cos amb un
     * objecte a dins.
     */
    private fun encodeValue(value: Any?): String = when (value) {
        null -> "null"
        is Number, is Boolean -> value.toString()
        is Map<*, *> -> encode(value)
        is List<*> -> value.joinToString(",", "[", "]") { encodeValue(it) }
        else -> "\"${value.toString().replace("\\", "\\\\").replace("\"", "\\\"")}\""
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

    /**
     * Treure o tornar a posar una cita a la bústia de qui ho demana.
     *
     * **L'uid va al cos i no al camí**: el d'un ítem d'RSS és `"<calendarId>-<itemId>"` i
     * l'itemId pot ser una URL sencera. `visible = null` treu la marca i torna al defecte,
     * que no és el mateix que `false`.
     */
    suspend fun setEventInInbox(
        calendarId: String,
        uid: String,
        recurrenceId: String?,
        visible: Boolean?,
    ): InboxMark = post(
        "/api/v1/inbox/events",
        mapOf(
            "calendar_id" to calendarId,
            "uid" to uid,
            "recurrence_id" to recurrenceId,
            "visible" to visible,
        ),
    )

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
        /** D'on ve, si ve d'una cita: calendari, uid i ocurrència. */
        sourceEvent: Triple<String, String, String?>? = null,
    ): Task = post(
        "/api/v1/tasks",
        buildMap {
            put("id", id)
            put("scope_id", scopeId)
            put("title", title)
            if (projectId != null) put("project_id", projectId)
            if (assigneeIds.isNotEmpty()) put("assignee_ids", assigneeIds)
            if (sourceEvent != null) {
                put(
                    "source_event",
                    mapOf(
                        "calendar_id" to sourceEvent.first,
                        "uid" to sourceEvent.second,
                        "recurrence_id" to sourceEvent.third,
                    ),
                )
            }
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

    /** Els agents. Buit si la instància no en té o si aquest principal no els pot veure. */
    suspend fun agents(): List<Agent> =
        runCatching { get<List<Agent>>("/api/v1/ai/agents") }.getOrDefault(emptyList())

    /**
     * Les llistes que aquest usuari té pinejades.
     *
     * **Buit si la crida falla**, com els agents: el menú de la xinxeta és una drecera, i
     * una capçalera que peta perquè una drecera no ha respost seria pitjor que no tenir-la.
     */
    suspend fun pinnedChecklists(): List<Checklist> =
        runCatching { get<List<Checklist>>("/api/v1/pinned-checklists") }.getOrDefault(emptyList())

    /** Pinejar és **per usuari** (P1): `POST` pineja, `DELETE` despineja. */
    suspend fun setChecklistPin(checklistId: String, pinned: Boolean): String =
        raw(if (pinned) "POST" else "DELETE", "/api/v1/checklists/$checklistId/pin", null, authenticated = true)

    suspend fun subtasks(taskId: String): List<Subtask> = get("/api/v1/tasks/$taskId/subtasks")

    suspend fun setSubtask(id: String, done: Boolean): String =
        raw("PATCH", "/api/v1/subtasks/$id", """{"done":$done}""", authenticated = true)

    /**
     * Afegir una subtasca o un ítem de llista **des de la targeta** (docs/03 §4).
     *
     * L'identificador el genera el client (D4), igual que a la creació de tasques: així
     * un reintent no duplica res.
     */
    suspend fun createSubtask(taskId: String, id: String, title: String): Subtask =
        post("/api/v1/tasks/$taskId/subtasks", mapOf("id" to id, "title" to title))

    suspend fun createChecklist(taskId: String, id: String, name: String): Checklist =
        post("/api/v1/tasks/$taskId/checklists", mapOf("id" to id, "name" to name))

    suspend fun createChecklistItem(checklistId: String, id: String, text: String): String =
        raw(
            "POST",
            "/api/v1/checklists/$checklistId/items",
            encode(mapOf("id" to id, "text" to text)),
            authenticated = true,
        )

    /**
     * Registra una subscripció de push.
     *
     * **Web Push i UnifiedPush comparteixen les RFC i el xifratge** (docs/11 §1): el
     * servidor guarda `endpoint`, `p256dh` i `auth` a la mateixa taula i els fa servir
     * amb la mateixa crida, tant si venen d'un navegador com d'un distribuïdor.
     */
    suspend fun subscribePush(endpoint: String, p256dh: String, auth: String): String = raw(
        "POST",
        "/api/v1/push/subscriptions",
        encode(
            mapOf(
                "endpoint" to endpoint,
                "p256dh" to p256dh,
                "auth" to auth,
                "platform" to "android",
            ),
        ),
        authenticated = true,
    )

    /** El buidat de la cua de sortida (docs/06 §4). El cos ja ve serialitzat. */
    suspend fun syncBatch(body: String): String =
        raw("POST", "/api/v1/sync/batch", body, authenticated = true)

    suspend fun sync(cursor: String?): String =
        raw("GET", "/api/v1/sync" + (cursor?.let { "?cursor=$it" } ?: ""), null, authenticated = true)

    // ------------------------------------------------------------------ Adjunts

    suspend fun listTaskAttachments(taskId: String): List<Attachment> =
        get("/api/v1/tasks/$taskId/attachments")

    suspend fun uploadTaskAttachment(taskId: String, filename: String, bytes: ByteArray, aiContext: Boolean = false): Attachment {
        val path = "/api/v1/tasks/$taskId/attachments?filename=${java.net.URLEncoder.encode(filename, "UTF-8")}&ai_context=$aiContext"
        val body = bytes.toRequestBody("application/octet-stream".toMediaType())
        val request = Request.Builder()
            .url(url(path))
            .post(body)
            .header("Authorization", "Bearer ${tokens.access() ?: throw ApiException(401, "")}")
            .header("X-Femho-Source", "android")
            .build()
        val response = client.newCall(request).execute()
        val text = response.body?.string().orEmpty()
        if (!response.isSuccessful) throw ApiException(response.code, detailOf(text))
        return json.decodeFromString(text)
    }

    suspend fun uploadEventAttachment(eventId: String, filename: String, bytes: ByteArray): Attachment {
        val path = "/api/v1/events/$eventId/attachments?filename=${java.net.URLEncoder.encode(filename, "UTF-8")}"
        val body = bytes.toRequestBody("application/octet-stream".toMediaType())
        val request = Request.Builder()
            .url(url(path))
            .post(body)
            .header("Authorization", "Bearer ${tokens.access() ?: throw ApiException(401, "")}")
            .header("X-Femho-Source", "android")
            .build()
        val response = client.newCall(request).execute()
        val text = response.body?.string().orEmpty()
        if (!response.isSuccessful) throw ApiException(response.code, detailOf(text))
        return json.decodeFromString(text)
    }

    suspend fun listEventAttachments(eventId: String): List<Attachment> =
        get("/api/v1/events/$eventId/attachments")

    suspend fun attachmentContent(id: String): ByteArray {
        val request = Request.Builder()
            .url(url("/api/v1/attachments/$id/content"))
            .get()
            .header("Authorization", "Bearer ${tokens.access() ?: throw ApiException(401, "")}")
            .header("X-Femho-Source", "android")
            .build()
        val response = client.newCall(request).execute()
        val bytes = response.body?.bytes() ?: throw ApiException(response.code, "No content")
        if (!response.isSuccessful) throw ApiException(response.code, detailOf(response.body?.string().orEmpty()))
        return bytes
    }

    suspend fun deleteAttachment(id: String) {
        raw("DELETE", "/api/v1/attachments/$id", null, authenticated = true)
    }

    // ------------------------------------------------------------------ Sessions

    suspend fun sessions(
        from: String? = null,
        to: String? = null,
        scopeIds: List<String>? = null,
        projectId: String? = null,
        userId: String? = null,
        search: String? = null,
    ): SessionReport {
        val query = buildList {
            if (from != null) add("from=$from")
            if (to != null) add("to=$to")
            if (scopeIds != null && scopeIds.isNotEmpty()) add("scope_ids=" + scopeIds.joinToString(","))
            if (projectId != null) add("project_id=$projectId")
            if (userId != null) add("user_id=$userId")
            if (search != null) add("search=${java.net.URLEncoder.encode(search, "UTF-8")}")
        }.joinToString("&")
        return get("/api/v1/sessions" + if (query.isEmpty()) "" else "?$query")
    }

    suspend fun sessionStats(
        from: String? = null,
        to: String? = null,
        scopeIds: List<String>? = null,
        projectId: String? = null,
        userId: String? = null,
    ): SessionStats {
        val query = buildList {
            if (from != null) add("from=$from")
            if (to != null) add("to=$to")
            if (scopeIds != null && scopeIds.isNotEmpty()) add("scope_ids=" + scopeIds.joinToString(","))
            if (projectId != null) add("project_id=$projectId")
            if (userId != null) add("user_id=$userId")
        }.joinToString("&")
        return get("/api/v1/sessions/stats" + if (query.isEmpty()) "" else "?$query")
    }

    suspend fun exportSessionsCsv(
        from: String? = null,
        to: String? = null,
        scopeIds: List<String>? = null,
        projectId: String? = null,
        userId: String? = null,
        search: String? = null,
    ): String {
        val query = buildList {
            if (from != null) add("from=$from")
            if (to != null) add("to=$to")
            if (scopeIds != null && scopeIds.isNotEmpty()) add("scope_ids=" + scopeIds.joinToString(","))
            if (projectId != null) add("project_id=$projectId")
            if (userId != null) add("user_id=$userId")
            if (search != null) add("search=${java.net.URLEncoder.encode(search, "UTF-8")}")
        }.joinToString("&")
        return raw("GET", "/api/v1/sessions/export.csv" + if (query.isEmpty()) "" else "?$query", null, authenticated = true)
    }

    suspend fun createSession(
        id: String,
        taskId: String,
        startedAt: String,
        endedAt: String? = null,
        note: String? = null,
    ): Session = post("/api/v1/sessions", mapOf("id" to id, "task_id" to taskId, "started_at" to startedAt, "ended_at" to endedAt, "note" to note))

    suspend fun updateSession(id: String, startedAt: String? = null, endedAt: String? = null, taskId: String? = null, note: String? = null): Session =
        patch("/api/v1/sessions/$id", buildMap {
            if (startedAt != null) put("started_at", startedAt)
            if (endedAt != null) put("ended_at", endedAt)
            if (taskId != null) put("task_id", taskId)
            if (note != null) put("note", note)
        })

    suspend fun deleteSession(id: String) {
        raw("DELETE", "/api/v1/sessions/$id", null, authenticated = true)
    }

    // ------------------------------------------------------------------ Compartits

    suspend fun shares(): List<ShareSummary> = get("/api/v1/shares")

    suspend fun createShare(
        taskId: String? = null,
        checklistId: String? = null,
        permission: String,
        requireName: Boolean = false,
        password: String? = null,
        expiresAt: String? = null,
        maxViews: Int? = null,
    ): Map<String, Any> = post("/api/v1/shares", buildMap {
        if (taskId != null) put("task_id", taskId)
        if (checklistId != null) put("checklist_id", checklistId)
        put("permission", permission)
        put("require_name", requireName)
        if (password != null) put("password", password)
        if (expiresAt != null) put("expires_at", expiresAt)
        if (maxViews != null) put("max_views", maxViews)
    })

    suspend fun shareAccesses(id: String): List<ShareAccess> = get("/api/v1/shares/$id/accesses")

    suspend fun updateShare(id: String, permission: String? = null, requireName: Boolean? = null, password: String? = null, expiresAt: String? = null, maxViews: Int? = null): ShareSummary =
        patch("/api/v1/shares/$id", buildMap {
            if (permission != null) put("permission", permission)
            if (requireName != null) put("require_name", requireName)
            if (password != null) put("password", password)
            if (expiresAt != null) put("expires_at", expiresAt)
            if (maxViews != null) put("max_views", maxViews)
        })

    suspend fun revokeShare(id: String) {
        raw("DELETE", "/api/v1/shares/$id", null, authenticated = true)
    }

    // ------------------------------------------------------------------ Convits i membres

    suspend fun scopeInvites(scopeId: String): List<Map<String, Any>> = get("/api/v1/scopes/$scopeId/invites")

    suspend fun createScopeInvite(scopeId: String): Map<String, Any> = post("/api/v1/scopes/$scopeId/invites", emptyMap<String, Any>())

    suspend fun revokeScopeInvite(scopeId: String, grantId: String) {
        raw("DELETE", "/api/v1/scopes/$scopeId/invites/$grantId", null, authenticated = true)
    }

    suspend fun joinPreview(token: String): Map<String, Any> = get("/api/v1/join/$token")

    suspend fun acceptJoin(token: String): Map<String, Any> = post("/api/v1/join/$token", emptyMap<String, Any>())

    suspend fun scopeMembers(scopeId: String): List<Map<String, Any>> = get("/api/v1/scopes/$scopeId/members")

    suspend fun updateMember(scopeId: String, memberId: String, role: String): Map<String, Any> =
        patch("/api/v1/scopes/$scopeId/members/$memberId", mapOf("role" to role))

    suspend fun removeMember(scopeId: String, memberId: String) {
        raw("DELETE", "/api/v1/scopes/$scopeId/members/$memberId", null, authenticated = true)
    }

    suspend fun leaveScope(scopeId: String) {
        raw("DELETE", "/api/v1/scopes/$scopeId/members/me", null, authenticated = true)
    }

    // ------------------------------------------------------------------ Correu

    suspend fun mailAccounts(): List<MailAccount> = get("/api/v1/mail/accounts")

    suspend fun createMailAccount(name: String, host: String, username: String, password: String, security: String): MailAccount =
        post("/api/v1/mail/accounts", mapOf("name" to name, "host" to host, "username" to username, "password" to password, "security" to security))

    suspend fun updateMailAccount(id: String, name: String? = null, host: String? = null, username: String? = null, password: String? = null, security: String? = null): MailAccount =
        patch("/api/v1/mail/accounts/$id", buildMap {
            if (name != null) put("name", name)
            if (host != null) put("host", host)
            if (username != null) put("username", username)
            if (password != null) put("password", password)
            if (security != null) put("security", security)
        })

    suspend fun deleteMailAccount(id: String) {
        raw("DELETE", "/api/v1/mail/accounts/$id", null, authenticated = true)
    }

    suspend fun testMailAccount(id: String, password: String? = null): MailTestResult =
        post("/api/v1/mail/accounts/$id/test", if (password != null) mapOf("password" to password) else emptyMap())

    suspend fun mailFolders(id: String): List<Map<String, Any>> = get("/api/v1/mail/accounts/$id/folders")

    suspend fun mailRules(): List<MailRule> = get("/api/v1/mail/rules")

    suspend fun createMailRule(accountId: String, folder: String, scopeId: String? = null, projectId: String? = null, titleTemplate: String? = null, inboxVisible: Boolean? = null): MailRule =
        post("/api/v1/mail/rules", buildMap {
            put("account_id", accountId)
            put("folder", folder)
            if (scopeId != null) put("scope_id", scopeId)
            if (projectId != null) put("project_id", projectId)
            if (titleTemplate != null) put("title_template", titleTemplate)
            if (inboxVisible != null) put("inbox_visible", inboxVisible)
        })

    suspend fun updateMailRule(id: String, folder: String? = null, scopeId: String? = null, projectId: String? = null, titleTemplate: String? = null, inboxVisible: Boolean? = null): MailRule =
        patch("/api/v1/mail/rules/$id", buildMap {
            if (folder != null) put("folder", folder)
            if (scopeId != null) put("scope_id", scopeId)
            if (projectId != null) put("project_id", projectId)
            if (titleTemplate != null) put("title_template", titleTemplate)
            if (inboxVisible != null) put("inbox_visible", inboxVisible)
        })

    suspend fun deleteMailRule(id: String) {
        raw("DELETE", "/api/v1/mail/rules/$id", null, authenticated = true)
    }

    suspend fun mailMessages(from: String, to: String, scopeIds: List<String>? = null): List<Map<String, Any>> {
        val query = buildList {
            add("from=$from")
            add("to=$to")
            if (scopeIds != null && scopeIds.isNotEmpty()) add("scope_ids=" + scopeIds.joinToString(","))
        }.joinToString("&")
        return get("/api/v1/mail/messages?$query")
    }

    suspend fun convertMailMessage(id: String): Map<String, Any> = post("/api/v1/mail/messages/$id/convert", emptyMap<String, Any>())

    suspend fun dismissMailMessage(id: String) {
        raw("DELETE", "/api/v1/mail/messages/$id", null, authenticated = true)
    }

    suspend fun setMailInInbox(messageId: String, visible: Boolean?): Map<String, Any> =
        post("/api/v1/inbox/mail", mapOf("message_id" to messageId, "visible" to visible))

    // ------------------------------------------------------------------ Calendaris

    suspend fun calendars(): List<Calendar> = get("/api/v1/calendars")

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
    ): Calendar = post("/api/v1/calendars", buildMap {
        if (scopeId != null) put("scope_id", scopeId)
        if (projectId != null) put("project_id", projectId)
        put("name", name)
        if (color != null) put("color", color)
        put("origin", origin)
        if (sourceKind != null) put("source_kind", sourceKind)
        if (sourceUrl != null) put("source_url", sourceUrl)
        if (sourceUsername != null) put("source_username", sourceUsername)
        if (sourceSecret != null) put("source_secret", sourceSecret)
        if (refreshInterval != null) put("refresh_interval", refreshInterval)
        if (inboxVisible != null) put("inbox_visible", inboxVisible)
    })

    suspend fun updateCalendar(id: String, name: String? = null, color: String? = null, sourceUrl: String? = null, sourceUsername: String? = null, sourceSecret: String? = null, refreshInterval: Int? = null, inboxVisible: Boolean? = null): Calendar =
        patch("/api/v1/calendars/$id", buildMap {
            if (name != null) put("name", name)
            if (color != null) put("color", color)
            if (sourceUrl != null) put("source_url", sourceUrl)
            if (sourceUsername != null) put("source_username", sourceUsername)
            if (sourceSecret != null) put("source_secret", sourceSecret)
            if (refreshInterval != null) put("refresh_interval", refreshInterval)
            if (inboxVisible != null) put("inbox_visible", inboxVisible)
        })

    suspend fun deleteCalendar(id: String) {
        raw("DELETE", "/api/v1/calendars/$id", null, authenticated = true)
    }

    // ------------------------------------------------------------------ Etiquetes

    suspend fun labels(): List<Label> = get("/api/v1/labels")

    suspend fun createLabel(scopeId: String, name: String, color: String? = null): Label =
        post("/api/v1/labels", mapOf("scope_id" to scopeId, "name" to name, "color" to color))

    suspend fun deleteLabel(id: String) {
        raw("DELETE", "/api/v1/labels/$id", null, authenticated = true)
    }

    suspend fun addTaskLabel(taskId: String, labelId: String) {
        raw("POST", "/api/v1/tasks/$taskId/labels/$labelId", null, authenticated = true)
    }

    suspend fun removeTaskLabel(taskId: String, labelId: String) {
        raw("DELETE", "/api/v1/tasks/$taskId/labels/$labelId", null, authenticated = true)
    }

    // ------------------------------------------------------------------ Tipologies

    suspend fun taskTypes(scopeId: String? = null): List<TaskType> {
        val query = if (scopeId != null) "?scope_id=$scopeId" else ""
        return get("/api/v1/task-types$query")
    }

    suspend fun createTaskType(scopeId: String, name: String, color: String? = null, required: Boolean = false): TaskType =
        post("/api/v1/task-types", mapOf("scope_id" to scopeId, "name" to name, "color" to color, "required" to required))

    suspend fun updateTaskType(id: String, name: String? = null, color: String? = null, required: Boolean? = null): TaskType =
        patch("/api/v1/task-types/$id", buildMap {
            if (name != null) put("name", name)
            if (color != null) put("color", color)
            if (required != null) put("required", required)
        })

    suspend fun deleteTaskType(id: String) {
        raw("DELETE", "/api/v1/task-types/$id", null, authenticated = true)
    }

    // ------------------------------------------------------------------ Projectes

    suspend fun createProject(scopeId: String, name: String): Project =
        post("/api/v1/projects", mapOf("scope_id" to scopeId, "name" to name))

    suspend fun updateProject(id: String, name: String? = null, archived: Boolean? = null): Project =
        patch("/api/v1/projects/$id", buildMap {
            if (name != null) put("name", name)
            if (archived != null) put("archived", archived)
        })

    suspend fun deleteProject(id: String) {
        raw("DELETE", "/api/v1/projects/$id", null, authenticated = true)
    }

    // ------------------------------------------------------------------ Àmbits

    suspend fun createScope(name: String, color: String, kind: String = "individual", icon: String? = null): Scope =
        post("/api/v1/scopes", buildMap {
            put("name", name)
            put("color", color)
            put("kind", kind)
            if (icon != null) put("icon", icon)
        })

    suspend fun updateScope(id: String, name: String? = null, color: String? = null, icon: String? = null): Scope =
        patch("/api/v1/scopes/$id", buildMap {
            if (name != null) put("name", name)
            if (color != null) put("color", color)
            if (icon != null) put("icon", icon)
        })

    suspend fun deleteScope(id: String) {
        raw("DELETE", "/api/v1/scopes/$id", null, authenticated = true)
    }

    suspend fun scopeSettings(scopeId: String): ScopeSettings = get("/api/v1/scopes/$scopeId/settings")

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
    ): ScopeSettings = patch("/api/v1/scopes/$scopeId/settings", buildMap {
        if (timeTracking != null) put("time_tracking", timeTracking)
        if (workStart != null) put("work_start", workStart)
        if (workEnd != null) put("work_end", workEnd)
        if (workDays != null) put("work_days", workDays)
        if (overtimeVisible != null) put("overtime_visible", overtimeVisible)
        if (longSessionHours != null) put("long_session_hours", longSessionHours)
        if (projectNoun != null) put("project_noun", projectNoun)
        if (taskTypesEnabled != null) put("task_types_enabled", taskTypesEnabled)
    })

    // ------------------------------------------------------------------ Tokens d'API

    suspend fun apiTokens(): List<ApiTokenSummary> = get("/api/v1/tokens")

    suspend fun createApiToken(name: String, capabilities: List<String>): Map<String, Any> =
        post("/api/v1/tokens", mapOf("name" to name, "capabilities" to capabilities))

    suspend fun revokeApiToken(id: String) {
        raw("DELETE", "/api/v1/tokens/$id", null, authenticated = true)
    }

    // ------------------------------------------------------------------ IA / Agents

    suspend fun updateAgentScopes(agentId: String, scopeIds: List<String>, allScopes: Boolean): Map<String, Any> =
        put("/api/v1/ai/agents/$agentId/scopes", mapOf("scope_ids" to scopeIds, "all_scopes" to allScopes))

    suspend fun createAgentCredential(agentId: String): Map<String, Any> =
        post("/api/v1/ai/agents/$agentId/credentials", emptyMap<String, Any>())

    suspend fun agentSkill(): String = raw("GET", "/api/v1/ai/skill", null, authenticated = true)

    suspend fun aiAttention(): Map<String, Any> = get("/api/v1/ai/attention")

    /** Els agents estesos (àmbits, permisos), per a Ajustos ▸ Usuari IA. */
    suspend fun agentDetails(): List<AgentDetail> = get("/api/v1/ai/agents")

    suspend fun createAgent(name: String): AgentDetail =
        post("/api/v1/ai/agents", mapOf("name" to name))

    suspend fun updateAgent(
        agentId: String,
        enabled: Boolean? = null,
        canCreateTasks: Boolean? = null,
    ): AgentDetail = patch("/api/v1/ai/agents/$agentId", buildMap {
        if (enabled != null) put("enabled", enabled)
        if (canCreateTasks != null) put("can_create_tasks", canCreateTasks)
    })

    suspend fun deleteAgent(agentId: String) {
        raw("DELETE", "/api/v1/ai/agents/$agentId", null, authenticated = true)
    }

    /** Quins àmbits pot marcar, i quins ja té un altre agent (per desactivar-los). */
    suspend fun agentScopeAvailability(agentId: String): List<AgentScopeAvailability> =
        get<AgentScopeEnvelope>("/api/v1/ai/agents/$agentId/scope-availability").data

    /** Les credencials d'un agent, per llistar-les i poder revocar-les. */
    suspend fun agentCredentials(agentId: String): List<ApiTokenSummary> =
        get<CredentialEnvelope>("/api/v1/ai/agents/$agentId/credentials").data

    suspend fun aiCoverage(): Map<String, Any> = get("/api/v1/ai/coverage")

    suspend fun aiStatus(): Map<String, Any> = get("/api/v1/ai/status")

    suspend fun takeOverTask(taskId: String, status: String): Task =
        post("/api/v1/tasks/$taskId/take-over", mapOf("status" to status))

    suspend fun claimTask(taskId: String): Task = post("/api/v1/ai/tasks/$taskId/claim", emptyMap<String, Any>())

    suspend fun releaseTask(taskId: String): Task = post("/api/v1/tasks/$taskId/release", emptyMap<String, Any>())

    suspend fun askUser(taskId: String, question: String): Map<String, Any> =
        post("/api/v1/tasks/$taskId/ask-user", mapOf("question" to question))

    suspend fun resumeTask(taskId: String, learned: String): Task =
        post("/api/v1/tasks/$taskId/resume", mapOf("learned" to learned))

    // ------------------------------------------------------------------ Tasques (extres)

    suspend fun getTask(id: String): Task = get("/api/v1/tasks/$id")

    suspend fun updateTask(id: String, fields: Map<String, Any?>): Task {
        val filtered = fields.filterValues { it != null }.mapValues { it.value!! }
        return patch("/api/v1/tasks/$id", filtered as Map<String, Any>)
    }

    suspend fun deleteTask(id: String) {
        raw("DELETE", "/api/v1/tasks/$id", null, authenticated = true)
    }

    suspend fun addAssignee(taskId: String, userId: String) {
        raw("POST", "/api/v1/tasks/$taskId/assignees/$userId", null, authenticated = true)
    }

    suspend fun removeAssignee(taskId: String, userId: String) {
        raw("DELETE", "/api/v1/tasks/$taskId/assignees/$userId", null, authenticated = true)
    }

    suspend fun taskComments(taskId: String): List<Comment> = get("/api/v1/tasks/$taskId/comments")

    suspend fun addComment(taskId: String, body: String): Comment =
        post("/api/v1/tasks/$taskId/comments", mapOf("body" to body))

    suspend fun taskActivity(taskId: String): List<ho.fem.model.ActivityEntry> =
        get<ActivityEnvelope>("/api/v1/tasks/$taskId/activity").data

    suspend fun undoActivity(id: String): Map<String, Any> = post("/api/v1/activity/$id/undo", emptyMap<String, Any>())

    // ------------------------------------------------------------------ Cerca

    suspend fun search(q: String, limit: Int? = null): Map<String, Any> {
        val query = if (limit != null) "?q=${java.net.URLEncoder.encode(q, "UTF-8")}&limit=$limit" else "?q=${java.net.URLEncoder.encode(q, "UTF-8")}"
        return get("/api/v1/search$query")
    }

    // ------------------------------------------------------------------ Dashboard

    suspend fun dashboard(): Map<String, Any> = get("/api/v1/dashboard")

    // ------------------------------------------------------------------ Admin

    suspend fun inviteAdminUser(email: String, name: String): Map<String, Any> =
        post("/api/v1/admin/users/invite", mapOf("email" to email, "name" to name))

    suspend fun updateAdminUser(id: String, name: String? = null, role: String? = null): Map<String, Any> =
        patch("/api/v1/admin/users/$id", buildMap {
            if (name != null) put("name", name)
            if (role != null) put("role", role)
        })

    suspend fun deleteAdminUser(id: String) {
        raw("DELETE", "/api/v1/admin/users/$id", null, authenticated = true)
    }

    suspend fun wipeInstance(confirmation: String): Map<String, Any> =
        post("/api/v1/admin/wipe", mapOf("confirmation" to confirmation))

    // ------------------------------------------------------------------ Auth

    suspend fun changePassword(current: String, new: String): Map<String, Any> =
        post("/api/v1/auth/password", mapOf("current_password" to current, "new_password" to new))

    suspend fun updateProfile(name: String? = null, locale: String? = null, theme: String? = null, accent: String? = null): UserProfile =
        patch("/api/v1/auth/me", buildMap {
            if (name != null) put("name", name)
            if (locale != null) put("locale", locale)
            if (theme != null) put("theme", theme)
            if (accent != null) put("accent", accent)
        })

    suspend fun updateSettings(
        gravatar: Boolean? = null,
        weekStart: String? = null,
        eventTaskDeleted: String? = null,
        showCalendarWidget: Boolean? = null,
        showOverdueSection: Boolean? = null,
        inboxPosition: String? = null,
        inboxShowOverdue: Boolean? = null,
    ): Map<String, Any> {
        val fields = buildMap<String, Any> {
            if (gravatar != null) put("gravatar", gravatar)
            if (weekStart != null) put("week_start", weekStart)
            if (eventTaskDeleted != null) put("event_task_deleted", eventTaskDeleted)
            if (showCalendarWidget != null) put("show_calendar_widget", showCalendarWidget)
            if (showOverdueSection != null) put("show_overdue_section", showOverdueSection)
            if (inboxPosition != null) put("inbox_position", inboxPosition)
            if (inboxShowOverdue != null) put("inbox_show_overdue", inboxShowOverdue)
        }
        return patch("/api/v1/auth/settings", fields)
    }
}
