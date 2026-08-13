package ho.fem.data

import androidx.room.ColumnInfo
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Transaction
import androidx.room.RoomDatabase
import kotlinx.coroutines.flow.Flow

/**
 * La base local. docs/03 §11, docs/06 §1.
 *
 * **Els repositoris exposen fluxos des d'aquí i cap pantalla crida la xarxa
 * directament.** És el que fa que l'app funcioni igual amb connexió i sense: la pantalla
 * no sap si el que llegeix acaba d'arribar del servidor o fa tres dies que hi és.
 *
 * L'esquema és el mínim per pintar les pantalles, no una còpia del servidor. El que no
 * es pinta —l'historial sencer, els adjunts, els calendaris externs— es demana quan cal
 * i no es replica: replicar-ho tot faria la primera sincronització llarga i el guany
 * seria zero.
 *
 * **`position` porta el desempat per `id` a totes les consultes ordenades**, com al
 * servidor: amb el jitter (D3) dues claus poden coincidir, i sense desempat el mòbil i
 * la web ensenyarien ordres diferents.
 */

@Entity(tableName = "tasks")
data class TaskEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "scope_id") val scopeId: String,
    @ColumnInfo(name = "project_id") val projectId: String?,
    val title: String,
    val description: String?,
    val status: String,
    val position: String,
    @ColumnInfo(name = "due_date") val dueDate: String?,
    @ColumnInfo(name = "due_time") val dueTime: String?,
    @ColumnInfo(name = "completed_at") val completedAt: String?,
    @ColumnInfo(name = "ai_mode") val aiMode: String,
    @ColumnInfo(name = "assignee_ids") val assigneeIds: String,
    val version: Int,
    /** Esborrat suau: arriba pel sync i no es pot esborrar la fila (docs/06 §7). */
    @ColumnInfo(name = "deleted") val deleted: Boolean = false,
)

@Entity(tableName = "scopes")
data class ScopeEntity(
    @PrimaryKey val id: String,
    val name: String,
    val kind: String,
    val color: String,
    val position: String,
)

@Entity(tableName = "projects")
data class ProjectEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "scope_id") val scopeId: String,
    val name: String,
    val position: String,
)

@Entity(tableName = "people")
data class PersonEntity(@PrimaryKey val id: String, val name: String)

/**
 * Etiquetes. docs/01, docs/05 §4.
 *
 * **Escriptura en línia**: no van a la cua de sortida. El servidor les gestiona directament
 * i el client les llegeix i les mostra. Només es desa localment per pintar la UI.
 */
@Entity(tableName = "labels")
data class LabelEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "scope_id") val scopeId: String,
    val name: String,
    val color: String?,
    @ColumnInfo(name = "created_at") val createdAt: String?,
)

/**
 * Tipologies de tasca. docs/01.
 *
 * **Escriptura en línia**: no van a la cua de sortida.
 */
@Entity(tableName = "task_types")
data class TaskTypeEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "scope_id") val scopeId: String,
    val name: String,
    val color: String?,
    val position: String?,
    val required: Boolean = false,
)

/**
 * Comentaris d'una tasca. docs/01.
 *
 * **Pot encuar-se**: `comment` és a la llista d'entitats de la cua (sync.ts:64-70).
 * Per simplificar en aquesta passada, es tracta com a escriptura en línia.
 */
@Entity(tableName = "comments")
data class CommentEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "task_id") val taskId: String,
    @ColumnInfo(name = "author_id") val authorId: String?,
    @ColumnInfo(name = "author_name") val authorName: String?,
    @ColumnInfo(name = "agent_id") val agentId: String?,
    val body: String,
    @ColumnInfo(name = "created_at") val createdAt: String,
)

/**
 * Sessions de dedicació (registre). docs/01.
 *
 * **Escriptura en línia**: no hi ha suport d'outbox per a sessions en aquesta passada.
 */
@Entity(tableName = "sessions")
data class SessionEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "task_id") val taskId: String,
    @ColumnInfo(name = "scope_id") val scopeId: String?,
    @ColumnInfo(name = "user_id") val userId: String,
    @ColumnInfo(name = "started_at") val startedAt: String,
    @ColumnInfo(name = "ended_at") val endedAt: String?,
    val source: String?,
    val note: String?,
)

