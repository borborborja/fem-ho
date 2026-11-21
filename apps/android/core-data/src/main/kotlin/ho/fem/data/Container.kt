package ho.fem.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import androidx.room.Room
import ho.fem.model.AuthSettingsEnvelope
import ho.fem.model.AuthTokens
import ho.fem.network.FemhoApi
import ho.fem.network.InMemoryTokenStore
import ho.fem.network.TokenStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.util.concurrent.ConcurrentHashMap
import java.util.UUID
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

/**
 * Les dependències, muntades a mà.
 *
 * Sense Hilt ni Koin: l'app té una base de dades, un client d'HTTP i un repositori, i
 * un contenidor d'injecció per a tres objectes és més codi de configuració que de
 * producte. El dia que en siguin trenta, es reconsidera.
 */
class Container(context: Context) {
    private val app = context.applicationContext

    /** El context d'aplicació. Cal per als serveis del sistema, com el d'idioma. */
    val appContext: Context get() = app

    val settings: Settings = Settings(app)
    private val sessions = AccountSessions(app)
    val expiredAccounts = sessions.expirations
    private val sessionChangeLock = Mutex()

    private class Workspace(val database: FemhoDatabase) {
        val syncLock = Mutex()
        val moveLock = Mutex()
        val doneSettingsLock = Mutex()
    }

    private val workspaces = ConcurrentHashMap<String, Workspace>()

    private fun workspace(account: ActiveAccount): Workspace =
        workspaces.computeIfAbsent(account.identity.key) {
            // L'antic femho.db no té cap marca de propietat. Es conserva sencer i
            // no s'obre en nom de cap compte: una cua antiga no es pot atribuir amb seguretat.
            Workspace(Room.databaseBuilder(app, FemhoDatabase::class.java, "femho-${account.identity.key}.db")
                .addMigrations(FemhoDatabase.MIGRATION_1_2, FemhoDatabase.MIGRATION_2_3, FemhoDatabase.MIGRATION_3_4, FemhoDatabase.MIGRATION_4_5)
                .build())
        }

    fun account(): ActiveAccount? = runCatching(sessions::active).getOrNull()

    /** En obrir l'app, una fallada del Keystore és diferent de no tenir cap sessió. */
    suspend fun restoreAccount(): ActiveAccount? = withContext(Dispatchers.IO) { sessions.active() }

    suspend fun hasLegacySession(): Boolean = withContext(Dispatchers.IO) { sessions.legacyTokenStore() != null }

    suspend fun recoverLegacySession(serverUrl: String): ActiveAccount? = sessionChangeLock.withLock {
        withContext(Dispatchers.IO) {
            sessions.active()?.let { return@withContext it }
            val legacy = sessions.legacyTokenStore() ?: return@withContext null
            val base = normalizeServerUrl(serverUrl)
            check(settings.serverUrl.first()?.let(::normalizeServerUrl) == base)
            java.net.URI(base).host?.let { settings.trustedCert(it) }

            // El client antic només desava els testimonis i el seu servidor. Confirma
            // la identitat al mateix servidor abans d'obrir una base de dades per compte.
            val user = try {
                client(base, legacy, followRedirects = false).profile()
            } catch (error: FemhoApi.ApiException) {
                if (error.status == 401 && legacy.refresh() == null) return@withContext null
                throw error
            }
            sessions.bindLegacy(AccountIdentity(base, user.id))
        }
    }

    suspend fun discardLegacySession() = sessionChangeLock.withLock {
        withContext(Dispatchers.IO) { sessions.legacyTokenStore()?.clear() }
    }

    fun api(baseUrl: String): FemhoApi = client(baseUrl, InMemoryTokenStore())

    fun api(account: ActiveAccount): FemhoApi =
        client(account.identity.serverUrl, sessions.tokensFor(account))

