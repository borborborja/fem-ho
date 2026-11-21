package ho.fem.app

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import ho.fem.designsystem.Femho
import ho.fem.designsystem.FemhoShape
import ho.fem.designsystem.FemhoText
import ho.fem.model.Project
import ho.fem.model.Scope

@Composable
internal fun ProjectFilter(
    scopes: List<Scope>,
    activeScopes: Set<String>,
    projects: List<Project>,
    activeProjects: List<String>,
    onToggle: (String) -> Unit,
    onResetScope: (String) -> Unit,
) {
    val groups = remember(scopes, activeScopes, projects) {
        val byScope = projects.groupBy { it.scopeId }
        scopes.filter { activeScopes.isEmpty() || it.id in activeScopes }
            .mapNotNull { scope -> byScope[scope.id]?.let { scope to it } }
    }
    if (groups.isEmpty()) return

    var open by remember { mutableStateOf(false) }
    val selected = remember(activeProjects) { activeProjects.toSet() }
    val count = groups.sumOf { (_, entries) -> entries.count { it.id in selected } }
    val label = stringResource(R.string.settings_entityprojects)
    val window = LocalWindowInfo.current.containerSize
    val (width, height) = with(LocalDensity.current) {
        minOf(320.dp, (window.width.toDp() - 24.dp).coerceAtLeast(1.dp)) to
            minOf(440.dp, (window.height.toDp() * 0.55f).coerceAtLeast(1.dp))
    }

    Box {
        Box(
            modifier = Modifier
                .heightIn(min = 48.dp)
                .clip(RoundedCornerShape(FemhoShape.pill))
                .clickable(role = Role.Button) { open = true }
                .testTag("projects-toggle")
                .padding(horizontal = 10.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = if (count == 0) label else "$label ($count)",
                color = if (count == 0) Femho.colors.inkSoft else Femho.colors.ink,
                fontSize = FemhoText.body,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                modifier = Modifier
                    .clip(RoundedCornerShape(FemhoShape.pill))
                    .background(if (count == 0) Femho.colors.ghostBg else Femho.colors.tagBg)
                    .padding(horizontal = 8.dp, vertical = 5.dp),
            )
        }
        DropdownMenu(
            expanded = open,
            onDismissRequest = { open = false },
            containerColor = Femho.colors.panelBg,
            tonalElevation = 0.dp,
            shadowElevation = if (Femho.isEink) 0.dp else 8.dp,
            shape = RoundedCornerShape(FemhoShape.card),
            border = BorderStroke(1.dp, Femho.colors.cardBorder),
            modifier = Modifier.width(width).heightIn(max = height).testTag("projects-menu"),
        ) {
            groups.forEachIndexed { index, (scope, entries) ->
                if (index > 0) HorizontalDivider(color = Femho.colors.divider)
                Text(
                    text = scope.name,
                    color = Femho.colors.ink,
                    fontSize = FemhoText.body,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 2.dp)
                        .semantics { heading() },
                )
                ProjectOption(
                    label = stringResource(R.string.nav_allprojects),
                    checked = entries.none { it.id in selected },
                    tag = "projects-all-${scope.id}",
                    onClick = { onResetScope(scope.id) },
                )
                entries.forEach { project ->
                    ProjectOption(
                        label = project.name,
                        checked = project.id in selected,
                        tag = "project-${project.id}",
                        onClick = { onToggle(project.id) },
                    )
                }
            }
        }
    }
}

@Composable
private fun ProjectOption(label: String, checked: Boolean, tag: String, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .toggleable(value = checked, role = Role.Checkbox, onValueChange = { onClick() })
            .testTag(tag)
            .padding(horizontal = 16.dp, vertical = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Checkbox(checked, onCheckedChange = null)
        Text(label, color = Femho.colors.ink, fontSize = FemhoText.body)
    }
}
