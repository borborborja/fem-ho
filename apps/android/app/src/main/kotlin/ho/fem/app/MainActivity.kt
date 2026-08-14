package ho.fem.app

import android.content.Intent
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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import ho.fem.app.R
import ho.fem.app.widget.FemhoWidgets
import ho.fem.designsystem.Femho
import ho.fem.designsystem.FemhoSize
import ho.fem.designsystem.FemhoText
import ho.fem.designsystem.FemhoTheme
import ho.fem.designsystem.FemhoShape
import ho.fem.designsystem.ScopeChip
import ho.fem.designsystem.scopeColor
import ho.fem.model.Checklist
import ho.fem.model.Project
import ho.fem.model.Scope
import ho.fem.model.TaskStatus
import ho.fem.model.UserProfile
import ho.fem.calendar.CalendarLabels
import ho.fem.calendar.DayList
import ho.fem.calendar.InboxLabels
import ho.fem.calendar.InboxRail
import ho.fem.calendar.MonthView
import ho.fem.calendar.WeekList
import ho.fem.settings.SettingsEmptyStates
import ho.fem.settings.SettingsLabels
import ho.fem.settings.SettingsScreen
import ho.fem.settings.SettingsTabs
import ho.fem.tasks.BoardLabels
import ho.fem.designsystem.CardAddForm
import ho.fem.designsystem.CardList
import ho.fem.designsystem.CardListItem
import ho.fem.tasks.BoardScreen
import ho.fem.tasks.CardExtras
import ho.fem.tasks.QuickAddField
import ho.fem.tasks.TaskDetail
import ho.fem.tasks.TaskDetailLabels
import ho.fem.model.AiMode
import ho.fem.model.Dates
import ho.fem.model.QuickAddContext
import ho.fem.model.QuickAddPerson
import ho.fem.model.QuickAddProject
import ho.fem.model.QuickAddScope
import kotlinx.coroutines.launch

/**
 * L'activitat única. docs/03.
 *
 * Tres destins i prou —login, tauler i ajustos—, i per això la navegació és un `when`
 * sobre l'estat de sessió i una pantalla actual. `navigation-compose` porta un graf,
 * arguments tipats i una pila que aquí no s'usaria; el dia que hi hagi deu pantalles, es
 * reconsidera.
 */
class MainActivity : ComponentActivity() {
    /**
     * L'intent que encara no s'ha atès.
     *
     * És estat de Compose i no una lectura de `getIntent()` perquè `onNewIntent` arriba
     * amb l'activitat ja composta: sense això, tocar un widget amb l'app oberta no faria
     * res visible, que és el pitjor dels casos —sembla que el widget estigui trencat.
     */
    private val pending = mutableStateOf<Intent?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        val container = (application as FemhoApplication).container
        pending.value = intent

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
                    Root(model, pending)
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        pending.value = intent
    }

    /**
     * En sortir de l'app, els widgets es posen al dia.
     *
     * És el moment exacte en què la persona torna a mirar la pantalla d'inici, i el que
     * evita que hi vegi el que hi havia abans d'entrar. La resta del temps ja se n'ocupa
     * el `SyncWorker`; això només tapa el buit entre dues execucions seves.
     */
    override fun onStop() {
        super.onStop()
        lifecycleScope.launch { FemhoWidgets.updateAll(applicationContext) }
    }
}

