package ho.fem.app

import androidx.compose.foundation.layout.requiredWidth
import androidx.compose.material3.Text
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToIndex
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeLeft
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import ho.fem.designsystem.FemhoTheme
import ho.fem.model.AiMode
import ho.fem.model.QuickAddContext
import ho.fem.model.QuickAddPerson
import ho.fem.model.QuickAddProject
import ho.fem.model.QuickAddResult
import ho.fem.model.QuickAddScope
import ho.fem.model.QuickAddTaskType
import ho.fem.model.Task
import ho.fem.model.TaskStatus
import ho.fem.tasks.BoardLabels
import ho.fem.tasks.BoardScreen
import ho.fem.tasks.QuickAddField
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class TaskUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val context = QuickAddContext(
        scopes = listOf(QuickAddScope("work", "Feina", listOf(QuickAddProject("client", "Client")))),
        people = listOf(QuickAddPerson("alba", "Alba")),
        activeScopeIds = listOf("work"),
        taskTypes = listOf(QuickAddTaskType("content", "Contingut", "work")),
    )
    private val columnTitles = mapOf(
        TaskStatus.INBOX to "Inbox",
        TaskStatus.TODO to "Por hacer",
        TaskStatus.DOING to "Haciendo",
        TaskStatus.DONE to "Hecho",
    )
    private val boardLabels = BoardLabels(
        columns = columnTitles,
        empty = columnTitles.mapValues { "Sin tareas" },
        advance = columnTitles,
        toggle = "Complete",
        lock = "Agent",
        attention = "Atenció",
        claim = "Reclama",
    )

    @Test
    fun captureKeepsAllParsedValuesAndClearsOnlyAfterPersisting() {
        var request: QuickAddResult? = null
        var acknowledge: ((Boolean) -> Unit)? = null
        val draft = "#Feina/Client Enviar proposta @Alba \$Contingut !ia:ajuda"
        compose.setContent {
            FemhoTheme {
                QuickAddField(
                    context = context,
                    placeholder = "Nova tasca",
                    scopeRequiredLabel = { it },
                    aiModeLabel = { it },
                    addLabel = "Afegeix",
                    creationError = "Torna-ho a provar",
                    onCreate = { result, saved ->
                        request = result
                        acknowledge = saved
                    },
                )
            }
        }
        compose.onNodeWithTag("quick-add").performTextInput(draft)
        compose.onNodeWithTag("quick-add-submit").performClick()
        compose.runOnIdle {
            val result = checkNotNull(request)
            assertEquals("Enviar proposta", result.title)
            assertEquals("work", result.scopeId)
            assertEquals("client", result.projectId)
            assertEquals(listOf("alba"), result.assigneeIds)
            assertEquals("content", result.taskTypeId)
            assertEquals(AiMode.ASSISTED, result.aiMode)
            checkNotNull(acknowledge)(false)
        }
        compose.onNodeWithTag("quick-add-error").assertIsDisplayed()
        compose.onNodeWithTag("quick-add").assertTextContains(draft)

        compose.onNodeWithTag("quick-add-submit").performClick()
        compose.runOnIdle { checkNotNull(acknowledge)(true) }
        val field = compose.onNodeWithTag("quick-add").fetchSemanticsNode()
        assertEquals("", field.config[SemanticsProperties.EditableText].text)
    }

    @Test
    fun captureDraftSurvivesSavedStateRestoration() {
        val restoration = StateRestorationTester(compose)
        restoration.setContent {
            FemhoTheme {
                QuickAddField(
                    context = context,
                    placeholder = "Nova tasca",
                    scopeRequiredLabel = { it },
                    aiModeLabel = { it },
                    addLabel = "Afegeix",
                    creationError = "Torna-ho a provar",
                    onCreate = { _, _ -> error("Unexpected capture") },
                )
            }
        }
        compose.onNodeWithTag("quick-add").performTextInput("Esborrany")
        restoration.emulateSavedInstanceStateRestore()
        compose.onNodeWithTag("quick-add").assertTextContains("Esborrany")
    }

    @Test
    fun captureRemainsAccessibleWhenScrollingALongColumn() {
        val tasks = List(60) { index ->
            Task(id = "task-$index", scopeId = "work", title = "Tasca $index", position = "$index")
        }
        compose.setContent {
            FemhoTheme {
                BoardScreen(
                    tasks = tasks,
                    labels = boardLabels,
                    onOpen = {},
                    onMove = { _, _ -> },
                    onToggle = {},
                    footer = {
                        Text("Nova tasca", modifier = Modifier.testTag("capture-${it.name.lowercase()}"))
                    },
                )
            }
        }
        compose.onNodeWithTag("board-column-inbox").assertIsSelected().assertTextContains("60")
        compose.onNodeWithTag("board-list-inbox").performScrollToIndex(45)
        compose.onNodeWithTag("capture-inbox").assertIsDisplayed()
        compose.onNodeWithTag("board-column-todo").performClick().assertIsSelected()
        compose.onNodeWithTag("capture-todo").assertIsDisplayed()
    }

    @Test
    fun boardShowsFixedPreviewAndKeepsTabsReadableAtLargerFont() {
        val width = mutableStateOf(320.dp)
        val tasks = TaskStatus.entries.mapIndexed { index, status ->
            Task(id = "task-$index", scopeId = "work", title = "Tasca $index", position = "$index", status = status)
        }
        compose.setContent {
            FemhoTheme {
                CompositionLocalProvider(LocalDensity provides Density(LocalDensity.current.density, fontScale = 1.4f)) {
                    BoardScreen(
                        tasks = tasks,
                        labels = boardLabels,
                        onOpen = {},
                        onMove = { _, _ -> },
                        onToggle = {},
                        modifier = Modifier.requiredWidth(width.value),
                    )
                }
            }
        }

        for (widthDp in listOf(320, 360, 412)) {
            compose.runOnIdle { width.value = widthDp.dp }
            val pager = compose.onNodeWithTag("board-pager").getUnclippedBoundsInRoot()
            val adjacent = compose.onNodeWithTag("board-page-todo", useUnmergedTree = true)
                .getUnclippedBoundsInRoot()
            assertEquals(32f, (pager.right - adjacent.left).value, 1f)

            for ((status, title) in columnTitles) {
                compose.onNodeWithTag("board-column-${status.name.lowercase()}")
                    .assertIsDisplayed()
                    .assertTextContains("1")
                val layouts = mutableListOf<TextLayoutResult>()
                compose.onNodeWithText(title, useUnmergedTree = true)
                    .performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(layouts) }
                val layout = layouts.single()
                assertFalse(
                    "$title at ${widthDp}dp and 140% font size: ${layout.size}, " +
                        "text ${layout.multiParagraph.width} × ${layout.multiParagraph.height}, " +
                        "constraints ${layout.layoutInput.constraints}",
                    layout.hasVisualOverflow,
                )
            }
        }

        compose.onNodeWithTag("board-pager").performTouchInput {
            swipeLeft(startX = this.width * 0.80f, endX = this.width * 0.15f, durationMillis = 350)
        }
        compose.onNodeWithTag("board-column-todo").assertIsSelected()
    }
}
