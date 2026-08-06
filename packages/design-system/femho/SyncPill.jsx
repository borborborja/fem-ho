import React from 'react';

/**
 * SyncPill — l'indicador de canvis pendents i de sense connexió (docs/04 §6, docs/02 §12).
 *
 * Tres estats i prou:
 *   - `offline` — pastilla persistent. **Persistent és la paraula**: desapareixent i
 *     tornant, l'usuari no sap mai si el que acaba d'escriure s'ha desat.
 *   - `pending` — hi ha cua per pujar. Es veu encara que hi hagi connexió, perquè el
 *     que importa no és la xarxa sinó si el que has fet ja és a l'altre costat.
 *   - `synced` — dos segons i fora. És una confirmació, no un estat.
 *
 * No hi ha estat "sincronitzant": un indicador que parpelleja a cada petició acaba
 * sent soroll que ningú mira, i llavors tampoc es mira quan diu que hi ha un problema.
 */
export function SyncPill({ state, label, count = 0, onClick, style, ...rest }) {
  if (state === 'idle') return null;

  const palette = {
    offline: { bg: 'var(--danger-bg)', fg: 'var(--danger-text)' },
    pending: { bg: 'var(--tag-bg)', fg: 'var(--ink-soft)' },
    synced: { bg: 'var(--ghost-bg)', fg: 'var(--ink-soft)' },
  }[state];

  return (
    <div
      role="status"
      aria-live="polite"
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        padding: '7px 14px',
        borderRadius: 100,
        fontSize: 11.5,
        fontWeight: 600,
        background: palette.bg,
        color: palette.fg,
        cursor: onClick === undefined ? 'default' : 'pointer',
        ...style,
      }}
      {...rest}
    >
      <span
        aria-hidden="true"
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: 'currentColor',
          // Sense animació: docs/04 prohibeix el shimmer i un punt que batega és el
          // mateix problema amb una altra forma.
          opacity: state === 'synced' ? 0.5 : 1,
        }}
      />
      {label}
      {count > 0 ? (
        <span
          style={{
            padding: '1px 7px',
            borderRadius: 100,
            background: 'var(--card-bg)',
            fontSize: 10.5,
            fontWeight: 700,
          }}
        >
          {count}
        </span>
      ) : null}
    </div>
  );
}
