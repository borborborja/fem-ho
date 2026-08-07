package ho.fem.model

import java.time.LocalDate
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * La mateixa taula que `packages/contracts/src/dates.test.ts`.
 *
 * El primer dia de la setmana és **una línia que si divergeix desplaça el calendari un
 * dia i no dona cap error**. Per això la taula està escrita als dos costats i provada
 * als dos, amb els mateixos casos.
 */
class DatesParityTest {
    @Test
    fun `dilluns en catala i castella, diumenge en angles`() {
        assertEquals(Dates.MONDAY, Dates.weekStart("ca"))
        assertEquals(Dates.MONDAY, Dates.weekStart("es"))
        assertEquals(Dates.SUNDAY, Dates.weekStart("en"))
    }

    @Test
    fun `la tria de la persona mana per damunt de l'idioma`() {
        assertEquals(Dates.SUNDAY, Dates.resolveWeekStart("sunday", "ca"))
        assertEquals(Dates.MONDAY, Dates.resolveWeekStart("monday", "en"))
        assertEquals(Dates.SUNDAY, Dates.resolveWeekStart("auto", "en"))
        assertEquals(Dates.MONDAY, Dates.resolveWeekStart(null, "ca"))
    }

    @Test
    fun `l'1 d'agost de 2026 cau on toca a cada graella`() {
        val dissabte = LocalDate.of(2026, 8, 1)
        // Els mateixos números que la prova de TypeScript.
        assertEquals(5, Dates.weekIndex(dissabte, Dates.MONDAY))
        assertEquals(6, Dates.weekIndex(dissabte, Dates.SUNDAY))
    }

    @Test
    fun `els noms surten del CLDR, com a la web`() {
        assertEquals("dl", Dates.weekdayNames("ca", Dates.MONDAY)[0])
        assertEquals("agost", Dates.monthName("ca", 8))
        assertEquals("agosto", Dates.monthName("es", 8))
        assertEquals("August", Dates.monthName("en", 8))
        assertTrue(Dates.weekdayNames("ca", Dates.MONDAY).none { it.endsWith(".") })
    }

    /**
     * El nom sencer del dia, per als widgets.
     *
     * Es comprova que **no** és el curt: el defecte que això arregla era una capçalera
     * que deia "dv" a la pantalla d'inici, que no vol dir res per a qui la mira.
     */
    @Test
    fun `el nom del dia es sencer i en minuscula`() {
        val divendres = LocalDate.of(2026, 8, 7)
        assertEquals("divendres", Dates.dayName("ca", divendres))
        assertEquals("friday", Dates.dayName("en", divendres))
        assertEquals("viernes", Dates.dayName("es", divendres))
    }
}
