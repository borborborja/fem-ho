package ho.fem.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import ho.fem.designsystem.Femho
import ho.fem.designsystem.FemhoShape
import ho.fem.designsystem.FemhoSize
import ho.fem.designsystem.FemhoText

/**
 * Ajustos a Android. docs/03 §8, docs/02 §9.
 *
 * **9 pestanyes com la web**: general, scopes, calendars, mail, mcp, ai, shares, profile, admin.
 * La fila de píndoles és desplaçable horitzontalment —el mateix patró que la web en mòbil—
 * i cada pestanya mostra un contenidor amb el seu contingut.
 *
 * **Cap literal**: tots els textos vénen del catàleg via `SettingsLabels`.
 */

data class SettingsLabels(
    val title: String,
    val back: String,
    val theme: String,
    val themeOptions: List<Pair<String, String>>,
    val accent: String,
    val accentOptions: List<Pair<String, String>>,
    val server: String,
    val logout: String,
    val tabs: SettingsTabs,
    val emptyStates: SettingsEmptyStates,
    val language: String,
    val languageOptions: List<Pair<String, String>>,
    val scopeMode: String,
    val scopeModeMulti: String,
    val scopeModeMultiHint: String,
    val scopeModeSingle: String,
    val scopeModeSingleHint: String,
    val scopeModeHelp: String,
    val weekStart: String,
    val weekStartAuto: String,
    val weekStartMonday: String,
    val weekStartSunday: String,
    val eventTaskDeleted: String,
    val eventTaskDeletedReturn: String,
    val eventTaskDeletedReturnHint: String,
    val eventTaskDeletedHide: String,
    val eventTaskDeletedHideHint: String,
    val dashboardItems: String,
    val showCalendarWidget: String,
    val showOverdueSection: String,
    val inboxPosition: String,
    val inboxLeft: String,
    val inboxRight: String,
    val inboxBelow: String,
    val inboxShowOverdue: String,
    val about: String,
    val aboutSource: String,
    val aboutCredits: String,
    // Perfil
    val profileName: String,
    val profileEmail: String,
    val timezone: String,
    val gravatar: String,
    val gravatarHelp: String,
    val changePassword: String,
    val currentPassword: String,
    val newPassword: String,
    val passwordChanged: String,
    val navSave: String,
    // Àmbits
    val scopeType: String,
    val scopeTypeIndividual: String,
    val scopeTypeCollective: String,
    val scopeColor: String,
    val members: String,
    val memberRemove: String,
    val roleAdmin: String,
    val roleCollaborator: String,
    val roleViewer: String,
    val roleOwner: String,
    val inviteCreate: String,
    val inviteRevoke: String,
    val inviteOnce: String,
    val inviteUrl: String,
    val invites: String,
    val noInvites: String,
    val noMembers: String,
    val scopeEdit: String,
    val scopeSave: String,
    val scopeCancel: String,
    val scopeDelete: String,
    val scopeDeleteConfirm: String,
    val scopeName: String,
    val navCreate: String,
    val newScope: String,
    // MCP i API
    val mcpInstructions: String,
    val mcpUrl: String,
    val tokensTitle: String,
    val tokensName: String,
    val tokensCreate: String,
    val tokensOnceWarning: String,
    val tokensPrefix: String,
    val tokensLastUsed: String,
    val tokensNever: String,
    val tokensRevoke: String,
    val tokensCopy: String,
    // Gestió de l'àmbit: projectes, etiquetes, tipologies i dedicació
    val scopeSection: String,
    val entityProjects: String,
    val entityLabels: String,
    val entityTypes: String,
    val entityDedication: String,
    val projectName: String,
    val projectDelete: String,
    val labelNew: String,
    val labelDelete: String,
    val typeNew: String,
    val typeDelete: String,
    val typesOn: String,
    val typesRequired: String,
    val tracking: String,
    val trackingOn: String,
    val trackingHelp: String,
    val overtimeVisible: String,
    val workStart: String,
    val workEnd: String,
    val workDays: String,
    val longSessionHours: String,
    val nounProject: String,
    val nounClient: String,
    // Calendaris: URL CalDAV, fonts i compartits
    val caldavUrls: String,
    val caldavEvents: String,
    val caldavTodos: String,
    val sourcesTitle: String,
    val sourcesAdd: String,
    val sourcesEmpty: String,
    val sourcesFailed: String,
    val sourcesInbox: String,
    val sourcesKindCaldav: String,
    val sourcesKindIcal: String,
    val sourcesKindRss: String,
    val sourcesName: String,
    val sourcesNever: String,
    val sourcesPassword: String,
    val sourcesReadOnly: String,
    val sourcesRefreshed: String,
    val sourcesRemove: String,
    val sourcesUrl: String,
    val sourcesUrlRequired: String,
    val sourcesUsername: String,
    val calendarShared: String,
    val sharedCalendars: String,
    val calendarPrivate: String,
    val calendarCredWarning: String,
    // Correu: comptes IMAP i regles
    val mailIntro: String,
    val mailAccounts: String,
    val mailAdd: String,
    val mailName: String,
    val mailHost: String,
    val mailUsername: String,
    val mailPassword: String,
    val mailPasswordKept: String,
    val mailSecurity: String,
    val mailSecurityTls: String,
    val mailSecurityStarttls: String,
    val mailTest: String,
    val mailTestOk: String,
    val mailTestFail: String,
    val mailAppPassword: String,
    val mailEmpty: String,
    val mailRules: String,
    val mailRulesEmpty: String,
    val mailAddRule: String,
    val mailFolder: String,
    val mailFolderPlaceholder: String,
    val mailPickFolder: String,
    val mailLoadingFolders: String,
    val mailFoldersFailed: String,
    val mailScope: String,
    val mailProject: String,
    val mailProjectNone: String,
    val mailTemplate: String,
    val mailTemplatePreset: String,
    val mailTemplatePreview: String,
    val mailTemplateUnknown: String,
    val mailFirstRun: String,
    val mailNotTouched: String,
    val mailRemove: String,
    val mailSave: String,
    // Agents (Usuari IA)
    val agents: String,
    val newAgent: String,
    val emptyAgents: String,
    val agentEnabled: String,
    val agentCanCreate: String,
    val agentScopes: String,
    val agentAllScopes: String,
    val agentScopeTaken: String,
    val agentCredentials: String,
    val agentNewCredential: String,
    val agentConnect: String,
    val agentDownloadMcp: String,
    val agentDownloadSkill: String,
    val agentMcpNoToken: String,
    val agentMcpHasToken: String,
    val agentSkillNoToken: String,
    /** El botó de crear (agent, àmbit, token...): "Crea". */
    val create: String,
    // Compartits (la pestanya: enllaços, accessos i revocar)
    val shareAccesses: String,
    val shareLastAccess: String,
    val shareRevoke: String,
    val shareRevoked: String,
)

data class SettingsTabs(
    val general: String,
    val scopes: String,
    val calendars: String,
    val mail: String,
    val mcp: String,
    val ai: String,
    val shares: String,
    val profile: String,
    val admin: String,
)

data class SettingsEmptyStates(
    val scopes: String,
    val calendars: String,
    val mail: String,
    val mcp: String,
    val ai: String,
    val shares: String,
    val profile: String,
    val admin: String,
)

