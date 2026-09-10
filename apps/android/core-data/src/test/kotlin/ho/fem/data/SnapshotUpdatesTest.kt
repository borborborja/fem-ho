package ho.fem.data

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals

@OptIn(ExperimentalCoroutinesApi::class)
class SnapshotUpdatesTest {
    @Test
    fun `una composició viva rellegeix el moviment i es buida en tancar sessió`() = runTest {
        val updates = SnapshotUpdates()
        var tasks: List<String>? = listOf("inbox")
        val frames = mutableListOf<List<String>?>()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) {
            updates.observe { tasks }.toList(frames)
        }
        tasks = listOf("todo")
        updates.invalidate()
        tasks = null
        updates.invalidate()
        assertEquals(listOf(listOf("inbox"), listOf("todo"), null), frames)
    }

    @Test
    fun `les instàncies reben el refresc i una de nova llegeix l’estat actual`() = runTest {
        val updates = SnapshotUpdates()
        var count = 1
        val first = mutableListOf<Int>()
        val second = mutableListOf<Int>()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { updates.observe { count }.toList(first) }
        count = 2
        updates.invalidate()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { updates.observe { count }.toList(second) }
        count = 3
        updates.invalidate()
        assertEquals(listOf(1, 2, 3), first)
        assertEquals(listOf(2, 3), second)
    }
}
