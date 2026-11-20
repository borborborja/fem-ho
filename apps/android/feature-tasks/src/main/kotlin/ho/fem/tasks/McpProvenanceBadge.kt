package ho.fem.tasks

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import ho.fem.designsystem.Femho
import ho.fem.designsystem.FemhoShape
import ho.fem.designsystem.FemhoText
import ho.fem.designsystem.Pill
import ho.fem.model.McpActivity

data class McpProvenanceLabels(
    val badge: String,
    val details: String,
    val creation: String,
    val lastChange: String,
    val unspecified: String,
)

@Composable
fun McpProvenanceBadge(activity: McpActivity, labels: McpProvenanceLabels) {
    var open by remember { mutableStateOf(false) }
    val details = activity.creation?.let { creation ->
        if (creation.origin == activity.origin) listOf(labels.creation to creation.origin)
        else listOf(labels.creation to creation.origin, labels.lastChange to activity.origin)
    } ?: listOf(labels.lastChange to activity.origin)
    Box {
        Pill(
            text = labels.badge,
            modifier = Modifier
                .clickable(role = Role.Button, onClickLabel = labels.details) { open = true }
                .testTag("task-mcp-badge"),
        )
        DropdownMenu(
            expanded = open,
            onDismissRequest = { open = false },
            containerColor = Femho.colors.panelBg,
            tonalElevation = 0.dp,
            shadowElevation = 8.dp,
            shape = RoundedCornerShape(FemhoShape.card),
            border = BorderStroke(1.dp, Femho.colors.cardBorder),
            modifier = Modifier.widthIn(min = 180.dp, max = 272.dp).testTag("task-mcp-details"),
        ) {
            Column(
                modifier = Modifier.padding(horizontal = 14.dp, vertical = 4.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(labels.details, color = Femho.colors.ink, fontSize = FemhoText.body, fontWeight = FontWeight.Bold)
                details.forEach { (label, origin) ->
                    Column {
                        Text(label, color = Femho.colors.inkSoft, fontSize = FemhoText.meta)
                        Text(origin ?: labels.unspecified, color = Femho.colors.ink, fontSize = FemhoText.body)
                    }
                }
            }
        }
    }
}
