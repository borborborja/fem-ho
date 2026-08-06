package ho.fem.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * El camp de servidor (docs/03 §2).
 *
 * "Sense esquema, **es prova primer `https://`**. Si falla i l'amfitrió és d'una xarxa
 * privada, s'ofereix `http://` amb un avís clar, **mai en silenci**."
 */
class ServerUrlTest {

    @Test
    fun `accepta les tres formes que diu docs 03 §2`() {
        assertEquals(listOf("https://femho.example.com"), serverCandidates("femho.example.com").candidates)
        assertEquals(
            listOf("https://femho.example.com"),
            serverCandidates("https://femho.example.com").candidates,
        )
        assertEquals(
            listOf("https://example.com/femho"),
            serverCandidates("https://example.com/femho").candidates,
        )
    }

    @Test
    fun `AQUESTA és la que compta - https primer, sempre`() {
        val result = serverCandidates("casa.local")
        assertEquals("https://casa.local", result.candidates.first())
    }

    @Test
    fun `a internet NO s'ofereix http`() {
        val result = serverCandidates("femho.example.com")

        // Caure a `http` sense avisar en una adreça pública és enviar la contrasenya en
        // clar. Aquí ni s'ofereix.
        assertEquals(1, result.candidates.size)
        assertFalse(result.hasInsecure)
    }

    @Test
    fun `a la xarxa de casa sí, però amb avís i el segon`() {
        for (host in listOf("casa.local", "192.168.1.50", "10.0.0.5", "172.16.3.4", "localhost")) {
            val result = serverCandidates(host)
            assertEquals("https://$host", result.candidates[0], "$host · el segur va primer")
            assertEquals("http://$host", result.candidates[1], "$host · l'insegur va després")
            assertTrue(result.hasInsecure, "$host · s'ha de poder avisar")
        }
    }

    @Test
    fun `172 fora del rang privat NO és casa`() {
        // El rang és 172.16 a 172.31. Fora d'aquí és internet, i s'ha vist més d'un cop
        // implementat com a "tot el 172".
        assertFalse(isPrivateHost("172.15.0.1"))
        assertFalse(isPrivateHost("172.32.0.1"))
        assertTrue(isPrivateHost("172.16.0.1"))
        assertTrue(isPrivateHost("172.31.255.255"))
    }

    @Test
    fun `un http escrit expressament es respecta, però es marca`() {
        val result = serverCandidates("http://femho.example.com")
        assertEquals(listOf("http://femho.example.com"), result.candidates)
        // Qui l'escriu sap què fa, però se li avisa igual.
        assertTrue(result.hasInsecure)
    }

    @Test
    fun `un esquema que no serveix es rebutja amb un motiu`() {
        for (input in listOf("ftp://servidor", "file:///etc/passwd", "gopher://x")) {
            val result = serverCandidates(input)
            assertTrue(result.candidates.isEmpty())
            assertNotNull(result.error)
        }
    }

    @Test
    fun `el camp buit es queixa`() {
        assertNotNull(serverCandidates("   ").error)
    }

    @Test
    fun `la barra final no fa dos URL diferents`() {
        assertEquals(
            serverCandidates("femho.example.com").candidates,
            serverCandidates("femho.example.com/").candidates,
        )
    }

    @Test
    fun `un port o unes credencials no confonen l'amfitrió`() {
        assertTrue(serverCandidates("192.168.1.50:8080").hasInsecure)
        assertFalse(serverCandidates("example.com:8443").hasInsecure)
    }

    @Test
    fun `una IPv6 entre claudàtors es llegeix bé`() {
        assertTrue(isPrivateHost("[fd00::1]"))
        assertTrue(serverCandidates("[::1]:8080").hasInsecure)
    }
}

/** La comprovació de versió de docs/03 §11. */
class VersionCheckTest {

    @Test
    fun `avisa quan el servidor és més nou`() {
        assertTrue(serverIsNewer(appVersion = "1.2.0", serverVersion = "1.3.0"))
        assertFalse(serverIsNewer(appVersion = "1.3.0", serverVersion = "1.2.0"))
        assertFalse(serverIsNewer(appVersion = "1.3.0", serverVersion = "1.3.0"))
    }

    @Test
    fun `compara números i no text`() {
        // "1.10.0" és més gran que "1.9.0", encara que com a text sigui al revés. És
        // l'error clàssic i el que faria que l'app no avisés mai a partir de la desena.
        assertTrue(serverIsNewer("1.9.0", "1.10.0"))
        assertEquals(1, compareVersions("1.10.0", "1.9.0"))
    }

    @Test
    fun `una versió amb sufix és anterior a la neta`() {
        assertTrue(serverIsNewer("2.0.0-rc1", "2.0.0"))
        assertFalse(serverIsNewer("2.0.0", "2.0.0-rc1"))
    }
}
