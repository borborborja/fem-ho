package ho.fem.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.net.Uri
import androidx.annotation.StringRes
import androidx.core.app.NotificationCompat
import ho.fem.data.ActiveAccount
import ho.fem.data.Container
import ho.fem.model.ActivityNotification
import ho.fem.model.ActivityNotificationDevice
import ho.fem.model.ActivityNotificationKind
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.unifiedpush.android.connector.UnifiedPush
import org.unifiedpush.android.connector.data.PushEndpoint
import java.time.Instant
import java.util.UUID

@StringRes
internal fun ActivityNotificationKind.label(): Int = when (this) {
    ActivityNotificationKind.TASK_CREATED -> R.string.notify_activity_taskcreated
    ActivityNotificationKind.STATUS_CHANGED -> R.string.notify_activity_statuschanged
    ActivityNotificationKind.TASK_ACTIVITY -> R.string.notify_activity_taskactivity
    ActivityNotificationKind.INBOX_ENTRY -> R.string.notify_activity_inboxentry
}

internal object ActivityNotifications {
    private const val STORE = "task_activity_notifications"
    private const val HISTORY_MS = 24 * 60 * 60 * 1000L
    private const val ACTIVITY_ID = 23
    private const val BATCH_SIZE = 50
    private val delivery = Mutex()
    private val registration = Mutex()
    private val changed = MutableStateFlow(0L)
    val changes = changed.asStateFlow()

    private fun store(context: Context) = context.getSharedPreferences(STORE, Context.MODE_PRIVATE)
    private fun key(account: ActiveAccount, name: String) = "${account.identity.key}.$name"

    @Synchronized
    fun deviceId(context: Context, account: ActiveAccount): String {
        val key = key(account, "device_id")
        val prefs = store(context)
        return prefs.getString(key, null) ?: UUID.randomUUID().toString().also {
            prefs.edit().putString(key, it).apply()
        }
    }

    fun enabled(context: Context, account: ActiveAccount): Boolean =
        store(context).getBoolean(key(account, "enabled"), false)

    private fun pendingDisable(context: Context, account: ActiveAccount): Boolean =
        store(context).getBoolean(key(account, "disable_pending"), false)

    fun needsSync(context: Context, account: ActiveAccount): Boolean =
        enabled(context, account) || pendingDisable(context, account)

    fun showPermission(context: Context): Boolean =
        context.getSystemService(NotificationManager::class.java).areNotificationsEnabled()

    fun channel(kind: ActivityNotificationKind): String = "external_${kind.wire}"

    fun ensureChannels(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannels(ActivityNotificationKind.entries.map { kind ->
            NotificationChannel(channel(kind), context.getString(kind.label()), NotificationManager.IMPORTANCE_DEFAULT)
        })
    }

    suspend fun settings(container: Container, account: ActiveAccount): ActivityNotificationDevice = registration.withLock {
        val context = container.appContext
        val settings = container.api(account).activityNotificationDevice(deviceId(context, account))
        if (pendingDisable(context, account)) {
            settings.copy(enabled = false, subscribed = false)
        } else {
            if (container.account() == account) {
                if (settings.enabled && !enabled(context, account)) {
                    store(context).edit().putBoolean(key(account, "enabled"), true).apply()
                    Notifications.requestSync(context, account)
                } else if (!settings.enabled && enabled(context, account)) {
                    withContext(Dispatchers.IO) { deactivate(context, account) }
                    store(context).edit().remove(key(account, "disable_pending")).apply()
                }
                if (settings.enabled && !settings.subscribed && store(context).contains(key(account, "endpoint"))) {
                    withContext(Dispatchers.IO) { clearRegistration(context, account) }
                    Notifications.requestSync(context, account)
                }
            }
            settings
        }
    }

    suspend fun setEnabled(container: Container, account: ActiveAccount, enabled: Boolean): ActivityNotificationDevice {
        val context = container.appContext
        if (!enabled) withContext(Dispatchers.IO) { deactivate(context, account) }
        val updated = registration.withLock {
            val settings = container.api(account).setActivityNotificationDevice(deviceId(context, account), enabled)
            if (container.account() != account) return@withLock settings
            store(context).edit()
                .putBoolean(key(account, "enabled"), enabled && settings.enabled)
                .remove(key(account, "disable_pending"))
                .apply()
            settings
        }
        if (enabled && updated.enabled && container.account() == account) {
            ensureChannels(context)
            Notifications.requestSync(context, account)
        }
        return updated
    }

