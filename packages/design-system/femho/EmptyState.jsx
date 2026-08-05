import React from 'react';

/**
 * EmptyState — estat buit amb frase sencera.
 *
 * docs/00 i docs/02 §12: **frases senceres als estats buits, mai un guió.** "Cap tasca
 * sense dia." "Sense esdeveniments ni tasques aquest dia." Un guió és el que posa qui
 * no ha decidit què vol dir.
 *
 * El text arriba com a prop des del catàleg (regla 3), no es fixa aquí.
 */
export function EmptyState({ children, style, ...rest }) {
  return (
    <p
      style={{
        fontSize: 12.5,
        color: 'var(--ink-faint)',
        margin: 0,
        padding: '10px 4px',
        lineHeight: 1.4,
        ...style,
      }}
      {...rest}
    >
      {children}
    </p>
  );
}
