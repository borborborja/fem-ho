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
import ho.fem.calendar.CalendarLabels
import ho.fem.calendar.DayList
import ho.fem.calendar.MonthView
import ho.fem.calendar.WeekList
import ho.fem.settings.SettingsLabels
import ho.fem.settings.SettingsScreen
import ho.fem.tasks.BoardLabels
import ho.fem.tasks.BoardScreen
import ho.fem.tasks.QuickAddField
import ho.fem.tasks.TaskDetail
import ho.fem.tasks.TaskDetailLabels
import ho.fem.model.AiMode
import ho.fem.model.QuickAddContext
import ho.fem.model.QuickAddPerson
import ho.fem.model.QuickAddProject
import ho.fem.model.QuickAddScope

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

private enum class Screen { BOARD, CALENDAR, SETTINGS }

@Composable
private fun Root(model: AppViewModel) {
    val session by model.session.collectAsStateWithLifecycle()
    var screen by remember { mutableStateOf(Screen.BOARD) }

    when (val state = session) {
        is AppViewModel.Session.Checking -> Loading()

        is AppViewModel.Session.NeedsServer -> ServerScreen(model, state.message)

        is AppViewModel.Session.NeedsLogin -> LoginScreen(model, state.instanceName)

        is AppViewModel.Session.Ready -> when (screen) {
            Screen.BOARD -> BoardHost(
                model = model,
                onSettings = { screen = Screen.SETTINGS },
                onCalendar = { screen = Screen.CALENDAR },
            )
            Screen.CALENDAR -> CalendarHost(
                model = model,
                onSettings = { screen = Screen.SETTINGS },
                onBoard = { screen = Screen.BOARD },
            )
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
private fun BoardHost(model: AppViewModel, onSettings: () -> Unit, onCalendar: () -> Unit) {
    val tasks by model.tasks.collectAsStateWithLifecycle()
    val scopes by model.scopes.collectAsStateWithLifecycle()
    val pending by model.pending.collectAsStateWithLifecycle()
    val projects by model.projects.collectAsStateWithLifecycle()
    val people by model.people.collectAsStateWithLifecycle()
    val openTask by model.openTask.collectAsStateWithLifecycle()
    val openChecklists by model.openChecklists.collectAsStateWithLifecycle()
    var active by remember { mutableStateOf<Set<String>>(emptySet()) }

    // Els textos es resolen aquí i no dins dels callbacks: `stringResource` és
    // `@Composable` i no es pot cridar des d'una lambda que no ho és.
    val quickAddError = stringResource(R.string.board_quickadd_scoperequiredprefix)
    val columnAddTemplate = stringResource(R.string.board_quickadd_placeholder)
    // "+ Afegir a {columna}…" per a cada columna: el text porta el nom de la columna i
    // `stringResource` no es pot cridar des del `footer`, que no és `@Composable` allà.
    val columnAddLabels = mapOf(
        TaskStatus.INBOX to stringResource(R.string.board_column_inbox),
        TaskStatus.TODO to stringResource(R.string.board_column_todo),
        TaskStatus.DOING to stringResource(R.string.board_column_doing),
        TaskStatus.DONE to stringResource(R.string.board_column_done),
    ).mapValues { (_, name) ->
        // El catàleg porta `{column}` literal: la substitució és aquí, com a la web, i
        // no amb `%1$s`, que faria divergir el text de les dues apps.
        columnAddTemplate.replace("{column}", name)
    }
    val manualLabel = stringResource(R.string.ai_mode_manual)
    val assistedLabel = stringResource(R.string.ai_mode_assisted)
    val delegatedLabel = stringResource(R.string.ai_mode_delegated)

    val visible = if (active.isEmpty()) tasks else tasks.filter { it.scopeId in active }

    Column(Modifier.fillMaxSize()) {
        TopBar(
            scopes = scopes,
            active = active,
            pending = pending,
            view = Screen.BOARD,
            onToggle = { id ->
                val next = if (id in active) active - id else active + id
                // No es poden desactivar tots: amb cap, es tornen a veure tots.
                active = if (next.isEmpty()) emptySet() else next
            },
            onSettings = onSettings,
            onView = { if (it == Screen.CALENDAR) onCalendar() },
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
            onOpen = model::open,
            onMove = { task, status -> model.move(task, status) },
            onToggle = { task ->
                model.move(task, if (task.status == TaskStatus.DONE) TaskStatus.TODO else TaskStatus.DONE)
            },
            modifier = Modifier.weight(1f),
            /**
             * L'afegida ràpida, **al peu de cada columna i amb el mateix parser que la
             * web**. El disseny validat la posa aquí i no sota el tauler; abans, escriure
             * mirant "Per fer" deixava la targeta a la bústia sense dir-ho.
             *
             * `parseQuickAdd` viu a `:core-model` i `parser-parity` el compara amb el de
             * TypeScript amb els mateixos fixtures. Una versió pròpia aquí divergiria al
             * primer cas rar.
             */
            footer = { status ->
                QuickAddField(
                    context = QuickAddContext(
                        scopes = scopes.map { scope ->
                            QuickAddScope(
                                id = scope.id,
                                name = scope.name,
                                projects = projects
                                    .filter { it.scopeId == scope.id }
                                    .map { QuickAddProject(it.id, it.name) },
                            )
                        },
                        people = people.map { QuickAddPerson(it.id, it.name) },
                        activeScopeIds =
                            if (active.isEmpty()) scopes.map { it.id } else active.toList(),
                    ),
                    placeholder = columnAddLabels[status].orEmpty(),
                    scopeRequiredLabel = { noms -> "${'$'}{quickAddError}${'$'}noms" },
                    aiModeLabel = { mode ->
                        when (mode) {
                            "assisted" -> assistedLabel
                            "delegated" -> delegatedLabel
                            else -> manualLabel
                        }
                    },
                    onCreate = { title, scopeId, _, _ -> model.create(scopeId, title, status) },
                    modifier = Modifier.padding(top = 8.dp).testTag("quick-add-${'$'}{status.name.lowercase()}"),
                )
            },
        )
    }

    // El full de detall va per sobre de tot, com a la web.
    openTask?.let { task ->
        TaskDetail(
            task = task,
            checklists = openChecklists,
            labels = TaskDetailLabels(
                title = stringResource(R.string.task_title),
                description = stringResource(R.string.task_description),
                status = mapOf(
                    TaskStatus.INBOX to stringResource(R.string.board_column_inbox),
                    TaskStatus.TODO to stringResource(R.string.board_column_todo),
                    TaskStatus.DOING to stringResource(R.string.board_column_doing),
                    TaskStatus.DONE to stringResource(R.string.board_column_done),
                ),
                aiMode = mapOf(
                    AiMode.MANUAL to manualLabel,
                    AiMode.ASSISTED to assistedLabel,
                    AiMode.DELEGATED to delegatedLabel,
                ),
                checklists = stringResource(R.string.task_checklists),
                toggle = stringResource(R.string.sync_complete),
                save = stringResource(R.string.nav_save),
                close = stringResource(R.string.nav_close),
                emptyChecklists = stringResource(R.string.checklist_empty),
            ),
            onSave = { title, mode ->
                model.rename(task, title)
                if (mode != task.aiMode) model.setAiMode(task, mode)
                model.closeTask()
            },
            onStatus = { model.move(task, it) },
            onToggleItem = model::toggleItem,
            onClose = model::closeTask,
        )
    }
}

@Composable
private fun CalendarHost(model: AppViewModel, onSettings: () -> Unit, onBoard: () -> Unit) {
    val scopes by model.scopes.collectAsStateWithLifecycle()
    val pending by model.pending.collectAsStateWithLifecycle()
    val events by model.events.collectAsStateWithLifecycle()
    var active by remember { mutableStateOf<Set<String>>(emptySet()) }
    var selected by remember { mutableStateOf(java.time.LocalDate.now()) }

    androidx.compose.runtime.LaunchedEffect(selected.month, selected.year) {
        val first = selected.withDayOfMonth(1)
        model.loadCalendar(
            from = first.minusDays(7).toString(),
            to = first.plusMonths(1).plusDays(7).toString(),
            day = selected.toString(),
        )
    }

    val labels = CalendarLabels(
        weekdays = stringResource(R.string.calendar_weekdays).split(","),
        months = stringResource(R.string.calendar_months).split(","),
        emptyDay = stringResource(R.string.calendar_empty_day),
        emptyWeek = stringResource(R.string.calendar_empty_week),
    )

    val colors = scopes.associate { it.id to scopeColor(it.color) }
    // Es resol FORA del `colorOf`: `scopeColor` és `@Composable` i el callback de
    // `DayList` no ho és. Amb el mapa ja resolt, el callback és una consulta i prou.
    val fallback = Femho.colors.inkFaint
    var mode by remember { mutableStateOf(CalendarMode.MONTH) }

    Column(Modifier.fillMaxSize()) {
        TopBar(
            scopes = scopes,
            active = active,
            pending = pending,
            view = Screen.CALENDAR,
            onToggle = { id ->
                val next = if (id in active) active - id else active + id
                active = if (next.isEmpty()) emptySet() else next
            },
            onSettings = onSettings,
            onView = { if (it == Screen.BOARD) onBoard() },
        )

        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            listOf(
                CalendarMode.MONTH to stringResource(R.string.calendar_month),
                CalendarMode.WEEK to stringResource(R.string.calendar_week),
                CalendarMode.DAY to stringResource(R.string.calendar_day),
            ).forEach { (target, label) ->
                Text(
                    text = label,
                    color = if (mode == target) Femho.colors.ink else Femho.colors.inkFaint,
                    fontSize = FemhoText.body,
                    fontWeight = if (mode == target) FontWeight.Bold else FontWeight.Medium,
                    modifier = Modifier
                        .padding(vertical = 12.dp)
                        .testTag("calendar-mode-${'$'}{target.name.lowercase()}")
                        .androidClickable { mode = target },
                )
            }
        }

        when (mode) {
            CalendarMode.MONTH -> {
                MonthView(
                    year = selected.year,
                    month = selected.monthValue,
                    selected = selected,
                    today = java.time.LocalDate.now(),
                    dots = events
                        .groupBy { java.time.LocalDate.parse(it.startsAt.substring(0, 10)) }
                        .mapValues { (_, list) ->
                            list.mapNotNull { colors[it.scopeId] }.distinct().take(3)
                        },
                    labels = labels,
                    onSelect = { selected = it },
                )

                DayList(
                    occurrences = events.filter { it.startsAt.startsWith(selected.toString()) },
                    colorOf = { colors[it] ?: fallback },
                    labels = labels,
                    modifier = Modifier.weight(1f),
                )
            }

            CalendarMode.WEEK -> {
                // La setmana comença en DILLUNS (docs/00): `dayOfWeek.value` és 1 per a
                // dilluns, o sigui que se'n resten els dies que han passat des d'ell.
                val monday = selected.minusDays((selected.dayOfWeek.value - 1).toLong())
                WeekList(
                    days = (0L..6L).map { offset ->
                        val day = monday.plusDays(offset)
                        day to events.filter { it.startsAt.startsWith(day.toString()) }
                    },
                    labels = labels,
                    onSelect = {
                        selected = it
                        mode = CalendarMode.DAY
                    },
                    modifier = Modifier.weight(1f).padding(horizontal = 12.dp),
                )
            }

            CalendarMode.DAY -> DayList(
                occurrences = events.filter { it.startsAt.startsWith(selected.toString()) },
                colorOf = { colors[it] ?: fallback },
                labels = labels,
                modifier = Modifier.weight(1f),
            )
        }
    }
}

private enum class CalendarMode { MONTH, WEEK, DAY }

@Composable
private fun TopBar(
    scopes: List<Scope>,
    active: Set<String>,
    pending: Int,
    view: Screen,
    onToggle: (String) -> Unit,
    onSettings: () -> Unit,
    onView: (Screen) -> Unit,
) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Wordmark()
            Row(verticalAlignment = Alignment.CenterVertically) {
                // El commutador Tasques / Calendari, igual que a la web (docs/02 §3).
                listOf(
                    Screen.BOARD to stringResource(R.string.nav_tasks),
                    Screen.CALENDAR to stringResource(R.string.nav_calendar),
                ).forEach { (target, label) ->
                    Text(
                        text = label,
                        color = if (view == target) Femho.colors.ink else Femho.colors.inkFaint,
                        fontSize = FemhoText.body,
                        fontWeight = if (view == target) FontWeight.Bold else FontWeight.Medium,
                        modifier = Modifier
                            .padding(horizontal = 8.dp, vertical = 12.dp)
                            .testTag("view-${'$'}{target.name.lowercase()}")
                            .androidClickable { onView(target) },
                    )
                }

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
