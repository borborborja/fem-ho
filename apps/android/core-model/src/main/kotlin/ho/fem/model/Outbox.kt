package ho.fem.model

/**
 * Les regles de la cua de sortida. docs/06 §4.
 *
 * **Viuen aquí, a Kotlin pur, i no a `:core-data`**, per la mateixa raó que l'índex
 * fraccional i el parser: són el contracte de sincronització, l'implementen dos clients
 * i han de fer-ho igual. A `:core-data` necessitarien Room i un emulador per provar-se;
 * aquí es proven a qualsevol màquina.
 *
 * Tres regles, i les tres surten del document:
 *
 *   1. **Fusió** — tres canvis del mateix camp de la mateixa entitat són UNA operació.
 *      Enviar-les totes faria que l'historial ensenyés tres edicions que l'usuari no
 *      reconeix.
 *   2. **Ordre topològic** — una entitat s'ha de crear abans que res que hi apunti. El
 *      criteri és la dependència, no el rellotge: una tasca encuada més tard que la
 *      seva llista ha de sortir igualment abans.
 *   3. **`op_id`** — clau d'idempotència generada al client. Si la petició es perd i es
 *      reintenta, el servidor reconeix que és la mateixa.
 */

data class Operation(
    val opId: String,
    val entity: String,
    val op: String,
    val entityId: String,
    val baseVersion: Int,
    val payload: String,
    val queuedAt: Long,
    /** L'entitat de la qual depèn: una llista depèn de la seva tasca. */
    val dependsOn: String? = null,
)

/**
 * Fusiona les operacions repetides del mateix camp de la mateixa entitat.
 *
 * **Es conserva l'última**, que és la que porta el valor bo, però amb el `baseVersion`
 * de la primera: és la versió que el client tenia quan va començar a editar, i és el que
 * el servidor ha de comparar per detectar un conflicte de veritat.
 *
 * Els `create` no es fusionen mai amb res: crear i després editar són dues coses, i
 * col·lapsar-les perdria la creació.
 */
fun mergeOperations(operations: List<Operation>): List<Operation> {
    val result = mutableListOf<Operation>()
    val indexOfKey = mutableMapOf<String, Int>()

    for (operation in operations) {
        if (operation.op == "create") {
            result += operation
            continue
        }

        val key = "${operation.entity}:${operation.entityId}:${operation.op}"
        val existing = indexOfKey[key]
        if (existing == null) {
            indexOfKey[key] = result.size
            result += operation
        } else {
            result[existing] = operation.copy(baseVersion = result[existing].baseVersion)
        }
    }

    return result
}

/**
 * Ordena per dependència.
 *
 * **La dependència mana sobre el rellotge.** Una llista encuada a les 10:00 que depèn
 * d'una tasca encuada a les 10:05 ha de sortir DESPRÉS de la tasca; si s'enviés per
 * ordre d'encuament, el servidor rebria una llista que penja d'una tasca que encara no
 * existeix.
 *
 * Un cicle —que no hauria de passar mai— no fa petar res: les que queden surten per
 * ordre d'encuament. Deixar-les fora seria perdre escriptures per una condició que
 * potser és un error nostre.
 */
fun topologicalOrder(operations: List<Operation>): List<Operation> {
    val creations = operations.filter { it.op == "create" }.associateBy { it.entityId }
    val emitted = mutableSetOf<String>()
    val result = mutableListOf<Operation>()

    fun emit(operation: Operation) {
        if (operation.opId in emitted) return
        emitted += operation.opId

        val dependency = operation.dependsOn?.let { creations[it] }
        if (dependency != null && dependency.opId !in emitted) emit(dependency)

        result += operation
    }

    for (operation in operations.sortedBy { it.queuedAt }) emit(operation)
    return result
}

/** El que s'envia: fusionat i en ordre de dependència. */
fun prepareBatch(operations: List<Operation>): List<Operation> =
    topologicalOrder(mergeOperations(operations))
