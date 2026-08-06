package ho.fem.designsystem

import androidx.compose.foundation.Canvas
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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Fill
import androidx.compose.ui.graphics.drawscope.Stroke
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
 * Un bloc desplegable de la targeta: les subtasques —sense nom— o una llista.
 *
 * La distinció es veu a l'epígraf i no a l'estructura: per a qui mira el tauler són el
 * mateix, coses que falten dins d'aquesta tasca.
 */
data class CardList(
    val id: String,
    /** `null` per al bloc de subtasques: no en té, i per això va sense caixa. */
    val name: String?,
    val pinned: Boolean = false,
    val pinLabel: String? = null,
    val onPinToggle: (() -> Unit)? = null,
    val items: List<CardListItem>,
)

data class CardListItem(
    val id: String,
    val text: String,
    val done: Boolean,
    val toggleLabel: String,
    val onToggle: () -> Unit,
)

/**
 * El formulari d'afegir de la targeta. **Un sol camp**: `#Llista element` hi posa
 * l'ítem, i sense sigil és una subtasca. És el mateix gest que l'afegida ràpida.
 */
data class CardAddForm(
    val open: Boolean,
    val onToggle: () -> Unit,
    val toggleLabel: String,
    val placeholder: String,
    val text: String,
    val onText: (String) -> Unit,
    val onSubmit: () -> Unit,
)

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
    /** El llapis de la cantonada. Al mòbil surt sempre: no hi ha ratolí per revelar-lo. */
    onEdit: (() -> Unit)? = null,
    editLabel: String = "",
    lists: List<CardList> = emptyList(),
    listsExpanded: Boolean = false,
    /**
     * "▸ Llistes (2)". **És el que decideix si el commutador surt**, i no `lists`: amb
     * la targeta plegada encara no s'ha demanat cap ítem, i el número ve de l'agregat
     * del tauler.
     */
    listsToggleLabel: String? = null,
    onToggleLists: () -> Unit = {},
    addForm: CardAddForm? = null,
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
        Row(
            horizontalArrangement = Arrangement.spacedBy(FemhoSize.cardGap),
            verticalAlignment = Alignment.Top,
        ) {
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

            /**
             * Les accions de la targeta.
             *
             * A la web surten en passar-hi el ratolí per sobre; **aquí surten sempre**,
             * perquè en un telèfon no hi ha res a passar-hi. És el que fa el disseny
             * mòbil, i és el mateix motiu pel qual les icones hi són a 19dp i no a 20.
             */
            Row(
                horizontalArrangement = Arrangement.spacedBy(3.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (onEdit != null) {
                    CardActionIcon(
                        label = editLabel,
                        onClick = onEdit,
                        testTag = "card-edit",
                    ) { PencilGlyph() }
                }
                if (addForm != null) {
                    CardActionIcon(
                        label = addForm.toggleLabel,
                        onClick = addForm.onToggle,
                        testTag = "card-add-toggle",
                    ) { ListPlusGlyph() }
                }
            }
        }

        if (listsToggleLabel != null) {
            Text(
                text = listsToggleLabel,
                color = Femho.colors.inkSoft,
                fontSize = FemhoText.meta,
                fontWeight = FontWeight.Bold,
                modifier = Modifier
                    .clickable(onClick = onToggleLists)
                    .padding(vertical = 2.dp)
                    .testTag("card-lists-toggle"),
            )
        }

        /**
         * **Les subtasques van nues i les llistes en caixa.**
         *
         * Al disseny anterior totes dues portaven caixa i epígraf; ara la distinció es
         * veu sense dir-la: el que no té nom és el que pertoca a la tasca i prou.
         */
        if (listsExpanded) {
            lists.forEach { list ->
                if (list.name == null) {
                    Column(
                        modifier = Modifier.fillMaxWidth().testTag("card-list"),
                        verticalArrangement = Arrangement.spacedBy(5.dp),
                    ) {
                        list.items.forEach { item ->
                            ChecklistRow(
                                text = item.text,
                                done = item.done,
                                toggleLabel = item.toggleLabel,
                                onToggle = item.onToggle,
                            )
                        }
                    }
                    return@forEach
                }

                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(FemhoShape.input))
                        .background(Femho.colors.tagBg)
                        .padding(horizontal = 10.dp, vertical = 8.dp)
                        .testTag("card-list"),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            text = list.name,
                            color = Femho.colors.ink,
                            fontSize = FemhoText.meta,
                            fontWeight = FontWeight.Bold,
                        )
                        if (list.pinLabel != null && list.onPinToggle != null) {
                            CardActionIcon(
                                label = list.pinLabel,
                                onClick = list.onPinToggle,
                                testTag = "card-list-pin",
                                tint = if (list.pinned) {
                                    Femho.colors.plouBlueInk
                                } else {
                                    Femho.colors.inkFaint
                                },
                            ) { PinGlyph(filled = list.pinned) }
                        }
                    }
                    list.items.forEach { item ->
                        ChecklistRow(
                            text = item.text,
                            done = item.done,
                            toggleLabel = item.toggleLabel,
                            onToggle = item.onToggle,
                        )
                    }
                }
            }
        }

        /**
         * Afegir, amb **un sol camp**: `#Llista element` va a la llista i sense sigil
         * és una subtasca. El botó de la cantonada l'obre; el teclat el tanca amb Enter.
         */
        if (addForm != null && addForm.open) {
            androidx.compose.material3.OutlinedTextField(
                value = addForm.text,
                onValueChange = addForm.onText,
                singleLine = true,
                placeholder = { Text(addForm.placeholder, fontSize = FemhoText.meta) },
                keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(
                    imeAction = androidx.compose.ui.text.input.ImeAction.Done,
                ),
                keyboardActions = androidx.compose.foundation.text.KeyboardActions(
                    onDone = { addForm.onSubmit() },
                ),
                modifier = Modifier.fillMaxWidth().testTag("card-add-item"),
            )
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


/** El botó d'icona de la cantonada de la targeta. 19dp, com al disseny mòbil. */
@Composable
private fun CardActionIcon(
    label: String,
    onClick: () -> Unit,
    testTag: String,
    tint: Color? = null,
    content: @Composable () -> Unit,
) {
    Box(
        modifier = Modifier
            .size(19.dp)
            .clip(CircleShape)
            .clickable(role = Role.Button, onClick = onClick)
            .semantics { contentDescription = label }
            .testTag(testTag),
        contentAlignment = Alignment.Center,
    ) {
        androidx.compose.runtime.CompositionLocalProvider(
            androidx.compose.material3.LocalContentColor provides (tint ?: Femho.colors.inkFaint),
        ) {
            content()
        }
    }
}

/**
 * Les icones, dibuixades amb `Canvas` i no amb un `.svg` a `res/`.
 *
 * Són quatre traços i així viuen al costat del component que les fa servir, amb el
 * mateix gruix de traç que la web (1.8) i el color que els doni qui les munta.
 */
@Composable
private fun PencilGlyph() {
    GlyphCanvas { scope, color, stroke ->
        with(scope) {
            drawLine(color, Offset(size.width * 0.50f, size.height * 0.83f), Offset(size.width * 0.87f, size.height * 0.83f), stroke, StrokeCap.Round)
            val path = Path().apply {
                moveTo(size.width * 0.69f, size.height * 0.15f)
                lineTo(size.width * 0.85f, size.height * 0.31f)
                lineTo(size.width * 0.29f, size.height * 0.79f)
                lineTo(size.width * 0.13f, size.height * 0.83f)
                lineTo(size.width * 0.17f, size.height * 0.67f)
                close()
            }
            drawPath(path, color, style = Stroke(width = stroke, cap = StrokeCap.Round, join = StrokeJoin.Round))
        }
    }
}

@Composable
private fun ListPlusGlyph() {
    GlyphCanvas { scope, color, stroke ->
        with(scope) {
            for ((y, right) in listOf(0.25f to 0.54f, 0.5f to 0.54f, 0.75f to 0.37f)) {
                drawLine(color, Offset(size.width * 0.17f, size.height * y), Offset(size.width * right, size.height * y), stroke, StrokeCap.Round)
            }
            drawLine(color, Offset(size.width * 0.71f, size.height * 0.58f), Offset(size.width * 0.71f, size.height * 0.87f), stroke, StrokeCap.Round)
            drawLine(color, Offset(size.width * 0.56f, size.height * 0.73f), Offset(size.width * 0.87f, size.height * 0.73f), stroke, StrokeCap.Round)
        }
    }
}

@Composable
private fun PinGlyph(filled: Boolean) {
    GlyphCanvas { scope, color, stroke ->
        with(scope) {
            val path = Path().apply {
                moveTo(size.width * 0.5f, size.height * 0.9f)
                cubicTo(size.width * 0.25f, size.height * 0.66f, size.width * 0.25f, size.height * 0.42f, size.width * 0.5f, size.height * 0.42f)
                cubicTo(size.width * 0.75f, size.height * 0.42f, size.width * 0.75f, size.height * 0.66f, size.width * 0.5f, size.height * 0.9f)
                close()
            }
            drawCircle(color, radius = size.minDimension * 0.26f, center = Offset(size.width * 0.5f, size.height * 0.42f), style = if (filled) Fill else Stroke(width = stroke))
            drawPath(path, color, style = if (filled) Fill else Stroke(width = stroke, cap = StrokeCap.Round, join = StrokeJoin.Round))
        }
    }
}

@Composable
private fun GlyphCanvas(draw: (DrawScope, Color, Float) -> Unit) {
    val color = androidx.compose.material3.LocalContentColor.current
    val stroke = with(androidx.compose.ui.platform.LocalDensity.current) { 1.4.dp.toPx() }
    Canvas(modifier = Modifier.size(12.dp)) { draw(this, color, stroke) }
}
