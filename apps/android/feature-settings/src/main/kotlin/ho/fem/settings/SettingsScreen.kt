package ho.fem.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
 * **Ni switch de vista ni chips d'àmbit**, igual que a la web: el brief hi insisteix
 * (línia 41). Aquí només hi ha "‹ Enrere" i el contingut.
 *
 * Les pestanyes de la web són una llista vertical aquí: 220px de navegació lateral en
 * un telèfon deixen el contingut en 100px.
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
    Column(
        modifier = modifier
            .fillMaxSize()
            .background(Femho.pageBackground)
            .verticalScroll(rememberScrollState())
            .padding(16.dp)
            .testTag("settings-screen"),
        verticalArrangement = Arrangement.spacedBy(FemhoSize.columnGap),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
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
