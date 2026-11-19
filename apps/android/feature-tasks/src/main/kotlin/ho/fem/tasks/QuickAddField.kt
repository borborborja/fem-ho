package ho.fem.tasks

import android.view.KeyEvent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import ho.fem.designsystem.Femho
import ho.fem.designsystem.FemhoShape
import ho.fem.designsystem.FemhoSize
import ho.fem.designsystem.FemhoText
import ho.fem.model.QuickAddContext
import ho.fem.model.QuickAddError
import ho.fem.model.QuickAddResult
import ho.fem.model.QuickAddSuggestion
import ho.fem.model.TokenKind
import ho.fem.model.openSigil
import ho.fem.model.parseQuickAdd
import ho.fem.model.quickAddSuggestions
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
    addLabel: String,
    creationError: String,
    onCreate: (QuickAddResult, onPersisted: (Boolean) -> Unit) -> Unit,
    /** El text que arriba de fora (full de compartir, accessos directes), si n'hi ha. */
    initialText: String = "",
    modifier: Modifier = Modifier,
    draftText: String? = null,
    onDraftChange: ((String) -> Unit)? = null,
    savingExternally: Boolean = false,
    focusRequested: Boolean = false,
    onFocusHandled: () -> Unit = {},
) {
    var localDraft by rememberSaveable { mutableStateOf(initialText) }
    val text = draftText ?: localDraft
    fun changeDraft(value: String) {
        if (draftText == null) localDraft = value else onDraftChange?.invoke(value)
    }
    var submitted by rememberSaveable { mutableStateOf(false) }
    var failed by rememberSaveable { mutableStateOf(false) }
    var persistingLocally by remember { mutableStateOf(false) }
    val persisting = persistingLocally || savingExternally
    var focused by remember { mutableStateOf(false) }
    val focusRequester = remember { FocusRequester() }
    val keyboard = LocalSoftwareKeyboardController.current
    val windowFocused = LocalWindowInfo.current.isWindowFocused
    LaunchedEffect(focusRequested, windowFocused) {
        // Un toc al widget pot portar una activitat viva al davant abans que la finestra tingui focus.
        if (focusRequested && windowFocused && focusRequester.requestFocus()) {
            withFrameNanos { }
            keyboard?.show()
            onFocusHandled()
        }
    }
    // Escape tanca el full sense tocar el text (QuickAdd.tsx:71); tornar a escriure el
    // reobre, que és el que espera qui el va tancar per mirar el que ja havia escrit.
    var dismissed by remember { mutableStateOf(false) }
    var active by remember { mutableIntStateOf(0) }

    // El text que arriba de fora (full de compartir) ho fa quan el camp ja és a
    // pantalla: si només el llegís el `remember`, no es veuria mai.
    LaunchedEffect(initialText) {
        if (initialText.isNotBlank() && text.isBlank()) changeDraft(initialText)
    }

    val parsed = remember(text, context) { parseQuickAdd(text, context) }

    // El full d'autocompletat: el mateix sigil i el mateix filtre que la web, amb les
    // persones per @, àmbits i projectes per # i les tipologies per $.
    val suggestions = remember(text, context, parsed.tokens, dismissed, focused) {
        if (dismissed || !focused) emptyList() else quickAddSuggestions(text, context, parsed.tokens)
    }

    LaunchedEffect(suggestions) {
        if (active >= suggestions.size) active = 0
    }

    fun pick(suggestion: QuickAddSuggestion) {
        val open = openSigil(text) ?: return
        changeDraft(text.substring(0, open.start) + suggestion.insert)
        active = 0
        dismissed = false
    }

    fun submit() {
        val submittedText = draftText ?: localDraft
        if (persistingLocally || savingExternally || submittedText.isBlank()) return
        val result = parseQuickAdd(submittedText, context)
        submitted = true
        failed = false
        if (result.error != null || result.scopeId == null) return
        persistingLocally = true
        onCreate(result) { saved ->
            persistingLocally = false
            failed = !saved
            if (saved) {
                // Si l'esborrany viu al ViewModel, aquest rep la confirmació encara que
                // la pantalla es recreï mentre Room desa la tasca.
                if (draftText == null && localDraft == submittedText) localDraft = ""
                submitted = false
            }
        }
    }

    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (parsed.tokens.isNotEmpty()) {
            LazyRow(horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                items(parsed.tokens, key = { "${it.kind}-${it.start}" }) { token ->
                    Chip(
                        label = if (token.kind == TokenKind.AI_MODE) aiModeLabel(token.id) else token.label,
                        onClick = { changeDraft(revertToken(text, token)) },
                    )
                }
            }
        }

        // El full ancorat sobre el teclat (docs/03 §4:82): res de popups que el teclat
        // taparia. Va just a sobre del camp, que és on el teclat comença.
        if (suggestions.isNotEmpty()) {
            LazyColumn(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(max = FemhoSize.touch * 3)
                    .clip(RoundedCornerShape(FemhoShape.column))
                    .background(Femho.colors.panelBg)
                    .testTag("quick-add-suggestions"),
            ) {
                itemsIndexed(suggestions, key = { _, suggestion -> suggestion.insert }) { index, suggestion ->
                    Text(
                        text = suggestion.label,
                        color = Femho.colors.ink,
                        fontSize = FemhoText.body,
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(if (index == active) Femho.colors.tagBg else Color.Transparent)
                            .clickable { pick(suggestion) }
                            .heightIn(min = FemhoSize.touch)
                            .padding(horizontal = 12.dp, vertical = 6.dp)
                            .testTag("suggestion-$index"),
                    )
                }
            }
        }

        OutlinedTextField(
            value = text,
            onValueChange = {
                changeDraft(it)
                // L'error desapareix en tornar a escriure: no s'ha de quedar clavat.
                if (submitted) submitted = false
                if (failed) failed = false
                dismissed = false
            },
            singleLine = true,
            placeholder = { Text(placeholder) },
            trailingIcon = {
                IconButton(
                    enabled = text.isNotBlank() && !persisting,
                    onClick = ::submit,
                    modifier = Modifier
                        .semantics { contentDescription = addLabel }
                        .testTag("quick-add-submit"),
                ) {
                    if (persisting) {
                        CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                    } else {
                        Text("+", color = Femho.colors.ink, fontSize = FemhoText.body)
                    }
                }
            },
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(
                onDone = {
                    // Amb el full obert, Enter tria la suggerència en comptes de crear.
                    if (suggestions.isNotEmpty()) {
                        suggestions.getOrNull(active)?.let { pick(it) }
                    } else {
                        submit()
                    }
                },
            ),
            modifier = Modifier
                .fillMaxWidth()
                .testTag("quick-add")
                .focusRequester(focusRequester)
                .onFocusChanged { focused = it.isFocused }
                .onPreviewKeyEvent { event ->
                    if (event.type == KeyEventType.KeyDown && suggestions.isNotEmpty()) {
                        when (event.nativeKeyEvent.keyCode) {
                            KeyEvent.KEYCODE_DPAD_DOWN -> {
                                active = (active + 1) % suggestions.size
                                true
                            }
                            KeyEvent.KEYCODE_DPAD_UP -> {
                                active = (active - 1 + suggestions.size) % suggestions.size
                                true
                            }
                            KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_DPAD_CENTER -> {
                                suggestions.getOrNull(active)?.let { pick(it) }
                                true
                            }
                            KeyEvent.KEYCODE_BACK, KeyEvent.KEYCODE_ESCAPE -> {
                                dismissed = true
                                true
                            }
                            else -> false
                        }
                    } else if (
                        event.type == KeyEventType.KeyDown &&
                        event.nativeKeyEvent.keyCode == KeyEvent.KEYCODE_ENTER
                    ) {
                        if (event.nativeKeyEvent.repeatCount == 0) submit()
                        true
                    } else false
                },
        )

        val error = when {
            failed -> creationError
            submitted && parsed.error == QuickAddError.SCOPE_REQUIRED -> scopeRequiredLabel(
                context.scopes.filter { it.id in context.activeScopeIds }.joinToString(", #") { it.name },
            )
            else -> null
        }
        if (error != null) {
            Text(
                text = error,
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
