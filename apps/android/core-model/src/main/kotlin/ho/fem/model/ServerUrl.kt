package ho.fem.model

import kotlinx.serialization.Serializable

/**
 * El camp de servidor del login (docs/03 §2).
 *
 * **És la diferència més important amb la web**, i el prototip mòbil no la té. El brief
 * ho demana a la línia 4: *"la app mòbil a la pantalla de login ha de deixar escriure el
 * servidor"*.
 *
 * Aquesta lògica és Kotlin pur i no toca la xarxa: així es pot provar sense emulador, i
 * la pantalla de Compose només ha de pintar el que digui.
 */

/** Els candidats a provar, en ordre, per al que ha escrit l'usuari. */
data class ServerCandidates(
    val candidates: List<String>,
    /** Cert si algun candidat és `http://`, que sempre ha de sortir amb avís. */
    val hasInsecure: Boolean,
    val error: String? = null,
)

/**
 * Un amfitrió d'una xarxa privada?
 *
 * **Només aquí es pot oferir `http://`.** A internet, caure a `http` sense avisar és
 * enviar la contrasenya en clar; a la xarxa de casa, on molta gent no té certificat, és
 * el cas normal — i s'ofereix igualment amb avís, mai en silenci.
 */
internal fun isPrivateHost(host: String): Boolean {
    val h = host.lowercase().trim('[', ']')

    if (h == "localhost" || h.endsWith(".local") || h.endsWith(".home") || h.endsWith(".lan")) {
        return true
    }
    if (h == "::1" || h.startsWith("fe80") || h.startsWith("fc") || h.startsWith("fd")) return true

    val parts = h.split('.')
    if (parts.size != 4 || parts.any { it.toIntOrNull() == null }) return false
    val (a, b) = parts[0].toInt() to parts[1].toInt()

    return when {
        a == 10 -> true
        a == 127 -> true
        a == 172 && b in 16..31 -> true
        a == 192 && b == 168 -> true
        a == 169 && b == 254 -> true
        else -> false
    }
}

private val VALID_HOST = Regex("^[A-Za-z0-9._~%\\-\\[\\]:]+$")

/**
 * Els URL a provar per al que ha escrit l'usuari.
 *
 * Accepta `femho.example.com`, `https://femho.example.com` i
 * `https://example.com/femho`. **Sense esquema es prova primer `https://`**, i només
 * s'ofereix `http://` si l'amfitrió és d'una xarxa privada.
 */
fun serverCandidates(input: String): ServerCandidates {
    val raw = input.trim().trimEnd('/')
    if (raw.isEmpty()) {
        return ServerCandidates(emptyList(), false, "Cal escriure el servidor.")
    }

    // Amb esquema explícit, es respecta: qui escriu `http://` sap què fa, però se li
    // avisa igual.
    if (raw.startsWith("https://") || raw.startsWith("http://")) {
        val host = hostOf(raw)
        if (host == null || !VALID_HOST.matches(host)) {
            return ServerCandidates(emptyList(), false, "Això no sembla una adreça de servidor.")
        }
        return ServerCandidates(listOf(raw), raw.startsWith("http://"))
    }

    if (raw.contains("://")) {
        // `ftp://`, `file://`… no serveixen per a res aquí i val més dir-ho.
        return ServerCandidates(emptyList(), false, "Només s'hi pot connectar per https o http.")
    }

    val host = hostOf("https://$raw")
    if (host == null || !VALID_HOST.matches(host)) {
        return ServerCandidates(emptyList(), false, "Això no sembla una adreça de servidor.")
    }

    val secure = "https://$raw"
    return if (isPrivateHost(host)) {
        // A la xarxa de casa, `http` és el cas normal i s'ofereix **després** del segur.
        ServerCandidates(listOf(secure, "http://$raw"), true)
    } else {
        ServerCandidates(listOf(secure), false)
    }
}

private fun hostOf(url: String): String? {
    val afterScheme = url.substringAfter("://", "")
    if (afterScheme.isEmpty()) return null
    val authority = afterScheme.substringBefore('/')
    if (authority.isEmpty()) return null

    // Es treuen credencials i port. Un IPv6 va entre claudàtors i no s'ha de partir pels
    // seus dos punts.
    val withoutUser = authority.substringAfterLast('@')
    return if (withoutUser.startsWith("[")) {
        withoutUser.substringBefore(']') + "]"
    } else {
        withoutUser.substringBefore(':')
    }
}

/** El que respon `GET /info`, retallat al que la pantalla de login necessita. */
@Serializable
data class InstanceInfo(
    val name: String,
    val version: String,
    /** `open`, `invite` o `disabled` (docs/12 §3). Decideix si s'ofereix registrar-se. */
    val registration: String = "disabled",
)

/**
 * L'app és prou nova per a aquesta instància?
 *
 * "L'app comprova la versió de la instància en connectar-se i avisa si el servidor és
 * més nou que ella, amb enllaç a la descàrrega. **No s'actualitza sola.**" (docs/03 §11)
 */
fun serverIsNewer(appVersion: String, serverVersion: String): Boolean =
    compareVersions(serverVersion, appVersion) > 0

/** Compara `1.2.3` amb `1.10.0` numèricament, no com a text. */
internal fun compareVersions(a: String, b: String): Int {
    val left = a.substringBefore('-').split('.').map { it.toIntOrNull() ?: 0 }
    val right = b.substringBefore('-').split('.').map { it.toIntOrNull() ?: 0 }

    for (i in 0 until maxOf(left.size, right.size)) {
        val l = left.getOrElse(i) { 0 }
        val r = right.getOrElse(i) { 0 }
        if (l != r) return if (l > r) 1 else -1
    }

    // Amb el mateix número, una versió amb sufix (`-rc1`) és ANTERIOR a la neta.
    val suffixA = a.substringAfter('-', "")
    val suffixB = b.substringAfter('-', "")
    return when {
        suffixA == suffixB -> 0
        suffixA.isEmpty() -> 1
        suffixB.isEmpty() -> -1
        else -> suffixA.compareTo(suffixB)
    }
}
