import React from 'react';

export function TabBar({ tabs = [], value, onChange, floating = true, style, ...rest }) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-around',
        height: 'var(--switcher-height)', padding: 'var(--space-2)',
        borderRadius: 'var(--radius-pill)',
        background: 'var(--switcher-bg)',
        backdropFilter: 'var(--blur-switcher)',
        WebkitBackdropFilter: 'var(--blur-switcher)',
        border: '1px solid var(--switcher-border)',
        boxShadow: 'var(--switcher-shadow)',
        boxSizing: 'border-box',
        ...(floating ? { position: 'absolute', left: 22, right: 22, bottom: 'var(--switcher-inset)', zIndex: 5 } : {}),
        ...style,
      }}
      {...rest}
    >
      {tabs.map(t => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            title={t.label}
            aria-label={t.label}
            aria-current={active ? 'page' : undefined}
            onClick={() => onChange && onChange(t.value)}
            style={{
              flex: 1, height: 'var(--tab-hit)', borderRadius: 'var(--radius-pill)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: 'none', cursor: 'pointer',
              transition: 'background var(--dur-fast) var(--ease-standard)',
              background: active ? 'var(--gradient-brand)' : 'transparent',
              color: active ? 'var(--on-brand)' : 'var(--ink-soft)',
              boxShadow: active ? 'var(--shadow-tab-active)' : 'none',
            }}
          >
            {t.icon}
          </button>
        );
      })}
    </div>
  );
}
