import React from 'react';

// Plou has no logo mark. The brand is the word "Plou" set in Roboto 900,
// either as gradient-clipped text (on themed surfaces) or flat white (over the map).
export function Wordmark({ size = 24, tone = 'gradient', place, style, ...rest }) {
  const word = {
    fontFamily: 'var(--font-sans)',
    fontWeight: 'var(--weight-black)',
    fontSize: size,
    letterSpacing: 'var(--tracking-snug)',
    lineHeight: 1,
    ...(tone === 'gradient'
      ? { background: 'var(--gradient-brand-text)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }
      : { color: tone === 'white' ? '#fff' : 'var(--ink)' }),
  };
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-4)', ...style }} {...rest}>
      <span style={word}>Plou</span>
      {place ? (
        <span style={{ fontSize: size * 0.54, color: tone === 'white' ? 'var(--glass-text-soft)' : 'var(--ink-soft)', fontWeight: 'var(--weight-regular)' }}>{place}</span>
      ) : null}
    </div>
  );
}
