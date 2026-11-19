package ho.fem.app

import android.content.Intent
import androidx.test.ext.junit.runners.AndroidJUnit4
import ho.fem.model.TaskStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class RoutingTest {
    @Test
    fun restoresValidDestinationsAndBackHistoryAcrossRemovedScreens() {
        val restored = Route.restoreStack("BOARD/CALENDAR/REGISTRE/SETTINGS/ESTADISTIQUES")

        assertEquals("BOARD/CALENDAR/SETTINGS", restored)
        assertEquals(Screen.SETTINGS, Route.currentScreen(restored))
        assertEquals(Screen.CALENDAR, Route.currentScreen(restored.substringBeforeLast('/')))
    }

    @Test
    fun restoresBoardWhenTheSavedDestinationsAreUnavailable() {
        val restored = Route.restoreStack("BOARD/REGISTRE/ESTADISTIQUES/UNKNOWN")

        assertEquals("BOARD", restored)
        assertEquals(Screen.BOARD, Route.currentScreen(restored))
    }

    @Test
    fun oldReportIntentsOpenBoardWithTheirOtherArguments() {
        for (name in listOf("registre", "estadistiques")) {
            val intent = Intent()
                .putExtra(Route.EXTRA_SCREEN, name)
                .putExtra(Route.EXTRA_TASK, "task-id")
                .putExtra(Route.EXTRA_STATUS, TaskStatus.TODO.name)
                .putExtra(Route.EXTRA_QUICK_ADD, true)
                .putExtra(Route.EXTRA_DRAFT, "draft")

            assertEquals(Screen.BOARD, Route.screenOf(intent))
            assertEquals("task-id", Route.taskOf(intent))
            assertEquals(TaskStatus.TODO, Route.statusOf(intent))
            assertTrue(Route.quickAddOf(intent))
            assertEquals("draft", Route.draftOf(intent))
        }
    }
}