@Composable
fun SettingsScreen(
    labels: SettingsLabels,
    theme: String,
    accent: String,
    serverUrl: String,
    profileName: String = "",
    profileEmail: String = "",
    profileTimezone: String = "",
    gravatarEnabled: Boolean = true,
    scopes: List<ho.fem.model.Scope> = emptyList(),
    projects: List<ho.fem.model.Project> = emptyList(),
    labelsList: List<ho.fem.model.Label> = emptyList(),
    taskTypes: List<ho.fem.model.TaskType> = emptyList(),
    scopeSettings: Map<String, ho.fem.model.ScopeSettings> = emptyMap(),
    calendars: List<ho.fem.model.Calendar> = emptyList(),
    mailAccounts: List<ho.fem.model.MailAccount> = emptyList(),
    mailRules: List<ho.fem.model.MailRule> = emptyList(),
    mcpUrl: String = "",
    tokens: List<ho.fem.model.ApiTokenSummary> = emptyList(),
    createdToken: String? = null,
    onTheme: (String) -> Unit,
    onAccent: (String) -> Unit,
    onLocale: (String) -> Unit,
    onCreateScope: (String, String, String) -> Unit,
    onUpdateScope: (String, String, String, String) -> Unit,
    onDeleteScope: (String) -> Unit,
    onScopeMode: (String) -> Unit,
    onWeekStart: (String) -> Unit,
    onEventTaskDeleted: (String) -> Unit,
    onShowCalendarWidget: (Boolean) -> Unit,
    onShowOverdueSection: (Boolean) -> Unit,
    onInboxPosition: (String) -> Unit,
    onInboxShowOverdue: (Boolean) -> Unit,
    onBack: () -> Unit,
    onLogout: () -> Unit,
    onSetName: (String) -> Unit = {},
    onSetGravatar: (Boolean) -> Unit = {},
    onChangePassword: (String, String, (String) -> Unit, () -> Unit) -> Unit = { _, _, _, _ -> },
    onCreateToken: (String, List<String>) -> Unit = { _, _ -> },
    onRevokeToken: (String) -> Unit = {},
    onCreateProject: (String, String) -> Unit = { _, _ -> },
    onDeleteProject: (String) -> Unit = {},
    onCreateLabel: (String, String) -> Unit = { _, _ -> },
    onDeleteLabel: (String) -> Unit = {},
    onCreateTaskType: (String, String) -> Unit = { _, _ -> },
    onUpdateTaskType: (String, String?, Boolean?) -> Unit = { _, _, _ -> },
    onDeleteTaskType: (String) -> Unit = {},
    onUpdateScopeSettings: (String, Boolean?, String?, String?, Boolean?, Int?, String?, Boolean?) -> Unit = { _, _, _, _, _, _, _, _ -> },
    onCreateCalendar: (String, String, String, String?, String?, String?, String?, Boolean?) -> Unit = { _, _, _, _, _, _, _, _ -> },
    onUpdateCalendar: (String, String?, String?, String?, String?, Int?, Boolean?) -> Unit = { _, _, _, _, _, _, _ -> },
    onDeleteCalendar: (String) -> Unit = {},
    onCreateMailAccount: (String, String, String, String, String) -> Unit = { _, _, _, _, _ -> },
    onUpdateMailAccount: (String, String?, String?, String?, String?, String?) -> Unit = { _, _, _, _, _, _ -> },
    onDeleteMailAccount: (String) -> Unit = {},
    onTestMailAccount: (String, (ho.fem.model.MailTestResult) -> Unit) -> Unit = { _, _ -> },
    onCreateMailRule: (String, String, String?, String?) -> Unit = { _, _, _, _ -> },
    onDeleteMailRule: (String) -> Unit = {},
    onCopyToClipboard: (String) -> Unit = {},
    // Agents (Usuari IA)
    agents: List<ho.fem.model.AgentDetail> = emptyList(),
    agentScopeAvailability: Map<String, List<ho.fem.model.AgentScopeAvailability>> = emptyMap(),
    agentCredentials: Map<String, List<ho.fem.model.ApiTokenSummary>> = emptyMap(),
    createdAgentToken: String? = null,
    agentSkill: String? = null,
    onCreateAgent: (String) -> Unit = {},
    onAgentEnabled: (ho.fem.model.AgentDetail, Boolean) -> Unit = { _, _ -> },
    onAgentCanCreate: (ho.fem.model.AgentDetail, Boolean) -> Unit = { _, _ -> },
    onAgentScopes: (ho.fem.model.AgentDetail, List<String>, Boolean) -> Unit = { _, _, _ -> },
    onAgentNewCredential: (ho.fem.model.AgentDetail) -> Unit = {},
    onRevokeAgentCredential: (String) -> Unit = {},
    onDeleteAgent: (ho.fem.model.AgentDetail) -> Unit = {},
    onAgentSkill: () -> Unit = {},
    // Compartits (la pestanya)
    shares: List<ho.fem.model.ShareSummary> = emptyList(),
    shareAccesses: Map<String, List<ho.fem.model.ShareAccess>> = emptyMap(),
    onRevokeShare: (String) -> Unit = {},
    modifier: Modifier = Modifier,
) {
    var selectedTab by remember { mutableStateOf("general") }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(Femho.pageBackground)
            .testTag("settings-screen"),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = labels.back,
                color = Femho.colors.inkSoft,
                fontSize = FemhoText.body,
                modifier = Modifier
                    .clickable(onClick = onBack)
                    .heightIn(min = FemhoSize.touch)
                    .padding(vertical = 12.dp)
                    .testTag("settings-back"),
            )
        }

        val tabs = listOf(
            "general" to labels.tabs.general,
            "scopes" to labels.tabs.scopes,
            "calendars" to labels.tabs.calendars,
            "mail" to labels.tabs.mail,
            "mcp" to labels.tabs.mcp,
            "ai" to labels.tabs.ai,
            "shares" to labels.tabs.shares,
            "profile" to labels.tabs.profile,
            "admin" to labels.tabs.admin,
        )

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState())
                .padding(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            tabs.forEach { (key, label) ->
                Text(
                    text = label,
                    color = if (selectedTab == key) Femho.onBrand else Femho.colors.inkSoft,
                    fontSize = FemhoText.body,
                    fontWeight = if (selectedTab == key) FontWeight.Bold else FontWeight.Medium,
                    modifier = Modifier
                        .clip(RoundedCornerShape(FemhoShape.pill))
                        .background(if (selectedTab == key) Femho.colors.plouBlue else Femho.colors.ghostBg)
                        .clickable { selectedTab = key }
                        .heightIn(min = FemhoSize.touch)
                        .padding(horizontal = 16.dp, vertical = 12.dp)
                        .testTag("settings-tab-$key"),
                )
            }
        }

        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(FemhoSize.columnGap),
        ) {
            when (selectedTab) {
                "general" -> GeneralTab(
                    labels = labels,
                    theme = theme,
                    accent = accent,
                    serverUrl = serverUrl,
                    onTheme = onTheme,
                    onAccent = onAccent,
                    onLocale = onLocale,
                    onScopeMode = onScopeMode,
                    onWeekStart = onWeekStart,
                    onEventTaskDeleted = onEventTaskDeleted,
                    onShowCalendarWidget = onShowCalendarWidget,
                    onShowOverdueSection = onShowOverdueSection,
                    onInboxPosition = onInboxPosition,
                    onInboxShowOverdue = onInboxShowOverdue,
                    onLogout = onLogout,
                )
                "scopes" -> ScopesTab(
                    labels = labels,
                    scopes = scopes,
                    projects = projects,
                    labelsList = labelsList,
                    taskTypes = taskTypes,
                    scopeSettings = scopeSettings,
                    onCreateScope = onCreateScope,
                    onUpdateScope = onUpdateScope,
                    onDeleteScope = onDeleteScope,
                    onCreateProject = onCreateProject,
                    onDeleteProject = onDeleteProject,
                    onCreateLabel = onCreateLabel,
                    onDeleteLabel = onDeleteLabel,
                    onCreateTaskType = onCreateTaskType,
                    onUpdateTaskType = onUpdateTaskType,
                    onDeleteTaskType = onDeleteTaskType,
                    onUpdateScopeSettings = onUpdateScopeSettings,
                    onCopyToClipboard = onCopyToClipboard,
                )
                "calendars" -> CalendarsTab(
                    labels = labels,
                    scopes = scopes,
                    calendars = calendars,
                    serverUrl = serverUrl,
                    onCreateCalendar = onCreateCalendar,
                    onUpdateCalendar = onUpdateCalendar,
                    onDeleteCalendar = onDeleteCalendar,
                    onCopyToClipboard = onCopyToClipboard,
                )
                "mail" -> MailTab(
                    labels = labels,
                    mailAccounts = mailAccounts,
                    mailRules = mailRules,
                    scopes = scopes,
                    onCreateMailAccount = onCreateMailAccount,
                    onUpdateMailAccount = onUpdateMailAccount,
                    onDeleteMailAccount = onDeleteMailAccount,
                    onTestMailAccount = onTestMailAccount,
                    onCreateMailRule = onCreateMailRule,
                    onDeleteMailRule = onDeleteMailRule,
                )
                "mcp" -> McpTab(
                    labels = labels,
                    mcpUrl = mcpUrl,
                    tokens = tokens,
                    createdToken = createdToken,
                    onCreateToken = onCreateToken,
                    onRevokeToken = onRevokeToken,
                    onCopyToClipboard = onCopyToClipboard,
                )
                "ai" -> AiTab(
                    labels = labels,
                    scopes = scopes,
                    agents = agents,
                    agentScopeAvailability = agentScopeAvailability,
                    agentCredentials = agentCredentials,
                    createdAgentToken = createdAgentToken,
                    agentSkill = agentSkill,
                    serverUrl = serverUrl,
                    onCreateAgent = onCreateAgent,
                    onAgentEnabled = onAgentEnabled,
                    onAgentCanCreate = onAgentCanCreate,
                    onAgentScopes = onAgentScopes,
                    onAgentNewCredential = onAgentNewCredential,
                    onRevokeAgentCredential = onRevokeAgentCredential,
                    onAgentSkill = onAgentSkill,
                    onCopyToClipboard = onCopyToClipboard,
                )
                "shares" -> SharesTab(
                    labels = labels,
                    shares = shares,
                    shareAccesses = shareAccesses,
                    onRevokeShare = onRevokeShare,
                )
                "profile" -> ProfileTab(
                    labels = labels,
                    name = profileName,
                    email = profileEmail,
                    timezone = profileTimezone,
                    gravatarEnabled = gravatarEnabled,
                    onSetName = onSetName,
                    onSetGravatar = onSetGravatar,
                    onChangePassword = onChangePassword,
                )
                "admin" -> EmptyState(labels.emptyStates.admin)
            }
        }
    }
}

@Composable
private fun GeneralTab(
    labels: SettingsLabels,
    theme: String,
    accent: String,
    serverUrl: String,
    onTheme: (String) -> Unit,
    onAccent: (String) -> Unit,
    onLocale: (String) -> Unit,
    onScopeMode: (String) -> Unit,
    onWeekStart: (String) -> Unit,
    onEventTaskDeleted: (String) -> Unit,
    onShowCalendarWidget: (Boolean) -> Unit,
    onShowOverdueSection: (Boolean) -> Unit,
    onInboxPosition: (String) -> Unit,
    onInboxShowOverdue: (Boolean) -> Unit,
    onLogout: () -> Unit,
) {
    // Idioma — el primer, perquè és el que canvia la pantalla on l'estàs triant
    Group(labels.language) {
        Chips(labels.languageOptions, "ca", onLocale, "language")
    }

    // Mode d'àmbits — decideix què hi ha a la barra superior
    Group(labels.scopeMode) {
        Chips(
            options = listOf(
                "multi" to labels.scopeModeMulti,
                "single" to labels.scopeModeSingle,
            ),
            value = "multi",
            onChange = onScopeMode,
            tag = "scope-mode",
        )
        Text(
            text = labels.scopeModeHelp,
            color = Femho.colors.inkSoft,
            fontSize = FemhoText.meta,
            modifier = Modifier.padding(top = 4.dp),
        )
    }

    // Primer dia de la setmana
    Group(labels.weekStart) {
        Chips(
            options = listOf(
                "auto" to labels.weekStartAuto,
                "monday" to labels.weekStartMonday,
                "sunday" to labels.weekStartSunday,
            ),
            value = "auto",
            onChange = onWeekStart,
            tag = "week-start",
        )
    }

    // Què passa amb la cita quan s'esborra la tasca
    Group(labels.eventTaskDeleted) {
        Chips(
            options = listOf(
                "return_to_inbox" to labels.eventTaskDeletedReturn,
                "hide_from_inbox" to labels.eventTaskDeletedHide,
            ),
            value = "return_to_inbox",
            onChange = onEventTaskDeleted,
            tag = "event-task-deleted",
        )
    }

    // Tema
    Group(labels.theme) {
        Chips(labels.themeOptions, theme, onTheme, "theme")
    }

    // Accent
    Group(labels.accent) {
        Chips(labels.accentOptions, accent, onAccent, "accent")
    }

    // Què es mostra al tauler general
    Group(labels.dashboardItems) {
        Toggle(labels.showCalendarWidget, checked = true, onChange = onShowCalendarWidget)
        Toggle(labels.showOverdueSection, checked = true, onChange = onShowOverdueSection)
    }

    // Posició de l'Inbox
    Group(labels.inboxPosition) {
        Chips(
            options = listOf(
                "left" to labels.inboxLeft,
                "right" to labels.inboxRight,
                "below" to labels.inboxBelow,
            ),
            value = "right",
            onChange = onInboxPosition,
            tag = "inbox-position",
        )
        Toggle(labels.inboxShowOverdue, checked = true, onChange = onInboxShowOverdue)
    }

    // Sobre
    Group(labels.about) {
        Text(
            text = labels.aboutSource,
            color = Femho.colors.inkSoft,
            fontSize = FemhoText.meta,
        )
        Text(
            text = labels.aboutCredits,
            color = Femho.colors.inkSoft,
            fontSize = FemhoText.meta,
            modifier = Modifier.padding(top = 8.dp),
        )
    }

    // Servidor
    Group(labels.server) {
        Text(serverUrl, color = Femho.colors.inkSoft, fontSize = FemhoText.body)
    }

    // Tancar sessió
    Text(
        text = labels.logout,
        color = Femho.colors.dangerText,
        fontSize = FemhoText.body,
        fontWeight = FontWeight.SemiBold,
        modifier = Modifier
            .clickable(onClick = onLogout)
            .heightIn(min = FemhoSize.touch)
            .padding(vertical = 12.dp)
            .testTag("settings-logout"),
    )
}

@Composable
private fun Group(title: String, content: @Composable () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(FemhoShape.card))
            .background(Femho.colors.cardBg)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(title, color = Femho.colors.ink, fontWeight = FontWeight.ExtraBold)
        content()
    }
}

@Composable
private fun Chips(
    options: List<Pair<String, String>>,
    value: String,
    onChange: (String) -> Unit,
    tag: String,
) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        options.forEach { (key, label) ->
            Text(
                text = label,
                color = if (value == key) Femho.onBrand else Femho.colors.inkSoft,
                fontSize = FemhoText.body,
                fontWeight = if (value == key) FontWeight.Bold else FontWeight.Medium,
                modifier = Modifier
                    .clip(RoundedCornerShape(FemhoShape.pill))
                    .background(if (value == key) Femho.colors.plouBlue else Femho.colors.ghostBg)
                    .clickable { onChange(key) }
                    .heightIn(min = FemhoSize.touch)
                    .padding(horizontal = 16.dp, vertical = 12.dp)
                    .testTag("$tag-$key"),
            )
        }
    }
}

/**
 * Un commutador amb etiqueta i estat.
 *
 * El patró de la web (Toggle component): etiqueta a l'esquerra, commutador a la dreta.
 * L'estat es mostra amb el color de l'accent (encès) o inkSoft (apagat).
 */
