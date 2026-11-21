package ho.fem.data

import ho.fem.model.CalendarTaskSuggestion
import ho.fem.model.CalendarTaskSuggestions
import ho.fem.model.McpActivity
import ho.fem.model.McpCreation
import ho.fem.model.Task
import ho.fem.model.TaskStatus
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import java.lang.reflect.InvocationHandler
import java.lang.reflect.Proxy
import java.lang.reflect.Method
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class TaskBoardReadsTest {
    private val scopes = listOf(
        ScopeEntity("personal", "Personal", "individual", "blue", "a1"),
        ScopeEntity("work", "Work", "individual", "orange", "a2"),
    )
    private val tasks = (1..30).map { Task("task-$it", "personal", title = "Task $it", position = "a1").toEntity() } +
        Task("work-task", "work", title = "Work", position = "a1", status = TaskStatus.DOING).toEntity()

    private fun local(
        boardTasks: List<TaskEntity> = tasks,
        snapshot: CalendarTaskSuggestions? = null,
        projects: List<ProjectEntity> = emptyList(),
        outbox: List<OutboxEntity> = emptyList(),
    ): LocalReads {
        val dao = Proxy.newProxyInstance(FemhoDao::class.java.classLoader, arrayOf(FemhoDao::class.java)) { proxy, method, args ->
            when {
                // La JVM de proves té Java 17; els stubs d’Android no exposen invokeDefault.
                method.isDefault -> InvocationHandler::class.java
                    .getMethod("invokeDefault", Any::class.java, Method::class.java, Array<Any>::class.java)
                    .invoke(null, proxy, method, args ?: emptyArray<Any>())
                method.name == "scopesOnce" -> scopes
                method.name == "projectsOnce" -> projects
                method.name == "calendarSuggestionsCacheOnce" -> snapshot?.let {
                    CalendarSuggestionsCacheEntity(snapshot = Json.encodeToString(it))
                }
                method.name == "outbox" -> outbox
                method.name == "taskRowsByIds" -> boardTasks.filter { it.id in args!![0] as List<*> }
                method.name == "countByStatus" -> boardTasks.filter { !it.deleted && it.scopeId in args!![0] as List<*> }
                    .groupBy { it.status }.map { (status, rows) -> StatusCount(status, rows.size) }
                method.name == "columnTasks" -> boardTasks.filter { !it.deleted && it.status == args!![0] && it.scopeId in args[1] as List<*> }
                    .sortedWith(compareBy({ it.position }, { it.id }))
                    .take(args!![2] as Int)
                else -> error("Unexpected ${method.name}")
            }
        } as FemhoDao
        return LocalReads(dao)
    }

    private fun suggestion(uid: String, scopeId: String = "personal", taskId: String? = null) = CalendarTaskSuggestion(
        calendarId = "calendar", uid = uid, scopeId = scopeId, taskId = taskId,
        title = uid, calendarName = "Calendar", startsAt = "2026-11-21T09:00:00Z", endsAt = "2026-11-21T09:30:00Z",
        allDay = false, declined = false, canStart = true, requiresShareConfirmation = false, requiresTaskType = false,
    )

    private fun calendar(vararg items: CalendarTaskSuggestion) = CalendarTaskSuggestions(
        enabled = true, date = "2026-11-21", timezone = "Europe/Madrid", dayEndsAt = "2026-11-21T23:00:00Z",
        items = items.toList(),
    )

    @Test
    fun `la procedència MCP es manté a la tasca desada fora de línia`() {
        val provenance = McpActivity(origin = "Revisor", creation = McpCreation("Planificador"))
        val entity = Task("task-mcp", "personal", title = "Tasca MCP", position = "a1", mcpActivity = provenance)
            .toEntity()

        assertEquals(provenance, entity.copy(status = "doing").toDomain().mcpActivity)
        assertNull(entity.copy(taskJson = null).toDomain().mcpActivity)
    }

    @Test
    fun `sense filtre mostra tots els àmbits i limita la llista sense truncar el recompte`() = runBlocking {
        val board = local().taskBoard(emptyList())
        assertEquals(25, board.columns.getValue(TaskStatus.INBOX).size)
        assertEquals(30, board.counts[TaskStatus.INBOX])
        assertEquals(1, board.counts[TaskStatus.DOING])
        assertEquals(0, board.counts[TaskStatus.TODO])
        assertEquals(emptyList(), board.columns[TaskStatus.TODO])
        assertEquals(setOf(TaskStatus.INBOX, TaskStatus.TODO, TaskStatus.DOING), board.columns.keys)
    }

    @Test
    fun `filtrar àmbits aplica el mateix filtre als recomptes i les targetes`() = runBlocking {
        val board = local().taskBoard(listOf("work"))
        assertEquals(listOf("work-task"), board.columns.values.flatten().map { it.id })
        assertEquals(0, board.counts[TaskStatus.INBOX])
        assertEquals(1, board.counts[TaskStatus.DOING])
        assertEquals(setOf("work"), board.scopeColors.keys)
    }

    @Test
    fun `un àmbit retirat conserva les tres columnes buides`() = runBlocking {
        val board = local().taskBoard(listOf("removed"))
        assertEquals(3, board.columns.size)
        assertTrue(board.columns.values.all { it.isEmpty() })
        assertTrue(board.counts.values.all { it == 0 })
        assertTrue(board.scopeColors.isEmpty())
    }

    @Test
    fun `les propostes substitueixen tasques vinculades i canvien de columna amb l'hora del calendari`() = runBlocking {
        val pending = suggestion("pending", taskId = "task-9")
        val finished = Task("done-task", "personal", title = "Feta", position = "a1", status = TaskStatus.DONE).toEntity()
        val local = local(
            boardTasks = tasks + finished,
            snapshot = calendar(pending, pending, suggestion("ongoing", "work", "work-task"), suggestion("finished", taskId = finished.id)),
        )

        val upcoming = local.taskBoard(emptyList(), now = pending.start.minusSeconds(1))
        assertEquals(25, upcoming.columns.getValue(TaskStatus.INBOX).size)
        assertEquals(29, upcoming.counts[TaskStatus.INBOX])
        assertEquals(1, upcoming.counts[TaskStatus.TODO])
        assertEquals(listOf(pending), upcoming.suggestions[TaskStatus.TODO])
        assertEquals(pending.start, upcoming.nextSuggestionAt)

        val current = local.taskBoard(emptyList(), now = pending.start)
        assertEquals(2, current.counts[TaskStatus.DOING])
        assertEquals(listOf(pending), current.suggestions[TaskStatus.DOING])
        assertEquals(pending.end, current.nextSuggestionAt)

        val expiredEvent = local.taskBoard(emptyList(), now = pending.end)
        assertEquals(listOf(pending), expiredEvent.suggestions[TaskStatus.TODO])
        assertEquals(Instant.parse("2026-11-21T23:00:00Z"), expiredEvent.nextSuggestionAt)

        val expiredDay = local.taskBoard(emptyList(), now = checkNotNull(expiredEvent.nextSuggestionAt))
        assertTrue(expiredDay.suggestions.isEmpty())
        assertEquals(30, expiredDay.counts[TaskStatus.INBOX])
        assertNull(expiredDay.nextSuggestionAt)
    }

    @Test
    fun `les propostes respecten els àmbits autoritzats, la selecció de projectes i els ajustos pendents`() = runBlocking {
        val selected = suggestion("selected", "work").copy(projectId = "proj")
        val snapshot = calendar(selected, suggestion("without-project", "work"), suggestion("other-scope"), suggestion("removed", "removed"))
        val projects = listOf(ProjectEntity("proj", "work", "Projecte", "a1"))
        val local = local(snapshot = snapshot, projects = projects)

        val board = local.taskBoard(listOf("work", "removed"), listOf("proj"), selected.start)
        assertEquals(listOf(selected), board.suggestions[TaskStatus.DOING])
        assertEquals(listOf("work-task"), board.columns[TaskStatus.DOING]?.map { it.id })
        assertEquals(2, board.counts[TaskStatus.DOING])
        assertEquals("Europe/Madrid", board.suggestionTimezone)

        val disabled = OutboxEntity("off", "calendar_suggestions", "update", "owner", 0,
            """{"type":"configure","enabled":false}""", 1)
        val offline = local(snapshot = snapshot, projects = projects, outbox = listOf(disabled))
            .taskBoard(listOf("work"), listOf("proj"), selected.start)
        assertTrue(offline.suggestions.isEmpty())
        assertEquals(1, offline.counts[TaskStatus.DOING])
        assertNull(offline.nextSuggestionAt)
    }
}