/**
 * Calendaris i fonts externes. docs/01, docs/08.
 *
 * **Escriptura en línia**: no van a la cua. El servidor gestiona el refresc de fonts.
 */
@Entity(tableName = "calendars")
data class CalendarEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "scope_id") val scopeId: String?,
    @ColumnInfo(name = "project_id") val projectId: String?,
    val name: String,
    val color: String?,
    val origin: String = "local",
    @ColumnInfo(name = "source_kind") val sourceKind: String?,
    @ColumnInfo(name = "source_url") val sourceUrl: String?,
    @ColumnInfo(name = "refresh_interval") val refreshInterval: Int?,
    @ColumnInfo(name = "inbox_visible") val inboxVisible: Boolean? = null,
    @ColumnInfo(name = "last_refreshed_at") val lastRefreshedAt: String?,
    @ColumnInfo(name = "last_error") val lastError: String?,
    @ColumnInfo(name = "shared_with_scope_id") val sharedWithScopeId: String?,
)

/**
 * Comptes de correu IMAP. docs/07.
 *
 * **Escriptura en línia**: no van a la cua. Les credencials es guarden al servidor.
 */
@Entity(tableName = "mail_accounts")
data class MailAccountEntity(
    @PrimaryKey val id: String,
    val name: String,
    val host: String,
    val username: String,
    @ColumnInfo(name = "has_secret") val hasSecret: Boolean = false,
    val security: String = "tls",
    @ColumnInfo(name = "created_at") val createdAt: String?,
)

/**
 * Regles de correu. docs/07.
 *
 * **Escriptura en línia**: no van a la cua.
 */
@Entity(tableName = "mail_rules")
data class MailRuleEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "account_id") val accountId: String?,
    val folder: String,
    @ColumnInfo(name = "scope_id") val scopeId: String?,
    @ColumnInfo(name = "project_id") val projectId: String?,
    @ColumnInfo(name = "title_template") val titleTemplate: String?,
    @ColumnInfo(name = "inbox_visible") val inboxVisible: Boolean? = null,
)

/**
 * Configuració d'àmbit (time tracking, noun, etc.). docs/01.
 *
 * **Escriptura en línia**: no va a la cua.
 */
@Entity(tableName = "scope_settings")
data class ScopeSettingsEntity(
    @PrimaryKey @ColumnInfo(name = "scope_id") val scopeId: String,
    @ColumnInfo(name = "time_tracking") val timeTracking: Boolean = false,
    @ColumnInfo(name = "work_start") val workStart: String?,
    @ColumnInfo(name = "work_end") val workEnd: String?,
    @ColumnInfo(name = "work_days") val workDays: String, // "1,2,3,4,5" serialitzat
    @ColumnInfo(name = "overtime_visible") val overtimeVisible: Boolean = false,
    @ColumnInfo(name = "long_session_hours") val longSessionHours: Int = 8,
    @ColumnInfo(name = "project_noun") val projectNoun: String = "projecte",
    @ColumnInfo(name = "task_types_enabled") val taskTypesEnabled: Boolean = false,
)

/**
 * Agents d'IA. docs/01.
 *
 * **Escriptura en línia**: no va a la cua.
 */
@Entity(tableName = "agents")
data class AgentEntity(
    @PrimaryKey val id: String,
    val name: String = "",
    val enabled: Boolean = false,
    @ColumnInfo(name = "can_create_tasks") val canCreateTasks: Boolean = false,
    @ColumnInfo(name = "scope_ids") val scopeIds: String = "", // "id1,id2" serialitzat
    @ColumnInfo(name = "all_scopes") val allScopes: Boolean = false,
    @ColumnInfo(name = "created_at") val createdAt: String?,
)

/**
 * La cua de sortida. docs/06 §4.
 *
 * `op_id` és la clau d'idempotència i el genera el client: si la petició es perd i es
 * reintenta, el servidor reconeix que és la mateixa i no la duplica.
 */
@Entity(tableName = "outbox")
data class OutboxEntity(
    @PrimaryKey @ColumnInfo(name = "op_id") val opId: String,
    val entity: String,
    val op: String,
    @ColumnInfo(name = "entity_id") val entityId: String,
    @ColumnInfo(name = "base_version") val baseVersion: Int,
    /** El cos, ja serialitzat. La cua no ha d'entendre què transporta. */
    val payload: String,
    @ColumnInfo(name = "queued_at") val queuedAt: Long,
    val attempts: Int = 0,
)