@Composable
private fun Toggle(
    label: String,
    checked: Boolean,
    onChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clickable { onChange(!checked) }
            .heightIn(min = FemhoSize.touch)
            .padding(vertical = 8.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = label,
            color = Femho.colors.ink,
            fontSize = FemhoText.body,
        )
        // Commutador visual: rectangle arrodonit amb cercle interior
        Box(
            modifier = Modifier
                .size(width = 40.dp, height = 24.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(if (checked) Femho.colors.plouBlue else Femho.colors.ghostBg)
                .padding(4.dp),
        ) {
            Box(
                modifier = Modifier
                    .size(16.dp)
                    .align(if (checked) Alignment.CenterEnd else Alignment.CenterStart)
                    .background(Femho.onBrand, RoundedCornerShape(8.dp)),
            )
        }
    }
}

/**
 * La pestanya Perfil d'Ajustos.
 *
 * Segueix el mateix disseny que la web (SettingsScreen.tsx:2236-2371):
 * - Nom (editable, desa en perdre el focus → PATCH /auth/me)
 * - Correu (només lectura)
 * - Zona horària (només lectura)
 * - Gravatar (commutador → PATCH /auth/settings)
 * - Canviar contrasenya (dos camps + botó → POST /auth/password)
 */
@Composable
private fun ProfileTab(
    labels: SettingsLabels,
    name: String,
    email: String,
    timezone: String,
    gravatarEnabled: Boolean,
    onSetName: (String) -> Unit,
    onSetGravatar: (Boolean) -> Unit,
    onChangePassword: (String, String, (String) -> Unit, () -> Unit) -> Unit,
) {
    var nameDraft by mutableStateOf(name)
    var currentPassword by remember { mutableStateOf("") }
    var newPassword by remember { mutableStateOf("") }
    var passwordError by remember { mutableStateOf<String?>(null) }
    var passwordSuccess by remember { mutableStateOf(false) }

    // El grup del nom
    Group(labels.tabs.profile) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            // Nom editable
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    text = labels.profileName,
                    color = Femho.colors.inkSoft,
                    fontSize = FemhoText.meta,
                )
                androidx.compose.foundation.text.BasicTextField(
                    value = nameDraft,
                    onValueChange = { nameDraft = it },
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(FemhoShape.pill))
                        .background(Femho.colors.ghostBg)
                        .padding(horizontal = 12.dp, vertical = 10.dp),
                    decorationBox = { innerTextField ->
                        Box(modifier = Modifier.padding(vertical = 4.dp)) {
                            if (nameDraft.isEmpty()) {
                                Text(
                                    text = "El teu nom",
                                    color = Femho.colors.inkFaint,
                                    fontSize = FemhoText.body,
                                )
                            } else {
                                Text(
                                    text = nameDraft,
                                    color = Femho.colors.ink,
                                    fontSize = FemhoText.body,
                                )
                            }
                            innerTextField()
                        }
                    },
                )
            }

            // Correu només lectura
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    text = labels.profileEmail,
                    color = Femho.colors.inkSoft,
                    fontSize = FemhoText.meta,
                )
                Text(
                    text = email.ifEmpty { "—" },
                    color = Femho.colors.ink,
                    fontSize = FemhoText.body,
                )
            }

            // Zona horària només lectura
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    text = labels.timezone,
                    color = Femho.colors.inkSoft,
                    fontSize = FemhoText.meta,
                )
                Text(
                    text = timezone.ifEmpty { "—" },
                    color = Femho.colors.ink,
                    fontSize = FemhoText.body,
                )
            }
        }
    }

    // Gravatar
    Group("Gravatar") {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Toggle(
                label = labels.gravatar,
                checked = gravatarEnabled,
                onChange = onSetGravatar,
            )
            Text(
                text = labels.gravatarHelp,
                color = Femho.colors.inkFaint,
                fontSize = FemhoText.meta,
            )
        }
    }

    // Canviar contrasenya
    Group(labels.changePassword) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            // Contrasenya actual
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    text = labels.currentPassword,
                    color = Femho.colors.inkSoft,
                    fontSize = FemhoText.meta,
                )
                androidx.compose.foundation.text.BasicTextField(
                    value = currentPassword,
                    onValueChange = {
                        currentPassword = it
                        passwordError = null
                        passwordSuccess = false
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(FemhoShape.pill))
                        .background(Femho.colors.ghostBg)
                        .padding(horizontal = 12.dp, vertical = 10.dp),
                    decorationBox = { innerTextField ->
                        Box(modifier = Modifier.padding(vertical = 4.dp)) {
                            if (currentPassword.isEmpty()) {
                                Text(
                                    text = labels.currentPassword,
                                    color = Femho.colors.inkFaint,
                                    fontSize = FemhoText.body,
                                )
                            } else {
                                Text(
                                    text = currentPassword,
                                    color = Femho.colors.ink,
                                    fontSize = FemhoText.body,
                                )
                            }
                            innerTextField()
                        }
                    },
                )
            }

            // Contrasenya nova
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    text = labels.newPassword,
                    color = Femho.colors.inkSoft,
                    fontSize = FemhoText.meta,
                )
                androidx.compose.foundation.text.BasicTextField(
                    value = newPassword,
                    onValueChange = {
                        newPassword = it
                        passwordError = null
                        passwordSuccess = false
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(FemhoShape.pill))
                        .background(Femho.colors.ghostBg)
                        .padding(horizontal = 12.dp, vertical = 10.dp),
                    decorationBox = { innerTextField ->
                        Box(modifier = Modifier.padding(vertical = 4.dp)) {
                            if (newPassword.isEmpty()) {
                                Text(
                                    text = labels.newPassword,
                                    color = Femho.colors.inkFaint,
                                    fontSize = FemhoText.body,
                                )
                            } else {
                                Text(
                                    text = newPassword,
                                    color = Femho.colors.ink,
                                    fontSize = FemhoText.body,
                                )
                            }
                            innerTextField()
                        }
                    },
                )
            }

            // Error o èxit
            passwordError?.let { error ->
                Text(
                    text = error,
                    color = Femho.colors.dangerText,
                    fontSize = FemhoText.meta,
                )
            }
            if (passwordSuccess) {
                Text(
                    text = labels.passwordChanged,
                    color = Femho.colors.inkSoft,
                    fontSize = FemhoText.meta,
                )
            }

            // Botó de canviar
            Text(
                text = labels.navSave,
                color = if (newPassword.length < 10) Femho.colors.inkFaint else Femho.onBrand,
                fontSize = FemhoText.body,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier
                    .clickable(enabled = newPassword.length >= 10) {
                        if (newPassword.length < 10) return@clickable
                        onChangePassword(
                            currentPassword,
                            newPassword,
                            { error ->
                                passwordError = error
                                passwordSuccess = false
                            },
                            {
                                passwordSuccess = true
                                currentPassword = ""
                                newPassword = ""
                            },
                        )
                    }
                    .heightIn(min = FemhoSize.touch)
                    .padding(vertical = 12.dp),
            )
        }
    }
}

/**
 * La pestanya MCP i API.
 *
 * Segueix el mateix disseny que la web (SettingsScreen.tsx:1650-1818):
 * - URL MCP amb botó de copiar
 * - Crear token (POST /tokens amb name + capabilities)
 * - El token es mostra UN SOL COP amb botó de copiar (P17: mai es torna a veure)
 * - Llista de tokens amb prefix i últim ús
 * - Botó de revocar a cada token
 */
@Composable
private fun McpTab(
    labels: SettingsLabels,
    mcpUrl: String,
    tokens: List<ho.fem.model.ApiTokenSummary>,
    createdToken: String?,
    onCreateToken: (String, List<String>) -> Unit,
    onRevokeToken: (String) -> Unit,
    onCopyToClipboard: (String) -> Unit,
) {
    var tokenName by remember { mutableStateOf("") }

    // URL MCP
    Group(labels.tabs.mcp) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(
                text = labels.mcpInstructions,
                color = Femho.colors.inkSoft,
                fontSize = FemhoText.meta,
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                androidx.compose.foundation.text.BasicTextField(
                    value = mcpUrl,
                    onValueChange = {},
                    readOnly = true,
                    modifier = Modifier
                        .weight(1f)
                        .clip(RoundedCornerShape(FemhoShape.pill))
                        .background(Femho.colors.ghostBg)
                        .padding(horizontal = 12.dp, vertical = 10.dp),
                    decorationBox = { innerTextField ->
                        Box(modifier = Modifier.padding(vertical = 4.dp)) {
                            Text(
                                text = mcpUrl,
                                color = Femho.colors.ink,
                                fontSize = FemhoText.body,
                            )
                            innerTextField()
                        }
                    },
                )
                Text(
                    text = labels.tokensCopy,
                    color = Femho.onBrand,
                    fontSize = FemhoText.body,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier
                        .clickable { onCopyToClipboard(mcpUrl) }
                        .heightIn(min = FemhoSize.touch)
                        .padding(vertical = 12.dp, horizontal = 16.dp),
                )
            }
        }
    }

    // Tokens
    Group(labels.tokensTitle) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            // Token creat: es mostra UN SOL COP
            if (createdToken != null) {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        androidx.compose.foundation.text.BasicTextField(
                            value = createdToken,
                            onValueChange = {},
                            readOnly = true,
                            modifier = Modifier
                                .weight(1f)
                                .clip(RoundedCornerShape(FemhoShape.pill))
                                .background(Femho.colors.ghostBg)
                                .padding(horizontal = 12.dp, vertical = 10.dp),
                            decorationBox = { innerTextField ->
                                Box(modifier = Modifier.padding(vertical = 4.dp)) {
                                    Text(
                                        text = createdToken,
                                        color = Femho.colors.ink,
                                        fontSize = FemhoText.body,
                                        fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace,
                                    )
                                    innerTextField()
                                }
                            },
                        )
                        Text(
                            text = labels.tokensCopy,
                            color = Femho.onBrand,
                            fontSize = FemhoText.body,
                            fontWeight = FontWeight.SemiBold,
                            modifier = Modifier
                                .clickable { onCopyToClipboard(createdToken) }
                                .heightIn(min = FemhoSize.touch)
                                .padding(vertical = 12.dp, horizontal = 16.dp),
                        )
                    }
                    Text(
                        text = labels.tokensOnceWarning,
                        color = Femho.colors.dangerText,
                        fontSize = FemhoText.meta,
                    )
                }
            }

            // Llista de tokens
            tokens.forEach { token ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 4.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(
                            text = token.prefix,
                            color = Femho.colors.ink,
                            fontSize = FemhoText.body,
                            fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace,
                        )
                        Text(
                            text = token.lastUsedAt?.let { lastUsed ->
                                // Format simple de data
                                labels.tokensLastUsed
                            } ?: labels.tokensNever,
                            color = Femho.colors.inkSoft,
                            fontSize = FemhoText.meta,
                        )
                    }
                    Text(
                        text = labels.tokensRevoke,
                        color = Femho.colors.dangerText,
                        fontSize = FemhoText.body,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier
                            .clickable { onRevokeToken(token.id) }
                            .heightIn(min = FemhoSize.touch)
                            .padding(vertical = 12.dp, horizontal = 16.dp),
                    )
                }
            }

            // Formulari de creació
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                androidx.compose.foundation.text.BasicTextField(
                    value = tokenName,
                    onValueChange = { tokenName = it },
                    modifier = Modifier
                        .weight(1f)
                        .clip(RoundedCornerShape(FemhoShape.pill))
                        .background(Femho.colors.ghostBg)
                        .padding(horizontal = 12.dp, vertical = 10.dp),
                    decorationBox = { innerTextField ->
                        Box(modifier = Modifier.padding(vertical = 4.dp)) {
                            if (tokenName.isEmpty()) {
                                Text(
                                    text = labels.tokensName,
                                    color = Femho.colors.inkFaint,
                                    fontSize = FemhoText.body,
                                )
                            } else {
                                Text(
                                    text = tokenName,
                                    color = Femho.colors.ink,
                                    fontSize = FemhoText.body,
                                )
                            }
                            innerTextField()
                        }
                    },
                )
                Text(
                    text = labels.tokensCreate,
                    color = if (tokenName.trim().isEmpty()) Femho.colors.inkFaint else Femho.onBrand,
                    fontSize = FemhoText.body,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier
                        .clickable(enabled = tokenName.trim().isNotEmpty()) {
                            if (tokenName.trim().isEmpty()) return@clickable
                            // Capacitats per defecte com la web
                            onCreateToken(
                                tokenName.trim(),
                                listOf("tasks:read", "tasks:write", "checklists:read", "checklists:write"),
                            )
                            tokenName = ""
                        }
                        .heightIn(min = FemhoSize.touch)
                        .padding(vertical = 12.dp, horizontal = 16.dp),
                )
            }
        }
    }
}

