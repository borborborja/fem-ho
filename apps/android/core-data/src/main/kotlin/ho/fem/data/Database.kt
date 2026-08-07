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
}

@Database(
    entities = [
        TaskEntity::class,
        ScopeEntity::class,
        ProjectEntity::class,
        PersonEntity::class,
        OutboxEntity::class,
    ],
    version = 1,
    exportSchema = false,
)
abstract class FemhoDatabase : RoomDatabase() {
    abstract fun dao(): FemhoDao
}
