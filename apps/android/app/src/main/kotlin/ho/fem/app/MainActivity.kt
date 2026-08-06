package ho.fem.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import ho.fem.R
import ho.fem.designsystem.Femho
import ho.fem.designsystem.FemhoSize
import ho.fem.designsystem.FemhoText
import ho.fem.designsystem.FemhoTheme
import ho.fem.designsystem.ScopeChip
import ho.fem.model.Scope
import ho.fem.model.TaskStatus
import ho.fem.settings.SettingsLabels
import ho.fem.settings.SettingsScreen
import ho.fem.tasks.BoardLabels
import ho.fem.tasks.BoardScreen

/**
 * L'activitat única. docs/03.
 *
 * Tres destins i prou —login, tauler i ajustos—, i per això la navegació és un `when`
 * sobre l'estat de sessió i una pantalla actual. `navigation-compose` porta un graf,
 * arguments tipats i una pila que aquí no s'usaria; el dia que hi hagi deu pantalles, es
 * reconsidera.
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        val container = (application as FemhoApplication).container

        setContent {
            val model: AppViewModel = viewModel(
                factory = object : ViewModelProvider.Factory {
                    @Suppress("UNCHECKED_CAST")
                    override fun <T : androidx.lifecycle.ViewModel> create(modelClass: Class<T>): T =
                        AppViewModel(container) as T
                },
            )

            val theme by model.theme.collectAsStateWithLifecycle()
            val accent by model.accent.collectAsStateWithLifecycle()

            FemhoTheme(theme = theme, accent = accent) {
                Box(
                    Modifier
                        .fillMaxSize()
                        .background(Femho.pageBackground)
                        .safeDrawingPadding(),
                ) {
                    Root(model)
                }
            }
        }
    }
}

private enum class Screen { BOARD, SETTINGS }

@Composable
private fun Root(model: AppViewModel) {
    val session by model.session.collectAsStateWithLifecycle()
    var screen by remember { mutableStateOf(Screen.BOARD) }

    when (val state = session) {
        is AppViewModel.Session.Checking -> Loading()

        is AppViewModel.Session.NeedsServer -> ServerScreen(model, state.message)

        is AppViewModel.Session.NeedsLogin -> LoginScreen(model, state.instanceName)

        is AppViewModel.Session.Ready -> when (screen) {
            Screen.BOARD -> BoardHost(model, onSettings = { screen = Screen.SETTINGS })
            Screen.SETTINGS -> SettingsHost(
                model = model,
                serverUrl = state.serverUrl,
                onBack = { screen = Screen.BOARD },
            )
        }
    }
}

@Composable
private fun Loading() {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Text(stringResource(R.string.state_loading), color = Femho.colors.inkFaint)
    }
}

@Composable
private fun Wordmark(modifier: Modifier = Modifier) {
    Text(
        text = stringResource(R.string.app_name),
        fontSize = FemhoText.wordmark,
        fontWeight = FontWeight.Black,
        color = Femho.colors.plouOrange,
        modifier = modifier,
    )
}

/**
 * El camp de servidor. docs/03 §2.
 *
 * **És la diferència deliberada amb la web**, que no en té: allà el servidor és el que
 * serveix la pàgina; aquí l'APK no sap on és la instància fins que l'hi diuen. Es valida
 * amb `GET /info` **abans** de demanar credencials, perquè ningú escrigui la contrasenya
 * en un lloc que no és el seu servidor.
 */
