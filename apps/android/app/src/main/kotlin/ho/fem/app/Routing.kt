package ho.fem.app

import android.content.Intent

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
enum class Screen { BOARD, CALENDAR, SETTINGS, REGISTRE, ESTADISTIQUES, JOIN, INVITE }

object Route {
    const val EXTRA_SCREEN = "ho.fem.screen"
    const val EXTRA_TASK = "ho.fem.task_id"

    /** Obre l'afegida ràpida amb el camp enfocat i, si escau, un text ja escrit. */
    const val EXTRA_QUICK_ADD = "ho.fem.quick_add"
    const val EXTRA_DRAFT = "ho.fem.draft"

    /**
     * La pantalla que demana l'intent. **El tauler si no en demana cap**, que és el que
     * l'app feia abans i el que ha de seguir fent quan s'obre des del llançador.
     */
    fun screenOf(intent: Intent?): Screen = when (intent?.getStringExtra(EXTRA_SCREEN)) {
        "calendar" -> Screen.CALENDAR
        "settings" -> Screen.SETTINGS
        "registre" -> Screen.REGISTRE
        "estadistiques" -> Screen.ESTADISTIQUES
        else -> Screen.BOARD
    }

    fun taskOf(intent: Intent?): String? = intent?.getStringExtra(EXTRA_TASK)

    fun quickAddOf(intent: Intent?): Boolean = intent?.getBooleanExtra(EXTRA_QUICK_ADD, false) == true

    fun draftOf(intent: Intent?): String? = intent?.getStringExtra(EXTRA_DRAFT)

    fun intentTo(
        screen: Screen = Screen.BOARD,
        taskId: String? = null,
        quickAdd: Boolean = false,
        draft: String? = null,
    ): Intent = Intent().apply {
        putExtra(EXTRA_SCREEN, screen.name.lowercase())
        if (taskId != null) putExtra(EXTRA_TASK, taskId)
        if (quickAdd) putExtra(EXTRA_QUICK_ADD, true)
        if (draft != null) putExtra(EXTRA_DRAFT, draft)
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
