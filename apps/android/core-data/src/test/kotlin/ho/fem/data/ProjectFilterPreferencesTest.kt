package ho.fem.data

import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.junit.Rule
import org.junit.rules.TemporaryFolder
import kotlin.test.Test
import kotlin.test.assertEquals

class ProjectFilterPreferencesTest {
    @get:Rule val folder = TemporaryFolder()

    private val identity = AccountIdentity("https://fem-ho.example", "user-a")
    private val account = ActiveAccount(identity, "first-login")

    @Test
    fun overlappingTogglesKeepEachSelection() = withSettings { settings ->
        assertEquals(emptyList(), settings.activeProjects(account).first())

        val ids = List(16) { "project-$it" }
        coroutineScope {
            ids.forEach { id ->
                launch(start = CoroutineStart.UNDISPATCHED) { settings.toggleActiveProject(account, id) }
            }
        }
        assertEquals(ids.toSet(), settings.activeProjects(account).first().toSet())

        coroutineScope {
            repeat(2) {
                launch(start = CoroutineStart.UNDISPATCHED) { settings.toggleActiveProject(account, ids.first()) }
            }
        }
        assertEquals(ids.toSet(), settings.activeProjects(account).first().toSet())
    }

    @Test
    fun clearingOneScopeRetainsOtherScopesAndAccounts() = withSettings { settings ->
        val otherUser = ActiveAccount(identity.copy(userId = "user-b"), "first-login")
        val otherServer = ActiveAccount(identity.copy(serverUrl = "https://other.example"), "first-login")
        for (session in listOf(account, otherUser, otherServer)) {
            settings.toggleActiveProject(session, "scope-a-project-1")
            settings.toggleActiveProject(session, "scope-a-project-2")
        }
        settings.toggleActiveProject(account, "scope-b-project-1")

        coroutineScope {
            launch(start = CoroutineStart.UNDISPATCHED) {
                settings.clearActiveProjects(account, setOf("scope-a-project-1", "scope-a-project-2"))
            }
            launch(start = CoroutineStart.UNDISPATCHED) {
                settings.toggleActiveProject(account, "scope-b-project-2")
            }
        }

        val newSession = ActiveAccount(identity, "second-login")
        assertEquals(listOf("scope-b-project-1", "scope-b-project-2"), settings.activeProjects(newSession).first())
        val unchanged = listOf("scope-a-project-1", "scope-a-project-2")
        assertEquals(unchanged, settings.activeProjects(otherUser).first())
        assertEquals(unchanged, settings.activeProjects(otherServer).first())
    }

    private fun withSettings(block: suspend (Settings) -> Unit) = runBlocking {
        val job = Job()
        val store = PreferenceDataStoreFactory.create(scope = CoroutineScope(Dispatchers.IO + job)) {
            folder.root.resolve("femho.preferences_pb")
        }
        try {
            block(Settings(store))
        } finally {
            job.cancelAndJoin()
        }
    }
}
