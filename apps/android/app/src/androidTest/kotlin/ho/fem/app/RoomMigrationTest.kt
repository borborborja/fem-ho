package ho.fem.app

import android.database.sqlite.SQLiteDatabase
import androidx.room.Room
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ho.fem.data.FemhoDatabase
import ho.fem.data.OutboxEntity
import ho.fem.data.TaskEntity
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class RoomMigrationTest {
    @Test
    fun v3TaskAndItsQueuedEditSurvive() = runBlocking<Unit> {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val name = "migration-room-v3-v4.db"
        context.deleteDatabase(name)
        val task = TaskEntity(
            id = "local-task", scopeId = "scope-a", projectId = null, title = "Queued edit",
            description = "Unchanged note", status = "todo", position = "a1", dueDate = null,
            dueTime = null, completedAt = null, aiMode = "manual", assigneeIds = "", version = 7,
        )
        val pending = OutboxEntity("local-op", "task", "update", task.id, 7, """{"title":"Queued edit"}""", 123L, 2)
        try {
            val fresh = Room.databaseBuilder(context, FemhoDatabase::class.java, name).build()
            try {
                fresh.dao().putTaskAndEnqueue(task, pending)
            } finally {
                fresh.close()
            }
            SQLiteDatabase.openDatabase(context.getDatabasePath(name).path, null, SQLiteDatabase.OPEN_READWRITE).use { legacy ->
                // Les altres taules tenen el mateix esquema a les dues versions.
                legacy.execSQL("DROP TABLE task_lists")
                legacy.execSQL("DROP TABLE pomodoro_cache")
                legacy.execSQL("DROP TABLE calendar_suggestions_cache")
                legacy.execSQL("DROP TABLE doing_auto_stop_cache")
                legacy.execSQL("ALTER TABLE tasks RENAME TO fixture_task")
                legacy.execSQL(
                    "CREATE TABLE tasks (id TEXT NOT NULL PRIMARY KEY, scope_id TEXT NOT NULL, project_id TEXT, " +
                        "title TEXT NOT NULL, description TEXT, status TEXT NOT NULL, position TEXT NOT NULL, " +
                        "due_date TEXT, due_time TEXT, completed_at TEXT, ai_mode TEXT NOT NULL, assignee_ids TEXT NOT NULL, " +
                        "version INTEGER NOT NULL, deleted INTEGER NOT NULL)",
                )
                legacy.execSQL(
                    "INSERT INTO tasks SELECT id, scope_id, project_id, title, description, status, position, due_date, " +
                        "due_time, completed_at, ai_mode, assignee_ids, version, deleted FROM fixture_task",
                )
                legacy.execSQL("DROP TABLE fixture_task")
                legacy.execSQL("ALTER TABLE outbox RENAME TO fixture_outbox")
                legacy.execSQL(
                    "CREATE TABLE outbox (op_id TEXT NOT NULL PRIMARY KEY, entity TEXT NOT NULL, op TEXT NOT NULL, " +
                        "entity_id TEXT NOT NULL, base_version INTEGER NOT NULL, payload TEXT NOT NULL, " +
                        "queued_at INTEGER NOT NULL, attempts INTEGER NOT NULL)",
                )
                legacy.execSQL(
                    "INSERT INTO outbox SELECT op_id, entity, op, entity_id, base_version, payload, queued_at, " +
                        "attempts FROM fixture_outbox",
                )
                legacy.execSQL("DROP TABLE fixture_outbox")
                // Room ha de validar l'esquema migrat i escriure'n la identitat nova.
                legacy.execSQL("DROP TABLE room_master_table")
                legacy.version = 3
            }
            val migrated = Room.databaseBuilder(context, FemhoDatabase::class.java, name)
                .addMigrations(
                    FemhoDatabase.MIGRATION_3_4, FemhoDatabase.MIGRATION_4_5,
                    FemhoDatabase.MIGRATION_5_6, FemhoDatabase.MIGRATION_6_7,
                ).build()
            try {
                val dao = migrated.dao()
                assertEquals(task, dao.task(task.id).first())
                assertEquals(pending.copy(taskId = task.id), dao.outbox().single())
                assertNull(dao.taskLists(task.id).first())
                assertNull(dao.pomodoroCache().first())
                assertNull(dao.calendarSuggestionsCache().first())
                assertNull(dao.doingAutoStopCache().first())
            } finally {
                migrated.close()
            }
        } finally {
            context.deleteDatabase(name)
        }
    }
}
