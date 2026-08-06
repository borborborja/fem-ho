import React from 'react';

/**
 * KanbanColumn — contenidor de columna amb capçalera, recompte, scroll i peu.
 *
 * PORTADA del prototip. Capçalera a 14,5px pes 800, pastilla de recompte a 11,5px amb
 * radi 100 i padding 1px 9px, cos amb scroll sense barra visible (`femho-scroll`) i 9px
 * entre targetes.
 *
 * LA VARIANT `inbox` ÉS DIFERENT, I NO COM DEIA docs/02
 * -----------------------------------------------------
 * docs/02 §4 descriu l'Inbox com "una targeta sòlida" i les altres tres com
 * "contenidors buits". El prototip fa **el contrari, i millor**:
 *
 *   - L'Inbox és un panell amb `--gradient-wash-warm`, vora hairline i radi 22.
 *   - Les altres TRES comparteixen UNA SOLA targeta sòlida.
 *
 * Les dues solucions fan que l'Inbox es distingeixi, però només la del prototip
 * compleix la segona meitat del que demana el brief a la línia 39: que les tres
 * "es sentin un sol element". docs/02 §3 diu que en jerarquia mana el prototip, i
 * aquí es nota per què.
 *
 * Per això aquest component NO pinta el fons de les tres columnes normals: el pinta el
 * contenidor que les agrupa (`KanbanBoard`). Aquí només hi ha el `--column-bg` tènue
 * que les separa entre elles.
 */
export function KanbanColumn({
  label,
  count,
  variant = 'grouped',
  divider = false,
  headerExtra,
  headerActions,
  children,
  footer,
  dropIndicator = false,
  style,
  ...rest
}) {
  const isInbox = variant === 'inbox';
  // `grouped` és la variant de les tres que van dins d'un KanbanGroup: no pinten res
  // pel seu compte, perquè el fons el posa la targeta que les envolta. Només un
  // separador a l'esquerra, i no a la primera.
  const isGrouped = variant === 'grouped';

  return (
    <section
      aria-label={label}
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        flex: 1,
        borderRadius: isInbox ? 22 : isGrouped ? 0 : 20,
        padding: 14,
        minWidth: 0,
        background: isInbox
          ? 'var(--gradient-wash-warm)'
          : isGrouped
            ? 'transparent'
            : 'var(--column-bg)',
        border: isGrouped ? 'none' : '1px solid var(--card-border)',
        borderLeft: isGrouped && divider ? '1px solid var(--card-border)' : undefined,
        // La columna destí mentre s'arrossega (docs/02 §4).
        boxShadow: dropIndicator ? 'inset 0 0 0 2px var(--plou-blue)' : undefined,
        ...style,
      }}
      {...rest}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '2px 4px 12px',
        }}
      >
        <h2 style={{ fontSize: 14.5, fontWeight: 800, margin: 0, color: 'var(--ink)' }}>{label}</h2>
        <span
          style={{
            fontSize: 11.5,
            color: 'var(--ink-faint)',
            // El prototip hi posa rgba(255,255,255,0.5) literal a l'Inbox, que en tema
            // fosc és una taca lluminosa. Tokenitzat a femho/tokens.css, mateix bug que
            // --column-bg.
            background: isInbox ? 'var(--inbox-pill-bg)' : 'var(--tag-bg)',
            borderRadius: 100,
            padding: '1px 9px',
          }}
        >
          {count}
        </span>
        {headerActions ? (
          <>
            <span style={{ flex: 1 }} />
            {headerActions}
          </>
        ) : null}
      </header>

      {headerExtra}

      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <div
          className="femho-scroll"
          style={{
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            gap: 9,
            overflowY: 'auto',
          }}
        >
          {children}
        </div>
      </div>

      {footer ? <div style={{ marginTop: 10 }}>{footer}</div> : null}
    </section>
  );
}

/**
 * L'epígraf d'àmbit plegable.
 *
 * Punt de 7px del color de l'àmbit, nom en majúscules a 11,5px pes 700 amb
 * `letter-spacing: 0.04em`, i un `▾`/`▸`. Surt quan hi ha més d'un àmbit actiu i el
 * filtre de projecte és "Tots" (docs/02 §4).
 */
export function ScopeGroupHeader({ label, color, open, onToggle, extra }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: 4 }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          flex: 1,
          border: 'none',
          background: 'none',
          padding: 0,
          cursor: 'pointer',
          fontFamily: 'var(--font-sans)',
          textAlign: 'left',
        }}
      >
        <span
          aria-hidden="true"
          style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0 }}
        />
        <span
          style={{
            fontSize: 11.5,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            color: 'var(--ink-soft)',
          }}
        >
          {label}
        </span>
        <span aria-hidden="true" style={{ color: 'var(--ink-faint)', fontSize: 11 }}>
          {open ? '▾' : '▸'}
        </span>
      </button>
      {extra}
    </div>
  );
}

/**
 * El contenidor de les tres columnes que no són l'Inbox.
 *
 * És el que fa que "es sentin un sol element" (brief línia 39): una sola targeta
 * sòlida amb les tres a dins, tal com fa el prototip.
 */
export function KanbanGroup({ children, borderColor, style, ...rest }) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 0,
        background: 'var(--card-bg)',
        border: '1px solid var(--card-border)',
        borderRadius: 22,
        boxShadow: 'var(--card-shadow)',
        padding: 14,
        minHeight: 0,
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}
