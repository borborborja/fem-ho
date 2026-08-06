package ho.fem.model

import java.time.DayOfWeek
import java.time.LocalDate
import java.time.format.TextStyle
import java.util.Locale

/**
 * El que del calendari depèn de l'idioma, i el que no.
 *
 * **Port de `packages/contracts/src/dates.ts`**, i ho ha de continuar sent. Els noms
 * dels mesos i dels dies els dona el CLDR, que és el mateix que fa servir `Intl` a la
 * web, o sigui que les dues apps diuen el mateix sense escriure-ho dues vegades.
 *
 * El primer dia de la setmana, en canvi, **és una taula escrita** i no surt de
 * `WeekFields.of(locale)`: el valor ha de ser idèntic als dos clients, i si cadascú
 * l'endevinés pel seu compte el calendari es desplaçaria un dia sense donar cap error.
 * La taula és la mateixa que la de TypeScript i les proves de tots dos costats la fixen.
 */
object Dates {
    /** Diumenge és 0, com `Date#getDay()` de la web. */
    const val SUNDAY = 0
    const val MONDAY = 1

    private val WEEK_STARTS = mapOf("ca" to MONDAY, "en" to SUNDAY, "es" to MONDAY)

    fun weekStart(locale: String): Int = WEEK_STARTS[locale] ?: MONDAY

    /** `auto` segueix l'idioma; `monday` i `sunday` manen per damunt. */
    fun resolveWeekStart(choice: String?, locale: String): Int = when (choice) {
        "monday" -> MONDAY
        "sunday" -> SUNDAY
        else -> weekStart(locale)
    }

    /** L'índex d'un dia dins de la setmana, comptant des del primer dia que toqui. */
    fun weekIndex(date: LocalDate, weekStart: Int): Int =
        (date.dayOfWeek.value % 7 - weekStart + 7) % 7

    /**
     * Els noms curts dels dies, començant pel primer que toqui.
     *
     * En minúscula i sense el punt final que hi posa el CLDR català: la capçalera d'una
     * columna de dues lletres no porta puntuació.
     */
    fun weekdayNames(locale: String, weekStart: Int): List<String> {
        val l = Locale.forLanguageTag(locale)
        return (0 until 7).map { index ->
            // `DayOfWeek.SUNDAY.value` és 7; el mòdul el torna a 0 per fer-lo coincidir
            // amb el `getDay()` de la web.
            val day = DayOfWeek.of(((weekStart + index + 6) % 7) + 1)
            day.getDisplayName(TextStyle.SHORT, l).removeSuffix(".").lowercase(l)
        }
    }

    /**
     * El nom d'un mes, per a la capçalera del calendari.
     *
     * `FULL_STANDALONE` i no `FULL`: en català, `FULL` dona la forma que va dins d'una
     * data —"d'agost", amb la preposició enganxada— i la capçalera d'un mes la vol
     * sola. En castellà i en anglès són iguals i no es nota; en català sí.
     */
    fun monthName(locale: String, month: Int): String =
        java.time.Month.of(month)
            .getDisplayName(TextStyle.FULL_STANDALONE, Locale.forLanguageTag(locale))
}
