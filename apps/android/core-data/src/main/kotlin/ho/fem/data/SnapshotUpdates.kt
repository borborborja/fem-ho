package ho.fem.data

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update

/** Una composició viva necessita una nova lectura encara que no es torni a crear. */
class SnapshotUpdates {
    private val revision = MutableStateFlow(0L)

    fun invalidate() { revision.update { it + 1 } }

    fun <T> observe(read: suspend () -> T): Flow<T> = revision.map { read() }
}