@Composable
private fun Root(model: AppViewModel, pending: MutableState<Intent?>) {
    val session by model.session.collectAsStateWithLifecycle()
    var screen by remember { mutableStateOf(Screen.BOARD) }

    /**
     * L'intent s'atén i **es consumeix**.
     *
     * Sense buidar-lo, una rotació de pantalla tornaria a obrir la tasca que el widget
     * va demanar fa mitja hora. La tasca es demana per identificador i no per objecte
     * perquè qui l'envia és un altre procés que no en té cap.
     */
    LaunchedEffect(pending.value) {
        val intent = pending.value ?: return@LaunchedEffect
        screen = Route.screenOf(intent)
        Route.taskOf(intent)?.let { model.openById(it) }
        if (Route.quickAddOf(intent)) model.requestQuickAdd(Route.draftOf(intent) ?: "")
        pending.value = null
    }

    when (val state = session) {
        is AppViewModel.Session.Checking -> Loading()

        is AppViewModel.Session.NeedsServer -> ServerScreen(model, state.message)

        is AppViewModel.Session.NeedsLogin -> LoginScreen(model, state.instanceName)

        is AppViewModel.Session.Ready -> when (screen) {
            Screen.BOARD -> BoardHost(
                model = model,
                onSettings = { screen = Screen.SETTINGS },
                onCalendar = { screen = Screen.CALENDAR },
                onRegistre = { screen = Screen.REGISTRE },
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
            Screen.REGISTRE -> RegistreHost(
                model = model,
                onBoard = { screen = Screen.BOARD },
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
private fun BoardHost(model: AppViewModel, onSettings: () -> Unit, onCalendar: () -> Unit, onRegistre: () -> Unit) {
    val tasks by model.tasks.collectAsStateWithLifecycle()
    val scopes by model.scopes.collectAsStateWithLifecycle()
    val pending by model.pending.collectAsStateWithLifecycle()
    val projects by model.projects.collectAsStateWithLifecycle()
    val people by model.people.collectAsStateWithLifecycle()
    val taskTypes by model.taskTypes.collectAsStateWithLifecycle()
    val labels by model.labels.collectAsStateWithLifecycle()
    val scopeSettings by model.scopeSettings.collectAsStateWithLifecycle()

    // El detall de tasca llegeix etiquetes i tipologies; si no es carreguen aquí, la
    // secció del detall surt buida fins que s'obren els Ajustos.
    LaunchedEffect(Unit) { model.loadEntityData() }
    val openTask by model.openTask.collectAsStateWithLifecycle()
    val openChecklists by model.openChecklists.collectAsStateWithLifecycle()
    val openComments by model.openComments.collectAsStateWithLifecycle()
    val openActivity by model.openActivity.collectAsStateWithLifecycle()
    val pinned by model.pinned.collectAsStateWithLifecycle()
    val activeProjects by model.activeProjects.collectAsStateWithLifecycle()
    val expandedCards by model.expandedCards.collectAsStateWithLifecycle()
    val openCards by model.openCards.collectAsStateWithLifecycle()
    val cardLists by model.cardLists.collectAsStateWithLifecycle()
    val cardDrafts by model.cardDrafts.collectAsStateWithLifecycle()
    val aiEnabled by model.aiEnabled.collectAsStateWithLifecycle()
    val aiBoard by model.aiBoard.collectAsStateWithLifecycle()
    val aiBoardLabel = stringResource(R.string.board_ia_toggle)
    var active by remember { mutableStateOf<Set<String>>(emptySet()) }

    // Els textos es resolen aquí i no dins dels callbacks: `stringResource` és
    // `@Composable` i no es pot cridar des d'una lambda que no ho és.
    val quickAddError = stringResource(R.string.board_quickadd_scoperequiredprefix)
    /**
     * El camp anuncia **només el sigil que serveix per a alguna cosa**, amb la mateixa
     * regla que la web: amb un sol àmbit actiu `#` no cal —s'agafa l'únic— i sense ningú
     * més `@` no té a qui assignar. Tres claus i no una perquè el text canvia sencer.
     */
    val quickAddPlain = stringResource(R.string.board_quickadd_placeholder_plain)
    val quickAddScope = stringResource(R.string.board_quickadd_placeholder_scope)
    val quickAddPerson = stringResource(R.string.board_quickadd_placeholder_person)
    val listsCollapsed = stringResource(R.string.card_lists_collapsed)
    val listsExpandedLabel = stringResource(R.string.card_lists_expanded)
    val addToggleLabel = stringResource(R.string.card_add)
    val addPlaceholder = stringResource(R.string.card_addplaceholder)
    val editLabel = stringResource(R.string.task_edit)
    val advanceTemplate = stringResource(R.string.board_card_advance)
    val pinLabel = stringResource(R.string.checklist_pin)
    val unpinLabel = stringResource(R.string.checklist_unpinaction)
    val toggleItemTemplate = stringResource(R.string.checklist_toggleitem)
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
        val actius = if (active.isEmpty()) scopes.map { it.id } else active.toList()
        val plantilla =
            when {
                actius.size > 1 -> quickAddScope
                people.size > 1 -> quickAddPerson
                else -> quickAddPlain
            }
        plantilla.replace("{column}", name)
    }
    val manualLabel = stringResource(R.string.ai_mode_manual)
    val assistedLabel = stringResource(R.string.ai_mode_assisted)
    val delegatedLabel = stringResource(R.string.ai_mode_delegated)

    val perAmbit = if (active.isEmpty()) tasks else tasks.filter { it.scopeId in active }

    /**
     * El filtre de projectes (`docs/14` P7).
     *
     * **Un àmbit sense res triat vol dir "tots els seus"**, o sigui que no n'hi ha prou
     * de mirar si el projecte de la tasca és a la llista: una tasca d'un àmbit sense tria
     * hi ha de ser igualment, i una **sense projecte** d'un àmbit amb tria, no.
     */
    val visible = if (activeProjects.isEmpty()) {
        perAmbit
    } else {
        perAmbit.filter { task ->
            val teTria = projects.any { it.scopeId == task.scopeId && it.id in activeProjects }
            if (!teTria) true else task.projectId != null && task.projectId in activeProjects
        }
    }

    Column(Modifier.fillMaxSize()) {
        TopBar(
            pinned = pinned,
            /**
             * **S'obre la tasca que la conté**, no una pantalla de llista.
             *
             * A Android les llistes viuen dins de la tasca —no hi ha `Screen.LIST`, i
             * `docs/03` no en descriu cap—, o sigui que la drecera porta on la llista es
             * pot llegir i marcar. A la web sí que hi ha pantalla pròpia i el menú hi va.
             */
            onOpenList = { id -> pinned.find { it.id == id }?.let { model.openById(it.taskId) } },
            projects = projects,
            activeProjects = activeProjects,
            onToggleProject = { model.toggleProject(it) },
            onAllProjects = { model.clearProjectsOfScope(it) },
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
            onView = {
                when (it) {
                    Screen.CALENDAR -> onCalendar()
                    Screen.REGISTRE -> onRegistre()
                    else -> Unit
                }
            },
            showRegistre = scopeSettings.values.any { it.timeTracking },
            aiEnabled = aiEnabled,
            aiBoardActive = aiBoard,
            onToggleAiBoard = model::toggleAiBoard,
            aiBoardLabel = aiBoardLabel,
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
                advance = mapOf(
                    TaskStatus.INBOX to advanceTemplate.replace(
                        "{column}",
                        stringResource(R.string.board_column_todo),
                    ),
                    TaskStatus.TODO to advanceTemplate.replace(
                        "{column}",
                        stringResource(R.string.board_column_doing),
                    ),
                ),
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
            /**
             * Les subtasques i les llistes, a la mateixa targeta.
             *
             * **Un sol commutador per a totes dues**, i el número que hi surt compta
             * blocs i no ítems: les subtasques, totes juntes, en són un.
             */
            aiBoard = aiBoard,
            extras = { task ->
                val blocs = task.progress?.lists ?: 0
                val expanded = task.id in expandedCards
                val carregat = cardLists[task.id]
                val draft = cardDrafts[task.id].orEmpty()

                CardExtras(
                    onEdit = { model.open(task) },
                    editLabel = editLabel,
                    lists = buildList {
                        val subtasks = carregat?.subtasks.orEmpty()
                        if (subtasks.isNotEmpty()) {
                            add(
                                CardList(
                                    id = "subtasks-${'$'}{task.id}",
                                    name = null,
                                    items = subtasks.map { sub ->
                                        CardListItem(
                                            id = sub.id,
                                            text = sub.title,
                                            done = sub.done,
                                            toggleLabel = toggleItemTemplate.replace("{text}", sub.title),
                                            onToggle = {
                                                model.toggleCardSubtask(task.id, sub.id, !sub.done)
                                            },
                                        )
                                    },
                                ),
                            )
                        }
                        carregat?.checklists.orEmpty().forEach { llista ->
                            add(
                                CardList(
                                    id = llista.id,
                                    name = llista.name,
                                    pinned = llista.pinned,
                                    pinLabel = if (llista.pinned) unpinLabel else pinLabel,
                                    onPinToggle = { model.togglePinList(task.id, llista) },
                                    items = llista.items.map { item ->
                                        CardListItem(
                                            id = item.id,
                                            text = item.text,
                                            done = item.done,
                                            toggleLabel = toggleItemTemplate.replace("{text}", item.text),
                                            onToggle = {
                                                model.toggleCardItem(task.id, item.id, !item.done)
                                            },
                                        )
                                    },
                                ),
                            )
                        }
                    },
                    expanded = expanded,
                    // Sense cap bloc no hi ha res a desplegar, i el commutador no surt.
                    toggleLabel = if (blocs == 0) {
                        null
                    } else {
                        (if (expanded) listsExpandedLabel else listsCollapsed)
                            .replace("{count}", blocs.toString())
                    },
                    onToggleLists = { model.toggleCard(task) },
                    addForm = CardAddForm(
                        open = task.id in openCards,
                        onToggle = { model.toggleCardForm(task) },
                        toggleLabel = addToggleLabel,
                        placeholder = addPlaceholder,
                        text = draft,
                        onText = { model.setCardDraft(task.id, it) },
                        onSubmit = { model.submitCardAdd(task) },
                    ),
                )
            },
        )
    }

    // El full de detall va per sobre de tot, com a la web.
    openTask?.let { task ->
        TaskDetail(
            task = task,
            checklists = openChecklists,
            projects = projects,
            people = people,
            taskTypes = taskTypes,
            labelsList = labels,
            isCollectiveScope = scopes.any { it.id == task.scopeId && it.kind == ho.fem.model.ScopeKind.COLLECTIVE },
            comments = openComments,
            activity = openActivity,
            labels = TaskDetailLabels(
                title = stringResource(R.string.task_title),
                description = stringResource(R.string.task_description),
                project = stringResource(R.string.task_project),
                noProject = stringResource(R.string.task_noproject),
                dueDate = stringResource(R.string.task_duedate),
                dueTime = stringResource(R.string.task_duetime),
                deadline = stringResource(R.string.task_deadline),
                recurrence = stringResource(R.string.task_recurrence),
                recurrenceNone = stringResource(R.string.task_recurrence_none),
                recurrenceDaily = stringResource(R.string.task_recurrence_daily),
                recurrenceWeekly = stringResource(R.string.task_recurrence_weekly),
                recurrenceMonthly = stringResource(R.string.task_recurrence_monthly),
                recurrenceYearly = stringResource(R.string.task_recurrence_yearly),
                recurrenceFromCompletion = stringResource(R.string.task_recurrence_fromcompletion),
                assignees = stringResource(R.string.task_assignees),
                taskType = stringResource(R.string.task_tasktype),
                noType = stringResource(R.string.stats_notype),
                labels = stringResource(R.string.task_labels),
                newLabel = stringResource(R.string.task_newlabel),
                newLabelPlaceholder = stringResource(R.string.task_newlabel_placeholder),
                emptyLabels = stringResource(R.string.task_empty_labels),
                labelAdd = stringResource(R.string.task_label_add),
                labelRemove = stringResource(R.string.task_label_remove),
                comments = stringResource(R.string.task_comments),
                commentPlaceholder = stringResource(R.string.task_newcomment),
                emptyComments = stringResource(R.string.task_empty_comments),
                activity = stringResource(R.string.task_activity),
                undo = stringResource(R.string.activity_undo),
                delete = stringResource(R.string.nav_delete),
                cancel = stringResource(R.string.nav_cancel),
                deleteConfirm = stringResource(R.string.task_deleteconfirm),
                lockWorking = stringResource(R.string.ai_lock_working),
                takeOverAction = stringResource(R.string.ai_takeover_action),
                takeOverWhere = stringResource(R.string.ai_takeover_where),
                activityVerbs = mapOf(
                    "answered" to stringResource(R.string.activity_verb_answered),
                    "asked" to stringResource(R.string.activity_verb_asked),
                    "cascade_complete" to stringResource(R.string.activity_verb_cascade_complete),
                    "claimed" to stringResource(R.string.activity_verb_claimed),
                    "commented" to stringResource(R.string.activity_verb_commented),
                    "completed" to stringResource(R.string.activity_verb_completed),
                    "created" to stringResource(R.string.activity_verb_created),
                    "deleted" to stringResource(R.string.activity_verb_deleted),
                    "moved" to stringResource(R.string.activity_verb_moved),
                    "refreshed" to stringResource(R.string.activity_verb_refreshed),
                    "released" to stringResource(R.string.activity_verb_released),
                    "reopened" to stringResource(R.string.activity_verb_reopened),
                    "token_created" to stringResource(R.string.activity_verb_token_created),
                    "token_revoked" to stringResource(R.string.activity_verb_token_revoked),
                    "updated" to stringResource(R.string.activity_verb_updated),
                ),
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
            onUpdateDetails = { description, projectId, dueDate, dueTime, deadline, rrule, recurrenceMode ->
                model.updateTaskDetails(task, description, projectId, dueDate, dueTime, deadline, rrule, recurrenceMode)
            },
            onStatus = { model.move(task, it) },
            onToggleItem = model::toggleItem,
            onAddAssignee = { model.addAssignee(task, it) },
            onRemoveAssignee = { model.removeAssignee(task, it) },
            onSetTaskType = { model.setTaskType(task, it) },
            onAddLabel = { model.addTaskLabel(task, it) },
            onRemoveLabel = { model.removeTaskLabel(task, it) },
            onCreateLabel = { model.createTaskLabel(task, it) },
            onAddComment = { model.addComment(task.id, it) },
            onUndoActivity = { model.undoActivity(it) },
            onDelete = { model.deleteTask(task) },
            onTakeOver = { model.takeOver(task, it) },
            onClose = model::closeTask,
        )
    }
}

@Composable
private fun CalendarHost(model: AppViewModel, onSettings: () -> Unit, onBoard: () -> Unit) {
    val scopes by model.scopes.collectAsStateWithLifecycle()
    val pending by model.pending.collectAsStateWithLifecycle()
    val events by model.events.collectAsStateWithLifecycle()
    val inbox by model.inbox.collectAsStateWithLifecycle()
    var active by remember { mutableStateOf<Set<String>>(emptySet()) }
    var selected by remember { mutableStateOf(java.time.LocalDate.now()) }

    /**
     * **La clau és `selected` sencer i no el mes i l'any.**
     *
     * Amb `selected.month, selected.year`, triar un altre dia del mateix mes no tornava a
     * demanar res: la bústia que es carregava era la del dia en què s'havia obert el mes,
     * i no canviava fins a passar de mes. Com que fins ara el resultat no es pintava
     * enlloc, no ho havia vist ningú.
     */
    androidx.compose.runtime.LaunchedEffect(selected) {
        val first = selected.withDayOfMonth(1)
        model.loadCalendar(
            from = first.minusDays(7).toString(),
            to = first.plusMonths(1).plusDays(7).toString(),
            day = selected.toString(),
        )
    }

    /**
     * L'idioma i el primer dia de la setmana d'aquesta pantalla.
     *
     * L'idioma surt de la configuració efectiva —que ja és la del perfil si Android 13+
     * l'ha aplicada— i el primer dia, de `Dates`, el mateix codi que la web.
     */
    val appLocale = androidx.compose.ui.platform.LocalConfiguration.current.locales[0]
        ?.language ?: "ca"
    val weekStart = Dates.weekStart(appLocale)

    val labels = CalendarLabels(
        // Els noms surten del CLDR i no del catàleg: `java.time` i `Intl` porten la
        // mateixa base, o sigui que les dues apps diuen el mateix sense escriure-ho dues
        // vegades. Abans eren dues claus amb els dotze mesos separats per comes.
        weekdays = Dates.weekdayNames(appLocale, weekStart),
        months = (1..12).map { Dates.monthName(appLocale, it) },
        emptyDay = stringResource(R.string.calendar_empty_day),
        emptyWeek = stringResource(R.string.calendar_empty_week),
    )

    // Es resol FORA del `colorOf`: llegir `Femho.colors` és una lectura de composició i
    // el callback de `DayList` no ho és. Amb el mapa ja resolt, el callback és una
    // consulta i prou.
    val palette = Femho.colors
    val colors = scopes.associate { it.id to palette.scopeColor(it.color) }
    val fallback = palette.inkFaint
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
                    weekStart = weekStart,
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
                // Amb quin dia comença la setmana ho decideix l'idioma: `Dates` és el
                // mateix codi que fa servir la web, i per això no divergeixen.
                val first = selected.minusDays(Dates.weekIndex(selected, weekStart).toLong())
                WeekList(
                    days = (0L..6L).map { offset ->
                        val day = first.plusDays(offset)
                        day to events.filter { it.startsAt.startsWith(day.toString()) }
                    },
                    labels = labels,
                    onSelect = {
                        selected = it
                        mode = CalendarMode.DAY
                    },
                    modifier = Modifier.weight(1f).padding(horizontal = 12.dp),
                    weekStart = weekStart,
                )
            }

            CalendarMode.DAY -> DayList(
                occurrences = events.filter { it.startsAt.startsWith(selected.toString()) },
                colorOf = { colors[it] ?: fallback },
                labels = labels,
                modifier = Modifier.weight(1f),
            )
        }

        /**
         * I el dipòsit del dia, que fins ara es demanava i es llençava.
         *
         * Va **sota** la graella i no al costat: a la web és un rail perquè hi ha amplada;
         * en un telèfon, dues columnes de 180px no serveixen per a res. És el mateix
         * contingut i les mateixes accions (docs/02 §10: la web en mòbil i l'app han de
         * ser gairebé idèntiques).
         */
        InboxRail(
            tasks = (inbox?.dated.orEmpty() + inbox?.overdue.orEmpty() + inbox?.undated.orEmpty()),
            events = inbox?.events.orEmpty(),
            colorOf = { colors[it] ?: fallback },
            labels = InboxLabels(
                title = stringResource(R.string.board_column_inbox),
                empty = stringResource(R.string.board_empty_inbox),
                fromCalendar = stringResource(R.string.inbox_section_events),
                allDay = stringResource(R.string.inbox_event_allday),
                toTask = stringResource(R.string.inbox_event_totask),
                hide = stringResource(R.string.inbox_eye_hide),
                show = stringResource(R.string.inbox_eye_show),
            ),
            onOpenTask = { model.open(it) },
            onEventToTask = { model.eventToTask(it, selected.toString()) },
            // El contrari del que hi ha ara, i no `null`: amb una font que per defecte no
            // entra a la bústia —un RSS—, `null` no faria res i el botó semblaria espatllat.
            onEventToggle = {
                model.setEventInInbox(it, visible = !it.inInbox, day = selected.toString())
            },
        )
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
    /** El Registre només surt si algun àmbit porta registre de dedicació. */
    showRegistre: Boolean = false,
    /** El commutador del tauler de la IA. Només surt si hi ha algun agent actiu. */
    aiEnabled: Boolean = false,
    aiBoardActive: Boolean = false,
    onToggleAiBoard: () -> Unit = {},
    aiBoardLabel: String = "",
    /**
     * Les llistes pinejades i com s'obren.
     *
     * `docs/03` §3 les demana a la capçalera —"el de llistes pinejades quan n'hi ha"— i
     * aquí no hi eren: a la web sí, i les dues superfícies s'han de sentir la mateixa
     * cosa. Si la llista és buida, el botó no surt (`docs/02` §3).
     */
    pinned: List<Checklist> = emptyList(),
    onOpenList: (String) -> Unit = {},
    /**
     * El filtre de projectes, **a cada xip** i no en un desplegable a part (`docs/14` P7).
     *
     * Un àmbit sense projectes no en porta: un desplegable buit és una promesa que no es
     * compleix.
     */
    projects: List<Project> = emptyList(),
    activeProjects: List<String> = emptyList(),
    onToggleProject: (String) -> Unit = {},
    onAllProjects: (String) -> Unit = {},
) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Wordmark()
            Row(verticalAlignment = Alignment.CenterVertically) {
                // El commutador Tasques / Calendari / Registre, igual que a la web (docs/02 §3).
                val targets = buildList {
                    add(Screen.BOARD to stringResource(R.string.nav_tasks))
                    add(Screen.CALENDAR to stringResource(R.string.nav_calendar))
                    if (showRegistre) add(Screen.REGISTRE to stringResource(R.string.nav_registre))
                }
                targets.forEach { (target, label) ->
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

                if (aiEnabled && view == Screen.BOARD) {
                    Text(
                        // El robot del disseny validat, en text: Compose no porta el joc
                        // d'icones de Plou i un SVG a mà aquí seria un dibuix repetit.
                        text = "◍",
                        color = if (aiBoardActive) Femho.onBrand else Femho.colors.inkSoft,
                        fontSize = FemhoText.body,
                        fontWeight = FontWeight.Bold,
                        textAlign = TextAlign.Center,
                        modifier = Modifier
                            .padding(horizontal = 6.dp)
                            .size(34.dp)
                            .clip(CircleShape)
                            // Un `if` amb una banda `Brush` i l'altra `Color` no resol cap
                            // sobrecàrrega de `background`: es tria el modificador sencer.
                            .then(
                                if (aiBoardActive) {
                                    Modifier.background(Femho.brandGradient2)
                                } else {
                                    Modifier.background(Femho.colors.tagBg)
                                },
                            )
                            .androidClickable { onToggleAiBoard() }
                            .padding(top = 8.dp)
                            .testTag("ai-board-toggle")
                            .semantics { contentDescription = aiBoardLabel },
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
                    color = Femho.colors.scopeColor(scope.color),
                    active = active.isEmpty() || scope.id in active,
                    onClick = { onToggle(scope.id) },
                )
            }
        }

        ScopeProjects(
            scopes = scopes,
            active = active,
            projects = projects,
            activeProjects = activeProjects,
            onToggleProject = onToggleProject,
            onAllProjects = onAllProjects,
        )

        PinnedRow(pinned = pinned, onOpenList = onOpenList)
    }
}

/**
 * El filtre de projectes dels àmbits actius.
 *
 * A la web el botonet va **enganxat al xip**; aquí els xips emboliquen i el desplegable
 * hauria de sortir per sobre d'una fila que ja fa scroll horitzontal, o sigui que la
 * mateixa idea pren la forma que la pantalla permet: una fila per àmbit, plegada, amb els
 * seus projectes. El que no canvia és el criteri —**un àmbit sense res triat vol dir tots
 * els seus**— ni el vocabulari.
 */
/**
 * El contingut d'un desplegable és text que ha de ser llegible com a panell;
 * sobre el fons de la pàgina (transparent) el text competeix amb el que hi ha al darrere —
 * i lletres sobre fons 100% transparent no es llegeixen.
 */
@Composable
private fun MenuPanel(content: @Composable () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(FemhoShape.card))
            .background(Femho.colors.cardBg)
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        content()
    }
}