    /** El receptor pot despertar-se després de sortir de l'app o fins i tot sense xarxa. */
    @Synchronized
    fun deactivate(context: Context, account: ActiveAccount) {
        if (!needsSync(context, account)) return
        val prefs = store(context)
        val instance = prefs.getString(key(account, "instance"), null)
        prefs.edit()
            .putBoolean(key(account, "enabled"), false)
            .putBoolean(key(account, "disable_pending"), true)
            .remove(key(account, "instance"))
            .remove(key(account, "endpoint"))
            .apply()
        instance?.let { runCatching { UnifiedPush.unregister(context, it) } }
        val manager = context.getSystemService(NotificationManager::class.java)
        for (notification in manager.activeNotifications) {
            if (notification.id == ACTIVITY_ID) manager.cancel(notification.tag, ACTIVITY_ID)
        }
    }

    fun accepts(context: Context, account: ActiveAccount, instance: String): Boolean =
        enabled(context, account) && store(context).getString(key(account, "instance"), null) == instance

    fun distributors(context: Context): List<String> = UnifiedPush.getDistributors(context).distinct()

    private fun clearRegistration(context: Context, account: ActiveAccount) {
        val prefs = store(context)
        val instance = prefs.getString(key(account, "instance"), null)
        prefs.edit().remove(key(account, "instance")).remove(key(account, "endpoint")).apply()
        instance?.let { runCatching { UnifiedPush.unregister(context, it) } }
    }

    suspend fun selectDistributor(context: Context, account: ActiveAccount, distributor: String) {
        withContext(Dispatchers.IO) {
            if (distributor !in distributors(context) || !enabled(context, account)) return@withContext
            registration.withLock {
                val prefs = store(context)
                val instance = prefs.getString(key(account, "instance"), null)
                prefs.edit().remove(key(account, "instance")).apply()
                instance?.let { UnifiedPush.unregister(context, it) }
                UnifiedPush.saveDistributor(context, distributor)
                val container = Container.get(context)
                forgetEndpoint(container, account)
                register(container, account)
            }
        }
    }

    private suspend fun register(container: Container, account: ActiveAccount) {
        val context = container.appContext
        if (container.account() != account || !enabled(context, account) || !showPermission(context)) return
        val prefs = store(context)
        val installed = distributors(context)
        val saved = UnifiedPush.getSavedDistributor(context).takeIf { it in installed }
        val selected = saved ?: installed.singleOrNull()
        if (selected == null) {
            forgetEndpoint(container, account)
            return
        }
        if (prefs.getString(key(account, "endpoint"), null) != null) return
        val vapid = container.api(account).pushPublicKey()
        synchronized(this) {
            if (container.account() != account || !enabled(context, account)) return
            if (selected != saved) UnifiedPush.saveDistributor(context, selected)
            val instance = prefs.getString(key(account, "instance"), null) ?: UUID.randomUUID().toString()
            prefs.edit().putString(key(account, "instance"), instance).apply()
            UnifiedPush.register(context, instance = instance, vapid = vapid)
        }
    }

    suspend fun onEndpoint(container: Container, account: ActiveAccount, instance: String, endpoint: PushEndpoint) =
        registration.withLock {
            val context = container.appContext
            val keys = endpoint.pubKeySet ?: return@withLock
            if (container.account() != account || !accepts(context, account, instance)) return@withLock
            container.api(account).subscribePush(endpoint.url, keys.pubKey, keys.auth, deviceId(context, account))
            synchronized(this) {
                if (container.account() == account && accepts(context, account, instance)) {
                    store(context).edit().putString(key(account, "endpoint"), endpoint.url).apply()
                    changed.update { it + 1 }
                }
            }
        }

    suspend fun onUnregistered(container: Container, account: ActiveAccount, instance: String) =
        registration.withLock {
            if (container.account() == account && accepts(container.appContext, account, instance)) {
                forgetEndpoint(container, account)
            }
        }

