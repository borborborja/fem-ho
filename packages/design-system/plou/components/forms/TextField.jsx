import React from 'react';

export function TextField({ label, tone = 'surface', shape = 'rounded', icon, style, ...rest }) {
  const tones = {
    surface: { background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--ink)' },
    glass: { background: 'var(--glass-bg)', backdropFilter: 'var(--blur-glass)', border: '1px solid var(--glass-border)', color: '#fff' },
  };
  const input = (
    <input
      style={{
        width: '100%', boxSizing: 'border-box', outline: 'none',
        borderRadius: shape === 'pill' ? 'var(--radius-pill)' : 'var(--radius-input)',
        padding: shape === 'pill' ? '11px 16px' : 'var(--pad-input)',
        fontSize: 'var(--text-body-xs)', fontFamily: 'var(--font-sans)',
        ...tones[tone],
      }}
      {...rest}
    />
  );
  if (!label) return <div style={{ display: 'flex', flex: 1, ...style }}>{input}</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', ...style }}>
      <div style={{ fontSize: 'var(--text-tag)', color: 'var(--ink-soft)' }}>{label}</div>
      {input}
    </div>
  );
}
