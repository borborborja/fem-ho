import React from 'react';

export function Tag({ tone = 'neutral', size = 'md', icon, children, style, ...rest }) {
  const tones = {
    neutral: { background: 'var(--tag-bg)', color: 'var(--tag-text)' },
    accent: { background: 'var(--gradient-wash-tag)', color: 'var(--tag-text)' },
    glass: { background: 'var(--glass-bg-strong)', color: '#fff' },
    onAlert: { background: 'rgba(255,255,255,0.2)', color: '#fff' },
  };
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '5px',
        fontSize: size === 'sm' ? 'var(--text-tag)' : 'var(--text-label)',
        fontWeight: 600,
        padding: size === 'sm' ? 'var(--pad-tag-sm)' : 'var(--pad-tag)',
        borderRadius: 'var(--radius-pill)',
        ...tones[tone], ...style,
      }}
      {...rest}
    >
      {icon}{children}
    </span>
  );
}