    private suspend fun forgetEndpoint(container: Container, account: ActiveAccount) {
        val context = container.appContext
        val prefs = store(context)
        val endpoint = prefs.getString(key(account, "endpoint"), null) ?: return
        container.api(account).unsubscribePush(endpoint)
        prefs.edit().remove(key(account, "endpoint")).apply()
        changed.update { it + 1 }
    }

    suspend fun sync(container: Container, account: ActiveAccount) = withContext(Dispatchers.IO) {
        val context = container.appContext
        if (!needsSync(context, account)) return@withContext
        registration.withLock {
            if (container.account() != account) return@withContext
            if (pendingDisable(context, account)) {
                container.api(account).setActivityNotificationDevice(deviceId(context, account), false)
                store(context).edit().remove(key(account, "disable_pending")).apply()
            } else {
                // Un distribuïdor avariat no ha d'impedir la consulta al servidor.
                try {
                    register(container, account)
                } catch (error: CancellationException) {
                    throw error
                } catch (_: Exception) {
                    changed.update { it + 1 }
                }
            }
        }
        delivery.withLock {
            val id = deviceId(context, account)
            val api = container.api(account)
            pruneHistory(context, id)
            while (container.account() == account && enabled(context, account)) {
                val pending = api.pendingActivityNotifications(id)
                val handled = pending.filter { display(container, account, it) }.map { it.id }
                if (container.account() != account || handled.isEmpty()) return@withContext
                api.acknowledgeActivityNotifications(id, handled)
                if (pending.size < BATCH_SIZE || handled.size < pending.size) return@withContext
            }
        }
    }

    private fun pruneHistory(context: Context, deviceId: String) {
        val prefs = store(context)
        val prefix = "$deviceId.seen."
        val cutoff = System.currentTimeMillis() - HISTORY_MS
        val expired = prefs.all.filter { (key, value) -> key.startsWith(prefix) && value is Long && value < cutoff }
        if (expired.isNotEmpty()) {
            val editor = prefs.edit()
            expired.keys.forEach(editor::remove)
            editor.apply()
        }
    }

    /**
     * La mateixa clau evita repetir un avís quan coincideixen el distribuïdor i la consulta.
     * Es conserva encara que la persona ja hagi descartat la notificació.
     */
    @Synchronized
    fun display(container: Container, account: ActiveAccount, item: ActivityNotification): Boolean {
        val context = container.appContext
        if (container.account() != account || !enabled(context, account)) return false
        val deviceId = deviceId(context, account)
        if (item.deviceId != deviceId) return false
        val prefs = store(context)
        val seen = "$deviceId.seen.${item.id}"
        if (prefs.contains(seen)) return true
        val created = runCatching { Instant.parse(item.createdAt).toEpochMilli() }.getOrNull()
        val now = System.currentTimeMillis()
        if (created == null || created < now - HISTORY_MS) return true
        val manager = context.getSystemService(NotificationManager::class.java)
        val channel = channel(item.kind)
        ensureChannels(context)
        if (showPermission(context) && manager.getNotificationChannel(channel)?.importance != NotificationManager.IMPORTANCE_NONE) {
            val destination = Route.intentTo(taskId = item.taskId)
                .setClass(context, MainActivity::class.java)
                .setData(Uri.Builder().scheme("femho").authority("activity")
                    .appendPath(deviceId).appendPath(item.id).build())
                .putExtra(Route.EXTRA_NOTIFICATION_ACCOUNT, account.identity.key)
            val open = PendingIntent.getActivity(context, 0, destination, PendingIntent.FLAG_IMMUTABLE)
            val notification = NotificationCompat.Builder(context, channel)
                .setSmallIcon(android.R.drawable.ic_popup_reminder)
                .setContentTitle(item.title)
                .setContentText(item.body)
                .setVisibility(Notification.VISIBILITY_PRIVATE)
                .setOnlyAlertOnce(true)
                .setAutoCancel(true)
                .setContentIntent(open)
                .build()
            manager.notify(item.id, ACTIVITY_ID, notification)
        }
        return prefs.edit().putLong(seen, now).commit()
    }
}