/**
 * La pestanya Àmbits d'Ajustos.
 *
 * Implementa el CRUD complet d'àmbits (crear, editar, esborrar), la gestió de membres
 * (llista, canvi de rol, treure) i els convits (crear enllaç d'un sol ús, revocar).
 *
 * Segueix el mateix patró que la web (SettingsScreen.tsx:1042-1336):
 * - Llista d'àmbits amb color, nom i tipus
 * - Crear àmbit nou (nom, color de 8 opcions, tipus individual/col·lectiu)
 * - Editar àmbit (nom, color, tipus)
 * - Esborrar àmbit (només si és buit)
 * - Per a cada àmbit col·lectiu: membres amb canvi de rol i treure
 * - Convits: crear enllaç d'un sol ús amb botó de copiar, revocar convits
 */
@Composable
private fun CalendarsTab(
    labels: SettingsLabels,
    scopes: List<ho.fem.model.Scope>,
    calendars: List<ho.fem.model.Calendar>,
    serverUrl: String,
    onCreateCalendar: (String, String, String, String?, String?, String?, String?, Boolean?) -> Unit,
    onUpdateCalendar: (String, String?, String?, String?, String?, Int?, Boolean?) -> Unit,
    onDeleteCalendar: (String) -> Unit,
    onCopyToClipboard: (String) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        scopes.forEach { scope ->
            Group(scope.name) {
                val sources = calendars.filter { it.scopeId == scope.id && it.origin == ho.fem.model.CalendarOrigin.SUBSCRIPTION }
                val shared = calendars.filter { it.sharedWithScope }

                if (sources.isEmpty()) {
                    Text(
                        text = labels.sourcesEmpty,
                        color = Femho.colors.inkFaint,
                        fontSize = FemhoText.meta,
                    )
                } else {
                    sources.forEach { source ->
                        Row(
                            verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    text = source.name,
                                    color = Femho.colors.ink,
                                    fontSize = FemhoText.body,
                                )
                                val lastError = source.lastError
                                val lastRefreshedAt = source.lastRefreshedAt
                                val status = when {
                                    lastError != null -> labels.sourcesFailed.replace("{reason}", lastError)
                                    lastRefreshedAt == null -> labels.sourcesNever
                                    else -> labels.sourcesRefreshed.replace("{when}", lastRefreshedAt)
                                }
                                Text(
                                    text = status,
                                    color = if (source.lastError != null) Femho.colors.dangerText else Femho.colors.inkFaint,
                                    fontSize = FemhoText.meta,
                                )
                            }
                            androidx.compose.material3.Switch(
                                checked = source.inboxVisible ?: true,
                                onCheckedChange = { on ->
                                    onUpdateCalendar(source.id, null, null, null, null, null, on)
                                },
                            )
                            Text(
                                text = labels.sourcesRemove,
                                color = Femho.colors.dangerText,
                                fontSize = FemhoText.meta,
                                modifier = Modifier
                                    .clickable { onDeleteCalendar(source.id) }
                                    .heightIn(min = FemhoSize.touch)
                                    .padding(horizontal = 8.dp, vertical = 6.dp),
                            )
                        }
                    }
                }

                var newSourceKind by remember(scope.id) { mutableStateOf("ical") }
                var newSourceName by remember(scope.id) { mutableStateOf("") }
                var newSourceUrl by remember(scope.id) { mutableStateOf("") }
                var newSourceUsername by remember(scope.id) { mutableStateOf("") }
                var newSourcePassword by remember(scope.id) { mutableStateOf("") }

                Text(
                    text = labels.sourcesTitle,
                    color = Femho.colors.inkSoft,
                    fontSize = FemhoText.body,
                    fontWeight = FontWeight.Medium,
                )
                Chips(
                    options = listOf(
                        "caldav" to labels.sourcesKindCaldav,
                        "ical" to labels.sourcesKindIcal,
                        "rss" to labels.sourcesKindRss,
                    ),
                    value = newSourceKind,
                    onChange = { newSourceKind = it },
                    tag = "source-kind",
                )
                androidx.compose.foundation.text.BasicTextField(
                    value = newSourceName,
                    onValueChange = { newSourceName = it },
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(FemhoShape.pill))
                        .background(Femho.colors.ghostBg)
                        .padding(horizontal = 12.dp, vertical = 8.dp),
                    decorationBox = { innerTextField ->
                        Box(modifier = Modifier.padding(vertical = 2.dp)) {
                            if (newSourceName.isEmpty()) {
                                Text(
                                    text = labels.sourcesName,
                                    color = Femho.colors.inkFaint,
                                    fontSize = FemhoText.body,
                                )
                            }
                            innerTextField()
                        }
                    },
                )
                androidx.compose.foundation.text.BasicTextField(
                    value = newSourceUrl,
                    onValueChange = { newSourceUrl = it },
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(FemhoShape.pill))
                        .background(Femho.colors.ghostBg)
                        .padding(horizontal = 12.dp, vertical = 8.dp),
                    decorationBox = { innerTextField ->
                        Box(modifier = Modifier.padding(vertical = 2.dp)) {
                            if (newSourceUrl.isEmpty()) {
                                Text(
                                    text = labels.sourcesUrl,
                                    color = Femho.colors.inkFaint,
                                    fontSize = FemhoText.body,
                                )
                            }
                            innerTextField()
                        }
                    },
                )
                if (newSourceKind == "caldav") {
                    androidx.compose.foundation.text.BasicTextField(
                        value = newSourceUsername,
                        onValueChange = { newSourceUsername = it },
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(FemhoShape.pill))
                            .background(Femho.colors.ghostBg)
                            .padding(horizontal = 12.dp, vertical = 8.dp),
                        decorationBox = { innerTextField ->
                            Box(modifier = Modifier.padding(vertical = 2.dp)) {
                                if (newSourceUsername.isEmpty()) {
                                    Text(
                                        text = labels.sourcesUsername,
                                        color = Femho.colors.inkFaint,
                                        fontSize = FemhoText.body,
                                    )
                                }
                                innerTextField()
                            }
                        },
                    )
                    androidx.compose.foundation.text.BasicTextField(
                        value = newSourcePassword,
                        onValueChange = { newSourcePassword = it },
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(FemhoShape.pill))
                            .background(Femho.colors.ghostBg)
                            .padding(horizontal = 12.dp, vertical = 8.dp),
                        decorationBox = { innerTextField ->
                            Box(modifier = Modifier.padding(vertical = 2.dp)) {
                                if (newSourcePassword.isEmpty()) {
                                    Text(
                                        text = labels.sourcesPassword,
                                        color = Femho.colors.inkFaint,
                                        fontSize = FemhoText.body,
                                    )
                                }
                                innerTextField()
                            }
                        },
                    )
                }
                Text(
                    text = labels.sourcesAdd,
                    color = Femho.colors.ink,
                    fontSize = FemhoText.body,
                    fontWeight = FontWeight.Medium,
                    modifier = Modifier
                        .clickable {
                            if (newSourceUrl.isNotBlank()) {
                                onCreateCalendar(
                                    scope.id,
                                    newSourceName.trim().ifEmpty { newSourceUrl.trim() },
                                    "subscription",
                                    newSourceKind,
                                    newSourceUrl.trim(),
                                    if (newSourceKind == "caldav" && newSourceUsername.isNotBlank()) newSourceUsername.trim() else null,
                                    if (newSourceKind == "caldav" && newSourcePassword.isNotBlank()) newSourcePassword.trim() else null,
                                    null,
                                )
                                newSourceName = ""
                                newSourceUrl = ""
                                newSourceUsername = ""
                                newSourcePassword = ""
                            }
                        }
                        .heightIn(min = FemhoSize.touch)
                        .padding(vertical = 8.dp),
                )

                if (shared.isNotEmpty()) {
                    Text(
                        text = labels.sharedCalendars,
                        color = Femho.colors.inkSoft,
                        fontSize = FemhoText.body,
                        fontWeight = FontWeight.Medium,
                    )
                    shared.forEach { calendar ->
                        Text(
                            text = calendar.name,
                            color = Femho.colors.ink,
                            fontSize = FemhoText.body,
                        )
                    }
                }

                Text(
                    text = labels.caldavUrls,
                    color = Femho.colors.inkSoft,
                    fontSize = FemhoText.body,
                    fontWeight = FontWeight.Medium,
                )
                listOf("events" to labels.caldavEvents, "todos" to labels.caldavTodos).forEach { (kind, kindLabel) ->
                    Row(
                        verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(
                            text = kindLabel,
                            color = Femho.colors.inkFaint,
                            fontSize = FemhoText.meta,
                            modifier = Modifier.width(90.dp),
                        )
                        val url = "$serverUrl/dav/calendars/${scope.id}-$kind/"
                        Text(
                            text = url,
                            color = Femho.colors.inkSoft,
                            fontSize = FemhoText.meta,
                            modifier = Modifier.weight(1f),
                        )
                        Text(
                            text = labels.tokensCopy,
                            color = Femho.colors.ink,
                            fontSize = FemhoText.meta,
                            modifier = Modifier
                                .clickable { onCopyToClipboard(url) }
                                .heightIn(min = FemhoSize.touch)
                                .padding(horizontal = 8.dp, vertical = 6.dp),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun MailTab(
    labels: SettingsLabels,
    mailAccounts: List<ho.fem.model.MailAccount>,
    mailRules: List<ho.fem.model.MailRule>,
    scopes: List<ho.fem.model.Scope>,
    onCreateMailAccount: (String, String, String, String, String) -> Unit,
    onUpdateMailAccount: (String, String?, String?, String?, String?, String?) -> Unit,
    onDeleteMailAccount: (String) -> Unit,
    onTestMailAccount: (String, (ho.fem.model.MailTestResult) -> Unit) -> Unit,
    onCreateMailRule: (String, String, String?, String?) -> Unit,
    onDeleteMailRule: (String) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(
            text = labels.mailIntro,
            color = Femho.colors.inkFaint,
            fontSize = FemhoText.meta,
        )
        Text(
            text = labels.mailNotTouched,
            color = Femho.colors.inkFaint,
            fontSize = FemhoText.meta,
        )

        // Comptes
        Group(labels.mailAccounts) {
            var newName by remember { mutableStateOf("") }
            var newHost by remember { mutableStateOf("") }
            var newUsername by remember { mutableStateOf("") }
            var newPassword by remember { mutableStateOf("") }
            var newSecurity by remember { mutableStateOf("tls") }
            val testResults = remember { mutableStateOf<Map<String, ho.fem.model.MailTestResult>>(emptyMap()) }

            if (mailAccounts.isEmpty()) {
                Text(
                    text = labels.mailEmpty,
                    color = Femho.colors.inkFaint,
                    fontSize = FemhoText.meta,
                )
            } else {
                mailAccounts.forEach { account ->
                    Column(modifier = Modifier.fillMaxWidth()) {
                        Row(
                            verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    text = account.name,
                                    color = Femho.colors.ink,
                                    fontSize = FemhoText.body,
                                )
                                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                    Text(
                                        text = account.host,
                                        color = Femho.colors.inkFaint,
                                        fontSize = FemhoText.meta,
                                    )
                                    Text(
                                        text = account.username,
                                        color = Femho.colors.inkFaint,
                                        fontSize = FemhoText.meta,
                                    )
                                }
                            }
                            Text(
                                text = labels.mailRemove,
                                color = Femho.colors.dangerText,
                                fontSize = FemhoText.meta,
                                modifier = Modifier
                                    .clickable { onDeleteMailAccount(account.id) }
                                    .heightIn(min = FemhoSize.touch)
                                    .padding(horizontal = 8.dp, vertical = 6.dp),
                            )
                        }
                        Text(
                            text = labels.mailTest,
                            color = Femho.colors.ink,
                            fontSize = FemhoText.meta,
                            fontWeight = FontWeight.Medium,
                            modifier = Modifier
                                .clickable {
                                    onTestMailAccount(account.id) { result ->
                                        testResults.value = testResults.value + (account.id to result)
                                    }
                                }
                                .heightIn(min = FemhoSize.touch)
                                .padding(vertical = 6.dp),
                        )
                        testResults.value[account.id]?.let { result ->
                            Text(
                                text = if (result.ok) labels.mailTestOk.replace("{count}", "—") else labels.mailTestFail.replace("{error}", result.error.orEmpty()),
                                color = if (result.ok) Femho.colors.ink else Femho.colors.dangerText,
                                fontSize = FemhoText.meta,
                            )
                        }
                        if (account.hasSecret) {
                            Text(
                                text = labels.mailPasswordKept,
                                color = Femho.colors.inkFaint,
                                fontSize = FemhoText.meta,
                            )
                        }
                    }
                }
            }

            // Formulari d'afegir compte
            androidx.compose.foundation.text.BasicTextField(
                value = newName,
                onValueChange = { newName = it },
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(FemhoShape.pill))
                    .background(Femho.colors.ghostBg)
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                decorationBox = { innerTextField ->
                    Box(modifier = Modifier.padding(vertical = 2.dp)) {
                        if (newName.isEmpty()) {
                            Text(text = labels.mailName, color = Femho.colors.inkFaint, fontSize = FemhoText.body)
                        }
                        innerTextField()
                    }
                },
            )
            androidx.compose.foundation.text.BasicTextField(
                value = newHost,
                onValueChange = { newHost = it },
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(FemhoShape.pill))
                    .background(Femho.colors.ghostBg)
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                decorationBox = { innerTextField ->
                    Box(modifier = Modifier.padding(vertical = 2.dp)) {
                        if (newHost.isEmpty()) {
                            Text(text = labels.mailHost, color = Femho.colors.inkFaint, fontSize = FemhoText.body)
                        }
                        innerTextField()
                    }
                },
            )
            androidx.compose.foundation.text.BasicTextField(
                value = newUsername,
                onValueChange = { newUsername = it },
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(FemhoShape.pill))
                    .background(Femho.colors.ghostBg)
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                decorationBox = { innerTextField ->
                    Box(modifier = Modifier.padding(vertical = 2.dp)) {
                        if (newUsername.isEmpty()) {
                            Text(text = labels.mailUsername, color = Femho.colors.inkFaint, fontSize = FemhoText.body)
                        }
                        innerTextField()
                    }
                },
            )
            androidx.compose.foundation.text.BasicTextField(
                value = newPassword,
                onValueChange = { newPassword = it },
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(FemhoShape.pill))
                    .background(Femho.colors.ghostBg)
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                decorationBox = { innerTextField ->
                    Box(modifier = Modifier.padding(vertical = 2.dp)) {
                        if (newPassword.isEmpty()) {
                            Text(text = labels.mailPassword, color = Femho.colors.inkFaint, fontSize = FemhoText.body)
                        }
                        innerTextField()
                    }
                },
            )
            Text(
                text = labels.mailSecurity,
                color = Femho.colors.inkSoft,
                fontSize = FemhoText.meta,
            )
            Chips(
                options = listOf(
                    "tls" to labels.mailSecurityTls,
                    "starttls" to labels.mailSecurityStarttls,
                ),
                value = newSecurity,
                onChange = { newSecurity = it },
                tag = "mail-security",
            )
            Text(
                text = labels.mailAdd,
                color = Femho.colors.ink,
                fontSize = FemhoText.body,
                fontWeight = FontWeight.Medium,
                modifier = Modifier
                    .clickable {
                        if (newName.isNotBlank() && newHost.isNotBlank() && newUsername.isNotBlank()) {
                            onCreateMailAccount(newName.trim(), newHost.trim(), newUsername.trim(), newPassword.trim(), newSecurity)
                            newName = ""
                            newHost = ""
                            newUsername = ""
                            newPassword = ""
                        }
                    }
                    .heightIn(min = FemhoSize.touch)
                    .padding(vertical = 8.dp),
            )
        }

        // Regles (carpetes mapades)
        Group(labels.mailRules) {
            var ruleAccount by remember { mutableStateOf<String?>(null) }
            var ruleFolder by remember { mutableStateOf("") }
            var ruleScope by remember { mutableStateOf<String?>(null) }
            var ruleTemplate by remember { mutableStateOf("") }

            if (mailRules.isEmpty()) {
                Text(
                    text = labels.mailRulesEmpty,
                    color = Femho.colors.inkFaint,
                    fontSize = FemhoText.meta,
                )
            } else {
                mailRules.forEach { rule ->
                    val ruleAccountName = mailAccounts.firstOrNull { it.id == rule.accountId }?.name
                    Row(
                        verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = "${ruleAccountName ?: "—"} · ${rule.folder}",
                                color = Femho.colors.ink,
                                fontSize = FemhoText.body,
                            )
                            val titleTemplate = rule.titleTemplate
                            if (!titleTemplate.isNullOrEmpty()) {
                                Text(
                                    text = titleTemplate,
                                    color = Femho.colors.inkFaint,
                                    fontSize = FemhoText.meta,
                                )
                            }
                        }
                        Text(
                            text = labels.mailRemove,
                            color = Femho.colors.dangerText,
                            fontSize = FemhoText.meta,
                            modifier = Modifier
                                .clickable { onDeleteMailRule(rule.id) }
                                .heightIn(min = FemhoSize.touch)
                                .padding(horizontal = 8.dp, vertical = 6.dp),
                        )
                    }
                }
            }

            if (mailAccounts.isNotEmpty()) {
                Chips(
                    options = mailAccounts.map { it.id to it.name },
                    value = ruleAccount.orEmpty(),
                    onChange = { ruleAccount = it },
                    tag = "rule-account",
                )
                androidx.compose.foundation.text.BasicTextField(
                    value = ruleFolder,
                    onValueChange = { ruleFolder = it },
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(FemhoShape.pill))
                        .background(Femho.colors.ghostBg)
                        .padding(horizontal = 12.dp, vertical = 8.dp),
                    decorationBox = { innerTextField ->
                        Box(modifier = Modifier.padding(vertical = 2.dp)) {
                            if (ruleFolder.isEmpty()) {
                                Text(text = labels.mailFolderPlaceholder, color = Femho.colors.inkFaint, fontSize = FemhoText.body)
                            }
                            innerTextField()
                        }
                    },
                )
                Chips(
                    options = listOf("" to labels.mailProjectNone) + scopes.map { it.id to it.name },
                    value = ruleScope ?: "",
                    onChange = { ruleScope = it.ifEmpty { null } },
                    tag = "rule-scope",
                )
                androidx.compose.foundation.text.BasicTextField(
                    value = ruleTemplate,
                    onValueChange = { ruleTemplate = it },
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(FemhoShape.pill))
                        .background(Femho.colors.ghostBg)
                        .padding(horizontal = 12.dp, vertical = 8.dp),
                    decorationBox = { innerTextField ->
                        Box(modifier = Modifier.padding(vertical = 2.dp)) {
                            if (ruleTemplate.isEmpty()) {
                                Text(text = labels.mailTemplate, color = Femho.colors.inkFaint, fontSize = FemhoText.body)
                            }
                            innerTextField()
                        }
                    },
                )
                if (ruleTemplate.isNotBlank()) {
                    Text(
                        text = labels.mailTemplatePreview.replace("{preview}", ruleTemplate),
                        color = Femho.colors.inkFaint,
                        fontSize = FemhoText.meta,
                    )
                }
                Text(
                    text = labels.mailAddRule,
                    color = Femho.colors.ink,
                    fontSize = FemhoText.body,
                    fontWeight = FontWeight.Medium,
                    modifier = Modifier
                        .clickable {
                            val accountId = ruleAccount
                            if (accountId != null && ruleFolder.isNotBlank()) {
                                onCreateMailRule(accountId, ruleFolder.trim(), ruleScope, ruleTemplate.trim().ifEmpty { null })
                                ruleFolder = ""
                                ruleTemplate = ""
                            }
                        }
                        .heightIn(min = FemhoSize.touch)
                        .padding(vertical = 8.dp),
                )
            }
        }
    }
}

