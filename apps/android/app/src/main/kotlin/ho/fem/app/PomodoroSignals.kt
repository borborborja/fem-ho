package ho.fem.app

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.media.AudioManager
import android.media.ToneGenerator
import android.net.Uri
import android.os.Build
import android.os.SystemClock
import androidx.core.app.NotificationCompat
import ho.fem.data.ActiveAccount
import ho.fem.data.Container
import ho.fem.data.LocalPomodoro
import ho.fem.model.PomodoroPhase
import ho.fem.model.PomodoroStatus
import ho.fem.model.PomodoroTimer
import ho.fem.model.projectPomodoroTimer
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeoutOrNull

private const val CHANNEL = "pomodoro"
private const val ALARM_REQUEST = 0
private const val MAX_LATE_MS = 60_000

internal fun pomodoroPhaseName(phase: PomodoroPhase): Int = when (phase) {
    PomodoroPhase.FOCUS -> R.string.pomodoro_focus
    PomodoroPhase.SHORT_BREAK -> R.string.pomodoro_shortbreak
    PomodoroPhase.LONG_BREAK -> R.string.pomodoro_longbreak
}

internal fun AlarmManager.canUseExactPomodoroAlarm(): Boolean =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.S || canScheduleExactAlarms()

/** El senyal només pertoca al dispositiu que ha iniciat o reprès aquesta versió. */
internal class PomodoroSignals(private val context: Context, private val container: Container) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val lock = Mutex()
    private val alarms = context.getSystemService(AlarmManager::class.java)
    private val notifications = context.getSystemService(NotificationManager::class.java)
    private var foreground = false
    private var scheduled: Signal? = null
    private var permissionState: Pair<Boolean, Boolean>? = null
    private var wakeup: Job? = null

    fun setForeground(value: Boolean) { foreground = value }

    fun cancel(account: ActiveAccount) {
        scope.launch {
            lock.withLock { cancelScheduled(account) }
        }
    }

    suspend fun update(account: ActiveAccount, state: LocalPomodoro): Unit = lock.withLock {
        if (container.account() != account) return@withLock
        val now = System.currentTimeMillis() + state.clockOffsetMs
        val device = container.settings.pomodoroDeviceId(account)
        val raw = state.snapshot.timer
        // Un refresc pot arribar després del límit del bloc. El senyal anterior encara
        // és vàlid si el servidor ha avançat la fase sense una ordre nova.
        val last = scheduled?.takeIf { it.account == account.identity.key }
            ?: raw?.toSignal(account)?.takeIf { it.deadline <= now }
        if (last != null) notifyIfDue(account, state, last, device, now)
        val next = projectPomodoroTimer(raw, now)?.takeIf {
            state.snapshot.settings.enabled && state.snapshot.settings.sound && it.deviceId == device
        }?.toSignal(account)
        if (next == null) cancelScheduled(account)
        else if (next != scheduled || permissionState != currentPermissions()) {
            cancelScheduled(account)
            scheduled = next
            permissionState = currentPermissions()
            val remaining = (next.deadline - now).coerceAtLeast(1)
            wakeup = scope.launch {
                delay(remaining)
                val repository = container.repository(account)
                update(account, repository.pomodoro.first())
            }
            if (notifications.areNotificationsEnabled()) scheduleAlarm(account, next, remaining)
        }
    }

    fun receive(intent: Intent, finished: () -> Unit) {
        scope.launch {
            try {
                val account = container.account() ?: return@launch
                val signal = Signal.fromIntent(intent, account) ?: return@launch
                val repository = container.repository(account)
                // Si hi ha xarxa, una pausa o un traspàs a un altre aparell guanya per
                // damunt de l'alarma vella. El termini local segueix manant en mode avió.
                withTimeoutOrNull(1_500) {
                    try {
                        repository.refreshPomodoro()
                    } catch (error: Exception) {
                        if (error is CancellationException) throw error
                    }
                }
                val state = repository.pomodoro.first()
                lock.withLock {
                    val device = container.settings.pomodoroDeviceId(account)
                    notifyIfDue(account, state, signal, device, System.currentTimeMillis() + state.clockOffsetMs)
                }
                update(account, state)
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                // Un tomb del procés o una sessió caducada no poden deixar el receptor obert.
            } finally {
                finished()
            }
        }
    }

    private suspend fun notifyIfDue(account: ActiveAccount, state: LocalPomodoro, signal: Signal, device: String, now: Long) {
        val timer = state.snapshot.timer ?: return
        if (container.account() != account || !state.snapshot.settings.enabled || !state.snapshot.settings.sound ||
            timer.id != signal.timerId || timer.deviceId != device || timer.version != signal.version ||
            now - signal.deadline !in 0L..MAX_LATE_MS.toLong() || !(timer.phaseNumber > signal.phaseNumber ||
                (timer.phaseNumber == signal.phaseNumber && timer.endAtMs == signal.deadline))) return
        if (!foreground && !notifications.areNotificationsEnabled()) return
        if (!container.settings.claimPomodoroSignal(account, signal.id)) return
        if (foreground) {
            val tone = runCatching { ToneGenerator(AudioManager.STREAM_NOTIFICATION, 80) }.getOrNull() ?: return
            tone.startTone(ToneGenerator.TONE_PROP_ACK, 500)
            scope.launch {
                delay(600)
                tone.release()
            }
        } else {
            val title = context.getString(R.string.pomodoro_title)
            notifications.createNotificationChannel(NotificationChannel(CHANNEL, title, NotificationManager.IMPORTANCE_DEFAULT))
            val open = PendingIntent.getActivity(
                context, 0,
                Route.intentTo(Screen.POMODORO).setClass(context, MainActivity::class.java),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            val content = context.getString(R.string.pomodoro_phaseended)
                .replace("{phase}", context.getString(pomodoroPhaseName(signal.phase)))
            notifications.notify(CHANNEL, 0, NotificationCompat.Builder(context, CHANNEL)
                .setSmallIcon(android.R.drawable.ic_popup_reminder)
                .setContentTitle(title)
                .setContentText(content)
                .setContentIntent(open)
                .setAutoCancel(true)
                .build())
        }
    }

    private fun scheduleAlarm(account: ActiveAccount, signal: Signal, remaining: Long) {
        val intent = alarmIntent(account).apply {
            putExtra("timer", signal.timerId)
            putExtra("version", signal.version)
            putExtra("phase_number", signal.phaseNumber)
            putExtra("deadline", signal.deadline)
            putExtra("phase", signal.phase.name)
        }
        val pending = PendingIntent.getBroadcast(context, ALARM_REQUEST, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val at = SystemClock.elapsedRealtime() + remaining
        if (alarms.canUseExactPomodoroAlarm()) {
            try {
                alarms.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, at, pending)
                return
            } catch (_: SecurityException) {
                // El permís es pot revocar entre la comprovació i la crida.
            }
        }
        alarms.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, at, pending)
    }

    private fun cancelScheduled(account: ActiveAccount) {
        if (scheduled?.account == account.identity.key) {
            wakeup?.cancel()
            wakeup = null
            scheduled = null
            permissionState = null
        }
        val operation = PendingIntent.getBroadcast(context, ALARM_REQUEST, alarmIntent(account),
            PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE)
        if (operation != null) alarms.cancel(operation)
    }

    private fun currentPermissions(): Pair<Boolean, Boolean> =
        notifications.areNotificationsEnabled() to alarms.canUseExactPomodoroAlarm()

    private fun alarmIntent(account: ActiveAccount): Intent = Intent(context, PomodoroAlarmReceiver::class.java)
        .setData(Uri.parse("femho-pomodoro://alarm/${account.identity.key}"))

    private fun PomodoroTimer.toSignal(account: ActiveAccount): Signal? = endAtMs?.takeIf { status == PomodoroStatus.RUNNING }
        ?.let { Signal(account.identity.key, id, version, phaseNumber, phase, it) }

    private data class Signal(
        val account: String, val timerId: String, val version: Int, val phaseNumber: Long,
        val phase: PomodoroPhase, val deadline: Long,
    ) {
        val id: String get() = "$timerId/$version/$phaseNumber/$deadline"

        companion object {
            fun fromIntent(intent: Intent, account: ActiveAccount): Signal? {
                if (intent.data?.lastPathSegment != account.identity.key) return null
                val timerId = intent.getStringExtra("timer") ?: return null
                val phase = PomodoroPhase.entries.firstOrNull { it.name == intent.getStringExtra("phase") } ?: return null
                return Signal(account.identity.key, timerId, intent.getIntExtra("version", -1),
                    intent.getLongExtra("phase_number", -1), phase, intent.getLongExtra("deadline", -1))
            }
        }
    }
}

class PomodoroAlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val pending = goAsync()
        (context.applicationContext as FemhoApplication).pomodoroSignals.receive(intent, pending::finish)
    }
}
