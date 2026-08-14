package ho.fem.data

import ho.fem.model.AiMode
import ho.fem.model.Agent
import ho.fem.model.AgentDetail
import ho.fem.model.Calendar
import ho.fem.model.CalendarOrigin
import ho.fem.model.Comment
import ho.fem.model.Label
import ho.fem.model.MailAccount
import ho.fem.model.MailRule
import ho.fem.model.MailSecurity
import ho.fem.model.MailTestResult
import ho.fem.model.Person
import ho.fem.model.Project
import ho.fem.model.Scope
import ho.fem.model.ScopeKind
import ho.fem.model.ScopeSettings
import ho.fem.model.Session
import ho.fem.model.ShareAccess
import ho.fem.model.ShareCreated
import ho.fem.model.ShareSummary
import ho.fem.model.Task
import ho.fem.model.TaskPage
import ho.fem.model.TaskStatus
import ho.fem.model.TaskType
import ho.fem.model.UserProfile
import ho.fem.model.generatePosition
import ho.fem.network.FemhoApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.util.UUID

/**
 * El repositori. docs/03 §11.
 *
 * **Llegir és sempre local; escriure és local i encuar.** La pantalla veu el canvi de
 * seguida perquè la base ja el porta, i la cua l'envia quan es pugui. És el que fa que
 * el mode avió no sigui un mode: és el comportament normal amb la xarxa caiguda.
 *
 * Cap pantalla crida `FemhoApi` directament, i per això l'API és privada aquí dins.
 */