@Composable
private fun ScopesTab(
    labels: SettingsLabels,
    scopes: List<ho.fem.model.Scope>,
    projects: List<ho.fem.model.Project>,
    labelsList: List<ho.fem.model.Label>,
    taskTypes: List<ho.fem.model.TaskType>,
    scopeSettings: Map<String, ho.fem.model.ScopeSettings>,
    onCreateScope: (String, String, String) -> Unit,
    onUpdateScope: (String, String, String, String) -> Unit,
    onDeleteScope: (String) -> Unit,
    onCreateProject: (String, String) -> Unit,
    onDeleteProject: (String) -> Unit,
    onCreateLabel: (String, String) -> Unit,
    onDeleteLabel: (String) -> Unit,
    onCreateTaskType: (String, String) -> Unit,
    onUpdateTaskType: (String, String?, Boolean?) -> Unit,
    onDeleteTaskType: (String) -> Unit,
    onUpdateScopeSettings: (
        String,
        Boolean?,
        String?,
        String?,
        Boolean?,
        Int?,
        String?,
        Boolean?,
    ) -> Unit,
    onCopyToClipboard: (String) -> Unit,
) {
    // Estat per crear àmbit nou
    var newScopeName by remember { mutableStateOf("") }
    var newScopeColor by remember { mutableStateOf("--femho-scope-1") }
    var newScopeKind by remember { mutableStateOf("individual") }

    // Estat per editar àmbit
    var editingScopeId by remember { mutableStateOf<String?>(null) }
    var editingName by remember { mutableStateOf("") }
    var editingColor by remember { mutableStateOf("") }
    var editingKind by remember { mutableStateOf("individual") }

    // Àmbits expandits per veure membres i convits
    var expandedScopeId by remember { mutableStateOf<String?>(null) }

    // Convit fresc (es mostra un sol cop)
    var freshInviteUrl by remember { mutableStateOf<String?>(null) }

    // Llista de colors disponibles (els 8 tokens de femhoScope)
    val scopeColors = listOf(
        "--femho-scope-1" to Femho.colors.femhoScope1,
        "--femho-scope-2" to Femho.colors.femhoScope2,
        "--femho-scope-3" to Femho.colors.femhoScope3,
        "--femho-scope-4" to Femho.colors.femhoScope4,
        "--femho-scope-5" to Femho.colors.femhoScope5,
        "--femho-scope-6" to Femho.colors.femhoScope6,
        "--femho-scope-7" to Femho.colors.femhoScope7,
        "--femho-scope-8" to Femho.colors.femhoScope8,
    )

    Group(labels.tabs.scopes) {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            // Llista d'àmbits existents
            scopes.forEach { scope ->
                val isExpanded = expandedScopeId == scope.id
                val isEditing = editingScopeId == scope.id

                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    // Capçalera de l'àmbit
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            // Color de l'àmbit
                            Box(
                                modifier = Modifier
                                    .size(12.dp)
                                    .background(
                                        color = scopeColors.find { it.first == scope.color }?.second
                                            ?: Femho.colors.inkFaint,
                                        shape = RoundedCornerShape(6.dp),
                                    ),
                            )
                            Text(
                                text = scope.name,
                                color = Femho.colors.ink,
                                fontSize = FemhoText.body,
                                fontWeight = FontWeight.SemiBold,
                            )
                            Text(
                                text = when (scope.kind) {
                                    ho.fem.model.ScopeKind.INDIVIDUAL -> labels.scopeTypeIndividual
                                    ho.fem.model.ScopeKind.COLLECTIVE -> labels.scopeTypeCollective
                                },
                                color = Femho.colors.inkFaint,
                                fontSize = FemhoText.meta,
                            )
                        }
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            if (isEditing) {
                                Text(
                                    text = labels.scopeSave,
                                    color = Femho.onBrand,
                                    fontSize = FemhoText.body,
                                    fontWeight = FontWeight.SemiBold,
                                    modifier = Modifier
                                        .clickable {
                                            onUpdateScope(scope.id, editingName, editingColor, editingKind)
                                            editingScopeId = null
                                        }
                                        .heightIn(min = FemhoSize.touch)
                                        .padding(vertical = 8.dp, horizontal = 12.dp),
                                )
                                Text(
                                    text = labels.scopeCancel,
                                    color = Femho.colors.inkSoft,
                                    fontSize = FemhoText.body,
                                    fontWeight = FontWeight.Medium,
                                    modifier = Modifier
                                        .clickable { editingScopeId = null }
                                        .heightIn(min = FemhoSize.touch)
                                        .padding(vertical = 8.dp, horizontal = 12.dp),
                                )
                            } else {
                                Text(
                                    text = labels.scopeEdit,
                                    color = Femho.colors.inkSoft,
                                    fontSize = FemhoText.body,
                                    fontWeight = FontWeight.Medium,
                                    modifier = Modifier
                                        .clickable {
                                            editingScopeId = scope.id
                                            editingName = scope.name
                                            editingColor = scope.color
                                            editingKind = when (scope.kind) {
                                                ho.fem.model.ScopeKind.INDIVIDUAL -> "individual"
                                                ho.fem.model.ScopeKind.COLLECTIVE -> "collective"
                                            }
                                        }
                                        .heightIn(min = FemhoSize.touch)
                                        .padding(vertical = 8.dp, horizontal = 12.dp),
                                )
                                Text(
                                    text = labels.scopeDelete,
                                    color = Femho.colors.dangerText,
                                    fontSize = FemhoText.body,
                                    fontWeight = FontWeight.Medium,
                                    modifier = Modifier
                                        .clickable { onDeleteScope(scope.id) }
                                        .heightIn(min = FemhoSize.touch)
                                        .padding(vertical = 8.dp, horizontal = 12.dp),
                                )
                            }
                        }
                    }

                    // Formulari d'edició
                    if (isEditing) {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            // Nom
                            androidx.compose.foundation.text.BasicTextField(
                                value = editingName,
                                onValueChange = { editingName = it },
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(FemhoShape.pill))
                                    .background(Femho.colors.ghostBg)
                                    .padding(horizontal = 12.dp, vertical = 10.dp),
                                decorationBox = { innerTextField ->
                                    Box(modifier = Modifier.padding(vertical = 4.dp)) {
                                        if (editingName.isEmpty()) {
                                            Text(
                                                text = labels.scopeName,
                                                color = Femho.colors.inkFaint,
                                                fontSize = FemhoText.body,
                                            )
                                        } else {
                                            Text(
                                                text = editingName,
                                                color = Femho.colors.ink,
                                                fontSize = FemhoText.body,
                                            )
                                        }
                                        innerTextField()
                                    }
                                },
                            )

                            // Selector de color
                            Row(
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                scopeColors.forEach { (token, color) ->
                                    val isSelected = editingColor == token
                                    Box(
                                        modifier = Modifier
                                            .size(32.dp)
                                            .background(
                                                color = color,
                                                shape = RoundedCornerShape(8.dp),
                                            )
                                            .then(
                                                if (isSelected) {
                                                    Modifier.border(
                                                        width = 2.dp,
                                                        color = Femho.colors.ink,
                                                        shape = RoundedCornerShape(8.dp),
                                                    )
                                                } else {
                                                    Modifier
                                                },
                                            )
                                            .clickable { editingColor = token },
                                    )
                                }
                            }

                            // Selector de tipus
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Text(
                                    text = labels.scopeTypeIndividual,
                                    color = if (editingKind == "individual") Femho.onBrand else Femho.colors.inkSoft,
                                    fontSize = FemhoText.body,
                                    fontWeight = if (editingKind == "individual") FontWeight.Bold else FontWeight.Medium,
                                    modifier = Modifier
                                        .clip(RoundedCornerShape(FemhoShape.pill))
                                        .background(
                                            if (editingKind == "individual") Femho.colors.plouBlue else Femho.colors.ghostBg,
                                        )
                                        .clickable { editingKind = "individual" }
                                        .heightIn(min = FemhoSize.touch)
                                        .padding(horizontal = 16.dp, vertical = 12.dp),
                                )
                                Text(
                                    text = labels.scopeTypeCollective,
                                    color = if (editingKind == "collective") Femho.onBrand else Femho.colors.inkSoft,
                                    fontSize = FemhoText.body,
                                    fontWeight = if (editingKind == "collective") FontWeight.Bold else FontWeight.Medium,
                                    modifier = Modifier
                                        .clip(RoundedCornerShape(FemhoShape.pill))
                                        .background(
                                            if (editingKind == "collective") Femho.colors.plouBlue else Femho.colors.ghostBg,
                                        )
                                        .clickable { editingKind = "collective" }
                                        .heightIn(min = FemhoSize.touch)
                                        .padding(horizontal = 16.dp, vertical = 12.dp),
                                )
                            }
                        }
                    }

                    // Gestió de l'àmbit: projectes, etiquetes, tipologies, dedicació i membres
                    Text(
                        text = if (isExpanded) "Amagar gestió" else labels.scopeSection,
                        color = Femho.colors.inkSoft,
                        fontSize = FemhoText.body,
                        fontWeight = FontWeight.Medium,
                        modifier = Modifier
                            .clickable {
                                expandedScopeId = if (isExpanded) null else scope.id
                            }
                            .heightIn(min = FemhoSize.touch)
                            .padding(vertical = 8.dp),
                    )

                    if (isExpanded) {
                        val scopeProjects = projects.filter { it.scopeId == scope.id }
                        val scopeLabels = labelsList.filter { it.scopeId == scope.id }
                        val scopeTypes = taskTypes.filter { it.scopeId == scope.id }
                        val settings = scopeSettings[scope.id]
                        val noun = if (settings?.projectNoun == "client") labels.nounClient else labels.nounProject

                        // Projectes
                        Group(noun) {
                            scopeProjects.forEach { project ->
                                Row(
                                    verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
                                    modifier = Modifier.fillMaxWidth(),
                                ) {
                                    Text(
                                        text = project.name,
                                        color = Femho.colors.ink,
                                        fontSize = FemhoText.body,
                                        modifier = Modifier.weight(1f),
                                    )
                                    Text(
                                        text = labels.projectDelete,
                                        color = Femho.colors.dangerText,
                                        fontSize = FemhoText.meta,
                                        modifier = Modifier
                                            .clickable { onDeleteProject(project.id) }
                                            .heightIn(min = FemhoSize.touch)
                                            .padding(horizontal = 8.dp, vertical = 6.dp),
                                    )
                                }
                            }
                            var newProjectName by remember(scope.id) { mutableStateOf("") }
                            Row(
                                verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                androidx.compose.foundation.text.BasicTextField(
                                    value = newProjectName,
                                    onValueChange = { newProjectName = it },
                                    modifier = Modifier
                                        .weight(1f)
                                        .clip(RoundedCornerShape(FemhoShape.pill))
                                        .background(Femho.colors.ghostBg)
                                        .padding(horizontal = 12.dp, vertical = 8.dp),
                                    decorationBox = { innerTextField ->
                                        Box(modifier = Modifier.padding(vertical = 2.dp)) {
                                            if (newProjectName.isEmpty()) {
                                                Text(
                                                    text = labels.projectName,
                                                    color = Femho.colors.inkFaint,
                                                    fontSize = FemhoText.body,
                                                )
                                            }
                                            innerTextField()
                                        }
                                    },
                                )
                                Text(
                                    text = "+",
                                    color = Femho.colors.ink,
                                    fontSize = FemhoText.body,
                                    modifier = Modifier
                                        .clickable {
                                            if (newProjectName.isNotBlank()) {
                                                onCreateProject(scope.id, newProjectName.trim())
                                                newProjectName = ""
                                            }
                                        }
                                        .heightIn(min = FemhoSize.touch)
                                        .padding(horizontal = 12.dp, vertical = 8.dp),
                                )
                            }
                        }

                        // Etiquetes
                        Group(labels.entityLabels) {
                            scopeLabels.forEach { label ->
                                Row(
                                    verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
                                    modifier = Modifier.fillMaxWidth(),
                                ) {
                                    Text(
                                        text = label.name,
                                        color = Femho.colors.ink,
                                        fontSize = FemhoText.body,
                                        modifier = Modifier.weight(1f),
                                    )
                                    Text(
                                        text = labels.labelDelete,
                                        color = Femho.colors.dangerText,
                                        fontSize = FemhoText.meta,
                                        modifier = Modifier
                                            .clickable { onDeleteLabel(label.id) }
                                            .heightIn(min = FemhoSize.touch)
                                            .padding(horizontal = 8.dp, vertical = 6.dp),
                                    )
                                }
                            }
                            var newLabelName by remember(scope.id) { mutableStateOf("") }
                            Row(
                                verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                androidx.compose.foundation.text.BasicTextField(
                                    value = newLabelName,
                                    onValueChange = { newLabelName = it },
                                    modifier = Modifier
                                        .weight(1f)
                                        .clip(RoundedCornerShape(FemhoShape.pill))
                                        .background(Femho.colors.ghostBg)
                                        .padding(horizontal = 12.dp, vertical = 8.dp),
                                    decorationBox = { innerTextField ->
                                        Box(modifier = Modifier.padding(vertical = 2.dp)) {
                                            if (newLabelName.isEmpty()) {
                                                Text(
                                                    text = labels.entityLabels,
                                                    color = Femho.colors.inkFaint,
                                                    fontSize = FemhoText.body,
                                                )
                                            }
                                            innerTextField()
                                        }
                                    },
                                )
                                Text(
                                    text = "+",
                                    color = Femho.colors.ink,
                                    fontSize = FemhoText.body,
                                    modifier = Modifier
                                        .clickable {
                                            if (newLabelName.isNotBlank()) {
                                                onCreateLabel(scope.id, newLabelName.trim())
                                                newLabelName = ""
                                            }
                                        }
                                        .heightIn(min = FemhoSize.touch)
                                        .padding(horizontal = 12.dp, vertical = 8.dp),
                                )
                            }
                        }

                        // Tipologies
                        Group(labels.entityTypes) {
                            scopeTypes.forEach { type ->
                                Row(
                                    verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
                                    modifier = Modifier.fillMaxWidth(),
                                ) {
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text(
                                            text = type.name,
                                            color = Femho.colors.ink,
                                            fontSize = FemhoText.body,
                                        )
                                        if (type.required) {
                                            Text(
                                                text = labels.typesRequired,
                                                color = Femho.colors.inkFaint,
                                                fontSize = FemhoText.meta,
                                            )
                                        }
                                    }
                                    Text(
                                        text = labels.typeDelete,
                                        color = Femho.colors.dangerText,
                                        fontSize = FemhoText.meta,
                                        modifier = Modifier
                                            .clickable { onDeleteTaskType(type.id) }
                                            .heightIn(min = FemhoSize.touch)
                                            .padding(horizontal = 8.dp, vertical = 6.dp),
                                    )
                                }
                            }
                            var newTypeName by remember(scope.id) { mutableStateOf("") }
                            Row(
                                verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                androidx.compose.foundation.text.BasicTextField(
                                    value = newTypeName,
                                    onValueChange = { newTypeName = it },
                                    modifier = Modifier
                                        .weight(1f)
                                        .clip(RoundedCornerShape(FemhoShape.pill))
                                        .background(Femho.colors.ghostBg)
                                        .padding(horizontal = 12.dp, vertical = 8.dp),
                                    decorationBox = { innerTextField ->
                                        Box(modifier = Modifier.padding(vertical = 2.dp)) {
                                            if (newTypeName.isEmpty()) {
                                                Text(
                                                    text = labels.typeNew,
                                                    color = Femho.colors.inkFaint,
                                                    fontSize = FemhoText.body,
                                                )
                                            }
                                            innerTextField()
                                        }
                                    },
                                )
                                Text(
                                    text = "+",
                                    color = Femho.colors.ink,
                                    fontSize = FemhoText.body,
                                    modifier = Modifier
                                        .clickable {
                                            if (newTypeName.isNotBlank()) {
                                                onCreateTaskType(scope.id, newTypeName.trim())
                                                newTypeName = ""
                                            }
                                        }
                                        .heightIn(min = FemhoSize.touch)
                                        .padding(horizontal = 12.dp, vertical = 8.dp),
                                )
                            }
                        }

                        // Dedicació
                        Group(labels.entityDedication) {
                            Row(
                                verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Text(
                                    text = labels.trackingOn,
                                    color = Femho.colors.ink,
                                    fontSize = FemhoText.body,
                                    modifier = Modifier.weight(1f),
                                )
                                androidx.compose.material3.Switch(
                                    checked = settings?.timeTracking ?: false,
                                    onCheckedChange = { on ->
                                        onUpdateScopeSettings(scope.id, on, null, null, null, null, null, null)
                                    },
                                )
                            }
                            Text(
                                text = labels.trackingHelp,
                                color = Femho.colors.inkFaint,
                                fontSize = FemhoText.meta,
                            )
                            Row(
                                verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Text(
                                    text = labels.overtimeVisible,
                                    color = Femho.colors.ink,
                                    fontSize = FemhoText.body,
                                    modifier = Modifier.weight(1f),
                                )
                                androidx.compose.material3.Switch(
                                    checked = settings?.overtimeVisible ?: false,
                                    onCheckedChange = { on ->
                                        onUpdateScopeSettings(scope.id, null, null, null, on, null, null, null)
                                    },
                                )
                            }
                            Text(
                                text = labels.workStart,
                                color = Femho.colors.inkSoft,
                                fontSize = FemhoText.meta,
                            )
                            androidx.compose.foundation.text.BasicTextField(
                                value = settings?.workStart.orEmpty(),
                                onValueChange = { onUpdateScopeSettings(scope.id, null, it, null, null, null, null, null) },
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(FemhoShape.pill))
                                    .background(Femho.colors.ghostBg)
                                    .padding(horizontal = 12.dp, vertical = 8.dp),
                                decorationBox = { innerTextField ->
                                    Box(modifier = Modifier.padding(vertical = 2.dp)) {
                                        if (settings?.workStart.isNullOrEmpty()) {
                                            Text(
                                                text = "09:00",
                                                color = Femho.colors.inkFaint,
                                                fontSize = FemhoText.body,
                                            )
                                        }
                                        innerTextField()
                                    }
                                },
                            )
                            Text(
                                text = labels.workEnd,
                                color = Femho.colors.inkSoft,
                                fontSize = FemhoText.meta,
                            )
                            androidx.compose.foundation.text.BasicTextField(
                                value = settings?.workEnd.orEmpty(),
                                onValueChange = { onUpdateScopeSettings(scope.id, null, null, it, null, null, null, null) },
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(FemhoShape.pill))
                                    .background(Femho.colors.ghostBg)
                                    .padding(horizontal = 12.dp, vertical = 8.dp),
                                decorationBox = { innerTextField ->
                                    Box(modifier = Modifier.padding(vertical = 2.dp)) {
                                        if (settings?.workEnd.isNullOrEmpty()) {
                                            Text(
                                                text = "18:00",
                                                color = Femho.colors.inkFaint,
                                                fontSize = FemhoText.body,
                                            )
                                        }
                                        innerTextField()
                                    }
                                },
                            )
                            Text(
                                text = labels.longSessionHours,
                                color = Femho.colors.inkSoft,
                                fontSize = FemhoText.meta,
                            )
                            androidx.compose.foundation.text.BasicTextField(
                                value = (settings?.longSessionHours ?: 8).toString(),
                                onValueChange = { value ->
                                    value.toIntOrNull()?.let { hours ->
                                        onUpdateScopeSettings(scope.id, null, null, null, null, hours, null, null)
                                    }
                                },
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(FemhoShape.pill))
                                    .background(Femho.colors.ghostBg)
                                    .padding(horizontal = 12.dp, vertical = 8.dp),
                                decorationBox = { innerTextField ->
                                    Box(modifier = Modifier.padding(vertical = 2.dp)) { innerTextField() }
                                },
                            )
                        }

                        // Membres i convits (només per àmbits col·lectius)
                        if (scope.kind == ho.fem.model.ScopeKind.COLLECTIVE) {
                            Text(
                                text = labels.members,
                                color = Femho.colors.inkSoft,
                                fontSize = FemhoText.body,
                                fontWeight = FontWeight.Medium,
                            )
                            Text(
                                text = labels.noMembers,
                                color = Femho.colors.inkFaint,
                                fontSize = FemhoText.meta,
                            )
                        }
                    }
                }

                // Separador
                if (scope != scopes.last()) {
                    androidx.compose.material3.HorizontalDivider(
                        color = Femho.colors.inkFaint,
                        thickness = 1.dp,
                    )
                }
            }

            // Formulari de creació d'àmbit
            Group(labels.newScope) {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    // Nom
                    androidx.compose.foundation.text.BasicTextField(
                        value = newScopeName,
                        onValueChange = { newScopeName = it },
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(FemhoShape.pill))
                            .background(Femho.colors.ghostBg)
                            .padding(horizontal = 12.dp, vertical = 10.dp),
                        decorationBox = { innerTextField ->
                            Box(modifier = Modifier.padding(vertical = 4.dp)) {
                                if (newScopeName.isEmpty()) {
                                    Text(
                                        text = labels.scopeName,
                                        color = Femho.colors.inkFaint,
                                        fontSize = FemhoText.body,
                                    )
                                } else {
                                    Text(
                                        text = newScopeName,
                                        color = Femho.colors.ink,
                                        fontSize = FemhoText.body,
                                    )
                                }
                                innerTextField()
                            }
                        },
                    )

                    // Selector de color
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        scopeColors.forEach { (token, color) ->
                            val isSelected = newScopeColor == token
                            Box(
                                modifier = Modifier
                                    .size(32.dp)
                                    .background(
                                        color = color,
                                        shape = RoundedCornerShape(8.dp),
                                    )
                                    .then(
                                        if (isSelected) {
                                            Modifier.border(
                                                width = 2.dp,
                                                color = Femho.colors.ink,
                                                shape = RoundedCornerShape(8.dp),
                                            )
                                        } else {
                                            Modifier
                                        },
                                    )
                                    .clickable { newScopeColor = token },
                            )
                        }
                    }

                    // Selector de tipus
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(
                            text = labels.scopeTypeIndividual,
                            color = if (newScopeKind == "individual") Femho.onBrand else Femho.colors.inkSoft,
                            fontSize = FemhoText.body,
                            fontWeight = if (newScopeKind == "individual") FontWeight.Bold else FontWeight.Medium,
                            modifier = Modifier
                                .clip(RoundedCornerShape(FemhoShape.pill))
                                .background(
                                    if (newScopeKind == "individual") Femho.colors.plouBlue else Femho.colors.ghostBg,
                                )
                                .clickable { newScopeKind = "individual" }
                                .heightIn(min = FemhoSize.touch)
                                .padding(horizontal = 16.dp, vertical = 12.dp),
                        )
                        Text(
                            text = labels.scopeTypeCollective,
                            color = if (newScopeKind == "collective") Femho.onBrand else Femho.colors.inkSoft,
                            fontSize = FemhoText.body,
                            fontWeight = if (newScopeKind == "collective") FontWeight.Bold else FontWeight.Medium,
                            modifier = Modifier
                                .clip(RoundedCornerShape(FemhoShape.pill))
                                .background(
                                    if (newScopeKind == "collective") Femho.colors.plouBlue else Femho.colors.ghostBg,
                                )
                                .clickable { newScopeKind = "collective" }
                                .heightIn(min = FemhoSize.touch)
                                .padding(horizontal = 16.dp, vertical = 12.dp),
                        )
                    }

                    // Botó de crear
                    Text(
                        text = labels.navCreate,
                        color = if (newScopeName.trim().isEmpty()) Femho.colors.inkFaint else Femho.onBrand,
                        fontSize = FemhoText.body,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier
                            .clickable(enabled = newScopeName.trim().isNotEmpty()) {
                                if (newScopeName.trim().isEmpty()) return@clickable
                                onCreateScope(newScopeName.trim(), newScopeColor, newScopeKind)
                                newScopeName = ""
                                newScopeColor = "--femho-scope-1"
                                newScopeKind = "individual"
                            }
                            .heightIn(min = FemhoSize.touch)
                            .padding(vertical = 12.dp, horizontal = 16.dp),
                    )
                }
            }
        }
    }
}

