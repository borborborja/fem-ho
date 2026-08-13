package ho.fem.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
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
    onTheme: (String) -> Unit,
    onAccent: (String) -> Unit,
    onBack: () -> Unit,
    onLogout: () -> Unit,
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
                "general" -> {
                    Group(labels.theme) {
                        Chips(labels.themeOptions, theme, onTheme, "theme")
                    }

                    Group(labels.accent) {
                        Chips(labels.accentOptions, accent, onAccent, "accent")
                    }

                    Group(labels.server) {
                        Text(serverUrl, color = Femho.colors.inkSoft, fontSize = FemhoText.body)
                    }

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
                "scopes" -> EmptyState(labels.emptyStates.scopes)
                "calendars" -> EmptyState(labels.emptyStates.calendars)
                "mail" -> EmptyState(labels.emptyStates.mail)
                "mcp" -> EmptyState(labels.emptyStates.mcp)
                "ai" -> EmptyState(labels.emptyStates.ai)
                "shares" -> EmptyState(labels.emptyStates.shares)
                "profile" -> EmptyState(labels.emptyStates.profile)
                "admin" -> EmptyState(labels.emptyStates.admin)
            }
        }
    }
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