class Repository(
    private val dao: FemhoDao,
    private val api: FemhoApi,
) {
    val tasks: Flow<List<Task>> = dao.tasks().map { rows -> rows.map { it.toDomain() } }
    val scopes: Flow<List<Scope>> = dao.scopes().map { rows -> rows.map { it.toDomain() } }
    val projects: Flow<List<Project>> = dao.projects().map { rows -> rows.map { it.toDomain() } }
    val people: Flow<List<Person>> = dao.people().map { rows -> rows.map { Person(it.id, it.name) } }
    val pending: Flow<Int> = dao.outboxFlow().map { it.size }

    /**
     * Refresca-ho tot des del servidor.
     *
     * **La cua es buida ABANS de llegir.** A l'inrevés, el que s'ha escrit offline es
     * perdria: el servidor encara no ho sap, tornaria l'estat antic i sobreescriuria el
     * local. És el mateix ordre que la web (docs/06 §4).
     */
    suspend fun refresh(scopeIds: List<String>, projectId: String?) {
        flush()

        val scopes = api.scopes()
        val projects = api.projects()
        val people = api.people()
        val board = api.board(scopeIds.ifEmpty { scopes.map { it.id } }, projectId)

        dao.putScopes(scopes.map { it.toEntity() })
        dao.putProjects(projects.map { it.toEntity() })
        if (people.isNotEmpty()) dao.putPeople(people.map { PersonEntity(it.id, it.name) })

        // Es reemplaça la instantània sencera del tauler: mantenir les que ja no hi són
        // deixaria a la pantalla tasques que algú ha esborrat des d'un altre dispositiu.
        // **En una transacció**, perquè ningú llegeixi la taula mig buida.
        dao.replaceTasks(board.tasks.map { it.toEntity() })
    }

    /**
     * Buida la cua de sortida.
     *
     * **La crida que no peta no vol dir que l'operació s'hagi aplicat.** `/sync/batch`
     * respon 200 amb l'estat de cada operació per separat (docs/06 §4), i mirar només si
     * la petició ha anat bé feia que una operació rebutjada sortís de la cua com si
     * s'hagués guardat: la tasca desapareixia del telèfon i no arribava mai al servidor.
     *
     * `ok` i `conflict` surten de la cua —el servidor ja ha decidit—; una rebutjada
     * també, perquè reintentar-la no la farà passar mai, però es compta com a fallada
     * perquè quedi rastre. Si la petició no arriba, es queda i es reintenta.
     */
    suspend fun flush() {
        for (operation in dao.outbox()) {
            val response = runCatching {
                api.syncBatch(
                    """{"operations":[{"op_id":"${operation.opId}","entity":"${operation.entity}",""" +
                        """"op":"${operation.op}","id":"${operation.entityId}",""" +
                        """"base_version":${operation.baseVersion},"data":${operation.payload}}]}""",
                )
            }.getOrNull()

            if (response == null) {
                dao.failed(operation.opId)
                continue
            }

            if (batchStatus(response) == "rejected") dao.failed(operation.opId)
            dao.dequeue(operation.opId)
        }
    }

    /**
     * Crea una tasca **a la columna on s'ha escrit**.
     *
     * El disseny validat posa una afegida ràpida al peu de cada columna, i abans totes
     * anaven a la bústia sense dir-ho: escriure a "Per fer" i veure la targeta aparèixer
     * a un altre lloc és el tipus de mentida petita que fa desconfiar de la resta.
     */
    suspend fun createTask(
        scopeId: String,
        title: String,
        projectId: String?,
        status: TaskStatus = TaskStatus.INBOX,
    ): String {
        // L'identificador el genera el client (D4): la creació és idempotent i la cua la
        // pot reintentar sense duplicar res.
        val id = UUID.randomUUID().toString()
        val wire = status.name.lowercase()
        // Al final de la columna, com fa el servidor quan el client no dona posició.
        val position = generatePosition(dao.lastPosition(scopeId, wire), null)

        dao.putTasks(
            listOf(
                TaskEntity(
                    id = id,
                    scopeId = scopeId,
                    projectId = projectId,
                    title = title,
                    description = null,
                    status = wire,
                    position = position,
                    dueDate = null,
                    dueTime = null,
                    completedAt = null,
                    aiMode = "manual",
                    assigneeIds = "",
                    version = 1,
                ),
            ),
        )

        dao.enqueue(
            OutboxEntity(
                opId = UUID.randomUUID().toString(),
                entity = "task",
                op = "create",
                entityId = id,
                baseVersion = 0,
                payload = """{"id":"$id","scope_id":"$scopeId","title":${quote(title)}""" +
                    ""","status":"$wire"""" +
                    (projectId?.let { ""","project_id":"$it"""" } ?: "") + "}",
                queuedAt = System.currentTimeMillis(),
            ),
        )
        return id
    }

    suspend fun moveTask(task: Task, status: TaskStatus, neighbours: Pair<String?, String?>) {
        val position = generatePosition(neighbours.first, neighbours.second)
        val wire = status.name.lowercase()

        dao.putTasks(listOf(task.copy(status = status, position = position).toEntity()))

        // Fusió: moure la mateixa targeta tres vegades és UN moviment, no tres.
        dao.collapse(task.id, "move")
        dao.enqueue(
            OutboxEntity(
                opId = UUID.randomUUID().toString(),
                entity = "task",
                op = "move",
                entityId = task.id,
                baseVersion = task.version,
                payload = """{"status":"$wire","position":"$position"}""",
                queuedAt = System.currentTimeMillis(),
            ),
        )
    }

    suspend fun renameTask(task: Task, title: String) {
        dao.putTasks(listOf(task.copy(title = title).toEntity()))
        dao.collapse(task.id, "update")
        dao.enqueue(
            OutboxEntity(
                opId = UUID.randomUUID().toString(),
                entity = "task",
                op = "update",
                entityId = task.id,
                baseVersion = task.version,
                payload = """{"title":${quote(title)}}""",
                queuedAt = System.currentTimeMillis(),
            ),
        )
    }

    // ------------------------------------------------------------ etiquetes

    val labels: Flow<List<Label>> = dao.labels().map { rows -> rows.map { it.toDomain() } }

    suspend fun createLabel(scopeId: String, name: String, color: String?): Label {
        val label = api.createLabel(scopeId, name, color)
        dao.putLabels(listOf(label.toEntity()))
        return label
    }

    suspend fun deleteLabel(id: String) {
        api.deleteLabel(id)
        dao.deleteLabel(id)
    }

    // ---------------------------------------------------------- tipologies

    val taskTypes: Flow<List<TaskType>> = dao.taskTypes().map { rows -> rows.map { it.toDomain() } }

    suspend fun createTaskType(scopeId: String, name: String, color: String?, required: Boolean): TaskType {
        val type = api.createTaskType(scopeId, name, color, required)
        dao.putTaskTypes(listOf(type.toEntity()))
        return type
    }

    suspend fun updateTaskType(id: String, name: String? = null, color: String? = null, required: Boolean? = null): TaskType {
        val type = api.updateTaskType(id, name, color, required)
        dao.putTaskTypes(listOf(type.toEntity()))
        return type
    }

    suspend fun deleteTaskType(id: String) {
        api.deleteTaskType(id)
        dao.deleteTaskType(id)
    }

    // ----------------------------------------------------------- comentaris

    fun commentsByTask(taskId: String): Flow<List<Comment>> =
        dao.commentsByTask(taskId).map { rows -> rows.map { it.toDomain() } }

    suspend fun addComment(taskId: String, body: String): Comment {
        // Pot encuar-se (comment és a sync.ts:64-70), però en aquesta passada es tracta
        // com a escriptura en línia per simplicitat —el mateix patró que createProject.
        val comment = api.addComment(taskId, body)
        dao.putComments(listOf(comment.toEntity()))
        return comment
    }

    // ------------------------------------------------------------ sessions

    val sessions: Flow<List<Session>> = dao.sessions().map { rows -> rows.map { it.toDomain() } }

    suspend fun createSession(
        id: String,
        taskId: String,
        startedAt: String,
        endedAt: String? = null,
        note: String? = null,
    ): Session {
        val session = api.createSession(id, taskId, startedAt, endedAt, note)
        dao.putSessions(listOf(session.toEntity()))
        return session
    }

    suspend fun updateSession(id: String, startedAt: String? = null, endedAt: String? = null, taskId: String? = null, note: String? = null): Session {
        val session = api.updateSession(id, startedAt, endedAt, taskId, note)
        dao.putSessions(listOf(session.toEntity()))
        return session
    }

    suspend fun deleteSession(id: String) {
        api.deleteSession(id)
        dao.deleteSession(id)
    }

    // ----------------------------------------------------------- calendaris

    val calendars: Flow<List<Calendar>> = dao.calendars().map { rows -> rows.map { it.toDomain() } }

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
    ): Calendar {
        val calendar = api.createCalendar(scopeId, projectId, name, color, origin, sourceKind, sourceUrl, sourceUsername, sourceSecret, refreshInterval, inboxVisible)
        dao.putCalendars(listOf(calendar.toEntity()))
        return calendar
    }

    suspend fun updateCalendar(
        id: String,
        name: String? = null,
        color: String? = null,
        sourceUrl: String? = null,
        sourceUsername: String? = null,
        sourceSecret: String? = null,
        refreshInterval: Int? = null,
        inboxVisible: Boolean? = null,
    ): Calendar {
        val calendar = api.updateCalendar(id, name, color, sourceUrl, sourceUsername, sourceSecret, refreshInterval, inboxVisible)
        dao.putCalendars(listOf(calendar.toEntity()))
        return calendar
    }

    suspend fun deleteCalendar(id: String) {
        api.deleteCalendar(id)
        dao.deleteCalendar(id)
    }

    // ------------------------------------------------------ comptes correu

    val mailAccounts: Flow<List<MailAccount>> = dao.mailAccounts().map { rows -> rows.map { it.toDomain() } }

    suspend fun createMailAccount(name: String, host: String, username: String, password: String, security: String): MailAccount {
        val account = api.createMailAccount(name, host, username, password, security)
        dao.putMailAccounts(listOf(account.toEntity()))
        return account
    }

    suspend fun updateMailAccount(id: String, name: String? = null, host: String? = null, username: String? = null, password: String? = null, security: String? = null): MailAccount {
        val account = api.updateMailAccount(id, name, host, username, password, security)
        dao.putMailAccounts(listOf(account.toEntity()))
        return account
    }

    suspend fun deleteMailAccount(id: String) {
        api.deleteMailAccount(id)
        dao.deleteMailAccount(id)
    }

    suspend fun testMailAccount(id: String, password: String? = null): MailTestResult =
        api.testMailAccount(id, password)

    val mailFolders: suspend (String) -> List<Map<String, Any>> = api::mailFolders

    // -------------------------------------------------------- regles correu

    val mailRules: Flow<List<MailRule>> = dao.mailRules().map { rows -> rows.map { it.toDomain() } }

    suspend fun createMailRule(
        accountId: String,
        folder: String,
        scopeId: String? = null,
        projectId: String? = null,
        titleTemplate: String? = null,
        inboxVisible: Boolean? = null,
    ): MailRule {
        val rule = api.createMailRule(accountId, folder, scopeId, projectId, titleTemplate, inboxVisible)
        dao.putMailRules(listOf(rule.toEntity()))
        return rule
    }

    suspend fun updateMailRule(
        id: String,
        folder: String? = null,
        scopeId: String? = null,
        projectId: String? = null,
        titleTemplate: String? = null,
        inboxVisible: Boolean? = null,
    ): MailRule {
        val rule = api.updateMailRule(id, folder, scopeId, projectId, titleTemplate, inboxVisible)
        dao.putMailRules(listOf(rule.toEntity()))
        return rule
    }

    suspend fun deleteMailRule(id: String) {
        api.deleteMailRule(id)
        dao.deleteMailRule(id)
    }

    // -------------------------------------------------- configuració àmbit

    fun scopeSettings(scopeId: String): Flow<ScopeSettings> =
        dao.scopeSettings(scopeId).map { row -> row?.toDomain() ?: ScopeSettings() }

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
    ): ScopeSettings {
        val settings = api.updateScopeSettings(scopeId, timeTracking, workStart, workEnd, workDays, overtimeVisible, longSessionHours, projectNoun, taskTypesEnabled)
        dao.putScopeSettings(settings.toEntity())
        return settings
    }

    // ---------------------------------------------------------------- agents

    val agents: Flow<List<Agent>> = dao.agents().map { rows -> rows.map { it.toDomain() } }

    suspend fun refreshAgents() {
        val agents = api.agents()
        dao.putAgents(agents.map { it.toEntity() })
    }

    suspend fun updateAgentScopes(agentId: String, scopeIds: List<String>, allScopes: Boolean) {
        api.updateAgentScopes(agentId, scopeIds, allScopes)
        // Refrescar l'agent després de canviar els àmbits
        val agents = api.agents()
        dao.putAgents(agents.map { it.toEntity() })
    }

    suspend fun createAgentCredential(agentId: String): Map<String, Any> =
        api.createAgentCredential(agentId)

    // ----------------------------------------------------------- projectes

    /**
     * Crea un projecte. **Pot encuar-se** (project és a sync.ts:64-70), però en aquesta
     * passada es tracta com a escriptura en línia per simplicitat —el mateix patró que createTask.
     */
    suspend fun createProject(scopeId: String, name: String): Project {
        val project = api.createProject(scopeId, name)
        dao.putProjects(listOf(project.toEntity()))
        return project
    }

    suspend fun updateProject(id: String, name: String? = null, archived: Boolean? = null): Project {
        val project = api.updateProject(id, name, archived)
        dao.putProjects(listOf(project.toEntity()))
        return project
    }

    suspend fun deleteProject(id: String) {
        api.deleteProject(id)
        dao.deleteProject(id)
    }

    // ---------------------------------------------------------------- àmbits

    suspend fun createScope(name: String, color: String, kind: String = "individual", icon: String? = null): Scope {
        val scope = api.createScope(name, color, kind, icon)
        dao.putScopes(listOf(scope.toEntity()))
        return scope
    }

    suspend fun updateScope(id: String, name: String? = null, color: String? = null, icon: String? = null): Scope {
        val scope = api.updateScope(id, name, color, icon)
        dao.putScopes(listOf(scope.toEntity()))
        return scope
    }

    suspend fun deleteScope(id: String) {
        api.deleteScope(id)
        dao.deleteScope(id)
    }

    // ------------------------------------------------------------- tasques

    /** Actualitza camps nous d'una tasca (descripció, venciment, repetició, etc.). */
    suspend fun updateTask(id: String, fields: Map<String, Any?>): Task {
        val task = api.updateTask(id, fields)
        dao.putTasks(listOf(task.toEntity()))
        return task
    }

    suspend fun deleteTask(id: String) {
        api.deleteTask(id)
        // Esborrat suau: no esborrem la fila, només la marquem
        dao.putTasks(listOf(TaskEntity(id = id, scopeId = "", projectId = null, title = "", description = null, status = "done", position = "", dueDate = null, dueTime = null, completedAt = null, aiMode = "manual", assigneeIds = "", version = 1, deleted = true)))
    }

    suspend fun addAssignee(taskId: String, userId: String) {
        api.addAssignee(taskId, userId)
        // Refrescar la tasca per actualitzar assigneeIds
        refresh(emptyList(), null)
    }

    suspend fun removeAssignee(taskId: String, userId: String) {
        api.removeAssignee(taskId, userId)
        refresh(emptyList(), null)
    }

    suspend fun takeOverTask(taskId: String, status: String): Task {
        val task = api.takeOverTask(taskId, status)
        dao.putTasks(listOf(task.toEntity()))
        return task
    }

    suspend fun undoActivity(id: String): Map<String, Any> =
        api.undoActivity(id)

    // ----------------------------------------------------------- compartits

    val shares: Flow<List<ShareSummary>> = kotlinx.coroutines.flow.flow {
        emit(api.shares())
    }

    suspend fun createShare(
        taskId: String? = null,
        checklistId: String? = null,
        permission: String,
        requireName: Boolean = false,
        password: String? = null,
        expiresAt: String? = null,
        maxViews: Int? = null,
    ): ShareCreated =
        api.createShare(taskId, checklistId, permission, requireName, password, expiresAt, maxViews)

    suspend fun revokeShare(id: String) {
        api.revokeShare(id)
    }

    suspend fun shareAccesses(id: String): List<ShareAccess> =
        api.shareAccesses(id)

    // ------------------------------------------------------------- convits

    suspend fun acceptJoin(token: String) {
        api.acceptJoin(token)
    }

    suspend fun inviteAccept(token: String, password: String) {
        api.inviteAccept(token, password)
    }

    // --------------------------------------------------------------- cerca

    suspend fun search(q: String, limit: Int? = null): TaskPage =
        api.search(q, limit)

    // ----------------------------------------------------------- dashboard

    suspend fun dashboard(): Map<String, Any> =
        api.dashboard()

    // ---------------------------------------------------------------- admin

    suspend fun inviteAdminUser(email: String, name: String): Map<String, Any> =
        api.inviteAdminUser(email, name)

    suspend fun updateAdminUser(id: String, name: String? = null, role: String? = null): Map<String, Any> =
        api.updateAdminUser(id, name, role)

    suspend fun deleteAdminUser(id: String) {
        api.deleteAdminUser(id)
    }

    // ----------------------------------------------------------------- auth

    suspend fun changePassword(current: String, new: String): Map<String, Any> =
        api.changePassword(current, new)

    suspend fun updateProfile(name: String? = null, locale: String? = null, theme: String? = null, accent: String? = null): UserProfile {
        val profile = api.updateProfile(name, locale, theme, accent)
        return profile
    }

    suspend fun updateSettings(
        gravatar: Boolean? = null,
        weekStart: String? = null,
        eventTaskDeleted: String? = null,
        showCalendarWidget: Boolean? = null,
        showOverdueSection: Boolean? = null,
        inboxPosition: String? = null,
        inboxShowOverdue: Boolean? = null,
    ): Map<String, Any> =
        api.updateSettings(gravatar, weekStart, eventTaskDeleted, showCalendarWidget, showOverdueSection, inboxPosition, inboxShowOverdue)

    private fun quote(value: String): String =
        "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n") + "\""
}

