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
                legacy.execSQL("DROP TABLE scopes")
                legacy.execSQL(
                    "CREATE TABLE scopes (id TEXT NOT NULL PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, " +
                        "color TEXT NOT NULL, position TEXT NOT NULL)",
                )
                legacy.execSQL("INSERT INTO scopes VALUES ('scope-a', 'Feina', 'individual', 'blue', 'a1')")
                legacy.execSQL("DROP TABLE calendars")
                legacy.execSQL(
                    "CREATE TABLE calendars (id TEXT NOT NULL PRIMARY KEY, scope_id TEXT, project_id TEXT, name TEXT NOT NULL, " +
                        "color TEXT, origin TEXT NOT NULL, source_kind TEXT, source_url TEXT, refresh_interval INTEGER, " +
                        "inbox_visible INTEGER, last_refreshed_at TEXT, last_error TEXT, shared_with_scope INTEGER NOT NULL)",
                )
                legacy.execSQL(
                    "INSERT INTO calendars (id, scope_id, name, origin, source_kind, source_url, shared_with_scope) " +
                        "VALUES ('calendar-a', 'scope-a', 'Calendari', 'subscription', 'ical', 'https://example.test/a.ics', 0)",
                )
                legacy.execSQL("DROP TABLE mail_accounts")
                legacy.execSQL(
                    "CREATE TABLE mail_accounts (id TEXT NOT NULL PRIMARY KEY, name TEXT NOT NULL, host TEXT NOT NULL, " +
                        "username TEXT NOT NULL, has_secret INTEGER NOT NULL, auth_method TEXT NOT NULL DEFAULT 'password', " +
                        "oauth_status TEXT, security TEXT NOT NULL, created_at TEXT)",
                )
                legacy.execSQL(
                    "INSERT INTO mail_accounts (id,name,host,username,has_secret,security) " +
                        "VALUES ('legacy-mail','Office','imap.example.test','office',0,'tls')",
                )
                legacy.execSQL("DROP TABLE mail_rules")
                legacy.execSQL(
                    "CREATE TABLE mail_rules (id TEXT NOT NULL PRIMARY KEY, account_id TEXT, folder TEXT NOT NULL, " +
                        "scope_id TEXT, project_id TEXT, title_template TEXT, inbox_visible INTEGER)",
                )
                legacy.execSQL(
                    "INSERT INTO mail_rules (id,account_id,folder,scope_id) VALUES ('old-rule','legacy-mail','INBOX','scope-a')",
                )
                // Room ha de validar l'esquema migrat i escriure'n la identitat nova.
                legacy.execSQL("DROP TABLE room_master_table")
                legacy.version = 3
            }
            val migrated = Room.databaseBuilder(context, FemhoDatabase::class.java, name)
                .addMigrations(
                    FemhoDatabase.MIGRATION_3_4, FemhoDatabase.MIGRATION_4_5,
                    FemhoDatabase.MIGRATION_5_6, FemhoDatabase.MIGRATION_6_7, FemhoDatabase.MIGRATION_7_8,
                ).build()
            try {
                val dao = migrated.dao()
                assertEquals(task, dao.task(task.id).first())
                assertEquals(pending.copy(taskId = task.id), dao.outbox().single())
                assertNull(dao.taskLists(task.id).first())
                assertNull(dao.pomodoroCache().first())
                assertNull(dao.calendarSuggestionsCache().first())
                assertNull(dao.doingAutoStopCache().first())
                assertEquals("", dao.scopes().first().single().ownerId)
                val calendar = dao.calendars().first().single()
                assertEquals("https://example.test/a.ics", calendar.sourceUrl)
                assertNull(calendar.sourceProvider)
                assertEquals(false, calendar.writable)
                assertEquals("imap", dao.mailAccounts().first().single().transport)
                val mailRule = dao.mailRules().first().single()
                assertEquals("scope-a", mailRule.scopeId)
                assertEquals(true, mailRule.enabled)
                assertNull(mailRule.gmailLabelId)
            } finally {
                migrated.close()
            }
        } finally {
            context.deleteDatabase(name)
        }
    }
}
