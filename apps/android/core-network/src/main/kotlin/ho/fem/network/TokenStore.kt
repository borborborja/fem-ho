package ho.fem.network

import ho.fem.model.AuthTokens
import kotlinx.coroutines.sync.Mutex

/**
 * On viuen els testimonis de sessió.
 *
 * És una interfície i no una classe perquè **les proves no han de tocar el magatzem
 * xifrat d'Android**: `FemhoApi` es prova amb un magatzem en memòria contra un servidor
 * fals, i la implementació real viu a `:core-data`, que ja depèn del context.
 */
interface TokenStore {
    val refreshLock: Mutex
    fun access(): String?
    fun refresh(): String?
    fun save(tokens: AuthTokens)
    fun clear()
}

/** Magatzem en memòria. Per a proves i per al període abans d'iniciar sessió. */
class InMemoryTokenStore(@Volatile private var tokens: AuthTokens? = null) : TokenStore {
    override val refreshLock = Mutex()
    override fun access(): String? = tokens?.accessToken
    override fun refresh(): String? = tokens?.refreshToken
    override fun save(tokens: AuthTokens) { this.tokens = tokens }
    override fun clear() { tokens = null }
}
