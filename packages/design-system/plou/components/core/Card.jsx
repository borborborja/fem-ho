import React from 'react';

const TONES = {
  surface: { background: 'var(--card-bg)' },
  washCool: { background: 'var(--gradient-wash-cool)' },
  washWarm: { background: 'var(--gradient-wash-warm)' },
  glass: { background: 'var(--glass-sheet-bg)', backdropFilter: 'var(--blur-glass)', boxShadow: 'var(--shadow-glass)', border: 'none', color: '#14151a' },
};

const PADS = { tile: 'var(--pad-tile)', tight: 'var(--pad-card-tight)', mobile: 'var(--pad-card-mobile)', comfy: 'var(--pad-card)' };
const RADII = { tile: 'var(--radius-card-sm)', tight: 'var(--radius-card-tight)', mobile: 'var(--radius-card)', comfy: 'var(--radius-card)' };

export function Card({ tone = 'surface', density = 'comfy', kicker, title, meta, children, style, ...rest }) {
  return (
    <div
      style={{
        border: '1px solid var(--card-border)',
        borderRadius: RADII[density],
        padding: PADS[density],
        boxShadow: 'var(--card-shadow)',
        boxSizing: 'border-box',
        ...TONES[tone],
        ...style,
      }}
      {...rest}
    >
      {kicker ? (
        <div style={{ fontSize: 'var(--text-kicker)', fontWeight: 'var(--weight-bold)', letterSpacing: 'var(--tracking-caps)', color: 'var(--kicker)', textTransform: 'uppercase' }}>{kicker}</div>
      ) : null}
      {title || meta ? (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--space-3)', marginTop: kicker ? 'var(--space-2)' : 0 }}>
          {title ? <div style={{ fontWeight: 800, fontSize: 'var(--text-card-title)' }}>{title}</div> : null}
          {meta ? <div style={{ fontSize: 'var(--text-kicker)', color: 'var(--ink-faint)', flex: 'none' }}>{meta}</div> : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}