    suspend fun refreshUserSettings(account: ActiveAccount): AuthSettingsEnvelope =
        workspace(account).doneSettingsLock.withLock {
            api(account).settings().also { settings.cacheDoneClearedAt(account, it.settings.doneClearedAt) }
        }

    suspend fun setDoneClearedAt(account: ActiveAccount, value: String?) {
        // L'escriptura i el refresc comparteixen el pany perquè un GET en vol no pugui
        // restaurar a la memòria cau una neteja anterior a la que acaba de confirmar el PATCH.
        workspace(account).doneSettingsLock.withLock {
            val updated = api(account).setDoneClearedAt(value)
            settings.cacheDoneClearedAt(account, updated.doneClearedAt)
        }
    }

    suspend fun authenticate(baseUrl: String, login: suspend (FemhoApi) -> AuthTokens): ActiveAccount =
        sessionChangeLock.withLock {
            val base = normalizeServerUrl(baseUrl)
            val pending = InMemoryTokenStore()
            val api = client(base, pending)
            login(api)
            val userId = api.profile().id
            val credentials = AuthTokens(checkNotNull(pending.access()), checkNotNull(pending.refresh()))
            val identity = AccountIdentity(base, userId)
            settings.setServerUrl(base)
            withContext(Dispatchers.IO) { sessions.start(identity, credentials) }
        }

    suspend fun logout(account: ActiveAccount, onLocalLogout: suspend () -> Unit) {
        val previous = sessionChangeLock.withLock {
            withContext(Dispatchers.IO) { sessions.end(account) }
        }
        onLocalLogout()
        if (previous != null) client(account.identity.serverUrl, InMemoryTokenStore(previous)).logout()
    }

    fun repository(account: ActiveAccount): Repository {
        val workspace = workspace(account)
        return Repository(workspace.database.dao(), api(account), workspace.syncLock, workspace.moveLock, account.identity.userId)
    }

    fun local(account: ActiveAccount): LocalReads = LocalReads(workspace(account).database.dao())

    private fun client(baseUrl: String, tokens: TokenStore, followRedirects: Boolean = true): FemhoApi {
        val der = runCatching {
            val host = java.net.URI(baseUrl).host ?: return@runCatching null
            val b64 = settings.trustedCertCache[host] ?: return@runCatching null
            android.util.Base64.decode(b64, android.util.Base64.NO_WRAP)
        }.getOrNull()
        return FemhoApi(baseUrl, tokens, der, followRedirects)
    }

    companion object {
        @Volatile
        private var instance: Container? = null

        /**
         * L'única instància del procés.
         *
         * El sistema desperta el procés per pintar un widget o per executar un treball
         * sense passar per cap `Activity`, i `FemhoApplication` viu a `:app`, que un
         * mòdul de funcionalitat no pot referenciar. Construir un segon `Container`
         * obriria una segona connexió de Room sobre el mateix fitxer.
         *
         * `Application.onCreate()` corre abans que qualsevol receptor o treballador, o
         * sigui que quan això es crida el contenidor ja hi és gairebé sempre; el
         * `synchronized` és per al gairebé.
         */
        fun get(context: Context): Container = instance ?: synchronized(this) {
            instance ?: Container(context).also { instance = it }
        }
    }
}

private val Context.dataStore by preferencesDataStore(name = "femho")

/**
 * Les preferències que **no** són secretes: la URL del servidor, els àmbits actius, el
 * tema. Els testimonis van a un altre lloc, xifrats.
 */
class Settings internal constructor(private val dataStore: DataStore<Preferences>) {
    constructor(context: Context) : this(context.dataStore)

    private val serverKey = stringPreferencesKey("server_url")
    private val scopesKey = "active_scopes"

