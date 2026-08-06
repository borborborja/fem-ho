import React from 'react';

/**
 * AiModeBadge — els tres modes d'IA dins d'una targeta densa (docs/09 §3).
 *
 * El brief ho demana explícitament: *"L'interface de tasques i de calendari ha de
 * permetre veure visualment si es una tasca individual, que la IA pot ajudar o la fa
 * autònomament la IA."*
 *
 *   - `manual`    → **no es pinta res.** És el cas normal i no ha d'ocupar espai.
 *   - `assisted`  → pastilla tènue amb `sparkles` i el text que arribi per prop.
 *   - `delegated` → pastilla amb `--gradient-wash-tag`, `sparkles` plena i text.
 *
 * **El color no és mai l'únic senyal**: sempre porta icona i text. Una pastilla que
 * només es distingís pel to seria invisible per a qui no distingeixi aquells dos tons,
 * i el mode d'IA no és un detall decoratiu.
 *
 * Una tasca **reservada per un agent en aquest moment** porta la pastilla amb una
 * pulsació lenta, que `prefers-reduced-motion` converteix en estàtica.
 */
export function AiModeBadge({ mode, label, leased = false, style, ...rest }) {
  // El cas normal no pinta res. Retornar `null` i no una pastilla buida: una pastilla
  // invisible seguiria ocupant el seu lloc a la fila de metadades.
  if (mode !== 'assisted' && mode !== 'delegated') return null;

  const delegated = mode === 'delegated';

  return (
    <span
      data-ai-mode={mode}
      data-leased={leased ? 'true' : 'false'}
      className={leased ? 'femho-ai-badge femho-ai-badge--leased' : 'femho-ai-badge'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        borderRadius: 100,
        padding: '2px 8px',
        fontFamily: 'var(--font-sans)',
        fontSize: 11,
        fontWeight: delegated ? 700 : 500,
        lineHeight: 1.4,
        background: delegated ? 'var(--gradient-wash-tag)' : 'var(--ghost-bg)',
        color: delegated ? 'var(--text-primary)' : 'var(--ink-soft)',
        ...style,
      }}
      {...rest}
    >
      <SparklesIcon filled={delegated} />
      {label}
    </span>
  );
}

/**
 * El punt de canvi autònom no vist (docs/09 §3).
 *
 * Sis píxels a la cantonada superior dreta de la targeta, amb `--plou-orange`.
 * Desapareix en obrir la tasca. És el que respon a *"També veure si hi ha hagut algun
 * canvi autònom"*.
 *
 * Porta `title` i `aria-label` per prop: un punt de color sense text no diu res a qui
 * navega amb lector de pantalla.
 */
export function UnseenAiDot({ label, style, ...rest }) {
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      data-testid="unseen-ai-dot"
      style={{
        position: 'absolute',
        top: 8,
        right: 8,
        width: 6,
        height: 6,
        borderRadius: '50%',
        background: 'var(--plou-orange)',
        ...style,
      }}
      {...rest}
    />
  );
}

/** `sparkles`, del joc d'icones. Plena per a `delegated`, de traç per a `assisted`. */
function SparklesIcon({ filled }) {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
      <path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15z" />
    </svg>
  );
}
