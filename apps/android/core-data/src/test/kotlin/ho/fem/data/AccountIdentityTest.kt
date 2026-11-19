package ho.fem.data

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotEquals

class AccountIdentityTest {
    @Test
    fun `el compte i el servidor s’aïllen independentment del token usat`() {
        val owner = AccountIdentity("https://Home.Example:443/femho/", "alice")
        assertEquals(owner.key, AccountIdentity("https://home.example/femho", "alice").key)
        assertNotEquals(owner.key, AccountIdentity("https://home.example/femho", "bob").key)
        assertNotEquals(owner.key, AccountIdentity("https://home.example/other", "alice").key)
        assertNotEquals(owner.key, AccountIdentity("http://home.example/femho", "alice").key)
        assertNotEquals(owner.key, AccountIdentity("https://other.example/femho", "alice").key)
    }

    @Test
    fun `les adreces de sessió no poden incloure credencials ni destinacions ambigües`() {
        for (url in listOf("https://me@home.example", "https://home.example?server=b", "file:///test")) {
            assertFailsWith<IllegalArgumentException> { normalizeServerUrl(url) }
        }
    }
}