    /**
     * Els projectes que es veuen. **Buit vol dir tots** (`docs/14` P7).
     *
     * A la web viu a la URL, que allà és l'estat compartible d'una pantalla. Aquí no hi
     * ha URL: va a les preferències, com els àmbits actius, i per la mateixa raó —qui
     * torna a obrir l'app es troba el tauler tal com el va deixar.
     */
    private val projectsKey = "active_projects"
    private val themeKey = stringPreferencesKey("theme")
    private val accentKey = stringPreferencesKey("accent")
    // Preferències de la pestanya General (paritat amb la web)
    private val scopeModeKey = stringPreferencesKey("scope_mode")
    private val localeKey = stringPreferencesKey("locale")
    private val weekStartKey = stringPreferencesKey("week_start")
    private val eventTaskDeletedKey = stringPreferencesKey("event_task_deleted")
    private val showCalendarWidgetKey = booleanPreferencesKey("show_calendar_widget")
    private val showOverdueSectionKey = booleanPreferencesKey("show_overdue_section")
    private val inboxPositionKey = stringPreferencesKey("inbox_position")
    private val inboxShowOverdueKey = booleanPreferencesKey("inbox_show_overdue")

    val serverUrl: Flow<String?> = read(serverKey)
    private fun accountKey(name: String, account: ActiveAccount): Preferences.Key<String> =
        stringPreferencesKey("${name}_${account.identity.key}")

    private fun decodeAccountList(value: String?): List<String> =
        value?.split(",")?.filter(String::isNotEmpty).orEmpty()

    private fun readAccountList(name: String, account: ActiveAccount): Flow<List<String>> =
        read(accountKey(name, account)).map(::decodeAccountList)

    fun activeScopeSelection(account: ActiveAccount): Flow<List<String>> =
        readAccountList(scopesKey, account)

    suspend fun activeScopes(account: ActiveAccount): List<String> = activeScopeSelection(account).first()

    suspend fun toggleActiveScope(account: ActiveAccount, id: String) {
        val key = accountKey(scopesKey, account)
        dataStore.edit { preferences ->
            val selected = preferences[key]?.split(",")?.filter(String::isNotBlank).orEmpty()
            val next = if (id in selected) selected - id else selected + id
            preferences[key] = next.joinToString(",")
        }
    }

    suspend fun cachedLocale(account: ActiveAccount): String? =
        read(accountKey("profile_locale", account)).first()

    suspend fun cachedTimezone(account: ActiveAccount): String? =
        read(accountKey("profile_timezone", account)).first()

    suspend fun cacheProfilePresentation(account: ActiveAccount, locale: String, timezone: String) {
        dataStore.edit {
            it[accountKey("profile_locale", account)] = locale
            it[accountKey("profile_timezone", account)] = timezone
        }
    }

    fun doneClearedAt(account: ActiveAccount): Flow<String?> = read(accountKey("done_cleared_at", account))

    internal suspend fun cacheDoneClearedAt(account: ActiveAccount, value: String?) {
        val key = accountKey("done_cleared_at", account)
        dataStore.edit { preferences ->
            if (value == null) preferences.remove(key) else preferences[key] = value
        }
    }

    suspend fun pomodoroDeviceId(account: ActiveAccount): String {
        val key = accountKey("pomodoro_device", account)
        return checkNotNull(dataStore.edit { if (it[key] == null) it[key] = UUID.randomUUID().toString() }[key])
    }

    suspend fun claimPomodoroSignal(account: ActiveAccount, signal: String): Boolean {
        val key = accountKey("pomodoro_signal", account)
        var claimed = false
        dataStore.edit {
            if (it[key] != signal) {
                it[key] = signal
                claimed = true
            }
        }
        return claimed
    }