/** La pestanya Usuari IA: agents, àmbits, credencials i el full d'instruccions. */
@Composable
private fun AiTab(
    labels: SettingsLabels,
    scopes: List<ho.fem.model.Scope>,
    agents: List<ho.fem.model.AgentDetail>,
    agentScopeAvailability: Map<String, List<ho.fem.model.AgentScopeAvailability>>,
    agentCredentials: Map<String, List<ho.fem.model.ApiTokenSummary>>,
    createdAgentToken: String?,
    agentSkill: String?,
    serverUrl: String,
    onCreateAgent: (String) -> Unit,
    onAgentEnabled: (ho.fem.model.AgentDetail, Boolean) -> Unit,
    onAgentCanCreate: (ho.fem.model.AgentDetail, Boolean) -> Unit,
    onAgentScopes: (ho.fem.model.AgentDetail, List<String>, Boolean) -> Unit,
    onAgentNewCredential: (ho.fem.model.AgentDetail) -> Unit,
    onRevokeAgentCredential: (String) -> Unit,
    onAgentSkill: () -> Unit,
    onCopyToClipboard: (String) -> Unit,
) {
    var newAgentName by remember { mutableStateOf("") }

    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Group(labels.agents) {
            if (agents.isEmpty()) {
                EmptyState(labels.emptyAgents)
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    agents.forEach { agent ->
                        AgentRow(
                            labels = labels,
                            agent = agent,
                            scopes = scopes,
                            availability = agentScopeAvailability[agent.id].orEmpty(),
                            credencials = agentCredentials[agent.id].orEmpty(),
                            createdAgentToken = createdAgentToken,
                            agentSkill = agentSkill,
                            serverUrl = serverUrl,
                            onEnabled = { onAgentEnabled(agent, it) },
                            onCanCreate = { onAgentCanCreate(agent, it) },
                            onScopes = { ids, all -> onAgentScopes(agent, ids, all) },
                            onNewCredential = { onAgentNewCredential(agent) },
                            onRevokeCredential = onRevokeAgentCredential,
                            onSkill = onAgentSkill,
                            onCopyToClipboard = onCopyToClipboard,
                        )
                    }
                }
            }
        }

        // Nou agent
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            androidx.compose.foundation.text.BasicTextField(
                value = newAgentName,
                onValueChange = { newAgentName = it },
                modifier = Modifier
                    .weight(1f)
                    .clip(RoundedCornerShape(FemhoShape.pill))
                    .background(Femho.colors.ghostBg)
                    .padding(horizontal = 12.dp, vertical = 10.dp),
                decorationBox = { innerTextField ->
                    Box(modifier = Modifier.padding(vertical = 4.dp)) {
                        if (newAgentName.isEmpty()) {
                            Text(
                                text = labels.newAgent,
                                color = Femho.colors.inkFaint,
                                fontSize = FemhoText.body,
                            )
                        }
                        innerTextField()
                    }
                },
            )
            Text(
                text = labels.create,
                color = if (newAgentName.trim().isEmpty()) Femho.colors.inkFaint else Femho.onBrand,
                fontSize = FemhoText.body,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier
                    .clickable(enabled = newAgentName.trim().isNotEmpty()) {
                        onCreateAgent(newAgentName.trim())
                        newAgentName = ""
                    }
                    .heightIn(min = FemhoSize.touch)
                    .padding(vertical = 12.dp, horizontal = 16.dp),
            )
        }
    }
}

