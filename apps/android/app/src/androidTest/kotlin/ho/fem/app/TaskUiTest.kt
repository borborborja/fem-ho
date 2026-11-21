package ho.fem.app

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
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
import androidx.compose.ui.test.assertContentDescriptionEquals
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.click
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToIndex
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeLeft
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import ho.fem.designsystem.CardAddForm
import ho.fem.designsystem.CardList
import ho.fem.designsystem.CardListItem
import ho.fem.designsystem.FemhoTheme
import ho.fem.designsystem.SubtaskRowActions
import ho.fem.designsystem.SubtaskRowLabels
import ho.fem.designsystem.TaskCard
import ho.fem.model.AiMode
import ho.fem.model.DoneDayFilter
import ho.fem.model.McpActivity
import ho.fem.model.McpCreation
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
import ho.fem.tasks.CardAiAction
import ho.fem.tasks.CardExtras
import ho.fem.tasks.McpProvenanceLabels
import ho.fem.tasks.QuickAddField
import ho.fem.tasks.TaskMenuLabels
import java.time.LocalDate
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
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
    private val today = LocalDate.parse("2026-03-29")
    private val profileZone = ZoneId.of("Europe/Madrid")
    private val boardDay = DoneDayFilter(profileZone, today, today, null)
    private val taskMenuLabels = TaskMenuLabels(
        openActions = "Accions de la tasca",
        edit = "Edita",
        move = "Mou a…",
        delete = "Esborra",
        deleteConfirm = "Vols esborrar «{title}»?",
        cancel = "Cancel·la",
    )

    @Test
    fun subtaskTitleLongPressEditsOnlyTheSubtaskAndMenuConfirmsDelete() {
        val title = mutableStateOf("Neteja")
        var toggles = 0
        var opens = 0
        var deletes = 0
        val labels = SubtaskRowLabels("Accions subtasca", "Edita subtasca", "Esborra subtasca",
            "Vols esborrar «{title}»?", "Títol", "Desa", "Cancel·la", "Error")
        compose.setContent {
            FemhoTheme {
                TaskCard(
                    title = "Tasca mare",
                    onOpen = { opens++ },
                    listsExpanded = true,
                    lists = listOf(CardList("subtasks", null, items = listOf(
                        CardListItem("item", title.value, false, "Completa", { toggles++ },
                            SubtaskRowActions(labels, { newTitle, finished -> title.value = newTitle; finished(true) }, { deletes++ })),
                    ))),
                )
            }
        }
        compose.onNodeWithTag("subtask-title", useUnmergedTree = true).performTouchInput { longClick() }
        compose.onNodeWithTag("subtask-editor").assertTextContains("Neteja").performTextReplacement("Prepara")
        compose.onNodeWithText("Desa").performClick()
        compose.onNodeWithTag("subtask-title", useUnmergedTree = true).assertTextContains("Prepara")
        compose.onNodeWithTag("subtask-actions").performClick()
        compose.onNodeWithText("Esborra subtasca").performClick()
        compose.onNodeWithText("Vols esborrar «Prepara»?").assertIsDisplayed()
        compose.onNodeWithText("Cancel·la").performClick()
        compose.runOnIdle {
            assertEquals(0, toggles)
            assertEquals(0, opens)
            assertEquals(0, deletes)
        }
    }

    @Test
    fun collapsingListsHidesTheOpenFormAndRestoresItsDraft() {
        val expanded = mutableStateOf(true)
        val draft = mutableStateOf("")
        compose.setContent {
            FemhoTheme {
                TaskCard(
                    title = "Tasca mare",
                    listsToggleLabel = "Llistes (1)",
                    listsExpanded = expanded.value,
                    onToggleLists = { expanded.value = !expanded.value },
                    addForm = CardAddForm(true, {}, "Afegeix", "Nova subtasca", draft.value, { draft.value = it }, {}),
                )
            }
        }
        compose.onNodeWithTag("card-add-item").performTextInput("Esborrany")
        compose.onNodeWithTag("card-lists-toggle").performClick()
        compose.onNodeWithTag("card-add-item").assertDoesNotExist()
        compose.onNodeWithTag("card-lists-toggle").performClick()
        compose.onNodeWithTag("card-add-item").assertTextContains("Esborrany")
    }

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
                    doneDay = boardDay,
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
    fun mcpBadgeOpensProvenanceWithoutOpeningTheTask() {
        val provenance = mutableStateOf(McpActivity(origin = "Revisor", creation = McpCreation()))
        val touched = Task(id = "mcp-task", scopeId = "work", title = "Tasca MCP", position = "a1")
        val ordinary = Task(id = "other-task", scopeId = "work", title = "Tasca manual", position = "a2")
        val mcpLabels = McpProvenanceLabels(
            badge = "MCP",
            details = "Origen MCP",
            creation = "Creada per MCP",
            lastChange = "Últim canvi per MCP",
            unspecified = "Automatització sense nom",
        )
        var openedTask = false
        compose.setContent {
            FemhoTheme {
                BoardScreen(
                    tasks = listOf(touched.copy(mcpActivity = provenance.value), ordinary),
                    doneDay = boardDay,
                    labels = boardLabels,
                    mcpLabels = mcpLabels,
                    onOpen = { openedTask = true },
                    onMove = { _, _ -> },
                    onToggle = {},
                )
            }
        }
        compose.onAllNodesWithTag("task-mcp-badge").assertCountEquals(1)
        compose.onNodeWithText(mcpLabels.badge).assertDoesNotExist()
        compose.onNodeWithTag("task-mcp-badge").assertContentDescriptionEquals(mcpLabels.details)
            .performTouchInput { click() }
        compose.onNodeWithTag("task-mcp-details").assertIsDisplayed()
        compose.onNodeWithText(mcpLabels.creation).assertIsDisplayed()
        compose.onNodeWithText(mcpLabels.lastChange).assertIsDisplayed()
        compose.onNodeWithText(mcpLabels.unspecified).assertIsDisplayed()
        compose.onNodeWithText("Revisor").assertIsDisplayed()
        compose.runOnIdle {
            assertFalse(openedTask)
            provenance.value = McpActivity(origin = "Revisor", creation = McpCreation("Revisor"))
        }
        compose.onNodeWithText(mcpLabels.creation).assertIsDisplayed()
        compose.onNodeWithText(mcpLabels.lastChange).assertDoesNotExist()
    }

    @Test
    fun boardShowsFixedPreviewAndKeepsTabsReadableAtLargerFont() {
        val width = mutableStateOf(320.dp)
        val tasks = TaskStatus.entries.mapIndexed { index, status ->
            Task(
                id = "task-$index", scopeId = "work", title = "Tasca $index", position = "$index", status = status,
                completedAt = if (status == TaskStatus.DONE) "2026-03-29T10:00:00Z" else null,
            )
        }
        compose.setContent {
            FemhoTheme {
                CompositionLocalProvider(LocalDensity provides Density(LocalDensity.current.density, fontScale = 1.4f)) {
                    BoardScreen(
                        tasks = tasks,
                        doneDay = boardDay,
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

    @Test
    fun pomodoroHeaderKeepsTitleOnOneLineAtLargerFont() {
        compose.setContent {
            FemhoTheme {
                CompositionLocalProvider(LocalDensity provides Density(LocalDensity.current.density, fontScale = 1.4f)) {
                    Box(Modifier.requiredWidth(320.dp).padding(horizontal = 16.dp)) {
                        PomodoroHeader("Pomodoro", "Back", "Settings", onBack = {}, onSettings = {})
                    }
                }
            }
        }
        for (text in listOf("Pomodoro", "Settings")) {
            val layouts = mutableListOf<TextLayoutResult>()
            compose.onNodeWithText(text, useUnmergedTree = true)
                .assertIsDisplayed()
                .performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(layouts) }
            val layout = layouts.single()
            assertEquals(text, 1, layout.lineCount)
            assertFalse(text, layout.isLineEllipsized(0))
            val lineWidth = layout.getLineRight(0) - layout.getLineLeft(0)
            assertTrue("$text width at 320dp and 140% font size: $lineWidth in ${layout.size}", lineWidth <= layout.size.width + 1)
        }
    }

    @Test
    fun doneTabCountsTheSameTasksItShowsInTheProfileDay() {
        fun completed(id: String, at: String?) = Task(
            id = id, scopeId = "work", title = id, position = id, status = TaskStatus.DONE, completedAt = at,
        )
        val first = completed("first", "2026-03-29T00:00:00+01:00")
        val after = completed("after", "2026-03-29T00:00:01Z")
        val previous = completed("previous", "2026-03-28T22:59:59Z")
        val tasks = listOf(
            first, after, previous,
            completed("future", "2026-03-29T22:00:00Z"),
            completed("missing", null),
            after.copy(id = "ai", aiMode = AiMode.ASSISTED),
            first.copy(id = "todo", status = TaskStatus.TODO, completedAt = null),
        )
        val day = mutableStateOf(today)
        val clearedAt = mutableStateOf<String?>("2026-03-29T01:00:00+01:00")
        compose.setContent {
            FemhoTheme {
                BoardScreen(
                    tasks = tasks,
                    doneDay = DoneDayFilter(profileZone, today, day.value, clearedAt.value),
                    labels = boardLabels,
                    onOpen = {},
                    onMove = { _, _ -> },
                    onToggle = {},
                )
            }
        }
        val tab = compose.onNodeWithTag("board-column-done")
        tab.performClick().assertTextContains("1")
        compose.onNodeWithTag("board-task-after").assertIsDisplayed()
        compose.onNodeWithTag("board-task-first").assertDoesNotExist()

        compose.runOnIdle { day.value = today.minusDays(1) }
        tab.assertTextContains("1")
        compose.onNodeWithTag("board-task-previous").assertIsDisplayed()
        compose.onNodeWithTag("board-task-after").assertDoesNotExist()

        compose.runOnIdle {
            day.value = today
            clearedAt.value = null
        }
        tab.assertTextContains("2")
        compose.onNodeWithTag("board-task-first").assertIsDisplayed()
        compose.onNodeWithTag("board-task-after").assertIsDisplayed()
        compose.onNodeWithTag("board-task-previous").assertDoesNotExist()
    }

    @Test
    fun taskActionsKeepCardTapAndChildControlsAndConfirmDeletion() {
        val task = Task(id = "task", scopeId = "work", title = "Revisar pressupost", position = "a0")
        val calls = mutableListOf<String>()
        compose.setContent {
            FemhoTheme {
                BoardScreen(
                    tasks = listOf(task),
                    doneDay = boardDay,
                    labels = boardLabels,
                    onOpen = { calls += "open:${it.id}" },
                    onMove = { moved, status -> calls += "move:${moved.id}:$status" },
                    onToggle = {},
                    extras = {
                        CardExtras(
                            onEdit = { calls += "edit-icon" },
                            editLabel = "Edita la tasca",
                            lists = emptyList(),
                            expanded = false,
                            toggleLabel = null,
                            onToggleLists = {},
                            addForm = CardAddForm(false, {}, "Afegeix", "", "", {}, {}),
                        )
                    },
                    taskMenuLabels = taskMenuLabels,
                    onDelete = { calls += "delete:${it.id}" },
                )
            }
        }

        val title = compose.onNodeWithText(task.title, useUnmergedTree = true)
        val card = compose.onNodeWithText(task.title)
        val menu = compose.onNodeWithTag("board-task-actions")
        title.performTouchInput { click() }
        compose.onNodeWithTag("card-edit").performTouchInput { click() }
        compose.onNodeWithTag("card-advance").performTouchInput { click() }
        menu.assertDoesNotExist()
        compose.runOnIdle { assertEquals(listOf("open:task", "edit-icon", "move:task:TODO"), calls) }

        title.performTouchInput { longClick() }
        menu.assertIsDisplayed()
        compose.onNodeWithTag("board-task-edit").performClick()
        menu.assertDoesNotExist()
        compose.runOnIdle { assertEquals(listOf("open:task", "edit-icon", "move:task:TODO", "open:task"), calls) }

        assertEquals(taskMenuLabels.openActions, card.fetchSemanticsNode().config[SemanticsActions.OnLongClick].label)
        card.performSemanticsAction(SemanticsActions.OnLongClick)
        compose.onNodeWithTag("board-task-delete").performClick()
        compose.onNodeWithText("Vols esborrar «Revisar pressupost»?").assertIsDisplayed()
        compose.onNodeWithTag("board-task-delete-cancel").performClick()
        compose.runOnIdle { assertFalse(calls.any { it.startsWith("delete:") }) }

        // La tecla Tab surt del mode tàctil abans de demanar el focus de la targeta.
        title.performTouchInput { longClick() }
        menu.assertIsDisplayed()
        compose.onNodeWithTag("board-task-delete").performClick()
        compose.onNodeWithTag("board-task-delete-confirm").performClick()
        compose.runOnIdle { assertEquals(listOf("delete:task"), calls.filter { it.startsWith("delete:") }) }
    }

    @Test
    fun taskActionsCopyContextOnlyForEnabledScopes() {
        val enabledTask = Task(id = "work-task", scopeId = "work", title = "Revisar pressupost", position = "a0")
        val disabledTask = Task(id = "personal-task", scopeId = "personal", title = "Preparar motxilla", position = "a1")
        val copied = mutableListOf<String>()
        val primary = mutableListOf<String>()
        val moved = mutableListOf<Pair<String, TaskStatus>>()
        compose.setContent {
            FemhoTheme {
                BoardScreen(
                    tasks = listOf(enabledTask, disabledTask),
                    doneDay = boardDay,
                    labels = boardLabels,
                    onOpen = {},
                    onMove = { task, destination -> moved += task.id to destination },
                    onToggle = {},
                    taskMenuLabels = taskMenuLabels.copy(copyContext = "Copia el context"),
                    canCopyContext = { it.scopeId == enabledTask.scopeId },
                    onCopyContext = { copied += it.id },
                    aiAction = { task ->
                        if (task.scopeId == enabledTask.scopeId) {
                            CardAiAction("IA", "Envia a la IA", "Copia el context", true,
                                onClick = { primary += task.id }, onCopy = { copied += task.id })
                        } else null
                    },
                )
            }
        }

        val copy = compose.onNodeWithTag("board-task-copy-context")
        compose.onNodeWithText(disabledTask.title).performTouchInput { longClick() }
        copy.assertDoesNotExist()
        compose.onNodeWithTag("board-task-edit").performClick()

        compose.onNodeWithText(enabledTask.title).performTouchInput { longClick() }
        copy.assertIsDisplayed().performClick()
        compose.onNodeWithTag("board-task-actions").assertDoesNotExist()
        compose.onAllNodesWithTag("board-task-ai").assertCountEquals(1)
        val card = hasAnyAncestor(hasTestTag("board-task-${enabledTask.id}"))
        val rail = compose.onNode(hasTestTag("card-rail") and card, useUnmergedTree = true)
        val advance = compose.onNode(hasTestTag("card-advance") and card, useUnmergedTree = true)
        val action = compose.onNodeWithTag("board-task-ai")
        assertEquals(rail.getUnclippedBoundsInRoot().bottom, action.getUnclippedBoundsInRoot().bottom)
        assertTrue(action.getUnclippedBoundsInRoot().top >= advance.getUnclippedBoundsInRoot().bottom)
        action.performTouchInput { click() }
        action.performTouchInput { longClick() }
        compose.runOnIdle { assertTrue(moved.isEmpty()) }
        advance.performTouchInput { click() }
        compose.runOnIdle {
            assertEquals(listOf(enabledTask.id, enabledTask.id), copied)
            assertEquals(listOf(enabledTask.id), primary)
            assertEquals(listOf(enabledTask.id to TaskStatus.TODO), moved)
        }
    }

    @Test
    fun taskMoveMenuUsesCanonicalStatusesAndChecksTheLatestLock() {
        val taskTitle = "Preparar reunió"
        val task = Task(id = "task", scopeId = "work", title = taskTitle, position = "a0")
        val tasks = mutableStateOf(listOf(task))
        val moved = mutableListOf<TaskStatus>()
        val locked = mutableListOf<String>()
        compose.setContent {
            FemhoTheme {
                BoardScreen(
                    tasks = tasks.value,
                    doneDay = boardDay,
                    labels = boardLabels,
                    onOpen = {},
                    onMove = { _, destination -> moved += destination },
                    onToggle = {},
                    onLocked = { locked += it.id },
                    taskMenuLabels = taskMenuLabels,
                )
            }
        }

        val card = compose.onNodeWithText(task.title)
        val move = compose.onNodeWithTag("board-task-move")
        val dialog = compose.onNodeWithTag("board-task-move-dialog")
        card.performSemanticsAction(SemanticsActions.OnLongClick)
        move.performClick()
        compose.onNodeWithTag("board-task-move-inbox").assertIsSelected().assertIsNotEnabled()
        compose.onNodeWithTag("board-task-move-todo").assertIsDisplayed()
        compose.onNodeWithTag("board-task-move-doing").assertIsDisplayed()
        compose.onNodeWithTag("board-task-move-done").assertIsDisplayed()
        compose.onNodeWithTag("board-task-move-cancel").performClick()
        dialog.assertDoesNotExist()
        compose.runOnIdle { assertEquals(emptyList<TaskStatus>(), moved) }

        card.performSemanticsAction(SemanticsActions.OnLongClick)
        move.performClick()
        compose.onNodeWithTag("board-task-move-doing").performClick()
        dialog.assertDoesNotExist()
        compose.runOnIdle { assertEquals(listOf(TaskStatus.DOING), moved) }

        card.performSemanticsAction(SemanticsActions.OnLongClick)
        move.performClick()
        compose.runOnIdle { tasks.value = listOf(task.copy(lockedUntil = "9999-12-31T23:59:59Z")) }
        compose.onNodeWithTag("board-task-move-done").performClick()
        dialog.assertDoesNotExist()
        compose.runOnIdle {
            assertEquals(listOf(TaskStatus.DOING), moved)
            assertEquals(listOf(task.id), locked)
        }
    }
}
