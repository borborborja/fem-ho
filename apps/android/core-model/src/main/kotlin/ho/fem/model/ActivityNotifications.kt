package ho.fem.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
enum class ActivityNotificationKind(val wire: String) {
    @SerialName("task_created") TASK_CREATED("task_created"),
    @SerialName("status_changed") STATUS_CHANGED("status_changed"),
    @SerialName("task_activity") TASK_ACTIVITY("task_activity"),
    @SerialName("inbox_entry") INBOX_ENTRY("inbox_entry"),
}

@Serializable
data class ActivityNotificationScope(
    @SerialName("scope_id") val scopeId: String,
    @SerialName("scope_name") val scopeName: String,
    @SerialName("task_created") val taskCreated: Boolean,
    @SerialName("status_changed") val statusChanged: Boolean,
    @SerialName("task_activity") val taskActivity: Boolean,
    @SerialName("inbox_entry") val inboxEntry: Boolean,
) {
    fun enabled(kind: ActivityNotificationKind): Boolean = when (kind) {
        ActivityNotificationKind.TASK_CREATED -> taskCreated
        ActivityNotificationKind.STATUS_CHANGED -> statusChanged
        ActivityNotificationKind.TASK_ACTIVITY -> taskActivity
        ActivityNotificationKind.INBOX_ENTRY -> inboxEntry
    }
}

@Serializable
data class ActivityNotificationDevice(
    val enabled: Boolean,
    val subscribed: Boolean,
    val scopes: List<ActivityNotificationScope>,
)

@Serializable
data class ActivityNotification(
    val id: String,
    val kind: ActivityNotificationKind,
    @SerialName("device_id") val deviceId: String,
    @SerialName("task_id") val taskId: String,
    val title: String,
    val body: String,
    @SerialName("created_at") val createdAt: String,
)

@Serializable
data class ActivityNotificationsEnvelope(val items: List<ActivityNotification>)