/**
 * L'estat de la primera —i única— operació del lot.
 *
 * Es llegeix amb el JSON de `kotlinx` i no amb un regex: `"status"` també és un camp de
 * les tasques, i l'entitat que el servidor torna dins del resultat en porta un.
 */
internal fun batchStatus(response: String): String? = runCatching {
    Json.parseToJsonElement(response)
        .jsonObject["results"]
        ?.jsonArray
        ?.firstOrNull()
        ?.jsonObject
        ?.get("status")
        ?.jsonPrimitive
        ?.content
}.getOrNull()

// ------------------------------------------------------------------ conversions

internal fun TaskEntity.toDomain(): Task = Task(
    id = id,
    scopeId = scopeId,
    projectId = projectId,
    title = title,
    description = description,
    status = TaskStatus.entries.firstOrNull { it.name.equals(status, true) } ?: TaskStatus.INBOX,
    position = position,
    dueDate = dueDate,
    dueTime = dueTime,
    completedAt = completedAt,
    aiMode = AiMode.entries.firstOrNull { it.wire == aiMode } ?: AiMode.MANUAL,
    assigneeIds = if (assigneeIds.isEmpty()) emptyList() else assigneeIds.split(","),
    version = version,
)

internal fun Task.toEntity(): TaskEntity = TaskEntity(
    id = id,
    scopeId = scopeId,
    projectId = projectId,
    title = title,
    description = description,
    status = status.name.lowercase(),
    position = position,
    dueDate = dueDate,
    dueTime = dueTime,
    completedAt = completedAt,
    aiMode = aiMode.wire,
    assigneeIds = assigneeIds.joinToString(","),
    version = version,
)

