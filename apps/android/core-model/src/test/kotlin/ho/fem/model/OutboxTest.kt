package ho.fem.model

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Les regles de la cua, docs/06 §4.
 *
 * Els mateixos casos que les proves de la web a `apps/web/src/sync/outbox.test.ts`. No
 * comparteixen fixtures perquè les operacions no són dades d'entrada sinó estructures
 * que cada client construeix, però **sí que comparteixen els casos**, i el dia que un
 * dels dos els resolgui diferent, aquesta prova o l'altra ho dirà.
 */
class OutboxTest {

    private fun op(
        id: String,
        entityId: String,
        op: String = "update",
        at: Long = 0,
        version: Int = 1,
        dependsOn: String? = null,
        payload: String = "{}",
    ) = Operation(id, "task", op, entityId, version, payload, at, dependsOn)

    @Test
    fun `tres canvis del mateix camp son una operacio`() {
        val merged = mergeOperations(
            listOf(
                op("a", "t1", at = 1, version = 3, payload = """{"title":"un"}"""),
                op("b", "t1", at = 2, version = 4, payload = """{"title":"dos"}"""),
                op("c", "t1", at = 3, version = 5, payload = """{"title":"tres"}"""),
            ),
        )

        assertEquals(1, merged.size)
        // L'última porta el valor bo...
        assertEquals("""{"title":"tres"}""", merged[0].payload)
        // ...i la versió de la primera, que és la que el client tenia en començar.
        assertEquals(3, merged[0].baseVersion)
    }

    @Test
    fun `operacions diferents de la mateixa entitat NO es fusionen`() {
        val merged = mergeOperations(
            listOf(op("a", "t1", op = "update"), op("b", "t1", op = "move")),
        )
        assertEquals(2, merged.size)
    }

    @Test
    fun `una creacio no es fusiona mai`() {
        val merged = mergeOperations(
            listOf(op("a", "t1", op = "create"), op("b", "t1", op = "create")),
        )
        // Col·lapsar-les perdria una de les dues tasques.
        assertEquals(2, merged.size)
    }

    @Test
    fun `la dependencia mana sobre el rellotge`() {
        // La llista s'encua ABANS que la tasca de la qual depèn.
        val ordered = topologicalOrder(
            listOf(
                op("llista", "c1", op = "create", at = 100, dependsOn = "t1"),
                op("tasca", "t1", op = "create", at = 500),
            ),
        )

        val ids = ordered.map { it.opId }
        assertTrue(
            ids.indexOf("tasca") < ids.indexOf("llista"),
            "la tasca ha de sortir abans de la llista que hi penja, i surt $ids",
        )
    }

    @Test
    fun `sense dependencies es respecta l'ordre d'encuament`() {
        val ordered = topologicalOrder(
            listOf(op("b", "t2", at = 200), op("a", "t1", at = 100)),
        )
        assertEquals(listOf("a", "b"), ordered.map { it.opId })
    }

    @Test
    fun `un cicle no perd cap operacio`() {
        val ordered = topologicalOrder(
            listOf(
                op("a", "t1", op = "create", at = 1, dependsOn = "t2"),
                op("b", "t2", op = "create", at = 2, dependsOn = "t1"),
            ),
        )
        // No hauria de passar mai, però perdre escriptures per un error nostre seria
        // pitjor que enviar-les en un ordre que el servidor potser rebutja.
        assertEquals(2, ordered.size)
    }

    @Test
    fun `el lot va fusionat I en ordre`() {
        val batch = prepareBatch(
            listOf(
                op("llista", "c1", op = "create", at = 100, dependsOn = "t1"),
                op("tasca", "t1", op = "create", at = 500),
                op("edicio1", "t1", at = 600, version = 1, payload = """{"title":"un"}"""),
                op("edicio2", "t1", at = 700, version = 2, payload = """{"title":"dos"}"""),
            ),
        )

        assertEquals(3, batch.size)
        val ids = batch.map { it.opId }
        assertTrue(ids.indexOf("tasca") < ids.indexOf("llista"))
        assertEquals("""{"title":"dos"}""", batch.first { it.op == "update" }.payload)
    }
}
