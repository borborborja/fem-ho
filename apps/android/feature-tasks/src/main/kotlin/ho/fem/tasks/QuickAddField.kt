package ho.fem.tasks

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import ho.fem.designsystem.Femho
import ho.fem.designsystem.FemhoShape
import ho.fem.designsystem.FemhoSize
import ho.fem.designsystem.FemhoText
import ho.fem.model.QuickAddContext
import ho.fem.model.TokenKind
import ho.fem.model.parseQuickAdd
import ho.fem.model.revertToken

/**
 * L'afegida ràpida amb xips reversibles. docs/02 §4, D12.
 *
 * **Fa servir el mateix parser que la web** —`parseQuickAdd` de `:core-model`, el que
 * `parser-parity` compara amb TypeScript amb els mateixos fixtures— i no una versió
 * pròpia. Una segona implementació divergiria en el primer cas rar i ningú ho veuria
 * fins que algú comparés les dues apps.
 *
 * El xip es pot tornar a text pla amb un toc, que és el que fa que un parser agressiu
 * sigui acceptable: si s'equivoca, es desfà sense esborrar res.
 */
@Composable
fun QuickAddField(
    context: QuickAddContext,
    placeholder: String,
    scopeRequiredLabel: (String) -> String,
    aiModeLabel: (String) -> String,
    onCreate: (title: String, scopeId: String, projectId: String?, assigneeIds: List<String>) -> Unit,
    modifier: Modifier = Modifier,
) {
    var text by remember { mutableStateOf("") }
    var submitted by remember { mutableStateOf(false) }

    val parsed = remember(text, context) { parseQuickAdd(text, context) }

    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (parsed.tokens.isNotEmpty()) {
            LazyRow(horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                items(parsed.tokens, key = { "${it.kind}-${it.start}" }) { token ->
                    Chip(
                        label = if (token.kind == TokenKind.AI_MODE) aiModeLabel(token.id) else token.label,
                        onClick = { text = revertToken(text, token) },
                    )
                }
            }
        }

        OutlinedTextField(
            value = text,
            onValueChange = {
                text = it
                // L'error desapareix en tornar a escriure: no s'ha de quedar clavat.
                if (submitted) submitted = false
            },
            singleLine = true,
            placeholder = { Text(placeholder) },
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(
                onDone = {
                    submitted = true
                    // "Si hi ha més d'un àmbit actiu i no s'ha escrit #, NO ES CREA RES."
                    val scopeId = parsed.scopeId
                    if (parsed.error == null && scopeId != null) {
                        onCreate(parsed.title, scopeId, parsed.projectId, parsed.assigneeIds)
                        text = ""
                        submitted = false
                    }
                },
            ),
            modifier = Modifier.fillMaxWidth().testTag("quick-add"),
        )

        if (submitted && parsed.error?.wire == "scope-required") {
            Text(
                text = scopeRequiredLabel(
                    context.scopes
                        .filter { it.id in context.activeScopeIds }
                        .joinToString(", #") { it.name },
                ),
                color = Femho.colors.dangerText,
                fontSize = FemhoText.meta,
                modifier = Modifier.testTag("quick-add-error"),
            )
        }
    }
}

@Composable
private fun Chip(label: String, onClick: () -> Unit) {
    Text(
        text = label,
        color = Femho.colors.tagText,
        fontSize = FemhoText.meta,
        fontWeight = FontWeight.SemiBold,
        modifier = Modifier
            .clip(RoundedCornerShape(FemhoShape.pill))
            .background(Femho.colors.tagBg)
            .clickable(onClick = onClick)
            .heightIn(min = FemhoSize.touch)
            .padding(horizontal = 12.dp, vertical = 12.dp)
            .testTag("quick-add-chip"),
    )
}