internal fun ScopeEntity.toDomain(): Scope = Scope(
    id = id,
    name = name,
    kind = ScopeKind.entries.firstOrNull { it.name.equals(kind, true) } ?: ScopeKind.INDIVIDUAL,
    color = color,
    position = position,
    ownerId = "",
)

internal fun Scope.toEntity(): ScopeEntity =
    ScopeEntity(id = id, name = name, kind = kind.name.lowercase(), color = color, position = position)

internal fun ProjectEntity.toDomain(): Project =
    Project(id = id, scopeId = scopeId, name = name, position = position)

internal fun Project.toEntity(): ProjectEntity =
    ProjectEntity(id = id, scopeId = scopeId, name = name, position = position)

internal fun LabelEntity.toDomain(): Label =
    Label(id = id, scopeId = scopeId, name = name, color = color, createdAt = createdAt)

internal fun Label.toEntity(): LabelEntity =
    LabelEntity(id = id, scopeId = scopeId, name = name, color = color, createdAt = createdAt)

internal fun TaskTypeEntity.toDomain(): TaskType =
    TaskType(id = id, scopeId = scopeId, name = name, color = color, position = position, required = required)

internal fun TaskType.toEntity(): TaskTypeEntity =
    TaskTypeEntity(id = id, scopeId = scopeId, name = name, color = color, position = position, required = required)

