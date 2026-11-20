package ho.fem.app

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.app.NotificationCompat
import ho.fem.data.Container
import ho.fem.model.ActivityNotification
import ho.fem.model.ActivityNotificationKind
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import org.json.JSONObject
import org.unifiedpush.android.connector.FailedReason
import org.unifiedpush.android.connector.MessagingReceiver
import org.unifiedpush.android.connector.data.PushEndpoint
import org.unifiedpush.android.connector.data.PushMessage

/**
 * El receptor d'UnifiedPush. docs/11 §1.
 *
 * **El missatge ja arriba desxifrat**: la biblioteca fa el desxifrat de Web Push amb la
 * mateixa RFC que fa servir el navegador, i per això el servidor no ha de distingir un
 * client de l'altre. El que arriba és el mateix JSON que rep la web.
 *
 * L'`endpoint` es registra al servidor com una subscripció qualsevol
 * (`POST /push/subscriptions`), amb `platform: android`. Una taula, una crida.
 */
class PushReceiver : MessagingReceiver() {

    override fun onMessage(context: Context, message: PushMessage, instance: String) {
        val container = Container.get(context)
        val account = container.account() ?: return
        if (!message.decrypted || !ActivityNotifications.accepts(context, account, instance)) return
        val payload = runCatching { JSONObject(String(message.content)) }.getOrNull() ?: return

        if (payload.has("kind")) {
            val kind = ActivityNotificationKind.entries.firstOrNull { it.wire == payload.optString("kind") } ?: return
            val item = ActivityNotification(
                id = payload.optString("id").ifEmpty { return },
                kind = kind,
                deviceId = payload.optString("device_id").ifEmpty { return },
                taskId = payload.optString("task_id").ifEmpty { return },
                title = payload.optString("title").ifEmpty { return },
                body = payload.optString("body"),
                createdAt = payload.optString("created_at").ifEmpty { return },
            )
            background {
                if (ActivityNotifications.accepts(context, account, instance) &&
                    ActivityNotifications.display(container, account, item)) {
                    Notifications.requestSync(context, account)
                }
            }
            return
        }

        val title = payload.optString("title").ifEmpty { return }
        val body = payload.optString("body")

        /**
         * La notificació obre la tasca de què parla, si el servidor n'ha dit quina.
         *
         * **Avui no en diu cap**: el payload porta `title` i `body` i prou
         * (`jobs/scheduler.ts`). Es llegeix igualment perquè el dia que n'hi posi, el
         * telèfon ja hi anirà sense tornar a publicar l'APK — i mentrestant es comporta
         * com abans, obrint el tauler.
         */
        val taskId = payload.optString("task_id").ifEmpty { null }
        val open = PendingIntent.getActivity(
            context,
            0,
            Route.intentTo(taskId = taskId).setClass(context, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

        // Les accions de la notificació: "Fet" i "Ajorna" (docs/03 §9). Van a un
        // receiver, no a l'activitat: no cal obrir l'app per marcar una tasca.
        fun actionPending(action: String, requestCode: Int): PendingIntent {
            val intent = Intent(context, NotificationActionReceiver::class.java)
                .setAction(action)
                .setData(Uri.Builder().scheme("femho").authority("notification")
                    .appendPath(account.identity.key).appendPath(taskId.orEmpty()).build())
                .putExtra(NotificationActionReceiver.EXTRA_TASK_ID, taskId)
                .putExtra(NotificationActionReceiver.EXTRA_ACCOUNT_KEY, account.identity.key)
            return PendingIntent.getBroadcast(
                context,
                requestCode,
                intent,
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
        }

        Notifications.ensureChannel(context)
        val notification = NotificationCompat.Builder(context, Notifications.CHANNEL_REMINDERS)
            .setSmallIcon(android.R.drawable.ic_popup_reminder)
            .setContentTitle(title)
            .setContentText(body)
            .setAutoCancel(true)
            .setContentIntent(open)
            .addAction(
                0,
                context.getString(R.string.board_column_done),
                actionPending(NotificationActionReceiver.ACTION_DONE, 1),
            )
            .addAction(
                0,
                context.getString(R.string.notification_snooze),
                actionPending(NotificationActionReceiver.ACTION_SNOOZE, 2),
            )
            .build()

        // La clau és el títol: dos recordatoris de la mateixa tasca es col·lapsen en un.
        context.getSystemService(NotificationManager::class.java)
            .notify(title.hashCode(), notification)
    }

    /**
     * Hi ha distribuïdor i ens ha donat un punt final: es registra al servidor.
     *
     * Les claus `p256dh` i `auth` són les del parell que genera la biblioteca, i són les
     * mateixes que el navegador dona a `PushSubscription`: el servidor les guarda a la
     * mateixa taula i les fa servir amb la mateixa crida.
     */
    override fun onNewEndpoint(context: Context, endpoint: PushEndpoint, instance: String) {
        val container = Container.get(context)
        val account = container.account() ?: return
        if (!ActivityNotifications.accepts(context, account, instance)) return
        background {
            ActivityNotifications.onEndpoint(container, account, instance, endpoint)
        }
    }

    /**
     * No hi ha cap distribuïdor.
     *
     * **No és un error i no s'ensenya cap avís**: la majoria de telèfons sense Google no
     * en tenen cap, i dir-los que "falta una cosa" quan l'app funciona igual només fa que
     * la desinstal·lin. Es cau a la consulta periòdica i ja està.
     */
    override fun onUnregistered(context: Context, instance: String) {
        val container = Container.get(context)
        val account = container.account() ?: return
        if (!ActivityNotifications.accepts(context, account, instance)) return
        background { ActivityNotifications.onUnregistered(container, account, instance) }
    }

    /**
     * El registre ha fallat.
     *
     * Mateix criteri que no tenir distribuïdor: **cap avís a l'usuari**, i es cau a la
     * consulta periòdica. El motiu sí que va al registre, perquè qui munti la instància
     * el pugui mirar.
     */
    override fun onRegistrationFailed(context: Context, reason: FailedReason, instance: String) {
        onUnregistered(context, instance)
    }

    /** Les confirmacions poden arribar amb l'activitat tancada. */
    private fun background(work: suspend () -> Unit) {
        val pending = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                work()
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                // Si el servidor no respon, la consulta periòdica conserva els avisos.
            } finally {
                pending?.finish()
            }
        }
    }
}
