package ho.fem.data

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import ho.fem.model.AuthTokens
import ho.fem.network.TokenStore
import java.util.UUID
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.sync.Mutex

/** El servidor i el compte es desen amb els testimonis, de manera indivisible. */
internal class AccountSessions(context: Context) {
    private val preferences by lazy {
        // El procés pot arrencar abans del primer desbloqueig si el llançador vol un widget.
        EncryptedSharedPreferences.create(
            context,
            "femho-tokens",
            MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    private val refreshLock = Mutex()
    private val expired = MutableSharedFlow<ActiveAccount>(extraBufferCapacity = 1)
    val expirations = expired.asSharedFlow()

    @Synchronized
    fun active(): ActiveAccount? {
        val server = preferences.getString("account_server", null) ?: return null
        val user = preferences.getString("account_user", null) ?: return null
        val generation = preferences.getString("session_generation", null) ?: return null
        if (preferences.getString("refresh", null) == null) return null
        return ActiveAccount(AccountIdentity(server, user), generation)
    }

    @Synchronized
    fun start(identity: AccountIdentity, tokens: AuthTokens): ActiveAccount {
        val account = ActiveAccount(identity, UUID.randomUUID().toString())
        check(preferences.edit()
            .putString("account_server", identity.serverUrl)
            .putString("account_user", identity.userId)
            .putString("session_generation", account.generation)
            .putString("access", tokens.accessToken)
            .putString("refresh", tokens.refreshToken)
            .commit())
        return account
    }

    @Synchronized
    fun end(account: ActiveAccount): AuthTokens? {
        if (active() != account) return null
        val access = preferences.getString("access", null)
        val refresh = preferences.getString("refresh", null)
        check(preferences.edit().clear().commit())
        return if (access != null && refresh != null) AuthTokens(access, refresh) else null
    }

    fun tokensFor(account: ActiveAccount): TokenStore = object : TokenStore {
        override val refreshLock = this@AccountSessions.refreshLock

        override fun access(): String? = token(account, "access")
        override fun refresh(): String? = token(account, "refresh")
        override fun save(tokens: AuthTokens) {
            synchronized(this@AccountSessions) {
                if (active() != account) return
                check(preferences.edit()
                    .putString("access", tokens.accessToken)
                    .putString("refresh", tokens.refreshToken)
                    .commit())
            }
        }

        override fun clear() {
            if (end(account) != null) expired.tryEmit(account)
        }
    }

    @Synchronized
    private fun token(account: ActiveAccount, name: String): String? =
        if (active() == account) preferences.getString(name, null) else null
}