internal fun CommentEntity.toDomain(): Comment =
    Comment(
        id = id,
        taskId = taskId,
        authorId = authorId,
        authorName = authorName,
        agentId = agentId,
        body = body,
        createdAt = createdAt,
    )

internal fun Comment.toEntity(): CommentEntity =
    CommentEntity(
        id = id,
        taskId = taskId,
        authorId = authorId,
        authorName = authorName,
        agentId = agentId,
        body = body,
        createdAt = createdAt,
    )

internal fun SessionEntity.toDomain(): Session =
    Session(
        id = id,
        taskId = taskId,
        scopeId = scopeId,
        userId = userId,
        startedAt = startedAt,
        endedAt = endedAt,
        source = source,
        note = note,
    )

internal fun Session.toEntity(): SessionEntity =
    SessionEntity(
        id = id,
        taskId = taskId,
        scopeId = scopeId,
        userId = userId,
        startedAt = startedAt,
        endedAt = endedAt,
        source = source,
        note = note,
    )

internal fun CalendarEntity.toDomain(): Calendar =
    Calendar(
        id = id,
        scopeId = scopeId,
        projectId = projectId,
        name = name,
        color = color,
        origin = CalendarOrigin.entries.firstOrNull { it.name.equals(origin, true) } ?: CalendarOrigin.LOCAL,
        sourceKind = sourceKind?.let { ho.fem.model.SourceKind.entries.firstOrNull { k -> k.name.equals(it, true) } },
        sourceUrl = sourceUrl,
        refreshInterval = refreshInterval,
        inboxVisible = inboxVisible,
        lastRefreshedAt = lastRefreshedAt,
        lastError = lastError,
        sharedWithScope = sharedWithScope,
    )