@Composable
private fun ScopeProjects(
    scopes: List<Scope>,
    active: Set<String>,
    projects: List<Project>,
    activeProjects: List<String>,
    onToggleProject: (String) -> Unit,
    onAllProjects: (String) -> Unit,
) {
    val ambProjectes = scopes.filter { scope ->
        (active.isEmpty() || scope.id in active) && projects.any { it.scopeId == scope.id }
    }
    if (ambProjectes.isEmpty()) return

    var open by remember { mutableStateOf(false) }
    val triats = activeProjects.size

    Column(Modifier.fillMaxWidth().padding(top = 8.dp)) {
        Text(
            text = stringResource(R.string.nav_allprojects) +
                if (triats > 0) "  ($triats)" else "",
            color = Femho.colors.inkSoft,
            fontSize = FemhoText.meta,
            fontWeight = FontWeight.Bold,
            modifier = Modifier
                .testTag("projects-toggle")
                .then(Modifier.androidClickable { open = !open })
                .padding(vertical = 6.dp),
        )

        if (open) {
            MenuPanel {
                ambProjectes.forEach { scope ->
                    val seus = projects.filter { it.scopeId == scope.id }
                    Text(
                        text = scope.name,
                        color = Femho.colors.inkFaint,
                        fontSize = FemhoText.meta,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.padding(top = 6.dp),
                    )
                    Text(
                        text = (if (seus.none { it.id in activeProjects }) "✓ " else "· ") +
                            stringResource(R.string.nav_allprojects),
                        color = Femho.colors.ink,
                        fontSize = FemhoText.body,
                        modifier = Modifier
                            .fillMaxWidth()
                            .testTag("projects-all-${'$'}{scope.id}")
                            .then(Modifier.androidClickable { onAllProjects(scope.id) })
                            .padding(vertical = 5.dp),
                    )
                    seus.forEach { project ->
                        Text(
                            text = (if (project.id in activeProjects) "✓ " else "· ") + project.name,
                            color = Femho.colors.ink,
                            fontSize = FemhoText.body,
                            modifier = Modifier
                                .fillMaxWidth()
                                .testTag("project-${'$'}{project.id}")
                                .then(Modifier.androidClickable { onToggleProject(project.id) })
                                .padding(vertical = 5.dp),
                        )
                    }
                }
            }
        }
    }
}

