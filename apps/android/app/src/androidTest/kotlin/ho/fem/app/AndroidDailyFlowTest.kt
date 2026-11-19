package ho.fem.app

import android.app.LocaleManager
import android.content.Context
import android.net.ConnectivityManager
import android.os.ParcelFileDescriptor
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.isFocused
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performScrollToIndex
import androidx.compose.ui.test.performTextReplacement
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.net.HttpURLConnection
import java.net.URL
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AndroidDailyFlowTest {
    @get:Rule
    val compose = createAndroidComposeRule<MainActivity>()

    private val args = InstrumentationRegistry.getArguments()
    private val target = InstrumentationRegistry.getInstrumentation().targetContext

    @Test
    fun offlineEditsRecoverAndDailySurfacesShareTheAccount() {
        val server = args.getString("serverUrl")
        assumeTrue("Pass the isolated server fixture to run this test", server != null)
        val base = requireNotNull(server)
        val email = argument("email")
        val password = argument("password")
        val task = argument("taskId")
        val scope = argument("scopeId")
        val date = argument("today")
        val token = request(
            base, "/api/v1/auth/login", "POST",
            JSONObject().put("email", email).put("password", password),
        ).getString("access_token")

        tag("server-input").performTextReplacement(base)
        tag("server-check").performClick()
        signIn(email, password)
        awaitLocale("en")
        tag("board-task-$task").performClick()
        tag("task-deadline").assertTextContains(date, substring = true)
        tag("task-close").performClick()

        tag("view-calendar").performClick()
        tag("calendar-date-$date").performClick()
        tag("calendar-mode-day").performClick()
        waitForText("Android fixture task")
        waitForText("Team calendar fixture task")
        tag("scope-chip-$scope").performClick()
        compose.waitUntil(15_000) {
            compose.onAllNodesWithText("Team calendar fixture task").fetchSemanticsNodes().isEmpty()
        }
        tag("calendar-next").performClick()
        tag("calendar-today").performClick()
        tag("view-board").performClick()

        // La segona sessió canvia el mateix camp abans que el dispositiu enviï la seva còpia.
        request(
            base, "/api/v1/tasks/$task", "PATCH",
            JSONObject().put("title", "Remote title"), token,
        )
        try {
            setOffline(true)
            tag("board-task-$task").performClick()
            tag("task-title").performTextReplacement("Offline title")
            compose.activityRule.scenario.recreate()
            tag("task-title").assertTextContains("Offline title")
            tag("task-save").performClick()
            tag("pending-count")
            waitForText("Offline title")

            val inbox = hasAnyAncestor(hasTestTag("quick-add-inbox"))
            val capture = compose.onNode(hasTestTag("quick-add") and inbox, useUnmergedTree = true)
            capture.performTextReplacement("Independent offline task")
            compose.onNode(hasTestTag("quick-add-submit") and inbox, useUnmergedTree = true)
                .performClick()
            compose.waitUntil(15_000) {
                capture.fetchSemanticsNode().config[SemanticsProperties.EditableText].text.isEmpty()
            }
            tag("board-list-inbox").performScrollToIndex(1)
            waitForText("Independent offline task")
        } finally {
            setOffline(false)
        }

        tag("sync-issues").performClick()
        tag("sync-keep-server").performClick()
        tag("board-list-inbox").performScrollToIndex(0)
        waitForText("Remote title")
        waitForServer(base, scope, token)

        tag("open-settings").performClick()
        tag("settings-tab-mcp").performScrollTo().performClick()
        tag("mcp-channel-mcp").performScrollTo().performClick()
        val oauthGrantId = argument("oauthGrantId")
        tag("mcp-edit-$oauthGrantId").performScrollTo().performClick()
        tag("mcp-choose-operation-tasks:move").performScrollTo().performClick()
        tag("mcp-save-token").performScrollTo().performClick()
        compose.waitUntil(15_000) {
            grants(base, token).any {
                it.getString("id") == oauthGrantId &&
                    it.getJSONArray("capabilities").length() == 1 &&
                    it.getJSONArray("capabilities").getString(0) == "tasks:read"
            }
        }
        tag("mcp-new-token").performScrollTo().performClick()
        tag("mcp-token-name").performScrollTo().performTextReplacement("Android smoke token")
        tag("mcp-choose-scope-$scope").performScrollTo().performClick()
        tag("mcp-save-token").performScrollTo().performClick()
        tag("mcp-created-token")
        val created = grants(base, token).single { it.getString("name") == "Android smoke token" }
        val tokenId = created.getString("id")
        tag("mcp-revoke-$tokenId").performScrollTo().performClick()
        tag("mcp-confirm-revoke").performClick()
        compose.waitUntil(15_000) {
            grants(base, token).any {
                it.getString("id") == tokenId && !it.isNull("revoked_at")
            }
        }

        tag("settings-tab-general").performScrollTo().performClick()
        tag("settings-logout").performScrollTo().performClick()
        signIn(argument("otherEmail"), password)
        awaitLocale("es")
        waitForText("Secondary account fixture")
        compose.onNodeWithTag("board-task-$task").assertDoesNotExist()
        compose.activityRule.scenario.onActivity { activity ->
            val launchIntent = activity.intent
            InstrumentationRegistry.getInstrumentation().callActivityOnNewIntent(
                activity, Route.intentTo(quickAdd = true),
            )
            // ActivityScenario fa servir l'intent inicial per detectar la destrucció.
            activity.intent = launchIntent
        }
        val focusedInbox = hasTestTag("quick-add") and hasAnyAncestor(hasTestTag("quick-add-inbox")) and isFocused()
        compose.waitUntil(15_000) {
            compose.onAllNodes(focusedInbox, useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty()
        }
    }

    private fun signIn(email: String, password: String) {
        tag("login-email").performTextReplacement(email)
        tag("login-password").performTextReplacement(password)
        tag("login-submit").performScrollTo().performClick()
        tag("board-column-inbox")
    }

    private fun argument(key: String): String = requireNotNull(args.getString(key)) { key }

    private fun awaitLocale(language: String) {
        val manager = target.getSystemService(LocaleManager::class.java)
        compose.waitUntil(15_000) { manager.applicationLocales[0]?.language == language }
    }

    private fun tag(name: String) =
        compose.onNodeWithTag(name, useUnmergedTree = true).also {
            compose.waitUntil(25_000) {
                compose.onAllNodesWithTag(name, useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty()
            }
        }

    private fun waitForText(text: String) = compose.waitUntil(25_000) {
        compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty()
    }

    private fun setOffline(offline: Boolean) {
        val automation = InstrumentationRegistry.getInstrumentation().uiAutomation
        val state = if (offline) "enable" else "disable"
        ParcelFileDescriptor.AutoCloseInputStream(
            automation.executeShellCommand("cmd connectivity airplane-mode $state"),
        ).use { it.readBytes() }
        val connectivity = target.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        compose.waitUntil(15_000) { (connectivity.activeNetwork == null) == offline }
    }

    private fun waitForServer(base: String, scope: String, token: String) {
        compose.waitUntil(25_000) {
            val tasks = request(base, "/api/v1/tasks?scope_id=$scope", token = token).getJSONArray("data")
            (0 until tasks.length()).map(tasks::getJSONObject).any {
                it.getString("title") == "Independent offline task"
            }
        }
        val tasks = request(base, "/api/v1/tasks?scope_id=$scope", token = token).getJSONArray("data")
        assertEquals(
            1,
            (0 until tasks.length()).map(tasks::getJSONObject).count {
                it.getString("title") == "Independent offline task"
            },
        )
    }

    private fun grants(base: String, token: String): List<JSONObject> {
        val grants = request(base, "/api/v1/tokens", token = token).getJSONArray("data")
        return (0 until grants.length()).map(grants::getJSONObject)
    }

    private fun request(
        base: String,
        path: String,
        method: String = "GET",
        body: JSONObject? = null,
        token: String? = null,
    ): JSONObject {
        val connection = URL(base + path).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = method
            connection.connectTimeout = 3_000
            connection.readTimeout = 3_000
            if (token != null) connection.setRequestProperty("Authorization", "Bearer $token")
            if (body != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                connection.outputStream.use { it.write(body.toString().toByteArray()) }
            }
            check(connection.responseCode in 200..299) {
                "HTTP ${connection.responseCode} for $method $path"
            }
            return connection.inputStream.bufferedReader().use { JSONObject(it.readText()) }
        } finally {
            connection.disconnect()
        }
    }
}