internal fun Calendar.toEntity(): CalendarEntity =
    CalendarEntity(
        id = id,
        scopeId = scopeId,
        projectId = projectId,
        name = name,
        color = color,
        origin = origin.name.lowercase(),
        sourceKind = sourceKind?.name?.lowercase(),
        sourceUrl = sourceUrl,
        refreshInterval = refreshInterval,
        inboxVisible = inboxVisible,
        lastRefreshedAt = lastRefreshedAt,
        lastError = lastError,
        sharedWithScope = sharedWithScope,
    )

internal fun MailAccountEntity.toDomain(): MailAccount =
    MailAccount(
        id = id,
        name = name,
        host = host,
        username = username,
        hasSecret = hasSecret,
        security = MailSecurity.entries.firstOrNull { it.name.equals(security, true) } ?: MailSecurity.TLS,
        createdAt = createdAt,
    )

internal fun MailAccount.toEntity(): MailAccountEntity =
    MailAccountEntity(
        id = id,
        name = name,
        host = host,
        username = username,
        hasSecret = true, // simplificació: sempre true quan ve del servidor
        security = security.name.lowercase(),
        createdAt = createdAt,
    )

internal fun MailRuleEntity.toDomain(): MailRule =
    MailRule(
        id = id,
        accountId = accountId,
        folder = folder,
        scopeId = scopeId,
        projectId = projectId,
        titleTemplate = titleTemplate,
        inboxVisible = inboxVisible,
    )