/**
 * Les llistes pinejades, desplegables des de la capçalera.
 *
 * **Cada llista diu com va**, no només com es diu: amb quatre pinejades, els noms sols
 * obliguen a entrar a cadascuna per saber quina té feina pendent. És el mateix que fa la
 * web i el que ensenya el prototip.
 */
@Composable
private fun PinnedRow(pinned: List<Checklist>, onOpenList: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }

    Column(Modifier.fillMaxWidth().padding(top = 8.dp)) {
        Text(
            text = stringResource(R.string.nav_pinned) + "  (${pinned.size})",
            color = Femho.colors.inkSoft,
            fontSize = FemhoText.meta,
            fontWeight = FontWeight.Bold,
            modifier = Modifier
                .testTag("pinned-toggle")
                .then(Modifier.androidClickable { open = !open })
                .padding(vertical = 6.dp),
        )

        if (open) {
            MenuPanel {
                if (pinned.isEmpty()) {
                    /**
                     * **El buit diu on es pinegen** (`docs/14` P8).
                     *
                     * Sense això, pinejar una llista no es descobreix enlloc: el control que ho
                     * ensenyaria només apareixia quan ja sabies que existia.
                     */
                    Text(
                        text = stringResource(R.string.nav_nopinned),
                        color = Femho.colors.inkFaint,
                        fontSize = FemhoText.meta,
                        modifier = Modifier.testTag("pinned-empty").padding(vertical = 6.dp),
                    )
                } else {
                    pinned.forEach { checklist ->
                        val done = checklist.items.count { it.done }
                        Column(
                            Modifier
                                .fillMaxWidth()
                                .testTag("pinned-${checklist.id}")
                                .then(Modifier.androidClickable { onOpenList(checklist.id) })
                                .padding(vertical = 6.dp),
                        ) {
                            Text(
                                // "Tasca · Llista", com als prototips: el nom sol no distingeix
                                // dues llistes que es diguin igual en tasques diferents.
                                text = checklist.taskTitle
                                    ?.takeIf { it.isNotEmpty() }
                                    ?.let { "${'$'}it · ${'$'}{checklist.name}" }
                                    ?: checklist.name,
                                color = Femho.colors.ink,
                                fontSize = FemhoText.body,
                                fontWeight = FontWeight.SemiBold,
                            )
                            Text(
                                // Els marcadors del catàleg són `{done}` i `{total}`: es
                                // substitueixen a mà, com la resta de plantilles d'aquesta app.
                                text = stringResource(R.string.nav_pinnedprogress)
                                    .replace("{done}", done.toString())
                                    .replace("{total}", checklist.items.size.toString()),
                                color = Femho.colors.inkFaint,
                                fontSize = FemhoText.meta,
                            )
                        }
                    }
                }
            }
        }
    }
}

