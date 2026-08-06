import React from 'react';

/**
 * MentionPopover — el desplegable d'autocompletat de `#` i `@` (docs/04 §6).
 *
 * **Desplegable al desktop, full al mòbil.** No és una floritura: al mòbil, un
 * desplegable ancorat al cursor queda tapat pel teclat virtual justament quan
 * l'usuari acaba d'escriure el sigil, que és l'únic moment en què serveix. El full
 * des de baix es col·loca per sobre del teclat i es pot recórrer amb el polze.
 *
 * El canvi el decideix una `matchMedia` i no una prop, perquè és una propietat del
 * dispositiu i no de qui el fa servir: si fos una prop, cada lloc que el munta hauria
 * de recordar passar-la, i el que se n'oblidés donaria un desplegable inaccessible al
 * mòbil sense que res fallés.
 *
 * L'accessibilitat va a fora: qui el munta posa `role="combobox"` i
 * `aria-activedescendant` a l'input, perquè el `listbox` i el camp han d'estar lligats
 * per identificador i el camp no és aquí.
 */
const MOBILE = '(max-width: 860px)';

export function useIsMobile() {
  const [mobile, setMobile] = React.useState(
    () => typeof window !== 'undefined' && window.matchMedia?.(MOBILE).matches === true,
  );

  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia(MOBILE);
    const onChange = (event) => setMobile(event.matches);
    query.addEventListener('change', onChange);
    setMobile(query.matches);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return mobile;
}

export function MentionPopover({
  id,
  suggestions = [],
  activeIndex = -1,
  onPick,
  emptyLabel,
  style,
  ...rest
}) {
  const mobile = useIsMobile();
  if (suggestions.length === 0 && emptyLabel === undefined) return null;

  const sheet = mobile
    ? {
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        margin: 0,
        borderRadius: '18px 18px 0 0',
        // Per sobre de la barra superior (z-index 30) i dels modals de contingut.
        zIndex: 60,
        maxHeight: '52vh',
        // El teclat virtual no ha de tapar l'últim element de la llista.
        paddingBottom: 'calc(8px + env(safe-area-inset-bottom, 0px))',
      }
    : {};

  return (
    <ul
      id={id}
      role="listbox"
      data-testid="quickadd-suggestions"
      data-variant={mobile ? 'sheet' : 'popover'}
      style={{
        listStyle: 'none',
        margin: '4px 0 0',
        padding: 4,
        background: 'var(--card-bg)',
        border: '1px solid var(--card-border)',
        borderRadius: 14,
        boxShadow: 'var(--card-shadow)',
        maxHeight: 260,
        overflowY: 'auto',
        ...sheet,
        ...style,
      }}
      {...rest}
    >
      {suggestions.length === 0 ? (
        <li
          role="presentation"
          style={{ padding: '10px', fontSize: 12.5, color: 'var(--ink-faint)' }}
        >
          {emptyLabel}
        </li>
      ) : (
        suggestions.map((suggestion, index) => (
          <li
            key={suggestion.id}
            id={`${id}-${index}`}
            role="option"
            aria-selected={index === activeIndex}
            data-testid={`suggestion-${suggestion.id}`}
            onMouseDown={(event) => {
              // `mousedown` i no `click`: amb `click`, l'input perd el focus abans i el
              // desplegable es tanca sol.
              event.preventDefault();
              onPick?.(suggestion);
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              // Al mòbil, àrea tàctil de 44px (docs/02 §10).
              padding: mobile ? '12px 12px' : '7px 10px',
              minHeight: mobile ? 44 : undefined,
              borderRadius: 10,
              cursor: 'pointer',
              fontSize: 13,
              color: 'var(--ink)',
              background: index === activeIndex ? 'var(--ghost-bg)' : 'transparent',
            }}
          >
            {suggestion.color ? (
              <span
                aria-hidden="true"
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: suggestion.color,
                  flexShrink: 0,
                }}
              />
            ) : null}
            {suggestion.label}
          </li>
        ))
      )}
    </ul>
  );
}
