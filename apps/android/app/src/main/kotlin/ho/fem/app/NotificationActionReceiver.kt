package ho.fem.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.format.DateTimeFormatter

/**
 * Les accions de les notificacions (docs/03 §9): "Fet" completa la tasca i "Ajorna"
 * allarga el venciment quinze minuts. Es fan al moment, sense obrir l'app.
 */
class NotificationActionReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        val taskId = intent.getStringExtra("task_id") ?: return
        val container = (context.applicationContext as FemhoApplication).container
        // El sistema pot matar el procés quan onReceive torna: goAsync allarga la vida
        // fins que la feina de segon pla acaba.
        val pendingResult = goAsync()

        CoroutineScope(Dispatchers.IO).launch {
            try {
                val base = container.settings.serverUrl.first() ?: return@launch
                when (action) {
                    ACTION_DONE -> runCatching { container.api(base).completeTask(taskId) }
                    ACTION_SNOOZE -> runCatching {
                        val task = container.api(base).getTask(taskId)
                        container.api(base).updateTask(taskId, snoozeFields(task.dueDate, task.dueTime))
                    }
                }
            } finally {
                pendingResult.finish()
            }
        }
    }

    /** Quinze minuts més al venciment: la data es conserva i l'hora puja, com a la web. */
    private fun snoozeFields(dueDate: String?, dueTime: String?): Map<String, Any?> {
        val date = dueDate?.let { runCatching { LocalDate.parse(it) }.getOrNull() }
            ?: LocalDate.now()
        val time = dueTime?.let { runCatching { LocalTime.parse(it) }.getOrNull() }
            ?: LocalTime.now().withSecond(0).withNano(0)
        val nou = LocalDateTime.of(date, time).plusMinutes(15)
        return mapOf(
            "due_date" to nou.toLocalDate().format(DateTimeFormatter.ISO_LOCAL_DATE),
            "due_time" to nou.toLocalTime().format(DateTimeFormatter.ofPattern("HH:mm")),
        )
    }

    companion object {
        const val ACTION_DONE = "ho.fem.notification.DONE"
        const val ACTION_SNOOZE = "ho.fem.notification.SNOOZE"
        const val EXTRA_TASK_ID = "task_id"
    }
}
