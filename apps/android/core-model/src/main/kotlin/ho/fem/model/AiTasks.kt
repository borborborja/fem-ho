package ho.fem.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
enum class AiTaskMethod(val wire: String) {
    @SerialName("copy") COPY("copy"),
    @SerialName("mcp_events") MCP_EVENTS("mcp_events"),
    @SerialName("claude_routine") CLAUDE_ROUTINE("claude_routine"),
}

@Serializable
data class AiTaskSettings(
    @SerialName("scope_id") val scopeId: String,
    val enabled: Boolean = false,
    val method: AiTaskMethod = AiTaskMethod.COPY,
    val ready: Boolean = false,
    @SerialName("can_dispatch") val canDispatch: Boolean = false,
    @SerialName("subscription_id") val subscriptionId: String? = null,
    @SerialName("routine_id") val routineId: String? = null,
    @SerialName("connection_id") val connectionId: String? = null,
    @SerialName("has_routine_token") val hasRoutineToken: Boolean = false,
)

@Serializable
data class AiTaskSettingsEnvelope(val data: List<AiTaskSettings>)

@Serializable
data class AiTaskConnection(
    val id: String,
    val label: String,
    @SerialName("expires_at") val expiresAt: String? = null,
)

@Serializable
data class AiTaskConnections(
    val subscriptions: List<AiTaskConnection> = emptyList(),
    val connections: List<AiTaskConnection> = emptyList(),
)

@Serializable
data class AiTaskContext(val text: String)

@Serializable
data class AiExecution(
    val id: String,
    val method: AiTaskMethod,
    val status: String,
    @SerialName("session_url") val sessionUrl: String? = null,
    @SerialName("retry_at") val retryAt: String? = null,
    @SerialName("result_comment_id") val resultCommentId: String? = null,
) {
    val pending: Boolean get() = status == "queued" || status == "sending"
}

@Serializable
data class AiExecutionsEnvelope(val data: List<AiExecution>)