    fun activeProjects(account: ActiveAccount): Flow<List<String>> = readAccountList(projectsKey, account)
    val theme: Flow<String> = read(themeKey).map { it ?: "system" }
    val accent: Flow<String> = read(accentKey).map { it ?: "default" }
    val scopeMode: Flow<String> = read(scopeModeKey).map { it ?: "multi" }
    suspend fun setScopeMode(value: String) = write(scopeModeKey, value)
    val locale: Flow<String> = read(localeKey).map { it ?: "ca" }
    val weekStart: Flow<String> = read(weekStartKey).map { it ?: "auto" }
    val eventTaskDeleted: Flow<String> = read(eventTaskDeletedKey).map { it ?: "return_to_inbox" }
    val showCalendarWidget: Flow<Boolean> = readBoolean(showCalendarWidgetKey).map { it ?: true }
    val showOverdueSection: Flow<Boolean> = readBoolean(showOverdueSectionKey).map { it ?: true }
    val inboxPosition: Flow<String> = read(inboxPositionKey).map { it ?: "right" }
    val inboxShowOverdue: Flow<Boolean> = readBoolean(inboxShowOverdueKey).map { it ?: true }

    private fun read(key: Preferences.Key<String>): Flow<String?> =
        dataStore.data.map { it[key] }

    private fun readBoolean(key: Preferences.Key<Boolean>): Flow<Boolean?> =
        dataStore.data.map { it[key] }

    suspend fun setServerUrl(value: String) = write(serverKey, value)
    suspend fun setActiveScopes(account: ActiveAccount, value: List<String>) =
        write(accountKey(scopesKey, account), value.joinToString(","))

    suspend fun toggleActiveProject(account: ActiveAccount, id: String) {
        updateActiveProjects(account) { selected -> if (id in selected) selected - id else selected + id }
    }

    suspend fun clearActiveProjects(account: ActiveAccount, ids: Set<String>) {
        if (ids.isNotEmpty()) updateActiveProjects(account) { selected -> selected.filterNot { it in ids } }
    }

    private suspend fun updateActiveProjects(account: ActiveAccount, update: (List<String>) -> List<String>) {
        val key = accountKey(projectsKey, account)
        // Dos tocs seguits han de llegir la tria dins de la mateixa transacció que l'escriu.
        dataStore.edit { preferences ->
            val selected = decodeAccountList(preferences[key])
            preferences[key] = update(selected).joinToString(",")
        }
    }

    suspend fun setTheme(value: String) = write(themeKey, value)
    suspend fun setAccent(value: String) = write(accentKey, value)
    // Preferències de la pestanya General
    suspend fun setLocale(value: String) = write(localeKey, value)
    suspend fun setWeekStart(value: String) = write(weekStartKey, value)
    suspend fun setEventTaskDeleted(value: String) = write(eventTaskDeletedKey, value)
    suspend fun setShowCalendarWidget(value: Boolean) = writeBoolean(showCalendarWidgetKey, value)
    suspend fun setShowOverdueSection(value: Boolean) = writeBoolean(showOverdueSectionKey, value)
    suspend fun setInboxPosition(value: String) = write(inboxPositionKey, value)
    suspend fun setInboxShowOverdue(value: Boolean) = writeBoolean(inboxShowOverdueKey, value)

    /** Certificat confiat per empremta, guardat per host (docs/03 §2:38). */
    fun trustedCertKey(host: String): Preferences.Key<String> = stringPreferencesKey("trusted_cert_$host")

    /**
     * Caché en memòria dels certificats confirmats: `api()` és síncrona i no pot llegir
     * DataStore, així que el que hi ha confirmat viu aquí i es persisteix en paral·lel.
     */
    internal val trustedCertCache = ConcurrentHashMap<String, String>()

    suspend fun setTrustedCert(host: String, derB64: String) {
        trustedCertCache[host] = derB64
        write(trustedCertKey(host), derB64)
    }

    suspend fun trustedCert(host: String): String? {
        trustedCertCache[host]?.let { return it }
        val stored = read(trustedCertKey(host)).first()
        if (stored != null) trustedCertCache[host] = stored
        return stored
    }

    private suspend fun write(key: Preferences.Key<String>, value: String) {
        dataStore.edit { it[key] = value }
    }

    private suspend fun writeBoolean(key: Preferences.Key<Boolean>, value: Boolean) {
        dataStore.edit { it[key] = value }
    }
}
