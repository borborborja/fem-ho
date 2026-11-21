package ho.fem.app.widget

import android.appwidget.AppWidgetManager
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import androidx.glance.appwidget.updateAll
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import ho.fem.data.ActiveAccount
import ho.fem.data.Container
import ho.fem.data.SnapshotUpdates
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.time.Instant
import java.util.concurrent.TimeUnit

private const val BOUNDARY_SESSION = "session"
private const val BOUNDARY_AT = "at"

private data class CalendarBoundary(val session: String, val at: Long) {
    val workName: String get() = "femho-widget-calendar-$session-$at"
}

/**
 * Repintar el que hi hagi col·locat a la pantalla d'inici.
 *
 * Els descriptors diuen `updatePeriodMillis="0"` i la xarxa penja del `SyncWorker`
 * de quinze minuts. El botó demana una execució puntual del mateix treball. El rellotge
 * local només repinta en els límits que fan canviar les propostes del calendari.
 *
 * Es crida també just després d'escriure des d'un widget: allà ja som al procés i la
 * feina és local, i ningú ha d'esperar quinze minuts per veure el que acaba de fer.
 *
 * `updateAll` **no falla si no hi ha cap instància col·locada**: no cal preguntar-ho.
 */
object FemhoWidgets {
    internal val snapshots = SnapshotUpdates()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val clockLock = Mutex()
    private val deliveryLock = Mutex()
    private var scheduled: CalendarBoundary? = null
    private var delivered: CalendarBoundary? = null
    private var clockJob: Job? = null

    internal fun arePlaced(context: Context): Boolean =
        areTaskWidgetsPlaced(context) || isPlaced(context, TodayWidgetReceiver::class.java)

    internal fun areTaskWidgetsPlaced(context: Context): Boolean =
        isPlaced(context, TaskBoardWidgetReceiver::class.java) || isPlaced(context, BoardWidgetReceiver::class.java)

    private fun isPlaced(context: Context, provider: Class<*>): Boolean = AppWidgetManager.getInstance(context)
        .getAppWidgetIds(ComponentName(context, provider)).isNotEmpty()

    internal suspend fun scheduleSuggestionUpdate(context: Context, account: ActiveAccount?, at: Instant?) = clockLock.withLock {
        val app = context.applicationContext
        if (Container.get(app).account() != account) return@withLock
        val next = if (account != null && at != null) CalendarBoundary(account.generation, at.toEpochMilli()) else null
        val now = System.currentTimeMillis()
        if (next == scheduled || next != null && next == delivered && next.at <= now) return@withLock
        if (next == delivered) delivered = null

        clockJob?.cancel()
        val manager = WorkManager.getInstance(app)
        scheduled?.let { manager.cancelUniqueWork(it.workName) }
        scheduled = next
        if (next == null) return@withLock

        // Els ginys comparteixen instantània, així que un sol despertador cobreix cada canvi.
        // El retard dins del procés és precís mentre és viu. WorkManager el recupera si el sistema el tanca.
        val delayMs = (next.at - now).coerceAtLeast(0)
        manager.enqueueUniqueWork(next.workName, ExistingWorkPolicy.REPLACE,
            OneTimeWorkRequestBuilder<WidgetCalendarClockWorker>()
                .setInitialDelay(delayMs, TimeUnit.MILLISECONDS)
                .setInputData(workDataOf(BOUNDARY_SESSION to next.session, BOUNDARY_AT to next.at))
                .build())
        clockJob = scope.launch {
            delay(delayMs)
            runCatching { updateAtBoundary(app, next.session, next.at) }
                .onFailure { if (it is CancellationException) throw it }
        }
    }

    internal suspend fun updateAtBoundary(context: Context, session: String, at: Long) = deliveryLock.withLock {
        val boundary = CalendarBoundary(session, at)
        val update = clockLock.withLock clock@{
            if (Container.get(context).account()?.generation != session || !areTaskWidgetsPlaced(context)) return@clock false
            if (boundary == delivered || scheduled?.let { it != boundary } == true) return@clock false
            scheduled = null
            clockJob = null
            true
        }
        if (update) {
            updateSuggestionWidgets(context)
            clockLock.withLock { delivered = boundary.takeIf { at <= System.currentTimeMillis() } }
        }
    }

    internal fun onTimeChanged(context: Context, finish: () -> Unit) {
        scope.launch {
            try {
                if (!areTaskWidgetsPlaced(context)) return@launch
                deliveryLock.withLock {
                    clockLock.withLock {
                        // Un retard calculat abans del canvi ja no correspon a l'hora de la cita.
                        clockJob?.cancel()
                        scheduled?.let { WorkManager.getInstance(context).cancelUniqueWork(it.workName) }
                        scheduled = null
                        delivered = null
                    }
                    updateSuggestionWidgets(context)
                }
            } catch (error: Exception) {
                if (error is CancellationException) throw error
            } finally {
                finish()
            }
        }
    }

    private suspend fun updateSuggestionWidgets(context: Context) {
        snapshots.invalidate()
        TaskBoardWidget().updateAll(context)
        BoardWidget().updateAll(context)
    }

    suspend fun updateAll(context: Context) {
        // updateAll no reinicia provideGlance si la composició segueix viva.
        snapshots.invalidate()
        TaskBoardWidget().updateAll(context)
        BoardWidget().updateAll(context)
        TodayWidget().updateAll(context)
    }
}

class WidgetTimeChangedReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_TIME_CHANGED) return
        FemhoWidgets.onTimeChanged(context.applicationContext, goAsync()::finish)
    }
}

class WidgetCalendarClockWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val session = inputData.getString(BOUNDARY_SESSION) ?: return Result.success()
        val at = inputData.getLong(BOUNDARY_AT, 0)
        return try {
            if (at > 0) FemhoWidgets.updateAtBoundary(applicationContext, session, at)
            Result.success()
        } catch (error: Exception) {
            if (error is CancellationException) throw error
            Result.retry()
        }
    }
}
