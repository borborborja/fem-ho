package ho.fem.data

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * L'estat de cada operació del lot, llegit de la resposta.
 *
 * **`/sync/batch` respon 200 encara que l'operació es rebutgi** (docs/06 §4: "cada
 * operació es resol per separat"). La cua mirava només si la crida havia anat bé i
 * treia de la cua coses que el servidor no havia guardat mai. Aquestes proves fixen el
 * contracte de lectura perquè no torni a passar.
 */
class BatchStatusTest {
    @Test
    fun `una operació acceptada`() {
        assertEquals(
            "ok",
            batchStatus("""{"results":[{"op_id":"a","status":"ok","entity":{"id":"1"}}]}"""),
        )
    }

    @Test
    fun `una operació rebutjada`() {
        assertEquals(
            "rejected",
            batchStatus("""{"results":[{"op_id":"a","status":"rejected","error":{"detail":"x"}}]}"""),
        )
    }

    @Test
    fun `un conflicte`() {
        assertEquals(
            "conflict",
            batchStatus("""{"results":[{"op_id":"a","status":"conflict","server_entity":{}}]}"""),
        )
    }

    /**
     * **`status` també és un camp de les tasques.** Amb un regex, l'entitat que ve dins
     * del resultat —`"status":"todo"`— es podia llegir com l'estat de l'operació. Per
     * això es parseja i no es busca.
     */
    @Test
    fun `l'estat de l'operació no es confon amb el de la tasca`() {
        assertEquals(
            "ok",
            batchStatus(
                """{"results":[{"op_id":"a","status":"ok","entity":{"id":"1","status":"todo"}}]}""",
            ),
        )
    }

    @Test
    fun `una resposta que no s'entén no diu res, i llavors no es dona per bona`() {
        assertNull(batchStatus("no és json"))
        assertNull(batchStatus("""{"results":[]}"""))
    }
}
