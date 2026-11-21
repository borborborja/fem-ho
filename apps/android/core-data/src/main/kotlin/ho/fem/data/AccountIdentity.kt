package ho.fem.data

import java.net.URI
import java.security.MessageDigest
import java.util.Locale

fun normalizeServerUrl(value: String): String {
    val uri = URI(value.trim()).normalize()
    val scheme = uri.scheme?.lowercase(Locale.ROOT)
    val host = uri.host?.lowercase(Locale.ROOT)
    require((scheme == "https" || scheme == "http") && host != null && uri.rawUserInfo == null &&
        uri.rawQuery == null && uri.rawFragment == null) { "Invalid server URL" }
    val port = when {
        uri.port == -1 || scheme == "https" && uri.port == 443 || scheme == "http" && uri.port == 80 -> ""
        else -> ":${uri.port}"
    }
    return "$scheme://$host$port${uri.rawPath.trimEnd('/')}"
}

data class AccountIdentity(val serverUrl: String, val userId: String) {
    val key: String = MessageDigest.getInstance("SHA-256")
        .digest("${normalizeServerUrl(serverUrl)}\u0000$userId".toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it) }
}

/** El marcador de sessió evita que una crida en cua prengui les credencials d'un altre login. */
@ConsistentCopyVisibility
data class ActiveAccount internal constructor(val identity: AccountIdentity, val generation: String)
