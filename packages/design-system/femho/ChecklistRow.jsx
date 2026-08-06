import React from 'react';

/**
 * ChecklistRow — un ítem de llista senzilla (docs/04 §6, docs/02 §6).
 *
 * **Casella rodona de 22px i el text. Res més.** Sense pastilles, sense assignats,
 * sense dates: un ítem no en té (P1), i la contenció és deliberada, no una simplificació
 * temporal. El dia que un ítem porti una data ja serà una subtasca amb un altre nom.
 *
 * La casella és el mateix cercle de 22px de `TaskCard` a posta: marcar una cosa és el
 * mateix gest a tot el producte, i que la llista tingui una casella diferent del kanban
 * faria que semblessin dos productes.
 */
export function ChecklistRow({
  text,
  done = false,
  onToggle,
  onTextChange,
  strikeWhenDone = true,
  toggleLabel,
  style,
  ...rest
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 11,
        padding: '7px 2px',
        ...style,
      }}
      {...rest}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={toggleLabel}
        onClick={onToggle}
        style={{
          flex: '0 0 auto',
          width: 22,
          height: 22,
          marginTop: 1,
          borderRadius: '50%',
          cursor: 'pointer',
          display: 'grid',
          placeItems: 'center',
          padding: 0,
          border: done ? 'none' : '2px solid var(--card-border)',
          background: done ? 'var(--gradient-brand-2stop)' : 'transparent',
        }}
      >
        {done ? (
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path
              d="M2.5 6.2l2.4 2.4L9.6 3.9"
              fill="none"
              stroke="var(--on-brand)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : null}
      </button>

      {onTextChange === undefined ? (
        <span
          style={{
            fontSize: 13.5,
            lineHeight: 1.35,
            color: done ? 'var(--ink-faint)' : 'var(--ink)',
            // El ratllat només quan els completats es veuen EN LÍNIA: a la secció
            // "Completats" ja se sap que ho estan i ratllar-los és soroll.
            textDecoration: done && strikeWhenDone ? 'line-through' : 'none',
          }}
        >
          {text}
        </span>
      ) : (
        <input
          value={text}
          onChange={(event) => onTextChange(event.target.value)}
          style={{
            flex: 1,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            font: 'inherit',
            fontSize: 13.5,
            lineHeight: 1.35,
            padding: 0,
            color: done ? 'var(--ink-faint)' : 'var(--ink)',
            textDecoration: done && strikeWhenDone ? 'line-through' : 'none',
          }}
        />
      )}
    </div>
  );
}
