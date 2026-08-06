package ho.fem.designsystem

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

/**
 * Els components de Fem-ho, en Compose. docs/04 §6.
 *
 * **Cap d'ells porta text en català**: els textos arriben com a paràmetre des de
 * `strings.xml`, que surt del mateix catàleg que la web (docs/03 §1, regla 3). Un
 * literal escrit aquí és una divergència garantida amb la web.
 *
 * Són els mateixos components que la web, amb els mateixos noms i les mateixes
 * decisions visuals. On la web fa servir `var(--card-bg)`, aquí es fa servir
 * `Femho.colors.cardBg`, que surt del mateix CSS.
 */

/**
 * El cercle d'estat de 22px.
 *
 * Fet: gradient de marca amb una marca. No fet: només vora de 2px. És el mateix gest a
 * tot el producte —kanban, llistes, subtasques— i per això és un component i no un
 * dibuix repetit.
 */
@Composable
fun StatusCircle(
    done: Boolean,
    contentDescription: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier
            .size(FemhoSize.statusCircle)
            .clip(CircleShape)
            .then(
                if (done) {
                    Modifier.background(Femho.brandGradient2)
                } else {
                    Modifier.border(2.dp, Femho.colors.cardBorder, CircleShape)
                },
            )
            .clickable(role = Role.Checkbox, onClick = onClick)
            .semantics { this.contentDescription = contentDescription },
        contentAlignment = Alignment.Center,
    ) {
        if (done) {
            Text("✓", color = Femho.onBrand, fontSize = FemhoText.meta, fontWeight = FontWeight.Bold)
        }
    }
}

/**
 * La targeta d'una tasca. docs/02 §4.
 *
 * Les accions ràpides són **només a les targetes de l'Inbox**: a la resta de columnes,
 * "→ Per fer" no vol dir res. Qui la munta decideix si n'hi posa.
 */
@Composable
fun TaskCard(
    title: String,
    modifier: Modifier = Modifier,
    project: String? = null,
    time: String? = null,
    aiModeLabel: String? = null,
    checklistProgress: String? = null,
    done: Boolean = false,
    toggleLabel: String = "",
    onToggle: () -> Unit = {},
    onOpen: () -> Unit = {},
    quickActions: List<Pair<String, () -> Unit>> = emptyList(),
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(FemhoShape.card))
            .background(Femho.colors.cardBg)
            .border(1.dp, Femho.colors.cardBorder, RoundedCornerShape(FemhoShape.card))
            .clickable(onClick = onOpen)
            .padding(12.dp)
            .testTag("task-card"),
        verticalArrangement = Arrangement.spacedBy(FemhoSize.cardGap),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(FemhoSize.cardGap)) {
            StatusCircle(done = done, contentDescription = toggleLabel, onClick = onToggle)

            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    text = title,
                    color = if (done) Femho.colors.inkFaint else Femho.colors.ink,
                    fontSize = FemhoText.cardTitle,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis,
                )

                val metadata = listOfNotNull(project, time, aiModeLabel, checklistProgress)
                if (metadata.isNotEmpty()) {
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        metadata.forEach { Pill(it) }
                    }
                }
            }
        }

        if (quickActions.isNotEmpty()) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                quickActions.forEach { (label, action) ->
                    Text(
                        text = label,
                        color = Femho.colors.inkSoft,
                        fontSize = FemhoText.meta,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier
                            .clip(RoundedCornerShape(FemhoShape.pill))
                            .background(Femho.colors.ghostBg)
                            .clickable(onClick = action)
                            .padding(horizontal = 10.dp, vertical = 5.dp),
                    )
                }
            }
        }
    }
}

@Composable
fun Pill(text: String, modifier: Modifier = Modifier, background: Color? = null) {
    Text(
        text = text,
        color = Femho.colors.tagText,
        fontSize = FemhoText.meta,
        modifier = modifier
            .clip(RoundedCornerShape(FemhoShape.pill))
            .background(background ?: Femho.colors.tagBg)
            .padding(horizontal = 8.dp, vertical = 2.dp),
    )
}

/**
 * Una columna del tauler.
 *
 * La variant `inbox` és **visualment una altra cosa** (brief línia 39): targeta sòlida
 * amb fons de targeta, vora completa i ombra, contra el contenidor tènue de les altres
 * tres.
 */
@Composable
fun KanbanColumn(
    label: String,
    count: Int,
    modifier: Modifier = Modifier,
    inbox: Boolean = false,
    header: @Composable (() -> Unit)? = null,
    content: @Composable () -> Unit,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(FemhoShape.column))
            .background(if (inbox) Femho.colors.cardBg else Femho.colors.columnBg)
            .border(1.dp, Femho.colors.cardBorder, RoundedCornerShape(FemhoShape.column))
            .padding(14.dp)
            .testTag(if (inbox) "inbox-rail" else "kanban-column"),
        verticalArrangement = Arrangement.spacedBy(FemhoSize.cardGap),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = label,
                    color = Femho.colors.ink,
                    fontSize = FemhoText.columnTitle,
                    fontWeight = FontWeight.ExtraBold,
                )
                Pill(count.toString(), background = if (inbox) Femho.colors.inboxPillBg else null)
            }
            header?.invoke()
        }
        content()
    }
}

/** Estat buit amb **frase sencera**, mai un guió (docs/00, docs/02 §12). */
@Composable
fun EmptyState(text: String, modifier: Modifier = Modifier) {
    Text(
        text = text,
        color = Femho.colors.inkFaint,
        fontSize = FemhoText.body,
        modifier = modifier.padding(vertical = 10.dp, horizontal = 4.dp),
    )
}

/** El chip d'un àmbit. Actiu: el color de l'àmbit amb text sobre marca. */
@Composable
fun ScopeChip(
    label: String,
    color: Color,
    active: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Text(
        text = label,
        color = if (active) Femho.onBrand else Femho.colors.inkSoft,
        fontSize = FemhoText.body,
        fontWeight = if (active) FontWeight.Bold else FontWeight.Medium,
        modifier = modifier
            .clip(RoundedCornerShape(FemhoShape.pill))
            .background(if (active) color else Femho.colors.ghostBg)
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 9.dp)
            .testTag("scope-chip"),
    )
}

/**
 * Un ítem de llista senzilla: casella rodona i text. Res més (P1).
 */
@Composable
fun ChecklistRow(
    text: String,
    done: Boolean,
    toggleLabel: String,
    onToggle: () -> Unit,
    modifier: Modifier = Modifier,
    strikeWhenDone: Boolean = true,
) {
    Row(
        modifier = modifier.fillMaxWidth().padding(vertical = 7.dp),
        horizontalArrangement = Arrangement.spacedBy(11.dp),
        verticalAlignment = Alignment.Top,
    ) {
        StatusCircle(done = done, contentDescription = toggleLabel, onClick = onToggle)
        Text(
            text = text,
            color = if (done) Femho.colors.inkFaint else Femho.colors.ink,
            fontSize = FemhoText.cardTitle,
            textDecoration = if (done && strikeWhenDone) {
                androidx.compose.ui.text.style.TextDecoration.LineThrough
            } else {
                null
            },
        )
    }
}