@Composable
private fun ServerScreen(model: AppViewModel, message: String?) {
    var value by remember { mutableStateOf("") }
    var insecure by remember { mutableStateOf<String?>(null) }

    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp).testTag("server-screen"),
        verticalArrangement = Arrangement.spacedBy(14.dp, Alignment.CenterVertically),
    ) {
        Wordmark()
        Text(
            stringResource(R.string.login_serverhint),
            color = Femho.colors.inkSoft,
            fontSize = FemhoText.body,
        )

        androidx.compose.material3.OutlinedTextField(
            value = value,
            onValueChange = { value = it },
            singleLine = true,
            label = { Text(stringResource(R.string.login_server)) },
            modifier = Modifier.fillMaxWidth().testTag("server-input"),
        )

        if (message != null) {
            Text(
                stringResource(R.string.login_serverunreachable),
                color = Femho.colors.dangerText,
                fontSize = FemhoText.body,
                modifier = Modifier.testTag("server-error"),
            )
        }

        // L'avís d'`http://` no és decoratiu: `network_security_config.xml` només el
        // permet en xarxes privades, i aquí es diu abans d'escriure cap contrasenya.
        insecure?.let {
            Text(
                stringResource(R.string.login_insecure),
                color = Femho.colors.dangerText,
                fontSize = FemhoText.meta,
                modifier = Modifier.testTag("server-insecure"),
            )
        }

        androidx.compose.material3.Button(
            onClick = { model.checkServer(value) { insecure = it } },
            modifier = Modifier.fillMaxWidth().testTag("server-check"),
        ) {
            Text(stringResource(R.string.login_checkserver))
        }
    }
}

@Composable
private fun LoginScreen(model: AppViewModel, instanceName: String) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }

    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp).testTag("login-screen"),
        verticalArrangement = Arrangement.spacedBy(14.dp, Alignment.CenterVertically),
    ) {
        Wordmark()
        Text(
            text = instanceName.ifEmpty { stringResource(R.string.login_subtitle) },
            color = Femho.colors.inkSoft,
            fontSize = FemhoText.body,
        )

        androidx.compose.material3.OutlinedTextField(
            value = email,
            onValueChange = { email = it },
            singleLine = true,
            label = { Text(stringResource(R.string.login_email)) },
            modifier = Modifier.fillMaxWidth().testTag("login-email"),
        )
        androidx.compose.material3.OutlinedTextField(
            value = password,
            onValueChange = { password = it },
            singleLine = true,
            visualTransformation = androidx.compose.ui.text.input.PasswordVisualTransformation(),
            label = { Text(stringResource(R.string.login_password)) },
            modifier = Modifier.fillMaxWidth().testTag("login-password"),
        )

        if (error != null) {
            // Mai es diu si el correu existeix: sempre el mateix missatge.
            Text(
                stringResource(R.string.login_error),
                color = Femho.colors.dangerText,
                fontSize = FemhoText.body,
                modifier = Modifier.testTag("login-error"),
            )
        }

        androidx.compose.material3.Button(
            onClick = { model.login(email, password) { error = it } },
            modifier = Modifier.fillMaxWidth().testTag("login-submit"),
        ) {
            Text(stringResource(R.string.login_submit))
        }
    }
}