/** El resultat de `countByStatus`. No és una taula: és la projecció d'un `GROUP BY`. */
data class StatusCount(val status: String, val total: Int)

@Dao
interface FemhoDao {
    @Query("SELECT * FROM tasks WHERE deleted = 0 ORDER BY position, id")
    fun tasks(): Flow<List<TaskEntity>>

    @Query("SELECT * FROM tasks WHERE id = :id AND deleted = 0")
    fun task(id: String): Flow<TaskEntity?>

    /**
     * L'última posició d'una columna, per posar-hi una targeta nova al final.
     *
     * Amb desempat per `id`, com al servidor: amb el jitter (D3) dues claus poden
     * coincidir, i sense desempat "l'última" seria una o l'altra segons el dia.
     */
    @Query(
        "SELECT position FROM tasks WHERE scope_id = :scopeId AND status = :status " +
            "AND deleted = 0 ORDER BY position DESC, id DESC LIMIT 1",
    )
    suspend fun lastPosition(scopeId: String, status: String): String?

    // -------------------------------------------------- lectures per als widgets

    /**
     * El que venç avui o abans, dels àmbits demanats.
     *
     * **`due_date <= :today`, no `= :today`.** Una tasca d'ahir sense fer segueix sent
     * d'avui per a qui la mira; amagar-la seria el tipus de mentida que fa que la gent
     * deixi de fiar-se de la llista. Separar-la visualment ja és feina de qui pinta.
     *
     * `due_time IS NULL` a l'ordre posa les que tenen hora abans que les que no: SQLite
     * ordena 0 (fals) abans que 1. Desempat per `id`, com totes les ordenades (D3).
     */
    @Query(
        "SELECT * FROM tasks WHERE deleted = 0 AND status != 'done' AND completed_at IS NULL " +
            "AND due_date IS NOT NULL AND due_date <= :today AND scope_id IN (:scopeIds) " +
            "ORDER BY due_date, due_time IS NULL, due_time, position, id LIMIT :limit",
    )
    suspend fun dueBy(today: String, scopeIds: List<String>, limit: Int): List<TaskEntity>

    /** Les que ja han vençut, per al distintiu. Estrictament abans d'avui. */
    @Query(
        "SELECT COUNT(*) FROM tasks WHERE deleted = 0 AND status != 'done' " +
            "AND due_date IS NOT NULL AND due_date < :today AND scope_id IN (:scopeIds)",
    )
    suspend fun overdueCount(today: String, scopeIds: List<String>): Int

    /**
     * Els comptadors de les quatre columnes, en una consulta.
     *
     * Les columnes buides **no surten**: `GROUP BY` no inventa files. Qui ho pinti hi ha
     * de posar el zero, i per això `LocalReads` torna un mapa amb les quatre sempre.
     */
    @Query(
        "SELECT status, COUNT(*) AS total FROM tasks WHERE deleted = 0 " +
            "AND scope_id IN (:scopeIds) GROUP BY status",
    )
    suspend fun countByStatus(scopeIds: List<String>): List<StatusCount>

    /**
     * Les mateixes taules que els fluxos, però d'una sola lectura.
     *
     * Un widget pinta un cop i mor: subscriure's a un `Flow` per llegir-lo una vegada
     * deixa una col·lecció oberta en un procés que el sistema matarà de seguida.
     */
    @Query("SELECT * FROM scopes ORDER BY position, id")
    suspend fun scopesOnce(): List<ScopeEntity>

    @Query("SELECT * FROM projects ORDER BY position, id")
    suspend fun projectsOnce(): List<ProjectEntity>

    @Query("SELECT * FROM people ORDER BY name, id")
    suspend fun peopleOnce(): List<PersonEntity>

    // ---------------------------------------------------------------------------

    @Query("SELECT * FROM scopes ORDER BY position, id")
    fun scopes(): Flow<List<ScopeEntity>>

    @Query("SELECT * FROM projects ORDER BY position, id")
    fun projects(): Flow<List<ProjectEntity>>