/**
 * Un agent: què pot fer, **d'on agafa feina**, i amb què s'hi connecta.
 *
 * Els tres blocs són el que cal per posar-lo a treballar, i van junts perquè és una sola
 * decisió: qui és, què porta i com hi entra (el mateix criteri que la web).
 */
@Composable
private fun AgentRow(
    labels: SettingsLabels,
    agent: ho.fem.model.AgentDetail,
    scopes: List<ho.fem.model.Scope>,
    availability: List<ho.fem.model.AgentScopeAvailability>,
    credencials: List<ho.fem.model.ApiTokenSummary>,
    createdAgentToken: String?,
    agentSkill: String?,
    serverUrl: String,
    onEnabled: (Boolean) -> Unit,
    onCanCreate: (Boolean) -> Unit,
    onScopes: (List<String>, Boolean) -> Unit,
    onNewCredential: () -> Unit,
    onRevokeCredential: (String) -> Unit,
    onSkill: () -> Unit,
    onCopyToClipboard: (String) -> Unit,
) {
    val presa = { scopeId: String -> availability.find { it.scopeId == scopeId }?.takenBy?.name }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(FemhoShape.card))
            .background(Femho.colors.cardBg)
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            text = agent.name,
            color = Femho.colors.ink,
            fontSize = FemhoText.body,
            fontWeight = FontWeight.SemiBold,
        )
        Toggle(label = labels.agentEnabled, checked = agent.enabled, onChange = onEnabled)
        Toggle(label = labels.agentCanCreate, checked = agent.canCreateTasks, onChange = onCanCreate)

        // D'on agafa feina. Un àmbit té un sol agent: els que ja té un altre surten
        // desactivats amb el seu nom, perquè saber a qui anar és el següent pas.
        Text(
            text = labels.agentScopes,
            color = Femho.colors.inkSoft,
            fontSize = FemhoText.meta,
            fontWeight = FontWeight.Bold,
        )
        Toggle(label = labels.agentAllScopes, checked = agent.allScopes, onChange = { value ->
            onScopes(if (value) emptyList() else agent.scopeIds, value)
        })
        if (!agent.allScopes) {
            scopes.forEach { scope ->
                val altre = presa(scope.id)
                val marcat = agent.scopeIds.contains(scope.id)
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable(enabled = altre == null) {
                            onScopes(
                                if (marcat) agent.scopeIds - scope.id else agent.scopeIds + scope.id,
                                false,
                            )
                        }
                        .heightIn(min = FemhoSize.touch)
                        .padding(vertical = 6.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(
                        modifier = Modifier
                            .size(18.dp)
                            .clip(RoundedCornerShape(4.dp))
                            .background(if (marcat) Femho.colors.plouBlue else Femho.colors.ghostBg)
                            .padding(3.dp),
                    ) {
                        if (marcat) {
                            Box(
                                modifier = Modifier
                                    .fillMaxSize()
                                    .background(Femho.onBrand, RoundedCornerShape(2.dp)),
                            )
                        }
                    }
                    Text(
                        text = if (altre == null) scope.name else "${scope.name} · $altre",
                        color = if (altre == null) Femho.colors.ink else Femho.colors.inkFaint,
                        fontSize = FemhoText.body,
                    )
                }
            }
        }

        // Amb què s'hi connecta. El testimoni surt una sola vegada (del hash no se'n
        // pot treure), i per això va amb l'avís al costat (P17).
        Text(
            text = labels.agentCredentials,
            color = Femho.colors.inkSoft,
            fontSize = FemhoText.meta,
            fontWeight = FontWeight.Bold,
        )
        credencials.forEach { cred ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = cred.prefix,
                    color = Femho.colors.ink,
                    fontSize = FemhoText.body,
                    fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace,
                )
                Text(
                    text = cred.name,
                    color = Femho.colors.inkFaint,
                    fontSize = FemhoText.body,
                    modifier = Modifier.weight(1f),
                )
                Text(
                    text = labels.tokensRevoke,
                    color = Femho.colors.dangerText,
                    fontSize = FemhoText.body,
                    modifier = Modifier
                        .clickable { onRevokeCredential(cred.id) }
                        .heightIn(min = FemhoSize.touch)
                        .padding(vertical = 10.dp, horizontal = 8.dp),
                )
            }
        }
        if (createdAgentToken != null) {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    text = createdAgentToken,
                    color = Femho.colors.ink,
                    fontSize = FemhoText.meta,
                    fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace,
                )
                Text(
                    text = labels.tokensOnceWarning,
                    color = Femho.colors.dangerText,
                    fontSize = FemhoText.meta,
                )
            }
        }
        Text(
            text = labels.agentNewCredential,
            color = Femho.onBrand,
            fontSize = FemhoText.body,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier
                .clickable(onClick = onNewCredential)
                .heightIn(min = FemhoSize.touch)
                .padding(vertical = 10.dp),
        )

        // Com s'hi connecta: el .mcp.json porta la credencial i el full d'instruccions
        // no en porta cap (això és el que fa que es pugui passar per un xat).
        Text(
            text = labels.agentConnect,
            color = Femho.colors.inkSoft,
            fontSize = FemhoText.meta,
            fontWeight = FontWeight.Bold,
        )
        val mcpJson = buildString {
            append("""{"mcpServers":{"fem-ho":{"type":"http","url":"${serverUrl.trimEnd('/')}/mcp","headers":{"Authorization":"Bearer ${createdAgentToken ?: "ENGANXA-HI-LA-CREDENCIAL"}"}}}}""")
        }
        Text(
            text = labels.agentDownloadMcp,
            color = Femho.colors.ink,
            fontSize = FemhoText.body,
            modifier = Modifier
                .clickable { onCopyToClipboard(mcpJson) }
                .heightIn(min = FemhoSize.touch)
                .padding(vertical = 10.dp),
        )
        Text(
            text = if (createdAgentToken != null) labels.agentMcpHasToken else labels.agentMcpNoToken,
            color = if (createdAgentToken != null) Femho.colors.dangerText else Femho.colors.inkFaint,
            fontSize = FemhoText.meta,
        )
        Text(
            text = labels.agentDownloadSkill,
            color = Femho.colors.ink,
            fontSize = FemhoText.body,
            modifier = Modifier
                .clickable(onClick = onSkill)
                .heightIn(min = FemhoSize.touch)
                .padding(vertical = 10.dp),
        )
        if (agentSkill != null) {
            Text(
                text = agentSkill.take(200) + (if (agentSkill.length > 200) "…" else ""),
                color = Femho.colors.inkFaint,
                fontSize = FemhoText.meta,
                fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace,
            )
        }
        Text(
            text = labels.agentSkillNoToken,
            color = Femho.colors.inkFaint,
            fontSize = FemhoText.meta,
        )
    }
}

