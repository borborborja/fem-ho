package ho.fem.data

import android.content.Context
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import androidx.room.Room
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import ho.fem.model.AuthTokens
import ho.fem.network.FemhoApi
import ho.fem.network.TokenStore
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
    val tokens: TokenStore = EncryptedTokenStore(app)

    private val database: FemhoDatabase = Room
        .databaseBuilder(app, FemhoDatabase::class.java, "femho.db")
        // Sense migracions destructives: la base local és una memòria cau, però la cua
        // de sortida NO ho és, i esborrar-la perdria escriptures que ningú ha vist.
        .addMigrations(FemhoDatabase.MIGRATION_1_2)
        .build()

    /**
     * El servidor pot canviar sense reinstal·lar res, i per això el client es construeix
     * a cada ús amb la base actual en comptes de guardar-se'n una còpia.
     */
    fun api(baseUrl: String): FemhoApi = FemhoApi(baseUrl, tokens)

    fun repository(baseUrl: String): Repository = Repository(database.dao(), api(baseUrl))

    /**
     * Lectura local sense servidor, per als widgets. `database` i `dao()` es queden
     * privats: la porta és de només lectura i és l'única que hi ha.
     */
    val local: LocalReads = LocalReads(database.dao())

    /**
     * El repositori amb el servidor configurat, o `null` si encara no n'hi ha cap.
     *
     * Els widgets i els treballadors s'executen sense saber si algú ha configurat mai la
     * instància. `repository(baseUrl)` els obligaria a llegir el DataStore pel seu
     * compte i a inventar-se què fer amb el `null`; així la resposta és una i és la
     * mateixa a tot arreu.
     */
    suspend fun repositoryOrNull(): Repository? =
        settings.serverUrl.first()?.let { repository(it) }

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
class Settings(private val context: Context) {
    private val serverKey = stringPreferencesKey("server_url")
    private val scopesKey = stringPreferencesKey("active_scopes")

    /**
     * Els projectes que es veuen. **Buit vol dir tots** (`docs/14` P7).
     *
     * A la web viu a la URL, que allà és l'estat compartible d'una pantalla. Aquí no hi
     * ha URL: va a les preferències, com els àmbits actius, i per la mateixa raó —qui
     * torna a obrir l'app es troba el tauler tal com el va deixar.
     */
    private val projectsKey = stringPreferencesKey("active_projects")
    private val themeKey = stringPreferencesKey("theme")
    private val accentKey = stringPreferencesKey("accent")
    // Preferències de la pestanya General (paritat amb la web)
    private val localeKey = stringPreferencesKey("locale")
    private val weekStartKey = stringPreferencesKey("week_start")
    private val eventTaskDeletedKey = stringPreferencesKey("event_task_deleted")
    private val showCalendarWidgetKey = booleanPreferencesKey("show_calendar_widget")
    private val showOverdueSectionKey = booleanPreferencesKey("show_overdue_section")
    private val inboxPositionKey = stringPreferencesKey("inbox_position")
    private val inboxShowOverdueKey = booleanPreferencesKey("inbox_show_overdue")

    val serverUrl: Flow<String?> = read(serverKey)
    val activeScopes: Flow<List<String>> =
        read(scopesKey).map { it?.split(",")?.filter(String::isNotEmpty) ?: emptyList() }
    val activeProjects: Flow<List<String>> =
        read(projectsKey).map { it?.split(",")?.filter(String::isNotEmpty) ?: emptyList() }
    val theme: Flow<String> = read(themeKey).map { it ?: "system" }
    val accent: Flow<String> = read(accentKey).map { it ?: "default" }
    val locale: Flow<String> = read(localeKey).map { it ?: "ca" }
    val weekStart: Flow<String> = read(weekStartKey).map { it ?: "auto" }
    val eventTaskDeleted: Flow<String> = read(eventTaskDeletedKey).map { it ?: "return_to_inbox" }
    val showCalendarWidget: Flow<Boolean> = readBoolean(showCalendarWidgetKey).map { it ?: true }
    val showOverdueSection: Flow<Boolean> = readBoolean(showOverdueSectionKey).map { it ?: true }
    val inboxPosition: Flow<String> = read(inboxPositionKey).map { it ?: "right" }
    val inboxShowOverdue: Flow<Boolean> = readBoolean(inboxShowOverdueKey).map { it ?: true }

    private fun read(key: Preferences.Key<String>): Flow<String?> =
        context.dataStore.data.map { it[key] }

    private fun readBoolean(key: Preferences.Key<Boolean>): Flow<Boolean?> =
        context.dataStore.data.map { it[key] }

    suspend fun setServerUrl(value: String) = write(serverKey, value)
    suspend fun setActiveScopes(value: List<String>) = write(scopesKey, value.joinToString(","))
    suspend fun setActiveProjects(value: List<String>) = write(projectsKey, value.joinToString(","))
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

    private suspend fun write(key: Preferences.Key<String>, value: String) {
        context.dataStore.edit { it[key] = value }
    }

    private suspend fun writeBoolean(key: Preferences.Key<Boolean>, value: Boolean) {
        context.dataStore.edit { it[key] = value }
    }
}

/**
 * Els testimonis, xifrats amb la clau del dispositiu.
 *
 * `EncryptedSharedPreferences` i no `DataStore`: el que cal aquí és xifratge en repòs
 * lligat al magatzem de claus del dispositiu, i és l'única peça d'AndroidX que el dona
 * sense muntar-lo a mà. Un testimoni de refresc en clar al disc val tant com la
 * contrasenya.
 */
private class EncryptedTokenStore(context: Context) : TokenStore {
    private val prefs = EncryptedSharedPreferences.create(
        context,
        "femho-tokens",
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    override fun access(): String? = prefs.getString("access", null)
    override fun refresh(): String? = prefs.getString("refresh", null)

    override fun save(tokens: AuthTokens) {
        prefs.edit()
            .putString("access", tokens.accessToken)
            .putString("refresh", tokens.refreshToken)
            .apply()
    }

    override fun clear() {
        prefs.edit().clear().apply()
    }
}