    @Query("SELECT * FROM people ORDER BY name, id")
    fun people(): Flow<List<PersonEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putTasks(rows: List<TaskEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putScopes(rows: List<ScopeEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putProjects(rows: List<ProjectEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putPeople(rows: List<PersonEntity>)

    @Query("DELETE FROM tasks")
    suspend fun clearTasks()

    /**
     * Buidar i tornar a omplir, **en una sola transacció**.
     *
     * Fer-ho en dos passos deixa una finestra en què la taula és buida, i qualsevol que
     * llegeixi just allà veu zero tasques. A la pantalla és un parpelleig; a un widget de
     * la pantalla d'inici és un "Res per avui" que es queda fins al proper refresc.
     * Es va veure exactament així a l'emulador.
     */
    @Transaction
    suspend fun replaceTasks(rows: List<TaskEntity>) {
        clearTasks()
        putTasks(rows)
    }

    @Query("DELETE FROM scopes")
    suspend fun clearScopes()

    @Query("DELETE FROM projects")
    suspend fun clearProjects()

    @Query("DELETE FROM people")
    suspend fun clearPeople()

    // ------------------------------------------------------------------- cua

    @Query("SELECT * FROM outbox ORDER BY queued_at, op_id")
    fun outboxFlow(): Flow<List<OutboxEntity>>

    @Query("SELECT * FROM outbox ORDER BY queued_at, op_id")
    suspend fun outbox(): List<OutboxEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun enqueue(operation: OutboxEntity)

    @Query("DELETE FROM outbox WHERE op_id = :opId")
    suspend fun dequeue(opId: String)

    @Query("UPDATE outbox SET attempts = attempts + 1 WHERE op_id = :opId")
    suspend fun failed(opId: String)

    /**
     * La fusió d'operacions del mateix camp de la mateixa entitat (docs/06 §4).
     *
     * Tres canvis de títol offline són **una** operació, no tres: enviar-les totes
     * faria que l'historial ensenyés tres edicions que l'usuari no reconeix.
     */
    @Query("DELETE FROM outbox WHERE entity_id = :entityId AND op = :op")
    suspend fun collapse(entityId: String, op: String)

    // -------------------------------------------------------------- etiquetes

    @Query("SELECT * FROM labels ORDER BY name, id")
    fun labels(): Flow<List<LabelEntity>>

    @Query("SELECT * FROM labels WHERE scope_id = :scopeId ORDER BY name, id")
    suspend fun labelsByScope(scopeId: String): List<LabelEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putLabels(rows: List<LabelEntity>)

    @Query("DELETE FROM labels WHERE id = :id")
    suspend fun deleteLabel(id: String)

    @Query("DELETE FROM labels")
    suspend fun clearLabels()

    // ------------------------------------------------------------ tipologies

    @Query("SELECT * FROM task_types ORDER BY position, name")
    fun taskTypes(): Flow<List<TaskTypeEntity>>

    @Query("SELECT * FROM task_types WHERE scope_id = :scopeId ORDER BY position, name")
    suspend fun taskTypesByScope(scopeId: String): List<TaskTypeEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putTaskTypes(rows: List<TaskTypeEntity>)

    @Query("DELETE FROM task_types WHERE id = :id")
    suspend fun deleteTaskType(id: String)

    @Query("DELETE FROM task_types")
    suspend fun clearTaskTypes()

    // ------------------------------------------------------------- comentaris

    @Query("SELECT * FROM comments WHERE task_id = :taskId ORDER BY created_at, id")
    fun commentsByTask(taskId: String): Flow<List<CommentEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putComments(rows: List<CommentEntity>)

    @Query("DELETE FROM comments WHERE task_id = :taskId")
    suspend fun clearComments(taskId: String)

    // ------------------------------------------------------------- sessions

    @Query("SELECT * FROM sessions ORDER BY started_at DESC, id")
    fun sessions(): Flow<List<SessionEntity>>

    @Query("SELECT * FROM sessions WHERE task_id = :taskId ORDER BY started_at DESC")
    suspend fun sessionsByTask(taskId: String): List<SessionEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putSessions(rows: List<SessionEntity>)

    @Query("DELETE FROM sessions WHERE id = :id")
    suspend fun deleteSession(id: String)

    @Query("DELETE FROM sessions")
    suspend fun clearSessions()

    // ------------------------------------------------------------- calendaris

    @Query("SELECT * FROM calendars ORDER BY name, id")
    fun calendars(): Flow<List<CalendarEntity>>

    @Query("SELECT * FROM calendars WHERE scope_id = :scopeId ORDER BY name, id")
    suspend fun calendarsByScope(scopeId: String): List<CalendarEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putCalendars(rows: List<CalendarEntity>)

    @Query("DELETE FROM calendars WHERE id = :id")
    suspend fun deleteCalendar(id: String)

    @Query("DELETE FROM calendars")
    suspend fun clearCalendars()

    // -------------------------------------------------------- comptes correu

    @Query("SELECT * FROM mail_accounts ORDER BY name, id")
    fun mailAccounts(): Flow<List<MailAccountEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putMailAccounts(rows: List<MailAccountEntity>)

    @Query("DELETE FROM mail_accounts WHERE id = :id")
    suspend fun deleteMailAccount(id: String)

    @Query("DELETE FROM mail_accounts")
    suspend fun clearMailAccounts()

    // ---------------------------------------------------------- regles correu

    @Query("SELECT * FROM mail_rules ORDER BY id")
    fun mailRules(): Flow<List<MailRuleEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putMailRules(rows: List<MailRuleEntity>)

    @Query("DELETE FROM mail_rules WHERE id = :id")
    suspend fun deleteMailRule(id: String)

    @Query("DELETE FROM mail_rules")
    suspend fun clearMailRules()

    // ---------------------------------------------------- configuració àmbit

    @Query("SELECT * FROM scope_settings WHERE scope_id = :scopeId")
    fun scopeSettings(scopeId: String): Flow<ScopeSettingsEntity?>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putScopeSettings(row: ScopeSettingsEntity)

    @Query("DELETE FROM scope_settings WHERE scope_id = :scopeId")
    suspend fun clearScopeSettings(scopeId: String)

    // ---------------------------------------------------------------- agents

    @Query("SELECT * FROM agents ORDER BY name, id")
    fun agents(): Flow<List<AgentEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putAgents(rows: List<AgentEntity>)

    @Query("DELETE FROM agents WHERE id = :id")
    suspend fun deleteAgent(id: String)

    @Query("DELETE FROM agents")
    suspend fun clearAgents()

    // ------------------------------------------------------------- projectes

    @Query("DELETE FROM projects WHERE id = :id")
    suspend fun deleteProject(id: String)

    // --------------------------------------------------------------- àmbits

    @Query("DELETE FROM scopes WHERE id = :id")
    suspend fun deleteScope(id: String)
}

@Database(
    entities = [
        TaskEntity::class,
        ScopeEntity::class,
        ProjectEntity::class,
        PersonEntity::class,
        OutboxEntity::class,
        // Entitats noves per a la paritat (onada 1):
        LabelEntity::class,
        TaskTypeEntity::class,
        CommentEntity::class,
        SessionEntity::class,
        CalendarEntity::class,
        MailAccountEntity::class,
        MailRuleEntity::class,
        ScopeSettingsEntity::class,
        AgentEntity::class,
    ],
    version = 2,
    exportSchema = false,
)
abstract class FemhoDatabase : RoomDatabase() {
    abstract fun dao(): FemhoDao

    /**
     * Migració de v1 a v2: afegeix les taules noves de les àrees de paritat.
     *
     * **Decisió**: com que és una app de desenvolupament (versió 1, `exportSchema = false`),
     * s'incrementa la versió a 2 i es crea una migració que afegeix les taules noves.
     * Les entitats existents no es toquen.
     *
     * Les taules noves es creen amb `IF NOT EXISTS` per permetre instal·lacions netes
     * directament a v2 sense passar per la migració.
     */
    companion object {
        val MIGRATION_1_2 = object : androidx.room.migration.Migration(1, 2) {
            override fun migrate(database: androidx.sqlite.db.SupportSQLiteDatabase) {
                // Etiquetes
                database.execSQL(
                    "CREATE TABLE IF NOT EXISTS labels (" +
                        "`id` TEXT PRIMARY KEY NOT NULL, " +
                        "`scope_id` TEXT NOT NULL, " +
                        "name TEXT NOT NULL, " +
                        "color TEXT, " +
                        "`created_at` TEXT)",
                )
                // Tipologies
                database.execSQL(
                    "CREATE TABLE IF NOT EXISTS task_types (" +
                        "`id` TEXT PRIMARY KEY NOT NULL, " +
                        "`scope_id` TEXT NOT NULL, " +
                        "name TEXT NOT NULL, " +
                        "color TEXT, " +
                        "position TEXT, " +
                        "required INTEGER NOT NULL DEFAULT 0)",
                )
                // Comentaris
                database.execSQL(
                    "CREATE TABLE IF NOT EXISTS comments (" +
                        "`id` TEXT PRIMARY KEY NOT NULL, " +
                        "`task_id` TEXT NOT NULL, " +
                        "`author_id` TEXT, " +
                        "`author_name` TEXT, " +
                        "`agent_id` TEXT, " +
                        "body TEXT NOT NULL, " +
                        "`created_at` TEXT NOT NULL)",
                )
                // Sessions
                database.execSQL(
                    "CREATE TABLE IF NOT EXISTS sessions (" +
                        "`id` TEXT PRIMARY KEY NOT NULL, " +
                        "`task_id` TEXT NOT NULL, " +
                        "`scope_id` TEXT, " +
                        "`user_id` TEXT NOT NULL, " +
                        "`started_at` TEXT NOT NULL, " +
                        "`ended_at` TEXT, " +
                        "source TEXT, " +
                        "note TEXT)",
                )
                // Calendaris
                database.execSQL(
                    "CREATE TABLE IF NOT EXISTS calendars (" +
                        "`id` TEXT PRIMARY KEY NOT NULL, " +
                        "`scope_id` TEXT, " +
                        "`project_id` TEXT, " +
                        "name TEXT NOT NULL, " +
                        "color TEXT, " +
                        "origin TEXT NOT NULL DEFAULT 'local', " +
                        "`source_kind` TEXT, " +
                        "`source_url` TEXT, " +
                        "`refresh_interval` INTEGER, " +
                        "`inbox_visible` INTEGER, " +
                        "`last_refreshed_at` TEXT, " +
                        "`last_error` TEXT, " +
                        "`shared_with_scope_id` TEXT)",
                )
                // Comptes de correu
                database.execSQL(
                    "CREATE TABLE IF NOT EXISTS mail_accounts (" +
                        "`id` TEXT PRIMARY KEY NOT NULL, " +
                        "name TEXT NOT NULL, " +
                        "host TEXT NOT NULL, " +
                        "username TEXT NOT NULL, " +
                        "`has_secret` INTEGER NOT NULL DEFAULT 0, " +
                        "security TEXT NOT NULL DEFAULT 'tls', " +
                        "`created_at` TEXT)",
                )
                // Regles de correu
                database.execSQL(
                    "CREATE TABLE IF NOT EXISTS mail_rules (" +
                        "`id` TEXT PRIMARY KEY NOT NULL, " +
                        "`account_id` TEXT, " +
                        "folder TEXT NOT NULL, " +
                        "`scope_id` TEXT, " +
                        "`project_id` TEXT, " +
                        "`title_template` TEXT, " +
                        "`inbox_visible` INTEGER)",
                )
                // Configuració d'àmbit
                database.execSQL(
                    "CREATE TABLE IF NOT EXISTS scope_settings (" +
                        "`scope_id` TEXT PRIMARY KEY NOT NULL, " +
                        "`time_tracking` INTEGER NOT NULL DEFAULT 0, " +
                        "`work_start` TEXT, " +
                        "`work_end` TEXT, " +
                        "`work_days` TEXT NOT NULL DEFAULT '', " +
                        "`overtime_visible` INTEGER NOT NULL DEFAULT 0, " +
                        "`long_session_hours` INTEGER NOT NULL DEFAULT 8, " +
                        "`project_noun` TEXT NOT NULL DEFAULT 'projecte', " +
                        "`task_types_enabled` INTEGER NOT NULL DEFAULT 0)",
                )
                // Agents
                database.execSQL(
                    "CREATE TABLE IF NOT EXISTS agents (" +
                        "`id` TEXT PRIMARY KEY NOT NULL, " +
                        "name TEXT NOT NULL DEFAULT '', " +
                        "enabled INTEGER NOT NULL DEFAULT 0, " +
                        "`can_create_tasks` INTEGER NOT NULL DEFAULT 0, " +
                        "`scope_ids` TEXT NOT NULL DEFAULT '', " +
                        "`all_scopes` INTEGER NOT NULL DEFAULT 0, " +
                        "`created_at` TEXT)",
                )
            }
        }
    }
}
