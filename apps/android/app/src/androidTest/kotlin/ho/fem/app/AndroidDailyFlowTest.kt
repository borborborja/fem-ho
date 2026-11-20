package ho.fem.app

import android.app.LocaleManager
import android.app.NotificationManager
import android.content.Context
import android.net.ConnectivityManager
import android.os.ParcelFileDescriptor
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isEnabled
import androidx.compose.ui.test.isFocused
import androidx.compose.ui.test.isOn
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performScrollToIndex
import androidx.compose.ui.test.performTextReplacement
import androidx.lifecycle.Lifecycle
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ho.fem.model.ActivityNotificationKind
import java.net.HttpURLConnection
import java.net.URL
import java.time.LocalDate
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
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
        val control = argument("controlUrl")
        val email = argument("email")
        val password = argument("password")
        val task = argument("taskId")
        val scope = argument("scopeId")
        val date = argument("today")
        val token = request(
            control, "/api/v1/auth/login", "POST",
            JSONObject().put("email", email).put("password", password),
            readTimeoutMillis = 15_000,
        ).getString("access_token")

        tag("server-input").performTextReplacement(base)
        tag("server-check").performClick()
        signIn(email, password, language = "en")
        compose.onAllNodes(
            hasAnyAncestor(hasTestTag("primary-view-tabs")) and hasClickAction(),
            useUnmergedTree = true,
        ).assertCountEquals(2)
        verifyCompletedTasks(control, scope, token)
        tag("board-task-$task").performClick()
        tag("task-deadline").assertTextContains(date, substring = true)
        tag("task-close").performClick()
        verifyProjectFilter(task, scope)
        verifyOfflineSessionRestore(base, task)

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

            // El canal de prova per adb segueix disponible en mode avió. La segona sessió
            // canvia el camp amb la versió antiga ja desada a la cua del dispositiu.
            request(
                control, "/api/v1/tasks/$task", "PATCH",
                JSONObject().put("title", "Remote title"), token,
            )
        } finally {
            setOffline(false)
        }

        // WorkManager pot reintentar amb 30 s d'espera mentre es recupera la connexió.
        tag("sync-issues", timeoutMillis = 65_000).performClick()
        tag("sync-keep-server").performClick()
        tag("board-list-inbox").performScrollToIndex(0)
        waitForText("Remote title")
        waitForServer(base, scope, token)

        tag("open-settings").performClick()
        tag("settings-tab-mcp").performScrollTo().performClick()
        tag("mcp-channel-mcp", enabled = true).performScrollTo().performClick()
        val oauthGrantId = argument("oauthGrantId")
        val restrictGrant = tag("mcp-edit-$oauthGrantId", enabled = true)
        tag("mcp-channel-mcp").assertIsOn()
        restrictGrant.performScrollTo().performClick()
        tag("mcp-choose-operation-tasks:move").performScrollTo().performClick()
        tag("mcp-save-token").performScrollTo().performClick()
        compose.waitUntil(15_000) {
            grants(base, token).any {
                it.getString("id") == oauthGrantId &&
                    it.getJSONArray("capabilities").length() == 1 &&
                    it.getJSONArray("capabilities").getString(0) == "tasks:read"
            }
        }
        tag("mcp-new-token", enabled = true).performScrollTo().performClick()
        tag("mcp-token-name").performScrollTo().performTextReplacement("Android smoke token")
        tag("mcp-choose-scope-$scope").performScrollTo().performClick()
        tag("mcp-save-token").performScrollTo().performClick()
        tag("mcp-created-token")
        val created = grants(base, token).single { it.getString("name") == "Android smoke token" }
        val tokenId = created.getString("id")
        tag("mcp-revoke-$tokenId", enabled = true).performScrollTo().performClick()
        tag("mcp-confirm-revoke").performClick()
        compose.waitUntil(15_000) {
            grants(base, token).any {
                it.getString("id") == tokenId && !it.isNull("revoked_at")
            }
        }

        verifyActivityNotifications(control, scope, token)
        tag("settings-tab-general").performScrollTo().performClick()
        tag("settings-logout").performScrollTo().performClick()
        signIn(argument("otherEmail"), password, language = "es")
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

    private fun verifyCompletedTasks(base: String, scope: String, token: String) {
        val current = "board-task-${argument("doneTodayId")}"
        val previous = "board-task-${argument("doneYesterdayId")}"
        val doneTab = "board-column-done"
        val clear = "board-done-clear"
        val showAll = "board-done-show-all"
        val settingsPath = "/api/v1/auth/settings"

        tag(doneTab).performClick()
        waitForDoneCount(12)
        tag(current)
        compose.onNodeWithTag(previous).assertDoesNotExist()

        tag("board-done-calendar").performClick()
        val yesterday = argument("yesterday")
        val today = LocalDate.parse(argument("today"))
        val tomorrow = today.plusDays(1)
        tag("board-done-calendar-next").assertIsNotEnabled()
        if (tomorrow.month == today.month) tag("calendar-date-$tomorrow").assertIsNotEnabled()
        if (LocalDate.parse(yesterday).month != today.month) {
            tag("board-done-calendar-previous").performClick()
        }
        tag("calendar-date-$yesterday").performClick()
        waitForDoneCount(50)
        tag(previous)
        compose.onNodeWithTag(current).assertDoesNotExist()
        compose.onNodeWithTag(clear).assertDoesNotExist()
        compose.onNodeWithTag(showAll).assertDoesNotExist()
        tag("board-done-back-today").performClick()
        waitForDoneCount(12)

        tag(clear, enabled = true).performClick()
        waitForDoneCount(0)
        tag(showAll, enabled = true)
        val cutoff = request(base, settingsPath, token = token).getJSONObject("settings")
        check(!cutoff.isNull("done_cleared_at"))

        val completed = try {
            setOffline(true)
            compose.activityRule.scenario.onActivity { it.viewModelStore.clear() }
            compose.activityRule.scenario.recreate()
            tag(doneTab).performClick()
            waitForDoneCount(0)
            tag(showAll)
            request(
                base, "/api/v1/tasks", "POST",
                JSONObject().put("scope_id", scope).put("title", "Completed after clear").put("status", "done"), token,
            )
        } finally {
            setOffline(false)
        }
        waitForDoneCount(1, timeoutMillis = 65_000)
        tag("board-task-${completed.getString("id")}")
        compose.onNodeWithTag(current).assertDoesNotExist()

        tag(showAll, enabled = true).performClick()
        waitForDoneCount(13)
        val restored = request(base, settingsPath, token = token).getJSONObject("settings")
        check(restored.has("done_cleared_at") && restored.isNull("done_cleared_at"))

        compose.activityRule.scenario.moveToState(Lifecycle.State.CREATED)
        request(
            base, settingsPath, "PATCH",
            JSONObject().put("done_cleared_at", completed.getString("completed_at")), token,
        )
        compose.activityRule.scenario.moveToState(Lifecycle.State.RESUMED)
        waitForDoneCount(0)
        tag(showAll, enabled = true).performClick()
        waitForDoneCount(13)
        tag("board-column-inbox").performClick()
    }

    private fun waitForDoneCount(count: Int, timeoutMillis: Long = 25_000) {
        val countInTab = hasText(count.toString()) and hasAnyAncestor(hasTestTag("board-column-done"))
        compose.waitUntil(timeoutMillis) {
            compose.onAllNodes(countInTab, useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty()
        }
    }

    private fun verifyActivityNotifications(base: String, scope: String, sessionToken: String) {
        val manager = target.getSystemService(NotificationManager::class.java)
        val container = (target.applicationContext as FemhoApplication).container
        val account = requireNotNull(container.account())
        val deviceId = ActivityNotifications.deviceId(target, account)
        val api = container.api(account)
        val automation = InstrumentationRegistry.getInstrumentation().uiAutomation
        ParcelFileDescriptor.AutoCloseInputStream(
            automation.executeShellCommand("pm grant ${target.packageName} android.permission.POST_NOTIFICATIONS"),
        ).use { it.readBytes() }

        tag("settings-tab-notifications").performScrollTo().performClick()
        val inboxToggle = "notifications-$scope-inbox_entry"
        val createdToggle = "notifications-$scope-task_created"
        tag(inboxToggle).performScrollTo().assertIsOff()
        tag("notifications-device-toggle", enabled = true).performScrollTo().performClick()
        tag(createdToggle, enabled = true).performScrollTo().performClick()
        tag(createdToggle, enabled = true).assertIsOn()
        tag(inboxToggle).assertIsOff()
        assertEquals(
            ActivityNotificationKind.entries.map(ActivityNotifications::channel).toSet(),
            manager.notificationChannels.map { it.id }.filter { it.startsWith("external_") }.toSet(),
        )

        request(base, "/api/v1/external-access", "PATCH", JSONObject().put("api_enabled", true), sessionToken)
        val pat = request(base, "/api/v1/tokens", "POST", JSONObject()
            .put("name", "Notification smoke client")
            .put("capabilities", org.json.JSONArray(listOf("tasks:create")))
            .put("channels", org.json.JSONArray(listOf("api")))
            .put("scope_ids", org.json.JSONArray(listOf(scope))), sessionToken).getString("token")
        fun create(status: String, title: String) = request(base, "/api/v1/tasks", "POST", JSONObject()
            .put("scope_id", scope).put("status", status).put("title", title), pat).getString("id")

        val expected = create("todo", "Task from external API")
        create("inbox", "Inbox alerts are off")
        val item = runBlocking { api.pendingActivityNotifications(deviceId).single() }
        assertEquals(expected, item.taskId)
        runBlocking { ActivityNotifications.sync(container, account) }
        val notification = manager.activeNotifications.single { it.tag == item.id }
        assertEquals(ActivityNotifications.channel(ActivityNotificationKind.TASK_CREATED), notification.notification.channelId)
        assertEquals(0, notification.notification.actions?.size ?: 0)
        assertEquals(emptyList<Any>(), runBlocking { api.pendingActivityNotifications(deviceId) })

        var launchIntent: android.content.Intent? = null
        compose.activityRule.scenario.onActivity { launchIntent = it.intent }
        try {
            notification.notification.contentIntent.send()
            tag("task-title").assertTextContains("Task from external API")
        } finally {
            // La notificació empra un URI propi i ActivityScenario encara espera el del llançador.
            compose.activityRule.scenario.onActivity { it.intent = launchIntent }
        }
        manager.cancel(notification.tag, notification.id)
        check(ActivityNotifications.display(container, account, item))
        assertEquals(0, manager.activeNotifications.count { it.tag == item.id })
        tag("task-close").performClick()
        tag("open-settings").performClick()
    }

    private fun signIn(email: String, password: String, language: String) {
        tag("login-email").performTextReplacement(email)
        tag("login-password").performTextReplacement(password)
        tag("login-submit").performScrollTo().performClick()
        awaitLocale(language)
        tag("board-column-inbox")
    }

    private fun verifyOfflineSessionRestore(base: String, task: String) {
        val settings = (target.applicationContext as FemhoApplication).container.settings
        runBlocking { settings.setServerUrl("https://other-instance.invalid") }
        try {
            setOffline(true)
            // Una recreació normal conserva el ViewModel. El buidem per tornar a llegir la sessió.
            compose.activityRule.scenario.onActivity { it.viewModelStore.clear() }
            compose.activityRule.scenario.recreate()
            tag("board-task-$task")
            assertEquals(base, runBlocking { settings.serverUrl.first() })
        } finally {
            setOffline(false)
        }
    }

    private fun verifyProjectFilter(task: String, personalScope: String) {
        val first = "project-${argument("firstProjectId")}"
        val second = "project-${argument("secondProjectId")}"
        val team = "project-${argument("teamProjectId")}"
        val allPersonal = "projects-all-$personalScope"
        val allTeam = "projects-all-${argument("teamScopeId")}"

        tag("projects-toggle").performClick()
        tag(allPersonal).performScrollTo().assertIsOn()
        tag(second).performScrollTo().performClick()
        waitForProjectSelection(second)
        dismissProjectMenu()
        waitForText("Projects (1)")
        compose.onNodeWithTag("board-task-$task").assertDoesNotExist()

        tag("projects-toggle").performClick()
        tag(first).performScrollTo().performClick()
        tag(team).performScrollTo().performClick()
        waitForProjectSelection(first)
        waitForProjectSelection(second)
        waitForProjectSelection(team)
        dismissProjectMenu()
        waitForText("Projects (3)")
        tag("board-task-$task")

        tag("scope-chip-$personalScope").performClick()
        waitForText("Projects (2)")
        tag("scope-chip-$personalScope").performClick()
        waitForText("Projects (3)")
        compose.activityRule.scenario.recreate()
        waitForText("Projects (3)")

        tag("projects-toggle").performClick()
        tag(allPersonal).performScrollTo().performClick()
        waitForProjectSelection(allPersonal)
        waitForProjectSelection(team)
        tag(allTeam).performScrollTo().performClick()
        waitForProjectSelection(allTeam)
        dismissProjectMenu()
        waitForText("Projects")
    }

    private fun waitForProjectSelection(tag: String) = compose.waitUntil(15_000) {
        compose.onAllNodes(hasTestTag(tag) and isOn(), useUnmergedTree = true)
            .fetchSemanticsNodes().isNotEmpty()
    }

    private fun dismissProjectMenu() {
        val automation = InstrumentationRegistry.getInstrumentation().uiAutomation
        ParcelFileDescriptor.AutoCloseInputStream(automation.executeShellCommand("input keyevent KEYCODE_BACK"))
            .use { it.readBytes() }
        compose.waitUntil(15_000) {
            compose.onAllNodes(hasTestTag("projects-menu"), useUnmergedTree = true)
                .fetchSemanticsNodes().isEmpty()
        }
    }

    private fun argument(key: String): String = requireNotNull(args.getString(key)) { key }

    private fun awaitLocale(language: String) {
        val manager = target.getSystemService(LocaleManager::class.java)
        compose.waitUntil(15_000) {
            if (manager.applicationLocales[0]?.toLanguageTag() != language) return@waitUntil false
            // El perfil pot canviar l'idioma abans que la nova Activity tingui finestra.
            var ready = false
            compose.activityRule.scenario.onActivity { activity ->
                ready = activity.resources.configuration.locales[0]?.toLanguageTag() == language &&
                    activity.hasWindowFocus()
            }
            ready
        }
    }

    private fun tag(
        name: String,
        enabled: Boolean = false,
        timeoutMillis: Long = 25_000,
    ): SemanticsNodeInteraction {
        val tagged = hasTestTag(name)
        val matcher = if (enabled) tagged and isEnabled() else tagged
        compose.waitUntil(timeoutMillis) {
            compose.onAllNodes(matcher, useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty()
        }
        return compose.onNode(matcher, useUnmergedTree = true)
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
        readTimeoutMillis: Int = 3_000,
    ): JSONObject {
        val connection = URL(base + path).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = method
            connection.connectTimeout = 3_000
        connection.readTimeout = readTimeoutMillis
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
