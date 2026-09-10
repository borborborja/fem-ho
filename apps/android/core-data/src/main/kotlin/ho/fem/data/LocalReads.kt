package ho.fem.data

import ho.fem.model.Person
import ho.fem.model.Project
import ho.fem.model.Scope
import ho.fem.model.Task
import ho.fem.model.TaskStatus

data class TaskBoardSnapshot(
    val columns: Map<TaskStatus, List<Task>>,
    val counts: Map<TaskStatus, Int>,
    val scopeColors: Map<String, String>,
)

/**
 * Lectura local, sense servidor.
 *
 * Els widgets de la pantalla d'inici pinten en un procés que el sistema desperta i mata
 * quan vol, sovint abans que el DataStore hagi dit quina és la instància, i sovint sense
 * xarxa. El que necessiten és **llegir la base i prou**.
 *
 * Per què no `Repository`: aquell demana una URL de servidor per construir-se, i pot
 * escriure. Les accions del widget passen pel Repository; pintar-lo només necessita
 * aquesta porta de lectura.
 *
 * La invariant que això respecta és *"cap pantalla crida la xarxa"*, no *"ningú llegeix
 * Room"*: la base local **és** la font de veritat de la interfície (docs/03 §7).
 */
class LocalReads internal constructor(private val dao: FemhoDao) {

    /**
     * Els àmbits que s'han de mirar.
     *
     * **Una llista buida vol dir "tots"**, igual que a `Repository.refresh()`. Si no es
     * resolgués aquí, un `IN ()` no tornaria mai res i el widget es veuria buit
     * precisament per a qui no ha filtrat res.
     */
    private suspend fun resolve(active: List<String>): List<String> =
        if (active.isNotEmpty()) active else dao.scopesOnce().map { it.id }

    /**
     * El que venç avui o abans.
     *
     * `limit` no és negociable i no surt de la interfície: el que es pinta a un widget
     * viatja per una transacció de Binder amb un sostre d'un megabyte compartit amb tot
     * el que el llançador rep. Una llista sense límit és una manera d'aturar la pantalla
     * d'inici de qualcú altre.
     */
    suspend fun due(today: String, activeScopeIds: List<String>, limit: Int = 25): List<Task> =
        dao.dueBy(today, resolve(activeScopeIds), limit).map { it.toDomain() }

    /** Quantes n'hi ha de vençudes abans d'avui. Per al distintiu, no per a la llista. */
    suspend fun overdue(today: String, activeScopeIds: List<String>): Int =
        dao.overdueCount(today, resolve(activeScopeIds))

    /**
     * Els comptadors de les quatre columnes. **Les quatre hi són sempre**, encara que
     * valguin zero: un tauler al qual li falta una columna no es llegeix com a buit, es
     * llegeix com a trencat.
     */
    suspend fun counts(activeScopeIds: List<String>): Map<TaskStatus, Int> {
        val rows = dao.countByStatus(resolve(activeScopeIds))
        val found = rows.associate { row ->
            val status = TaskStatus.entries.firstOrNull { it.name.equals(row.status, true) }
            status to row.total
        }
        return TaskStatus.entries.associateWith { found[it] ?: 0 }
    }

    suspend fun column(status: TaskStatus, activeScopeIds: List<String>, limit: Int = 25): List<Task> =
        dao.columnTasks(status.name.lowercase(), resolve(activeScopeIds), limit).map { it.toDomain() }

    /** Una sola instantània: un moviment no pot duplicar la tasca entre columnes. */
    suspend fun taskBoard(activeScopeIds: List<String>): TaskBoardSnapshot =
        dao.taskBoardSnapshot(activeScopeIds)

    suspend fun scopes(): List<Scope> = dao.scopesOnce().map { it.toDomain() }

    suspend fun projects(): List<Project> = dao.projectsOnce().map { it.toDomain() }

    suspend fun people(): List<Person> = dao.peopleOnce().map { Person(it.id, it.name) }
}
