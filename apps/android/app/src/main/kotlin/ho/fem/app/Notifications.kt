package ho.fem.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.flow.first
import java.util.concurrent.TimeUnit

/**
 * Avisos. docs/11 §1.
 *
 * **UnifiedPush si hi ha distribuïdor, i consulta periòdica si no n'hi ha.** El document
 * ho diu així i la raó és pràctica: sense Google Play Services, la majoria de telèfons no
 * tenen cap distribuïdor instal·lat, i una app que només sap parlar per push no avisaria
 * mai. La consulta és pitjor —gasta bateria i té latència— però funciona a tot arreu.
 *
 * Web Push i UnifiedPush **comparteixen les RFC i el xifratge**, o sigui que el servidor
 * no distingeix: una taula de subscripcions i una crida d'enviament per als dos clients.
 * L'única diferència és qui dona l'`endpoint`.
 */
object Notifications {
    const val CHANNEL_REMINDERS = "reminders"
    private const val SYNC_WORK = "femho-periodic-sync"

    fun ensureChannel(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        // Un canal per als recordatoris: així l'usuari pot silenciar-los sense silenciar
        // l'app sencera, que és el que acaba fent si no pot triar.
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_REMINDERS,
                context.getString(ho.fem.R.string.app_name),
                NotificationManager.IMPORTANCE_DEFAULT,
            ),
        )
    }

    /**
     * La consulta periòdica.
     *
     * Quinze minuts és el mínim que WorkManager accepta per a feina periòdica, i és a
     * posta: demanar-ne menys no en dona menys, dona el mateix amb una promesa que el
     * sistema no complirà.
     */
    fun schedulePolling(context: Context) {
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            SYNC_WORK,
            ExistingPeriodicWorkPolicy.KEEP,
            PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES)
                .setConstraints(
                    Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build(),
                )
                .build(),
        )
    }
}

/**
 * Buida la cua de sortida i torna a llegir.
 *
 * **La cua primer.** A l'inrevés, el que s'ha escrit sense connexió es perdria: el
 * servidor encara no ho sap, tornaria l'estat antic i sobreescriuria el local. És el
 * mateix ordre que `Repository.refresh` i que la web (docs/06 §4).
 */
class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val container = (applicationContext as FemhoApplication).container
        val base = container.settings.serverUrl.first() ?: return Result.success()
        if (container.tokens.refresh() == null) return Result.success()

        val active = container.settings.activeScopes.first()
        return runCatching { container.repository(base).refresh(active, null) }
            .fold(
                // Un error de xarxa és `retry`, no `failure`: la feina segueix sent
                // vàlida i el sistema la tornarà a provar amb espera creixent.
                onSuccess = { Result.success() },
                onFailure = { Result.retry() },
            )
    }
}
