package ho.fem.model

import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * La bústia amb fonts, tal com arriba del servidor.
 *
 * **El que aquestes proves fixen és la compatibilitat cap enrere**, que a Android no és
 * teòrica: l'app s'actualitza sola des de la botiga i el servidor l'actualitza qui té la
 * casa, o sigui que una app nova contra un servidor vell és el cas **normal** i no una
 * raresa. Un camp sense valor per defecte fa petar la deserialització sencera, i el que
 * es veu és una pantalla en blanc sense cap error que digui per què.
 */
class InboxEventsTest {
    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun `una bustia d'un servidor vell, sense fonts, es llegeix igual`() {
        val vell = """{"date":"2026-08-11","dated":[],"overdue":[],"undated":[]}"""
        val inbox = json.decodeFromString<Inbox>(vell)
        assertEquals("2026-08-11", inbox.date)
        assertTrue(inbox.events.isEmpty())
    }

    @Test
    fun `i una amb fonts porta el que cal per dibuixar-les i actuar-hi`() {
        val nou = """
            {"date":"2026-08-11","dated":[],"overdue":[],"undated":[],
             "events":[{"calendar_id":"c1","scope_id":"s1","uid":"u1","recurrence_id":null,
                        "summary":"Dentista","location":null,
                        "starts_at":"2026-08-11T09:00:00.000Z","ends_at":"2026-08-11T10:00:00.000Z",
                        "all_day":false,"source_kind":"ical",
                        "calendar_name":"Escola","calendar_color":"--plou-pink"}]}
        """.trimIndent()
        val inbox = json.decodeFromString<Inbox>(nou)
        val event = inbox.events.single()
        assertEquals("Dentista", event.summary)
        assertEquals("Escola", event.calendarName)
        assertEquals("ical", event.sourceKind)
    }

    @Test
    fun `la clau d'una cita es la identitat externa, no cap id de fila`() {
        /**
         * És la decisió que sosté tota la funció: el refresc d'una font reescriu les
         * files i les pot tornar a la vida, o sigui que l'`id` no és estable. La clau ha
         * de sortir de `calendar_id` + `uid` + `recurrence_id`, que és el que l'origen
         * promet.
         */
        val serie = InboxEvent(
            calendarId = "c1",
            scopeId = "s1",
            uid = "u1",
            summary = "Reunió",
            startsAt = "2026-08-11T09:00:00.000Z",
            endsAt = "2026-08-11T10:00:00.000Z",
        )
        val ocurrencia = serie.copy(recurrenceId = "2026-08-18T09:00:00.000Z")

        assertEquals("c1|u1|", serie.key)
        assertTrue(serie.key != ocurrencia.key)
    }

    @Test
    fun `una ocurrencia d'un servidor vell es dona per visible i no per amagada`() {
        /**
         * Sense el camp, el defecte és `true`. Davant d'un servidor que no sap res de la
         * bústia, val més ensenyar-ho tot que amagar-ho tot: el segon cas seria un
         * calendari que es buida sol i ningú entendria per què.
         */
        val vell = """
            {"event_id":"e1","uid":"u1","summary":"Sopar",
             "starts_at":"2026-08-11T20:00:00.000Z","ends_at":"2026-08-11T22:00:00.000Z",
             "scope_id":"s1"}
        """.trimIndent()
        assertTrue(json.decodeFromString<EventOccurrence>(vell).inInbox)
    }

    @Test
    fun `i el marcatge torna la resolucio sencera, no nomes el que s'ha desat`() {
        val resposta = """{"visible":false,"in_inbox":false}"""
        val mark = json.decodeFromString<InboxMark>(resposta)
        assertEquals(false, mark.visible)
        assertEquals(false, mark.inInbox)
    }
}
