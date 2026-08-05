import React from 'react';

/**
 * ScopeChip — el chip d'àmbit de la barra superior.
 *
 * PORTAT del prototip: píndola de 100px de radi, padding 9px 16px, mínim 170px al
 * desplegable de projecte i lliure aquí.
 *
 *   - Actiu:   fons del color de l'àmbit, text `var(--on-brand)`, pes 700.
 *   - Inactiu: `var(--ghost-bg)`, `var(--ink-soft)`, pes 500.
 *
 * AQUÍ ÉS ON FEM-HO TRENCA LA REGLA DE PLOU, I A POSTA
 * ----------------------------------------------------
 * El readme de Plou diu que la tríada de marca no s'ha de fer servir mai com a
 * farciment pla. docs/04 §4 ho trenca deliberadament: els àmbits necessiten color
 * categòric i la tríada ja és el llenguatge del producte.
 *
 * La regla estesa que sí que val:
 *   - Un àmbit no pinta mai una superfície gran. Només indicadors petits: chips, punts
 *     de 5–8px, vores de 3px.
 *   - La targeta de tasca no es tenyeix d'àmbit. Si es tenyissin, un tauler amb tres
 *     àmbits semblaria un arbre de Nadal i el gradient de marca deixaria de destacar.
 *
 * El text actiu va amb `var(--on-brand)` i **mai amb blanc literal**: amb l'accent
 * `soft`, `--on-brand` passa a fosc i un blanc escrit a mà seria il·legible.
 */
export function ScopeChip({ label, color, active = false, onClick, style, ...rest }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        borderRadius: 100,
        padding: '9px 16px',
        border: 'none',
        cursor: 'pointer',
        fontFamily: 'var(--font-sans)',
        fontSize: 13,
        fontWeight: active ? 700 : 500,
        background: active ? color : 'var(--ghost-bg)',
        color: active ? 'var(--on-brand)' : 'var(--ink-soft)',
        whiteSpace: 'nowrap',
        ...style,
      }}
      {...rest}
    >
      {label}
    </button>
  );
}