internal fun MailRule.toEntity(): MailRuleEntity =
    MailRuleEntity(
        id = id,
        accountId = accountId,
        folder = folder,
        scopeId = scopeId,
        projectId = projectId,
        titleTemplate = titleTemplate,
        inboxVisible = inboxVisible,
    )

internal fun ScopeSettingsEntity.toDomain(): ScopeSettings =
    ScopeSettings(
        timeTracking = timeTracking,
        workStart = workStart,
        workEnd = workEnd,
        workDays = workDays,
        overtimeVisible = overtimeVisible,
        longSessionHours = longSessionHours,
        projectNoun = projectNoun,
        taskTypesEnabled = taskTypesEnabled,
    )

internal fun ScopeSettings.toEntity(): ScopeSettingsEntity =
    ScopeSettingsEntity(
        scopeId = "", // es completa en escriure
        timeTracking = timeTracking,
        workStart = workStart,
        workEnd = workEnd,
        workDays = workDays,
        overtimeVisible = overtimeVisible,
        longSessionHours = longSessionHours,
        projectNoun = projectNoun,
        taskTypesEnabled = taskTypesEnabled,
    )

internal fun AgentEntity.toDomain(): Agent =
    Agent(
        id = id,
        name = name,
        enabled = enabled,
    )

internal fun Agent.toEntity(): AgentEntity =
    AgentEntity(
        id = id,
        name = name,
        enabled = enabled,
        canCreateTasks = false,
        scopeIds = "",
        allScopes = false,
        createdAt = null,
    )

internal fun AgentDetail.toEntity(): AgentEntity =
    AgentEntity(
        id = id,
        name = name,
        enabled = enabled,
        canCreateTasks = canCreateTasks,
        scopeIds = scopeIds.joinToString(","),
        allScopes = allScopes,
        createdAt = createdAt,
    )
