package ho.fem.network

import java.net.InetSocketAddress
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.cert.X509Certificate
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocket
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager

/**
 * Llegeix el certificat que un servidor presenta, sense validar-ne la cadena, només per
 * ensenyar-ne l'empremta a la pantalla de confirmació (docs/03 §2:38).
 *
 * És una **sonda**: obre una connexió TLS, llegeix el certificat i la tanca. L'app mai
 * l'usa per a dades reals — la connexió de veritat fa servir el certificat que l'usuari
 * ha confirmat, que és exactament el que diu l'empremta. El TrustManager que ho accepta
 * tot viu només aquí, i no es compila a cap client.
 */
fun probeServerCertificate(host: String, port: Int): X509Certificate? = runCatching {
    val trustAll = arrayOf<TrustManager>(object : X509TrustManager {
        override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) = Unit
        override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) = Unit
        override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
    })
    val context = SSLContext.getInstance("TLS").apply { init(null, trustAll, SecureRandom()) }
    val socket = context.socketFactory.createSocket() as SSLSocket
    socket.connect(InetSocketAddress(host, port), 5000)
    socket.soTimeout = 5000
    socket.startHandshake()
    val cert = socket.session.peerCertificates.firstOrNull() as? X509Certificate
    socket.close()
    cert
}.getOrNull()

/** Empremta SHA-256 del certificat, en hex separada per dos punts (format clàssic). */
fun certificateFingerprint(cert: X509Certificate): String {
    val digest = MessageDigest.getInstance("SHA-256").digest(cert.encoded)
    return digest.joinToString(":") { "%02X".format(it) }
}
