package ho.fem.data

import ho.fem.model.Task
import ho.fem.model.TaskStatus
import kotlinx.coroutines.runBlocking
import java.lang.reflect.InvocationHandler
import java.lang.reflect.Proxy
import java.lang.reflect.Method
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class TaskBoardReadsTest {
    private val scopes = listOf(
        ScopeEntity("personal", "Personal", "individual", "blue", "a1"),
        ScopeEntity("work", "Work", "individual", "orange", "a2"),
    )
    private val tasks = (1..30).map { Task("task-$it", "personal", title = "Task $it", position = "a1").toEntity() } +
        Task("work-task", "work", title = "Work", position = "a1", status = TaskStatus.DOING).toEntity()

    private fun local(): LocalReads {
        val dao = Proxy.newProxyInstance(FemhoDao::class.java.classLoader, arrayOf(FemhoDao::class.java)) { proxy, method, args ->
            when {
                // La JVM de proves té Java 17; els stubs d’Android no exposen invokeDefault.
                method.isDefault -> InvocationHandler::class.java
                    .getMethod("invokeDefault", Any::class.java, Method::class.java, Array<Any>::class.java)
                    .invoke(null, proxy, method, args ?: emptyArray<Any>())
                method.name == "scopesOnce" -> scopes
                method.name == "countByStatus" -> tasks.filter { it.scopeId in args!![0] as List<*> }
                    .groupBy { it.status }.map { (status, rows) -> StatusCount(status, rows.size) }
                method.name == "columnTasks" -> tasks.filter { it.status == args!![0] && it.scopeId in args[1] as List<*> }
                    .take(args!![2] as Int)
                else -> error("Unexpected ${method.name}")
            }
        } as FemhoDao
        return LocalReads(dao)
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
}
