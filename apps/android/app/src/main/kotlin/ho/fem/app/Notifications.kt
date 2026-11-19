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
import androidx.work.workDataOf
import ho.fem.app.widget.FemhoWidgets
import ho.fem.data.ActiveAccount
import kotlinx.coroutines.CancellationException
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
    internal const val SYNC_ACCOUNT = "account"

    fun ensureChannel(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        // Un canal per als recordatoris: així l'usuari pot silenciar-los sense silenciar
        // l'app sencera, que és el que acaba fent si no pot triar.
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_REMINDERS,
                context.getString(ho.fem.app.R.string.app_name),
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
    fun requestSync(context: Context, account: ActiveAccount) {
        val key = account.identity.key
        WorkManager.getInstance(context).enqueueUniqueWork(
            "femho-sync-$key",
            // Una operació nova pot arribar mentre el worker acaba de llegir la cua.
            androidx.work.ExistingWorkPolicy.APPEND_OR_REPLACE,
            androidx.work.OneTimeWorkRequestBuilder<SyncWorker>()
                .setInputData(workDataOf(SYNC_ACCOUNT to key))
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build(),
        )
    }

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
        val account = container.account() ?: return Result.success()
        val expected = inputData.getString(Notifications.SYNC_ACCOUNT)
        if (expected != null && expected != account.identity.key) return Result.success()
        return runCatching { container.repository(account).refresh(emptyList(), null) }
            .fold(
                // Un error de xarxa és `retry`, no `failure`: la feina segueix sent
                // vàlida i el sistema la tornarà a provar amb espera creixent.
                onSuccess = {
                    // Els widgets es repinten **només si el refresc ha anat bé**: repintar
                    // després d'un error ensenyaria les mateixes dades i gastaria una
                    // transacció amb el llançador per no dir res de nou.
                    FemhoWidgets.updateAll(applicationContext)
                    Result.success()
                },
                onFailure = {
                    if (it is CancellationException) throw it
                    if (container.account() == account) Result.retry() else Result.success()
                },
            )
    }
}
