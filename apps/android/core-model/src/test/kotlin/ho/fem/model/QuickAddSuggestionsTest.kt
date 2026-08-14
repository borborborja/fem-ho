package ho.fem.model

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * L'autocompletat de l'afegida ràpida: el sigil obert i les suggerències que se'n
 * deriven. La mateixa regla que la web (QuickAdd.tsx), perquè els dos costats es
 * comportin igual davant del mateix text.
 */
class QuickAddSuggestionsTest {

    private val context = QuickAddContext(
        scopes = listOf(
            QuickAddScope(
                id = "personal",
                name = "Personal",
                projects = listOf(QuickAddProject("habitatge", "Habitatge")),
            ),
            QuickAddScope(
                id = "feina",
                name = "Feina",
                projects = listOf(QuickAddProject("client-salt", "Client Salt")),
            ),
            // Amb accent, per comprovar que el filtre els ignora.
            QuickAddScope(id = "musica", name = "Música"),
        ),
        people = listOf(
            QuickAddPerson("anna", "Anna"),
            QuickAddPerson("alba", "Alba"),
        ),
        taskTypes = listOf(QuickAddTaskType("task", "Tasca", "feina")),
    )

    private fun suggestions(text: String): List<QuickAddSuggestion> {
        val parsed = parseQuickAdd(text, context)
        return quickAddSuggestions(text, context, parsed.tokens)
    }

    @Test
    fun `sigil obert sense res més suggereix tot`() {
        val open = openSigil("@")
        assertEquals(OpenSigil('@', "", 0), open)
        assertEquals(2, suggestions("@").size)
    }

    @Test
    fun `el darrer sigil guanya`() {
        val open = openSigil("comprar pa @alb")
        assertEquals('@', open?.sigil)
        assertEquals("alb", open?.query)
        assertEquals(11, open?.start)
    }

    @Test
    fun `sense sigil no hi ha suggerencies`() {
        assertNull(openSigil("comprar pa"))
        assertTrue(suggestions("comprar pa").isEmpty())
    }

    @Test
    fun `persones per arrova amb filtre`() {
        val found = suggestions("@al")
        assertEquals(1, found.size)
        assertEquals("Alba", found[0].label)
        assertEquals("@Alba ", found[0].insert)
    }

    @Test
    fun `amics i projectes per coixinet`() {
        val found = suggestions("#")
        val labels = found.map { it.label }
        assertTrue("Personal" in labels)
        assertTrue("Feina" in labels)
        // Els projectes surten com a Àmbit/Projecte.
        assertTrue("Personal/Habitatge" in labels)
        assertTrue("Feina/Client Salt" in labels)
    }

    @Test
    fun `el filtre ignora accents i majuscules`() {
        // "Música" buscat sense accent ni majúscula.
        val found = suggestions("#musi")
        assertEquals(1, found.size)
        assertEquals("Música", found[0].label)
    }

    @Test
    fun `tipologies per dolar`() {
        val found = suggestions("$")
        assertEquals(1, found.size)
        assertEquals("Tasca", found[0].label)
        assertEquals("\$Tasca ", found[0].insert)
    }

    @Test
    fun `sigil resolt no suggereix res`() {
        // @Anna ja és un token: no cal completar-lo.
        assertTrue(suggestions("@Anna").isEmpty())
    }

    @Test
    fun `sigil resolt enmig del text no impedeix el següent`() {
        val found = suggestions("@Anna i @alb")
        assertEquals(1, found.size)
        assertEquals("Alba", found[0].label)
    }

    @Test
    fun `el nom amb espai intern es pot completar`() {
        // "Client Salt" té un espai: el text després del sigil no acaba en espai.
        val found = suggestions("#Feina/Client ")
        assertEquals(1, found.size)
        assertEquals("Feina/Client Salt", found[0].label)
    }
}
