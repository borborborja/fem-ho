import React from 'react';

export function NavItem({ icon, active, children, style, ...rest }) {
  return (
    <button
      style={{
        display: 'flex', alignItems: 'center', gap: 'var(--space-5)',
        padding: 'var(--space-5) var(--space-7)', borderRadius: 'var(--radius-nav)',
        cursor: 'pointer', fontWeight: 600, fontSize: 'var(--text-body)',
        border: 'none', width: '100%', textAlign: 'left', fontFamily: 'var(--font-sans)',
        transition: 'background var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard)',
        background: active ? 'var(--gradient-brand)' : 'transparent',
        color: active ? 'var(--on-brand)' : 'var(--nav-idle)',
        boxShadow: active ? 'var(--shadow-nav-active)' : 'none',
        ...style,
      }}
      aria-current={active ? 'page' : undefined}
      {...rest}
    >
      {icon}{children}
    </button>
  );
}