/** La pestanya Compartits: enllaços, accessos i revocar. */
@Composable
private fun SharesTab(
    labels: SettingsLabels,
    shares: List<ho.fem.model.ShareSummary>,
    shareAccesses: Map<String, List<ho.fem.model.ShareAccess>>,
    onRevokeShare: (String) -> Unit,
) {
    if (shares.isEmpty()) {
        EmptyState(labels.emptyStates.shares)
        return
    }

    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        shares.forEach { share ->
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(FemhoShape.card))
                    .background(Femho.colors.cardBg)
                    .padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
                ) {
                    Text(
                        text = share.permission.name.lowercase(),
                        color = Femho.colors.ink,
                        fontSize = FemhoText.body,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.weight(1f),
                    )
                    if (share.revokedAt != null) {
                        Text(
                            text = labels.shareRevoked,
                            color = Femho.colors.inkFaint,
                            fontSize = FemhoText.body,
                        )
                    } else {
                        Text(
                            text = labels.shareRevoke,
                            color = Femho.colors.dangerText,
                            fontSize = FemhoText.body,
                            modifier = Modifier
                                .clickable { onRevokeShare(share.id) }
                                .heightIn(min = FemhoSize.touch)
                                .padding(vertical = 8.dp)
                                .testTag("share-revoke-${share.id}"),
                        )
                    }
                }
                // Els accessos: pseudònim sempre (no hi ha cap columna d'IP enlloc, D10).
                shareAccesses[share.id].orEmpty().forEach { access ->
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Text(
                            text = access.label.orEmpty(),
                            color = Femho.colors.inkFaint,
                            fontSize = FemhoText.meta,
                        )
                        Text(
                            text = access.lastSeen.orEmpty().take(10),
                            color = Femho.colors.inkFaint,
                            fontSize = FemhoText.meta,
                        )
                    }
                }
            }
        }
    }
}

/** Estat buit amb frase sencera del catàleg —mai un guió (docs/00, docs/02 §12). */
@Composable
private fun EmptyState(text: String) {
    Text(
        text = text,
        color = Femho.colors.inkFaint,
        fontSize = FemhoText.body,
        modifier = Modifier.padding(vertical = 10.dp, horizontal = 4.dp),
    )
}
