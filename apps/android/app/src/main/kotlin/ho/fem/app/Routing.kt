package ho.fem.app

import android.content.Intent
import ho.fem.model.CalendarTaskSuggestion
import ho.fem.model.SourceEvent
import ho.fem.model.TaskStatus

/**
 * Com s'obre l'app des de fora.
 *
 * Fins ara no s'obria: `MainActivity` no llegia mai l'`Intent` i la pantalla era estat
 * local d'una composició. El `PendingIntent` de les notificacions era un intent pelat que
 * portava a la pantalla que hi hagués. Amb widgets això deixa de ser acceptable: tocar
 * una tasca a la pantalla d'inici i que s'obri el tauler per on el vas deixar no és
 * obrir la tasca.
 *
 * **No hi ha cap `intent-filter` ni cap esquema propi.** Els widgets i les notificacions
 * arriben amb component explícit, o sigui que no cal exposar cap superfície nova a la
 * resta del telèfon per fer això.
 */
enum class Screen { BOARD, CALENDAR, SETTINGS, SEARCH, DASHBOARD, JOIN, INVITE, POMODORO }

data class CalendarSuggestionTarget(
    val occurrence: SourceEvent,
    val startsAt: String,
    val accountKey: String,
) {
    fun matches(item: CalendarTaskSuggestion): Boolean =
        item.occurrence == occurrence && item.startsAt == startsAt
}

object Route {
    const val EXTRA_SCREEN = "ho.fem.screen"
    const val EXTRA_STATUS = "ho.fem.status"
    const val EXTRA_TASK = "ho.fem.task_id"
    const val EXTRA_NOTIFICATION_ACCOUNT = "ho.fem.notification_account"
    private const val EXTRA_CALENDAR = "ho.fem.suggestion.calendar"
    private const val EXTRA_EVENT_UID = "ho.fem.suggestion.event"
    private const val EXTRA_RECURRENCE = "ho.fem.suggestion.recurrence"
    private const val EXTRA_EVENT_START = "ho.fem.suggestion.starts_at"
    private const val EXTRA_WIDGET_ACCOUNT = "ho.fem.widget_account"

    /** Obre l'afegida ràpida amb el camp enfocat i, si escau, un text ja escrit. */
    const val EXTRA_QUICK_ADD = "ho.fem.quick_add"
    const val EXTRA_DRAFT = "ho.fem.draft"

    /** Conserva els destins vàlids quan una actualització retira una pantalla. */
    fun restoreStack(saved: String): String {
        val screens = mutableListOf(Screen.BOARD)
        for (name in saved.split('/')) {
            val screen = screenNamed(name) ?: continue
            if (screen != Screen.BOARD && screen != screens.last()) screens.add(screen)
        }
        return screens.joinToString("/") { it.name }
    }

    fun currentScreen(stack: String): Screen = screenNamed(stack.substringAfterLast('/')) ?: Screen.BOARD

    private fun screenNamed(name: String): Screen? = Screen.entries.firstOrNull { it.name == name }

    /**
     * La pantalla que demana l'intent. **El tauler si no en demana cap**, que és el que
     * l'app feia abans i el que ha de seguir fent quan s'obre des del llançador.
     */
    fun screenOf(intent: Intent?): Screen = when (intent?.getStringExtra(EXTRA_SCREEN)) {
        "calendar" -> Screen.CALENDAR
        "settings" -> Screen.SETTINGS
        "search" -> Screen.SEARCH
        "pomodoro" -> Screen.POMODORO
        else -> Screen.BOARD
    }

    fun statusOf(intent: Intent?): TaskStatus? =
        TaskStatus.entries.firstOrNull { it.name == intent?.getStringExtra(EXTRA_STATUS) }

    fun taskOf(intent: Intent?): String? = intent?.getStringExtra(EXTRA_TASK)

    fun quickAddOf(intent: Intent?): Boolean = intent?.getBooleanExtra(EXTRA_QUICK_ADD, false) == true

    fun draftOf(intent: Intent?): String? = intent?.getStringExtra(EXTRA_DRAFT)

    fun intentTo(
        screen: Screen = Screen.BOARD,
        taskId: String? = null,
        quickAdd: Boolean = false,
        draft: String? = null,
        status: TaskStatus? = null,
    ): Intent = Intent().apply {
        putExtra(EXTRA_SCREEN, screen.name.lowercase())
        if (taskId != null) putExtra(EXTRA_TASK, taskId)
        if (quickAdd) putExtra(EXTRA_QUICK_ADD, true)
        if (draft != null) putExtra(EXTRA_DRAFT, draft)
        if (status != null) putExtra(EXTRA_STATUS, status.name)
    }

    fun intentToCalendarSuggestion(suggestion: CalendarTaskSuggestion, status: TaskStatus, accountKey: String): Intent =
        intentTo(status = status).apply {
            putExtra(EXTRA_CALENDAR, suggestion.calendarId)
            putExtra(EXTRA_EVENT_UID, suggestion.uid)
            putExtra(EXTRA_RECURRENCE, suggestion.recurrenceId)
            putExtra(EXTRA_EVENT_START, suggestion.startsAt)
            putExtra(EXTRA_WIDGET_ACCOUNT, accountKey)
        }

    fun calendarSuggestionOf(intent: Intent): CalendarSuggestionTarget? {
        val calendarId = intent.getStringExtra(EXTRA_CALENDAR) ?: return null
        val uid = intent.getStringExtra(EXTRA_EVENT_UID) ?: return null
        val startsAt = intent.getStringExtra(EXTRA_EVENT_START) ?: return null
        val accountKey = intent.getStringExtra(EXTRA_WIDGET_ACCOUNT) ?: return null
        return CalendarSuggestionTarget(SourceEvent(calendarId, uid, intent.getStringExtra(EXTRA_RECURRENCE)), startsAt, accountKey)
    }

    /**
     * El token d'un convit d'àmbit, si l'intent és un deep link de `join`.
     *
     * Accepta `femho://join/{token}` i `https://<servidor>/join/{token}`; el token és
     * l'últim segment del camí, que és on el servidor el posa en generar l'enllaç.
     */
    fun joinTokenOf(intent: Intent?): String? = tokenOf(intent, "join")

    /** El token d'un convit a la instància, si l'intent és un deep link d'`invite`. */
    fun inviteTokenOf(intent: Intent?): String? = tokenOf(intent, "invite")

    private fun tokenOf(intent: Intent?, host: String): String? {
        val data = intent?.data ?: return null
        if (data.host != host) return null
        return data.pathSegments.lastOrNull()
    }
}