// `scopeColor` viu ara a `:core-designsystem` (`Palette.kt`), com a funció pura: els
// widgets de la pantalla d'inici la necessiten i allà no hi ha composició.

private fun Modifier.androidClickable(onClick: () -> Unit): Modifier = this.clickable(onClick = onClick)

@Composable
private fun SettingsHost(model: AppViewModel, serverUrl: String, onBack: () -> Unit) {
    val theme by model.theme.collectAsStateWithLifecycle()
    val accent by model.accent.collectAsStateWithLifecycle()
    val profile by model.profile.collectAsStateWithLifecycle()
    val gravatarEnabled by model.gravatarEnabled.collectAsStateWithLifecycle()
    val scopes by model.scopes.collectAsStateWithLifecycle()
    val tokens by model.tokens.collectAsStateWithLifecycle()
    val createdToken by model.createdToken.collectAsStateWithLifecycle()
    val projects by model.projects.collectAsStateWithLifecycle()
    val labels by model.labels.collectAsStateWithLifecycle()
    val taskTypes by model.taskTypes.collectAsStateWithLifecycle()
    val scopeSettings by model.scopeSettings.collectAsStateWithLifecycle()
    val calendars by model.calendars.collectAsStateWithLifecycle()
    val mailAccounts by model.mailAccounts.collectAsStateWithLifecycle()
    val mailRules by model.mailRules.collectAsStateWithLifecycle()

    LaunchedEffect(Unit) {
        model.loadEntityData()
        model.loadCalendars()
        model.loadMailData()
    }

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
            tabs = SettingsTabs(
                general = stringResource(R.string.settings_tab_general),
                scopes = stringResource(R.string.settings_tab_scopes),
                calendars = stringResource(R.string.settings_tab_calendars),
                mail = stringResource(R.string.settings_tab_mail),
                mcp = stringResource(R.string.settings_tab_mcp),
                ai = stringResource(R.string.settings_tab_ai),
                shares = stringResource(R.string.settings_tab_shares),
                profile = stringResource(R.string.settings_tab_profile),
                admin = stringResource(R.string.settings_tab_admin),
            ),
            emptyStates = SettingsEmptyStates(
                scopes = stringResource(R.string.settings_empty_scopes),
                calendars = stringResource(R.string.settings_empty_calendars),
                mail = stringResource(R.string.settings_empty_mail),
                mcp = stringResource(R.string.settings_empty_mcp),
                ai = stringResource(R.string.settings_empty_ai),
                shares = stringResource(R.string.settings_empty_shares),
                profile = stringResource(R.string.settings_empty_profile),
                admin = stringResource(R.string.settings_empty_admin),
            ),
            // General tab
            language = stringResource(R.string.settings_language),
            languageOptions = listOf(
                "ca" to "Català",
                "en" to "English",
                "es" to "Español",
            ),
            scopeMode = stringResource(R.string.settings_scopemode),
            scopeModeMulti = stringResource(R.string.settings_scopemode_multi),
            scopeModeMultiHint = stringResource(R.string.settings_scopemode_multi_hint),
            scopeModeSingle = stringResource(R.string.settings_scopemode_single),
            scopeModeSingleHint = stringResource(R.string.settings_scopemode_single_hint),
            scopeModeHelp = stringResource(R.string.settings_scopemode_help),
            weekStart = stringResource(R.string.settings_weekstart),
            weekStartAuto = stringResource(R.string.settings_weekstart_auto, stringResource(R.string.settings_day_mon)),
            weekStartMonday = stringResource(R.string.settings_day_mon),
            weekStartSunday = stringResource(R.string.settings_day_sun),
            eventTaskDeleted = stringResource(R.string.settings_events_ondelete),
            eventTaskDeletedReturn = stringResource(R.string.settings_events_ondelete_return),
            eventTaskDeletedReturnHint = stringResource(R.string.settings_events_ondelete_returnhint),
            eventTaskDeletedHide = stringResource(R.string.settings_events_ondelete_hide),
            eventTaskDeletedHideHint = stringResource(R.string.settings_events_ondelete_hidehint),
            dashboardItems = stringResource(R.string.settings_dashboarditems),
            showCalendarWidget = stringResource(R.string.settings_showcalendarwidget),
            showOverdueSection = stringResource(R.string.settings_showoverduesection),
            inboxPosition = stringResource(R.string.settings_inboxposition),
            inboxLeft = stringResource(R.string.settings_inbox_left),
            inboxRight = stringResource(R.string.settings_inbox_right),
            inboxBelow = stringResource(R.string.settings_inbox_below),
            inboxShowOverdue = stringResource(R.string.settings_inboxshowoverdue),
            about = stringResource(R.string.settings_about),
            aboutSource = stringResource(R.string.settings_source).format("0.13.0", "AGPL-3.0-or-later"),
            aboutCredits = stringResource(R.string.settings_credits),
            // Perfil
            profileName = stringResource(R.string.settings_profilename),
            profileEmail = stringResource(R.string.settings_profileemail),
            timezone = stringResource(R.string.settings_timezone),
            gravatar = stringResource(R.string.settings_gravatar),
            gravatarHelp = stringResource(R.string.settings_gravatarhelp),
            changePassword = stringResource(R.string.settings_changepassword),
            currentPassword = stringResource(R.string.settings_currentpassword),
            newPassword = stringResource(R.string.settings_newpassword),
            passwordChanged = stringResource(R.string.settings_passwordchanged),
            navSave = stringResource(R.string.nav_save),
            // MCP i API
            mcpInstructions = stringResource(R.string.settings_mcpinstructions),
            mcpUrl = stringResource(R.string.settings_mcpurl),
            tokensTitle = stringResource(R.string.tokens_title),
            tokensName = stringResource(R.string.tokens_name),
            tokensCreate = stringResource(R.string.tokens_create),
            tokensOnceWarning = stringResource(R.string.tokens_oncewarning),
            tokensPrefix = stringResource(R.string.tokens_prefix),
            tokensLastUsed = stringResource(R.string.tokens_lastused),
            tokensNever = stringResource(R.string.tokens_never),
            tokensRevoke = stringResource(R.string.tokens_revoke),
            tokensCopy = stringResource(R.string.tokens_copy),
            scopeSection = stringResource(R.string.settings_scopesection),
            entityProjects = stringResource(R.string.settings_entityprojects),
            entityLabels = stringResource(R.string.settings_entitylabels),
            entityTypes = stringResource(R.string.settings_entitytypes),
            entityDedication = stringResource(R.string.settings_entitydedication),
            projectName = stringResource(R.string.settings_projectname),
            projectDelete = stringResource(R.string.settings_projectdelete),
            labelNew = stringResource(R.string.settings_labelnew),
            labelDelete = stringResource(R.string.settings_labeldelete),
            typeNew = stringResource(R.string.settings_typenew),
            typeDelete = stringResource(R.string.settings_typedelete),
            typesOn = stringResource(R.string.settings_typeson),
            typesRequired = stringResource(R.string.settings_typesrequired),
            tracking = stringResource(R.string.settings_tracking),
            trackingOn = stringResource(R.string.settings_trackingon),
            trackingHelp = stringResource(R.string.settings_trackinghelp),
            overtimeVisible = stringResource(R.string.settings_overtimevisible),
            workStart = stringResource(R.string.settings_workstart),
            workEnd = stringResource(R.string.settings_workend),
            workDays = stringResource(R.string.settings_workdays),
            longSessionHours = stringResource(R.string.settings_longsessionhours),
            nounProject = stringResource(R.string.settings_noun_project),
            nounClient = stringResource(R.string.settings_noun_client),
            caldavUrls = stringResource(R.string.settings_caldavurls),
            caldavEvents = stringResource(R.string.settings_caldavevents),
            caldavTodos = stringResource(R.string.settings_caldavtodos),
            sourcesTitle = stringResource(R.string.settings_sources),
            sourcesAdd = stringResource(R.string.settings_sources_add),
            sourcesEmpty = stringResource(R.string.settings_sources_empty),
            sourcesFailed = stringResource(R.string.settings_sources_failed),
            sourcesInbox = stringResource(R.string.settings_sources_inbox),
            sourcesKindCaldav = stringResource(R.string.settings_sources_kind_caldav),
            sourcesKindIcal = stringResource(R.string.settings_sources_kind_ical),
            sourcesKindRss = stringResource(R.string.settings_sources_kind_rss),
            sourcesName = stringResource(R.string.settings_sources_name),
            sourcesNever = stringResource(R.string.settings_sources_never),
            sourcesPassword = stringResource(R.string.settings_sources_password),
            sourcesReadOnly = stringResource(R.string.settings_sources_readonly),
            sourcesRefreshed = stringResource(R.string.settings_sources_refreshed),
            sourcesRemove = stringResource(R.string.settings_sources_remove),
            sourcesUrl = stringResource(R.string.settings_sources_url),
            sourcesUrlRequired = stringResource(R.string.settings_sources_urlrequired),
            sourcesUsername = stringResource(R.string.settings_sources_username),
            calendarShared = stringResource(R.string.settings_calendarshared),
            sharedCalendars = stringResource(R.string.settings_sharedcalendars),
            calendarPrivate = stringResource(R.string.settings_calendarprivate),
            calendarCredWarning = stringResource(R.string.settings_calendarcredwarning),
            mailIntro = stringResource(R.string.settings_mail_intro),
            mailAccounts = stringResource(R.string.settings_mail_accounts),
            mailAdd = stringResource(R.string.settings_mail_add),
            mailName = stringResource(R.string.settings_mail_name),
            mailHost = stringResource(R.string.settings_mail_host),
            mailUsername = stringResource(R.string.settings_mail_username),
            mailPassword = stringResource(R.string.settings_mail_password),
            mailPasswordKept = stringResource(R.string.settings_mail_passwordkept),
            mailSecurity = stringResource(R.string.settings_mail_security),
            mailSecurityTls = stringResource(R.string.settings_mail_security_tls),
            mailSecurityStarttls = stringResource(R.string.settings_mail_security_starttls),
            mailTest = stringResource(R.string.settings_mail_test),
            mailTestOk = stringResource(R.string.settings_mail_testok),
            mailTestFail = stringResource(R.string.settings_mail_testfail),
            mailAppPassword = stringResource(R.string.settings_mail_apppassword),
            mailEmpty = stringResource(R.string.settings_mail_empty),
            mailRules = stringResource(R.string.settings_mail_rules),
            mailRulesEmpty = stringResource(R.string.settings_mail_rules_empty),
            mailAddRule = stringResource(R.string.settings_mail_addrule),
            mailFolder = stringResource(R.string.settings_mail_folder),
            mailFolderPlaceholder = stringResource(R.string.settings_mail_folderplaceholder),
            mailPickFolder = stringResource(R.string.settings_mail_pickfolder),
            mailLoadingFolders = stringResource(R.string.settings_mail_loadingfolders),
            mailFoldersFailed = stringResource(R.string.settings_mail_foldersfailed),
            mailScope = stringResource(R.string.settings_mail_scope),
            mailProject = stringResource(R.string.settings_mail_project),
            mailProjectNone = stringResource(R.string.settings_mail_projectnone),
            mailTemplate = stringResource(R.string.settings_mail_template),
            mailTemplatePreset = stringResource(R.string.settings_mail_templatepreset),
            mailTemplatePreview = stringResource(R.string.settings_mail_templatepreview),
            mailTemplateUnknown = stringResource(R.string.settings_mail_templateunknown),
            mailFirstRun = stringResource(R.string.settings_mail_firstrun),
            mailNotTouched = stringResource(R.string.settings_mail_nottouched),
            mailRemove = stringResource(R.string.settings_mail_remove),
            mailSave = stringResource(R.string.settings_mail_save),
            scopeType = stringResource(R.string.settings_scopetype),
            scopeTypeIndividual = stringResource(R.string.settings_scopetype_individual),
            scopeTypeCollective = stringResource(R.string.settings_scopetype_collective),
            scopeColor = stringResource(R.string.settings_scopecolor),
            members = stringResource(R.string.settings_members),
            memberRemove = stringResource(R.string.settings_memberremove),
            roleAdmin = stringResource(R.string.settings_role_admin),
            roleCollaborator = stringResource(R.string.settings_role_collaborator),
            roleViewer = stringResource(R.string.settings_role_viewer),
            roleOwner = stringResource(R.string.settings_role_owner),
            inviteCreate = stringResource(R.string.settings_invitecreate),
            inviteRevoke = stringResource(R.string.settings_inviterevoke),
            inviteOnce = stringResource(R.string.settings_inviteonce),
            inviteUrl = stringResource(R.string.settings_inviteurl),
            invites = stringResource(R.string.settings_invites),
            noInvites = stringResource(R.string.settings_invitenone),
            noMembers = stringResource(R.string.settings_nomembers),
            scopeEdit = stringResource(R.string.settings_scopeedit),
            scopeSave = stringResource(R.string.settings_scopesave),
            scopeCancel = stringResource(R.string.settings_scopecancel),
            scopeDelete = stringResource(R.string.settings_scopedelete),
            scopeDeleteConfirm = stringResource(R.string.settings_scopedeleteconfirm),
            scopeName = stringResource(R.string.settings_scopename),
            navCreate = stringResource(R.string.nav_create),
            newScope = stringResource(R.string.settings_newscope),
        ),
        profileName = profile?.name.orEmpty(),
        profileEmail = profile?.email.orEmpty(),
        profileTimezone = profile?.timezone.orEmpty(),
        gravatarEnabled = gravatarEnabled,
        scopes = scopes,
        projects = projects,
        labelsList = labels,
        taskTypes = taskTypes,
        scopeSettings = scopeSettings,
        calendars = calendars,
        mailAccounts = mailAccounts,
        mailRules = mailRules,
        theme = theme,
        accent = accent,
        serverUrl = serverUrl,
        mcpUrl = "$serverUrl/mcp",
        tokens = tokens,
        createdToken = createdToken,
        onTheme = model::setTheme,
        onAccent = model::setAccent,
        onLocale = model::setLocale,
        onScopeMode = { /* TODO: persistir al perfil */ },
        onWeekStart = model::setWeekStart,
        onEventTaskDeleted = model::setEventTaskDeleted,
        onShowCalendarWidget = model::setShowCalendarWidget,
        onShowOverdueSection = model::setShowOverdueSection,
        onInboxPosition = model::setInboxPosition,
        onInboxShowOverdue = model::setInboxShowOverdue,
        onBack = onBack,
        onLogout = model::logout,
        onSetName = model::setName,
        onSetGravatar = model::setGravatar,
        onChangePassword = model::changePassword,
        onCreateToken = model::createToken,
        onRevokeToken = model::revokeToken,
        onCopyToClipboard = model::copyToClipboard,
        onCreateScope = model::createScope,
        onUpdateScope = model::updateScope,
        onDeleteScope = model::deleteScope,
        onCreateProject = model::createProject,
        onDeleteProject = model::deleteProject,
        onCreateLabel = model::createLabel,
        onDeleteLabel = model::deleteLabel,
        onCreateTaskType = model::createTaskType,
        onUpdateTaskType = model::updateTaskType,
        onDeleteTaskType = model::deleteTaskType,
        onUpdateScopeSettings = model::updateScopeSettings,
        onCreateCalendar = model::createCalendar,
        onUpdateCalendar = model::updateCalendar,
        onDeleteCalendar = model::deleteCalendar,
        onCreateMailAccount = model::createMailAccount,
        onUpdateMailAccount = model::updateMailAccount,
        onDeleteMailAccount = model::deleteMailAccount,
        onTestMailAccount = model::testMailAccount,
         onCreateMailRule = model::createMailRule,
         onDeleteMailRule = model::deleteMailRule,
     )
 }

