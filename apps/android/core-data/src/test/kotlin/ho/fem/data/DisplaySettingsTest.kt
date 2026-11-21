package ho.fem.data

import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Rule
import org.junit.rules.TemporaryFolder
import kotlin.test.Test
import kotlin.test.assertEquals

class DisplaySettingsTest {
    @get:Rule val folder = TemporaryFolder()

    @Test
    fun `els temes nous conserven la base i l'accent desats abans d'actualitzar`() = runBlocking {
        val job = Job()
        val store = PreferenceDataStoreFactory.create(scope = CoroutineScope(Dispatchers.IO + job)) {
            folder.root.resolve("femho.preferences_pb")
        }
        try {
            val settings = Settings(store)
            assertEquals(DisplaySettings(), settings.display.first())
            store.edit {
                it[stringPreferencesKey("theme")] = "dark"
                it[stringPreferencesKey("accent")] = "mono-warm"
            }
            assertEquals("dark", settings.display.first().selection)
            settings.selectDisplay("high-contrast")
            assertEquals(DisplaySettings("dark", "mono-warm", "high-contrast"), settings.display.first())
            settings.selectDisplay("eink")
            assertEquals(DisplaySettings("dark", "mono-warm", "eink"), Settings(store).display.first())
            settings.selectDisplay("light")
            assertEquals(DisplaySettings("light", "mono-warm"), settings.display.first())
        } finally {
            job.cancelAndJoin()
        }
    }
}
