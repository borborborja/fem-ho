package ho.fem.tasks

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
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
fun McpProvenanceBadge(activity: McpActivity, labels: McpProvenanceLabels, compact: Boolean = false) {
    var open by remember { mutableStateOf(false) }
    val details = activity.creation?.let { creation ->
        if (creation.origin == activity.origin) listOf(labels.creation to creation.origin)
        else listOf(labels.creation to creation.origin, labels.lastChange to activity.origin)
    } ?: listOf(labels.lastChange to activity.origin)
    Box {
        val button = Modifier
            .clickable(role = Role.Button, onClickLabel = labels.details) { open = true }
            .testTag("task-mcp-badge")
        if (compact) {
            Box(
                modifier = Modifier.size(24.dp).then(button)
                    .semantics { contentDescription = labels.details },
                contentAlignment = Alignment.Center,
            ) {
                val tint = Femho.colors.inkSoft
                Canvas(Modifier.size(14.dp)) {
                    scale(size.width / 16f, size.height / 16f, pivot = Offset.Zero) {
                        val plug = Path().apply {
                            moveTo(6f, 2f)
                            lineTo(6f, 5f)
                            moveTo(10f, 2f)
                            lineTo(10f, 5f)
                            moveTo(3.5f, 5f)
                            lineTo(12.5f, 5f)
                            moveTo(5f, 5f)
                            lineTo(5f, 8f)
                            cubicTo(5f, 10f, 6.4f, 11f, 8f, 11f)
                            cubicTo(9.6f, 11f, 11f, 10f, 11f, 8f)
                            lineTo(11f, 5f)
                            moveTo(8f, 11f)
                            lineTo(8f, 14f)
                        }
                        drawPath(plug, tint, style = Stroke(1.5f, cap = StrokeCap.Round, join = StrokeJoin.Round))
                    }
                }
            }
        } else {
            Pill(text = labels.badge, modifier = button)
        }
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