/** Minuts a «1 h 30 min», com la web. */
private fun fmtMinutes(minutes: Long): String {
    val h = minutes / 60
    val m = minutes % 60
    return when {
        h > 0 && m > 0 -> "${h} h ${m} min"
        h > 0 -> "${h} h"
        else -> "${m} min"
    }
}

@Composable
private fun RegistreHost(model: AppViewModel, onBoard: () -> Unit) {
    val scopes by model.scopes.collectAsStateWithLifecycle()
    val people by model.people.collectAsStateWithLifecycle()
    val projects by model.projects.collectAsStateWithLifecycle()
    val scopeSettings by model.scopeSettings.collectAsStateWithLifecycle()
    val report by model.sessions.collectAsStateWithLifecycle()

    var periode by remember { mutableStateOf("days30") }
    var from by remember { mutableStateOf(java.time.LocalDate.now().minusDays(30).toString()) }
    var to by remember { mutableStateOf(java.time.LocalDate.now().toString()) }
    var projecte by remember { mutableStateOf<String?>(null) }
    var persona by remember { mutableStateOf<String?>(null) }
    var cerca by remember { mutableStateOf("") }
    var searchDraft by remember { mutableStateOf("") }

    // Els períodes predefinits de la web (docs/02): el rang es recalcula en canviar-ne.
    val avui = java.time.LocalDate.now()
    fun aplicarPeriode(key: String) {
        periode = key
        val (f, t) = when (key) {
            "today" -> avui to avui
            "week" -> avui.minusDays(((avui.dayOfWeek.value + 6) % 7).toLong()) to avui
            "month" -> avui.withDayOfMonth(1) to avui
            "days90" -> avui.minusDays(89) to avui
            "all" -> null to null
            else -> avui.minusDays(29) to avui
        }
        from = f?.toString() ?: ""
        to = t?.toString() ?: ""
    }

    androidx.compose.runtime.LaunchedEffect(periode, projecte, persona, cerca) {
        model.loadSessions(
            from = from.ifEmpty { null },
            to = to.ifEmpty { null },
            projectId = projecte,
            userId = persona,
            search = cerca.ifBlank { null },
        )
    }

    val nomPersona = { id: String -> people.firstOrNull { it.id == id }?.name ?: id }
    val trackingActiu = scopeSettings.values.any { it.timeTracking }
    val entries = report.data
    val totals = report.totals

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Femho.pageBackground)
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            text = stringResource(R.string.nav_backtoboard),
            color = Femho.colors.inkSoft,
            fontSize = FemhoText.body,
            modifier = Modifier
                .clickable(onClick = onBoard)
                .heightIn(min = FemhoSize.touch)
                .padding(vertical = 12.dp)
                .testTag("registre-back"),
        )
        Text(
            text = stringResource(R.string.registre_title),
            color = Femho.colors.ink,
            fontSize = FemhoText.columnTitle,
            fontWeight = FontWeight.ExtraBold,
        )
        Text(
            text = stringResource(R.string.registre_subtitle),
            color = Femho.colors.inkSoft,
            fontSize = FemhoText.body,
        )

        if (!trackingActiu) {
            Text(
                text = stringResource(R.string.registre_noscopes),
                color = Femho.colors.inkFaint,
                fontSize = FemhoText.meta,
            )
        } else {
            // Filtres: període, projecte, persona, cerca
            val periodes = listOf(
                "today" to stringResource(R.string.registre_period_today),
                "week" to stringResource(R.string.registre_period_week),
                "month" to stringResource(R.string.registre_period_month),
                "days30" to stringResource(R.string.registre_period_days30),
                "days90" to stringResource(R.string.registre_period_days90),
                "all" to stringResource(R.string.registre_period_all),
            )
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                periodes.forEach { (key, label) ->
                    Text(
                        text = label,
                        color = if (periode == key) Femho.onBrand else Femho.colors.inkSoft,
                        fontSize = FemhoText.meta,
                        fontWeight = if (periode == key) FontWeight.Bold else FontWeight.Medium,
                        modifier = Modifier
                            .clip(RoundedCornerShape(FemhoShape.pill))
                            .background(if (periode == key) Femho.colors.plouBlue else Femho.colors.ghostBg)
                            .clickable { aplicarPeriode(key) }
                            .heightIn(min = FemhoSize.touch)
                            .padding(horizontal = 10.dp, vertical = 10.dp)
                            .testTag("registre-period-$key"),
                    )
                }
            }

            // Projecte: tots, intern, o els actius
            val projectesActius = projects.filter { project -> scopes.any { it.id == project.scopeId } }
            val projectOptions = listOf<String?>(null, "none") + projectesActius.map { it.id }
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                projectOptions.forEach { id ->
                    val label = when (id) {
                        null -> stringResource(R.string.registre_allprojects)
                        "none" -> stringResource(R.string.registre_noproject)
                        else -> projectesActius.first { it.id == id }.name
                    }
                    Text(
                        text = label,
                        color = if (projecte == id) Femho.onBrand else Femho.colors.inkSoft,
                        fontSize = FemhoText.meta,
                        fontWeight = if (projecte == id) FontWeight.Bold else FontWeight.Medium,
                        modifier = Modifier
                            .clip(RoundedCornerShape(FemhoShape.pill))
                            .background(if (projecte == id) Femho.colors.plouBlue else Femho.colors.ghostBg)
                            .clickable { projecte = id }
                            .heightIn(min = FemhoSize.touch)
                            .padding(horizontal = 10.dp, vertical = 10.dp)
                            .testTag("registre-project-${id ?: "all"}"),
                    )
                }
            }

            // Persona: tothom o una
            val personOptions = listOf<String?>(null) + people.map { it.id }
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                personOptions.forEach { id ->
                    val label = id?.let { nomPersona(it) } ?: stringResource(R.string.registre_everyone)
                    Text(
                        text = label,
                        color = if (persona == id) Femho.onBrand else Femho.colors.inkSoft,
                        fontSize = FemhoText.meta,
                        fontWeight = if (persona == id) FontWeight.Bold else FontWeight.Medium,
                        modifier = Modifier
                            .clip(RoundedCornerShape(FemhoShape.pill))
                            .background(if (persona == id) Femho.colors.plouBlue else Femho.colors.ghostBg)
                            .clickable { persona = id }
                            .heightIn(min = FemhoSize.touch)
                            .padding(horizontal = 10.dp, vertical = 10.dp)
                            .testTag("registre-person-${id ?: "all"}"),
                    )
                }
            }

            androidx.compose.foundation.text.BasicTextField(
                value = searchDraft,
                onValueChange = { searchDraft = it },
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(FemhoShape.pill))
                    .background(Femho.colors.ghostBg)
                    .padding(horizontal = 12.dp, vertical = 8.dp)
                    .testTag("registre-search"),
                decorationBox = { innerTextField ->
                    Box(modifier = Modifier.padding(vertical = 2.dp)) {
                        if (searchDraft.isEmpty()) {
                            Text(
                                text = stringResource(R.string.registre_search),
                                color = Femho.colors.inkFaint,
                                fontSize = FemhoText.body,
                            )
                        }
                        innerTextField()
                    }
                },
            )
            Text(
                text = stringResource(R.string.nav_save),
                color = Femho.colors.ink,
                fontSize = FemhoText.meta,
                fontWeight = FontWeight.Medium,
                modifier = Modifier
                    .clickable { cerca = searchDraft.trim() }
                    .heightIn(min = FemhoSize.touch)
                    .padding(vertical = 6.dp)
                    .testTag("registre-search-apply"),
            )

            // Resum i pastilles de persones i projectes
            Text(
                text = stringResource(R.string.registre_summary)
                    .replace("{tasks}", totals.tasks.toString())
                    .replace("{time}", fmtMinutes(totals.minutes)),
                color = Femho.colors.inkSoft,
                fontSize = FemhoText.meta,
            )
            if (totals.overtimeMinutes > 0) {
                Text(
                    text = stringResource(R.string.registre_overtimetotal)
                        .replace("{time}", fmtMinutes(totals.overtimeMinutes)),
                    color = Femho.colors.inkFaint,
                    fontSize = FemhoText.meta,
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                totals.byUser.forEach { bucket ->
                    Text(
                        text = "${nomPersona(bucket.key)}: ${fmtMinutes(bucket.minutes)}",
                        color = Femho.colors.ink,
                        fontSize = FemhoText.meta,
                        modifier = Modifier
                            .clip(RoundedCornerShape(FemhoShape.pill))
                            .background(Femho.colors.ghostBg)
                            .padding(horizontal = 10.dp, vertical = 6.dp)
                            .testTag("registre-pill-user-${bucket.key}"),
                    )
                }
                totals.byProject.forEach { bucket ->
                    Text(
                        text = buildString {
                            append(if (bucket.key == "none") stringResource(R.string.registre_noproject) else bucket.label.orEmpty())
                            append(": ")
                            append(fmtMinutes(bucket.minutes))
                        },
                        color = Femho.colors.inkSoft,
                        fontSize = FemhoText.meta,
                        modifier = Modifier
                            .clip(RoundedCornerShape(FemhoShape.pill))
                            .background(Femho.colors.ghostBg)
                            .padding(horizontal = 10.dp, vertical = 6.dp)
                            .testTag("registre-pill-project-${bucket.key}"),
                    )
                }
            }

            // La taula: blocs agrupats per dia amb total diari
            if (entries.isEmpty()) {
                Text(
                    text = stringResource(R.string.registre_empty),
                    color = Femho.colors.inkFaint,
                    fontSize = FemhoText.meta,
                )
            } else {
                val totalDia = totals.byDay.associate { it.key to it.minutes }
                var diaActual = ""
                entries.forEach { entry ->
                    val dia = entry.startedAt.take(10)
                    if (dia != diaActual) {
                        diaActual = dia
                        Row(modifier = Modifier.fillMaxWidth().background(Femho.colors.ghostBg).padding(horizontal = 10.dp, vertical = 6.dp)) {
                            Text(
                                text = dia,
                                color = Femho.colors.ink,
                                fontSize = FemhoText.body,
                                fontWeight = FontWeight.Bold,
                                modifier = Modifier.weight(1f).testTag("registre-day-$dia"),
                            )
                            Text(
                                text = fmtMinutes(totalDia[dia] ?: 0),
                                color = Femho.colors.ink,
                                fontSize = FemhoText.body,
                                fontWeight = FontWeight.Bold,
                            )
                        }
                    }
                    Row(modifier = Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 6.dp)) {
                        Text(
                            text = "${entry.startedAt.take(16).replace('T', ' ')}",
                            color = Femho.colors.inkSoft,
                            fontSize = FemhoText.meta,
                            modifier = Modifier.width(110.dp),
                        )
                        Text(
                            text = entry.projectName ?: stringResource(R.string.registre_noproject),
                            color = Femho.colors.inkSoft,
                            fontSize = FemhoText.meta,
                            modifier = Modifier.weight(1f),
                        )
                        Text(
                            text = entry.taskTitle.orEmpty(),
                            color = Femho.colors.ink,
                            fontSize = FemhoText.body,
                            modifier = Modifier.weight(2f).testTag("registre-row-${entry.id}"),
                        )
                        Text(
                            text = "${fmtMinutes(entry.minutes)}${if (entry.open) " ▶" else ""}",
                            color = if (entry.needsReview) Femho.colors.dangerText else Femho.colors.ink,
                            fontSize = FemhoText.meta,
                            fontWeight = if (entry.needsReview) FontWeight.Bold else FontWeight.Medium,
                        )
                    }
                }
            }
        }
    }
}
