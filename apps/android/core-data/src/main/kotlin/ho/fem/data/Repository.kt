package ho.fem.data

import ho.fem.model.AiMode
import ho.fem.model.Person
import ho.fem.model.Project
import ho.fem.model.Scope
import ho.fem.model.ScopeKind
import ho.fem.model.Task
import ho.fem.model.TaskStatus
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
