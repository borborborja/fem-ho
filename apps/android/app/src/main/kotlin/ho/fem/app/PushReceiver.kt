package ho.fem.app

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import org.json.JSONObject
import kotlinx.coroutines.flow.first
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
        val payload = runCatching { JSONObject(String(message.content)) }.getOrNull() ?: return

        val title = payload.optString("title").ifEmpty { return }
        val body = payload.optString("body")

        val open = PendingIntent.getActivity(
            context,
            0,
            Intent(context, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

        Notifications.ensureChannel(context)
        val notification = NotificationCompat.Builder(context, Notifications.CHANNEL_REMINDERS)
            .setSmallIcon(android.R.drawable.ic_popup_reminder)
            .setContentTitle(title)
            .setContentText(body)
            .setAutoCancel(true)
            .setContentIntent(open)
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
        val container = (context.applicationContext as FemhoApplication).container
        val keys = endpoint.pubKeySet ?: return

        CoroutineScope(Dispatchers.IO).launch {
            val base = container.settings.serverUrl.first() ?: return@launch
            runCatching {
                container.api(base).subscribePush(
                    endpoint = endpoint.url,
                    p256dh = keys.pubKey,
                    auth = keys.auth,
                )
            }
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
        Notifications.schedulePolling(context)
    }

    /**
     * El registre ha fallat.
     *
     * Mateix criteri que no tenir distribuïdor: **cap avís a l'usuari**, i es cau a la
     * consulta periòdica. El motiu sí que va al registre, perquè qui munti la instància
     * el pugui mirar.
     */
    override fun onRegistrationFailed(context: Context, reason: FailedReason, instance: String) {
        android.util.Log.w("femho", "UnifiedPush no s'ha pogut registrar: ${'$'}reason")
        Notifications.schedulePolling(context)
    }
}
