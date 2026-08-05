import React from 'react';

export function Dialog({ open = true, title, width = 420, onClose, children, footer, style, ...rest }) {
  if (!open) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: 'absolute', inset: 0, zIndex: 30,
        background: 'var(--dialog-backdrop)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 'var(--space-9)',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        style={{
          width: '100%', maxWidth: width, boxSizing: 'border-box',
          background: 'var(--dialog-bg)', color: 'var(--ink)',
          border: '1px solid var(--card-border)',
          borderRadius: 'var(--radius-dialog)',
          padding: 'var(--space-12)',
          display: 'flex', flexDirection: 'column', gap: 'var(--space-7)',
          boxShadow: 'var(--shadow-dialog)',
          ...style,
        }}
        {...rest}
      >
        {title ? <div style={{ fontWeight: 800, fontSize: 'var(--text-h2)' }}>{title}</div> : null}
        {children}
        {footer ? <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-2)' }}>{footer}</div> : null}
      </div>
    </div>
  );
}
