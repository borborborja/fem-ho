import React from 'react';

export function GlassBar({ shape = 'pill', children, style, ...rest }) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 'var(--space-4)',
        background: 'var(--glass-bg)',
        backdropFilter: 'var(--blur-glass)', WebkitBackdropFilter: 'var(--blur-glass)',
        border: '1px solid var(--glass-border)',
        borderRadius: shape === 'pill' ? 'var(--radius-pill)' : 'var(--radius-card-tight)',
        padding: shape === 'pill' ? '8px 12px' : 'var(--pad-card-tight)',
        color: 'var(--glass-text)', boxSizing: 'border-box',
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}
