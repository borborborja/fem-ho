package ho.fem.data

import androidx.datastore.preferences.core.PreferenceDataStoreFactory
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
import kotlin.test.assertNull

class DoneSettingsTest {
    @get:Rule val folder = TemporaryFolder()

    @Test
    fun cacheIsSharedAcrossSessionsOnlyForTheSameAccountAndServer() = runBlocking {
        val identity = AccountIdentity("https://fem-ho.example", "user-a")
        val account = ActiveAccount(identity, "first-login")
        val nextSession = ActiveAccount(identity, "second-login")
        val otherUser = ActiveAccount(identity.copy(userId = "user-b"), "first-login")
        val otherServer = ActiveAccount(identity.copy(serverUrl = "https://other.example"), "first-login")
        val cutoff = "2026-11-20T11:30:00Z"
        val job = Job()
        val store = PreferenceDataStoreFactory.create(scope = CoroutineScope(Dispatchers.IO + job)) {
            folder.root.resolve("femho.preferences_pb")
        }
        val settings = Settings(store)
        try {
            assertNull(settings.doneClearedAt(account).first())
            settings.cacheDoneClearedAt(account, cutoff)
            assertEquals(cutoff, settings.doneClearedAt(nextSession).first())
            assertNull(settings.doneClearedAt(otherUser).first())
            assertNull(settings.doneClearedAt(otherServer).first())

            settings.cacheDoneClearedAt(nextSession, null)
            assertNull(settings.doneClearedAt(account).first())
        } finally {
            job.cancelAndJoin()
        }
    }
}