@Composable
private fun BoardHost(model: AppViewModel, onSettings: () -> Unit) {
    val tasks by model.tasks.collectAsStateWithLifecycle()
    val scopes by model.scopes.collectAsStateWithLifecycle()
    val pending by model.pending.collectAsStateWithLifecycle()
    var active by remember { mutableStateOf<Set<String>>(emptySet()) }

    val visible = if (active.isEmpty()) tasks else tasks.filter { it.scopeId in active }

    Column(Modifier.fillMaxSize()) {
        TopBar(
            scopes = scopes,
            active = active,
            pending = pending,
            onToggle = { id ->
                val next = if (id in active) active - id else active + id
                // No es poden desactivar tots: amb cap, es tornen a veure tots.
                active = if (next.isEmpty()) emptySet() else next
            },
            onSettings = onSettings,
        )

        BoardScreen(
            tasks = visible,
            labels = BoardLabels(
                columns = mapOf(
                    TaskStatus.INBOX to stringResource(R.string.board_column_inbox),
                    TaskStatus.TODO to stringResource(R.string.board_column_todo),
                    TaskStatus.DOING to stringResource(R.string.board_column_doing),
                    TaskStatus.DONE to stringResource(R.string.board_column_done),
                ),
                empty = mapOf(
                    TaskStatus.INBOX to stringResource(R.string.board_empty_inbox),
                    TaskStatus.TODO to stringResource(R.string.board_empty_todo),
                    TaskStatus.DOING to stringResource(R.string.board_empty_doing),
                    TaskStatus.DONE to stringResource(R.string.board_empty_done),
                ),
                toTodo = stringResource(R.string.board_card_totodo),
                toDoing = stringResource(R.string.board_card_todoing),
                toggle = stringResource(R.string.sync_complete),
            ),
            onOpen = {},
            onMove = { task, status -> model.move(task, status) },
            onToggle = { task ->
                model.move(task, if (task.status == TaskStatus.DONE) TaskStatus.TODO else TaskStatus.DONE)
            },
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
private fun TopBar(
    scopes: List<Scope>,
    active: Set<String>,
    pending: Int,
    onToggle: (String) -> Unit,
    onSettings: () -> Unit,
) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Wordmark()
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (pending > 0) {
                    // La pastilla de canvis pendents: el que importa no és la xarxa
                    // sinó si el que has fet ja és a l'altre costat (docs/02 §12).
                    Text(
                        text = "$pending",
                        color = Femho.colors.inkSoft,
                        fontSize = FemhoText.meta,
                        modifier = Modifier.padding(end = 12.dp).testTag("pending-count"),
                    )
                }
                Text(
                    text = stringResource(R.string.nav_settings),
                    color = Femho.colors.inkSoft,
                    fontSize = FemhoText.body,
                    modifier = Modifier
                        .padding(8.dp)
                        .testTag("open-settings")
                        .then(Modifier.androidClickable(onSettings)),
                )
            }
        }

        Row(
            modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(7.dp),
        ) {
            scopes.forEach { scope ->
                ScopeChip(
                    label = scope.name,
                    color = scopeColor(scope.color),
                    active = active.isEmpty() || scope.id in active,
                    onClick = { onToggle(scope.id) },
                )
            }
        }
    }
}

/** `--plou-blue` → el color viu del tema. El nom del token no es guarda com a valor. */
@Composable
private fun scopeColor(token: String): Color = when (token) {
    "--plou-blue" -> Femho.colors.plouBlue
    "--plou-orange" -> Femho.colors.plouOrange
    "--plou-pink" -> Femho.colors.plouPink
    "--femho-scope-1" -> Femho.colors.femhoScope1
    "--femho-scope-2" -> Femho.colors.femhoScope2
    "--femho-scope-3" -> Femho.colors.femhoScope3
    "--femho-scope-4" -> Femho.colors.femhoScope4
    "--femho-scope-5" -> Femho.colors.femhoScope5
    "--femho-scope-6" -> Femho.colors.femhoScope6
    "--femho-scope-7" -> Femho.colors.femhoScope7
    "--femho-scope-8" -> Femho.colors.femhoScope8
    else -> Femho.colors.inkFaint
}

private fun Modifier.androidClickable(onClick: () -> Unit): Modifier = this.clickable(onClick = onClick)

@Composable
private fun SettingsHost(model: AppViewModel, serverUrl: String, onBack: () -> Unit) {
    val theme by model.theme.collectAsStateWithLifecycle()
    val accent by model.accent.collectAsStateWithLifecycle()

    SettingsScreen(
        labels = SettingsLabels(
            title = stringResource(R.string.settings_title),
            back = stringResource(R.string.nav_backtoboard),
            theme = stringResource(R.string.settings_theme),
            themeOptions = listOf(
                "system" to stringResource(R.string.settings_theme_system),
                "light" to stringResource(R.string.settings_theme_light),
                "dark" to stringResource(R.string.settings_theme_dark),
            ),
            accent = stringResource(R.string.settings_accent),
            accentOptions = listOf(
                "default" to stringResource(R.string.settings_accent_default),
                "soft" to stringResource(R.string.settings_accent_soft),
                "mono-warm" to stringResource(R.string.settings_accent_mono_warm),
                "mono-cool" to stringResource(R.string.settings_accent_mono_cool),
            ),
            server = stringResource(R.string.login_server),
            logout = stringResource(R.string.nav_logout),
        ),
        theme = theme,
        accent = accent,
        serverUrl = serverUrl,
        onTheme = model::setTheme,
        onAccent = model::setAccent,
        onBack = onBack,
        onLogout = model::logout,
    )
}
