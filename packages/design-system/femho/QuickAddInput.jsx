import React from 'react';
import { MentionPopover } from './MentionPopover.jsx';

/**
 * QuickAddInput — el camp d'afegida ràpida amb xips reversibles i autocompletat.
 *
 * docs/02 §4: "`Enter` crea la tasca **sense obrir cap modal**. El camp es buida i manté
 * el focus, per poder-ne encadenar."
 *
 * COM ES PINTEN ELS XIPS
 * -----------------------
 * docs/02 §4 diu "es pinta com a pastilla **dins del camp**". El prototip no en té: fa
 * servir un `<input>` pla, o sigui que aquí no hi ha res a portar i mana el document.
 *
 * Els xips van dins del mateix contenidor que l'input, en una fila pròpia a sobre. La
 * caixa sencera es pinta com un camp —vora, fons i radi de `femho-input`— o sigui que
 * visualment són "dins del camp".
 *
 * NO es fa amb una capa superposada sobre el text de l'input, que és l'altra manera
 * òbvia: una pastilla és més ampla que el text que substitueix, i el cursor acaba
 * desplaçat respecte del que es veu. Amb IME, amb text llarg o amb desplaçament
 * horitzontal, el desajust es fa gran. Aquí el cursor sempre és on l'usuari el veu.
 *
 * Els textos arriben com a props des del catàleg (regla 3).
 */
export function QuickAddInput({
  value,
  onChange,
  onSubmit,
  placeholder,
  tokens = [],
  onRevertToken,
  error,
  suggestions = [],
  activeSuggestion = -1,
  onSuggestionKeyDown,
  onSuggestionPick,
  inputRef,
  style,
  ...rest
}) {
  const listId = React.useId();
  const open = suggestions.length > 0;

  return (
    <div style={{ ...style }} {...rest}>
      <div
        style={{
          background: 'var(--input-bg)',
          border: '1px solid var(--input-border)',
          borderRadius: 'var(--radius-input)',
          padding: tokens.length > 0 ? '8px 10px 4px' : 0,
          boxSizing: 'border-box',
          width: '100%',
        }}
      >
        {tokens.length > 0 ? (
          <div
            data-testid="quickadd-chips"
            style={{ display: 'flex', gap: 5, flexWrap: 'wrap', paddingBottom: 6 }}
          >
            {tokens.map((token) => (
              <button
                key={`${token.kind}-${token.start}`}
                type="button"
                data-testid={`chip-${token.kind}`}
                data-chip-label={token.label}
                onClick={() => onRevertToken?.(token)}
                // El xip s'ha de poder desfer amb un clic (D12). El títol accessible
                // ho diu, perquè un botó que només ensenya un nom no explica què fa.
                title={token.revertLabel}
                aria-label={token.revertLabel}
                style={{
                  fontSize: 10.5,
                  fontWeight: 600,
                  padding: '3px 9px',
                  borderRadius: 100,
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-sans)',
                  background:
                    token.kind === 'aiMode' || token.kind === 'taskType'
                      ? 'var(--gradient-wash-tag)'
                      : 'var(--tag-bg)',
                  color: 'var(--tag-text)',
                }}
              >
                {token.label}
              </button>
            ))}
          </div>
        ) : null}

        <input
          ref={inputRef}
          className="plou-input"
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange?.(event.target.value)}
          onKeyDown={(event) => {
            // L'autocompletat mira primer: fletxes, Enter i Escape són seus mentre és
            // obert (docs/02 §4).
            if (open && onSuggestionKeyDown?.(event) === true) return;
            if (event.key === 'Enter') {
              event.preventDefault();
              onSubmit?.();
            }
          }}
          // Combobox accessible amb aria-activedescendant (docs/02 §4). Sense això, un
          // lector de pantalla no anuncia què hi ha seleccionat a la llista.
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            open && activeSuggestion >= 0 ? `${listId}-${activeSuggestion}` : undefined
          }
          style={{
            border: tokens.length > 0 ? 'none' : undefined,
            background: tokens.length > 0 ? 'transparent' : undefined,
            padding: tokens.length > 0 ? 0 : undefined,
          }}
        />
      </div>

      {open ? (
        <MentionPopover
          id={listId}
          suggestions={suggestions}
          activeIndex={activeSuggestion}
          onPick={onSuggestionPick}
        />
      ) : null}

      {error ? (
        <div
          data-testid="quickadd-error"
          role="alert"
          style={{ fontSize: 11, color: 'var(--danger-text)', paddingTop: 4 }}
        >
          {error}
        </div>
      ) : null}
    </div>
  );
}
